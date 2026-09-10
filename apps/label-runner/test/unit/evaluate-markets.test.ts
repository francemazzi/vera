import { describe, expect, it, vi } from "vitest";
import { evaluateMarkets } from "../../src/evaluate-markets.js";
import type { LabelEvaluator } from "../../src/openrouter-evaluator.js";
import type { RunnerEvaluation } from "../../src/contracts.js";
import { preliminaryTemplate } from "../fixtures/preliminary-template.js";

// Synthetic fixtures: client artwork and reviewed conclusions remain in the private domain dataset.
describe("independent product and destination evaluation", () => {
  it("keeps five SKU pages separate and retains conflicting destination outcomes and corrections", async () => {
    const template = {
      ...preliminaryTemplate,
      version: "3" as const,
      promptVersion: "label-evaluation-v5" as const,
    };
    const products = Array.from({ length: 5 }, (_, index) => ({
      id: `sku-${index + 1}`,
      name: `Product ${index + 1}`,
      category: "coffee" as const,
      pages: [index + 1],
      facts: [
        {
          field: "denomination",
          text: `Coffee ${index + 1}`,
          status: "OBSERVED" as const,
          evidence: [],
        },
      ],
    }));
    const evaluate = vi.fn<LabelEvaluator["evaluate"]>(async (input): Promise<RunnerEvaluation> => {
      expect(input.productFacts?.products).toHaveLength(1);
      expect(input.pages.map((page) => page.page)).toEqual(input.productFacts!.products[0]!.pages);
      const isSaudi: boolean = input.countryCodes[0] === "SA";
      return {
        provider: "openrouter",
        model: "google/gemini-2.5-flash",
        promptVersion: "label-evaluation-v5",
        rulePackVersion: "global-food-label-preliminary-v1@3",
        sourceSnapshot: "a".repeat(64),
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          estimatedCostUsd: 0.01,
          latencyMs: 10,
        },
        controls: template.controls.map(({ fieldCode }) => ({
          fieldCode,
          outcome: isSaudi ? "REVIEW" : "FAIL",
          consultantStatus: "ATTENZIONE",
          confidence: 0,
          rationale: `${input.focusedProductId} ${input.countryCodes[0]}`,
          correctiveSuggestion: `${input.focusedProductId}: ${"Complete corrective wording. ".repeat(30)}`,
          citations: [],
          boundingBox: { page: input.pages[0]!.page, ymin: 0, xmin: 0, ymax: 100, xmax: 100 },
        })),
      };
    });
    const result = await evaluateMarkets(
      { evaluate },
      {
        template,
        productFacts: { products },
        countryCodes: ["SA", "US"],
        productCategory: "coffee",
        pages: products.map((product) => ({ page: product.pages[0]!, bytes: new Uint8Array([1]) })),
        regulatoryScope: {
          regulatoryAreas: ["ASIA", "AMERICA"],
          jurisdictions: ["SA", "US"],
          language: "en",
          evaluationDate: "2026-09-09T00:00:00.000Z",
          marketScopes: ["SA", "US"].map((countryCode) => ({
            countryCode,
            jurisdictions: [countryCode],
            language: "en",
            evaluationDate: "2026-09-09T00:00:00.000Z",
          })),
        },
        sources: {
          sourceSnapshot: "a".repeat(64),
          controls: template.controls.map(({ fieldCode }) => ({ fieldCode, citations: [] })),
        },
      },
    );
    expect(evaluate).toHaveBeenCalledTimes(10);
    expect(result.usage.totalTokens).toBe(300);
    for (const control of result.controls) {
      expect(control.outcome).toBe("FAIL");
      expect(control.marketFeedback).toHaveLength(10);
      expect(
        new Set(control.marketFeedback!.map((row) => `${row.productId}:${row.market}`)).size,
      ).toBe(10);
      for (const row of control.marketFeedback!) {
        expect(row.outcome).toBe(row.market === "SA" ? "REVIEW" : "FAIL");
        expect(row.correctiveSuggestion!.length).toBeGreaterThan(500);
        expect(row.boundingBox?.page).toBe(Number(row.productId!.slice(4)));
      }
    }
  });
});
