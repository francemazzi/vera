import { describe, expect, it } from "vitest";

import {
  DSL_SEMANTIC_ERROR_CODES,
  DslSemanticError,
  MAX_SEMANTIC_TEXT_CODE_UNITS,
  RECOMMENDED_SAME_VISUAL_AREA_EDGE_DISTANCE,
  RECOMMENDED_SAME_VISUAL_AREA_IOU_THRESHOLD,
  boundingBoxIntersectionOverUnion,
  compareIsoDates,
  compareJsonNumbers,
  compareSemanticText,
  compareUtcDateTimes,
  isDateTimeWithinHalfOpenInterval,
  isDateWithinHalfOpenInterval,
  isoDateIsBetween,
  jsonNumberIsBetween,
  normalizeJsonNumber,
  normalizeSemanticText,
  normalizedBoundingBoxEdgeDistance,
  parseIsoDate,
  parseUtcDateTime,
  sameVisualArea,
  semanticTextContains,
  semanticTextEquals,
  utcDateTimeIntervalsOverlap,
  type UnicodeComparisonOptions,
} from "../../src/dsl-semantic-primitives.js";

const STRICT_TEXT: UnicodeComparisonOptions = {
  normalization: "NFC",
  whitespace: "PRESERVE",
  caseSensitivity: "SENSITIVE",
};

const COMPATIBLE_TEXT: UnicodeComparisonOptions = {
  normalization: "NFKC",
  whitespace: "COLLAPSE",
  caseSensitivity: "INSENSITIVE",
};

const DOCUMENT_HASH = "a".repeat(64);
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000001";

describe("Unicode semantic primitives", () => {
  it("makes normalization, whitespace, and case behavior explicit", () => {
    expect(normalizeSemanticText("  Ａ\u00a0VALUE\n", COMPATIBLE_TEXT)).toBe("a value");
    expect(normalizeSemanticText("e\u0301", STRICT_TEXT)).toBe("é");
    expect(normalizeSemanticText("  A\tB  ", STRICT_TEXT)).toBe("  A\tB  ");
  });

  it("compares Unicode code points without locale collation", () => {
    expect(compareSemanticText("A", "A", STRICT_TEXT)).toBe(0);
    expect(compareSemanticText("A", "B", STRICT_TEXT)).toBe(-1);
    expect(compareSemanticText("😀", "�", STRICT_TEXT)).toBe(1);
    expect(compareSemanticText("A", "AA", STRICT_TEXT)).toBe(-1);
    expect(compareSemanticText("AA", "A", STRICT_TEXT)).toBe(1);
  });

  it("supports explicit equality and normalized containment", () => {
    expect(semanticTextEquals(" Ａ ", "a", COMPATIBLE_TEXT)).toBe(true);
    expect(semanticTextEquals("A", "a", STRICT_TEXT)).toBe(false);
    expect(semanticTextContains("  Alpha\nBeta ", "alpha beta", COMPATIBLE_TEXT)).toBe(true);
    expect(semanticTextContains("Alpha", "pha", STRICT_TEXT)).toBe(true);
    expect(() => semanticTextContains("Alpha", "", STRICT_TEXT)).toThrow(
      expect.objectContaining({ code: "INVALID_TEXT_FRAGMENT" }),
    );
    expect(() => semanticTextContains("Alpha", " \n ", COMPATIBLE_TEXT)).toThrow(
      expect.objectContaining({ code: "INVALID_TEXT_FRAGMENT" }),
    );
  });

  it("rejects non-strings, lone surrogates, and oversized input", () => {
    expect(() => normalizeSemanticText(42 as unknown as string, STRICT_TEXT)).toThrow(
      expect.objectContaining({ code: "INVALID_TEXT" }),
    );
    expect(() => normalizeSemanticText("\uD800", STRICT_TEXT)).toThrow(DslSemanticError);
    expect(() =>
      normalizeSemanticText("x".repeat(MAX_SEMANTIC_TEXT_CODE_UNITS + 1), STRICT_TEXT),
    ).toThrow(expect.objectContaining({ code: "INVALID_TEXT" }));
  });

  it.each([
    { normalization: "NFD", whitespace: "PRESERVE", caseSensitivity: "SENSITIVE" },
    { normalization: "NFC", whitespace: "TRIM", caseSensitivity: "SENSITIVE" },
    { normalization: "NFC", whitespace: "PRESERVE", caseSensitivity: "LOCALE" },
    { ...STRICT_TEXT, unexpected: true },
  ])("rejects invalid Unicode options %j", (options) => {
    expect(() =>
      normalizeSemanticText("value", options as unknown as UnicodeComparisonOptions),
    ).toThrow(expect.objectContaining({ code: "INVALID_TEXT_OPTIONS" }));
  });
});

