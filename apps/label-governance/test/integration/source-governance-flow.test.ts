import {
  ChromaPrivateLabelRagIndex,
  PRIVATE_LABEL_VERIFIED_COLLECTION,
  PRIVATE_LABEL_RAG_EMBEDDING_DIMENSIONS,
} from "@vera/rag";
import type {
  ChromaCollection,
  ChromaMetadata,
  ChromaVectorMatch,
  ChromaVectorQuery,
  ChromaVectorRecord,
  ChromaVectorStore,
  PrivateLabelEmbeddingProvider,
  RagProviderModel,
} from "@vera/rag";
import { describe, expect, it, vi } from "vitest";

import { createBackendSourceGovernanceJobProcessor } from "../../src/backend-source-job-processor.js";
import type { SourceClassificationProposal } from "../../src/contracts.js";
import { createLabelGovernanceServer } from "../../src/server.js";
import type {
  SourceDocumentMaterializer,
  MaterializedSourceDocument,
} from "../../src/source-document-materializer.js";
import type { SourceLedgerRepository } from "../../src/source-ledger.js";
import type {
  SourceBackendClient,
  SourceWorkerCompletion,
  SourceWorkerFailure,
  SourceWorkerInput,
  SourceWorkerProcessing,
} from "../../src/source-backend-client.js";

const sourceId = "00000000-0000-4000-8000-000000000601";
const candidateId = "00000000-0000-4000-8000-000000000602";
const classificationRunId = "00000000-0000-4000-8000-000000000603";
const ledgerVersionId = "00000000-0000-4000-8000-000000000604";
const actorId = "00000000-0000-4000-8000-000000000605";
const sourceHash = "a".repeat(64);
const materializedHash = "b".repeat(64);

const model: RagProviderModel = {
  name: "synthetic-label-embedding",
  digest: "c".repeat(64),
  runtimeVersion: "integration-test",
};

function embedding(): readonly number[] {
  return Array.from({ length: PRIVATE_LABEL_RAG_EMBEDDING_DIMENSIONS }, (_, index) =>
    index === 0 ? 1 : 0,
  );
}

function classificationProposal(): SourceClassificationProposal {
  return {
    authority: "European Union",
    legalNature: "REGULATION",
    jurisdiction: "EU",
    language: "it",
    actReference: "Regolamento (UE) n. 1169/2011",
    revisionLabel: "consolidated",
    validFrom: "2014-12-13T00:00:00.000Z",
    validTo: null,
    bindingForce: "BINDING",
    productCategories: ["Alimenti preimballati"],
    labelingTopics: ["Informazioni alimentari"],
    possibleSupersedes: [],
    possibleDuplicates: [],
    confidence: 0.98,
    evidence: [
      {
        field: "actReference",
        pageNumber: 1,
        quote:
          "Regolamento (UE) n. 1169/2011 relativo alla fornitura di informazioni sugli alimenti.",
      },
    ],
  };
}

function workerInput(): SourceWorkerInput {
  return {
    candidateId,
    batchId: "00000000-0000-4000-8000-000000000606",
    classificationRunId,
    kind: "FETCH_AND_CLASSIFY",
    sourceKind: "TABULAR",
    sourceFormat: "PDF",
    stageStatus: "CLASSIFICATION_QUEUED",
    governanceStatus: "UNVERIFIED",
    classificationStatus: "QUEUED",
    verifiedRagStatus: "NOT_REQUESTED",
    ragStatus: "QUEUED",
    sourceVersion: 1,
    ragWorkspaceScope: "00000000-0000-4000-8000-000000000606",
    sourceTitle: "Regolamento (UE) n. 1169/2011",
    pdfUrl: "https://eur-lex.europa.eu/legal-content/IT/TXT/PDF/?uri=CELEX:32011R1169",
    canonicalUrl: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169",
    storageObjectKey: "label-governance/sources/catalogue/1169-2011/original.pdf",
    extractedTextObjectKey: null,
    sourceSha256: sourceHash,
    contentByteSize: 1_024,
    jurisdiction: "EU",
    language: "it",
    documentType: "REGULATION",
    actReference: "Regolamento (UE) n. 1169/2011",
    revisionLabel: "consolidated",
    validFrom: "2014-12-13T00:00:00.000Z",
    validTo: null,
    productCategories: ["Alimenti preimballati"],
    notes: "Catalogo Food Consulting",
    classificationJson: null,
  };
}

