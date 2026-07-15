import { describe, expect, it } from "vitest";

import { ExtractorNormalizationError } from "../../src/errors.js";
import {
  normalizeDecimal,
  normalizeIsoDate,
  normalizeUnicode,
  normalizeUtcDateTime,
} from "../../src/normalization.js";

describe("normalizeUnicode", () => {
  it("compatibility-normalizes glyphs and Unicode whitespace deterministically", () => {
    expect(normalizeUnicode("  Ａ\u00a0value\n\twith  space  ")).toBe("A value with space");
    expect(normalizeUnicode("e\u0301")).toBe("é");
  });

  it("does not perform locale-dependent case folding", () => {
    expect(normalizeUnicode("I İ ı i")).toBe("I İ ı i");
  });
});

describe("normalizeDecimal", () => {
  it.each([
    [12, 12],
    [-0, 0],
    ["0", 0],
    ["-0", 0],
    ["-12.50", -12.5],
  ] as const)("normalizes %s to %s", (input, expected) => {
    expect(normalizeDecimal(input)).toBe(expected);
  });

  it.each([
    NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    " 1",
    "+1",
    "01",
    "1,5",
    "1e2",
    "Infinity",
    "9007199254740993",
    "-9007199254740993",
  ])("rejects ambiguous, inexact, or non-finite decimal %s", (value) => {
    expect(() => normalizeDecimal(value)).toThrow(ExtractorNormalizationError);
  });

  it("rejects a textual decimal outside the finite range", () => {
    expect(() => normalizeDecimal(`1${"0".repeat(400)}`)).toThrow(
      expect.objectContaining({ code: "NORMALIZATION_FAILED" }),
    );
  });
});

describe("normalizeIsoDate", () => {
  it("accepts a real calendar date exactly as written", () => {
    expect(normalizeIsoDate("2024-02-29")).toBe("2024-02-29");
    expect(normalizeIsoDate("0099-01-01")).toBe("0099-01-01");
  });

  it.each(["2026-2-01", "2026-02-30", "not-a-date"])("rejects invalid date %s", (value) => {
    expect(() => normalizeIsoDate(value)).toThrow(ExtractorNormalizationError);
  });
});

describe("normalizeUtcDateTime", () => {
  it("normalizes explicit offsets to UTC with millisecond precision", () => {
    expect(normalizeUtcDateTime("2026-01-01T01:30:00+01:00")).toBe("2026-01-01T00:30:00.000Z");
    expect(normalizeUtcDateTime("2026-01-01T00:30:00Z")).toBe("2026-01-01T00:30:00.000Z");
  });

  it.each([
    "2026-01-01T00:00:00",
    "invalidZ",
    "01/01/2026Z",
    "2026-02-30T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:60:00Z",
    "2026-01-01T00:00:60Z",
    "2026-01-01T00:00:00+24:00",
  ])("rejects ambiguous or invalid date-time %s", (value) => {
    expect(() => normalizeUtcDateTime(value)).toThrow(ExtractorNormalizationError);
  });
});
