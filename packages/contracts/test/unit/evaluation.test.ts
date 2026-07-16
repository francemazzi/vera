import { describe, expect, it } from "vitest";

import {
  EvaluationResultSchema,
  EvaluationTraceReasonSchema,
  ExpressionTraceSchema,
  ResolvedRuleFindingSchema,
  RuleFindingResolutionSchema,
  RuleFindingSchema,
  RuleOverrideTraceSchema,
  type EvaluationResult,
  type ExpressionTrace,
  type ResolvedRuleFinding,
  type RuleFinding,
} from "../../src/evaluation.js";

const UUIDS = {
  rule: "00000000-0000-4000-8000-000000000001",
  otherRule: "00000000-0000-4000-8000-000000000002",
  thirdRule: "00000000-0000-4000-8000-000000000003",
  override: "00000000-0000-4000-8000-000000000004",
  evidence: "00000000-0000-4000-8000-000000000005",
  otherEvidence: "00000000-0000-4000-8000-000000000006",
} as const;

function literalTrace(path: string, truth: ExpressionTrace["truth"] = "TRUE"): ExpressionTrace {
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

function factTrace(path: string, overrides: Partial<ExpressionTrace> = {}): ExpressionTrace {
  return {
    path,
    op: "present",
    truth: "TRUE",
    reason: "EVALUATED",
    factKeys: ["synthetic.present"],
    expected: true,
    observed: true,
    evidenceIds: [UUIDS.evidence],
    children: [],
    ...overrides,
  };
}

function nestedNotTrace(depth: number, path = "/appliesWhen"): ExpressionTrace {
  if (depth === 1) return literalTrace(path);
  const child = nestedNotTrace(depth - 1, `${path}/operand`);
  return {
    path,
    op: "not",
    truth: child.truth === "TRUE" ? "FALSE" : child.truth === "FALSE" ? "TRUE" : "UNKNOWN",
    reason: "EVALUATED",
    factKeys: [...child.factKeys],
    expected: null,
    observed: null,
    evidenceIds: [...child.evidenceIds],
    children: [child],
  };
}

function oversizedTraceTree(): ExpressionTrace {
  const children = Array.from({ length: 64 }, (_, groupIndex) => {
    const path = `/appliesWhen/operands/${String(groupIndex)}`;
    return {
      path,
      op: "all" as const,
      truth: "TRUE" as const,
      reason: "EVALUATED" as const,
      factKeys: [],
      expected: null,
      observed: null,
      evidenceIds: [],
      children: Array.from({ length: 64 }, (_, leafIndex) =>
        literalTrace(`${path}/operands/${String(leafIndex)}`),
      ),
    };
  });
  return {
    path: "/appliesWhen",
    op: "all",
    truth: "TRUE",
    reason: "EVALUATED",
    factKeys: [],
    expected: null,
    observed: null,
    evidenceIds: [],
    children,
  };
}

function passFinding(overrides: Partial<RuleFinding> = {}): RuleFinding {
  return {
    ruleId: UUIDS.rule,
    ruleContentHash: "a".repeat(64),
    evaluationDate: "2026-01-01T00:00:00.0000001Z",
    outcome: "PASS",
    appliesWhen: literalTrace("/appliesWhen"),
    exceptionTraces: [],
    satisfiedWhen: factTrace("/satisfiedWhen"),
    overrideTraces: [],
    evidenceIds: [UUIDS.evidence],
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

function unchangedFinding(overrides: Partial<ResolvedRuleFinding> = {}): ResolvedRuleFinding {
  return {
    finding: passFinding(),
    resolution: "UNCHANGED",
    effectiveOutcome: "PASS",
    relatedRuleIds: [],
    ...overrides,
  };
}

function findingWithOverride(
  ruleId: string,
  overriddenRuleId: string,
  truth: ExpressionTrace["truth"],
): RuleFinding {
  return passFinding({
    ruleId,
    overrideTraces: [
      {
        overrideId: UUIDS.override,
        overriddenRuleId,
        trace: literalTrace("/overrides/0/when", truth),
      },
    ],
  });
}

describe("evaluation vocabulary", () => {
  it("pins trace reasons and resolution states", () => {
    expect(EvaluationTraceReasonSchema.options).toEqual([
      "EVALUATED",
      "MISSING_FACT",
      "UNRESOLVED_FACT",
      "TYPE_MISMATCH",
      "MISSING_EVIDENCE",
      "RESOURCE_LIMIT",
    ]);
    expect(RuleFindingResolutionSchema.options).toEqual([
      "UNCHANGED",
      "OVERRIDDEN",
      "UNCERTAIN_OVERRIDE",
      "CONFLICT_REVIEW",
      "INVALID_OVERRIDE_GRAPH",
    ]);
  });
});

describe("ExpressionTraceSchema", () => {
  it("accepts a logical tree and propagates exact fact/evidence unions", () => {
    const left = factTrace("/satisfiedWhen/operands/0");
    const right = factTrace("/satisfiedWhen/operands/1", {
      factKeys: ["synthetic.other"],
      evidenceIds: [UUIDS.otherEvidence],
    });
    const result = ExpressionTraceSchema.parse({
      path: "/satisfiedWhen",
      op: "all",
      truth: "TRUE",
      reason: "EVALUATED",
      factKeys: ["synthetic.other", "synthetic.present"],
      expected: null,
      observed: null,
      evidenceIds: [UUIDS.evidence, UUIDS.otherEvidence],
      children: [left, right],
    });

    expect(result.truth).toBe("TRUE");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.children)).toBe(true);
    expect(Object.isFrozen(result.children[0])).toBe(true);
  });

  it("accepts a not trace with its canonical child path", () => {
    expect(
      ExpressionTraceSchema.safeParse({
        path: "/appliesWhen",
        op: "not",
        truth: "FALSE",
        reason: "EVALUATED",
        factKeys: ["synthetic.present"],
        expected: null,
        observed: null,
        evidenceIds: [UUIDS.evidence],
        children: [factTrace("/appliesWhen/operand")],
      }).success,
    ).toBe(true);
  });

  it("accepts any with an evaluated UNKNOWN propagated from its children", () => {
    const unknown = factTrace("/appliesWhen/operands/0", {
      truth: "UNKNOWN",
      reason: "UNRESOLVED_FACT",
      observed: null,
    });
    expect(
      ExpressionTraceSchema.safeParse({
        path: "/appliesWhen",
        op: "any",
        truth: "UNKNOWN",
        reason: "EVALUATED",
        factKeys: [...unknown.factKeys],
        expected: null,
        observed: null,
        evidenceIds: [...unknown.evidenceIds],
        children: [unknown],
      }).success,
    ).toBe(true);
  });

  it.each([
    ["extra field", { ...literalTrace("/appliesWhen"), extra: true }],
    ["invalid pointer", { ...literalTrace("appliesWhen") }],
    ["leaf children", { ...factTrace("/appliesWhen"), children: [literalTrace("/child")] }],
    [
      "empty collection",
      {
        ...literalTrace("/appliesWhen"),
        op: "all",
        factKeys: [],
        evidenceIds: [],
      },
    ],
    [
      "wrong not arity",
      {
        ...literalTrace("/appliesWhen"),
        op: "not",
        children: [],
      },
    ],
    [
      "logical scalar values",
      {
        ...literalTrace("/appliesWhen"),
        op: "all",
        expected: true,
        children: [literalTrace("/appliesWhen/operands/0")],
      },
    ],
    [
      "logical observed value",
      {
        ...literalTrace("/appliesWhen"),
        op: "all",
        expected: null,
        observed: true,
        children: [literalTrace("/appliesWhen/operands/0")],
      },
    ],
    [
      "logical operational failure reason",
      {
        ...literalTrace("/appliesWhen", "UNKNOWN"),
        op: "all",
        reason: "RESOURCE_LIMIT",
        children: [literalTrace("/appliesWhen/operands/0", "UNKNOWN")],
      },
    ],
    [
      "logical truth drift",
      {
        path: "/appliesWhen",
        op: "all",
        truth: "TRUE",
        reason: "EVALUATED",
        factKeys: [],
        expected: null,
        observed: null,
        evidenceIds: [],
        children: [literalTrace("/appliesWhen/operands/0", "FALSE")],
      },
    ],
    [
      "wrong child path",
      {
        ...literalTrace("/appliesWhen"),
        op: "all",
        children: [literalTrace("/wrong")],
      },
    ],
    [
      "missing logical union",
      {
        ...literalTrace("/appliesWhen"),
        op: "all",
        children: [factTrace("/appliesWhen/operands/0")],
      },
    ],
    [
      "duplicate fact keys",
      {
        ...factTrace("/appliesWhen"),
        op: "same_visual_area",
        factKeys: ["synthetic.present", "synthetic.present"],
      },
    ],
    [
      "duplicate evidence",
      {
        ...factTrace("/appliesWhen"),
        evidenceIds: [UUIDS.evidence, UUIDS.evidence],
      },
    ],
    [
      "unordered fact keys",
      {
        ...factTrace("/appliesWhen"),
        op: "same_visual_area",
        factKeys: ["synthetic.z", "synthetic.a"],
      },
    ],
    [
      "unordered evidence",
      {
        ...factTrace("/appliesWhen"),
        evidenceIds: [UUIDS.otherEvidence, UUIDS.evidence],
      },
    ],
    [
      "evaluated fact is unknown",
      {
        ...factTrace("/appliesWhen"),
        truth: "UNKNOWN",
      },
    ],
    [
      "evaluated fact has no evidence",
      {
        ...factTrace("/appliesWhen"),
        evidenceIds: [],
      },
    ],
    [
      "non-evaluation reason with definite truth",
      {
        ...factTrace("/appliesWhen"),
        reason: "MISSING_FACT",
      },
    ],
    [
      "missing fact with observed value",
      {
        ...factTrace("/appliesWhen"),
        truth: "UNKNOWN",
        reason: "MISSING_FACT",
      },
    ],
    [
      "missing evidence claiming evidence",
      {
        ...factTrace("/appliesWhen"),
        truth: "UNKNOWN",
        reason: "MISSING_EVIDENCE",
      },
    ],
    [
      "truth references a fact",
      {
        ...literalTrace("/appliesWhen"),
        factKeys: ["synthetic.present"],
      },
    ],
    [
      "truth references evidence",
      {
        ...literalTrace("/appliesWhen"),
        evidenceIds: [UUIDS.evidence],
      },
    ],
    [
      "truth expected value drift",
      {
        ...literalTrace("/appliesWhen"),
        expected: "FALSE",
      },
    ],
    [
      "truth observed value drift",
      {
        ...literalTrace("/appliesWhen"),
        observed: "FALSE",
      },
    ],
    [
      "truth has an operational failure reason",
      {
        ...literalTrace("/appliesWhen", "UNKNOWN"),
        reason: "MISSING_FACT",
      },
    ],
    [
      "ordinary fact leaf has no key",
      {
        ...factTrace("/appliesWhen"),
        factKeys: [],
      },
    ],
    [
      "same visual area has one fact",
      {
        ...factTrace("/appliesWhen"),
        op: "same_visual_area",
      },
    ],
    [
      "same visual area exceeds its fact bound",
      {
        ...factTrace("/appliesWhen"),
        op: "same_visual_area",
        factKeys: Array.from({ length: 11 }, (_, index) => `synthetic.visual.${String(index)}`),
      },
    ],
    [
      "unresolved fact has an observed value",
      {
        ...factTrace("/appliesWhen"),
        truth: "UNKNOWN",
        reason: "UNRESOLVED_FACT",
      },
    ],
    [
      "present reports a type mismatch",
      {
        ...factTrace("/appliesWhen"),
        truth: "UNKNOWN",
        reason: "TYPE_MISMATCH",
      },
    ],
    [
      "ordinary equality reports a resource limit",
      {
        ...factTrace("/appliesWhen"),
        op: "eq",
        truth: "UNKNOWN",
        reason: "RESOURCE_LIMIT",
      },
    ],
    [
      "type mismatch omits evidence",
      {
        ...factTrace("/appliesWhen"),
        op: "eq",
        truth: "UNKNOWN",
        reason: "TYPE_MISMATCH",
        evidenceIds: [],
      },
    ],
    [
      "type mismatch omits its observed value",
      {
        ...factTrace("/appliesWhen"),
        op: "eq",
        truth: "UNKNOWN",
        reason: "TYPE_MISMATCH",
        observed: null,
      },
    ],
  ] as const)("rejects %s", (_label, candidate) => {
    expect(ExpressionTraceSchema.safeParse(candidate).success).toBe(false);
  });

  it("accepts bounded unresolved and resource-limit leaves as UNKNOWN", () => {
    const missing = factTrace("/appliesWhen", {
      truth: "UNKNOWN",
      reason: "MISSING_FACT",
      observed: null,
      evidenceIds: [],
    });
    const resourceLimit = factTrace("/satisfiedWhen", {
      op: "matches",
      truth: "UNKNOWN",
      reason: "RESOURCE_LIMIT",
    });
    expect(ExpressionTraceSchema.safeParse(missing).success).toBe(true);
    expect(ExpressionTraceSchema.safeParse(resourceLimit).success).toBe(true);
    expect(
      ExpressionTraceSchema.safeParse(
        factTrace("/satisfiedWhen", {
          op: "same_visual_area",
          factKeys: ["synthetic.left", "synthetic.right"],
          truth: "UNKNOWN",
          reason: "RESOURCE_LIMIT",
        }),
      ).success,
    ).toBe(true);
    expect(
      ExpressionTraceSchema.safeParse(
        factTrace("/satisfiedWhen", {
          op: "eq",
          truth: "UNKNOWN",
          reason: "TYPE_MISMATCH",
        }),
      ).success,
    ).toBe(true);
  });

  it("deep-freezes detached expected and observed JSON values", () => {
    const expectedInput = { nested: { value: true } };
    const observedInput = [{ nested: [1, 2, 3] }];
    const result = ExpressionTraceSchema.parse(
      factTrace("/satisfiedWhen", { expected: expectedInput, observed: observedInput }),
    );

    expect(Object.isFrozen(expectedInput)).toBe(false);
    expect(Object.isFrozen(observedInput)).toBe(false);
    expect(Object.isFrozen(result.expected)).toBe(true);
    expect(Object.isFrozen(result.observed)).toBe(true);
    if (result.expected === null || typeof result.expected !== "object") {
      throw new Error("Expected an object fixture");
    }
    const nestedExpected = Object.values(result.expected)[0];
    expect(Object.isFrozen(nestedExpected)).toBe(true);
    if (!Array.isArray(result.observed)) throw new Error("Expected an array fixture");
    expect(Object.isFrozen(result.observed[0])).toBe(true);
  });

  it("rejects cycles at the snapshot boundary without throwing", () => {
    const cyclic = { ...literalTrace("/appliesWhen") } as Record<string, unknown>;
    cyclic["children"] = [cyclic];
    expect(() => ExpressionTraceSchema.safeParse(cyclic)).not.toThrow();
    expect(ExpressionTraceSchema.safeParse(cyclic).success).toBe(false);
  });

  it("accepts the DSL depth boundary and rejects one additional logical level", () => {
    expect(ExpressionTraceSchema.safeParse(nestedNotTrace(32)).success).toBe(true);
    const tooDeep = nestedNotTrace(33);
    expect(() => ExpressionTraceSchema.safeParse(tooDeep)).not.toThrow();
    expect(ExpressionTraceSchema.safeParse(tooDeep).success).toBe(false);
  });

  it("rejects a structurally valid trace that exceeds the aggregate node bound", () => {
    const oversized = oversizedTraceTree();
    expect(() => ExpressionTraceSchema.safeParse(oversized)).not.toThrow();
    expect(ExpressionTraceSchema.safeParse(oversized).success).toBe(false);
  }, 30_000);
});

describe("RuleOverrideTraceSchema", () => {
  it("accepts strict override provenance", () => {
    expect(
      RuleOverrideTraceSchema.parse({
        overrideId: UUIDS.override,
        overriddenRuleId: UUIDS.otherRule,
        trace: literalTrace("/overrides/0/when"),
      }),
    ).toMatchObject({ overrideId: UUIDS.override, overriddenRuleId: UUIDS.otherRule });
  });

  it("rejects malformed IDs and unknown fields", () => {
    expect(
      RuleOverrideTraceSchema.safeParse({
        overrideId: "bad",
        overriddenRuleId: UUIDS.otherRule,
        trace: literalTrace("/overrides/0/when"),
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe("RuleFindingSchema", () => {
  it("accepts and snapshots a technically scoped PASS finding", () => {
    const input = passFinding();
    const result = RuleFindingSchema.parse(input);
    expect(result).toEqual(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.evidenceIds)).toBe(true);
  });

  it.each([
    ["bad hash", passFinding({ ruleContentHash: "A".repeat(64) })],
    ["professional scope", { ...passFinding(), validationScope: "PROFESSIONAL" }],
    ["outcome drift", passFinding({ outcome: "FAIL" })],
    ["missing satisfaction", passFinding({ satisfiedWhen: null })],
    [
      "satisfaction after non-applicability",
      passFinding({
        outcome: "NOT_APPLICABLE",
        appliesWhen: literalTrace("/appliesWhen", "FALSE"),
      }),
    ],
    [
      "exception after uncertain applicability",
      passFinding({
        outcome: "REVIEW",
        appliesWhen: literalTrace("/appliesWhen", "UNKNOWN"),
        exceptionTraces: [literalTrace("/exceptions/0/when", "FALSE")],
        satisfiedWhen: null,
        evidenceIds: [],
      }),
    ],
    ["duplicate evidence", passFinding({ evidenceIds: [UUIDS.evidence, UUIDS.evidence] })],
    [
      "unordered finding evidence",
      passFinding({
        satisfiedWhen: factTrace("/satisfiedWhen", {
          evidenceIds: [UUIDS.evidence, UUIDS.otherEvidence],
        }),
        evidenceIds: [UUIDS.otherEvidence, UUIDS.evidence],
      }),
    ],
    ["incomplete evidence union", passFinding({ evidenceIds: [] })],
    ["wrong applicability path", passFinding({ appliesWhen: literalTrace("/wrong") })],
    ["wrong satisfaction path", passFinding({ satisfiedWhen: factTrace("/wrong") })],
    [
      "wrong exception path",
      passFinding({
        outcome: "NOT_APPLICABLE",
        exceptionTraces: [literalTrace("/wrong", "TRUE")],
        satisfiedWhen: null,
        evidenceIds: [],
      }),
    ],
    [
      "duplicate override relation",
      passFinding({
        overrideTraces: [
          {
            overrideId: UUIDS.override,
            overriddenRuleId: UUIDS.otherRule,
            trace: literalTrace("/overrides/0/when"),
          },
          {
            overrideId: UUIDS.override,
            overriddenRuleId: UUIDS.thirdRule,
            trace: literalTrace("/overrides/1/when"),
          },
        ],
      }),
    ],
    [
      "duplicate override target",
      passFinding({
        overrideTraces: [
          {
            overrideId: UUIDS.override,
            overriddenRuleId: UUIDS.otherRule,
            trace: literalTrace("/overrides/0/when"),
          },
          {
            overrideId: "00000000-0000-4000-8000-000000000007",
            overriddenRuleId: UUIDS.otherRule,
            trace: literalTrace("/overrides/1/when"),
          },
        ],
      }),
    ],
    [
      "wrong override path",
      passFinding({
        overrideTraces: [
          {
            overrideId: UUIDS.override,
            overriddenRuleId: UUIDS.otherRule,
            trace: literalTrace("/wrong"),
          },
        ],
      }),
    ],
    [
      "self override",
      passFinding({
        overrideTraces: [
          {
            overrideId: UUIDS.override,
            overriddenRuleId: UUIDS.rule,
            trace: literalTrace("/overrides/0/when"),
          },
        ],
      }),
    ],
    [
      "override trace after skipped satisfaction",
      passFinding({
        outcome: "NOT_APPLICABLE",
        appliesWhen: literalTrace("/appliesWhen", "FALSE"),
        satisfiedWhen: null,
        overrideTraces: [
          {
            overrideId: UUIDS.override,
            overriddenRuleId: UUIDS.otherRule,
            trace: literalTrace("/overrides/0/when"),
          },
        ],
        evidenceIds: [],
      }),
    ],
    ["aggregate trace node limit", passFinding({ appliesWhen: oversizedTraceTree() })],
  ] as const)("rejects %s", (_label, candidate) => {
    expect(RuleFindingSchema.safeParse(candidate).success).toBe(false);
  });

  it("accepts skipped satisfaction for inapplicability and active exceptions", () => {
    expect(
      RuleFindingSchema.safeParse(
        passFinding({
          outcome: "NOT_APPLICABLE",
          appliesWhen: literalTrace("/appliesWhen", "FALSE"),
          satisfiedWhen: null,
          evidenceIds: [],
        }),
      ).success,
    ).toBe(true);
    expect(
      RuleFindingSchema.safeParse(
        passFinding({
          outcome: "NOT_APPLICABLE",
          exceptionTraces: [literalTrace("/exceptions/0/when", "TRUE")],
          satisfiedWhen: null,
          evidenceIds: [],
        }),
      ).success,
    ).toBe(true);
  });

  it("accepts REVIEW when applicability or an exception remains UNKNOWN", () => {
    expect(
      RuleFindingSchema.safeParse(
        passFinding({
          outcome: "REVIEW",
          appliesWhen: literalTrace("/appliesWhen", "UNKNOWN"),
          satisfiedWhen: null,
          evidenceIds: [],
        }),
      ).success,
    ).toBe(true);
    expect(
      RuleFindingSchema.safeParse(
        passFinding({
          outcome: "REVIEW",
          exceptionTraces: [literalTrace("/exceptions/0/when", "UNKNOWN")],
          satisfiedWhen: null,
          evidenceIds: [],
        }),
      ).success,
    ).toBe(true);
  });

  it("propagates evidence from exception and override traces", () => {
    const exception = factTrace("/exceptions/0/when", {
      truth: "FALSE",
      factKeys: ["synthetic.exception"],
      evidenceIds: [UUIDS.otherEvidence],
    });
    const override = factTrace("/overrides/0/when", {
      factKeys: ["synthetic.override"],
    });
    expect(
      RuleFindingSchema.safeParse(
        passFinding({
          outcome: "PASS",
          exceptionTraces: [exception],
          overrideTraces: [
            {
              overrideId: UUIDS.override,
              overriddenRuleId: UUIDS.otherRule,
              trace: override,
            },
          ],
          evidenceIds: [UUIDS.evidence, UUIDS.otherEvidence],
        }),
      ).success,
    ).toBe(true);
  });
});

describe("ResolvedRuleFindingSchema", () => {
  it.each([
    ["unchanged", unchangedFinding()],
    [
      "overridden",
      unchangedFinding({
        resolution: "OVERRIDDEN",
        effectiveOutcome: "NOT_APPLICABLE",
        relatedRuleIds: [UUIDS.otherRule],
      }),
    ],
    [
      "conflict",
      unchangedFinding({
        resolution: "CONFLICT_REVIEW",
        effectiveOutcome: "REVIEW",
        relatedRuleIds: [UUIDS.otherRule],
      }),
    ],
    [
      "uncertain override",
      unchangedFinding({
        resolution: "UNCERTAIN_OVERRIDE",
        effectiveOutcome: "REVIEW",
        relatedRuleIds: [UUIDS.otherRule],
      }),
    ],
    [
      "invalid graph without a known related rule",
      unchangedFinding({
        resolution: "INVALID_OVERRIDE_GRAPH",
        effectiveOutcome: "REVIEW",
      }),
    ],
  ] as const)("accepts %s", (_label, candidate) => {
    expect(ResolvedRuleFindingSchema.safeParse(candidate).success).toBe(true);
  });

  it.each([
    ["changed unchanged outcome", unchangedFinding({ effectiveOutcome: "FAIL" })],
    ["related unchanged rule", unchangedFinding({ relatedRuleIds: [UUIDS.otherRule] })],
    [
      "override pass",
      unchangedFinding({ resolution: "OVERRIDDEN", relatedRuleIds: [UUIDS.otherRule] }),
    ],
    [
      "override without source",
      unchangedFinding({ resolution: "OVERRIDDEN", effectiveOutcome: "NOT_APPLICABLE" }),
    ],
    [
      "conflict without peer",
      unchangedFinding({ resolution: "CONFLICT_REVIEW", effectiveOutcome: "REVIEW" }),
    ],
    [
      "uncertain override without peer",
      unchangedFinding({ resolution: "UNCERTAIN_OVERRIDE", effectiveOutcome: "REVIEW" }),
    ],
    [
      "uncertain override as pass",
      unchangedFinding({
        resolution: "UNCERTAIN_OVERRIDE",
        relatedRuleIds: [UUIDS.otherRule],
      }),
    ],
    [
      "invalid graph as fail",
      unchangedFinding({ resolution: "INVALID_OVERRIDE_GRAPH", effectiveOutcome: "FAIL" }),
    ],
    ["self relation", unchangedFinding({ relatedRuleIds: [UUIDS.rule] })],
    [
      "duplicate relations",
      unchangedFinding({
        resolution: "CONFLICT_REVIEW",
        effectiveOutcome: "REVIEW",
        relatedRuleIds: [UUIDS.otherRule, UUIDS.otherRule],
      }),
    ],
    [
      "unordered relations",
      unchangedFinding({
        resolution: "CONFLICT_REVIEW",
        effectiveOutcome: "REVIEW",
        relatedRuleIds: [UUIDS.thirdRule, UUIDS.otherRule],
      }),
    ],
  ] as const)("rejects %s", (_label, candidate) => {
    expect(ResolvedRuleFindingSchema.safeParse(candidate).success).toBe(false);
  });

  it("allows bounded fan-in beyond the per-rule override and conflict limits", () => {
    const relatedRuleIds = Array.from(
      { length: 201 },
      (_, index) => `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
    );
    expect(
      ResolvedRuleFindingSchema.safeParse(
        unchangedFinding({
          resolution: "CONFLICT_REVIEW",
          effectiveOutcome: "REVIEW",
          relatedRuleIds,
        }),
      ).success,
    ).toBe(true);
  });
});

describe("EvaluationResultSchema", () => {
  it("accepts a non-empty result with a derived aggregate", () => {
    const result = EvaluationResultSchema.parse({
      findings: [unchangedFinding()],
      aggregateOutcome: "PASS",
    } satisfies EvaluationResult);
    expect(result.aggregateOutcome).toBe("PASS");
    expect(Object.isFrozen(result.findings)).toBe(true);
  });

  it("uses effective outcomes for FAIL > REVIEW > PASS aggregation", () => {
    const fail = unchangedFinding({
      finding: passFinding({
        ruleId: UUIDS.otherRule,
        outcome: "FAIL",
        satisfiedWhen: factTrace("/satisfiedWhen", { truth: "FALSE" }),
      }),
      effectiveOutcome: "FAIL",
    });
    expect(
      EvaluationResultSchema.safeParse({
        findings: [unchangedFinding(), fail],
        aggregateOutcome: "FAIL",
      }).success,
    ).toBe(true);
  });

  it("accepts an overridden target backed by a TRUE source trace", () => {
    const source = unchangedFinding({
      finding: findingWithOverride(UUIDS.rule, UUIDS.otherRule, "TRUE"),
    });
    const target = unchangedFinding({
      finding: passFinding({ ruleId: UUIDS.otherRule }),
      resolution: "OVERRIDDEN",
      effectiveOutcome: "NOT_APPLICABLE",
      relatedRuleIds: [UUIDS.rule],
    });
    expect(
      EvaluationResultSchema.safeParse({
        findings: [source, target],
        aggregateOutcome: "PASS",
      }).success,
    ).toBe(true);
  });

  it("accepts reciprocal uncertain override peers backed by an UNKNOWN trace", () => {
    const source = unchangedFinding({
      finding: findingWithOverride(UUIDS.rule, UUIDS.otherRule, "UNKNOWN"),
      resolution: "UNCERTAIN_OVERRIDE",
      effectiveOutcome: "REVIEW",
      relatedRuleIds: [UUIDS.otherRule],
    });
    const target = unchangedFinding({
      finding: passFinding({ ruleId: UUIDS.otherRule }),
      resolution: "UNCERTAIN_OVERRIDE",
      effectiveOutcome: "REVIEW",
      relatedRuleIds: [UUIDS.rule],
    });
    expect(
      EvaluationResultSchema.safeParse({
        findings: [source, target],
        aggregateOutcome: "REVIEW",
      }).success,
    ).toBe(true);
  });

  it("accepts reciprocal conflict peers", () => {
    const left = unchangedFinding({
      resolution: "CONFLICT_REVIEW",
      effectiveOutcome: "REVIEW",
      relatedRuleIds: [UUIDS.otherRule],
    });
    const right = unchangedFinding({
      finding: passFinding({ ruleId: UUIDS.otherRule }),
      resolution: "CONFLICT_REVIEW",
      effectiveOutcome: "REVIEW",
      relatedRuleIds: [UUIDS.rule],
    });
    expect(
      EvaluationResultSchema.safeParse({
        findings: [left, right],
        aggregateOutcome: "REVIEW",
      }).success,
    ).toBe(true);
  });

  it.each([
    ["empty findings", { findings: [], aggregateOutcome: "NOT_APPLICABLE" }],
    ["aggregate drift", { findings: [unchangedFinding()], aggregateOutcome: "FAIL" }],
    [
      "duplicate rule",
      { findings: [unchangedFinding(), unchangedFinding()], aggregateOutcome: "PASS" },
    ],
    [
      "mixed evaluation dates",
      {
        findings: [
          unchangedFinding(),
          unchangedFinding({
            finding: passFinding({
              ruleId: UUIDS.otherRule,
              evaluationDate: "2026-01-02T00:00:00Z",
            }),
          }),
        ],
        aggregateOutcome: "PASS",
      },
    ],
    [
      "out-of-order findings",
      {
        findings: [
          unchangedFinding({ finding: passFinding({ ruleId: UUIDS.otherRule }) }),
          unchangedFinding(),
        ],
        aggregateOutcome: "PASS",
      },
    ],
    [
      "missing related peer",
      {
        findings: [
          unchangedFinding({
            resolution: "CONFLICT_REVIEW",
            effectiveOutcome: "REVIEW",
            relatedRuleIds: [UUIDS.otherRule],
          }),
        ],
        aggregateOutcome: "REVIEW",
      },
    ],
    [
      "spoofed overridden source",
      {
        findings: [
          unchangedFinding(),
          unchangedFinding({
            finding: passFinding({ ruleId: UUIDS.otherRule }),
            resolution: "OVERRIDDEN",
            effectiveOutcome: "NOT_APPLICABLE",
            relatedRuleIds: [UUIDS.rule],
          }),
        ],
        aggregateOutcome: "PASS",
      },
    ],
    [
      "spoofed uncertain override",
      {
        findings: [
          unchangedFinding({
            resolution: "UNCERTAIN_OVERRIDE",
            effectiveOutcome: "REVIEW",
            relatedRuleIds: [UUIDS.otherRule],
          }),
          unchangedFinding({
            finding: passFinding({ ruleId: UUIDS.otherRule }),
            resolution: "UNCERTAIN_OVERRIDE",
            effectiveOutcome: "REVIEW",
            relatedRuleIds: [UUIDS.rule],
          }),
        ],
        aggregateOutcome: "REVIEW",
      },
    ],
    [
      "asymmetric uncertain override",
      {
        findings: [
          unchangedFinding({
            finding: findingWithOverride(UUIDS.rule, UUIDS.otherRule, "UNKNOWN"),
            resolution: "UNCERTAIN_OVERRIDE",
            effectiveOutcome: "REVIEW",
            relatedRuleIds: [UUIDS.otherRule],
          }),
          unchangedFinding({
            finding: passFinding({ ruleId: UUIDS.otherRule }),
            resolution: "UNCERTAIN_OVERRIDE",
            effectiveOutcome: "REVIEW",
            relatedRuleIds: [UUIDS.thirdRule],
          }),
          unchangedFinding({ finding: passFinding({ ruleId: UUIDS.thirdRule }) }),
        ],
        aggregateOutcome: "REVIEW",
      },
    ],
    [
      "asymmetric conflict",
      {
        findings: [
          unchangedFinding({
            resolution: "CONFLICT_REVIEW",
            effectiveOutcome: "REVIEW",
            relatedRuleIds: [UUIDS.otherRule],
          }),
          unchangedFinding({ finding: passFinding({ ruleId: UUIDS.otherRule }) }),
        ],
        aggregateOutcome: "REVIEW",
      },
    ],
    ["unknown field", { findings: [unchangedFinding()], aggregateOutcome: "PASS", extra: true }],
  ] as const)("rejects %s", (_label, candidate) => {
    expect(EvaluationResultSchema.safeParse(candidate).success).toBe(false);
  });
});
