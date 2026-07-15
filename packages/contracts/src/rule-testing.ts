import { z } from "zod";

import { RuleFindingResolutionSchema } from "./evaluation.js";
import { EvidenceSchema, FactSchema } from "./extraction.js";
import { sha256CanonicalJson } from "./hash.js";
import { snapshotJsonValue } from "./json-snapshot.js";
import { RulePackVersionSchema } from "./rule-pack.js";
import { UtcDateTimeSchema } from "./time.js";
import { EvaluationOutcomeSchema, ValidationScopeSchema } from "./vocabulary.js";

export const RULE_TESTING_SCHEMA_VERSION = "vera.rule-testing/v1" as const;
export const RULE_PACK_IMPACT_SCHEMA_VERSION = "vera.rule-pack-impact/v1" as const;

export const RULE_TESTING_LIMITS = Object.freeze({
  maxCanonicalBytes: 35_000_000,
  maxJsonDepth: 128,
  maxJsonNodes: 650_000,
  maxFixtures: 20_000,
  maxFactsPerFixture: 10_000,
  maxEvidencePerFixture: 10_000,
  maxTextCharacters: 2_000,
} as const);

const Sha256DigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Expected a lowercase SHA-256 digest");
const StableCaseIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z][A-Za-z0-9._:-]*$/u, "Expected a stable synthetic case ID");
const BoundedTextSchema = z
  .string()
  .min(1)
  .max(RULE_TESTING_LIMITS.maxTextCharacters)
  .regex(/^\S(?:[\s\S]*\S)?$/u, "Leading or trailing whitespace is forbidden");

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isStrictlySorted(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    /* v8 ignore next -- loop bounds guarantee both entries */
    if (previous === undefined || current === undefined) return false;
    if (compareStrings(previous, current) >= 0) return false;
  }
  return true;
}

