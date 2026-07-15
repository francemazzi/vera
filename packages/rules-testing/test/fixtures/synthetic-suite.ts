import {
  DSL_VERSION,
  RULE_PACK_SCHEMA_VERSION,
  RULE_TESTING_SCHEMA_VERSION,
  RuleDefinitionSchema,
  RulePackVersionSchema,
  RuleTestFixtureSchema,
  computeRuleDefinitionHash,
  computeRulePackVersionHash,
  computeRuleTestFixtureHash,
} from "@vera/contracts";
import type {
  DslExpression,
  Evidence,
  ExtractionFact,
  RuleDefinition,
  RuleDefinitionHashInput,
  RulePackVersion,
  RulePackVersionHashInput,
  RuleTestCoverageTag,
  RuleTestExpectedFinding,
  RuleTestFixture,
  RuleTestFixtureHashInput,
  RuleTestRunRequest,
} from "@vera/contracts";

import { DEFAULT_REQUIRED_COVERAGE_TAGS } from "../../src/index.js";

export const SYNTHETIC_IDS = {
  source: "00000000-0000-4000-8000-000000008001",
  sourceVersion: "00000000-0000-4000-8000-000000008002",
  ruleCardA: "00000000-0000-4000-8000-000000008003",
  ruleCardRevisionA: "00000000-0000-4000-8000-000000008004",
  ruleCardB: "00000000-0000-4000-8000-000000008005",
  ruleCardRevisionB: "00000000-0000-4000-8000-000000008006",
  pack: "00000000-0000-4000-8000-000000008010",
  version: "00000000-0000-4000-8000-000000008011",
  candidateVersion: "00000000-0000-4000-8000-000000008012",
  author: "00000000-0000-4000-8000-000000008013",
  publisher: "00000000-0000-4000-8000-000000008014",
  request: "00000000-0000-4000-8000-000000008015",
  requestAlt: "00000000-0000-4000-8000-000000008016",
  ruleA: "00000000-0000-4000-8000-000000008101",
  ruleB: "00000000-0000-4000-8000-000000008102",
  exceptionA: "00000000-0000-4000-8000-000000008201",
  overrideB: "00000000-0000-4000-8000-000000008202",
  document: "00000000-0000-4000-8000-000000008301",
  run: "00000000-0000-4000-8000-000000008302",
} as const;

const SOURCE_HASH = "1".repeat(64);
const RULE_CARD_A_HASH = "2".repeat(64);
const RULE_CARD_B_HASH = "3".repeat(64);
const DOCUMENT_HASH = "4".repeat(64);
const OBSERVED_AT = "2026-06-01T00:00:00.000Z";
const VALID_FROM = "2026-01-01T00:00:00.000Z";
const VALID_TO = "2027-01-01T00:00:00.000Z";
const START_DATE = VALID_FROM;
const END_BOUNDARY_DATE = "2026-12-31T23:59:59.999Z";
const DEFAULT_DATE = "2026-07-15T12:00:00.000Z";

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function present(factKey: string): DslExpression {
  return { op: "present", factKey };
}

function makeRule(input: Omit<RuleDefinitionHashInput, "contentHash">): RuleDefinition {
  return RuleDefinitionSchema.parse({
    ...input,
    contentHash: computeRuleDefinitionHash(input),
  });
}

export function makeRuleA(overrides: Partial<RuleDefinitionHashInput> = {}): RuleDefinition {
  return makeRule({
    dslVersion: DSL_VERSION,
    state: "DRAFT",
    id: SYNTHETIC_IDS.ruleA,
    sourceId: SYNTHETIC_IDS.source,
    sourceVersionId: SYNTHETIC_IDS.sourceVersion,
    sourceContentHash: SOURCE_HASH,
    ruleCardId: SYNTHETIC_IDS.ruleCardA,
    ruleCardRevisionId: SYNTHETIC_IDS.ruleCardRevisionA,
    ruleCardRevisionContentHash: RULE_CARD_A_HASH,
    normativeKey: "synthetic.matrix.rule_a",
    deonticCategory: "OBLIGATION",
    riskLevel: "LOW",
    validity: { validFrom: VALID_FROM, validTo: VALID_TO },
    appliesWhen: present("ruleA.applicable"),
    satisfiedWhen: present("ruleA.marker"),
    exceptions: [
      {
        id: SYNTHETIC_IDS.exceptionA,
        key: "synthetic_exception_a",
        when: present("ruleA.exception"),
        reason: "Synthetic exception makes rule A not applicable",
        sourceVersionId: SYNTHETIC_IDS.sourceVersion,
        sourceReference: "synthetic-source/a#exception",
      },
    ],
    overrides: [],
    conflictsWith: [],
    evidenceBindings: [
      { factKey: "ruleA.applicable", evidenceRequirementKeys: ["applicability"] },
      { factKey: "ruleA.marker", evidenceRequirementKeys: ["marker"] },
      { factKey: "ruleA.exception", evidenceRequirementKeys: ["exception"] },
    ],
    unknownPolicy: "REVIEW",
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  });
}

