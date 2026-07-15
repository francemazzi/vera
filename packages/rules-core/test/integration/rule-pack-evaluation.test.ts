import {
  ACTIVATION_EVENT_SCHEMA_VERSION,
  DSL_VERSION,
  RULE_PACK_SCHEMA_VERSION,
  ActivationEventSchema,
  ResolvedRulePackSchema,
  RuleDefinitionSchema,
  RulePackVersionSchema,
  computeActivationEventHash,
  computeRuleDefinitionHash,
  computeRulePackVersionHash,
  verifyRulePackEvaluationHash,
} from "@vera/contracts";
import type {
  ActivationEvent,
  ActivationEventHashInput,
  ExtractionFact,
  RuleDefinition,
  RuleDefinitionHashInput,
  RulePackVersion,
  RulePackVersionHashInput,
} from "@vera/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  RuleEvaluationResourceLimitError,
  evaluateResolvedRulePack,
  evaluateRulePackVersion,
} from "../../src/index.js";

const EVALUATION_DATE = "2026-07-15T12:00:00.0001Z";

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function makeRule(idNumber: number, satisfied: "TRUE" | "FALSE"): RuleDefinition {
  const input: RuleDefinitionHashInput = {
    dslVersion: DSL_VERSION,
    state: "DRAFT",
    id: uuid(idNumber),
    sourceId: uuid(100),
    sourceVersionId: uuid(101),
    sourceContentHash: "a".repeat(64),
    ruleCardId: uuid(102),
    ruleCardRevisionId: uuid(103),
    ruleCardRevisionContentHash: "b".repeat(64),
    normativeKey: `synthetic.pack.rule.${String(idNumber)}`,
    deonticCategory: "OBLIGATION",
    riskLevel: "LOW",
    validity: {
      validFrom: "2026-01-01T00:00:00.0001Z",
      validTo: "2027-01-01T00:00:00.0001Z",
    },
    appliesWhen: { op: "truth", value: "TRUE" },
    satisfiedWhen: { op: "truth", value: satisfied },
    exceptions: [],
    overrides: [],
    conflictsWith: [],
    evidenceBindings: [],
    unknownPolicy: "REVIEW",
    validationScope: "TECHNICAL_DEMO",
  };
  return RuleDefinitionSchema.parse({ ...input, contentHash: computeRuleDefinitionHash(input) });
}

function makeVersion(
  rules: readonly RuleDefinition[] = [makeRule(1, "TRUE"), makeRule(2, "FALSE")],
): RulePackVersion {
  const input: RulePackVersionHashInput = {
    schemaVersion: RULE_PACK_SCHEMA_VERSION,
    id: uuid(200),
    packId: uuid(201),
    semver: "1.0.0",
    domain: "synthetic-quality",
    jurisdiction: "synthetic-zone",
    validity: {
      validFrom: "2026-02-01T00:00:00.0001Z",
      validTo: "2026-12-01T00:00:00.0001Z",
    },
    rules,
    changeReason: "Initial synthetic evaluation snapshot",
    supersedesVersionId: null,
    createdAt: "2026-01-10T00:00:00.0001Z",
    createdBy: uuid(202),
    publishedAt: "2026-01-20T00:00:00.0001Z",
    publishedBy: uuid(203),
    validationScope: "TECHNICAL_DEMO",
  };
  return RulePackVersionSchema.parse({
    ...input,
    contentHash: computeRulePackVersionHash(input),
  });
}

function makeActivation(version: RulePackVersion): ActivationEvent {
  const input: ActivationEventHashInput = {
    schemaVersion: ACTIVATION_EVENT_SCHEMA_VERSION,
    id: uuid(204),
    packId: version.packId,
    sequence: 1,
    type: "ACTIVATE",
    versionId: version.id,
    versionContentHash: version.contentHash,
    expectedPreviousVersionId: null,
    effectiveAt: "2026-02-01T00:00:00.0001Z",
    recordedAt: "2026-01-25T00:00:00.0001Z",
    actorId: uuid(203),
    exercisedRole: "APPROVER",
    reason: "Activate the initial synthetic snapshot",
    previousEventHash: null,
    validationScope: "TECHNICAL_DEMO",
  };
  return ActivationEventSchema.parse({
    ...input,
    contentHash: computeActivationEventHash(input),
  });
}

function expectDeeplyFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach((nested) => {
    expectDeeplyFrozen(nested, seen);
  });
}

describe("Rule Pack evaluation integration", () => {
  it("stores the exact immutable version and deterministic result in one hash-pinned envelope", () => {
    const version = makeVersion();
    const first = evaluateRulePackVersion(version, [], [], EVALUATION_DATE);
    const replay = evaluateRulePackVersion(version, [], [], EVALUATION_DATE);

    expect(first).toEqual(replay);
    expect(first.rulePackVersion).toEqual(version);
    expect(first.evaluationResult.findings.map(({ finding }) => finding.ruleId)).toEqual(
      version.rules.map(({ id }) => id),
    );
    expect(first.evaluationResult.aggregateOutcome).toBe("FAIL");
    expect(verifyRulePackEvaluationHash(first)).toBe(true);
    expectDeeplyFrozen(first);
    expect(() => {
      (first.rulePackVersion.rules as RuleDefinition[]).pop();
    }).toThrow(TypeError);
  });

  it("evaluates the version and timestamp selected by a validated activation replay", () => {
    const version = makeVersion();
    const resolved = ResolvedRulePackSchema.parse({
      request: {
        domain: version.domain,
        jurisdiction: version.jurisdiction,
        evaluationDate: EVALUATION_DATE,
      },
      rulePackVersion: version,
      activationEvent: makeActivation(version),
    });

    expect(evaluateResolvedRulePack(resolved, [], [])).toEqual(
      evaluateRulePackVersion(version, [], [], EVALUATION_DATE),
    );
  });

  it("inspects the fact collection once for the complete Rule Pack", () => {
    function factDescriptorInspections(version: RulePackVersion): number {
      const facts: ExtractionFact[] = [];
      const descriptorSpy = vi.spyOn(Object, "getOwnPropertyDescriptor");
      try {
        evaluateRulePackVersion(version, facts, [], EVALUATION_DATE);
        return descriptorSpy.mock.calls.filter(([target]) => target === facts).length;
      } finally {
        descriptorSpy.mockRestore();
      }
    }

    const oneRuleInspections = factDescriptorInspections(makeVersion([makeRule(1, "TRUE")]));
    const twoRuleInspections = factDescriptorInspections(makeVersion());

    expect(oneRuleInspections).toBeGreaterThan(0);
    expect(twoRuleInspections).toBe(oneRuleInspections);
  });

  it("fails before kernel evaluation outside the version half-open interval", () => {
    const version = makeVersion();
    const validTo = version.validity.validTo;
    if (validTo === null) throw new Error("Expected a bounded synthetic pack interval");

    expect(() => evaluateRulePackVersion(version, [], [], validTo)).toThrow(RangeError);
  });

  it("fails with the public resource error before allocating an oversized result", () => {
    const rules = Array.from({ length: 3_000 }, (_, index) => makeRule(10_000 + index, "TRUE"));
    const version = makeVersion(rules);

    expect(() => evaluateRulePackVersion(version, [], [], EVALUATION_DATE)).toThrow(
      RuleEvaluationResourceLimitError,
    );
  }, 30_000);
});
