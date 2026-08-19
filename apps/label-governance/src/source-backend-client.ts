import { GoogleAuth } from "google-auth-library";
import { z } from "zod";

import { SourceClassificationProposalSchema } from "./contracts.js";
import { SourceGovernanceJobSchema } from "./source-jobs.js";
import type { SourceGovernanceJob } from "./source-jobs.js";

const Sha256DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const OptionalTextSchema = z.string().trim().min(1).max(8_000).nullable();
const OptionalUrlSchema = z.url().max(2_048).nullable();
const UtcDateTimeSchema = z.iso.datetime({ offset: true }).nullable();
const RagWorkspaceScopeSchema = z.union([z.uuid(), z.literal("GLOBAL")]);

/**
 * PDF remains the only public-import format. `OFFICIAL_HTML` is an internal
 * catalogue snapshot that the backend has already fetched into private GCS;
 * the governance worker never follows an HTML URL itself.
 */
export const SourceDocumentFormatSchema = z.enum(["PDF", "OFFICIAL_HTML"]);

const SourceCandidateStageStatusSchema = z.enum([
  "PENDING_UPLOAD",
  "RECEIVED",
  // Discovery proposals are staged records. They are readable by the worker
  // for classification, but cannot be indexed until an expert verifies them.
  "DISCOVERED",
  "REJECTED",
  "CLASSIFICATION_QUEUED",
  "CLASSIFIED",
  "FAILED",
  "SUBMITTED",
]);

const SourceRagStatusSchema = z.enum(["NOT_REQUESTED", "QUEUED", "INDEXED", "FAILED"]);

const DateOrUtcDateTimeSchema = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })])
  .transform((value) => (value.length === 10 ? `${value}T00:00:00.000Z` : value));

export const SourceWorkerInputSchema = z
  .object({
    candidateId: z.uuid(),
    batchId: z.uuid(),
    classificationRunId: z.uuid().nullable(),
    kind: SourceGovernanceJobSchema.shape.kind,
    sourceKind: z.enum(["TABULAR", "PDF_UPLOAD"]),
    // Default preserves replay compatibility for source jobs created before
    // curated official-HTML snapshots were introduced.
    sourceFormat: SourceDocumentFormatSchema.default("PDF"),
    stageStatus: SourceCandidateStageStatusSchema,
    governanceStatus: z.enum(["UNVERIFIED", "VERIFIED", "APPROVED", "RETIRED"]).nullable(),
    classificationStatus: z.enum(["QUEUED", "RUNNING", "COMPLETED", "FAILED"]).nullable(),
    /** Informative/verified collection lifecycle, separate from formal RAG. */
    verifiedRagStatus: SourceRagStatusSchema,
    ragStatus: SourceRagStatusSchema,
    sourceVersion: z.int().min(1),
    /** Missing legacy scope is fail-closed by the index worker. */
    ragWorkspaceScope: RagWorkspaceScopeSchema.nullable().optional(),
    sourceTitle: OptionalTextSchema,
    pdfUrl: OptionalUrlSchema,
    canonicalUrl: OptionalUrlSchema,
    storageObjectKey: OptionalTextSchema,
    extractedTextObjectKey: OptionalTextSchema,
    sourceSha256: Sha256DigestSchema.nullable(),
    contentByteSize: z
      .int()
      .min(1)
      .max(50 * 1024 * 1024)
      .nullable(),
    jurisdiction: z.string().trim().min(1).max(120).nullable(),
    language: z.string().trim().min(2).max(35).nullable(),
    documentType: z.string().trim().min(1).max(120).nullable(),
    actReference: z.string().trim().min(1).max(500).nullable(),
    revisionLabel: z.string().trim().min(1).max(120).nullable(),
    validFrom: UtcDateTimeSchema,
    validTo: UtcDateTimeSchema,
    productCategories: z.array(z.string().trim().min(1).max(120)).max(100),
    notes: z.string().trim().min(1).max(8_000).nullable(),
    /** Durable worker classification may include audit fields alongside the proposal. */
    classificationJson: z.unknown().nullable(),
  })
  .strict();

export type SourceWorkerInput = z.infer<typeof SourceWorkerInputSchema>;

