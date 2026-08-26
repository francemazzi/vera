import { PRIVATE_LABEL_GOLD_COLLECTION } from "./private-label-gold-collection.js";
import type { ChromaCollection, ChromaVectorStore } from "./chroma-client.js";
import type { PrivateLabelEmbeddingProvider } from "./providers.js";

export type GoldExampleRecord = Readonly<{
  confirmationId: string;
  fieldCode: string;
  countryCode: string;
  productCategory: string;
  promptVersion: string;
  goldOutcome: string;
  rationale: string;
}>;

/**
 * Indexes consultant-confirmed gold examples into a collection that never
 * shares IDs or metadata with verified legal sources.
 */
export class ChromaPrivateLabelGoldIndex {
  readonly #chroma: ChromaVectorStore;
  readonly #embeddingProvider: PrivateLabelEmbeddingProvider;

  public constructor(options: {
    readonly chroma: ChromaVectorStore;
    readonly embeddingProvider: PrivateLabelEmbeddingProvider;
  }) {
    this.#chroma = options.chroma;
    this.#embeddingProvider = options.embeddingProvider;
  }

  public async indexExamples(
    examples: readonly GoldExampleRecord[],
  ): Promise<{ readonly chunksIndexed: number; readonly collection: string }> {
    if (examples.length === 0) return { chunksIndexed: 0, collection: PRIVATE_LABEL_GOLD_COLLECTION };
    const embeddings = await this.#embeddingProvider.embedDocuments(
      examples.map((example) => `${example.fieldCode} ${example.goldOutcome} ${example.rationale}`),
    );
    const collection = await this.#collection();
    await this.#chroma.upsert({
      collection,
      records: examples.map((example, index) => ({
        id: `${example.confirmationId}:${example.fieldCode}`,
        embedding: embeddings[index] ?? [],
        document: example.rationale,
        metadata: {
          field_code: example.fieldCode,
          country_code: example.countryCode,
          product_category: example.productCategory,
          prompt_version: example.promptVersion,
          gold_outcome: example.goldOutcome,
        },
      })),
    });
    return { chunksIndexed: examples.length, collection: PRIVATE_LABEL_GOLD_COLLECTION };
  }

  async #collection(): Promise<ChromaCollection> {
    return this.#chroma.ensureCollection({
      name: PRIVATE_LABEL_GOLD_COLLECTION,
      metadata: { scope: "GOLD", embedding_model: "google/gemini-embedding-001" },
    });
  }
}
