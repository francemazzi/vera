import { JsonValueSchema } from "@vera/contracts";

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 50;
const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;
const MAX_RETRIES = 3;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const CHAT_REQUEST_KEYS = new Set(["format", "messages", "model", "options", "think"]);
const CHAT_REQUEST_MESSAGE_KEYS = new Set(["content", "images", "role"]);
const EMBED_REQUEST_KEYS = new Set(["dimensions", "input", "model", "options", "truncate"]);

export type OllamaClientErrorCode =
  | "HTTP_ERROR"
  | "INVALID_CONFIGURATION"
  | "INVALID_REQUEST"
  | "INVALID_RESPONSE"
  | "MODEL_METADATA_MISMATCH"
  | "MODEL_NOT_AVAILABLE"
  | "RESPONSE_TOO_LARGE"
  | "RUNTIME_VERSION_MISMATCH"
  | "TIMEOUT"
  | "UNAVAILABLE";

export class OllamaClientError extends Error {
  public readonly code: OllamaClientErrorCode;
  public readonly details: Readonly<Record<string, unknown>>;
  public readonly retryable: boolean;

  public constructor(
    code: OllamaClientErrorCode,
    message: string,
    options: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly retryable?: boolean;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "OllamaClientError";
    this.code = code;
    this.details = Object.freeze({ ...(options.details ?? {}) });
    this.retryable = options.retryable ?? false;
  }
}

export interface OllamaChatMessage {
  readonly role: "assistant" | "system" | "user";
  readonly content: string;
  readonly images?: readonly string[];
}

export interface OllamaChatRequest {
  readonly model: string;
  readonly messages: readonly OllamaChatMessage[];
  readonly format?: "json" | Readonly<Record<string, unknown>>;
  readonly options?: Readonly<Record<string, unknown>>;
  readonly think?: boolean;
}

export interface OllamaEmbedRequest {
  readonly model: string;
  readonly input: string | readonly string[];
  readonly dimensions?: number;
  readonly options?: Readonly<Record<string, unknown>>;
  readonly truncate?: boolean;
}

export interface OllamaChatResponse {
  readonly model: string;
  readonly createdAt: string;
  readonly content: string;
  readonly thinking: string | null;
  readonly doneReason: string | null;
}

export interface OllamaEmbedResponse {
  readonly model: string;
  readonly embeddings: readonly (readonly number[])[];
}

export interface OllamaTransportResult<T> {
  readonly value: T;
  readonly rawOutput: string;
  readonly attempts: number;
}

export interface OllamaClientOptions {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly maxResponseBytes?: number;
}

export interface OllamaModelIdentity {
  readonly name: string;
  readonly digest: string;
  readonly runtimeVersion: string;
}

export type OllamaVerifiedModel = OllamaModelIdentity;

interface NormalizedOptions {
  readonly baseUrl: URL;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly maxResponseBytes: number;
}

interface RawChatResponse {
  readonly model: string;
  readonly created_at: string;
  readonly message: {
    readonly role: "assistant";
    readonly content: string;
    readonly thinking?: string;
  };
  readonly done: true;
  readonly done_reason?: string;
}

interface RawEmbedResponse {
  readonly model: string;
  readonly embeddings: readonly (readonly number[])[];
}

interface RawVersionResponse {
  readonly version: string;
}

interface RawModelTag {
  readonly name: string;
  readonly model: string;
  readonly digest: string;
}

