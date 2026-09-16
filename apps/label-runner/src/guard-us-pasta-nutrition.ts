import { LABEL_CONSULTANT_STATUSES, LABEL_OUTCOMES } from "./contracts.js";
import type { RunnerSourceCitation } from "./contracts.js";

type Outcome = (typeof LABEL_OUTCOMES)[number];
type ConsultantStatus = (typeof LABEL_CONSULTANT_STATUSES)[number];

type PastaControl = Readonly<{
  fieldCode: string;
  outcome: Outcome;
  consultantStatus?: ConsultantStatus;
  rationale: string;
  correctiveSuggestion?: string;
  confidence: number;
  citations: readonly RunnerSourceCitation[];
}>;

type ProductFacts = Readonly<{
  products: readonly Readonly<{
    name: string;
    facts: readonly Readonly<{ field?: string; text: string }>[];
  }>[];
}>;

const SHELF_STABLE_OPTIONAL: readonly string[] = [
  "condizioni_particolari_conservazione",
  "istruzioni_uso",
];

const US_EU_ONLY: readonly string[] = [
  "atmosfera_protettiva",
  "bollatura_sanitaria_marchio_identificazione",
  "denominazioni_dop_igp_stg",
  "indicazioni_ambientali",
  "sede_stabilimento_produzione_confezionamento",
  "origine_ingrediente_primario",
];

function factsText(facts: ProductFacts | undefined): string {
  if (!facts) return "";
  return facts.products
    .flatMap((product) => product.facts.map((fact) => `${product.name} ${fact.text}`))
    .join("\n");
}

function uniqueCitations(
  left: readonly RunnerSourceCitation[],
  right: readonly RunnerSourceCitation[],
): readonly RunnerSourceCitation[] {
  const seen = new Set<string>();
  return [...left, ...right].filter((citation) => {
    if (seen.has(citation.chunkId)) return false;
    seen.add(citation.chunkId);
    return true;
  });
}

function corpus(control: PastaControl, facts?: ProductFacts): string {
  return `${factsText(facts)}\n${control.rationale}\n${control.correctiveSuggestion ?? ""}`;
}

function citationCorpus(citations: readonly RunnerSourceCitation[]): string {
  return citations
    .map((citation) => `${citation.actReference} ${citation.sectionTitle} ${citation.quote}`)
    .join("\n");
}

