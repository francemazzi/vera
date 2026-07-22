import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  ACTIVATION_EVENT_SCHEMA_VERSION,
  DSL_VERSION,
  RULE_PACK_IMPACT_SCHEMA_VERSION,
  RULE_PACK_SCHEMA_VERSION,
  RULE_TESTING_SCHEMA_VERSION,
  RuleDefinitionSchema,
  RulePackDraftSchema,
  RulePackImpactReportSchema,
  RuleTestRunResultSchema,
  computeActivationEventHash,
  computeRuleCardRevisionHash,
  computeRuleDefinitionHash,
  computeRulePackDraftHash,
  computeRulePackImpactReportHash,
  computeRuleTestRunResultHash,
  sha256CanonicalJson,
} from "@vera/contracts";
import type {
  ActivationEvent,
  ActivationEventHashInput,
  Actor,
  ComplianceSource,
  ComplianceSourceState,
  ComplianceSourceTransitionEvent,
  ComplianceSourceVersion,
  RuleCard,
  RuleCardApprovalDecision,
  RuleCardComment,
  RuleCardReviewDecision,
  RuleCardRevision,
  RuleCardRevisionHashInput,
  RuleCardTransitionEvent,
  RuleDefinition,
  RuleDefinitionHashInput,
  RulePackDraft,
  RulePackDraftHashInput,
  RulePackImpactReport,
  RulePackImpactReportHashInput,
  RulePackVersion,
  RuleTestRunResult,
  RuleTestRunResultHashInput,
} from "@vera/contracts";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DurableComplianceSourceRepository,
  DurableRuleCardRepository,
  DurableRulePackActivationLedger,
  DurableRulePackRepository,
  DurableRuleTestRunRepository,
  PrivateLabelGovernanceRepository,
  VeraStorageRepository,
  canonicalizeStorageBackup,
  createPrismaClient,
  exportStorageBackup,
  restoreStorageBackup,
} from "../../src/index.js";
import type { VeraPrismaClient } from "../../src/index.js";
import { makeEvaluationRun, makeReviewDecision, uuid } from "../fixtures/evaluation.js";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const BackupIdempotencySchema = z.object({
  requestHash: z.string().regex(/^[0-9a-f]{64}$/u),
});

