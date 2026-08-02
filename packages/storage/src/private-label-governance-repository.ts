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
import {
  PrivateLabelEuCountryCodeSchema,
  PrivateLabelRulePackSnapshotSchema,
  computePrivateLabelSourceSnapshotHash,
  privateLabelSourceBindings,
  type PrivateLabelRulePackSnapshot,
} from "./private-label-rule-pack.js";

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
    actorRole: z.enum(["SYNC_AGENT", "ADMIN"]),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const SourceTransitionInputSchema = z
  .object({
    sourceVersionId: z.uuid(),
    expectedSequence: z.int().min(1),
    expectedState: z.enum(["UNVERIFIED", "VERIFIED", "APPROVED"]),
    toState: z.enum(["VERIFIED", "APPROVED", "RETIRED"]),
    actorId: z.uuid(),
    actorRole: z.literal("ADMIN"),
    reason: z.string().trim().min(1).max(1_000).optional(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const RulePackSnapshotInputSchema = z
  .object({
    id: z.uuid(),
    version: z.string().trim().min(1).max(120),
    sourceSnapshotHash: DigestSchema,
    snapshot: PrivateLabelRulePackSnapshotSchema,
    createdByActorId: z.uuid(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const ActivationInputSchema = z
  .object({
    rulePackVersionId: z.uuid(),
    action: ActivationActionSchema,
    countryCodes: z.array(PrivateLabelEuCountryCodeSchema).min(1).max(27),
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
export type PrivateLabelActorRole = "SYNC_AGENT" | "ADMIN";
export type PrivateLabelSourceVersionInput = z.infer<typeof SourceVersionInputSchema>;
export type PrivateLabelSourceTransitionInput = z.infer<typeof SourceTransitionInputSchema>;
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

function sourceTransitionHash(input: {
  readonly versionId: string;
  readonly sequence: number;
  readonly fromState: PrivateLabelSourceState | null;
  readonly toState: PrivateLabelSourceState;
  readonly actorId: string;
  readonly actorRole: PrivateLabelActorRole;
  readonly reason: string | null;
  readonly createdAt: string;
  readonly contentHash: string;
}): string {
  return sha256CanonicalJson(input);
}

function privateSourceState(value: string): PrivateLabelSourceState {
  if (
    value === "UNVERIFIED" ||
    value === "VERIFIED" ||
    value === "APPROVED" ||
    value === "RETIRED"
  ) {
    return value;
  }
  throw new StorageValidationError("Private source state is invalid");
}

function canTransitionSource(
  fromState: PrivateLabelSourceState,
  toState: PrivateLabelSourceState,
): boolean {
  return (
    (fromState === "UNVERIFIED" && toState === "VERIFIED") ||
    (fromState === "VERIFIED" && toState === "APPROVED") ||
    (fromState === "APPROVED" && toState === "RETIRED")
  );
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
    const transitionHash = sourceTransitionHash({
      versionId: input.version.id,
      sequence: 1,
      fromState: null,
      toState: "UNVERIFIED",
      actorId: input.actorId,
      actorRole: input.actorRole,
      reason: null,
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
        const latestVersion = await transaction.privateLabelSourceVersion.findFirst({
          where: { sourceId: input.source.id },
          orderBy: { revision: "desc" },
        });
        const expectedRevision = (latestVersion?.revision ?? 0) + 1;
        if (input.version.revision !== expectedRevision) {
          throw new StorageConflictError(
            "Private source revision is not the next immutable revision",
          );
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

  /**
   * Appends the human verification/approval ledger. The creator, verifier and
   * approver must be three distinct ADMIN identities; a retired source keeps
   * its complete immutable history.
   */
  public async appendSourceTransition(inputValue: PrivateLabelSourceTransitionInput): Promise<{
    readonly id: string;
    readonly sequence: number;
    readonly state: PrivateLabelSourceState;
    readonly contentHash: string;
  }> {
    const input = SourceTransitionInputSchema.parse(inputValue);
    try {
      return await this.#prisma.$transaction(async (transaction) => {
        const sourceVersion = await transaction.privateLabelSourceVersion.findUnique({
          where: { id: input.sourceVersionId },
          include: {
            transitions: { orderBy: { sequence: "asc" } },
          },
        });
        if (sourceVersion === null)
          throw new StorageNotFoundError("Private source version not found");
        const previous = sourceVersion.transitions.at(-1);
        if (previous === undefined) {
          throw new StorageValidationError("Private source version has no creation transition");
        }
        const currentState = privateSourceState(previous.toState);
        if (previous.sequence !== input.expectedSequence || currentState !== input.expectedState) {
          throw new StorageConflictError("Private source transition expectation is stale");
        }
        if (!canTransitionSource(currentState, input.toState)) {
          throw new StorageValidationError("Private source transition is not allowed");
        }
        if (input.toState === "RETIRED" && input.reason === undefined) {
          throw new StorageValidationError("Private source retirement requires a reason");
        }
        const creatorsAndReviewers = sourceVersion.transitions
          .filter(({ toState }) => toState === "UNVERIFIED" || toState === "VERIFIED")
          .map(({ actorId }) => actorId);
        if (
          (input.toState === "VERIFIED" || input.toState === "APPROVED") &&
          creatorsAndReviewers.includes(input.actorId)
        ) {
          throw new StorageValidationError(
            "Private source verifier and approver must be distinct from prior contributors",
          );
        }
        const sequence = previous.sequence + 1;
        const contentHash = sourceTransitionHash({
          versionId: sourceVersion.id,
          sequence,
          fromState: currentState,
          toState: input.toState,
          actorId: input.actorId,
          actorRole: input.actorRole,
          reason: input.reason ?? null,
          createdAt: input.createdAt,
          contentHash: sourceVersion.contentHash,
        });
        const id = randomUUID();
        await transaction.privateLabelSourceTransition.create({
          data: {
            id,
            sourceVersionId: sourceVersion.id,
            sequence,
            fromState: currentState,
            toState: input.toState,
            actorId: input.actorId,
            actorRole: input.actorRole,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
            contentHash,
            createdAt: parseDate(input.createdAt),
          },
        });
        return { id, sequence, state: input.toState, contentHash };
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError(
          "Private source transition conflicts with a concurrent update",
        );
      }
      throw error;
    }
  }

  public async getSourceVersion(sourceVersionId: string): Promise<{
    readonly id: string;
    readonly sourceId: string;
    readonly revision: number;
    readonly contentHash: string;
    readonly contentObjectRef: string;
    readonly state: PrivateLabelSourceState;
    readonly transitions: readonly {
      readonly sequence: number;
      readonly fromState: PrivateLabelSourceState | null;
      readonly toState: PrivateLabelSourceState;
      readonly actorId: string;
      readonly reason: string | null;
      readonly contentHash: string;
      readonly createdAt: string;
    }[];
  }> {
    const sourceVersion = await this.#prisma.privateLabelSourceVersion.findUnique({
      where: { id: z.uuid().parse(sourceVersionId) },
      include: { transitions: { orderBy: { sequence: "asc" } } },
    });
    if (sourceVersion === null) throw new StorageNotFoundError("Private source version not found");
    const last = sourceVersion.transitions.at(-1);
    if (last === undefined) throw new StorageValidationError("Private source version has no state");
    return {
      id: sourceVersion.id,
      sourceId: sourceVersion.sourceId,
      revision: sourceVersion.revision,
      contentHash: sourceVersion.contentHash,
      contentObjectRef: sourceVersion.contentObjectRef,
      state: privateSourceState(last.toState),
      transitions: sourceVersion.transitions.map((transition) => ({
        sequence: transition.sequence,
        fromState: transition.fromState === null ? null : privateSourceState(transition.fromState),
        toState: privateSourceState(transition.toState),
        actorId: transition.actorId,
        reason: transition.reason,
        contentHash: transition.contentHash,
        createdAt: transition.createdAt.toISOString(),
      })),
    };
  }

  public async listSourceVersions(): Promise<
    readonly {
      readonly id: string;
      readonly sourceId: string;
      readonly stableReference: string;
      readonly title: string;
      readonly jurisdiction: string;
      readonly revision: number;
      readonly contentHash: string;
      readonly state: PrivateLabelSourceState;
    }[]
  > {
    const versions = await this.#prisma.privateLabelSourceVersion.findMany({
      include: { source: true, transitions: { orderBy: { sequence: "desc" }, take: 1 } },
      orderBy: [{ sourceId: "asc" }, { revision: "asc" }],
    });
    return versions.map((version) => {
      const state = version.transitions[0];
      if (state === undefined)
        throw new StorageValidationError("Private source version has no state");
      return {
        id: version.id,
        sourceId: version.sourceId,
        stableReference: version.source.stableReference,
        title: version.source.title,
        jurisdiction: version.source.jurisdiction,
        revision: version.revision,
        contentHash: version.contentHash,
        state: privateSourceState(state.toState),
      };
    });
  }

  async #assertSnapshotSourcesApproved(
    transaction: Pick<VeraPrismaClient, "privateLabelSourceVersion">,
    snapshot: PrivateLabelRulePackSnapshot,
  ): Promise<void> {
    const bindings = privateLabelSourceBindings(snapshot);
    const versions = await transaction.privateLabelSourceVersion.findMany({
      where: { id: { in: bindings.map(({ sourceVersionId }) => sourceVersionId) } },
      include: { transitions: { orderBy: { sequence: "desc" }, take: 1 } },
    });
    if (versions.length !== bindings.length) {
      throw new StorageValidationError("A rule pack references an unknown private source version");
    }
    const byId = new Map(versions.map((version) => [version.id, version] as const));
    for (const binding of bindings) {
      const version = byId.get(binding.sourceVersionId);
      if (version === undefined || version.contentHash !== binding.sourceContentHash) {
        throw new StorageValidationError(
          "A rule pack source hash does not match the private source",
        );
      }
      const state = version.transitions[0];
      if (state === undefined || privateSourceState(state.toState) !== "APPROVED") {
        throw new StorageValidationError("A rule pack requires approved private source versions");
      }
    }
  }

  public async saveRulePackSnapshot(inputValue: PrivateLabelRulePackSnapshotInput): Promise<{
    readonly id: string;
    readonly contentHash: string;
  }> {
    const input = RulePackSnapshotInputSchema.parse(inputValue);
    const computedSourceSnapshotHash = computePrivateLabelSourceSnapshotHash(input.snapshot);
    if (computedSourceSnapshotHash !== input.sourceSnapshotHash) {
      throw new StorageValidationError(
        "Private rule pack source snapshot hash does not match bindings",
      );
    }
    const contentHash = sha256CanonicalJson({
      version: input.version,
      sourceSnapshotHash: input.sourceSnapshotHash,
      snapshot: input.snapshot,
    });
    try {
      await this.#prisma.$transaction(async (transaction) => {
        await this.#assertSnapshotSourcesApproved(transaction, input.snapshot);
        await transaction.privateLabelRulePackVersion.create({
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
      if (input.action === "ACTIVATED") {
        const parsedSnapshot = PrivateLabelRulePackSnapshotSchema.parse(snapshot.snapshot);
        await this.#assertSnapshotSourcesApproved(transaction, parsedSnapshot);
      }
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
