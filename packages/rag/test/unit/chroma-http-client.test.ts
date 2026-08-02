import { describe, expect, it } from "vitest";

import { ChromaHttpVectorStore } from "../../src/index.js";

describe("ChromaHttpVectorStore", () => {
  it("uses Chroma v2 collections with caller-provided embeddings and metadata filters", async () => {
    const calls: { readonly input: string; readonly init: RequestInit | undefined }[] = [];
    const responses = [
      new Response(JSON.stringify({ id: "collection-1", name: "silto-label-preliminary-v1" }), {
        status: 200,
      }),
      new Response("{}", { status: 201 }),
      new Response(
        JSON.stringify({
          ids: [["chunk-1"]],
          documents: [["Synthetic official source text."]],
          metadatas: [[{ jurisdiction: "IT", source_state: "UNVERIFIED" }]],
          distances: [[0.12]],
        }),
        { status: 200 },
      ),
      new Response("{}", { status: 200 }),
      new Response("ok", { status: 200 }),
    ];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      const response = responses.shift();
      if (response === undefined) throw new Error("unexpected Chroma request");
      return response;
    };
    const chroma = new ChromaHttpVectorStore({
      endpoint: "http://10.90.0.10:8000",
      tenant: "silto",
      database: "label",
      token: "synthetic-chroma-token-123456",
      fetch,
    });

    const collection = await chroma.ensureCollection({
      name: "silto-label-preliminary-v1",
      metadata: { scope: "PRELIMINARY" },
    });
    await chroma.upsert({
      collection,
      records: [
        {
          id: "chunk-1",
          embedding: [0.1, 0.2],
          document: "Synthetic official source text.",
          metadata: { jurisdiction: "IT", source_state: "UNVERIFIED" },
        },
      ],
    });
    const matches = await chroma.query({
      collection,
      query: {
        embedding: [0.1, 0.2],
        limit: 5,
        where: { $and: [{ jurisdiction: { $eq: "IT" } }] },
      },
    });
    await chroma.delete({ collection, where: { source_version_id: { $eq: "source-version" } } });
    await chroma.heartbeat();

    expect(calls.map(({ input }) => input)).toEqual([
      "http://10.90.0.10:8000/api/v2/tenants/silto/databases/label/collections",
      "http://10.90.0.10:8000/api/v2/tenants/silto/databases/label/collections/collection-1/upsert",
      "http://10.90.0.10:8000/api/v2/tenants/silto/databases/label/collections/collection-1/query",
      "http://10.90.0.10:8000/api/v2/tenants/silto/databases/label/collections/collection-1/delete",
      "http://10.90.0.10:8000/api/v2/heartbeat",
    ]);
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      get_or_create: true,
      configuration: { hnsw: { space: "cosine" } },
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({
      ids: ["chunk-1"],
      embeddings: [[0.1, 0.2]],
    });
    expect(JSON.parse(String(calls[2]?.init?.body))).toMatchObject({
      query_embeddings: [[0.1, 0.2]],
      where: { $and: [{ jurisdiction: { $eq: "IT" } }] },
    });
    expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({
      where: { source_version_id: { $eq: "source-version" } },
    });
    expect(matches).toEqual([
      {
        id: "chunk-1",
        distance: 0.12,
        document: "Synthetic official source text.",
        metadata: { jurisdiction: "IT", source_state: "UNVERIFIED" },
      },
    ]);
  });
});