describe("PostgreSQL storage integration", () => {
  let container: StartedTestContainer | undefined;
  let prisma: VeraPrismaClient;
  let repository: VeraStorageRepository;
  let privateGovernance: PrivateLabelGovernanceRepository;
  let complianceSources: DurableComplianceSourceRepository;

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
      cwd: packageRoot,
      env: { ...process.env, DATABASE_URL: connectionString },
      stdio: "pipe",
    });
    prisma = createPrismaClient({ connectionString });
    await clearIntegrationTables(prisma);
    repository = new VeraStorageRepository(prisma);
    privateGovernance = new PrivateLabelGovernanceRepository(prisma);
    complianceSources = new DurableComplianceSourceRepository(prisma);
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    if (container !== undefined) await container.stop();
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

  it("persists a private source, append-only activation and reproducible OpenRouter run", async () => {
    const source = await privateGovernance.createSourceVersion({
      source: {
        id: uuid(301),
        stableReference: "eu-label-private-source-001",
        title: "Private regulatory source",
        jurisdiction: "EU",
      },
      version: {
        id: uuid(302),
        revision: 1,
        contentHash: "1".repeat(64),
        contentObjectRef: "gs://private-governance/sources/001.pdf",
      },
      actorId: uuid(303),
      actorRole: "SYNC_AGENT",
      createdAt: "2026-07-18T10:00:00.000Z",
    });
    expect(source.state).toBe("UNVERIFIED");
    expect(await prisma.privateLabelSourceTransition.count()).toBe(1);

    const sourceSnapshotHash = "2".repeat(64);
    const rulePack = await privateGovernance.saveRulePackSnapshot({
      id: uuid(304),
      version: "eu-private-v1",
      sourceSnapshotHash,
      snapshot: { sourceVersionIds: [uuid(302)], controlCount: 24 },
      createdByActorId: uuid(305),
      createdAt: "2026-07-18T10:01:00.000Z",
    });
    const activated = await privateGovernance.appendRulePackActivation({
      rulePackVersionId: rulePack.id,
      action: "ACTIVATED",
      countryCodes: ["IT", "FR"],
      actorId: uuid(306),
      reason: "Synthetic private integration verification",
      createdAt: "2026-07-18T10:02:00.000Z",
    });
    const deactivated = await privateGovernance.appendRulePackActivation({
      rulePackVersionId: rulePack.id,
      action: "DEACTIVATED",
      countryCodes: ["IT", "FR"],
      actorId: uuid(306),
      reason: "Synthetic rollback verification",
      createdAt: "2026-07-18T10:03:00.000Z",
    });
    expect(activated.sequence).toBe(1);
    expect(deactivated.sequence).toBe(2);

    const run = await privateGovernance.saveEvaluationRun({
      id: uuid(307),
      externalAnalysisId: uuid(308),
      inputSha256: "3".repeat(64),
      provider: "openrouter",
      model: "provider/private-vision-model",
      promptVersion: "label-v1",
      rulePackVersionId: rulePack.id,
      sourceSnapshotHash,
      controls: [{ fieldCode: "elenco_ingredienti", outcome: "REVIEW" }],
      evidenceRefs: [{ kind: "NORMALIZED_PAGE_1", sha256: "4".repeat(64) }],
      createdAt: "2026-07-18T10:04:00.000Z",
    });
    expect(run.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    const persistedRun = await prisma.privateLabelEvaluationRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(persistedRun).toMatchObject({
      inputSha256: "3".repeat(64),
      provider: "openrouter",
      model: "provider/private-vision-model",
      promptVersion: "label-v1",
      rulePackVersionId: rulePack.id,
      sourceSnapshotHash,
    });
    expect(persistedRun.controls).toEqual([{ fieldCode: "elenco_ingredienti", outcome: "REVIEW" }]);
    await expect(
      privateGovernance.saveEvaluationRun({
        id: uuid(309),
        externalAnalysisId: uuid(308),
        inputSha256: "3".repeat(64),
        provider: "openrouter",
        model: "provider/private-vision-model",
        promptVersion: "label-v1",
        rulePackVersionId: rulePack.id,
        sourceSnapshotHash: "5".repeat(64),
        controls: [],
        evidenceRefs: [],
        createdAt: "2026-07-18T10:04:00.000Z",
      }),
    ).rejects.toThrow("does not match");
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

  it("persists durable compliance source lifecycle and activation eligibility", async () => {
    const context = makeDurableDomainContext();
    const source = makeComplianceSource(context);
    const version = makeComplianceVersion(context);

    await expect(complianceSources.getSource(source.id)).rejects.toThrow("does not exist");
    await expect(complianceSources.addSource(source)).resolves.toEqual(source);
    await expect(complianceSources.addSource(source)).rejects.toThrow("already exists");
    await expect(complianceSources.appendVersion(version, 0)).resolves.toEqual(version);
    await expect(
      complianceSources.appendVersion(
        makeComplianceVersion(context, { id: randomUUID(), sourceId: randomUUID() }),
        0,
      ),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
    await expect(
      complianceSources.appendVersion(
        makeComplianceVersion(context, {
          id: randomUUID(),
          revision: 2,
          contentHash: digest(`stale-version-${context.namespace}`),
          replacesVersionId: version.id,
          replacementReason: "Stale synthetic replacement",
          versionLabel: "synthetic-v2",
        }),
        0,
      ),
    ).rejects.toMatchObject({ code: "VERSION_REVISION_CONFLICT" });

    const uploaded = makeComplianceTransition(context, version, "UPLOADED", {
      sequence: 1,
      from: null,
      actor: context.author,
      at: context.times.uploaded,
    });
    const reviewed = makeComplianceTransition(context, version, "REVIEWED", {
      sequence: 2,
      from: "UPLOADED",
      actor: context.reviewer,
      at: context.times.reviewed,
    });
    const approved = makeComplianceTransition(context, version, "APPROVED", {
      sequence: 3,
      from: "REVIEWED",
      actor: context.approver,
      at: context.times.approved,
    });

    await complianceSources.appendTransition(
      uploaded,
      { actor: context.author },
      {
        sequence: 0,
        state: null,
      },
    );
    await complianceSources.appendTransition(
      reviewed,
      { actor: context.reviewer },
      {
        sequence: 1,
        state: "UPLOADED",
      },
    );
    await complianceSources.appendTransition(
      approved,
      { actor: context.approver },
      {
        sequence: 2,
        state: "REVIEWED",
      },
    );
    await expect(
      complianceSources.appendTransition(
        approved,
        { actor: context.approver },
        {
          sequence: 3,
          state: "APPROVED",
        },
      ),
    ).rejects.toThrow(/already exists|TRANSITION_ALREADY_EXISTS/u);

    expect(await complianceSources.getSource(source.id)).toEqual(source);
    expect(await complianceSources.getVersion(version.id)).toEqual(version);
    expect(await complianceSources.getVersions(source.id)).toEqual([version]);
    expect(await complianceSources.getVersionState(version.id)).toBe("APPROVED");
    await expect(complianceSources.getVersion(randomUUID())).rejects.toMatchObject({
      code: "VERSION_NOT_FOUND",
    });
    await expect(
      complianceSources.appendTransition(
        makeComplianceTransition(context, { ...version, id: randomUUID() }, "UPLOADED", {
          sequence: 1,
          from: null,
          actor: context.author,
          at: context.times.uploaded,
        }),
        { actor: context.author },
        { sequence: 0, state: null },
      ),
    ).rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });
    expect(await complianceSources.getVersionStateAt(version.id, context.times.created)).toBeNull();
    expect(await complianceSources.getVersionStateAt(version.id, context.times.reviewed)).toBe(
      "REVIEWED",
    );
    expect(await complianceSources.getTransitionHistory(version.id)).toEqual([
      uploaded,
      reviewed,
      approved,
    ]);
    expect(await complianceSources.getSourceHistory(source.id)).toMatchObject({
      source,
      versions: [{ version, state: "APPROVED" }],
    });
    await expect(
      complianceSources.assertVersionEligibleForActivation({
        versionId: version.id,
        activationAt: context.times.approved,
        evaluationDate: context.times.evaluation,
        expectedContentHash: version.contentHash,
      }),
    ).resolves.toEqual(version);
  });

  it("persists durable Rule Card audit workflow and eligibility checks", async () => {
    const seeded = await seedApprovedComplianceSource(complianceSources);
    const cards = new DurableRuleCardRepository(prisma, seeded.sourceReader);
    const card = makeRuleCard(seeded.context, seeded.source, seeded.version);
    const revision = makeRuleCardRevision(seeded.context, card, seeded.version);
    const created = makeRuleCardTransition(seeded.context, revision, {
      sequence: 1,
      from: null,
      to: "DRAFT",
      actor: seeded.context.author,
      at: seeded.context.times.cardCreated,
    });

    await expect(cards.addCard(card)).resolves.toEqual(card);
    await expect(cards.addCard(card)).rejects.toThrow("already exists");
    await expect(
      cards.appendRevision(revision, created, seeded.context.author, 0),
    ).resolves.toEqual(revision);
    await expect(cards.getCard(randomUUID())).rejects.toMatchObject({
      code: "RULE_CARD_NOT_FOUND",
    });
    await expect(cards.getRevision(randomUUID())).rejects.toMatchObject({
      code: "RULE_CARD_REVISION_NOT_FOUND",
    });
    const staleRevision = makeRuleCardRevision(seeded.context, card, seeded.version, {
      id: randomUUID(),
      revision: 2,
      replacesRevisionId: revision.id,
      revisionReason: "Stale synthetic Rule Card replacement",
      createdAt: seeded.context.times.cardRevision2Created,
    });
    await expect(
      cards.appendRevision(
        staleRevision,
        makeRuleCardTransition(seeded.context, staleRevision, {
          id: randomUUID(),
          sequence: 1,
          from: null,
          to: "DRAFT",
          actor: seeded.context.author,
          at: seeded.context.times.cardRevision2Created,
        }),
        seeded.context.author,
        0,
      ),
    ).rejects.toMatchObject({ code: "RULE_CARD_REVISION_CONFLICT" });
    const missingCard = { ...card, id: randomUUID() };
    const missingRevision = makeRuleCardRevision(seeded.context, missingCard, seeded.version, {
      id: randomUUID(),
    });
    await expect(
      cards.appendRevision(
        missingRevision,
        makeRuleCardTransition(seeded.context, missingRevision, {
          sequence: 1,
          from: null,
          to: "DRAFT",
          actor: seeded.context.author,
          at: seeded.context.times.cardCreated,
        }),
        seeded.context.author,
        0,
      ),
    ).rejects.toMatchObject({ code: "RULE_CARD_NOT_FOUND" });

    const comment = makeRuleCardComment(seeded.context, revision, 2);
    const submitted = makeRuleCardTransition(seeded.context, revision, {
      sequence: 3,
      from: "DRAFT",
      to: "IN_REVIEW",
      actor: seeded.context.author,
      at: seeded.context.times.cardSubmitted,
    });
    const reviewed = makeRuleCardReview(seeded.context, revision, 4);
    const approved = makeRuleCardApproval(seeded.context, revision, 5);

    await cards.appendComment(comment, seeded.context.author, { sequence: 1 });
    await cards.submitForReview(submitted, seeded.context.author, { sequence: 2 });
    await cards.recordReview(reviewed, seeded.context.reviewer, { sequence: 3 });
    await cards.recordApproval(approved, seeded.context.approver, { sequence: 4 });
    await expect(
      cards.recordApproval(approved, seeded.context.approver, { sequence: 5 }),
    ).rejects.toMatchObject({ code: "AUDIT_SEQUENCE_CONFLICT" });

    expect(await cards.getCard(card.id)).toEqual(card);
    expect(await cards.getRevision(revision.id)).toEqual(revision);
    expect(await cards.getRevisionState(revision.id)).toBe("APPROVED");
    expect((await cards.getAudit(revision.id)).map(({ kind }) => kind)).toEqual([
      "TRANSITION",
      "COMMENT",
      "TRANSITION",
      "REVIEW",
      "APPROVAL",
    ]);
    expect(await cards.getHistory(card.id)).toMatchObject({
      card,
      revisions: [{ state: "APPROVED", requiredApprovals: 1 }],
    });
    await expect(
      cards.assertEligibleForRuleGeneration({
        revisionId: revision.id,
        generationAt: seeded.context.times.evaluation,
        evaluationDate: seeded.context.times.evaluation,
        expectedRevisionContentHash: revision.contentHash,
        expectedSourceContentHash: seeded.version.contentHash,
        targetState: "DRAFT",
      }),
    ).resolves.toMatchObject({
      cardId: card.id,
      cardRevisionId: revision.id,
      sourceVersionId: seeded.version.id,
    });
    await expect(
      cards.assertRevisionEligibleForActivation({
        revisionId: revision.id,
        activationAt: seeded.context.times.evaluation,
        evaluationDate: seeded.context.times.evaluation,
        expectedRevisionContentHash: revision.contentHash,
        expectedSourceContentHash: seeded.version.contentHash,
      }),
    ).resolves.toEqual(revision);
    const retired = makeRuleCardTransition(seeded.context, revision, {
      sequence: 6,
      from: "APPROVED",
      to: "RETIRED",
      actor: seeded.context.approver,
      at: "2026-02-01T00:06:00.000Z",
      reason: "Retire the synthetic durable revision",
    });
    await expect(
      cards.retireRevision(retired, seeded.context.approver, { sequence: 5 }),
    ).resolves.toEqual(retired);
    expect(await cards.getRevisionState(revision.id)).toBe("RETIRED");
  });

  it("persists durable Rule Pack publication, activation and test run aggregates", async () => {
    const seeded = await seedApprovedRuleCard(complianceSources, prisma);
    const readinessContexts: string[] = [];
    const eligibilityCalls: string[] = [];
    const packs = new DurableRulePackRepository(
      prisma,
      {
        assertRuleEligible(rule, eligibilityAt, purpose) {
          eligibilityCalls.push(`${purpose}:${rule.id}:${eligibilityAt}`);
          return {
            source: seeded.source,
            sourceVersion: seeded.sourceVersion,
            ruleCardRevision: seeded.revision,
          };
        },
      },
      {
        assertRulePackReady(_version, context) {
          readinessContexts.push(`${context.purpose}:${context.checkedAt}`);
        },
      },
    );
    const draft = makeRulePackDraft(seeded.context, seeded.revision);
    const addedDraft = await packs.addDraft(draft, seeded.context.author);
    expect(addedDraft).toEqual(draft);
    expect(await packs.getDraft(draft.id)).toEqual(draft);
    await expect(packs.getDraft(randomUUID())).rejects.toMatchObject({
      code: "RULE_PACK_DRAFT_NOT_FOUND",
    });
    await expect(packs.getVersion(randomUUID())).rejects.toMatchObject({
      code: "RULE_PACK_VERSION_NOT_FOUND",
    });

    const replacedDraft = rehashDraft(draft, {
      revision: 2,
      semver: "1.0.1",
      updatedAt: seeded.context.times.packUpdated,
      updatedBy: seeded.context.otherAuthor.id,
      changeReason: "Synthetic replacement before publication",
    });
    await expect(
      packs.replaceDraft(replacedDraft, 0, seeded.context.otherAuthor),
    ).rejects.toMatchObject({ code: "RULE_PACK_DRAFT_REVISION_CONFLICT" });
    await expect(packs.replaceDraft(replacedDraft, 1, seeded.context.otherAuthor)).resolves.toEqual(
      replacedDraft,
    );

    const published = await packs.publishDraft(
      {
        draftId: draft.id,
        versionId: seeded.context.rulePackVersionId,
        publishedAt: seeded.context.times.packPublished,
        expectedDraftRevision: 2,
      },
      seeded.context.packPublisher,
    );
    expect(await packs.getVersion(published.id)).toEqual(published);
    expect(await packs.getVersionBySemVer(published.packId, "1.0.1")).toEqual(published);
    expect(await packs.getVersions(published.packId)).toEqual([published]);
    await expect(
      packs.assertVersionEligibleForActivation(
        published.id,
        seeded.context.times.packActivation,
        seeded.context.activationActor.id,
      ),
    ).resolves.toEqual(published);
    expect(eligibilityCalls.some((call) => call.startsWith("PUBLICATION:"))).toBe(true);
    expect(eligibilityCalls.some((call) => call.startsWith("ACTIVATION:"))).toBe(true);
    expect(readinessContexts).toEqual([
      `PUBLICATION:${seeded.context.times.packPublished}`,
      `ACTIVATION:${seeded.context.times.packActivation}`,
    ]);

    const clone = await packs.cloneVersion(
      {
        sourceVersionId: published.id,
        draftId: randomUUID(),
        semver: "1.1.0",
        changeReason: "Clone the synthetic durable Rule Pack",
        createdAt: seeded.context.times.packCloned,
      },
      seeded.context.otherAuthor,
    );
    expect(clone.supersedesVersionId).toBe(published.id);

    const versions = new Map([[published.id, published]]);
    const activations = new DurableRulePackActivationLedger(prisma, {
      getVersion(versionId) {
        const version = versions.get(versionId);
        if (version === undefined) throw new Error(`Unknown synthetic version ${versionId}`);
        return version;
      },
      assertVersionEligibleForActivation(versionId) {
        const version = versions.get(versionId);
        if (version === undefined) throw new Error(`Unknown synthetic version ${versionId}`);
        return version;
      },
    });
    const activated = makeActivationEvent(seeded.context, published, {
      sequence: 1,
      type: "ACTIVATE",
      previousEventHash: null,
      expectedPreviousVersionId: null,
      effectiveAt: seeded.context.times.packActivation,
      recordedAt: seeded.context.times.activationRecorded,
      reason: "Activate the synthetic durable Rule Pack",
    });
    expect(
      await activations.appendEvent(activated, {
        actor: seeded.context.activationActor,
        expected: { sequence: 0, previousEventHash: null, activeVersionId: null },
      }),
    ).toEqual(activated);
    expect(
      await activations.appendEvent(activated, {
        actor: seeded.context.activationActor,
        expected: { sequence: 99, previousEventHash: "f".repeat(64), activeVersionId: null },
      }),
    ).toEqual(activated);
    expect(await activations.getHistory(published.packId)).toEqual([activated]);
    expect(
      (
        await activations.resolve({
          domain: published.domain,
          jurisdiction: published.jurisdiction,
          evaluationDate: seeded.context.times.packActivation,
        })
      ).rulePackVersion,
    ).toEqual(published);

    const deactivated = makeActivationEvent(seeded.context, published, {
      sequence: 2,
      type: "DEACTIVATE",
      versionId: null,
      versionContentHash: null,
      previousEventHash: activated.contentHash,
      expectedPreviousVersionId: published.id,
      effectiveAt: seeded.context.times.packDeactivation,
      recordedAt: seeded.context.times.deactivationRecorded,
      reason: "Deactivate the synthetic durable Rule Pack",
    });
    await activations.appendEvent(deactivated, {
      actor: seeded.context.activationActor,
      expected: {
        sequence: 1,
        previousEventHash: activated.contentHash,
        activeVersionId: published.id,
      },
    });
    expect(await activations.getHistory(published.packId)).toEqual([activated, deactivated]);
    await expect(
      activations.resolve({
        domain: published.domain,
        jurisdiction: published.jurisdiction,
        evaluationDate: seeded.context.times.packDeactivation,
      }),
    ).rejects.toMatchObject({ code: "RULE_PACK_RESOLUTION_NOT_FOUND" });

    const testRuns = new DurableRuleTestRunRepository(prisma);
    const result = makeRuleTestRunResult(seeded.context, published);
    expect(await testRuns.saveTestRun(result)).toEqual(result);
    expect(await testRuns.saveTestRun(result)).toEqual(result);
    expect(await testRuns.getTestRun(result.requestId)).toEqual(result);
    expect(await testRuns.getTestRunByRequestId(result.requestId)).toEqual(result);
    await expect(testRuns.getTestRunByRequestId(randomUUID())).rejects.toThrow("not found");
    const { contentHash: _resultContentHash, ...conflictingRunInput } = result;
    void _resultContentHash;
    const conflictingRun: RuleTestRunResult = RuleTestRunResultSchema.parse({
      ...conflictingRunInput,
      fixtureSetHash: digest(`conflicting-fixture-set-${seeded.context.namespace}`),
      contentHash: computeRuleTestRunResultHash({
        ...conflictingRunInput,
        fixtureSetHash: digest(`conflicting-fixture-set-${seeded.context.namespace}`),
      }),
    });
    await expect(testRuns.saveTestRun(conflictingRun)).rejects.toThrow("different content");
    const hashCollisionRun = makeRuleTestRunResult(seeded.context, published);
    await prisma.ruleTestRunRecord.create({
      data: {
        id: randomUUID(),
        requestId: randomUUID(),
        rulePackVersionId: hashCollisionRun.rulePackVersionId,
        rulePackVersionContentHash: hashCollisionRun.rulePackVersionContentHash,
        contentHash: hashCollisionRun.contentHash,
        passed: hashCollisionRun.passed,
        validationScope: hashCollisionRun.validationScope,
        payload: hashCollisionRun as never,
      },
    });
    await expect(testRuns.saveTestRun(hashCollisionRun)).rejects.toThrow("different requestId");

    const report = makeRulePackImpactReport(seeded.context, published);
    expect(await testRuns.saveImpactReport(report)).toEqual(report);
    expect(await testRuns.saveImpactReport(report)).toEqual(report);
    const persistedReport = await prisma.rulePackImpactReportRecord.findUniqueOrThrow({
      where: { contentHash: report.contentHash },
    });
    expect(await testRuns.getImpactReport(persistedReport.id)).toEqual(report);
    await expect(testRuns.getImpactReport(randomUUID())).rejects.toThrow("not found");
  });

  it("exports a canonical backup after migration round trip", async () => {
    const backup = await exportStorageBackup(prisma, "2026-07-15T12:30:00.000Z");

    expect(backup.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      backup.idempotencyRecords.some((record) => BackupIdempotencySchema.safeParse(record).success),
    ).toBe(true);
    expect(canonicalizeStorageBackup(backup)).toContain("vera.storage-backup/v3");
  });

  it("restores a v3 backup into empty durable tables with stable hash", async () => {
    await clearBackupManagedTables(prisma);
    await repository.createAccount({
      id: uuid(901),
      email: "backup-restore@example.test",
      displayName: "Backup Restore",
      passwordHash: "$argon2id$v=19$m=1,t=1,p=1$c3ludGhldGlj$AAAAAAAAAAAAAAAAAAAAAA",
      role: "ADMIN",
      createdAt: "2026-07-20T10:00:00.000Z",
    });
    await repository.saveEvaluationRun(makeEvaluationRun(uuid(902)));
    await complianceSources.addSource({
      id: uuid(903),
      type: "POLICY",
      domain: "synthetic-domain",
      jurisdiction: "DEMO",
      title: "Backup restore source",
      stableReference: "BACKUP-RESTORE-001",
      validationScope: "TECHNICAL_DEMO",
    });
    await seedDurableBackupGraph(complianceSources, prisma);

    const backup = await exportStorageBackup(prisma, "2026-07-20T10:30:00.000Z");
    expect(backup.ruleCards).toHaveLength(1);
    expect(backup.rulePackVersions).toHaveLength(1);
    expect(backup.activationEvents).toHaveLength(1);
    expect(backup.ruleTestRuns).toHaveLength(1);
    expect(backup.rulePackImpactReports).toHaveLength(1);
    await expect(
      restoreStorageBackup(prisma, { ...backup, contentHash: "0".repeat(64) }),
    ).rejects.toThrow("contentHash");

    await clearBackupManagedTables(prisma);
    expect(await prisma.localAccount.count()).toBe(0);
    expect(await prisma.evaluationRunRecord.count()).toBe(0);
    expect(await prisma.complianceSourceRecord.count()).toBe(0);

    await restoreStorageBackup(prisma, backup);
    const restored = await exportStorageBackup(prisma, "2026-07-20T10:30:00.000Z");

    expect(restored.contentHash).toBe(backup.contentHash);
    expect(await prisma.localAccount.count()).toBe(1);
    expect(await prisma.session.count()).toBe(0);
    expect(await prisma.evaluationRunRecord.count()).toBe(1);
    expect(await prisma.complianceSourceRecord.count()).toBe(2);
    expect(await prisma.ruleCardRecord.count()).toBe(1);
    expect(await prisma.rulePackVersionRecord.count()).toBe(1);
    expect(await prisma.activationEventRecord.count()).toBe(1);
    expect(await prisma.ruleTestRunRecord.count()).toBe(1);
    expect(await prisma.rulePackImpactReportRecord.count()).toBe(1);
    await expect(restoreStorageBackup(prisma, backup)).rejects.toThrow("non-empty target table");
  });
});

