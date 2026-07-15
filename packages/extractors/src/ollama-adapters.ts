import {
  FactObservationListSchema,
  JsonValueSchema,
  sha256Bytes,
  sha256CanonicalJson,
} from "@vera/contracts";
import type {
  ExtractionRequest,
  ExtractionResult,
  ExtractorKind,
  FactObservation,
  JsonValue,
} from "@vera/contracts";

import {
  defaultExtractorRuntime,
  parseExtractionRequest,
  parseExtractionResult,
  parseRuntimeTimestamp,
  requireAdapterIdentity,
  requireInputKind,
} from "./adapter.js";
import type { ExtractorAdapter, ExtractorRuntime } from "./adapter.js";
import { ExtractorValidationError } from "./errors.js";
import { materializeFactObservations } from "./manual-adapter.js";
import { OllamaClientError } from "./ollama-client.js";
import type { OllamaClient } from "./ollama-client.js";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const STABLE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/u;
const MAX_MODEL_OUTPUT_NODES = 50_000;
const MAX_MODEL_OUTPUT_DEPTH = 64;

const FORBIDDEN_NORMATIVE_KEYS = new Set([
  "complianceoutcome",
  "compliancestatus",
  "decision",
  "evaluationoutcome",
  "evaluationresult",
  "finding",
  "findings",
  "normativeoutcome",
  "outcome",
  "rulefinding",
  "ruleoutcome",
  "verdict",
]);

const FACT_OUTPUT_PROTOCOL = `Return only one JSON object with the key "facts".
Each fact must contain exactly: key, valueType, status, originalValue, normalizedValue,
rawConfidence, evidence, candidates. valueType is STRING, NUMBER, BOOLEAN, DATE or JSON.
status is RESOLVED, NULL, NOT_FOUND, NOT_READABLE or CONFLICT. Evidence entries contain exactly
text and boundingBox; boundingBox contains x, y, width and height normalized to [0,1] from the
top-left origin. Conflict candidates contain exactly originalValue, normalizedValue, rawConfidence
and evidence. Do not emit Markdown, explanations, compliance decisions, findings, verdicts or
normative outcomes.`;

const DEFAULT_OCR_PROMPT = `Extract literal, observable facts from the attached synthetic document
image. Preserve the source wording in originalValue and normalize only when the value type permits it.`;
const DEFAULT_VISION_PROMPT = `Extract only directly observable facts from the attached synthetic
document image. Do not infer obligations, permissions, prohibitions or compliance.`;
const DEFAULT_LLM_PROMPT = `Extract factual observations from the supplied synthetic text. Do not
interpret the text as a normative decision and abstain with an unresolved status when evidence is
insufficient.`;

type OllamaFactKind = "OLLAMA_LLM" | "OLLAMA_OCR" | "OLLAMA_VISION";

type OllamaDocumentInput = Extract<ExtractionRequest["input"], { readonly kind: OllamaFactKind }>;

export interface OllamaModelConfig {
  readonly name: string;
  readonly digest: string;
  readonly runtimeVersion: string;
}

interface OllamaAdapterBaseOptions {
  readonly id: string;
  readonly client: OllamaClient;
  readonly model: OllamaModelConfig;
  readonly options?: Readonly<Record<string, JsonValue>>;
  readonly runtime?: ExtractorRuntime;
}

export interface OllamaFactAdapterOptions extends OllamaAdapterBaseOptions {
  readonly prompt?: string;
}

export interface OllamaEmbeddingAdapterOptions extends OllamaAdapterBaseOptions {
  readonly dimensions?: number;
  readonly truncate?: boolean;
}

interface NormalizedModelConfig {
  readonly name: string;
  readonly digest: string;
  readonly runtimeVersion: string;
}