interface RawTagsResponse {
  readonly models: readonly RawModelTag[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOnlyKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

function assertNonEmptyString(value: string, field: string): void {
  if (!isNonEmptyString(value)) {
    throw new OllamaClientError("INVALID_REQUEST", `${field} must be a non-empty string`);
  }
}

function assertJsonSerializable(value: unknown, field: string): void {
  const parsed = JsonValueSchema.safeParse(value);
  if (!parsed.success) {
    throw new OllamaClientError(
      "INVALID_REQUEST",
      `${field} must be bounded, canonical JSON with finite numbers`,
      { details: { issueCount: parsed.error.issues.length } },
    );
  }
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
    throw new OllamaClientError(
      "INVALID_CONFIGURATION",
      `${field} must be an integer between ${String(minimum)} and ${String(maximum)}`,
    );
  }
  return normalized;
}

function normalizeBaseUrl(value: string | undefined): URL {
  let url: URL;
  try {
    url = new URL(value ?? DEFAULT_BASE_URL);
  } catch (cause) {
    throw new OllamaClientError("INVALID_CONFIGURATION", "Ollama baseUrl must be a valid URL", {
      cause,
    });
  }

  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new OllamaClientError(
      "INVALID_CONFIGURATION",
      "Ollama baseUrl must be an unauthenticated loopback HTTP URL",
    );
  }

  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/`;
  return url;
}

function normalizeOptions(options: OllamaClientOptions): NormalizedOptions {
  return {
    baseUrl: normalizeBaseUrl(options.baseUrl),
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
      30_000,
    ),
    maxResponseBytes: normalizeInteger(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      "maxResponseBytes",
      1,
      DEFAULT_MAX_RESPONSE_BYTES,
    ),
  };
}

function assertChatRequest(request: OllamaChatRequest): void {
  if (!isRecord(request) || !hasOnlyKeys(request, CHAT_REQUEST_KEYS)) {
    throw new OllamaClientError("INVALID_REQUEST", "chat request must be a strict JSON object");
  }
  assertNonEmptyString(request.model, "model");
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new OllamaClientError("INVALID_REQUEST", "messages must contain at least one entry");
  }
  for (const message of request.messages) {
    if (
      !isRecord(message) ||
      !hasOnlyKeys(message, CHAT_REQUEST_MESSAGE_KEYS) ||
      !["assistant", "system", "user"].includes(String(message["role"])) ||
      !isNonEmptyString(message["content"]) ||
      (message["images"] !== undefined &&
        (!Array.isArray(message["images"]) ||
          message["images"].some((image) => !isNonEmptyString(image))))
    ) {
      throw new OllamaClientError(
        "INVALID_REQUEST",
        "chat messages must have a valid role, content and optional image array",
      );
    }
  }
  if (request.format !== undefined && request.format !== "json" && !isRecord(request.format)) {
    throw new OllamaClientError("INVALID_REQUEST", "format must be json or a JSON Schema object");
  }
  if (request.options !== undefined && !isRecord(request.options)) {
    throw new OllamaClientError("INVALID_REQUEST", "options must be a JSON object");
  }
  if (request.think !== undefined && typeof request.think !== "boolean") {
    throw new OllamaClientError("INVALID_REQUEST", "think must be boolean");
  }
  assertJsonSerializable(request, "chat request");
}

function assertEmbedRequest(request: OllamaEmbedRequest): void {
  if (!isRecord(request) || !hasOnlyKeys(request, EMBED_REQUEST_KEYS)) {
    throw new OllamaClientError("INVALID_REQUEST", "embed request must be a strict JSON object");
  }
  assertNonEmptyString(request.model, "model");
  const inputs = typeof request.input === "string" ? [request.input] : request.input;
  if (
    !Array.isArray(inputs) ||
    inputs.length === 0 ||
    inputs.some((input) => !isNonEmptyString(input))
  ) {
    throw new OllamaClientError("INVALID_REQUEST", "input must contain non-empty text");
  }
  if (
    request.dimensions !== undefined &&
    (!Number.isSafeInteger(request.dimensions) ||
      request.dimensions < 1 ||
      request.dimensions > 16_384)
  ) {
    throw new OllamaClientError(
      "INVALID_REQUEST",
      "dimensions must be an integer between 1 and 16384",
    );
  }
  if (request.options !== undefined && !isRecord(request.options)) {
    throw new OllamaClientError("INVALID_REQUEST", "options must be a JSON object");
  }
  if (request.truncate !== undefined && typeof request.truncate !== "boolean") {
    throw new OllamaClientError("INVALID_REQUEST", "truncate must be boolean");
  }
  assertJsonSerializable(request, "embed request");
}

const CHAT_RESPONSE_KEYS = new Set([
  "created_at",
  "done",
  "done_reason",
  "eval_count",
  "eval_duration",
  "load_duration",
  "logprobs",
  "message",
  "model",
  "prompt_eval_count",
  "prompt_eval_duration",
  "total_duration",
]);
const CHAT_MESSAGE_KEYS = new Set(["content", "images", "role", "thinking", "tool_calls"]);
const EMBED_RESPONSE_KEYS = new Set([
  "embeddings",
  "load_duration",
  "model",
  "prompt_eval_count",
  "total_duration",
]);
const MODEL_TAG_KEYS = new Set(["details", "digest", "model", "modified_at", "name", "size"]);

function hasValidOptionalMetrics(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  return keys.every((key) => record[key] === undefined || isNonNegativeInteger(record[key]));
}

function parseChatResponse(value: unknown): RawChatResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, CHAT_RESPONSE_KEYS) ||
    !isNonEmptyString(value["model"]) ||
    !isNonEmptyString(value["created_at"]) ||
    !Number.isFinite(Date.parse(value["created_at"])) ||
    value["done"] !== true ||
    (value["done_reason"] !== undefined && typeof value["done_reason"] !== "string") ||
    (value["logprobs"] !== undefined &&
      (!Array.isArray(value["logprobs"]) || value["logprobs"].length > 0)) ||
    !hasValidOptionalMetrics(value, [
      "eval_count",
      "eval_duration",
      "load_duration",
      "prompt_eval_count",
      "prompt_eval_duration",
      "total_duration",
    ]) ||
    !isRecord(value["message"]) ||
    !hasOnlyKeys(value["message"], CHAT_MESSAGE_KEYS) ||
    value["message"]["role"] !== "assistant" ||
    typeof value["message"]["content"] !== "string" ||
    (value["message"]["thinking"] !== undefined &&
      typeof value["message"]["thinking"] !== "string") ||
    (value["message"]["images"] !== undefined &&
      (!Array.isArray(value["message"]["images"]) || value["message"]["images"].length > 0)) ||
    (value["message"]["tool_calls"] !== undefined &&
      (!Array.isArray(value["message"]["tool_calls"]) || value["message"]["tool_calls"].length > 0))
  ) {
    throw new OllamaClientError(
      "INVALID_RESPONSE",
      "Ollama /api/chat returned an invalid non-streaming response",
    );
  }
  return value as unknown as RawChatResponse;
}

function parseEmbedResponse(value: unknown): RawEmbedResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, EMBED_RESPONSE_KEYS) ||
    !isNonEmptyString(value["model"]) ||
    !Array.isArray(value["embeddings"]) ||
    value["embeddings"].length === 0 ||
    !value["embeddings"].every(
      (embedding) =>
        Array.isArray(embedding) &&
        embedding.length > 0 &&
        embedding.length <= 16_384 &&
        embedding.every((component) => isFiniteNumber(component)),
    ) ||
    !hasValidOptionalMetrics(value, ["load_duration", "prompt_eval_count", "total_duration"])
  ) {
    throw new OllamaClientError(
      "INVALID_RESPONSE",
      "Ollama /api/embed returned an invalid response",
    );
  }
  return value as unknown as RawEmbedResponse;
}

function parseVersionResponse(value: unknown): RawVersionResponse {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isNonEmptyString(value["version"])) {
    throw new OllamaClientError("INVALID_RESPONSE", "Ollama /api/version returned invalid data");
  }
  return { version: value["version"] };
}

function parseTagsResponse(value: unknown): RawTagsResponse {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value["models"])) {
    throw new OllamaClientError("INVALID_RESPONSE", "Ollama /api/tags returned invalid data");
  }

  const models = value["models"].map((model) => {
    if (
      !isRecord(model) ||
      !hasOnlyKeys(model, MODEL_TAG_KEYS) ||
      !isNonEmptyString(model["name"]) ||
      !isNonEmptyString(model["model"]) ||
      typeof model["digest"] !== "string" ||
      !SHA256_PATTERN.test(model["digest"]) ||
      (model["modified_at"] !== undefined && !isNonEmptyString(model["modified_at"])) ||
      (model["size"] !== undefined && !isNonNegativeInteger(model["size"])) ||
      (model["details"] !== undefined && !isRecord(model["details"]))
    ) {
      throw new OllamaClientError(
        "INVALID_RESPONSE",
        "Ollama /api/tags returned invalid model data",
      );
    }
    return { name: model["name"], model: model["model"], digest: model["digest"] };
  });
  return { models };
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
        throw new OllamaClientError("RESPONSE_TOO_LARGE", "Ollama response exceeds size limit", {
          details: { maxResponseBytes },
        });
      }
      chunks.push(Buffer.from(chunk.value));
      chunk = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

function delay(milliseconds: number): Promise<void> {
  if (milliseconds === 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export class OllamaClient {
  readonly #options: NormalizedOptions;

  public constructor(options: OllamaClientOptions = {}) {
    this.#options = normalizeOptions(options);
  }

  public async chat(
    request: OllamaChatRequest,
  ): Promise<OllamaTransportResult<OllamaChatResponse>> {
    assertChatRequest(request);
    const result = await this.#request(
      "POST",
      "api/chat",
      JSON.stringify({ ...request, stream: false }),
      parseChatResponse,
    );
    return {
      value: {
        model: result.value.model,
        createdAt: result.value.created_at,
        content: result.value.message.content,
        thinking: result.value.message.thinking ?? null,
        doneReason: result.value.done_reason ?? null,
      },
      rawOutput: result.rawOutput,
      attempts: result.attempts,
    };
  }

  public async embed(
    request: OllamaEmbedRequest,
  ): Promise<OllamaTransportResult<OllamaEmbedResponse>> {
    assertEmbedRequest(request);
    const result = await this.#request(
      "POST",
      "api/embed",
      JSON.stringify(request),
      parseEmbedResponse,
    );
    return {
      value: { model: result.value.model, embeddings: result.value.embeddings },
      rawOutput: result.rawOutput,
      attempts: result.attempts,
    };
  }

  public async verifyModel(model: OllamaModelIdentity): Promise<OllamaVerifiedModel> {
    if (
      !isNonEmptyString(model.name) ||
      !SHA256_PATTERN.test(model.digest) ||
      !isNonEmptyString(model.runtimeVersion)
    ) {
      throw new OllamaClientError(
        "INVALID_CONFIGURATION",
        "Pinned model verification requires name, digest and runtime version",
      );
    }

    const [version, tags] = await Promise.all([
      this.#request("GET", "api/version", null, parseVersionResponse),
      this.#request("GET", "api/tags", null, parseTagsResponse),
    ]);
    const installed = tags.value.models.find(
      (candidate) => candidate.name === model.name || candidate.model === model.name,
    );
    if (installed === undefined) {
      throw new OllamaClientError(
        "MODEL_NOT_AVAILABLE",
        `Pinned Ollama model ${model.name} is not installed`,
        { details: { model: model.name } },
      );
    }
    if (installed.digest !== model.digest) {
      throw new OllamaClientError(
        "MODEL_METADATA_MISMATCH",
        `Installed Ollama model ${model.name} does not match the pinned digest`,
        {
          details: {
            actualDigest: installed.digest,
            expectedDigest: model.digest,
            model: model.name,
          },
        },
      );
    }
    if (version.value.version !== model.runtimeVersion) {
      throw new OllamaClientError(
        "RUNTIME_VERSION_MISMATCH",
        "Ollama daemon version does not match the pinned runtime version",
        {
          details: {
            actualVersion: version.value.version,
            expectedVersion: model.runtimeVersion,
          },
        },
      );
    }
    return {
      name: model.name,
      digest: installed.digest,
      runtimeVersion: version.value.version,
    };
  }

  async #request<T>(
    method: "GET" | "POST",
    path: string,
    body: string | null,
    parse: (value: unknown) => T,
  ): Promise<OllamaTransportResult<T>> {
    const endpoint = new URL(path, this.#options.baseUrl);
    let attempt = 0;

    while (attempt <= this.#options.maxRetries) {
      attempt += 1;
      try {
        const result = await this.#requestOnce(method, endpoint, body, parse);
        return { ...result, attempts: attempt };
      } catch (error) {
        const normalized =
          error instanceof OllamaClientError
            ? error
            : new OllamaClientError("UNAVAILABLE", "Ollama request failed", {
                cause: error,
                retryable: true,
              });
        if (!normalized.retryable || attempt > this.#options.maxRetries) throw normalized;
        await delay(this.#options.retryDelayMs);
      }
    }

    throw new OllamaClientError("UNAVAILABLE", "Ollama retry budget was exhausted");
  }

  async #requestOnce<T>(
    method: "GET" | "POST",
    endpoint: URL,
    body: string | null,
    parse: (value: unknown) => T,
  ): Promise<Omit<OllamaTransportResult<T>, "attempts">> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.#options.timeoutMs);

    try {
      const response = await fetch(
        endpoint,
        body === null
          ? { method, redirect: "error", signal: controller.signal }
          : {
              method,
              headers: { "content-type": "application/json" },
              body,
              redirect: "error",
              signal: controller.signal,
            },
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new OllamaClientError(
          "HTTP_ERROR",
          `Ollama request failed with HTTP ${String(response.status)}`,
          {
            details: { status: response.status },
            retryable: RETRYABLE_STATUS.has(response.status),
          },
        );
      }

      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > this.#options.maxResponseBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new OllamaClientError("RESPONSE_TOO_LARGE", "Ollama response exceeds size limit", {
          details: { maxResponseBytes: this.#options.maxResponseBytes },
        });
      }

      const rawOutput = await readResponseBody(response, this.#options.maxResponseBytes);

      let decoded: unknown;
      try {
        decoded = JSON.parse(rawOutput) as unknown;
      } catch (cause) {
        throw new OllamaClientError("INVALID_RESPONSE", "Ollama response is not valid JSON", {
          cause,
        });
      }

      return { value: parse(decoded), rawOutput };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new OllamaClientError(
          "TIMEOUT",
          `Ollama request timed out after ${String(this.#options.timeoutMs)} ms`,
          { cause: error, retryable: true },
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
