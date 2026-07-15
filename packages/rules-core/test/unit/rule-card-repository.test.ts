import { describe, expect, it } from "vitest";

import {
  InMemoryRuleCardRepository,
  RuleCardInvariantError,
  RuleCardNotFoundError,
} from "../../src/index.js";
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
import { HASHES, IDS, TIMES, makeSource, makeVersion } from "../fixtures/compliance-source.js";
import type { RuleCardRevisionHashInput, RuleGenerationEligibilityRequest } from "@vera/contracts";

interface DraftSetup {
  readonly repository: InMemoryRuleCardRepository;
  readonly revision: ReturnType<typeof makeRuleCardRevision>;
  readonly source: ReturnType<typeof makeSourceReader>;
}

function repositoryWithDraft(
  revisionOverrides: Partial<RuleCardRevisionHashInput> = {},
  sourceState: "UPLOADED" | "REVIEWED" | "APPROVED" | "RETIRED" | null = "APPROVED",
): DraftSetup {
  const source = makeSourceReader(sourceState);
  const repository = new InMemoryRuleCardRepository(source.reader);
  repository.addCard(makeRuleCard());
  const revision = makeRuleCardRevision(revisionOverrides);
  repository.appendRevision(revision, makeRuleCardTransition(revision), RULE_CARD_ACTORS.author, 0);
  return { repository, revision, source };
}

