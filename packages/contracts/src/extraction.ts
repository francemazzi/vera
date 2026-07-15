import { z } from "zod";

import { canonicalizeJson, type JsonValue } from "./hash.js";
import { UtcDateTimeSchema } from "./time.js";
import { ValidationScopeSchema } from "./vocabulary.js";

const Sha256DigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Expected a lowercase SHA-256 digest");
const StableKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z][A-Za-z0-9._-]*$/u, "Expected a stable key");
const LanguageTagSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u, "Expected a BCP 47 language tag");
const CanonicalBase64Schema = z
  .string()
  .min(4)
  .max(30_000_000)
  .regex(
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u,
    "Expected canonical base64",
  );

const MAX_RESULT_ITEMS = 10_000;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 50_000;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

function canonicalizeJsonSafely(value: unknown): string | null {
  try {
    return canonicalizeJson(value);
  } catch {
    return null;
  }
}

function isBoundedJsonValue(value: unknown): value is JsonValue {
  const stack: Array<{ readonly depth: number; readonly value: unknown }> = [{ depth: 0, value }];
  const seen = new WeakSet<object>();
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    nodes += 1;
    if (nodes > MAX_JSON_NODES || current.depth > MAX_JSON_DEPTH) return false;

    const item = current.value;
    if (item === null || typeof item === "boolean") continue;
    if (typeof item === "string") {
      if (LONE_SURROGATE.test(item)) return false;
      continue;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) return false;
      continue;
    }
    if (typeof item !== "object" || seen.has(item)) return false;
    seen.add(item);

    if (Object.getOwnPropertySymbols(item).length > 0) return false;
    if (Array.isArray(item)) {
      if (item.length > MAX_JSON_NODES) return false;
      for (let index = 0; index < item.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(item, index);
        if (descriptor === undefined || !("value" in descriptor)) return false;
        stack.push({ depth: current.depth + 1, value: descriptor.value });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(item) as object | null;
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Object.keys(item);
    if (keys.length > MAX_JSON_NODES) return false;
    for (const key of keys) {
      if (LONE_SURROGATE.test(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (descriptor === undefined || !("value" in descriptor)) return false;
      stack.push({ depth: current.depth + 1, value: descriptor.value });
    }
  }
  return true;
}

const JsonValueRuntimeSchema = z.unknown().superRefine((value, context) => {
  if (!isBoundedJsonValue(value) || canonicalizeJsonSafely(value) === null) {
    context.addIssue({
      code: "custom",
      message: "JSON values must be bounded and deterministically canonicalizable",
      path: [],
    });
  }
});

export const JsonValueSchema = JsonValueRuntimeSchema as z.ZodType<JsonValue>;

export const ExtractorKindSchema = z.enum([
  "MANUAL",
  "JSON",
  "OLLAMA_OCR",
  "OLLAMA_VISION",
  "OLLAMA_LLM",
  "OLLAMA_EMBEDDING",
]);

export type ExtractorKind = z.infer<typeof ExtractorKindSchema>;

export const FactStatusSchema = z.enum([
  "RESOLVED",
  "NULL",
  "NOT_FOUND",
  "NOT_READABLE",
  "CONFLICT",
]);

export type FactStatus = z.infer<typeof FactStatusSchema>;

export const FactValueTypeSchema = z.enum(["STRING", "NUMBER", "BOOLEAN", "DATE", "JSON"]);

export type FactValueType = z.infer<typeof FactValueTypeSchema>;

export const NormalizedBoundingBoxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .superRefine(({ x, y, width, height }, context) => {
    if (x + width > 1) {
      context.addIssue({ code: "custom", message: "x + width must be <= 1", path: ["width"] });
    }
    if (y + height > 1) {
      context.addIssue({ code: "custom", message: "y + height must be <= 1", path: ["height"] });
    }
  });

export type NormalizedBoundingBox = z.infer<typeof NormalizedBoundingBoxSchema>;

export const EvidenceSchema = z
  .object({
    id: z.uuid(),
    documentId: z.uuid(),
    documentHash: Sha256DigestSchema,
    page: z.int().min(1),
    text: z.string().min(1).max(20_000),
    language: LanguageTagSchema,
    boundingBox: NormalizedBoundingBoxSchema,
    providerRunId: z.uuid(),
    capturedAt: UtcDateTimeSchema,
    validationScope: ValidationScopeSchema,
  })
  .strict();

export type Evidence = z.infer<typeof EvidenceSchema>;

function hasUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function matchesValueType(valueType: FactValueType, value: JsonValue): boolean {
  if (value === null) return false;
  switch (valueType) {
    case "STRING":
      return typeof value === "string";
    case "NUMBER":
      return typeof value === "number" && Number.isFinite(value);
    case "BOOLEAN":
      return typeof value === "boolean";
    case "DATE":
      return typeof value === "string" && z.iso.date().safeParse(value).success;
    case "JSON":
      return true;
  }
}

const FactBaseShape = {
  id: z.uuid(),
  key: StableKeySchema,
  valueType: FactValueTypeSchema,
  providerRunId: z.uuid(),
  observedAt: UtcDateTimeSchema,
  rawConfidence: z.number().min(0).max(1).nullable(),
  validationScope: ValidationScopeSchema,
} as const;

export const FactCandidateSchema = z
  .object({
    id: z.uuid(),
    originalValue: JsonValueSchema,
    normalizedValue: JsonValueSchema.refine((value) => value !== null, {
      message: "A conflict candidate requires a normalized value",
    }),
    evidenceIds: z.array(z.uuid()).min(1).max(100),
    providerRunId: z.uuid(),
    rawConfidence: z.number().min(0).max(1).nullable(),
  })
  .strict()
  .superRefine(({ evidenceIds }, context) => {
    if (!hasUniqueStrings(evidenceIds)) {
      context.addIssue({
        code: "custom",
        message: "Evidence IDs must be unique",
        path: ["evidenceIds"],
      });
    }
  });

export type FactCandidate = z.infer<typeof FactCandidateSchema>;

export const ResolvedFactSchema = z
  .object({
    ...FactBaseShape,
    status: z.literal("RESOLVED"),
    originalValue: JsonValueSchema.refine((value) => value !== null, {
      message: "A resolved fact requires an original value",
    }),
    normalizedValue: JsonValueSchema.refine((value) => value !== null, {
      message: "A resolved fact requires a normalized value",
    }),
    evidenceIds: z.array(z.uuid()).min(1).max(100),
    candidates: z.array(z.never()).max(0),
  })
  .strict()
  .superRefine(({ valueType, normalizedValue, evidenceIds }, context) => {
    if (!matchesValueType(valueType, normalizedValue)) {
      context.addIssue({
        code: "custom",
        message: `normalizedValue does not match ${valueType}`,
        path: ["normalizedValue"],
      });
    }
    if (!hasUniqueStrings(evidenceIds)) {
      context.addIssue({
        code: "custom",
        message: "Evidence IDs must be unique",
        path: ["evidenceIds"],
      });
    }
  });

export type ResolvedFact = z.infer<typeof ResolvedFactSchema>;

const UnresolvedFactShape = {
  ...FactBaseShape,
  originalValue: z.null(),
  normalizedValue: z.null(),
  evidenceIds: z.array(z.uuid()).max(100),
  candidates: z.array(z.never()).max(0),
} as const;

function validateUnresolvedEvidence(
  status: "NOT_FOUND" | "NOT_READABLE" | "NULL",
  evidenceIds: readonly string[],
  context: z.RefinementCtx,
): void {
  if (!hasUniqueStrings(evidenceIds)) {
    context.addIssue({
      code: "custom",
      message: "Evidence IDs must be unique",
      path: ["evidenceIds"],
    });
  }
  if ((status === "NULL" || status === "NOT_READABLE") && evidenceIds.length === 0) {
    context.addIssue({
      code: "custom",
      message: `${status} requires evidence of the observation`,
      path: ["evidenceIds"],
    });
  }
}

export const NullFactSchema = z
  .object({ ...UnresolvedFactShape, status: z.literal("NULL") })
  .strict()
  .superRefine(({ evidenceIds }, context) => {
    validateUnresolvedEvidence("NULL", evidenceIds, context);
  });
export const NotFoundFactSchema = z
  .object({ ...UnresolvedFactShape, status: z.literal("NOT_FOUND") })
  .strict()
  .superRefine(({ evidenceIds }, context) => {
    validateUnresolvedEvidence("NOT_FOUND", evidenceIds, context);
  });
export const NotReadableFactSchema = z
  .object({ ...UnresolvedFactShape, status: z.literal("NOT_READABLE") })
  .strict()
  .superRefine(({ evidenceIds }, context) => {
    validateUnresolvedEvidence("NOT_READABLE", evidenceIds, context);
  });

export const ConflictFactSchema = z
  .object({
    ...FactBaseShape,
    status: z.literal("CONFLICT"),
    originalValue: z.null(),
    normalizedValue: z.null(),
    evidenceIds: z.array(z.uuid()).min(2).max(200),
    candidates: z.array(FactCandidateSchema).min(2).max(100),
  })
  .strict()
  .superRefine(({ valueType, evidenceIds, candidates, rawConfidence }, context) => {
    if (rawConfidence !== null) {
      context.addIssue({
        code: "custom",
        message: "A conflicting fact cannot expose a combined confidence",
        path: ["rawConfidence"],
      });
    }
    if (!hasUniqueStrings(evidenceIds)) {
      context.addIssue({
        code: "custom",
        message: "Evidence IDs must be unique",
        path: ["evidenceIds"],
      });
    }
    const candidateValues = new Set<string>();
    candidates.forEach((candidate, index) => {
      if (!matchesValueType(valueType, candidate.normalizedValue)) {
        context.addIssue({
          code: "custom",
          message: `Candidate value does not match ${valueType}`,
          path: ["candidates", index, "normalizedValue"],
        });
      }
      const canonical = canonicalizeJsonSafely(candidate.normalizedValue);
      if (canonical !== null) candidateValues.add(canonical);
    });
    if (candidateValues.size < 2) {
      context.addIssue({
        code: "custom",
        message: "A conflict requires at least two distinct normalized values",
        path: ["candidates"],
      });
    }
  });

export const FactSchema = z.union([
  ResolvedFactSchema,
  NullFactSchema,
  NotFoundFactSchema,
  NotReadableFactSchema,
  ConflictFactSchema,
]);

export type ExtractionFact = z.infer<typeof FactSchema>;

export type Fact<T extends JsonValue = JsonValue> =
  | (Omit<ResolvedFact, "normalizedValue"> & { readonly normalizedValue: T })
  | Exclude<ExtractionFact, ResolvedFact>;

export const ExtractorModelSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    digest: Sha256DigestSchema,
    runtime: z.literal("OLLAMA"),
    runtimeVersion: z.string().trim().min(1).max(100),
  })
  .strict();

