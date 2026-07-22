import type { JsonValue } from "@vera/contracts";
import { describe, expect, it } from "vitest";

import { exportStorageBackup } from "../../src/index.js";
import type { VeraPrismaClient } from "../../src/index.js";

interface FakeSnapshot {
  readonly localAccounts: readonly {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
    readonly passwordHash: string;
    readonly role: string;
    readonly disabled: boolean;
    readonly createdAt: Date;
  }[];
  readonly complianceSources: readonly { readonly payload: JsonValue }[];
  readonly complianceSourceVersions: readonly { readonly payload: JsonValue }[];
  readonly complianceSourceTransitions: readonly { readonly payload: JsonValue }[];
  readonly ruleCards: readonly { readonly payload: JsonValue }[];
  readonly ruleCardRevisions: readonly { readonly payload: JsonValue }[];
  readonly ruleCardAudit: readonly {
    readonly id: string;
    readonly revisionId: string;
    readonly sequence: number;
    readonly kind: string;
    readonly actorId: string;
    readonly payload: JsonValue;
    readonly createdAt: Date;
  }[];
  readonly rulePackDrafts: readonly { readonly payload: JsonValue }[];
  readonly rulePackDraftContributors: readonly {
    readonly draftId: string;
    readonly actorId: string;
  }[];
  readonly rulePackVersions: readonly { readonly payload: JsonValue }[];
  readonly rulePackVersionExcludedActivators: readonly {
    readonly versionId: string;
    readonly actorId: string;
  }[];
  readonly rulePackDraftPublications: readonly {
    readonly draftId: string;
    readonly publishedVersionId: string;
  }[];
  readonly activationEvents: readonly { readonly payload: JsonValue }[];
  readonly evaluationRuns: readonly { readonly payload: JsonValue }[];
  readonly reviewDecisions: readonly { readonly payload: JsonValue }[];
  readonly blobObjects: readonly {
    readonly sha256: string;
    readonly byteLength: number;
    readonly mediaType: string;
    readonly path: string;
    readonly createdAt: Date;
  }[];
  readonly idempotencyRecords: readonly {
    readonly scope: string;
    readonly key: string;
    readonly requestHash: string | null;
    readonly responseHash: string;
    readonly response: JsonValue;
    readonly createdAt: Date;
    readonly expiresAt: Date;
  }[];
  readonly ruleTestRuns: readonly { readonly payload: JsonValue }[];
  readonly rulePackImpactReports: readonly {
    readonly id: string;
    readonly contentHash: string;
    readonly validationScope: string;
    readonly payload: JsonValue;
    readonly createdAt: Date;
  }[];
}

interface FakeTransaction {
  readonly localAccount: { findMany(): Promise<FakeSnapshot["localAccounts"]> };
  readonly complianceSourceRecord: { findMany(): Promise<FakeSnapshot["complianceSources"]> };
  readonly complianceSourceVersionRecord: {
    findMany(): Promise<FakeSnapshot["complianceSourceVersions"]>;
  };
  readonly complianceSourceTransitionRecord: {
    findMany(): Promise<FakeSnapshot["complianceSourceTransitions"]>;
  };
  readonly ruleCardRecord: { findMany(): Promise<FakeSnapshot["ruleCards"]> };
  readonly ruleCardRevisionRecord: { findMany(): Promise<FakeSnapshot["ruleCardRevisions"]> };
  readonly ruleCardAuditRecord: { findMany(): Promise<FakeSnapshot["ruleCardAudit"]> };
  readonly rulePackDraftRecord: { findMany(): Promise<FakeSnapshot["rulePackDrafts"]> };
  readonly rulePackDraftContributorRecord: {
    findMany(): Promise<FakeSnapshot["rulePackDraftContributors"]>;
  };
  readonly rulePackVersionRecord: { findMany(): Promise<FakeSnapshot["rulePackVersions"]> };
  readonly rulePackVersionExcludedActivatorRecord: {
    findMany(): Promise<FakeSnapshot["rulePackVersionExcludedActivators"]>;
  };
  readonly rulePackDraftPublicationRecord: {
    findMany(): Promise<FakeSnapshot["rulePackDraftPublications"]>;
  };
  readonly activationEventRecord: { findMany(): Promise<FakeSnapshot["activationEvents"]> };
  readonly evaluationRunRecord: { findMany(): Promise<FakeSnapshot["evaluationRuns"]> };
  readonly reviewDecisionRecord: { findMany(): Promise<FakeSnapshot["reviewDecisions"]> };
  readonly blobObject: { findMany(): Promise<FakeSnapshot["blobObjects"]> };
  readonly idempotencyRecord: { findMany(): Promise<FakeSnapshot["idempotencyRecords"]> };
  readonly ruleTestRunRecord: { findMany(): Promise<FakeSnapshot["ruleTestRuns"]> };
  readonly rulePackImpactReportRecord: {
    findMany(): Promise<FakeSnapshot["rulePackImpactReports"]>;
  };
}

