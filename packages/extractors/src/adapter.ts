import { randomUUID } from "node:crypto";

import {
  ExtractionRequestSchema,
  ExtractionResultSchema,
  canonicalizeJson,
  sha256Bytes,
  sha256CanonicalJson,
  UtcDateTimeSchema,
} from "@vera/contracts";
import type {
  ExtractionInput,
  ExtractionRequest,
  ExtractionResult,
  ExtractorKind,
  ExtractorRun,
} from "@vera/contracts";

import { ExtractorValidationError } from "./errors.js";

const MAX_RECORDED_RAW_OUTPUT_CHARACTERS = 2_000_000;

export interface ExtractorAdapter {
  readonly id: string;
  readonly kind: ExtractorKind;
  supports(kind: ExtractorKind): boolean;
  extract(request: ExtractionRequest): Promise<ExtractionResult>;
}

export type ExtractionRequestFor<TKind extends ExtractorKind> = ExtractionRequest & {
  readonly kind: TKind;
  readonly input: Extract<ExtractionInput, { readonly kind: TKind }>;
};

export interface ExtractorRuntime {
  readonly createId: () => string;
  readonly now: () => string;
  readonly runtimeVersion: string;
}

export const defaultExtractorRuntime: ExtractorRuntime = {
  createId: randomUUID,
  now: () => new Date().toISOString(),
  runtimeVersion: process.version,
};

export function parseExtractionRequest(value: unknown): ExtractionRequest {
  const parsed = ExtractionRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new ExtractorValidationError(
      "INVALID_EXTRACTION_REQUEST",
      "Extraction request does not satisfy the strict shared contract",
      { issueCount: parsed.error.issues.length },
    );
  }
  return parsed.data;
}

export function parseExtractionResult(value: unknown): ExtractionResult {
  const parsed = ExtractionResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new ExtractorValidationError(
      "INVALID_EXTRACTION_OUTPUT",
      "Extractor output does not satisfy the strict shared contract",
      { issueCount: parsed.error.issues.length },
    );
  }
  return parsed.data;
}

export function requireInputKind<TKind extends ExtractorKind>(
  request: ExtractionRequest,
  expectedKind: TKind,
): asserts request is ExtractionRequestFor<TKind>;
export function requireInputKind<TKind extends ExtractorKind>(
  request: ExtractionRequest,
  expectedKind: TKind,
): void {
  if (request.kind !== expectedKind || request.input.kind !== expectedKind) {
    throw new ExtractorValidationError(
      "UNSUPPORTED_INPUT_KIND",
      `Adapter for ${expectedKind} cannot process ${request.input.kind}`,
      { actualKind: request.input.kind, expectedKind },
    );
  }
}

export function requireAdapterIdentity(request: ExtractionRequest, adapterId: string): void {
  if (request.adapterId !== adapterId) {
    throw new ExtractorValidationError(
      "INVALID_EXTRACTION_REQUEST",
      "Extraction request adapterId does not match the selected adapter",
      { actualAdapterId: request.adapterId, expectedAdapterId: adapterId },
    );
  }
  const expectedInputHash =
    "documentHash" in request.input
      ? request.input.documentHash
      : sha256CanonicalJson(request.input);
  if (request.inputHash !== expectedInputHash) {
    throw new ExtractorValidationError(
      "INVALID_EXTRACTION_REQUEST",
      "Request input hash does not match the extracted input",
      { expectedInputHash, inputHash: request.inputHash },
    );
  }
}

export function parseRuntimeTimestamp(value: string): string {
  const parsed = UtcDateTimeSchema.safeParse(value);
  if (!parsed.success) {
    throw new ExtractorValidationError(
      "INVALID_EXTRACTION_OUTPUT",
      "Extractor runtime returned a non-canonical UTC timestamp",
      { issueCount: parsed.error.issues.length },
    );
  }
  return parsed.data;
}

export function elapsedMilliseconds(startedAt: string, completedAt: string): number {
  const elapsed = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    throw new ExtractorValidationError(
      "INVALID_EXTRACTION_OUTPUT",
      "Extractor runtime timestamps are not monotonic",
    );
  }
  return elapsed;
}

export function createLocalExtractorRun(
  request: ExtractionRequest,
  runtime: ExtractorRuntime,
  startedAt: string,
  completedAt: string,
): ExtractorRun {
  elapsedMilliseconds(startedAt, completedAt);
  let rawOutput: string;
  let options: ExtractorRun["options"] = {};
  try {
    rawOutput = canonicalizeJson(request.input);
  } catch (cause) {
    throw new ExtractorValidationError(
      "INVALID_EXTRACTION_REQUEST",
      "Extraction input cannot be deterministically canonicalized",
      { cause: cause instanceof Error ? cause.name : "unknown" },
    );
  }
  if (rawOutput.length > MAX_RECORDED_RAW_OUTPUT_CHARACTERS) {
    const bytes = new TextEncoder().encode(rawOutput);
    const canonicalInputSha256 = sha256Bytes(bytes);
    options = {
      rawOutputTruncated: true,
      canonicalInputSha256,
      originalCharacters: rawOutput.length,
      originalBytes: bytes.byteLength,
    };
    rawOutput = canonicalizeJson({
      canonicalInputSha256,
      originalBytes: bytes.byteLength,
      preservation: "CONTENT_ADDRESSED_SOURCE_REQUIRED",
    });
  }
  return {
    id: runtime.createId(),
    adapterId: request.adapterId,
    kind: request.kind,
    startedAt,
    completedAt,
    model: null,
    prompt: null,
    options,
    rawOutput,
    validationScope: request.validationScope,
  };
}
