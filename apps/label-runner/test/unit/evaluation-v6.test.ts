import { describe, expect, it, vi } from "vitest";
import { LABEL_FIELD_CODES } from "../../src/contracts.js";
import { fallbackRegulatoryScope } from "../../src/fallback-regulatory-scope.js";
import { createOpenRouterLabelEvaluator } from "../../src/openrouter-evaluator.js";
import type { LabelEvaluator } from "../../src/openrouter-evaluator.js";
import { preliminaryTemplate, sourceSnapshot } from "../fixtures/preliminary-template.js";

const FIELD = "elenco_ingredienti";
const REGION = { page: 3, ymin: 100, xmin: 220, ymax: 130, xmax: 420 };
const ASSESSMENT = {
  applicability: "UNRESOLVED",
  observation: "OBSERVED",
  actions: [],
  blocker: {
    owner: "INTERNAL",
    code: "SOURCE_MISSING",
    detail: "Serve la disposizione pertinente alla dichiarazione osservata.",
  },
} as const;

function input(): Parameters<LabelEvaluator["evaluate"]>[0] {
  const samePageOtherProduct = {
    id: "other-sku",
    name: "Other SKU",
    category: "beverages" as const,
    pages: [3],
    facts: [
      { field: FIELD, text: "Other product", status: "OBSERVED" as const, evidence: [REGION] },
    ],
  };
  return {
    template: {
      ...preliminaryTemplate,
      id: "global-food-label-preliminary-v1",
      version: "3",
      promptVersion: "label-evaluation-v6",
    },
    pages: [{ page: 3, bytes: new Uint8Array([137, 80, 78, 71]) }],
    countryCodes: ["IT"],
    focusedProductId: "sku",
    productCategory: "beverages",
    regulatoryScope: fallbackRegulatoryScope({ countryCodes: ["IT"] }),
    sources: { controls: [], sourceSnapshot },
    productFacts: {
      products: [
        {
          id: "sku",
          name: "Synthetic drink",
          category: "beverages",
          pages: [3],
          facts: [
            {
              field: FIELD,
              text: "Ingredienti: acqua e orzo",
              status: "OBSERVED",
              evidence: [REGION],
            },
            { field: "allergeni", text: "Orzo", status: "OBSERVED", evidence: [REGION] },
            {
              field: FIELD,
              text: "Scheda tecnica",
              status: "OBSERVED",
              evidence: [{ ...REGION, documentId: "12345678-abcd-4321-abcd-123456789abc" }],
            },
          ],
        },
        samePageOtherProduct,
      ],
    },
  };
}

function controls(overrides: Readonly<Record<string, unknown>> = {}) {
  return LABEL_FIELD_CODES.map((fieldCode) => ({
    fieldCode,
    outcome: "REVIEW",
    consultantStatus: "ATTENZIONE",
    rationale: `Controllo ${fieldCode} in attesa della fonte.`,
    confidence: 0.7,
    assessment: ASSESSMENT,
    ...(fieldCode === FIELD ? overrides : {}),
  }));
}

function evaluator(output: ReturnType<typeof controls>) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ choices: [{ message: { content: JSON.stringify({ controls: output }) } }] }),
  );
  return {
    fetch,
    service: createOpenRouterLabelEvaluator({
      apiKey: "synthetic-only",
      model: "google/gemini-2.5-flash",
      timeoutMs: 1_000,
      fetch,
    }),
  };
}

describe("label evaluation v6", () => {
  it.each([undefined, { ...ASSESSMENT, actions: undefined }])(
    "fails the run once for a missing assessment or action list",
    async (assessment) => {
      const { service, fetch } = evaluator(controls({ assessment }));
      await expect(service.evaluate(input())).rejects.toMatchObject({
        failureCode: "EVALUATION_CONTRACT_INVALID",
        retryable: false,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("uses the focused SKU's observed artwork with a margin and keeps the specific review reason", async () => {
    const { service, fetch } = evaluator(controls({ evidence: { factIndex: 0, regionIndex: 0 } }));
    const result = await service.evaluate(input());
    const request = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      messages: { content: string }[];
    };
    expect(request.messages[0]?.content).toContain('"assessment":{"applicability":');
    expect(result.controls).toHaveLength(24);
    expect(result.controls.find(({ fieldCode }) => fieldCode === FIELD)).toMatchObject({
      outcome: "REVIEW",
      assessment: { blocker: ASSESSMENT.blocker },
      observedText: "Ingredienti: acqua e orzo",
      boundingBox: { page: 3, ymin: 94, xmin: 196, ymax: 136, xmax: 444 },
    });
  });

  it.each([1, 2, 3])("drops nonmatching, documentary or unknown region %i", async (factIndex) => {
    const { service } = evaluator(
      controls({ evidence: { factIndex, regionIndex: 0 }, boundingBox: REGION }),
    );
    const result = await service.evaluate(input());
    const control = result.controls.find(({ fieldCode }) => fieldCode === FIELD);
    expect(control).toBeDefined();
    expect(control).not.toHaveProperty("boundingBox");
    expect(control).not.toHaveProperty("observedText");
  });
});
