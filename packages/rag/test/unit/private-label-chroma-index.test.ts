import { describe, expect, it } from "vitest";

import { ChromaPrivateLabelRagIndex, RagError, labelingTopicQueryValues } from "../../src/index.js";
import type {
  ChromaCollection,
  ChromaMetadata,
  ChromaVectorMatch,
  ChromaVectorStore,
  ChromaVectorRecord,
  ChromaVectorQuery,
  PrivateLabelEmbeddingProvider,
  PrivateLabelRagSection,
  RagProviderModel,
} from "../../src/index.js";
import { uuid } from "../fixtures/rag.js";

const MODEL: RagProviderModel = {
  name: "synthetic-private-label-embedding",
  digest: "e".repeat(64),
  runtimeVersion: "synthetic-v1",
};

function vector(): readonly number[] {
  return Array.from({ length: 1_536 }, (_, index) => (index === 0 ? 1 : 0));
}

function section(overrides: Partial<PrivateLabelRagSection> = {}): PrivateLabelRagSection {
  return {
    sourceId: uuid(100),
    sourceVersionId: uuid(101),
    workspaceScope: uuid(102),
    sourceState: "VERIFIED",
    validityStatus: "ADMIN_DECLARED",
    sourceContentHash: "a".repeat(64),
    title: "Synthetic food-label source",
    jurisdiction: "IT",
    language: "it",
    documentType: "REGULATION",
    actReference: "EU 1169/2011",
    canonicalReference: "https://eur-lex.europa.eu/synthetic.pdf",
    pdfReference: null,
    revisionLabel: "2026.1",
    validity: { validFrom: "2026-01-01T00:00:00.000Z", validTo: null },
    productCategories: ["food"],
    sectionId: "art-9",
    sectionTitle: "Mandatory particulars",
    pageNumber: 12,
    text: "Synthetic label text requires a visible product denomination and allergen declaration.",
    ...overrides,
  };
}

class FakeEmbeddingProvider implements PrivateLabelEmbeddingProvider {
  public readonly model = MODEL;
  public readonly documents: string[] = [];
  public readonly queries: string[] = [];

  public embedTexts(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return this.embedDocuments(texts);
  }

  public embedDocuments(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    this.documents.push(...texts);
    return Promise.resolve(texts.map(() => vector()));
  }

  public embedQuery(text: string): Promise<readonly number[]> {
    this.queries.push(text);
    return Promise.resolve(vector());
  }
}

class FakeChromaStore implements ChromaVectorStore {
  public readonly collections: ChromaCollection[] = [];
  public readonly records: ChromaVectorRecord[] = [];
  public nextMatches: readonly ChromaVectorMatch[] = [];
  public lastQuery: ChromaVectorQuery | null = null;
  public readonly deletes: {
    readonly collection: ChromaCollection;
    readonly where: Record<string, unknown>;
  }[] = [];

  public ensureCollection(input: {
    readonly name: string;
    readonly metadata: ChromaMetadata;
  }): Promise<ChromaCollection> {
    const collection = { id: `collection-${input.name}`, name: input.name };
    this.collections.push(collection);
    return Promise.resolve(collection);
  }

  public upsert(input: {
    readonly collection: ChromaCollection;
    readonly records: readonly ChromaVectorRecord[];
  }): Promise<void> {
    this.records.push(...input.records);
    return Promise.resolve();
  }

