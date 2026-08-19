import { RulePackDraftSchema, RulePackVersionSchema } from "@vera/contracts";
import type { Actor, RulePackDraft, RulePackVersion, SemVer, UtcDateTime } from "@vera/contracts";
import {
  InMemoryRulePackRepository,
  RulePackNotFoundError,
  type CloneRulePackVersionRequest,
  type PublishRulePackDraftRequest,
  type RulePackReadinessGate,
  type RulePackRepositorySnapshot,
  type RulePackRuleEligibilityReader,
} from "@vera/rules-core";

import type { Prisma } from "./generated/prisma/client.js";
import { parsePayload, toInputJson } from "./payload.js";
import type { VeraPrismaClient } from "./prisma.js";
import { StorageConflictError } from "./repository.js";
import { isUniqueConstraint, runSerializableWithRetries } from "./transaction.js";

type TransactionClient = Prisma.TransactionClient;
type DbClient = VeraPrismaClient | TransactionClient;

/**
 * Prisma-backed Rule Pack repository. Mutations hydrate a trusted snapshot into
 * {@link InMemoryRulePackRepository}, then persist accepted drafts/versions.
 */
export class DurableRulePackRepository {
  readonly #prisma: VeraPrismaClient;
  readonly #eligibility: RulePackRuleEligibilityReader;
  readonly #readinessGate: RulePackReadinessGate | null;

  public constructor(
    prisma: VeraPrismaClient,
    eligibility: RulePackRuleEligibilityReader,
    readinessGate: RulePackReadinessGate | null = null,
  ) {
    this.#prisma = prisma;
    this.#eligibility = eligibility;
    this.#readinessGate = readinessGate;
  }

