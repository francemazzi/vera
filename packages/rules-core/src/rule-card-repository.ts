import {
  RuleCardActivationEligibilityRequestSchema,
  RuleCardApprovalDecisionSchema,
  RuleCardCommentSchema,
  RuleGenerationEligibilityRequestSchema,
  RuleCardReviewDecisionSchema,
  RuleCardRevisionSchema,
  RuleCardSchema,
  RuleCardTransitionEventSchema,
  compareUtcDateTimes,
  effectiveRisk,
  isWithinValidityInterval,
  parseActorSnapshot,
  validityIntervalsOverlap,
} from "@vera/contracts";
import { types as nodeUtilTypes } from "node:util";
import type {
  Actor,
  ComplianceSource,
  ComplianceSourceState,
  ComplianceSourceVersion,
  RuleCard,
  RuleCardActivationEligibilityRequest as RuleCardActivationEligibilityRequestContract,
  RuleCardApprovalDecision,
  RuleCardComment,
  RuleDraftGenerationReference as RuleDraftGenerationReferenceContract,
  RuleGenerationEligibilityRequest as RuleGenerationEligibilityRequestContract,
  RuleCardReviewDecision,
  RuleCardRevision,
  RuleCardState,
  RuleCardTransitionEvent,
  UtcDateTime,
} from "@vera/contracts";

import {
  RuleCardConflictError,
  RuleCardEligibilityError,
  RuleCardInvariantError,
  RuleCardNotFoundError,
  RuleCardValidationError,
} from "./rule-card-errors.js";

export interface RuleCardSourceReader {
  getSource(sourceId: string): ComplianceSource;
  getVersion(versionId: string): ComplianceSourceVersion;
  getVersionState(versionId: string): ComplianceSourceState | null;
  getVersionStateAt(versionId: string, at: UtcDateTime): ComplianceSourceState | null;
}

export interface RuleCardAuditExpectation {
  readonly sequence: number;
}

interface RuleCardAuditLike {
  readonly id: string;
  readonly revisionId: string;
  readonly sequence: number;
  readonly actorId: string;
  readonly at: string;
  readonly revisionContentHash: string;
  readonly exercisedRole: string;
}

export type RuleGenerationEligibilityRequest = RuleGenerationEligibilityRequestContract;
export type RuleDraftGenerationReference = RuleDraftGenerationReferenceContract;
export type RuleCardActivationEligibilityRequest = RuleCardActivationEligibilityRequestContract;

export type RuleCardAuditRecord =
  | { readonly kind: "TRANSITION"; readonly record: RuleCardTransitionEvent }
  | { readonly kind: "COMMENT"; readonly record: RuleCardComment }
  | { readonly kind: "REVIEW"; readonly record: RuleCardReviewDecision }
  | { readonly kind: "APPROVAL"; readonly record: RuleCardApprovalDecision };

export interface RuleCardRevisionSnapshot {
  readonly revision: RuleCardRevision;
  readonly state: RuleCardState;
  readonly requiredApprovals: 1 | 2;
  readonly audit: readonly RuleCardAuditRecord[];
}

export interface RuleCardHistory {
  readonly card: RuleCard;
  readonly revisions: readonly RuleCardRevisionSnapshot[];
}

const RULE_CARD_ACTIVATION_REQUEST_KEYS = Object.freeze([
  "revisionId",
  "activationAt",
  "evaluationDate",
  "expectedRevisionContentHash",
  "expectedSourceContentHash",
] as const);
const RULE_CARD_ACTIVATION_REQUEST_KEY_SET: ReadonlySet<PropertyKey> = new Set(
  RULE_CARD_ACTIVATION_REQUEST_KEYS,
);

