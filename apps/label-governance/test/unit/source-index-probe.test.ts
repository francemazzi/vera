import { describe, expect, it } from "vitest";
import { probeVerifiedSourceIndex } from "../../src/source-index-probe.js";
import type {
  ChromaCollection,
  ChromaMetadata,
  ChromaVectorMatch,
  ChromaVectorStore,
} from "@vera/rag";

class FakeChromaStore implements ChromaVectorStore {
  public constructor(
    private readonly records: readonly ChromaVectorMatch[],
  ) {}

  public ensureCollection(input: {
    readonly name: string;
    readonly metadata: ChromaMetadata;
  }): Promise<ChromaCollection> {
    return Promise.resolve({ id: `collection-${input.name}`, name: input.name });
  }

  public upsert(): Promise<void> {
    return Promise.resolve();
  }

  public delete(): Promise<void> {
    return Promise.resolve();
  }

  public query(): Promise<readonly ChromaVectorMatch[]> {
    return Promise.resolve([]);
  }

  public get(): Promise<readonly ChromaVectorMatch[]> {
    return Promise.resolve(this.records);
  }

  public count(): Promise<number> {
    return Promise.resolve(this.records.length);
  }

  public heartbeat(): Promise<void> {
    return Promise.resolve();
  }
}

describe("verified source index probe", () => {
  it("counts jurisdictions and filters 21 CFR 101.12 pasta rows", async () => {
    const chroma = new FakeChromaStore([
      {
        id: "us-101-12",
        distance: null,
        document: "21 CFR 101.12 — Pastas, plain 55 g 2 oz (56 g/visual unit)",
        metadata: {
          jurisdiction: "US",
          section_id: "101.12",
          act_reference: "21 CFR 101.12",
          section_title: "Table 2 — Pastas, plain",
        },
      },
      {
        id: "it-art-9",
        distance: null,
        document: "Articolo 9 indicazioni obbligatorie",
        metadata: {
          jurisdiction: "IT",
          section_id: "art-9",
          act_reference: "Reg. (UE) 1169/2011",
          section_title: "Articolo 9",
        },
      },
    ]);
    const probe = await probeVerifiedSourceIndex(chroma);
    expect(probe.heartbeatOk).toBe(true);
    expect(probe.collection).toBe("silto-label-verified-v1");
    expect(probe.chunkCount).toBe(2);
    expect(probe.byJurisdiction).toEqual({ US: 1, IT: 1 });
    expect(probe.retrieved.map((item) => item.chunkId)).toEqual(["us-101-12"]);
  });
});