export function makeRuleB(overrides: Partial<RuleDefinitionHashInput> = {}): RuleDefinition {
  return makeRule({
    dslVersion: DSL_VERSION,
    state: "DRAFT",
    id: SYNTHETIC_IDS.ruleB,
    sourceId: SYNTHETIC_IDS.source,
    sourceVersionId: SYNTHETIC_IDS.sourceVersion,
    sourceContentHash: SOURCE_HASH,
    ruleCardId: SYNTHETIC_IDS.ruleCardB,
    ruleCardRevisionId: SYNTHETIC_IDS.ruleCardRevisionB,
    ruleCardRevisionContentHash: RULE_CARD_B_HASH,
    normativeKey: "synthetic.matrix.rule_b",
    deonticCategory: "OBLIGATION",
    riskLevel: "LOW",
    validity: { validFrom: VALID_FROM, validTo: VALID_TO },
    appliesWhen: present("ruleB.applicable"),
    satisfiedWhen: present("ruleB.marker"),
    exceptions: [],
    overrides: [
      {
        id: SYNTHETIC_IDS.overrideB,
        overridingRuleId: SYNTHETIC_IDS.ruleB,
        overriddenRuleId: SYNTHETIC_IDS.ruleA,
        when: present("ruleB.override"),
        reason: "Synthetic rule B supersedes rule A for this demo case",
        sourceVersionId: SYNTHETIC_IDS.sourceVersion,
        sourceReference: "synthetic-source/b#override",
      },
    ],
    conflictsWith: [],
    evidenceBindings: [
      { factKey: "ruleB.applicable", evidenceRequirementKeys: ["applicability"] },
      { factKey: "ruleB.marker", evidenceRequirementKeys: ["marker"] },
      { factKey: "ruleB.override", evidenceRequirementKeys: ["override"] },
    ],
    unknownPolicy: "REVIEW",
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  });
}

