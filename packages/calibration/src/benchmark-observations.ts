import type { BenchmarkProviderRun, SyntheticBenchmarkCorpus } from "@vera/benchmark";

import { CalibrationObservationSchema } from "./schema.js";
import type { CalibrationObservation } from "./schema.js";

export function observationsFromBenchmark(
  corpus: SyntheticBenchmarkCorpus,
  providerRun: BenchmarkProviderRun,
): readonly CalibrationObservation[] {
  const predictionByCase = new Map(
    providerRun.predictions.map((prediction) => [prediction.caseId, prediction]),
  );
  return corpus.cases.map((item) => {
    const prediction = predictionByCase.get(item.caseId);
    const correct = prediction?.predictedOutcome === item.expectedOutcome;
    return CalibrationObservationSchema.parse({
      caseId: item.caseId,
      split: item.split,
      score: correct ? 0.9 : 0.4,
      correct,
      proposedOutcome: prediction?.predictedOutcome ?? "REVIEW",
      riskLevel: item.expectedOutcome === "FAIL" ? "HIGH" : "LOW",
      validationScope: "TECHNICAL_DEMO",
    });
  });
}
