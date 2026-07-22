import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  EvaluationRunSchema,
  ReviewDecisionSchema,
  sha256Bytes,
  sha256CanonicalJson,
} from "@vera/contracts";
import type { EvaluationRun, ReviewDecision } from "@vera/contracts";
import { runDemoMvp } from "@vera/demo-mvp";
import { buildReviewDecision } from "@vera/rules-core";
import {
  VeraStorageRepository,
  canonicalizeStorageBackup,
  createPrismaClient,
  exportStorageBackup,
} from "@vera/storage";
import type { VeraPrismaClient } from "@vera/storage";
import type { FastifyInstance } from "fastify";
import { GenericContainer, Wait } from "testcontainers";
import type { StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createApiServer } from "../../src/index.js";

const storageRoot = fileURLToPath(new URL("../../../../packages/storage", import.meta.url));
const NOW = "2026-07-15T12:00:00.000Z";
const BOOTSTRAP_TOKEN = "mvp-bootstrap-token";
const ADMIN_PASSWORD = "mvp-admin-password";
const AUTHOR_PASSWORD = "mvp-author-password";
const REVIEWER_PASSWORD = "mvp-reviewer-password";

const AccountSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  role: z.enum(["AUTHOR", "REVIEWER", "APPROVER", "ADMIN"]),
});
type ApiAccount = z.infer<typeof AccountSchema>;
const AccountResponseSchema = z.object({ account: AccountSchema });
const SessionResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.iso.datetime(),
  account: AccountSchema,
});
const EvaluationRunResponseSchema = z.object({ evaluationRun: EvaluationRunSchema });
const ReviewDecisionResponseSchema = z.object({ reviewDecision: ReviewDecisionSchema });
const BackupIdempotencySchema = z.object({
  requestHash: z.string().regex(/^[0-9a-f]{64}$/u),
});

function reboundDecision(input: {
  readonly source: ReviewDecision;
  readonly run: EvaluationRun;
  readonly actorId: string;
  readonly exercisedRole: "REVIEWER" | "APPROVER";
  readonly id?: string;
  readonly reason?: string;
}): ReviewDecision {
  return buildReviewDecision({
    id: input.id ?? input.source.id,
    run: input.run,
    previousDecision: null,
    decision: input.source.decision,
    findingRuleId: input.source.findingRuleId,
    targetOutcome: input.source.targetOutcome,
    reason: input.reason ?? input.source.reason,
    decidedAt: input.source.decidedAt,
    actorId: input.actorId,
    exercisedRole: input.exercisedRole,
  });
}