async function clearIntegrationTables(prisma: VeraPrismaClient): Promise<void> {
  await prisma.$transaction([
    prisma.privateLabelEvaluationRun.deleteMany(),
    prisma.privateLabelRulePackActivation.deleteMany(),
    prisma.privateLabelRulePackVersion.deleteMany(),
    prisma.privateLabelSourceTransition.deleteMany(),
    prisma.privateLabelSourceVersion.deleteMany(),
    prisma.privateLabelSource.deleteMany(),
  ]);
  await clearBackupManagedTables(prisma);
}

async function clearBackupManagedTables(prisma: VeraPrismaClient): Promise<void> {
  await prisma.$transaction([
    prisma.reviewDecisionRecord.deleteMany(),
    prisma.evaluationRunRecord.deleteMany(),
    prisma.idempotencyRecord.deleteMany(),
    prisma.blobObject.deleteMany(),
    prisma.rulePackImpactReportRecord.deleteMany(),
    prisma.ruleTestRunRecord.deleteMany(),
    prisma.activationEventRecord.deleteMany(),
    prisma.rulePackDraftPublicationRecord.deleteMany(),
    prisma.rulePackVersionExcludedActivatorRecord.deleteMany(),
    prisma.rulePackVersionRecord.deleteMany(),
    prisma.rulePackDraftContributorRecord.deleteMany(),
    prisma.rulePackDraftRecord.deleteMany(),
    prisma.ruleCardAuditRecord.deleteMany(),
    prisma.ruleCardRevisionRecord.deleteMany(),
    prisma.ruleCardRecord.deleteMany(),
    prisma.complianceSourceTransitionRecord.deleteMany(),
    prisma.complianceSourceVersionRecord.deleteMany(),
    prisma.complianceSourceRecord.deleteMany(),
    prisma.session.deleteMany(),
    prisma.localAccount.deleteMany(),
  ]);
}

