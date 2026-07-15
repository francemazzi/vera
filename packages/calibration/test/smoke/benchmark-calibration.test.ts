import { describe, expect, it } from "vitest";

import { generateSyntheticCorpus, runSimulatedProvider } from "@vera/benchmark";

import { fitCalibrationProfile, observationsFromBenchmark } from "../../src/index.js";

describe("calibration smoke from synthetic benchmark", () => {
  it("replays the synthetic benchmark into a hash-pinned demo profile", () => {
    const corpus = generateSyntheticCorpus();
    const providerRun = runSimulatedProvider(corpus);
    const profile = fitCalibrationProfile({
      id: "00000000-0000-4000-8000-000000010003",
      version: "1.0.0-demo",
      modelName: providerRun.model,
      modelDigest: providerRun.modelDigest,
      targetKind: "FINDING",
      factKey: null,
      corpusHash: corpus.corpusHash,
      observations: observationsFromBenchmark(corpus, providerRun),
      binCount: 5,
      minSamples: 3,
      maxAcceptedRisk: 0.1,
    });

    expect(profile.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(profile.reliability).toHaveLength(5);
    expect(profile.riskCoverage.length).toBeGreaterThan(0);
  });
});