describe("MVP through real API and PostgreSQL", () => {
  let container: StartedTestContainer | undefined;
  let prisma: VeraPrismaClient | undefined;
  let repository: VeraStorageRepository | undefined;
  let server: FastifyInstance | undefined;

  beforeAll(async () => {
    const externalUrl = process.env["VERA_TEST_DATABASE_URL"];
    let connectionString: string;
    if (externalUrl !== undefined && externalUrl.length > 0) {
      connectionString = externalUrl;
    } else {
      container = await new GenericContainer("pgvector/pgvector:0.8.5-pg17")
        .withEnvironment({
          POSTGRES_DB: "vera",
          POSTGRES_USER: "vera",
          POSTGRES_PASSWORD: "local-only",
        })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections", 2))
        .start();
      connectionString = `postgresql://vera:local-only@${container.getHost()}:${container.getMappedPort(5432).toString()}/vera`;
    }
    execFileSync("pnpm", ["migrate:deploy"], {
      cwd: storageRoot,
      env: { ...process.env, DATABASE_URL: connectionString },
      stdio: "pipe",
    });
    prisma = createPrismaClient({ connectionString });
    if (externalUrl !== undefined && externalUrl.length > 0) {
      await prisma.$executeRawUnsafe(`
        TRUNCATE TABLE
          "review_decisions",
          "evaluation_runs",
          "idempotency_records",
          "blob_objects",
          "sessions",
          "local_accounts"
        RESTART IDENTITY CASCADE
      `);
    }
    repository = new VeraStorageRepository(prisma);
    server = await createApiServer({
      repository,
      bootstrapTokenHash: sha256Bytes(Buffer.from(BOOTSTRAP_TOKEN, "utf8")),
      now: () => NOW,
    });
  }, 120_000);

  afterAll(async () => {
    if (server !== undefined) await server.close();
    if (prisma !== undefined) await prisma.$disconnect();
    if (container !== undefined) await container.stop();
  });

  it("persists and replays all 20 synthetic runs and reviews through real auth", async () => {
    if (server === undefined || repository === undefined || prisma === undefined) {
      throw new Error("Integration setup did not complete");
    }
    const api = server;
    const storage = repository;
    const database = prisma;

    const bootstrap = await api.inject({
      method: "POST",
      url: "/v1/accounts",
      headers: { authorization: `Bootstrap ${BOOTSTRAP_TOKEN}` },
      payload: {
        email: "admin@mvp.example.test",
        displayName: "MVP Admin",
        password: ADMIN_PASSWORD,
        role: "ADMIN",
      },
    });
    expect(bootstrap.statusCode).toBe(201);
    const administrator = AccountResponseSchema.parse(bootstrap.json()).account;

    const adminLogin = await api.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { email: administrator.email, password: ADMIN_PASSWORD },
    });
    expect(adminLogin.statusCode).toBe(201);
    const adminToken = SessionResponseSchema.parse(adminLogin.json()).token;

    const createAccount = async (input: {
      readonly email: string;
      readonly displayName: string;
      readonly password: string;
      readonly role: "AUTHOR" | "REVIEWER";
    }): Promise<ApiAccount> => {
      const response = await api.inject({
        method: "POST",
        url: "/v1/accounts",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: input,
      });
      expect(response.statusCode).toBe(201);
      return AccountResponseSchema.parse(response.json()).account;
    };
    const author = await createAccount({
      email: "author@mvp.example.test",
      displayName: "MVP Author",
      password: AUTHOR_PASSWORD,
      role: "AUTHOR",
    });
    const reviewer = await createAccount({
      email: "reviewer@mvp.example.test",
      displayName: "MVP Reviewer",
      password: REVIEWER_PASSWORD,
      role: "REVIEWER",
    });

    const secondBootstrap = await api.inject({
      method: "POST",
      url: "/v1/accounts",
      headers: { authorization: `Bootstrap ${BOOTSTRAP_TOKEN}` },
      payload: {
        email: "second-admin@mvp.example.test",
        displayName: "Second MVP Admin",
        password: ADMIN_PASSWORD,
        role: "ADMIN",
      },
    });
    expect(secondBootstrap.statusCode).toBe(409);

    const login = async (email: string, password: string): Promise<string> => {
      const response = await api.inject({
        method: "POST",
        url: "/v1/sessions",
        payload: { email, password },
      });
      expect(response.statusCode).toBe(201);
      return SessionResponseSchema.parse(response.json()).token;
    };
    const authorToken = await login(author.email, AUTHOR_PASSWORD);
    const reviewerToken = await login(reviewer.email, REVIEWER_PASSWORD);
    const demo = await runDemoMvp();

    expect(demo.cases).toHaveLength(20);
    expect(demo.report.evaluation.outcomeCounts).toEqual({
      PASS: 5,
      FAIL: 5,
      REVIEW: 5,
      NOT_APPLICABLE: 5,
    });

    let firstRunResponse: unknown;
    for (const [index, item] of demo.cases.entries()) {
      const run = item.auditExport.run;
      const key = `mvp-run-${index.toString().padStart(4, "0")}`;
      const created = await api.inject({
        method: "POST",
        url: "/v1/evaluation-runs",
        headers: { authorization: `Bearer ${authorToken}`, "idempotency-key": key },
        payload: run,
      });
      expect(created.statusCode).toBe(201);
      const saved = EvaluationRunResponseSchema.parse(created.json()).evaluationRun;
      expect(saved.contentHash).toBe(run.contentHash);
      expect(saved.evaluationSnapshot.contentHash).toBe(run.evaluationSnapshot.contentHash);

      const fetched = await api.inject({
        method: "GET",
        url: `/v1/evaluation-runs/${run.id}`,
        headers: { authorization: `Bearer ${authorToken}` },
      });
      expect(fetched.statusCode).toBe(200);
      expect(EvaluationRunResponseSchema.parse(fetched.json()).evaluationRun).toEqual(saved);

      if (index === 0) {
        firstRunResponse = created.json();
        const replay = await api.inject({
          method: "POST",
          url: "/v1/evaluation-runs",
          headers: { authorization: `Bearer ${authorToken}`, "idempotency-key": key },
          payload: run,
        });
        expect(replay.statusCode).toBe(201);
        expect(replay.json()).toEqual(firstRunResponse);

        const notYetStored = demo.cases[1]?.auditExport.run;
        if (notYetStored === undefined) throw new Error("MVP corpus has no second run");
        const collision = await api.inject({
          method: "POST",
          url: "/v1/evaluation-runs",
          headers: { authorization: `Bearer ${authorToken}`, "idempotency-key": key },
          payload: notYetStored,
        });
        expect(collision.statusCode).toBe(409);
        expect(await database.evaluationRunRecord.count({ where: { id: notYetStored.id } })).toBe(
          0,
        );
      }
    }
    expect(await database.evaluationRunRecord.count()).toBe(20);

    let firstDecisionResponse: unknown;
    for (const [index, item] of demo.cases.entries()) {
      const source = item.auditExport.reviewDecisions[0];
      if (source === undefined) throw new Error(`MVP case ${item.caseId} has no review`);
      const decision = reboundDecision({
        source,
        run: item.auditExport.run,
        actorId: reviewer.id,
        exercisedRole: "REVIEWER",
      });
      const key = `mvp-review-${index.toString().padStart(4, "0")}`;

      if (index === 0) {
        const wrongActor = reboundDecision({
          source,
          run: item.auditExport.run,
          actorId: administrator.id,
          exercisedRole: "REVIEWER",
          id: randomUUID(),
        });
        const actorMismatch = await api.inject({
          method: "POST",
          url: `/v1/evaluation-runs/${decision.runId}/review-decisions`,
          headers: { authorization: `Bearer ${reviewerToken}`, "idempotency-key": key },
          payload: wrongActor,
        });
        expect(actorMismatch.statusCode).toBe(403);

        const wrongRole = reboundDecision({
          source,
          run: item.auditExport.run,
          actorId: reviewer.id,
          exercisedRole: "APPROVER",
          id: randomUUID(),
        });
        const roleMismatch = await api.inject({
          method: "POST",
          url: `/v1/evaluation-runs/${decision.runId}/review-decisions`,
          headers: { authorization: `Bearer ${reviewerToken}`, "idempotency-key": key },
          payload: wrongRole,
        });
        expect(roleMismatch.statusCode).toBe(403);
        expect(await storage.listReviewDecisions(decision.runId)).toHaveLength(0);
      }

      const created = await api.inject({
        method: "POST",
        url: `/v1/evaluation-runs/${decision.runId}/review-decisions`,
        headers: { authorization: `Bearer ${reviewerToken}`, "idempotency-key": key },
        payload: decision,
      });
      expect(created.statusCode).toBe(201);
      const saved = ReviewDecisionResponseSchema.parse(created.json()).reviewDecision;
      expect(saved.contentHash).toBe(decision.contentHash);
      expect(saved.sequence).toBe(1);
      expect(saved.previousEventHash).toBeNull();
      expect(await storage.listReviewDecisions(decision.runId)).toEqual([saved]);

      if (index === 0) {
        firstDecisionResponse = created.json();
        const replay = await api.inject({
          method: "POST",
          url: `/v1/evaluation-runs/${decision.runId}/review-decisions`,
          headers: { authorization: `Bearer ${reviewerToken}`, "idempotency-key": key },
          payload: decision,
        });
        expect(replay.statusCode).toBe(201);
        expect(replay.json()).toEqual(firstDecisionResponse);

        const alternative = reboundDecision({
          source,
          run: item.auditExport.run,
          actorId: reviewer.id,
          exercisedRole: "REVIEWER",
          id: randomUUID(),
          reason: "A different valid review request must not mutate the stream.",
        });
        const collision = await api.inject({
          method: "POST",
          url: `/v1/evaluation-runs/${decision.runId}/review-decisions`,
          headers: { authorization: `Bearer ${reviewerToken}`, "idempotency-key": key },
          payload: alternative,
        });
        expect(collision.statusCode).toBe(409);
        expect(await storage.listReviewDecisions(decision.runId)).toHaveLength(1);
      }
    }

    const backup = await exportStorageBackup(database, "2026-07-15T12:30:00.000Z");
    const persistedRuns = backup.evaluationRuns.map((run) => EvaluationRunSchema.parse(run));
    const persistedDecisions = backup.reviewDecisions.map((decision) =>
      ReviewDecisionSchema.parse(decision),
    );
    const outcomeCounts = { PASS: 0, FAIL: 0, REVIEW: 0, NOT_APPLICABLE: 0 };
    for (const run of persistedRuns) {
      outcomeCounts[run.evaluationSnapshot.evaluationResult.aggregateOutcome] += 1;
    }
    const { contentHash, ...hashInput } = backup;

    expect(persistedRuns).toHaveLength(20);
    expect(persistedDecisions).toHaveLength(20);
    expect(new Set(persistedRuns.map(({ id }) => id)).size).toBe(20);
    expect(new Set(persistedDecisions.map(({ id }) => id)).size).toBe(20);
    expect(outcomeCounts).toEqual({ PASS: 5, FAIL: 5, REVIEW: 5, NOT_APPLICABLE: 5 });
    expect(backup.idempotencyRecords).toHaveLength(40);
    for (const record of backup.idempotencyRecords) BackupIdempotencySchema.parse(record);
    expect(sha256CanonicalJson(hashInput)).toBe(contentHash);
    expect(canonicalizeStorageBackup(backup)).toContain("vera.storage-backup/v3");
  }, 120_000);
});
