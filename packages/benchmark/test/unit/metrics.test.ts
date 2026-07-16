import { describe, expect, it } from "vitest";

import {
  BenchmarkMetricReportSchema,
  computePointMetrics,
  generateSyntheticCorpus,
  runSimulatedProvider,
  runSyntheticBenchmark,
} from "../../src/index.js";

describe("synthetic benchmark metrics", () => {
  it("computes extraction and finding metrics for the deterministic simulated provider", () => {
    const corpus = generateSyntheticCorpus();
    const providerRun = runSimulatedProvider(corpus);
    const metrics = computePointMetrics(corpus.cases, providerRun.predictions);

    expect(metrics.extraction.precision).toBeCloseTo(76 / 79, 12);
    expect(metrics.extraction.recall).toBe(0.95);
    expect(metrics.extraction.missingRate).toBe(0.05);
    expect(metrics.extraction.hallucinationRate).toBeCloseTo(3 / 79, 12);
    expect(metrics.findings.sensitivity).toBe(0.6);
    expect(metrics.findings.specificity).toBe(1);
    expect(metrics.findings.falseNegativeRate).toBe(0.4);
    expect(metrics.findings.macroF1).toBeGreaterThan(0.85);
  });

  it("produces stable bootstrap reports and rejects tampered report hashes", () => {
    const corpus = generateSyntheticCorpus();
    const first = runSyntheticBenchmark(corpus, 50);
    const replay = runSyntheticBenchmark(corpus, 50);

    expect(first).toEqual(replay);
    expect(first.disclaimer).toContain("Synthetic technical benchmark only");
    expect(first.extraction.f1.ciLow).toBeLessThanOrEqual(first.extraction.f1.value);
    expect(first.extraction.f1.ciHigh).toBeGreaterThanOrEqual(first.extraction.f1.value);
    expect(() =>
      BenchmarkMetricReportSchema.parse({ ...first, reportHash: "0".repeat(64) }),
    ).toThrow(/reportHash/u);
    expect(() => runSyntheticBenchmark(corpus, 50, [])).toThrow(/provider matrix/u);
  });
});
