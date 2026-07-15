import { readFileSync } from "node:fs";

import {
  DSL_VERSION,
  EvidenceSchema,
  EvaluationResultSchema,
  FactSchema,
  RuleDefinitionSchema,
  canonicalizeJson,
  computeRuleDefinitionHash,
} from "@vera/contracts";
import type {
  DeonticCategory,
  DslExpression,
  Evidence,
  EvaluationResult,
  ExtractionFact,
  ResolvedRuleFinding,
  RuleDefinition,
  RuleDefinitionHashInput,
  TruthValue,
} from "@vera/contracts";
import { describe, expect, it } from "vitest";

import { evaluateRule } from "../../src/dsl-evaluator.js";
import { resolveRuleFindings } from "../../src/rule-resolution.js";

const EVALUATION_DATE = "2026-07-15T10:00:00.0001Z";
const SOURCE_ID = "00000000-0000-4000-8000-000000008001";
const SOURCE_VERSION_ID = "00000000-0000-4000-8000-000000008002";
const CARD_ID = "00000000-0000-4000-8000-000000008003";
const CARD_REVISION_ID = "00000000-0000-4000-8000-000000008004";
const PROVIDER_RUN_ID = "00000000-0000-4000-8000-000000008005";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000008006";
const EVIDENCE_ID = "00000000-0000-4000-8000-000000008007";

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

interface OverrideFixture {
  readonly targetId: string;
  readonly truth: TruthValue;
}

interface RuleFixtureOptions {
  readonly number: number;
  readonly normativeKey?: string;
  readonly deonticCategory?: DeonticCategory;
  readonly appliesWhen?: DslExpression;
  readonly satisfiedWhen?: DslExpression;
  readonly overrides?: readonly OverrideFixture[];
  readonly evidenceBindings?: RuleDefinitionHashInput["evidenceBindings"];
}

function makeRule(options: RuleFixtureOptions): RuleDefinition {
  const id = uuid(options.number);
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
    normativeKey: options.normativeKey ?? `synthetic.kernel.${String(options.number)}`,
    deonticCategory: options.deonticCategory ?? "OBLIGATION",
    riskLevel: "LOW",
    validity: {
      validFrom: "2026-01-01T00:00:00.0001Z",
      validTo: "2027-01-01T00:00:00.0001Z",
    },
    appliesWhen: options.appliesWhen ?? { op: "truth", value: "TRUE" },
    satisfiedWhen: options.satisfiedWhen ?? { op: "truth", value: "TRUE" },
    exceptions: [],
    overrides: (options.overrides ?? []).map(({ targetId, truth }, index) => ({
      id: uuid(100_000 + options.number * 10 + index),
      overridingRuleId: id,
      overriddenRuleId: targetId,
      when: { op: "truth", value: truth },
      reason: "Synthetic explicit precedence",
      sourceVersionId: SOURCE_VERSION_ID,
      sourceReference: `synthetic.override.${String(index)}`,
    })),
    conflictsWith: [],
    evidenceBindings: options.evidenceBindings ?? [],
    unknownPolicy: "REVIEW",
    validationScope: "TECHNICAL_DEMO",
  };
  return RuleDefinitionSchema.parse({ ...input, contentHash: computeRuleDefinitionHash(input) });
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return EvidenceSchema.parse({
    id: EVIDENCE_ID,
    documentId: DOCUMENT_ID,
    documentHash: "c".repeat(64),
    page: 1,
    text: "Synthetic numeric observation",
    language: "en-GB",
    boundingBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
    providerRunId: PROVIDER_RUN_ID,
    capturedAt: EVALUATION_DATE,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  });
}

function makeNumberFact(): ExtractionFact {
  return FactSchema.parse({
    id: uuid(200_000),
    key: "sample.score",
    valueType: "NUMBER",
    providerRunId: PROVIDER_RUN_ID,
    observedAt: EVALUATION_DATE,
    rawConfidence: null,
    validationScope: "TECHNICAL_DEMO",
    status: "RESOLVED",
    originalValue: 5,
    normalizedValue: 5,
    evidenceIds: [EVIDENCE_ID],
    candidates: [],
  });
}

