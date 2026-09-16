import type { RunnerSourceCitation } from "./contracts.js";
import { LABEL_CONSULTANT_STATUSES, LABEL_OUTCOMES } from "./contracts.js";
import { alignPastaControlAssessment } from "./pasta-control-assessment.js";
import { pinnedCitationsForControl } from "./pinned-source-citations.js";

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

/**
 * Rewrites US pasta assessments so FAIL/REVIEW/NA survive the backend callback
 * contract, including leftover REVIEW blockers on FAIL and EXEMPT without cites.
 */
export function finalizeUsPastaControl(input: {
  readonly control: PastaControl;
  readonly retrievedCitations?: readonly RunnerSourceCitation[];
  readonly countryCode?: string;
}): PastaControl {
  const pinned = pinnedCitationsForControl({
    fieldCode: input.control.fieldCode,
    countryCode: input.countryCode ?? "US",
  });
  const citations = uniqueCitations(
    uniqueCitations(input.control.citations, input.retrievedCitations ?? []),
    pinned,
  );
  const detail =
    input.control.correctiveSuggestion ??
    input.control.rationale ??
    input.control.fieldCode;
  if (input.control.outcome === "FAIL") {
    return {
      ...input.control,
      citations,
      assessment: alignPastaControlAssessment({
        kind: "FAIL",
        fieldCode: input.control.fieldCode,
        detail,
        citations,
      }),
    };
  }
  if (input.control.outcome === "REVIEW") {
    return {
      ...input.control,
      citations,
      assessment: alignPastaControlAssessment({
        kind: "REVIEW",
        fieldCode: input.control.fieldCode,
        detail,
      }),
    };
  }
  if (input.control.outcome !== "NOT_APPLICABLE") return { ...input.control, citations };
  return {
    ...input.control,
    citations,
    assessment: alignPastaControlAssessment({
      kind: "NOT_APPLICABLE",
      fieldCode: input.control.fieldCode,
      detail,
    }),
  };
}
