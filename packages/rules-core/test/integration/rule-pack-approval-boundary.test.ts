import { describe, expect, it } from "vitest";
import {
  ACTIVATION_EVENT_SCHEMA_VERSION,
  ActivationEventSchema,
  computeActivationEventHash,
} from "@vera/contracts";
import type {
  ActivationEvent,
  ActivationEventHashInput,
  RuleCardRevision,
  RulePackVersion,
  UtcDateTime,
} from "@vera/contracts";

import { InMemoryComplianceSourceRepository } from "../../src/compliance-source-repository.js";
import { InMemoryRuleCardRepository } from "../../src/rule-card-repository.js";
import { InMemoryRulePackActivationLedger } from "../../src/rule-pack-activation.js";
import {
  InMemoryRulePackRepository,
  RepositoryBackedRulePackEligibilityReader,
} from "../../src/rule-pack-repository.js";
import {
  ACTORS,
  IDS,
  TIMES,
  makeEvent,
  makeSource,
  makeVersion,
} from "../fixtures/compliance-source.js";
import {
  RULE_CARD_ACTORS,
  RULE_CARD_IDS,
  RULE_CARD_TIMES,
  makeRuleCard,
  makeRuleCardApprovalDecision,
  makeRuleCardReviewDecision,
  makeRuleCardRevision,
  makeRuleCardTransition,
} from "../fixtures/rule-card.js";
import {
  RULE_PACK_ACTORS,
  RULE_PACK_IDS,
  RULE_PACK_TIMES,
  makeDraft,
  makeRule,
} from "../fixtures/rule-pack.js";

const ROLLBACK_IDS = {
  revision2Draft: "00000000-0000-4000-8000-000000000801",
  revision2Submit: "00000000-0000-4000-8000-000000000802",
  revision2Review: "00000000-0000-4000-8000-000000000803",
  revision2Approval: "00000000-0000-4000-8000-000000000804",
  activation1: "00000000-0000-4000-8000-000000000805",
  activation2: "00000000-0000-4000-8000-000000000806",
  rollback: "00000000-0000-4000-8000-000000000807",
  revision1Retirement: "00000000-0000-4000-8000-000000000808",
} as const;

const ROLLBACK_TIMES = {
  revision2Created: "2026-02-12T00:00:00.000Z",
  revision2Draft: "2026-02-12T00:01:00.000Z",
  revision2Submitted: "2026-02-12T00:02:00.000Z",
  revision2Reviewed: "2026-02-12T00:03:00.000Z",
  revision2Approved: "2026-02-12T00:04:00.000Z",
  activation1Recorded: "2026-02-20T00:00:00.000Z",
  activation1Effective: "2026-03-01T00:00:00.000Z",
  activation2Recorded: "2026-05-20T00:00:00.000Z",
  activation2Effective: "2026-06-01T00:00:00.000Z",
  revision1Retired: "2026-08-01T00:00:00.000Z",
  rollbackRecorded: "2026-08-20T00:00:00.000Z",
  rollbackEffective: "2026-09-01T00:00:00.000Z",
} as const;

interface ApprovedWorkflow {
  readonly sources: InMemoryComplianceSourceRepository;
  readonly cards: InMemoryRuleCardRepository;
}

function approvedWorkflow(): ApprovedWorkflow {
  const sources = new InMemoryComplianceSourceRepository();
  sources.addSource(makeSource());
  sources.appendVersion(makeVersion(), 0);
  sources.appendTransition(makeEvent(), { actor: ACTORS.author }, { sequence: 0, state: null });
  sources.appendTransition(
    makeEvent({
      id: IDS.event2,
      sequence: 2,
      from: "UPLOADED",
      to: "REVIEWED",
      actorId: IDS.reviewer,
      exercisedRole: "REVIEWER",
      at: TIMES.reviewed,
    }),
    { actor: ACTORS.reviewer },
    { sequence: 1, state: "UPLOADED" },
  );
  sources.appendTransition(
    makeEvent({
      id: IDS.event3,
      sequence: 3,
      from: "REVIEWED",
      to: "APPROVED",
      actorId: IDS.approver,
      exercisedRole: "APPROVER",
      at: TIMES.approved,
    }),
    { actor: ACTORS.approver },
    { sequence: 2, state: "REVIEWED" },
  );

  const cards = new InMemoryRuleCardRepository(sources);
  cards.addCard(makeRuleCard());
  const revision = makeRuleCardRevision();
  cards.appendRevision(revision, makeRuleCardTransition(revision), RULE_CARD_ACTORS.author, 0);
  cards.submitForReview(
    makeRuleCardTransition(revision, {
      id: RULE_CARD_IDS.audit3,
      sequence: 2,
      from: "DRAFT",
      to: "IN_REVIEW",
      at: RULE_CARD_TIMES.submitted,
    }),
    RULE_CARD_ACTORS.author,
    { sequence: 1 },
  );
  cards.recordReview(makeRuleCardReviewDecision(revision), RULE_CARD_ACTORS.reviewer, {
    sequence: 2,
  });
  cards.recordApproval(makeRuleCardApprovalDecision(revision), RULE_CARD_ACTORS.approver, {
    sequence: 3,
  });
  return { sources, cards };
}

