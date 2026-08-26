import { describe, expect, it } from "vitest";

import {
  ChromaPrivateLabelGoldIndex,
  PRIVATE_LABEL_GOLD_COLLECTION,
  PRIVATE_LABEL_VERIFIED_COLLECTION,
} from "../../src/index.js";
import type {
  ChromaCollection,
  ChromaMetadata,
  ChromaVectorRecord,
  ChromaVectorStore,
  PrivateLabelEmbeddingProvider,
  RagProviderModel,
} from "../../src/index.js";

const MODEL: RagProviderModel = {
  name: "synthetic-gold-embedding",
  digest: "e".repeat(64),
  runtimeVersion: "synthetic-v1",
};

class FakeEmbeddingProvider implements PrivateLabelEmbeddingProvider {
  public readonly model = MODEL;

  public embedTexts(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return this.embedDocuments(texts);
  }

  public embedDocuments(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return Promise.resolve(texts.map(() => [1, 0]));
  }

  public embedQuery(): Promise<readonly number[]> {
    return Promise.resolve([1, 0]);
  }
}

class FakeChromaStore implements ChromaVectorStore {
  public readonly collectionNames: string[] = [];
  public readonly records: ChromaVectorRecord[] = [];

  public ensureCollection(input: {
    readonly name: string;
    readonly metadata: ChromaMetadata;
  }): Promise<ChromaCollection> {
    this.collectionNames.push(input.name);
    return Promise.resolve({ id: `collection-${input.name}`, name: input.name });
  }

  public upsert(input: {
    readonly collection: ChromaCollection;
    readonly records: readonly ChromaVectorRecord[];
  }): Promise<void> {
    this.records.push(...input.records);
    return Promise.resolve();
  }

  public delete(): Promise<void> {
    return Promise.resolve();
  }

  public query(): Promise<readonly never[]> {
    return Promise.resolve([]);
  }

  public heartbeat(): Promise<void> {
    return Promise.resolve();
  }
}

describe("ChromaPrivateLabelGoldIndex", () => {
  it("upserts gold examples into a collection separate from verified law", async () => {
    const chroma = new FakeChromaStore();
    const index = new ChromaPrivateLabelGoldIndex({
      chroma,
      embeddingProvider: new FakeEmbeddingProvider(),
    });
    const result = await index.indexExamples([
      {
        confirmationId: "conf-1",
        fieldCode: "indicazioni_aggiuntive",
        countryCode: "IT",
        productCategory: "confectionery",
        promptVersion: "label-evaluation-v2",
        goldOutcome: "FAIL",
        rationale: "Claim strutto fuorviante.",
      },
    ]);
    expect(result.collection).toBe(PRIVATE_LABEL_GOLD_COLLECTION);
    expect(result.collection).not.toBe(PRIVATE_LABEL_VERIFIED_COLLECTION);
    expect(chroma.collectionNames).toEqual([PRIVATE_LABEL_GOLD_COLLECTION]);
    expect(chroma.records[0]?.id).toBe("conf-1:indicazioni_aggiuntive");
  });
});
