import { describe, expect, it } from "vitest";

import {
  computeRuleCardRevisionHash,
  RuleCardApprovalDecisionSchema,
  RuleCardCommentSchema,
  RuleDraftGenerationReferenceSchema,
  RuleGenerationEligibilityRequestSchema,
  RuleCardReviewDecisionSchema,
  RuleCardRevisionSchema,
  RuleCardSchema,
  RuleCardTransitionEventSchema,
  verifyRuleCardRevisionHash,
} from "../../src/index.js";
import type { RuleCardRevisionHashInput } from "../../src/index.js";

const IDS = {
  card: "00000000-0000-4000-8000-000000000020",
  revision: "00000000-0000-4000-8000-000000000021",
  previousRevision: "00000000-0000-4000-8000-000000000022",
  source: "00000000-0000-4000-8000-000000000023",
  sourceVersion: "00000000-0000-4000-8000-000000000024",
  actor: "00000000-0000-4000-8000-000000000025",
  record: "00000000-0000-4000-8000-000000000026",
} as const;

const REVISION_HASH = "b".repeat(64);
const SOURCE_HASH = "c".repeat(64);
const CREATED_AT = "2026-03-01T00:00:00.000Z";

const CARD = {
  id: IDS.card,
  sourceId: IDS.source,
  sourceVersionId: IDS.sourceVersion,
  sourceSection: "synthetic-section-1",
  validationScope: "TECHNICAL_DEMO",
} as const;

const EVIDENCE_REQUIREMENT = {
  id: "00000000-0000-4000-8000-000000000027",
  key: "document.marker",
  description: "A synthetic marker is visible",
  rationale: "The marker demonstrates evidence linkage",
  sourceReference: "synthetic-section-1.2",
} as const;

const EXCEPTION = {
  id: "00000000-0000-4000-8000-000000000028",
  key: "temporary.exclusion",
  description: "A documented synthetic exclusion applies",
  rationale: "The source explicitly defines the exclusion",
  sourceReference: "synthetic-section-1.3",
} as const;

const REVISION_INPUT: RuleCardRevisionHashInput = {
  id: IDS.revision,
  cardId: IDS.card,
  revision: 1,
  sourceId: IDS.source,
  sourceVersionId: IDS.sourceVersion,
  sourceContentHash: SOURCE_HASH,
  sourceSection: CARD.sourceSection,
  normativeActor: "Synthetic operator",
  object: "Synthetic operational record",
  scope: "Locally generated demonstration cases",
  normativeKey: "synthetic.record.marker",
  deonticCategory: "OBLIGATION",
  exceptions: [EXCEPTION],
  evidenceRequirements: [EVIDENCE_REQUIREMENT],
  riskLevel: "MEDIUM",
  riskRationale: "A missed requirement needs planned correction",
  falsePositiveCost: "LOW",
  falsePositiveCostRationale: "A false alert is locally reversible",
  falseNegativeCost: "HIGH",
  falseNegativeCostRationale: "A missed issue may remain undetected",
  provenance: "MANUAL",
  provider: null,
  validity: { validFrom: CREATED_AT, validTo: null },
  createdAt: CREATED_AT,
  createdBy: IDS.actor,
  replacesRevisionId: null,
  revisionReason: null,
};

const REVISION = {
  ...REVISION_INPUT,
  contentHash: computeRuleCardRevisionHash(REVISION_INPUT),
};

function auditBase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: IDS.record,
    revisionId: IDS.revision,
    sequence: 1,
    actorId: IDS.actor,
    at: CREATED_AT,
    revisionContentHash: REVISION_HASH,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

function transition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return auditBase({
    from: null,
    to: "DRAFT",
    exercisedRole: "AUTHOR",
    reason: null,
    ...overrides,
  });
}

describe("RuleCardSchema", () => {
  it("accepts stable links and trims the source section", () => {
    expect(RuleCardSchema.parse({ ...CARD, sourceSection: "  synthetic-section-1  " })).toEqual(
      CARD,
    );
  });

  it.each([
    { id: "invalid" },
    { sourceId: "invalid" },
    { sourceVersionId: "invalid" },
    { sourceSection: " " },
    { validationScope: "UNVERIFIED" },
  ])("rejects an invalid stable link %#", (override) => {
    expect(RuleCardSchema.safeParse({ ...CARD, ...override }).success).toBe(false);
  });

  it("does not accept mutable projection state", () => {
    expect(RuleCardSchema.safeParse({ ...CARD, state: "DRAFT" }).success).toBe(false);
  });
});

