import { z } from "zod";

const ChunkIdSchema = z.string().trim().min(1).max(300);

export const RetrievalBenchmarkCaseSchema = z
  .object({
    caseId: z.string().trim().min(1).max(120),
    expectedRelevantChunkIds: z.array(ChunkIdSchema).min(1),
    retrievedChunkIds: z.array(ChunkIdSchema),
    citedChunkIds: z.array(ChunkIdSchema),
    supportedClaimIds: z.array(z.string().trim().min(1).max(120)),
    unsupportedClaimIds: z.array(z.string().trim().min(1).max(120)),
  })
  .strict();

export type RetrievalBenchmarkCase = z.infer<typeof RetrievalBenchmarkCaseSchema>;

export const RetrievalMetricsSchema = z
  .object({
    caseCount: z.int().min(0),
    recallAtK: z.number().min(0).max(1),
    citationAccuracy: z.number().min(0).max(1),
    faithfulness: z.number().min(0).max(1),
    unsupportedClaimRate: z.number().min(0).max(1),
  })
  .strict();

export type RetrievalMetrics = z.infer<typeof RetrievalMetricsSchema>;

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function intersectionSize(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) count += 1;
  }
  return count;
}

export function computeRetrievalMetrics(
  cases: readonly RetrievalBenchmarkCase[],
): RetrievalMetrics {
  const parsedCases = cases.map((item) => RetrievalBenchmarkCaseSchema.parse(item));
  let recallSum = 0;
  let validCitationCount = 0;
  let citationCount = 0;
  let supportedClaimCount = 0;
  let unsupportedClaimCount = 0;

  for (const item of parsedCases) {
    const expected = new Set(item.expectedRelevantChunkIds);
    const retrieved = new Set(item.retrievedChunkIds);
    const cited = new Set(item.citedChunkIds);
    recallSum += ratio(intersectionSize(expected, retrieved), expected.size);
    validCitationCount += intersectionSize(cited, expected);
    citationCount += cited.size;
    supportedClaimCount += item.supportedClaimIds.length;
    unsupportedClaimCount += item.unsupportedClaimIds.length;
  }

  const claimCount = supportedClaimCount + unsupportedClaimCount;
  return RetrievalMetricsSchema.parse({
    caseCount: parsedCases.length,
    recallAtK: parsedCases.length === 0 ? 1 : recallSum / parsedCases.length,
    citationAccuracy: ratio(validCitationCount, citationCount),
    faithfulness: ratio(supportedClaimCount, claimCount),
    unsupportedClaimRate: ratio(unsupportedClaimCount, claimCount),
  });
}