function materializedDocument(): MaterializedSourceDocument {
  return {
    artifacts: {
      sourceSha256: materializedHash,
      storageObjectKey: "label-governance/sources/catalogue/1169-2011/original.pdf",
      extractedTextObjectKey: "label-governance/sources/catalogue/1169-2011/extracted.json",
      contentByteSize: 1_024,
    },
    classificationText:
      "Regolamento (UE) n. 1169/2011 relativo alla fornitura di informazioni sugli alimenti ai consumatori.",
    sections: [
      {
        id: "article-9",
        title: "Articolo 9",
        pageNumber: 1,
        text: "Le informazioni obbligatorie sugli alimenti comprendono denominazione e elenco degli ingredienti.",
      },
      {
        id: "article-21",
        title: "Articolo 21",
        pageNumber: 2,
        text: "Le sostanze o i prodotti che provocano allergie o intolleranze devono essere evidenziati.",
      },
    ],
  };
}

class StaticEmbeddingProvider implements PrivateLabelEmbeddingProvider {
  public readonly model = model;
  public readonly embeddedDocuments: string[] = [];

  public embedTexts(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return this.embedDocuments(texts);
  }

  public embedDocuments(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    this.embeddedDocuments.push(...texts);
    return Promise.resolve(texts.map(() => embedding()));
  }

  public embedQuery(text: string): Promise<readonly number[]> {
    void text;
    return Promise.resolve(embedding());
  }
}

class RecordingChromaStore implements ChromaVectorStore {
  public readonly collections = new Map<string, ChromaCollection>();
  public readonly records: {
    readonly collection: ChromaCollection;
    readonly record: ChromaVectorRecord;
  }[] = [];
  public readonly deletes: {
    readonly collection: ChromaCollection;
    readonly where: Readonly<Record<string, unknown>>;
  }[] = [];

  public ensureCollection(input: {
    readonly name: string;
    readonly metadata: ChromaMetadata;
  }): Promise<ChromaCollection> {
    const existing = this.collections.get(input.name);
    if (existing !== undefined) return Promise.resolve(existing);
    const collection = { id: `collection-${input.name}`, name: input.name };
    this.collections.set(input.name, collection);
    return Promise.resolve(collection);
  }

  public upsert(input: {
    readonly collection: ChromaCollection;
    readonly records: readonly ChromaVectorRecord[];
  }): Promise<void> {
    this.records.push(...input.records.map((record) => ({ collection: input.collection, record })));
    return Promise.resolve();
  }

  public delete(input: {
    readonly collection: ChromaCollection;
    readonly where: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    this.deletes.push(input);
    return Promise.resolve();
  }

  public query(input: {
    readonly collection: ChromaCollection;
    readonly query: ChromaVectorQuery;
  }): Promise<readonly ChromaVectorMatch[]> {
    void input;
    return Promise.resolve([]);
  }

  public heartbeat(): Promise<void> {
    return Promise.resolve();
  }
}

class InMemoryWorkerBackend implements SourceBackendClient {
  public readonly processing: SourceWorkerProcessing[] = [];
  public readonly completions: SourceWorkerCompletion[] = [];
  public readonly failures: SourceWorkerFailure[] = [];
  #input: SourceWorkerInput;
  readonly #claimedJobs = new Set<string>();

  public constructor(input: SourceWorkerInput) {
    this.#input = input;
  }

  public setInput(input: SourceWorkerInput): void {
    this.#input = input;
  }