function packRepository(workflow: ApprovedWorkflow): InMemoryRulePackRepository {
  return new InMemoryRulePackRepository(
    new RepositoryBackedRulePackEligibilityReader(workflow.sources, workflow.cards),
  );
}

function publish(
  repository: InMemoryRulePackRepository,
  publishedAt: UtcDateTime = RULE_PACK_TIMES.published1,
): RulePackVersion {
  repository.addDraft(makeDraft(), RULE_PACK_ACTORS.author);
  return repository.publishDraft(
    {
      draftId: RULE_PACK_IDS.draft1,
      versionId: RULE_PACK_IDS.version1,
      publishedAt,
      expectedDraftRevision: 1,
    },
    RULE_PACK_ACTORS.publisher,
  );
}

function approveSecondRevision(workflow: ApprovedWorkflow): RuleCardRevision {
  const revision = makeRuleCardRevision({
    id: RULE_CARD_IDS.revision2,
    revision: 2,
    createdAt: ROLLBACK_TIMES.revision2Created,
    replacesRevisionId: RULE_CARD_IDS.revision1,
    revisionReason: "Second approved synthetic interpretation",
  });
  workflow.cards.appendRevision(
    revision,
    makeRuleCardTransition(revision, {
      id: ROLLBACK_IDS.revision2Draft,
      at: ROLLBACK_TIMES.revision2Draft,
    }),
    RULE_CARD_ACTORS.author,
    1,
  );
  workflow.cards.submitForReview(
    makeRuleCardTransition(revision, {
      id: ROLLBACK_IDS.revision2Submit,
      sequence: 2,
      from: "DRAFT",
      to: "IN_REVIEW",
      at: ROLLBACK_TIMES.revision2Submitted,
    }),
    RULE_CARD_ACTORS.author,
    { sequence: 1 },
  );
  workflow.cards.recordReview(
    makeRuleCardReviewDecision(revision, {
      id: ROLLBACK_IDS.revision2Review,
      sequence: 3,
      at: ROLLBACK_TIMES.revision2Reviewed,
    }),
    RULE_CARD_ACTORS.reviewer,
    { sequence: 2 },
  );
  workflow.cards.recordApproval(
    makeRuleCardApprovalDecision(revision, {
      id: ROLLBACK_IDS.revision2Approval,
      sequence: 4,
      at: ROLLBACK_TIMES.revision2Approved,
    }),
    RULE_CARD_ACTORS.approver,
    { sequence: 3 },
  );
  return revision;
}

function publishSecond(
  repository: InMemoryRulePackRepository,
  revision: RuleCardRevision,
): RulePackVersion {
  const rule = makeRule(RULE_PACK_IDS.rule2, {
    ruleCardRevisionId: revision.id,
    ruleCardRevisionContentHash: revision.contentHash,
  });
  repository.addDraft(
    makeDraft({
      id: RULE_PACK_IDS.draft2,
      semver: "1.1.0",
      rules: [rule],
      supersedesVersionId: RULE_PACK_IDS.version1,
      createdAt: RULE_PACK_TIMES.cloned,
      createdBy: RULE_PACK_ACTORS.otherAuthor.id,
      updatedAt: RULE_PACK_TIMES.cloned,
      updatedBy: RULE_PACK_ACTORS.otherAuthor.id,
      changeReason: "Second synthetic Rule Pack bound to Rule Card revision two",
    }),
    RULE_PACK_ACTORS.otherAuthor,
  );
  return repository.publishDraft(
    {
      draftId: RULE_PACK_IDS.draft2,
      versionId: RULE_PACK_IDS.version2,
      publishedAt: RULE_PACK_TIMES.published2,
      expectedDraftRevision: 1,
    },
    RULE_PACK_ACTORS.publisher,
  );
}

