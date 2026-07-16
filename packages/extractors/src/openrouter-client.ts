import { JsonValueSchema, sha256CanonicalJson } from "@vera/contracts";

const OPENROUTER_BASE_URL = new URL("https://openrouter.ai/api/v1/");
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 50;
const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;
const MAX_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 5_000;
const MAX_MESSAGE_CHARACTERS = 2_010_000;
const CHAT_REQUEST_KEYS = new Set([
  "maxTokens",
  "messages",
  "responseFormat",
  "seed",
  "temperature",
]);
const CHAT_MESSAGE_KEYS = new Set(["content", "role"]);

export const OPENROUTER_API_VERSION = "v1" as const;
export const OPENROUTER_CHAT_MODEL = "meta-llama/llama-3.1-8b-instruct" as const;
export const OPENROUTER_PROVIDER_POLICY = Object.freeze({
  allow_fallbacks: true,
  data_collection: "deny" as const,
  require_parameters: true,
  zdr: true,
});
export const OPENROUTER_ROUTING_CONFIG_HASH = sha256CanonicalJson({
  apiVersion: OPENROUTER_API_VERSION,
  baseOrigin: OPENROUTER_BASE_URL.origin,
  model: OPENROUTER_CHAT_MODEL,
  provider: OPENROUTER_PROVIDER_POLICY,
});

export type OpenRouterClientErrorCode =
  | "HTTP_ERROR"
  | "INVALID_CONFIGURATION"
  | "INVALID_REQUEST"
  | "INVALID_RESPONSE"
  | "MODEL_MISMATCH"
  | "RESPONSE_TOO_LARGE"
  | "TIMEOUT"
  | "UNAVAILABLE";

export class OpenRouterClientError extends Error {
  public readonly code: OpenRouterClientErrorCode;
  public readonly details: Readonly<Record<string, unknown>>;
  public readonly retryable: boolean;
  public readonly retryAfterMs: number | null;

