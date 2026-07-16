import {
  DSL_VERSION,
  RULE_PACK_SCHEMA_VERSION,
  RuleDefinitionSchema,
  RulePackVersionSchema,
  canonicalizeEvaluationAuditExport,
  computeRuleDefinitionHash,
  computeRulePackVersionHash,
  verifyEvaluationAuditExportHash,
} from "@vera/contracts";
import type {
  AuditAgent,
  EvaluationAuditExport,
  EvaluationRun,
  RuleDefinition,
  RuleDefinitionHashInput,
  RulePackVersion,
  RulePackVersionHashInput,
} from "@vera/contracts";
import { describe, expect, it } from "vitest";

import {
  EvaluationAuditLedgerError,
  InMemoryEvaluationAuditLedger,
  buildEvaluationRun,
  buildReviewDecision,
  evaluateRulePackVersion,
  replayEvaluationAuditExport,
} from "../../src/index.js";

const EVALUATION_DATE = "2026-07-15T12:00:00.0001Z";

function uuid(value: number): string {
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

function makeVersion(): RulePackVersion {
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
    rules: [makeRule()],
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

const AGENT: AuditAgent = {
  id: "evaluationAgent",
  actorId: uuid(20),
  kind: "SYSTEM",
  role: "AUTHOR",
  displayName: "Synthetic evaluator",
  validationScope: "TECHNICAL_DEMO",
};

function makeRun(): EvaluationRun {
  return buildEvaluationRun({
    id: uuid(30),
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

function exportWithTwoDecisions(): EvaluationAuditExport {
  const ledger = new InMemoryEvaluationAuditLedger();
  const run = ledger.recordRun(makeRun());
  const first = ledger.appendReviewDecision(
    buildReviewDecision({
      id: uuid(40),
      run,
      decision: "CONFIRM",
      findingRuleId: run.evaluationSnapshot.rulePackVersion.rules[0]?.id ?? null,
      targetOutcome: "PASS",
      reason: "Synthetic reviewer confirms the technical demo result",
      decidedAt: "2026-07-15T12:05:00.0001Z",
      actorId: uuid(41),
      exercisedRole: "REVIEWER",
    }),
  );
  ledger.appendReviewDecision(
    buildReviewDecision({
      id: uuid(42),
      run,
      previousDecision: first,
      decision: "REQUEST_MORE_EVIDENCE",
      reason: "Synthetic reviewer asks for a second technical check",
      decidedAt: "2026-07-15T12:06:00.0001Z",
      actorId: uuid(43),
      exercisedRole: "REVIEWER",
    }),
  );
  return ledger.exportRun(run.id, "2026-07-15T12:10:00.0001Z");
}

describe("Evaluation audit ledger", () => {
  it("exports, imports and replays immutable historical evaluation snapshots", () => {
    const exported = exportWithTwoDecisions();
    const imported = new InMemoryEvaluationAuditLedger().importExport(exported);
    const replay = replayEvaluationAuditExport(imported);

    expect(verifyEvaluationAuditExportHash(imported)).toBe(true);
    expect(canonicalizeEvaluationAuditExport(imported)).toBe(
      canonicalizeEvaluationAuditExport(exported),
    );
    expect(replay.evaluationSnapshot.evaluationResult.aggregateOutcome).toBe("PASS");
    expect(replay.evaluationSnapshot.rulePackVersion.semver).toBe("1.0.0");
    expect(replay.reviewDecisions.map(({ sequence }) => sequence)).toEqual([1, 2]);
  });

  it("detects tampering and rejects stale review writes", () => {
    const ledger = new InMemoryEvaluationAuditLedger();
    const run = ledger.recordRun(makeRun());
    const first = ledger.appendReviewDecision(
      buildReviewDecision({
        id: uuid(50),
        run,
        decision: "CONFIRM",
        findingRuleId: run.evaluationSnapshot.rulePackVersion.rules[0]?.id ?? null,
        targetOutcome: "PASS",
        reason: "Synthetic reviewer confirms the technical demo result",
        decidedAt: "2026-07-15T12:05:00.0001Z",
        actorId: uuid(51),
        exercisedRole: "REVIEWER",
      }),
    );
    const stale = buildReviewDecision({
      id: uuid(52),
      run,
      decision: "CONFIRM",
      targetOutcome: "PASS",
      reason: "A stale writer does not know about the previous event",
      decidedAt: "2026-07-15T12:06:00.0001Z",
      actorId: uuid(53),
      exercisedRole: "REVIEWER",
    });
    const second = buildReviewDecision({
      id: uuid(54),
      run,
      previousDecision: first,
      decision: "OVERRIDE",
      findingRuleId: run.evaluationSnapshot.rulePackVersion.rules[0]?.id ?? null,
      targetOutcome: "REVIEW",
      reason: "Synthetic reviewer records a technical override",
      decidedAt: "2026-07-15T12:07:00.0001Z",
      actorId: uuid(55),
      exercisedRole: "REVIEWER",
    });
    ledger.appendReviewDecision(second);
    const exported = ledger.exportRun(run.id, "2026-07-15T12:10:00.0001Z");
    const firstExportedDecision = exported.reviewDecisions[0];
    const secondExportedDecision = exported.reviewDecisions[1];
    if (firstExportedDecision === undefined || secondExportedDecision === undefined) {
      throw new Error("Expected two exported review decisions");
    }
    const tampered = {
      ...exported,
      reviewDecisions: [
        firstExportedDecision,
        {
          ...secondExportedDecision,
          previousEventHash: "f".repeat(64),
        },
      ],
    };

    expect(() => ledger.appendReviewDecision(stale)).toThrow(EvaluationAuditLedgerError);
    expect(verifyEvaluationAuditExportHash(tampered)).toBe(false);
  });

  it("returns immutable defensive snapshots", () => {
    const ledger = new InMemoryEvaluationAuditLedger();
    const run = ledger.recordRun(makeRun());
    const exposed = ledger.getRun(run.id);

    expect(() => {
      (exposed.entities as unknown as unknown[]).pop();
    }).toThrow(TypeError);
    expect(ledger.getRun(run.id).entities).toHaveLength(run.entities.length);
  });
});
