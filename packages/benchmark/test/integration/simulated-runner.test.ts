import { describe, expect, it } from "vitest";

import {
  BenchmarkMetricReportSchema,
  generateSyntheticCorpus,
  runSyntheticBenchmark,
} from "../../src/index.js";

describe("synthetic benchmark runner integration", () => {
  it("completes a simulated provider run with schema-valid metrics and hashes", () => {
    const corpus = generateSyntheticCorpus();
    const report = runSyntheticBenchmark(corpus, 100, [
      {
        model: "synthetic-ollama-sim",
        modelDigest: "5".repeat(64),
        runtimeVersion: "simulated-0.1.0",
        prompt: "Extract synthetic facts and classify the synthetic compliance outcome.",
        options: { temperature: 0, seed: 42 },
      },
      {
        model: "synthetic-ollama-sim-alt",
        modelDigest: "6".repeat(64),
        runtimeVersion: "simulated-0.1.0",
        prompt: "Alternative synthetic prompt",
        options: { temperature: 0, seed: 43 },
      },
    ]);

    expect(BenchmarkMetricReportSchema.parse(report)).toEqual(report);
    expect(report.corpusHash).toBe(corpus.corpusHash);
    expect(report.providerRuns).toHaveLength(2);
    expect(report.providerRuns[0]?.predictions).toHaveLength(corpus.cases.length);
    expect(report.providerRuns[0]?.providerKind).toBe("SIMULATED_OLLAMA");
    expect(report.reportHash).toMatch(/^[0-9a-f]{64}$/u);
  });
});
