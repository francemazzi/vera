import { describe, expect, it } from "vitest";

import {
  applyCalibration,
  buildReliabilityDiagram,
  buildRiskCoverageCurve,
  CalibrationProfileSchema,
  fitCalibrationProfile,
  selectCalibrationProfile,
} from "../../src/index.js";
import type { CalibrationObservation, CalibrationProfile } from "../../src/index.js";

const MODEL_DIGEST = "7".repeat(64);
const CORPUS_HASH = "8".repeat(64);

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function observation(
  index: number,
  score: number,
  correct: boolean,
  split: CalibrationObservation["split"] = "calibration",
): CalibrationObservation {
  return {
    caseId: `case-${String(index).padStart(4, "0")}`,
    split,
    score,
    correct,
    proposedOutcome: correct ? "PASS" : "FAIL",
    riskLevel: "LOW",
    validationScope: "TECHNICAL_DEMO",
  };
}

function profile(
  overrides: Partial<Parameters<typeof fitCalibrationProfile>[0]> = {},
): CalibrationProfile {
  return fitCalibrationProfile({
    id: uuid(1),
    version: "1.0.0",
    modelName: "synthetic-calibration-model",
    modelDigest: MODEL_DIGEST,
    targetKind: "FACT",
    factKey: "synthetic.marker",
    corpusHash: CORPUS_HASH,
    observations: [
      observation(1, 0.95, true),
      observation(2, 0.9, true),
      observation(3, 0.8, true),
      observation(4, 0.4, false),
    ],
    binCount: 5,
    minSamples: 2,
    maxAcceptedRisk: 0.1,
    ...overrides,
  });
}

describe("calibration profile fitting", () => {
  it("builds reliability bins and risk coverage from calibration observations only", () => {
    const observations = [
      observation(1, 0.9, true),
      observation(2, 0.8, false),
      observation(3, 0.2, true, "development"),
    ];

    const bins = buildReliabilityDiagram(observations, 5);
    const curve = buildRiskCoverageCurve(observations);

    expect(bins).toHaveLength(5);
    expect(bins.reduce((total, bin) => total + bin.sampleCount, 0)).toBe(3);
    expect(curve[0]).toMatchObject({ threshold: 0.9, coverage: 1 / 3, risk: 0 });
  });

  it("fits hash-pinned profiles and withholds thresholds below the minimum sample count", () => {
    const fitted = profile();
    const insufficient = profile({ id: uuid(2), minSamples: 10 });

    expect(fitted.threshold).toBe(0.8);
    expect(fitted.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(insufficient.threshold).toBeNull();
  });

  it("rejects malformed profile versions", () => {
    const fitted = profile();

    expect(() =>
      CalibrationProfileSchema.parse({
        ...fitted,
        version: "1",
      }),
    ).toThrow();
  });
});

describe("calibration application", () => {
  it("uses exact profiles before hierarchical fallback", () => {
    const exact = profile({ id: uuid(3), factKey: "synthetic.marker" });
    const fallback = profile({ id: uuid(4), factKey: null });

    expect(
      selectCalibrationProfile([fallback, exact], {
        modelDigest: MODEL_DIGEST,
        targetKind: "FACT",
        factKey: "synthetic.marker",
        corpusHash: CORPUS_HASH,
      })?.id,
    ).toBe(exact.id);
    expect(
      selectCalibrationProfile([fallback], {
        modelDigest: MODEL_DIGEST,
        targetKind: "FACT",
        factKey: "synthetic.other",
        corpusHash: CORPUS_HASH,
      })?.id,
    ).toBe(fallback.id);
  });

  it("abstains without sufficient calibration and blocks high-risk demo PASS", () => {
    const fitted = profile();
    const insufficient = profile({ id: uuid(5), minSamples: 10 });

    expect(
      applyCalibration(null, { score: 0.9, proposedOutcome: "PASS", riskLevel: "LOW" }),
    ).toMatchObject({
      decision: "REVIEW",
      reason: "NO_PROFILE",
    });
    expect(
      applyCalibration(insufficient, { score: 0.9, proposedOutcome: "PASS", riskLevel: "LOW" }),
    ).toMatchObject({
      decision: "REVIEW",
      reason: "INSUFFICIENT_SAMPLES",
    });
    expect(
      applyCalibration(fitted, { score: 0.7, proposedOutcome: "PASS", riskLevel: "LOW" }),
    ).toMatchObject({
      decision: "REVIEW",
      reason: "BELOW_THRESHOLD",
    });
    expect(
      applyCalibration(fitted, { score: 0.9, proposedOutcome: "PASS", riskLevel: "HIGH" }),
    ).toMatchObject({
      decision: "REVIEW",
      reason: "HIGH_RISK_PASS_BLOCKED",
    });
    expect(
      applyCalibration(fitted, { score: 0.9, proposedOutcome: "FAIL", riskLevel: "HIGH" }),
    ).toMatchObject({
      decision: "ALLOW",
      reason: "PROFILE_ACCEPTED",
    });
  });
});
