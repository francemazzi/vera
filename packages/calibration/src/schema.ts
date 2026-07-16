import { z } from "zod";

import { sha256CanonicalJson } from "@vera/contracts";

export const CALIBRATION_SCHEMA_VERSION = "vera.calibration-profile/v1" as const;

const Sha256DigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Expected a lowercase SHA-256 digest");
const StableKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z][A-Za-z0-9._-]*$/u, "Expected a stable key");

export const CalibrationTargetKindSchema = z.enum(["FACT", "FINDING"]);
export const CalibrationDecisionSchema = z.enum(["ALLOW", "REVIEW"]);
export const CalibrationRiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const CalibrationOutcomeSchema = z.enum(["PASS", "FAIL", "REVIEW", "NOT_APPLICABLE"]);

export type CalibrationTargetKind = z.infer<typeof CalibrationTargetKindSchema>;
export type CalibrationDecision = z.infer<typeof CalibrationDecisionSchema>;
export type CalibrationRiskLevel = z.infer<typeof CalibrationRiskLevelSchema>;
export type CalibrationOutcome = z.infer<typeof CalibrationOutcomeSchema>;

export const CalibrationObservationSchema = z
  .object({
    caseId: z.string().min(1).max(200),
    split: z.enum(["development", "calibration", "blind"]),
    score: z.number().min(0).max(1),
    correct: z.boolean(),
    proposedOutcome: CalibrationOutcomeSchema,
    riskLevel: CalibrationRiskLevelSchema,
    validationScope: z.literal("TECHNICAL_DEMO"),
  })
  .strict();

export type CalibrationObservation = z.infer<typeof CalibrationObservationSchema>;

export const ReliabilityBinSchema = z
  .object({
    index: z.int().min(0),
    lowerInclusive: z.number().min(0).max(1),
    upperExclusive: z.number().min(0).max(1),
    sampleCount: z.int().min(0),
    meanConfidence: z.number().min(0).max(1),
    empiricalAccuracy: z.number().min(0).max(1),
  })
  .strict();

export type ReliabilityBin = z.infer<typeof ReliabilityBinSchema>;

export const RiskCoveragePointSchema = z
  .object({
    threshold: z.number().min(0).max(1),
    coverage: z.number().min(0).max(1),
    risk: z.number().min(0).max(1),
    sampleCount: z.int().min(0),
  })
  .strict();

export type RiskCoveragePoint = z.infer<typeof RiskCoveragePointSchema>;

export const CalibrationProfileSchema = z
  .object({
    schemaVersion: z.literal(CALIBRATION_SCHEMA_VERSION),
    id: z.uuid(),
    version: z.string().regex(/^(?:0|[1-9][0-9]*)\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/u),
    modelName: z.string().min(1).max(200),
    modelDigest: Sha256DigestSchema,
    targetKind: CalibrationTargetKindSchema,
    factKey: StableKeySchema.nullable(),
    corpusHash: Sha256DigestSchema,
    sourceDataHash: Sha256DigestSchema,
    algorithm: z
      .object({
        name: z.literal("histogram-risk-coverage"),
        version: z.literal("1.0.0"),
        parametersHash: Sha256DigestSchema,
      })
      .strict(),
    binCount: z.int().min(2).max(50),
    minSamples: z.int().min(1).max(10_000),
    sampleCount: z.int().min(0).max(10_000),
    threshold: z.number().min(0).max(1).nullable(),
    maxAcceptedRisk: z.number().min(0).max(1),
    reliability: z.array(ReliabilityBinSchema).min(2).max(50),
    riskCoverage: z.array(RiskCoveragePointSchema).min(1).max(10_000),
    validationScope: z.literal("TECHNICAL_DEMO"),
    contentHash: Sha256DigestSchema,
  })
  .strict()
  .superRefine((profile, context) => {
    if (profile.targetKind === "FINDING" && profile.factKey !== null) {
      context.addIssue({
        code: "custom",
        message: "Finding calibration profiles cannot be scoped to one fact key",
        path: ["factKey"],
      });
    }
    if (profile.threshold !== null && profile.sampleCount < profile.minSamples) {
      context.addIssue({
        code: "custom",
        message: "Profiles below the minimum sample count cannot expose a threshold",
        path: ["threshold"],
      });
    }
    const { contentHash, ...hashInput } = profile;
    if (contentHash !== sha256CanonicalJson(hashInput)) {
      context.addIssue({
        code: "custom",
        message: "contentHash does not match the canonical calibration profile",
        path: ["contentHash"],
      });
    }
  });

export type CalibrationProfile = z.infer<typeof CalibrationProfileSchema>;

export const CalibrationApplicationSchema = z
  .object({
    profileId: z.uuid().nullable(),
    decision: CalibrationDecisionSchema,
    reason: z.enum([
      "PROFILE_ACCEPTED",
      "NO_PROFILE",
      "INSUFFICIENT_SAMPLES",
      "BELOW_THRESHOLD",
      "HIGH_RISK_PASS_BLOCKED",
    ]),
    threshold: z.number().min(0).max(1).nullable(),
    score: z.number().min(0).max(1),
    validationScope: z.literal("TECHNICAL_DEMO"),
  })
  .strict();

export type CalibrationApplication = z.infer<typeof CalibrationApplicationSchema>;
