import type { RunnerSourceCitation } from "./contracts.js";
import { LABEL_CONSULTANT_STATUSES, LABEL_OUTCOMES } from "./contracts.js";
import { alignPastaControlAssessment } from "./pasta-control-assessment.js";

type PastaControl = Readonly<{
  fieldCode: string;
  outcome: (typeof LABEL_OUTCOMES)[number];
  consultantStatus?: (typeof LABEL_CONSULTANT_STATUSES)[number];
  rationale: string;
  correctiveSuggestion?: string;
  confidence: number;
  citations: readonly RunnerSourceCitation[];
  assessment?: ReturnType<typeof alignPastaControlAssessment>;
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

/**
 * US pasta applicability: EU-only and shelf-stable optional controls are NA.
 */
export function applyUsPastaApplicability(
  control: PastaControl,
  countryCode?: string,
): PastaControl {
  if (countryCode !== "US") return control;
  if (US_EU_ONLY.includes(control.fieldCode)) {
    if (control.outcome === "NOT_APPLICABLE" && control.consultantStatus === "NON_APPLICABILE") {
      return control;
    }
    return {
      ...control,
      outcome: "NOT_APPLICABLE",
      consultantStatus: "NON_APPLICABILE",
      rationale: `${control.rationale} US evaluation: EU-only control is not applicable.`,
      assessment: alignPastaControlAssessment({
        kind: "NOT_APPLICABLE",
        fieldCode: control.fieldCode,
        detail: "US destination: this EU-only labeling control is not applicable.",
      }),
    };
  }
  if (!SHELF_STABLE_OPTIONAL.includes(control.fieldCode)) return control;
  if (control.outcome === "NOT_APPLICABLE" && control.consultantStatus === "NON_APPLICABILE") {
    return control;
  }
  return {
    ...control,
    outcome: "NOT_APPLICABLE",
    consultantStatus: "NON_APPLICABILE",
    rationale: `${control.rationale} Dry pasta is shelf-stable; this control is not required for US retail or foodservice packs.`,
    assessment: alignPastaControlAssessment({
      kind: "NOT_APPLICABLE",
      fieldCode: control.fieldCode,
      detail: "Dry pasta is shelf-stable; this control is not required for US packs.",
    }),
  };
}
