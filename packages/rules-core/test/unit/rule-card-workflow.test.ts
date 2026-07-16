import { describe, expect, it } from "vitest";

import {
  InMemoryRuleCardRepository,
  RuleCardConflictError,
  RuleCardEligibilityError,
  RuleCardInvariantError,
} from "../../src/index.js";
import { IDS, TIMES } from "../fixtures/compliance-source.js";
import {
  RULE_CARD_ACTORS,
  RULE_CARD_HASHES,
  RULE_CARD_IDS,
  RULE_CARD_TIMES,
  makeRuleCard,
  makeRuleCardApprovalDecision,
  makeRuleCardComment,
  makeRuleCardReviewDecision,
  makeRuleCardRevision,
  makeRuleCardTransition,
  makeRuleGenerationRequest,
  makeSourceReader,
} from "../fixtures/rule-card.js";

interface DraftSetup {
  readonly repository: InMemoryRuleCardRepository;
  readonly revision: ReturnType<typeof makeRuleCardRevision>;
  readonly source: ReturnType<typeof makeSourceReader>;
}

function draft(riskLevel: "LOW" | "HIGH" = "LOW"): DraftSetup {
  const source = makeSourceReader();
  const repository = new InMemoryRuleCardRepository(source.reader);
  repository.addCard(makeRuleCard());
  const revision = makeRuleCardRevision({ riskLevel });
  repository.appendRevision(revision, makeRuleCardTransition(revision), RULE_CARD_ACTORS.author, 0);
  return { repository, revision, source };
}

function submit(
  repository: InMemoryRuleCardRepository,
  revision: ReturnType<typeof makeRuleCardRevision>,
  sequence = 2,
): void {
  repository.submitForReview(
    makeRuleCardTransition(revision, {
      id: RULE_CARD_IDS.audit3,
      sequence,
      from: "DRAFT",
      to: "IN_REVIEW",
      at: RULE_CARD_TIMES.submitted,
    }),
    RULE_CARD_ACTORS.author,
    { sequence: sequence - 1 },
  );
}

function review(
  repository: InMemoryRuleCardRepository,
  revision: ReturnType<typeof makeRuleCardRevision>,
  sequence = 3,
): void {
  repository.recordReview(
    makeRuleCardReviewDecision(revision, { sequence }),
    RULE_CARD_ACTORS.reviewer,
    { sequence: sequence - 1 },
  );
}

function approve(
  repository: InMemoryRuleCardRepository,
  revision: ReturnType<typeof makeRuleCardRevision>,
  sequence = 4,
  second = false,
): void {
  repository.recordApproval(
    makeRuleCardApprovalDecision(revision, {
      id: second ? RULE_CARD_IDS.audit6 : RULE_CARD_IDS.audit5,
      sequence,
      actorId: second ? IDS.secondApprover : IDS.approver,
      at: second ? RULE_CARD_TIMES.secondApproval : RULE_CARD_TIMES.firstApproval,
    }),
    second ? RULE_CARD_ACTORS.secondApprover : RULE_CARD_ACTORS.approver,
    { sequence: sequence - 1 },
  );
}

function approveLow(setup: ReturnType<typeof draft>): void {
  submit(setup.repository, setup.revision);
  review(setup.repository, setup.revision);
  approve(setup.repository, setup.revision);
}

