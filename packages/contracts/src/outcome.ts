import type { EvaluationOutcome, TruthValue } from "./vocabulary.js";

const EMPTY_TRUTH_OPERANDS_MESSAGE = "Truth operators require at least one operand";
const EMPTY_OUTCOMES_MESSAGE = "Outcome aggregation requires at least one finding";

/** Negates a three-valued truth value without collapsing UNKNOWN. */
export function negateTruth(value: TruthValue): TruthValue {
  if (value === "TRUE") {
    return "FALSE";
  }

  if (value === "FALSE") {
    return "TRUE";
  }

  return "UNKNOWN";
}

/**
 * Combines one or more truth values using Kleene three-valued conjunction.
 * An empty logical expression is a schema error, not an identity value.
 */
export function allTruth(values: readonly TruthValue[]): TruthValue {
  if (values.length === 0) {
    throw new RangeError(EMPTY_TRUTH_OPERANDS_MESSAGE);
  }

  if (values.includes("FALSE")) {
    return "FALSE";
  }

  if (values.includes("UNKNOWN")) {
    return "UNKNOWN";
  }

  return "TRUE";
}

/**
 * Combines one or more truth values using Kleene three-valued disjunction.
 * An empty logical expression is a schema error, not an identity value.
 */
export function anyTruth(values: readonly TruthValue[]): TruthValue {
  if (values.length === 0) {
    throw new RangeError(EMPTY_TRUTH_OPERANDS_MESSAGE);
  }

  if (values.includes("TRUE")) {
    return "TRUE";
  }

  if (values.includes("UNKNOWN")) {
    return "UNKNOWN";
  }

  return "FALSE";
}

/**
 * Derives a finding after applicability and the combined exception predicate
 * have been evaluated. Null marks a node that was legitimately skipped. A
 * null exception on an applicable rule means that the rule declares none.
 */
export function deriveRuleFinding(
  applies: TruthValue,
  exception: TruthValue | null,
  satisfied: TruthValue | null,
): EvaluationOutcome {
  if (applies === "FALSE") {
    return "NOT_APPLICABLE";
  }

  if (applies === "UNKNOWN") {
    return "REVIEW";
  }

  if (exception === "TRUE") {
    return "NOT_APPLICABLE";
  }

  if (exception === "UNKNOWN") {
    return "REVIEW";
  }

  if (satisfied === null) {
    throw new Error("Satisfaction is required when a rule is applicable and no exception applies");
  }

  if (satisfied === "TRUE") {
    return "PASS";
  }

  if (satisfied === "FALSE") {
    return "FAIL";
  }

  return "REVIEW";
}

/**
 * Derives a rule result from its applicability and satisfaction truth values.
 * Satisfaction is intentionally ignored when applicability is not TRUE.
 */
export function deriveRuleOutcome(applies: TruthValue, satisfied: TruthValue): EvaluationOutcome {
  return deriveRuleFinding(applies, "FALSE", satisfied);
}

/** Aggregates non-empty findings using FAIL > REVIEW > PASS > NOT_APPLICABLE. */
export function aggregateOutcomes(outcomes: readonly EvaluationOutcome[]): EvaluationOutcome {
  if (outcomes.length === 0) {
    throw new RangeError(EMPTY_OUTCOMES_MESSAGE);
  }

  if (outcomes.includes("FAIL")) {
    return "FAIL";
  }

  if (outcomes.includes("REVIEW")) {
    return "REVIEW";
  }

  if (outcomes.includes("PASS")) {
    return "PASS";
  }

  return "NOT_APPLICABLE";
}
