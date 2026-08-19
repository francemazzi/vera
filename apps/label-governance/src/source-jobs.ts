import { z } from "zod";

export const SourceGovernanceJobSchema = z
  .object({
    candidateId: z.uuid(),
    classificationRunId: z.uuid().optional(),
    kind: z.enum([
      "FETCH_AND_CLASSIFY",
      "CLASSIFY",
      "INDEX_VERIFIED",
      "INDEX_APPROVED",
      "REMOVE_RETIRED",
    ]),
  })
  .strict();

export type SourceGovernanceJob = z.infer<typeof SourceGovernanceJobSchema>;

export type SourceGovernanceJobResult = Readonly<{
  candidateId: string;
  kind: SourceGovernanceJob["kind"];
  replayed?: boolean;
  /** Artifact SHA was already reserved by a different candidate; no AI/RAG work ran. */
  duplicate?: boolean;
  classificationStatus?: "COMPLETED" | "FAILED";
  ragStatus?: "INDEXED" | "REMOVED" | "FAILED";
}>;

export class SourceGovernanceJobError extends Error {
  public constructor(
    message: string,
    public readonly retryable: boolean,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "SourceGovernanceJobError";
  }
}

/**
 * Private worker boundary used by `/internal/source-jobs`.
 *
 * Its implementation resolves `candidateId` against the backend/private
 * database, fetches only the opaque GCS object, validates any external URL
 * against the official allowlist, extracts text, classifies it, and writes to
 * Chroma only after an expert has verified the candidate. A direct private PDF
 * may be classified in staging, but no unverified source is ever embedded.
 * It also persists FAILED state before throwing a
 * retryable error. A Cloud Task never contains source content, object paths,
 * OpenRouter credentials, or browser identity.
 */
export interface SourceGovernanceJobProcessor {
  process(job: SourceGovernanceJob): Promise<SourceGovernanceJobResult>;
}

/**
 * Safe deployment default until the environment-specific candidate/GCS adapter
 * is injected. Acknowledging no job would lose a source, so it asks Cloud
 * Tasks to retry rather than returning a false success.
 */
export function createUnavailableSourceGovernanceJobProcessor(): SourceGovernanceJobProcessor {
  return {
    async process() {
      await Promise.resolve();
      throw new SourceGovernanceJobError("Source job processor is not configured", true);
    },
  };
}
