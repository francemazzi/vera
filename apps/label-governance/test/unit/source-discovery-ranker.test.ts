import { describe, expect, it, vi } from "vitest";

import { createOpenRouterSourceDiscoveryRanker } from "../../src/source-discovery-ranker.js";
import type { SourceDiscoveryRanker } from "../../src/source-discovery-ranker.js";

const ranking = {
  shouldPropose: true,
  rationale: "The title is relevant to food allergen labeling.",
  documentType: "REGULATION",
  actReference: "Synthetic 1/2026",
  revisionLabel: null,
  language: "it",
  productCategories: ["Food"],
  labelingTopics: ["allergens"],
  evidence: [{ quote: "Food allergen labeling", pageNumber: null }],
};

const input: Parameters<SourceDiscoveryRanker["rank"]>[0] = {
  authorityName: "Synthetic Official Gazette",
  jurisdictionCode: "IT",
  sourceTitle: "Food allergen labeling",
  officialSearchEvidence: "Food allergen labeling",
  discoveryQuery: "food allergens",
  scope: {
    marketCountryCode: "IT",
    regulatoryAreas: ["EU" as const],
    productCategory: "Prepacked food",
    evaluationDate: "2026-07-20",
    language: "it",
    templateVersion: "food-label-v1",
    requiredTopics: ["allergens"],
  },
};

describe("OpenRouter source-discovery ranker", () => {
  it("uses strict JSON ranking without a URL-bearing model field", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "google/gemini-2.5-pro",
          choices: [{ message: { content: JSON.stringify(ranking) } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const ranker = createOpenRouterSourceDiscoveryRanker({
      apiKey: "test-key",
      timeoutMs: 1_000,
      fetch,
    });

    await expect(ranker.rank(input)).resolves.toMatchObject({
      ranking,
      model: "google/gemini-2.5-pro",
    });
    const request = fetch.mock.calls[0]?.[1];
    expect(request).toMatchObject({ method: "POST" });
    if (typeof request?.body !== "string") throw new Error("Expected a JSON string request body");
    const parsed: unknown = JSON.parse(request.body);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Expected a JSON object request body");
    }
    const body = parsed as Record<string, unknown>;
    expect(JSON.stringify(body["response_format"])).not.toContain("url");
    expect(JSON.stringify(body["messages"])).not.toContain("https://");
  });

  it("rejects a provider route that returns a different model", async () => {
    const ranker = createOpenRouterSourceDiscoveryRanker({
      apiKey: "test-key",
      timeoutMs: 1_000,
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            model: "other/provider-model",
            choices: [{ message: { content: JSON.stringify(ranking) } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    });

    await expect(ranker.rank(input)).rejects.toMatchObject({ retryable: false });
  });
});
