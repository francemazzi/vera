import type {
  ExtractionRequest,
  ExtractionResult,
  ExtractorKind,
  ExtractorRun,
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
import {
  DEFAULT_MODEL_LLM_PROMPT,
  MODEL_FACT_OUTPUT_JSON_SCHEMA,
  MODEL_FACT_OUTPUT_JSON_SCHEMA_HASH,
  MODEL_FACT_OUTPUT_PROTOCOL,
  parseModelFactObservationOutput,
} from "./ollama-adapters.js";
import { OpenRouterClientError } from "./openrouter-client.js";
import type { OpenRouterClient } from "./openrouter-client.js";

const STABLE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/u;

export interface OpenRouterLlmAdapterOptions {
  readonly id: string;
  readonly client: OpenRouterClient;
  readonly prompt?: string;
  readonly seed?: number;
  readonly maxTokens?: number;
  readonly runtime?: ExtractorRuntime;
}

function normalizeAdapterId(value: string): string {
  const id = value.trim();
  if (id.length > 120 || !STABLE_KEY_PATTERN.test(id)) {
    throw new OpenRouterClientError(
      "INVALID_CONFIGURATION",
      "OpenRouter adapter id must be a stable key",
    );
  }
  return id;
}

function normalizePrompt(value: string): string {
  const prompt = `${value.trim()}\n\n${MODEL_FACT_OUTPUT_PROTOCOL}`;
  if (prompt.length === 0 || prompt.length > 100_000) {
    throw new OpenRouterClientError(
      "INVALID_CONFIGURATION",
      "OpenRouter prompt must contain between 1 and 100000 characters",
    );
  }
  return prompt;
}

function normalizeOptionalInteger(
  value: number | undefined,
  field: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new OpenRouterClientError(
      "INVALID_CONFIGURATION",
      `${field} must be an integer between ${String(minimum)} and ${String(maximum)}`,
    );
  }
  return value;
}

export class OpenRouterLlmAdapter implements ExtractorAdapter {
  public readonly id: string;
  public readonly kind = "OPENROUTER_LLM" as const;

  readonly #client: OpenRouterClient;
  readonly #prompt: string;
  readonly #seed: number | undefined;
  readonly #maxTokens: number | undefined;
  readonly #runtime: ExtractorRuntime;

  public constructor(options: OpenRouterLlmAdapterOptions) {
    this.id = normalizeAdapterId(options.id);
    this.#client = options.client;
    this.#prompt = normalizePrompt(options.prompt ?? DEFAULT_MODEL_LLM_PROMPT);
    this.#seed = normalizeOptionalInteger(
      options.seed,
      "OpenRouter seed",
      Number.MIN_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    );
    this.#maxTokens = normalizeOptionalInteger(
      options.maxTokens,
      "OpenRouter maxTokens",
      1,
      131_072,
    );
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
    const provenance = `Document hash: ${input.documentHash}; page: ${String(input.page)}; language: ${input.language}.`;
    const response = await this.#client.chat({
      messages: [
        { role: "system", content: this.#prompt },
        { role: "user", content: `${provenance}\n\nSource text:\n${input.text}` },
      ],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "vera_fact_observations",
          strict: true,
          schema: MODEL_FACT_OUTPUT_JSON_SCHEMA,
        },
      },
      temperature: 0,
      ...(this.#seed === undefined ? {} : { seed: this.#seed }),
      ...(this.#maxTokens === undefined ? {} : { maxTokens: this.#maxTokens }),
    });
    if (response.value.finishReason !== "stop") {
      throw new ExtractorValidationError(
        "INVALID_EXTRACTION_OUTPUT",
        "OpenRouter fact extraction did not complete normally",
        { finishReason: response.value.finishReason },
      );
    }
    const observations = parseModelFactObservationOutput(response.value.content, "OpenRouter");
    const transportOptions: Record<string, JsonValue> = {
      temperature: 0,
      format: "json-schema",
      formatSchemaHash: MODEL_FACT_OUTPUT_JSON_SCHEMA_HASH,
      routingConfigHash: this.#client.model.routingConfigHash,
      transportAttempts: response.attempts,
      generationId: response.value.generationId,
      upstreamProvider: response.value.provider,
      systemFingerprint: response.value.systemFingerprint,
      nativeFinishReason: response.value.nativeFinishReason,
      usage:
        response.value.usage === null
          ? null
          : {
              promptTokens: response.value.usage.promptTokens,
              completionTokens: response.value.usage.completionTokens,
              totalTokens: response.value.usage.totalTokens,
              cost: response.value.usage.cost,
            },
      dataCollection: "deny",
      zeroDataRetention: true,
      sameModelProviderFallbacks: true,
    };
    if (this.#seed !== undefined) transportOptions["seed"] = this.#seed;
    if (this.#maxTokens !== undefined) transportOptions["maxTokens"] = this.#maxTokens;

    const runContext: ExtractorRun = {
      id: runId,
      adapterId: this.id,
      kind: this.kind,
      startedAt,
      completedAt: startedAt,
      model: this.#client.model,
      prompt: this.#prompt,
      options: transportOptions,
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

    return parseExtractionResult({
      requestId: validRequest.id,
      run: { ...runContext, completedAt },
      facts: materialized.facts,
      evidence: materialized.evidence,
      embeddings: [],
      validationScope: validRequest.validationScope,
    });
  }
}