function makeStringFact(value: string): ExtractionFact {
  return FactSchema.parse({
    id: uuid(200_001),
    key: "sample.large",
    valueType: "STRING",
    providerRunId: PROVIDER_RUN_ID,
    observedAt: EVALUATION_DATE,
    rawConfidence: null,
    validationScope: "TECHNICAL_DEMO",
    status: "RESOLVED",
    originalValue: value,
    normalizedValue: value,
    evidenceIds: [EVIDENCE_ID],
    candidates: [],
  });
}

function byRuleId(result: EvaluationResult, ruleId: string): ResolvedRuleFinding {
  const resolved = result.findings.find(({ finding }) => finding.ruleId === ruleId);
  if (resolved === undefined) throw new Error(`Missing resolved rule ${ruleId}`);
  return resolved;
}

function expectDeeplyFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeeplyFrozen(nested, seen);
}

describe("deterministic kernel integration", () => {
  it.each([
    {
      overrideTruth: "TRUE",
      sourceOutcome: "PASS",
      targetOutcome: "NOT_APPLICABLE",
      aggregate: "PASS",
    },
    {
      overrideTruth: "FALSE",
      sourceOutcome: "PASS",
      targetOutcome: "FAIL",
      aggregate: "FAIL",
    },
    {
      overrideTruth: "UNKNOWN",
      sourceOutcome: "REVIEW",
      targetOutcome: "REVIEW",
      aggregate: "REVIEW",
    },
  ] as const)(
    "resolves an evaluated $overrideTruth override without load-order influence",
    ({ overrideTruth, sourceOutcome, targetOutcome, aggregate }) => {
      const sourceId = uuid(1);
      const targetId = uuid(2);
      const source = makeRule({
        number: 1,
        overrides: [{ targetId, truth: overrideTruth }],
      });
      const target = makeRule({
        number: 2,
        satisfiedWhen: { op: "truth", value: "FALSE" },
      });
      const sourceFinding = evaluateRule(source, [], [], EVALUATION_DATE);
      const targetFinding = evaluateRule(target, [], [], EVALUATION_DATE);

      expect(sourceFinding.overrideTraces).toHaveLength(1);
      expect(sourceFinding.overrideTraces[0]?.trace.truth).toBe(overrideTruth);

      const result = resolveRuleFindings([target, source], [targetFinding, sourceFinding]);

      expect(byRuleId(result, sourceId).effectiveOutcome).toBe(sourceOutcome);
      expect(byRuleId(result, targetId).effectiveOutcome).toBe(targetOutcome);
      expect(result.aggregateOutcome).toBe(aggregate);
      expect(EvaluationResultSchema.parse(result)).toEqual(result);

      if (overrideTruth === "UNKNOWN") {
        expect(byRuleId(result, sourceId)).toMatchObject({
          resolution: "UNCERTAIN_OVERRIDE",
          relatedRuleIds: [targetId],
        });
        expect(byRuleId(result, targetId)).toMatchObject({
          resolution: "UNCERTAIN_OVERRIDE",
          relatedRuleIds: [sourceId],
        });
      }
    },
  );

  it.each([
    {
      applies: "FALSE",
      sourceOutcome: "NOT_APPLICABLE",
    },
    {
      applies: "UNKNOWN",
      sourceOutcome: "REVIEW",
    },
  ] as const)(
    "accepts legitimately skipped override traces when source applicability is $applies",
    ({ applies, sourceOutcome }) => {
      const sourceId = uuid(10);
      const targetId = uuid(11);
      const source = makeRule({
        number: 10,
        appliesWhen: { op: "truth", value: applies },
        overrides: [{ targetId, truth: "TRUE" }],
      });
      const target = makeRule({
        number: 11,
        satisfiedWhen: { op: "truth", value: "FALSE" },
      });
      const sourceFinding = evaluateRule(source, [], [], EVALUATION_DATE);
      const targetFinding = evaluateRule(target, [], [], EVALUATION_DATE);

      expect(sourceFinding.overrideTraces).toEqual([]);
      const result = resolveRuleFindings([source, target], [sourceFinding, targetFinding]);

      expect(byRuleId(result, sourceId)).toMatchObject({
        resolution: "UNCHANGED",
        effectiveOutcome: sourceOutcome,
        relatedRuleIds: [],
      });
      expect(byRuleId(result, targetId)).toMatchObject({
        resolution: "UNCHANGED",
        effectiveOutcome: "FAIL",
        relatedRuleIds: [],
      });
      expect(result.aggregateOutcome).toBe("FAIL");
    },
  );

  it("fails an implicit OBLIGATION/PROHIBITION conflict closed to REVIEW", () => {
    const obligationId = uuid(20);
    const prohibitionId = uuid(21);
    const normativeKey = "synthetic.shared.action";
    const obligation = makeRule({
      number: 20,
      normativeKey,
      deonticCategory: "OBLIGATION",
    });
    const prohibition = makeRule({
      number: 21,
      normativeKey,
      deonticCategory: "PROHIBITION",
      satisfiedWhen: { op: "truth", value: "FALSE" },
    });
    const result = resolveRuleFindings(
      [prohibition, obligation],
      [
        evaluateRule(prohibition, [], [], EVALUATION_DATE),
        evaluateRule(obligation, [], [], EVALUATION_DATE),
      ],
    );

    expect(byRuleId(result, obligationId)).toMatchObject({
      resolution: "CONFLICT_REVIEW",
      effectiveOutcome: "REVIEW",
      relatedRuleIds: [prohibitionId],
    });
    expect(byRuleId(result, prohibitionId)).toMatchObject({
      resolution: "CONFLICT_REVIEW",
      effectiveOutcome: "REVIEW",
      relatedRuleIds: [obligationId],
    });
    expect(result.aggregateOutcome).toBe("REVIEW");
  });

  it("returns a deeply frozen evaluated and resolved output", () => {
    const rule = makeRule({
      number: 30,
      satisfiedWhen: {
        op: "between",
        factKey: "sample.score",
        minimum: 1,
        maximum: 10,
        includeMinimum: true,
        includeMaximum: false,
      },
      evidenceBindings: [
        {
          factKey: "sample.score",
          evidenceRequirementKeys: ["sample.score.evidence"],
        },
      ],
    });
    const finding = evaluateRule(rule, [makeNumberFact()], [makeEvidence()], EVALUATION_DATE);
    const result = resolveRuleFindings([rule], [finding]);

    expect(result.aggregateOutcome).toBe("PASS");
    expect(result.findings[0]?.finding.satisfiedWhen?.expected).toEqual({
      minimum: 1,
      maximum: 10,
      includeMinimum: true,
      includeMaximum: false,
    });
    expectDeeplyFrozen(result);
  });

  it("keeps a repeated 100k-string rule trace bounded through resolution", () => {
    const largeValue = "x".repeat(100_000);
    const repeatedExpression: DslExpression = {
      op: "all",
      operands: Array.from({ length: 2 }, () => ({
        op: "all",
        operands: Array.from({ length: 64 }, () => ({
          op: "contains",
          factKey: "sample.large",
          expected: "x",
          comparison: {
            normalization: "NFC",
            whitespace: "PRESERVE",
            caseSensitivity: "SENSITIVE",
          },
        })),
      })),
    };
    const rule = makeRule({
      number: 31,
      satisfiedWhen: repeatedExpression,
      evidenceBindings: [
        {
          factKey: "sample.large",
          evidenceRequirementKeys: ["sample.large.evidence"],
        },
      ],
    });
    const finding = evaluateRule(
      rule,
      [makeStringFact(largeValue)],
      [makeEvidence()],
      EVALUATION_DATE,
    );
    const result = resolveRuleFindings([rule], [finding]);
    const firstLeaf = result.findings[0]?.finding.satisfiedWhen?.children[0]?.children[0];

    expect(result.aggregateOutcome).toBe("PASS");
    expect(firstLeaf?.observed).toMatchObject({
      projection: "CANONICAL_JSON_SHA256_V1",
      canonicalBytes: 100_002,
      canonicalCodeUnits: 100_002,
    });
    expect(new TextEncoder().encode(canonicalizeJson(result)).byteLength).toBeLessThan(10_000_000);
    expect(EvaluationResultSchema.parse(result)).toEqual(result);
  });

  it("propagates a provider-run evidence mismatch as REVIEW", () => {
    const rule = makeRule({
      number: 32,
      satisfiedWhen: {
        op: "greater_than",
        factKey: "sample.score",
        expectedExclusive: 3,
      },
      evidenceBindings: [
        {
          factKey: "sample.score",
          evidenceRequirementKeys: ["sample.score.evidence"],
        },
      ],
    });
    const finding = evaluateRule(
      rule,
      [makeNumberFact()],
      [makeEvidence({ providerRunId: uuid(200_002) })],
      EVALUATION_DATE,
    );
    const result = resolveRuleFindings([rule], [finding]);

    expect(finding).toMatchObject({
      outcome: "REVIEW",
      satisfiedWhen: {
        truth: "UNKNOWN",
        reason: "MISSING_EVIDENCE",
        evidenceIds: [],
      },
    });
    expect(result.aggregateOutcome).toBe("REVIEW");
  });

  it("produces byte-identical canonical JSON across replay and input permutations", () => {
    const source = makeRule({
      number: 40,
      overrides: [{ targetId: uuid(41), truth: "FALSE" }],
    });
    const target = makeRule({
      number: 41,
      satisfiedWhen: { op: "truth", value: "FALSE" },
    });
    const sourceFinding = evaluateRule(source, [], [], EVALUATION_DATE);
    const targetFinding = evaluateRule(target, [], [], EVALUATION_DATE);

    const forward = resolveRuleFindings([source, target], [sourceFinding, targetFinding]);
    const permuted = resolveRuleFindings([target, source], [targetFinding, sourceFinding]);
    const replayRules = JSON.parse(canonicalizeJson([target, source])) as RuleDefinition[];
    const replayFindings = JSON.parse(
      canonicalizeJson([sourceFinding, targetFinding]),
    ) as (typeof sourceFinding)[];
    const replayed = resolveRuleFindings(replayRules, replayFindings);

    const encoder = new TextEncoder();
    const forwardBytes = encoder.encode(canonicalizeJson(forward));
    expect(encoder.encode(canonicalizeJson(permuted))).toEqual(forwardBytes);
    expect(encoder.encode(canonicalizeJson(replayed))).toEqual(forwardBytes);
  });

  it("keeps both deterministic kernel modules free from infrastructure imports", () => {
    const modules = [
      {
        url: new URL("../../src/dsl-evaluator.ts", import.meta.url),
        allowed: new Set(["node:util", "@vera/contracts", "re2js", "./dsl-semantic-primitives.js"]),
      },
      {
        url: new URL("../../src/rule-resolution.ts", import.meta.url),
        allowed: new Set(["@vera/contracts", "./dsl-semantic-primitives.js"]),
      },
    ];
    const importSpecifier = /\bfrom\s+["']([^"']+)["']/gu;
    const forbiddenBoundary =
      /(?:^|[./-])(?:fs|http|https|storage|ui|ai|ollama|openai|database|prisma)(?:$|[./-])/iu;

    for (const module of modules) {
      const source = readFileSync(module.url, "utf8");
      const imports = [...source.matchAll(importSpecifier)].map((match) => match[1]);
      expect(new Set(imports)).toEqual(module.allowed);
      expect(
        imports.some((specifier) => specifier === undefined || forbiddenBoundary.test(specifier)),
      ).toBe(false);
      expect(source).not.toMatch(/\b(?:import|require)\s*\(/u);
    }
  });
});
