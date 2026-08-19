import { ActivationEventSchema } from "@vera/contracts";
import type { ActivationEvent, ResolvedRulePack, RulePackResolutionRequest } from "@vera/contracts";
import {
  InMemoryRulePackActivationLedger,
  type ActivationAppendCommand,
  type RulePackActivationVersionReader,
} from "@vera/rules-core";

import type { Prisma } from "./generated/prisma/client.js";
import { parsePayload, toInputJson } from "./payload.js";
import type { VeraPrismaClient } from "./prisma.js";
import { StorageConflictError } from "./repository.js";
import { isUniqueConstraint, runSerializableWithRetries } from "./transaction.js";

type DbClient = VeraPrismaClient | Prisma.TransactionClient;

function indexedVersionId(event: ActivationEvent): string {
  const versionId = event.versionId ?? event.expectedPreviousVersionId;
  if (versionId === null) {
    throw new StorageConflictError(
      `Activation event ${event.id} has no indexable version identity`,
    );
  }
  return versionId;
}

/**
 * Prisma-backed activation ledger. Append/resolve hydrate trusted history into
 * {@link InMemoryRulePackActivationLedger} and persist accepted events.
 */
export class DurableRulePackActivationLedger {
  readonly #prisma: VeraPrismaClient;
  readonly #versionReader: RulePackActivationVersionReader;

  public constructor(prisma: VeraPrismaClient, versionReader: RulePackActivationVersionReader) {
    this.#prisma = prisma;
    this.#versionReader = versionReader;
  }

  public async appendEvent(
    eventInput: ActivationEvent,
    commandInput: ActivationAppendCommand,
  ): Promise<ActivationEvent> {
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        const prior = await transaction.activationEventRecord.findUnique({
          where: { id: eventInput.id },
          select: { id: true },
        });
        const memory = await this.#hydrateAll(transaction);
        const stored = memory.appendEvent(eventInput, commandInput);
        if (prior !== null) return stored;
        await transaction.activationEventRecord.create({
          data: {
            id: stored.id,
            packId: stored.packId,
            sequence: stored.sequence,
            type: stored.type,
            versionId: indexedVersionId(stored),
            contentHash: stored.contentHash,
            previousEventHash: stored.previousEventHash,
            payload: toInputJson(stored),
            recordedAt: new Date(stored.recordedAt),
          },
        });
        return stored;
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError("Activation event already exists or sequence is stale");
      }
      throw error;
    }
  }

  public async getHistory(packId: string): Promise<readonly ActivationEvent[]> {
    const rows = await this.#prisma.activationEventRecord.findMany({
      where: { packId },
      orderBy: { sequence: "asc" },
    });
    const events = rows.map((row) => parsePayload(ActivationEventSchema, row.payload));
    return InMemoryRulePackActivationLedger.fromHistory(events, this.#versionReader).getHistory(
      packId,
    );
  }

  public async resolve(requestInput: RulePackResolutionRequest): Promise<ResolvedRulePack> {
    const memory = await this.#hydrateAll(this.#prisma);
    return memory.resolve(requestInput);
  }

  async #hydrateAll(client: DbClient): Promise<InMemoryRulePackActivationLedger> {
    const rows = await client.activationEventRecord.findMany({
      orderBy: [{ packId: "asc" }, { sequence: "asc" }],
    });
    const events = rows.map((row) => parsePayload(ActivationEventSchema, row.payload));
    return InMemoryRulePackActivationLedger.fromHistory(events, this.#versionReader);
  }
}
