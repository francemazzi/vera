import { describe, expect, it } from "vitest";

import {
  compareUtcDateTimes,
  isWithinValidityInterval,
  UtcDateTimeSchema,
  ValidityIntervalSchema,
  validityIntervalsOverlap,
} from "../../src/index.js";

describe("UtcDateTimeSchema", () => {
  it("accepts an ISO date-time expressed in UTC", () => {
    expect(UtcDateTimeSchema.parse("2026-01-01T00:00:00.000Z")).toBe("2026-01-01T00:00:00.000Z");
    expect(UtcDateTimeSchema.parse("2026-01-01T00:00Z")).toBe("2026-01-01T00:00Z");
    expect(UtcDateTimeSchema.parse("2026-01-01T00:00:00.0000001Z")).toBe(
      "2026-01-01T00:00:00.0000001Z",
    );
  });

  it.each(["2026-01-01", "2026-01-01T00:00:00", "2026-01-01T01:00:00+01:00", "not-a-date"])(
    "rejects non-UTC or invalid value %s",
    (value) => {
      expect(UtcDateTimeSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("compareUtcDateTimes", () => {
  it("compares UTC instants exactly below millisecond precision", () => {
    expect(compareUtcDateTimes("2026-01-01T00:00:00.00001Z", "2026-01-01T00:00:00.00002Z")).toBe(
      -1,
    );
    expect(compareUtcDateTimes("2026-01-01T00:00:00.00002Z", "2026-01-01T00:00:00.00001Z")).toBe(1);
  });

  it("treats omitted seconds and insignificant fractional zeroes as the same instant", () => {
    expect(compareUtcDateTimes("2026-01-01T00:00Z", "2026-01-01T00:00:00Z")).toBe(0);
    expect(compareUtcDateTimes("2026-01-01T00:00:00.1Z", "2026-01-01T00:00:00.1000Z")).toBe(0);
  });

  it("rejects invalid runtime operands", () => {
    expect(() => compareUtcDateTimes("not-a-date", "2026-01-01T00:00:00Z")).toThrow();
  });
});

describe("ValidityIntervalSchema", () => {
  const validFrom = "2026-01-01T00:00:00.000Z";

  it("accepts an unbounded half-open interval", () => {
    expect(ValidityIntervalSchema.parse({ validFrom, validTo: null })).toEqual({
      validFrom,
      validTo: null,
    });
  });

  it("accepts a bounded interval when validTo is later", () => {
    const validTo = "2026-01-01T00:00:00.001Z";

    expect(ValidityIntervalSchema.parse({ validFrom, validTo })).toEqual({ validFrom, validTo });
  });

  it("orders interval endpoints exactly within one millisecond", () => {
    const preciseFrom = "2026-01-01T00:00:00.0001Z";
    const preciseTo = "2026-01-01T00:00:00.0002Z";

    expect(ValidityIntervalSchema.parse({ validFrom: preciseFrom, validTo: preciseTo })).toEqual({
      validFrom: preciseFrom,
      validTo: preciseTo,
    });
    expect(
      ValidityIntervalSchema.safeParse({ validFrom: preciseTo, validTo: preciseFrom }).success,
    ).toBe(false);
    expect(
      ValidityIntervalSchema.safeParse({
        validFrom: "2026-01-01T00:00:00.1Z",
        validTo: "2026-01-01T00:00:00.1000Z",
      }).success,
    ).toBe(false);
  });

  it.each(["2026-01-01T00:00:00.000Z", "2025-12-31T23:59:59.999Z"])(
    "rejects non-positive interval ending at %s",
    (validTo) => {
      expect(ValidityIntervalSchema.safeParse({ validFrom, validTo }).success).toBe(false);
    },
  );
});

describe("isWithinValidityInterval", () => {
  const bounded = {
    validFrom: "2026-01-01T00:00:00.000Z",
    validTo: "2026-02-01T00:00:00.000Z",
  } as const;

  it.each([
    ["2025-12-31T23:59:59.999Z", false],
    ["2026-01-01T00:00:00.000Z", true],
    ["2026-01-15T00:00:00.000Z", true],
    ["2026-01-31T23:59:59.999Z", true],
    ["2026-02-01T00:00:00.000Z", false],
  ] as const)("applies half-open boundary semantics to %s", (date, expected) => {
    expect(isWithinValidityInterval(bounded, date)).toBe(expected);
  });

  it("keeps an unbounded interval active after its start", () => {
    expect(
      isWithinValidityInterval(
        { validFrom: bounded.validFrom, validTo: null },
        "2126-01-01T00:00:00.000Z",
      ),
    ).toBe(true);
  });

  it("preserves exact half-open boundaries below millisecond precision", () => {
    const precise = {
      validFrom: "2026-01-01T00:00:00.0001Z",
      validTo: "2026-01-01T00:00:00.0011Z",
    } as const;

    expect(isWithinValidityInterval(precise, "2026-01-01T00:00:00.00005Z")).toBe(false);
    expect(isWithinValidityInterval(precise, precise.validFrom)).toBe(true);
    expect(isWithinValidityInterval(precise, "2026-01-01T00:00:00.00109Z")).toBe(true);
    expect(isWithinValidityInterval(precise, precise.validTo)).toBe(false);
  });

  it("rejects malformed runtime inputs even when static types are bypassed", () => {
    expect(() => isWithinValidityInterval(bounded, "2026-01-01T01:00:00.000+01:00")).toThrow();
    expect(() =>
      isWithinValidityInterval(
        { validFrom: bounded.validFrom, validTo: bounded.validFrom },
        bounded.validFrom,
      ),
    ).toThrow();
  });
});

describe("validityIntervalsOverlap", () => {
  const left = {
    validFrom: "2026-01-01T00:00:00.0001Z",
    validTo: "2026-01-01T00:00:00.0003Z",
  } as const;

  it("detects exact sub-millisecond overlap", () => {
    expect(
      validityIntervalsOverlap(left, {
        validFrom: "2026-01-01T00:00:00.0002Z",
        validTo: "2026-01-01T00:00:00.0004Z",
      }),
    ).toBe(true);
  });

  it("treats touching boundaries as disjoint and supports open ends", () => {
    expect(
      validityIntervalsOverlap(left, {
        validFrom: left.validTo,
        validTo: "2026-01-01T00:00:00.0004Z",
      }),
    ).toBe(false);
    expect(
      validityIntervalsOverlap(
        { validFrom: left.validFrom, validTo: null },
        { validFrom: left.validTo, validTo: null },
      ),
    ).toBe(true);
  });
});
