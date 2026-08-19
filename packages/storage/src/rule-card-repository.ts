import {
  RuleCardApprovalDecisionSchema,
  RuleCardCommentSchema,
  RuleCardReviewDecisionSchema,
  RuleCardRevisionSchema,
  RuleCardSchema,
  RuleCardTransitionEventSchema,
  effectiveRisk,
} from "@vera/contracts";
import type {
  Actor,
  RuleCard,
  RuleCardApprovalDecision,
  RuleCardComment,
  RuleCardReviewDecision,
  RuleCardRevision,
  RuleCardState,
  RuleCardTransitionEvent,
} from "@vera/contracts";
import {
  InMemoryRuleCardRepository,
  RuleCardNotFoundError,
  RuleCardValidationError,
  type RuleCardActivationEligibilityRequest,
  type RuleCardAuditExpectation,
  type RuleCardAuditRecord,
  type RuleCardHistory,
  type RuleCardRevisionSnapshot,
  type RuleCardSourceReader,
  type RuleDraftGenerationReference,
  type RuleGenerationEligibilityRequest,
} from "@vera/rules-core";

import type { Prisma } from "./generated/prisma/client.js";
import { parsePayload, toInputJson } from "./payload.js";
import type { VeraPrismaClient } from "./prisma.js";
import { StorageConflictError } from "./repository.js";
import { isUniqueConstraint, runSerializableWithRetries } from "./transaction.js";

type TransactionClient = Prisma.TransactionClient;
type DbClient = VeraPrismaClient | TransactionClient;

function approvalRequirement(revision: RuleCardRevision): 1 | 2 {
  const risk = effectiveRisk([
    revision.riskLevel,
    revision.falsePositiveCost,
    revision.falseNegativeCost,
  ]);
  return risk === "HIGH" || risk === "CRITICAL" ? 2 : 1;
}

