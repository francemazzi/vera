import { describe, expect, it } from "vitest";

import { computeRetrievalMetrics } from "../../src/index.js";

describe("computeRetrievalMetrics", () => {
  it("computes recall, citation accuracy, faithfulness and unsupported claim rate", () => {
    const metrics = computeRetrievalMetrics([
      {
        caseId: "case-1",
        expectedRelevantChunkIds: ["a", "b"],
        retrievedChunkIds: ["a", "x"],
        citedChunkIds: ["a", "x"],
        supportedClaimIds: ["claim-1"],
        unsupportedClaimIds: ["claim-2"],
      },
      {
        caseId: "case-2",
        expectedRelevantChunkIds: ["c"],
        retrievedChunkIds: ["c"],
        citedChunkIds: ["c"],
        supportedClaimIds: ["claim-3", "claim-4"],
        unsupportedClaimIds: [],
      },
    ]);

    expect(metrics.caseCount).toBe(2);
    expect(metrics.recallAtK).toBe(0.75);
    expect(metrics.citationAccuracy).toBeCloseTo(2 / 3);
    expect(metrics.faithfulness).toBeCloseTo(3 / 4);
    expect(metrics.unsupportedClaimRate).toBeCloseTo(1 / 4);
  });
});