export type ExtractorModel = z.infer<typeof ExtractorModelSchema>;

export const ExtractorRunSchema = z
  .object({
    id: z.uuid(),
    adapterId: StableKeySchema,
    kind: ExtractorKindSchema,
    startedAt: UtcDateTimeSchema,
    completedAt: UtcDateTimeSchema,
    model: ExtractorModelSchema.nullable(),
    prompt: z.string().min(1).max(100_000).nullable(),
    options: z.record(z.string(), JsonValueSchema),
    rawOutput: z.string().max(2_000_000).nullable(),
    validationScope: ValidationScopeSchema,
  })
  .strict()
  .superRefine(({ kind, startedAt, completedAt, model, prompt, rawOutput }, context) => {
    if (Date.parse(completedAt) < Date.parse(startedAt)) {
      context.addIssue({
        code: "custom",
        message: "completedAt cannot precede startedAt",
        path: ["completedAt"],
      });
    }
    const isOllama = kind.startsWith("OLLAMA_");
    if (isOllama !== (model !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only Ollama runs require model metadata",
        path: ["model"],
      });
    }
    if (isOllama && (rawOutput === null || rawOutput.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "Ollama raw output is required",
        path: ["rawOutput"],
      });
    }
    const needsPrompt = kind === "OLLAMA_OCR" || kind === "OLLAMA_VISION" || kind === "OLLAMA_LLM";
    if (needsPrompt !== (prompt !== null)) {
      context.addIssue({
        code: "custom",
        message: "Prompt presence does not match extractor kind",
        path: ["prompt"],
      });
    }
  });

