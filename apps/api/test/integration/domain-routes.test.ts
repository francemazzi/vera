import { sha256CanonicalJson } from "@vera/contracts";
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

  public getEvaluationRun(id: string): Promise<EvaluationRun> {
    const run = this.runs.get(id);
    if (run === undefined) throw new StorageConflictError("missing run");
    return Promise.resolve(run);
  }

  public listReviewDecisions(runId: string): Promise<readonly ReviewDecision[]> {
    return Promise.resolve([...(this.decisions.get(runId) ?? [])]);
  }

  public getOrCreateIdempotency(input: {
    readonly scope: string;
    readonly key: string;
    readonly requestHash: string;
    readonly response: JsonValue;
  }): Promise<{ readonly response: JsonValue; readonly created: boolean }> {
    const mapKey = `${input.scope}:${input.key}`;
    const existing = this.idempotency.get(mapKey);
    if (existing !== undefined) {
      if (existing.requestHash !== input.requestHash) {
        throw new StorageConflictError("Idempotency key already exists for a different request");
      }
      return Promise.resolve({ response: existing.response, created: false });
    }
    this.idempotency.set(mapKey, { requestHash: input.requestHash, response: input.response });
    return Promise.resolve({ response: input.response, created: true });
  }

  public saveEvaluationRunIdempotently(input: {
    readonly run: EvaluationRun;
    readonly scope: string;
    readonly key: string;
  }): Promise<{ readonly response: JsonValue; readonly created: boolean }> {
    this.runs.set(input.run.id, input.run);
    this.decisions.set(input.run.id, []);
    return Promise.resolve({
      response: { evaluationRun: input.run } as unknown as JsonValue,
      created: true,
    });
  }

  public appendReviewDecisionIdempotently(input: {
    readonly decision: ReviewDecision;
  }): Promise<{ readonly response: JsonValue; readonly created: boolean }> {
    const stream = this.decisions.get(input.decision.runId);
    if (stream === undefined) throw new StorageConflictError("missing run");
    stream.push(input.decision);
    return Promise.resolve({
      response: { reviewDecision: input.decision } as unknown as JsonValue,
      created: true,
    });
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

describe("Phase 14 domain API routes", () => {
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

  it("lists review decisions for an evaluation run", async () => {
    const run = makeEvaluationRun(uuid(50));
    const decision = makeReviewDecision(run, { id: uuid(51) });
    repository.runs.set(run.id, run);
    repository.decisions.set(run.id, [decision]);

    const response = await server.inject({
      method: "GET",
      url: `/v1/evaluation-runs/${run.id}/review-decisions`,
      headers: { authorization: "Bearer reviewer" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ reviewDecisions: [decision] });
  });

  it("returns 503 when a domain repository is not configured", async () => {
    const response = await server.inject({
      method: "GET",
      url: `/v1/compliance-sources/${uuid(60)}`,
      headers: { authorization: "Bearer author" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(sha256CanonicalJson(response.json())).toMatch(/^[0-9a-f]{64}$/u);
  });
});
