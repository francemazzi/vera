import { randomUUID } from "node:crypto";

import { sha256CanonicalJson } from "@vera/contracts";
import { z } from "zod";

import type { Prisma } from "./generated/prisma/client.js";
import type { VeraPrismaClient } from "./prisma.js";
import {
  StorageConflictError,
  StorageNotFoundError,
  StorageValidationError,
} from "./repository.js";

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const ActivationActionSchema = z.enum(["ACTIVATED", "DEACTIVATED"]);
const JsonSchema: z.ZodType<Prisma.InputJsonValue> = z.json() as z.ZodType<Prisma.InputJsonValue>;

const SourceVersionInputSchema = z
  .object({
    source: z
      .object({
        id: z.uuid(),
        stableReference: z.string().trim().min(1).max(500),
        title: z.string().trim().min(1).max(300),
        jurisdiction: z.string().trim().min(1).max(120),
      })
      .strict(),
    version: z
      .object({
        id: z.uuid(),
        revision: z.int().min(1),
        contentHash: DigestSchema,
        contentObjectRef: z.string().trim().min(1).max(1_000),
      })
      .strict(),
    actorId: z.uuid(),
    actorRole: z.enum(["SYNC_AGENT", "AUTHOR"]),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const RulePackSnapshotInputSchema = z
  .object({
    id: z.uuid(),
    version: z.string().trim().min(1).max(120),
    sourceSnapshotHash: DigestSchema,
    snapshot: JsonSchema,
    createdByActorId: z.uuid(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const ActivationInputSchema = z
  .object({
    rulePackVersionId: z.uuid(),
    action: ActivationActionSchema,
    countryCodes: z
      .array(z.string().regex(/^[A-Z]{2}$/u))
      .min(1)
      .max(27),
    actorId: z.uuid(),
    reason: z.string().trim().min(1).max(1_000).optional(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const EvaluationRunInputSchema = z
  .object({
    id: z.uuid(),
    externalAnalysisId: z.uuid(),
    inputSha256: DigestSchema,
    provider: z.literal("openrouter"),
    model: z.string().trim().min(1).max(240),
    promptVersion: z.string().trim().min(1).max(120),
    rulePackVersionId: z.uuid(),
    sourceSnapshotHash: DigestSchema,
    controls: JsonSchema,
    evidenceRefs: JsonSchema,
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type PrivateLabelSourceState = "UNVERIFIED" | "VERIFIED" | "APPROVED" | "RETIRED";
export type PrivateLabelActorRole = "SYNC_AGENT" | "AUTHOR" | "REVIEWER" | "APPROVER" | "ADMIN";
export type PrivateLabelSourceVersionInput = z.infer<typeof SourceVersionInputSchema>;
export type PrivateLabelRulePackSnapshotInput = z.infer<typeof RulePackSnapshotInputSchema>;
export type PrivateLabelActivationInput = z.infer<typeof ActivationInputSchema>;
export type PrivateLabelEvaluationRunInput = z.infer<typeof EvaluationRunInputSchema>;

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "P2002"
  );
}

function parseDate(value: string): Date {
  return new Date(value);
}

/**
 * Private persistence for SILTO-LABEL. It stores opaque GCS references and
 * hashes, never source body text or credentials in the public repository.
 */
export class PrivateLabelGovernanceRepository {
  readonly #prisma: VeraPrismaClient;

  public constructor(prisma: VeraPrismaClient) {
    this.#prisma = prisma;
  }

  public async createSourceVersion(inputValue: PrivateLabelSourceVersionInput): Promise<{
    readonly sourceVersionId: string;
    readonly state: "UNVERIFIED";
    readonly transitionHash: string;
  }> {
    const input = SourceVersionInputSchema.parse(inputValue);
    const transitionHash = sha256CanonicalJson({
      versionId: input.version.id,
      sequence: 1,
      fromState: null,
      toState: "UNVERIFIED",
      actorId: input.actorId,
      actorRole: input.actorRole,
      createdAt: input.createdAt,
      contentHash: input.version.contentHash,
    });
    try {
      await this.#prisma.$transaction(async (transaction) => {
        const existing = await transaction.privateLabelSource.findUnique({
          where: { id: input.source.id },
        });
        if (existing === null) {
          await transaction.privateLabelSource.create({
            data: {
              ...input.source,
              createdAt: parseDate(input.createdAt),
              createdByActorId: input.actorId,
            },
          });
        } else if (
          existing.stableReference !== input.source.stableReference ||
          existing.title !== input.source.title ||
          existing.jurisdiction !== input.source.jurisdiction
        ) {
          throw new StorageValidationError("A private source identity is immutable");
        }
        await transaction.privateLabelSourceVersion.create({
          data: {
            id: input.version.id,
            sourceId: input.source.id,
            revision: input.version.revision,
            contentHash: input.version.contentHash,
            contentObjectRef: input.version.contentObjectRef,
            createdAt: parseDate(input.createdAt),
            createdByActorId: input.actorId,
          },
        });
        await transaction.privateLabelSourceTransition.create({
          data: {
            id: randomUUID(),
            sourceVersionId: input.version.id,
            sequence: 1,
            fromState: null,
            toState: "UNVERIFIED",
            actorId: input.actorId,
            actorRole: input.actorRole,
            contentHash: transitionHash,
            createdAt: parseDate(input.createdAt),
          },
        });
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError("Private source version already exists");
      }
      throw error;
    }
    return { sourceVersionId: input.version.id, state: "UNVERIFIED", transitionHash };
  }

  public async saveRulePackSnapshot(inputValue: PrivateLabelRulePackSnapshotInput): Promise<{
    readonly id: string;
    readonly contentHash: string;
  }> {
    const input = RulePackSnapshotInputSchema.parse(inputValue);
    const contentHash = sha256CanonicalJson({
      version: input.version,
      sourceSnapshotHash: input.sourceSnapshotHash,
      snapshot: input.snapshot,
    });
    try {
      await this.#prisma.privateLabelRulePackVersion.create({
        data: {
          id: input.id,
          version: input.version,
          contentHash,
          sourceSnapshotHash: input.sourceSnapshotHash,
          snapshot: input.snapshot,
          createdAt: parseDate(input.createdAt),
          createdByActorId: input.createdByActorId,
        },
      });
    } catch (error) {
      if (isUniqueConstraint(error))
        throw new StorageConflictError("Rule pack snapshot already exists");
      throw error;
    }
    return { id: input.id, contentHash };
  }

  public async appendRulePackActivation(inputValue: PrivateLabelActivationInput): Promise<{
    readonly id: string;
    readonly sequence: number;
    readonly contentHash: string;
  }> {
    const input = ActivationInputSchema.parse(inputValue);
    return this.#prisma.$transaction(async (transaction) => {
      const snapshot = await transaction.privateLabelRulePackVersion.findUnique({
        where: { id: input.rulePackVersionId },
      });
      if (snapshot === null) throw new StorageNotFoundError("Private rule pack snapshot not found");
      const previous = await transaction.privateLabelRulePackActivation.findFirst({
        where: { rulePackVersionId: input.rulePackVersionId },
        orderBy: { sequence: "desc" },
      });
      const sequence = (previous?.sequence ?? 0) + 1;
      const contentHash = sha256CanonicalJson({
        rulePackVersionId: input.rulePackVersionId,
        sequence,
        action: input.action,
        countryCodes: [...input.countryCodes].sort(),
        actorId: input.actorId,
        reason: input.reason ?? null,
        previousEventHash: previous?.contentHash ?? null,
        createdAt: input.createdAt,
      });
      const id = randomUUID();
      await transaction.privateLabelRulePackActivation.create({
        data: {
          id,
          rulePackVersionId: input.rulePackVersionId,
          sequence,
          action: input.action,
          countryCodes: [...new Set(input.countryCodes)].sort(),
          actorId: input.actorId,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(previous === null ? {} : { previousEventHash: previous.contentHash }),
          contentHash,
          createdAt: parseDate(input.createdAt),
        },
      });
      return { id, sequence, contentHash };
    });
  }

  public async saveEvaluationRun(inputValue: PrivateLabelEvaluationRunInput): Promise<{
    readonly id: string;
    readonly contentHash: string;
  }> {
    const input = EvaluationRunInputSchema.parse(inputValue);
    const snapshot = await this.#prisma.privateLabelRulePackVersion.findUnique({
      where: { id: input.rulePackVersionId },
    });
    if (snapshot === null) throw new StorageNotFoundError("Private rule pack snapshot not found");
    if (snapshot.sourceSnapshotHash !== input.sourceSnapshotHash) {
      throw new StorageValidationError("Evaluation source snapshot does not match the rule pack");
    }
    const contentHash = sha256CanonicalJson({ ...input });
    try {
      await this.#prisma.privateLabelEvaluationRun.create({
        data: {
          ...input,
          contentHash,
          createdAt: parseDate(input.createdAt),
        },
      });
    } catch (error) {
      if (isUniqueConstraint(error))
        throw new StorageConflictError("Private evaluation run already exists");
      throw error;
    }
    return { id: input.id, contentHash };
  }
}
