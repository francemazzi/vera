// #region npm-integration
import { RulePackVersionSchema } from "@vera/contracts";
import { evaluateRulePackVersion } from "@vera/rules-core";

import {
  EVALUATION_DATE,
  EXPECTED_SUMMARY,
  SYNTHETIC_RULE_PACK_JSON,
} from "./synthetic-rule-pack.js";

const rulePackVersion = RulePackVersionSchema.parse(JSON.parse(SYNTHETIC_RULE_PACK_JSON));
const snapshot = evaluateRulePackVersion(rulePackVersion, [], [], EVALUATION_DATE);
const summary = {
  aggregateOutcome: snapshot.evaluationResult.aggregateOutcome,
  findings: snapshot.evaluationResult.findings.map(({ effectiveOutcome, finding }) => ({
    ruleId: finding.ruleId,
    outcome: effectiveOutcome,
  })),
};

if (JSON.stringify(summary) !== JSON.stringify(EXPECTED_SUMMARY)) {
  throw new Error("Il risultato dell'esempio npm non è quello atteso");
}

console.log(JSON.stringify(summary, null, 2));
// #endregion npm-integration
