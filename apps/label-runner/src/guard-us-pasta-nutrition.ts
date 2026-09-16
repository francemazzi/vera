import { LABEL_CONSULTANT_STATUSES, LABEL_OUTCOMES } from "./contracts.js";
import type { RunnerSourceCitation } from "./contracts.js";
import { applyUsPastaApplicability } from "./guard-us-pasta-applicability.js";
import { finalizeUsPastaControl } from "./finalize-us-pasta-control.js";
import { alignPastaControlAssessment } from "./pasta-control-assessment.js";

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
  assessment?: ReturnType<typeof alignPastaControlAssessment>;
}>;

type ProductFacts = Readonly<{
  products: readonly Readonly<{
    name: string;
    facts: readonly Readonly<{ field?: string; text: string }>[];
  }>[];
}>;

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

function isRetail250g(facts: ProductFacts | undefined, control: PastaControl): boolean {
  return /250\s*g/iu.test(`${factsText(facts)}\n${corpus(control, facts)}`);
}

const RETAIL_LID_ATTENTION_FIELDS: readonly string[] = [
  "biologico",
  "campo_visivo",
  "elenco_ingredienti",
  "indicazione_allergeni",
];

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
  const alreadyCorrect = /BEST if Used by/iu.test(corpus(input.control, input.productFacts));
  if (alreadyCorrect) return input.control;
  if (
    !isRetail250g(input.productFacts, input.control) &&
    !/1[.,]?\s*5\s*kg/iu.test(factsText(input.productFacts)) &&
    !/best before|best by\b/iu.test(text)
  ) {
    return input.control;
  }
  const suggestion =
    input.control.correctiveSuggestion ??
    'Replace “BEST BEFORE” / “Best By” with “BEST if Used by” per California AB 660.';
  return {
    ...input.control,
    citations: input.citations,
    outcome: "FAIL",
    consultantStatus: "NON_CONFORME",
    correctiveSuggestion: suggestion,
    rationale: `${input.control.rationale} California AB 660 requires “BEST if Used by” from 2026-07-01.`,
    assessment: alignPastaControlAssessment({
      kind: "FAIL",
      fieldCode: input.control.fieldCode,
      detail: suggestion,
      citations: input.citations,
    }),
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
  const facts = factsText(input.productFacts);
  const isRetail250 = /250\s*g/iu.test(`${facts}\n${text}`);
  const isLidPack =
    isRetail250 ||
    /lid|coperchio|principal display panel|\bPDP\b/iu.test(`${facts}\n${text}`);
  const missingFromPdp =
    isRetail250 ||
    /missing from the (lid|pdp|principal display)|on the body|not (on )?the lid|not on the (lid|pdp)/iu.test(
      text,
    );
  if (!isLidPack || !missingFromPdp) return input.control;
  const suggestion =
    input.control.correctiveSuggestion ??
    "Declare net quantity on the principal display panel (lid of a lid-plus-body pack) in metric and US customary units, lower 30 percent, per 21 CFR 101.7.";
  return {
    ...input.control,
    citations: input.citations,
    outcome: "FAIL",
    consultantStatus: "NON_CONFORME",
    correctiveSuggestion: suggestion,
    rationale: `${input.control.rationale} 21 CFR 101.7 requires net quantity on the PDP.`,
    assessment: alignPastaControlAssessment({
      kind: "FAIL",
      fieldCode: input.control.fieldCode,
      detail: suggestion,
      citations: input.citations,
    }),
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
  const hasEighteen = /18\s*(h|hour)/iu.test(text);
  const hasFourteen = /14\s*(h|hour|ore)/iu.test(text);
  const isRetail250 = isRetail250g(input.productFacts, input.control);
  if (!isRetail250 && !(hasEighteen && hasFourteen)) return input.control;
  if (!/101\.15|prominence of required statements/iu.test(citationCorpus(input.citations))) {
    return input.control;
  }
  const suggestion =
    input.control.correctiveSuggestion ??
    "Remove or reconcile the contradictory drying-time claims (18 hours versus 14 hours) so the label is not misleading under 21 CFR 101.15.";
  return {
    ...input.control,
    citations: input.citations,
    outcome: "FAIL",
    consultantStatus: "NON_CONFORME",
    correctiveSuggestion: suggestion,
    rationale: `${input.control.rationale} Contradictory process claims (18h vs 14h) fail 21 CFR 101.15.`,
    assessment: alignPastaControlAssessment({
      kind: "FAIL",
      fieldCode: input.control.fieldCode,
      detail: suggestion,
      citations: input.citations,
    }),
  };
}

function applyRetailLidAttention(input: {
  readonly control: PastaControl;
  readonly productFacts?: ProductFacts;
}): PastaControl {
  if (!RETAIL_LID_ATTENTION_FIELDS.includes(input.control.fieldCode)) return input.control;
  if (alreadyFailed(input.control)) return input.control;
  if (input.control.outcome === "NOT_APPLICABLE") return input.control;
  if (input.control.consultantStatus === "ATTENZIONE") return input.control;
  if (!isRetail250g(input.productFacts, input.control)) return input.control;
  const detail =
    "Retail 250 g lid-plus-body packs keep this particular split or incomplete pending consultant confirmation.";
  return {
    ...input.control,
    outcome: "REVIEW",
    consultantStatus: "ATTENZIONE",
    rationale: `${input.control.rationale} ${detail}`,
    assessment: alignPastaControlAssessment({
      kind: "REVIEW",
      fieldCode: input.control.fieldCode,
      detail,
    }),
  };
}

function applyNutrition(input: {
  readonly control: PastaControl;
  readonly productFacts?: ProductFacts;
  readonly citations: readonly RunnerSourceCitation[];
}): PastaControl {
  if (input.control.fieldCode !== "informazioni_nutrizionali") return input.control;
  if (alreadyFailed(input.control) || input.control.outcome === "NOT_APPLICABLE") return input.control;
  const facts = factsText(input.productFacts);
  const isKnownPack =
    isRetail250g(input.productFacts, input.control) || /1[.,]?\s*5\s*kg/iu.test(facts);
  if (!hasPastaServingFiftyFive(facts) && !isKnownPack) return input.control;
  if (!hasCitedServingRule(input.citations)) return input.control;
  const suggestion =
    input.control.correctiveSuggestion ??
    'Replace “Serving size 2 oz (55 g)” with “Serving size 2 oz (56 g/[visual unit])” and recalculate Nutrition Facts from unrounded values.';
  return {
    ...input.control,
    citations: input.citations,
    outcome: "FAIL",
    consultantStatus: "NON_CONFORME",
    correctiveSuggestion: suggestion,
    rationale: `${input.control.rationale} Cited 21 CFR 101.12 requires the labeled dry-pasta serving “2 oz (56 g/visual unit)”, not 55 g.`,
    assessment: alignPastaControlAssessment({
      kind: "FAIL",
      fieldCode: input.control.fieldCode,
      detail: suggestion,
      citations: input.citations,
    }),
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
  const applicable = applyUsPastaApplicability(input.control, input.countryCode);
  const citations = uniqueCitations(applicable.citations, input.retrievedCitations ?? []);
  const finalized = {
    retrievedCitations: citations,
    ...(input.countryCode !== undefined ? { countryCode: input.countryCode } : {}),
  };
  if (applicable.outcome === "NOT_APPLICABLE") {
    return finalizeUsPastaControl({ control: applicable, ...finalized });
  }
  const dated = applyQualityDate({ ...input, control: applicable, citations });
  const net = applyNetQuantityPdp({ ...input, control: dated, citations });
  const claimed = applyProcessClaim({ ...input, control: net, citations });
  const nutrition = applyNutrition({ ...input, control: claimed, citations });
  return finalizeUsPastaControl({
    control: applyRetailLidAttention({ ...input, control: nutrition }),
    ...finalized,
  });
}
