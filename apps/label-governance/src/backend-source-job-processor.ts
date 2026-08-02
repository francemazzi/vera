import { sha256CanonicalJson } from "@vera/contracts";
import {
  PRIVATE_LABEL_APPROVED_COLLECTION,
  PRIVATE_LABEL_VERIFIED_COLLECTION,
  RagError,
} from "@vera/rag";
import type { PrivateLabelRagIndex, PrivateLabelRagSection } from "@vera/rag";

import type { SourceClassificationProposal } from "./contracts.js";
import { SourceClassificationProposalSchema } from "./contracts.js";
import { assertOfficialSourceUrl } from "./official-source-policy.js";
import type { SourceBackendClient, SourceWorkerInput } from "./source-backend-client.js";
import type {
  SourceWorkerArtifacts,
  SourceWorkerCompletion,
  SourceWorkerFailure,
} from "./source-backend-client.js";
import {
  SourceDocumentMaterializationError,
  sourceWorkerArtifacts,
} from "./source-document-materializer.js";
import type { SourceDocumentMaterializer } from "./source-document-materializer.js";
import { isVerifiedDiscoverySnapshotObjectKey } from "./source-discovery-snapshot.js";
import { SourceGovernanceJobError, SourceGovernanceJobSchema } from "./source-jobs.js";
import type {
  SourceGovernanceJob,
  SourceGovernanceJobProcessor,
  SourceGovernanceJobResult,
} from "./source-jobs.js";
import { SourceClassificationError } from "./source-classifier.js";
import type { SourceClassifier } from "./source-classifier.js";

const UNKNOWN_VALID_FROM = "1970-01-01T00:00:00.000Z";

type CompletionClassification = NonNullable<SourceWorkerCompletion["classification"]>;

function sourceTitle(input: SourceWorkerInput): string {
  return input.sourceTitle ?? "Normative source";
}

function officialReference(input: SourceWorkerInput): string | null {
  return input.canonicalUrl ?? input.pdfUrl;
}

function persistedProposal(value: unknown): SourceClassificationProposal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return SourceClassificationProposalSchema.parse(value);
  }
  const auditFields = new Set(["model", "promptVersion", "responseSchemaHash", "requestHash"]);
  const proposal = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([field]) => !auditFields.has(field)),
  );
  return SourceClassificationProposalSchema.parse(proposal);
}

function classificationRequestHash(input: SourceWorkerInput): string {
  return sha256CanonicalJson({
    sourceId: input.candidateId,
    sourceVersion: input.sourceVersion,
    sourceContentHash: input.sourceSha256,
    canonicalUrl: officialReference(input),
    model: "google/gemini-2.5-pro",
    promptVersion: "label-source-classification-v1",
  });
}

function sectionsForRag(input: {
  readonly candidate: SourceWorkerInput;
  readonly sourceHash: string;
  readonly proposal: SourceClassificationProposal;
  readonly materialized: Awaited<ReturnType<SourceDocumentMaterializer["materialize"]>>;
  readonly state: "VERIFIED" | "APPROVED";
}): readonly PrivateLabelRagSection[] {
  const candidate = input.candidate;
  const workspaceScope = candidate.ragWorkspaceScope;
  if (!workspaceScope) {
    throw new SourceDocumentMaterializationError(
      "A source without an explicit workspace or curated GLOBAL scope cannot enter Chroma",
      false,
      "SOURCE_WORKSPACE_SCOPE_UNAVAILABLE",
    );
  }
  const proposal = input.proposal;
  const validityStatus =
    candidate.validFrom !== null
      ? candidate.governanceStatus === "VERIFIED" || candidate.governanceStatus === "APPROVED"
        ? "ADMIN_CONFIRMED"
        : "ADMIN_DECLARED"
      : proposal.validFrom !== null
        ? "AI_PROPOSED"
        : "UNKNOWN";
  // Unknown dates remain indexable for future administrator discovery and
  // reclassification, but the Chroma normal retrieval filter excludes them.
  // They can never reach the approved collection (defence in depth below).
  const validFrom = candidate.validFrom ?? proposal.validFrom ?? UNKNOWN_VALID_FROM;
  const validTo = candidate.validTo ?? proposal.validTo;
  const categories =
    candidate.productCategories.length > 0
      ? candidate.productCategories
      : proposal.productCategories;
  return input.materialized.sections.map((section) => ({
    sourceId: candidate.candidateId,
    // The candidate UUID is a stable source-version identity; each re-index
    // deletes it first, so a revision cannot leave stale chunks behind.
    sourceVersionId: candidate.candidateId,
    workspaceScope,
    sourceState: input.state,
    validityStatus,
    sourceContentHash: input.sourceHash,
    title: sourceTitle(candidate),
    jurisdiction: candidate.jurisdiction ?? proposal.jurisdiction,
    language: candidate.language ?? proposal.language,
    documentType: candidate.documentType ?? proposal.legalNature,
    actReference: candidate.actReference ?? proposal.actReference,
    canonicalReference: officialReference(candidate),
    pdfReference: candidate.pdfUrl,
    revisionLabel: candidate.revisionLabel ?? proposal.revisionLabel ?? "UNSPECIFIED",
    validity: { validFrom, validTo },
    productCategories: categories,
    labelingTopics: proposal.labelingTopics,
    sectionId: section.id,
    sectionTitle: section.title,
    pageNumber: section.pageNumber,
    text: section.text,
  }));
}