const SourceWorkerInputResponseSchema = z
  .object({
    candidateId: z.uuid(),
    classificationRunId: z.uuid().nullable(),
    kind: SourceGovernanceJobSchema.shape.kind,
    source: z
      .object({
        batchId: z.uuid(),
        sourceVersion: z.int().min(1),
        ragWorkspaceScope: RagWorkspaceScopeSchema.nullable().optional(),
        sourceKind: z.enum(["TABULAR", "PDF_UPLOAD"]),
        sourceFormat: SourceDocumentFormatSchema.default("PDF"),
        stageStatus: SourceWorkerInputSchema.shape.stageStatus,
        governanceStatus: SourceWorkerInputSchema.shape.governanceStatus,
        classificationStatus: SourceWorkerInputSchema.shape.classificationStatus.optional(),
        verifiedRagStatus: SourceWorkerInputSchema.shape.verifiedRagStatus,
        ragStatus: SourceWorkerInputSchema.shape.ragStatus,
        sourceTitle: OptionalTextSchema,
        pdfUrl: OptionalUrlSchema,
        canonicalUrl: OptionalUrlSchema,
        storageObjectKey: OptionalTextSchema,
        extractedTextObjectKey: OptionalTextSchema,
        sourceSha256: Sha256DigestSchema.nullable(),
        contentByteSize: z
          .int()
          .min(1)
          .max(50 * 1024 * 1024)
          .nullable(),
        jurisdiction: z.string().trim().min(1).max(120).nullable(),
        language: z.string().trim().min(2).max(35).nullable(),
        documentType: z.string().trim().min(1).max(120).nullable(),
        actReference: z.string().trim().min(1).max(500).nullable(),
        revisionLabel: z.string().trim().min(1).max(120).nullable(),
        validFrom: DateOrUtcDateTimeSchema.nullable(),
        validTo: DateOrUtcDateTimeSchema.nullable(),
        productCategories: z.array(z.string().trim().min(1).max(120)).max(100),
        notes: z.string().trim().min(1).max(8_000).nullable().optional(),
        classificationJson: z.unknown().nullable(),
      })
      .strict(),
  })
  .strict();

const WorkerInputEnvelopeSchema = z
  .object({
    status: z.literal("success"),
    data: SourceWorkerInputResponseSchema,
  })
  .strict();

const ClaimEnvelopeSchema = z
  .object({
    status: z.literal("success"),
    data: z
      .object({
        candidateId: z.uuid(),
        kind: SourceGovernanceJobSchema.shape.kind,
        classificationRunId: z.uuid().nullable(),
        stageStatus: SourceWorkerInputSchema.shape.stageStatus,
        classificationStatus: SourceWorkerInputSchema.shape.classificationStatus,
        verifiedRagStatus: SourceWorkerInputSchema.shape.verifiedRagStatus,
        ragStatus: SourceWorkerInputSchema.shape.ragStatus,
        lease: z.object({ expiresAt: z.iso.datetime({ offset: true }) }).nullable(),
      })
      .strict(),
    meta: z
      .object({
        acquired: z.boolean(),
        replayed: z.boolean(),
        leaseExpiresAt: z.iso.datetime({ offset: true }).optional(),
      })
      .strict(),
  })
  .strict();

const SourceWorkerArtifactsSchema = z
  .object({
    sourceSha256: Sha256DigestSchema,
    storageObjectKey: z.string().trim().min(1).max(1_000),
    extractedTextObjectKey: z.string().trim().min(1).max(1_000),
    contentByteSize: z
      .int()
      .min(1)
      .max(50 * 1024 * 1024),
  })
  .strict();

const SourceWorkerRagResultSchema = z
  .object({
    status: z.enum(["INDEXED", "REMOVED", "FAILED"]),
    collection: z.enum(["silto-label-verified-v1", "silto-label-approved-v1"]).nullable(),
    chunkCount: z.int().min(0).max(1_000_000),
    sourceHash: Sha256DigestSchema.nullable(),
  })
  .strict();

export type SourceWorkerArtifacts = z.infer<typeof SourceWorkerArtifactsSchema>;
export type SourceWorkerRagResult = z.infer<typeof SourceWorkerRagResultSchema>;

