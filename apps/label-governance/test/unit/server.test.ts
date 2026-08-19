import { describe, expect, it, vi } from "vitest";

import { createLabelGovernanceServer } from "../../src/server.js";
import type { SourceClassifier } from "../../src/source-classifier.js";

const sourceRequest = {
  sourceId: "00000000-0000-4000-8000-000000000201",
  sourceVersionId: "00000000-0000-4000-8000-000000000202",
  sourceContentHash: "b".repeat(64),
  canonicalUrl: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169",
  sourceTitle: "Synthetic regulation",
  sourceText: "REGULATION (EU) No 1169/2011.",
} as const;

const actorHeaders = {
  authorization: "Bearer synthetic-backend-oidc",
  "x-silto-actor-id": "00000000-0000-4000-8000-000000000203",
  "x-silto-actor-role": "ADMIN",
  "x-silto-workspace-id": "00000000-0000-4000-8000-000000000204",
} as const;

const ledgerRequest = {
  action: "CREATE_UNVERIFIED",
  candidateId: "00000000-0000-4000-8000-000000000205",
  source: {
    id: "00000000-0000-4000-8000-000000000206",
    stableReference: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169",
    title: "Synthetic regulation",
    jurisdiction: "European Union",
  },
  version: {
    id: "00000000-0000-4000-8000-000000000207",
    revision: 1,
    contentHash: "d".repeat(64),
    contentObjectRef: "label-governance/sources/synthetic/original.pdf",
  },
  actor: {
    id: "00000000-0000-4000-8000-000000000203",
    role: "ADMIN",
  },
  createdAt: "2026-07-19T00:00:00.000Z",
} as const;

function classifierResult(): Awaited<ReturnType<SourceClassifier["classify"]>> {
  return {
    model: "google/gemini-2.5-pro" as const,
    promptVersion: "label-source-classification-v1" as const,
    responseSchemaHash: "c".repeat(64),
    proposal: {
      authority: "European Union",
      legalNature: "REGULATION" as const,
      jurisdiction: "European Union",
      language: "it",
      actReference: null,
      revisionLabel: null,
      validFrom: null,
      validTo: null,
      bindingForce: "BINDING" as const,
      productCategories: [],
      labelingTopics: [],
      possibleSupersedes: [],
      possibleDuplicates: [],
      confidence: 0.9,
      evidence: [{ field: "authority", pageNumber: 1, quote: "European Union" }],
    },
  };
}