function errorFailureCode(error: unknown): string {
  if (error instanceof SourceDocumentMaterializationError) return error.failureCode;
  if (error instanceof SourceClassificationError) return "OPENROUTER_CLASSIFICATION_FAILED";
  if (error instanceof RagError) return `RAG_${error.code}`;
  return "SOURCE_WORKER_FAILED";
}

function errorRetryable(error: unknown): boolean {
  if (error instanceof SourceDocumentMaterializationError) return error.retryable;
  if (error instanceof SourceClassificationError) return error.retryable;
  if (error instanceof RagError) return error.retryable;
  return true;
}

function ragFailure(sourceHash: string | null): NonNullable<SourceWorkerFailure["rag"]> {
  return { status: "FAILED", collection: null, chunkCount: 0, sourceHash };
}

/**
 * Concrete orchestration for the private worker. Every dependency is injected
 * so GCS/PDF, OpenRouter, Chroma and backend calls can be integration-tested
 * independently. It never transitions source governance state itself.
 */
export function createBackendSourceGovernanceJobProcessor(options: {
  readonly backend: SourceBackendClient;
  readonly documentMaterializer: SourceDocumentMaterializer;
  readonly classifier: SourceClassifier;
  readonly ragIndex: PrivateLabelRagIndex;
  readonly officialSourceHosts: readonly string[];
  readonly createInvocationId?: () => string;
}): SourceGovernanceJobProcessor {
  const createInvocationId = options.createInvocationId ?? (() => crypto.randomUUID());

  const reportFailure = async (input: {
    readonly candidate: SourceWorkerInput;
    readonly job: SourceGovernanceJob;
    readonly invocationId: string;
    readonly error: unknown;
    readonly classification?: CompletionClassification;
    readonly artifacts?: SourceWorkerArtifacts;
  }): Promise<SourceGovernanceJobResult> => {
    const retryable = errorRetryable(input.error);
    const failure: SourceWorkerFailure = {
      kind: input.job.kind,
      classificationRunId: input.candidate.classificationRunId,
      workerInvocationId: input.invocationId,
      status: "FAILED",
      failure: { code: errorFailureCode(input.error), retryable },
      ...(input.classification === undefined ? {} : { classification: input.classification }),
      ...(input.artifacts === undefined ? {} : { artifacts: input.artifacts }),
      ...(input.job.kind === "REMOVE_RETIRED"
        ? {}
        : { rag: ragFailure(input.candidate.sourceSha256) }),
    };
    try {
      await options.backend.fail({ candidateId: input.candidate.candidateId, callback: failure });
    } catch (callbackError) {
      throw new SourceGovernanceJobError("Unable to persist source worker failure", true, {
        cause: callbackError,
      });
    }
    if (retryable) {
      throw new SourceGovernanceJobError("Source worker retryable failure persisted", true, {
        cause: input.error,
      });
    }
    return {
      candidateId: input.candidate.candidateId,
      kind: input.job.kind,
      ...(input.job.kind === "REMOVE_RETIRED" ? {} : { classificationStatus: "FAILED" as const }),
      ragStatus: "FAILED",
    };
  };

  return {
    async process(job): Promise<SourceGovernanceJobResult> {
      const inputJob = SourceGovernanceJobSchema.parse(job);
      const initial = await options.backend.getInput(inputJob);
      const invocationId = createInvocationId();
      const claim = await options.backend.claim({
        candidateId: initial.candidateId,
        kind: inputJob.kind,
        classificationRunId: inputJob.classificationRunId ?? initial.classificationRunId,
        workerInvocationId: invocationId,
      });
      if (!claim.acquired) {
        return { candidateId: initial.candidateId, kind: inputJob.kind, replayed: true };
      }
      const candidate = initial;
      let classification: CompletionClassification | undefined;
      let artifacts: SourceWorkerArtifacts | undefined;
      try {
        if (inputJob.kind === "REMOVE_RETIRED") {
          await options.ragIndex.removePreliminarySourceVersion(candidate.candidateId);
          await options.ragIndex.removeApprovedSourceVersion(candidate.candidateId);
          await options.backend.complete({
            candidateId: candidate.candidateId,
            callback: {
              kind: inputJob.kind,
              classificationRunId: candidate.classificationRunId,
              workerInvocationId: invocationId,
              status: "COMPLETED",
              rag: {
                status: "REMOVED",
                collection: null,
                chunkCount: 0,
                sourceHash: candidate.sourceSha256,
              },
            },
          });
          return { candidateId: candidate.candidateId, kind: inputJob.kind, ragStatus: "REMOVED" };
        }

        const reference = officialReference(candidate);
        // Direct PDFs can be classified in staging, but every source reaching
        // either RAG collection must carry an official canonical/PDF reference
        // that an expert can audit from the analysis citation.
        const needsOfficialReference =
          candidate.sourceKind === "TABULAR" ||
          inputJob.kind === "INDEX_VERIFIED" ||
          inputJob.kind === "INDEX_APPROVED";
        if (needsOfficialReference && reference === null) {
          throw new SourceDocumentMaterializationError(
            "An official reference is required for this source operation",
            false,
            "OFFICIAL_SOURCE_URL_REQUIRED",
          );
        }
        const isVerifiedDiscoverySnapshot = isVerifiedDiscoverySnapshotObjectKey(
          candidate,
          candidate.storageObjectKey,
        );
        if (reference !== null) {
          if (!isVerifiedDiscoverySnapshot) {
            assertOfficialSourceUrl(reference, options.officialSourceHosts);
          }
        } else if (candidate.sourceKind !== "PDF_UPLOAD") {
          throw new SourceDocumentMaterializationError(
            "A source without a canonical URL must be a directly uploaded PDF candidate",
            false,
            "OFFICIAL_SOURCE_URL_REQUIRED",
          );
        }
        // A formal collection must never derive its temporal validity from an
        // AI proposal or an unconfirmed/unknown range.
        // The backend independently blocks APPROVE without these candidate
        // fields; keeping this guard in the worker prevents an unsafe replay
        // or a malformed callback from bypassing that boundary.
        if (
          inputJob.kind === "INDEX_APPROVED" &&
          (candidate.validFrom === null ||
            (candidate.validTo !== null &&
              Date.parse(candidate.validTo) <= Date.parse(candidate.validFrom)))
        ) {
          throw new SourceDocumentMaterializationError(
            "Approved indexing requires an ADMIN-confirmed validity range",
            false,
            "SOURCE_VALIDITY_NOT_CONFIRMED",
          );
        }
        // Index jobs never need to materialize, reserve, or expose a source
        // to any downstream dependency unless its human governance state is
        // already sufficient for the target collection.
        if (inputJob.kind === "INDEX_VERIFIED") {
          if (
            candidate.governanceStatus !== "VERIFIED" &&
            candidate.governanceStatus !== "APPROVED"
          ) {
            throw new SourceDocumentMaterializationError(
              "Only expert-verified sources can enter the verified RAG collection",
              false,
              "SOURCE_NOT_VERIFIED",
            );
          }
          if (candidate.classificationJson === null) {
            throw new SourceDocumentMaterializationError(
              "Verified indexing requires a persisted classification proposal",
              false,
              "VERIFIED_CLASSIFICATION_INPUT_UNAVAILABLE",
            );
          }
        }
        if (inputJob.kind === "INDEX_APPROVED") {
          if (candidate.governanceStatus !== "APPROVED") {
            throw new SourceDocumentMaterializationError(
              "Only approved sources can enter the approved RAG collection",
              false,
              "SOURCE_NOT_APPROVED",
            );
          }
          if (candidate.classificationJson === null) {
            throw new SourceDocumentMaterializationError(
              "Approved indexing requires a persisted classification proposal",
              false,
              "APPROVED_CLASSIFICATION_INPUT_UNAVAILABLE",
            );
          }
        }
        if (
          (inputJob.kind === "INDEX_VERIFIED" || inputJob.kind === "INDEX_APPROVED") &&
          !candidate.ragWorkspaceScope
        ) {
          throw new SourceDocumentMaterializationError(
            "A source without an explicit workspace or curated GLOBAL scope cannot enter Chroma",
            false,
            "SOURCE_WORKSPACE_SCOPE_UNAVAILABLE",
          );
        }
        const materialized = await options.documentMaterializer.materialize(candidate);
        artifacts = sourceWorkerArtifacts(materialized);
        // Reserve the discovered content hash before sending a byte of source
        // text to OpenRouter or adding a vector. This closes the URL-import
        // race where two allowed URLs resolve to the same PDF.
        const reservation = await options.backend.reserveArtifacts({
          candidateId: candidate.candidateId,
          callback: {
            kind: inputJob.kind,
            classificationRunId: candidate.classificationRunId,
            workerInvocationId: invocationId,
            status: "PROCESSING",
            artifacts,
          },
        });
        if (reservation.duplicate || reservation.replayed) {
          // The backend either cleared the lease and recorded a terminal
          // duplicate, or reports that another terminal result won the race.
          // Do not issue a second callback: Cloud Tasks receives this 2xx and
          // no classification or Chroma chunks are created by this worker.
          return {
            candidateId: candidate.candidateId,
            kind: inputJob.kind,
            ...(reservation.replayed ? { replayed: true } : {}),
            ...(reservation.duplicate ? { duplicate: true } : {}),
          };
        }

        if (inputJob.kind === "INDEX_VERIFIED") {
          const proposal = persistedProposal(candidate.classificationJson);
          const sections = sectionsForRag({
            candidate,
            sourceHash: materialized.artifacts.sourceSha256,
            proposal,
            materialized,
            state: candidate.governanceStatus === "APPROVED" ? "APPROVED" : "VERIFIED",
          });
          const indexed = await options.ragIndex.indexPreliminarySections(sections);
          await options.backend.complete({
            candidateId: candidate.candidateId,
            callback: {
              kind: inputJob.kind,
              classificationRunId: candidate.classificationRunId,
              workerInvocationId: invocationId,
              status: "COMPLETED",
              artifacts,
              rag: {
                status: "INDEXED",
                collection: PRIVATE_LABEL_VERIFIED_COLLECTION,
                chunkCount: indexed.chunksIndexed,
                sourceHash: materialized.artifacts.sourceSha256,
              },
            },
          });
          return { candidateId: candidate.candidateId, kind: inputJob.kind, ragStatus: "INDEXED" };
        }

        if (inputJob.kind === "INDEX_APPROVED") {
          const proposal = persistedProposal(candidate.classificationJson);
          const sections = sectionsForRag({
            candidate,
            sourceHash: materialized.artifacts.sourceSha256,
            proposal,
            materialized,
            state: "APPROVED",
          });
          // Keep an approved source in the verified collection as well as the
          // formal collection. Each index performs an upsert before it prunes
          // only stale content hashes, so a formal-index failure never clears
          // an already usable verified source.
          await options.ragIndex.indexPreliminarySections(sections);
          const indexed = await options.ragIndex.indexApprovedSections(sections);
          await options.backend.complete({
            candidateId: candidate.candidateId,
            callback: {
              kind: inputJob.kind,
              classificationRunId: candidate.classificationRunId,
              workerInvocationId: invocationId,
              status: "COMPLETED",
              artifacts,
              rag: {
                status: "INDEXED",
                collection: PRIVATE_LABEL_APPROVED_COLLECTION,
                chunkCount: indexed.chunksIndexed,
                sourceHash: materialized.artifacts.sourceSha256,
              },
            },
          });
          return { candidateId: candidate.candidateId, kind: inputJob.kind, ragStatus: "INDEXED" };
        }

        const result = await options.classifier.classify({
          sourceId: candidate.candidateId,
          sourceVersionId: candidate.candidateId,
          sourceContentHash: materialized.artifacts.sourceSha256,
          canonicalUrl: reference,
          sourceTitle: sourceTitle(candidate),
          sourceText: materialized.classificationText,
        });
        classification = {
          ...result.proposal,
          model: result.model,
          promptVersion: result.promptVersion,
          responseSchemaHash: result.responseSchemaHash,
          requestHash: classificationRequestHash({
            ...candidate,
            sourceSha256: materialized.artifacts.sourceSha256,
          }),
        };
        await options.backend.complete({
          candidateId: candidate.candidateId,
          callback: {
            kind: inputJob.kind,
            classificationRunId: candidate.classificationRunId,
            workerInvocationId: invocationId,
            status: "COMPLETED",
            classification,
            artifacts,
          },
        });
        return {
          candidateId: candidate.candidateId,
          kind: inputJob.kind,
          classificationStatus: "COMPLETED",
        };
      } catch (error) {
        return reportFailure({
          candidate,
          job: inputJob,
          invocationId,
          error,
          ...(classification === undefined ? {} : { classification }),
          ...(artifacts === undefined ? {} : { artifacts }),
        });
      }
    },
  };
}
