import { cpus, arch, platform } from "node:os";

import { sha256CanonicalJson } from "@vera/contracts";
import type { JsonValue } from "@vera/contracts";

import { computeMetricsWithBootstrap } from "./metrics.js";
import {
  BENCHMARK_RUN_SCHEMA_VERSION,
  BenchmarkMetricReportSchema,
  BenchmarkPredictionSchema,
  BenchmarkProviderRunSchema,
} from "./schema.js";
import type {
  BenchmarkMetricReport,
  BenchmarkOutcome,
  BenchmarkPrediction,
  BenchmarkProviderRun,
  SyntheticBenchmarkCase,
  SyntheticBenchmarkCorpus,
} from "./schema.js";

export interface SimulatedProviderOptions {
  readonly model: string;
  readonly modelDigest: string;
  readonly runtimeVersion: string;
  readonly prompt: string;
  readonly options: Record<string, JsonValue>;
}

const DEFAULT_PROVIDER: SimulatedProviderOptions = {
  model: "synthetic-ollama-sim",
  modelDigest: "5".repeat(64),
  runtimeVersion: "simulated-0.1.0",
  prompt: "Extract synthetic facts and classify the synthetic compliance outcome.",
  options: { temperature: 0, seed: 42 },
};

function simulatedOutcome(item: SyntheticBenchmarkCase, index: number): BenchmarkOutcome {
  if (index % 9 === 0 && item.expectedOutcome === "FAIL") return "PASS";
  if (index % 7 === 0) return "REVIEW";
  return item.expectedOutcome;
}

function simulatedFacts(item: SyntheticBenchmarkCase, index: number): Record<string, JsonValue> {
  const facts: Record<string, JsonValue> = { ...item.expectedFacts };
  if (index % 5 === 0) {
    Reflect.deleteProperty(facts, "synthetic.marker");
  }
  if (index % 6 === 0) {
    facts["synthetic.extra"] = "hallucinated-demo-value";
  }
  return facts;
}

function predictionFor(item: SyntheticBenchmarkCase, index: number): BenchmarkPrediction {
  return BenchmarkPredictionSchema.parse({
    caseId: item.caseId,
    predictedFacts: simulatedFacts(item, index),
    predictedOutcome: simulatedOutcome(item, index),
    rawOutput: JSON.stringify({ caseId: item.caseId, simulated: true }),
    latencyMs: 12 + index,
    validationScope: "TECHNICAL_DEMO",
  });
}

function hardware(): BenchmarkProviderRun["hardware"] {
  return {
    platform: platform(),
    arch: arch(),
    cpuCount: Math.max(1, cpus().length),
  };
}

export function runSimulatedProvider(
  corpus: SyntheticBenchmarkCorpus,
  options: SimulatedProviderOptions = DEFAULT_PROVIDER,
): BenchmarkProviderRun {
  const predictions = corpus.cases.map((item, index) => predictionFor(item, index + 1));
  const rawOutputs = predictions.map(({ rawOutput }) => rawOutput);
  return BenchmarkProviderRunSchema.parse({
    providerKind: "SIMULATED_OLLAMA",
    model: options.model,
    modelDigest: options.modelDigest,
    runtimeVersion: options.runtimeVersion,
    promptHash: sha256CanonicalJson(options.prompt),
    optionsHash: sha256CanonicalJson(options.options),
    hardware: hardware(),
    corpusHash: corpus.corpusHash,
    predictions,
    rawOutputHash: sha256CanonicalJson(rawOutputs),
    validationScope: "TECHNICAL_DEMO",
  });
}

export function runSyntheticBenchmark(
  corpus: SyntheticBenchmarkCorpus,
  bootstrapIterations = 200,
  providers: readonly SimulatedProviderOptions[] = [DEFAULT_PROVIDER],
): BenchmarkMetricReport {
  if (providers.length === 0) {
    throw new RangeError("Benchmark provider matrix must contain at least one provider");
  }
  const providerRuns = providers.map((provider) => runSimulatedProvider(corpus, provider));
  const primaryRun = providerRuns[0];
  if (primaryRun === undefined) {
    throw new RangeError("Benchmark provider matrix must contain a primary provider");
  }
  const metrics = computeMetricsWithBootstrap(
    corpus.cases,
    primaryRun.predictions,
    bootstrapIterations,
  );
  const hashInput = {
    schemaVersion: BENCHMARK_RUN_SCHEMA_VERSION,
    corpusHash: corpus.corpusHash,
    seed: 42,
    bootstrapIterations,
    extraction: metrics.extraction,
    findings: metrics.findings,
    providerRuns,
    disclaimer:
      "Synthetic technical benchmark only; not real-world accuracy, certification or professional validation.",
    validationScope: "TECHNICAL_DEMO",
  };
  return BenchmarkMetricReportSchema.parse({
    ...hashInput,
    reportHash: sha256CanonicalJson(hashInput),
  });
}