  public getInput(): Promise<SourceWorkerInput> {
    return Promise.resolve(this.#input);
  }

  public claim(input: Parameters<SourceBackendClient["claim"]>[0]): Promise<{
    readonly acquired: boolean;
    readonly replayed: boolean;
    readonly input?: SourceWorkerInput;
  }> {
    const key = `${input.kind}:${input.classificationRunId ?? "none"}`;
    if (this.#claimedJobs.has(key)) return Promise.resolve({ acquired: false, replayed: true });
    this.#claimedJobs.add(key);
    return Promise.resolve({ acquired: true, replayed: false });
  }

  public reserveArtifacts(input: {
    readonly candidateId: string;
    readonly callback: SourceWorkerProcessing;
  }): Promise<{ readonly replayed: boolean; readonly duplicate: boolean }> {
    this.processing.push(input.callback);
    return Promise.resolve({ replayed: false, duplicate: false });
  }

  public complete(input: {
    readonly candidateId: string;
    readonly callback: SourceWorkerCompletion;
  }): Promise<void> {
    this.completions.push(input.callback);
    return Promise.resolve();
  }

  public fail(input: {
    readonly candidateId: string;
    readonly callback: SourceWorkerFailure;
  }): Promise<void> {
    this.failures.push(input.callback);
    return Promise.resolve();
  }
}

type LedgerState = "UNVERIFIED" | "VERIFIED" | "APPROVED" | "RETIRED";
type LedgerTransition = {
  readonly sequence: number;
  readonly toState: LedgerState;
  readonly actorId: string;
};

class InMemoryLedgerRepository implements SourceLedgerRepository {
  readonly #versions = new Map<
    string,
    { id: string; contentHash: string; state: LedgerState; transitions: LedgerTransition[] }
  >();

  public createSourceVersion(input: {
    readonly source: {
      readonly id: string;
      readonly stableReference: string;
      readonly title: string;
      readonly jurisdiction: string;
    };
    readonly version: {
      readonly id: string;
      readonly revision: number;
      readonly contentHash: string;
      readonly contentObjectRef: string;
    };
    readonly actorId: string;
    readonly actorRole: "ADMIN";
    readonly createdAt: string;
  }): Promise<{
    readonly sourceVersionId: string;
    readonly state: "UNVERIFIED";
    readonly transitionHash: string;
  }> {
    this.#versions.set(input.version.id, {
      id: input.version.id,
      contentHash: input.version.contentHash,
      state: "UNVERIFIED",
      transitions: [{ sequence: 1, toState: "UNVERIFIED", actorId: input.actorId }],
    });
    return Promise.resolve({
      sourceVersionId: input.version.id,
      state: "UNVERIFIED",
      transitionHash: "d".repeat(64),
    });
  }

  public appendSourceTransition(input: {
    readonly sourceVersionId: string;
    readonly expectedSequence: number;
    readonly expectedState: "UNVERIFIED" | "VERIFIED" | "APPROVED";
    readonly toState: "VERIFIED" | "APPROVED" | "RETIRED";
    readonly actorId: string;
    readonly actorRole: "ADMIN";
    readonly reason?: string;
    readonly createdAt: string;
  }): Promise<{
    readonly id: string;
    readonly sequence: number;
    readonly state: string;
    readonly contentHash: string;
  }> {
    const version = this.#versions.get(input.sourceVersionId);
    const latest = version?.transitions.at(-1);
    if (
      version === undefined ||
      latest === undefined ||
      version.state !== input.expectedState ||
      latest.sequence !== input.expectedSequence
    ) {
      return Promise.reject(new Error("stale immutable ledger transition"));
    }
    const sequence = latest.sequence + 1;
    version.state = input.toState;
    version.transitions.push({ sequence, toState: input.toState, actorId: input.actorId });
    return Promise.resolve({
      id: `${input.sourceVersionId}-${sequence.toString()}`,
      sequence,
      state: input.toState,
      contentHash: "e".repeat(64),
    });
  }

