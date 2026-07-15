import { z } from "zod";

import { JsonValueSchema, sha256CanonicalJson } from "@vera/contracts";

export const SYNTHETIC_BENCHMARK_SCHEMA_VERSION = "vera.synthetic-benchmark/v1" as const;
export const BENCHMARK_RUN_SCHEMA_VERSION = "vera.benchmark-run/v1" as const;

const Sha256DigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Expected a lowercase SHA-256 digest");
const CaseIdSchema = z
  .string()
  .regex(/^case-[0-9]{4}$/u, "Expected a deterministic synthetic case ID");
const StableKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z][A-Za-z0-9._-]*$/u, "Expected a stable key");
const BoundedTextSchema = z.string().min(1).max(100_000);

export const BenchmarkSplitSchema = z.enum(["development", "calibration", "blind"]);
export const BenchmarkOutcomeSchema = z.enum(["PASS", "FAIL", "REVIEW", "NOT_APPLICABLE"]);
export const BenchmarkDocumentKindSchema = z.enum(["PDF", "IMAGE", "JSON"]);
export const BenchmarkProviderKindSchema = z.enum(["SIMULATED_OLLAMA", "OLLAMA"]);

export type BenchmarkSplit = z.infer<typeof BenchmarkSplitSchema>;
export type BenchmarkOutcome = z.infer<typeof BenchmarkOutcomeSchema>;
export type BenchmarkDocumentKind = z.infer<typeof BenchmarkDocumentKindSchema>;
export type BenchmarkProviderKind = z.infer<typeof BenchmarkProviderKindSchema>;

export const SyntheticDocumentSchema = z
  .object({
    id: z.uuid(),
    caseId: CaseIdSchema,
    kind: BenchmarkDocumentKindSchema,
    mediaType: z.enum(["application/pdf", "image/svg+xml", "application/json"]),
    byteLength: z.int().positive(),
    sha256: Sha256DigestSchema,
    validationScope: z.literal("TECHNICAL_DEMO"),
  })
  .strict();

export type SyntheticDocument = z.infer<typeof SyntheticDocumentSchema>;

export const SyntheticBenchmarkCaseSchema = z
  .object({
    caseId: CaseIdSchema,
    split: BenchmarkSplitSchema,
    expectedOutcome: BenchmarkOutcomeSchema,
    expectedFacts: z.record(StableKeySchema, JsonValueSchema),
    documents: z.array(SyntheticDocumentSchema).length(3),
    validationScope: z.literal("TECHNICAL_DEMO"),
  })
  .strict()
  .superRefine(({ documents }, context) => {
    const kinds = documents.map(({ kind }) => kind).sort();
    if (kinds.join(",") !== "IMAGE,JSON,PDF") {
      context.addIssue({
        code: "custom",
        message: "Each synthetic case must include one PDF, one image and one JSON document",
        path: ["documents"],
      });
    }
  });

export type SyntheticBenchmarkCase = z.infer<typeof SyntheticBenchmarkCaseSchema>;

export const SyntheticBenchmarkCorpusSchema = z
  .object({
    schemaVersion: z.literal(SYNTHETIC_BENCHMARK_SCHEMA_VERSION),
    seed: z.literal(42),
    cases: z.array(SyntheticBenchmarkCaseSchema).min(20).max(10_000),
    corpusHash: Sha256DigestSchema,
    validationScope: z.literal("TECHNICAL_DEMO"),
  })
  .strict()
  .superRefine(({ cases }, context) => {
    const caseIds = cases.map(({ caseId }) => caseId);
    const sorted = [...caseIds].sort();
    if (caseIds.some((caseId, index) => caseId !== sorted[index])) {
      context.addIssue({
        code: "custom",
        message: "Synthetic cases must be sorted by caseId",
        path: ["cases"],
      });
    }
    if (new Set(caseIds).size !== caseIds.length) {
      context.addIssue({ code: "custom", message: "Synthetic case IDs must be unique" });
    }
  })
  .superRefine(({ corpusHash, ...hashInput }, context) => {
    if (corpusHash !== sha256CanonicalJson(hashInput)) {
      context.addIssue({
        code: "custom",
        message: "corpusHash does not match the canonical synthetic benchmark corpus",
        path: ["corpusHash"],
      });
    }
  });

export type SyntheticBenchmarkCorpus = z.infer<typeof SyntheticBenchmarkCorpusSchema>;

export const BenchmarkPredictionSchema = z
  .object({
    caseId: CaseIdSchema,
    predictedFacts: z.record(StableKeySchema, JsonValueSchema),
    predictedOutcome: BenchmarkOutcomeSchema,
    rawOutput: BoundedTextSchema,
    latencyMs: z.number().nonnegative(),
    validationScope: z.literal("TECHNICAL_DEMO"),
  })
  .strict();

export type BenchmarkPrediction = z.infer<typeof BenchmarkPredictionSchema>;

export const BenchmarkProviderRunSchema = z
  .object({
    providerKind: BenchmarkProviderKindSchema,
    model: z.string().min(1).max(200),
    modelDigest: Sha256DigestSchema,
    runtimeVersion: z.string().min(1).max(100),
    promptHash: Sha256DigestSchema,
    optionsHash: Sha256DigestSchema,
    hardware: z
      .object({
        platform: z.string().min(1).max(100),
        arch: z.string().min(1).max(100),
        cpuCount: z.int().positive(),
      })
      .strict(),
    corpusHash: Sha256DigestSchema,
    predictions: z.array(BenchmarkPredictionSchema).min(1).max(10_000),
    rawOutputHash: Sha256DigestSchema,
    validationScope: z.literal("TECHNICAL_DEMO"),
  })
  .strict();

export type BenchmarkProviderRun = z.infer<typeof BenchmarkProviderRunSchema>;

export const MetricWithCiSchema = z
  .object({
    value: z.number().min(0).max(1),
    ciLow: z.number().min(0).max(1),
    ciHigh: z.number().min(0).max(1),
  })
  .strict()
  .superRefine(({ value, ciLow, ciHigh }, context) => {
    if (ciLow > value || value > ciHigh) {
      context.addIssue({
        code: "custom",
        message: "Metric confidence interval must contain the point estimate",
      });
    }
  });

export type MetricWithCi = z.infer<typeof MetricWithCiSchema>;

export const BenchmarkMetricReportSchema = z
  .object({
    schemaVersion: z.literal(BENCHMARK_RUN_SCHEMA_VERSION),
    corpusHash: Sha256DigestSchema,
    seed: z.literal(42),
    bootstrapIterations: z.int().min(10).max(10_000),
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
    providerRuns: z.array(BenchmarkProviderRunSchema).min(1).max(20),
    reportHash: Sha256DigestSchema,
    disclaimer: z.literal(
      "Synthetic technical benchmark only; not real-world accuracy, certification or professional validation.",
    ),
    validationScope: z.literal("TECHNICAL_DEMO"),
  })
  .strict()
  .superRefine(({ reportHash, ...hashInput }, context) => {
    if (reportHash !== sha256CanonicalJson(hashInput)) {
      context.addIssue({
        code: "custom",
        message: "reportHash does not match the canonical benchmark metric report",
        path: ["reportHash"],
      });
    }
  });

export type BenchmarkMetricReport = z.infer<typeof BenchmarkMetricReportSchema>;
