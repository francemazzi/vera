import { describe, expect, it } from "vitest";
import {
  attributeCiprianiMismatch,
  ciprianiReplayMeetsGate,
} from "../../src/cipriani-pasta-mismatch.js";

describe("Cipriani replay mismatch attribution", () => {
  it("labels empty citations on a blocking field as NO_CITATION", () => {
    expect(
      attributeCiprianiMismatch({
        expected: "NON_CONFORME",
        predicted: "ATTENZIONE",
        outcome: "REVIEW",
        citationChunkIds: [],
      }),
    ).toBe("NO_CITATION");
  });

  it("labels NA disagreements as APPLICABILITY", () => {
    expect(
      attributeCiprianiMismatch({
        expected: "ATTENZIONE",
        predicted: "NON_APPLICABILE",
        outcome: "NOT_APPLICABLE",
        citationChunkIds: ["us-cfr-101-12-pasta-racc"],
      }),
    ).toBe("APPLICABILITY");
  });

  it("fails the calibration gate below 90/85 or with a false EU failure", () => {
    expect(
      ciprianiReplayMeetsGate({ agreement: 0.91, blockingRecall: 0.86, falseEuFailures: 0 }),
    ).toBe(true);
    expect(
      ciprianiReplayMeetsGate({ agreement: 0.76, blockingRecall: 0.86, falseEuFailures: 0 }),
    ).toBe(false);
    expect(
      ciprianiReplayMeetsGate({ agreement: 0.91, blockingRecall: 0.57, falseEuFailures: 0 }),
    ).toBe(false);
    expect(
      ciprianiReplayMeetsGate({ agreement: 0.91, blockingRecall: 0.86, falseEuFailures: 1 }),
    ).toBe(false);
  });
});
