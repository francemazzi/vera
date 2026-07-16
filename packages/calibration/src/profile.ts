import { sha256CanonicalJson } from "@vera/contracts";

import {
  CALIBRATION_SCHEMA_VERSION,
  CalibrationApplicationSchema,
  CalibrationObservationSchema,
  CalibrationProfileSchema,
} from "./schema.js";
import type {
  CalibrationApplication,
  CalibrationObservation,
  CalibrationOutcome,
  CalibrationProfile,
  CalibrationRiskLevel,
  CalibrationTargetKind,
  ReliabilityBin,
  RiskCoveragePoint,
} from "./schema.js";

export interface FitCalibrationProfileInput {
  readonly id: string;
  readonly version: string;
  readonly modelName: string;
  readonly modelDigest: string;
  readonly targetKind: CalibrationTargetKind;
  readonly factKey: string | null;
  readonly corpusHash: string;
  readonly observations: readonly CalibrationObservation[];
  readonly binCount: number;
  readonly minSamples: number;
  readonly maxAcceptedRisk: number;
}

export interface CalibrationCandidate {
  readonly score: number;
  readonly proposedOutcome: CalibrationOutcome;
  readonly riskLevel: CalibrationRiskLevel;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function calibrationSamples(
  observations: readonly CalibrationObservation[],
): readonly CalibrationObservation[] {
  return observations.filter(({ split }) => split === "calibration");
}

export function buildReliabilityDiagram(
  observations: readonly CalibrationObservation[],
  binCount: number,
): readonly ReliabilityBin[] {
  return Array.from({ length: binCount }, (_, index) => {
    const lowerInclusive = index / binCount;
    const upperExclusive = (index + 1) / binCount;
    const items = observations.filter(({ score }) =>
      index === binCount - 1
        ? score >= lowerInclusive && score <= upperExclusive
        : score >= lowerInclusive && score < upperExclusive,
    );
    return {
      index,
      lowerInclusive,
      upperExclusive,
      sampleCount: items.length,
      meanConfidence: ratio(
        items.reduce((total, { score }) => total + score, 0),
        items.length,
      ),
      empiricalAccuracy: ratio(items.filter(({ correct }) => correct).length, items.length),
    };
  });
}

export function buildRiskCoverageCurve(
  observations: readonly CalibrationObservation[],
): readonly RiskCoveragePoint[] {
  const thresholds = [...new Set(observations.map(({ score }) => score))].sort(
    (left, right) => right - left,
  );
  if (thresholds.length === 0) return [{ threshold: 1, coverage: 0, risk: 1, sampleCount: 0 }];
  return thresholds.map((threshold) => {
    const accepted = observations.filter(({ score }) => score >= threshold);
    return {
      threshold,
      coverage: ratio(accepted.length, observations.length),
      risk: ratio(accepted.filter(({ correct }) => !correct).length, accepted.length),
      sampleCount: accepted.length,
    };
  });
}

function chooseThreshold(
  curve: readonly RiskCoveragePoint[],
  minSamples: number,
  maxAcceptedRisk: number,
): number | null {
  const acceptable = curve
    .filter(({ sampleCount, risk }) => sampleCount >= minSamples && risk <= maxAcceptedRisk)
    .sort((left, right) => right.coverage - left.coverage || left.threshold - right.threshold);
  return acceptable[0]?.threshold ?? null;
}

export function fitCalibrationProfile(input: FitCalibrationProfileInput): CalibrationProfile {
  const parsedObservations = input.observations.map((observation) =>
    CalibrationObservationSchema.parse(observation),
  );
  const samples = calibrationSamples(parsedObservations);
  const reliability = buildReliabilityDiagram(samples, input.binCount);
  const riskCoverage = buildRiskCoverageCurve(samples);
  const threshold =
    samples.length < input.minSamples
      ? null
      : chooseThreshold(riskCoverage, input.minSamples, input.maxAcceptedRisk);
  const hashInput = {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    id: input.id,
    version: input.version,
    modelName: input.modelName,
    modelDigest: input.modelDigest,
    targetKind: input.targetKind,
    factKey: input.factKey,
    corpusHash: input.corpusHash,
    sourceDataHash: sha256CanonicalJson(parsedObservations),
    algorithm: {
      name: "histogram-risk-coverage" as const,
      version: "1.0.0" as const,
      parametersHash: sha256CanonicalJson({
        binCount: input.binCount,
        minSamples: input.minSamples,
        maxAcceptedRisk: input.maxAcceptedRisk,
      }),
    },
    binCount: input.binCount,
    minSamples: input.minSamples,
    sampleCount: samples.length,
    threshold,
    maxAcceptedRisk: input.maxAcceptedRisk,
    reliability,
    riskCoverage,
    validationScope: "TECHNICAL_DEMO" as const,
  };
  return CalibrationProfileSchema.parse({
    ...hashInput,
    contentHash: sha256CanonicalJson(hashInput),
  });
}

export function selectCalibrationProfile(
  profiles: readonly CalibrationProfile[],
  request: {
    readonly modelDigest: string;
    readonly targetKind: CalibrationTargetKind;
    readonly factKey: string | null;
    readonly corpusHash: string;
  },
): CalibrationProfile | null {
  const compatible = profiles
    .map((profile) => CalibrationProfileSchema.parse(profile))
    .filter(
      (profile) =>
        profile.modelDigest === request.modelDigest &&
        profile.targetKind === request.targetKind &&
        profile.corpusHash === request.corpusHash,
    );
  const exact = compatible.find(({ factKey }) => factKey === request.factKey);
  if (exact !== undefined && exact.sampleCount >= exact.minSamples && exact.threshold !== null) {
    return exact;
  }
  const fallback = compatible.find(({ factKey }) => factKey === null);
  if (
    fallback !== undefined &&
    fallback.sampleCount >= fallback.minSamples &&
    fallback.threshold !== null
  ) {
    return fallback;
  }
  return null;
}

export function applyCalibration(
  profile: CalibrationProfile | null,
  candidate: CalibrationCandidate,
): CalibrationApplication {
  if (profile === null) {
    return CalibrationApplicationSchema.parse({
      profileId: null,
      decision: "REVIEW",
      reason: "NO_PROFILE",
      threshold: null,
      score: candidate.score,
      validationScope: "TECHNICAL_DEMO",
    });
  }
  const parsed = CalibrationProfileSchema.parse(profile);
  if (parsed.sampleCount < parsed.minSamples || parsed.threshold === null) {
    return CalibrationApplicationSchema.parse({
      profileId: parsed.id,
      decision: "REVIEW",
      reason: "INSUFFICIENT_SAMPLES",
      threshold: parsed.threshold,
      score: candidate.score,
      validationScope: "TECHNICAL_DEMO",
    });
  }
  if (
    candidate.proposedOutcome === "PASS" &&
    (candidate.riskLevel === "HIGH" || candidate.riskLevel === "CRITICAL")
  ) {
    return CalibrationApplicationSchema.parse({
      profileId: parsed.id,
      decision: "REVIEW",
      reason: "HIGH_RISK_PASS_BLOCKED",
      threshold: parsed.threshold,
      score: candidate.score,
      validationScope: "TECHNICAL_DEMO",
    });
  }
  if (candidate.score < parsed.threshold) {
    return CalibrationApplicationSchema.parse({
      profileId: parsed.id,
      decision: "REVIEW",
      reason: "BELOW_THRESHOLD",
      threshold: parsed.threshold,
      score: candidate.score,
      validationScope: "TECHNICAL_DEMO",
    });
  }
  return CalibrationApplicationSchema.parse({
    profileId: parsed.id,
    decision: "ALLOW",
    reason: "PROFILE_ACCEPTED",
    threshold: parsed.threshold,
    score: candidate.score,
    validationScope: "TECHNICAL_DEMO",
  });
}
