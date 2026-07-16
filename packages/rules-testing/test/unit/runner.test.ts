import {
  RULE_PACK_IMPACT_SCHEMA_VERSION,
  RuleTestFixtureSchema,
  computeRuleTestFixtureHash,
} from "@vera/contracts";
import type { RuleTestFixture, RuleTestFixtureHashInput } from "@vera/contracts";
import { RulePackEligibilityError } from "@vera/rules-core";
import { describe, expect, it } from "vitest";

import {
  RulePackTestGateError,
  createRulePackReadinessGate,
  diffRulePackVersions,
  runRulePackTests,
  runRuleTestingApiRequest,
} from "../../src/index.js";
import {
  SYNTHETIC_IDS,
  makeCompleteFixtureMatrix,
  makeFalseComplianceCandidate,
  makeRuleA,
  makeRunRequest,
  makeVersion,
} from "../fixtures/synthetic-suite.js";

function rehashFixture(
  fixture: RuleTestFixture,
  overrides: Partial<RuleTestFixtureHashInput>,
): RuleTestFixture {
  const current = structuredClone(fixture);
  Reflect.deleteProperty(current, "contentHash");
  const input = { ...(current as unknown as RuleTestFixtureHashInput), ...overrides };
  return RuleTestFixtureSchema.parse({
    ...input,
    contentHash: computeRuleTestFixtureHash(input),
  });
}

describe("rule testing runner", () => {
  it("passes the complete synthetic outcome matrix for every demo rule", () => {
    const result = runRulePackTests(makeRunRequest());

    expect(result.passed).toBe(true);
    expect(result.fixtureResults.every(({ passed }) => passed)).toBe(true);
    expect(result.coverage).toHaveLength(2);
    for (const coverage of result.coverage) {
      expect(coverage.missingCoverageTags).toEqual([]);
      expect(coverage.observedOutcomes).toEqual(["FAIL", "NOT_APPLICABLE", "PASS", "REVIEW"]);
    }
    expect(result.coverage[0]?.observedCoverageTags).toEqual([
      "EVIDENCE",
      "EXCEPTION",
      "OUTCOME_FAIL",
      "OUTCOME_NOT_APPLICABLE",
      "OUTCOME_PASS",
      "OUTCOME_REVIEW",
      "OVERRIDE",
      "VALIDITY_END",
      "VALIDITY_START",
    ]);
  });

  it("reports fixture expectation regressions without mutating the request", () => {
    const request = makeRunRequest();
    const failingFixture = request.fixtures.find(({ caseId }) => caseId === "rule-a-fail");
    if (failingFixture === undefined) throw new Error("Expected synthetic fail fixture");
    const wrongExpectation = {
      ...failingFixture.expected,
      outcome: "PASS" as const,
      effectiveOutcome: "PASS" as const,
    };
    const tampered = rehashFixture(failingFixture, {
      expected: wrongExpectation,
      coverageTags: ["OUTCOME_FAIL", "OUTCOME_PASS"],
    });
    const fixtures = request.fixtures
      .map((fixture) => (fixture.id === tampered.id ? tampered : fixture))
      .sort((left, right) =>
        `${left.ruleId}:${left.caseId}` < `${right.ruleId}:${right.caseId}` ? -1 : 1,
      );

    const result = runRulePackTests({ ...request, fixtures });

    expect(result.passed).toBe(false);
    expect(result.fixtureResults.filter(({ passed }) => !passed)).toHaveLength(1);
    expect(
      result.fixtureResults.find(({ fixtureId }) => fixtureId === tampered.id)?.issues,
    ).toEqual(["Actual finding differs from expected fixture outcome"]);
    expect(request.fixtures.find(({ id }) => id === tampered.id)?.expected.outcome).toBe("FAIL");
  });

  it("blocks readiness when required coverage is missing", () => {
    const request = makeRunRequest({
      fixtures: makeCompleteFixtureMatrix().filter(
        ({ caseId }) => caseId !== "rule-b-not-applicable",
      ),
    });
    const result = runRulePackTests(request);

    expect(result.passed).toBe(false);
    expect(
      result.coverage.find(({ ruleId }) => ruleId === SYNTHETIC_IDS.ruleB)?.missingCoverageTags,
    ).toEqual(["OUTCOME_NOT_APPLICABLE"]);

    const gate = createRulePackReadinessGate({
      requestId: SYNTHETIC_IDS.requestAlt,
      fixtures: request.fixtures,
    });
    expect(() => {
      gate.assertRulePackReady(request.rulePackVersion, {
        purpose: "PUBLICATION",
        checkedAt: "2026-07-15T12:00:00.000Z",
      });
    }).toThrow(RulePackEligibilityError);
  });

  it("runs API payloads through the same contract as the runner", () => {
    const request = makeRunRequest();

    expect(runRuleTestingApiRequest(structuredClone(request))).toEqual(runRulePackTests(request));
  });

  it("exposes the failed result on explicit gate errors", () => {
    const result = runRulePackTests(makeRunRequest());
    const error = new RulePackTestGateError(result);

    expect(error.name).toBe("RulePackTestGateError");
    expect(error.result).toEqual(result);
  });
});

