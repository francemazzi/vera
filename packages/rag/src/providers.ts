import { RagError } from "./errors.js";
import type { RagProviderModel, RagProviderUsage } from "./types.js";

export interface EmbeddingProvider {
  readonly model: RagProviderModel;
  embedTexts(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export interface RuleDraftProviderResult {
  readonly rawOutput: string;
  readonly attempts: number;
  readonly provider: RagProviderModel;
  readonly generationId?: string | null;
  readonly responseModel?: string | null;
  readonly upstreamProvider?: string | null;
  readonly systemFingerprint?: string | null;
  readonly usage?: RagProviderUsage | null;
  readonly responseSchemaHash?: string | null;
}

export interface RuleDraftProvider {
  readonly model: RagProviderModel;
  generateJson(prompt: string): Promise<RuleDraftProviderResult>;
}

export interface RetryOptions {
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
}

interface NormalizedRetryOptions {
  readonly maxRetries: number;
  readonly retryDelayMs: number;
}

function normalizeRetryOptions(options: RetryOptions = {}): NormalizedRetryOptions {
  const maxRetries = options.maxRetries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 25;

  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 3) {
    throw new RagError("CONFIGURATION_INVALID", "maxRetries must be an integer between 0 and 3");
  }

  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 5000) {
    throw new RagError(
      "CONFIGURATION_INVALID",
      "retryDelayMs must be an integer between 0 and 5000",
    );
  }

  return { maxRetries, retryDelayMs };
}

function delay(milliseconds: number): Promise<void> {
  if (milliseconds === 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isRetryableError(error: unknown): boolean {
  return error instanceof RagError && error.retryable;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<{ readonly value: T; readonly attempts: number }> {
  const normalized = normalizeRetryOptions(options);
  let attempts = 0;
  let lastError: unknown;

  while (attempts <= normalized.maxRetries) {
    attempts += 1;
    try {
      return { value: await operation(), attempts };
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempts > normalized.maxRetries) break;
      await delay(normalized.retryDelayMs);
    }
  }

  throw new RagError("RETRY_EXHAUSTED", "RAG provider retry budget exhausted", {
    cause: lastError,
    retryable: false,
    details: { attempts },
  });
}

export class RetryingEmbeddingProvider implements EmbeddingProvider {
  public readonly model: RagProviderModel;
  readonly #inner: EmbeddingProvider;
  readonly #options: RetryOptions;

  public constructor(inner: EmbeddingProvider, options: RetryOptions = {}) {
    this.model = inner.model;
    this.#inner = inner;
    this.#options = options;
  }

  public async embedTexts(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    const result = await withRetry(() => this.#inner.embedTexts(texts), this.#options);
    return result.value;
  }
}

export class RetryingRuleDraftProvider implements RuleDraftProvider {
  public readonly model: RagProviderModel;
  readonly #inner: RuleDraftProvider;
  readonly #options: RetryOptions;

  public constructor(inner: RuleDraftProvider, options: RetryOptions = {}) {
    this.model = inner.model;
    this.#inner = inner;
    this.#options = options;
  }

  public async generateJson(prompt: string): Promise<RuleDraftProviderResult> {
    const result = await withRetry(() => this.#inner.generateJson(prompt), this.#options);
    const innerResult = result.value;
    return { ...innerResult, attempts: innerResult.attempts + result.attempts - 1 };
  }
}
