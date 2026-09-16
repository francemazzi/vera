import { describe, expect, it } from "vitest";
import { applyUsPastaNutritionGuard } from "../../src/guard-us-pasta-nutrition.js";
import { usPastaReplayCitations } from "../../src/us-pasta-replay-citations.js";
import { currentControlChecks } from "../../src/current-control-checks.js";
import { overlayInstructionsForMarket } from "../../src/market-overlay.js";

const citations = usPastaReplayCitations().filter((item) => item.chunkId.includes("101-12"));

function control(outcome: "PASS" | "REVIEW") {
  return {
    fieldCode: "informazioni_nutrizionali",
    outcome,
    consultantStatus: outcome === "PASS" ? ("CONFORME" as const) : ("ATTENZIONE" as const),
    rationale: "Nutrition Facts present.",
    confidence: 0.4,
    citations,
  };
}

describe("US pasta nutrition guard", () => {
  it("fails a 55 g dry-pasta serving when 21 CFR 101.12 is cited", () => {
    const result = applyUsPastaNutritionGuard({
      control: control("PASS"),
      productFacts: {
        products: [
          {
            name: "Tagliolini",
            facts: [
              {
                text: "Serving size 2 oz (55g) extra thin durum wheat egg pasta",
              },
            ],
          },
        ],
      },
    });
    expect(result.outcome).toBe("FAIL");
    expect(result.consultantStatus).toBe("NON_CONFORME");
    expect(result.correctiveSuggestion).toContain("56 g");
    expect(result.assessment?.blocker).toBeUndefined();
    expect(result.assessment?.actions.some((action) => action.kind === "REPLACE")).toBe(true);
  });

  it("marks EU-only US controls as not applicable and fails GGG date wording", () => {
    const environmental = applyUsPastaNutritionGuard({
      control: {
        fieldCode: "indicazioni_ambientali",
        outcome: "REVIEW",
        consultantStatus: "ATTENZIONE",
        rationale: "Italian recycling marks.",
        confidence: 0.2,
        citations: [],
      },
      countryCode: "US",
    });
    expect(environmental.consultantStatus).toBe("NON_APPLICABILE");
    expect(environmental.assessment?.applicability).toBe("EXEMPT");
    expect(environmental.assessment?.blocker).toBeUndefined();
    const origin = applyUsPastaNutritionGuard({
      control: {
        fieldCode: "origine_ingrediente_primario",
        outcome: "REVIEW",
        consultantStatus: "ATTENZIONE",
        rationale: "Wheat origin printed.",
        confidence: 0.2,
        citations: [],
      },
      countryCode: "US",
    });
    expect(origin.consultantStatus).toBe("NON_APPLICABILE");
    const dated = applyUsPastaNutritionGuard({
      control: {
        fieldCode: "termine_minimo_conservazione_data_scadenza",
        outcome: "REVIEW",
        consultantStatus: "ATTENZIONE",
        rationale: "BEST BEFORE 12/2027.",
        confidence: 0.2,
        citations: [],
      },
      retrievedCitations: usPastaReplayCitations().filter((item) => item.chunkId.includes("ab-660")),
    });
    expect(dated.consultantStatus).toBe("NON_CONFORME");
    expect(dated.correctiveSuggestion).toMatch(/BEST if Used by/u);
  });

  it("uses retrieved 21 CFR 101.12 excerpts when the model omitted citation ids", () => {
    const result = applyUsPastaNutritionGuard({
      control: { ...control("REVIEW"), citations: [] },
      retrievedCitations: citations,
      productFacts: {
        products: [
          {
            name: "Tagliolini",
            facts: [{ text: "Serving size 2 oz (55g) extra thin durum wheat egg pasta" }],
          },
        ],
      },
    });
    expect(result.outcome).toBe("FAIL");
  });

  it("does not invent a pasta serving failure without the cited RACC excerpt", () => {
    const result = applyUsPastaNutritionGuard({
      control: { ...control("REVIEW"), citations: [] },
      productFacts: {
        products: [
          {
            name: "Tagliolini",
            facts: [{ text: "Serving size 2 oz (55g) pasta" }],
          },
        ],
      },
    });
    expect(result.outcome).toBe("REVIEW");
  });

  it("fails missing PDP net quantity and contradictory drying-time claims", () => {
    const net = applyUsPastaNutritionGuard({
      control: {
        fieldCode: "quantita_netto_volume_nominale",
        outcome: "REVIEW",
        consultantStatus: "ATTENZIONE",
        rationale: "Net quantity is on the body, not the lid.",
        confidence: 0.3,
        citations: [],
      },
      retrievedCitations: usPastaReplayCitations().filter((item) => item.chunkId.includes("101-7")),
      productFacts: {
        products: [{ name: "Tagliolini", facts: [{ text: "Lid is the principal display panel." }] }],
      },
    });
    expect(net.consultantStatus).toBe("NON_CONFORME");
    const claimed = applyUsPastaNutritionGuard({
      control: {
        fieldCode: "indicazioni_aggiuntive",
        outcome: "REVIEW",
        consultantStatus: "ATTENZIONE",
        rationale: "Slow dried 18 hours versus 14 ore.",
        confidence: 0.3,
        citations: [],
      },
      retrievedCitations: usPastaReplayCitations().filter((item) => item.chunkId.includes("101-15")),
      productFacts: {
        products: [{ name: "Tagliolini", facts: [{ text: "Dried 18 hours / 14 ore." }] }],
      },
    });
    expect(claimed.consultantStatus).toBe("NON_CONFORME");
    const retailEighteen = applyUsPastaNutritionGuard({
      control: {
        fieldCode: "indicazioni_aggiuntive",
        outcome: "REVIEW",
        consultantStatus: "ATTENZIONE",
        rationale: "Slow dried 18 hours.",
        confidence: 0.3,
        citations: [],
      },
      retrievedCitations: usPastaReplayCitations().filter((item) => item.chunkId.includes("101-15")),
      productFacts: {
        products: [{ name: "Pappardelle Classica BIO 250 g", facts: [{ text: "Slow dried 18 hours." }] }],
      },
    });
    expect(retailEighteen.consultantStatus).toBe("NON_CONFORME");
    const retailWithoutHours = applyUsPastaNutritionGuard({
      control: {
        fieldCode: "indicazioni_aggiuntive",
        outcome: "REVIEW",
        consultantStatus: "ATTENZIONE",
        rationale: "Optional claims present.",
        confidence: 0.3,
        citations: [],
      },
      retrievedCitations: usPastaReplayCitations().filter((item) => item.chunkId.includes("101-15")),
      productFacts: {
        products: [{ name: "Pappardelle Classica BIO 250 g", facts: [{ text: "Egg pasta." }] }],
      },
    });
    expect(retailWithoutHours.consultantStatus).toBe("NON_CONFORME");
    const vision = applyUsPastaNutritionGuard({
      control: {
        fieldCode: "campo_visivo",
        outcome: "PASS",
        consultantStatus: "CONFORME",
        rationale: "Identity is on the lid.",
        confidence: 0.7,
        citations: [],
      },
      productFacts: {
        products: [{ name: "Pappardelle Classica BIO 250 g", facts: [{ text: "Egg pasta." }] }],
      },
    });
    expect(vision.consultantStatus).toBe("ATTENZIONE");
  });

  it("marks dry-pasta storage and use instructions as not applicable in the US", () => {
    const storage = applyUsPastaNutritionGuard({
      control: {
        fieldCode: "condizioni_particolari_conservazione",
        outcome: "REVIEW",
        consultantStatus: "ATTENZIONE",
        rationale: "No storage statement.",
        confidence: 0.2,
        citations: [],
      },
      countryCode: "US",
    });
    expect(storage.consultantStatus).toBe("NON_APPLICABILE");
    const use = applyUsPastaNutritionGuard({
      control: {
        fieldCode: "istruzioni_uso",
        outcome: "REVIEW",
        consultantStatus: "ATTENZIONE",
        rationale: "No cooking instructions.",
        confidence: 0.2,
        citations: [],
      },
      countryCode: "US",
    });
    expect(use.consultantStatus).toBe("NON_APPLICABILE");
  });

  it("fails net quantity on a 250 g lid pack even when the model called it PASS", () => {
    const net = applyUsPastaNutritionGuard({
      control: {
        fieldCode: "quantita_netto_volume_nominale",
        outcome: "PASS",
        consultantStatus: "CONFORME",
        rationale: "Net weight is present on the pack.",
        confidence: 0.6,
        citations: [],
      },
      retrievedCitations: usPastaReplayCitations().filter((item) => item.chunkId.includes("101-7")),
      productFacts: {
        products: [{ name: "Pappardelle Classica BIO 250 g", facts: [{ text: "Durum wheat egg pasta." }] }],
      },
    });
    expect(net.consultantStatus).toBe("NON_CONFORME");
    const nutrition = applyUsPastaNutritionGuard({
      control: {
        fieldCode: "informazioni_nutrizionali",
        outcome: "REVIEW",
        consultantStatus: "ATTENZIONE",
        rationale: "Nutrition Facts present.",
        confidence: 0.4,
        citations: [],
      },
      retrievedCitations: usPastaReplayCitations().filter((item) => item.chunkId.includes("101-12")),
      productFacts: {
        products: [{ name: "Tagliarelle Classica BIO 250 g", facts: [{ text: "Egg pasta." }] }],
      },
    });
    expect(nutrition.consultantStatus).toBe("NON_CONFORME");
    const date = applyUsPastaNutritionGuard({
      control: {
        fieldCode: "termine_minimo_conservazione_data_scadenza",
        outcome: "REVIEW",
        consultantStatus: "ATTENZIONE",
        rationale: "A date is present.",
        confidence: 0.4,
        citations: [],
      },
      retrievedCitations: usPastaReplayCitations().filter((item) => item.chunkId.includes("ab-660")),
      productFacts: {
        products: [{ name: "Tagliarelle Classica BIO 250 g", facts: [{ text: "Egg pasta." }] }],
      },
    });
    expect(date.consultantStatus).toBe("NON_CONFORME");
  });
});

describe("US overlay is category-aware", () => {
  it("keeps olive-oil ingredient wording conditional", () => {
    expect(overlayInstructionsForMarket("US")["elenco_ingredienti"]).toContain("olive oil");
    expect(overlayInstructionsForMarket("US")["elenco_ingredienti"]).toContain("Never apply");
    expect(overlayInstructionsForMarket("US", { isOliveOil: false })["elenco_ingredienti"]).not.toMatch(
      /EXTRA VIRGIN OLIVE OIL/u,
    );
    expect(currentControlChecks("generic-prepacked", "US")["informazioni_nutrizionali"]).toContain(
      "56 g",
    );
    expect(currentControlChecks("generic-prepacked", "US")["elenco_ingredienti"]).not.toMatch(
      /require the explicit statement “INGREDIENTS: EXTRA VIRGIN OLIVE OIL” on the information panel\. Its absence is ATTENZIONE\.$/u,
    );
  });
});
