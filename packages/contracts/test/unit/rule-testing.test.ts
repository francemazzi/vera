import { describe, expect, it } from "vitest";

import {
  RULE_PACK_IMPACT_SCHEMA_VERSION,
  RULE_TESTING_SCHEMA_VERSION,
  RulePackImpactReportSchema,
  RuleTestFixtureSchema,
  RuleTestRunResultSchema,
  computeRulePackImpactReportHash,
  computeRuleTestFixtureHash,
  computeRuleTestFixtureSetHash,
  computeRuleTestRunResultHash,
  verifyRuleTestFixtureHash,
} from "../../src/index.js";
import type {
  Evidence,
  ExtractionFact,
  RulePackImpactReportHashInput,
  RuleTestFixture,
  RuleTestFixtureHashInput,
  RuleTestRunResultHashInput,
} from "../../src/index.js";

const IDS = {
  request: "00000000-0000-4000-8000-000000009001",
  rule: "00000000-0000-4000-8000-000000009002",
  fixture: "00000000-0000-4000-8000-000000009003",
  fact: "00000000-0000-4000-8000-000000009004",
  evidence: "00000000-0000-4000-8000-000000009005",
  document: "00000000-0000-4000-8000-000000009006",
  run: "00000000-0000-4000-8000-000000009007",
  baseline: "00000000-0000-4000-8000-000000009008",
  candidate: "00000000-0000-4000-8000-000000009009",
} as const;

const RULE_HASH = "a".repeat(64);
const VERSION_HASH = "b".repeat(64);
const FIXTURE_SET_HASH = "c".repeat(64);
const EVALUATION_HASH = "d".repeat(64);

function evidence(): Evidence {
  return {
    id: IDS.evidence,
    documentId: IDS.document,
    documentHash: "1".repeat(64),
    page: 1,
    text: "Synthetic evidence",
    language: "en",
    boundingBox: { x: 0, y: 0, width: 0.2, height: 0.2 },
    providerRunId: IDS.run,
    capturedAt: "2026-01-01T00:00:00.000Z",
    validationScope: "TECHNICAL_DEMO",
  };
}

function fact(): ExtractionFact {
  return {
    id: IDS.fact,
    key: "synthetic.marker",
    valueType: "BOOLEAN",
    status: "RESOLVED",
    originalValue: true,
    normalizedValue: true,
    evidenceIds: [IDS.evidence],
    providerRunId: IDS.run,
    observedAt: "2026-01-01T00:00:00.000Z",
    rawConfidence: null,
    candidates: [],
    validationScope: "TECHNICAL_DEMO",
  };
}

function fixtureInput(overrides: Partial<RuleTestFixtureHashInput> = {}): RuleTestFixtureHashInput {
  return {
    schemaVersion: RULE_TESTING_SCHEMA_VERSION,
    id: IDS.fixture,
    caseId: "synthetic-case",
    description: "Synthetic rule testing fixture",
    ruleId: IDS.rule,
    ruleContentHash: RULE_HASH,
    evaluationDate: "2026-07-15T12:00:00.000Z",
    facts: [fact()],
    evidence: [evidence()],
    expected: {
      ruleId: IDS.rule,
      ruleContentHash: RULE_HASH,
      outcome: "PASS",
      effectiveOutcome: "PASS",
      resolution: "UNCHANGED",
      relatedRuleIds: [],
    },
    coverageTags: ["OUTCOME_PASS"],
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

function fixture(overrides: Partial<RuleTestFixtureHashInput> = {}): RuleTestFixture {
  const input = fixtureInput(overrides);
  return RuleTestFixtureSchema.parse({
    ...input,
    contentHash: computeRuleTestFixtureHash(input),
  });
}

describe("rule testing contracts", () => {
  it("hashes fixtures canonically and rejects tampering", () => {
    const valid = fixture();

    expect(verifyRuleTestFixtureHash(valid)).toBe(true);
    expect(computeRuleTestFixtureSetHash([valid])).toMatch(/^[0-9a-f]{64}$/u);
    expect(verifyRuleTestFixtureHash({ ...valid, description: "Changed synthetic fixture" })).toBe(
      false,
    );
  });

  it("requires coverage tags to match the expected effective outcome", () => {
    expect(() =>
      fixture({
        expected: {
          ...fixtureInput().expected,
          outcome: "FAIL",
          effectiveOutcome: "FAIL",
        },
      }),
    ).toThrow(/OUTCOME_FAIL/u);
  });

  it("derives run result pass status from fixtures and coverage", () => {
    const item = fixture();
    const hashInput: RuleTestRunResultHashInput = {
      schemaVersion: RULE_TESTING_SCHEMA_VERSION,
      requestId: IDS.request,
      rulePackVersionId: IDS.baseline,
      rulePackVersionContentHash: VERSION_HASH,
      fixtureSetHash: computeRuleTestFixtureSetHash([item]),
      requiredCoverageTags: ["OUTCOME_PASS"],
      fixtureResults: [
        {
          fixtureId: item.id,
          caseId: item.caseId,
          ruleId: item.ruleId,
          expected: item.expected,
          actual: structuredClone(item.expected),
          aggregateOutcome: "PASS",
          evaluationContentHash: EVALUATION_HASH,
          passed: true,
          issues: [],
        },
      ],
      coverage: [
        {
          ruleId: item.ruleId,
          ruleContentHash: item.ruleContentHash,
          observedCoverageTags: ["OUTCOME_PASS"],
          missingCoverageTags: [],
          observedOutcomes: ["PASS"],
        },
      ],
      passed: true,
      validationScope: "TECHNICAL_DEMO",
    };

    expect(
      RuleTestRunResultSchema.parse({
        ...hashInput,
        contentHash: computeRuleTestRunResultHash(hashInput),
      }).passed,
    ).toBe(true);
    expect(() =>
      RuleTestRunResultSchema.parse({
        ...hashInput,
        passed: false,
        contentHash: computeRuleTestRunResultHash({ ...hashInput, passed: false }),
      }),
    ).toThrow(/pass\/fail/u);
  });

  it("derives impact summary and classifications", () => {
    const hashInput: RulePackImpactReportHashInput = {
      schemaVersion: RULE_PACK_IMPACT_SCHEMA_VERSION,
      baseline: { versionId: IDS.baseline, semver: "1.0.0", contentHash: "1".repeat(64) },
      candidate: { versionId: IDS.candidate, semver: "1.1.0", contentHash: "2".repeat(64) },
      fixtureSetHash: FIXTURE_SET_HASH,
      cases: [
        {
          fixtureId: IDS.fixture,
          caseId: "synthetic-case",
          ruleId: IDS.rule,
          baseline: {
            ruleContentHash: RULE_HASH,
            outcome: "FAIL",
            effectiveOutcome: "FAIL",
            resolution: "UNCHANGED",
          },
          candidate: {
            ruleContentHash: "e".repeat(64),
            outcome: "PASS",
            effectiveOutcome: "PASS",
            resolution: "UNCHANGED",
          },
          classifications: ["OUTCOME_CHANGED", "POSSIBLE_FALSE_CONFORMITY"],
        },
      ],
      summary: {
        totalCases: 1,
        changedCases: 1,
        newReviewCases: 0,
        possibleFalseComplianceCases: 1,
        unchangedCases: 0,
      },
      validationScope: "TECHNICAL_DEMO",
    };

    expect(
      RulePackImpactReportSchema.parse({
        ...hashInput,
        contentHash: computeRulePackImpactReportHash(hashInput),
      }).summary.possibleFalseComplianceCases,
    ).toBe(1);
  });
});
