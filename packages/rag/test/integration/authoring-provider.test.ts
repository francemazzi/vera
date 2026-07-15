import { describe, expect, it } from "vitest";

import { RagError, RetryingEmbeddingProvider, generateRuleCardDraft } from "../../src/index.js";
import type { EmbeddingProvider, RagProviderModel } from "../../src/index.js";
import { MODEL, StaticDraftProvider, retrievedChunk, validDraftOutput } from "../fixtures/rag.js";

class FlakyEmbeddingProvider implements EmbeddingProvider {
  public readonly model: RagProviderModel = MODEL;
  #calls = 0;

  public embedTexts(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    this.#calls += 1;
    if (this.#calls === 1) {
      return Promise.reject(
        new RagError("PROVIDER_UNAVAILABLE", "transient embedding outage", {
          retryable: true,
        }),
      );
    }
    return Promise.resolve(texts.map(() => [1, 0, 0, 0]));
  }
}

describe("RAG provider retry contracts", () => {
  it("retries transient embedding failures", async () => {
    const provider = new RetryingEmbeddingProvider(new FlakyEmbeddingProvider(), {
      maxRetries: 1,
      retryDelayMs: 0,
    });

    await expect(provider.embedTexts(["retention"])).resolves.toEqual([[1, 0, 0, 0]]);
  });

  it("records draft provider attempts in generated logs", async () => {
    const chunk = retrievedChunk();
    const result = await generateRuleCardDraft({
      instruction: "Draft one synthetic label rule.",
      chunks: [chunk],
      provider: new StaticDraftProvider(validDraftOutput(chunk.chunkId)),
      generatedAt: "2026-07-15T16:20:00.000Z",
    });

    expect(result.log.attempts).toBe(1);
  });
});
