import { describe, expect, it } from "vitest";

import { chunkApprovedSourceSections, citationFromChunk } from "../../src/index.js";
import { section } from "../fixtures/rag.js";

describe("chunkApprovedSourceSections", () => {
  it("creates deterministic approved chunks with source/version/section metadata", () => {
    const text = Array.from(
      { length: 8 },
      (_, index) => `Sentence ${String(index)} retention label.`,
    )
      .join(" ")
      .repeat(4);
    const chunks = chunkApprovedSourceSections([section({ text })], {
      maxChars: 240,
      overlapChars: 30,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toMatchObject({
      sourceState: "APPROVED",
      sourceVersionId: section().sourceVersionId,
      sectionId: "section-1",
      validationScope: "TECHNICAL_DEMO",
    });
    expect(chunks.map((chunk) => chunk.contentHash)).toEqual(
      chunkApprovedSourceSections([section({ text })], {
        maxChars: 240,
        overlapChars: 30,
      }).map((chunk) => chunk.contentHash),
    );
  });

  it("rejects non-approved source sections before indexing", () => {
    expect(() => chunkApprovedSourceSections([section({ sourceState: "REVIEWED" })])).toThrow(
      "Only APPROVED source versions may be indexed",
    );
  });

  it("builds bounded citations from chunks", () => {
    const chunk = chunkApprovedSourceSections([section({ text: "A".repeat(500) })])[0];
    if (chunk === undefined) throw new Error("expected a chunk");
    const citation = citationFromChunk(chunk);
    expect(citation.quote.length).toBeLessThanOrEqual(280);
    expect(citation.sourceContentHash).toBe(chunk.sourceContentHash);
  });
});
