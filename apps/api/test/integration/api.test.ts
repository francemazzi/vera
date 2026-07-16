import type { ActorRole, EvaluationRun, JsonValue, ReviewDecision } from "@vera/contracts";
import { StorageConflictError } from "@vera/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiProblem, createApiServer } from "../../src/index.js";
import type { AuthService, AuthenticatedAccount } from "../../src/index.js";
import { makeEvaluationRun, makeReviewDecision, uuid } from "../fixtures/evaluation.js";

class FakeRepository {
  readonly runs = new Map<string, EvaluationRun>();
  readonly decisions = new Map<string, ReviewDecision[]>();
  readonly idempotency = new Map<string, JsonValue>();

  public saveEvaluationRun(run: EvaluationRun): Promise<EvaluationRun> {
    if (this.runs.has(run.id)) throw new StorageConflictError("EvaluationRun already exists");
    this.runs.set(run.id, run);
    this.decisions.set(run.id, []);
    return Promise.resolve(run);
  }

  public getEvaluationRun(id: string): Promise<EvaluationRun> {
    const run = this.runs.get(id);
    if (run === undefined) throw new StorageConflictError("missing");
    return Promise.resolve(run);
  }

  public appendReviewDecision(decision: ReviewDecision): Promise<ReviewDecision> {
    const stream = this.decisions.get(decision.runId);
    if (stream === undefined) throw new StorageConflictError("missing run");
    const previous = stream.at(-1);
    if (
      decision.sequence !== stream.length + 1 ||
      decision.previousEventHash !== (previous?.contentHash ?? null)
    ) {
      throw new StorageConflictError("ReviewDecision sequence is stale or non-contiguous");
    }
    stream.push(decision);
    return Promise.resolve(decision);
  }

  public getOrCreateIdempotency(input: {
    readonly scope: string;
    readonly key: string;
    readonly response: JsonValue;
  }): Promise<{ readonly response: JsonValue; readonly created: boolean }> {
    const mapKey = `${input.scope}:${input.key}`;
    const existing = this.idempotency.get(mapKey);
    if (existing !== undefined) return Promise.resolve({ response: existing, created: false });
    this.idempotency.set(mapKey, input.response);
    return Promise.resolve({ response: input.response, created: true });
  }

  public recordBlob(): Promise<void> {
    return Promise.resolve();
  }
}

function account(role: ActorRole): AuthenticatedAccount {
  return {
    id: uuid(role === "AUTHOR" ? 70 : role === "REVIEWER" ? 71 : 72),
    email: `${role.toLocaleLowerCase("und")}@example.test`,
    displayName: `Synthetic ${role}`,
    role,
  };
}

const fakeAuth: AuthService = {
  createAccount() {
    return Promise.resolve(account("ADMIN"));
  },
  login() {
    return Promise.resolve({
      token: "token",
      expiresAt: "2026-07-15T20:00:00.000Z",
      account: account("ADMIN"),
    });
  },
  authenticate(authorization) {
    if (authorization === "Bearer author") return Promise.resolve(account("AUTHOR"));
    if (authorization === "Bearer reviewer") return Promise.resolve(account("REVIEWER"));
    if (authorization === "Bearer admin") return Promise.resolve(account("ADMIN"));
    throw new ApiProblem(401, "Unauthorized", "Missing bearer token");
  },
};

describe("VERA API", () => {
  const repository = new FakeRepository();
  let server: Awaited<ReturnType<typeof createApiServer>>;

  beforeAll(async () => {
    server = await createApiServer({
      repository: repository as never,
      auth: fakeAuth,
      now: () => "2026-07-15T12:00:00.000Z",
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it("serves health and OpenAPI", async () => {
    const health = await server.inject({ method: "GET", url: "/health" });
    const openapi = await server.inject({ method: "GET", url: "/openapi.json" });

    expect(health.statusCode).toBe(200);
    expect(openapi.statusCode).toBe(200);
    expect(openapi.json()).toMatchObject({ openapi: "3.0.3" });
  });

  it("enforces auth, RBAC and idempotency for evaluation creation", async () => {
    const run = makeEvaluationRun();

    expect(
      (await server.inject({ method: "POST", url: "/v1/evaluation-runs", payload: run }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/v1/evaluation-runs",
          headers: { authorization: "Bearer reviewer", "idempotency-key": "idem-api-1" },
          payload: run,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/v1/evaluation-runs",
          headers: { authorization: "Bearer author" },
          payload: run,
        })
      ).statusCode,
    ).toBe(400);

    const created = await server.inject({
      method: "POST",
      url: "/v1/evaluation-runs",
      headers: { authorization: "Bearer author", "idempotency-key": "idem-api-1" },
      payload: run,
    });
    const replay = await server.inject({
      method: "POST",
      url: "/v1/evaluation-runs",
      headers: { authorization: "Bearer author", "idempotency-key": "idem-api-1" },
      payload: run,
    });

    expect(created.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
  });

  it("blocks mutation and restricts review decisions to reviewer roles", async () => {
    const run = makeEvaluationRun();
    if (!repository.runs.has(run.id)) {
      repository.runs.set(run.id, run);
      repository.decisions.set(run.id, []);
    }
    const decision = makeReviewDecision(run);

    expect(
      (
        await server.inject({
          method: "PATCH",
          url: `/v1/evaluation-runs/${run.id}`,
          headers: { authorization: "Bearer admin" },
          payload: {},
        })
      ).statusCode,
    ).toBe(405);
    expect(
      (
        await server.inject({
          method: "POST",
          url: `/v1/evaluation-runs/${run.id}/review-decisions`,
          headers: { authorization: "Bearer author", "idempotency-key": "idem-review-1" },
          payload: decision,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await server.inject({
          method: "POST",
          url: `/v1/evaluation-runs/${run.id}/review-decisions`,
          headers: { authorization: "Bearer reviewer", "idempotency-key": "idem-review-1" },
          payload: decision,
        })
      ).statusCode,
    ).toBe(201);
  });
});
