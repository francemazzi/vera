import { describe, expect, it } from "vitest";

import { deriveRuleOutcome } from "../../src/index.js";
import {
  aggregateOutcomes,
  allTruth,
  anyTruth,
  deriveRuleFinding,
  negateTruth,
} from "../../src/outcome.js";
import type { EvaluationOutcome, TruthValue } from "../../src/index.js";

const truthTable: readonly (readonly [TruthValue, TruthValue, EvaluationOutcome])[] = [
  ["FALSE", "TRUE", "NOT_APPLICABLE"],
  ["FALSE", "FALSE", "NOT_APPLICABLE"],
  ["FALSE", "UNKNOWN", "NOT_APPLICABLE"],
  ["UNKNOWN", "TRUE", "REVIEW"],
  ["UNKNOWN", "FALSE", "REVIEW"],
  ["UNKNOWN", "UNKNOWN", "REVIEW"],
  ["TRUE", "TRUE", "PASS"],
  ["TRUE", "FALSE", "FAIL"],
  ["TRUE", "UNKNOWN", "REVIEW"],
];

describe("deriveRuleOutcome", () => {
  it.each(truthTable)("maps applies=%s and satisfied=%s to %s", (applies, satisfied, expected) => {
    expect(deriveRuleOutcome(applies, satisfied)).toBe(expected);
  });
});

describe("three-valued truth operators", () => {
  it.each([
    ["TRUE", "FALSE"],
    ["FALSE", "TRUE"],
    ["UNKNOWN", "UNKNOWN"],
  ] satisfies readonly (readonly [TruthValue, TruthValue])[])(
    "negates %s to %s",
    (value, expected) => {
      expect(negateTruth(value)).toBe(expected);
    },
  );

  const binaryTruthTable = [
    ["TRUE", "TRUE", "TRUE", "TRUE"],
    ["TRUE", "FALSE", "FALSE", "TRUE"],
    ["TRUE", "UNKNOWN", "UNKNOWN", "TRUE"],
    ["FALSE", "TRUE", "FALSE", "TRUE"],
    ["FALSE", "FALSE", "FALSE", "FALSE"],
    ["FALSE", "UNKNOWN", "FALSE", "UNKNOWN"],
    ["UNKNOWN", "TRUE", "UNKNOWN", "TRUE"],
    ["UNKNOWN", "FALSE", "FALSE", "UNKNOWN"],
    ["UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN"],
  ] satisfies readonly (readonly [TruthValue, TruthValue, TruthValue, TruthValue])[];

  it.each(binaryTruthTable)(
    "combines %s and %s as all=%s and any=%s",
    (left, right, expectedAll, expectedAny) => {
      expect(allTruth([left, right])).toBe(expectedAll);
      expect(anyTruth([left, right])).toBe(expectedAny);
    },
  );

  it.each(["TRUE", "FALSE", "UNKNOWN"] satisfies readonly TruthValue[])(
    "preserves the single operand %s",
    (value) => {
      expect(allTruth([value])).toBe(value);
      expect(anyTruth([value])).toBe(value);
    },
  );

  it("handles longer lists without depending on operand order", () => {
    expect(allTruth(["UNKNOWN", "TRUE", "FALSE"])).toBe("FALSE");
    expect(allTruth(["TRUE", "UNKNOWN", "TRUE"])).toBe("UNKNOWN");
    expect(anyTruth(["UNKNOWN", "FALSE", "TRUE"])).toBe("TRUE");
    expect(anyTruth(["FALSE", "UNKNOWN", "FALSE"])).toBe("UNKNOWN");
  });

  it("rejects empty logical expressions", () => {
    expect(() => allTruth([])).toThrow(
      new RangeError("Truth operators require at least one operand"),
    );
    expect(() => anyTruth([])).toThrow(
      new RangeError("Truth operators require at least one operand"),
    );
  });
});

describe("deriveRuleFinding", () => {
  const findingTruthTable = [
    ["FALSE", null, null, "NOT_APPLICABLE"],
    ["UNKNOWN", null, null, "REVIEW"],
    ["TRUE", "TRUE", null, "NOT_APPLICABLE"],
    ["TRUE", "UNKNOWN", null, "REVIEW"],
    ["TRUE", "FALSE", "TRUE", "PASS"],
    ["TRUE", "FALSE", "FALSE", "FAIL"],
    ["TRUE", "FALSE", "UNKNOWN", "REVIEW"],
    ["TRUE", null, "TRUE", "PASS"],
    ["TRUE", null, "FALSE", "FAIL"],
    ["TRUE", null, "UNKNOWN", "REVIEW"],
  ] satisfies readonly (readonly [
    TruthValue,
    TruthValue | null,
    TruthValue | null,
    EvaluationOutcome,
  ])[];

  it.each(findingTruthTable)(
    "maps applies=%s, exception=%s and satisfied=%s to %s",
    (applies, exception, satisfied, expected) => {
      expect(deriveRuleFinding(applies, exception, satisfied)).toBe(expected);
    },
  );

  it("rejects a satisfaction node skipped while it is required", () => {
    expect(() => deriveRuleFinding("TRUE", "FALSE", null)).toThrow(
      "Satisfaction is required when a rule is applicable and no exception applies",
    );
    expect(() => deriveRuleFinding("TRUE", null, null)).toThrow(
      "Satisfaction is required when a rule is applicable and no exception applies",
    );
  });
});

describe("aggregateOutcomes", () => {
  const binaryAggregationTable = [
    ["PASS", "PASS", "PASS"],
    ["PASS", "FAIL", "FAIL"],
    ["PASS", "REVIEW", "REVIEW"],
    ["PASS", "NOT_APPLICABLE", "PASS"],
    ["FAIL", "PASS", "FAIL"],
    ["FAIL", "FAIL", "FAIL"],
    ["FAIL", "REVIEW", "FAIL"],
    ["FAIL", "NOT_APPLICABLE", "FAIL"],
    ["REVIEW", "PASS", "REVIEW"],
    ["REVIEW", "FAIL", "FAIL"],
    ["REVIEW", "REVIEW", "REVIEW"],
    ["REVIEW", "NOT_APPLICABLE", "REVIEW"],
    ["NOT_APPLICABLE", "PASS", "PASS"],
    ["NOT_APPLICABLE", "FAIL", "FAIL"],
    ["NOT_APPLICABLE", "REVIEW", "REVIEW"],
    ["NOT_APPLICABLE", "NOT_APPLICABLE", "NOT_APPLICABLE"],
  ] satisfies readonly (readonly [EvaluationOutcome, EvaluationOutcome, EvaluationOutcome])[];

  it.each(binaryAggregationTable)("aggregates %s and %s as %s", (left, right, expected) => {
    expect(aggregateOutcomes([left, right])).toBe(expected);
  });

  it.each(["PASS", "FAIL", "REVIEW", "NOT_APPLICABLE"] satisfies readonly EvaluationOutcome[])(
    "preserves the single finding %s",
    (outcome) => {
      expect(aggregateOutcomes([outcome])).toBe(outcome);
    },
  );

  it("uses documented precedence for longer lists", () => {
    expect(aggregateOutcomes(["PASS", "NOT_APPLICABLE", "REVIEW"])).toBe("REVIEW");
    expect(aggregateOutcomes(["REVIEW", "PASS", "FAIL", "NOT_APPLICABLE"])).toBe("FAIL");
  });

  it("rejects an empty Rule Pack", () => {
    expect(() => aggregateOutcomes([])).toThrow(
      new RangeError("Outcome aggregation requires at least one finding"),
    );
  });
});
