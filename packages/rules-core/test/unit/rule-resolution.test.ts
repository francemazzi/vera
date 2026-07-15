import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  DSL_VERSION,
  EvaluationResultSchema,
  RuleDefinitionSchema,
  RuleFindingSchema,
  canonicalizeJson,
  computeRuleDefinitionHash,
  type EvaluationOutcome,
  type ExpressionTrace,
  type ResolvedRuleFinding,
  type RuleDefinition,
  type RuleDefinitionHashInput,
  type RuleFinding,
  type TruthValue,
} from "@vera/contracts";

import { resolveRuleFindings } from "../../src/rule-resolution.js";

const SOURCE_ID = "00000000-0000-4000-8000-000000009001";
const SOURCE_VERSION_ID = "00000000-0000-4000-8000-000000009002";
const CARD_ID = "00000000-0000-4000-8000-000000009003";
const CARD_REVISION_ID = "00000000-0000-4000-8000-000000009004";
const EVALUATION_DATE = "2026-06-01T00:00:00.000Z";

function uuidFromInteger(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

interface OverrideFixture {
  readonly targetId: string;
  readonly declaredTruth?: TruthValue;
}

interface RuleFixtureOptions {
  readonly overrides?: readonly OverrideFixture[];
  readonly conflictsWith?: readonly string[];
  readonly normativeKey?: string;
  readonly deonticCategory?: RuleDefinition["deonticCategory"];
  readonly validFrom?: string;
  readonly validTo?: string | null;
}

function ruleNumber(id: string): number {
  return Number.parseInt(id.slice(-6), 10);
}

function makeRule(id: string, options: RuleFixtureOptions = {}): RuleDefinition {
  const input: RuleDefinitionHashInput = {
    dslVersion: DSL_VERSION,
    state: "DRAFT",
    id,
    sourceId: SOURCE_ID,
    sourceVersionId: SOURCE_VERSION_ID,
    sourceContentHash: "a".repeat(64),
    ruleCardId: CARD_ID,
    ruleCardRevisionId: CARD_REVISION_ID,
    ruleCardRevisionContentHash: "b".repeat(64),
    normativeKey: options.normativeKey ?? `synthetic.rule.${id.slice(-6)}`,
    deonticCategory: options.deonticCategory ?? "OBLIGATION",
    riskLevel: "LOW",
    validity: {
      validFrom: options.validFrom ?? "2026-01-01T00:00:00.000Z",
      validTo: options.validTo === undefined ? "2027-01-01T00:00:00.000Z" : options.validTo,
    },
    appliesWhen: { op: "truth", value: "TRUE" },
    satisfiedWhen: { op: "truth", value: "TRUE" },
    exceptions: [],
    overrides: (options.overrides ?? []).map(({ targetId, declaredTruth = "TRUE" }, index) => ({
      id: uuidFromInteger(100_000 + ruleNumber(id) * 100 + index),
      overridingRuleId: id,
      overriddenRuleId: targetId,
      when: { op: "truth", value: declaredTruth },
      reason: "Synthetic explicit precedence",
      sourceVersionId: SOURCE_VERSION_ID,
      sourceReference: `synthetic-override-${String(index)}`,
    })),
    conflictsWith: [...(options.conflictsWith ?? [])],
    evidenceBindings: [],
    unknownPolicy: "REVIEW",
    validationScope: "TECHNICAL_DEMO",
  };
  return RuleDefinitionSchema.parse({ ...input, contentHash: computeRuleDefinitionHash(input) });
}

function truthTrace(path: string, truth: TruthValue): ExpressionTrace {
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

function makeFinding(
  rule: RuleDefinition,
  outcome: EvaluationOutcome = "PASS",
  overrideTruths: Readonly<Record<string, TruthValue>> = {},
): RuleFinding {
  const appliesTruth: TruthValue = outcome === "NOT_APPLICABLE" ? "FALSE" : "TRUE";
  const satisfiedTruth: TruthValue =
    outcome === "FAIL" ? "FALSE" : outcome === "REVIEW" ? "UNKNOWN" : "TRUE";
  const satisfiedWhen =
    appliesTruth === "TRUE" ? truthTrace("/satisfiedWhen", satisfiedTruth) : null;
  return RuleFindingSchema.parse({
    ruleId: rule.id,
    ruleContentHash: rule.contentHash,
    evaluationDate: EVALUATION_DATE,
    outcome,
    appliesWhen: truthTrace("/appliesWhen", appliesTruth),
    exceptionTraces: [],
    satisfiedWhen,
    overrideTraces:
      satisfiedWhen === null
        ? []
        : rule.overrides.map((override, index) => ({
            overrideId: override.id,
            overriddenRuleId: override.overriddenRuleId,
            trace: truthTrace(
              `/overrides/${String(index)}/when`,
              overrideTruths[override.id] ??
                (override.when.op === "truth" ? override.when.value : "UNKNOWN"),
            ),
          })),
    evidenceIds: [],
    validationScope: "TECHNICAL_DEMO",
  });
}

function makeUncertainApplicabilityFinding(rule: RuleDefinition): RuleFinding {
  return RuleFindingSchema.parse({
    ruleId: rule.id,
    ruleContentHash: rule.contentHash,
    evaluationDate: EVALUATION_DATE,
    outcome: "REVIEW",
    appliesWhen: truthTrace("/appliesWhen", "UNKNOWN"),
    exceptionTraces: [],
    satisfiedWhen: null,
    overrideTraces: [],
    evidenceIds: [],
    validationScope: "TECHNICAL_DEMO",
  });
}

function resolutionById(
  result: ReturnType<typeof resolveRuleFindings>,
  id: string,
): ResolvedRuleFinding {
  const resolved = result.findings.find(({ finding }) => finding.ruleId === id);
  if (resolved === undefined) throw new Error(`Missing resolved finding ${id}`);
  return resolved;
}

interface TopologyEdge {
  readonly source: number;
  readonly target: number;
  readonly truth: TruthValue;
}

function makeTopology(
  nodeCount: number,
  edges: readonly TopologyEdge[],
  idBase: number,
): { readonly rules: readonly RuleDefinition[]; readonly findings: readonly RuleFinding[] } {
  const ids = Array.from({ length: nodeCount }, (_, index) => uuidFromInteger(idBase + index));
  const rules = ids.map((id, source) =>
    makeRule(id, {
      overrides: edges
        .filter((edge) => edge.source === source)
        .map((edge) => {
          const targetId = ids[edge.target];
          if (targetId === undefined) throw new Error("Invalid synthetic topology target");
          return { targetId, declaredTruth: edge.truth };
        }),
    }),
  );
  return { rules, findings: rules.map((rule) => makeFinding(rule)) };
}

describe("resolveRuleFindings", () => {
  it("resolves a DAG topologically and prevents an overridden rule from overriding another", () => {
    const aId = uuidFromInteger(1);
    const bId = uuidFromInteger(2);
    const cId = uuidFromInteger(3);
    const a = makeRule(aId, { overrides: [{ targetId: bId }] });
    const b = makeRule(bId, { overrides: [{ targetId: cId }] });
    const c = makeRule(cId);

    const result = resolveRuleFindings(
      [c, b, a],
      [makeFinding(c, "FAIL"), makeFinding(a), makeFinding(b, "FAIL")],
    );

    expect(result.findings.map(({ finding }) => finding.ruleId)).toEqual([aId, bId, cId]);
    expect(resolutionById(result, aId)).toMatchObject({
      resolution: "UNCHANGED",
      effectiveOutcome: "PASS",
      relatedRuleIds: [],
    });
    expect(resolutionById(result, bId)).toMatchObject({
      resolution: "OVERRIDDEN",
      effectiveOutcome: "NOT_APPLICABLE",
      relatedRuleIds: [aId],
    });
    expect(resolutionById(result, cId)).toMatchObject({
      resolution: "UNCHANGED",
      effectiveOutcome: "FAIL",
    });
    expect(result.aggregateOutcome).toBe("FAIL");
    expect(EvaluationResultSchema.safeParse(result).success).toBe(true);
  });

  it.each([
    ["FALSE", "PASS"],
    ["TRUE", "NOT_APPLICABLE"],
  ] as const)(
    "does not activate an override with trace %s and overriding outcome %s",
    (overrideTruth, sourceOutcome) => {
      const aId = uuidFromInteger(10);
      const bId = uuidFromInteger(11);
      const a = makeRule(aId, { overrides: [{ targetId: bId }] });
      const b = makeRule(bId);
      const override = a.overrides[0];
      if (override === undefined) throw new Error("Expected override fixture");

      const result = resolveRuleFindings(
        [a, b],
        [makeFinding(a, sourceOutcome, { [override.id]: overrideTruth }), makeFinding(b, "FAIL")],
      );

      expect(resolutionById(result, bId)).toMatchObject({
        resolution: "UNCHANGED",
        effectiveOutcome: "FAIL",
        relatedRuleIds: [],
      });
    },
  );

  it("turns both endpoints of an UNKNOWN override into reciprocal REVIEW findings", () => {
    const aId = uuidFromInteger(12);
    const bId = uuidFromInteger(13);
    const a = makeRule(aId, { overrides: [{ targetId: bId }] });
    const b = makeRule(bId);
    const override = a.overrides[0];
    if (override === undefined) throw new Error("Expected uncertain override fixture");

    const result = resolveRuleFindings(
      [a, b],
      [makeFinding(a, "PASS", { [override.id]: "UNKNOWN" }), makeFinding(b, "FAIL")],
    );
    expect(resolutionById(result, aId)).toMatchObject({
      resolution: "UNCERTAIN_OVERRIDE",
      effectiveOutcome: "REVIEW",
      relatedRuleIds: [bId],
    });
    expect(resolutionById(result, bId)).toMatchObject({
      resolution: "UNCERTAIN_OVERRIDE",
      effectiveOutcome: "REVIEW",
      relatedRuleIds: [aId],
    });
    expect(result.aggregateOutcome).toBe("REVIEW");
    expect(EvaluationResultSchema.safeParse(result).success).toBe(true);
  });

  it("never derives precedence from uncertain applicability and permits skipped traces", () => {
    const aId = uuidFromInteger(14);
    const bId = uuidFromInteger(15);
    const a = makeRule(aId, { overrides: [{ targetId: bId }] });
    const b = makeRule(bId);

    const uncertainResult = resolveRuleFindings(
      [a, b],
      [makeUncertainApplicabilityFinding(a), makeFinding(b, "FAIL")],
    );
    expect(resolutionById(uncertainResult, aId)).toMatchObject({
      resolution: "UNCHANGED",
      effectiveOutcome: "REVIEW",
      relatedRuleIds: [],
    });
    expect(resolutionById(uncertainResult, bId)).toMatchObject({
      resolution: "UNCHANGED",
      effectiveOutcome: "FAIL",
      relatedRuleIds: [],
    });
    expect(uncertainResult.aggregateOutcome).toBe("FAIL");

    const notApplicableResult = resolveRuleFindings(
      [a, b],
      [makeFinding(a, "NOT_APPLICABLE"), makeFinding(b, "FAIL")],
    );
    expect(resolutionById(notApplicableResult, aId).resolution).toBe("UNCHANGED");
    expect(resolutionById(notApplicableResult, bId).resolution).toBe("UNCHANGED");
  });

  it("fails a missing override trace closed only on the operative path", () => {
    const aId = uuidFromInteger(16);
    const bId = uuidFromInteger(17);
    const a = makeRule(aId, { overrides: [{ targetId: bId }] });
    const b = makeRule(bId);
    const operativeWithoutTrace = RuleFindingSchema.parse({
      ...makeFinding(a),
      overrideTraces: [],
    });

    const result = resolveRuleFindings([a, b], [operativeWithoutTrace, makeFinding(b, "FAIL")]);
    expect(resolutionById(result, aId).resolution).toBe("INVALID_OVERRIDE_GRAPH");
    expect(resolutionById(result, bId).resolution).toBe("INVALID_OVERRIDE_GRAPH");
    expect(EvaluationResultSchema.safeParse(result).success).toBe(true);
  });

  it("fails a cyclic override component closed to REVIEW without throwing", () => {
    const aId = uuidFromInteger(20);
    const bId = uuidFromInteger(21);
    const a = makeRule(aId, { overrides: [{ targetId: bId }] });
    const b = makeRule(bId, { overrides: [{ targetId: aId }] });

    const result = resolveRuleFindings([a, b], [makeFinding(a, "FAIL"), makeFinding(b)]);

    expect(result.aggregateOutcome).toBe("REVIEW");
    expect(resolutionById(result, aId)).toMatchObject({
      resolution: "INVALID_OVERRIDE_GRAPH",
      effectiveOutcome: "REVIEW",
      relatedRuleIds: [bId],
    });
    expect(resolutionById(result, bId)).toMatchObject({
      resolution: "INVALID_OVERRIDE_GRAPH",
      effectiveOutcome: "REVIEW",
      relatedRuleIds: [aId],
    });
    expect(EvaluationResultSchema.safeParse(result).success).toBe(true);
  });

  it("fails dangling and non-overlapping override references closed", () => {
    const danglingTargetId = uuidFromInteger(31);
    const dangling = makeRule(uuidFromInteger(30), {
      overrides: [{ targetId: danglingTargetId }],
    });
    const danglingResult = resolveRuleFindings([dangling], [makeFinding(dangling)]);
    expect(danglingResult.findings[0]).toMatchObject({
      resolution: "INVALID_OVERRIDE_GRAPH",
      effectiveOutcome: "REVIEW",
      relatedRuleIds: [],
    });
    expect(EvaluationResultSchema.safeParse(danglingResult).success).toBe(true);

    const earlyId = uuidFromInteger(32);
    const lateId = uuidFromInteger(33);
    const early = makeRule(earlyId, {
      overrides: [{ targetId: lateId }],
      validFrom: "2025-01-01T00:00:00.000Z",
      validTo: "2025-06-01T00:00:00.000Z",
    });
    const late = makeRule(lateId, {
      validFrom: "2025-06-01T00:00:00.000Z",
      validTo: "2026-01-01T00:00:00.000Z",
    });
    const nonOverlapResult = resolveRuleFindings(
      [early, late],
      [makeFinding(early), makeFinding(late)],
    );
    expect(nonOverlapResult.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resolution: "INVALID_OVERRIDE_GRAPH" }),
        expect.objectContaining({ resolution: "INVALID_OVERRIDE_GRAPH" }),
      ]),
    );
    expect(EvaluationResultSchema.safeParse(nonOverlapResult).success).toBe(true);
  });

  it("rejects a mismatched override trace and an incoherent rule hash as REVIEW", () => {
    const aId = uuidFromInteger(40);
    const bId = uuidFromInteger(41);
    const unrelatedId = uuidFromInteger(42);
    const a = makeRule(aId, { overrides: [{ targetId: bId }] });
    const b = makeRule(bId);
    const aFinding = makeFinding(a);
    const trace = aFinding.overrideTraces[0];
    if (trace === undefined) throw new Error("Expected override trace fixture");
    const mismatchedFinding = RuleFindingSchema.parse({
      ...aFinding,
      overrideTraces: [{ ...trace, overriddenRuleId: unrelatedId }],
    });

    const mismatchedResult = resolveRuleFindings(
      [a, b],
      [mismatchedFinding, makeFinding(b, "FAIL")],
    );
    expect(resolutionById(mismatchedResult, aId).resolution).toBe("INVALID_OVERRIDE_GRAPH");
    expect(resolutionById(mismatchedResult, bId).resolution).toBe("INVALID_OVERRIDE_GRAPH");
    expect(EvaluationResultSchema.safeParse(mismatchedResult).success).toBe(true);

    const badHashFinding = RuleFindingSchema.parse({
      ...makeFinding(b),
      ruleContentHash: "f".repeat(64),
    });
    const hashResult = resolveRuleFindings([b], [badHashFinding]);
    expect(hashResult.findings[0]).toMatchObject({
      resolution: "INVALID_OVERRIDE_GRAPH",
      effectiveOutcome: "REVIEW",
      relatedRuleIds: [],
    });
    expect(EvaluationResultSchema.safeParse(hashResult).success).toBe(true);
  });

  it("turns both applicable sides of an unresolved declared conflict into REVIEW", () => {
    const aId = uuidFromInteger(50);
    const bId = uuidFromInteger(51);
    const cId = uuidFromInteger(52);
    const a = makeRule(aId, { conflictsWith: [bId] });
    const b = makeRule(bId);
    const c = makeRule(cId);

    const result = resolveRuleFindings(
      [a, b, c],
      [makeFinding(a), makeFinding(b, "FAIL"), makeFinding(c, "FAIL")],
    );

    expect(resolutionById(result, aId)).toMatchObject({
      resolution: "CONFLICT_REVIEW",
      effectiveOutcome: "REVIEW",
      relatedRuleIds: [bId],
    });
    expect(resolutionById(result, bId)).toMatchObject({
      resolution: "CONFLICT_REVIEW",
      effectiveOutcome: "REVIEW",
      relatedRuleIds: [aId],
    });
    expect(resolutionById(result, cId).effectiveOutcome).toBe("FAIL");
    expect(result.aggregateOutcome).toBe("FAIL");
  });

  it.each(["OBLIGATION", "PERMISSION"] as const)(
    "detects the implicit %s versus PROHIBITION conflict for one normative key",
    (category) => {
      const leftId = uuidFromInteger(category === "OBLIGATION" ? 53 : 55);
      const prohibitionId = uuidFromInteger(category === "OBLIGATION" ? 54 : 56);
      const normativeKey = `synthetic.implicit.${category.toLowerCase()}`;
      const left = makeRule(leftId, { normativeKey, deonticCategory: category });
      const prohibition = makeRule(prohibitionId, {
        normativeKey,
        deonticCategory: "PROHIBITION",
      });

      const result = resolveRuleFindings(
        [prohibition, left],
        [makeFinding(left), makeFinding(prohibition, "FAIL")],
      );
      expect(resolutionById(result, leftId)).toMatchObject({
        resolution: "CONFLICT_REVIEW",
        effectiveOutcome: "REVIEW",
        relatedRuleIds: [prohibitionId],
      });
      expect(resolutionById(result, prohibitionId)).toMatchObject({
        resolution: "CONFLICT_REVIEW",
        effectiveOutcome: "REVIEW",
        relatedRuleIds: [leftId],
      });
      expect(EvaluationResultSchema.safeParse(result).success).toBe(true);
    },
  );

  it("leaves a conflict unchanged when one side is not applicable", () => {
    const aId = uuidFromInteger(60);
    const bId = uuidFromInteger(61);
    const a = makeRule(aId, { conflictsWith: [bId] });
    const b = makeRule(bId);

    const result = resolveRuleFindings([a, b], [makeFinding(a), makeFinding(b, "NOT_APPLICABLE")]);
    expect(result.findings.map(({ resolution }) => resolution)).toEqual(["UNCHANGED", "UNCHANGED"]);
    expect(result.aggregateOutcome).toBe("PASS");
  });

  it("uses an active explicit precedence relation to resolve a declared conflict", () => {
    const aId = uuidFromInteger(70);
    const bId = uuidFromInteger(71);
    const a = makeRule(aId, {
      overrides: [{ targetId: bId }],
      conflictsWith: [bId],
    });
    const b = makeRule(bId, { conflictsWith: [aId] });

    const result = resolveRuleFindings([b, a], [makeFinding(b, "FAIL"), makeFinding(a)]);
    expect(resolutionById(result, aId).resolution).toBe("UNCHANGED");
    expect(resolutionById(result, bId)).toMatchObject({
      resolution: "OVERRIDDEN",
      effectiveOutcome: "NOT_APPLICABLE",
      relatedRuleIds: [aId],
    });
    expect(result.aggregateOutcome).toBe("PASS");
  });

  it("preserves deterministic override fan-in beyond the previous relation bound", () => {
    const targetId = uuidFromInteger(6_999);
    const target = makeRule(targetId);
    const sources = Array.from({ length: 250 }, (_, index) =>
      makeRule(uuidFromInteger(6_000 + index), { overrides: [{ targetId }] }),
    );
    const result = resolveRuleFindings(
      [target, ...sources].reverse(),
      [makeFinding(target, "FAIL"), ...sources.map((rule) => makeFinding(rule))].reverse(),
    );

    const resolvedTarget = resolutionById(result, targetId);
    expect(resolvedTarget.resolution).toBe("OVERRIDDEN");
    expect(resolvedTarget.effectiveOutcome).toBe("NOT_APPLICABLE");
    expect(resolvedTarget.relatedRuleIds).toEqual(sources.map(({ id }) => id).sort());
    expect(EvaluationResultSchema.safeParse(result).success).toBe(true);
  });

  it("fails an incomplete one-to-one rule/finding map closed", () => {
    const aId = uuidFromInteger(80);
    const bId = uuidFromInteger(81);
    const a = makeRule(aId);
    const b = makeRule(bId);

    const result = resolveRuleFindings([a, b], [makeFinding(a, "FAIL")]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      resolution: "INVALID_OVERRIDE_GRAPH",
      effectiveOutcome: "REVIEW",
      relatedRuleIds: [],
    });
    expect(result.aggregateOutcome).toBe("REVIEW");
    expect(EvaluationResultSchema.safeParse(result).success).toBe(true);
  });

  it("collapses duplicate rule and finding identities deterministically as an invalid map", () => {
    const a = makeRule(uuidFromInteger(85));
    const finding = makeFinding(a);

    const result = resolveRuleFindings([a, a], [finding, finding]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      resolution: "INVALID_OVERRIDE_GRAPH",
      effectiveOutcome: "REVIEW",
      relatedRuleIds: [],
    });
    expect(EvaluationResultSchema.safeParse(result).success).toBe(true);

    const target = makeRule(uuidFromInteger(8501));
    const overriding = makeRule(uuidFromInteger(8500), {
      overrides: [{ targetId: target.id }],
    });
    const override = overriding.overrides[0];
    if (override === undefined) throw new Error("Expected duplicate-map override fixture");
    const trueFinding = makeFinding(overriding, "PASS", { [override.id]: "TRUE" });
    const falseFinding = makeFinding(overriding, "PASS", { [override.id]: "FALSE" });
    const targetFinding = makeFinding(target);
    expect(
      resolveRuleFindings([overriding, target], [trueFinding, targetFinding, falseFinding]),
    ).toEqual(
      resolveRuleFindings([target, overriding], [falseFinding, targetFinding, trueFinding]),
    );
  });

  it("fails extra override traces and dangling conflict declarations closed", () => {
    const targetId = uuidFromInteger(87);
    const traceOnlyRule = makeRule(uuidFromInteger(86));
    const extraTraceFinding = RuleFindingSchema.parse({
      ...makeFinding(traceOnlyRule),
      overrideTraces: [
        {
          overrideId: uuidFromInteger(900_086),
          overriddenRuleId: targetId,
          trace: truthTrace("/overrides/0/when", "TRUE"),
        },
      ],
    });
    const extraTraceResult = resolveRuleFindings([traceOnlyRule], [extraTraceFinding]);
    expect(extraTraceResult.findings[0]).toMatchObject({
      resolution: "INVALID_OVERRIDE_GRAPH",
      relatedRuleIds: [],
    });
    expect(EvaluationResultSchema.safeParse(extraTraceResult).success).toBe(true);

    const conflictRule = makeRule(uuidFromInteger(88), { conflictsWith: [targetId] });
    const conflictResult = resolveRuleFindings([conflictRule], [makeFinding(conflictRule)]);
    expect(conflictResult.findings[0]).toMatchObject({
      resolution: "INVALID_OVERRIDE_GRAPH",
      effectiveOutcome: "REVIEW",
      relatedRuleIds: [],
    });
    expect(EvaluationResultSchema.safeParse(conflictResult).success).toBe(true);
  });

  it("is deterministic across input order, repeatable, and side-effect free", () => {
    const aId = uuidFromInteger(90);
    const bId = uuidFromInteger(91);
    const cId = uuidFromInteger(92);
    const a = makeRule(aId, { overrides: [{ targetId: bId }] });
    const b = makeRule(bId);
    const c = makeRule(cId, { conflictsWith: [aId] });
    const rules = [a, b, c];
    const findings = [makeFinding(a), makeFinding(b, "FAIL"), makeFinding(c)];
    const rulesBefore = structuredClone(rules);
    const findingsBefore = structuredClone(findings);
    const expected = resolveRuleFindings(rules, findings);
    const mutableFindings = structuredClone(findings);
    const detached = resolveRuleFindings(rules, mutableFindings);
    const mutableFirstFinding = mutableFindings[0];
    if (mutableFirstFinding === undefined) throw new Error("Expected mutable finding fixture");
    (mutableFirstFinding as unknown as { outcome: EvaluationOutcome }).outcome = "FAIL";

    fc.assert(
      fc.property(
        fc.shuffledSubarray(rules, { minLength: rules.length, maxLength: rules.length }),
        fc.shuffledSubarray(findings, {
          minLength: findings.length,
          maxLength: findings.length,
        }),
        (shuffledRules, shuffledFindings) => {
          expect(resolveRuleFindings(shuffledRules, shuffledFindings)).toEqual(expected);
          expect(resolveRuleFindings(shuffledRules, shuffledFindings)).toEqual(
            resolveRuleFindings(shuffledRules, shuffledFindings),
          );
        },
      ),
      { numRuns: 50 },
    );

    expect(rules).toEqual(rulesBefore);
    expect(findings).toEqual(findingsBefore);
    expect(expected.findings).not.toBe(findings);
    expect(expected.findings[0]?.finding).not.toBe(findings[0]);
    expect(Object.isFrozen(expected)).toBe(true);
    expect(Object.isFrozen(expected.findings)).toBe(true);
    expect(Object.isFrozen(expected.findings[0])).toBe(true);
    expect(Object.isFrozen(expected.findings[0]?.finding)).toBe(true);
    expect(Object.isFrozen(expected.findings[0]?.relatedRuleIds)).toBe(true);
    expect(detached.findings[0]?.finding.outcome).toBe("PASS");
  });

  it("preserves canonical replay for generated DAGs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 7 }),
        fc.array(fc.boolean(), { minLength: 21, maxLength: 21 }),
        fc.array(fc.constantFrom<TruthValue>("TRUE", "FALSE", "UNKNOWN"), {
          minLength: 21,
          maxLength: 21,
        }),
        (nodeCount, enabled, truths) => {
          const edges: TopologyEdge[] = [];
          let edgeIndex = 0;
          for (let source = 0; source < nodeCount; source += 1) {
            for (let target = source + 1; target < nodeCount; target += 1) {
              if (enabled[edgeIndex] === true) {
                edges.push({
                  source,
                  target,
                  truth: truths[edgeIndex] ?? "FALSE",
                });
              }
              edgeIndex += 1;
            }
          }
          const topology = makeTopology(nodeCount, edges, 20_000);
          const forward = resolveRuleFindings(topology.rules, topology.findings);
          const reverse = resolveRuleFindings(
            [...topology.rules].reverse(),
            [...topology.findings].reverse(),
          );

          expect(
            forward.findings.every(({ resolution }) => resolution !== "INVALID_OVERRIDE_GRAPH"),
          ).toBe(true);
          expect(canonicalizeJson(reverse)).toBe(canonicalizeJson(forward));
          expect(canonicalizeJson(resolveRuleFindings(topology.rules, topology.findings))).toBe(
            canonicalizeJson(forward),
          );
        },
      ),
      { numRuns: 30 },
    );
  });

  it("isolates generated cyclic components from independent DAG components", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 1, max: 4 }),
        fc.constantFrom<TruthValue>("TRUE", "FALSE", "UNKNOWN"),
        (cycleSize, dagSize, dagTruth) => {
          const cycleEdges = Array.from({ length: cycleSize }, (_, source) => ({
            source,
            target: (source + 1) % cycleSize,
            truth: "FALSE" as const,
          }));
          const cycle = makeTopology(cycleSize, cycleEdges, 21_000);
          const dagEdges = Array.from({ length: Math.max(0, dagSize - 1) }, (_, source) => ({
            source,
            target: source + 1,
            truth: dagTruth,
          }));
          const dag = makeTopology(dagSize, dagEdges, 22_000);
          const result = resolveRuleFindings(
            [...dag.rules, ...cycle.rules],
            [...cycle.findings, ...dag.findings],
          );

          for (const rule of cycle.rules) {
            expect(resolutionById(result, rule.id).resolution).toBe("INVALID_OVERRIDE_GRAPH");
          }
          for (const rule of dag.rules) {
            expect(resolutionById(result, rule.id).resolution).not.toBe("INVALID_OVERRIDE_GRAPH");
          }
          expect(EvaluationResultSchema.safeParse(result).success).toBe(true);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("resolves generated diamond graphs independently of edge truth combinations", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.constantFrom<TruthValue>("TRUE", "FALSE", "UNKNOWN"),
          fc.constantFrom<TruthValue>("TRUE", "FALSE", "UNKNOWN"),
          fc.constantFrom<TruthValue>("TRUE", "FALSE", "UNKNOWN"),
          fc.constantFrom<TruthValue>("TRUE", "FALSE", "UNKNOWN"),
        ),
        (truths) => {
          const topology = makeTopology(
            4,
            [
              { source: 0, target: 1, truth: truths[0] },
              { source: 0, target: 2, truth: truths[1] },
              { source: 1, target: 3, truth: truths[2] },
              { source: 2, target: 3, truth: truths[3] },
            ],
            23_000,
          );
          const result = resolveRuleFindings(topology.rules, topology.findings);
          expect(EvaluationResultSchema.safeParse(result).success).toBe(true);
          expect(
            result.findings.every(({ resolution }) => resolution !== "INVALID_OVERRIDE_GRAPH"),
          ).toBe(true);
          expect(canonicalizeJson(result)).toBe(
            canonicalizeJson(
              resolveRuleFindings([...topology.rules].reverse(), [...topology.findings].reverse()),
            ),
          );
        },
      ),
      { numRuns: 30 },
    );
  });

  it("explicitly rejects findings from different evaluation instants", () => {
    const a = makeRule(uuidFromInteger(95));
    const b = makeRule(uuidFromInteger(96));
    const laterFinding = RuleFindingSchema.parse({
      ...makeFinding(b),
      evaluationDate: "2026-06-01T00:00:00.000001Z",
    });

    expect(() => resolveRuleFindings([a, b], [makeFinding(a), laterFinding])).toThrow(
      new RangeError("Rule finding resolution requires one common evaluation date"),
    );
  });

  it("snapshots only bounded dense data-property input arrays before resolution", () => {
    const rule = makeRule(uuidFromInteger(97));
    const finding = makeFinding(rule);
    expect(() =>
      resolveRuleFindings(new Array<RuleDefinition>(10_001).fill(rule), [finding]),
    ).toThrow(new RangeError("Rules cannot exceed 10000 entries"));
    expect(() => resolveRuleFindings([rule], new Array<RuleFinding>(10_001).fill(finding))).toThrow(
      new RangeError("Findings cannot exceed 10000 entries"),
    );

    let getterReads = 0;
    const accessorRules = [rule];
    Object.defineProperty(accessorRules, "0", {
      configurable: true,
      enumerable: true,
      get: () => {
        getterReads += 1;
        return rule;
      },
    });
    expect(() => resolveRuleFindings(accessorRules, [finding])).toThrow(
      new TypeError("Rules entries must be enumerable data properties"),
    );
    expect(getterReads).toBe(0);
  });

  it("rejects an empty finding collection with a controlled error", () => {
    expect(() => resolveRuleFindings([], [])).toThrow(
      new RangeError("Rule finding resolution requires at least one finding"),
    );
  });
});
