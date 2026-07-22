import {
  ComplianceSourceSchema,
  ComplianceSourceTransitionEventSchema,
  ComplianceSourceVersionSchema,
  type ComplianceSource,
  type ComplianceSourceState,
  type ComplianceSourceTransitionEvent,
  type ComplianceSourceVersion,
  type UtcDateTime,
} from "@vera/contracts";
import {
  ComplianceSourceNotFoundError,
  InMemoryComplianceSourceRepository,
  type ComplianceSourceHistory,
  type ComplianceSourceTransitionAuthorization,
  type TransitionExpectation,
  type VersionActivationEligibilityRequest,
} from "@vera/rules-core";

import type { Prisma } from "./generated/prisma/client.js";
import { parsePayload, toInputJson } from "./payload.js";
import type { VeraPrismaClient } from "./prisma.js";
import { StorageConflictError } from "./repository.js";
import { isUniqueConstraint, runSerializableWithRetries } from "./transaction.js";

type TransactionClient = Prisma.TransactionClient;

export class DurableComplianceSourceRepository {
  readonly #prisma: VeraPrismaClient;

  public constructor(prisma: VeraPrismaClient) {
    this.#prisma = prisma;
  }

  public async addSource(source: ComplianceSource): Promise<ComplianceSource> {
    const stored = new InMemoryComplianceSourceRepository().addSource(source);
    try {
      await this.#prisma.complianceSourceRecord.create({
        data: {
          id: stored.id,
          type: stored.type,
          domain: stored.domain,
          jurisdiction: stored.jurisdiction,
          title: stored.title,
          stableReference: stored.stableReference,
          validationScope: stored.validationScope,
          payload: toInputJson(stored),
          createdAt: new Date(),
        },
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError("Compliance source already exists");
      }
      throw error;
    }
    return stored;
  }

  public async appendVersion(
    version: ComplianceSourceVersion,
    expectedCurrentRevision: number,
  ): Promise<ComplianceSourceVersion> {
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        const sourceRow = await transaction.complianceSourceRecord.findUnique({
          where: { id: version.sourceId },
          select: { id: true },
        });
        if (sourceRow === null) {
          return new InMemoryComplianceSourceRepository().appendVersion(
            version,
            expectedCurrentRevision,
          );
        }

        const history = await this.#loadSourceHistory(transaction, version.sourceId);
        const memory = InMemoryComplianceSourceRepository.fromHistory(history);
        const stored = memory.appendVersion(version, expectedCurrentRevision);
        await transaction.complianceSourceVersionRecord.create({
          data: {
            id: stored.id,
            sourceId: stored.sourceId,
            revision: stored.revision,
            contentHash: stored.contentHash,
            replacesVersionId: stored.replacesVersionId,
            payload: toInputJson(stored),
            createdAt: new Date(stored.createdAt),
          },
        });
        return stored;
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError(
          "Compliance source version already exists or revision is stale",
        );
      }
      throw error;
    }
  }

  public async appendTransition(
    event: ComplianceSourceTransitionEvent,
    authorization: ComplianceSourceTransitionAuthorization,
    expected: TransitionExpectation,
  ): Promise<ComplianceSourceTransitionEvent> {
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        const versionRow = await transaction.complianceSourceVersionRecord.findUnique({
          where: { id: event.versionId },
          select: { sourceId: true },
        });
        if (versionRow === null) {
          return new InMemoryComplianceSourceRepository().appendTransition(
            event,
            authorization,
            expected,
          );
        }

        const history = await this.#loadSourceHistory(transaction, versionRow.sourceId);
        const memory = InMemoryComplianceSourceRepository.fromHistory(history);
        const stored = memory.appendTransition(event, authorization, expected);
        await transaction.complianceSourceTransitionRecord.create({
          data: {
            id: stored.id,
            versionId: stored.versionId,
            sequence: stored.sequence,
            fromState: stored.from,
            toState: stored.to,
            actorId: stored.actorId,
            contentHash: stored.contentHash,
            payload: toInputJson(stored),
            createdAt: new Date(stored.at),
          },
        });
        return stored;
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError(
          "Compliance source transition already exists or sequence is stale",
        );
      }
      throw error;
    }
  }

  public async getSource(sourceId: string): Promise<ComplianceSource> {
    const row = await this.#prisma.complianceSourceRecord.findUnique({
      where: { id: sourceId },
    });
    if (row === null) {
      throw new ComplianceSourceNotFoundError(
        "SOURCE_NOT_FOUND",
        `Compliance source ${sourceId} does not exist`,
        { sourceId },
      );
    }
    return parsePayload(ComplianceSourceSchema, row.payload);
  }

  public async getVersion(versionId: string): Promise<ComplianceSourceVersion> {
    const row = await this.#prisma.complianceSourceVersionRecord.findUnique({
      where: { id: versionId },
    });
    if (row === null) {
      throw new ComplianceSourceNotFoundError(
        "VERSION_NOT_FOUND",
        `Compliance source version ${versionId} does not exist`,
        { versionId },
      );
    }
    return parsePayload(ComplianceSourceVersionSchema, row.payload);
  }

  public async getVersions(sourceId: string): Promise<readonly ComplianceSourceVersion[]> {
    await this.getSource(sourceId);
    const rows = await this.#prisma.complianceSourceVersionRecord.findMany({
      where: { sourceId },
      orderBy: { revision: "asc" },
    });
    return rows.map((row) => parsePayload(ComplianceSourceVersionSchema, row.payload));
  }

  public async getVersionState(versionId: string): Promise<ComplianceSourceState | null> {
    await this.getVersion(versionId);
    const last = await this.#prisma.complianceSourceTransitionRecord.findFirst({
      where: { versionId },
      orderBy: { sequence: "desc" },
    });
    if (last === null) return null;
    return parsePayload(ComplianceSourceTransitionEventSchema, last.payload).to;
  }

  public async getVersionStateAt(
    versionId: string,
    at: UtcDateTime,
  ): Promise<ComplianceSourceState | null> {
    const memory = await this.#hydrateForVersionOrEmpty(versionId);
    return memory.getVersionStateAt(versionId, at);
  }

  public async getTransitionHistory(
    versionId: string,
  ): Promise<readonly ComplianceSourceTransitionEvent[]> {
    await this.getVersion(versionId);
    const rows = await this.#prisma.complianceSourceTransitionRecord.findMany({
      where: { versionId },
      orderBy: { sequence: "asc" },
    });
    return rows.map((row) => parsePayload(ComplianceSourceTransitionEventSchema, row.payload));
  }

  public async getSourceHistory(sourceId: string): Promise<ComplianceSourceHistory> {
    return this.#loadSourceHistory(this.#prisma, sourceId);
  }

  public async assertVersionEligibleForActivation(
    request: VersionActivationEligibilityRequest,
  ): Promise<ComplianceSourceVersion> {
    const memory = await this.#hydrateForVersionOrEmpty(request.versionId);
    return memory.assertVersionEligibleForActivation(request);
  }

  async #hydrateForVersionOrEmpty(
    versionId: string,
  ): Promise<InMemoryComplianceSourceRepository> {
    const versionRow = await this.#prisma.complianceSourceVersionRecord.findUnique({
      where: { id: versionId },
      select: { sourceId: true },
    });
    if (versionRow === null) {
      return new InMemoryComplianceSourceRepository();
    }
    const history = await this.#loadSourceHistory(this.#prisma, versionRow.sourceId);
    return InMemoryComplianceSourceRepository.fromHistory(history);
  }

  async #loadSourceHistory(
    client: VeraPrismaClient | TransactionClient,
    sourceId: string,
  ): Promise<ComplianceSourceHistory> {
    const sourceRow = await client.complianceSourceRecord.findUnique({
      where: { id: sourceId },
    });
    if (sourceRow === null) {
      throw new ComplianceSourceNotFoundError(
        "SOURCE_NOT_FOUND",
        `Compliance source ${sourceId} does not exist`,
        { sourceId },
      );
    }

    const versionRows = await client.complianceSourceVersionRecord.findMany({
      where: { sourceId },
      orderBy: { revision: "asc" },
      include: {
        transitions: {
          orderBy: { sequence: "asc" },
        },
      },
    });

    return {
      source: parsePayload(ComplianceSourceSchema, sourceRow.payload),
      versions: versionRows.map((versionRow) => {
        const transitions = versionRow.transitions.map((transitionRow) =>
          parsePayload(ComplianceSourceTransitionEventSchema, transitionRow.payload),
        );
        return {
          version: parsePayload(ComplianceSourceVersionSchema, versionRow.payload),
          state: transitions.at(-1)?.to ?? null,
          transitions,
        };
      }),
    };
  }
}
