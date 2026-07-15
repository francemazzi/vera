import { describe, expect, it } from "vitest";

import {
  ACTIVATION_EVENT_SCHEMA_VERSION,
  DSL_VERSION,
  EVALUATION_AUDIT_EXPORT_SCHEMA_VERSION,
  EVALUATION_RUN_SCHEMA_VERSION,
  REVIEW_DECISION_SCHEMA_VERSION,
  RULE_PACK_EVALUATION_SCHEMA_VERSION,
  RULE_PACK_SCHEMA_VERSION,
  ActivationEventSchema,
  EvaluationAuditExportSchema,
  EvaluationRunSchema,
  ReviewDecisionSchema,
  RuleDefinitionSchema,
  RulePackEvaluationSnapshotSchema,
  RulePackVersionSchema,
  canonicalizeEvaluationAuditExport,
  computeActivationEventHash,
  computeEvaluationAuditExportHash,
  computeEvaluationRunHash,
  computeEvaluationSnapshotFindingsHash,
  computeEvaluationSnapshotResultHash,
  computeEvaluationSnapshotTraceHash,
  computeReviewDecisionHash,
  computeRuleDefinitionHash,
  computeRulePackEvaluationHash,
  computeRulePackVersionHash,
  sha256CanonicalJson,
  verifyEvaluationAuditExportHash,
  verifyEvaluationRunHash,
  verifyReviewDecisionHash,
} from "../../src/index.js";
import type {
  ActivationEvent,
  ActivationEventHashInput,
  EvaluationAuditExport,
  EvaluationRun,
  EvaluationRunHashInput,
  ExpressionTrace,
  ReviewDecision,
  ReviewDecisionHashInput,
  RuleDefinition,
  RuleDefinitionHashInput,
  RulePackEvaluationHashInput,
  RulePackEvaluationSnapshot,
  RulePackVersion,
  RulePackVersionHashInput,
} from "../../src/index.js";

