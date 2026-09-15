import {
  PRIVATE_LABEL_VERIFIED_COLLECTION,
  type ChromaMetadata,
  type ChromaVectorStore,
} from "@vera/rag";

export type SourceIndexProbe = Readonly<{
  heartbeatOk: boolean;
  collection: string;
  chunkCount: number;
  byJurisdiction: Readonly<Record<string, number>>;
  bySection: Readonly<Record<string, number>>;
  retrieved: readonly Readonly<{
    chunkId: string;
    jurisdiction: string;
    actReference: string;
    sectionTitle: string;
  }>[];
}>;

function metadataString(metadata: ChromaMetadata | null, key: string): string {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/**
 * Inventory of the verified Chroma collection. Uses metadata listing rather than
 * embeddings so production checks stay independent of OpenRouter.
 */
export async function probeVerifiedSourceIndex(
  chroma: ChromaVectorStore,
): Promise<SourceIndexProbe> {
  let heartbeatOk = false;
  try {
    await chroma.heartbeat();
    heartbeatOk = true;
  } catch {
    heartbeatOk = false;
  }
  const collection = await chroma.ensureCollection({
    name: PRIVATE_LABEL_VERIFIED_COLLECTION,
    metadata: { scope: "PRELIMINARY" },
  });
  const chunkCount = await chroma.count({ collection });
  const records = await chroma.get({ collection, limit: 1_000 });
  const byJurisdiction: Record<string, number> = {};
  const bySection: Record<string, number> = {};
  for (const record of records) {
    increment(byJurisdiction, metadataString(record.metadata, "jurisdiction") || "UNKNOWN");
    increment(bySection, metadataString(record.metadata, "section_id") || "UNKNOWN");
  }
  const retrieved = records
    .filter((record) => {
      const haystack = [
        record.document ?? "",
        metadataString(record.metadata, "act_reference"),
        metadataString(record.metadata, "section_id"),
        metadataString(record.metadata, "section_title"),
      ].join(" ");
      return /101\.12|Pastas, plain|56 g/iu.test(haystack);
    })
    .slice(0, 20)
    .map((record) => ({
      chunkId: record.id,
      jurisdiction: metadataString(record.metadata, "jurisdiction") || "UNKNOWN",
      actReference: metadataString(record.metadata, "act_reference") || "",
      sectionTitle: metadataString(record.metadata, "section_title") || "",
    }));
  return {
    heartbeatOk,
    collection: collection.name,
    chunkCount,
    byJurisdiction,
    bySection,
    retrieved,
  };
}