function snapshot(generation: number): FakeSnapshot {
  const createdAt = new Date(`2026-07-15T12:0${generation.toString()}:00.000Z`);
  return {
    localAccounts: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        email: `generation-${generation.toString()}@example.test`,
        displayName: `Generation ${generation.toString()}`,
        passwordHash: "$argon2id$v=19$m=1,t=1,p=1$c3ludGhldGlj$AAAAAAAAAAAAAAAAAAAAAA",
        role: "ADMIN",
        disabled: false,
        createdAt,
      },
    ],
    complianceSources: [{ payload: { generation, aggregate: "complianceSource" } }],
    complianceSourceVersions: [{ payload: { generation, aggregate: "complianceSourceVersion" } }],
    complianceSourceTransitions: [
      { payload: { generation, aggregate: "complianceSourceTransition" } },
    ],
    ruleCards: [{ payload: { generation, aggregate: "ruleCard" } }],
    ruleCardRevisions: [{ payload: { generation, aggregate: "ruleCardRevision" } }],
    ruleCardAudit: [
      {
        id: "00000000-0000-4000-8000-000000000002",
        revisionId: "00000000-0000-4000-8000-000000000003",
        sequence: generation,
        kind: "TRANSITION",
        actorId: "00000000-0000-4000-8000-000000000004",
        payload: { generation, aggregate: "ruleCardAudit" },
        createdAt,
      },
    ],
    rulePackDrafts: [{ payload: { generation, aggregate: "rulePackDraft" } }],
    rulePackDraftContributors: [
      {
        draftId: "00000000-0000-4000-8000-000000000005",
        actorId: "00000000-0000-4000-8000-000000000006",
      },
    ],
    rulePackVersions: [{ payload: { generation, aggregate: "rulePackVersion" } }],
    rulePackVersionExcludedActivators: [
      {
        versionId: "00000000-0000-4000-8000-000000000007",
        actorId: "00000000-0000-4000-8000-000000000008",
      },
    ],
    rulePackDraftPublications: [
      {
        draftId: "00000000-0000-4000-8000-000000000005",
        publishedVersionId: "00000000-0000-4000-8000-000000000007",
      },
    ],
    activationEvents: [{ payload: { generation, aggregate: "activationEvent" } }],
    evaluationRuns: [{ payload: { generation } }],
    reviewDecisions: [{ payload: { generation } }],
    blobObjects: [
      {
        sha256: generation.toString().repeat(64),
        byteLength: generation,
        mediaType: "application/octet-stream",
        path: `generation-${generation.toString()}`,
        createdAt,
      },
    ],
    idempotencyRecords: [
      {
        scope: `generation-${generation.toString()}`,
        key: "backup-test",
        requestHash: generation.toString().repeat(64),
        responseHash: generation.toString().repeat(64),
        response: { generation },
        createdAt,
        expiresAt: new Date("2026-07-16T12:00:00.000Z"),
      },
    ],
    ruleTestRuns: [{ payload: { generation, aggregate: "ruleTestRun" } }],
    rulePackImpactReports: [
      {
        id: "00000000-0000-4000-8000-000000000009",
        contentHash: "a".repeat(64),
        validationScope: "TECHNICAL_DEMO",
        payload: { generation, aggregate: "rulePackImpactReport" },
        createdAt,
      },
    ],
  };
}

