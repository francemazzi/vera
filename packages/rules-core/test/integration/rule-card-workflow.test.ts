import {
  computeRuleCardRevisionHash,
  sha256Bytes,
  type Actor,
  type ComplianceSource,
  type ComplianceSourceTransitionEvent,
  type ComplianceSourceVersion,
  type RiskLevel,
  type RuleCard,
  type RuleCardApprovalDecision,
  type RuleCardComment,
  type RuleCardReviewDecision,
  type RuleCardRevision,
  type RuleCardRevisionHashInput,
  type RuleCardTransitionEvent,
  type RuleGenerationEligibilityRequest,
} from "@vera/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryComplianceSourceRepository, InMemoryRuleCardRepository } from "../../src/index.js";

const IDS = {
  author: "00000000-0000-4000-8000-000000000001",
  reviewer: "00000000-0000-4000-8000-000000000002",
  approverOne: "00000000-0000-4000-8000-000000000003",
  approverTwo: "00000000-0000-4000-8000-000000000004",
  source: "00000000-0000-4000-8000-000000000101",
  sourceVersion: "00000000-0000-4000-8000-000000000201",
  sourceUpload: "00000000-0000-4000-8000-000000000301",
  sourceReview: "00000000-0000-4000-8000-000000000302",
  sourceApproval: "00000000-0000-4000-8000-000000000303",
  sourceRetirement: "00000000-0000-4000-8000-000000000304",
  card: "00000000-0000-4000-8000-000000000401",
  revisionOne: "00000000-0000-4000-8000-000000000501",
  revisionTwo: "00000000-0000-4000-8000-000000000502",
  evidence: "00000000-0000-4000-8000-000000000601",
  draft: "00000000-0000-4000-8000-000000000701",
  submit: "00000000-0000-4000-8000-000000000702",
  review: "00000000-0000-4000-8000-000000000703",
  approvalOne: "00000000-0000-4000-8000-000000000704",
  approvalTwo: "00000000-0000-4000-8000-000000000705",
  commentOne: "00000000-0000-4000-8000-000000000706",
  commentTwo: "00000000-0000-4000-8000-000000000707",
  secondDraft: "00000000-0000-4000-8000-000000000708",
} as const;

const TIMES = {
  sourceCreated: "2026-01-01T00:00:00.000Z",
  sourceUploaded: "2026-01-01T01:00:00.000Z",
  sourceReviewed: "2026-01-01T02:00:00.000Z",
  sourceApproved: "2026-01-01T03:00:00.000Z",
  cardCreated: "2026-02-01T00:00:00.000Z",
  cardSubmitted: "2026-02-02T00:00:00.000Z",
  cardReviewed: "2026-02-03T00:00:00.000Z",
  cardApprovedOne: "2026-02-04T00:00:00.000Z",
  cardApprovedTwo: "2026-02-05T00:00:00.000Z",
  generation: "2026-02-06T00:00:00.000Z",
  sourceRetired: "2026-08-01T00:00:00.000Z",
  evaluation: "2026-06-01T00:00:00.000Z",
  validFrom: "2026-01-01T00:00:00.000Z",
  validTo: "2027-01-01T00:00:00.000Z",
} as const;

const ACTORS = {
  author: actor(IDS.author, "AUTHOR"),
  reviewer: actor(IDS.reviewer, "REVIEWER"),
  approverOne: actor(IDS.approverOne, "APPROVER"),
  approverTwo: actor(IDS.approverTwo, "APPROVER"),
} as const;

const SOURCE_CONTENT_HASH = sha256Bytes(
  new TextEncoder().encode("Synthetic compliance source for integration tests"),
);

function actor(id: string, role: Actor["role"]): Actor {
  return {
    id,
    displayName: `Synthetic ${role}`,
    role,
    validationScope: "TECHNICAL_DEMO",
  };
}

function makeSource(): ComplianceSource {
  return {
    id: IDS.source,
    type: "STANDARD",
    domain: "synthetic-methodology",
    jurisdiction: "GLOBAL-DEMO",
    title: "Synthetic Integration Reference",
    stableReference: "urn:vera:synthetic:integration-reference",
    validationScope: "TECHNICAL_DEMO",
  };
}

function makeSourceVersion(): ComplianceSourceVersion {
  return {
    id: IDS.sourceVersion,
    sourceId: IDS.source,
    revision: 1,
    versionLabel: "synthetic-v1",
    license: "CC0-1.0",
    contentHash: SOURCE_CONTENT_HASH,
    validity: { validFrom: TIMES.validFrom, validTo: TIMES.validTo },
    createdAt: TIMES.sourceCreated,
    createdBy: IDS.author,
    replacesVersionId: null,
    replacementReason: null,
  };
}

