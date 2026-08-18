import { describe, expect, it } from "vitest";

import { labelingTopicQueryValues, normalizeLabelingTopic } from "../../src/labeling-topic.js";

describe("normalizeLabelingTopic", () => {
  it("canonicalizes uppercase, spaces and underscores to kebab-case", () => {
    expect(normalizeLabelingTopic("ALLERGENS")).toBe("allergens");
    expect(normalizeLabelingTopic("Food information")).toBe("food-information");
    expect(normalizeLabelingTopic("allergens")).toBe("allergens");
  });

  it("keeps historical case variants for Chroma $contains filters", () => {
    expect(labelingTopicQueryValues("allergens")).toEqual(
      expect.arrayContaining(["allergens", "ALLERGENS"]),
    );
  });
});