export function makeVersion(
  rules: readonly RuleDefinition[] = [makeRuleA(), makeRuleB()],
  overrides: Partial<RulePackVersionHashInput> = {},
): RulePackVersion {
  const input: RulePackVersionHashInput = {
    schemaVersion: RULE_PACK_SCHEMA_VERSION,
    id: SYNTHETIC_IDS.version,
    packId: SYNTHETIC_IDS.pack,
    semver: "1.0.0",
    domain: "synthetic-quality",
    jurisdiction: "GLOBAL-DEMO",
    validity: { validFrom: VALID_FROM, validTo: VALID_TO },
    rules: [...rules].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    changeReason: "Initial synthetic matrix for rule testing",
    supersedesVersionId: null,
    createdAt: "2025-12-01T00:00:00.000Z",
    createdBy: SYNTHETIC_IDS.author,
    publishedAt: "2025-12-15T00:00:00.000Z",
    publishedBy: SYNTHETIC_IDS.publisher,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
  return RulePackVersionSchema.parse({
    ...input,
    contentHash: computeRulePackVersionHash(input),
  });
}

export function makeFalseComplianceCandidate(): RulePackVersion {
  const candidateRuleA = makeRuleA({
    satisfiedWhen: { op: "truth", value: "TRUE" },
    evidenceBindings: [
      { factKey: "ruleA.applicable", evidenceRequirementKeys: ["applicability"] },
      { factKey: "ruleA.exception", evidenceRequirementKeys: ["exception"] },
    ],
  });
  return makeVersion([candidateRuleA, makeRuleB()], {
    id: SYNTHETIC_IDS.candidateVersion,
    semver: "1.1.0",
    changeReason: "Synthetic candidate that makes rule A too permissive",
    supersedesVersionId: SYNTHETIC_IDS.version,
    publishedAt: "2025-12-20T00:00:00.000Z",
  });
}

interface Observation {
  readonly fact: ExtractionFact;
  readonly evidence: Evidence | null;
}

function evidence(id: string, key: string): Evidence {
  return {
    id,
    documentId: SYNTHETIC_IDS.document,
    documentHash: DOCUMENT_HASH,
    page: 1,
    text: `Synthetic evidence for ${key}`,
    language: "en",
    boundingBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
    providerRunId: SYNTHETIC_IDS.run,
    capturedAt: OBSERVED_AT,
    validationScope: "TECHNICAL_DEMO",
  };
}

function fact(
  id: string,
  key: string,
  status: "RESOLVED" | "NOT_FOUND" | "NULL",
  evidenceId: string,
  includeEvidence: boolean,
): Observation {
  const base = {
    id,
    key,
    valueType: "BOOLEAN" as const,
    providerRunId: SYNTHETIC_IDS.run,
    observedAt: OBSERVED_AT,
    rawConfidence: null,
    validationScope: "TECHNICAL_DEMO" as const,
  };
  const linkedEvidence = evidence(evidenceId, key);
  if (status === "RESOLVED") {
    return {
      fact: {
        ...base,
        status,
        originalValue: true,
        normalizedValue: true,
        evidenceIds: [evidenceId],
        candidates: [],
      },
      evidence: includeEvidence ? linkedEvidence : null,
    };
  }
  return {
    fact: {
      ...base,
      status,
      originalValue: null,
      normalizedValue: null,
      evidenceIds: [evidenceId],
      candidates: [],
    },
    evidence: includeEvidence ? linkedEvidence : null,
  };
}

function facts(
  seed: number,
  specs: readonly [string, "RESOLVED" | "NOT_FOUND" | "NULL", boolean][],
): {
  readonly facts: readonly ExtractionFact[];
  readonly evidence: readonly Evidence[];
} {
  const observations = specs.map(([key, status, includeEvidence], index) =>
    fact(uuid(seed + index), key, status, uuid(seed + 1_000 + index), includeEvidence),
  );
  return {
    facts: observations
      .map(({ fact }) => fact)
      .sort((left, right) => left.key.localeCompare(right.key)),
    evidence: observations
      .map(({ evidence }) => evidence)
      .filter((item): item is Evidence => item !== null)
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function expected(
  rule: RuleDefinition,
  outcome: RuleTestExpectedFinding["outcome"],
  options: Partial<Omit<RuleTestExpectedFinding, "ruleId" | "ruleContentHash" | "outcome">> = {},
): RuleTestExpectedFinding {
  return {
    ruleId: rule.id,
    ruleContentHash: rule.contentHash,
    outcome,
    effectiveOutcome: options.effectiveOutcome ?? outcome,
    resolution: options.resolution ?? "UNCHANGED",
    relatedRuleIds: options.relatedRuleIds ?? [],
  };
}

function makeFixture(input: {
  readonly id: string;
  readonly caseId: string;
  readonly description: string;
  readonly rule: RuleDefinition;
  readonly expected: RuleTestExpectedFinding;
  readonly fixtureFacts: readonly ExtractionFact[];
  readonly fixtureEvidence: readonly Evidence[];
  readonly coverageTags: readonly RuleTestCoverageTag[];
  readonly evaluationDate?: string;
}): RuleTestFixture {
  const hashInput: RuleTestFixtureHashInput = {
    schemaVersion: RULE_TESTING_SCHEMA_VERSION,
    id: input.id,
    caseId: input.caseId,
    description: input.description,
    ruleId: input.rule.id,
    ruleContentHash: input.rule.contentHash,
    evaluationDate: input.evaluationDate ?? DEFAULT_DATE,
    facts: input.fixtureFacts,
    evidence: input.fixtureEvidence,
    expected: input.expected,
    coverageTags: [...input.coverageTags].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
    validationScope: "TECHNICAL_DEMO",
  };
  return RuleTestFixtureSchema.parse({
    ...hashInput,
    contentHash: computeRuleTestFixtureHash(hashInput),
  });
}

export function makeCompleteFixtureMatrix(
  version: RulePackVersion = makeVersion(),
): readonly RuleTestFixture[] {
  const ruleA = version.rules.find(({ id }) => id === SYNTHETIC_IDS.ruleA);
  const ruleB = version.rules.find(({ id }) => id === SYNTHETIC_IDS.ruleB);
  if (ruleA === undefined || ruleB === undefined)
    throw new Error("Synthetic version is incomplete");

  const aPass = facts(90_000, [
    ["ruleA.applicable", "RESOLVED", true],
    ["ruleA.exception", "NOT_FOUND", true],
    ["ruleA.marker", "RESOLVED", true],
    ["ruleB.applicable", "NOT_FOUND", true],
  ]);
  const aFail = facts(90_100, [
    ["ruleA.applicable", "RESOLVED", true],
    ["ruleA.exception", "NOT_FOUND", true],
    ["ruleA.marker", "NOT_FOUND", true],
    ["ruleB.applicable", "NOT_FOUND", true],
  ]);
  const aReview = facts(90_200, [
    ["ruleA.applicable", "RESOLVED", true],
    ["ruleA.exception", "NOT_FOUND", true],
    ["ruleA.marker", "RESOLVED", false],
    ["ruleB.applicable", "NOT_FOUND", true],
  ]);
  const aException = facts(90_300, [
    ["ruleA.applicable", "RESOLVED", true],
    ["ruleA.exception", "RESOLVED", true],
    ["ruleA.marker", "NOT_FOUND", true],
    ["ruleB.applicable", "NOT_FOUND", true],
  ]);
  const aOverride = facts(90_400, [
    ["ruleA.applicable", "RESOLVED", true],
    ["ruleA.exception", "NOT_FOUND", true],
    ["ruleA.marker", "RESOLVED", true],
    ["ruleB.applicable", "RESOLVED", true],
    ["ruleB.marker", "RESOLVED", true],
    ["ruleB.override", "RESOLVED", true],
  ]);
  const bPass = facts(90_500, [
    ["ruleA.applicable", "NOT_FOUND", true],
    ["ruleB.applicable", "RESOLVED", true],
    ["ruleB.marker", "RESOLVED", true],
    ["ruleB.override", "NOT_FOUND", true],
  ]);
  const bFail = facts(90_600, [
    ["ruleA.applicable", "NOT_FOUND", true],
    ["ruleB.applicable", "RESOLVED", true],
    ["ruleB.marker", "NOT_FOUND", true],
    ["ruleB.override", "NOT_FOUND", true],
  ]);
  const bReview = facts(90_700, [
    ["ruleA.applicable", "NOT_FOUND", true],
    ["ruleB.applicable", "RESOLVED", true],
    ["ruleB.marker", "NULL", true],
    ["ruleB.override", "NOT_FOUND", true],
  ]);
  const bNotApplicable = facts(90_800, [
    ["ruleA.applicable", "NOT_FOUND", true],
    ["ruleB.applicable", "NOT_FOUND", true],
  ]);
  const bOverride = facts(90_900, [
    ["ruleA.applicable", "RESOLVED", true],
    ["ruleA.exception", "NOT_FOUND", true],
    ["ruleA.marker", "RESOLVED", true],
    ["ruleB.applicable", "RESOLVED", true],
    ["ruleB.marker", "RESOLVED", true],
    ["ruleB.override", "RESOLVED", true],
  ]);

  return [
    makeFixture({
      id: uuid(91_001),
      caseId: "rule-a-pass-start",
      description: "Rule A passes at the inclusive validity start",
      rule: ruleA,
      expected: expected(ruleA, "PASS"),
      fixtureFacts: aPass.facts,
      fixtureEvidence: aPass.evidence,
      coverageTags: ["EVIDENCE", "OUTCOME_PASS", "VALIDITY_START"],
      evaluationDate: START_DATE,
    }),
    makeFixture({
      id: uuid(91_002),
      caseId: "rule-a-fail",
      description: "Rule A fails when its marker is explicitly not found",
      rule: ruleA,
      expected: expected(ruleA, "FAIL"),
      fixtureFacts: aFail.facts,
      fixtureEvidence: aFail.evidence,
      coverageTags: ["EVIDENCE", "OUTCOME_FAIL"],
    }),
    makeFixture({
      id: uuid(91_003),
      caseId: "rule-a-review-missing-evidence",
      description: "Rule A reviews when a resolved marker lacks evidence",
      rule: ruleA,
      expected: expected(ruleA, "REVIEW"),
      fixtureFacts: aReview.facts,
      fixtureEvidence: aReview.evidence,
      coverageTags: ["EVIDENCE", "OUTCOME_REVIEW"],
    }),
    makeFixture({
      id: uuid(91_004),
      caseId: "rule-a-not-applicable-exception",
      description: "Rule A becomes not applicable through a synthetic exception",
      rule: ruleA,
      expected: expected(ruleA, "NOT_APPLICABLE"),
      fixtureFacts: aException.facts,
      fixtureEvidence: aException.evidence,
      coverageTags: ["EXCEPTION", "OUTCOME_NOT_APPLICABLE"],
    }),
    makeFixture({
      id: uuid(91_005),
      caseId: "rule-a-overridden-end",
      description: "Rule A is overridden just before the validity end",
      rule: ruleA,
      expected: expected(ruleA, "PASS", {
        effectiveOutcome: "NOT_APPLICABLE",
        resolution: "OVERRIDDEN",
        relatedRuleIds: [ruleB.id],
      }),
      fixtureFacts: aOverride.facts,
      fixtureEvidence: aOverride.evidence,
      coverageTags: ["OUTCOME_NOT_APPLICABLE", "OVERRIDE", "VALIDITY_END"],
      evaluationDate: END_BOUNDARY_DATE,
    }),
    makeFixture({
      id: uuid(91_101),
      caseId: "rule-b-pass",
      description: "Rule B passes with marker evidence and an inactive override",
      rule: ruleB,
      expected: expected(ruleB, "PASS"),
      fixtureFacts: bPass.facts,
      fixtureEvidence: bPass.evidence,
      coverageTags: ["EVIDENCE", "OUTCOME_PASS"],
    }),
    makeFixture({
      id: uuid(91_102),
      caseId: "rule-b-fail",
      description: "Rule B fails when its marker is explicitly absent",
      rule: ruleB,
      expected: expected(ruleB, "FAIL"),
      fixtureFacts: bFail.facts,
      fixtureEvidence: bFail.evidence,
      coverageTags: ["OUTCOME_FAIL"],
    }),
    makeFixture({
      id: uuid(91_103),
      caseId: "rule-b-review",
      description: "Rule B reviews when marker extraction returns NULL",
      rule: ruleB,
      expected: expected(ruleB, "REVIEW"),
      fixtureFacts: bReview.facts,
      fixtureEvidence: bReview.evidence,
      coverageTags: ["OUTCOME_REVIEW"],
    }),
    makeFixture({
      id: uuid(91_104),
      caseId: "rule-b-not-applicable",
      description: "Rule B is not applicable when applicability is not found",
      rule: ruleB,
      expected: expected(ruleB, "NOT_APPLICABLE"),
      fixtureFacts: bNotApplicable.facts,
      fixtureEvidence: bNotApplicable.evidence,
      coverageTags: ["OUTCOME_NOT_APPLICABLE"],
    }),
    makeFixture({
      id: uuid(91_105),
      caseId: "rule-b-pass-with-override",
      description: "Rule B passes while exercising its override expression",
      rule: ruleB,
      expected: expected(ruleB, "PASS"),
      fixtureFacts: bOverride.facts,
      fixtureEvidence: bOverride.evidence,
      coverageTags: ["OUTCOME_PASS", "OVERRIDE"],
    }),
  ].sort((left, right) =>
    `${left.ruleId}:${left.caseId}` < `${right.ruleId}:${right.caseId}` ? -1 : 1,
  );
}

export function makeRunRequest(overrides: Partial<RuleTestRunRequest> = {}): RuleTestRunRequest {
  const version = overrides.rulePackVersion ?? makeVersion();
  return {
    schemaVersion: RULE_TESTING_SCHEMA_VERSION,
    requestId: SYNTHETIC_IDS.request,
    rulePackVersion: version,
    fixtures: makeCompleteFixtureMatrix(version),
    requiredCoverageTags: DEFAULT_REQUIRED_COVERAGE_TAGS,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}
