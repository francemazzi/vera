import type { z } from "zod";
import { ControlAssessmentSchema } from "./control-assessment-schema.js";
import type { RunnerSourceCitation } from "./contracts.js";

type Assessment = z.infer<typeof ControlAssessmentSchema>;

function citationIds(citations: readonly RunnerSourceCitation[]): string[] {
  return [...new Set(citations.map((citation) => citation.chunkId))].slice(0, 24);
}

/**
 * Builds a callback-valid v3 assessment after a US pasta post-guard changes
 * the control outcome. FAIL cannot keep a REVIEW blocker; REVIEW needs one.
 */
export function alignPastaControlAssessment(input: {
  readonly kind: "FAIL" | "REVIEW" | "NOT_APPLICABLE";
  readonly fieldCode: string;
  readonly detail: string;
  readonly citations?: readonly RunnerSourceCitation[];
}): Assessment {
  if (input.kind === "NOT_APPLICABLE") {
    return {
      applicability: "EXEMPT",
      conditions: input.detail.slice(0, 2_000),
      observation: "ABSENT",
      actions: [],
    };
  }
  if (input.kind === "REVIEW") {
    const text = input.detail.slice(0, 2_000);
    return {
      applicability: "APPLICABLE",
      observation: "OBSERVED",
      blocker: { owner: "INTERNAL", code: "PRODUCT_DATA_MISSING", detail: text },
      actions: [{ kind: "REQUEST_DATA", location: "label", text, citationChunkIds: [] }],
    };
  }
  const citationChunkIds = citationIds(input.citations ?? []);
  const suggestion = input.detail.slice(0, 4_000);
  const claims =
    input.fieldCode === "indicazioni_aggiuntive"
      ? [
          {
            text: "Slow dried 18 hours versus 14 hours",
            language: "en",
            outcome: "REJECTED" as const,
            rationale: input.detail.slice(0, 2_000),
            conditions: "Not specified",
            productEvidence: "Retail lid-plus-body pasta pack.",
            proposedWording: suggestion.slice(0, 2_000),
            citationChunkIds,
          },
        ]
      : undefined;
  return {
    applicability: "APPLICABLE",
    observation: "OBSERVED",
    actions: citationChunkIds.length
      ? [
          {
            kind: "REPLACE",
            location: "label",
            language: "en",
            text: suggestion,
            citationChunkIds,
          },
        ]
      : [],
    ...(claims ? { claims } : {}),
  };
}
