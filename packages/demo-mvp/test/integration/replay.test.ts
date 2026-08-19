import { describe, expect, it } from "vitest";

import {
  canonicalizeEvaluationAuditExport,
  verifyEvaluationAuditExportHash,
} from "@vera/contracts";
import { replayEvaluationAuditExport } from "@vera/rules-core";

import { runDemoMvp } from "../../src/index.js";

describe("synthetic demo MVP replay", () => {
  it("is deterministic from seed, hashes, snapshots and provider digest", async () => {
    const first = await runDemoMvp();
    const second = await runDemoMvp();

    expect(second.report.contentHash).toBe(first.report.contentHash);
    expect(second.report.corpus.corpusHash).toBe(first.report.corpus.corpusHash);
    expect(second.report.rulePack.contentHash).toBe(first.report.rulePack.contentHash);
    expect(second.report.benchmark.modelDigest).toBe(first.report.benchmark.modelDigest);
    expect(second.report.audit.exportHash).toBe(first.report.audit.exportHash);
  }, 30_000);

  it("exports immutable audit records that replay to the evaluation snapshots", async () => {
    const { cases, report } = await runDemoMvp();
    const canonicalExports = cases.map(({ auditExport, evaluation }) => {
      expect(verifyEvaluationAuditExportHash(auditExport)).toBe(true);
      const replay = replayEvaluationAuditExport(auditExport);
      expect(replay.evaluationSnapshot.contentHash).toBe(evaluation.contentHash);
      expect(replay.reviewDecisions).toHaveLength(1);
      expect(replay.reviewDecisions[0]?.decision).toBe("CONFIRM");
      return canonicalizeEvaluationAuditExport(auditExport);
    });

    expect(canonicalExports).toHaveLength(report.audit.exportedRuns);
    expect(report.audit.replayHash).toMatch(/^[0-9a-f]{64}$/u);
  }, 30_000);
});
