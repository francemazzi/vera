import { z } from "zod";

import { MetricWithCiSchema } from "@vera/benchmark";
import { sha256CanonicalJson } from "@vera/contracts";

export const DEMO_MVP_SCHEMA_VERSION = "vera.demo-mvp/v1" as const;

const Sha256DigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Expected a lowercase SHA-256 digest");
const CaseIdSchema = z.string().regex(/^case-[0-9]{4}$/u);

export const DemoOutcomeCountsSchema = z
  .object({
    PASS: z.int().min(0),
    FAIL: z.int().min(0),
    REVIEW: z.int().min(0),
    NOT_APPLICABLE: z.int().min(0),
  })
  .strict();

export const DemoTuningCycleSchema = z
  .object({
    cycle: z.int().min(1).max(2),
    splitUsed: z.literal("development"),
    caseIds: z.array(CaseIdSchema).min(1),
    purpose: z.string().min(1).max(500),
    decision: z.string().min(1).max(500),
    changeHash: Sha256DigestSchema,
  })
  .strict();

export const DemoMvpReportHashInputSchema = z
  .object({
    schemaVersion: z.literal(DEMO_MVP_SCHEMA_VERSION),
    generatedAt: z.iso.datetime(),
    validationScope: z.literal("TECHNICAL_DEMO"),
    corpus: z
      .object({
        seed: z.literal(42),
        corpusHash: Sha256DigestSchema,
        caseCount: z.int().min(1),
        splitCounts: z
          .object({
            development: z.int().min(0),
            calibration: z.int().min(0),
            blind: z.int().min(0),
          })
          .strict(),
        blindCaseIds: z.array(CaseIdSchema),
      })
      .strict(),
    source: z
      .object({
        sourceId: z.uuid(),
        sourceVersionId: z.uuid(),
        contentHash: Sha256DigestSchema,
        approvalState: z.literal("APPROVED"),
      })
      .strict(),
    rulePack: z
      .object({
        versionId: z.uuid(),
        semver: z.string().min(5),
        contentHash: Sha256DigestSchema,
        ruleCount: z.int().min(1),
        testRunHash: Sha256DigestSchema,
        testGatePassed: z.boolean(),
      })
      .strict(),
    ingestion: z
      .object({
        caseCount: z.int().min(1),
        documentCount: z.int().min(1),
        pdfCount: z.int().min(0),
        imageCount: z.int().min(0),
        jsonCount: z.int().min(0),
      })
      .strict(),
    extraction: z
      .object({
        adapterId: z.string().min(1),
        runCount: z.int().min(1),
        factCount: z.int().min(1),
        evidenceCount: z.int().min(1),
        rawOutputHash: Sha256DigestSchema,
      })
      .strict(),
    evaluation: z
      .object({
        evaluatedCases: z.int().min(1),
        matchedExpectedCases: z.int().min(0),
        outcomeCounts: DemoOutcomeCountsSchema,
        reviewRate: z.number().min(0).max(1),
        snapshotHash: Sha256DigestSchema,
      })
      .strict(),
    review: z
      .object({
        requiredDecisions: z.int().min(1),
        completedDecisions: z.int().min(0),
        overrideCount: z.int().min(0),
        decisionChainHash: Sha256DigestSchema,
      })
      .strict(),
    audit: z
      .object({
        exportedRuns: z.int().min(1),
        exportHash: Sha256DigestSchema,
        replayHash: Sha256DigestSchema,
      })
      .strict(),
    benchmark: z
      .object({
        reportHash: Sha256DigestSchema,
        model: z.string().min(1),
        modelDigest: Sha256DigestSchema,
        runtimeVersion: z.string().min(1),
        extraction: z
          .object({
            precision: MetricWithCiSchema,
            recall: MetricWithCiSchema,
            f1: MetricWithCiSchema,
            missingRate: MetricWithCiSchema,
            hallucinationRate: MetricWithCiSchema,
          })
          .strict(),
        findings: z
          .object({
            sensitivity: MetricWithCiSchema,
            specificity: MetricWithCiSchema,
            macroF1: MetricWithCiSchema,
            falseNegativeRate: MetricWithCiSchema,
          })
          .strict(),
        latencyMs: z
          .object({
            min: z.number().nonnegative(),
            mean: z.number().nonnegative(),
            p95: z.number().nonnegative(),
            max: z.number().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    calibration: z
      .object({
        profileId: z.uuid(),
        profileHash: Sha256DigestSchema,
        sampleCount: z.int().min(0),
        threshold: z.number().min(0).max(1).nullable(),
        demoApplicationDecision: z.enum(["ALLOW", "REVIEW"]),
        demoApplicationReason: z.string().min(1),
      })
      .strict(),
    tuning: z
      .object({
        maxCyclesAllowed: z.literal(2),
        cycles: z.array(DemoTuningCycleSchema).max(2),
        blindSetImmutable: z.literal(true),
      })
      .strict(),
    modelCards: z
      .array(
        z
          .object({
            model: z.string().min(1),
            digest: Sha256DigestSchema,
            runtimeVersion: z.string().min(1),
            intendedUse: z.string().min(1).max(500),
            limitations: z.array(z.string().min(1).max(500)).min(1),
            validationScope: z.literal("TECHNICAL_DEMO"),
          })
          .strict(),
      )
      .min(1),
    limitations: z.array(z.string().min(1).max(500)).min(1),
    disclaimer: z.literal(
      "Synthetic technical demonstration only; not real-world accuracy, certification or professional validation.",
    ),
  })
  .strict()
  .superRefine((report, context) => {
    const splitTotal =
      report.corpus.splitCounts.development +
      report.corpus.splitCounts.calibration +
      report.corpus.splitCounts.blind;
    if (splitTotal !== report.corpus.caseCount) {
      context.addIssue({
        code: "custom",
        message: "Split counts must add up to the corpus case count",
        path: ["corpus", "splitCounts"],
      });
    }
    if (report.ingestion.caseCount !== report.corpus.caseCount) {
      context.addIssue({
        code: "custom",
        message: "Ingestion must cover every corpus case",
        path: ["ingestion", "caseCount"],
      });
    }
    if (report.evaluation.evaluatedCases !== report.corpus.caseCount) {
      context.addIssue({
        code: "custom",
        message: "Evaluation must cover every corpus case",
        path: ["evaluation", "evaluatedCases"],
      });
    }
    if (report.audit.exportedRuns !== report.review.completedDecisions) {
      context.addIssue({
        code: "custom",
        message: "Every completed review must have an audit export",
        path: ["audit", "exportedRuns"],
      });
    }
    const tuningIds = new Set(report.tuning.cycles.flatMap(({ caseIds }) => caseIds));
    if (report.corpus.blindCaseIds.some((caseId) => tuningIds.has(caseId))) {
      context.addIssue({
        code: "custom",
        message: "Tuning cycles cannot include blind case IDs",
        path: ["tuning", "cycles"],
      });
    }
  });

export const DemoMvpReportSchema = DemoMvpReportHashInputSchema.extend({
  contentHash: Sha256DigestSchema,
})
  .strict()
  .superRefine((report, context) => {
    const { contentHash, ...hashInput } = report;
    if (contentHash !== sha256CanonicalJson(hashInput)) {
      context.addIssue({
        code: "custom",
        message: "contentHash does not match the canonical demo MVP report",
        path: ["contentHash"],
      });
    }
  });

export type DemoOutcomeCounts = z.infer<typeof DemoOutcomeCountsSchema>;
export type DemoTuningCycle = z.infer<typeof DemoTuningCycleSchema>;
export type DemoMvpReportHashInput = z.infer<typeof DemoMvpReportHashInputSchema>;
export type DemoMvpReport = z.infer<typeof DemoMvpReportSchema>;
