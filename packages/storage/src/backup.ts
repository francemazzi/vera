import {
  ActivationEventSchema,
  ComplianceSourceSchema,
  ComplianceSourceTransitionEventSchema,
  ComplianceSourceVersionSchema,
  EvaluationRunSchema,
  JsonValueSchema,
  ReviewDecisionSchema,
  RuleCardRevisionSchema,
  RuleCardSchema,
  RulePackDraftSchema,
  RulePackImpactReportSchema,
  RulePackVersionSchema,
  RuleTestRunResultSchema,
  canonicalizeJson,
  sha256CanonicalJson,
} from "@vera/contracts";
import type { JsonValue } from "@vera/contracts";
import { z } from "zod";

import type { ContentAddressedBlobStore } from "./blob-store.js";
import type { Prisma } from "./generated/prisma/client.js";
import type { VeraPrismaClient } from "./prisma.js";
import { StorageConflictError, StorageValidationError } from "./repository.js";

export interface StorageBackup {
  readonly schemaVersion: "vera.storage-backup/v3";
  readonly exportedAt: string;
  /**
   * Sensitive: includes passwordHash so a restored backup can authenticate the
   * same local accounts. Backup files must be handled as credential material.
   */
  readonly localAccounts: readonly JsonValue[];
  readonly complianceSources: readonly JsonValue[];
  readonly complianceSourceVersions: readonly JsonValue[];
  readonly complianceSourceTransitions: readonly JsonValue[];
  readonly ruleCards: readonly JsonValue[];
  readonly ruleCardRevisions: readonly JsonValue[];
  readonly ruleCardAudit: readonly JsonValue[];
  readonly rulePackDrafts: readonly JsonValue[];
  readonly rulePackDraftContributors: readonly JsonValue[];
  readonly rulePackVersions: readonly JsonValue[];
  readonly rulePackVersionExcludedActivators: readonly JsonValue[];
  readonly rulePackDraftPublications: readonly JsonValue[];
  readonly activationEvents: readonly JsonValue[];
  readonly evaluationRuns: readonly JsonValue[];
  readonly reviewDecisions: readonly JsonValue[];
  readonly blobObjects: readonly JsonValue[];
  readonly idempotencyRecords: readonly JsonValue[];
  readonly ruleTestRuns: readonly JsonValue[];
  readonly rulePackImpactReports: readonly JsonValue[];
  readonly contentHash: string;
}

export interface RestoreStorageBackupOptions {
  readonly blobStore?: ContentAddressedBlobStore;
  readonly blobBytesBySha256?: ReadonlyMap<string, Uint8Array>;
}

const STORAGE_BACKUP_SCHEMA_VERSION = "vera.storage-backup/v3" as const;

const IsoDateTimeSchema = z.iso.datetime({ offset: true });
const Sha256DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);