function makeSourceEvent(
  overrides: Partial<ComplianceSourceTransitionEvent> = {},
): ComplianceSourceTransitionEvent {
  return {
    id: IDS.sourceUpload,
    versionId: IDS.sourceVersion,
    sequence: 1,
    from: null,
    to: "UPLOADED",
    actorId: IDS.author,
    exercisedRole: "AUTHOR",
    at: TIMES.sourceUploaded,
    contentHash: SOURCE_CONTENT_HASH,
    reason: null,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

function makeSourceRepository(
  targetState: "UPLOADED" | "APPROVED" = "APPROVED",
): InMemoryComplianceSourceRepository {
  const repository = new InMemoryComplianceSourceRepository();
  repository.addSource(makeSource());
  repository.appendVersion(makeSourceVersion(), 0);
  repository.appendTransition(
    makeSourceEvent(),
    { actor: ACTORS.author },
    { sequence: 0, state: null },
  );

  if (targetState === "APPROVED") {
    repository.appendTransition(
      makeSourceEvent({
        id: IDS.sourceReview,
        sequence: 2,
        from: "UPLOADED",
        to: "REVIEWED",
        actorId: IDS.reviewer,
        exercisedRole: "REVIEWER",
        at: TIMES.sourceReviewed,
      }),
      { actor: ACTORS.reviewer },
      { sequence: 1, state: "UPLOADED" },
    );
    repository.appendTransition(
      makeSourceEvent({
        id: IDS.sourceApproval,
        sequence: 3,
        from: "REVIEWED",
        to: "APPROVED",
        actorId: IDS.approverOne,
        exercisedRole: "APPROVER",
        at: TIMES.sourceApproved,
      }),
      { actor: ACTORS.approverOne },
      { sequence: 2, state: "REVIEWED" },
    );
  }

  return repository;
}

function makeCard(): RuleCard {
  return {
    id: IDS.card,
    sourceId: IDS.source,
    sourceVersionId: IDS.sourceVersion,
    sourceSection: "synthetic-section-1",
    validationScope: "TECHNICAL_DEMO",
  };
}

function makeRevision(
  riskLevel: RiskLevel = "LOW",
  overrides: Partial<RuleCardRevisionHashInput> = {},
): RuleCardRevision {
  const input: RuleCardRevisionHashInput = {
    id: IDS.revisionOne,
    cardId: IDS.card,
    revision: 1,
    sourceId: IDS.source,
    sourceVersionId: IDS.sourceVersion,
    sourceContentHash: SOURCE_CONTENT_HASH,
    sourceSection: "synthetic-section-1",
    normativeActor: "Synthetic document operator",
    object: "Synthetic record label",
    scope: "Public technical demonstration only",
    normativeKey: "synthetic.record.label",
    deonticCategory: "OBLIGATION",
    exceptions: [],
    evidenceRequirements: [
      {
        id: IDS.evidence,
        key: "syntheticEvidence",
        description: "Synthetic visible marker",
        rationale: "Provides deterministic technical evidence",
        sourceReference: "synthetic-section-1",
      },
    ],
    riskLevel,
    riskRationale: "Synthetic intrinsic impact",
    falsePositiveCost: "LOW",
    falsePositiveCostRationale: "Synthetic reversible review cost",
    falseNegativeCost: "LOW",
    falseNegativeCostRationale: "Synthetic reversible omission cost",
    provenance: "MANUAL",
    provider: null,
    validity: { validFrom: TIMES.validFrom, validTo: TIMES.validTo },
    createdAt: TIMES.cardCreated,
    createdBy: IDS.author,
    replacesRevisionId: null,
    revisionReason: null,
    ...overrides,
  };

  return { ...input, contentHash: computeRuleCardRevisionHash(input) };
}

function makeCardTransition(
  revision: RuleCardRevision,
  overrides: Partial<RuleCardTransitionEvent> = {},
): RuleCardTransitionEvent {
  return {
    id: IDS.draft,
    revisionId: revision.id,
    sequence: 1,
    from: null,
    to: "DRAFT",
    actorId: IDS.author,
    exercisedRole: "AUTHOR",
    at: revision.createdAt,
    revisionContentHash: revision.contentHash,
    reason: null,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

function makeReview(
  revision: RuleCardRevision,
  overrides: Partial<RuleCardReviewDecision> = {},
): RuleCardReviewDecision {
  return {
    id: IDS.review,
    revisionId: revision.id,
    sequence: 3,
    actorId: IDS.reviewer,
    exercisedRole: "REVIEWER",
    at: TIMES.cardReviewed,
    revisionContentHash: revision.contentHash,
    decision: "ACCEPTED",
    rationale: "Independent synthetic review accepted",
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

function makeApproval(
  revision: RuleCardRevision,
  overrides: Partial<RuleCardApprovalDecision> = {},
): RuleCardApprovalDecision {
  return {
    id: IDS.approvalOne,
    revisionId: revision.id,
    sequence: 4,
    actorId: IDS.approverOne,
    exercisedRole: "APPROVER",
    at: TIMES.cardApprovedOne,
    revisionContentHash: revision.contentHash,
    decision: "APPROVED",
    rationale: "Independent synthetic approval",
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

function createDraft(
  sourceRepository: InMemoryComplianceSourceRepository,
  riskLevel: RiskLevel = "LOW",
): {
  readonly cards: InMemoryRuleCardRepository;
  readonly card: RuleCard;
  readonly revision: RuleCardRevision;
} {
  const cards = new InMemoryRuleCardRepository(sourceRepository);
  const card = cards.addCard(makeCard());
  const revision = makeRevision(riskLevel);
  cards.appendRevision(revision, makeCardTransition(revision), ACTORS.author, 0);
  return { cards, card, revision };
}

function submitAndReview(cards: InMemoryRuleCardRepository, revision: RuleCardRevision): void {
  cards.submitForReview(
    makeCardTransition(revision, {
      id: IDS.submit,
      sequence: 2,
      from: "DRAFT",
      to: "IN_REVIEW",
      at: TIMES.cardSubmitted,
    }),
    ACTORS.author,
    { sequence: 1 },
  );
  cards.recordReview(makeReview(revision), ACTORS.reviewer, { sequence: 2 });
}

function approveLowRiskWorkflow(): {
  readonly sources: InMemoryComplianceSourceRepository;
  readonly cards: InMemoryRuleCardRepository;
  readonly card: RuleCard;
  readonly revision: RuleCardRevision;
} {
  const sources = makeSourceRepository();
  const { cards, card, revision } = createDraft(sources);
  submitAndReview(cards, revision);
  cards.recordApproval(makeApproval(revision), ACTORS.approverOne, { sequence: 3 });
  return { sources, cards, card, revision };
}

describe("Rule Card workflow integration", () => {
  it("runs approved source through an independent LOW-risk review into draft rule generation", () => {
    const { sources, cards, revision } = approveLowRiskWorkflow();

    expect(sources.getVersionState(IDS.sourceVersion)).toBe("APPROVED");
    expect(cards.getRevisionState(revision.id)).toBe("APPROVED");
    expect(
      cards.assertEligibleForRuleGeneration({
        revisionId: revision.id,
        generationAt: TIMES.generation,
        evaluationDate: TIMES.evaluation,
        expectedRevisionContentHash: revision.contentHash,
        expectedSourceContentHash: SOURCE_CONTENT_HASH,
        targetState: "DRAFT",
      }),
    ).toEqual({
      targetState: "DRAFT",
      cardId: IDS.card,
      cardRevisionId: revision.id,
      revisionContentHash: revision.contentHash,
      sourceId: IDS.source,
      sourceVersionId: IDS.sourceVersion,
      sourceContentHash: SOURCE_CONTENT_HASH,
      generationAt: TIMES.generation,
      evaluationDate: TIMES.evaluation,
      validationScope: "TECHNICAL_DEMO",
    });
  });

  it("keeps a HIGH-risk revision in review until two distinct approvers form quorum", () => {
    const sources = makeSourceRepository();
    const { cards, revision } = createDraft(sources, "HIGH");
    submitAndReview(cards, revision);

    cards.recordApproval(makeApproval(revision), ACTORS.approverOne, { sequence: 3 });
    expect(cards.getRevisionState(revision.id)).toBe("IN_REVIEW");
    expect(() =>
      cards.assertEligibleForRuleGeneration({
        revisionId: revision.id,
        generationAt: TIMES.generation,
        evaluationDate: TIMES.evaluation,
        expectedRevisionContentHash: revision.contentHash,
        expectedSourceContentHash: SOURCE_CONTENT_HASH,
        targetState: "DRAFT",
      }),
    ).toThrow(expect.objectContaining({ code: "APPROVAL_QUORUM_NOT_MET" }));

    cards.recordApproval(
      makeApproval(revision, {
        id: IDS.approvalTwo,
        sequence: 5,
        actorId: IDS.approverTwo,
        at: TIMES.cardApprovedTwo,
      }),
      ACTORS.approverTwo,
      { sequence: 4 },
    );

    expect(cards.getRevisionState(revision.id)).toBe("APPROVED");
    expect(cards.getHistory(IDS.card).revisions.at(0)?.requiredApprovals).toBe(2);
  });

  it("blocks review or generation when the source is not currently approved", () => {
    const nonApprovedSource = makeSourceRepository("UPLOADED");
    const { cards: pendingCards, revision: pendingRevision } = createDraft(nonApprovedSource);

    expect(() =>
      pendingCards.submitForReview(
        makeCardTransition(pendingRevision, {
          id: IDS.submit,
          sequence: 2,
          from: "DRAFT",
          to: "IN_REVIEW",
          at: TIMES.cardSubmitted,
        }),
        ACTORS.author,
        { sequence: 1 },
      ),
    ).toThrow(expect.objectContaining({ code: "SOURCE_VERSION_NOT_APPROVED" }));

    const { sources, cards, revision } = approveLowRiskWorkflow();
    sources.appendTransition(
      makeSourceEvent({
        id: IDS.sourceRetirement,
        sequence: 4,
        from: "APPROVED",
        to: "RETIRED",
        actorId: IDS.approverTwo,
        exercisedRole: "APPROVER",
        at: TIMES.sourceRetired,
        reason: "Synthetic source replacement",
      }),
      { actor: ACTORS.approverTwo, reason: "Synthetic source replacement" },
      { sequence: 3, state: "APPROVED" },
    );

    expect(() =>
      cards.assertEligibleForRuleGeneration({
        revisionId: revision.id,
        generationAt: TIMES.generation,
        evaluationDate: TIMES.evaluation,
        expectedRevisionContentHash: revision.contentHash,
        expectedSourceContentHash: SOURCE_CONTENT_HASH,
        targetState: "DRAFT",
      }),
    ).toThrow(expect.objectContaining({ code: "SOURCE_VERSION_NOT_APPROVED" }));
    expect(() =>
      cards.assertEligibleForRuleGeneration({
        revisionId: revision.id,
        generationAt: TIMES.sourceRetired,
        evaluationDate: TIMES.sourceRetired,
        expectedRevisionContentHash: revision.contentHash,
        expectedSourceContentHash: SOURCE_CONTENT_HASH,
        targetState: "DRAFT",
      }),
    ).toThrow(expect.objectContaining({ code: "SOURCE_VERSION_NOT_APPROVED" }));
  });

  it("returns immutable revision and audit history snapshots", () => {
    const { cards, revision } = approveLowRiskWorkflow();
    const exposedHistory = cards.getHistory(IDS.card);
    const exposedRevision = exposedHistory.revisions.at(0);
    if (exposedRevision === undefined) throw new Error("Expected the synthetic revision history");

    exposedRevision.revision.object = "Mutated external object";
    const exposedAudit = exposedRevision.audit.at(0);
    if (exposedAudit === undefined) throw new Error("Expected the synthetic audit history");
    exposedAudit.record.revisionContentHash = "f".repeat(64);

    expect(cards.getRevision(revision.id).object).toBe("Synthetic record label");
    expect(cards.getAudit(revision.id).at(0)?.record.revisionContentHash).toBe(
      revision.contentHash,
    );
    expect(cards.getRevisionState(revision.id)).toBe("APPROVED");
  });

  it("rejects stale concurrent revision and audit writers", () => {
    const sources = makeSourceRepository();
    const { cards, revision } = createDraft(sources);
    const secondRevision = makeRevision("LOW", {
      id: IDS.revisionTwo,
      revision: 2,
      createdAt: TIMES.cardSubmitted,
      replacesRevisionId: revision.id,
      revisionReason: "Synthetic concurrent edit",
    });

    expect(() =>
      cards.appendRevision(
        secondRevision,
        makeCardTransition(secondRevision, { id: IDS.secondDraft }),
        ACTORS.author,
        0,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_CARD_REVISION_CONFLICT" }));

    const commentOne: RuleCardComment = {
      id: IDS.commentOne,
      revisionId: revision.id,
      sequence: 2,
      actorId: IDS.author,
      exercisedRole: "AUTHOR",
      at: TIMES.cardSubmitted,
      revisionContentHash: revision.contentHash,
      body: "First synthetic concurrent comment",
      validationScope: "TECHNICAL_DEMO",
    };
    const commentTwo: RuleCardComment = {
      ...commentOne,
      id: IDS.commentTwo,
      body: "Second synthetic concurrent comment",
    };
    cards.appendComment(commentOne, ACTORS.author, { sequence: 1 });

    expect(() => cards.appendComment(commentTwo, ACTORS.author, { sequence: 1 })).toThrow(
      expect.objectContaining({ code: "AUDIT_SEQUENCE_CONFLICT" }),
    );
  });

  it("rejects an active generation target even for an approved revision", () => {
    const { cards, revision } = approveLowRiskWorkflow();

    expect(() =>
      cards.assertEligibleForRuleGeneration({
        revisionId: revision.id,
        generationAt: TIMES.generation,
        evaluationDate: TIMES.evaluation,
        expectedRevisionContentHash: revision.contentHash,
        expectedSourceContentHash: SOURCE_CONTENT_HASH,
        targetState: "ACTIVE",
      } as unknown as RuleGenerationEligibilityRequest),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_GENERATION_REQUEST" }));
  });
});
