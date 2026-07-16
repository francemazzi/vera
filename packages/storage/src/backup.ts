import { canonicalizeJson, sha256CanonicalJson } from "@vera/contracts";
import type { JsonValue } from "@vera/contracts";

import type { VeraPrismaClient } from "./prisma.js";

export interface StorageBackup {
  readonly schemaVersion: "vera.storage-backup/v2";
  readonly exportedAt: string;
  readonly evaluationRuns: readonly JsonValue[];
  readonly reviewDecisions: readonly JsonValue[];
  readonly blobObjects: readonly JsonValue[];
  readonly idempotencyRecords: readonly JsonValue[];
  readonly contentHash: string;
}

function dateIso(value: Date): string {
  return value.toISOString();
}

export async function exportStorageBackup(
  prisma: VeraPrismaClient,
  exportedAt: string,
): Promise<StorageBackup> {
  const snapshot = await prisma.$transaction(
    async (transaction) => ({
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
    }),
    { isolationLevel: "RepeatableRead" },
  );
  const hashInput = {
    schemaVersion: "vera.storage-backup/v2" as const,
    exportedAt,
    ...snapshot,
  };
  return { ...hashInput, contentHash: sha256CanonicalJson(hashInput) };
}

export function canonicalizeStorageBackup(backup: StorageBackup): string {
  return canonicalizeJson(backup);
}
