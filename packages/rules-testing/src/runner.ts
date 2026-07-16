import {
  RULE_PACK_IMPACT_SCHEMA_VERSION,
  RULE_TESTING_SCHEMA_VERSION,
  RulePackImpactReportSchema,
  RulePackImpactRequestSchema,
  RuleTestRunRequestSchema,
  RuleTestRunResultSchema,
  computeRulePackImpactReportHash,
  computeRuleTestFixtureSetHash,
  computeRuleTestRunResultHash,
} from "@vera/contracts";
import type {
  EvaluationOutcome,
  RulePackImpactCase,
  RulePackImpactClassification,
  RulePackImpactOutcome,
  RulePackImpactReport,
  RulePackImpactReportHashInput,
  RulePackImpactRequest,
  RulePackVersion,
  RuleTestActualFinding,
  RuleTestCoverageEntry,
  RuleTestCoverageTag,
  RuleTestFixture,
  RuleTestFixtureResult,
  RuleTestRunRequest,
  RuleTestRunResult,
  RuleTestRunResultHashInput,
  UtcDateTime,
} from "@vera/contracts";
import { RulePackEligibilityError, evaluateRulePackVersion } from "@vera/rules-core";
import type { RulePackReadinessGate } from "@vera/rules-core";

export const DEFAULT_REQUIRED_COVERAGE_TAGS = Object.freeze([
  "OUTCOME_FAIL",
  "OUTCOME_NOT_APPLICABLE",
  "OUTCOME_PASS",
  "OUTCOME_REVIEW",
] as const satisfies readonly RuleTestCoverageTag[]);

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)].sort(compareStrings);
}

function sortFixtures(fixtures: readonly RuleTestFixture[]): readonly RuleTestFixture[] {
  return [...fixtures].sort((left, right) =>
    compareStrings(`${left.ruleId}:${left.caseId}`, `${right.ruleId}:${right.caseId}`),
  );
}

function toActualFinding(
  result: ReturnType<typeof evaluateRulePackVersion>["evaluationResult"]["findings"][number],
): RuleTestActualFinding {
  return {
    ruleId: result.finding.ruleId,
    ruleContentHash: result.finding.ruleContentHash,
    outcome: result.finding.outcome,
    effectiveOutcome: result.effectiveOutcome,
    resolution: result.resolution,
    relatedRuleIds: [...result.relatedRuleIds].sort(compareStrings),
  };
}

function actualMatchesExpected(
  actual: RuleTestActualFinding | null,
  expected: RuleTestActualFinding,
): boolean {
  return (
    actual !== null &&
    actual.ruleId === expected.ruleId &&
    actual.ruleContentHash === expected.ruleContentHash &&
    actual.outcome === expected.outcome &&
    actual.effectiveOutcome === expected.effectiveOutcome &&
    actual.resolution === expected.resolution &&
    actual.relatedRuleIds.length === expected.relatedRuleIds.length &&
    actual.relatedRuleIds.every((value, index) => value === expected.relatedRuleIds[index])
  );
}

function formatIssue(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return `Evaluation failed: ${error.message}`;
  }
  return "Evaluation failed with an unknown error";
}

function evaluateFixture(
  version: RulePackVersion,
  fixture: RuleTestFixture,
): RuleTestFixtureResult {
  try {
    const snapshot = evaluateRulePackVersion(
      version,
      fixture.facts,
      fixture.evidence,
      fixture.evaluationDate,
    );
    const resolved = snapshot.evaluationResult.findings.find(
      ({ finding }) => finding.ruleId === fixture.ruleId,
    );
    const actual = resolved === undefined ? null : toActualFinding(resolved);
    const issues =
      resolved === undefined
        ? (["Target rule did not produce a finding"] as const)
        : actualMatchesExpected(actual, fixture.expected)
          ? []
          : (["Actual finding differs from expected fixture outcome"] as const);
    return {
      fixtureId: fixture.id,
      caseId: fixture.caseId,
      ruleId: fixture.ruleId,
      expected: fixture.expected,
      actual,
      aggregateOutcome: snapshot.evaluationResult.aggregateOutcome,
      evaluationContentHash: snapshot.contentHash,
      passed: actualMatchesExpected(actual, fixture.expected) && issues.length === 0,
      issues,
    };
  } catch (error) {
    return {
      fixtureId: fixture.id,
      caseId: fixture.caseId,
      ruleId: fixture.ruleId,
      expected: fixture.expected,
      actual: null,
      aggregateOutcome: null,
      evaluationContentHash: null,
      passed: false,
      issues: [formatIssue(error)],
    };
  }
}

