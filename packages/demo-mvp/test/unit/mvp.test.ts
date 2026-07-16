import { describe, expect, it } from "vitest";

import { DemoMvpReportSchema, runDemoMvp } from "../../src/index.js";

describe("synthetic demo MVP report", () => {
  it("covers ingestion, extraction, evaluation, review, audit and reporting", async () => {
    const { report } = await runDemoMvp();

    expect(DemoMvpReportSchema.parse(report)).toEqual(report);
    expect(report.validationScope).toBe("TECHNICAL_DEMO");
    expect(report.corpus.caseCount).toBe(20);
    expect(report.corpus.splitCounts).toEqual({
      development: 12,
      calibration: 4,
      blind: 4,
    });
    expect(report.ingestion).toMatchObject({
      caseCount: 20,
      documentCount: 60,
      pdfCount: 20,
      imageCount: 20,
      jsonCount: 20,
    });
    expect(report.extraction).toMatchObject({
      adapterId: "manual.demo-mvp",
      runCount: 20,
      factCount: 40,
      evidenceCount: 40,
    });
    expect(report.evaluation.matchedExpectedCases).toBe(20);
    expect(report.evaluation.outcomeCounts).toEqual({
      PASS: 5,
      FAIL: 5,
      REVIEW: 5,
      NOT_APPLICABLE: 5,
    });
    expect(report.review.completedDecisions).toBe(20);
    expect(report.audit.exportedRuns).toBe(20);
    expect(report.rulePack.testGatePassed).toBe(true);
    expect(report.disclaimer).toContain("Synthetic technical demonstration only");
  });

  it("limits tuning to development cases and preserves the blind split", async () => {
    const { report } = await runDemoMvp();
    const blindCaseIds = new Set(report.corpus.blindCaseIds);

    expect(report.tuning.maxCyclesAllowed).toBe(2);
    expect(report.tuning.cycles).toHaveLength(2);
    expect(report.tuning.blindSetImmutable).toBe(true);
    for (const cycle of report.tuning.cycles) {
      expect(cycle.splitUsed).toBe("development");
      expect(cycle.caseIds.some((caseId) => blindCaseIds.has(caseId))).toBe(false);
      expect(cycle.changeHash).toMatch(/^[0-9a-f]{64}$/u);
    }
  });
});
