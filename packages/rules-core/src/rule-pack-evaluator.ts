import {
  RULE_PACK_EVALUATION_SCHEMA_VERSION,
  ResolvedRulePackSchema,
  RulePackEvaluationSnapshotSchema,
  RulePackVersionSchema,
  UtcDateTimeSchema,
  computeRulePackEvaluationHash,
  isWithinValidityInterval,
} from "@vera/contracts";
import type {
  Evidence,
  ExtractionFact,
  ResolvedRulePack,
  RulePackEvaluationHashInput,
  RulePackEvaluationSnapshot,
  RulePackVersion,
  UtcDateTime,
} from "@vera/contracts";

import { evaluateRules } from "./dsl-evaluator.js";
import { resolveRuleFindings } from "./rule-resolution.js";

/**
 * Evaluates an immutable version snapshot without consulting ambient state.
 * Activation selection remains explicit so test runners can exercise inactive candidates.
 */
export function evaluateRulePackVersion(
  versionInput: RulePackVersion,
  facts: readonly ExtractionFact[],
  evidence: readonly Evidence[],
  evaluationDateInput: UtcDateTime,
): RulePackEvaluationSnapshot {
  const version = RulePackVersionSchema.parse(versionInput);
  const evaluationDate = UtcDateTimeSchema.parse(evaluationDateInput);
  if (!isWithinValidityInterval(version.validity, evaluationDate)) {
    throw new RangeError("Rule Pack version is not valid at the requested evaluation date");
  }

  const findings = evaluateRules(version.rules, facts, evidence, evaluationDate);
  const evaluationResult = resolveRuleFindings(version.rules, findings);
  const hashInput: RulePackEvaluationHashInput = {
    schemaVersion: RULE_PACK_EVALUATION_SCHEMA_VERSION,
    rulePackVersion: version,
    evaluationDate,
    evaluationResult,
    validationScope: "TECHNICAL_DEMO",
  };

  return RulePackEvaluationSnapshotSchema.parse({
    ...hashInput,
    contentHash: computeRulePackEvaluationHash(hashInput),
  });
}

/** Evaluates the exact version selected by the append-only temporal resolver. */
export function evaluateResolvedRulePack(
  resolvedInput: ResolvedRulePack,
  facts: readonly ExtractionFact[],
  evidence: readonly Evidence[],
): RulePackEvaluationSnapshot {
  const resolved = ResolvedRulePackSchema.parse(resolvedInput);
  return evaluateRulePackVersion(
    resolved.rulePackVersion,
    facts,
    evidence,
    resolved.request.evaluationDate,
  );
}