export type ExtractorRun = z.infer<typeof ExtractorRunSchema>;

export const EmbeddingSchema = z
  .object({
    id: z.uuid(),
    key: StableKeySchema,
    inputHash: Sha256DigestSchema,
    vector: z.array(z.number()).min(1).max(16_384),
    dimensions: z.int().min(1).max(16_384),
    providerRunId: z.uuid(),
    validationScope: ValidationScopeSchema,
  })
  .strict()
  .superRefine(({ vector, dimensions }, context) => {
    if (vector.length !== dimensions) {
      context.addIssue({
        code: "custom",
        message: "Embedding dimensions must match vector length",
        path: ["dimensions"],
      });
    }
  });

export type Embedding = z.infer<typeof EmbeddingSchema>;

export const EvidenceObservationSchema = z
  .object({
    text: z.string().min(1).max(20_000),
    boundingBox: NormalizedBoundingBoxSchema,
  })
  .strict();

export type EvidenceObservation = z.infer<typeof EvidenceObservationSchema>;

export const FactCandidateObservationSchema = z
  .object({
    originalValue: JsonValueSchema,
    normalizedValue: JsonValueSchema.refine((value) => value !== null),
    rawConfidence: z.number().min(0).max(1).nullable(),
    evidence: z.array(EvidenceObservationSchema).min(1).max(100),
  })
  .strict();

