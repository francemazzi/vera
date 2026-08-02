import { describe, expect, it } from "vitest";

import {
  OPENROUTER_GEMINI_EMBEDDING_DIMENSIONS,
  OPENROUTER_GEMINI_EMBEDDING_MODEL,
  OpenRouterEmbeddingProvider,
} from "../../src/index.js";
import type { RagError } from "../../src/index.js";

const API_KEY = "synthetic-openrouter-key-123456";

function embedding(value = 0.25): readonly number[] {
  return Array.from({ length: OPENROUTER_GEMINI_EMBEDDING_DIMENSIONS }, () => value);
}

function responseFor(
  vectors: readonly (readonly number[])[],
  model: string = OPENROUTER_GEMINI_EMBEDDING_MODEL,
): Response {
  return new Response(
    JSON.stringify({
      model,
      data: vectors.map((vector, index) => ({ embedding: vector, index, object: "embedding" })),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("OpenRouterEmbeddingProvider", () => {
  it("uses an injected server key to request fixed 1536-dimensional document embeddings", async () => {
    let capturedInput: Parameters<typeof globalThis.fetch>[0] | undefined;
    let capturedInit: RequestInit | undefined;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      capturedInput = input;
      capturedInit = init;
      return responseFor([embedding()]);
    };
    const provider = new OpenRouterEmbeddingProvider({ apiKey: API_KEY, fetch });

    const vectors = await provider.embedDocuments(["Synthetic official source text."]);

    expect(String(capturedInput)).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(capturedInit?.headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      model: OPENROUTER_GEMINI_EMBEDDING_MODEL,
      dimensions: 1_536,
      input_type: "search_document",
      input: ["Synthetic official source text."],
      provider: { data_collection: "deny", order: ["google"], zdr: true },
    });
    expect(vectors[0]).toHaveLength(1_536);
  });

  it("uses query semantics and rejects a response with an unexpected dimension", async () => {
    const provider = new OpenRouterEmbeddingProvider({
      apiKey: API_KEY,
      fetch: async (_input, init) => {
        expect(JSON.parse(String(init?.body))).toMatchObject({ input_type: "search_query" });
        return responseFor([embedding().slice(0, 10)]);
      },
    });

    await expect(provider.embedQuery("allergen requirement")).rejects.toMatchObject({
      code: "DIMENSION_MISMATCH",
    } satisfies Partial<RagError>);
  });

  it("fails closed when OpenRouter attributes a vector to another model", async () => {
    const provider = new OpenRouterEmbeddingProvider({
      apiKey: API_KEY,
      fetch: async () => responseFor([embedding()], "different/model"),
    });

    await expect(provider.embedDocuments(["Synthetic official source text."])).rejects.toMatchObject({
      code: "EGRESS_UNAVAILABLE",
      retryable: false,
    } satisfies Partial<RagError>);
  });
});