interface DurableDomainContext {
  readonly namespace: string;
  readonly domain: string;
  readonly jurisdiction: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly sourceContentHash: string;
  readonly cardId: string;
  readonly cardRevisionId: string;
  readonly rulePackId: string;
  readonly rulePackDraftId: string;
  readonly rulePackVersionId: string;
  readonly ruleId: string;
  readonly author: Actor;
  readonly otherAuthor: Actor;
  readonly reviewer: Actor;
  readonly approver: Actor;
  readonly packPublisher: Actor;
  readonly activationActor: Actor;
  readonly times: {
    readonly created: string;
    readonly uploaded: string;
    readonly reviewed: string;
    readonly approved: string;
    readonly evaluation: string;
    readonly cardCreated: string;
    readonly cardSubmitted: string;
    readonly cardReviewed: string;
    readonly cardApproved: string;
    readonly cardRevision2Created: string;
    readonly packCreated: string;
    readonly packUpdated: string;
    readonly packPublished: string;
    readonly packCloned: string;
    readonly packActivation: string;
    readonly activationRecorded: string;
    readonly packDeactivation: string;
    readonly deactivationRecorded: string;
  };
}

interface SeededApprovedComplianceSource {
  readonly context: DurableDomainContext;
  readonly source: ComplianceSource;
  readonly version: ComplianceSourceVersion;
  readonly sourceReader: {
    readonly getSource: (sourceId: string) => ComplianceSource;
    readonly getVersion: (versionId: string) => ComplianceSourceVersion;
    readonly getVersionState: (versionId: string) => ComplianceSourceState | null;
    readonly getVersionStateAt: (versionId: string, at: string) => ComplianceSourceState | null;
  };
}