function submitForReview(
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

function recordAcceptedReview(
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

function recordApproval(
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

function approveLowRisk(setup: DraftSetup): void {
  submitForReview(setup.repository, setup.revision);
  recordAcceptedReview(setup.repository, setup.revision);
  recordApproval(setup.repository, setup.revision);
}

describe("InMemoryRuleCardRepository cards and revisions", () => {
  it("validates cards at runtime and rejects duplicates", () => {
    const source = makeSourceReader();
    const repository = new InMemoryRuleCardRepository(source.reader);
    const malformed = { ...makeRuleCard(), unexpected: true };

    expect(() => repository.addCard(malformed)).toThrow(
      expect.objectContaining({ code: "INVALID_RULE_CARD_PAYLOAD" }),
    );

    repository.addCard(makeRuleCard());
    expect(() => repository.addCard(makeRuleCard())).toThrow(
      expect.objectContaining({ code: "RULE_CARD_ALREADY_EXISTS" }),
    );
  });

  it("rejects missing or inconsistent source links", () => {
    const missing = makeSourceReader();
    missing.setSource(makeSource({ id: IDS.sourceB }));
    const missingRepository = new InMemoryRuleCardRepository(missing.reader);

    expect(() => missingRepository.addCard(makeRuleCard())).toThrow(
      expect.objectContaining({ code: "SOURCE_VERSION_MISMATCH" }),
    );

    const mismatched = makeSourceReader();
    mismatched.setVersion(makeVersion({ sourceId: IDS.sourceB }));
    const mismatchedRepository = new InMemoryRuleCardRepository(mismatched.reader);
    expect(() => mismatchedRepository.addCard(makeRuleCard())).toThrow(RuleCardInvariantError);
  });

  it("stores and returns defensive copies of cards, revisions, nested values, and audit", () => {
    const source = makeSourceReader();
    const repository = new InMemoryRuleCardRepository(source.reader);
    const card = makeRuleCard();
    const addedCard = repository.addCard(card);
    const revision = makeRuleCardRevision();
    const addedRevision = repository.appendRevision(
      revision,
      makeRuleCardTransition(revision),
      RULE_CARD_ACTORS.author,
      0,
    );

    card.sourceSection = "mutated-input";
    addedCard.sourceSection = "mutated-result";
    repository.getCard(RULE_CARD_IDS.card).sourceSection = "mutated-read";
    const inputRequirement = revision.evidenceRequirements[0];
    if (inputRequirement === undefined) throw new Error("Expected a synthetic requirement");
    inputRequirement.description = "mutated-input";
    addedRevision.validity.validFrom = TIMES.beforeValidity;
    const readException = repository.getRevision(revision.id).exceptions[0];
    if (readException === undefined) throw new Error("Expected a synthetic exception");
    readException.rationale = "mutated-read";

    const audit = repository.getAudit(revision.id);
    const first = audit[0];
    if (first?.kind !== "TRANSITION") throw new Error("Expected a synthetic creation event");
    first.record.reason = "mutated-audit";

    expect(repository.getCard(RULE_CARD_IDS.card).sourceSection).toBe("synthetic-section-1");
    expect(repository.getRevision(revision.id).evidenceRequirements[0]?.description).toBe(
      "A synthetic marker is visible",
    );
    expect(repository.getRevision(revision.id).validity.validFrom).toBe(TIMES.validFrom);
    expect(repository.getRevision(revision.id).exceptions[0]?.rationale).toBe(
      "The source explicitly defines the exclusion",
    );
    expect(repository.getAudit(revision.id)[0]?.record).toMatchObject({ reason: null });
  });

  it("validates revision hashes and creation events at runtime", () => {
    const source = makeSourceReader();
    const repository = new InMemoryRuleCardRepository(source.reader);
    repository.addCard(makeRuleCard());
    const spoofed = makeRuleCardRevision({}, RULE_CARD_HASHES.otherRevision);

    expect(() =>
      repository.appendRevision(
        spoofed,
        makeRuleCardTransition(spoofed),
        RULE_CARD_ACTORS.author,
        0,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_CARD_REVISION_PAYLOAD" }));

    const revision = makeRuleCardRevision();
    const malformedEvent = { ...makeRuleCardTransition(revision), unexpected: true };
    expect(() =>
      repository.appendRevision(revision, malformedEvent, RULE_CARD_ACTORS.author, 0),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_CARD_TRANSITION_PAYLOAD" }));
  });

  it("rejects missing cards and revisions through every public read boundary", () => {
    const source = makeSourceReader();
    const repository = new InMemoryRuleCardRepository(source.reader);
    const revision = makeRuleCardRevision({ cardId: RULE_CARD_IDS.otherCard });

    expect(() =>
      repository.appendRevision(
        revision,
        makeRuleCardTransition(revision),
        RULE_CARD_ACTORS.author,
        0,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_CARD_NOT_FOUND" }));
    expect(() => repository.getCard(RULE_CARD_IDS.otherCard)).toThrow(RuleCardNotFoundError);
    expect(() => repository.getHistory(RULE_CARD_IDS.otherCard)).toThrow(RuleCardNotFoundError);
    expect(() => repository.getRevision(RULE_CARD_IDS.unknownRevision)).toThrow(
      expect.objectContaining({ code: "RULE_CARD_REVISION_NOT_FOUND" }),
    );
    expect(() => repository.getRevisionState(RULE_CARD_IDS.unknownRevision)).toThrow(
      RuleCardNotFoundError,
    );
    expect(() => repository.getAudit(RULE_CARD_IDS.unknownRevision)).toThrow(RuleCardNotFoundError);
  });

  it("separates duplicate IDs, stale concurrency, and non-monotonic revisions", () => {
    const setup = repositoryWithDraft();

    expect(() =>
      setup.repository.appendRevision(
        setup.revision,
        makeRuleCardTransition(setup.revision, { id: RULE_CARD_IDS.audit7 }),
        RULE_CARD_ACTORS.author,
        1,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_CARD_REVISION_ALREADY_EXISTS" }));

    const second = makeRuleCardRevision({
      id: RULE_CARD_IDS.revision2,
      revision: 2,
      createdAt: RULE_CARD_TIMES.revision2Created,
      replacesRevisionId: RULE_CARD_IDS.revision1,
      revisionReason: "Synthetic correction",
    });
    const secondEvent = makeRuleCardTransition(second, {
      id: RULE_CARD_IDS.audit7,
      at: RULE_CARD_TIMES.revision2Draft,
    });

    expect(() =>
      setup.repository.appendRevision(second, secondEvent, RULE_CARD_ACTORS.author, 0),
    ).toThrow(expect.objectContaining({ code: "RULE_CARD_REVISION_CONFLICT" }));

    const thirdNumber = makeRuleCardRevision({
      id: RULE_CARD_IDS.revision2,
      revision: 3,
      createdAt: RULE_CARD_TIMES.revision2Created,
      replacesRevisionId: RULE_CARD_IDS.revision1,
      revisionReason: "Skipped revision number",
    });
    expect(() =>
      setup.repository.appendRevision(
        thirdNumber,
        makeRuleCardTransition(thirdNumber, {
          id: RULE_CARD_IDS.audit7,
          at: RULE_CARD_TIMES.revision2Draft,
        }),
        RULE_CARD_ACTORS.author,
        1,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_CARD_REVISION_NOT_MONOTONIC" }));
  });

  it("requires each revision to replace the immediate predecessor", () => {
    const setup = repositoryWithDraft();
    const detached = makeRuleCardRevision({
      id: RULE_CARD_IDS.revision2,
      revision: 2,
      createdAt: RULE_CARD_TIMES.revision2Created,
      replacesRevisionId: RULE_CARD_IDS.unknownRevision,
      revisionReason: "Detached predecessor",
    });

    expect(() =>
      setup.repository.appendRevision(
        detached,
        makeRuleCardTransition(detached, {
          id: RULE_CARD_IDS.audit7,
          at: RULE_CARD_TIMES.revision2Draft,
        }),
        RULE_CARD_ACTORS.author,
        1,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_CARD_REVISION_REPLACEMENT" }));
  });

  it("rejects a replacement revision that predates its predecessor audit", () => {
    const setup = repositoryWithDraft();
    const regressive = makeRuleCardRevision({
      id: RULE_CARD_IDS.revision2,
      revision: 2,
      createdAt: "2026-02-01T00:00:30.000Z",
      replacesRevisionId: RULE_CARD_IDS.revision1,
      revisionReason: "Regressive synthetic timestamp",
    });

    expect(() =>
      setup.repository.appendRevision(
        regressive,
        makeRuleCardTransition(regressive, {
          id: RULE_CARD_IDS.audit7,
          at: "2026-02-01T00:00:45.000Z",
        }),
        RULE_CARD_ACTORS.author,
        1,
      ),
    ).toThrow(expect.objectContaining({ code: "AUDIT_TIME_NOT_MONOTONIC" }));
  });

  it.each([
    [{ sourceId: IDS.sourceB }, "source ID"],
    [{ sourceVersionId: IDS.versionA2 }, "source version ID"],
    [{ sourceContentHash: RULE_CARD_HASHES.otherSource }, "source hash"],
    [{ sourceSection: "different-section" }, "source section"],
    [
      {
        validity: {
          validFrom: "2028-01-01T00:00:00.000Z",
          validTo: "2029-01-01T00:00:00.000Z",
        },
      },
      "non-overlapping validity",
    ],
  ] as const)("rejects a revision detached from its %s", (override, bindingLabel) => {
    void bindingLabel;
    const source = makeSourceReader();
    const repository = new InMemoryRuleCardRepository(source.reader);
    repository.addCard(makeRuleCard());
    const revision = makeRuleCardRevision(override);

    expect(() =>
      repository.appendRevision(
        revision,
        makeRuleCardTransition(revision),
        RULE_CARD_ACTORS.author,
        0,
      ),
    ).toThrow(expect.objectContaining({ code: "SOURCE_VERSION_MISMATCH" }));
  });

  it("accepts overlapping source and Rule Card validity intervals with open ends", () => {
    const source = makeSourceReader();
    source.setVersion(
      makeVersion({
        validity: { validFrom: TIMES.validFrom, validTo: null },
      }),
    );
    const repository = new InMemoryRuleCardRepository(source.reader);
    repository.addCard(makeRuleCard());
    const revision = makeRuleCardRevision({
      validity: { validFrom: TIMES.validFrom, validTo: null },
    });

    expect(
      repository.appendRevision(
        revision,
        makeRuleCardTransition(revision),
        RULE_CARD_ACTORS.author,
        0,
      ),
    ).toEqual(revision);
  });

  it.each([
    [RULE_CARD_ACTORS.reviewerAsAuthor, {}, "wrong author identity"],
    [RULE_CARD_ACTORS.author, { revisionContentHash: RULE_CARD_HASHES.otherRevision }, "hash"],
    [
      RULE_CARD_ACTORS.author,
      { at: RULE_CARD_TIMES.beforeAudit },
      "timestamp before revision creation",
    ],
    [
      RULE_CARD_ACTORS.author,
      { sequence: 2, from: "DRAFT", to: "IN_REVIEW", id: RULE_CARD_IDS.audit7 },
      "non-creation transition",
    ],
  ] as const)(
    "rejects a creation event with a mismatched %s",
    (workflowActor, eventOverride, mismatchLabel) => {
      void mismatchLabel;
      const source = makeSourceReader();
      const repository = new InMemoryRuleCardRepository(source.reader);
      repository.addCard(makeRuleCard());
      const revision = makeRuleCardRevision();

      expect(() =>
        repository.appendRevision(
          revision,
          makeRuleCardTransition(revision, eventOverride),
          workflowActor,
          0,
        ),
      ).toThrow(expect.objectContaining({ code: "RULE_CARD_TRANSITION_NOT_AUTHORIZED" }));
    },
  );
});

describe("InMemoryRuleCardRepository unified audit", () => {
  it("records comments, transitions, reviews, and approvals in one contiguous stream", () => {
    const setup = repositoryWithDraft();
    setup.repository.appendComment(makeRuleCardComment(setup.revision), RULE_CARD_ACTORS.author, {
      sequence: 1,
    });
    submitForReview(setup.repository, setup.revision, 3);
    recordAcceptedReview(setup.repository, setup.revision, 4);
    recordApproval(setup.repository, setup.revision, 5);

    const audit = setup.repository.getAudit(setup.revision.id);
    expect(audit.map(({ kind }) => kind)).toEqual([
      "TRANSITION",
      "COMMENT",
      "TRANSITION",
      "REVIEW",
      "APPROVAL",
    ]);
    expect(audit.map(({ record }) => record.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(setup.repository.getRevisionState(setup.revision.id)).toBe("APPROVED");
    expect(setup.repository.getHistory(RULE_CARD_IDS.card)).toMatchObject({
      revisions: [{ state: "APPROVED", requiredApprovals: 1 }],
    });
  });

  it("validates every audit payload before accessing domain state", () => {
    const setup = repositoryWithDraft();
    const malformedComment = { ...makeRuleCardComment(setup.revision), unexpected: true };
    const malformedReview = { ...makeRuleCardReviewDecision(setup.revision), unexpected: true };
    const malformedApproval = {
      ...makeRuleCardApprovalDecision(setup.revision),
      unexpected: true,
    };

    expect(() =>
      setup.repository.appendComment(malformedComment, RULE_CARD_ACTORS.author, { sequence: 1 }),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_CARD_COMMENT_PAYLOAD" }));
    expect(() =>
      setup.repository.recordReview(malformedReview, RULE_CARD_ACTORS.reviewer, { sequence: 1 }),
    ).toThrow(expect.objectContaining({ code: "INVALID_REVIEW_DECISION_PAYLOAD" }));
    expect(() =>
      setup.repository.recordApproval(malformedApproval, RULE_CARD_ACTORS.approver, {
        sequence: 1,
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_APPROVAL_DECISION_PAYLOAD" }));
  });

  it.each([
    [{ sequence: 3 }, { sequence: 1 }, "non-contiguous record"],
    [{ sequence: 2 }, { sequence: 0 }, "stale expectation"],
  ] as const)("rejects an audit sequence conflict: %s", (recordOverride, expected, label) => {
    void label;
    const setup = repositoryWithDraft();

    expect(() =>
      setup.repository.appendComment(
        makeRuleCardComment(setup.revision, recordOverride),
        RULE_CARD_ACTORS.author,
        expected,
      ),
    ).toThrow(expect.objectContaining({ code: "AUDIT_SEQUENCE_CONFLICT" }));
  });

  it("rejects audit IDs reused anywhere in the repository", () => {
    const setup = repositoryWithDraft();

    expect(() =>
      setup.repository.appendComment(
        makeRuleCardComment(setup.revision, { id: RULE_CARD_IDS.audit1 }),
        RULE_CARD_ACTORS.author,
        { sequence: 1 },
      ),
    ).toThrow(expect.objectContaining({ code: "AUDIT_RECORD_ALREADY_EXISTS" }));
  });

  it.each([
    [{ actorId: IDS.reviewer }, "identity"],
    [{ exercisedRole: "REVIEWER" as const }, "role"],
    [{ revisionContentHash: RULE_CARD_HASHES.otherRevision }, "revision hash"],
  ] as const)("rejects an audit record with a mismatched %s", (override, label) => {
    void label;
    const setup = repositoryWithDraft();

    expect(() =>
      setup.repository.appendComment(
        makeRuleCardComment(setup.revision, override),
        RULE_CARD_ACTORS.author,
        { sequence: 1 },
      ),
    ).toThrow(expect.objectContaining({ code: "AUDIT_RECORD_MISMATCH" }));
  });

  it("rejects non-monotonic audit time and malformed workflow identities", () => {
    const setup = repositoryWithDraft();

    expect(() =>
      setup.repository.appendComment(
        makeRuleCardComment(setup.revision, { at: RULE_CARD_TIMES.beforeAudit }),
        RULE_CARD_ACTORS.author,
        { sequence: 1 },
      ),
    ).toThrow(expect.objectContaining({ code: "AUDIT_TIME_NOT_MONOTONIC" }));
    expect(() =>
      setup.repository.appendComment(
        makeRuleCardComment(setup.revision),
        RULE_CARD_ACTORS.invalid,
        { sequence: 1 },
      ),
    ).toThrow(expect.objectContaining({ code: "DECISION_NOT_AUTHORIZED" }));
  });
});

describe("InMemoryRuleCardRepository review and approval workflow", () => {
  it("validates submit-for-review transitions at the runtime boundary", () => {
    const setup = repositoryWithDraft();
    const malformed = {
      ...makeRuleCardTransition(setup.revision, {
        id: RULE_CARD_IDS.audit3,
        sequence: 2,
        from: "DRAFT",
        to: "IN_REVIEW",
        at: RULE_CARD_TIMES.submitted,
      }),
      unexpected: true,
    };

    expect(() =>
      setup.repository.submitForReview(malformed, RULE_CARD_ACTORS.author, { sequence: 1 }),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_CARD_TRANSITION_PAYLOAD" }));
  });

  it("requires an approved source and the author to submit the latest draft", () => {
    const unapproved = repositoryWithDraft({}, "REVIEWED");
    expect(() => {
      submitForReview(unapproved.repository, unapproved.revision);
    }).toThrow(expect.objectContaining({ code: "SOURCE_VERSION_NOT_APPROVED" }));

    const wrongAuthor = repositoryWithDraft();
    expect(() =>
      wrongAuthor.repository.submitForReview(
        makeRuleCardTransition(wrongAuthor.revision, {
          id: RULE_CARD_IDS.audit3,
          sequence: 2,
          from: "DRAFT",
          to: "IN_REVIEW",
          actorId: IDS.reviewer,
          at: RULE_CARD_TIMES.submitted,
        }),
        RULE_CARD_ACTORS.reviewerAsAuthor,
        { sequence: 1 },
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_CARD_TRANSITION_NOT_AUTHORIZED" }));

    const superseded = repositoryWithDraft();
    const second = makeRuleCardRevision({
      id: RULE_CARD_IDS.revision2,
      revision: 2,
      createdAt: RULE_CARD_TIMES.revision2Created,
      replacesRevisionId: RULE_CARD_IDS.revision1,
      revisionReason: "Replaced before review",
    });
    superseded.repository.appendRevision(
      second,
      makeRuleCardTransition(second, {
        id: RULE_CARD_IDS.audit7,
        at: RULE_CARD_TIMES.revision2Draft,
      }),
      RULE_CARD_ACTORS.author,
      1,
    );
    expect(() => {
      submitForReview(superseded.repository, superseded.revision);
    }).toThrow(expect.objectContaining({ code: "RULE_CARD_REVISION_SUPERSEDED" }));
  });

  it("requires the source to be approved at the review event timestamp", () => {
    const source = makeSourceReader("APPROVED");
    const repository = new InMemoryRuleCardRepository(source.reader);
    repository.addCard(makeRuleCard());
    const revision = makeRuleCardRevision({ createdAt: "2026-01-01T02:30:00.000Z" });
    repository.appendRevision(
      revision,
      makeRuleCardTransition(revision, { at: "2026-01-01T02:31:00.000Z" }),
      RULE_CARD_ACTORS.author,
      0,
    );

    expect(() =>
      repository.submitForReview(
        makeRuleCardTransition(revision, {
          id: RULE_CARD_IDS.audit3,
          sequence: 2,
          from: "DRAFT",
          to: "IN_REVIEW",
          at: "2026-01-01T02:45:00.000Z",
        }),
        RULE_CARD_ACTORS.author,
        { sequence: 1 },
      ),
    ).toThrow(expect.objectContaining({ code: "SOURCE_VERSION_NOT_APPROVED" }));
  });

  it("allows only one independent review and blocks self-review", () => {
    const draft = repositoryWithDraft();
    expect(() =>
      draft.repository.recordReview(
        makeRuleCardReviewDecision(draft.revision, { sequence: 2 }),
        RULE_CARD_ACTORS.reviewer,
        { sequence: 1 },
      ),
    ).toThrow(expect.objectContaining({ code: "DECISION_NOT_ALLOWED" }));

    const selfReview = repositoryWithDraft();
    submitForReview(selfReview.repository, selfReview.revision);
    expect(() =>
      selfReview.repository.recordReview(
        makeRuleCardReviewDecision(selfReview.revision, { actorId: IDS.author }),
        RULE_CARD_ACTORS.selfReviewer,
        { sequence: 2 },
      ),
    ).toThrow(expect.objectContaining({ code: "DECISION_NOT_AUTHORIZED" }));

    const duplicate = repositoryWithDraft();
    submitForReview(duplicate.repository, duplicate.revision);
    recordAcceptedReview(duplicate.repository, duplicate.revision);
    expect(() =>
      duplicate.repository.recordReview(
        makeRuleCardReviewDecision(duplicate.revision, {
          id: RULE_CARD_IDS.audit6,
          sequence: 4,
          at: RULE_CARD_TIMES.firstApproval,
        }),
        RULE_CARD_ACTORS.reviewer,
        { sequence: 3 },
      ),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_REVIEW_DECISION" }));
  });

  it("projects requested changes and permits a linked corrective revision", () => {
    const setup = repositoryWithDraft();
    submitForReview(setup.repository, setup.revision);
    setup.repository.recordReview(
      makeRuleCardReviewDecision(setup.revision, {
        decision: "CHANGES_REQUESTED",
        rationale: "The synthetic rationale needs clarification",
      }),
      RULE_CARD_ACTORS.reviewer,
      { sequence: 2 },
    );

    expect(setup.repository.getRevisionState(setup.revision.id)).toBe("CHANGES_REQUESTED");
    expect(() =>
      setup.repository.recordApproval(
        makeRuleCardApprovalDecision(setup.revision),
        RULE_CARD_ACTORS.approver,
        { sequence: 3 },
      ),
    ).toThrow(expect.objectContaining({ code: "DECISION_NOT_ALLOWED" }));

    const correction = makeRuleCardRevision({
      id: RULE_CARD_IDS.revision2,
      revision: 2,
      createdAt: RULE_CARD_TIMES.revision2Created,
      replacesRevisionId: RULE_CARD_IDS.revision1,
      revisionReason: "Applied the requested clarification",
    });
    expect(
      setup.repository.appendRevision(
        correction,
        makeRuleCardTransition(correction, {
          id: RULE_CARD_IDS.audit7,
          at: RULE_CARD_TIMES.revision2Draft,
        }),
        RULE_CARD_ACTORS.author,
        1,
      ),
    ).toEqual(correction);
  });

  it("requires an accepted review before approval and forbids self-approval", () => {
    const missingReview = repositoryWithDraft();
    submitForReview(missingReview.repository, missingReview.revision);
    expect(() =>
      missingReview.repository.recordApproval(
        makeRuleCardApprovalDecision(missingReview.revision, { sequence: 3 }),
        RULE_CARD_ACTORS.approver,
        { sequence: 2 },
      ),
    ).toThrow(expect.objectContaining({ code: "REVIEW_ACCEPTANCE_REQUIRED" }));

    const selfApproval = repositoryWithDraft();
    submitForReview(selfApproval.repository, selfApproval.revision);
    recordAcceptedReview(selfApproval.repository, selfApproval.revision);
    expect(() =>
      selfApproval.repository.recordApproval(
        makeRuleCardApprovalDecision(selfApproval.revision, { actorId: IDS.author }),
        RULE_CARD_ACTORS.selfApprover,
        { sequence: 3 },
      ),
    ).toThrow(expect.objectContaining({ code: "DECISION_NOT_AUTHORIZED" }));

    const reviewerApproval = repositoryWithDraft();
    submitForReview(reviewerApproval.repository, reviewerApproval.revision);
    recordAcceptedReview(reviewerApproval.repository, reviewerApproval.revision);
    expect(() =>
      reviewerApproval.repository.recordApproval(
        makeRuleCardApprovalDecision(reviewerApproval.revision, { actorId: IDS.reviewer }),
        RULE_CARD_ACTORS.reviewerAsApprover,
        { sequence: 3 },
      ),
    ).toThrow(expect.objectContaining({ code: "DECISION_NOT_AUTHORIZED" }));
  });

  it("meets LOW quorum with one approver", () => {
    const setup = repositoryWithDraft();
    approveLowRisk(setup);

    expect(setup.repository.getRevisionState(setup.revision.id)).toBe("APPROVED");
    expect(setup.repository.getHistory(RULE_CARD_IDS.card).revisions[0]?.requiredApprovals).toBe(1);
  });

  it("requires two distinct approvals for HIGH effective risk", () => {
    const setup = repositoryWithDraft({ falseNegativeCost: "HIGH" });
    submitForReview(setup.repository, setup.revision);
    recordAcceptedReview(setup.repository, setup.revision);
    recordApproval(setup.repository, setup.revision);

    expect(setup.repository.getRevisionState(setup.revision.id)).toBe("IN_REVIEW");
    expect(setup.repository.getHistory(RULE_CARD_IDS.card).revisions[0]?.requiredApprovals).toBe(2);
    expect(() =>
      setup.repository.assertEligibleForRuleGeneration(makeRuleGenerationRequest(setup.revision)),
    ).toThrow(expect.objectContaining({ code: "APPROVAL_QUORUM_NOT_MET" }));

    recordApproval(setup.repository, setup.revision, 5, true);
    expect(setup.repository.getRevisionState(setup.revision.id)).toBe("APPROVED");
  });

  it("rejects duplicate approvals from the same identity before HIGH quorum", () => {
    const setup = repositoryWithDraft({ riskLevel: "CRITICAL" });
    submitForReview(setup.repository, setup.revision);
    recordAcceptedReview(setup.repository, setup.revision);
    recordApproval(setup.repository, setup.revision);

    expect(() =>
      setup.repository.recordApproval(
        makeRuleCardApprovalDecision(setup.revision, {
          id: RULE_CARD_IDS.audit6,
          sequence: 5,
          at: RULE_CARD_TIMES.secondApproval,
        }),
        RULE_CARD_ACTORS.approver,
        { sequence: 4 },
      ),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_APPROVAL_DECISION" }));
  });

  it("projects an approval rejection as changes requested", () => {
    const setup = repositoryWithDraft();
    submitForReview(setup.repository, setup.revision);
    recordAcceptedReview(setup.repository, setup.revision);
    setup.repository.recordApproval(
      makeRuleCardApprovalDecision(setup.revision, {
        decision: "REJECTED",
        rationale: "The synthetic approval gate found a blocking ambiguity",
      }),
      RULE_CARD_ACTORS.approver,
      { sequence: 3 },
    );

    expect(setup.repository.getRevisionState(setup.revision.id)).toBe("CHANGES_REQUESTED");
  });

  it("retires an approved revision with an independent approver and immutable reason", () => {
    const setup = repositoryWithDraft();
    approveLowRisk(setup);
    const retirement = makeRuleCardTransition(setup.revision, {
      id: RULE_CARD_IDS.audit6,
      sequence: 5,
      from: "APPROVED",
      to: "RETIRED",
      actorId: IDS.approver,
      exercisedRole: "APPROVER",
      at: RULE_CARD_TIMES.retired,
      reason: "Superseded by a future synthetic interpretation",
    });

    expect(
      setup.repository.retireRevision(retirement, RULE_CARD_ACTORS.approver, { sequence: 4 }),
    ).toEqual(retirement);
    expect(setup.repository.getRevisionState(setup.revision.id)).toBe("RETIRED");
  });

  it("rejects retirement before approval, by the reviewer, or without a reason", () => {
    const draft = repositoryWithDraft();
    expect(() =>
      draft.repository.retireRevision(
        makeRuleCardTransition(draft.revision, {
          id: RULE_CARD_IDS.audit6,
          sequence: 2,
          from: "APPROVED",
          to: "RETIRED",
          actorId: IDS.approver,
          exercisedRole: "APPROVER",
          at: RULE_CARD_TIMES.retired,
          reason: "Premature retirement",
        }),
        RULE_CARD_ACTORS.approver,
        { sequence: 1 },
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_CARD_TRANSITION_NOT_AUTHORIZED" }));

    const reviewed = repositoryWithDraft();
    approveLowRisk(reviewed);
    expect(() =>
      reviewed.repository.retireRevision(
        makeRuleCardTransition(reviewed.revision, {
          id: RULE_CARD_IDS.audit6,
          sequence: 5,
          from: "APPROVED",
          to: "RETIRED",
          actorId: IDS.reviewer,
          exercisedRole: "APPROVER",
          at: RULE_CARD_TIMES.retired,
          reason: "Reviewer cannot retire",
        }),
        RULE_CARD_ACTORS.reviewerAsApprover,
        { sequence: 4 },
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_CARD_TRANSITION_NOT_AUTHORIZED" }));

    expect(() =>
      reviewed.repository.retireRevision(
        makeRuleCardTransition(reviewed.revision, {
          id: RULE_CARD_IDS.audit7,
          sequence: 5,
          from: "APPROVED",
          to: "RETIRED",
          actorId: IDS.approver,
          exercisedRole: "APPROVER",
          at: RULE_CARD_TIMES.retired,
          reason: null,
        }),
        RULE_CARD_ACTORS.approver,
        { sequence: 4 },
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_CARD_TRANSITION_PAYLOAD" }));
  });
});

describe("InMemoryRuleCardRepository rule generation guard", () => {
  it("returns a hash-pinned DRAFT reference only for an approved current revision", () => {
    const setup = repositoryWithDraft();
    approveLowRisk(setup);

    expect(
      setup.repository.assertEligibleForRuleGeneration(makeRuleGenerationRequest(setup.revision)),
    ).toEqual({
      targetState: "DRAFT",
      cardId: RULE_CARD_IDS.card,
      cardRevisionId: RULE_CARD_IDS.revision1,
      revisionContentHash: setup.revision.contentHash,
      sourceId: IDS.sourceA,
      sourceVersionId: IDS.versionA1,
      sourceContentHash: HASHES.a1,
      generationAt: RULE_CARD_TIMES.evaluation,
      evaluationDate: RULE_CARD_TIMES.evaluation,
      validationScope: "TECHNICAL_DEMO",
    });
  });

  it("rejects a declared generation instant before the approval quorum", () => {
    const setup = repositoryWithDraft();
    approveLowRisk(setup);

    expect(() =>
      setup.repository.assertEligibleForRuleGeneration(
        makeRuleGenerationRequest(setup.revision, {
          generationAt: RULE_CARD_TIMES.reviewed,
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_CARD_REVISION_NOT_APPROVED" }));
  });

  it.each([
    [{ targetState: "ACTIVE" }, "non-DRAFT target"],
    [{ revisionId: "not-a-uuid" }, "invalid revision ID"],
    [{ expectedRevisionContentHash: "invalid" }, "invalid revision hash"],
    [{ expectedSourceContentHash: "invalid" }, "invalid source hash"],
    [{ generationAt: "not-a-date" }, "invalid generation date"],
    [{ evaluationDate: "not-a-date" }, "invalid evaluation date"],
    [{ unexpected: true }, "unknown field"],
  ] as const)("rejects a malformed generation request: %s", (override, label) => {
    void label;
    const setup = repositoryWithDraft();
    const malformed = { ...makeRuleGenerationRequest(setup.revision), ...override };

    expect(() =>
      setup.repository.assertEligibleForRuleGeneration(
        malformed as unknown as RuleGenerationEligibilityRequest,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_GENERATION_REQUEST" }));
  });

  it("distinguishes missing review, partial quorum, and blocking decisions", () => {
    const missingReview = repositoryWithDraft();
    submitForReview(missingReview.repository, missingReview.revision);
    expect(() =>
      missingReview.repository.assertEligibleForRuleGeneration(
        makeRuleGenerationRequest(missingReview.revision),
      ),
    ).toThrow(expect.objectContaining({ code: "REVIEW_ACCEPTANCE_REQUIRED" }));

    const partial = repositoryWithDraft({ riskLevel: "HIGH" });
    submitForReview(partial.repository, partial.revision);
    recordAcceptedReview(partial.repository, partial.revision);
    recordApproval(partial.repository, partial.revision);
    expect(() =>
      partial.repository.assertEligibleForRuleGeneration(
        makeRuleGenerationRequest(partial.revision),
      ),
    ).toThrow(expect.objectContaining({ code: "APPROVAL_QUORUM_NOT_MET" }));

    const blocked = repositoryWithDraft();
    submitForReview(blocked.repository, blocked.revision);
    blocked.repository.recordReview(
      makeRuleCardReviewDecision(blocked.revision, { decision: "CHANGES_REQUESTED" }),
      RULE_CARD_ACTORS.reviewer,
      { sequence: 2 },
    );
    expect(() =>
      blocked.repository.assertEligibleForRuleGeneration(
        makeRuleGenerationRequest(blocked.revision),
      ),
    ).toThrow(expect.objectContaining({ code: "BLOCKING_DECISION_PRESENT" }));
  });

  it("rejects a draft, a mismatched revision hash, and a mismatched source hash", () => {
    const draft = repositoryWithDraft();
    expect(() =>
      draft.repository.assertEligibleForRuleGeneration(makeRuleGenerationRequest(draft.revision)),
    ).toThrow(expect.objectContaining({ code: "RULE_CARD_REVISION_NOT_APPROVED" }));

    const revisionMismatch = repositoryWithDraft();
    approveLowRisk(revisionMismatch);
    expect(() =>
      revisionMismatch.repository.assertEligibleForRuleGeneration(
        makeRuleGenerationRequest(revisionMismatch.revision, {
          expectedRevisionContentHash: RULE_CARD_HASHES.otherRevision,
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_CARD_CONTENT_HASH_MISMATCH" }));

    const sourceMismatch = repositoryWithDraft();
    approveLowRisk(sourceMismatch);
    expect(() =>
      sourceMismatch.repository.assertEligibleForRuleGeneration(
        makeRuleGenerationRequest(sourceMismatch.revision, {
          expectedSourceContentHash: RULE_CARD_HASHES.otherSource,
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "SOURCE_VERSION_MISMATCH" }));
  });

  it("rechecks source approval and both half-open validity intervals", () => {
    const sourceState = repositoryWithDraft();
    approveLowRisk(sourceState);
    sourceState.source.setState("REVIEWED");
    expect(() =>
      sourceState.repository.assertEligibleForRuleGeneration(
        makeRuleGenerationRequest(sourceState.revision),
      ),
    ).toThrow(expect.objectContaining({ code: "SOURCE_VERSION_NOT_APPROVED" }));

    const outside = repositoryWithDraft();
    approveLowRisk(outside);
    expect(() =>
      outside.repository.assertEligibleForRuleGeneration(
        makeRuleGenerationRequest(outside.revision, { evaluationDate: TIMES.beforeValidity }),
      ),
    ).toThrow(expect.objectContaining({ code: "BLOCKING_DECISION_PRESENT" }));
    expect(() =>
      outside.repository.assertEligibleForRuleGeneration(
        makeRuleGenerationRequest(outside.revision, { evaluationDate: TIMES.validTo }),
      ),
    ).toThrow(expect.objectContaining({ code: "BLOCKING_DECISION_PRESENT" }));

    const expiredSource = repositoryWithDraft();
    approveLowRisk(expiredSource);
    expiredSource.source.setVersion(
      makeVersion({
        validity: {
          validFrom: TIMES.validFrom,
          validTo: "2026-06-01T00:00:00.000Z",
        },
      }),
    );
    expect(() =>
      expiredSource.repository.assertEligibleForRuleGeneration(
        makeRuleGenerationRequest(expiredSource.revision),
      ),
    ).toThrow(expect.objectContaining({ code: "BLOCKING_DECISION_PRESENT" }));
  });

  it("keeps a retired Rule Card terminal and unable to generate rules", () => {
    const setup = repositoryWithDraft();
    approveLowRisk(setup);
    setup.repository.retireRevision(
      makeRuleCardTransition(setup.revision, {
        id: RULE_CARD_IDS.audit6,
        sequence: 5,
        from: "APPROVED",
        to: "RETIRED",
        actorId: IDS.approver,
        exercisedRole: "APPROVER",
        at: RULE_CARD_TIMES.retired,
        reason: "Retiring the synthetic interpretation",
      }),
      RULE_CARD_ACTORS.approver,
      { sequence: 4 },
    );
    const second = makeRuleCardRevision({
      id: RULE_CARD_IDS.revision2,
      revision: 2,
      createdAt: RULE_CARD_TIMES.revision2Created,
      replacesRevisionId: RULE_CARD_IDS.revision1,
      revisionReason: "New synthetic interpretation",
    });
    expect(() =>
      setup.repository.appendRevision(
        second,
        makeRuleCardTransition(second, {
          id: RULE_CARD_IDS.audit7,
          at: RULE_CARD_TIMES.revision2Draft,
        }),
        RULE_CARD_ACTORS.author,
        1,
      ),
    ).toThrow(expect.objectContaining({ code: "DECISION_NOT_ALLOWED" }));

    expect(() =>
      setup.repository.assertEligibleForRuleGeneration(makeRuleGenerationRequest(setup.revision)),
    ).toThrow(expect.objectContaining({ code: "RULE_CARD_REVISION_NOT_APPROVED" }));
  });

  it("blocks generation from a superseded draft revision", () => {
    const setup = repositoryWithDraft();
    const second = makeRuleCardRevision({
      id: RULE_CARD_IDS.revision2,
      revision: 2,
      createdAt: RULE_CARD_TIMES.revision2Created,
      replacesRevisionId: RULE_CARD_IDS.revision1,
      revisionReason: "New synthetic interpretation",
    });
    setup.repository.appendRevision(
      second,
      makeRuleCardTransition(second, {
        id: RULE_CARD_IDS.audit7,
        at: RULE_CARD_TIMES.revision2Draft,
      }),
      RULE_CARD_ACTORS.author,
      1,
    );

    expect(() =>
      setup.repository.assertEligibleForRuleGeneration(makeRuleGenerationRequest(setup.revision)),
    ).toThrow(expect.objectContaining({ code: "RULE_CARD_REVISION_SUPERSEDED" }));
  });
});
