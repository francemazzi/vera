import { describe, expect, it } from "vitest";

import { LABEL_FIELD_CODES } from "../../src/contracts.js";
import { createOpenRouterLabelEvaluator } from "../../src/openrouter-evaluator.js";
import type { LabelEvaluator } from "../../src/openrouter-evaluator.js";
import { fallbackRegulatoryScope } from "../../src/source-retriever.js";
import { preliminaryTemplate, sourceSnapshot } from "../fixtures/preliminary-template.js";

const retrieved = {
  chunkId: "00000000-0000-4000-8000-000000000201:art-7:0:aaaaaaaaaaaaaaaa",
  sourceVersionId: "00000000-0000-4000-8000-000000000201",
  sourceContentHash: "a".repeat(64),
  title: "Regolamento (UE) n. 1169/2011",
  documentType: "REGULATION",
  actReference: "Reg. (UE) 1169/2011",
  canonicalReference: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169",
  pdfReference: null,
  sectionId: "art-7",
  sectionTitle: "Pratiche leali",
  pageNumber: 12,
  quote: "Le informazioni sugli alimenti non inducono in errore il consumatore.",
} as const;

function outcomeFor(fieldCode: string): "PASS" | "FAIL" | "REVIEW" | "NOT_APPLICABLE" {
  if (fieldCode === "indicazioni_aggiuntive") return "FAIL";
  if (fieldCode === "indicazioni_ambientali") return "FAIL";
  if (fieldCode === "istruzioni_uso") return "PASS";
  if (fieldCode === "atmosfera_protettiva") return "NOT_APPLICABLE";
  if (fieldCode === "etichettatura_specifica_prodotto") return "REVIEW";
  return "REVIEW";
}

function lionsweetModelResponse(): Record<string, unknown> {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            controls: LABEL_FIELD_CODES.map((fieldCode) => ({
              fieldCode,
              outcome: outcomeFor(fieldCode),
              consultantStatus:
                outcomeFor(fieldCode) === "FAIL"
                  ? "NON_CONFORME"
                  : outcomeFor(fieldCode) === "PASS"
                    ? "CONFORME"
                    : outcomeFor(fieldCode) === "NOT_APPLICABLE"
                      ? "NON_APPLICABILE"
                      : "ATTENZIONE",
              rationale: "Synthetic LionSweet replay",
              confidence: 0.8,
              citationChunkIds:
                fieldCode === "indicazioni_aggiuntive" ||
                fieldCode === "indicazioni_ambientali" ||
                fieldCode === "istruzioni_uso"
                  ? [retrieved.chunkId]
                  : [],
              ...(fieldCode === "indicazioni_aggiuntive"
                ? { correctiveSuggestion: "Rimuovere il claim sullo strutto." }
                : {}),
            })),
          }),
        },
      },
    ],
  };
}

function evaluatorWith(fetch: typeof globalThis.fetch): LabelEvaluator {
  return createOpenRouterLabelEvaluator({
    apiKey: "synthetic-openrouter-key-1234",
    model: "google/gemini-2.5-flash",
    promptVersion: "label-evaluation-v2",
    rulePackVersion: "eu-it-preliminary-v1@2",
    sourceSnapshot,
    timeoutMs: 1_000,
    fetch,
  });
}

describe("LionSweet v2 acceptance", () => {
  it("applies lawfulness, applicability and does not force N/A on product-specific labelling", async () => {
    let requestBody: string | undefined;
    const fetch: typeof globalThis.fetch = (_input, init) => {
      requestBody = typeof init?.body === "string" ? init.body : undefined;
      return Promise.resolve(
        new Response(JSON.stringify(lionsweetModelResponse()), { status: 200 }),
      );
    };
    const citedFields = new Set([
      "indicazioni_aggiuntive",
      "indicazioni_ambientali",
      "istruzioni_uso",
    ]);
    const result = await evaluatorWith(fetch).evaluate({
      pages: [{ page: 1, bytes: new Uint8Array([137, 80, 78, 71]) }],
      countryCodes: ["IT"],
      productCategory: "confectionery",
      regulatoryScope: fallbackRegulatoryScope({ countryCodes: ["IT"] }),
      sources: {
        controls: LABEL_FIELD_CODES.map((fieldCode) => ({
          fieldCode,
          citations: citedFields.has(fieldCode) ? [retrieved] : [],
        })),
        sourceSnapshot,
      },
      template: {
        ...preliminaryTemplate,
        version: "2",
        promptVersion: "label-evaluation-v2",
        controls: preliminaryTemplate.controls.map((control) =>
          control.fieldCode === "biologico" ? control : { ...control, sectorSpecific: undefined },
        ),
      },
    });

    const byCode = Object.fromEntries(result.controls.map((control) => [control.fieldCode, control]));
    expect(byCode["indicazioni_aggiuntive"]?.outcome).toBe("FAIL");
    expect(byCode["indicazioni_ambientali"]?.outcome).toBe("FAIL");
    expect(byCode["istruzioni_uso"]?.outcome).toBe("PASS");
    expect(byCode["atmosfera_protettiva"]?.outcome).toBe("NOT_APPLICABLE");
    expect(byCode["etichettatura_specifica_prodotto"]?.outcome).not.toBe("NOT_APPLICABLE");
    expect(JSON.stringify(requestBody)).toContain("product category confectionery");
    expect(JSON.stringify(requestBody)).toContain("Do not invent Directive 2000/36/EC");
    expect(JSON.stringify(requestBody)).not.toContain("Menu EU law");
    expect(JSON.stringify(result.controls)).not.toContain("Menu EU law");
  });
});