function activationEvent(
  version: RulePackVersion,
  overrides: Partial<ActivationEventHashInput> = {},
): ActivationEvent {
  const input: ActivationEventHashInput = {
    schemaVersion: ACTIVATION_EVENT_SCHEMA_VERSION,
    id: ROLLBACK_IDS.activation1,
    packId: version.packId,
    sequence: 1,
    type: "ACTIVATE",
    versionId: version.id,
    versionContentHash: version.contentHash,
    expectedPreviousVersionId: null,
    effectiveAt: ROLLBACK_TIMES.activation1Effective,
    recordedAt: ROLLBACK_TIMES.activation1Recorded,
    actorId: ACTORS.secondApprover.id,
    exercisedRole: "APPROVER",
    reason: "Activate the first synthetic version",
    previousEventHash: null,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
  return ActivationEventSchema.parse({
    ...input,
    contentHash: computeActivationEventHash(input),
  });
}

function appendActivation(
  ledger: InMemoryRulePackActivationLedger,
  event: ActivationEvent,
  expected: {
    readonly sequence: number;
    readonly previousEventHash: string | null;
    readonly activeVersionId: string | null;
  },
): ActivationEvent {
  return ledger.appendEvent(event, { actor: ACTORS.secondApprover, expected });
}

function twoVersionWorkflow(): {
  readonly workflow: ApprovedWorkflow;
  readonly repository: InMemoryRulePackRepository;
  readonly first: RulePackVersion;
  readonly second: RulePackVersion;
} {
  const workflow = approvedWorkflow();
  const repository = packRepository(workflow);
  const first = publish(repository);
  const secondRevision = approveSecondRevision(workflow);
  const second = publishSecond(repository, secondRevision);
  return { workflow, repository, first, second };
}

describe("Rule Pack authoritative approval boundary", () => {
  it("publishes and revalidates a pack against real append-only source and card workflows", () => {
    const workflow = approvedWorkflow();
    const repository = packRepository(workflow);
    const version = publish(repository);

    expect(version.rules[0]).toMatchObject({
      sourceVersionId: IDS.versionA1,
      ruleCardRevisionId: RULE_CARD_IDS.revision1,
    });
    expect(
      repository.assertVersionEligibleForActivation(
        version.id,
        RULE_PACK_TIMES.packValidFrom,
        IDS.secondApprover,
      ).contentHash,
    ).toBe(version.contentHash);
  });

  it("rolls back through the real ledger to an exact approved non-latest Rule Card revision", () => {
    const { repository, first, second } = twoVersionWorkflow();
    const ledger = new InMemoryRulePackActivationLedger(repository);
    const firstActivation = activationEvent(first);
    appendActivation(ledger, firstActivation, {
      sequence: 0,
      previousEventHash: null,
      activeVersionId: null,
    });
    const secondActivation = activationEvent(second, {
      id: ROLLBACK_IDS.activation2,
      sequence: 2,
      versionId: second.id,
      versionContentHash: second.contentHash,
      expectedPreviousVersionId: first.id,
      effectiveAt: ROLLBACK_TIMES.activation2Effective,
      recordedAt: ROLLBACK_TIMES.activation2Recorded,
      reason: "Activate the second synthetic version",
      previousEventHash: firstActivation.contentHash,
    });
    appendActivation(ledger, secondActivation, {
      sequence: 1,
      previousEventHash: firstActivation.contentHash,
      activeVersionId: first.id,
    });
    const rollback = activationEvent(first, {
      id: ROLLBACK_IDS.rollback,
      sequence: 3,
      type: "ROLLBACK",
      expectedPreviousVersionId: second.id,
      effectiveAt: ROLLBACK_TIMES.rollbackEffective,
      recordedAt: ROLLBACK_TIMES.rollbackRecorded,
      reason: "Rollback to the first approved immutable version",
      previousEventHash: secondActivation.contentHash,
    });

    expect(
      appendActivation(ledger, rollback, {
        sequence: 2,
        previousEventHash: secondActivation.contentHash,
        activeVersionId: second.id,
      }).type,
    ).toBe("ROLLBACK");
    expect(ledger.getHistory(first.packId).map(({ versionId }) => versionId)).toEqual([
      first.id,
      second.id,
      first.id,
    ]);
  });

  it("blocks a real rollback when the exact historical Rule Card revision is no longer approved", () => {
    const { workflow, repository, first, second } = twoVersionWorkflow();
    const ledger = new InMemoryRulePackActivationLedger(repository);
    const firstActivation = activationEvent(first);
    appendActivation(ledger, firstActivation, {
      sequence: 0,
      previousEventHash: null,
      activeVersionId: null,
    });
    const secondActivation = activationEvent(second, {
      id: ROLLBACK_IDS.activation2,
      sequence: 2,
      versionId: second.id,
      versionContentHash: second.contentHash,
      expectedPreviousVersionId: first.id,
      effectiveAt: ROLLBACK_TIMES.activation2Effective,
      recordedAt: ROLLBACK_TIMES.activation2Recorded,
      reason: "Activate the second synthetic version",
      previousEventHash: firstActivation.contentHash,
    });
    appendActivation(ledger, secondActivation, {
      sequence: 1,
      previousEventHash: firstActivation.contentHash,
      activeVersionId: first.id,
    });

    const revisionOne = workflow.cards.getRevision(RULE_CARD_IDS.revision1);
    workflow.cards.retireRevision(
      makeRuleCardTransition(revisionOne, {
        id: ROLLBACK_IDS.revision1Retirement,
        sequence: 5,
        from: "APPROVED",
        to: "RETIRED",
        actorId: IDS.approver,
        exercisedRole: "APPROVER",
        at: ROLLBACK_TIMES.revision1Retired,
        reason: "Retire the exact historical interpretation before rollback",
      }),
      RULE_CARD_ACTORS.approver,
      { sequence: 4 },
    );
    const rollback = activationEvent(first, {
      id: ROLLBACK_IDS.rollback,
      sequence: 3,
      type: "ROLLBACK",
      expectedPreviousVersionId: second.id,
      effectiveAt: ROLLBACK_TIMES.rollbackEffective,
      recordedAt: ROLLBACK_TIMES.rollbackRecorded,
      reason: "Attempt rollback to a retired exact revision",
      previousEventHash: secondActivation.contentHash,
    });

    expect(() =>
      appendActivation(ledger, rollback, {
        sequence: 2,
        previousEventHash: secondActivation.contentHash,
        activeVersionId: second.id,
      }),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_RULE_NOT_ELIGIBLE" }));
    expect(ledger.getHistory(first.packId)).toHaveLength(2);
  });

  it("rejects publication when a bound Rule Card has not reached APPROVED", () => {
    const workflow = approvedWorkflow();
    const unapprovedCards = new InMemoryRuleCardRepository(workflow.sources);
    unapprovedCards.addCard(makeRuleCard());
    const revision = makeRuleCardRevision();
    unapprovedCards.appendRevision(
      revision,
      makeRuleCardTransition(revision),
      RULE_CARD_ACTORS.author,
      0,
    );
    const repository = packRepository({ sources: workflow.sources, cards: unapprovedCards });

    expect(() => publish(repository)).toThrow(
      expect.objectContaining({ code: "RULE_PACK_RULE_NOT_ELIGIBLE" }),
    );
  });

  it("binds pack domain and jurisdiction to the authoritative ComplianceSource", () => {
    const cases = [
      { domain: "different-synthetic-domain" },
      { jurisdiction: "OTHER-DEMO" },
    ] as const;
    for (const scopeOverride of cases) {
      const workflow = approvedWorkflow();
      const repository = packRepository(workflow);
      repository.addDraft(makeDraft(scopeOverride), RULE_PACK_ACTORS.author);
      expect(() =>
        repository.publishDraft(
          {
            draftId: RULE_PACK_IDS.draft1,
            versionId: RULE_PACK_IDS.version1,
            publishedAt: RULE_PACK_TIMES.published1,
            expectedDraftRevision: 1,
          },
          RULE_PACK_ACTORS.publisher,
        ),
      ).toThrow(expect.objectContaining({ code: "RULE_PACK_SCOPE_MISMATCH" }));
    }
  });

  it("rejects publication and activation after the authoritative source is retired", () => {
    const workflow = approvedWorkflow();
    const repository = packRepository(workflow);
    const version = publish(repository);
    workflow.sources.appendTransition(
      makeEvent({
        id: IDS.event4,
        sequence: 4,
        from: "APPROVED",
        to: "RETIRED",
        actorId: IDS.approver,
        exercisedRole: "APPROVER",
        at: TIMES.retired,
        reason: "Synthetic source retirement",
      }),
      { actor: ACTORS.approver, reason: "Synthetic source retirement" },
      { sequence: 3, state: "APPROVED" },
    );

    expect(() =>
      repository.assertVersionEligibleForActivation(
        version.id,
        "2026-06-30T00:00:00.000Z",
        IDS.secondApprover,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_RULE_NOT_ELIGIBLE" }));

    const laterRepository = packRepository(workflow);
    expect(() => publish(laterRepository, "2026-06-30T00:00:00.000Z")).toThrow(
      expect.objectContaining({ code: "RULE_PACK_RULE_NOT_ELIGIBLE" }),
    );
  });
});