  public constructor(
    code: OpenRouterClientErrorCode,
    message: string,
    options: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly retryable?: boolean;
      readonly retryAfterMs?: number | null;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "OpenRouterClientError";
    this.code = code;
    this.details = Object.freeze({ ...(options.details ?? {}) });
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export interface OpenRouterModelIdentity {
  readonly name: typeof OPENROUTER_CHAT_MODEL;
  readonly runtime: "OPENROUTER";
  readonly apiVersion: typeof OPENROUTER_API_VERSION;
  readonly routingConfigHash: string;
}

export interface OpenRouterChatMessage {
  readonly role: "assistant" | "system" | "user";
  readonly content: string;
}

export type OpenRouterResponseFormat =
  | { readonly type: "json_object" }
  | {
      readonly type: "json_schema";
      readonly json_schema: {
        readonly name: string;
        readonly strict: true;
        readonly schema: Readonly<Record<string, unknown>>;
      };
    };

export interface OpenRouterChatRequest {
  readonly messages: readonly OpenRouterChatMessage[];
  readonly responseFormat: OpenRouterResponseFormat;
  readonly temperature: number;
  readonly seed?: number;
  readonly maxTokens?: number;
}

export interface OpenRouterUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly cost: number | null;
}

export interface OpenRouterChatResponse {
  readonly model: string;
  readonly content: string;
  readonly generationId: string;
  readonly provider: string | null;
  readonly systemFingerprint: string | null;
  readonly finishReason: string;
  readonly nativeFinishReason: string | null;
  readonly usage: OpenRouterUsage | null;
}

export interface OpenRouterTransportResult<T> {
  readonly value: T;
  readonly rawOutput: string;
  readonly attempts: number;
}

export interface OpenRouterClientOptions {
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly maxResponseBytes?: number;
  readonly fetch?: typeof fetch;
}

interface NormalizedOptions {
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly maxResponseBytes: number;
  readonly fetch: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasOnlyKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

function normalizeInteger(
  value: number | undefined,
  fallback: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw new OpenRouterClientError(
      "INVALID_CONFIGURATION",
      `${field} must be an integer between ${String(minimum)} and ${String(maximum)}`,
    );
  }
  return normalized;
}

function normalizeOptions(options: OpenRouterClientOptions): NormalizedOptions {
  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  if (apiKey.length < 16 || apiKey.length > 512 || /\s/u.test(apiKey)) {
    throw new OpenRouterClientError(
      "INVALID_CONFIGURATION",
      "OpenRouter apiKey must be configured as a non-empty bearer token",
    );
  }
  if (options.fetch !== undefined && typeof options.fetch !== "function") {
    throw new OpenRouterClientError(
      "INVALID_CONFIGURATION",
      "OpenRouter fetch transport must be a function",
    );
  }
  return {
    apiKey,
    timeoutMs: normalizeInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs", 1, 300_000),
    maxRetries: normalizeInteger(
      options.maxRetries,
      DEFAULT_MAX_RETRIES,
      "maxRetries",
      0,
      MAX_RETRIES,
    ),
    retryDelayMs: normalizeInteger(
      options.retryDelayMs,
      DEFAULT_RETRY_DELAY_MS,
      "retryDelayMs",
      0,
      MAX_RETRY_AFTER_MS,
    ),
    maxResponseBytes: normalizeInteger(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      "maxResponseBytes",
      1,
      DEFAULT_MAX_RESPONSE_BYTES,
    ),
    fetch: options.fetch ?? globalThis.fetch,
  };
}

function assertResponseFormat(value: unknown): asserts value is OpenRouterResponseFormat {
  if (!isRecord(value)) {
    throw new OpenRouterClientError(
      "INVALID_REQUEST",
      "OpenRouter responseFormat must be a strict JSON object",
    );
  }
  if (value["type"] === "json_object" && Object.keys(value).length === 1) return;
  const jsonSchema = value["json_schema"];
  if (
    value["type"] !== "json_schema" ||
    Object.keys(value).length !== 2 ||
    !isRecord(jsonSchema) ||
    Object.keys(jsonSchema).some((key) => !new Set(["name", "schema", "strict"]).has(key)) ||
    !isNonEmptyString(jsonSchema["name"]) ||
    jsonSchema["name"].length > 64 ||
    !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(jsonSchema["name"]) ||
    jsonSchema["strict"] !== true ||
    !isRecord(jsonSchema["schema"])
  ) {
    throw new OpenRouterClientError(
      "INVALID_REQUEST",
      "OpenRouter responseFormat must contain a valid strict JSON Schema",
    );
  }
}

function assertChatRequest(request: OpenRouterChatRequest): void {
  if (!isRecord(request) || !hasOnlyKeys(request, CHAT_REQUEST_KEYS)) {
    throw new OpenRouterClientError(
      "INVALID_REQUEST",
      "OpenRouter chat request must be a strict JSON object",
    );
  }
  if (
    !Array.isArray(request.messages) ||
    request.messages.length === 0 ||
    request.messages.length > 100
  ) {
    throw new OpenRouterClientError(
      "INVALID_REQUEST",
      "OpenRouter messages must contain between 1 and 100 entries",
    );
  }
  for (const message of request.messages) {
    if (
      !isRecord(message) ||
      !hasOnlyKeys(message, CHAT_MESSAGE_KEYS) ||
      !["assistant", "system", "user"].includes(String(message["role"])) ||
      !isNonEmptyString(message["content"]) ||
      message["content"].length > MAX_MESSAGE_CHARACTERS
    ) {
      throw new OpenRouterClientError(
        "INVALID_REQUEST",
        "OpenRouter messages must contain a valid role and bounded text content",
      );
    }
  }
  assertResponseFormat(request.responseFormat);
  if (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2) {
    throw new OpenRouterClientError(
      "INVALID_REQUEST",
      "OpenRouter temperature must be a finite number between 0 and 2",
    );
  }
  if (request.seed !== undefined && !Number.isSafeInteger(request.seed)) {
    throw new OpenRouterClientError("INVALID_REQUEST", "OpenRouter seed must be a safe integer");
  }
  if (
    request.maxTokens !== undefined &&
    (!Number.isSafeInteger(request.maxTokens) ||
      request.maxTokens < 1 ||
      request.maxTokens > 131_072)
  ) {
    throw new OpenRouterClientError(
      "INVALID_REQUEST",
      "OpenRouter maxTokens must be an integer between 1 and 131072",
    );
  }
  const parsed = JsonValueSchema.safeParse(request);
  if (!parsed.success) {
    throw new OpenRouterClientError(
      "INVALID_REQUEST",
      "OpenRouter chat request must be bounded canonical JSON",
      { details: { issueCount: parsed.error.issues.length } },
    );
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function apiErrorStatus(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const code = value["code"];
  if (typeof code === "number" && Number.isSafeInteger(code) && code >= 100 && code <= 599) {
    return code;
  }
  if (typeof code === "string" && /^\d{3}$/u.test(code)) return Number(code);
  return null;
}

function openRouterApiError(value: unknown): OpenRouterClientError {
  const status = apiErrorStatus(value);
  return new OpenRouterClientError(
    "HTTP_ERROR",
    "OpenRouter returned an API error instead of a completed response",
    {
      ...(status === null ? {} : { details: { status } }),
      retryable: status !== null && isRetryableStatus(status),
    },
  );
}

function selectedProvider(value: Readonly<Record<string, unknown>>): string | null {
  const metadata = value["openrouter_metadata"];
  if (isRecord(metadata)) {
    const endpoints = metadata["endpoints"];
    const available = isRecord(endpoints) ? endpoints["available"] : undefined;
    if (Array.isArray(available)) {
      for (const candidate of available as readonly unknown[]) {
        if (
          isRecord(candidate) &&
          candidate["selected"] === true &&
          isNonEmptyString(candidate["provider"])
        ) {
          return candidate["provider"];
        }
      }
    }
  }
  return isNonEmptyString(value["provider"]) ? value["provider"] : null;
}

function parseUsage(value: unknown): OpenRouterUsage | null {
  if (value === undefined || value === null) return null;
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value["prompt_tokens"]) ||
    !isNonNegativeInteger(value["completion_tokens"]) ||
    !isNonNegativeInteger(value["total_tokens"]) ||
    value["total_tokens"] !== value["prompt_tokens"] + value["completion_tokens"] ||
    (value["cost"] !== undefined && value["cost"] !== null && !isNonNegativeNumber(value["cost"]))
  ) {
    throw new OpenRouterClientError(
      "INVALID_RESPONSE",
      "OpenRouter chat response contains invalid usage metadata",
    );
  }
  return {
    promptTokens: value["prompt_tokens"],
    completionTokens: value["completion_tokens"],
    totalTokens: value["total_tokens"],
    cost: value["cost"] ?? null,
  };
}

function parseChatResponse(value: unknown): OpenRouterChatResponse {
  if (!isRecord(value)) {
    throw new OpenRouterClientError(
      "INVALID_RESPONSE",
      "OpenRouter chat response must be a JSON object",
    );
  }
  if (value["error"] !== undefined) {
    throw openRouterApiError(value["error"]);
  }
  const choices = value["choices"];
  const choice: unknown = Array.isArray(choices) ? (choices as readonly unknown[])[0] : undefined;
  const message = isRecord(choice) ? choice["message"] : undefined;
  if (isRecord(choice) && choice["error"] !== undefined) {
    throw openRouterApiError(choice["error"]);
  }
  if (
    !isNonEmptyString(value["id"]) ||
    value["object"] !== "chat.completion" ||
    !isNonNegativeInteger(value["created"]) ||
    !isNonEmptyString(value["model"]) ||
    !Array.isArray(choices) ||
    choices.length !== 1 ||
    !isRecord(choice) ||
    choice["index"] !== 0 ||
    !isNonEmptyString(choice["finish_reason"]) ||
    (choice["native_finish_reason"] !== undefined &&
      choice["native_finish_reason"] !== null &&
      typeof choice["native_finish_reason"] !== "string") ||
    !isRecord(message) ||
    message["role"] !== "assistant" ||
    typeof message["content"] !== "string" ||
    (value["provider"] !== undefined &&
      value["provider"] !== null &&
      !isNonEmptyString(value["provider"])) ||
    (value["system_fingerprint"] !== undefined &&
      value["system_fingerprint"] !== null &&
      !isNonEmptyString(value["system_fingerprint"]))
  ) {
    throw new OpenRouterClientError(
      "INVALID_RESPONSE",
      "OpenRouter returned an invalid non-streaming chat response",
    );
  }
  if (value["model"] !== OPENROUTER_CHAT_MODEL) {
    throw new OpenRouterClientError(
      "MODEL_MISMATCH",
      "OpenRouter response model does not match the pinned model",
      {
        details: {
          actualModel: value["model"],
          expectedModel: OPENROUTER_CHAT_MODEL,
        },
      },
    );
  }
  if (choice["finish_reason"] !== "stop") {
    throw new OpenRouterClientError(
      "INVALID_RESPONSE",
      "OpenRouter chat completion did not finish with stop",
      { details: { finishReason: choice["finish_reason"] } },
    );
  }
  return {
    model: value["model"],
    content: message["content"],
    generationId: value["id"],
    provider: selectedProvider(value),
    systemFingerprint: value["system_fingerprint"] ?? null,
    finishReason: choice["finish_reason"],
    nativeFinishReason: choice["native_finish_reason"] ?? null,
    usage: parseUsage(value["usage"]),
  };
}

async function readResponseBody(response: Response, maxResponseBytes: number): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new OpenRouterClientError(
          "RESPONSE_TOO_LARGE",
          "OpenRouter response exceeds size limit",
          { details: { maxResponseBytes } },
        );
      }
      chunks.push(Buffer.from(chunk.value));
      chunk = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

