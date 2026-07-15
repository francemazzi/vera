import { describe, expect, it } from "vitest";

import { UtcDateTimeSchema, ValidityIntervalSchema } from "../../src/index.js";

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