describe("Label governance HTTP boundary", () => {
  it("accepts the backend Cloud Tasks source-job contract without source text", async () => {
    const authorizer = { authorize: vi.fn().mockResolvedValue(undefined) };
    const processor = {
      process: vi.fn().mockResolvedValue({
        candidateId: "00000000-0000-4000-8000-000000000205",
        kind: "FETCH_AND_CLASSIFY",
        classificationStatus: "COMPLETED",
        ragStatus: "INDEXED",
      }),
    };
    const classifier = { classify: vi.fn() };
    const server = await createLabelGovernanceServer({
      authorizer,
      classifier,
      sourceJobProcessor: processor,
    });

    const job = {
      candidateId: "00000000-0000-4000-8000-000000000205",
      classificationRunId: "00000000-0000-4000-8000-000000000206",
      kind: "FETCH_AND_CLASSIFY",
    } as const;
    const response = await server.inject({
      method: "POST",
      url: "/internal/source-jobs",
      headers: { authorization: "Bearer synthetic-backend-oidc" },
      payload: job,
    });

    expect(response.statusCode).toBe(200);
    expect(processor.process).toHaveBeenCalledWith(job);
    expect(classifier.classify).not.toHaveBeenCalled();
    await server.close();
  });

  it("returns a retryable status when a source worker preserves a retryable failure", async () => {
    const authorizer = { authorize: vi.fn().mockResolvedValue(undefined) };
    const classifier = { classify: vi.fn() };
    const processor = {
      process: vi
        .fn()
        .mockRejectedValue(
          new (await import("../../src/source-jobs.js")).SourceGovernanceJobError(
            "GCS unavailable",
            true,
          ),
        ),
    };
    const server = await createLabelGovernanceServer({
      authorizer,
      classifier,
      sourceJobProcessor: processor,
    });

    const response = await server.inject({
      method: "POST",
      url: "/internal/source-jobs",
      headers: { authorization: "Bearer synthetic-backend-oidc" },
      payload: {
        candidateId: "00000000-0000-4000-8000-000000000205",
        kind: "CLASSIFY",
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("60");
    expect(response.json()).toEqual({ status: "error", code: "SOURCE_JOB_RETRYABLE" });
    await server.close();
  });

  it("refuses source text before a verified backend OIDC identity", async () => {
    const authorizer = { authorize: vi.fn().mockRejectedValue(new Error("invalid token")) };
    const classifier = { classify: vi.fn() };
    const server = await createLabelGovernanceServer({ authorizer, classifier });

    const response = await server.inject({
      method: "POST",
      url: "/internal/source-classifications",
      payload: sourceRequest,
    });

    expect(response.statusCode).toBe(401);
    expect(classifier.classify).not.toHaveBeenCalled();
    await server.close();
  });

  it("passes only an allowlisted official source to the classifier and records actor audit context", async () => {
    const authorizer = { authorize: vi.fn().mockResolvedValue(undefined) };
    const classifier = { classify: vi.fn().mockResolvedValue(classifierResult()) };
    const server = await createLabelGovernanceServer({ authorizer, classifier });

    const response = await server.inject({
      method: "POST",
      url: "/internal/source-classifications",
      headers: actorHeaders,
      payload: sourceRequest,
    });

    expect(response.statusCode).toBe(200);
    expect(classifier.classify).toHaveBeenCalledWith(sourceRequest);
    expect(response.json()).toMatchObject({
      status: "success",
      audit: {
        actorId: actorHeaders["x-silto-actor-id"],
        workspaceId: actorHeaders["x-silto-workspace-id"],
        actorRole: "ADMIN",
      },
    });
    await server.close();
  });

  it("rejects a non-official URL without sending the source text to OpenRouter", async () => {
    const authorizer = { authorize: vi.fn().mockResolvedValue(undefined) };
    const classifier = { classify: vi.fn() };
    const server = await createLabelGovernanceServer({ authorizer, classifier });

    const response = await server.inject({
      method: "POST",
      url: "/internal/source-classifications",
      headers: actorHeaders,
      payload: { ...sourceRequest, canonicalUrl: "https://example.test/not-official.pdf" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ status: "error", code: "OFFICIAL_SOURCE_URL_REQUIRED" });
    expect(classifier.classify).not.toHaveBeenCalled();
    await server.close();
  });

  it("requires an ADMIN actor context even after backend authentication", async () => {
    const authorizer = { authorize: vi.fn().mockResolvedValue(undefined) };
    const classifier = { classify: vi.fn() };
    const server = await createLabelGovernanceServer({ authorizer, classifier });

    const response = await server.inject({
      method: "POST",
      url: "/internal/source-classifications",
      headers: { ...actorHeaders, "x-silto-actor-role": "CONSULTANT" },
      payload: sourceRequest,
    });

    expect(response.statusCode).toBe(403);
    expect(classifier.classify).not.toHaveBeenCalled();
    await server.close();
  });

  it("uses the OIDC-authenticated backend's forwarded body actor for immutable ledger audit", async () => {
    const authorizer = { authorize: vi.fn().mockResolvedValue(undefined) };
    const repository = {
      createSourceVersion: vi.fn().mockResolvedValue({
        sourceVersionId: ledgerRequest.version.id,
        state: "UNVERIFIED" as const,
        transitionHash: "e".repeat(64),
      }),
      appendSourceTransition: vi.fn(),
      getSourceVersion: vi.fn(),
    };
    const server = await createLabelGovernanceServer({
      authorizer,
      classifier: { classify: vi.fn() },
      sourceLedgerRepository: repository,
    });

    const response = await server.inject({
      method: "POST",
      url: "/internal/source-versions",
      headers: { authorization: "Bearer synthetic-backend-oidc" },
      payload: ledgerRequest,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "success",
      data: { sourceVersionId: ledgerRequest.version.id, state: "UNVERIFIED", sequence: 1 },
    });
    expect(repository.createSourceVersion).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ledgerRequest.actor.id, actorRole: "ADMIN" }),
    );
    await server.close();
  });

  it("accepts a task identity only on source jobs, never on formal ledger routes", async () => {
    const backendAuthorizer = { authorize: vi.fn().mockRejectedValue(new Error("task identity")) };
    const sourceJobAuthorizer = { authorize: vi.fn().mockResolvedValue(undefined) };
    const processor = {
      process: vi.fn().mockResolvedValue({
        candidateId: "00000000-0000-4000-8000-000000000205",
        kind: "CLASSIFY",
      }),
    };
    const repository = {
      createSourceVersion: vi.fn(),
      appendSourceTransition: vi.fn(),
      getSourceVersion: vi.fn(),
    };
    const server = await createLabelGovernanceServer({
      authorizer: backendAuthorizer,
      sourceJobAuthorizer,
      classifier: { classify: vi.fn() },
      sourceJobProcessor: processor,
      sourceLedgerRepository: repository,
    });

    const jobResponse = await server.inject({
      method: "POST",
      url: "/internal/source-jobs",
      headers: { authorization: "Bearer synthetic-task-oidc" },
      payload: {
        candidateId: "00000000-0000-4000-8000-000000000205",
        kind: "CLASSIFY",
      },
    });
    const ledgerResponse = await server.inject({
      method: "POST",
      url: "/internal/source-versions",
      headers: { authorization: "Bearer synthetic-task-oidc" },
      payload: ledgerRequest,
    });

    expect(jobResponse.statusCode).toBe(200);
    expect(ledgerResponse.statusCode).toBe(401);
    expect(sourceJobAuthorizer.authorize).toHaveBeenCalledOnce();
    expect(backendAuthorizer.authorize).toHaveBeenCalledOnce();
    expect(repository.createSourceVersion).not.toHaveBeenCalled();
    await server.close();
  });
});