function projectState(
  revision: RuleCardRevision,
  audit: readonly RuleCardAuditRecord[],
): RuleCardState {
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

function parseAuditRecord(kind: string, payload: unknown): RuleCardAuditRecord {
  if (kind === "TRANSITION") {
    return { kind, record: parsePayload(RuleCardTransitionEventSchema, payload) };
  }
  if (kind === "COMMENT") {
    return { kind, record: parsePayload(RuleCardCommentSchema, payload) };
  }
  if (kind === "REVIEW") {
    return { kind, record: parsePayload(RuleCardReviewDecisionSchema, payload) };
  }
  if (kind === "APPROVAL") {
    return { kind, record: parsePayload(RuleCardApprovalDecisionSchema, payload) };
  }
  throw new RuleCardValidationError(
    "INVALID_RULE_CARD_TRANSITION_PAYLOAD",
    "Rule Card audit record kind is not recognized",
    { kind },
  );
}

/**
 * Prisma-backed Rule Card repository. Domain mutations run through a hydrated
 * {@link InMemoryRuleCardRepository}; only accepted deltas are persisted.
 */
export class DurableRuleCardRepository {
  readonly #prisma: VeraPrismaClient;
  readonly #sourceReader: RuleCardSourceReader;

  public constructor(prisma: VeraPrismaClient, sourceReader: RuleCardSourceReader) {
    this.#prisma = prisma;
    this.#sourceReader = sourceReader;
  }

  public async addCard(card: RuleCard): Promise<RuleCard> {
    const stored = new InMemoryRuleCardRepository(this.#sourceReader).addCard(card);
    try {
      await this.#prisma.ruleCardRecord.create({
        data: {
          id: stored.id,
          sourceId: stored.sourceId,
          sourceVersionId: stored.sourceVersionId,
          sourceSection: stored.sourceSection,
          validationScope: stored.validationScope,
          payload: toInputJson(stored),
        },
      });
    } catch (error) {
      if (isUniqueConstraint(error)) throw new StorageConflictError("Rule Card already exists");
      throw error;
    }
    return stored;
  }

  public async appendRevision(
    revision: RuleCardRevision,
    creationEvent: RuleCardTransitionEvent,
    actor: Actor,
    expectedCurrentRevision: number,
  ): Promise<RuleCardRevision> {
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        const cardRow = await transaction.ruleCardRecord.findUnique({
          where: { id: revision.cardId },
          select: { id: true },
        });
        if (cardRow === null) {
          return new InMemoryRuleCardRepository(this.#sourceReader).appendRevision(
            revision,
            creationEvent,
            actor,
            expectedCurrentRevision,
          );
        }

        const memory = await this.#hydrateCard(transaction, revision.cardId);
        const stored = memory.appendRevision(
          revision,
          creationEvent,
          actor,
          expectedCurrentRevision,
        );
        await transaction.ruleCardRevisionRecord.create({
          data: {
            id: stored.id,
            cardId: stored.cardId,
            revision: stored.revision,
            contentHash: stored.contentHash,
            payload: toInputJson(stored),
            createdAt: new Date(stored.createdAt),
          },
        });
        const created = memory.getAudit(stored.id)[0];
        if (created === undefined) {
          throw new RuleCardValidationError(
            "INVALID_RULE_CARD_TRANSITION_PAYLOAD",
            "Rule Card creation event was not recorded in audit history",
            { revisionId: stored.id },
          );
        }
        await this.#insertAudit(transaction, created);
        return stored;
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError("Rule Card revision or audit record already exists");
      }
      throw error;
    }
  }

  public async appendComment(
    comment: RuleCardComment,
    actor: Actor,
    expected: RuleCardAuditExpectation,
  ): Promise<RuleCardComment> {
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        const memory = await this.#hydrateForRevisionOrEmpty(transaction, comment.revisionId);
        const stored = memory.appendComment(comment, actor, expected);
        await this.#insertAudit(transaction, { kind: "COMMENT", record: stored });
        return stored;
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError("Rule Card audit record already exists");
      }
      throw error;
    }
  }

  public async submitForReview(
    transition: RuleCardTransitionEvent,
    actor: Actor,
    expected: RuleCardAuditExpectation,
  ): Promise<RuleCardTransitionEvent> {
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        const memory = await this.#hydrateForRevisionOrEmpty(transaction, transition.revisionId);
        const stored = memory.submitForReview(transition, actor, expected);
        await this.#insertAudit(transaction, { kind: "TRANSITION", record: stored });
        return stored;
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError("Rule Card audit record already exists");
      }
      throw error;
    }
  }

  public async recordReview(
    decision: RuleCardReviewDecision,
    actor: Actor,
    expected: RuleCardAuditExpectation,
  ): Promise<RuleCardReviewDecision> {
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        const memory = await this.#hydrateForRevisionOrEmpty(transaction, decision.revisionId);
        const stored = memory.recordReview(decision, actor, expected);
        await this.#insertAudit(transaction, { kind: "REVIEW", record: stored });
        return stored;
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError("Rule Card audit record already exists");
      }
      throw error;
    }
  }

  public async recordApproval(
    decision: RuleCardApprovalDecision,
    actor: Actor,
    expected: RuleCardAuditExpectation,
  ): Promise<RuleCardApprovalDecision> {
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        const memory = await this.#hydrateForRevisionOrEmpty(transaction, decision.revisionId);
        const stored = memory.recordApproval(decision, actor, expected);
        await this.#insertAudit(transaction, { kind: "APPROVAL", record: stored });
        return stored;
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError("Rule Card audit record already exists");
      }
      throw error;
    }
  }

  public async retireRevision(
    transition: RuleCardTransitionEvent,
    actor: Actor,
    expected: RuleCardAuditExpectation,
  ): Promise<RuleCardTransitionEvent> {
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        const memory = await this.#hydrateForRevisionOrEmpty(transaction, transition.revisionId);
        const stored = memory.retireRevision(transition, actor, expected);
        await this.#insertAudit(transaction, { kind: "TRANSITION", record: stored });
        return stored;
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError("Rule Card audit record already exists");
      }
      throw error;
    }
  }

  public async getCard(cardId: string): Promise<RuleCard> {
    const row = await this.#prisma.ruleCardRecord.findUnique({ where: { id: cardId } });
    if (row === null) {
      throw new RuleCardNotFoundError("RULE_CARD_NOT_FOUND", `Rule Card ${cardId} does not exist`, {
        cardId,
      });
    }
    return parsePayload(RuleCardSchema, row.payload);
  }

  public async getRevision(revisionId: string): Promise<RuleCardRevision> {
    const row = await this.#prisma.ruleCardRevisionRecord.findUnique({
      where: { id: revisionId },
    });
    if (row === null) {
      throw new RuleCardNotFoundError(
        "RULE_CARD_REVISION_NOT_FOUND",
        `Rule Card revision ${revisionId} does not exist`,
        { revisionId },
      );
    }
    return parsePayload(RuleCardRevisionSchema, row.payload);
  }

  public async getRevisionState(revisionId: string): Promise<RuleCardState> {
    const memory = await this.#hydrateForRevisionOrEmpty(this.#prisma, revisionId);
    return memory.getRevisionState(revisionId);
  }

  public async getAudit(revisionId: string): Promise<readonly RuleCardAuditRecord[]> {
    const revision = await this.#prisma.ruleCardRevisionRecord.findUnique({
      where: { id: revisionId },
      select: { id: true },
    });
    if (revision === null) {
      throw new RuleCardNotFoundError(
        "RULE_CARD_REVISION_NOT_FOUND",
        `Rule Card revision ${revisionId} does not exist`,
        { revisionId },
      );
    }
    const rows = await this.#prisma.ruleCardAuditRecord.findMany({
      where: { revisionId },
      orderBy: { sequence: "asc" },
    });
    return rows.map((row) => parseAuditRecord(row.kind, row.payload));
  }

  public async getHistory(cardId: string): Promise<RuleCardHistory> {
    return this.#loadHistory(this.#prisma, cardId);
  }

  public async assertEligibleForRuleGeneration(
    request: RuleGenerationEligibilityRequest,
  ): Promise<RuleDraftGenerationReference> {
    const memory = await this.#hydrateForRevisionOrEmpty(this.#prisma, request.revisionId);
    return memory.assertEligibleForRuleGeneration(request);
  }

  public async assertRevisionEligibleForActivation(
    request: RuleCardActivationEligibilityRequest,
  ): Promise<RuleCardRevision> {
    const memory = await this.#hydrateForRevisionOrEmpty(this.#prisma, request.revisionId);
    return memory.assertRevisionEligibleForActivation(request);
  }

  async #hydrateForRevisionOrEmpty(
    client: DbClient,
    revisionId: string,
  ): Promise<InMemoryRuleCardRepository> {
    const revision = await client.ruleCardRevisionRecord.findUnique({
      where: { id: revisionId },
      select: { cardId: true },
    });
    if (revision === null) return new InMemoryRuleCardRepository(this.#sourceReader);
    return this.#hydrateCard(client, revision.cardId);
  }

  async #hydrateCard(client: DbClient, cardId: string): Promise<InMemoryRuleCardRepository> {
    const history = await this.#loadHistory(client, cardId);
    return InMemoryRuleCardRepository.fromHistory(history, this.#sourceReader);
  }

  async #loadHistory(client: DbClient, cardId: string): Promise<RuleCardHistory> {
    const cardRow = await client.ruleCardRecord.findUnique({
      where: { id: cardId },
      include: {
        revisions: {
          orderBy: { revision: "asc" },
          include: {
            audit: { orderBy: { sequence: "asc" } },
          },
        },
      },
    });
    if (cardRow === null) {
      throw new RuleCardNotFoundError("RULE_CARD_NOT_FOUND", `Rule Card ${cardId} does not exist`, {
        cardId,
      });
    }

    const card = parsePayload(RuleCardSchema, cardRow.payload);
    const revisions: RuleCardRevisionSnapshot[] = cardRow.revisions.map((revisionRow) => {
      const revision = parsePayload(RuleCardRevisionSchema, revisionRow.payload);
      const audit = revisionRow.audit.map((entry) => parseAuditRecord(entry.kind, entry.payload));
      return {
        revision,
        state: projectState(revision, audit),
        requiredApprovals: approvalRequirement(revision),
        audit,
      };
    });

    return { card, revisions };
  }

  async #insertAudit(transaction: TransactionClient, entry: RuleCardAuditRecord): Promise<void> {
    const record = entry.record;
    await transaction.ruleCardAuditRecord.create({
      data: {
        id: record.id,
        revisionId: record.revisionId,
        sequence: record.sequence,
        kind: entry.kind,
        actorId: record.actorId,
        payload: toInputJson(record),
        createdAt: new Date(record.at),
      },
    });
  }
}
