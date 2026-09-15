import { LABEL_CONSULTANT_STATUSES } from "./contracts.js";
import type { CiprianiPastaGoldCase } from "./cipriani-pasta-gold.js";

type ConsultantStatus = (typeof LABEL_CONSULTANT_STATUSES)[number];

const FINDING_PATTERNS: Readonly<Record<string, readonly RegExp[]>> = {
  serving_size_56g: [/56\s*g/iu, /serving size/iu, /2\s*oz/iu],
  nutrition_facts_recalculate: [/nutrition facts/iu, /ricalcol/iu, /recalcul/iu],
  quality_date_ggg: [/best if used by/iu, /\bGGG\b/iu, /AB 660/iu, /best before/iu],
  net_quantity_pdp: [/principal display panel/iu, /\bPDP\b/iu, /net weight/iu],
  process_claim_18h_vs_14h: [/18\s*hour/iu, /14\s*(hour|ore)/iu, /drying time/iu],
};

function joinedText(control: Readonly<{
  rationale?: string | null;
  correctiveSuggestion?: string | null;
}>): string {
  return `${control.rationale ?? ""}\n${control.correctiveSuggestion ?? ""}`;
}

/**
 * Scores a Cipriani pasta replay against ChatGPT gold statuses and blocking findings.
 */
export function scoreCiprianiPastaCase(input: {
  readonly gold: CiprianiPastaGoldCase;
  readonly predicted: Readonly<Record<string, ConsultantStatus>>;
  readonly controls: readonly Readonly<{
    fieldCode: string;
    consultantStatus: ConsultantStatus;
    rationale?: string | null;
    correctiveSuggestion?: string | null;
  }>[];
}): Readonly<{
  matched: number;
  compared: number;
  agreement: number;
  mismatches: readonly Readonly<{
    fieldCode: string;
    expected: ConsultantStatus;
    predicted: ConsultantStatus | null;
  }>[];
  blockingRecall: number;
  blockingHits: readonly string[];
  blockingMisses: readonly string[];
  falseEuFailures: readonly string[];
}> {
  const mismatches = Object.entries(input.gold.expected)
    .filter(([fieldCode, status]) => input.predicted[fieldCode] !== status)
    .map(([fieldCode, status]) => ({
      fieldCode,
      expected: status,
      predicted: input.predicted[fieldCode] ?? null,
    }));
  const compared = Object.keys(input.gold.expected).length;
  const matched = compared - mismatches.length;
  const corpus = input.controls.map(joinedText).join("\n");
  const blockingHits = input.gold.blockingFindings.filter((finding) =>
    (FINDING_PATTERNS[finding] ?? []).some((pattern) => pattern.test(corpus)),
  );
  const blockingMisses = input.gold.blockingFindings.filter(
    (finding) => !blockingHits.includes(finding),
  );
  const falseEuFailures = ["indicazioni_ambientali", "sede_stabilimento_produzione_confezionamento"]
    .filter((fieldCode) => {
      const status = input.predicted[fieldCode];
      return status === "NON_CONFORME" || status === "ATTENZIONE";
    });
  return {
    matched,
    compared,
    agreement: compared > 0 ? matched / compared : 0,
    mismatches,
    blockingRecall:
      input.gold.blockingFindings.length > 0
        ? blockingHits.length / input.gold.blockingFindings.length
        : 1,
    blockingHits,
    blockingMisses,
    falseEuFailures,
  };
}
