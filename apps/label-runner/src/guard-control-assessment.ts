import type { z } from "zod";
import type { ControlAssessmentSchema } from "./control-assessment-schema.js";

type Assessment = z.infer<typeof ControlAssessmentSchema>;
const FACTUAL_OPTIONAL: readonly string[] = [
  "atmosfera_protettiva",
  "biologico",
  "denominazioni_dop_igp_stg",
  "istruzioni_uso",
];
const PHYSICAL_SIZE: readonly string[] = [
  "altezza_minima_caratteri",
  "altezza_cifre_quantita_nominale",
];

/** Prevents unsupported conclusions and converts a precise gap into an internal task. */
export function guardControlAssessment(
  input: Readonly<{
    fieldCode: string;
    productCategory?: string;
    outcome: string;
    assessment?: Assessment;
    citedIds: readonly string[];
    requestedIds: readonly string[];
  }>,
): Readonly<{ assessment: Assessment; requiresReview: boolean; correction: string }> {
  const invalidCitation: boolean = input.requestedIds.some((id) => !input.citedIds.includes(id));
  let gap: string | undefined;
  let code: NonNullable<Assessment["blocker"]>["code"] = "SOURCE_MISSING";
  if (
    input.fieldCode === "etichettatura_specifica_prodotto" &&
    input.productCategory &&
    !["coffee", "beverages", "supplements"].includes(input.productCategory)
  ) {
    gap = `Completare internamente i controlli verticali della categoria ${input.productCategory}; non è possibile dichiararli non applicabili per mancanza di implementazione.`;
    code = "UNIMPLEMENTED_CATEGORY";
  } else if (!input.assessment)
    gap = "Completare internamente applicabilità, osservazione e azioni del controllo.";
  else if (input.assessment.applicability === "UNRESOLVED" && input.outcome !== "REVIEW")
    gap = "Risolvere l’applicabilità prima di formulare una conclusione normativa.";
  else if (
    input.assessment.applicability === "EXEMPT" &&
    (!input.assessment.conditions || !["NOT_APPLICABLE", "REVIEW"].includes(input.outcome))
  )
    gap = "Documentare le condizioni dell’esenzione e il loro riscontro sul prodotto.";
  else if (
    input.assessment.actions.some((action) => action.kind === "RESEARCH") &&
    (input.outcome !== "REVIEW" || input.assessment.blocker?.owner !== "INTERNAL")
  )
    gap = "La ricerca normativa ancora necessaria deve rimanere un controllo sospeso interno.";
  else if (invalidCitation)
    gap = "La fonte selezionata non appartiene alle evidenze verificate di questo controllo.";
  else if (
    input.assessment.actions.some((action) =>
      action.citationChunkIds.some((id) => !input.citedIds.includes(id)),
    )
  )
    gap = "Verificare la fonte della correzione proposta prima di utilizzarla.";
  else if (
    input.assessment.claims?.some(
      (claim) =>
        claim.citationChunkIds.some((id) => !input.citedIds.includes(id)) ||
        (claim.outcome !== "UNRESOLVED" && !claim.citationChunkIds.length),
    )
  )
    gap = "Completare la base normativa specifica di ciascun claim nel dossier interno.";
  else if (
    input.outcome === "PASS" &&
    input.assessment.claims?.some((claim) => claim.outcome !== "SUPPORTED")
  )
    gap = "Risolvere i claim sospesi o respinti prima di dichiarare il controllo conforme.";
  else if (
    input.fieldCode === "indicazioni_aggiuntive" &&
    input.assessment.observation === "OBSERVED" &&
    input.outcome !== "REVIEW" &&
    !input.assessment.claims?.length
  )
    gap = "Completare il dossier separato per ciascun claim osservato.";
  else if (
    input.outcome === "NOT_APPLICABLE" &&
    input.assessment.applicability !== "EXEMPT" &&
    !(
      input.assessment.applicability === "FACTUALLY_NOT_APPLICABLE" &&
      FACTUAL_OPTIONAL.includes(input.fieldCode)
    )
  )
    gap = "Stabilire e documentare l’applicabilità del requisito per questo prodotto e mercato.";
  else if (
    (input.outcome === "PASS" ||
      input.outcome === "FAIL" ||
      input.assessment.applicability === "EXEMPT") &&
    !input.citedIds.length
  )
    gap = "Acquisire la disposizione applicabile, le condizioni e la decorrenza nazionale.";
  else if (PHYSICAL_SIZE.includes(input.fieldCode) && input.outcome !== "REVIEW") {
    gap =
      "Occorre un artwork con scala di stampa attendibile per misurare le dimensioni fisiche dei caratteri.";
    code = "SCALE_UNVERIFIED";
  } else if (input.outcome === "REVIEW" && !input.assessment.blocker)
    gap = "Precisare la fonte o il dato necessario a risolvere il controllo sospeso.";
  else if (input.outcome !== "REVIEW" && input.assessment.blocker)
    gap = input.assessment.blocker.detail;
  else if (
    input.assessment.actions.some(
      (action) => ["ADD", "REPLACE"].includes(action.kind) && !action.language,
    )
  )
    gap = "Completare la lingua del testo proposto per ciascun pannello.";
  else if (
    input.outcome === "FAIL" &&
    !input.assessment.actions.some(
      (action) =>
        ["ADD", "REPLACE", "REMOVE"].includes(action.kind) && action.citationChunkIds.length > 0,
    )
  )
    gap = "Completare la correzione con testo, posizione, lingua, condizioni e fonte applicabile.";
  const assessment: Assessment = gap
    ? {
        applicability: "UNRESOLVED",
        observation: input.assessment?.observation ?? "NOT_LOCALIZED",
        blocker: { owner: code === "SCALE_UNVERIFIED" ? "CLIENT" : "INTERNAL", code, detail: gap },
        actions: [
          {
            kind: code === "SCALE_UNVERIFIED" ? "REQUEST_DATA" : "RESEARCH",
            location: "Dossier di verifica",
            text: gap,
            citationChunkIds: [],
          },
        ],
      }
    : input.assessment!;
  const actionText: string = assessment.actions
    .map((action) => {
      const verbs = {
        ADD: "Aggiungere",
        REPLACE: "Sostituire",
        REMOVE: "Rimuovere",
        REQUEST_DATA: "Dato necessario",
        RESEARCH: "Attività interna",
      };
      return `${verbs[action.kind]} · ${action.location}${action.language ? ` · ${action.language}` : ""}: ${action.text}${action.condition ? `\nCondizione: ${action.condition}` : ""}`;
    })
    .join("\n\n");
  const correction: string = [
    assessment.conditions ? `Condizioni di applicabilità: ${assessment.conditions}` : "",
    actionText,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { assessment, requiresReview: gap !== undefined, correction };
}