const SourceWorkerClassificationSchema = SourceClassificationProposalSchema.extend({
  model: z.literal("google/gemini-2.5-pro"),
  promptVersion: z.literal("label-source-classification-v1"),
  responseSchemaHash: Sha256DigestSchema,
  requestHash: Sha256DigestSchema,
}).strict();

/**
 * Sent immediately after PDF materialization. The backend atomically reserves
 * the SHA-256 before the worker can send source text to AI or Chroma.
 */
const SourceWorkerProcessingSchema = z
  .object({
    kind: SourceGovernanceJobSchema.shape.kind,
    classificationRunId: z.uuid().nullable(),
    workerInvocationId: z.uuid(),
    status: z.literal("PROCESSING"),
    artifacts: SourceWorkerArtifactsSchema,
  })
  .strict();

const SourceWorkerCompletionSchema = z
  .object({
    kind: SourceGovernanceJobSchema.shape.kind,
    classificationRunId: z.uuid().nullable(),
    workerInvocationId: z.uuid(),
    status: z.literal("COMPLETED"),
    classification: SourceWorkerClassificationSchema.optional(),
    artifacts: SourceWorkerArtifactsSchema.optional(),
    rag: SourceWorkerRagResultSchema.optional(),
  })
  .strict();

const SourceWorkerFailureSchema = z
  .object({
    kind: SourceGovernanceJobSchema.shape.kind,
    classificationRunId: z.uuid().nullable(),
    workerInvocationId: z.uuid(),
    status: z.literal("FAILED"),
    failure: z
      .object({
        code: z.string().trim().min(1).max(120),
        retryable: z.boolean(),
      })
      .strict(),
    // A classification can be durable even when a subsequent Chroma operation
    // fails. The backend records it without ever treating it as approval.
    classification: SourceWorkerClassificationSchema.optional(),
    artifacts: SourceWorkerArtifactsSchema.optional(),
    rag: SourceWorkerRagResultSchema.optional(),
  })
  .strict();

export type SourceWorkerCompletion = z.infer<typeof SourceWorkerCompletionSchema>;
export type SourceWorkerFailure = z.infer<typeof SourceWorkerFailureSchema>;
export type SourceWorkerProcessing = z.infer<typeof SourceWorkerProcessingSchema>;