const JSON_VALUE_SCHEMA_REFERENCE = "#/$defs/jsonValue";
const OLLAMA_GRAMMAR_RUNTIME_ONLY_KEYWORDS = new Set([
  "maxItems",
  "maxLength",
  "minItems",
  "minLength",
  "pattern",
]);
const JSON_VALUE_OUTPUT_SCHEMA = {
  anyOf: [
    { type: "null" },
    { type: "boolean" },
    { type: "number" },
    { type: "string" },
    { type: "array", items: { $ref: JSON_VALUE_SCHEMA_REFERENCE } },
    { type: "object", additionalProperties: { $ref: JSON_VALUE_SCHEMA_REFERENCE } },
  ],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function replaceUnconstrainedJsonSchemas(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceUnconstrainedJsonSchemas(item));
  if (!isRecord(value)) return value;
  const entries = Object.entries(value);
  if (entries.length === 0) return { $ref: JSON_VALUE_SCHEMA_REFERENCE };
  return Object.fromEntries(
    entries
      .filter(([key]) => !OLLAMA_GRAMMAR_RUNTIME_ONLY_KEYWORDS.has(key))
      .map(([key, item]) => [key, replaceUnconstrainedJsonSchemas(item)]),
  );
}

function createFactOutputJsonSchema(): Readonly<Record<string, unknown>> {
  const generated = FactObservationListSchema.toJSONSchema({ target: "draft-07" });
  const facts = structuredClone(generated);
  delete facts.$schema;
  return Object.freeze({
    $defs: { jsonValue: JSON_VALUE_OUTPUT_SCHEMA },
    type: "object",
    properties: { facts: replaceUnconstrainedJsonSchemas(facts) },
    required: ["facts"],
    additionalProperties: false,
  });
}

const FACT_OUTPUT_JSON_SCHEMA = createFactOutputJsonSchema();
const FACT_OUTPUT_JSON_SCHEMA_HASH = sha256CanonicalJson(FACT_OUTPUT_JSON_SCHEMA);

function normalizeNormativeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/gu, "");
}

function invalidOutput(
  message: string,
  details: Readonly<Record<string, string | number | null>> = {},
): never {
  throw new ExtractorValidationError("INVALID_EXTRACTION_OUTPUT", message, details);
}

function assertNoNormativeOutput(value: unknown): void {
  const stack: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 0 }];
  let visited = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    visited += 1;
    if (visited > MAX_MODEL_OUTPUT_NODES || current.depth > MAX_MODEL_OUTPUT_DEPTH) {
      invalidOutput("Ollama output exceeds structural limits");
    }

    if (Array.isArray(current.value)) {
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    if (!isRecord(current.value)) continue;

    for (const [key, nested] of Object.entries(current.value)) {
      if (FORBIDDEN_NORMATIVE_KEYS.has(normalizeNormativeKey(key))) {
        throw new ExtractorValidationError(
          "NORMATIVE_OUTPUT_FORBIDDEN",
          "An extractor cannot return a normative outcome or decision",
          { field: key },
        );
      }
      if (
        key === "key" &&
        typeof nested === "string" &&
        FORBIDDEN_NORMATIVE_KEYS.has(normalizeNormativeKey(nested))
      ) {
        throw new ExtractorValidationError(
          "NORMATIVE_OUTPUT_FORBIDDEN",
          "An extractor cannot disguise a normative outcome as a fact",
          { field: nested },
        );
      }
      stack.push({ value: nested, depth: current.depth + 1 });
    }
  }
}

