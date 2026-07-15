import {
  DSL_VERSION,
  RULE_PACK_SCHEMA_VERSION,
  RuleDefinitionSchema,
  RulePackVersionSchema,
  computeRuleDefinitionHash,
  computeRulePackVersionHash,
} from "@vera/contracts";
import type {
  AuditAgent,
  EvaluationRun,
  ReviewDecision,
  RuleDefinition,
  RuleDefinitionHashInput,
  RulePackVersion,
  RulePackVersionHashInput,
} from "@vera/contracts";
import { buildEvaluationRun, buildReviewDecision, evaluateRulePackVersion } from "@vera/rules-core";

const EVALUATION_DATE = "2026-07-15T12:00:00.0001Z";

export function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function makeRule(): RuleDefinition {
  const input: RuleDefinitionHashInput = {
    dslVersion: DSL_VERSION,
    state: "DRAFT",
    id: uuid(1),
    sourceId: uuid(2),
    sourceVersionId: uuid(3),
    sourceContentHash: "a".repeat(64),
    ruleCardId: uuid(4),
    ruleCardRevisionId: uuid(5),
    ruleCardRevisionContentHash: "b".repeat(64),
    normativeKey: "synthetic.storage.rule",
    deonticCategory: "OBLIGATION",
    riskLevel: "LOW",
    validity: {
      validFrom: "2026-01-01T00:00:00.0001Z",
      validTo: "2026-12-01T00:00:00.0001Z",
    },
    appliesWhen: { op: "truth", value: "TRUE" },
    satisfiedWhen: { op: "truth", value: "TRUE" },
    exceptions: [],
    overrides: [],
    conflictsWith: [],
    evidenceBindings: [],
    unknownPolicy: "REVIEW",
    validationScope: "TECHNICAL_DEMO",
  };
  return RuleDefinitionSchema.parse({ ...input, contentHash: computeRuleDefinitionHash(input) });
}

function makeVersion(): RulePackVersion {
  const input: RulePackVersionHashInput = {
    schemaVersion: RULE_PACK_SCHEMA_VERSION,
    id: uuid(10),
    packId: uuid(11),
    semver: "1.0.0",
    domain: "synthetic-storage",
    jurisdiction: "GLOBAL-DEMO",
    validity: {
      validFrom: "2026-01-01T00:00:00.0001Z",
      validTo: "2026-12-01T00:00:00.0001Z",
    },
    rules: [makeRule()],
    changeReason: "Synthetic storage fixture",
    supersedesVersionId: null,
    createdAt: "2026-01-01T00:00:00.0001Z",
    createdBy: uuid(12),
    publishedAt: "2026-01-02T00:00:00.0001Z",
    publishedBy: uuid(13),
    validationScope: "TECHNICAL_DEMO",
  };
  return RulePackVersionSchema.parse({ ...input, contentHash: computeRulePackVersionHash(input) });
}

const AGENT: AuditAgent = {
  id: "evaluationAgent",
  actorId: uuid(20),
  kind: "SYSTEM",
  role: "AUTHOR",
  displayName: "Synthetic evaluator",
  validationScope: "TECHNICAL_DEMO",
};

export function makeEvaluationRun(id: string = uuid(30)): EvaluationRun {
  return buildEvaluationRun({
    id,
    caseId: "case001",
    recordedAt: "2026-07-15T12:00:01.0001Z",
    evaluationSnapshot: evaluateRulePackVersion(makeVersion(), [], [], EVALUATION_DATE),
    input: { caseId: "case001", source: "synthetic" },
    facts: [],
    evidence: [],
    prompt: "synthetic prompt",
    provider: { model: "synthetic", digest: "c".repeat(64) },
    agent: AGENT,
  });
}

export function makeReviewDecision(run: EvaluationRun, id: string = uuid(40)): ReviewDecision {
  return buildReviewDecision({
    id,
    run,
    decision: "CONFIRM",
    findingRuleId: run.evaluationSnapshot.rulePackVersion.rules[0]?.id ?? null,
    targetOutcome: "PASS",
    reason: "Synthetic reviewer confirms the technical demo result",
    decidedAt: "2026-07-15T12:05:00.0001Z",
    actorId: uuid(41),
    exercisedRole: "REVIEWER",
  });
}
