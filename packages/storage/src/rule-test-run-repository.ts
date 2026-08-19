import { randomUUID } from "node:crypto";

import { RulePackImpactReportSchema, RuleTestRunResultSchema } from "@vera/contracts";
import type { RulePackImpactReport, RuleTestRunResult } from "@vera/contracts";

import { parsePayload, toInputJson } from "./payload.js";
import type { VeraPrismaClient } from "./prisma.js";
import { StorageConflictError, StorageNotFoundError } from "./repository.js";
import { isUniqueConstraint, runSerializableWithRetries } from "./transaction.js";

/**
 * Prisma persistence for immutable Rule Test runs and Rule Pack impact reports.
 * Idempotent upserts key on requestId/contentHash (runs) or contentHash (reports).
 */
export class DurableRuleTestRunRepository {
  readonly #prisma: VeraPrismaClient;

  public constructor(prisma: VeraPrismaClient) {
    this.#prisma = prisma;
  }

  public async saveTestRun(result: RuleTestRunResult): Promise<RuleTestRunResult> {
    const parsed = RuleTestRunResultSchema.parse(result);
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        const byRequest = await transaction.ruleTestRunRecord.findUnique({
          where: { requestId: parsed.requestId },
        });
        if (byRequest !== null) {
          if (byRequest.contentHash !== parsed.contentHash) {
            throw new StorageConflictError(
              "Rule test run requestId already exists with different content",
            );
          }
          return parsePayload(RuleTestRunResultSchema, byRequest.payload);
        }

        const byHash = await transaction.ruleTestRunRecord.findUnique({
          where: { contentHash: parsed.contentHash },
        });
        if (byHash !== null) {
          if (byHash.requestId !== parsed.requestId) {
            throw new StorageConflictError(
              "Rule test run contentHash already exists with different requestId",
            );
          }
          return parsePayload(RuleTestRunResultSchema, byHash.payload);
        }

        await transaction.ruleTestRunRecord.create({
          data: {
            id: parsed.requestId,
            requestId: parsed.requestId,
            rulePackVersionId: parsed.rulePackVersionId,
            rulePackVersionContentHash: parsed.rulePackVersionContentHash,
            contentHash: parsed.contentHash,
            passed: parsed.passed,
            validationScope: parsed.validationScope,
            payload: toInputJson(parsed),
          },
        });
        return parsed;
      });
    } catch (error) {
      if (error instanceof StorageConflictError) throw error;
      if (isUniqueConstraint(error)) {
        throw new StorageConflictError("Rule test run already exists");
      }
      throw error;
    }
  }

  public async getTestRun(id: string): Promise<RuleTestRunResult> {
    const record = await this.#prisma.ruleTestRunRecord.findUnique({ where: { id } });
    if (record === null) throw new StorageNotFoundError(`Rule test run not found: ${id}`);
    return parsePayload(RuleTestRunResultSchema, record.payload);
  }

  public async getTestRunByRequestId(requestId: string): Promise<RuleTestRunResult> {
    const record = await this.#prisma.ruleTestRunRecord.findUnique({ where: { requestId } });
    if (record === null) {
      throw new StorageNotFoundError(`Rule test run not found for requestId: ${requestId}`);
    }
    return parsePayload(RuleTestRunResultSchema, record.payload);
  }

  public async saveImpactReport(report: RulePackImpactReport): Promise<RulePackImpactReport> {
    const parsed = RulePackImpactReportSchema.parse(report);
    try {
      return await runSerializableWithRetries(this.#prisma, async (transaction) => {
        const existing = await transaction.rulePackImpactReportRecord.findUnique({
          where: { contentHash: parsed.contentHash },
        });
        if (existing !== null) {
          return parsePayload(RulePackImpactReportSchema, existing.payload);
        }
        await transaction.rulePackImpactReportRecord.create({
          data: {
            id: randomUUID(),
            contentHash: parsed.contentHash,
            validationScope: parsed.validationScope,
            payload: toInputJson(parsed),
          },
        });
        return parsed;
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        const concurrent = await this.#prisma.rulePackImpactReportRecord.findUnique({
          where: { contentHash: parsed.contentHash },
        });
        if (concurrent !== null) {
          return parsePayload(RulePackImpactReportSchema, concurrent.payload);
        }
        throw new StorageConflictError("Rule Pack impact report already exists");
      }
      throw error;
    }
  }

  public async getImpactReport(id: string): Promise<RulePackImpactReport> {
    const record = await this.#prisma.rulePackImpactReportRecord.findUnique({ where: { id } });
    if (record === null) {
      throw new StorageNotFoundError(`Rule Pack impact report not found: ${id}`);
    }
    return parsePayload(RulePackImpactReportSchema, record.payload);
  }
}