describe("finite JSON number primitives", () => {
  it.each([
    [0, 0],
    [Number.MIN_VALUE, Number.MIN_VALUE],
    [1.5, 1.5],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  ])("normalizes %s without textual coercion", (input, expected) => {
    expect(normalizeJsonNumber(input)).toBe(expected);
  });

  it.each([
    -0,
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MAX_VALUE,
    "1",
    1n,
    null,
  ])("rejects ambiguous or non-JSON number %s", (input) => {
    expect(() => normalizeJsonNumber(input)).toThrow(
      expect.objectContaining({ code: "INVALID_NUMBER" }),
    );
  });

  it("uses exact IEEE-754 comparison without hidden tolerance", () => {
    expect(compareJsonNumbers(1, 2)).toBe(-1);
    expect(compareJsonNumbers(2, 1)).toBe(1);
    expect(compareJsonNumbers(2, 2)).toBe(0);
    expect(() => compareJsonNumbers(-0, 0)).toThrow(
      expect.objectContaining({ code: "INVALID_NUMBER" }),
    );
    expect(compareJsonNumbers(0.1 + 0.2, 0.3)).toBe(1);
  });

  it("requires explicit inclusive or exclusive range boundaries", () => {
    expect(jsonNumberIsBetween(1, 1, 2, { includeMinimum: true, includeMaximum: false })).toBe(
      true,
    );
    expect(jsonNumberIsBetween(1, 1, 2, { includeMinimum: false, includeMaximum: true })).toBe(
      false,
    );
    expect(jsonNumberIsBetween(2, 1, 2, { includeMinimum: false, includeMaximum: true })).toBe(
      true,
    );
    expect(jsonNumberIsBetween(2, 1, 2, { includeMinimum: true, includeMaximum: false })).toBe(
      false,
    );
    expect(() =>
      jsonNumberIsBetween(2, 3, 1, { includeMinimum: true, includeMaximum: true }),
    ).toThrow(expect.objectContaining({ code: "INVALID_NUMERIC_RANGE" }));
  });

  it.each([
    { includeMinimum: "true", includeMaximum: false },
    { includeMinimum: true },
    { includeMinimum: true, includeMaximum: false, unexpected: true },
  ])("rejects invalid numeric range options %j", (options) => {
    expect(() =>
      jsonNumberIsBetween(
        1,
        0,
        2,
        options as unknown as {
          includeMinimum: boolean;
          includeMaximum: boolean;
        },
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_NUMERIC_RANGE_OPTIONS" }));
  });
});

describe("ISO date primitives", () => {
  it("validates leap years and compares calendar dates", () => {
    expect(parseIsoDate("2000-02-29").canonical).toBe("2000-02-29");
    expect(parseIsoDate("0000-01-01").epochDay).toBeLessThan(0);
    expect(compareIsoDates("2026-01-01", "2026-01-02")).toBe(-1);
    expect(compareIsoDates("2026-01-02", "2026-01-01")).toBe(1);
    expect(compareIsoDates("2026-01-01", "2026-01-01")).toBe(0);
  });

  it.each(["2026-1-01", "1900-02-29", "2026-04-31", "2026-13-01", "not-a-date"])(
    "rejects invalid date %s",
    (value) => {
      expect(() => parseIsoDate(value)).toThrow(expect.objectContaining({ code: "INVALID_DATE" }));
    },
  );

  it("evaluates date intervals as half-open and supports unbounded ends", () => {
    const bounded = { from: "2026-01-01", to: "2026-02-01" };
    expect(isDateWithinHalfOpenInterval("2026-01-01", bounded)).toBe(true);
    expect(isDateWithinHalfOpenInterval("2026-01-31", bounded)).toBe(true);
    expect(isDateWithinHalfOpenInterval("2026-02-01", bounded)).toBe(false);
    expect(isDateWithinHalfOpenInterval("9999-12-31", { from: "2026-01-01", to: null })).toBe(true);
    expect(() =>
      isDateWithinHalfOpenInterval("2026-01-01", {
        from: "2026-02-01",
        to: "2026-01-01",
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_INTERVAL" }));
  });

  it("supports every explicit date_between boundary combination", () => {
    const minimum = "2026-01-01";
    const maximum = "2026-01-02";
    expect(
      isoDateIsBetween(minimum, minimum, maximum, {
        includeMinimum: true,
        includeMaximum: false,
      }),
    ).toBe(true);
    expect(
      isoDateIsBetween(minimum, minimum, maximum, {
        includeMinimum: false,
        includeMaximum: true,
      }),
    ).toBe(false);
    expect(
      isoDateIsBetween(maximum, minimum, maximum, {
        includeMinimum: false,
        includeMaximum: true,
      }),
    ).toBe(true);
    expect(
      isoDateIsBetween(maximum, minimum, maximum, {
        includeMinimum: true,
        includeMaximum: false,
      }),
    ).toBe(false);
    expect(() =>
      isoDateIsBetween(minimum, maximum, minimum, {
        includeMinimum: true,
        includeMaximum: true,
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_INTERVAL" }));
  });
});

describe("canonical UTC date-time primitives", () => {
  const start = "2026-01-01T00:00:00.000Z";
  const middle = "2026-01-01T00:00:00.500Z";
  const end = "2026-01-01T00:00:01.000Z";

  it("parses canonical millisecond UTC and compares instants", () => {
    expect(parseUtcDateTime(start)).toEqual({
      canonical: start,
      epochMilliseconds: 1767225600000,
      epochSecond: 1767225600,
      fractionalSecond: "",
    });
    expect(compareUtcDateTimes(start, middle)).toBe(-1);
    expect(compareUtcDateTimes(end, middle)).toBe(1);
    expect(compareUtcDateTimes(start, start)).toBe(0);
  });

  it.each([
    "2026-01-01T00:00:00.000+00:00",
    "2026-01-01T24:00:00.000Z",
    "2026-01-01T00:60:00.000Z",
    "2026-01-01T00:00:60.000Z",
    "2026-02-30T00:00:00.000Z",
  ])("rejects noncanonical or invalid date-time %s", (value) => {
    expect(() => parseUtcDateTime(value)).toThrow(
      expect.objectContaining({ code: "INVALID_DATE_TIME" }),
    );
  });

  it("accepts public UTC-Z precision and compares sub-millisecond instants exactly", () => {
    expect(parseUtcDateTime("2026-01-01T00:00:00Z").fractionalSecond).toBe("");
    expect(parseUtcDateTime("2026-01-01T00:00:00.1Z").fractionalSecond).toBe("1");
    expect(compareUtcDateTimes("2026-01-01T00:00:00.1234Z", "2026-01-01T00:00:00.1235Z")).toBe(-1);
    expect(compareUtcDateTimes("2026-01-01T00:00:00.1Z", "2026-01-01T00:00:00.1000Z")).toBe(0);
  });

  it("uses half-open date-time boundaries", () => {
    const interval = { from: start, to: end };
    expect(isDateTimeWithinHalfOpenInterval(start, interval)).toBe(true);
    expect(isDateTimeWithinHalfOpenInterval(middle, interval)).toBe(true);
    expect(isDateTimeWithinHalfOpenInterval(end, interval)).toBe(false);
    expect(isDateTimeWithinHalfOpenInterval(end, { from: start, to: null })).toBe(true);
    expect(() => isDateTimeWithinHalfOpenInterval(start, { from: end, to: start })).toThrow(
      expect.objectContaining({ code: "INVALID_INTERVAL" }),
    );
  });

  it("treats touching intervals as disjoint and handles unbounded overlap", () => {
    expect(
      utcDateTimeIntervalsOverlap({ from: start, to: middle }, { from: middle, to: end }),
    ).toBe(false);
    expect(utcDateTimeIntervalsOverlap({ from: start, to: end }, { from: middle, to: null })).toBe(
      true,
    );
    expect(utcDateTimeIntervalsOverlap({ from: end, to: null }, { from: start, to: middle })).toBe(
      false,
    );
    expect(() =>
      utcDateTimeIntervalsOverlap({ from: end, to: start }, { from: start, to: middle }),
    ).toThrow(expect.objectContaining({ code: "INVALID_INTERVAL" }));
  });
});

describe("same_visual_area geometry", () => {
  const full = { x: 0, y: 0, width: 1, height: 1 };
  const half = { x: 0, y: 0, width: 0.5, height: 1 };
  const otherHalf = { x: 0.5, y: 0, width: 0.5, height: 1 };

  it("computes intersection-over-union in normalized coordinates", () => {
    expect(boundingBoxIntersectionOverUnion(full, full)).toBe(1);
    expect(boundingBoxIntersectionOverUnion(full, half)).toBe(0.5);
    expect(boundingBoxIntersectionOverUnion(half, otherHalf)).toBe(0);
  });

  it("keeps an explicit recommended IoU threshold for overlap rules", () => {
    expect(RECOMMENDED_SAME_VISUAL_AREA_IOU_THRESHOLD).toBe(0.5);
  });

  it("computes edge-to-edge distance normalized by the page diagonal", () => {
    expect(normalizedBoundingBoxEdgeDistance(half, otherHalf)).toBe(0);
    expect(
      normalizedBoundingBoxEdgeDistance(
        { x: 0, y: 0, width: 0.25, height: 0.25 },
        { x: 0.75, y: 0.75, width: 0.25, height: 0.25 },
      ),
    ).toBe(0.5);
  });

  it("requires the same page and a caller-declared inclusive distance threshold", () => {
    const left = {
      documentId: DOCUMENT_ID,
      documentHash: DOCUMENT_HASH,
      page: 1,
      boundingBox: { x: 0, y: 0, width: 0.25, height: 0.25 },
    };
    const close = {
      documentId: DOCUMENT_ID,
      documentHash: DOCUMENT_HASH,
      page: 1,
      boundingBox: { x: 0.26, y: 0, width: 0.25, height: 0.25 },
    };
    const otherPage = { ...close, page: 2 };
    const otherDocument = { ...close, documentHash: "b".repeat(64) };
    const otherDocumentId = {
      ...close,
      documentId: "00000000-0000-4000-8000-000000000002",
    };
    const distance = normalizedBoundingBoxEdgeDistance(left.boundingBox, close.boundingBox);

    expect(RECOMMENDED_SAME_VISUAL_AREA_EDGE_DISTANCE).toBe(0.02);
    expect(sameVisualArea(left, close, distance)).toBe(true);
    expect(sameVisualArea(left, close, distance / 2)).toBe(false);
    expect(sameVisualArea(left, otherPage, 1)).toBe(false);
    expect(sameVisualArea(left, otherDocument, 1)).toBe(false);
    expect(sameVisualArea(left, otherDocumentId, 1)).toBe(false);
    expect(sameVisualArea(left, left, 0)).toBe(true);
  });

  it.each([-0.1, 1.1, NaN, Infinity])("rejects invalid distance threshold %s", (threshold) => {
    const region = {
      documentId: DOCUMENT_ID,
      documentHash: DOCUMENT_HASH,
      page: 1,
      boundingBox: full,
    };
    expect(() => sameVisualArea(region, region, threshold)).toThrow(
      expect.objectContaining({ code: "INVALID_VISUAL_THRESHOLD" }),
    );
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid page %s", (page) => {
    expect(() =>
      sameVisualArea(
        { documentId: DOCUMENT_ID, documentHash: DOCUMENT_HASH, page, boundingBox: full },
        {
          documentId: DOCUMENT_ID,
          documentHash: DOCUMENT_HASH,
          page: 1,
          boundingBox: full,
        },
        RECOMMENDED_SAME_VISUAL_AREA_EDGE_DISTANCE,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_VISUAL_REGION" }));
  });

  it("rejects a malformed document hash", () => {
    expect(() =>
      sameVisualArea(
        { documentId: DOCUMENT_ID, documentHash: "not-a-hash", page: 1, boundingBox: full },
        {
          documentId: DOCUMENT_ID,
          documentHash: DOCUMENT_HASH,
          page: 1,
          boundingBox: full,
        },
        RECOMMENDED_SAME_VISUAL_AREA_EDGE_DISTANCE,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_VISUAL_REGION" }));
  });

  it.each([
    { x: -0.1, y: 0, width: 0.5, height: 0.5 },
    { x: 0, y: 0, width: 0, height: 0.5 },
    { x: 0.8, y: 0, width: 0.3, height: 0.5 },
    { x: 0, y: 0.8, width: 0.5, height: 0.3 },
    { x: 0, y: 0, width: Number.NaN, height: 0.5 },
  ])("rejects invalid bounding box %j", (box) => {
    expect(() => boundingBoxIntersectionOverUnion(box, full)).toThrow(
      expect.objectContaining({ code: "INVALID_BOUNDING_BOX" }),
    );
  });
});

describe("semantic error vocabulary", () => {
  it("contains unique explicit codes", () => {
    expect(new Set(DSL_SEMANTIC_ERROR_CODES).size).toBe(DSL_SEMANTIC_ERROR_CODES.length);
  });
});
