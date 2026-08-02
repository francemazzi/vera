import { StorageConflictError, StorageValidationError } from "@vera/storage";
import { z } from "zod";

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const SourceLedgerRequestSchema = z
  .object({
    action: z.enum(["CREATE_UNVERIFIED", "VERIFY", "APPROVE", "RETIRE"]),
    candidateId: z.uuid(),
    source: z
      .object({
        id: z.uuid(),
        // Keep the gateway contract aligned with the immutable VERA model.
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
    actor: z.object({ id: z.uuid(), role: z.literal("ADMIN") }).strict(),
    expectedSequence: z.int().min(1).optional(),
    reason: z.string().trim().min(1).max(1_000).optional(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type SourceLedgerRequest = z.infer<typeof SourceLedgerRequestSchema>;

/**
 * The backend forwards this identity only after it has authorized the SILTO
 * user in its own workspace. The Cloud Run caller is separately authenticated
 * with OIDC, so a browser cannot submit this record directly.
 */
export interface SourceLedgerActorContext {
  readonly actorId: string;
  readonly actorRole: "ADMIN";
}

export interface SourceLedgerRepository {
  createSourceVersion(input: {
    readonly source: {
      readonly id: string;
      readonly stableReference: string;
      readonly title: string;
      readonly jurisdiction: string;
    };
    readonly version: {
      readonly id: string;
      readonly revision: number;
      readonly contentHash: string;
      readonly contentObjectRef: string;
    };
    readonly actorId: string;
    readonly actorRole: "ADMIN";
    readonly createdAt: string;
  }): Promise<{
    readonly sourceVersionId: string;
    readonly state: "UNVERIFIED";
    readonly transitionHash: string;
  }>;
  appendSourceTransition(input: {
    readonly sourceVersionId: string;
    readonly expectedSequence: number;
    readonly expectedState: "UNVERIFIED" | "VERIFIED" | "APPROVED";
    readonly toState: "VERIFIED" | "APPROVED" | "RETIRED";
    readonly actorId: string;
    readonly actorRole: "ADMIN";
    readonly reason?: string;
    readonly createdAt: string;
  }): Promise<{
    readonly id: string;
    readonly sequence: number;
    readonly state: string;
    readonly contentHash: string;
  }>;
  getSourceVersion(sourceVersionId: string): Promise<{
    readonly id: string;
    readonly contentHash: string;
    readonly state: "UNVERIFIED" | "VERIFIED" | "APPROVED" | "RETIRED";
    readonly transitions: readonly {
      readonly sequence: number;
      readonly toState: "UNVERIFIED" | "VERIFIED" | "APPROVED" | "RETIRED";
      readonly actorId: string;
    }[];
  }>;
}

function assertActorMatches(request: SourceLedgerRequest, actor: SourceLedgerActorContext): void {
  if (request.actor.id !== actor.actorId || request.actor.role !== actor.actorRole) {
    throw new SourceLedgerError(
      "Forwarded source-ledger actor does not match the request payload",
      false,
    );
  }
}

function transitionFor(action: Exclude<SourceLedgerRequest["action"], "CREATE_UNVERIFIED">): {
  readonly expectedState: "UNVERIFIED" | "VERIFIED" | "APPROVED";
  readonly toState: "VERIFIED" | "APPROVED" | "RETIRED";
} {
  if (action === "VERIFY") return { expectedState: "UNVERIFIED", toState: "VERIFIED" };
  if (action === "APPROVE") return { expectedState: "VERIFIED", toState: "APPROVED" };
  return { expectedState: "APPROVED", toState: "RETIRED" };
}

export class SourceLedgerError extends Error {
  public constructor(
    message: string,
    public readonly retryable: boolean,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "SourceLedgerError";
  }
}

async function existingSourceVersion(
  repository: SourceLedgerRepository,
  sourceVersionId: string,
): Promise<Awaited<ReturnType<SourceLedgerRepository["getSourceVersion"]>>> {
  try {
    return await repository.getSourceVersion(sourceVersionId);
  } catch (error) {
    // A concurrent transaction can report a conflict before its data becomes
    // visible. Make that condition retryable rather than leaking a 500 or
    // claiming an idempotent transition without reading the ledger.
    throw new SourceLedgerError("Unable to read the immutable source ledger", true, {
      cause: error,
    });
  }
}

/**
 * Writes the immutable VERA source ledger. It is intentionally independent of
 * candidate state: backend policy remains the only authority for workspace
 * access and the ledger never sees source bodies.
 */
export async function applySourceLedgerAction(input: {
  readonly repository: SourceLedgerRepository;
  readonly request: SourceLedgerRequest;
  readonly actor: SourceLedgerActorContext;
}): Promise<{
  readonly sourceVersionId: string;
  readonly state: string;
  readonly sequence: number;
}> {
  const request = SourceLedgerRequestSchema.parse(input.request);
  assertActorMatches(request, input.actor);
  if (request.action === "CREATE_UNVERIFIED") {
    try {
      const created = await input.repository.createSourceVersion({
        source: request.source,
        version: request.version,
        actorId: input.actor.actorId,
        actorRole: "ADMIN",
        createdAt: request.createdAt,
      });
      return { sourceVersionId: created.sourceVersionId, state: created.state, sequence: 1 };
    } catch (error) {
      if (!(error instanceof StorageConflictError)) {
        throw new SourceLedgerError("Unable to create immutable source version", true, {
          cause: error,
        });
      }
      const existing = await existingSourceVersion(input.repository, request.version.id);
      if (existing.contentHash !== request.version.contentHash) {
        throw new SourceLedgerError(
          "Immutable source version conflicts with different content",
          false,
        );
      }
      return {
        sourceVersionId: existing.id,
        state: existing.state,
        sequence: existing.transitions.at(-1)?.sequence ?? 1,
      };
    }
  }

  const transition = transitionFor(request.action);
  if (request.expectedSequence === undefined) {
    throw new SourceLedgerError("Source ledger transition requires expectedSequence", false);
  }
  try {
    const appended = await input.repository.appendSourceTransition({
      sourceVersionId: request.version.id,
      expectedSequence: request.expectedSequence,
      expectedState: transition.expectedState,
      toState: transition.toState,
      actorId: input.actor.actorId,
      actorRole: "ADMIN",
      ...(request.reason === undefined ? {} : { reason: request.reason }),
      createdAt: request.createdAt,
    });
    return {
      sourceVersionId: request.version.id,
      state: appended.state,
      sequence: appended.sequence,
    };
  } catch (error) {
    if (!(error instanceof StorageConflictError) && !(error instanceof StorageValidationError)) {
      throw new SourceLedgerError("Unable to append immutable source transition", true, {
        cause: error,
      });
    }
    const existing = await existingSourceVersion(input.repository, request.version.id);
    const latest = existing.transitions.at(-1);
    if (latest?.toState === transition.toState) {
      return { sourceVersionId: existing.id, state: existing.state, sequence: latest.sequence };
    }
    throw new SourceLedgerError("Immutable source transition conflicts with ledger state", false, {
      cause: error,
    });
  }
}
