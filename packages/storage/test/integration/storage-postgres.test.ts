import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  VeraStorageRepository,
  canonicalizeStorageBackup,
  createPrismaClient,
  exportStorageBackup,
} from "../../src/index.js";
import type { VeraPrismaClient } from "../../src/index.js";
import { makeEvaluationRun, makeReviewDecision, uuid } from "../fixtures/evaluation.js";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

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
    expect(canonicalizeStorageBackup(backup)).toContain("vera.storage-backup/v1");
  });
});
