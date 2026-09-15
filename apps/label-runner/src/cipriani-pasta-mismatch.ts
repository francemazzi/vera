import { LABEL_CONSULTANT_STATUSES } from "./contracts.js";

type ConsultantStatus = (typeof LABEL_CONSULTANT_STATUSES)[number];

export const CIPRIANI_REPLAY_MIN_AGREEMENT = 0.9;
export const CIPRIANI_REPLAY_MIN_BLOCKING_RECALL = 0.85;

export type CiprianiMismatchCause =
  | "NO_CITATION"
  | "GUARD_BLOCK"
  | "APPLICABILITY"
  | "MODEL_HEDGE";

/**
 * Attributes a gold-status mismatch so replay diagnosis is mechanical.
 */
export function attributeCiprianiMismatch(input: {
  readonly expected: ConsultantStatus;
  readonly predicted: ConsultantStatus | null;
  readonly outcome?: string;
  readonly citationChunkIds: readonly string[];
  readonly blockerCode?: string | null;
}): CiprianiMismatchCause {
  const isDecisiveExpected =
    input.expected === "CONFORME" || input.expected === "NON_CONFORME";
  if (isDecisiveExpected && input.citationChunkIds.length === 0) return "NO_CITATION";
  if (
    (input.expected === "NON_APPLICABILE" && input.predicted !== "NON_APPLICABILE") ||
    (input.predicted === "NON_APPLICABILE" && input.expected !== "NON_APPLICABILE")
  ) {
    return "APPLICABILITY";
  }
  if (input.blockerCode) return "GUARD_BLOCK";
  return "MODEL_HEDGE";
}

export function ciprianiReplayMeetsGate(input: {
  readonly agreement: number;
  readonly blockingRecall: number;
  readonly falseEuFailures: number;
}): boolean {
  return (
    input.agreement >= CIPRIANI_REPLAY_MIN_AGREEMENT &&
    input.blockingRecall >= CIPRIANI_REPLAY_MIN_BLOCKING_RECALL &&
    input.falseEuFailures === 0
  );
}