describe("rule pack impact diff", () => {
  it("produces deterministic impact reports and flags possible false compliance", () => {
    const baselineVersion = makeVersion();
    const candidateVersion = makeFalseComplianceCandidate();
    const request = {
      schemaVersion: RULE_PACK_IMPACT_SCHEMA_VERSION,
      baselineVersion,
      candidateVersion,
      fixtures: makeCompleteFixtureMatrix(baselineVersion),
      validationScope: "TECHNICAL_DEMO" as const,
    };

    const first = diffRulePackVersions(request);
    const replay = diffRulePackVersions(structuredClone(request));

    expect(first).toEqual(replay);
    expect(first.summary.possibleFalseComplianceCases).toBeGreaterThan(0);
    expect(
      first.cases.some(({ classifications }) =>
        classifications.includes("POSSIBLE_FALSE_CONFORMITY"),
      ),
    ).toBe(true);
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("flags new review cases separately from possible false compliance", () => {
    const baselineVersion = makeVersion();
    const reviewRule = makeRuleA({
      satisfiedWhen: { op: "present", factKey: "candidate.missing_marker" },
      evidenceBindings: [
        { factKey: "ruleA.applicable", evidenceRequirementKeys: ["applicability"] },
        { factKey: "ruleA.exception", evidenceRequirementKeys: ["exception"] },
        { factKey: "candidate.missing_marker", evidenceRequirementKeys: ["marker"] },
      ],
    });
    const candidateVersion = makeVersion([reviewRule], {
      id: SYNTHETIC_IDS.candidateVersion,
      semver: "1.1.0",
      changeReason: "Synthetic candidate that introduces review",
      supersedesVersionId: baselineVersion.id,
      publishedAt: "2025-12-20T00:00:00.000Z",
    });
    const passFixture = makeCompleteFixtureMatrix(baselineVersion).filter(
      ({ caseId }) => caseId === "rule-a-pass-start",
    );

    const report = diffRulePackVersions({
      schemaVersion: RULE_PACK_IMPACT_SCHEMA_VERSION,
      baselineVersion,
      candidateVersion,
      fixtures: passFixture,
      validationScope: "TECHNICAL_DEMO",
    });

    expect(report.summary.newReviewCases).toBe(1);
    expect(report.cases[0]?.classifications).toEqual(["NEW_REVIEW", "OUTCOME_CHANGED"]);
  });

  it("fails impact diff when a candidate omits the fixture target rule", () => {
    const baselineVersion = makeVersion();
    const candidateVersion = makeVersion([makeRuleA()], {
      id: SYNTHETIC_IDS.candidateVersion,
      semver: "1.1.0",
      changeReason: "Synthetic candidate missing rule B",
      supersedesVersionId: baselineVersion.id,
      publishedAt: "2025-12-20T00:00:00.000Z",
    });
    const ruleBFixture = makeCompleteFixtureMatrix(baselineVersion).filter(
      ({ caseId }) => caseId === "rule-b-pass",
    );

    expect(() =>
      diffRulePackVersions({
        schemaVersion: RULE_PACK_IMPACT_SCHEMA_VERSION,
        baselineVersion,
        candidateVersion,
        fixtures: ruleBFixture,
        validationScope: "TECHNICAL_DEMO",
      }),
    ).toThrow(/impact finding/u);
  });
});