const ProcessingReservationEnvelopeSchema = z
  .object({
    status: z.literal("success"),
    data: z.unknown(),
    meta: z
      .object({
        replayed: z.boolean(),
        duplicate: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

export class SourceBackendClientError extends Error {
  public constructor(
    message: string,
    public readonly retryable: boolean,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "SourceBackendClientError";
  }
}

export interface SourceBackendClient {
  readonly getInput: (job: SourceGovernanceJob) => Promise<SourceWorkerInput>;
  readonly claim: (input: {
    readonly candidateId: string;
    readonly kind: SourceGovernanceJob["kind"];
    readonly classificationRunId: string | null;
    readonly workerInvocationId: string;
  }) => Promise<{
    readonly acquired: boolean;
    readonly replayed: boolean;
    readonly input?: SourceWorkerInput;
  }>;
  readonly reserveArtifacts: (input: {
    readonly candidateId: string;
    readonly callback: SourceWorkerProcessing;
  }) => Promise<{ readonly replayed: boolean; readonly duplicate: boolean }>;
  readonly complete: (input: {
    readonly candidateId: string;
    readonly callback: SourceWorkerCompletion;
  }) => Promise<void>;
  readonly fail: (input: {
    readonly candidateId: string;
    readonly callback: SourceWorkerFailure;
  }) => Promise<void>;
}

interface IdTokenClient {
  request(options: {
    readonly url: string;
    readonly method: string;
    readonly data?: unknown;
  }): Promise<{ readonly data: unknown }>;
}

function trimBaseUrl(value: string, allowLoopbackHttp = false): string {
  try {
    const url = new URL(value);
    const isLoopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" &&
        !(allowLoopbackHttp && url.protocol === "http:" && isLoopback)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("invalid");
    }
    return url.toString().replace(/\/$/u, "");
  } catch {
    throw new SourceBackendClientError("Governance backend URL is invalid", false);
  }
}

function errorFromBackend(error: unknown): SourceBackendClientError {
  const response =
    typeof error === "object" && error !== null && "response" in error
      ? (error as { readonly response?: { readonly status?: unknown } }).response
      : undefined;
  const status = typeof response?.status === "number" ? response.status : undefined;
  return new SourceBackendClientError(
    status === undefined
      ? "Governance backend request failed"
      : `Governance backend returned HTTP ${String(status)}`,
    status === undefined || status === 408 || status === 409 || status === 429 || status >= 500,
    { cause: error },
  );
}

/** OIDC-only client for the backend's non-public source-worker endpoints. */
export function createSourceBackendClient(options: {
  readonly backendUrl: string;
  readonly audience: string;
  readonly auth?: Pick<GoogleAuth, "getIdTokenClient">;
  /** Explicit local-only bearer bridge; production always uses Google OIDC. */
  readonly localToken?: string;
}): SourceBackendClient {
  const backendUrl = trimBaseUrl(options.backendUrl, options.localToken !== undefined);
  const auth = options.auth ?? new GoogleAuth();
  let client: Promise<IdTokenClient> | undefined;
  const idTokenClient = (): Promise<IdTokenClient> => {
    client ??= auth.getIdTokenClient(options.audience) as Promise<IdTokenClient>;
    return client;
  };
  const request = async (path: string, method: string, data?: unknown): Promise<unknown> => {
    try {
      if (options.localToken !== undefined) {
        const response = await fetch(`${backendUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${options.localToken}`,
            ...(data === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok)
          throw new Error(`Governance backend returned HTTP ${String(response.status)}`);
        return await response.json();
      }
      const response = await (
        await idTokenClient()
      ).request({
        url: `${backendUrl}${path}`,
        method,
        ...(data === undefined ? {} : { data }),
      });
      return response.data;
    } catch (error) {
      throw errorFromBackend(error);
    }
  };
  const encodedCandidateId = (candidateId: string): string =>
    encodeURIComponent(z.uuid().parse(candidateId));

  return {
    async getInput(job) {
      const parsedJob = SourceGovernanceJobSchema.parse(job);
      const query = new URLSearchParams({ kind: parsedJob.kind });
      if (parsedJob.classificationRunId !== undefined) {
        query.set("classificationRunId", parsedJob.classificationRunId);
      }
      const response = WorkerInputEnvelopeSchema.parse(
        await request(
          `/internal/label/sources/${encodedCandidateId(parsedJob.candidateId)}/worker-input?${query.toString()}`,
          "GET",
        ),
      ).data;
      return SourceWorkerInputSchema.parse({
        candidateId: response.candidateId,
        classificationRunId: response.classificationRunId,
        kind: response.kind,
        ...response.source,
        classificationStatus: response.source.classificationStatus ?? null,
        notes: response.source.notes ?? null,
      });
    },
    async claim(input) {
      const response = ClaimEnvelopeSchema.parse(
        await request(
          `/internal/label/sources/${encodedCandidateId(input.candidateId)}/worker-claim`,
          "POST",
          {
            kind: input.kind,
            classificationRunId: input.classificationRunId,
            workerInvocationId: input.workerInvocationId,
          },
        ),
      );
      return {
        acquired: response.meta.acquired,
        replayed: response.meta.replayed,
      };
    },
    async reserveArtifacts(input) {
      const callback = SourceWorkerProcessingSchema.parse(input.callback);
      const response = ProcessingReservationEnvelopeSchema.parse(
        await request(
          `/internal/label/sources/${encodedCandidateId(input.candidateId)}/worker-callback`,
          "POST",
          callback,
        ),
      );
      return {
        replayed: response.meta.replayed,
        duplicate: response.meta.duplicate ?? false,
      };
    },
    async complete(input) {
      const callback = SourceWorkerCompletionSchema.parse(input.callback);
      await request(
        `/internal/label/sources/${encodedCandidateId(input.candidateId)}/worker-callback`,
        "POST",
        callback,
      );
    },
    async fail(input) {
      const callback = SourceWorkerFailureSchema.parse(input.callback);
      await request(
        `/internal/label/sources/${encodedCandidateId(input.candidateId)}/worker-callback`,
        "POST",
        callback,
      );
    },
  };
}