interface SeededApprovedRuleCard extends SeededApprovedComplianceSource {
  readonly sourceVersion: ComplianceSourceVersion;
  readonly card: RuleCard;
  readonly revision: RuleCardRevision;
}

function digest(label: string): string {
  return sha256CanonicalJson({ label });
}

function actor(role: Actor["role"], namespace: string, label: string): Actor {
  return {
    id: randomUUID(),
    displayName: `Synthetic ${label} ${role}`,
    role,
    validationScope: "TECHNICAL_DEMO",
  };
}

function makeDurableDomainContext(): DurableDomainContext {
  const namespace = randomUUID().replaceAll("-", "").slice(0, 12);
  return {
    namespace,
    domain: `synthetic-storage-${namespace}`,
    jurisdiction: `GLOBAL-${namespace}`,
    sourceId: randomUUID(),
    sourceVersionId: randomUUID(),
    sourceContentHash: digest(`source-version-${namespace}`),
    cardId: randomUUID(),
    cardRevisionId: randomUUID(),
    rulePackId: randomUUID(),
    rulePackDraftId: randomUUID(),
    rulePackVersionId: randomUUID(),
    ruleId: randomUUID(),
    author: actor("AUTHOR", namespace, "author"),
    otherAuthor: actor("AUTHOR", namespace, "other-author"),
    reviewer: actor("REVIEWER", namespace, "reviewer"),
    approver: actor("APPROVER", namespace, "approver"),
    packPublisher: actor("APPROVER", namespace, "publisher"),
    activationActor: actor("APPROVER", namespace, "activator"),
    times: {
      created: "2026-01-01T00:00:00.000Z",
      uploaded: "2026-01-01T01:00:00.000Z",
      reviewed: "2026-01-01T02:00:00.000Z",
      approved: "2026-01-01T03:00:00.000Z",
      evaluation: "2026-06-01T00:00:00.000Z",
      cardCreated: "2026-02-01T00:00:00.000Z",
      cardSubmitted: "2026-02-01T00:03:00.000Z",
      cardReviewed: "2026-02-01T00:04:00.000Z",
      cardApproved: "2026-02-01T00:05:00.000Z",
      cardRevision2Created: "2026-02-02T00:00:00.000Z",
      packCreated: "2026-02-10T00:00:00.000Z",
      packUpdated: "2026-02-10T01:00:00.000Z",
      packPublished: "2026-02-11T00:00:00.000Z",
      packCloned: "2026-02-12T00:00:00.000Z",
      packActivation: "2026-03-01T00:00:00.000Z",
      activationRecorded: "2026-02-20T00:00:00.000Z",
      packDeactivation: "2026-11-01T00:00:00.000Z",
      deactivationRecorded: "2026-10-20T00:00:00.000Z",
    },
  };
}