function hasPastaServingFiftyFive(text: string): boolean {
  return (
    /pasta|noodle|semolina|tagliolini|tagliardi|tagliarelle|pappardelle/iu.test(text) &&
    /2\s*oz\s*\(?\s*55\s*g/iu.test(text)
  );
}

function hasCitedServingRule(citations: readonly RunnerSourceCitation[]): boolean {
  return /101\.12|101\.9|RACC|reference amount/iu.test(citationCorpus(citations));
}

function alreadyFailed(control: PastaControl): boolean {
  return control.outcome === "FAIL" && control.consultantStatus === "NON_CONFORME";
}

function applyEuOnly(control: PastaControl, countryCode?: string): PastaControl {
  if (countryCode !== "US" || !US_EU_ONLY.includes(control.fieldCode)) return control;
  if (control.outcome === "NOT_APPLICABLE" && control.consultantStatus === "NON_APPLICABILE") {
    return control;
  }
  return {
    ...control,
    outcome: "NOT_APPLICABLE",
    consultantStatus: "NON_APPLICABILE",
    rationale: `${control.rationale} US evaluation: EU-only control is not applicable.`,
  };
}

function applyShelfStableOptional(control: PastaControl, countryCode?: string): PastaControl {
  if (countryCode !== "US" || !SHELF_STABLE_OPTIONAL.includes(control.fieldCode)) return control;
  if (control.outcome === "NOT_APPLICABLE" && control.consultantStatus === "NON_APPLICABILE") {
    return control;
  }
  return {
    ...control,
    outcome: "NOT_APPLICABLE",
    consultantStatus: "NON_APPLICABILE",
    rationale: `${control.rationale} Dry pasta is shelf-stable; this control is not required for US retail or foodservice packs.`,
  };
}

function applyQualityDate(input: {
  readonly control: PastaControl;
  readonly productFacts?: ProductFacts;
  readonly citations: readonly RunnerSourceCitation[];
}): PastaControl {
  if (input.control.fieldCode !== "termine_minimo_conservazione_data_scadenza") return input.control;
  if (alreadyFailed(input.control)) return input.control;
  const text = `${corpus(input.control, input.productFacts)}\n${citationCorpus(input.citations)}`;
  const hasStandard = /\bGGG\b|AB 660|BEST if Used by/iu.test(text);
  if (!hasStandard) return input.control;
  if (!/best before|best by\b/iu.test(text)) return input.control;
  return {
    ...input.control,
    citations: input.citations,
    outcome: "FAIL",
    consultantStatus: "NON_CONFORME",
    correctiveSuggestion:
      input.control.correctiveSuggestion ??
      'Replace “BEST BEFORE” / “Best By” with “BEST if Used by” per California AB 660.',
    rationale: `${input.control.rationale} California AB 660 requires “BEST if Used by” from 2026-07-01.`,
  };
}

function applyNetQuantityPdp(input: {
  readonly control: PastaControl;
  readonly productFacts?: ProductFacts;
  readonly citations: readonly RunnerSourceCitation[];
}): PastaControl {
  if (input.control.fieldCode !== "quantita_netto_volume_nominale") return input.control;
  if (alreadyFailed(input.control)) return input.control;
  if (!/101\.7|net quantity of contents|principal display panel/iu.test(citationCorpus(input.citations))) {
    return input.control;
  }
  const text = corpus(input.control, input.productFacts);
  const isLidPack =
    /lid|coperchio|principal display panel|\bPDP\b|250\s*g/iu.test(text) ||
    /lid|coperchio|250\s*g/iu.test(factsText(input.productFacts));
  const missingFromPdp =
    /missing from the (lid|pdp|principal display)|on the body|not (on )?the lid|not on the (lid|pdp)/iu.test(
      text,
    ) ||
    (/250\s*g/iu.test(factsText(input.productFacts)) &&
      /lid|coperchio/iu.test(factsText(input.productFacts)));
  if (!isLidPack || !missingFromPdp) return input.control;
  return {
    ...input.control,
    citations: input.citations,
    outcome: "FAIL",
    consultantStatus: "NON_CONFORME",
    correctiveSuggestion:
      input.control.correctiveSuggestion ??
      "Declare net quantity on the principal display panel (lid of a lid-plus-body pack) in metric and US customary units, lower 30 percent, per 21 CFR 101.7.",
    rationale: `${input.control.rationale} 21 CFR 101.7 requires net quantity on the PDP.`,
  };
}

function applyProcessClaim(input: {
  readonly control: PastaControl;
  readonly productFacts?: ProductFacts;
  readonly citations: readonly RunnerSourceCitation[];
}): PastaControl {
  if (input.control.fieldCode !== "indicazioni_aggiuntive") return input.control;
  if (alreadyFailed(input.control)) return input.control;
  const text = corpus(input.control, input.productFacts);
  if (!/18\s*(h|hour)/iu.test(text) || !/14\s*(h|hour|ore)/iu.test(text)) return input.control;
  if (!/101\.15|prominence of required statements/iu.test(citationCorpus(input.citations))) {
    return input.control;
  }
  return {
    ...input.control,
    citations: input.citations,
    outcome: "FAIL",
    consultantStatus: "NON_CONFORME",
    correctiveSuggestion:
      input.control.correctiveSuggestion ??
      "Remove or reconcile the contradictory drying-time claims (18 hours versus 14 hours) so the label is not misleading under 21 CFR 101.15.",
    rationale: `${input.control.rationale} Contradictory process claims (18h vs 14h) fail 21 CFR 101.15.`,
  };
}

function applyNutrition(input: {
  readonly control: PastaControl;
  readonly productFacts?: ProductFacts;
  readonly citations: readonly RunnerSourceCitation[];
}): PastaControl {
  if (input.control.fieldCode !== "informazioni_nutrizionali") return input.control;
  if (alreadyFailed(input.control) || input.control.outcome === "NOT_APPLICABLE") return input.control;
  if (!hasPastaServingFiftyFive(factsText(input.productFacts))) return input.control;
  if (!hasCitedServingRule(input.citations)) return input.control;
  return {
    ...input.control,
    citations: input.citations,
    outcome: "FAIL",
    consultantStatus: "NON_CONFORME",
    correctiveSuggestion:
      input.control.correctiveSuggestion ??
      'Replace “Serving size 2 oz (55 g)” with “Serving size 2 oz (56 g/[visual unit])” and recalculate Nutrition Facts from unrounded values.',
    rationale: `${input.control.rationale} Cited 21 CFR 101.12 requires the labeled dry-pasta serving “2 oz (56 g/visual unit)”, not 55 g.`,
  };
}

/**
 * US pasta post-guards: EU-only NA, AB 660 date wording, PDP net quantity,
 * contradictory process claims, and 21 CFR 101.12 serving size.
 */
export function applyUsPastaNutritionGuard(input: {
  readonly control: PastaControl;
  readonly productFacts?: ProductFacts;
  readonly retrievedCitations?: readonly RunnerSourceCitation[];
  readonly countryCode?: string;
}): PastaControl {
  if (input.countryCode === "US" && US_EU_ONLY.includes(input.control.fieldCode)) {
    return applyEuOnly(input.control, input.countryCode);
  }
  if (input.countryCode === "US" && SHELF_STABLE_OPTIONAL.includes(input.control.fieldCode)) {
    return applyShelfStableOptional(input.control, input.countryCode);
  }
  const citations = uniqueCitations(input.control.citations, input.retrievedCitations ?? []);
  const dated = applyQualityDate({ ...input, citations });
  const net = applyNetQuantityPdp({ ...input, control: dated, citations });
  const claimed = applyProcessClaim({ ...input, control: net, citations });
  return applyNutrition({ ...input, control: claimed, citations });
}