function addStrictlySortedIssue(
  values: readonly string[],
  label: string,
  path: readonly PropertyKey[],
  context: z.core.$RefinementCtx,
): void {
  if (!isStrictlySorted(values)) {
    context.addIssue({
      code: "custom",
      message: `${label} must be unique and strictly sorted`,
      path: [...path],
    });
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

class InvalidRuleTestingSnapshot {
  public constructor(public readonly issue: string) {}
}

const RuleTestingSnapshotSchema = z
  .unknown()
  .overwrite((value) => {
    const result = snapshotJsonValue(value, {
      maxDepth: RULE_TESTING_LIMITS.maxJsonDepth,
      maxNodes: RULE_TESTING_LIMITS.maxJsonNodes,
      maxCanonicalBytes: RULE_TESTING_LIMITS.maxCanonicalBytes,
      rejectNegativeZero: true,
      rejectUnsafeIntegers: true,
    });
    return result.success ? result.value : new InvalidRuleTestingSnapshot(result.issue);
  })
  .superRefine((value, context) => {
    if (value instanceof InvalidRuleTestingSnapshot) {
      context.addIssue({
        code: "custom",
        message: `Rule testing values must be bounded JSON snapshots: ${value.issue}`,
        path: [],
      });
    }
  });

export const RuleTestCoverageTagSchema = z.enum([
  "OUTCOME_PASS",
  "OUTCOME_FAIL",
  "OUTCOME_REVIEW",
  "OUTCOME_NOT_APPLICABLE",
  "EXCEPTION",
  "OVERRIDE",
  "EVIDENCE",
  "VALIDITY_START",
  "VALIDITY_END",
]);

export type RuleTestCoverageTag = z.infer<typeof RuleTestCoverageTagSchema>;

export const RuleTestExpectedFindingSchema = z
  .object({
    ruleId: z.uuid(),
    ruleContentHash: Sha256DigestSchema,
    outcome: EvaluationOutcomeSchema,
    effectiveOutcome: EvaluationOutcomeSchema,
    resolution: RuleFindingResolutionSchema,
    relatedRuleIds: z.array(z.uuid()).max(RULE_TESTING_LIMITS.maxFixtures).readonly(),
  })
  .strict()
  .superRefine(({ relatedRuleIds }, context) => {
    addStrictlySortedIssue(relatedRuleIds, "Related rule IDs", ["relatedRuleIds"], context);
  })
  .readonly();

export type RuleTestExpectedFinding = z.infer<typeof RuleTestExpectedFindingSchema>;

interface RuleTestFixtureRefinementInput {
  readonly expected: RuleTestExpectedFinding;
  readonly ruleId: string;
  readonly ruleContentHash: string;
  readonly facts: readonly { readonly key: string }[];
  readonly evidence: readonly { readonly id: string }[];
  readonly coverageTags: readonly RuleTestCoverageTag[];
}

function refineRuleTestFixture(
  fixture: RuleTestFixtureRefinementInput,
  context: z.core.$RefinementCtx,
): void {
  if (fixture.expected.ruleId !== fixture.ruleId) {
    context.addIssue({
      code: "custom",
      message: "Expected finding rule ID must match the fixture target",
      path: ["expected", "ruleId"],
    });
  }
  if (fixture.expected.ruleContentHash !== fixture.ruleContentHash) {
    context.addIssue({
      code: "custom",
      message: "Expected finding hash must match the fixture target",
      path: ["expected", "ruleContentHash"],
    });
  }
  addStrictlySortedIssue(
    fixture.facts.map(({ key }) => key),
    "Fixture facts",
    ["facts"],
    context,
  );
  addStrictlySortedIssue(
    fixture.evidence.map(({ id }) => id),
    "Fixture evidence",
    ["evidence"],
    context,
  );
  addStrictlySortedIssue(fixture.coverageTags, "Coverage tags", ["coverageTags"], context);
  const expectedTag = `OUTCOME_${fixture.expected.effectiveOutcome}` as RuleTestCoverageTag;
  if (!fixture.coverageTags.includes(expectedTag)) {
    context.addIssue({
      code: "custom",
      message: `Coverage tags must include ${expectedTag}`,
      path: ["coverageTags"],
    });
  }
}

const RuleTestFixtureHashInputShape = {
  schemaVersion: z.literal(RULE_TESTING_SCHEMA_VERSION),
  id: z.uuid(),
  caseId: StableCaseIdSchema,
  description: BoundedTextSchema,
  ruleId: z.uuid(),
  ruleContentHash: Sha256DigestSchema,
  evaluationDate: UtcDateTimeSchema,
  facts: z.array(FactSchema).max(RULE_TESTING_LIMITS.maxFactsPerFixture).readonly(),
  evidence: z.array(EvidenceSchema).max(RULE_TESTING_LIMITS.maxEvidencePerFixture).readonly(),
  expected: RuleTestExpectedFindingSchema,
  coverageTags: z.array(RuleTestCoverageTagSchema).min(1).max(9).readonly(),
  validationScope: ValidationScopeSchema,
} as const;

const RuleTestFixtureHashInputObjectSchema = z
  .object(RuleTestFixtureHashInputShape)
  .strict()
  .superRefine(refineRuleTestFixture)
  .readonly();

export const RuleTestFixtureHashInputSchema = RuleTestingSnapshotSchema.pipe(
  RuleTestFixtureHashInputObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RuleTestFixtureHashInputObjectSchema>
>;

export type RuleTestFixtureHashInput = z.infer<typeof RuleTestFixtureHashInputSchema>;

export function computeRuleTestFixtureHash(input: RuleTestFixtureHashInput): string {
  return sha256CanonicalJson(RuleTestFixtureHashInputSchema.parse(input));
}

const RuleTestFixtureCandidateObjectSchema = z
  .object({
    ...RuleTestFixtureHashInputShape,
    contentHash: Sha256DigestSchema,
  })
  .strict()
  .superRefine((fixture, context) => {
    const { contentHash, ...hashInput } = fixture;
    refineRuleTestFixture(hashInput, context);
    if (contentHash !== sha256CanonicalJson(hashInput)) {
      context.addIssue({
        code: "custom",
        message: "contentHash does not match the canonical Rule Test fixture",
        path: ["contentHash"],
      });
    }
  })
  .readonly();

export const RuleTestFixtureSchema = RuleTestingSnapshotSchema.pipe(
  RuleTestFixtureCandidateObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RuleTestFixtureCandidateObjectSchema>
>;

export type RuleTestFixture = z.infer<typeof RuleTestFixtureSchema>;

export function verifyRuleTestFixtureHash(fixture: unknown): boolean {
  return RuleTestFixtureSchema.safeParse(fixture).success;
}

export function computeRuleTestFixtureSetHash(fixtures: readonly RuleTestFixture[]): string {
  return sha256CanonicalJson(z.array(RuleTestFixtureSchema).parse(fixtures));
}

interface RuleTestRunRequestRefinementInput {
  readonly requiredCoverageTags: readonly RuleTestCoverageTag[];
  readonly fixtures: readonly RuleTestFixture[];
  readonly rulePackVersion: {
    readonly rules: readonly { readonly id: string; readonly contentHash: string }[];
  };
}

function refineRunRequest(
  request: RuleTestRunRequestRefinementInput,
  context: z.core.$RefinementCtx,
): void {
  addStrictlySortedIssue(
    request.requiredCoverageTags,
    "Required coverage tags",
    ["requiredCoverageTags"],
    context,
  );
  addStrictlySortedIssue(
    request.fixtures.map(({ caseId, ruleId }) => `${ruleId}:${caseId}`),
    "Run fixtures",
    ["fixtures"],
    context,
  );
  request.fixtures.forEach((fixture, index) => {
    const rule = request.rulePackVersion.rules.find(({ id }) => id === fixture.ruleId);
    if (rule === undefined) {
      context.addIssue({
        code: "custom",
        message: "Fixture target rule is absent from the Rule Pack version",
        path: ["fixtures", index, "ruleId"],
      });
      return;
    }
    if (rule.contentHash !== fixture.ruleContentHash) {
      context.addIssue({
        code: "custom",
        message: "Fixture target hash does not match the Rule Pack version",
        path: ["fixtures", index, "ruleContentHash"],
      });
    }
  });
}

const RuleTestRunRequestObjectSchema = z
  .object({
    schemaVersion: z.literal(RULE_TESTING_SCHEMA_VERSION),
    requestId: z.uuid(),
    rulePackVersion: RulePackVersionSchema,
    fixtures: z.array(RuleTestFixtureSchema).min(1).max(RULE_TESTING_LIMITS.maxFixtures).readonly(),
    requiredCoverageTags: z.array(RuleTestCoverageTagSchema).min(1).max(9).readonly(),
    validationScope: ValidationScopeSchema,
  })
  .strict()
  .superRefine(refineRunRequest)
  .readonly();

export const RuleTestRunRequestSchema = RuleTestingSnapshotSchema.pipe(
  RuleTestRunRequestObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RuleTestRunRequestObjectSchema>
>;

export type RuleTestRunRequest = z.infer<typeof RuleTestRunRequestSchema>;

export const RuleTestActualFindingSchema = RuleTestExpectedFindingSchema;
export type RuleTestActualFinding = RuleTestExpectedFinding;

const RuleTestFixtureResultObjectSchema = z
  .object({
    fixtureId: z.uuid(),
    caseId: StableCaseIdSchema,
    ruleId: z.uuid(),
    expected: RuleTestExpectedFindingSchema,
    actual: RuleTestActualFindingSchema.nullable(),
    aggregateOutcome: EvaluationOutcomeSchema.nullable(),
    evaluationContentHash: Sha256DigestSchema.nullable(),
    passed: z.boolean(),
    issues: z.array(BoundedTextSchema).max(20).readonly(),
  })
  .strict()
  .superRefine(({ expected, actual, passed, issues }, context) => {
    const actualMatches =
      actual !== null &&
      actual.ruleId === expected.ruleId &&
      actual.ruleContentHash === expected.ruleContentHash &&
      actual.outcome === expected.outcome &&
      actual.effectiveOutcome === expected.effectiveOutcome &&
      actual.resolution === expected.resolution &&
      actual.relatedRuleIds.length === expected.relatedRuleIds.length &&
      actual.relatedRuleIds.every((value, index) => value === expected.relatedRuleIds[index]);
    if (passed !== (actualMatches && issues.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "Fixture result pass/fail must be derived from actual and expected findings",
        path: ["passed"],
      });
    }
  })
  .readonly();

export const RuleTestFixtureResultSchema = RuleTestingSnapshotSchema.pipe(
  RuleTestFixtureResultObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RuleTestFixtureResultObjectSchema>
>;

export type RuleTestFixtureResult = z.infer<typeof RuleTestFixtureResultSchema>;

const RuleTestCoverageEntryObjectSchema = z
  .object({
    ruleId: z.uuid(),
    ruleContentHash: Sha256DigestSchema,
    observedCoverageTags: z.array(RuleTestCoverageTagSchema).max(9).readonly(),
    missingCoverageTags: z.array(RuleTestCoverageTagSchema).max(9).readonly(),
    observedOutcomes: z.array(EvaluationOutcomeSchema).max(4).readonly(),
  })
  .strict()
  .superRefine(({ observedCoverageTags, missingCoverageTags, observedOutcomes }, context) => {
    addStrictlySortedIssue(
      observedCoverageTags,
      "Observed coverage tags",
      ["observedCoverageTags"],
      context,
    );
    addStrictlySortedIssue(
      missingCoverageTags,
      "Missing coverage tags",
      ["missingCoverageTags"],
      context,
    );
    addStrictlySortedIssue(observedOutcomes, "Observed outcomes", ["observedOutcomes"], context);
  })
  .readonly();

export const RuleTestCoverageEntrySchema = RuleTestingSnapshotSchema.pipe(
  RuleTestCoverageEntryObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RuleTestCoverageEntryObjectSchema>
>;

export type RuleTestCoverageEntry = z.infer<typeof RuleTestCoverageEntrySchema>;

const RuleTestRunResultHashInputShape = {
  schemaVersion: z.literal(RULE_TESTING_SCHEMA_VERSION),
  requestId: z.uuid(),
  rulePackVersionId: z.uuid(),
  rulePackVersionContentHash: Sha256DigestSchema,
  fixtureSetHash: Sha256DigestSchema,
  requiredCoverageTags: z.array(RuleTestCoverageTagSchema).min(1).max(9).readonly(),
  fixtureResults: z
    .array(RuleTestFixtureResultObjectSchema)
    .min(1)
    .max(RULE_TESTING_LIMITS.maxFixtures)
    .readonly(),
  coverage: z.array(RuleTestCoverageEntryObjectSchema).min(1).max(10_000).readonly(),
  passed: z.boolean(),
  validationScope: ValidationScopeSchema,
} as const;

const RuleTestRunResultHashInputObjectSchema = z
  .object(RuleTestRunResultHashInputShape)
  .strict()
  .superRefine((result, context) => {
    addStrictlySortedIssue(
      result.requiredCoverageTags,
      "Required coverage tags",
      ["requiredCoverageTags"],
      context,
    );
    addStrictlySortedIssue(
      result.fixtureResults.map(({ ruleId, caseId }) => `${ruleId}:${caseId}`),
      "Fixture results",
      ["fixtureResults"],
      context,
    );
    addStrictlySortedIssue(
      result.coverage.map(({ ruleId }) => ruleId),
      "Coverage entries",
      ["coverage"],
      context,
    );
    const derivedPassed =
      result.fixtureResults.every(({ passed }) => passed) &&
      result.coverage.every(({ missingCoverageTags }) => missingCoverageTags.length === 0);
    if (result.passed !== derivedPassed) {
      context.addIssue({
        code: "custom",
        message: "Run result pass/fail must derive from fixtures and coverage",
        path: ["passed"],
      });
    }
  })
  .readonly();

export const RuleTestRunResultHashInputSchema = RuleTestingSnapshotSchema.pipe(
  RuleTestRunResultHashInputObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RuleTestRunResultHashInputObjectSchema>
>;

export type RuleTestRunResultHashInput = z.infer<typeof RuleTestRunResultHashInputSchema>;

export function computeRuleTestRunResultHash(input: RuleTestRunResultHashInput): string {
  return sha256CanonicalJson(RuleTestRunResultHashInputSchema.parse(input));
}

const RuleTestRunResultCandidateObjectSchema = z
  .object({
    ...RuleTestRunResultHashInputShape,
    contentHash: Sha256DigestSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const { contentHash, ...hashInput } = result;
    const parsed = RuleTestRunResultHashInputObjectSchema.safeParse(hashInput);
    if (!parsed.success) {
      parsed.error.issues.forEach((issue) => {
        context.addIssue({ ...issue, path: issue.path });
      });
    }
    if (contentHash !== sha256CanonicalJson(hashInput)) {
      context.addIssue({
        code: "custom",
        message: "contentHash does not match the canonical Rule Test run result",
        path: ["contentHash"],
      });
    }
  })
  .readonly();

export const RuleTestRunResultSchema = RuleTestingSnapshotSchema.pipe(
  RuleTestRunResultCandidateObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RuleTestRunResultCandidateObjectSchema>
>;

export type RuleTestRunResult = z.infer<typeof RuleTestRunResultSchema>;

export const RulePackImpactClassificationSchema = z.enum([
  "UNCHANGED",
  "OUTCOME_CHANGED",
  "NEW_REVIEW",
  "POSSIBLE_FALSE_CONFORMITY",
]);

export type RulePackImpactClassification = z.infer<typeof RulePackImpactClassificationSchema>;

export const RulePackImpactVersionRefSchema = z
  .object({
    versionId: z.uuid(),
    semver: z.string().min(5).max(255),
    contentHash: Sha256DigestSchema,
  })
  .strict()
  .readonly();

export type RulePackImpactVersionRef = z.infer<typeof RulePackImpactVersionRefSchema>;

const RulePackImpactOutcomeObjectSchema = z
  .object({
    ruleContentHash: Sha256DigestSchema,
    outcome: EvaluationOutcomeSchema,
    effectiveOutcome: EvaluationOutcomeSchema,
    resolution: RuleFindingResolutionSchema,
  })
  .strict()
  .readonly();

export const RulePackImpactOutcomeSchema = RuleTestingSnapshotSchema.pipe(
  RulePackImpactOutcomeObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RulePackImpactOutcomeObjectSchema>
>;

export type RulePackImpactOutcome = z.infer<typeof RulePackImpactOutcomeSchema>;

const RulePackImpactCaseObjectSchema = z
  .object({
    fixtureId: z.uuid(),
    caseId: StableCaseIdSchema,
    ruleId: z.uuid(),
    baseline: RulePackImpactOutcomeObjectSchema,
    candidate: RulePackImpactOutcomeObjectSchema,
    classifications: z.array(RulePackImpactClassificationSchema).min(1).max(4).readonly(),
  })
  .strict()
  .superRefine(({ baseline, candidate, classifications }, context) => {
    addStrictlySortedIssue(classifications, "Impact classifications", ["classifications"], context);
    const outcomeChanged = baseline.effectiveOutcome !== candidate.effectiveOutcome;
    const newReview =
      baseline.effectiveOutcome !== "REVIEW" && candidate.effectiveOutcome === "REVIEW";
    const possibleFalseCompliance =
      (baseline.effectiveOutcome === "FAIL" || baseline.effectiveOutcome === "REVIEW") &&
      (candidate.effectiveOutcome === "PASS" || candidate.effectiveOutcome === "NOT_APPLICABLE");
    const expected = [
      outcomeChanged ? "OUTCOME_CHANGED" : null,
      newReview ? "NEW_REVIEW" : null,
      possibleFalseCompliance ? "POSSIBLE_FALSE_CONFORMITY" : null,
    ].filter((value): value is RulePackImpactClassification => value !== null);
    if (expected.length === 0) expected.push("UNCHANGED");
    expected.sort(compareStrings);
    if (
      classifications.length !== expected.length ||
      classifications.some((value, index) => value !== expected[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "Impact classifications must be derived from baseline and candidate outcomes",
        path: ["classifications"],
      });
    }
  })
  .readonly();

export const RulePackImpactCaseSchema = RuleTestingSnapshotSchema.pipe(
  RulePackImpactCaseObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RulePackImpactCaseObjectSchema>
>;

export type RulePackImpactCase = z.infer<typeof RulePackImpactCaseSchema>;

const RulePackImpactSummaryObjectSchema = z
  .object({
    totalCases: z.int().min(0),
    changedCases: z.int().min(0),
    newReviewCases: z.int().min(0),
    possibleFalseComplianceCases: z.int().min(0),
    unchangedCases: z.int().min(0),
  })
  .strict()
  .readonly();

export const RulePackImpactSummarySchema = RuleTestingSnapshotSchema.pipe(
  RulePackImpactSummaryObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RulePackImpactSummaryObjectSchema>
>;

export type RulePackImpactSummary = z.infer<typeof RulePackImpactSummarySchema>;

const RulePackImpactReportHashInputShape = {
  schemaVersion: z.literal(RULE_PACK_IMPACT_SCHEMA_VERSION),
  baseline: RulePackImpactVersionRefSchema,
  candidate: RulePackImpactVersionRefSchema,
  fixtureSetHash: Sha256DigestSchema,
  cases: z.array(RulePackImpactCaseObjectSchema).max(RULE_TESTING_LIMITS.maxFixtures).readonly(),
  summary: RulePackImpactSummaryObjectSchema,
  validationScope: ValidationScopeSchema,
} as const;

const RulePackImpactReportHashInputObjectSchema = z
  .object(RulePackImpactReportHashInputShape)
  .strict()
  .superRefine((report, context) => {
    addStrictlySortedIssue(
      report.cases.map(({ ruleId, caseId }) => `${ruleId}:${caseId}`),
      "Impact cases",
      ["cases"],
      context,
    );
    const summary = {
      totalCases: report.cases.length,
      changedCases: report.cases.filter(({ classifications }) =>
        classifications.includes("OUTCOME_CHANGED"),
      ).length,
      newReviewCases: report.cases.filter(({ classifications }) =>
        classifications.includes("NEW_REVIEW"),
      ).length,
      possibleFalseComplianceCases: report.cases.filter(({ classifications }) =>
        classifications.includes("POSSIBLE_FALSE_CONFORMITY"),
      ).length,
      unchangedCases: report.cases.filter(({ classifications }) =>
        classifications.includes("UNCHANGED"),
      ).length,
    };
    for (const [key, value] of Object.entries(summary)) {
      if (report.summary[key as keyof typeof summary] !== value) {
        context.addIssue({
          code: "custom",
          message: "Impact summary must be derived from case classifications",
          path: ["summary", key],
        });
      }
    }
  })
  .readonly();

export const RulePackImpactReportHashInputSchema = RuleTestingSnapshotSchema.pipe(
  RulePackImpactReportHashInputObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RulePackImpactReportHashInputObjectSchema>
>;

export type RulePackImpactReportHashInput = z.infer<typeof RulePackImpactReportHashInputSchema>;

export function computeRulePackImpactReportHash(input: RulePackImpactReportHashInput): string {
  return sha256CanonicalJson(RulePackImpactReportHashInputSchema.parse(input));
}

const RulePackImpactReportCandidateObjectSchema = z
  .object({
    ...RulePackImpactReportHashInputShape,
    contentHash: Sha256DigestSchema,
  })
  .strict()
  .superRefine((report, context) => {
    const { contentHash, ...hashInput } = report;
    const parsed = RulePackImpactReportHashInputObjectSchema.safeParse(hashInput);
    if (!parsed.success) {
      parsed.error.issues.forEach((issue) => {
        context.addIssue({ ...issue, path: issue.path });
      });
    }
    if (contentHash !== sha256CanonicalJson(hashInput)) {
      context.addIssue({
        code: "custom",
        message: "contentHash does not match the canonical Rule Pack impact report",
        path: ["contentHash"],
      });
    }
  })
  .readonly();

export const RulePackImpactReportSchema = RuleTestingSnapshotSchema.pipe(
  RulePackImpactReportCandidateObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RulePackImpactReportCandidateObjectSchema>
>;

export type RulePackImpactReport = z.infer<typeof RulePackImpactReportSchema>;

const RulePackImpactRequestObjectSchema = z
  .object({
    schemaVersion: z.literal(RULE_PACK_IMPACT_SCHEMA_VERSION),
    baselineVersion: RulePackVersionSchema,
    candidateVersion: RulePackVersionSchema,
    fixtures: z.array(RuleTestFixtureSchema).min(1).max(RULE_TESTING_LIMITS.maxFixtures).readonly(),
    validationScope: ValidationScopeSchema,
  })
  .strict()
  .superRefine(({ fixtures }, context) => {
    addStrictlySortedIssue(
      fixtures.map(({ caseId, ruleId }) => `${ruleId}:${caseId}`),
      "Impact request fixtures",
      ["fixtures"],
      context,
    );
  })
  .readonly();

export const RulePackImpactRequestSchema = RuleTestingSnapshotSchema.pipe(
  RulePackImpactRequestObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RulePackImpactRequestObjectSchema>
>;

export type RulePackImpactRequest = z.infer<typeof RulePackImpactRequestSchema>;