function snapshotRuleCardActivationRequest(
  input: unknown,
): Readonly<Record<string, string>> | null {
  if (input === null || typeof input !== "object" || nodeUtilTypes.isProxy(input)) return null;
  const prototype = Object.getPrototypeOf(input) as object | null;
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(input);
  if (
    ownKeys.length !== RULE_CARD_ACTIVATION_REQUEST_KEYS.length ||
    ownKeys.some((key) => !RULE_CARD_ACTIVATION_REQUEST_KEY_SET.has(key))
  ) {
    return null;
  }

  const snapshot: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of RULE_CARD_ACTIVATION_REQUEST_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable ||
      typeof descriptor.value !== "string" ||
      descriptor.value.length > 4_096
    ) {
      return null;
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function approvalRequirement(revision: RuleCardRevision): 1 | 2 {
  const risk = effectiveRisk([
    revision.riskLevel,
    revision.falsePositiveCost,
    revision.falseNegativeCost,
  ]);
  return risk === "HIGH" || risk === "CRITICAL" ? 2 : 1;
}

export class InMemoryRuleCardRepository {
  readonly #sourceReader: RuleCardSourceReader;
  readonly #cards = new Map<string, RuleCard>();
  readonly #revisions = new Map<string, RuleCardRevision>();
  readonly #revisionIdsByCard = new Map<string, string[]>();
  readonly #auditByRevision = new Map<string, RuleCardAuditRecord[]>();
  readonly #auditIds = new Set<string>();

  public constructor(sourceReader: RuleCardSourceReader) {
    this.#sourceReader = sourceReader;
  }

  public addCard(card: RuleCard): RuleCard {
    const parsed = RuleCardSchema.safeParse(card);
    if (!parsed.success) {
      throw new RuleCardValidationError(
        "INVALID_RULE_CARD_PAYLOAD",
        "Rule Card payload does not satisfy the strict public contract",
        { issueCount: parsed.error.issues.length },
      );
    }
    const validCard = parsed.data;
    if (this.#cards.has(validCard.id)) {
      throw new RuleCardConflictError(
        "RULE_CARD_ALREADY_EXISTS",
        `Rule Card ${validCard.id} already exists`,
        { cardId: validCard.id },
      );
    }

    this.#assertCardSourceExists(validCard);
    const stored = clone(validCard);
    this.#cards.set(stored.id, stored);
    this.#revisionIdsByCard.set(stored.id, []);
    return clone(stored);
  }

  public appendRevision(
    revision: RuleCardRevision,
    creationEvent: RuleCardTransitionEvent,
    actor: Actor,
    expectedCurrentRevision: number,
  ): RuleCardRevision {
    const parsedRevision = RuleCardRevisionSchema.safeParse(revision);
    if (!parsedRevision.success) {
      throw new RuleCardValidationError(
        "INVALID_RULE_CARD_REVISION_PAYLOAD",
        "Rule Card revision does not satisfy its canonical public contract",
        { issueCount: parsedRevision.error.issues.length },
      );
    }
    const parsedEvent = RuleCardTransitionEventSchema.safeParse(creationEvent);
    if (!parsedEvent.success) {
      throw new RuleCardValidationError(
        "INVALID_RULE_CARD_TRANSITION_PAYLOAD",
        "Rule Card creation event does not satisfy its public contract",
        { issueCount: parsedEvent.error.issues.length },
      );
    }
    const validActor = this.#parseActor(actor);
    const validRevision = parsedRevision.data;
    const validEvent = parsedEvent.data;
    const card = this.#requireCard(validRevision.cardId);
    const revisionIds = this.#revisionIdsByCard.get(card.id);
    if (revisionIds === undefined) {
      throw new RuleCardNotFoundError(
        "RULE_CARD_NOT_FOUND",
        `Rule Card ${card.id} does not exist`,
        {
          cardId: card.id,
        },
      );
    }

    if (this.#revisions.has(validRevision.id)) {
      throw new RuleCardConflictError(
        "RULE_CARD_REVISION_ALREADY_EXISTS",
        `Rule Card revision ${validRevision.id} already exists`,
        { revisionId: validRevision.id },
      );
    }
    if (expectedCurrentRevision !== revisionIds.length) {
      throw new RuleCardConflictError(
        "RULE_CARD_REVISION_CONFLICT",
        "The Rule Card revision expectation is stale",
        {
          actualRevision: revisionIds.length,
          expectedRevision: expectedCurrentRevision,
          cardId: card.id,
        },
      );
    }
    if (validRevision.revision !== revisionIds.length + 1) {
      throw new RuleCardInvariantError(
        "RULE_CARD_REVISION_NOT_MONOTONIC",
        "Rule Card revisions must increase by exactly one",
        { cardId: card.id, revision: validRevision.revision },
      );
    }

    const predecessorId = revisionIds.at(-1) ?? null;
    if (validRevision.replacesRevisionId !== predecessorId) {
      throw new RuleCardInvariantError(
        "INVALID_RULE_CARD_REVISION_REPLACEMENT",
        "A revision must replace the immediately preceding Rule Card revision",
        {
          expectedPredecessorId: predecessorId,
          replacesRevisionId: validRevision.replacesRevisionId,
          revisionId: validRevision.id,
        },
      );
    }
    if (predecessorId !== null) {
      const predecessorState = this.getRevisionState(predecessorId);
      if (
        predecessorState !== "DRAFT" &&
        predecessorState !== "CHANGES_REQUESTED" &&
        predecessorState !== "APPROVED"
      ) {
        throw new RuleCardInvariantError(
          "DECISION_NOT_ALLOWED",
          "Only a draft, changes-requested, or approved revision can have a successor",
          { predecessorId, predecessorState },
        );
      }

      const predecessorAudit = this.#requireAudit(predecessorId);
      const predecessorAt = predecessorAudit.at(-1)?.record.at;
      if (
        predecessorAt !== undefined &&
        compareUtcDateTimes(validRevision.createdAt, predecessorAt) < 0
      ) {
        throw new RuleCardInvariantError(
          "AUDIT_TIME_NOT_MONOTONIC",
          "A replacement revision cannot predate its predecessor audit history",
          {
            at: validRevision.createdAt,
            predecessorAt,
            predecessorId,
            revisionId: validRevision.id,
          },
        );
      }
    }

    this.#assertRevisionBinding(card, validRevision, null);
    if (
      validActor.role !== "AUTHOR" ||
      validActor.id !== validRevision.createdBy ||
      validEvent.revisionId !== validRevision.id ||
      validEvent.sequence !== 1 ||
      validEvent.from !== null ||
      validEvent.to !== "DRAFT" ||
      validEvent.actorId !== validActor.id ||
      validEvent.exercisedRole !== validActor.role ||
      validEvent.revisionContentHash !== validRevision.contentHash ||
      compareUtcDateTimes(validEvent.at, validRevision.createdAt) < 0
    ) {
      throw new RuleCardInvariantError(
        "RULE_CARD_TRANSITION_NOT_AUTHORIZED",
        "The creation event must be bound to the author and immutable revision",
        { revisionId: validRevision.id },
      );
    }
    this.#assertNewAuditId(validEvent.id);

    const storedRevision = clone(validRevision);
    const storedEvent = clone(validEvent);
    this.#revisions.set(storedRevision.id, storedRevision);
    revisionIds.push(storedRevision.id);
    this.#auditByRevision.set(storedRevision.id, [{ kind: "TRANSITION", record: storedEvent }]);
    this.#auditIds.add(storedEvent.id);
    return clone(storedRevision);
  }

  public appendComment(
    comment: RuleCardComment,
    actor: Actor,
    expected: RuleCardAuditExpectation,
  ): RuleCardComment {
    const parsed = RuleCardCommentSchema.safeParse(comment);
    if (!parsed.success) {
      throw new RuleCardValidationError(
        "INVALID_RULE_CARD_COMMENT_PAYLOAD",
        "Rule Card comment does not satisfy its public contract",
        { issueCount: parsed.error.issues.length },
      );
    }
    const validActor = this.#parseActor(actor);
    const validComment = parsed.data;
    const audit = this.#prepareAudit(validComment, validActor, expected);
    audit.push({ kind: "COMMENT", record: clone(validComment) });
    this.#auditIds.add(validComment.id);
    return clone(validComment);
  }

  public submitForReview(
    transition: RuleCardTransitionEvent,
    actor: Actor,
    expected: RuleCardAuditExpectation,
  ): RuleCardTransitionEvent {
    const parsed = RuleCardTransitionEventSchema.safeParse(transition);
    if (!parsed.success) {
      throw new RuleCardValidationError(
        "INVALID_RULE_CARD_TRANSITION_PAYLOAD",
        "Rule Card review transition does not satisfy its public contract",
        { issueCount: parsed.error.issues.length },
      );
    }
    const validActor = this.#parseActor(actor);
    const event = parsed.data;
    const revision = this.#requireRevision(event.revisionId);
    const audit = this.#prepareAudit(event, validActor, expected);
    if (
      this.#projectState(revision, audit) !== "DRAFT" ||
      event.from !== "DRAFT" ||
      event.to !== "IN_REVIEW" ||
      validActor.role !== "AUTHOR" ||
      validActor.id !== revision.createdBy
    ) {
      throw new RuleCardInvariantError(
        "RULE_CARD_TRANSITION_NOT_AUTHORIZED",
        "Only the revision author can submit the current draft for review",
        { revisionId: revision.id },
      );
    }
    this.#assertLatestRevision(revision);
    this.#assertRevisionBinding(this.#requireCard(revision.cardId), revision, event.at);
    audit.push({ kind: "TRANSITION", record: clone(event) });
    this.#auditIds.add(event.id);
    return clone(event);
  }

  public recordReview(
    decision: RuleCardReviewDecision,
    actor: Actor,
    expected: RuleCardAuditExpectation,
  ): RuleCardReviewDecision {
    const parsed = RuleCardReviewDecisionSchema.safeParse(decision);
    if (!parsed.success) {
      throw new RuleCardValidationError(
        "INVALID_REVIEW_DECISION_PAYLOAD",
        "Rule Card review decision does not satisfy its public contract",
        { issueCount: parsed.error.issues.length },
      );
    }
    const validActor = this.#parseActor(actor);
    const validDecision = parsed.data;
    const revision = this.#requireRevision(validDecision.revisionId);
    const audit = this.#prepareAudit(validDecision, validActor, expected);
    if (this.#projectState(revision, audit) !== "IN_REVIEW") {
      throw new RuleCardInvariantError(
        "DECISION_NOT_ALLOWED",
        "Review decisions require an in-review revision",
        { revisionId: revision.id },
      );
    }
    if (validActor.role !== "REVIEWER" || validActor.id === revision.createdBy) {
      throw new RuleCardInvariantError(
        "DECISION_NOT_AUTHORIZED",
        "A contributor cannot review their own Rule Card revision",
        { actorId: validActor.id, revisionId: revision.id },
      );
    }
    if (audit.some(({ kind }) => kind === "REVIEW")) {
      throw new RuleCardConflictError(
        "DUPLICATE_REVIEW_DECISION",
        "A review decision is already recorded for this revision",
        { revisionId: revision.id },
      );
    }
    audit.push({ kind: "REVIEW", record: clone(validDecision) });
    this.#auditIds.add(validDecision.id);
    return clone(validDecision);
  }

  public recordApproval(
    decision: RuleCardApprovalDecision,
    actor: Actor,
    expected: RuleCardAuditExpectation,
  ): RuleCardApprovalDecision {
    const parsed = RuleCardApprovalDecisionSchema.safeParse(decision);
    if (!parsed.success) {
      throw new RuleCardValidationError(
        "INVALID_APPROVAL_DECISION_PAYLOAD",
        "Rule Card approval decision does not satisfy its public contract",
        { issueCount: parsed.error.issues.length },
      );
    }
    const validActor = this.#parseActor(actor);
    const validDecision = parsed.data;
    const revision = this.#requireRevision(validDecision.revisionId);
    const audit = this.#prepareAudit(validDecision, validActor, expected);
    if (this.#projectState(revision, audit) !== "IN_REVIEW") {
      throw new RuleCardInvariantError(
        "DECISION_NOT_ALLOWED",
        "Approval decisions require an in-review revision",
        { revisionId: revision.id },
      );
    }
    const review = audit.find(({ kind }) => kind === "REVIEW");
    if (review?.kind !== "REVIEW" || review.record.decision !== "ACCEPTED") {
      throw new RuleCardEligibilityError(
        "REVIEW_ACCEPTANCE_REQUIRED",
        "An accepted independent review is required before approval",
        { revisionId: revision.id },
      );
    }
    if (
      validActor.role !== "APPROVER" ||
      validActor.id === revision.createdBy ||
      validActor.id === review.record.actorId
    ) {
      throw new RuleCardInvariantError(
        "DECISION_NOT_AUTHORIZED",
        "An approver must be distinct from contributors and the reviewer",
        { actorId: validActor.id, revisionId: revision.id },
      );
    }
    if (
      audit.some((entry) => entry.kind === "APPROVAL" && entry.record.actorId === validActor.id)
    ) {
      throw new RuleCardConflictError(
        "DUPLICATE_APPROVAL_DECISION",
        "The same identity cannot approve a revision twice",
        { actorId: validActor.id, revisionId: revision.id },
      );
    }
    this.#assertRevisionBinding(this.#requireCard(revision.cardId), revision, validDecision.at);
    audit.push({ kind: "APPROVAL", record: clone(validDecision) });
    this.#auditIds.add(validDecision.id);
    return clone(validDecision);
  }

  public retireRevision(
    transition: RuleCardTransitionEvent,
    actor: Actor,
    expected: RuleCardAuditExpectation,
  ): RuleCardTransitionEvent {
    const parsed = RuleCardTransitionEventSchema.safeParse(transition);
    if (!parsed.success) {
      throw new RuleCardValidationError(
        "INVALID_RULE_CARD_TRANSITION_PAYLOAD",
        "Rule Card retirement event does not satisfy its public contract",
        { issueCount: parsed.error.issues.length },
      );
    }
    const validActor = this.#parseActor(actor);
    const event = parsed.data;
    const revision = this.#requireRevision(event.revisionId);
    const audit = this.#prepareAudit(event, validActor, expected);
    const reviewerIds = audit
      .filter((entry) => entry.kind === "REVIEW")
      .map((entry) => entry.record.actorId);
    if (
      this.#projectState(revision, audit) !== "APPROVED" ||
      event.from !== "APPROVED" ||
      event.to !== "RETIRED" ||
      event.reason === null ||
      validActor.role !== "APPROVER" ||
      validActor.id === revision.createdBy ||
      reviewerIds.includes(validActor.id)
    ) {
      throw new RuleCardInvariantError(
        "RULE_CARD_TRANSITION_NOT_AUTHORIZED",
        "Retirement requires an independent approver and a reason",
        { actorId: validActor.id, revisionId: revision.id },
      );
    }
    audit.push({ kind: "TRANSITION", record: clone(event) });
    this.#auditIds.add(event.id);
    return clone(event);
  }

  public getCard(cardId: string): RuleCard {
    return clone(this.#requireCard(cardId));
  }

  public getRevision(revisionId: string): RuleCardRevision {
    return clone(this.#requireRevision(revisionId));
  }

  public getRevisionState(revisionId: string): RuleCardState {
    const revision = this.#requireRevision(revisionId);
    return this.#projectState(revision, this.#requireAudit(revisionId));
  }

  public getAudit(revisionId: string): readonly RuleCardAuditRecord[] {
    this.#requireRevision(revisionId);
    return clone(this.#requireAudit(revisionId));
  }

  public getHistory(cardId: string): RuleCardHistory {
    const card = this.getCard(cardId);
    const ids = this.#revisionIdsByCard.get(cardId);
    if (ids === undefined) {
      throw new RuleCardNotFoundError("RULE_CARD_NOT_FOUND", `Rule Card ${cardId} does not exist`, {
        cardId,
      });
    }
    return {
      card,
      revisions: ids.map((id) => {
        const revision = this.getRevision(id);
        return {
          revision,
          state: this.getRevisionState(id),
          requiredApprovals: approvalRequirement(revision),
          audit: this.getAudit(id),
        };
      }),
    };
  }

  public assertEligibleForRuleGeneration(
    request: RuleGenerationEligibilityRequest,
  ): RuleDraftGenerationReference {
    const parsed = RuleGenerationEligibilityRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new RuleCardValidationError(
        "INVALID_RULE_GENERATION_REQUEST",
        "Rule generation accepts only a strict, hash-pinned DRAFT request",
        { issueCount: parsed.error.issues.length },
      );
    }
    const validRequest = parsed.data;
    const revision = this.#assertApprovedRevisionEligibility({
      revisionId: validRequest.revisionId,
      eligibilityAt: validRequest.generationAt,
      evaluationDate: validRequest.evaluationDate,
      expectedRevisionContentHash: validRequest.expectedRevisionContentHash,
      expectedSourceContentHash: validRequest.expectedSourceContentHash,
      requireLatest: true,
    });

    return {
      targetState: "DRAFT",
      cardId: revision.cardId,
      cardRevisionId: revision.id,
      revisionContentHash: revision.contentHash,
      sourceId: revision.sourceId,
      sourceVersionId: revision.sourceVersionId,
      sourceContentHash: revision.sourceContentHash,
      generationAt: validRequest.generationAt,
      evaluationDate: validRequest.evaluationDate,
      validationScope: "TECHNICAL_DEMO",
    };
  }

  /** Revalidates one immutable, hash-pinned revision without requiring it to remain latest. */
  public assertRevisionEligibleForActivation(
    request: RuleCardActivationEligibilityRequest,
  ): RuleCardRevision {
    const snapshot = snapshotRuleCardActivationRequest(request);
    const parsed = RuleCardActivationEligibilityRequestSchema.safeParse(snapshot);
    if (!parsed.success) {
      throw new RuleCardValidationError(
        "INVALID_RULE_CARD_ACTIVATION_REQUEST",
        "Rule Pack activation requires a strict, hash-pinned Rule Card revision request",
        { issueCount: parsed.error.issues.length },
      );
    }
    const validRequest = parsed.data;
    return clone(
      this.#assertApprovedRevisionEligibility({
        revisionId: validRequest.revisionId,
        eligibilityAt: validRequest.activationAt,
        evaluationDate: validRequest.evaluationDate,
        expectedRevisionContentHash: validRequest.expectedRevisionContentHash,
        expectedSourceContentHash: validRequest.expectedSourceContentHash,
        requireLatest: false,
      }),
    );
  }

  #assertApprovedRevisionEligibility(request: {
    readonly revisionId: string;
    readonly eligibilityAt: UtcDateTime;
    readonly evaluationDate: UtcDateTime;
    readonly expectedRevisionContentHash: string;
    readonly expectedSourceContentHash: string;
    readonly requireLatest: boolean;
  }): RuleCardRevision {
    const revision = this.#requireRevision(request.revisionId);
    if (request.requireLatest) this.#assertLatestRevision(revision);
    if (revision.contentHash !== request.expectedRevisionContentHash) {
      throw new RuleCardEligibilityError(
        "RULE_CARD_CONTENT_HASH_MISMATCH",
        "The Rule Card revision hash differs from the eligibility request",
        { revisionId: revision.id },
      );
    }
    const state = this.getRevisionState(revision.id);
    if (state !== "APPROVED") {
      const audit = this.#requireAudit(revision.id);
      const acceptedReview = audit.some(
        (entry) => entry.kind === "REVIEW" && entry.record.decision === "ACCEPTED",
      );
      const grantedApprovals = audit.filter(
        (entry) => entry.kind === "APPROVAL" && entry.record.decision === "APPROVED",
      ).length;

      if (state === "CHANGES_REQUESTED") {
        throw new RuleCardEligibilityError(
          "BLOCKING_DECISION_PRESENT",
          "A blocking review or approval decision prevents revision eligibility",
          { revisionId: revision.id },
        );
      }
      if (state === "IN_REVIEW" && !acceptedReview) {
        throw new RuleCardEligibilityError(
          "REVIEW_ACCEPTANCE_REQUIRED",
          "An accepted independent review is required for revision eligibility",
          { revisionId: revision.id },
        );
      }
      if (state === "IN_REVIEW" && grantedApprovals < approvalRequirement(revision)) {
        throw new RuleCardEligibilityError(
          "APPROVAL_QUORUM_NOT_MET",
          "The Rule Card approval quorum has not been reached",
          {
            grantedApprovals,
            requiredApprovals: approvalRequirement(revision),
            revisionId: revision.id,
          },
        );
      }
      throw new RuleCardEligibilityError(
        "RULE_CARD_REVISION_NOT_APPROVED",
        "Only an approved Rule Card revision is eligible",
        { revisionId: revision.id },
      );
    }
    const approval = this.#requireAudit(revision.id)
      .filter((entry) => entry.kind === "APPROVAL" && entry.record.decision === "APPROVED")
      .at(approvalRequirement(revision) - 1);
    if (
      approval?.kind !== "APPROVAL" ||
      compareUtcDateTimes(request.eligibilityAt, approval.record.at) < 0
    ) {
      throw new RuleCardEligibilityError(
        "RULE_CARD_REVISION_NOT_APPROVED",
        "The Rule Card was not approved at the declared eligibility instant",
        { at: request.eligibilityAt, revisionId: revision.id },
      );
    }
    const { sourceVersion } = this.#assertRevisionBinding(
      this.#requireCard(revision.cardId),
      revision,
      request.eligibilityAt,
    );
    if (sourceVersion.contentHash !== request.expectedSourceContentHash) {
      throw new RuleCardEligibilityError(
        "SOURCE_VERSION_MISMATCH",
        "The source hash differs from the eligibility request",
        { sourceVersionId: sourceVersion.id },
      );
    }
    if (
      !isWithinValidityInterval(revision.validity, request.evaluationDate) ||
      !isWithinValidityInterval(sourceVersion.validity, request.evaluationDate)
    ) {
      throw new RuleCardEligibilityError(
        "BLOCKING_DECISION_PRESENT",
        "The Rule Card or source is outside its validity interval",
        { revisionId: revision.id },
      );
    }
    return revision;
  }

  #parseActor(actor: Actor): Actor {
    const parsed = parseActorSnapshot(actor);
    if (parsed === null) {
      throw new RuleCardInvariantError(
        "DECISION_NOT_AUTHORIZED",
        "Workflow actor does not satisfy the public identity contract",
      );
    }
    return parsed;
  }

  #prepareAudit(
    record: RuleCardAuditLike,
    actor: Actor,
    expected: RuleCardAuditExpectation,
  ): RuleCardAuditRecord[] {
    const revision = this.#requireRevision(record.revisionId);
    const audit = this.#requireAudit(record.revisionId);
    const currentSequence = audit.at(-1)?.record.sequence ?? 0;
    if (expected.sequence !== currentSequence || record.sequence !== currentSequence + 1) {
      throw new RuleCardConflictError(
        "AUDIT_SEQUENCE_CONFLICT",
        "The Rule Card audit sequence expectation is stale or non-contiguous",
        {
          actualSequence: currentSequence,
          expectedSequence: expected.sequence,
          recordSequence: record.sequence,
          revisionId: revision.id,
        },
      );
    }
    this.#assertNewAuditId(record.id);
    const previousAt = audit.at(-1)?.record.at ?? revision.createdAt;
    if (
      record.actorId !== actor.id ||
      record.exercisedRole !== actor.role ||
      record.revisionContentHash !== revision.contentHash
    ) {
      throw new RuleCardInvariantError(
        "AUDIT_RECORD_MISMATCH",
        "Audit identity, exercised role, or revision hash does not match",
        { revisionId: revision.id },
      );
    }
    if (compareUtcDateTimes(record.at, previousAt) < 0) {
      throw new RuleCardInvariantError(
        "AUDIT_TIME_NOT_MONOTONIC",
        "Rule Card audit timestamps must be monotonic",
        { revisionId: revision.id },
      );
    }
    return audit;
  }

  #projectState(revision: RuleCardRevision, audit: readonly RuleCardAuditRecord[]): RuleCardState {
    let state: RuleCardState = "DRAFT";
    let approvals = 0;

    for (const entry of audit) {
      if (entry.kind === "TRANSITION") state = entry.record.to;
      if (entry.kind === "REVIEW" && entry.record.decision === "CHANGES_REQUESTED") {
        state = "CHANGES_REQUESTED";
      }
      if (entry.kind === "APPROVAL") {
        if (entry.record.decision === "REJECTED") {
          state = "CHANGES_REQUESTED";
        } else {
          approvals += 1;
          if (approvals >= approvalRequirement(revision)) state = "APPROVED";
        }
      }
    }
    return state;
  }

  #assertCardSourceExists(card: RuleCard): void {
    let source: ComplianceSource;
    let version: ComplianceSourceVersion;
    try {
      source = this.#sourceReader.getSource(card.sourceId);
      version = this.#sourceReader.getVersion(card.sourceVersionId);
    } catch {
      throw new RuleCardInvariantError(
        "SOURCE_VERSION_MISMATCH",
        "Rule Card source or source version does not exist",
        { sourceId: card.sourceId, sourceVersionId: card.sourceVersionId },
      );
    }
    if (source.id !== card.sourceId || version.sourceId !== source.id) {
      throw new RuleCardInvariantError(
        "SOURCE_VERSION_MISMATCH",
        "Rule Card source version belongs to another source",
        { sourceId: card.sourceId, sourceVersionId: card.sourceVersionId },
      );
    }
  }

  #assertRevisionBinding(
    card: RuleCard,
    revision: RuleCardRevision,
    requireApprovedAt: UtcDateTime | null,
  ): { readonly sourceVersion: ComplianceSourceVersion } {
    this.#assertCardSourceExists(card);
    const sourceVersion = this.#sourceReader.getVersion(card.sourceVersionId);
    if (
      revision.sourceId !== card.sourceId ||
      revision.sourceVersionId !== card.sourceVersionId ||
      revision.sourceSection !== card.sourceSection ||
      revision.sourceContentHash !== sourceVersion.contentHash
    ) {
      throw new RuleCardInvariantError(
        "SOURCE_VERSION_MISMATCH",
        "Rule Card revision is not bound to its stable source and hash",
        { revisionId: revision.id, sourceVersionId: sourceVersion.id },
      );
    }
    if (!validityIntervalsOverlap(revision.validity, sourceVersion.validity)) {
      throw new RuleCardInvariantError(
        "SOURCE_VERSION_MISMATCH",
        "Rule Card and source validity intervals do not overlap",
        { revisionId: revision.id, sourceVersionId: sourceVersion.id },
      );
    }
    if (requireApprovedAt !== null) {
      const currentSourceState = this.#sourceReader.getVersionState(sourceVersion.id);
      const sourceStateAt = this.#sourceReader.getVersionStateAt(
        sourceVersion.id,
        requireApprovedAt,
      );
      if (currentSourceState !== "APPROVED" || sourceStateAt !== "APPROVED") {
        throw new RuleCardEligibilityError(
          "SOURCE_VERSION_NOT_APPROVED",
          "The bound source must be currently approved and approved at the workflow instant",
          {
            at: requireApprovedAt,
            currentState: currentSourceState,
            revisionId: revision.id,
            stateAt: sourceStateAt,
            sourceVersionId: sourceVersion.id,
          },
        );
      }
    }
    return { sourceVersion };
  }

  #assertLatestRevision(revision: RuleCardRevision): void {
    const revisionIds = this.#revisionIdsByCard.get(revision.cardId);
    if (revisionIds?.at(-1) !== revision.id) {
      throw new RuleCardEligibilityError(
        "RULE_CARD_REVISION_SUPERSEDED",
        "Only the latest Rule Card revision is eligible for this operation",
        { revisionId: revision.id },
      );
    }
  }

  #assertNewAuditId(id: string): void {
    if (this.#auditIds.has(id)) {
      throw new RuleCardConflictError(
        "AUDIT_RECORD_ALREADY_EXISTS",
        `Rule Card audit record ${id} already exists`,
        { auditId: id },
      );
    }
  }

  #requireCard(cardId: string): RuleCard {
    const card = this.#cards.get(cardId);
    if (card === undefined) {
      throw new RuleCardNotFoundError("RULE_CARD_NOT_FOUND", `Rule Card ${cardId} does not exist`, {
        cardId,
      });
    }
    return card;
  }

  #requireRevision(revisionId: string): RuleCardRevision {
    const revision = this.#revisions.get(revisionId);
    if (revision === undefined) {
      throw new RuleCardNotFoundError(
        "RULE_CARD_REVISION_NOT_FOUND",
        `Rule Card revision ${revisionId} does not exist`,
        { revisionId },
      );
    }
    return revision;
  }

  #requireAudit(revisionId: string): RuleCardAuditRecord[] {
    const audit = this.#auditByRevision.get(revisionId);
    if (audit === undefined) {
      throw new RuleCardNotFoundError(
        "RULE_CARD_REVISION_NOT_FOUND",
        `Rule Card revision ${revisionId} has no audit stream`,
        { revisionId },
      );
    }
    return audit;
  }
}
