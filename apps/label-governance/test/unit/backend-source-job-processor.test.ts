import { describe, expect, it, vi } from "vitest";
import { RagError } from "@vera/rag";

import { createBackendSourceGovernanceJobProcessor } from "../../src/backend-source-job-processor.js";
import type { SourceClassificationProposal } from "../../src/contracts.js";
import type { SourceDocumentMaterializer } from "../../src/source-document-materializer.js";
import { SourceGovernanceJobError } from "../../src/source-jobs.js";
import type { SourceBackendClient, SourceWorkerInput } from "../../src/source-backend-client.js";

const candidateId = "00000000-0000-4000-8000-000000000401";
const classificationRunId = "00000000-0000-4000-8000-000000000402";

function containing<T extends Record<string, unknown>>(expected: T): T {
  const matcher: unknown = expect.objectContaining(expected as never);
  return matcher as T;
}

function proposal(): SourceClassificationProposal {
  return {
    authority: "European Union",
    legalNature: "REGULATION",
    jurisdiction: "European Union",
    language: "it",
    actReference: "Regulation (EU) 1169/2011",
    revisionLabel: null,
    validFrom: null,
    validTo: null,
    bindingForce: "BINDING",
    productCategories: ["Food"],
    labelingTopics: ["Food information"],
    possibleSupersedes: [],
    possibleDuplicates: [],
    confidence: 0.9,
    evidence: [{ field: "actReference", pageNumber: 1, quote: "Regulation (EU) 1169/2011" }],
  };
}

function candidate(overrides: Partial<SourceWorkerInput> = {}): SourceWorkerInput {
  return {
    candidateId,
    batchId: "00000000-0000-4000-8000-000000000403",
    classificationRunId,
    kind: "CLASSIFY",
    sourceKind: "PDF_UPLOAD",
    sourceFormat: "PDF",
    stageStatus: "CLASSIFICATION_QUEUED",
    governanceStatus: null,
    classificationStatus: "QUEUED",
    verifiedRagStatus: "NOT_REQUESTED",
    ragStatus: "NOT_REQUESTED",
    sourceVersion: 1,
    ragWorkspaceScope: "00000000-0000-4000-8000-000000000403",
    sourceTitle: "Uploaded official candidate",
    pdfUrl: null,
    canonicalUrl: null,
    storageObjectKey:
      "label-governance/sources/00000000-0000-4000-8000-000000000403/00000000-0000-4000-8000-000000000401/original.pdf",
    extractedTextObjectKey: null,
    sourceSha256: "a".repeat(64),
    contentByteSize: 1_000,
    jurisdiction: "European Union",
    language: "it",
    documentType: "REGULATION",
    actReference: null,
    revisionLabel: null,
    validFrom: null,
    validTo: null,
    productCategories: [],
    notes: null,
    classificationJson: null,
    ...overrides,
  };
}

function materializer(): SourceDocumentMaterializer {
  return {
    materialize: vi.fn().mockResolvedValue({
      artifacts: {
        sourceSha256: "a".repeat(64),
        storageObjectKey:
          "label-governance/sources/00000000-0000-4000-8000-000000000403/00000000-0000-4000-8000-000000000401/original.pdf",
        extractedTextObjectKey:
          "label-governance/sources/00000000-0000-4000-8000-000000000403/00000000-0000-4000-8000-000000000401/extracted.json",
        contentByteSize: 1_000,
      },
      classificationText: "Regulation (EU) 1169/2011",
      sections: [
        { id: "page-1-part-1", title: "Page 1", pageNumber: 1, text: "Regulation (EU) 1169/2011" },
      ],
    }),
  };
}

function backend(input: SourceWorkerInput): SourceBackendClient {
  return {
    getInput: vi.fn().mockResolvedValue(input),
    claim: vi.fn().mockResolvedValue({ acquired: true, replayed: false }),
    reserveArtifacts: vi.fn().mockResolvedValue({ replayed: false, duplicate: false }),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  };
}