function parseObservationOutput(content: string): readonly FactObservation[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(content) as unknown;
  } catch (cause) {
    throw new ExtractorValidationError(
      "INVALID_EXTRACTION_OUTPUT",
      "Ollama fact extraction output is not valid JSON",
      { cause: cause instanceof Error ? cause.name : "unknown" },
    );
  }

  assertNoNormativeOutput(decoded);
  if (
    !isRecord(decoded) ||
    Object.keys(decoded).length !== 1 ||
    !Array.isArray(decoded["facts"]) ||
    decoded["facts"].length > 10_000
  ) {
    invalidOutput("Ollama fact extraction output must be a strict facts envelope");
  }

  const decodedFacts = decoded["facts"] as readonly unknown[];
  const parsed = FactObservationListSchema.safeParse(decodedFacts);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const firstFact = decodedFacts[0];
    const firstFactShape = isRecord(firstFact)
      ? JSON.stringify({
          status: firstFact["status"],
          valueType: firstFact["valueType"],
          originalIsNull: firstFact["originalValue"] === null,
          normalizedType:
            firstFact["normalizedValue"] === null ? "null" : typeof firstFact["normalizedValue"],
          evidenceCount: Array.isArray(firstFact["evidence"]) ? firstFact["evidence"].length : null,
          candidateCount: Array.isArray(firstFact["candidates"])
            ? firstFact["candidates"].length
            : null,
        })
      : "unavailable";
    invalidOutput("Ollama returned invalid fact observations", {
      issueCount: parsed.error.issues.length,
      firstFactShape,
      ...(firstIssue === undefined
        ? {}
        : { firstIssue: `${firstIssue.path.join(".")}: ${firstIssue.message}` }),
    });
  }
  return parsed.data;
}

function normalizeModel(model: OllamaModelConfig): NormalizedModelConfig {
  const name = model.name.trim();
  const runtimeVersion = model.runtimeVersion.trim();
  if (
    name.length === 0 ||
    name.length > 200 ||
    !SHA256_PATTERN.test(model.digest) ||
    runtimeVersion.length === 0 ||
    runtimeVersion.length > 100
  ) {
    throw new OllamaClientError(
      "INVALID_CONFIGURATION",
      "Ollama model metadata must contain a name, lowercase digest and runtime version",
    );
  }
  return { name, digest: model.digest, runtimeVersion };
}

function normalizeAdapterId(id: string): string {
  const normalized = id.trim();
  if (normalized.length > 200 || !STABLE_KEY_PATTERN.test(normalized)) {
    throw new OllamaClientError("INVALID_CONFIGURATION", "Ollama adapter id must be a stable key");
  }
  return normalized;
}

function normalizePrompt(prompt: string): string {
  const normalized = `${prompt.trim()}\n\n${FACT_OUTPUT_PROTOCOL}`;
  if (normalized.length === 0 || normalized.length > 100_000) {
    throw new OllamaClientError(
      "INVALID_CONFIGURATION",
      "Ollama prompt must contain between 1 and 100000 characters",
    );
  }
  return normalized;
}

function cloneOptions(
  options: Readonly<Record<string, JsonValue>> | undefined,
  defaults: Readonly<Record<string, JsonValue>> = {},
): Readonly<Record<string, JsonValue>> {
  if (options !== undefined && !isRecord(options)) {
    throw new OllamaClientError("INVALID_CONFIGURATION", "Ollama options must be a JSON object");
  }
  const merged = { ...defaults, ...(options ?? {}) };
  const parsed = JsonValueSchema.safeParse(merged);
  if (!parsed.success || !isRecord(parsed.data)) {
    throw new OllamaClientError(
      "INVALID_CONFIGURATION",
      "Ollama options must be bounded, canonical JSON with finite numbers",
      { details: { issueCount: parsed.success ? 1 : parsed.error.issues.length } },
    );
  }
  return structuredClone(parsed.data);
}

function assertReturnedModel(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new ExtractorValidationError(
      "INVALID_EXTRACTION_OUTPUT",
      "Ollama response model does not match the pinned model",
      { actualModel: actual, expectedModel: expected },
    );
  }
}

function buildUserMessage(input: OllamaDocumentInput): {
  readonly content: string;
  readonly images?: readonly string[];
} {
  const provenance = `Document hash: ${input.documentHash}; page: ${String(input.page)}; language: ${input.language}.`;
  if (input.kind === "OLLAMA_LLM") {
    return { content: `${provenance}\n\nSource text:\n${input.text}` };
  }
  return {
    content: `${provenance}\n\nAnalyze the attached ${input.mediaType} image.`,
    images: [input.imageBase64],
  };
}