export type FactCandidateObservation = z.infer<typeof FactCandidateObservationSchema>;

export const FactObservationSchema = z
  .object({
    key: StableKeySchema,
    valueType: FactValueTypeSchema,
    status: FactStatusSchema,
    originalValue: JsonValueSchema,
    normalizedValue: JsonValueSchema,
    rawConfidence: z.number().min(0).max(1).nullable(),
    evidence: z.array(EvidenceObservationSchema).max(100),
    candidates: z.array(FactCandidateObservationSchema).max(100),
  })
  .strict()
  .superRefine(
    (
      { status, valueType, originalValue, normalizedValue, rawConfidence, evidence, candidates },
      context,
    ) => {
      if (status === "RESOLVED") {
        if (
          originalValue === null ||
          !matchesValueType(valueType, normalizedValue) ||
          evidence.length === 0 ||
          candidates.length > 0
        ) {
          context.addIssue({
            code: "custom",
            message: "A resolved observation requires typed values and evidence only",
            path: [],
          });
        }
        return;
      }

      if (status === "CONFLICT") {
        const distinct = new Set(
          candidates
            .map(({ normalizedValue: value }) => canonicalizeJsonSafely(value))
            .filter((value): value is string => value !== null),
        );
        if (
          originalValue !== null ||
          normalizedValue !== null ||
          rawConfidence !== null ||
          candidates.length < 2 ||
          distinct.size < 2 ||
          candidates.some((candidate) => !matchesValueType(valueType, candidate.normalizedValue))
        ) {
          context.addIssue({
            code: "custom",
            message: "A conflict requires distinct typed candidates without a combined value",
            path: ["candidates"],
          });
        }
        return;
      }

      if (originalValue !== null || normalizedValue !== null || candidates.length > 0) {
        context.addIssue({
          code: "custom",
          message: `${status} cannot carry a value or conflict candidates`,
          path: ["normalizedValue"],
        });
      }
      if ((status === "NULL" || status === "NOT_READABLE") && evidence.length === 0) {
        context.addIssue({
          code: "custom",
          message: `${status} requires observation evidence`,
          path: ["evidence"],
        });
      }
    },
  );

export type FactObservation = z.infer<typeof FactObservationSchema>;

export const FactObservationListSchema = z
  .array(FactObservationSchema)
  .max(MAX_RESULT_ITEMS)
  .superRefine((observations, context) => {
    const candidateCount = observations.reduce(
      (total, observation) => total + observation.candidates.length,
      0,
    );
    const evidenceCount = observations.reduce(
      (total, observation) =>
        total +
        observation.evidence.length +
        observation.candidates.reduce(
          (candidateTotal, candidate) => candidateTotal + candidate.evidence.length,
          0,
        ),
      0,
    );
    if (candidateCount > MAX_RESULT_ITEMS) {
      context.addIssue({
        code: "custom",
        message: `Extraction observations cannot exceed ${String(MAX_RESULT_ITEMS)} candidates`,
        path: [],
      });
    }
    if (evidenceCount > MAX_RESULT_ITEMS) {
      context.addIssue({
        code: "custom",
        message: `Extraction observations cannot exceed ${String(MAX_RESULT_ITEMS)} evidence items`,
        path: [],
      });
    }
  });

