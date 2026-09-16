import { describe, expect, it } from "vitest";
import { CIPRIANI_PASTA_GOLD_CASES } from "../../src/cipriani-pasta-gold.js";
import { scoreCiprianiPastaCase } from "../../src/cipriani-pasta-score.js";
import { LABEL_FIELD_CODES } from "../../src/contracts.js";

describe("Cipriani pasta gold mapping", () => {
  it("covers thirteen SKUs with hold-out split and every field code", () => {
    expect(CIPRIANI_PASTA_GOLD_CASES).toHaveLength(13);
    expect(CIPRIANI_PASTA_GOLD_CASES.filter((item) => item.split === "holdout").map((item) => item.id)).toEqual(
      ["cipriani-tagliarelle-spinaci-250g", "cipriani-pappardelle-white-1_5kg"],
    );
    for (const item of CIPRIANI_PASTA_GOLD_CASES) {
      expect(new Set(Object.keys(item.expected))).toEqual(new Set(LABEL_FIELD_CODES));
    }
  });

  it("never uses hold-out SKUs as few-shot examples", async () => {
    const { ciprianiPastaCalibrationExamples } = await import(
      "../../src/cipriani-pasta-calibration-examples.js"
    );
    const examples = ciprianiPastaCalibrationExamples();
    expect(examples.length).toBeGreaterThan(0);
    expect(examples.length).toBeLessThanOrEqual(8);
    expect(examples.every((item) => item.countryCode === "US")).toBe(true);
    expect(examples.some((item) => item.rationale.includes("Tagliarelle Spinaci"))).toBe(false);
    expect(examples.some((item) => item.rationale.includes("Pappardelle White"))).toBe(false);
  });

  it("scores serving-size recall from corrective wording", () => {
    const gold = CIPRIANI_PASTA_GOLD_CASES[0]!;
    const score = scoreCiprianiPastaCase({
      gold,
      predicted: gold.expected,
      controls: [
        {
          fieldCode: "informazioni_nutrizionali",
          consultantStatus: "NON_CONFORME",
          rationale: "Serving size 2 oz (55g) is wrong.",
          correctiveSuggestion: "Use Serving size 2 oz (56 g/nest) and recalculate Nutrition Facts.",
        },
        {
          fieldCode: "termine_minimo_conservazione_data_scadenza",
          consultantStatus: "NON_CONFORME",
          rationale: "BEST BEFORE conflicts with GGG AB 660.",
          correctiveSuggestion: "Replace with BEST if Used by.",
        },
        {
          fieldCode: "quantita_netto_volume_nominale",
          consultantStatus: "NON_CONFORME",
          rationale: "Net weight missing from the PDP.",
          correctiveSuggestion: "Place NET WEIGHT on the principal display panel.",
        },
        {
          fieldCode: "indicazioni_aggiuntive",
          consultantStatus: "NON_CONFORME",
          rationale: "18 hours drying contradicts 14 ore.",
          correctiveSuggestion: "Remove the contradictory drying time claim.",
        },
      ],
    });
    expect(score.agreement).toBe(1);
    expect(score.blockingRecall).toBe(1);
    const statusOnly = scoreCiprianiPastaCase({
      gold,
      predicted: gold.expected,
      controls: Object.entries(gold.expected).map(([fieldCode, consultantStatus]) => ({
        fieldCode,
        consultantStatus,
        rationale: "Status-only replay row.",
      })),
    });
    expect(statusOnly.blockingRecall).toBe(1);
    expect(score.falseEuFailures).toEqual([]);
  });
});