describe("Rule Card unified audit stream", () => {
  it("appends comments without changing state, hash, or quorum", () => {
    const setup = draft();
    const comment = makeRuleCardComment(setup.revision);
    const returned = setup.repository.appendComment(comment, RULE_CARD_ACTORS.author, {
      sequence: 1,
    });
    returned.body = "mutated";

    expect(setup.repository.getRevisionState(setup.revision.id)).toBe("DRAFT");
    expect(setup.repository.getRevision(setup.revision.id).contentHash).toBe(
      setup.revision.contentHash,
    );
    expect(setup.repository.getAudit(setup.revision.id)).toHaveLength(2);
    expect(setup.repository.getAudit(setup.revision.id)[1]?.record).toMatchObject({
      body: "Synthetic audit comment",
      sequence: 2,
    });
  });

  it("rejects stale, duplicate, mismatched, and non-monotonic comments", () => {
    const stale = draft();
    expect(() =>
      stale.repository.appendComment(makeRuleCardComment(stale.revision), RULE_CARD_ACTORS.author, {
        sequence: 0,
      }),
    ).toThrow(expect.objectContaining({ code: "AUDIT_SEQUENCE_CONFLICT" }));

    const duplicate = draft();
    duplicate.repository.appendComment(
      makeRuleCardComment(duplicate.revision),
      RULE_CARD_ACTORS.author,
      { sequence: 1 },
    );
    expect(() =>
      duplicate.repository.appendComment(
        makeRuleCardComment(duplicate.revision, { sequence: 3 }),
        RULE_CARD_ACTORS.author,
        { sequence: 2 },
      ),
    ).toThrow(expect.objectContaining({ code: "AUDIT_RECORD_ALREADY_EXISTS" }));

    const mismatch = draft();
    expect(() =>
      mismatch.repository.appendComment(
        makeRuleCardComment(mismatch.revision),
        RULE_CARD_ACTORS.reviewer,
        { sequence: 1 },
      ),
    ).toThrow(expect.objectContaining({ code: "AUDIT_RECORD_MISMATCH" }));

    const time = draft();
    expect(() =>
      time.repository.appendComment(
        makeRuleCardComment(time.revision, { at: RULE_CARD_TIMES.beforeAudit }),
        RULE_CARD_ACTORS.author,
        { sequence: 1 },
      ),
    ).toThrow(expect.objectContaining({ code: "AUDIT_TIME_NOT_MONOTONIC" }));
  });
});

