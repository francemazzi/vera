import { canonicalizeJson } from "@vera/contracts";
import type { JsonValue } from "@vera/contracts";

import type {
  BenchmarkMetricReport,
  BenchmarkOutcome,
  BenchmarkPrediction,
  MetricWithCi,
  SyntheticBenchmarkCase,
} from "./schema.js";

const OUTCOMES: readonly BenchmarkOutcome[] = ["PASS", "FAIL", "REVIEW", "NOT_APPLICABLE"];

interface ExtractionCounts {
  readonly tp: number;
  readonly fp: number;
  readonly fn: number;
  readonly missing: number;
  readonly hallucinated: number;
  readonly expected: number;
  readonly predicted: number;
}

interface FindingCounts {
  readonly failTp: number;
  readonly failFn: number;
  readonly nonFailTn: number;
  readonly nonFailFp: number;
  readonly labels: readonly {
    readonly expected: BenchmarkOutcome;
    readonly predicted: BenchmarkOutcome;
  }[];
}

export interface PointMetrics {
  readonly extraction: Record<keyof BenchmarkMetricReport["extraction"], number>;
  readonly findings: Record<keyof BenchmarkMetricReport["findings"], number>;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function f1(precision: number, recall: number): number {
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function equalJson(left: JsonValue, right: JsonValue): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function extractionCounts(
  cases: readonly SyntheticBenchmarkCase[],
  predictions: ReadonlyMap<string, BenchmarkPrediction>,
): ExtractionCounts {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let missing = 0;
  let hallucinated = 0;
  let expected = 0;
  let predicted = 0;
  for (const item of cases) {
    const prediction = predictions.get(item.caseId);
    const predictedFacts = prediction?.predictedFacts ?? {};
    expected += Object.keys(item.expectedFacts).length;
    predicted += Object.keys(predictedFacts).length;
    for (const [key, value] of Object.entries(item.expectedFacts)) {
      if (!(key in predictedFacts)) {
        fn += 1;
        missing += 1;
        continue;
      }
      if (equalJson(predictedFacts[key] as JsonValue, value)) {
        tp += 1;
      } else {
        fp += 1;
        fn += 1;
      }
    }
    for (const key of Object.keys(predictedFacts)) {
      if (!(key in item.expectedFacts)) {
        fp += 1;
        hallucinated += 1;
      }
    }
  }
  return { tp, fp, fn, missing, hallucinated, expected, predicted };
}

function findingCounts(
  cases: readonly SyntheticBenchmarkCase[],
  predictions: ReadonlyMap<string, BenchmarkPrediction>,
): FindingCounts {
  let failTp = 0;
  let failFn = 0;
  let nonFailTn = 0;
  let nonFailFp = 0;
  const labels = cases.map((item) => {
    const predicted = predictions.get(item.caseId)?.predictedOutcome ?? "REVIEW";
    const expected = item.expectedOutcome;
    if (expected === "FAIL" && predicted === "FAIL") failTp += 1;
    else if (expected === "FAIL") failFn += 1;
    else if (predicted === "FAIL") nonFailFp += 1;
    else nonFailTn += 1;
    return { expected, predicted };
  });
  return { failTp, failFn, nonFailTn, nonFailFp, labels };
}

function macroF1(labels: FindingCounts["labels"]): number {
  const scores = OUTCOMES.map((outcome) => {
    const tp = labels.filter(
      ({ expected, predicted }) => expected === outcome && predicted === outcome,
    ).length;
    const fp = labels.filter(
      ({ expected, predicted }) => expected !== outcome && predicted === outcome,
    ).length;
    const fn = labels.filter(
      ({ expected, predicted }) => expected === outcome && predicted !== outcome,
    ).length;
    return f1(ratio(tp, tp + fp), ratio(tp, tp + fn));
  });
  return scores.reduce((total, value) => total + value, 0) / scores.length;
}

export function computePointMetrics(
  cases: readonly SyntheticBenchmarkCase[],
  predictionsInput: readonly BenchmarkPrediction[],
): PointMetrics {
  const predictions = new Map(
    predictionsInput.map((prediction) => [prediction.caseId, prediction]),
  );
  const extraction = extractionCounts(cases, predictions);
  const precision = ratio(extraction.tp, extraction.tp + extraction.fp);
  const recall = ratio(extraction.tp, extraction.tp + extraction.fn);
  const findings = findingCounts(cases, predictions);
  return {
    extraction: {
      precision,
      recall,
      f1: f1(precision, recall),
      missingRate: ratio(extraction.missing, extraction.expected),
      hallucinationRate: ratio(extraction.hallucinated, extraction.predicted),
    },
    findings: {
      sensitivity: ratio(findings.failTp, findings.failTp + findings.failFn),
      specificity: ratio(findings.nonFailTn, findings.nonFailTn + findings.nonFailFp),
      macroF1: macroF1(findings.labels),
      falseNegativeRate: ratio(findings.failFn, findings.failTp + findings.failFn),
    },
  };
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

function sampleCases(
  cases: readonly SyntheticBenchmarkCase[],
  iteration: number,
): readonly SyntheticBenchmarkCase[] {
  let state = (42 + iteration * 2_654_435_761) >>> 0;
  return cases.map(() => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return cases[state % cases.length] as SyntheticBenchmarkCase;
  });
}

function withCi(value: number, samples: readonly number[]): MetricWithCi {
  return {
    value,
    ciLow: Math.min(value, percentile(samples, 0.025)),
    ciHigh: Math.max(value, percentile(samples, 0.975)),
  };
}

export function computeMetricsWithBootstrap(
  cases: readonly SyntheticBenchmarkCase[],
  predictions: readonly BenchmarkPrediction[],
  iterations: number,
): Omit<
  BenchmarkMetricReport,
  | "schemaVersion"
  | "corpusHash"
  | "seed"
  | "bootstrapIterations"
  | "providerRuns"
  | "reportHash"
  | "disclaimer"
  | "validationScope"
> {
  const point = computePointMetrics(cases, predictions);
  const samples = Array.from({ length: iterations }, (_, index) => {
    const sampled = sampleCases(cases, index);
    return computePointMetrics(sampled, predictions);
  });
  return {
    extraction: {
      precision: withCi(
        point.extraction.precision,
        samples.map(({ extraction }) => extraction.precision),
      ),
      recall: withCi(
        point.extraction.recall,
        samples.map(({ extraction }) => extraction.recall),
      ),
      f1: withCi(
        point.extraction.f1,
        samples.map(({ extraction }) => extraction.f1),
      ),
      missingRate: withCi(
        point.extraction.missingRate,
        samples.map(({ extraction }) => extraction.missingRate),
      ),
      hallucinationRate: withCi(
        point.extraction.hallucinationRate,
        samples.map(({ extraction }) => extraction.hallucinationRate),
      ),
    },
    findings: {
      sensitivity: withCi(
        point.findings.sensitivity,
        samples.map(({ findings }) => findings.sensitivity),
      ),
      specificity: withCi(
        point.findings.specificity,
        samples.map(({ findings }) => findings.specificity),
      ),
      macroF1: withCi(
        point.findings.macroF1,
        samples.map(({ findings }) => findings.macroF1),
      ),
      falseNegativeRate: withCi(
        point.findings.falseNegativeRate,
        samples.map(({ findings }) => findings.falseNegativeRate),
      ),
    },
  };
}
