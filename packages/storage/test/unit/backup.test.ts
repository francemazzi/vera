import type { JsonValue } from "@vera/contracts";
import { describe, expect, it } from "vitest";

import { exportStorageBackup } from "../../src/index.js";
import type { VeraPrismaClient } from "../../src/index.js";

interface FakeSnapshot {
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
}

interface FakeTransaction {
  readonly evaluationRunRecord: { findMany(): Promise<FakeSnapshot["evaluationRuns"]> };
  readonly reviewDecisionRecord: { findMany(): Promise<FakeSnapshot["reviewDecisions"]> };
  readonly blobObject: { findMany(): Promise<FakeSnapshot["blobObjects"]> };
  readonly idempotencyRecord: { findMany(): Promise<FakeSnapshot["idempotencyRecords"]> };
}

function snapshot(generation: number): FakeSnapshot {
  const createdAt = new Date(`2026-07-15T12:0${generation.toString()}:00.000Z`);
  return {
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
          evaluationRunRecord: {
            findMany(): Promise<FakeSnapshot["evaluationRuns"]> {
              live = snapshot(2);
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
  });
});