const DocumentInputShape = {
  documentId: z.uuid(),
  documentHash: Sha256DigestSchema,
  page: z.int().min(1),
  language: LanguageTagSchema,
} as const;

export const ManualExtractionInputSchema = z
  .object({
    kind: z.literal("MANUAL"),
    ...DocumentInputShape,
    observations: FactObservationListSchema,
  })
  .strict();

export const JsonExtractionInputSchema = z
  .object({
    kind: z.literal("JSON"),
    ...DocumentInputShape,
    value: JsonValueSchema,
  })
  .strict();

const ImageExtractionInputShape = {
  ...DocumentInputShape,
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  imageBase64: CanonicalBase64Schema,
} as const;

function decodedBase64(value: string): Uint8Array | null {
  try {
    const decoded = atob(value);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function hasImageSignature(
  mediaType: "image/jpeg" | "image/png" | "image/webp",
  value: string,
): boolean {
  const bytes = decodedBase64(value);
  if (bytes === null) return false;
  switch (mediaType) {
    case "image/png":
      return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (byte, index) => bytes[index] === byte,
      );
    case "image/jpeg":
      return (
        bytes.length >= 4 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff &&
        bytes.at(-2) === 0xff &&
        bytes.at(-1) === 0xd9
      );
    case "image/webp":
      return (
        bytes.length >= 12 &&
        String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
        String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
      );
  }
}

function validateImageInput(
  input: {
    readonly imageBase64: string;
    readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
  },
  context: z.RefinementCtx,
): void {
  if (!hasImageSignature(input.mediaType, input.imageBase64)) {
    context.addIssue({
      code: "custom",
      message: "Image bytes do not match the declared media type",
      path: ["imageBase64"],
    });
  }
}

export const OllamaOcrExtractionInputSchema = z
  .object({ kind: z.literal("OLLAMA_OCR"), ...ImageExtractionInputShape })
  .strict()
  .superRefine(validateImageInput);

export const OllamaVisionExtractionInputSchema = z
  .object({ kind: z.literal("OLLAMA_VISION"), ...ImageExtractionInputShape })
  .strict()
  .superRefine(validateImageInput);

export const OllamaLlmExtractionInputSchema = z
  .object({
    kind: z.literal("OLLAMA_LLM"),
    ...DocumentInputShape,
    text: z.string().min(1).max(2_000_000),
  })
  .strict();

export const EmbeddingInputEntrySchema = z
  .object({
    key: StableKeySchema,
    text: z.string().min(1).max(100_000),
  })
  .strict();

export const OllamaEmbeddingExtractionInputSchema = z
  .object({
    kind: z.literal("OLLAMA_EMBEDDING"),
    entries: z.array(EmbeddingInputEntrySchema).min(1).max(1_000),
  })
  .strict()
  .superRefine(({ entries }, context) => {
    if (!hasUniqueStrings(entries.map(({ key }) => key))) {
      context.addIssue({
        code: "custom",
        message: "Embedding input keys must be unique",
        path: ["entries"],
      });
    }
  });

export const ExtractionInputSchema = z.union([
  ManualExtractionInputSchema,
  JsonExtractionInputSchema,
  OllamaOcrExtractionInputSchema,
  OllamaVisionExtractionInputSchema,
  OllamaLlmExtractionInputSchema,
  OllamaEmbeddingExtractionInputSchema,
]);

export type ExtractionInput = z.infer<typeof ExtractionInputSchema>;

export const ExtractionRequestSchema = z
  .object({
    id: z.uuid(),
    adapterId: StableKeySchema,
    kind: ExtractorKindSchema,
    inputHash: Sha256DigestSchema,
    requestedAt: UtcDateTimeSchema,
    input: ExtractionInputSchema,
    validationScope: ValidationScopeSchema,
  })
  .strict()
  .superRefine(({ kind, input }, context) => {
    if (kind !== input.kind) {
      context.addIssue({
        code: "custom",
        message: "Request kind must match input kind",
        path: ["input", "kind"],
      });
    }
  });

export type ExtractionRequest = z.infer<typeof ExtractionRequestSchema>;

export const ExtractionResultSchema = z
  .object({
    requestId: z.uuid(),
    run: ExtractorRunSchema,
    facts: z.array(FactSchema).max(MAX_RESULT_ITEMS),
    evidence: z.array(EvidenceSchema).max(MAX_RESULT_ITEMS),
    embeddings: z.array(EmbeddingSchema).max(MAX_RESULT_ITEMS),
    validationScope: ValidationScopeSchema,
  })
  .strict()
  .superRefine(({ run, facts, evidence, embeddings }, context) => {
    const evidenceIds = new Set(evidence.map(({ id }) => id));
    const entityIds = [
      ...facts.map(({ id }) => id),
      ...facts.flatMap(({ candidates }) => candidates.map(({ id }) => id)),
      ...evidenceIds,
      ...embeddings.map(({ id }) => id),
    ];
    if (!hasUniqueStrings(entityIds)) {
      context.addIssue({ code: "custom", message: "Result entity IDs must be unique", path: [] });
    }
    if (!hasUniqueStrings(facts.map(({ key }) => key))) {
      context.addIssue({ code: "custom", message: "Fact keys must be unique", path: ["facts"] });
    }
    if (!hasUniqueStrings(embeddings.map(({ key }) => key))) {
      context.addIssue({
        code: "custom",
        message: "Embedding keys must be unique",
        path: ["embeddings"],
      });
    }
    if (new Set(embeddings.map(({ dimensions }) => dimensions)).size > 1) {
      context.addIssue({
        code: "custom",
        message: "All embeddings in one run must have the same dimensions",
        path: ["embeddings"],
      });
    }
    if (facts.reduce((total, fact) => total + fact.candidates.length, 0) > MAX_RESULT_ITEMS) {
      context.addIssue({
        code: "custom",
        message: `Extraction results cannot exceed ${String(MAX_RESULT_ITEMS)} candidates`,
        path: ["facts"],
      });
    }
    facts.forEach((fact, factIndex) => {
      if (fact.providerRunId !== run.id) {
        context.addIssue({
          code: "custom",
          message: "Fact providerRunId must match the run",
          path: ["facts", factIndex, "providerRunId"],
        });
      }
      fact.evidenceIds.forEach((evidenceId, evidenceIndex) => {
        if (!evidenceIds.has(evidenceId)) {
          context.addIssue({
            code: "custom",
            message: "Fact references missing evidence",
            path: ["facts", factIndex, "evidenceIds", evidenceIndex],
          });
        }
      });
      fact.candidates.forEach((candidate, candidateIndex) => {
        if (candidate.providerRunId !== run.id) {
          context.addIssue({
            code: "custom",
            message: "Candidate providerRunId must match the run",
            path: ["facts", factIndex, "candidates", candidateIndex, "providerRunId"],
          });
        }
        candidate.evidenceIds.forEach((evidenceId, evidenceIndex) => {
          if (!evidenceIds.has(evidenceId)) {
            context.addIssue({
              code: "custom",
              message: "Candidate references missing evidence",
              path: [
                "facts",
                factIndex,
                "candidates",
                candidateIndex,
                "evidenceIds",
                evidenceIndex,
              ],
            });
          }
          if (!fact.evidenceIds.includes(evidenceId)) {
            context.addIssue({
              code: "custom",
              message: "Candidate evidence must be propagated to its fact",
              path: [
                "facts",
                factIndex,
                "candidates",
                candidateIndex,
                "evidenceIds",
                evidenceIndex,
              ],
            });
          }
        });
      });
    });
    evidence.forEach((item, index) => {
      if (item.providerRunId !== run.id) {
        context.addIssue({
          code: "custom",
          message: "Evidence providerRunId must match the run",
          path: ["evidence", index, "providerRunId"],
        });
      }
    });
    embeddings.forEach((embedding, index) => {
      if (embedding.providerRunId !== run.id) {
        context.addIssue({
          code: "custom",
          message: "Embedding providerRunId must match the run",
          path: ["embeddings", index, "providerRunId"],
        });
      }
    });
    if (
      run.kind === "OLLAMA_EMBEDDING"
        ? facts.length > 0 || evidence.length > 0
        : embeddings.length > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Embedding and fact extraction outputs cannot be mixed",
        path: ["embeddings"],
      });
    }
  });

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