describe("storage backup", () => {
  it("reads every table from one repeatable-read snapshot", async () => {
    let live = snapshot(1);
    let isolationLevel: string | undefined;
    const client = {
      async $transaction(
        operation: (transaction: FakeTransaction) => Promise<unknown>,
        options: { readonly isolationLevel?: string },
      ): Promise<unknown> {
        isolationLevel = options.isolationLevel;
        const captured = live;
        const transaction: FakeTransaction = {
          localAccount: {
            findMany(): Promise<FakeSnapshot["localAccounts"]> {
              live = snapshot(2);
              return Promise.resolve(captured.localAccounts);
            },
          },
          complianceSourceRecord: {
            findMany: () => Promise.resolve(captured.complianceSources),
          },
          complianceSourceVersionRecord: {
            findMany: () => Promise.resolve(captured.complianceSourceVersions),
          },
          complianceSourceTransitionRecord: {
            findMany: () => Promise.resolve(captured.complianceSourceTransitions),
          },
          ruleCardRecord: {
            findMany: () => Promise.resolve(captured.ruleCards),
          },
          ruleCardRevisionRecord: {
            findMany: () => Promise.resolve(captured.ruleCardRevisions),
          },
          ruleCardAuditRecord: {
            findMany: () => Promise.resolve(captured.ruleCardAudit),
          },
          rulePackDraftRecord: {
            findMany: () => Promise.resolve(captured.rulePackDrafts),
          },
          rulePackDraftContributorRecord: {
            findMany: () => Promise.resolve(captured.rulePackDraftContributors),
          },
          rulePackVersionRecord: {
            findMany: () => Promise.resolve(captured.rulePackVersions),
          },
          rulePackVersionExcludedActivatorRecord: {
            findMany: () => Promise.resolve(captured.rulePackVersionExcludedActivators),
          },
          rulePackDraftPublicationRecord: {
            findMany: () => Promise.resolve(captured.rulePackDraftPublications),
          },
          activationEventRecord: {
            findMany: () => Promise.resolve(captured.activationEvents),
          },
          evaluationRunRecord: {
            findMany(): Promise<FakeSnapshot["evaluationRuns"]> {
              return Promise.resolve(captured.evaluationRuns);
            },
          },
          reviewDecisionRecord: {
            findMany: () => Promise.resolve(captured.reviewDecisions),
          },
          blobObject: {
            findMany: () => Promise.resolve(captured.blobObjects),
          },
          idempotencyRecord: {
            findMany: () => Promise.resolve(captured.idempotencyRecords),
          },
          ruleTestRunRecord: {
            findMany: () => Promise.resolve(captured.ruleTestRuns),
          },
          rulePackImpactReportRecord: {
            findMany: () => Promise.resolve(captured.rulePackImpactReports),
          },
        };
        return operation(transaction);
      },
    };

    const backup = await exportStorageBackup(
      client as unknown as VeraPrismaClient,
      "2026-07-15T12:30:00.000Z",
    );

    expect(isolationLevel).toBe("RepeatableRead");
    expect(live.evaluationRuns).toEqual([{ payload: { generation: 2 } }]);
    expect(backup.schemaVersion).toBe("vera.storage-backup/v3");
    expect(backup.localAccounts).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000001",
        email: "generation-1@example.test",
        displayName: "Generation 1",
        passwordHash: "$argon2id$v=19$m=1,t=1,p=1$c3ludGhldGlj$AAAAAAAAAAAAAAAAAAAAAA",
        role: "ADMIN",
        disabled: false,
        createdAt: "2026-07-15T12:01:00.000Z",
      },
    ]);
    expect(backup.complianceSources).toEqual([{ generation: 1, aggregate: "complianceSource" }]);
    expect(backup.rulePackDraftContributors).toEqual([
      {
        draftId: "00000000-0000-4000-8000-000000000005",
        actorId: "00000000-0000-4000-8000-000000000006",
      },
    ]);
    expect(backup.evaluationRuns).toEqual([{ generation: 1 }]);
    expect(backup.reviewDecisions).toEqual([{ generation: 1 }]);
    expect(backup.blobObjects).toEqual([
      {
        sha256: "1".repeat(64),
        byteLength: 1,
        mediaType: "application/octet-stream",
        path: "generation-1",
        createdAt: "2026-07-15T12:01:00.000Z",
      },
    ]);
    expect(backup.idempotencyRecords).toEqual([
      {
        scope: "generation-1",
        key: "backup-test",
        requestHash: "1".repeat(64),
        responseHash: "1".repeat(64),
        response: { generation: 1 },
        createdAt: "2026-07-15T12:01:00.000Z",
        expiresAt: "2026-07-16T12:00:00.000Z",
      },
    ]);
    expect(backup.ruleTestRuns).toEqual([{ generation: 1, aggregate: "ruleTestRun" }]);
  });
});
