import { describe, expect, it } from "vitest";

import { generateSyntheticCorpus, runSimulatedProvider } from "@vera/benchmark";

import {
  applyCalibration,
  fitCalibrationProfile,
  observationsFromBenchmark,
  selectCalibrationProfile,
} from "../../src/index.js";

describe("benchmark-backed calibration integration", () => {
  it("fits a versioned profile from the synthetic benchmark calibration split", () => {
    const corpus = generateSyntheticCorpus();
    const providerRun = runSimulatedProvider(corpus);
    const observations = observationsFromBenchmark(corpus, providerRun);
    const profile = fitCalibrationProfile({
      id: "00000000-0000-4000-8000-000000010001",
      version: "1.0.0",
      modelName: providerRun.model,
      modelDigest: providerRun.modelDigest,
      targetKind: "FINDING",
      factKey: null,
      corpusHash: corpus.corpusHash,
      observations,
      binCount: 5,
      minSamples: 3,
      maxAcceptedRisk: 0.1,
    });

    expect(profile.sampleCount).toBe(4);
    expect(profile.threshold).toBe(0.9);
    expect(profile.validationScope).toBe("TECHNICAL_DEMO");
    expect(
      selectCalibrationProfile([profile], {
        modelDigest: providerRun.modelDigest,
        targetKind: "FINDING",
        factKey: null,
        corpusHash: corpus.corpusHash,
      })?.id,
    ).toBe(profile.id);
    expect(
      applyCalibration(profile, {
        score: 0.9,
        proposedOutcome: "PASS",
        riskLevel: "CRITICAL",
      }),
    ).toMatchObject({ decision: "REVIEW", reason: "HIGH_RISK_PASS_BLOCKED" });
  });

  it("returns no compatible profile across model or corpus boundaries", () => {
    const corpus = generateSyntheticCorpus();
    const providerRun = runSimulatedProvider(corpus);
    const profile = fitCalibrationProfile({
      id: "00000000-0000-4000-8000-000000010002",
      version: "1.0.0",
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

    expect(
      selectCalibrationProfile([profile], {
        modelDigest: "9".repeat(64),
        targetKind: "FINDING",
        factKey: null,
        corpusHash: corpus.corpusHash,
      }),
    ).toBeNull();
    expect(
      selectCalibrationProfile([profile], {
        modelDigest: providerRun.modelDigest,
        targetKind: "FINDING",
        factKey: null,
        corpusHash: "a".repeat(64),
      }),
    ).toBeNull();
  });
});