function defaultPrompt(kind: OllamaFactKind): string {
  switch (kind) {
    case "OLLAMA_OCR":
      return DEFAULT_OCR_PROMPT;
    case "OLLAMA_VISION":
      return DEFAULT_VISION_PROMPT;
    case "OLLAMA_LLM":
      return DEFAULT_LLM_PROMPT;
  }
}

abstract class OllamaFactAdapter<TKind extends OllamaFactKind> implements ExtractorAdapter {
  public readonly id: string;
  public readonly kind: TKind;

  readonly #client: OllamaClient;
  readonly #model: NormalizedModelConfig;
  readonly #options: Readonly<Record<string, JsonValue>>;
  readonly #prompt: string;
  readonly #runtime: ExtractorRuntime;

  protected constructor(kind: TKind, options: OllamaFactAdapterOptions) {
    this.id = normalizeAdapterId(options.id);
    this.kind = kind;
    this.#client = options.client;
    this.#model = normalizeModel(options.model);
    this.#options = cloneOptions(options.options, { temperature: 0 });
    this.#prompt = normalizePrompt(options.prompt ?? defaultPrompt(kind));
    this.#runtime = options.runtime ?? defaultExtractorRuntime;
  }

  public supports(kind: ExtractorKind): boolean {
    return kind === this.kind;
  }

  public async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const validRequest = parseExtractionRequest(request);
    requireInputKind(validRequest, this.kind);
    requireAdapterIdentity(validRequest, this.id);
    const input = validRequest.input;

    const runId = this.#runtime.createId();
    const startedAt = parseRuntimeTimestamp(this.#runtime.now());
    const verifiedModel = await this.#client.verifyModel(this.#model);
    const userMessage = buildUserMessage(input);
    const response = await this.#client.chat({
      model: verifiedModel.name,
      messages: [
        { role: "system", content: this.#prompt },
        { role: "user", ...userMessage },
      ],
      format: FACT_OUTPUT_JSON_SCHEMA,
      options: this.#options,
      think: false,
    });
    assertReturnedModel(response.value.model, verifiedModel.name);
    const observations = parseObservationOutput(response.value.content);
    const runContext = {
      id: runId,
      adapterId: this.id,
      kind: this.kind,
      startedAt,
      completedAt: startedAt,
      model: {
        name: verifiedModel.name,
        digest: verifiedModel.digest,
        runtime: "OLLAMA" as const,
        runtimeVersion: verifiedModel.runtimeVersion,
      },
      prompt: this.#prompt,
      options: {
        ...this.#options,
        format: "json-schema",
        formatSchemaHash: FACT_OUTPUT_JSON_SCHEMA_HASH,
        think: false,
        transportAttempts: response.attempts,
      },
      rawOutput: response.rawOutput,
      validationScope: validRequest.validationScope,
    };
    const materialized = materializeFactObservations(
      observations,
      validRequest,
      runContext,
      this.#runtime,
    );
    const completedAt = parseRuntimeTimestamp(this.#runtime.now());
    const run = { ...runContext, completedAt };

    return parseExtractionResult({
      requestId: validRequest.id,
      run,
      facts: materialized.facts,
      evidence: materialized.evidence,
      embeddings: [],
      validationScope: validRequest.validationScope,
    });
  }
}

export class OllamaOcrAdapter extends OllamaFactAdapter<"OLLAMA_OCR"> {
  public constructor(options: OllamaFactAdapterOptions) {
    super("OLLAMA_OCR", options);
  }
}

export class OllamaVisionAdapter extends OllamaFactAdapter<"OLLAMA_VISION"> {
  public constructor(options: OllamaFactAdapterOptions) {
    super("OLLAMA_VISION", options);
  }
}

export class OllamaLlmAdapter extends OllamaFactAdapter<"OLLAMA_LLM"> {
  public constructor(options: OllamaFactAdapterOptions) {
    super("OLLAMA_LLM", options);
  }
}