function makeComplianceSource(context: DurableDomainContext): ComplianceSource {
  return {
    id: context.sourceId,
    type: "STANDARD",
    domain: context.domain,
    jurisdiction: context.jurisdiction,
    title: `Synthetic durable source ${context.namespace}`,
    stableReference: `urn:vera:synthetic:durable-source:${context.namespace}`,
    validationScope: "TECHNICAL_DEMO",
  };
}

function makeComplianceVersion(
  context: DurableDomainContext,
  overrides: Partial<ComplianceSourceVersion> = {},
): ComplianceSourceVersion {
  return {
    id: context.sourceVersionId,
    sourceId: context.sourceId,
    revision: 1,
    versionLabel: "synthetic-v1",
    license: "CC0-1.0",
    contentHash: context.sourceContentHash,
    validity: {
      validFrom: context.times.created,
      validTo: "2027-01-01T00:00:00.000Z",
    },
    createdAt: context.times.created,
    createdBy: context.author.id,
    replacesVersionId: null,
    replacementReason: null,
    ...overrides,
  };
}

function makeComplianceTransition(
  context: DurableDomainContext,
  version: ComplianceSourceVersion,
  to: ComplianceSourceTransitionEvent["to"],
  options: {
    readonly sequence: number;
    readonly from: ComplianceSourceTransitionEvent["from"];
    readonly actor: Actor;
    readonly at: string;
    readonly reason?: string | null;
  },
): ComplianceSourceTransitionEvent {
  return {
    id: randomUUID(),
    versionId: version.id,
    sequence: options.sequence,
    from: options.from,
    to,
    actorId: options.actor.id,
    exercisedRole: options.actor.role,
    at: options.at,
    reason: options.reason ?? null,
    contentHash: version.contentHash,
    validationScope: "TECHNICAL_DEMO",
  };
}

function stateAt(context: DurableDomainContext, at: string): ComplianceSourceState | null {
  if (Date.parse(at) < Date.parse(context.times.uploaded)) return null;
  if (Date.parse(at) < Date.parse(context.times.reviewed)) return "UPLOADED";
  if (Date.parse(at) < Date.parse(context.times.approved)) return "REVIEWED";
  return "APPROVED";
}

async function seedApprovedComplianceSource(
  complianceSources: DurableComplianceSourceRepository,
): Promise<SeededApprovedComplianceSource> {
  const context = makeDurableDomainContext();
  const source = makeComplianceSource(context);
  const version = makeComplianceVersion(context);
  await complianceSources.addSource(source);
  await complianceSources.appendVersion(version, 0);
  const uploaded = makeComplianceTransition(context, version, "UPLOADED", {
    sequence: 1,
    from: null,
    actor: context.author,
    at: context.times.uploaded,
  });
  const reviewed = makeComplianceTransition(context, version, "REVIEWED", {
    sequence: 2,
    from: "UPLOADED",
    actor: context.reviewer,
    at: context.times.reviewed,
  });
  const approved = makeComplianceTransition(context, version, "APPROVED", {
    sequence: 3,
    from: "REVIEWED",
    actor: context.approver,
    at: context.times.approved,
  });
  await complianceSources.appendTransition(
    uploaded,
    { actor: context.author },
    {
      sequence: 0,
      state: null,
    },
  );
  await complianceSources.appendTransition(
    reviewed,
    { actor: context.reviewer },
    {
      sequence: 1,
      state: "UPLOADED",
    },
  );
  await complianceSources.appendTransition(
    approved,
    { actor: context.approver },
    {
      sequence: 2,
      state: "REVIEWED",
    },
  );
  const persistedSource = await complianceSources.getSource(source.id);
  const persistedVersion = await complianceSources.getVersion(version.id);
  return {
    context,
    source: persistedSource,
    version: persistedVersion,
    sourceReader: {
      getSource(sourceId) {
        if (sourceId !== persistedSource.id)
          throw new Error(`Unknown synthetic source ${sourceId}`);
        return structuredClone(persistedSource);
      },
      getVersion(versionId) {
        if (versionId !== persistedVersion.id) {
          throw new Error(`Unknown synthetic source version ${versionId}`);
        }
        return structuredClone(persistedVersion);
      },
      getVersionState(versionId) {
        if (versionId !== persistedVersion.id) {
          throw new Error(`Unknown synthetic source version ${versionId}`);
        }
        return "APPROVED";
      },
      getVersionStateAt(versionId, at) {
        if (versionId !== persistedVersion.id) {
          throw new Error(`Unknown synthetic source version ${versionId}`);
        }
        return stateAt(context, at);
      },
    },
  };
}

function makeRuleCard(
  context: DurableDomainContext,
  source: ComplianceSource,
  version: ComplianceSourceVersion,
): RuleCard {
  return {
    id: context.cardId,
    sourceId: source.id,
    sourceVersionId: version.id,
    sourceSection: `synthetic-section-${context.namespace}`,
    validationScope: "TECHNICAL_DEMO",
  };
}

function makeRuleCardRevision(
  context: DurableDomainContext,
  card: RuleCard,
  sourceVersion: ComplianceSourceVersion,
  overrides: Partial<RuleCardRevisionHashInput> = {},
): RuleCardRevision {
  const input: RuleCardRevisionHashInput = {
    id: context.cardRevisionId,
    cardId: card.id,
    revision: 1,
    sourceId: card.sourceId,
    sourceVersionId: card.sourceVersionId,
    sourceContentHash: sourceVersion.contentHash,
    sourceSection: card.sourceSection,
    normativeActor: "Synthetic operator",
    object: "Synthetic durable record",
    scope: "Synthetic durable storage coverage",
    normativeKey: `synthetic.${context.namespace}.marker`,
    deonticCategory: "OBLIGATION",
    exceptions: [],
    evidenceRequirements: [
      {
        id: randomUUID(),
        key: "document.marker",
        description: "A synthetic marker is visible",
        rationale: "The marker demonstrates evidence linkage",
        sourceReference: card.sourceSection,
      },
    ],
    riskLevel: "LOW",
    riskRationale: "The synthetic impact is local and reversible",
    falsePositiveCost: "LOW",
    falsePositiveCostRationale: "A false alert is locally reversible",
    falseNegativeCost: "LOW",
    falseNegativeCostRationale: "A missed synthetic marker has limited impact",
    provenance: "MANUAL",
    provider: null,
    validity: {
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2027-01-01T00:00:00.000Z",
    },
    createdAt: context.times.cardCreated,
    createdBy: context.author.id,
    replacesRevisionId: null,
    revisionReason: null,
    ...overrides,
  };
  return {
    ...input,
    contentHash: computeRuleCardRevisionHash(input),
  };
}

