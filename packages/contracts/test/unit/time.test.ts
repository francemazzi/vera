import { describe, expect, it } from "vitest";

import {
  isWithinValidityInterval,
  UtcDateTimeSchema,
  ValidityIntervalSchema,
} from "../../src/index.js";

describe("UtcDateTimeSchema", () => {
  it("accepts an ISO date-time expressed in UTC", () => {
    expect(UtcDateTimeSchema.parse("2026-01-01T00:00:00.000Z")).toBe("2026-01-01T00:00:00.000Z");
  });

  it.each(["2026-01-01", "2026-01-01T00:00:00", "2026-01-01T01:00:00+01:00", "not-a-date"])(
    "rejects non-UTC or invalid value %s",
    (value) => {
      expect(UtcDateTimeSchema.safeParse(value).success).toBe(false);
    },
  );
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