describe("Rule generation boundary schemas", () => {
  const request = {
    revisionId: IDS.revision,
    generationAt: CREATED_AT,
    evaluationDate: CREATED_AT,
    expectedRevisionContentHash: REVISION_HASH,
    expectedSourceContentHash: SOURCE_HASH,
    targetState: "DRAFT",
  } as const;

  it("accepts a strict hash-pinned DRAFT request and reference", () => {
    expect(RuleGenerationEligibilityRequestSchema.parse(request)).toEqual(request);
    expect(
      RuleDraftGenerationReferenceSchema.safeParse({
        targetState: "DRAFT",
        cardId: IDS.card,
        cardRevisionId: IDS.revision,
        revisionContentHash: REVISION_HASH,
        sourceId: IDS.source,
        sourceVersionId: IDS.sourceVersion,
        sourceContentHash: SOURCE_HASH,
        generationAt: CREATED_AT,
        evaluationDate: CREATED_AT,
        validationScope: "TECHNICAL_DEMO",
      }).success,
    ).toBe(true);
  });

  it.each([
    { revisionId: "not-a-uuid" },
    { generationAt: "2026-03-01T01:00:00.000+01:00" },
    { evaluationDate: "2026-03-01T01:00:00.000+01:00" },
    { expectedRevisionContentHash: "invalid" },
    { expectedSourceContentHash: "invalid" },
    { targetState: "ACTIVE" },
    { hidden: true },
  ])("rejects a malformed generation request %#", (override) => {
    expect(
      RuleGenerationEligibilityRequestSchema.safeParse({ ...request, ...override }).success,
    ).toBe(false);
  });
});