  public getSourceVersion(sourceVersionId: string): Promise<{
    readonly id: string;
    readonly contentHash: string;
    readonly state: LedgerState;
    readonly transitions: readonly LedgerTransition[];
  }> {
    const version = this.#versions.get(sourceVersionId);
    if (version === undefined) return Promise.reject(new Error("source version is missing"));
    return Promise.resolve({
      id: version.id,
      contentHash: version.contentHash,
      state: version.state,
      transitions: [...version.transitions],
    });
  }
}

describe("source governance integration flow", () => {
  it("classifies an UNVERIFIED source without Chroma, then indexes it only after the expert VERIFY transition", async () => {
    const backendAuthorizer = {
      authorize: vi.fn((authorization: string | undefined): Promise<void> => {
        if (authorization === "Bearer synthetic-backend") return Promise.resolve();
        return Promise.reject(new Error("backend OIDC rejected"));
      }),
    };
    const taskAuthorizer = {
      authorize: vi.fn((authorization: string | undefined): Promise<void> => {
        if (authorization === "Bearer synthetic-task") return Promise.resolve();
        return Promise.reject(new Error("task OIDC rejected"));
      }),
    };
    const backend = new InMemoryWorkerBackend(workerInput());
    const embeddings = new StaticEmbeddingProvider();
    const chroma = new RecordingChromaStore();
    const ragIndex = new ChromaPrivateLabelRagIndex({ chroma, embeddingProvider: embeddings });
    const classifier = {
      classify: vi.fn().mockResolvedValue({
        proposal: classificationProposal(),
        model: "google/gemini-2.5-pro" as const,
        promptVersion: "label-source-classification-v1" as const,
        responseSchemaHash: "f".repeat(64),
      }),
    };
    const materialize = vi.fn().mockResolvedValue(materializedDocument());
    const materializer: SourceDocumentMaterializer = { materialize };
    const processor = createBackendSourceGovernanceJobProcessor({
      backend,
      documentMaterializer: materializer,
      classifier,
      ragIndex,
      officialSourceHosts: ["eur-lex.europa.eu"],
      createInvocationId: (): string => "00000000-0000-4000-8000-000000000607",
    });
    const ledger = new InMemoryLedgerRepository();
    const server = await createLabelGovernanceServer({
      authorizer: backendAuthorizer,
      sourceJobAuthorizer: taskAuthorizer,
      classifier,
      sourceJobProcessor: processor,
      sourceLedgerRepository: ledger,
    });

    try {
      const ledgerResponse = await server.inject({
        method: "POST",
        url: "/internal/source-versions",
        headers: { authorization: "Bearer synthetic-backend" },
        payload: {
          action: "CREATE_UNVERIFIED",
          candidateId,
          source: {
            id: sourceId,
            stableReference: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169",
            title: "Regolamento (UE) n. 1169/2011",
            jurisdiction: "EU",
          },
          version: {
            id: ledgerVersionId,
            revision: 1,
            contentHash: sourceHash,
            contentObjectRef: "label-governance/sources/catalogue/1169-2011/original.pdf",
          },
          actor: { id: actorId, role: "ADMIN" },
          createdAt: "2026-07-20T12:00:00.000Z",
        },
      });
      expect(ledgerResponse.statusCode).toBe(200);
      expect(ledgerResponse.json()).toEqual({
        status: "success",
        data: { sourceVersionId: ledgerVersionId, state: "UNVERIFIED", sequence: 1 },
      });

      const taskPayload = {
        candidateId,
        classificationRunId,
        kind: "FETCH_AND_CLASSIFY",
      } as const;
      const completed = await server.inject({
        method: "POST",
        url: "/internal/source-jobs",
        headers: { authorization: "Bearer synthetic-task" },
        payload: taskPayload,
      });
      expect(completed.statusCode).toBe(200);
      expect(completed.json()).toEqual({
        status: "success",
        meta: {
          candidateId,
          kind: "FETCH_AND_CLASSIFY",
          classificationStatus: "COMPLETED",
        },
      });

      expect(backend.failures).toEqual([]);
      expect(backend.processing).toHaveLength(1);
      expect(backend.completions).toHaveLength(1);
      const classificationCompletion = backend.completions[0];
      if (classificationCompletion === undefined) throw new Error("source worker did not complete");
      expect(classificationCompletion.status).toBe("COMPLETED");
      const completionClassification = classificationCompletion.classification;
      if (completionClassification === undefined)
        throw new Error("classification callback is missing");
      expect(completionClassification.model).toBe("google/gemini-2.5-pro");
      expect(completionClassification.promptVersion).toBe("label-source-classification-v1");
      expect(completionClassification.authority).toBe("European Union");
      expect(classificationCompletion.rag).toBeUndefined();
      expect(classifier.classify).toHaveBeenCalledOnce();
      expect(materialize).toHaveBeenCalledOnce();
      expect(embeddings.embeddedDocuments).toEqual([]);
      expect(chroma.records).toEqual([]);
      expect([...chroma.collections.keys()]).toEqual([]);

      const replay = await server.inject({
        method: "POST",
        url: "/internal/source-jobs",
        headers: { authorization: "Bearer synthetic-task" },
        payload: taskPayload,
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual({
        status: "success",
        meta: { candidateId, kind: "FETCH_AND_CLASSIFY", replayed: true },
      });

      const verifyResponse = await server.inject({
        method: "POST",
        url: "/internal/source-versions",
        headers: { authorization: "Bearer synthetic-backend" },
        payload: {
          action: "VERIFY",
          candidateId,
          source: {
            id: sourceId,
            stableReference: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169",
            title: "Regolamento (UE) n. 1169/2011",
            jurisdiction: "EU",
          },
          version: {
            id: ledgerVersionId,
            revision: 1,
            contentHash: sourceHash,
            contentObjectRef: "label-governance/sources/catalogue/1169-2011/original.pdf",
          },
          actor: { id: actorId, role: "ADMIN" },
          expectedSequence: 1,
          reason: "Fonte ufficiale controllata dall'esperto Food Consulting",
          createdAt: "2026-07-20T12:05:00.000Z",
        },
      });
      expect(verifyResponse.statusCode).toBe(200);
      expect(verifyResponse.json()).toEqual({
        status: "success",
        data: { sourceVersionId: ledgerVersionId, state: "VERIFIED", sequence: 2 },
      });

      backend.setInput({
        ...workerInput(),
        kind: "INDEX_VERIFIED",
        classificationRunId: null,
        governanceStatus: "VERIFIED",
        stageStatus: "SUBMITTED",
        classificationStatus: "COMPLETED",
        ragStatus: "QUEUED",
        classificationJson: completionClassification,
      });
      const verified = await server.inject({
        method: "POST",
        url: "/internal/source-jobs",
        headers: { authorization: "Bearer synthetic-task" },
        payload: { candidateId, kind: "INDEX_VERIFIED" },
      });
      expect(verified.statusCode).toBe(200);
      expect(verified.json()).toEqual({
        status: "success",
        meta: { candidateId, kind: "INDEX_VERIFIED", ragStatus: "INDEXED" },
      });

      expect(backend.processing).toHaveLength(2);
      expect(backend.completions).toHaveLength(2);
      const verifiedCompletion = backend.completions[1];
      if (verifiedCompletion === undefined)
        throw new Error("verified source worker did not complete");
      expect(verifiedCompletion.rag).toEqual({
        status: "INDEXED",
        collection: PRIVATE_LABEL_VERIFIED_COLLECTION,
        chunkCount: 2,
        sourceHash: materializedHash,
      });
      expect(classifier.classify).toHaveBeenCalledOnce();
      expect(materialize).toHaveBeenCalledTimes(2);
      expect(embeddings.embeddedDocuments).toHaveLength(2);
      expect(chroma.records).toHaveLength(2);
      const indexedRecord = chroma.records.find(
        ({ collection }): boolean => collection.name === PRIVATE_LABEL_VERIFIED_COLLECTION,
      );
      if (indexedRecord === undefined) throw new Error("verified RAG record is missing");
      expect(indexedRecord.record.metadata["source_state"]).toBe("VERIFIED");
      expect(indexedRecord.record.metadata["validity_status"]).toBe("ADMIN_CONFIRMED");
      expect(indexedRecord.record.metadata["source_content_hash"]).toBe(materializedHash);
      expect(indexedRecord.record.metadata["jurisdiction"]).toBe("EU");
      expect([...chroma.collections.keys()]).toEqual([PRIVATE_LABEL_VERIFIED_COLLECTION]);
      expect(taskAuthorizer.authorize).toHaveBeenCalledTimes(3);
      expect(backendAuthorizer.authorize).toHaveBeenCalledTimes(2);
    } finally {
      await server.close();
    }
  });
});