const LocalAccountBackupRecordSchema = z
  .object({
    id: z.uuid(),
    email: z.string().min(1),
    displayName: z.string(),
    passwordHash: z.string().min(1),
    role: z.string().min(1),
    disabled: z.boolean(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

const RuleCardAuditBackupRecordSchema = z
  .object({
    id: z.uuid(),
    revisionId: z.uuid(),
    sequence: z.int().min(1),
    kind: z.string().min(1),
    actorId: z.uuid(),
    payload: JsonValueSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();

const RulePackDraftContributorBackupRecordSchema = z
  .object({
    draftId: z.uuid(),
    actorId: z.uuid(),
  })
  .strict();

const RulePackVersionExcludedActivatorBackupRecordSchema = z
  .object({
    versionId: z.uuid(),
    actorId: z.uuid(),
  })
  .strict();

const RulePackDraftPublicationBackupRecordSchema = z
  .object({
    draftId: z.uuid(),
    publishedVersionId: z.uuid(),
  })
  .strict();

const BlobObjectBackupRecordSchema = z
  .object({
    sha256: Sha256DigestSchema,
    byteLength: z.int().min(0),
    mediaType: z.string().min(1),
    path: z.string().min(1),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

const IdempotencyBackupRecordSchema = z
  .object({
    scope: z.string().min(1),
    key: z.string().min(1),
    requestHash: Sha256DigestSchema.nullable(),
    responseHash: Sha256DigestSchema,
    response: JsonValueSchema,
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .strict();

const RulePackImpactReportBackupRecordSchema = z
  .object({
    id: z.uuid(),
    contentHash: Sha256DigestSchema,
    validationScope: z.string().min(1),
    payload: JsonValueSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();

function dateIso(value: Date): string {
  return value.toISOString();
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function indexedActivationVersionId(event: {
  readonly versionId: string | null;
  readonly expectedPreviousVersionId: string | null;
}): string {
  const versionId = event.versionId ?? event.expectedPreviousVersionId;
  if (versionId === null) {
    throw new StorageValidationError("Activation event has no indexable version identity");
  }
  return versionId;
}

function backupHashInput(backup: StorageBackup): Omit<StorageBackup, "contentHash"> {
  return {
    schemaVersion: backup.schemaVersion,
    exportedAt: backup.exportedAt,
    localAccounts: backup.localAccounts,
    complianceSources: backup.complianceSources,
    complianceSourceVersions: backup.complianceSourceVersions,
    complianceSourceTransitions: backup.complianceSourceTransitions,
    ruleCards: backup.ruleCards,
    ruleCardRevisions: backup.ruleCardRevisions,
    ruleCardAudit: backup.ruleCardAudit,
    rulePackDrafts: backup.rulePackDrafts,
    rulePackDraftContributors: backup.rulePackDraftContributors,
    rulePackVersions: backup.rulePackVersions,
    rulePackVersionExcludedActivators: backup.rulePackVersionExcludedActivators,
    rulePackDraftPublications: backup.rulePackDraftPublications,
    activationEvents: backup.activationEvents,
    evaluationRuns: backup.evaluationRuns,
    reviewDecisions: backup.reviewDecisions,
    blobObjects: backup.blobObjects,
    idempotencyRecords: backup.idempotencyRecords,
    ruleTestRuns: backup.ruleTestRuns,
    rulePackImpactReports: backup.rulePackImpactReports,
  };
}

function validateBackupHash(backup: StorageBackup): void {
  const expected = sha256CanonicalJson(backupHashInput(backup));
  if (backup.contentHash !== expected) {
    throw new StorageValidationError("Storage backup contentHash does not match its content");
  }
}

async function assertEmptyWhenRestoring(
  tableName: string,
  rows: readonly JsonValue[],
  count: () => Promise<number>,
): Promise<void> {
  if (rows.length === 0) return;
  if ((await count()) !== 0) {
    throw new StorageConflictError(
      `Cannot restore ${tableName} into a non-empty target table; wipe restored aggregates first`,
    );
  }
}

export async function exportStorageBackup(
  prisma: VeraPrismaClient,
  exportedAt: string,
): Promise<StorageBackup> {
  const snapshot = await prisma.$transaction(
    async (transaction) => ({
      localAccounts: (await transaction.localAccount.findMany({ orderBy: { id: "asc" } })).map(
        (record) =>
          ({
            id: record.id,
            email: record.email,
            displayName: record.displayName,
            passwordHash: record.passwordHash,
            role: record.role,
            disabled: record.disabled,
            createdAt: dateIso(record.createdAt),
          }) satisfies JsonValue,
      ),
      complianceSources: (
        await transaction.complianceSourceRecord.findMany({ orderBy: { id: "asc" } })
      ).map(({ payload }) => payload as JsonValue),
      complianceSourceVersions: (
        await transaction.complianceSourceVersionRecord.findMany({
          orderBy: [{ sourceId: "asc" }, { revision: "asc" }, { id: "asc" }],
        })
      ).map(({ payload }) => payload as JsonValue),
      complianceSourceTransitions: (
        await transaction.complianceSourceTransitionRecord.findMany({
          orderBy: [{ versionId: "asc" }, { sequence: "asc" }, { id: "asc" }],
        })
      ).map(({ payload }) => payload as JsonValue),
      ruleCards: (await transaction.ruleCardRecord.findMany({ orderBy: { id: "asc" } })).map(
        ({ payload }) => payload as JsonValue,
      ),
      ruleCardRevisions: (
        await transaction.ruleCardRevisionRecord.findMany({
          orderBy: [{ cardId: "asc" }, { revision: "asc" }, { id: "asc" }],
        })
      ).map(({ payload }) => payload as JsonValue),
      ruleCardAudit: (
        await transaction.ruleCardAuditRecord.findMany({
          orderBy: [{ revisionId: "asc" }, { sequence: "asc" }, { id: "asc" }],
        })
      ).map(
        (record) =>
          ({
            id: record.id,
            revisionId: record.revisionId,
            sequence: record.sequence,
            kind: record.kind,
            actorId: record.actorId,
            payload: record.payload as JsonValue,
            createdAt: dateIso(record.createdAt),
          }) satisfies JsonValue,
      ),
      rulePackDrafts: (
        await transaction.rulePackDraftRecord.findMany({
          orderBy: [{ packId: "asc" }, { id: "asc" }],
        })
      ).map(({ payload }) => payload as JsonValue),
      rulePackDraftContributors: (
        await transaction.rulePackDraftContributorRecord.findMany({
          orderBy: [{ draftId: "asc" }, { actorId: "asc" }],
        })
      ).map(
        (record) =>
          ({
            draftId: record.draftId,
            actorId: record.actorId,
          }) satisfies JsonValue,
      ),
      rulePackVersions: (
        await transaction.rulePackVersionRecord.findMany({
          orderBy: [{ packId: "asc" }, { semver: "asc" }, { id: "asc" }],
        })
      ).map(({ payload }) => payload as JsonValue),
      rulePackVersionExcludedActivators: (
        await transaction.rulePackVersionExcludedActivatorRecord.findMany({
          orderBy: [{ versionId: "asc" }, { actorId: "asc" }],
        })
      ).map(
        (record) =>
          ({
            versionId: record.versionId,
            actorId: record.actorId,
          }) satisfies JsonValue,
      ),
      rulePackDraftPublications: (
        await transaction.rulePackDraftPublicationRecord.findMany({
          orderBy: { draftId: "asc" },
        })
      ).map(
        (record) =>
          ({
            draftId: record.draftId,
            publishedVersionId: record.publishedVersionId,
          }) satisfies JsonValue,
      ),
      activationEvents: (
        await transaction.activationEventRecord.findMany({
          orderBy: [{ packId: "asc" }, { sequence: "asc" }, { id: "asc" }],
        })
      ).map(({ payload }) => payload as JsonValue),
      evaluationRuns: (
        await transaction.evaluationRunRecord.findMany({ orderBy: { id: "asc" } })
      ).map(({ payload }) => payload as JsonValue),
      reviewDecisions: (
        await transaction.reviewDecisionRecord.findMany({
          orderBy: [{ runId: "asc" }, { sequence: "asc" }],
        })
      ).map(({ payload }) => payload as JsonValue),
      blobObjects: (await transaction.blobObject.findMany({ orderBy: { sha256: "asc" } })).map(
        (record) =>
          ({
            sha256: record.sha256,
            byteLength: record.byteLength,
            mediaType: record.mediaType,
            path: record.path,
            createdAt: dateIso(record.createdAt),
          }) satisfies JsonValue,
      ),
      idempotencyRecords: (
        await transaction.idempotencyRecord.findMany({
          orderBy: [{ scope: "asc" }, { key: "asc" }],
        })
      ).map(
        (record) =>
          ({
            scope: record.scope,
            key: record.key,
            requestHash: record.requestHash,
            responseHash: record.responseHash,
            response: record.response as JsonValue,
            createdAt: dateIso(record.createdAt),
            expiresAt: dateIso(record.expiresAt),
          }) satisfies JsonValue,
      ),
      ruleTestRuns: (
        await transaction.ruleTestRunRecord.findMany({
          orderBy: [{ rulePackVersionId: "asc" }, { requestId: "asc" }],
        })
      ).map(({ payload }) => payload as JsonValue),
      rulePackImpactReports: (
        await transaction.rulePackImpactReportRecord.findMany({
          orderBy: [{ contentHash: "asc" }, { id: "asc" }],
        })
      ).map(
        (record) =>
          ({
            id: record.id,
            contentHash: record.contentHash,
            validationScope: record.validationScope,
            payload: record.payload as JsonValue,
            createdAt: dateIso(record.createdAt),
          }) satisfies JsonValue,
      ),
    }),
    { isolationLevel: "RepeatableRead" },
  );
  const hashInput = {
    schemaVersion: STORAGE_BACKUP_SCHEMA_VERSION,
    exportedAt,
    ...snapshot,
  };
  return { ...hashInput, contentHash: sha256CanonicalJson(hashInput) };
}

export async function restoreStorageBackup(
  prisma: VeraPrismaClient,
  backup: StorageBackup,
  options: RestoreStorageBackupOptions = {},
): Promise<void> {
  validateBackupHash(backup);

  await prisma.$transaction(async (transaction) => {
    await Promise.all([
      assertEmptyWhenRestoring("local_accounts", backup.localAccounts, () =>
        transaction.localAccount.count(),
      ),
      assertEmptyWhenRestoring("compliance_sources", backup.complianceSources, () =>
        transaction.complianceSourceRecord.count(),
      ),
      assertEmptyWhenRestoring("compliance_source_versions", backup.complianceSourceVersions, () =>
        transaction.complianceSourceVersionRecord.count(),
      ),
      assertEmptyWhenRestoring(
        "compliance_source_transitions",
        backup.complianceSourceTransitions,
        () => transaction.complianceSourceTransitionRecord.count(),
      ),
      assertEmptyWhenRestoring("rule_cards", backup.ruleCards, () =>
        transaction.ruleCardRecord.count(),
      ),
      assertEmptyWhenRestoring("rule_card_revisions", backup.ruleCardRevisions, () =>
        transaction.ruleCardRevisionRecord.count(),
      ),
      assertEmptyWhenRestoring("rule_card_audit", backup.ruleCardAudit, () =>
        transaction.ruleCardAuditRecord.count(),
      ),
      assertEmptyWhenRestoring("rule_pack_drafts", backup.rulePackDrafts, () =>
        transaction.rulePackDraftRecord.count(),
      ),
      assertEmptyWhenRestoring(
        "rule_pack_draft_contributors",
        backup.rulePackDraftContributors,
        () => transaction.rulePackDraftContributorRecord.count(),
      ),
      assertEmptyWhenRestoring("rule_pack_versions", backup.rulePackVersions, () =>
        transaction.rulePackVersionRecord.count(),
      ),
      assertEmptyWhenRestoring(
        "rule_pack_version_excluded_activators",
        backup.rulePackVersionExcludedActivators,
        () => transaction.rulePackVersionExcludedActivatorRecord.count(),
      ),
      assertEmptyWhenRestoring(
        "rule_pack_draft_publications",
        backup.rulePackDraftPublications,
        () => transaction.rulePackDraftPublicationRecord.count(),
      ),
      assertEmptyWhenRestoring("activation_events", backup.activationEvents, () =>
        transaction.activationEventRecord.count(),
      ),
      assertEmptyWhenRestoring("evaluation_runs", backup.evaluationRuns, () =>
        transaction.evaluationRunRecord.count(),
      ),
      assertEmptyWhenRestoring("review_decisions", backup.reviewDecisions, () =>
        transaction.reviewDecisionRecord.count(),
      ),
      assertEmptyWhenRestoring("blob_objects", backup.blobObjects, () =>
        transaction.blobObject.count(),
      ),
      assertEmptyWhenRestoring("idempotency_records", backup.idempotencyRecords, () =>
        transaction.idempotencyRecord.count(),
      ),
      assertEmptyWhenRestoring("rule_test_runs", backup.ruleTestRuns, () =>
        transaction.ruleTestRunRecord.count(),
      ),
      assertEmptyWhenRestoring("rule_pack_impact_reports", backup.rulePackImpactReports, () =>
        transaction.rulePackImpactReportRecord.count(),
      ),
    ]);

    await transaction.localAccount.createMany({
      data: backup.localAccounts.map((value) => {
        const record = LocalAccountBackupRecordSchema.parse(value);
        return {
          id: record.id,
          email: record.email,
          displayName: record.displayName,
          passwordHash: record.passwordHash,
          role: record.role,
          disabled: record.disabled,
          createdAt: new Date(record.createdAt),
        };
      }),
    });

    await transaction.complianceSourceRecord.createMany({
      data: backup.complianceSources.map((value) => {
        const source = ComplianceSourceSchema.parse(value);
        return {
          id: source.id,
          type: source.type,
          domain: source.domain,
          jurisdiction: source.jurisdiction,
          title: source.title,
          stableReference: source.stableReference,
          validationScope: source.validationScope,
          payload: toInputJson(source),
          createdAt: new Date(backup.exportedAt),
        };
      }),
    });
    await transaction.complianceSourceVersionRecord.createMany({
      data: backup.complianceSourceVersions.map((value) => {
        const version = ComplianceSourceVersionSchema.parse(value);
        return {
          id: version.id,
          sourceId: version.sourceId,
          revision: version.revision,
          contentHash: version.contentHash,
          replacesVersionId: version.replacesVersionId,
          payload: toInputJson(version),
          createdAt: new Date(version.createdAt),
        };
      }),
    });
    await transaction.complianceSourceTransitionRecord.createMany({
      data: backup.complianceSourceTransitions.map((value) => {
        const transition = ComplianceSourceTransitionEventSchema.parse(value);
        return {
          id: transition.id,
          versionId: transition.versionId,
          sequence: transition.sequence,
          fromState: transition.from,
          toState: transition.to,
          actorId: transition.actorId,
          contentHash: transition.contentHash,
          payload: toInputJson(transition),
          createdAt: new Date(transition.at),
        };
      }),
    });

    await transaction.ruleCardRecord.createMany({
      data: backup.ruleCards.map((value) => {
        const card = RuleCardSchema.parse(value);
        return {
          id: card.id,
          sourceId: card.sourceId,
          sourceVersionId: card.sourceVersionId,
          sourceSection: card.sourceSection,
          validationScope: card.validationScope,
          payload: toInputJson(card),
          createdAt: new Date(backup.exportedAt),
        };
      }),
    });
    await transaction.ruleCardRevisionRecord.createMany({
      data: backup.ruleCardRevisions.map((value) => {
        const revision = RuleCardRevisionSchema.parse(value);
        return {
          id: revision.id,
          cardId: revision.cardId,
          revision: revision.revision,
          contentHash: revision.contentHash,
          payload: toInputJson(revision),
          createdAt: new Date(revision.createdAt),
        };
      }),
    });
    await transaction.ruleCardAuditRecord.createMany({
      data: backup.ruleCardAudit.map((value) => {
        const record = RuleCardAuditBackupRecordSchema.parse(value);
        return {
          id: record.id,
          revisionId: record.revisionId,
          sequence: record.sequence,
          kind: record.kind,
          actorId: record.actorId,
          payload: toInputJson(record.payload),
          createdAt: new Date(record.createdAt),
        };
      }),
    });

    await transaction.rulePackDraftRecord.createMany({
      data: backup.rulePackDrafts.map((value) => {
        const draft = RulePackDraftSchema.parse(value);
        return {
          id: draft.id,
          packId: draft.packId,
          revision: draft.revision,
          contentHash: draft.contentHash,
          payload: toInputJson(draft),
          updatedAt: new Date(draft.updatedAt),
          createdAt: new Date(draft.createdAt),
        };
      }),
    });
    await transaction.rulePackDraftContributorRecord.createMany({
      data: backup.rulePackDraftContributors.map((value) =>
        RulePackDraftContributorBackupRecordSchema.parse(value),
      ),
    });
    await transaction.rulePackVersionRecord.createMany({
      data: backup.rulePackVersions.map((value) => {
        const version = RulePackVersionSchema.parse(value);
        return {
          id: version.id,
          packId: version.packId,
          semver: version.semver,
          contentHash: version.contentHash,
          payload: toInputJson(version),
          publishedAt: new Date(version.publishedAt),
          createdAt: new Date(version.createdAt),
        };
      }),
    });
    await transaction.rulePackVersionExcludedActivatorRecord.createMany({
      data: backup.rulePackVersionExcludedActivators.map((value) =>
        RulePackVersionExcludedActivatorBackupRecordSchema.parse(value),
      ),
    });
    await transaction.rulePackDraftPublicationRecord.createMany({
      data: backup.rulePackDraftPublications.map((value) =>
        RulePackDraftPublicationBackupRecordSchema.parse(value),
      ),
    });

    await transaction.activationEventRecord.createMany({
      data: backup.activationEvents.map((value) => {
        const event = ActivationEventSchema.parse(value);
        return {
          id: event.id,
          packId: event.packId,
          sequence: event.sequence,
          type: event.type,
          versionId: indexedActivationVersionId(event),
          contentHash: event.contentHash,
          previousEventHash: event.previousEventHash,
          payload: toInputJson(event),
          recordedAt: new Date(event.recordedAt),
        };
      }),
    });

    await transaction.evaluationRunRecord.createMany({
      data: backup.evaluationRuns.map((value) => {
        const run = EvaluationRunSchema.parse(value);
        return {
          id: run.id,
          contentHash: run.contentHash,
          aggregateOutcome: run.evaluationSnapshot.evaluationResult.aggregateOutcome,
          validationScope: run.validationScope,
          payload: toInputJson(run),
          createdAt: new Date(run.recordedAt),
        };
      }),
    });
    await transaction.reviewDecisionRecord.createMany({
      data: backup.reviewDecisions.map((value) => {
        const decision = ReviewDecisionSchema.parse(value);
        return {
          id: decision.id,
          runId: decision.runId,
          sequence: decision.sequence,
          contentHash: decision.contentHash,
          previousEventHash: decision.previousEventHash,
          actorId: decision.actorId,
          payload: toInputJson(decision),
          createdAt: new Date(decision.decidedAt),
        };
      }),
    });

    await transaction.blobObject.createMany({
      data: await Promise.all(
        backup.blobObjects.map(async (value) => {
          const record = BlobObjectBackupRecordSchema.parse(value);
          const bytes = options.blobBytesBySha256?.get(record.sha256);
          if (bytes === undefined) {
            return {
              sha256: record.sha256,
              byteLength: record.byteLength,
              mediaType: record.mediaType,
              path: record.path,
              createdAt: new Date(record.createdAt),
            };
          }
          if (options.blobStore === undefined) {
            throw new StorageValidationError(
              "Blob bytes were provided without a ContentAddressedBlobStore",
            );
          }
          const descriptor = await options.blobStore.put(bytes, record.mediaType);
          if (descriptor.sha256 !== record.sha256 || descriptor.byteLength !== record.byteLength) {
            throw new StorageValidationError("Blob bytes do not match backup metadata");
          }
          return {
            sha256: record.sha256,
            byteLength: record.byteLength,
            mediaType: record.mediaType,
            path: descriptor.path,
            createdAt: new Date(record.createdAt),
          };
        }),
      ),
    });
    await transaction.idempotencyRecord.createMany({
      data: backup.idempotencyRecords.map((value) => {
        const record = IdempotencyBackupRecordSchema.parse(value);
        return {
          scope: record.scope,
          key: record.key,
          requestHash: record.requestHash,
          responseHash: record.responseHash,
          response: toInputJson(record.response),
          createdAt: new Date(record.createdAt),
          expiresAt: new Date(record.expiresAt),
        };
      }),
    });

    await transaction.ruleTestRunRecord.createMany({
      data: backup.ruleTestRuns.map((value) => {
        const run = RuleTestRunResultSchema.parse(value);
        return {
          id: run.requestId,
          requestId: run.requestId,
          rulePackVersionId: run.rulePackVersionId,
          rulePackVersionContentHash: run.rulePackVersionContentHash,
          contentHash: run.contentHash,
          passed: run.passed,
          validationScope: run.validationScope,
          payload: toInputJson(run),
          createdAt: new Date(backup.exportedAt),
        };
      }),
    });
    await transaction.rulePackImpactReportRecord.createMany({
      data: backup.rulePackImpactReports.map((value) => {
        const record = RulePackImpactReportBackupRecordSchema.parse(value);
        const report = RulePackImpactReportSchema.parse(record.payload);
        if (
          record.contentHash !== report.contentHash ||
          record.validationScope !== report.validationScope
        ) {
          throw new StorageValidationError(
            "Rule Pack impact report metadata does not match payload",
          );
        }
        return {
          id: record.id,
          contentHash: record.contentHash,
          validationScope: record.validationScope,
          payload: toInputJson(report),
          createdAt: new Date(record.createdAt),
        };
      }),
    });
  });
}

export function canonicalizeStorageBackup(backup: StorageBackup): string {
  return canonicalizeJson(backup);
}