describe("RuleCardRevisionSchema", () => {
  it("accepts a complete first revision", () => {
    expect(RuleCardRevisionSchema.parse(REVISION)).toEqual(REVISION);
  });

  it("accepts a later revision only when linked to a distinct predecessor", () => {
    const replacementInput: RuleCardRevisionHashInput = {
      ...REVISION_INPUT,
      revision: 2,
      replacesRevisionId: IDS.previousRevision,
      revisionReason: "Clarified the synthetic interpretation",
    };
    const replacement = {
      ...replacementInput,
      contentHash: computeRuleCardRevisionHash(replacementInput),
    };

    expect(RuleCardRevisionSchema.parse(replacement)).toEqual(replacement);
  });

  it("accepts no declared exceptions", () => {
    const hashInput = { ...REVISION_INPUT, exceptions: [] };
    expect(
      RuleCardRevisionSchema.safeParse({
        ...hashInput,
        contentHash: computeRuleCardRevisionHash(hashInput),
      }).success,
    ).toBe(true);
  });

  it("accepts AI-assisted provenance only with a named provider", () => {
    const hashInput: RuleCardRevisionHashInput = {
      ...REVISION_INPUT,
      provenance: "AI_ASSISTED",
      provider: "Synthetic local adapter",
    };

    expect(
      RuleCardRevisionSchema.safeParse({
        ...hashInput,
        contentHash: computeRuleCardRevisionHash(hashInput),
      }).success,
    ).toBe(true);
  });

  it.each([
    { revision: 0 },
    { revision: 1.5 },
    { sourceContentHash: "invalid" },
    { sourceSection: " " },
    { normativeActor: " " },
    { object: " " },
    { scope: " " },
    { normativeKey: "invalid key with spaces" },
    { deonticCategory: "ADVICE" },
    { evidenceRequirements: [] },
    { riskLevel: "SEVERE" },
    { riskRationale: " " },
    { falsePositiveCost: "SEVERE" },
    { falsePositiveCostRationale: " " },
    { falseNegativeCost: "SEVERE" },
    { falseNegativeCostRationale: " " },
    { provenance: "UNKNOWN" },
    { provenance: "AI_ASSISTED", provider: null },
    { provenance: "MANUAL", provider: "Unexpected provider" },
    { validity: { validFrom: CREATED_AT, validTo: CREATED_AT } },
    { createdAt: "2026-03-01T01:00:00.000+01:00" },
    { contentHash: "B".repeat(64) },
    { contentHash: REVISION_HASH },
    { revision: 2, replacesRevisionId: null },
    { revision: 2, replacesRevisionId: null, revisionReason: "Missing predecessor" },
    { revision: 1, replacesRevisionId: IDS.previousRevision, revisionReason: null },
    {
      revision: 1,
      replacesRevisionId: IDS.previousRevision,
      revisionReason: "Unexpected replacement",
    },
    { revision: 2, replacesRevisionId: IDS.previousRevision, revisionReason: null },
    {
      revision: 2,
      replacesRevisionId: IDS.revision,
      revisionReason: "Self replacement",
    },
  ])("rejects an invalid revision invariant %#", (override) => {
    expect(RuleCardRevisionSchema.safeParse({ ...REVISION, ...override }).success).toBe(false);
  });

  it.each(["description", "rationale", "sourceReference"] as const)(
    "requires a nonempty exception %s",
    (field) => {
      expect(
        RuleCardRevisionSchema.safeParse({
          ...REVISION,
          exceptions: [{ ...EXCEPTION, [field]: " " }],
        }).success,
      ).toBe(false);
    },
  );

  it.each(["description", "rationale", "sourceReference"] as const)(
    "requires a nonempty evidence requirement %s",
    (field) => {
      expect(
        RuleCardRevisionSchema.safeParse({
          ...REVISION,
          evidenceRequirements: [{ ...EVIDENCE_REQUIREMENT, [field]: " " }],
        }).success,
      ).toBe(false);
    },
  );

  it("rejects duplicate IDs and structured keys independently in both collections", () => {
    expect(
      RuleCardRevisionSchema.safeParse({ ...REVISION, exceptions: [EXCEPTION, EXCEPTION] }).success,
    ).toBe(false);
    expect(
      RuleCardRevisionSchema.safeParse({
        ...REVISION,
        evidenceRequirements: [EVIDENCE_REQUIREMENT, EVIDENCE_REQUIREMENT],
      }).success,
    ).toBe(false);

    expect(
      RuleCardRevisionSchema.safeParse({
        ...REVISION,
        exceptions: [EXCEPTION, { ...EXCEPTION, key: "different.exception" }],
      }).success,
    ).toBe(false);
    expect(
      RuleCardRevisionSchema.safeParse({
        ...REVISION,
        evidenceRequirements: [
          EVIDENCE_REQUIREMENT,
          { ...EVIDENCE_REQUIREMENT, key: "different.requirement" },
        ],
      }).success,
    ).toBe(false);
    expect(
      RuleCardRevisionSchema.safeParse({
        ...REVISION,
        exceptions: [
          EXCEPTION,
          {
            ...EXCEPTION,
            id: "00000000-0000-4000-8000-000000000029",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      RuleCardRevisionSchema.safeParse({
        ...REVISION,
        evidenceRequirements: [
          EVIDENCE_REQUIREMENT,
          {
            ...EVIDENCE_REQUIREMENT,
            id: "00000000-0000-4000-8000-000000000030",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("computes and verifies a deterministic hash over the canonical snapshot", () => {
    expect(computeRuleCardRevisionHash({ ...REVISION_INPUT })).toBe(REVISION.contentHash);
    expect(verifyRuleCardRevisionHash(REVISION)).toBe(true);
    expect(verifyRuleCardRevisionHash({ ...REVISION, contentHash: REVISION_HASH })).toBe(false);
    expect(verifyRuleCardRevisionHash({ ...REVISION, unknown: true })).toBe(false);
  });

  it("rejects undeclared fields at the revision and nested levels", () => {
    expect(RuleCardRevisionSchema.safeParse({ ...REVISION, state: "DRAFT" }).success).toBe(false);
    expect(
      RuleCardRevisionSchema.safeParse({
        ...REVISION,
        exceptions: [{ ...EXCEPTION, hidden: true }],
      }).success,
    ).toBe(false);
    expect(
      RuleCardRevisionSchema.safeParse({
        ...REVISION,
        evidenceRequirements: [{ ...EVIDENCE_REQUIREMENT, hidden: true }],
      }).success,
    ).toBe(false);
  });
});

describe("RuleCardCommentSchema", () => {
  it.each(["AUTHOR", "REVIEWER", "APPROVER", "ADMIN"] as const)(
    "records a comment made while exercising the %s role",
    (exercisedRole) => {
      expect(
        RuleCardCommentSchema.safeParse(
          auditBase({ exercisedRole, body: "A synthetic audit comment" }),
        ).success,
      ).toBe(true);
    },
  );

  it.each([
    { sequence: 0, exercisedRole: "AUTHOR", body: "Comment" },
    { exercisedRole: "UNKNOWN", body: "Comment" },
    { exercisedRole: "AUTHOR", body: " " },
    { exercisedRole: "AUTHOR", body: "Comment", revisionContentHash: "invalid" },
    { exercisedRole: "AUTHOR", body: "Comment", at: "not-a-date" },
    { exercisedRole: "AUTHOR", body: "Comment", validationScope: "PROFESSIONAL" },
    { exercisedRole: "AUTHOR", body: "Comment", unknown: true },
  ])("rejects an invalid comment %#", (override) => {
    expect(RuleCardCommentSchema.safeParse(auditBase(override)).success).toBe(false);
  });
});

describe("RuleCardReviewDecisionSchema", () => {
  it.each(["ACCEPTED", "CHANGES_REQUESTED"] as const)(
    "accepts the %s reviewer decision",
    (decision) => {
      expect(
        RuleCardReviewDecisionSchema.safeParse(
          auditBase({
            exercisedRole: "REVIEWER",
            decision,
            rationale: "The synthetic review is fully explained",
          }),
        ).success,
      ).toBe(true);
    },
  );

  it.each([
    { exercisedRole: "AUTHOR", decision: "ACCEPTED", rationale: "Explained" },
    { exercisedRole: "REVIEWER", decision: "REJECTED", rationale: "Explained" },
    { exercisedRole: "REVIEWER", decision: "ACCEPTED", rationale: " " },
    { exercisedRole: "REVIEWER", decision: "ACCEPTED", rationale: "Explained", hidden: true },
  ])("rejects an invalid reviewer decision %#", (override) => {
    expect(RuleCardReviewDecisionSchema.safeParse(auditBase(override)).success).toBe(false);
  });
});

describe("RuleCardApprovalDecisionSchema", () => {
  it.each(["APPROVED", "REJECTED"] as const)("accepts the %s approver decision", (decision) => {
    expect(
      RuleCardApprovalDecisionSchema.safeParse(
        auditBase({
          exercisedRole: "APPROVER",
          decision,
          rationale: "The synthetic approval decision is fully explained",
        }),
      ).success,
    ).toBe(true);
  });

  it.each([
    { exercisedRole: "REVIEWER", decision: "APPROVED", rationale: "Explained" },
    { exercisedRole: "APPROVER", decision: "ACCEPTED", rationale: "Explained" },
    { exercisedRole: "APPROVER", decision: "APPROVED", rationale: " " },
    { exercisedRole: "APPROVER", decision: "APPROVED", rationale: "Explained", hidden: true },
  ])("rejects an invalid approver decision %#", (override) => {
    expect(RuleCardApprovalDecisionSchema.safeParse(auditBase(override)).success).toBe(false);
  });
});

describe("RuleCardTransitionEventSchema", () => {
  it.each([
    [{ sequence: 1, from: null, to: "DRAFT", exercisedRole: "AUTHOR" }],
    [{ sequence: 2, from: "DRAFT", to: "IN_REVIEW", exercisedRole: "AUTHOR" }],
    [
      {
        sequence: 4,
        from: "APPROVED",
        to: "RETIRED",
        exercisedRole: "APPROVER",
        reason: "Superseded by a later synthetic revision",
      },
    ],
  ])("accepts a legal append-only transition %#", (override) => {
    expect(RuleCardTransitionEventSchema.safeParse(transition(override)).success).toBe(true);
  });

  it.each([
    { sequence: 2, from: null, to: "DRAFT", exercisedRole: "AUTHOR" },
    { sequence: 1, from: "DRAFT", to: "IN_REVIEW", exercisedRole: "AUTHOR" },
    { sequence: 1, from: null, to: "APPROVED", exercisedRole: "APPROVER" },
    { sequence: 2, from: "DRAFT", to: "APPROVED", exercisedRole: "APPROVER" },
    { sequence: 3, from: "IN_REVIEW", to: "APPROVED", exercisedRole: "APPROVER" },
    {
      sequence: 3,
      from: "IN_REVIEW",
      to: "CHANGES_REQUESTED",
      exercisedRole: "REVIEWER",
      reason: "Synthetic changes are required",
    },
    { sequence: 2, from: "DRAFT", to: "IN_REVIEW", exercisedRole: "REVIEWER" },
    {
      sequence: 3,
      from: "IN_REVIEW",
      to: "CHANGES_REQUESTED",
      exercisedRole: "REVIEWER",
    },
    { sequence: 4, from: "APPROVED", to: "RETIRED", exercisedRole: "APPROVER" },
    { revisionContentHash: "invalid" },
    { at: "2026-03-01T00:00:00.000+00:00" },
    { validationScope: "PROFESSIONAL" },
    { hidden: true },
  ])("rejects an invalid transition invariant %#", (override) => {
    expect(RuleCardTransitionEventSchema.safeParse(transition(override)).success).toBe(false);
  });
});
