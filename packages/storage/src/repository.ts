import { EvaluationRunSchema, ReviewDecisionSchema, sha256CanonicalJson } from "@vera/contracts";
import type { ActorRole, EvaluationRun, JsonValue, ReviewDecision } from "@vera/contracts";
import { z } from "zod";

import type { Prisma } from "./generated/prisma/client.js";
import type { VeraPrismaClient } from "./prisma.js";

const SERIALIZABLE_ATTEMPTS = 3;
const LEGACY_EVALUATION_RUN_SCOPE = "evaluation-runs:create";

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

export interface IdempotentMutationResult {
  readonly response: JsonValue;
  readonly created: boolean;
}

interface CreateLocalAccountInput {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly role: ActorRole;
  readonly createdAt: string;
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

function isRetryableTransactionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { readonly code?: unknown }).code === "P2002" ||
      (error as { readonly code?: unknown }).code === "P2034")
  );
}

async function runSerializableWithRetries<T>(
  prisma: VeraPrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt >= SERIALIZABLE_ATTEMPTS) throw error;
    }
  }
}

function localAccountRecord(record: {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly role: string;
  readonly disabled: boolean;
  readonly createdAt: Date;
}): LocalAccountRecord {
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

function evaluationRunResponse(run: EvaluationRun): JsonValue {
  return { evaluationRun: run } as unknown as JsonValue;
}

function reviewDecisionResponse(decision: ReviewDecision): JsonValue {
  return { reviewDecision: decision };
}

function requestHash(scope: string, request: EvaluationRun | ReviewDecision): string {
  return sha256CanonicalJson({ scope, request: toJsonValue(request) });
}

function replayIdempotency(
  record: {
    readonly requestHash: string | null;
    readonly responseHash: string;
    readonly response: unknown;
  },
  expectedRequestHash: string,
  expectedResponseHash: string,
): JsonValue {
  const response = toJsonValue(record.response);
  if (sha256CanonicalJson(response) !== record.responseHash) {
    throw new StorageValidationError("Stored idempotency response hash is invalid");
  }
  const matches =
    record.requestHash === null
      ? record.responseHash === expectedResponseHash
      : record.requestHash === expectedRequestHash;
  if (!matches) {
    throw new StorageConflictError("Idempotency key already exists for a different request");
  }
  return response;
}

function replayHistoricalIdempotency(
  record: {
    readonly requestHash: string | null;
    readonly responseHash: string;
    readonly response: unknown;
  },
  expectedResponseHash: string,
): JsonValue {
  const response = toJsonValue(record.response);
  if (
    record.requestHash !== null ||
    sha256CanonicalJson(response) !== record.responseHash ||
    record.responseHash !== expectedResponseHash
  ) {
    throw new StorageConflictError("Historical idempotency record cannot be replayed safely");
  }
  return response;
}

function legacyReviewDecisionScope(runId: string): string {
  return `review-decisions:${runId}`;
}

export class VeraStorageRepository {
  readonly #prisma: VeraPrismaClient;

  public constructor(prisma: VeraPrismaClient) {
    this.#prisma = prisma;
  }

  public async createAccount(input: CreateLocalAccountInput): Promise<LocalAccountRecord> {
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
      return localAccountRecord(record);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new StorageConflictError("Account already exists");
      throw error;
    }
  }

  public async bootstrapAdminAccount(input: CreateLocalAccountInput): Promise<LocalAccountRecord> {
    if (input.role !== "ADMIN") {
      throw new StorageValidationError("The initial account must have the ADMIN role");
    }
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        if ((await transaction.localAccount.count()) !== 0) {
          throw new StorageConflictError("Initial ADMIN bootstrap is no longer available");
        }
        const record = await transaction.localAccount.create({
          data: {
            id: input.id,
            email: input.email.toLocaleLowerCase("und"),
            displayName: input.displayName,
            passwordHash: input.passwordHash,
            role: input.role,
            createdAt: new Date(input.createdAt),
          },
        });
        return localAccountRecord(record);
      });
    } catch (error) {
      if (isRetryableTransactionError(error)) {
        throw new StorageConflictError("Initial ADMIN bootstrap lost a concurrent race");
      }
      throw error;
    }
  }

  public async findAccountByEmail(email: string): Promise<LocalAccountRecord | null> {
    const record = await this.#prisma.localAccount.findUnique({
      where: { email: email.toLocaleLowerCase("und") },
    });
    if (record === null) return null;
    return localAccountRecord(record);
  }

  public async findAccountById(id: string): Promise<LocalAccountRecord | null> {
    const record = await this.#prisma.localAccount.findUnique({ where: { id } });
    if (record === null) return null;
    return localAccountRecord(record);
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

  public async saveEvaluationRunIdempotently(input: {
    readonly run: EvaluationRun;
    readonly scope: string;
    readonly key: string;
    readonly createdAt: string;
    readonly expiresAt: string;
  }): Promise<IdempotentMutationResult> {
    const run = EvaluationRunSchema.parse(input.run);
    const response = evaluationRunResponse(run);
    const expectedRequestHash = requestHash(input.scope, run);
    const expectedResponseHash = sha256CanonicalJson(response);
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        const existing = await transaction.idempotencyRecord.findUnique({
          where: { scope_key: { scope: input.scope, key: input.key } },
        });
        if (existing !== null) {
          return {
            response: replayIdempotency(existing, expectedRequestHash, expectedResponseHash),
            created: false,
          };
        }
        const historical = await transaction.idempotencyRecord.findUnique({
          where: { scope_key: { scope: LEGACY_EVALUATION_RUN_SCOPE, key: input.key } },
        });
        if (historical !== null) {
          return {
            response: replayHistoricalIdempotency(historical, expectedResponseHash),
            created: false,
          };
        }
        await transaction.evaluationRunRecord.create({
          data: {
            id: run.id,
            contentHash: run.contentHash,
            aggregateOutcome: run.evaluationSnapshot.evaluationResult.aggregateOutcome,
            validationScope: run.validationScope,
            payload: toInputJson(run),
            createdAt: new Date(run.recordedAt),
          },
        });
        await transaction.idempotencyRecord.create({
          data: {
            scope: input.scope,
            key: input.key,
            requestHash: expectedRequestHash,
            responseHash: expectedResponseHash,
            response: toInputJson(response),
            createdAt: new Date(input.createdAt),
            expiresAt: new Date(input.expiresAt),
          },
        });
        return { response, created: true };
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError("EvaluationRun already exists");
      }
      if (isRetryableTransactionError(error)) {
        throw new StorageConflictError("EvaluationRun write lost a concurrent race");
      }
      throw error;
    }
  }

  public async getEvaluationRun(id: string): Promise<EvaluationRun> {
    const record = await this.#prisma.evaluationRunRecord.findUnique({ where: { id } });
    if (record === null) throw new StorageNotFoundError(`EvaluationRun not found: ${id}`);
    return EvaluationRunSchema.parse(record.payload);
  }

  public async appendReviewDecision(decisionInput: ReviewDecision): Promise<ReviewDecision> {
    const decision = ReviewDecisionSchema.parse(decisionInput);
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        await this.#appendReviewDecision(transaction, decision);
        return decision;
      });
    } catch (error) {
      if (isUniqueConstraint(error))
        throw new StorageConflictError("ReviewDecision already exists");
      if (isRetryableTransactionError(error)) {
        throw new StorageConflictError("ReviewDecision write lost a concurrent race");
      }
      throw error;
    }
  }

  public async appendReviewDecisionIdempotently(input: {
    readonly decision: ReviewDecision;
    readonly scope: string;
    readonly key: string;
    readonly createdAt: string;
    readonly expiresAt: string;
  }): Promise<IdempotentMutationResult> {
    const decision = ReviewDecisionSchema.parse(input.decision);
    const response = reviewDecisionResponse(decision);
    const expectedRequestHash = requestHash(input.scope, decision);
    const expectedResponseHash = sha256CanonicalJson(response);
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        const existing = await transaction.idempotencyRecord.findUnique({
          where: { scope_key: { scope: input.scope, key: input.key } },
        });
        if (existing !== null) {
          return {
            response: replayIdempotency(existing, expectedRequestHash, expectedResponseHash),
            created: false,
          };
        }
        const historical = await transaction.idempotencyRecord.findUnique({
          where: {
            scope_key: { scope: legacyReviewDecisionScope(decision.runId), key: input.key },
          },
        });
        if (historical !== null) {
          return {
            response: replayHistoricalIdempotency(historical, expectedResponseHash),
            created: false,
          };
        }
        await this.#appendReviewDecision(transaction, decision);
        await transaction.idempotencyRecord.create({
          data: {
            scope: input.scope,
            key: input.key,
            requestHash: expectedRequestHash,
            responseHash: expectedResponseHash,
            response: toInputJson(response),
            createdAt: new Date(input.createdAt),
            expiresAt: new Date(input.expiresAt),
          },
        });
        return { response, created: true };
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError("ReviewDecision already exists or sequence is stale");
      }
      if (isRetryableTransactionError(error)) {
        throw new StorageConflictError("ReviewDecision write lost a concurrent race");
      }
      throw error;
    }
  }

  async #appendReviewDecision(
    transaction: Prisma.TransactionClient,
    decision: ReviewDecision,
  ): Promise<void> {
    const run = await transaction.evaluationRunRecord.findUnique({
      where: { id: decision.runId },
    });
    if (run === null) {
      throw new StorageNotFoundError(`EvaluationRun not found: ${decision.runId}`);
    }
    if (decision.runContentHash !== run.contentHash) {
      throw new StorageConflictError("ReviewDecision is bound to a stale EvaluationRun hash");
    }
    const previous = await transaction.reviewDecisionRecord.findFirst({
      where: { runId: decision.runId },
      orderBy: { sequence: "desc" },
    });
    if (decision.sequence !== (previous?.sequence ?? 0) + 1) {
      throw new StorageConflictError("ReviewDecision sequence is stale or non-contiguous");
    }
    if (decision.previousEventHash !== (previous?.contentHash ?? null)) {
      throw new StorageConflictError("ReviewDecision previous hash is stale");
    }
    await transaction.reviewDecisionRecord.create({
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
    readonly requestHash: string;
    readonly response: JsonValue;
    readonly createdAt: string;
    readonly expiresAt: string;
  }): Promise<{ readonly response: JsonValue; readonly created: boolean }> {
    const expectedRequestHash = Sha256DigestSchema.parse(input.requestHash);
    const responseHash = sha256CanonicalJson(input.response);
    const existing = await this.#prisma.idempotencyRecord.findUnique({
      where: { scope_key: { scope: input.scope, key: input.key } },
    });
    if (existing !== null) {
      return {
        response: replayIdempotency(existing, expectedRequestHash, responseHash),
        created: false,
      };
    }
    try {
      await this.#prisma.idempotencyRecord.create({
        data: {
          scope: input.scope,
          key: input.key,
          requestHash: expectedRequestHash,
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
        return {
          response: replayIdempotency(concurrent, expectedRequestHash, responseHash),
          created: false,
        };
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