  public delete(input: {
    readonly collection: ChromaCollection;
    readonly where: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    this.deletes.push({ collection: input.collection, where: { ...input.where } });
    return Promise.resolve();
  }

  public query(input: {
    readonly collection: ChromaCollection;
    readonly query: ChromaVectorQuery;
  }): Promise<readonly ChromaVectorMatch[]> {
    this.lastQuery = input.query;
    return Promise.resolve(this.nextMatches);
  }

  public heartbeat(): Promise<void> {
    return Promise.resolve();
  }
}

describe("ChromaPrivateLabelRagIndex", () => {
  it("indexes expert-verified sources only in the verified collection with auditable metadata", async () => {
    const chroma = new FakeChromaStore();
    const embeddings = new FakeEmbeddingProvider();
    const index = new ChromaPrivateLabelRagIndex({ chroma, embeddingProvider: embeddings });

    const result = await index.indexPreliminarySections([section()]);

    expect(result).toMatchObject({ chunksIndexed: 1, sourceVersionIds: [uuid(101)] });
    expect(chroma.collections.map(({ name }) => name)).toEqual(["silto-label-verified-v1"]);
    expect(chroma.records[0]?.document).toBe(section().text);
    expect(chroma.records[0]?.metadata).toMatchObject({
      source_state: "VERIFIED",
      validity_status: "ADMIN_DECLARED",
      source_content_hash: "a".repeat(64),
      page_number: 12,
      product_categories: ["food"],
      workspace_scope: uuid(102),
    });
    expect(chroma.records[0]?.embedding).toHaveLength(1_536);
    expect(embeddings.documents).toEqual([section().text]);
  });

  it("upserts replacement chunks before pruning only older content hashes", async () => {
    const chroma = new FakeChromaStore();
    const index = new ChromaPrivateLabelRagIndex({
      chroma,
      embeddingProvider: new FakeEmbeddingProvider(),
    });

    await index.indexPreliminarySections([section({ sourceContentHash: "b".repeat(64) })]);

    expect(chroma.records).toHaveLength(1);
    expect(
      chroma.deletes.map(({ collection, where }) => ({ name: collection.name, where })),
    ).toEqual([
      {
        name: "silto-label-verified-v1",
        where: {
          $and: [
            { source_version_id: { $eq: uuid(101) } },
            { source_content_hash: { $ne: "b".repeat(64) } },
          ],
        },
      },
    ]);
  });

  it("keeps verified and approved collections physically separate and rejects invalid state mixing", async () => {
    const index = new ChromaPrivateLabelRagIndex({
      chroma: new FakeChromaStore(),
      embeddingProvider: new FakeEmbeddingProvider(),
    });

    await expect(index.indexApprovedSections([section()])).rejects.toMatchObject({
      code: "INDEX_REJECTED",
    } satisfies Partial<RagError>);
    await expect(
      index.indexPreliminarySections([section({ sourceState: "APPROVED" })]),
    ).resolves.toMatchObject({
      chunksIndexed: 1,
    });
    await expect(
      index.indexApprovedSections([
        section({ sourceState: "APPROVED", validityStatus: "AI_PROPOSED" }),
      ]),
    ).rejects.toMatchObject({ code: "INDEX_REJECTED" } satisfies Partial<RagError>);
    await expect(
      index.indexApprovedSections([
        section({ sourceState: "APPROVED", validityStatus: "ADMIN_CONFIRMED" }),
      ]),
    ).resolves.toMatchObject({ chunksIndexed: 1 });
  });

  it("removes a retired source version from each physical collection by metadata filter", async () => {
    const chroma = new FakeChromaStore();
    const index = new ChromaPrivateLabelRagIndex({
      chroma,
      embeddingProvider: new FakeEmbeddingProvider(),
    });

    await index.removePreliminarySourceVersion(uuid(101));
    await index.removeApprovedSourceVersion(uuid(101));

    expect(
      chroma.deletes.map(({ collection, where }) => ({ name: collection.name, where })),
    ).toEqual([
      {
        name: "silto-label-verified-v1",
        where: { source_version_id: { $eq: uuid(101) } },
      },
      {
        name: "silto-label-approved-v1",
        where: { source_version_id: { $eq: uuid(101) } },
      },
    ]);
  });

  it("queries verified sources with state, multi-jurisdiction and temporal metadata filters", async () => {
    const chroma = new FakeChromaStore();
    const index = new ChromaPrivateLabelRagIndex({
      chroma,
      embeddingProvider: new FakeEmbeddingProvider(),
    });
    await index.indexPreliminarySections([section()]);
    const record = chroma.records[0];
    if (record === undefined) throw new Error("expected indexed verified source");
    chroma.nextMatches = [
      {
        id: record.id,
        distance: 0.1,
        document: record.document,
        metadata: record.metadata,
      },
    ];

    const result = await index.retrievePreliminarySafely({
      queryText: "allergen declaration",
      workspaceId: uuid(102),
      jurisdiction: "IT",
      evaluationDate: "2026-07-19T00:00:00.000Z",
      productCategory: "food",
    });

    expect(result).toMatchObject({
      status: "AVAILABLE",
      scope: "PRELIMINARY",
      requiresReview: true,
    });
    if (result.status !== "AVAILABLE") throw new Error("expected retrieval result");
    expect(result.chunks[0]).toMatchObject({
      sourceState: "VERIFIED",
      pageNumber: 12,
      citation: { canonicalReference: "https://eur-lex.europa.eu/synthetic.pdf" },
    });
    expect(chroma.lastQuery?.where).toEqual({
      $and: [
        { source_state: { $in: ["VERIFIED", "APPROVED"] } },
        { validity_status: { $in: ["ADMIN_DECLARED", "ADMIN_CONFIRMED", "AI_PROPOSED"] } },
        { jurisdiction: { $in: ["IT"] } },
        {
          $or: [{ workspace_scope: { $eq: uuid(102) } }, { workspace_scope: { $eq: "GLOBAL" } }],
        },
        { valid_from_epoch: { $lte: Date.parse("2026-07-19T00:00:00.000Z") } },
        { valid_to_epoch: { $gt: Date.parse("2026-07-19T00:00:00.000Z") } },
        { product_categories: { $contains: "food" } },
      ],
    });
  });

  it("stores and filters labeling topics alongside the mandatory scope filters", async () => {
    const chroma = new FakeChromaStore();
    const index = new ChromaPrivateLabelRagIndex({
      chroma,
      embeddingProvider: new FakeEmbeddingProvider(),
    });
    await index.indexPreliminarySections([section({ labelingTopics: ["allergens"] })]);

    expect(chroma.records[0]?.metadata).toMatchObject({ labeling_topics: ["allergens"] });
    await index.retrievePreliminarySafely({
      queryText: "allergen declaration",
      workspaceId: uuid(102),
      jurisdiction: "IT",
      evaluationDate: "2026-07-19T00:00:00.000Z",
      labelingTopics: ["allergens", "ingredients"],
    });
    expect(chroma.lastQuery?.where).toEqual({
      $and: [
        { source_state: { $in: ["VERIFIED", "APPROVED"] } },
        { validity_status: { $in: ["ADMIN_DECLARED", "ADMIN_CONFIRMED", "AI_PROPOSED"] } },
        { jurisdiction: { $in: ["IT"] } },
        {
          $or: [{ workspace_scope: { $eq: uuid(102) } }, { workspace_scope: { $eq: "GLOBAL" } }],
        },
        { valid_from_epoch: { $lte: Date.parse("2026-07-19T00:00:00.000Z") } },
        { valid_to_epoch: { $gt: Date.parse("2026-07-19T00:00:00.000Z") } },
        {
          $or: ["allergens", "ingredients"].flatMap((topic) =>
            labelingTopicQueryValues(topic).map((value) => ({
              labeling_topics: { $contains: value },
            })),
          ),
        },
      ],
    });
  });

  it("stores unknown temporal metadata for recovery but excludes it from ordinary preliminary retrieval", async () => {
    const chroma = new FakeChromaStore();
    const index = new ChromaPrivateLabelRagIndex({
      chroma,
      embeddingProvider: new FakeEmbeddingProvider(),
    });
    await index.indexPreliminarySections([section({ validityStatus: "UNKNOWN" })]);
    expect(chroma.records[0]?.metadata).toMatchObject({
      validity_status: "UNKNOWN",
      validity_known: false,
    });

    await index.retrievePreliminarySafely({
      queryText: "allergen declaration",
      workspaceId: uuid(102),
      jurisdiction: "IT",
      evaluationDate: "2026-07-19T00:00:00.000Z",
    });
    expect(chroma.lastQuery?.where).toEqual({
      $and: [
        { source_state: { $in: ["VERIFIED", "APPROVED"] } },
        { validity_status: { $in: ["ADMIN_DECLARED", "ADMIN_CONFIRMED", "AI_PROPOSED"] } },
        { jurisdiction: { $in: ["IT"] } },
        {
          $or: [{ workspace_scope: { $eq: uuid(102) } }, { workspace_scope: { $eq: "GLOBAL" } }],
        },
        { valid_from_epoch: { $lte: Date.parse("2026-07-19T00:00:00.000Z") } },
        { valid_to_epoch: { $gt: Date.parse("2026-07-19T00:00:00.000Z") } },
      ],
    });
  });

  it("marks a failed preliminary retrieval unavailable without dropping the review requirement", async () => {
    const failingProvider: PrivateLabelEmbeddingProvider = {
      model: MODEL,
      embedTexts: () => Promise.reject(new Error("not used")),
      embedDocuments: () => Promise.reject(new Error("not used")),
      embedQuery: () => Promise.reject(new RagError("PROVIDER_UNAVAILABLE", "offline")),
    };
    const index = new ChromaPrivateLabelRagIndex({
      chroma: new FakeChromaStore(),
      embeddingProvider: failingProvider,
    });

    await expect(
      index.retrievePreliminarySafely({
        queryText: "allergens",
        workspaceId: uuid(102),
        jurisdiction: "IT",
        evaluationDate: "2026-07-19T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "UNAVAILABLE",
      scope: "PRELIMINARY",
      requiresReview: true,
      reason: "PROVIDER_UNAVAILABLE: offline",
    });
  });
});