export class OllamaEmbeddingAdapter implements ExtractorAdapter {
  public readonly id: string;
  public readonly kind = "OLLAMA_EMBEDDING" as const;

  readonly #client: OllamaClient;
  readonly #dimensions: number | undefined;
  readonly #model: NormalizedModelConfig;
  readonly #options: Readonly<Record<string, JsonValue>>;
  readonly #runtime: ExtractorRuntime;
  readonly #truncate: boolean | undefined;

  public constructor(options: OllamaEmbeddingAdapterOptions) {
    this.id = normalizeAdapterId(options.id);
    this.#client = options.client;
    this.#model = normalizeModel(options.model);
    this.#options = cloneOptions(options.options);
    this.#runtime = options.runtime ?? defaultExtractorRuntime;
    if (
      options.dimensions !== undefined &&
      (!Number.isSafeInteger(options.dimensions) ||
        options.dimensions < 1 ||
        options.dimensions > 16_384)
    ) {
      throw new OllamaClientError(
        "INVALID_CONFIGURATION",
        "Embedding dimensions must be an integer between 1 and 16384",
      );
    }
    this.#dimensions = options.dimensions;
    this.#truncate = options.truncate;
  }

  public supports(kind: ExtractorKind): boolean {
    return kind === this.kind;
  }

  public async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const validRequest = parseExtractionRequest(request);
    requireInputKind(validRequest, this.kind);
    requireAdapterIdentity(validRequest, this.id);
    const input = validRequest.input;

    const runId = this.#runtime.createId();
    const startedAt = parseRuntimeTimestamp(this.#runtime.now());
    const verifiedModel = await this.#client.verifyModel(this.#model);
    const embedRequest = {
      model: verifiedModel.name,
      input: input.entries.map(({ text }) => text),
      options: this.#options,
      ...(this.#dimensions === undefined ? {} : { dimensions: this.#dimensions }),
      ...(this.#truncate === undefined ? {} : { truncate: this.#truncate }),
    };
    const response = await this.#client.embed(embedRequest);
    assertReturnedModel(response.value.model, verifiedModel.name);
    if (response.value.embeddings.length !== input.entries.length) {
      invalidOutput("Ollama embedding count does not match the requested inputs", {
        actualCount: response.value.embeddings.length,
        expectedCount: input.entries.length,
      });
    }

    const embeddings = input.entries.map((entry, index) => {
      const vector = response.value.embeddings[index];
      if (
        vector === undefined ||
        (this.#dimensions !== undefined && vector.length !== this.#dimensions)
      ) {
        invalidOutput("Ollama embedding dimensions do not match the request", {
          embeddingIndex: index,
        });
      }
      return {
        id: this.#runtime.createId(),
        key: entry.key,
        inputHash: sha256Bytes(new TextEncoder().encode(entry.text)),
        vector,
        dimensions: vector.length,
        providerRunId: runId,
        validationScope: validRequest.validationScope,
      };
    });

    const transportOptions: Record<string, JsonValue> = {
      ...this.#options,
      transportAttempts: response.attempts,
    };
    if (this.#dimensions !== undefined) transportOptions["dimensions"] = this.#dimensions;
    if (this.#truncate !== undefined) transportOptions["truncate"] = this.#truncate;
    const completedAt = parseRuntimeTimestamp(this.#runtime.now());

    return parseExtractionResult({
      requestId: validRequest.id,
      run: {
        id: runId,
        adapterId: this.id,
        kind: this.kind,
        startedAt,
        completedAt,
        model: {
          name: verifiedModel.name,
          digest: verifiedModel.digest,
          runtime: "OLLAMA",
          runtimeVersion: verifiedModel.runtimeVersion,
        },
        prompt: null,
        options: transportOptions,
        rawOutput: response.rawOutput,
        validationScope: validRequest.validationScope,
      },
      facts: [],
      evidence: [],
      embeddings,
      validationScope: validRequest.validationScope,
    });
  }
}