describe("Rule Card review and approval", () => {
  it("keeps an accepted review in review and approves LOW with one independent approver", () => {
    const setup = draft();
    submit(setup.repository, setup.revision);
    review(setup.repository, setup.revision);

    expect(setup.repository.getRevisionState(setup.revision.id)).toBe("IN_REVIEW");
    approve(setup.repository, setup.revision);
    expect(setup.repository.getRevisionState(setup.revision.id)).toBe("APPROVED");
  });

  it("requires two distinct approvers when any effective-risk component is HIGH", () => {
    const setup = draft("HIGH");
    submit(setup.repository, setup.revision);
    review(setup.repository, setup.revision);
    approve(setup.repository, setup.revision);
    expect(setup.repository.getRevisionState(setup.revision.id)).toBe("IN_REVIEW");

    approve(setup.repository, setup.revision, 5, true);
    expect(setup.repository.getRevisionState(setup.revision.id)).toBe("APPROVED");
    expect(setup.repository.getHistory(RULE_CARD_IDS.card).revisions[0]).toMatchObject({
      requiredApprovals: 2,
      state: "APPROVED",
    });
  });

  it("blocks self-review, duplicate review, and approval without accepted review", () => {
    const self = draft();
    submit(self.repository, self.revision);
    expect(() =>
      self.repository.recordReview(
        makeRuleCardReviewDecision(self.revision, { actorId: IDS.author }),
        RULE_CARD_ACTORS.selfReviewer,
        { sequence: 2 },
      ),
    ).toThrow(expect.objectContaining({ code: "DECISION_NOT_AUTHORIZED" }));

    const duplicate = draft();
    submit(duplicate.repository, duplicate.revision);
    review(duplicate.repository, duplicate.revision);
    expect(() =>
      duplicate.repository.recordReview(
        makeRuleCardReviewDecision(duplicate.revision, {
          id: RULE_CARD_IDS.audit7,
          sequence: 4,
        }),
        RULE_CARD_ACTORS.reviewer,
        { sequence: 3 },
      ),
    ).toThrow(RuleCardConflictError);

    const noReview = draft();
    submit(noReview.repository, noReview.revision);
    expect(() =>
      noReview.repository.recordApproval(
        makeRuleCardApprovalDecision(noReview.revision, { sequence: 3 }),
        RULE_CARD_ACTORS.approver,
        { sequence: 2 },
      ),
    ).toThrow(expect.objectContaining({ code: "REVIEW_ACCEPTANCE_REQUIRED" }));
  });

  it("blocks contributor, reviewer, and duplicate approver identities", () => {
    const contributor = draft("HIGH");
    submit(contributor.repository, contributor.revision);
    review(contributor.repository, contributor.revision);
    expect(() =>
      contributor.repository.recordApproval(
        makeRuleCardApprovalDecision(contributor.revision, { actorId: IDS.author }),
        RULE_CARD_ACTORS.selfApprover,
        { sequence: 3 },
      ),
    ).toThrow(expect.objectContaining({ code: "DECISION_NOT_AUTHORIZED" }));

    const reviewer = draft("HIGH");
    submit(reviewer.repository, reviewer.revision);
    review(reviewer.repository, reviewer.revision);
    expect(() =>
      reviewer.repository.recordApproval(
        makeRuleCardApprovalDecision(reviewer.revision, { actorId: IDS.reviewer }),
        RULE_CARD_ACTORS.reviewerAsApprover,
        { sequence: 3 },
      ),
    ).toThrow(RuleCardInvariantError);

    const repeated = draft("HIGH");
    submit(repeated.repository, repeated.revision);
    review(repeated.repository, repeated.revision);
    approve(repeated.repository, repeated.revision);
    expect(() =>
      repeated.repository.recordApproval(
        makeRuleCardApprovalDecision(repeated.revision, {
          id: RULE_CARD_IDS.audit6,
          sequence: 5,
        }),
        RULE_CARD_ACTORS.approver,
        { sequence: 4 },
      ),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_APPROVAL_DECISION" }));
  });

  it("projects requested changes or an approval rejection as terminal for the revision", () => {
    const changes = draft();
    submit(changes.repository, changes.revision);
    changes.repository.recordReview(
      makeRuleCardReviewDecision(changes.revision, {
        decision: "CHANGES_REQUESTED",
        rationale: "Synthetic clarification required",
      }),
      RULE_CARD_ACTORS.reviewer,
      { sequence: 2 },
    );
    expect(changes.repository.getRevisionState(changes.revision.id)).toBe("CHANGES_REQUESTED");
    expect(() => {
      approve(changes.repository, changes.revision);
    }).toThrow(expect.objectContaining({ code: "DECISION_NOT_ALLOWED" }));

    const rejected = draft();
    submit(rejected.repository, rejected.revision);
    review(rejected.repository, rejected.revision);
    rejected.repository.recordApproval(
      makeRuleCardApprovalDecision(rejected.revision, {
        decision: "REJECTED",
        rationale: "Synthetic approval rejected",
      }),
      RULE_CARD_ACTORS.approver,
      { sequence: 3 },
    );
    expect(rejected.repository.getRevisionState(rejected.revision.id)).toBe("CHANGES_REQUESTED");
  });

  it("rechecks source approval at submit and final approval", () => {
    const submitBlocked = draft();
    submitBlocked.source.setState("REVIEWED");
    expect(() => {
      submit(submitBlocked.repository, submitBlocked.revision);
    }).toThrow(expect.objectContaining({ code: "SOURCE_VERSION_NOT_APPROVED" }));

    const approvalBlocked = draft();
    submit(approvalBlocked.repository, approvalBlocked.revision);
    review(approvalBlocked.repository, approvalBlocked.revision);
    approvalBlocked.source.setState("RETIRED");
    expect(() => {
      approve(approvalBlocked.repository, approvalBlocked.revision);
    }).toThrow(RuleCardEligibilityError);
  });
});

describe("Rule Card retirement, revisions, and generation", () => {
  it("retires an approved revision with an independent approver and reason", () => {
    const setup = draft();
    approveLow(setup);
    setup.repository.retireRevision(
      makeRuleCardTransition(setup.revision, {
        id: RULE_CARD_IDS.audit6,
        sequence: 5,
        from: "APPROVED",
        to: "RETIRED",
        actorId: IDS.secondApprover,
        exercisedRole: "APPROVER",
        at: RULE_CARD_TIMES.retired,
        reason: "Synthetic replacement",
      }),
      RULE_CARD_ACTORS.secondApprover,
      { sequence: 4 },
    );
    expect(setup.repository.getRevisionState(setup.revision.id)).toBe("RETIRED");
  });

  it("blocks replacement in review but permits an approved revision to have a successor", () => {
    const inReview = draft();
    submit(inReview.repository, inReview.revision);
    const next = makeRuleCardRevision({
      id: RULE_CARD_IDS.revision2,
      revision: 2,
      createdAt: RULE_CARD_TIMES.revision2Created,
      replacesRevisionId: RULE_CARD_IDS.revision1,
      revisionReason: "Synthetic update",
    });
    expect(() =>
      inReview.repository.appendRevision(
        next,
        makeRuleCardTransition(next, {
          id: RULE_CARD_IDS.audit7,
          at: RULE_CARD_TIMES.revision2Draft,
        }),
        RULE_CARD_ACTORS.author,
        1,
      ),
    ).toThrow(expect.objectContaining({ code: "DECISION_NOT_ALLOWED" }));

    const approved = draft();
    approveLow(approved);
    expect(
      approved.repository.appendRevision(
        next,
        makeRuleCardTransition(next, {
          id: RULE_CARD_IDS.audit7,
          at: RULE_CARD_TIMES.revision2Draft,
        }),
        RULE_CARD_ACTORS.author,
        1,
      ),
    ).toEqual(next);
    expect(approved.repository.getRevisionState(approved.revision.id)).toBe("APPROVED");
  });

  it("returns only a pinned DRAFT generation reference and blocks invalid requests", () => {
    const setup = draft();
    approveLow(setup);
    expect(
      setup.repository.assertEligibleForRuleGeneration(makeRuleGenerationRequest(setup.revision)),
    ).toMatchObject({
      targetState: "DRAFT",
      cardRevisionId: setup.revision.id,
      revisionContentHash: setup.revision.contentHash,
      sourceContentHash: setup.revision.sourceContentHash,
      validationScope: "TECHNICAL_DEMO",
    });

    expect(() =>
      setup.repository.assertEligibleForRuleGeneration(
        makeRuleGenerationRequest(setup.revision, { targetState: "ACTIVE" }),
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_GENERATION_REQUEST" }));
    expect(() =>
      setup.repository.assertEligibleForRuleGeneration(
        makeRuleGenerationRequest(setup.revision, {
          expectedRevisionContentHash: RULE_CARD_HASHES.otherRevision,
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_CARD_CONTENT_HASH_MISMATCH" }));
    expect(() =>
      setup.repository.assertEligibleForRuleGeneration(
        makeRuleGenerationRequest(setup.revision, {
          expectedSourceContentHash: RULE_CARD_HASHES.otherSource,
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "SOURCE_VERSION_MISMATCH" }));
    expect(() =>
      setup.repository.assertEligibleForRuleGeneration(
        makeRuleGenerationRequest(setup.revision, { evaluationDate: TIMES.beforeValidity }),
      ),
    ).toThrow(expect.objectContaining({ code: "BLOCKING_DECISION_PRESENT" }));
  });

  it("blocks generation for a draft or a source retired after card approval", () => {
    const unapproved = draft();
    expect(() =>
      unapproved.repository.assertEligibleForRuleGeneration(
        makeRuleGenerationRequest(unapproved.revision),
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_CARD_REVISION_NOT_APPROVED" }));

    const retiredSource = draft();
    approveLow(retiredSource);
    retiredSource.source.setState("RETIRED");
    expect(() =>
      retiredSource.repository.assertEligibleForRuleGeneration(
        makeRuleGenerationRequest(retiredSource.revision),
      ),
    ).toThrow(expect.objectContaining({ code: "SOURCE_VERSION_NOT_APPROVED" }));
  });
});
