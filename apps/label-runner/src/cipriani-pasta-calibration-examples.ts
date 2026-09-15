import { CIPRIANI_PASTA_GOLD_CASES } from "./cipriani-pasta-gold.js";

export type CiprianiPastaGoldExample = Readonly<{
  fieldCode: string;
  goldOutcome: "PASS" | "FAIL" | "REVIEW" | "NOT_APPLICABLE";
  rationale: string;
  countryCode: "US";
  productCategory: "generic-prepacked";
}>;

function outcomeFor(status: string): CiprianiPastaGoldExample["goldOutcome"] {
  if (status === "CONFORME") return "PASS";
  if (status === "NON_CONFORME") return "FAIL";
  if (status === "NON_APPLICABILE") return "NOT_APPLICABLE";
  return "REVIEW";
}

/**
 * Few-shot rows from calibration SKUs. Hold-out cases are never included.
 */
export function ciprianiPastaCalibrationExamples(): readonly CiprianiPastaGoldExample[] {
  const examples: CiprianiPastaGoldExample[] = [];
  for (const item of CIPRIANI_PASTA_GOLD_CASES.filter((row) => row.split === "calibration")) {
    for (const [fieldCode, status] of Object.entries(item.expected)) {
      if (status !== "NON_CONFORME" && status !== "ATTENZIONE") continue;
      examples.push({
        fieldCode,
        goldOutcome: outcomeFor(status),
        rationale: `${item.productName}: consultant gold ${status} for ${fieldCode}.`,
        countryCode: "US",
        productCategory: "generic-prepacked",
      });
      if (examples.length === 8) return examples;
    }
  }
  return examples;
}
