import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { sha256CanonicalJson } from "@vera/contracts";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  VeraStorageRepository,
  canonicalizeStorageBackup,
  createPrismaClient,
  exportStorageBackup,
} from "../../src/index.js";
import type { VeraPrismaClient } from "../../src/index.js";
import { makeEvaluationRun, makeReviewDecision, uuid } from "../fixtures/evaluation.js";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const BackupIdempotencySchema = z.object({
  requestHash: z.string().regex(/^[0-9a-f]{64}$/u),
});

describe("PostgreSQL storage integration", () => {
  let container: StartedTestContainer;
  let prisma: VeraPrismaClient;
  let repository: VeraStorageRepository;

  beforeAll(async () => {
    container = await new GenericContainer("pgvector/pgvector:0.8.5-pg17")
      .withEnvironment({
        POSTGRES_DB: "vera",
        POSTGRES_USER: "vera",
        POSTGRES_PASSWORD: "local-only",
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections", 2))
      .start();
    const connectionString = `postgresql://vera:local-only@${container.getHost()}:${container.getMappedPort(5432).toString()}/vera`;
    execFileSync("pnpm", ["migrate:deploy"], {
      cwd: packageRoot,
      env: { ...process.env, DATABASE_URL: connectionString },
      stdio: "pipe",
    });
    prisma = createPrismaClient({ connectionString });
    repository = new VeraStorageRepository(prisma);
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  it("allows exactly one ADMIN bootstrap during a concurrent first-account race", async () => {
    const candidates = [uuid(82), uuid(83)].map((id, index) =>
      repository.bootstrapAdminAccount({
        id,
        email: `bootstrap-${index.toString()}@example.test`,
        displayName: `Bootstrap ${index.toString()}`,
        passwordHash: "$argon2id$v=19$m=1,t=1,p=1$c3ludGhldGlj$AAAAAAAAAAAAAAAAAAAAAA",
        role: "ADMIN",
        createdAt: "2026-07-15T11:59:00.000Z",
      }),
    );

    const results = await Promise.allSettled(candidates);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(await prisma.localAccount.count()).toBe(1);
    await expect(
      repository.bootstrapAdminAccount({
        id: uuid(84),
        email: "late-bootstrap@example.test",
        displayName: "Late bootstrap",
        passwordHash: "$argon2id$v=19$m=1,t=1,p=1$c3ludGhldGlj$AAAAAAAAAAAAAAAAAAAAAA",
        role: "ADMIN",
        createdAt: "2026-07-15T11:59:01.000Z",
      }),
    ).rejects.toThrow("no longer available");
  });

  it("persists accounts, sessions, immutable runs, review decisions and idempotency records", async () => {
    const account = await repository.createAccount({
      id: uuid(80),
      email: "Reviewer@example.test",
      displayName: "Synthetic Reviewer",
      passwordHash: "$argon2id$v=19$m=1,t=1,p=1$c3ludGhldGlj$AAAAAAAAAAAAAAAAAAAAAA",
      role: "REVIEWER",
      createdAt: "2026-07-15T12:00:00.000Z",
    });
    const session = await repository.createSession({
      id: uuid(81),
      tokenHash: "d".repeat(64),
      accountId: account.id,
      createdAt: "2026-07-15T12:00:00.000Z",
      expiresAt: "2026-07-15T13:00:00.000Z",
    });
    const run = await repository.saveEvaluationRun(makeEvaluationRun());
    const decision = await repository.appendReviewDecision(makeReviewDecision(run));
    const idempotent = await repository.getOrCreateIdempotency({
      scope: "test",
      key: "idem-key-0001",
      requestHash: "e".repeat(64),
      response: { ok: true },
      createdAt: "2026-07-15T12:00:00.000Z",
      expiresAt: "2026-07-16T12:00:00.000Z",
    });

    expect(account.email).toBe("reviewer@example.test");
    expect(session.accountId).toBe(account.id);
    expect((await repository.getEvaluationRun(run.id)).contentHash).toBe(run.contentHash);
    expect((await repository.listReviewDecisions(run.id))[0]?.contentHash).toBe(
      decision.contentHash,
    );
    expect(idempotent.created).toBe(true);
  });

  it("atomically replays run writes and rejects key collisions before mutation", async () => {
    const run = makeEvaluationRun(uuid(32));
    const input = {
      run,
      scope: "accounts:author:evaluation-runs",
      key: "atomic-run-0001",
      createdAt: "2026-07-15T12:10:00.000Z",
      expiresAt: "2026-07-16T12:10:00.000Z",
    } as const;

    const [first, replay] = await Promise.all([
      repository.saveEvaluationRunIdempotently(input),
      repository.saveEvaluationRunIdempotently(input),
    ]);
    expect([first.created, replay.created].sort()).toEqual([false, true]);
    expect(first.response).toEqual(replay.response);
    expect(await prisma.evaluationRunRecord.count({ where: { id: run.id } })).toBe(1);

    const collision = makeEvaluationRun(uuid(33));
    await expect(
      repository.saveEvaluationRunIdempotently({ ...input, run: collision }),
    ).rejects.toThrow("different request");
    expect(await prisma.evaluationRunRecord.count({ where: { id: collision.id } })).toBe(0);
  });

  it("falls back to the historical evaluation scope without mutating on mismatch", async () => {
    const run = await repository.saveEvaluationRun(makeEvaluationRun(uuid(34)));
    const response = { evaluationRun: run };
    await prisma.idempotencyRecord.create({
      data: {
        scope: "evaluation-runs:create",
        key: "legacy-run-0001",
        requestHash: null,
        responseHash: sha256CanonicalJson(response),
        response: response as never,
        createdAt: new Date("2026-07-15T12:11:00.000Z"),
        expiresAt: new Date("2026-07-16T12:11:00.000Z"),
      },
    });

    const replay = await repository.saveEvaluationRunIdempotently({
      run,
      scope: "accounts:legacy-author:evaluation-runs",
      key: "legacy-run-0001",
      createdAt: "2026-07-15T12:11:00.000Z",
      expiresAt: "2026-07-16T12:11:00.000Z",
    });
    expect(replay.created).toBe(false);
    expect(replay.response).toEqual(response);
    await expect(
      repository.saveEvaluationRunIdempotently({
        run: makeEvaluationRun(uuid(35)),
        scope: "accounts:legacy-author:evaluation-runs",
        key: "legacy-run-0001",
        createdAt: "2026-07-15T12:11:00.000Z",
        expiresAt: "2026-07-16T12:11:00.000Z",
      }),
    ).rejects.toThrow("replayed safely");
    expect(await prisma.evaluationRunRecord.count({ where: { id: uuid(35) } })).toBe(0);

    const unsafeRun = makeEvaluationRun(uuid(37));
    const unsafeResponse = { evaluationRun: unsafeRun };
    await prisma.idempotencyRecord.create({
      data: {
        scope: "evaluation-runs:create",
        key: "legacy-run-unsafe-0002",
        requestHash: "f".repeat(64),
        responseHash: sha256CanonicalJson(unsafeResponse),
        response: unsafeResponse as never,
        createdAt: new Date("2026-07-15T12:11:00.000Z"),
        expiresAt: new Date("2026-07-16T12:11:00.000Z"),
      },
    });
    await expect(
      repository.saveEvaluationRunIdempotently({
        run: unsafeRun,
        scope: "accounts:legacy-author:evaluation-runs",
        key: "legacy-run-unsafe-0002",
        createdAt: "2026-07-15T12:11:00.000Z",
        expiresAt: "2026-07-16T12:11:00.000Z",
      }),
    ).rejects.toThrow("replayed safely");
    expect(await prisma.evaluationRunRecord.count({ where: { id: unsafeRun.id } })).toBe(0);

    const corruptRun = makeEvaluationRun(uuid(39));
    const corruptResponse = { evaluationRun: corruptRun };
    await prisma.idempotencyRecord.create({
      data: {
        scope: "evaluation-runs:create",
        key: "legacy-run-corrupt-0003",
        requestHash: null,
        responseHash: "0".repeat(64),
        response: corruptResponse as never,
        createdAt: new Date("2026-07-15T12:11:00.000Z"),
        expiresAt: new Date("2026-07-16T12:11:00.000Z"),
      },
    });
    await expect(
      repository.saveEvaluationRunIdempotently({
        run: corruptRun,
        scope: "accounts:legacy-author:evaluation-runs",
        key: "legacy-run-corrupt-0003",
        createdAt: "2026-07-15T12:11:00.000Z",
        expiresAt: "2026-07-16T12:11:00.000Z",
      }),
    ).rejects.toThrow("replayed safely");
    expect(await prisma.evaluationRunRecord.count({ where: { id: corruptRun.id } })).toBe(0);
  });

  it("falls back to the historical review scope before validating the stale chain", async () => {
    const run = await repository.saveEvaluationRun(makeEvaluationRun(uuid(38)));
    const decision = await repository.appendReviewDecision(makeReviewDecision(run, uuid(46)));
    const response = { reviewDecision: decision };
    await prisma.idempotencyRecord.create({
      data: {
        scope: `review-decisions:${run.id}`,
        key: "legacy-review-0001",
        requestHash: null,
        responseHash: sha256CanonicalJson(response),
        response: response as never,
        createdAt: new Date("2026-07-15T12:11:30.000Z"),
        expiresAt: new Date("2026-07-16T12:11:30.000Z"),
      },
    });

    const input = {
      decision,
      scope: `accounts:legacy-reviewer:evaluation-runs:${run.id}:review-decisions`,
      key: "legacy-review-0001",
      createdAt: "2026-07-15T12:11:30.000Z",
      expiresAt: "2026-07-16T12:11:30.000Z",
    } as const;
    const replay = await repository.appendReviewDecisionIdempotently(input);
    expect(replay).toEqual({ response, created: false });

    await expect(
      repository.appendReviewDecisionIdempotently({
        ...input,
        decision: makeReviewDecision(run, uuid(47)),
      }),
    ).rejects.toThrow("replayed safely");
    expect(await repository.listReviewDecisions(run.id)).toEqual([decision]);
  });

  it("atomically replays review writes before checking a now-stale chain", async () => {
    const run = await repository.saveEvaluationRun(makeEvaluationRun(uuid(36)));
    const decision = makeReviewDecision(run, uuid(44));
    const input = {
      decision,
      scope: `accounts:reviewer:evaluation-runs:${run.id}:review-decisions`,
      key: "atomic-review-0001",
      createdAt: "2026-07-15T12:12:00.000Z",
      expiresAt: "2026-07-16T12:12:00.000Z",
    } as const;

    const [first, replay] = await Promise.all([
      repository.appendReviewDecisionIdempotently(input),
      repository.appendReviewDecisionIdempotently(input),
    ]);
    expect([first.created, replay.created].sort()).toEqual([false, true]);
    expect(first.response).toEqual(replay.response);
    expect(await repository.listReviewDecisions(run.id)).toHaveLength(1);

    const collision = makeReviewDecision(run, uuid(45));
    await expect(
      repository.appendReviewDecisionIdempotently({ ...input, decision: collision }),
    ).rejects.toThrow("different request");
    expect(await repository.listReviewDecisions(run.id)).toHaveLength(1);
  });

  it("rejects duplicate immutable runs and stale review chains", async () => {
    const run = await repository.saveEvaluationRun(makeEvaluationRun(uuid(31)));
    const decision = makeReviewDecision(run, uuid(42));
    await repository.appendReviewDecision(decision);

    await expect(repository.saveEvaluationRun(run)).rejects.toThrow("already exists");
    await expect(repository.appendReviewDecision(decision)).rejects.toThrow("non-contiguous");
  });

  it("exports a canonical backup after migration round trip", async () => {
    const backup = await exportStorageBackup(prisma, "2026-07-15T12:30:00.000Z");

    expect(backup.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      backup.idempotencyRecords.some((record) => BackupIdempotencySchema.safeParse(record).success),
    ).toBe(true);
    expect(canonicalizeStorageBackup(backup)).toContain("vera.storage-backup/v2");
  });
});