function retryAfterMilliseconds(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1000), MAX_RETRY_AFTER_MS);
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_AFTER_MS);
}

function delay(milliseconds: number): Promise<void> {
  if (milliseconds === 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export class OpenRouterClient {
  public readonly model: OpenRouterModelIdentity = Object.freeze({
    name: OPENROUTER_CHAT_MODEL,
    runtime: "OPENROUTER",
    apiVersion: OPENROUTER_API_VERSION,
    routingConfigHash: OPENROUTER_ROUTING_CONFIG_HASH,
  });

  readonly #options: NormalizedOptions;

  public constructor(options: OpenRouterClientOptions) {
    this.#options = normalizeOptions(options);
  }

  public async chat(
    request: OpenRouterChatRequest,
  ): Promise<OpenRouterTransportResult<OpenRouterChatResponse>> {
    assertChatRequest(request);
    const body = JSON.stringify({
      model: OPENROUTER_CHAT_MODEL,
      messages: request.messages,
      stream: false,
      temperature: request.temperature,
      response_format: request.responseFormat,
      provider: OPENROUTER_PROVIDER_POLICY,
      ...(request.seed === undefined ? {} : { seed: request.seed }),
      ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
    });
    return this.#request(body);
  }

  async #request(body: string): Promise<OpenRouterTransportResult<OpenRouterChatResponse>> {
    const endpoint = new URL("chat/completions", OPENROUTER_BASE_URL);
    let attempt = 0;
    while (attempt <= this.#options.maxRetries) {
      attempt += 1;
      try {
        const result = await this.#requestOnce(endpoint, body);
        return { ...result, attempts: attempt };
      } catch (error) {
        const normalized =
          error instanceof OpenRouterClientError
            ? error
            : new OpenRouterClientError("UNAVAILABLE", "OpenRouter request failed", {
                cause: error,
                retryable: true,
              });
        if (!normalized.retryable || attempt > this.#options.maxRetries) throw normalized;
        await delay(normalized.retryAfterMs ?? this.#options.retryDelayMs);
      }
    }
    throw new OpenRouterClientError("UNAVAILABLE", "OpenRouter retry budget was exhausted");
  }

  async #requestOnce(
    endpoint: URL,
    body: string,
  ): Promise<Omit<OpenRouterTransportResult<OpenRouterChatResponse>, "attempts">> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.#options.timeoutMs);
    try {
      const response = await this.#options.fetch(endpoint, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.#options.apiKey}`,
          "Content-Type": "application/json",
          "X-OpenRouter-Metadata": "enabled",
        },
        body,
      });
      const rawOutput = await readResponseBody(response, this.#options.maxResponseBytes);
      if (!response.ok) {
        throw new OpenRouterClientError(
          "HTTP_ERROR",
          `OpenRouter request failed with HTTP ${String(response.status)}`,
          {
            details: { status: response.status },
            retryable: isRetryableStatus(response.status),
            retryAfterMs: retryAfterMilliseconds(response.headers.get("retry-after")),
          },
        );
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(rawOutput) as unknown;
      } catch (cause) {
        throw new OpenRouterClientError(
          "INVALID_RESPONSE",
          "OpenRouter response is not valid JSON",
          { cause },
        );
      }
      return { value: parseChatResponse(decoded), rawOutput };
    } catch (error) {
      if (error instanceof OpenRouterClientError) throw error;
      if (controller.signal.aborted || isAbortError(error)) {
        throw new OpenRouterClientError(
          "TIMEOUT",
          `OpenRouter request timed out after ${String(this.#options.timeoutMs)} ms`,
          { cause: error, retryable: true },
        );
      }
      throw new OpenRouterClientError("UNAVAILABLE", "OpenRouter endpoint is unavailable", {
        cause: error,
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