function buildCoverage(
  version: RulePackVersion,
  fixtures: readonly RuleTestFixture[],
  results: readonly RuleTestFixtureResult[],
  requiredCoverageTags: readonly RuleTestCoverageTag[],
): readonly RuleTestCoverageEntry[] {
  const resultByFixtureId = new Map(results.map((result) => [result.fixtureId, result] as const));
  return version.rules.map((rule) => {
    const matchingFixtures = fixtures.filter(({ ruleId }) => ruleId === rule.id);
    const observedCoverageTags = sortedUnique(
      matchingFixtures.flatMap(({ coverageTags }) => coverageTags),
    );
    const observedOutcomes = sortedUnique(
      matchingFixtures
        .map(({ id }) => resultByFixtureId.get(id)?.actual?.effectiveOutcome)
        .filter((value): value is EvaluationOutcome => value !== undefined),
    );
    const missingCoverageTags = requiredCoverageTags.filter(
      (tag) => !observedCoverageTags.includes(tag),
    );
    return {
      ruleId: rule.id,
      ruleContentHash: rule.contentHash,
      observedCoverageTags,
      missingCoverageTags,
      observedOutcomes,
    };
  });
}

export function runRulePackTests(input: RuleTestRunRequest): RuleTestRunResult {
  const request = RuleTestRunRequestSchema.parse(input);
  const fixtures = sortFixtures(request.fixtures);
  const requiredCoverageTags = [...request.requiredCoverageTags].sort(compareStrings);
  const fixtureResults = fixtures.map((fixture) =>
    evaluateFixture(request.rulePackVersion, fixture),
  );
  const coverage = buildCoverage(
    request.rulePackVersion,
    fixtures,
    fixtureResults,
    requiredCoverageTags,
  );
  const hashInput: RuleTestRunResultHashInput = {
    schemaVersion: RULE_TESTING_SCHEMA_VERSION,
    requestId: request.requestId,
    rulePackVersionId: request.rulePackVersion.id,
    rulePackVersionContentHash: request.rulePackVersion.contentHash,
    fixtureSetHash: computeRuleTestFixtureSetHash(fixtures),
    requiredCoverageTags,
    fixtureResults,
    coverage,
    passed:
      fixtureResults.every(({ passed }) => passed) &&
      coverage.every(({ missingCoverageTags }) => missingCoverageTags.length === 0),
    validationScope: "TECHNICAL_DEMO",
  };
  return RuleTestRunResultSchema.parse({
    ...hashInput,
    contentHash: computeRuleTestRunResultHash(hashInput),
  });
}

export function runRuleTestingApiRequest(input: unknown): RuleTestRunResult {
  return runRulePackTests(RuleTestRunRequestSchema.parse(input));
}

function impactOutcome(version: RulePackVersion, fixture: RuleTestFixture): RulePackImpactOutcome {
  const snapshot = evaluateRulePackVersion(
    version,
    fixture.facts,
    fixture.evidence,
    fixture.evaluationDate,
  );
  const resolved = snapshot.evaluationResult.findings.find(
    ({ finding }) => finding.ruleId === fixture.ruleId,
  );
  if (resolved === undefined) {
    throw new RangeError(`Rule ${fixture.ruleId} did not produce an impact finding`);
  }
  return {
    ruleContentHash: resolved.finding.ruleContentHash,
    outcome: resolved.finding.outcome,
    effectiveOutcome: resolved.effectiveOutcome,
    resolution: resolved.resolution,
  };
}

