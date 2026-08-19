import { z } from "zod";

import type { SourceWorkerArtifacts, SourceWorkerInput } from "./source-backend-client.js";

export const SourceTextSectionSchema = z
  .object({
    id: z.string().trim().min(1).max(500),
    title: z.string().trim().min(1).max(300),
    pageNumber: z.int().min(1).nullable(),
    text: z.string().trim().min(1).max(100_000),
  })
  .strict();

export type SourceTextSection = z.infer<typeof SourceTextSectionSchema>;

export const MaterializedSourceDocumentSchema = z
  .object({
    artifacts: z
      .object({
        sourceSha256: z.string().regex(/^[0-9a-f]{64}$/u),
        storageObjectKey: z.string().trim().min(1).max(1_000),
        extractedTextObjectKey: z.string().trim().min(1).max(1_000),
        contentByteSize: z
          .int()
          .min(1)
          .max(50 * 1024 * 1024),
      })
      .strict(),
    /** Bounded text sent only to the official-source classifier. */
    classificationText: z.string().trim().min(1).max(500_000),
    sections: z.array(SourceTextSectionSchema).min(1).max(10_000),
  })
  .strict();

export type MaterializedSourceDocument = z.infer<typeof MaterializedSourceDocumentSchema>;

export class SourceDocumentMaterializationError extends Error {
  public constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly failureCode: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "SourceDocumentMaterializationError";
  }
}

/**
 * Resolves only an opaque GCS object (or an allowed official PDF URL) to
 * bounded extracted text. Curated official HTML is always pre-snapshotted by
 * the backend in private GCS and is never fetched from its canonical URL by
 * the worker. The processor never accepts raw document bytes from Cloud Tasks.
 */
export interface SourceDocumentMaterializer {
  readonly materialize: (input: SourceWorkerInput) => Promise<MaterializedSourceDocument>;
}

export function sourceWorkerArtifacts(
  materialized: MaterializedSourceDocument,
): SourceWorkerArtifacts {
  return materialized.artifacts;
}