  public async addDraft(draft: RulePackDraft, actor: Actor): Promise<RulePackDraft> {
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        const memory = await this.#hydrate(transaction);
        const stored = memory.addDraft(draft, actor);
        await this.#persistDraftCreate(transaction, stored);
        return stored;
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError("Rule Pack draft already exists");
      }
      throw error;
    }
  }

  public async replaceDraft(
    draft: RulePackDraft,
    expectedRevision: number,
    actor: Actor,
  ): Promise<RulePackDraft> {
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        const memory = await this.#hydrate(transaction);
        const stored = memory.replaceDraft(draft, expectedRevision, actor);
        await transaction.rulePackDraftRecord.update({
          where: { id: stored.id },
          data: {
            revision: stored.revision,
            contentHash: stored.contentHash,
            payload: toInputJson(stored),
            updatedAt: new Date(stored.updatedAt),
          },
        });
        await transaction.rulePackDraftContributorRecord.createMany({
          data: [{ draftId: stored.id, actorId: stored.updatedBy }],
          skipDuplicates: true,
        });
        return stored;
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError("Rule Pack draft update conflict");
      }
      throw error;
    }
  }

  public async cloneVersion(
    request: CloneRulePackVersionRequest,
    actor: Actor,
  ): Promise<RulePackDraft> {
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        const memory = await this.#hydrate(transaction);
        const stored = memory.cloneVersion(request, actor);
        await this.#persistDraftCreate(transaction, stored);
        return stored;
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError("Rule Pack draft already exists");
      }
      throw error;
    }
  }

  public async publishDraft(
    request: PublishRulePackDraftRequest,
    publisher: Actor,
  ): Promise<RulePackVersion> {
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        const memory = await this.#hydrate(transaction);
        const stored = memory.publishDraft(request, publisher);
        const draftId = request.draftId;
        const contributors = await transaction.rulePackDraftContributorRecord.findMany({
          where: { draftId },
        });
        await transaction.rulePackVersionRecord.create({
          data: {
            id: stored.id,
            packId: stored.packId,
            semver: stored.semver,
            contentHash: stored.contentHash,
            payload: toInputJson(stored),
            publishedAt: new Date(stored.publishedAt),
          },
        });
        if (contributors.length > 0) {
          await transaction.rulePackVersionExcludedActivatorRecord.createMany({
            data: contributors.map(({ actorId }) => ({
              versionId: stored.id,
              actorId,
            })),
            skipDuplicates: true,
          });
        }
        await transaction.rulePackDraftPublicationRecord.create({
          data: {
            draftId,
            publishedVersionId: stored.id,
          },
        });
        return stored;
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError("Rule Pack version already published or exists");
      }
      throw error;
    }
  }

  public async getDraft(draftId: string): Promise<RulePackDraft> {
    const row = await this.#prisma.rulePackDraftRecord.findUnique({ where: { id: draftId } });
    if (row === null) {
      throw new RulePackNotFoundError(
        "RULE_PACK_DRAFT_NOT_FOUND",
        `Rule Pack draft ${draftId} does not exist`,
        { draftId },
      );
    }
    return parsePayload(RulePackDraftSchema, row.payload);
  }

  public async getVersion(versionId: string): Promise<RulePackVersion> {
    const row = await this.#prisma.rulePackVersionRecord.findUnique({ where: { id: versionId } });
    if (row === null) {
      throw new RulePackNotFoundError(
        "RULE_PACK_VERSION_NOT_FOUND",
        `Rule Pack version ${versionId} does not exist`,
        { versionId },
      );
    }
    return parsePayload(RulePackVersionSchema, row.payload);
  }

  public async getVersions(packId: string): Promise<readonly RulePackVersion[]> {
    const rows = await this.#prisma.rulePackVersionRecord.findMany({
      where: { packId },
      orderBy: { publishedAt: "asc" },
    });
    return rows.map((row) => parsePayload(RulePackVersionSchema, row.payload));
  }

  public async getVersionBySemVer(packId: string, semver: SemVer): Promise<RulePackVersion> {
    const row = await this.#prisma.rulePackVersionRecord.findUnique({
      where: { packId_semver: { packId, semver } },
    });
    if (row === null) {
      throw new RulePackNotFoundError(
        "RULE_PACK_VERSION_NOT_FOUND",
        `Rule Pack ${packId} has no version ${semver}`,
        { packId, semver },
      );
    }
    return parsePayload(RulePackVersionSchema, row.payload);
  }

  public async assertVersionEligibleForActivation(
    versionId: string,
    activationAt: UtcDateTime,
    actorId: string,
  ): Promise<RulePackVersion> {
    const memory = await this.#hydrate(this.#prisma);
    return memory.assertVersionEligibleForActivation(versionId, activationAt, actorId);
  }

  async #hydrate(client: DbClient): Promise<InMemoryRulePackRepository> {
    const snapshot = await this.#loadSnapshot(client);
    return InMemoryRulePackRepository.fromSnapshot(
      snapshot,
      this.#eligibility,
      this.#readinessGate,
    );
  }

  async #loadSnapshot(client: DbClient): Promise<RulePackRepositorySnapshot> {
    const [draftRows, contributorRows, versionRows, excludedRows, publicationRows] =
      await Promise.all([
        client.rulePackDraftRecord.findMany({ orderBy: { createdAt: "asc" } }),
        client.rulePackDraftContributorRecord.findMany(),
        client.rulePackVersionRecord.findMany({ orderBy: { publishedAt: "asc" } }),
        client.rulePackVersionExcludedActivatorRecord.findMany(),
        client.rulePackDraftPublicationRecord.findMany(),
      ]);

    const contributorIdsByDraftId: Record<string, string[]> = {};
    for (const draft of draftRows) contributorIdsByDraftId[draft.id] = [];
    for (const row of contributorRows) {
      const bucket = contributorIdsByDraftId[row.draftId] ?? [];
      bucket.push(row.actorId);
      contributorIdsByDraftId[row.draftId] = bucket;
    }

    const excludedActivatorIdsByVersionId: Record<string, string[]> = {};
    for (const version of versionRows) excludedActivatorIdsByVersionId[version.id] = [];
    for (const row of excludedRows) {
      const bucket = excludedActivatorIdsByVersionId[row.versionId] ?? [];
      bucket.push(row.actorId);
      excludedActivatorIdsByVersionId[row.versionId] = bucket;
    }

    const publishedVersionIdByDraftId: Record<string, string> = {};
    for (const row of publicationRows) {
      publishedVersionIdByDraftId[row.draftId] = row.publishedVersionId;
    }

    return {
      drafts: draftRows.map((row) => parsePayload(RulePackDraftSchema, row.payload)),
      versions: versionRows.map((row) => parsePayload(RulePackVersionSchema, row.payload)),
      contributorIdsByDraftId,
      excludedActivatorIdsByVersionId,
      publishedVersionIdByDraftId,
    };
  }

  async #persistDraftCreate(transaction: TransactionClient, draft: RulePackDraft): Promise<void> {
    await transaction.rulePackDraftRecord.create({
      data: {
        id: draft.id,
        packId: draft.packId,
        revision: draft.revision,
        contentHash: draft.contentHash,
        payload: toInputJson(draft),
        updatedAt: new Date(draft.updatedAt),
        createdAt: new Date(draft.createdAt),
      },
    });
    await transaction.rulePackDraftContributorRecord.createMany({
      data: [
        { draftId: draft.id, actorId: draft.createdBy },
        { draftId: draft.id, actorId: draft.updatedBy },
      ],
      skipDuplicates: true,
    });
  }
}
