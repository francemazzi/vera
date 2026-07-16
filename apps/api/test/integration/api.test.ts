import { sha256Bytes, sha256CanonicalJson } from "@vera/contracts";
import type { ActorRole, EvaluationRun, JsonValue, ReviewDecision } from "@vera/contracts";
import { StorageConflictError } from "@vera/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiProblem, createApiServer } from "../../src/index.js";
import type { AuthService, AuthenticatedAccount } from "../../src/index.js";
import { makeEvaluationRun, makeReviewDecision, uuid } from "../fixtures/evaluation.js";

class FakeRepository {
  readonly runs = new Map<string, EvaluationRun>();
  readonly decisions = new Map<string, ReviewDecision[]>();
  readonly idempotency = new Map<
    string,
    { readonly requestHash: string; readonly response: JsonValue }
  >();

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

  public saveEvaluationRunIdempotently(input: {
    readonly run: EvaluationRun;
    readonly scope: string;
    readonly key: string;
  }): Promise<{ readonly response: JsonValue; readonly created: boolean }> {
    const response = { evaluationRun: input.run } as unknown as JsonValue;
    return this.#idempotentMutation(input.scope, input.key, input.run, response, () =>
      this.saveEvaluationRun(input.run),
    );
  }

  public appendReviewDecisionIdempotently(input: {
    readonly decision: ReviewDecision;
    readonly scope: string;
    readonly key: string;
  }): Promise<{ readonly response: JsonValue; readonly created: boolean }> {
    const response = { reviewDecision: input.decision } as unknown as JsonValue;
    return this.#idempotentMutation(input.scope, input.key, input.decision, response, () =>
      this.appendReviewDecision(input.decision),
    );
  }

  async #idempotentMutation(
    scope: string,
    key: string,
    request: EvaluationRun | ReviewDecision,
    response: JsonValue,
    mutate: () => Promise<unknown>,
  ): Promise<{ readonly response: JsonValue; readonly created: boolean }> {
    const mapKey = `${scope}:${key}`;
    const requestHash = sha256CanonicalJson({ scope, request });
    const existing = this.idempotency.get(mapKey);
    if (existing !== undefined) {
      if (existing.requestHash !== requestHash) {
        throw new StorageConflictError("Idempotency key already exists for a different request");
      }
      return { response: existing.response, created: false };
    }
    await mutate();
    this.idempotency.set(mapKey, { requestHash, response });
    return { response, created: true };
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
  bootstrapAdmin(input) {
    return Promise.resolve(account(input.role));
  },
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
      bootstrapTokenHash: sha256Bytes(Buffer.from("bootstrap-secret", "utf8")),
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

  it("permits one-time ADMIN bootstrap credentials and otherwise requires an ADMIN", async () => {
    const payload = {
      email: "new-account@example.test",
      displayName: "New account",
      password: "local-password-only",
      role: "ADMIN",
    } as const;

    expect((await server.inject({ method: "POST", url: "/v1/accounts", payload })).statusCode).toBe(
      401,
    );
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/v1/accounts",
          headers: { authorization: "Bootstrap wrong-secret" },
          payload,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/v1/accounts",
          headers: { authorization: "Bootstrap bootstrap-secret" },
          payload: { ...payload, role: "AUTHOR" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/v1/accounts",
          headers: { authorization: "Bootstrap bootstrap-secret" },
          payload,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/v1/accounts",
          headers: { authorization: "Bearer reviewer" },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/v1/accounts",
          headers: { authorization: "Bearer admin" },
          payload: { ...payload, email: "author-created-by-admin@example.test", role: "AUTHOR" },
        })
      ).statusCode,
    ).toBe(201);
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
    expect(replay.json()).toEqual(created.json());

    const collidingRun = makeEvaluationRun(uuid(31));
    const collision = await server.inject({
      method: "POST",
      url: "/v1/evaluation-runs",
      headers: { authorization: "Bearer author", "idempotency-key": "idem-api-1" },
      payload: collidingRun,
    });
    expect(collision.statusCode).toBe(409);
    expect(repository.runs.has(collidingRun.id)).toBe(false);

    const independentlyScoped = await server.inject({
      method: "POST",
      url: "/v1/evaluation-runs",
      headers: { authorization: "Bearer admin", "idempotency-key": "idem-api-1" },
      payload: collidingRun,
    });
    expect(independentlyScoped.statusCode).toBe(201);
  });

  it("blocks mutation and restricts review decisions to reviewer roles", async () => {
    const run = makeEvaluationRun();
    if (!repository.runs.has(run.id)) {
      repository.runs.set(run.id, run);
      repository.decisions.set(run.id, []);
    }
    const decision = makeReviewDecision(run);
    const wrongActor = makeReviewDecision(run, { actorId: uuid(72) });
    const wrongRole = makeReviewDecision(run, {
      actorId: account("REVIEWER").id,
      exercisedRole: "APPROVER",
    });

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
          payload: wrongActor,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await server.inject({
          method: "POST",
          url: `/v1/evaluation-runs/${run.id}/review-decisions`,
          headers: { authorization: "Bearer reviewer", "idempotency-key": "idem-review-1" },
          payload: wrongRole,
        })
      ).statusCode,
    ).toBe(403);
    const created = await server.inject({
      method: "POST",
      url: `/v1/evaluation-runs/${run.id}/review-decisions`,
      headers: { authorization: "Bearer reviewer", "idempotency-key": "idem-review-1" },
      payload: decision,
    });
    const replay = await server.inject({
      method: "POST",
      url: `/v1/evaluation-runs/${run.id}/review-decisions`,
      headers: { authorization: "Bearer reviewer", "idempotency-key": "idem-review-1" },
      payload: decision,
    });
    const collision = await server.inject({
      method: "POST",
      url: `/v1/evaluation-runs/${run.id}/review-decisions`,
      headers: { authorization: "Bearer reviewer", "idempotency-key": "idem-review-1" },
      payload: makeReviewDecision(run, {
        id: uuid(43),
        reason: "A different but valid review request must collide",
      }),
    });

    expect(created.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(created.json());
    expect(collision.statusCode).toBe(409);
    expect(repository.decisions.get(run.id)).toHaveLength(1);
  });
});
