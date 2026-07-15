import { OllamaClientError } from "@vera/extractors";
import type { OllamaClient, OllamaChatMessage } from "@vera/extractors";

import { RagError } from "./errors.js";
import type { EmbeddingProvider, RuleDraftProvider, RuleDraftProviderResult } from "./providers.js";
import type { RagProviderModel } from "./types.js";

export interface OllamaRagProviderOptions {
  readonly client: OllamaClient;
  readonly model: RagProviderModel;
  readonly dimensions?: number;
  readonly options?: Readonly<Record<string, unknown>>;
}

function mapOllamaError(error: unknown): RagError {
  if (error instanceof RagError) return error;
  if (error instanceof OllamaClientError) {
    return new RagError(
      error.retryable ? "PROVIDER_UNAVAILABLE" : "EGRESS_UNAVAILABLE",
      error.message,
      {
        cause: error,
        retryable: error.retryable,
        details: { ollamaCode: error.code, ...error.details },
      },
    );
  }
  return new RagError("PROVIDER_UNAVAILABLE", "Ollama provider failed", {
    cause: error,
    retryable: true,
  });
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  public readonly model: RagProviderModel;
  readonly #client: OllamaClient;
  readonly #dimensions: number | undefined;
  readonly #options: Readonly<Record<string, unknown>> | undefined;

  public constructor(options: OllamaRagProviderOptions) {
    this.model = options.model;
    this.#client = options.client;
    this.#dimensions = options.dimensions;
    this.#options = options.options;
  }

  public async embedTexts(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    try {
      const result = await this.#client.embed({
        model: this.model.name,
        input: texts,
        ...(this.#dimensions === undefined ? {} : { dimensions: this.#dimensions }),
        ...(this.#options === undefined ? {} : { options: this.#options }),
        truncate: false,
      });
      return result.value.embeddings;
    } catch (error) {
      throw mapOllamaError(error);
    }
  }
}

export class OllamaRuleDraftProvider implements RuleDraftProvider {
  public readonly model: RagProviderModel;
  readonly #client: OllamaClient;
  readonly #options: Readonly<Record<string, unknown>> | undefined;

  public constructor(options: OllamaRagProviderOptions) {
    this.model = options.model;
    this.#client = options.client;
    this.#options = options.options;
  }

  public async generateJson(prompt: string): Promise<RuleDraftProviderResult> {
    const messages: readonly OllamaChatMessage[] = [
      {
        role: "system",
        content:
          "You draft editorial Rule Cards only. Return strict JSON. Never produce approval or compliance outcomes.",
      },
      { role: "user", content: prompt },
    ];

    try {
      const result = await this.#client.chat({
        model: this.model.name,
        messages,
        format: "json",
        ...(this.#options === undefined ? {} : { options: this.#options }),
        think: false,
      });
      return {
        rawOutput: result.value.content,
        attempts: result.attempts,
        provider: this.model,
      };
    } catch (error) {
      throw mapOllamaError(error);
    }
  }
}
