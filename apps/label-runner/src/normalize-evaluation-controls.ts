import { ControlAssessmentSchema } from "./control-assessment-schema.js";
import { guardControlAssessment } from "./guard-control-assessment.js";
import { z } from "zod";
import { RunnerBoundingBoxSchema } from "./contracts.js";
import type { PreliminaryTemplate, RunnerSourceCitation, RunnerBoundingBox } from "./contracts.js";
import type { LabelRetrievedSources } from "./source-retriever.js";
import { OpenRouterLabelEvaluationError } from "./evaluation-error.js";

const ModelControlSchema = z
  .object({
    fieldCode: z.string(),
    outcome: z.enum(["PASS", "FAIL", "REVIEW", "NOT_APPLICABLE"]),
    consultantStatus: z.enum([
      "CONFORME",
      "NON_CONFORME",
      "ATTENZIONE",
      "SUGGERIMENTO",
      "NON_APPLICABILE",
    ]),
    rationale: z.string().min(1).max(8_000),
    confidence: z.number().min(0).max(1),
    citationChunkIds: z
      .array(z.string().min(1).max(300))
      .max(24)
      .nullish()
      .transform((value) => value ?? []),
    correctiveSuggestion: z.string().min(1).max(80_000).optional(),
    boundingBox: z.unknown().optional(),
    assessment: ControlAssessmentSchema.optional(),
    marketFeedback: z
      .array(
        z
          .object({
            market: z.string().min(1).max(120),
            outcome: z.enum(["PASS", "FAIL", "REVIEW", "NOT_APPLICABLE"]),
            consultantStatus: z.enum([
              "CONFORME",
              "NON_CONFORME",
              "ATTENZIONE",
              "SUGGERIMENTO",
              "NON_APPLICABILE",
            ]),
            rationale: z.string().min(1).max(8_000),
            correctiveSuggestion: z.string().min(1).max(80_000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(24)
      .optional(),
  })
  .strict();

const ModelOutputSchema = z.object({ controls: z.array(ModelControlSchema) }).strict();

function citationsForControl(
  fieldCode: string,
  requestedIds: readonly string[],
  sources: LabelRetrievedSources,
): readonly RunnerSourceCitation[] {
  const available =
    sources.controls.find((entry) => entry.fieldCode === fieldCode)?.citations ?? [];
  const allowed = new Map(available.map((citation) => [citation.chunkId, citation]));
  const resolved: RunnerSourceCitation[] = [];
  for (const id of requestedIds) {
    const citation = allowed.get(id);
    if (citation && !resolved.some((entry) => entry.chunkId === citation.chunkId))
      resolved.push(citation);
  }
  return resolved;
}

type LabelFieldCode = PreliminaryTemplate["controls"][number]["fieldCode"];
type ModelControl = z.infer<typeof ModelControlSchema>;
type ConsultantStatus = ModelControl["consultantStatus"];

function consultantStatusFor(control: ModelControl): ConsultantStatus {
  if (control.outcome === "NOT_APPLICABLE") return "NON_APPLICABILE";
  if (control.outcome === "REVIEW") return "ATTENZIONE";
  if (control.outcome === "PASS") {
    return control.consultantStatus === "SUGGERIMENTO" ? "SUGGERIMENTO" : "CONFORME";
  }
  return control.consultantStatus === "ATTENZIONE" ? "ATTENZIONE" : "NON_CONFORME";
}

type ReconciledControl = {
  readonly control: ModelControl;
  readonly fieldCode: LabelFieldCode;
  readonly repaired: boolean;
};

/**
 * Maps model-returned field codes onto the immutable template, which the
 * backend has already validated as the 24 distinct codes. A code that is not an
 * exact match is resolved only when arithmetic forces the assignment: one
 * unmatched control against one unused code. Similarity matching is deliberately
 * refused — a plausible but wrong pairing would misattribute an assessment.
 */
function reconcileFieldCodes(input: {
  readonly controls: readonly ModelControl[];
  readonly template: PreliminaryTemplate;
}): readonly ReconciledControl[] {
  const expectedCount = input.template.controls.length;
  if (input.controls.length !== expectedCount) {
    throw new OpenRouterLabelEvaluationError(
      `OpenRouter returned ${String(input.controls.length)} controls, expected ${String(expectedCount)}`,
      false,
    );
  }
  const remaining = new Map<string, LabelFieldCode>(
    input.template.controls.map((control) => [control.fieldCode, control.fieldCode]),
  );
  const paired = input.controls.map((control) => {
    const exact = remaining.get(control.fieldCode);
    if (exact === undefined) return { control, fieldCode: null };
    remaining.delete(exact);
    return { control, fieldCode: exact };
  });
  const unmatchedCount = paired.filter((entry) => entry.fieldCode === null).length;
  if (unmatchedCount > 1) {
    throw new OpenRouterLabelEvaluationError(
      `OpenRouter evaluation could not reconcile ${String(unmatchedCount)} field codes`,
      false,
    );
  }
  const forced = [...remaining.values()][0];
  return paired.map((entry) => {
    if (entry.fieldCode !== null) {
      return { control: entry.control, fieldCode: entry.fieldCode, repaired: false };
    }
    if (forced === undefined) {
      throw new OpenRouterLabelEvaluationError(
        "OpenRouter evaluation could not reconcile 1 field code",
        false,
      );
    }
    return { control: entry.control, fieldCode: forced, repaired: true };
  });
}

export function normalizedControls(input: {
  readonly parsed: unknown;
  readonly sources: LabelRetrievedSources;
  readonly template: PreliminaryTemplate;
  readonly productCategory?: string;
}): readonly {
  readonly fieldCode: LabelFieldCode;
  readonly outcome: "PASS" | "FAIL" | "REVIEW" | "NOT_APPLICABLE";
  readonly consultantStatus:
    "CONFORME" | "NON_CONFORME" | "ATTENZIONE" | "SUGGERIMENTO" | "NON_APPLICABILE";
  readonly rationale: string;
  readonly correctiveSuggestion?: string;
  readonly confidence: number;
  readonly citations: readonly RunnerSourceCitation[];
  readonly boundingBox?: RunnerBoundingBox;
  readonly assessment?: z.infer<typeof ControlAssessmentSchema>;
  readonly marketFeedback?: readonly Readonly<{
    market: string;
    outcome: "PASS" | "FAIL" | "REVIEW" | "NOT_APPLICABLE";
    consultantStatus:
      "CONFORME" | "NON_CONFORME" | "ATTENZIONE" | "SUGGERIMENTO" | "NON_APPLICABILE";
    rationale: string;
    correctiveSuggestion?: string;
  }>[];
}[] {
  const output = ModelOutputSchema.parse(input.parsed);
  const reconciled = reconcileFieldCodes({ controls: output.controls, template: input.template });
  return reconciled.map(({ control, fieldCode, repaired }) => {
    const cited = repaired
      ? []
      : citationsForControl(fieldCode, control.citationChunkIds, input.sources);
    const citations = cited;
    const guard =
      input.template.version === "3"
        ? guardControlAssessment({
            fieldCode,
            ...(input.productCategory ? { productCategory: input.productCategory } : {}),
            outcome: control.outcome,
            ...(control.assessment ? { assessment: control.assessment } : {}),
            requestedIds: control.citationChunkIds,
            citedIds: citations.map((entry) => entry.chunkId),
          })
        : undefined;
    const mustReview =
      repaired ||
      guard?.requiresReview === true ||
      control.citationChunkIds.some((id) => !citations.some((entry) => entry.chunkId === id)) ||
      ((control.outcome === "PASS" || control.outcome === "FAIL") && citations.length === 0);
    const correction: string | undefined =
      guard?.correction || (mustReview ? undefined : control.correctiveSuggestion);
    const box = repaired ? undefined : RunnerBoundingBoxSchema.safeParse(control.boundingBox);
    const outcome = mustReview ? "REVIEW" : control.outcome;
    return {
      fieldCode,
      outcome,
      consultantStatus: mustReview ? "ATTENZIONE" : consultantStatusFor(control),
      rationale: repaired
        ? "Codice controllo non confermato dal modello: esito degradato a revisione."
        : mustReview && guard
          ? (guard.assessment.blocker?.detail ?? "Approfondimento interno richiesto.")
          : mustReview
            ? `Base normativa verificata non collegata: ricerca interna richiesta per ${fieldCode}. Osservazione da validare: ${control.rationale}`
            : control.rationale,
      ...(correction ? { correctiveSuggestion: correction } : {}),
      ...(guard ? { assessment: guard.assessment } : {}),
      confidence: mustReview ? 0 : control.confidence,
      citations,
      ...(box?.success === true ? { boundingBox: box.data } : {}),
      ...(input.template.version !== "3" && control.marketFeedback
        ? {
            marketFeedback: control.marketFeedback.map((row) => ({
              market: row.market,
              outcome: row.outcome,
              consultantStatus: row.consultantStatus,
              rationale: row.rationale,
              ...(row.correctiveSuggestion
                ? { correctiveSuggestion: row.correctiveSuggestion }
                : {}),
            })),
          }
        : {}),
    };
  });
}