describe("backend source governance job processor", () => {
  it("classifies a directly uploaded PDF without a canonical URL but never indexes it before expert verification", async () => {
    const input = candidate();
    const client = backend(input);
    const ragIndex = {
      removePreliminarySourceVersion: vi.fn().mockResolvedValue(undefined),
      removeApprovedSourceVersion: vi.fn().mockResolvedValue(undefined),
      indexPreliminarySections: vi
        .fn()
        .mockResolvedValue({ chunksIndexed: 1, sourceVersionIds: [candidateId] }),
      indexApprovedSections: vi.fn(),
      retrievePreliminary: vi.fn(),
      retrieveApproved: vi.fn(),
      retrievePreliminarySafely: vi.fn(),
      retrieveApprovedSafely: vi.fn(),
    };
    const classifier = {
      classify: vi.fn().mockResolvedValue({
        proposal: proposal(),
        model: "google/gemini-2.5-pro",
        promptVersion: "label-source-classification-v1",
        responseSchemaHash: "b".repeat(64),
      }),
    };
    const processor = createBackendSourceGovernanceJobProcessor({
      backend: client,
      documentMaterializer: materializer(),
      classifier,
      ragIndex,
      officialSourceHosts: ["eur-lex.europa.eu"],
      createInvocationId: () => "00000000-0000-4000-8000-000000000404",
    });

    const result = await processor.process({ candidateId, classificationRunId, kind: "CLASSIFY" });

    expect(result).toMatchObject({ classificationStatus: "COMPLETED" });
    expect(classifier.classify).toHaveBeenCalledWith(
      containing({ canonicalUrl: null, sourceText: "Regulation (EU) 1169/2011" }),
    );
    expect(ragIndex.indexPreliminarySections).not.toHaveBeenCalled();
    expect(ragIndex.indexApprovedSections).not.toHaveBeenCalled();
    expect(client.complete).toHaveBeenCalledWith(
      containing({
        callback: containing({
          classification: containing({
            model: "google/gemini-2.5-pro",
            authority: "European Union",
          }),
        }),
      }),
    );
  });

  it("allows FETCH_AND_CLASSIFY for a direct PDF without a canonical or PDF URL, without writing Chroma", async () => {
    const input = candidate({ kind: "FETCH_AND_CLASSIFY" });
    const client = backend(input);
    const document = materializer();
    const ragIndex = {
      removePreliminarySourceVersion: vi.fn().mockResolvedValue(undefined),
      removeApprovedSourceVersion: vi.fn().mockResolvedValue(undefined),
      indexPreliminarySections: vi
        .fn()
        .mockResolvedValue({ chunksIndexed: 1, sourceVersionIds: [candidateId] }),
      indexApprovedSections: vi.fn(),
      retrievePreliminary: vi.fn(),
      retrieveApproved: vi.fn(),
      retrievePreliminarySafely: vi.fn(),
      retrieveApprovedSafely: vi.fn(),
    };
    const classifier = {
      classify: vi.fn().mockResolvedValue({
        proposal: proposal(),
        model: "google/gemini-2.5-pro",
        promptVersion: "label-source-classification-v1",
        responseSchemaHash: "b".repeat(64),
      }),
    };
    const processor = createBackendSourceGovernanceJobProcessor({
      backend: client,
      documentMaterializer: document,
      classifier,
      ragIndex,
      officialSourceHosts: ["eur-lex.europa.eu"],
      createInvocationId: () => "00000000-0000-4000-8000-000000000404",
    });

    await expect(
      processor.process({ candidateId, classificationRunId, kind: "FETCH_AND_CLASSIFY" }),
    ).resolves.toMatchObject({ classificationStatus: "COMPLETED" });
    expect(document.materialize).toHaveBeenCalledWith(input);
    expect(classifier.classify).toHaveBeenCalledWith(containing({ canonicalUrl: null }));
    expect(ragIndex.indexPreliminarySections).not.toHaveBeenCalled();
    expect(ragIndex.indexApprovedSections).not.toHaveBeenCalled();
  });

  it("uses a strict backend-verified discovery snapshot without rechecking its country portal against the static host list", async () => {
    const sourceSha256 = "a".repeat(64);
    const input = candidate({
      sourceKind: "TABULAR",
      sourceFormat: "PDF",
      stageStatus: "DISCOVERED",
      canonicalUrl: "https://legislatie.just.ro/Public/DetaliiDocument/261454",
      storageObjectKey:
        "label-governance/source-discovery/00000000-0000-4000-8000-000000000405/" +
        `00000000-0000-4000-8000-000000000406/original/${sourceSha256}.pdf`,
      sourceSha256,
    });
    const client = backend(input);
    const document = materializer();
    const classifier = {
      classify: vi.fn().mockResolvedValue({
        proposal: proposal(),
        model: "google/gemini-2.5-pro",
        promptVersion: "label-source-classification-v1",
        responseSchemaHash: "b".repeat(64),
      }),
    };
    const processor = createBackendSourceGovernanceJobProcessor({
      backend: client,
      documentMaterializer: document,
      classifier,
      ragIndex: {
        removePreliminarySourceVersion: vi.fn(),
        removeApprovedSourceVersion: vi.fn(),
        indexPreliminarySections: vi.fn(),
        indexApprovedSections: vi.fn(),
        retrievePreliminary: vi.fn(),
        retrieveApproved: vi.fn(),
        retrievePreliminarySafely: vi.fn(),
        retrieveApprovedSafely: vi.fn(),
      },
      // Romanian official portals are not in this intentionally narrow
      // deployment allowlist. The immutable discovery key is the boundary.
      officialSourceHosts: ["eur-lex.europa.eu"],
      createInvocationId: () => "00000000-0000-4000-8000-000000000404",
    });

    const result = await processor.process({ candidateId, classificationRunId, kind: "CLASSIFY" });
    expect(client.fail).not.toHaveBeenCalled();
    expect(result).toMatchObject({ classificationStatus: "COMPLETED" });
    expect(document.materialize).toHaveBeenCalledWith(input);
    expect(classifier.classify).toHaveBeenCalled();
  });

  it("stops before OpenRouter and Chroma when the backend reserves a duplicate hash", async () => {
    const input = candidate({ kind: "FETCH_AND_CLASSIFY" });
    const reserveArtifacts = vi.fn().mockResolvedValue({ replayed: false, duplicate: true });
    const client = { ...backend(input), reserveArtifacts };
    const document = materializer();
    const classifier = { classify: vi.fn() };
    const ragIndex = {
      removePreliminarySourceVersion: vi.fn(),
      removeApprovedSourceVersion: vi.fn(),
      indexPreliminarySections: vi.fn(),
      indexApprovedSections: vi.fn(),
      retrievePreliminary: vi.fn(),
      retrieveApproved: vi.fn(),
      retrievePreliminarySafely: vi.fn(),
      retrieveApprovedSafely: vi.fn(),
    };
    const processor = createBackendSourceGovernanceJobProcessor({
      backend: client,
      documentMaterializer: document,
      classifier,
      ragIndex,
      officialSourceHosts: ["eur-lex.europa.eu"],
      createInvocationId: () => "00000000-0000-4000-8000-000000000404",
    });

    await expect(
      processor.process({ candidateId, classificationRunId, kind: "FETCH_AND_CLASSIFY" }),
    ).resolves.toMatchObject({ duplicate: true });
    expect(document.materialize).toHaveBeenCalledWith(input);
    expect(client.reserveArtifacts).toHaveBeenCalledWith(
      containing({ callback: containing({ status: "PROCESSING" }) }),
    );
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(ragIndex.indexPreliminarySections).not.toHaveBeenCalled();
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).not.toHaveBeenCalled();
  });

  it("indexes an expert-verified source only in the verified collection without a second AI call", async () => {
    const input = candidate({
      kind: "INDEX_VERIFIED",
      classificationRunId: null,
      sourceKind: "TABULAR",
      governanceStatus: "VERIFIED",
      stageStatus: "SUBMITTED",
      classificationStatus: "COMPLETED",
      ragStatus: "QUEUED",
      canonicalUrl: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169",
      validFrom: "2025-04-01T00:00:00.000Z",
      classificationJson: { ...proposal(), model: "google/gemini-2.5-pro" },
    });
    const client = backend(input);
    const ragIndex = {
      removePreliminarySourceVersion: vi.fn().mockResolvedValue(undefined),
      removeApprovedSourceVersion: vi.fn().mockResolvedValue(undefined),
      indexPreliminarySections: vi
        .fn()
        .mockResolvedValue({ chunksIndexed: 1, sourceVersionIds: [candidateId] }),
      indexApprovedSections: vi.fn(),
      retrievePreliminary: vi.fn(),
      retrieveApproved: vi.fn(),
      retrievePreliminarySafely: vi.fn(),
      retrieveApprovedSafely: vi.fn(),
    };
    const classifier = { classify: vi.fn() };
    const processor = createBackendSourceGovernanceJobProcessor({
      backend: client,
      documentMaterializer: materializer(),
      classifier,
      ragIndex,
      officialSourceHosts: ["eur-lex.europa.eu"],
      createInvocationId: () => "00000000-0000-4000-8000-000000000404",
    });

    const result = await processor.process({ candidateId, kind: "INDEX_VERIFIED" });

    expect(result).toMatchObject({ ragStatus: "INDEXED" });
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(ragIndex.indexPreliminarySections).toHaveBeenCalledWith([
      containing({ sourceState: "VERIFIED", validityStatus: "ADMIN_CONFIRMED" }),
    ]);
    expect(ragIndex.indexApprovedSections).not.toHaveBeenCalled();
    expect(client.complete).toHaveBeenCalledWith(
      containing({
        callback: containing({
          rag: containing({ collection: "silto-label-verified-v1" }),
        }),
      }),
    );
  });

  it("rejects an unverified source before materialization or Chroma indexing", async () => {
    const input = candidate({
      kind: "INDEX_VERIFIED",
      classificationRunId: null,
      sourceKind: "TABULAR",
      governanceStatus: "UNVERIFIED",
      stageStatus: "SUBMITTED",
      classificationStatus: "COMPLETED",
      ragStatus: "QUEUED",
      canonicalUrl: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169",
      classificationJson: { ...proposal(), model: "google/gemini-2.5-pro" },
    });
    const client = backend(input);
    const document = materializer();
    const ragIndex = {
      removePreliminarySourceVersion: vi.fn(),
      removeApprovedSourceVersion: vi.fn(),
      indexPreliminarySections: vi.fn(),
      indexApprovedSections: vi.fn(),
      retrievePreliminary: vi.fn(),
      retrieveApproved: vi.fn(),
      retrievePreliminarySafely: vi.fn(),
      retrieveApprovedSafely: vi.fn(),
    };
    const processor = createBackendSourceGovernanceJobProcessor({
      backend: client,
      documentMaterializer: document,
      classifier: { classify: vi.fn() },
      ragIndex,
      officialSourceHosts: ["eur-lex.europa.eu"],
      createInvocationId: () => "00000000-0000-4000-8000-000000000404",
    });

    await expect(processor.process({ candidateId, kind: "INDEX_VERIFIED" })).resolves.toMatchObject(
      { ragStatus: "FAILED" },
    );
    expect(document.materialize).not.toHaveBeenCalled();
    expect(ragIndex.indexPreliminarySections).not.toHaveBeenCalled();
    expect(ragIndex.indexApprovedSections).not.toHaveBeenCalled();
    expect(client.fail).toHaveBeenCalledWith(
      containing({
        callback: containing({
          failure: { code: "SOURCE_NOT_VERIFIED", retryable: false },
        }),
      }),
    );
  });

  it("fails closed when a verified source has no workspace or curated GLOBAL scope", async () => {
    const input = candidate({
      kind: "INDEX_VERIFIED",
      classificationRunId: null,
      sourceKind: "TABULAR",
      governanceStatus: "VERIFIED",
      stageStatus: "SUBMITTED",
      classificationStatus: "COMPLETED",
      ragStatus: "QUEUED",
      canonicalUrl: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169",
      validFrom: "2025-04-01T00:00:00.000Z",
      ragWorkspaceScope: null,
      classificationJson: { ...proposal(), model: "google/gemini-2.5-pro" },
    });
    const client = backend(input);
    const document = materializer();
    const ragIndex = {
      removePreliminarySourceVersion: vi.fn(),
      removeApprovedSourceVersion: vi.fn(),
      indexPreliminarySections: vi.fn(),
      indexApprovedSections: vi.fn(),
      retrievePreliminary: vi.fn(),
      retrieveApproved: vi.fn(),
      retrievePreliminarySafely: vi.fn(),
      retrieveApprovedSafely: vi.fn(),
    };
    const processor = createBackendSourceGovernanceJobProcessor({
      backend: client,
      documentMaterializer: document,
      classifier: { classify: vi.fn() },
      ragIndex,
      officialSourceHosts: ["eur-lex.europa.eu"],
      createInvocationId: () => "00000000-0000-4000-8000-000000000404",
    });

    await expect(processor.process({ candidateId, kind: "INDEX_VERIFIED" })).resolves.toMatchObject(
      { ragStatus: "FAILED" },
    );
    expect(document.materialize).not.toHaveBeenCalled();
    expect(ragIndex.indexPreliminarySections).not.toHaveBeenCalled();
    expect(client.fail).toHaveBeenCalledWith(
      containing({
        callback: containing({
          failure: { code: "SOURCE_WORKSPACE_SCOPE_UNAVAILABLE", retryable: false },
        }),
      }),
    );
  });

  it("indexes an approved source from its persisted classification without a second AI call", async () => {
    const input = candidate({
      kind: "INDEX_APPROVED",
      classificationRunId: null,
      governanceStatus: "APPROVED",
      stageStatus: "SUBMITTED",
      classificationStatus: "COMPLETED",
      ragStatus: "QUEUED",
      canonicalUrl: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169",
      validFrom: "2025-04-01T00:00:00.000Z",
      classificationJson: { ...proposal(), model: "google/gemini-2.5-pro" },
    });
    const client = backend(input);
    const ragIndex = {
      removePreliminarySourceVersion: vi.fn().mockResolvedValue(undefined),
      removeApprovedSourceVersion: vi.fn().mockResolvedValue(undefined),
      indexPreliminarySections: vi.fn(),
      indexApprovedSections: vi
        .fn()
        .mockResolvedValue({ chunksIndexed: 1, sourceVersionIds: [candidateId] }),
      retrievePreliminary: vi.fn(),
      retrieveApproved: vi.fn(),
      retrievePreliminarySafely: vi.fn(),
      retrieveApprovedSafely: vi.fn(),
    };
    const classifier = { classify: vi.fn() };
    const processor = createBackendSourceGovernanceJobProcessor({
      backend: client,
      documentMaterializer: materializer(),
      classifier,
      ragIndex,
      officialSourceHosts: ["eur-lex.europa.eu"],
      createInvocationId: () => "00000000-0000-4000-8000-000000000404",
    });

    const result = await processor.process({ candidateId, kind: "INDEX_APPROVED" });

    expect(result).toMatchObject({ ragStatus: "INDEXED" });
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(ragIndex.indexApprovedSections).toHaveBeenCalledWith([
      containing({ sourceState: "APPROVED", validityStatus: "ADMIN_CONFIRMED" }),
    ]);
    expect(client.complete).toHaveBeenCalledWith(
      containing({
        callback: containing({
          rag: containing({ collection: "silto-label-approved-v1" }),
        }),
      }),
    );
    expect(ragIndex.removePreliminarySourceVersion).not.toHaveBeenCalled();
    expect(ragIndex.removeApprovedSourceVersion).not.toHaveBeenCalled();
  });

  it("keeps the verified collection intact when approved indexing fails", async () => {
    const input = candidate({
      kind: "INDEX_APPROVED",
      classificationRunId: null,
      governanceStatus: "APPROVED",
      stageStatus: "SUBMITTED",
      classificationStatus: "COMPLETED",
      verifiedRagStatus: "INDEXED",
      ragStatus: "QUEUED",
      canonicalUrl: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169",
      validFrom: "2025-04-01T00:00:00.000Z",
      classificationJson: { ...proposal(), model: "google/gemini-2.5-pro" },
    });
    const client = backend(input);
    const ragIndex = {
      removePreliminarySourceVersion: vi.fn(),
      removeApprovedSourceVersion: vi.fn(),
      indexPreliminarySections: vi
        .fn()
        .mockResolvedValue({ chunksIndexed: 1, sourceVersionIds: [candidateId] }),
      indexApprovedSections: vi.fn().mockRejectedValue(
        new RagError("VECTOR_STORE_UNAVAILABLE", "approved collection unavailable", {
          retryable: false,
        }),
      ),
      retrievePreliminary: vi.fn(),
      retrieveApproved: vi.fn(),
      retrievePreliminarySafely: vi.fn(),
      retrieveApprovedSafely: vi.fn(),
    };
    const processor = createBackendSourceGovernanceJobProcessor({
      backend: client,
      documentMaterializer: materializer(),
      classifier: { classify: vi.fn() },
      ragIndex,
      officialSourceHosts: ["eur-lex.europa.eu"],
      createInvocationId: () => "00000000-0000-4000-8000-000000000404",
    });

    await expect(processor.process({ candidateId, kind: "INDEX_APPROVED" })).resolves.toMatchObject(
      { ragStatus: "FAILED" },
    );
    expect(ragIndex.indexPreliminarySections).toHaveBeenCalledTimes(1);
    expect(ragIndex.indexApprovedSections).toHaveBeenCalledTimes(1);
    expect(ragIndex.removePreliminarySourceVersion).not.toHaveBeenCalled();
    expect(ragIndex.removeApprovedSourceVersion).not.toHaveBeenCalled();
    expect(client.fail).toHaveBeenCalledWith(
      containing({
        callback: containing({
          failure: { code: "RAG_VECTOR_STORE_UNAVAILABLE", retryable: false },
        }),
      }),
    );
  });

  it("never sends an approved source with an unconfirmed validity range to Chroma", async () => {
    const input = candidate({
      kind: "INDEX_APPROVED",
      classificationRunId: null,
      governanceStatus: "APPROVED",
      stageStatus: "SUBMITTED",
      classificationStatus: "COMPLETED",
      ragStatus: "QUEUED",
      canonicalUrl: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169",
      classificationJson: { ...proposal(), model: "google/gemini-2.5-pro" },
      validFrom: null,
    });
    const client = backend(input);
    const document = materializer();
    const ragIndex = {
      removePreliminarySourceVersion: vi.fn(),
      removeApprovedSourceVersion: vi.fn(),
      indexPreliminarySections: vi.fn(),
      indexApprovedSections: vi.fn(),
      retrievePreliminary: vi.fn(),
      retrieveApproved: vi.fn(),
      retrievePreliminarySafely: vi.fn(),
      retrieveApprovedSafely: vi.fn(),
    };
    const processor = createBackendSourceGovernanceJobProcessor({
      backend: client,
      documentMaterializer: document,
      classifier: { classify: vi.fn() },
      ragIndex,
      officialSourceHosts: ["eur-lex.europa.eu"],
      createInvocationId: () => "00000000-0000-4000-8000-000000000404",
    });

    await expect(processor.process({ candidateId, kind: "INDEX_APPROVED" })).resolves.toMatchObject(
      { ragStatus: "FAILED" },
    );
    expect(document.materialize).not.toHaveBeenCalled();
    expect(ragIndex.indexApprovedSections).not.toHaveBeenCalled();
    expect(client.fail).toHaveBeenCalledWith(
      containing({
        callback: containing({
          failure: { code: "SOURCE_VALIDITY_NOT_CONFIRMED", retryable: false },
        }),
      }),
    );
  });

  it("persists a retryable source failure before asking Cloud Tasks to retry", async () => {
    const input = candidate({
      canonicalUrl: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169",
    });
    const client = backend(input);
    const processor = createBackendSourceGovernanceJobProcessor({
      backend: client,
      documentMaterializer: {
        materialize: vi.fn().mockRejectedValue(new Error("temporary bucket outage")),
      },
      classifier: { classify: vi.fn() },
      ragIndex: {
        removePreliminarySourceVersion: vi.fn(),
        removeApprovedSourceVersion: vi.fn(),
        indexPreliminarySections: vi.fn(),
        indexApprovedSections: vi.fn(),
        retrievePreliminary: vi.fn(),
        retrieveApproved: vi.fn(),
        retrievePreliminarySafely: vi.fn(),
        retrieveApprovedSafely: vi.fn(),
      },
      officialSourceHosts: ["eur-lex.europa.eu"],
      createInvocationId: () => "00000000-0000-4000-8000-000000000404",
    });

    await expect(
      processor.process({ candidateId, classificationRunId, kind: "CLASSIFY" }),
    ).rejects.toBeInstanceOf(SourceGovernanceJobError);
    expect(client.fail).toHaveBeenCalledWith(
      containing({
        callback: containing({
          failure: { code: "SOURCE_WORKER_FAILED", retryable: true },
        }),
      }),
    );
  });
});
