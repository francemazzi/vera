import { EvaluationRunSchema, ReviewDecisionSchema, sha256CanonicalJson } from "@vera/contracts";
import type { ActorRole, EvaluationRun, JsonValue, ReviewDecision } from "@vera/contracts";
import { z } from "zod";

import type { Prisma } from "./generated/prisma/client.js";
import type { VeraPrismaClient } from "./prisma.js";

const Sha256DigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Expected a lowercase SHA-256 digest");

export class StorageConflictError extends Error {}
export class StorageNotFoundError extends Error {}
export class StorageValidationError extends Error {}

export interface LocalAccountRecord {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly role: ActorRole;
  readonly disabled: boolean;
  readonly createdAt: string;
}

export interface SessionRecord {
  readonly id: string;
  readonly tokenHash: string;
  readonly accountId: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

function toInputJson(value: JsonValue | EvaluationRun | ReviewDecision): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

function iso(date: Date): string {
  return date.toISOString();
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "P2002"
  );
}

export class VeraStorageRepository {
  readonly #prisma: VeraPrismaClient;

  public constructor(prisma: VeraPrismaClient) {
    this.#prisma = prisma;
  }

  public async createAccount(input: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
    readonly passwordHash: string;
    readonly role: ActorRole;
    readonly createdAt: string;
  }): Promise<LocalAccountRecord> {
    try {
      const record = await this.#prisma.localAccount.create({
        data: {
          id: input.id,
          email: input.email.toLocaleLowerCase("und"),
          displayName: input.displayName,
          passwordHash: input.passwordHash,
          role: input.role,
          createdAt: new Date(input.createdAt),
        },
      });
      return {
        id: record.id,
        email: record.email,
        displayName: record.displayName,
        passwordHash: record.passwordHash,
        role: record.role as ActorRole,
        disabled: record.disabled,
        createdAt: iso(record.createdAt),
      };
    } catch (error) {
      if (isUniqueConstraint(error)) throw new StorageConflictError("Account already exists");
      throw error;
    }
  }

  public async findAccountByEmail(email: string): Promise<LocalAccountRecord | null> {
    const record = await this.#prisma.localAccount.findUnique({
      where: { email: email.toLocaleLowerCase("und") },
    });
    if (record === null) return null;
    return {
      id: record.id,
      email: record.email,
      displayName: record.displayName,
      passwordHash: record.passwordHash,
      role: record.role as ActorRole,
      disabled: record.disabled,
      createdAt: iso(record.createdAt),
    };
  }

  public async findAccountById(id: string): Promise<LocalAccountRecord | null> {
    const record = await this.#prisma.localAccount.findUnique({ where: { id } });
    if (record === null) return null;
    return {
      id: record.id,
      email: record.email,
      displayName: record.displayName,
      passwordHash: record.passwordHash,
      role: record.role as ActorRole,
      disabled: record.disabled,
      createdAt: iso(record.createdAt),
    };
  }

  public async createSession(input: {
    readonly id: string;
    readonly tokenHash: string;
    readonly accountId: string;
    readonly createdAt: string;
    readonly expiresAt: string;
  }): Promise<SessionRecord> {
    const record = await this.#prisma.session.create({
      data: {
        id: input.id,
        tokenHash: Sha256DigestSchema.parse(input.tokenHash),
        accountId: input.accountId,
        createdAt: new Date(input.createdAt),
        expiresAt: new Date(input.expiresAt),
      },
    });
    return {
      id: record.id,
      tokenHash: record.tokenHash,
      accountId: record.accountId,
      expiresAt: iso(record.expiresAt),
      revokedAt: null,
    };
  }

  public async findSessionByTokenHash(
    tokenHash: string,
    at: string,
  ): Promise<SessionRecord | null> {
    const record = await this.#prisma.session.findUnique({
      where: { tokenHash: Sha256DigestSchema.parse(tokenHash) },
    });
    if (record === null || record.revokedAt !== null || record.expiresAt <= new Date(at)) {
      return null;
    }
    return {
      id: record.id,
      tokenHash: record.tokenHash,
      accountId: record.accountId,
      expiresAt: iso(record.expiresAt),
      revokedAt: null,
    };
  }

  public async saveEvaluationRun(runInput: EvaluationRun): Promise<EvaluationRun> {
    const run = EvaluationRunSchema.parse(runInput);
    try {
      await this.#prisma.evaluationRunRecord.create({
        data: {
          id: run.id,
          contentHash: run.contentHash,
          aggregateOutcome: run.evaluationSnapshot.evaluationResult.aggregateOutcome,
          validationScope: run.validationScope,
          payload: toInputJson(run),
          createdAt: new Date(run.recordedAt),
        },
      });
    } catch (error) {
      if (isUniqueConstraint(error)) throw new StorageConflictError("EvaluationRun already exists");
      throw error;
    }
    return this.getEvaluationRun(run.id);
  }

  public async getEvaluationRun(id: string): Promise<EvaluationRun> {
    const record = await this.#prisma.evaluationRunRecord.findUnique({ where: { id } });
    if (record === null) throw new StorageNotFoundError(`EvaluationRun not found: ${id}`);
    return EvaluationRunSchema.parse(record.payload);
  }

  public async appendReviewDecision(decisionInput: ReviewDecision): Promise<ReviewDecision> {
    const decision = ReviewDecisionSchema.parse(decisionInput);
    const run = await this.getEvaluationRun(decision.runId);
    if (decision.runContentHash !== run.contentHash) {
      throw new StorageConflictError("ReviewDecision is bound to a stale EvaluationRun hash");
    }
    const previous = await this.#prisma.reviewDecisionRecord.findFirst({
      where: { runId: decision.runId },
      orderBy: { sequence: "desc" },
    });
    if (decision.sequence !== (previous?.sequence ?? 0) + 1) {
      throw new StorageConflictError("ReviewDecision sequence is stale or non-contiguous");
    }
    if (decision.previousEventHash !== (previous?.contentHash ?? null)) {
      throw new StorageConflictError("ReviewDecision previous hash is stale");
    }
    try {
      await this.#prisma.reviewDecisionRecord.create({
        data: {
          id: decision.id,
          runId: decision.runId,
          sequence: decision.sequence,
          contentHash: decision.contentHash,
          previousEventHash: decision.previousEventHash,
          actorId: decision.actorId,
          payload: toInputJson(decision),
          createdAt: new Date(decision.decidedAt),
        },
      });
    } catch (error) {
      if (isUniqueConstraint(error))
        throw new StorageConflictError("ReviewDecision already exists");
      throw error;
    }
    return decision;
  }

  public async listReviewDecisions(runId: string): Promise<readonly ReviewDecision[]> {
    const records = await this.#prisma.reviewDecisionRecord.findMany({
      where: { runId },
      orderBy: { sequence: "asc" },
    });
    return records.map((record) => ReviewDecisionSchema.parse(record.payload));
  }

  public async getOrCreateIdempotency(input: {
    readonly scope: string;
    readonly key: string;
    readonly response: JsonValue;
    readonly createdAt: string;
    readonly expiresAt: string;
  }): Promise<{ readonly response: JsonValue; readonly created: boolean }> {
    const responseHash = sha256CanonicalJson(input.response);
    const existing = await this.#prisma.idempotencyRecord.findUnique({
      where: { scope_key: { scope: input.scope, key: input.key } },
    });
    if (existing !== null) {
      if (existing.responseHash !== responseHash) {
        throw new StorageConflictError("Idempotency key already exists with different response");
      }
      return { response: toJsonValue(existing.response), created: false };
    }
    try {
      await this.#prisma.idempotencyRecord.create({
        data: {
          scope: input.scope,
          key: input.key,
          responseHash,
          response: toInputJson(input.response),
          createdAt: new Date(input.createdAt),
          expiresAt: new Date(input.expiresAt),
        },
      });
      return { response: input.response, created: true };
    } catch (error) {
      if (isUniqueConstraint(error)) {
        const concurrent = await this.#prisma.idempotencyRecord.findUniqueOrThrow({
          where: { scope_key: { scope: input.scope, key: input.key } },
        });
        if (concurrent.responseHash !== responseHash) {
          throw new StorageConflictError("Idempotency key already exists with different response");
        }
        return { response: toJsonValue(concurrent.response), created: false };
      }
      throw error;
    }
  }

  public async recordBlob(input: {
    readonly sha256: string;
    readonly byteLength: number;
    readonly mediaType: string;
    readonly path: string;
    readonly createdAt: string;
  }): Promise<void> {
    await this.#prisma.blobObject.upsert({
      where: { sha256: Sha256DigestSchema.parse(input.sha256) },
      create: {
        sha256: input.sha256,
        byteLength: input.byteLength,
        mediaType: input.mediaType,
        path: input.path,
        createdAt: new Date(input.createdAt),
      },
      update: {},
    });
  }
}
