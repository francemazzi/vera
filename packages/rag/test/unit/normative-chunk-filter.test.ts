import { describe, expect, it } from "vitest";

import { hasNormativeSignal } from "../../src/normative-chunk-filter.js";
import {
  PRIVATE_LABEL_GOLD_COLLECTION,
  isPrivateLabelGoldCollection,
  isPrivateLabelLegalCollection,
} from "../../src/private-label-gold-collection.js";
import { PRIVATE_LABEL_VERIFIED_COLLECTION } from "../../src/private-label-rag-types.js";

describe("normative chunk filter", () => {
  it("keeps act text and drops EUR-Lex portal chrome", () => {
    expect(
      hasNormativeSignal("Art. 7 Le informazioni sugli alimenti non inducono in errore."),
    ).toBe(true);
    expect(hasNormativeSignal("Menu EU law ELI background Quick search")).toBe(false);
    expect(hasNormativeSignal("Normattiva navigazione del portale")).toBe(false);
  });
});

describe("private label gold collection", () => {
  it("never shares the verified legal collection name", () => {
    expect(PRIVATE_LABEL_GOLD_COLLECTION).toBe("silto-label-gold-v1");
    expect(PRIVATE_LABEL_GOLD_COLLECTION).not.toBe(PRIVATE_LABEL_VERIFIED_COLLECTION);
    expect(isPrivateLabelGoldCollection(PRIVATE_LABEL_GOLD_COLLECTION)).toBe(true);
    expect(isPrivateLabelLegalCollection(PRIVATE_LABEL_VERIFIED_COLLECTION)).toBe(true);
    expect(isPrivateLabelLegalCollection(PRIVATE_LABEL_GOLD_COLLECTION)).toBe(false);
  });
});