function makeRuleCardTransition(
  context: DurableDomainContext,
  revision: RuleCardRevision,
  options: {
    readonly id?: string;
    readonly sequence: number;
    readonly from: RuleCardTransitionEvent["from"];
    readonly to: RuleCardTransitionEvent["to"];
    readonly actor: Actor;
    readonly at: string;
    readonly reason?: string | null;
  },
): RuleCardTransitionEvent {
  return {
    id: options.id ?? randomUUID(),
    revisionId: revision.id,
    sequence: options.sequence,
    from: options.from,
    to: options.to,
    actorId: options.actor.id,
    exercisedRole: options.actor.role,
    at: options.at,
    revisionContentHash: revision.contentHash,
    reason: options.reason ?? null,
    validationScope: "TECHNICAL_DEMO",
  };
}

function makeRuleCardComment(
  context: DurableDomainContext,
  revision: RuleCardRevision,
  sequence: number,
): RuleCardComment {
  return {
    id: randomUUID(),
    revisionId: revision.id,
    sequence,
    actorId: context.author.id,
    exercisedRole: "AUTHOR",
    at: "2026-02-01T00:02:00.000Z",
    revisionContentHash: revision.contentHash,
    validationScope: "TECHNICAL_DEMO",
    body: "Synthetic durable audit comment",
  };
}

function makeRuleCardReview(
  context: DurableDomainContext,
  revision: RuleCardRevision,
  sequence: number,
): RuleCardReviewDecision {
  return {
    id: randomUUID(),
    revisionId: revision.id,
    sequence,
    actorId: context.reviewer.id,
    at: context.times.cardReviewed,
    revisionContentHash: revision.contentHash,
    validationScope: "TECHNICAL_DEMO",
    exercisedRole: "REVIEWER",
    decision: "ACCEPTED",
    rationale: "The synthetic source binding and interpretation are consistent",
  };
}

function makeRuleCardApproval(
  context: DurableDomainContext,
  revision: RuleCardRevision,
  sequence: number,
): RuleCardApprovalDecision {
  return {
    id: randomUUID(),
    revisionId: revision.id,
    sequence,
    actorId: context.approver.id,
    at: context.times.cardApproved,
    revisionContentHash: revision.contentHash,
    validationScope: "TECHNICAL_DEMO",
    exercisedRole: "APPROVER",
    decision: "APPROVED",
    rationale: "The synthetic revision meets the technical demonstration gate",
  };
}

async function seedApprovedRuleCard(
  complianceSources: DurableComplianceSourceRepository,
  prisma: VeraPrismaClient,
): Promise<SeededApprovedRuleCard> {
  const seeded = await seedApprovedComplianceSource(complianceSources);
  const cards = new DurableRuleCardRepository(prisma, seeded.sourceReader);
  const card = makeRuleCard(seeded.context, seeded.source, seeded.version);
  const revision = makeRuleCardRevision(seeded.context, card, seeded.version);
  await cards.addCard(card);
  await cards.appendRevision(
    revision,
    makeRuleCardTransition(seeded.context, revision, {
      sequence: 1,
      from: null,
      to: "DRAFT",
      actor: seeded.context.author,
      at: seeded.context.times.cardCreated,
    }),
    seeded.context.author,
    0,
  );
  await cards.submitForReview(
    makeRuleCardTransition(seeded.context, revision, {
      sequence: 2,
      from: "DRAFT",
      to: "IN_REVIEW",
      actor: seeded.context.author,
      at: seeded.context.times.cardSubmitted,
    }),
    seeded.context.author,
    { sequence: 1 },
  );
  await cards.recordReview(
    makeRuleCardReview(seeded.context, revision, 3),
    seeded.context.reviewer,
    {
      sequence: 2,
    },
  );
  await cards.recordApproval(
    makeRuleCardApproval(seeded.context, revision, 4),
    seeded.context.approver,
    { sequence: 3 },
  );
  return {
    ...seeded,
    sourceVersion: seeded.version,
    card,
    revision,
  };
}

async function seedDurableBackupGraph(
  complianceSources: DurableComplianceSourceRepository,
  prisma: VeraPrismaClient,
): Promise<void> {
  const seeded = await seedApprovedRuleCard(complianceSources, prisma);
  const packs = new DurableRulePackRepository(prisma, {
    assertRuleEligible() {
      return {
        source: seeded.source,
        sourceVersion: seeded.sourceVersion,
        ruleCardRevision: seeded.revision,
      };
    },
  });
  const draft = makeRulePackDraft(seeded.context, seeded.revision);
  await packs.addDraft(draft, seeded.context.author);
  const published = await packs.publishDraft(
    {
      draftId: draft.id,
      versionId: seeded.context.rulePackVersionId,
      publishedAt: seeded.context.times.packPublished,
      expectedDraftRevision: 1,
    },
    seeded.context.packPublisher,
  );
  const activations = new DurableRulePackActivationLedger(prisma, {
    getVersion(versionId) {
      if (versionId !== published.id) throw new Error(`Unknown synthetic version ${versionId}`);
      return published;
    },
    assertVersionEligibleForActivation(versionId) {
      if (versionId !== published.id) throw new Error(`Unknown synthetic version ${versionId}`);
      return published;
    },
  });
  const activated = makeActivationEvent(seeded.context, published);
  await activations.appendEvent(activated, {
    actor: seeded.context.activationActor,
    expected: { sequence: 0, previousEventHash: null, activeVersionId: null },
  });
  const testRuns = new DurableRuleTestRunRepository(prisma);
  await testRuns.saveTestRun(makeRuleTestRunResult(seeded.context, published));
  await testRuns.saveImpactReport(makeRulePackImpactReport(seeded.context, published));
}

