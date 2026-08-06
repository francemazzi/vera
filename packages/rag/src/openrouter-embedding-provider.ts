import { sha256CanonicalJson } from "@vera/contracts";

import { RagError } from "./errors.js";
import type { PrivateLabelEmbeddingProvider } from "./providers.js";
import type { OpenRouterRagProviderModel } from "./types.js";

const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_BATCH_SIZE = 64;
const MAX_RESPONSE_BYTES = 8_000_000;

export const OPENROUTER_GEMINI_EMBEDDING_MODEL = "google/gemini-embedding-001" as const;
export const OPENROUTER_GEMINI_EMBEDDING_DIMENSIONS = 1_536 as const;
const OPENROUTER_GEMINI_EMBEDDING_RESPONSE_MODEL = "gemini-embedding-001";

const ROUTING_POLICY = Object.freeze({
  allow_fallbacks: false,
  data_collection: "deny" as const,
  order: ["google-vertex"],
  zdr: true,
});

export const OPENROUTER_GEMINI_EMBEDDING_ROUTING_CONFIG_HASH = sha256CanonicalJson({
  apiVersion: "v1",
  dimensions: OPENROUTER_GEMINI_EMBEDDING_DIMENSIONS,
  endpoint: OPENROUTER_EMBEDDINGS_URL,
  model: OPENROUTER_GEMINI_EMBEDDING_MODEL,
  provider: ROUTING_POLICY,
});

export interface OpenRouterEmbeddingProviderOptions {
  /** Server-injected credential; never read from process.env by this adapter. */
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

interface NormalizedOptions {
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly fetch: typeof globalThis.fetch;
}

interface EmbeddingResponseItem {
  readonly embedding: readonly number[];
  readonly index: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptions(options: OpenRouterEmbeddingProviderOptions): NormalizedOptions {
  const apiKey = options.apiKey.trim();
  if (apiKey.length < 16 || apiKey.length > 512 || /\s/u.test(apiKey)) {
    throw new RagError("CONFIGURATION_INVALID", "OpenRouter API key is not configured");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new RagError(
      "CONFIGURATION_INVALID",
      `timeoutMs must be an integer between 1 and ${String(MAX_TIMEOUT_MS)}`,
    );
  }
  if (options.fetch !== undefined && typeof options.fetch !== "function") {
    throw new RagError("CONFIGURATION_INVALID", "OpenRouter fetch transport must be a function");
  }
  return { apiKey, timeoutMs, fetch: options.fetch ?? globalThis.fetch };
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status === 524 || status === 529 || status >= 500;
}

function parseEmbeddingItems(value: unknown, expectedCount: number): readonly (readonly number[])[] {
  if (!isRecord(value) || value["model"] !== OPENROUTER_GEMINI_EMBEDDING_RESPONSE_MODEL) {
    throw new RagError("EGRESS_UNAVAILABLE", "OpenRouter returned an unexpected embedding model");
  }
  const data = value["data"];
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw new RagError("EGRESS_UNAVAILABLE", "OpenRouter returned an unexpected embedding count");
  }
  const parsed: EmbeddingResponseItem[] = data.map((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry["embedding"])) {
      throw new RagError("EGRESS_UNAVAILABLE", "OpenRouter returned an invalid embedding item");
    }
    const index = entry["index"];
    if (typeof index !== "number" || !Number.isSafeInteger(index)) {
      throw new RagError("EGRESS_UNAVAILABLE", "OpenRouter returned an invalid embedding item");
    }
    const embedding = entry["embedding"];
    if (
      embedding.length !== OPENROUTER_GEMINI_EMBEDDING_DIMENSIONS ||
      embedding.some((component) => typeof component !== "number" || !Number.isFinite(component))
    ) {
      throw new RagError("DIMENSION_MISMATCH", "OpenRouter embedding dimensions do not match 1536");
    }
    return { index, embedding: [...embedding] as readonly number[] };
  });
  const ordered = [...parsed].sort((left, right) => left.index - right.index);
  if (ordered.some((entry, index) => entry.index !== index)) {
    throw new RagError("EGRESS_UNAVAILABLE", "OpenRouter embedding indexes are invalid");
  }
  return ordered.map(({ embedding }) => embedding);
}

/**
 * OpenRouter embedding adapter for the private Label governance worker. It
 * receives its key from the caller and sends only explicit document/query text.
 */
export class OpenRouterEmbeddingProvider implements PrivateLabelEmbeddingProvider {
  public readonly model: OpenRouterRagProviderModel = Object.freeze({
    name: OPENROUTER_GEMINI_EMBEDDING_MODEL,
    runtime: "OPENROUTER",
    apiVersion: "v1",
    routingConfigHash: OPENROUTER_GEMINI_EMBEDDING_ROUTING_CONFIG_HASH,
  });

  readonly #options: NormalizedOptions;

  public constructor(options: OpenRouterEmbeddingProviderOptions) {
    this.#options = normalizeOptions(options);
  }

  public async embedTexts(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return this.embedDocuments(texts);
  }

  public async embedDocuments(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return this.#embed(texts, "search_document");
  }

  public async embedQuery(text: string): Promise<readonly number[]> {
    const vectors = await this.#embed([text], "search_query");
    const vector = vectors[0];
    if (vector === undefined) {
      throw new RagError("DIMENSION_MISMATCH", "OpenRouter omitted the query embedding");
    }
    return vector;
  }

  async #embed(
    texts: readonly string[],
    inputType: "search_document" | "search_query",
  ): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];
    if (texts.some((text) => typeof text !== "string" || text.trim().length === 0)) {
      throw new RagError("QUERY_INVALID", "Embedding text must be non-empty");
    }
    const vectors: (readonly number[])[] = [];
    for (let offset = 0; offset < texts.length; offset += MAX_BATCH_SIZE) {
      const batch = texts.slice(offset, offset + MAX_BATCH_SIZE);
      vectors.push(...(await this.#embedBatch(batch, inputType)));
    }
    return vectors;
  }

  async #embedBatch(
    texts: readonly string[],
    inputType: "search_document" | "search_query",
  ): Promise<readonly (readonly number[])[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#options.timeoutMs);
    try {
      const response = await this.#options.fetch(OPENROUTER_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.#options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENROUTER_GEMINI_EMBEDDING_MODEL,
          input: texts,
          input_type: inputType,
          dimensions: OPENROUTER_GEMINI_EMBEDDING_DIMENSIONS,
          encoding_format: "float",
          provider: ROUTING_POLICY,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new RagError("PROVIDER_UNAVAILABLE", "OpenRouter embeddings request failed", {
          details: { status: response.status },
          retryable: isRetryableStatus(response.status),
        });
      }
      const rawResponse = await response.text();
      if (rawResponse.length > MAX_RESPONSE_BYTES) {
        throw new RagError("EGRESS_UNAVAILABLE", "OpenRouter embeddings response exceeds the limit");
      }
      try {
        return parseEmbeddingItems(JSON.parse(rawResponse) as unknown, texts.length);
      } catch (error) {
        if (error instanceof RagError) throw error;
        throw new RagError("EGRESS_UNAVAILABLE", "OpenRouter embeddings response is not valid JSON", {
          cause: error,
        });
      }
    } catch (error) {
      if (error instanceof RagError) throw error;
      throw new RagError("PROVIDER_UNAVAILABLE", "OpenRouter embeddings request is unavailable", {
        cause: error,
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
