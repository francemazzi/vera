import type { ActorRole, JsonValue } from "@vera/contracts";
import type {
  EmbeddingProvider,
  PgVectorRagIndex,
  RagSafeRetrievalResult,
  RuleDraftProvider,
} from "@vera/rag";
import { StorageConflictError } from "@vera/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiProblem, createApiServer } from "../../src/index.js";
import type { AuthService, AuthenticatedAccount } from "../../src/index.js";
import { uuid } from "../fixtures/evaluation.js";

class FakeRepository {
  readonly idempotency = new Map<
    string,
    { readonly requestHash: string; readonly response: JsonValue }
  >();

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
}

class FakeRagIndex {
  readonly deletedVersionIds: string[] = [];
  #retrieval: RagSafeRetrievalResult = { status: "AVAILABLE", chunks: [] };

  public setRetrieval(result: RagSafeRetrievalResult): void {
    this.#retrieval = result;
  }

  public ensureSchema(): Promise<void> {
    return Promise.resolve();
  }

  public indexApprovedSections(
    sections: readonly { readonly sourceVersionId: string }[],
  ): Promise<{ readonly chunksIndexed: number; readonly sourceVersionIds: readonly string[] }> {
    return Promise.resolve({
      chunksIndexed: sections.length,
      sourceVersionIds: [...new Set(sections.map((section) => section.sourceVersionId))].sort(),
    });
  }

  public deleteBySourceVersionId(sourceVersionId: string): Promise<number> {
    this.deletedVersionIds.push(sourceVersionId);
    return Promise.resolve(1);
  }

  public retrieveSafely(): Promise<RagSafeRetrievalResult> {
    return Promise.resolve(this.#retrieval);
  }
}

function account(role: ActorRole): AuthenticatedAccount {
  return {
    id: uuid(role === "AUTHOR" ? 70 : role === "APPROVER" ? 73 : 72),
    email: `${role.toLocaleLowerCase("und")}@example.test`,
    displayName: `Synthetic ${role}`,
    role,
  };
}

function authFor(role: ActorRole): AuthService {
  const authenticated = account(role);
  return {
    authenticate: () => Promise.resolve(authenticated),
    bootstrapAdmin: () => Promise.resolve(authenticated),
    createAccount: () => Promise.resolve(authenticated),
    login: () =>
      Promise.resolve({
        token: "synthetic-token",
        expiresAt: "2026-07-22T20:00:00.000Z",
        account: authenticated,
      }),
  };
}

const unusedEmbeddingProvider = {
  model: { name: "synthetic", digest: "a".repeat(64), runtimeVersion: "test" },
  embedTexts: () => Promise.resolve([]),
} as unknown as EmbeddingProvider;

const unusedDraftProvider = {
  model: { name: "synthetic", digest: "a".repeat(64), runtimeVersion: "test" },
  generateJson: () => Promise.reject(new Error("unused")),
} as unknown as RuleDraftProvider;

describe("RAG API routes", () => {
  const repository = new FakeRepository();
  const ragIndex = new FakeRagIndex();
  let server: Awaited<ReturnType<typeof createApiServer>>;

  beforeAll(async () => {
    server = await createApiServer({
      repository: repository as never,
      ragIndex: ragIndex as unknown as PgVectorRagIndex,
      ragEmbeddingProvider: unusedEmbeddingProvider,
      ragDraftProvider: unusedDraftProvider,
      auth: authFor("AUTHOR"),
      now: () => "2026-07-22T12:00:00.000Z",
    });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns 503 when RAG retrieve is called without a configured index", async () => {
    const unconfigured = await createApiServer({
      repository: repository as never,
      auth: authFor("AUTHOR"),
    });
    await unconfigured.ready();
    const response = await unconfigured.inject({
      method: "POST",
      url: "/v1/rag/retrieve",
      headers: { authorization: "Bearer synthetic" },
      payload: {
        queryText: "retention label",
        domain: "synthetic-domain",
        jurisdiction: "DEMO",
        evaluationDate: "2026-07-22T00:00:00.000Z",
        topK: 3,
      },
    });
    expect(response.statusCode).toBe(503);
    await unconfigured.close();
  });

  it("returns safe retrieval results for authenticated callers", async () => {
    ragIndex.setRetrieval({
      status: "UNAVAILABLE",
      requiresReview: true,
      reason: "PROVIDER_UNAVAILABLE: offline",
    });
    const response = await server.inject({
      method: "POST",
      url: "/v1/rag/retrieve",
      headers: { authorization: "Bearer synthetic" },
      payload: {
        queryText: "retention label",
        domain: "synthetic-domain",
        jurisdiction: "DEMO",
        evaluationDate: "2026-07-22T00:00:00.000Z",
        topK: 3,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      retrieval: {
        status: "UNAVAILABLE",
        requiresReview: true,
        reason: "PROVIDER_UNAVAILABLE: offline",
      },
    });
  });

  it("rejects unauthenticated RAG retrieve calls", async () => {
    const unauthenticated = await createApiServer({
      repository: repository as never,
      ragIndex: ragIndex as unknown as PgVectorRagIndex,
      auth: {
        authenticate: () => Promise.reject(new ApiProblem(401, "Unauthorized", "missing")),
        bootstrapAdmin: () => Promise.resolve(account("ADMIN")),
        createAccount: () => Promise.resolve(account("ADMIN")),
        login: () =>
          Promise.resolve({
            token: "x",
            expiresAt: "2026-07-22T20:00:00.000Z",
            account: account("ADMIN"),
          }),
      },
    });
    await unauthenticated.ready();
    const response = await unauthenticated.inject({
      method: "POST",
      url: "/v1/rag/retrieve",
      payload: {
        queryText: "retention label",
        domain: "synthetic-domain",
        jurisdiction: "DEMO",
        evaluationDate: "2026-07-22T00:00:00.000Z",
      },
    });
    expect(response.statusCode).toBe(401);
    await unauthenticated.close();
  });
});