function makeRule(context: DurableDomainContext, revision: RuleCardRevision): RuleDefinition {
  const input: RuleDefinitionHashInput = {
    dslVersion: DSL_VERSION,
    state: "DRAFT",
    id: context.ruleId,
    sourceId: revision.sourceId,
    sourceVersionId: revision.sourceVersionId,
    sourceContentHash: revision.sourceContentHash,
    ruleCardId: revision.cardId,
    ruleCardRevisionId: revision.id,
    ruleCardRevisionContentHash: revision.contentHash,
    normativeKey: revision.normativeKey,
    deonticCategory: revision.deonticCategory,
    riskLevel: revision.riskLevel,
    validity: revision.validity,
    appliesWhen: { op: "truth", value: "TRUE" },
    satisfiedWhen: { op: "present", factKey: "synthetic.marker" },
    exceptions: [],
    overrides: [],
    conflictsWith: [],
    evidenceBindings: [
      {
        factKey: "synthetic.marker",
        evidenceRequirementKeys: ["document.marker"],
      },
    ],
    unknownPolicy: "REVIEW",
    validationScope: "TECHNICAL_DEMO",
  };
  return RuleDefinitionSchema.parse({
    ...input,
    contentHash: computeRuleDefinitionHash(input),
  });
}

function makeRulePackDraft(
  context: DurableDomainContext,
  revision: RuleCardRevision,
  overrides: Partial<RulePackDraftHashInput> = {},
): RulePackDraft {
  const input: RulePackDraftHashInput = {
    schemaVersion: RULE_PACK_SCHEMA_VERSION,
    id: context.rulePackDraftId,
    packId: context.rulePackId,
    revision: 1,
    semver: "1.0.0",
    domain: context.domain,
    jurisdiction: context.jurisdiction,
    validity: {
      validFrom: context.times.packActivation,
      validTo: context.times.packDeactivation,
    },
    rules: [makeRule(context, revision)],
    changeReason: "Initial synthetic durable Rule Pack publication",
    supersedesVersionId: null,
    createdAt: context.times.packCreated,
    createdBy: context.author.id,
    updatedAt: context.times.packCreated,
    updatedBy: context.author.id,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
  return RulePackDraftSchema.parse({
    ...input,
    contentHash: computeRulePackDraftHash(input),
  });
}

function rehashDraft(
  draft: RulePackDraft,
  overrides: Partial<RulePackDraftHashInput>,
): RulePackDraft {
  const { contentHash: _contentHash, ...hashInput } = draft;
  void _contentHash;
  const input: RulePackDraftHashInput = { ...hashInput, ...overrides };
  return RulePackDraftSchema.parse({
    ...input,
    contentHash: computeRulePackDraftHash(input),
  });
}

function makeActivationEvent(
  context: DurableDomainContext,
  version: RulePackVersion,
  overrides: Partial<ActivationEventHashInput> = {},
): ActivationEvent {
  const input: ActivationEventHashInput = {
    schemaVersion: ACTIVATION_EVENT_SCHEMA_VERSION,
    id: randomUUID(),
    packId: version.packId,
    sequence: 1,
    type: "ACTIVATE",
    versionId: version.id,
    versionContentHash: version.contentHash,
    expectedPreviousVersionId: null,
    effectiveAt: context.times.packActivation,
    recordedAt: context.times.activationRecorded,
    actorId: context.activationActor.id,
    exercisedRole: "APPROVER",
    reason: "Activate synthetic durable Rule Pack",
    previousEventHash: null,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
  return {
    ...input,
    contentHash: computeActivationEventHash(input),
  };
}

function makeRuleTestRunResult(
  context: DurableDomainContext,
  version: RulePackVersion,
): RuleTestRunResult {
  const rule = version.rules[0];
  if (rule === undefined) throw new Error("Expected a synthetic rule");
  const expected = {
    ruleId: rule.id,
    ruleContentHash: rule.contentHash,
    outcome: "PASS" as const,
    effectiveOutcome: "PASS" as const,
    resolution: "UNCHANGED" as const,
    relatedRuleIds: [],
  };
  const hashInput: RuleTestRunResultHashInput = {
    schemaVersion: RULE_TESTING_SCHEMA_VERSION,
    requestId: randomUUID(),
    rulePackVersionId: version.id,
    rulePackVersionContentHash: version.contentHash,
    fixtureSetHash: digest(`fixture-set-${context.namespace}`),
    requiredCoverageTags: ["OUTCOME_PASS"],
    fixtureResults: [
      {
        fixtureId: randomUUID(),
        caseId: `case-${context.namespace}`,
        ruleId: rule.id,
        expected,
        actual: structuredClone(expected),
        aggregateOutcome: "PASS",
        evaluationContentHash: digest(`evaluation-${context.namespace}`),
        passed: true,
        issues: [],
      },
    ],
    coverage: [
      {
        ruleId: rule.id,
        ruleContentHash: rule.contentHash,
        observedCoverageTags: ["OUTCOME_PASS"],
        missingCoverageTags: [],
        observedOutcomes: ["PASS"],
      },
    ],
    passed: true,
    validationScope: "TECHNICAL_DEMO",
  };
  return RuleTestRunResultSchema.parse({
    ...hashInput,
    contentHash: computeRuleTestRunResultHash(hashInput),
  });
}

function makeRulePackImpactReport(
  context: DurableDomainContext,
  version: RulePackVersion,
): RulePackImpactReport {
  const rule = version.rules[0];
  if (rule === undefined) throw new Error("Expected a synthetic rule");
  const hashInput: RulePackImpactReportHashInput = {
    schemaVersion: RULE_PACK_IMPACT_SCHEMA_VERSION,
    baseline: { versionId: version.id, semver: version.semver, contentHash: version.contentHash },
    candidate: { versionId: version.id, semver: version.semver, contentHash: version.contentHash },
    fixtureSetHash: digest(`impact-fixtures-${context.namespace}`),
    cases: [
      {
        fixtureId: randomUUID(),
        caseId: `impact-${context.namespace}`,
        ruleId: rule.id,
        baseline: {
          ruleContentHash: rule.contentHash,
          outcome: "PASS",
          effectiveOutcome: "PASS",
          resolution: "UNCHANGED",
        },
        candidate: {
          ruleContentHash: rule.contentHash,
          outcome: "PASS",
          effectiveOutcome: "PASS",
          resolution: "UNCHANGED",
        },
        classifications: ["UNCHANGED"],
      },
    ],
    summary: {
      totalCases: 1,
      changedCases: 0,
      newReviewCases: 0,
      possibleFalseComplianceCases: 0,
      unchangedCases: 1,
    },
    validationScope: "TECHNICAL_DEMO",
  };
  return RulePackImpactReportSchema.parse({
    ...hashInput,
    contentHash: computeRulePackImpactReportHash(hashInput),
  });
}