function classifyImpact(
  baseline: RulePackImpactOutcome,
  candidate: RulePackImpactOutcome,
): readonly RulePackImpactClassification[] {
  const classifications: RulePackImpactClassification[] = [];
  if (baseline.effectiveOutcome !== candidate.effectiveOutcome) {
    classifications.push("OUTCOME_CHANGED");
  }
  if (baseline.effectiveOutcome !== "REVIEW" && candidate.effectiveOutcome === "REVIEW") {
    classifications.push("NEW_REVIEW");
  }
  if (
    (baseline.effectiveOutcome === "FAIL" || baseline.effectiveOutcome === "REVIEW") &&
    (candidate.effectiveOutcome === "PASS" || candidate.effectiveOutcome === "NOT_APPLICABLE")
  ) {
    classifications.push("POSSIBLE_FALSE_CONFORMITY");
  }
  if (classifications.length === 0) classifications.push("UNCHANGED");
  return classifications.sort(compareStrings);
}

function versionRef(version: RulePackVersion): RulePackImpactReportHashInput["baseline"] {
  return {
    versionId: version.id,
    semver: version.semver,
    contentHash: version.contentHash,
  };
}

export function diffRulePackVersions(input: RulePackImpactRequest): RulePackImpactReport {
  const request = RulePackImpactRequestSchema.parse(input);
  const fixtures = sortFixtures(request.fixtures);
  const cases: readonly RulePackImpactCase[] = fixtures.map((fixture) => {
    const baseline = impactOutcome(request.baselineVersion, fixture);
    const candidate = impactOutcome(request.candidateVersion, fixture);
    return {
      fixtureId: fixture.id,
      caseId: fixture.caseId,
      ruleId: fixture.ruleId,
      baseline,
      candidate,
      classifications: classifyImpact(baseline, candidate),
    };
  });
  const summary = {
    totalCases: cases.length,
    changedCases: cases.filter(({ classifications }) => classifications.includes("OUTCOME_CHANGED"))
      .length,
    newReviewCases: cases.filter(({ classifications }) => classifications.includes("NEW_REVIEW"))
      .length,
    possibleFalseComplianceCases: cases.filter(({ classifications }) =>
      classifications.includes("POSSIBLE_FALSE_CONFORMITY"),
    ).length,
    unchangedCases: cases.filter(({ classifications }) => classifications.includes("UNCHANGED"))
      .length,
  };
  const hashInput: RulePackImpactReportHashInput = {
    schemaVersion: RULE_PACK_IMPACT_SCHEMA_VERSION,
    baseline: versionRef(request.baselineVersion),
    candidate: versionRef(request.candidateVersion),
    fixtureSetHash: computeRuleTestFixtureSetHash(fixtures),
    cases,
    summary,
    validationScope: "TECHNICAL_DEMO",
  };
  return RulePackImpactReportSchema.parse({
    ...hashInput,
    contentHash: computeRulePackImpactReportHash(hashInput),
  });
}

export class RulePackTestGateError extends Error {
  public readonly result: RuleTestRunResult;

  public constructor(result: RuleTestRunResult) {
    super("Rule Pack test gate failed");
    this.name = "RulePackTestGateError";
    this.result = result;
  }
}

export interface RulePackReadinessGateOptions {
  readonly requestId: string;
  readonly fixtures: readonly RuleTestFixture[];
  readonly requiredCoverageTags?: readonly RuleTestCoverageTag[];
}

export function createRulePackReadinessGate(
  options: RulePackReadinessGateOptions,
): RulePackReadinessGate {
  const requiredCoverageTags = [
    ...(options.requiredCoverageTags ?? DEFAULT_REQUIRED_COVERAGE_TAGS),
  ].sort(compareStrings);
  return {
    assertRulePackReady(version: RulePackVersion, context: { readonly checkedAt: UtcDateTime }) {
      const result = runRulePackTests({
        schemaVersion: RULE_TESTING_SCHEMA_VERSION,
        requestId: options.requestId,
        rulePackVersion: version,
        fixtures: options.fixtures,
        requiredCoverageTags,
        validationScope: "TECHNICAL_DEMO",
      });
      if (!result.passed) {
        throw new RulePackEligibilityError(
          "RULE_PACK_TEST_GATE_FAILED",
          "Rule Pack publication or activation is blocked by failing or incomplete synthetic fixtures",
          {
            checkedAt: context.checkedAt,
            failingFixtures: result.fixtureResults.filter(({ passed }) => !passed).length,
            missingCoverage: result.coverage.reduce(
              (total, entry) => total + entry.missingCoverageTags.length,
              0,
            ),
            rulePackVersionId: version.id,
          },
        );
      }
    },
  };
}
