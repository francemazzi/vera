import { describe, expect, it } from "vitest";
import { guardControlAssessment } from "../../src/guard-control-assessment.js";
import { ControlAssessmentSchema } from "../../src/control-assessment-schema.js";
import { ProductFactsSchema } from "../../src/product-facts-schema.js";
import { currentControlChecks } from "../../src/current-control-checks.js";
import { EvaluationRunnerControlSchema } from "../../src/contracts.js";

const assessment = ControlAssessmentSchema.parse({
  applicability: "APPLICABLE",
  observation: "OBSERVED",
  actions: [],
});
describe("evidence-backed v3 decisions", () => {
  it("preserves all twelve long corrective actions through the callback contract", () => {
    const result = guardControlAssessment({
      fieldCode: "informazioni_nutrizionali",
      outcome: "REVIEW",
      citedIds: [],
      requestedIds: [],
      assessment: {
        ...assessment,
        blocker: {
          owner: "CLIENT",
          code: "PRODUCT_DATA_MISSING",
          detail: "Specific analytical values needed",
        },
        actions: Array.from({ length: 12 }, (_, index) => ({
          kind: "REQUEST_DATA" as const,
          location: "L".repeat(500),
          text: `${index}: ${"T".repeat(3900)}`,
          condition: "C".repeat(1000),
          citationChunkIds: [],
        })),
      },
    });
    const parsed = EvaluationRunnerControlSchema.parse({
      fieldCode: "informazioni_nutrizionali",
      outcome: "REVIEW",
      rationale: "Product data missing",
      confidence: 0,
      correctiveSuggestion: result.correction,
      assessment: result.assessment,
    });
    expect(parsed.correctiveSuggestion).toHaveLength(result.correction.length);
    expect(parsed.correctiveSuggestion!.length).toBeGreaterThan(60_000);
    expect(parsed.correctiveSuggestion).toContain("11: T");
  });
  it("keeps unimplemented vertical categories in internal review despite an apparent citation", () => {
    const result = guardControlAssessment({
      fieldCode: "etichettatura_specifica_prodotto",
      productCategory: "dairy",
      outcome: "NOT_APPLICABLE",
      citedIds: ["general-source"],
      requestedIds: ["general-source"],
      assessment: {
        ...assessment,
        applicability: "EXEMPT",
        conditions: "Model proposed exemption",
      },
    });
    expect(result.requiresReview).toBe(true);
    expect(result.assessment.blocker).toMatchObject({
      owner: "INTERNAL",
      code: "UNIMPLEMENTED_CATEGORY",
    });
  });
  it("does not turn an unverified coffee exemption into non-applicability", () => {
    const result = guardControlAssessment({
      fieldCode: "informazioni_nutrizionali",
      outcome: "NOT_APPLICABLE",
      citedIds: [],
      requestedIds: [],
      assessment: { ...assessment, applicability: "EXEMPT" },
    });
    expect(result.requiresReview).toBe(true);
    expect(result.assessment.blocker?.owner).toBe("INTERNAL");
  });
  it("accepts a sourced exemption with conditions retained in the action", () => {
    const result = guardControlAssessment({
      fieldCode: "informazioni_nutrizionali",
      outcome: "NOT_APPLICABLE",
      citedIds: ["source-2021"],
      requestedIds: ["source-2021"],
      assessment: {
        ...assessment,
        applicability: "EXEMPT",
        conditions: "Solo prodotto monoingrediente senza claim nutrizionali",
        actions: [],
      },
    });
    expect(result.requiresReview).toBe(false);
    expect(result.correction).toContain("monoingrediente");
  });
  it("rejects a fabricated citation even when another selected citation exists", () => {
    expect(
      guardControlAssessment({
        fieldCode: "elenco_ingredienti",
        outcome: "PASS",
        citedIds: ["real"],
        requestedIds: ["real", "invented"],
        assessment,
      }).requiresReview,
    ).toBe(true);
  });
  it("cannot certify physical character dimensions from a scaled image", () => {
    const result = guardControlAssessment({
      fieldCode: "altezza_minima_caratteri",
      outcome: "PASS",
      citedIds: ["real"],
      requestedIds: ["real"],
      assessment,
    });
    expect(result.assessment.blocker?.code).toBe("SCALE_UNVERIFIED");
  });
  it("does not substitute an unimplemented category with non-applicability", () => {
    expect(
      guardControlAssessment({
        fieldCode: "etichettatura_specifica_prodotto",
        outcome: "NOT_APPLICABLE",
        citedIds: [],
        requestedIds: [],
        assessment: { ...assessment, applicability: "FACTUALLY_NOT_APPLICABLE" },
      }).requiresReview,
    ).toBe(true);
  });
  it("requires an actionable sourced correction for FAIL", () => {
    expect(
      guardControlAssessment({
        fieldCode: "elenco_ingredienti",
        outcome: "FAIL",
        citedIds: ["real"],
        requestedIds: ["real"],
        assessment,
      }).requiresReview,
    ).toBe(true);
  });
  it("keeps legal research internal and rejects invented regions for absent facts", () => {
    expect(
      ControlAssessmentSchema.safeParse({
        ...assessment,
        blocker: { owner: "CLIENT", code: "SOURCE_MISSING", detail: "Look up GSO" },
      }).success,
    ).toBe(false);
    expect(
      ProductFactsSchema.safeParse({
        products: [
          {
            id: "orione",
            name: "Orione",
            category: "coffee",
            pages: [3],
            facts: [
              {
                field: "process",
                text: "Not observed",
                status: "ABSENT",
                evidence: [{ page: 3, ymin: 0, xmin: 0, ymax: 10, xmax: 10 }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("asks about caffeine/process and capsule compatibility separately", () => {
    expect(currentControlChecks("coffee", "SA")["etichettatura_specifica_prodotto"]).toContain(
      "does not describe decaffeination",
    );
    expect(currentControlChecks("supplements", "US")["indicazioni_aggiuntive"]).toContain(
      "claim-by-claim dossier",
    );
  });
});

it("requires each claim to have its own cited basis and prevents unresolved claims in PASS", () => {
  const claim = {
    text: "Supports focus",
    language: "en",
    outcome: "UNRESOLVED" as const,
    rationale: "Dose absent",
    conditions: "Verify authorised dose",
    productEvidence: "No analytical evidence",
    citationChunkIds: [],
  };
  const result = guardControlAssessment({
    fieldCode: "indicazioni_aggiuntive",
    outcome: "PASS",
    citedIds: ["real"],
    requestedIds: ["real"],
    assessment: { ...assessment, claims: [claim] },
  });
  expect(result.requiresReview).toBe(true);
  expect(result.assessment.blocker?.owner).toBe("INTERNAL");
});