const EVALUATION_DATE = "2026-07-15T12:00:00.0001Z";

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function literalTrace(path: string, truth: ExpressionTrace["truth"]): ExpressionTrace {
  return {
    path,
    op: "truth",
    truth,
    reason: "EVALUATED",
    factKeys: [],
    expected: truth,
    observed: truth,
    evidenceIds: [],
    children: [],
  };
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
    normativeKey: "synthetic.audit.rule",
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

function makeVersion(rule: RuleDefinition = makeRule()): RulePackVersion {
  const input: RulePackVersionHashInput = {
    schemaVersion: RULE_PACK_SCHEMA_VERSION,
    id: uuid(10),
    packId: uuid(11),
    semver: "1.0.0",
    domain: "synthetic-audit",
    jurisdiction: "GLOBAL-DEMO",
    validity: {
      validFrom: "2026-01-01T00:00:00.0001Z",
      validTo: "2026-12-01T00:00:00.0001Z",
    },
    rules: [rule],
    changeReason: "Synthetic audit fixture",
    supersedesVersionId: null,
    createdAt: "2026-01-01T00:00:00.0001Z",
    createdBy: uuid(12),
    publishedAt: "2026-01-02T00:00:00.0001Z",
    publishedBy: uuid(13),
    validationScope: "TECHNICAL_DEMO",
  };
  return RulePackVersionSchema.parse({ ...input, contentHash: computeRulePackVersionHash(input) });
}

function makeSnapshot(): RulePackEvaluationSnapshot {
  const rule = makeRule();
  const version = makeVersion(rule);
  const evaluationResult = {
    findings: [
      {
        finding: {
          ruleId: rule.id,
          ruleContentHash: rule.contentHash,
          evaluationDate: EVALUATION_DATE,
          outcome: "PASS",
          appliesWhen: literalTrace("/appliesWhen", "TRUE"),
          exceptionTraces: [],
          satisfiedWhen: literalTrace("/satisfiedWhen", "TRUE"),
          overrideTraces: [],
          evidenceIds: [],
          validationScope: "TECHNICAL_DEMO",
        },
        resolution: "UNCHANGED",
        effectiveOutcome: "PASS",
        relatedRuleIds: [],
      },
    ],
    aggregateOutcome: "PASS",
  } as const;
  const input: RulePackEvaluationHashInput = {
    schemaVersion: RULE_PACK_EVALUATION_SCHEMA_VERSION,
    rulePackVersion: version,
    evaluationDate: EVALUATION_DATE,
    evaluationResult,
    validationScope: "TECHNICAL_DEMO",
  };
  return RulePackEvaluationSnapshotSchema.parse({
    ...input,
    contentHash: computeRulePackEvaluationHash(input),
  });
}

function makeRun(): EvaluationRun {
  const snapshot = makeSnapshot();
  const inputHash = sha256CanonicalJson({ caseId: "case001" });
  const factsHash = sha256CanonicalJson([]);
  const evidenceHash = sha256CanonicalJson([]);
  const promptHash = sha256CanonicalJson("synthetic prompt");
  const providerHash = sha256CanonicalJson({ model: "synthetic", digest: "c".repeat(64) });
  const hashInput: EvaluationRunHashInput = {
    schemaVersion: EVALUATION_RUN_SCHEMA_VERSION,
    id: uuid(20),
    caseId: "case001",
    recordedAt: "2026-07-15T12:00:01.0001Z",
    evaluationDate: snapshot.evaluationDate,
    inputHash,
    promptHash,
    providerHash,
    factsHash,
    evidenceHash,
    rulePackVersionId: snapshot.rulePackVersion.id,
    rulePackVersionContentHash: snapshot.rulePackVersion.contentHash,
    evaluationSnapshotHash: snapshot.contentHash,
    evaluationResultHash: computeEvaluationSnapshotResultHash(snapshot),
    findingsHash: computeEvaluationSnapshotFindingsHash(snapshot),
    traceHash: computeEvaluationSnapshotTraceHash(snapshot),
    evaluationSnapshot: snapshot,
    entities: [
      {
        id: "evaluationResult",
        kind: "EVALUATION_RESULT",
        contentHash: computeEvaluationSnapshotResultHash(snapshot),
        mediaType: "application/json",
        description: "Result",
      },
      {
        id: "evidence",
        kind: "EVIDENCE",
        contentHash: evidenceHash,
        mediaType: "application/json",
        description: "Evidence",
      },
      {
        id: "facts",
        kind: "FACTS",
        contentHash: factsHash,
        mediaType: "application/json",
        description: "Facts",
      },
      {
        id: "findings",
        kind: "FINDINGS",
        contentHash: computeEvaluationSnapshotFindingsHash(snapshot),
        mediaType: "application/json",
        description: "Findings",
      },
      {
        id: "input",
        kind: "INPUT",
        contentHash: inputHash,
        mediaType: "application/json",
        description: "Input",
      },
      {
        id: "prompt",
        kind: "PROMPT",
        contentHash: promptHash,
        mediaType: "application/json",
        description: "Prompt",
      },
      {
        id: "provider",
        kind: "PROVIDER",
        contentHash: providerHash,
        mediaType: "application/json",
        description: "Provider",
      },
      {
        id: "rulePackSnapshot",
        kind: "RULE_PACK_SNAPSHOT",
        contentHash: snapshot.contentHash,
        mediaType: "application/json",
        description: "Snapshot",
      },
      {
        id: "trace",
        kind: "TRACE",
        contentHash: computeEvaluationSnapshotTraceHash(snapshot),
        mediaType: "application/json",
        description: "Trace",
      },
    ],
    agents: [
      {
        id: "evaluationAgent",
        actorId: uuid(21),
        kind: "SYSTEM",
        role: "AUTHOR",
        displayName: "Synthetic evaluator",
        validationScope: "TECHNICAL_DEMO",
      },
    ],
    activities: [
      {
        id: "evaluation",
        type: "EVALUATION_RUN",
        startedAt: "2026-07-15T12:00:01.0001Z",
        endedAt: "2026-07-15T12:00:01.0001Z",
        agentId: "evaluationAgent",
        usedEntityIds: ["evidence", "facts", "input", "prompt", "provider", "rulePackSnapshot"],
        generatedEntityIds: ["evaluationResult", "findings", "trace"],
      },
    ],
    validationScope: "TECHNICAL_DEMO",
  };
  return EvaluationRunSchema.parse({
    ...hashInput,
    contentHash: computeEvaluationRunHash(hashInput),
  });
}

function makeDecision(run: EvaluationRun): ReviewDecision {
  const input: ReviewDecisionHashInput = {
    schemaVersion: REVIEW_DECISION_SCHEMA_VERSION,
    id: uuid(30),
    runId: run.id,
    runContentHash: run.contentHash,
    sequence: 1,
    previousEventHash: null,
    decision: "CONFIRM",
    findingRuleId: run.evaluationSnapshot.rulePackVersion.rules[0]?.id ?? null,
    targetOutcome: "PASS",
    reason: "Synthetic reviewer confirms the technical demo result",
    decidedAt: "2026-07-15T12:05:00.0001Z",
    actorId: uuid(31),
    exercisedRole: "REVIEWER",
    validationScope: "TECHNICAL_DEMO",
  };
  return ReviewDecisionSchema.parse({ ...input, contentHash: computeReviewDecisionHash(input) });
}

function makeActivation(): ActivationEvent {
  const snapshot = makeSnapshot();
  const input: ActivationEventHashInput = {
    schemaVersion: ACTIVATION_EVENT_SCHEMA_VERSION,
    id: uuid(40),
    packId: snapshot.rulePackVersion.packId,
    sequence: 1,
    type: "ACTIVATE",
    versionId: snapshot.rulePackVersion.id,
    versionContentHash: snapshot.rulePackVersion.contentHash,
    expectedPreviousVersionId: null,
    effectiveAt: "2026-01-01T00:00:00.0001Z",
    recordedAt: "2026-01-01T00:00:00.0001Z",
    actorId: uuid(41),
    exercisedRole: "APPROVER",
    reason: "Synthetic activation",
    previousEventHash: null,
    validationScope: "TECHNICAL_DEMO",
  };
  return ActivationEventSchema.parse({ ...input, contentHash: computeActivationEventHash(input) });
}

describe("evaluation audit contracts", () => {
  it("hashes EvaluationRun, ReviewDecision and canonical export envelopes", () => {
    const run = makeRun();
    const decision = makeDecision(run);
    const hashInput = {
      schemaVersion: EVALUATION_AUDIT_EXPORT_SCHEMA_VERSION,
      exportedAt: "2026-07-15T12:10:00.0001Z",
      run,
      reviewDecisions: [decision],
    } as const;
    const exported: EvaluationAuditExport = EvaluationAuditExportSchema.parse({
      ...hashInput,
      exportHash: computeEvaluationAuditExportHash(hashInput),
    });

    expect(verifyEvaluationRunHash(run)).toBe(true);
    expect(verifyReviewDecisionHash(decision)).toBe(true);
    expect(verifyEvaluationAuditExportHash(exported)).toBe(true);
    expect(canonicalizeEvaluationAuditExport(exported)).toBe(
      canonicalizeEvaluationAuditExport(exported),
    );
    expect(Object.isFrozen(exported.run.evaluationSnapshot)).toBe(true);
  });

  it("detects tampered run hashes and review chain gaps", () => {
    const run = makeRun();
    const decision = makeDecision(run);

    expect(
      EvaluationRunSchema.safeParse({
        ...run,
        findingsHash: "f".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      EvaluationAuditExportSchema.safeParse({
        schemaVersion: EVALUATION_AUDIT_EXPORT_SCHEMA_VERSION,
        exportedAt: "2026-07-15T12:10:00.0001Z",
        run,
        reviewDecisions: [{ ...decision, sequence: 2 }],
        exportHash: "0".repeat(64),
      }).success,
    ).toBe(false);
  });

  it("keeps activation events separate from immutable evaluation runs", () => {
    const run = makeRun();
    const activation = makeActivation();

    expect(run.evaluationSnapshot.rulePackVersion.contentHash).not.toBe(activation.contentHash);
    expect(run.rulePackVersionContentHash).toBe(run.evaluationSnapshot.rulePackVersion.contentHash);
  });
});
