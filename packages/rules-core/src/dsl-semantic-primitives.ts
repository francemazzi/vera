import { EvidenceSchema, MAX_EVALUABLE_TEXT_CODE_UNITS, UtcDateTimeSchema } from "@vera/contracts";
import type { Evidence, NormalizedBoundingBox } from "@vera/contracts";

export const MAX_SEMANTIC_TEXT_CODE_UNITS = MAX_EVALUABLE_TEXT_CODE_UNITS;
export const RECOMMENDED_SAME_VISUAL_AREA_IOU_THRESHOLD = 0.5;
export const RECOMMENDED_SAME_VISUAL_AREA_EDGE_DISTANCE = 0.02;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const UTC_DATE_TIME_PARTS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/u;

export const DSL_SEMANTIC_ERROR_CODES = [
  "INVALID_TEXT",
  "INVALID_TEXT_OPTIONS",
  "INVALID_TEXT_FRAGMENT",
  "INVALID_NUMBER",
  "INVALID_NUMERIC_RANGE",
  "INVALID_NUMERIC_RANGE_OPTIONS",
  "INVALID_DATE",
  "INVALID_DATE_TIME",
  "INVALID_INTERVAL",
  "INVALID_BOUNDING_BOX",
  "INVALID_VISUAL_REGION",
  "INVALID_VISUAL_THRESHOLD",
] as const;

export type DslSemanticErrorCode = (typeof DSL_SEMANTIC_ERROR_CODES)[number];

export class DslSemanticError extends Error {
  public readonly code: DslSemanticErrorCode;

  public constructor(code: DslSemanticErrorCode, message: string) {
    super(message);
    this.name = "DslSemanticError";
    this.code = code;
  }
}

export interface UnicodeComparisonOptions {
  readonly normalization: "NFC" | "NFKC";
  readonly whitespace: "PRESERVE" | "COLLAPSE";
  /** Unicode default lowercasing; deliberately not locale-aware collation. */
  readonly caseSensitivity: "SENSITIVE" | "INSENSITIVE";
}

export type SemanticComparison = -1 | 0 | 1;

function assertSemanticText(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > MAX_SEMANTIC_TEXT_CODE_UNITS ||
    LONE_SURROGATE.test(value)
  ) {
    throw new DslSemanticError(
      "INVALID_TEXT",
      "Semantic text must be a bounded well-formed Unicode string",
    );
  }
}

function validateUnicodeComparisonOptions(options: unknown): UnicodeComparisonOptions {
  if (options === null || typeof options !== "object" || Object.keys(options).length !== 3) {
    throw new DslSemanticError(
      "INVALID_TEXT_OPTIONS",
      "Unicode options require explicit supported normalization, whitespace, and case modes",
    );
  }
  const candidate = options as Readonly<Record<string, unknown>>;
  const normalization = candidate["normalization"];
  const whitespace = candidate["whitespace"];
  const caseSensitivity = candidate["caseSensitivity"];
  if (
    (normalization !== "NFC" && normalization !== "NFKC") ||
    (whitespace !== "PRESERVE" && whitespace !== "COLLAPSE") ||
    (caseSensitivity !== "SENSITIVE" && caseSensitivity !== "INSENSITIVE")
  ) {
    throw new DslSemanticError(
      "INVALID_TEXT_OPTIONS",
      "Unicode options require explicit supported normalization, whitespace, and case modes",
    );
  }
  return { normalization, whitespace, caseSensitivity };
}

export function normalizeSemanticText(value: string, options: UnicodeComparisonOptions): string {
  assertSemanticText(value);
  const validOptions = validateUnicodeComparisonOptions(options);
  let normalized = value.normalize(validOptions.normalization);
  if (validOptions.whitespace === "COLLAPSE") {
    normalized = normalized.replace(/\p{White_Space}+/gu, " ").trim();
  }
  if (validOptions.caseSensitivity === "INSENSITIVE") {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

function compareCodePoints(left: string, right: string): SemanticComparison {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) as number);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) as number);
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const leftPoint = leftPoints[index] as number;
    const rightPoint = rightPoints[index] as number;
    if (leftPoint < rightPoint) return -1;
    if (leftPoint > rightPoint) return 1;
  }
  if (leftPoints.length < rightPoints.length) return -1;
  if (leftPoints.length > rightPoints.length) return 1;
  return 0;
}

export function compareSemanticText(
  left: string,
  right: string,
  options: UnicodeComparisonOptions,
): SemanticComparison {
  return compareCodePoints(
    normalizeSemanticText(left, options),
    normalizeSemanticText(right, options),
  );
}

export function semanticTextEquals(
  left: string,
  right: string,
  options: UnicodeComparisonOptions,
): boolean {
  return compareSemanticText(left, right, options) === 0;
}

export function semanticTextContains(
  text: string,
  fragment: string,
  options: UnicodeComparisonOptions,
): boolean {
  const normalizedText = normalizeSemanticText(text, options);
  const normalizedFragment = normalizeSemanticText(fragment, options);
  if (normalizedFragment.length === 0) {
    throw new DslSemanticError(
      "INVALID_TEXT_FRAGMENT",
      "Text containment requires a non-empty normalized fragment",
    );
  }
  return normalizedText.includes(normalizedFragment);
}

/**
 * Accepts only canonical finite JSON numbers. Unsafe integers and negative zero are rejected
 * because they cannot cross the public Fact/DSL hashing boundary without ambiguity.
 */
export function normalizeJsonNumber(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Object.is(value, -0) ||
    (Number.isInteger(value) && !Number.isSafeInteger(value))
  ) {
    throw new DslSemanticError(
      "INVALID_NUMBER",
      "Numeric operands must be finite JSON numbers and integers must be safe",
    );
  }
  return value;
}

export function compareJsonNumbers(left: unknown, right: unknown): SemanticComparison {
  const normalizedLeft = normalizeJsonNumber(left);
  const normalizedRight = normalizeJsonNumber(right);
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
}

export interface NumericRangeOptions {
  readonly includeMinimum: boolean;
  readonly includeMaximum: boolean;
}

function validateNumericRangeOptions(options: unknown): NumericRangeOptions {
  if (options === null || typeof options !== "object" || Object.keys(options).length !== 2) {
    throw new DslSemanticError(
      "INVALID_NUMERIC_RANGE_OPTIONS",
      "Numeric ranges require explicit boolean inclusion options",
    );
  }
  const candidate = options as Readonly<Record<string, unknown>>;
  const includeMinimum = candidate["includeMinimum"];
  const includeMaximum = candidate["includeMaximum"];
  if (typeof includeMinimum !== "boolean" || typeof includeMaximum !== "boolean") {
    throw new DslSemanticError(
      "INVALID_NUMERIC_RANGE_OPTIONS",
      "Numeric ranges require explicit boolean inclusion options",
    );
  }
  return { includeMinimum, includeMaximum };
}

export function jsonNumberIsBetween(
  value: unknown,
  minimum: unknown,
  maximum: unknown,
  options: NumericRangeOptions,
): boolean {
  const validOptions = validateNumericRangeOptions(options);
  const normalizedValue = normalizeJsonNumber(value);
  const normalizedMinimum = normalizeJsonNumber(minimum);
  const normalizedMaximum = normalizeJsonNumber(maximum);
  if (normalizedMinimum > normalizedMaximum) {
    throw new DslSemanticError(
      "INVALID_NUMERIC_RANGE",
      "Numeric range minimum cannot exceed maximum",
    );
  }
  const satisfiesMinimum = validOptions.includeMinimum
    ? normalizedValue >= normalizedMinimum
    : normalizedValue > normalizedMinimum;
  const satisfiesMaximum = validOptions.includeMaximum
    ? normalizedValue <= normalizedMaximum
    : normalizedValue < normalizedMaximum;
  return satisfiesMinimum && satisfiesMaximum;
}

export interface ParsedIsoDate {
  readonly canonical: string;
  readonly epochDay: number;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseIsoDate(value: string): ParsedIsoDate {
  assertSemanticText(value);
  const match = ISO_DATE.exec(value);
  if (match === null) {
    throw new DslSemanticError("INVALID_DATE", "Date operands must use YYYY-MM-DD");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new DslSemanticError("INVALID_DATE", "Date operand is not a real calendar date");
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return { canonical: value, epochDay: timestamp / 86_400_000 };
}

export function compareIsoDates(left: string, right: string): SemanticComparison {
  const leftDay = parseIsoDate(left).epochDay;
  const rightDay = parseIsoDate(right).epochDay;
  if (leftDay < rightDay) return -1;
  if (leftDay > rightDay) return 1;
  return 0;
}

/** Evaluates the four explicit boundary combinations used by the DSL `date_between` operator. */
export function isoDateIsBetween(
  value: string,
  minimum: string,
  maximum: string,
  options: NumericRangeOptions,
): boolean {
  const validOptions = validateNumericRangeOptions(options);
  const minimumToMaximum = compareIsoDates(minimum, maximum);
  if (minimumToMaximum > 0) {
    throw new DslSemanticError("INVALID_INTERVAL", "Calendar range minimum cannot exceed maximum");
  }
  const valueToMinimum = compareIsoDates(value, minimum);
  const valueToMaximum = compareIsoDates(value, maximum);
  const satisfiesMinimum = validOptions.includeMinimum ? valueToMinimum >= 0 : valueToMinimum > 0;
  const satisfiesMaximum = validOptions.includeMaximum ? valueToMaximum <= 0 : valueToMaximum < 0;
  return satisfiesMinimum && satisfiesMaximum;
}

export interface ParsedUtcDateTime {
  readonly canonical: string;
  readonly epochMilliseconds: number;
  readonly epochSecond: number;
  /** Fractional-second digits with insignificant trailing zeroes removed. */
  readonly fractionalSecond: string;
}

export function parseUtcDateTime(value: string): ParsedUtcDateTime {
  assertSemanticText(value);
  const parsed = UtcDateTimeSchema.safeParse(value);
  const match = UTC_DATE_TIME_PARTS.exec(value);
  if (!parsed.success || match === null) {
    throw new DslSemanticError(
      "INVALID_DATE_TIME",
      "Date-time operands must satisfy the public RFC 3339 UTC-Z contract",
    );
  }
  const epochSecond = Date.parse(`${String(match[1])}.000Z`) / 1000;
  const epochMilliseconds = Date.parse(parsed.data);
  return {
    canonical: parsed.data,
    epochMilliseconds,
    epochSecond,
    fractionalSecond: (match[2] ?? "").replace(/0+$/u, ""),
  };
}

function compareParsedUtcDateTimes(
  left: ParsedUtcDateTime,
  right: ParsedUtcDateTime,
): SemanticComparison {
  if (left.epochSecond < right.epochSecond) return -1;
  if (left.epochSecond > right.epochSecond) return 1;
  const fractionLength = Math.max(left.fractionalSecond.length, right.fractionalSecond.length);
  const leftFraction = left.fractionalSecond.padEnd(fractionLength, "0");
  const rightFraction = right.fractionalSecond.padEnd(fractionLength, "0");
  if (leftFraction < rightFraction) return -1;
  if (leftFraction > rightFraction) return 1;
  return 0;
}

export function compareUtcDateTimes(left: string, right: string): SemanticComparison {
  return compareParsedUtcDateTimes(parseUtcDateTime(left), parseUtcDateTime(right));
}

export interface HalfOpenInterval<T extends string> {
  readonly from: T;
  readonly to: T | null;
}

function isWithinHalfOpenRange(value: number, from: number, to: number | null): boolean {
  if (to !== null && to <= from) {
    throw new DslSemanticError(
      "INVALID_INTERVAL",
      "Half-open interval end must be later than its start",
    );
  }
  return value >= from && (to === null || value < to);
}

export function isDateWithinHalfOpenInterval(
  value: string,
  interval: HalfOpenInterval<string>,
): boolean {
  const from = parseIsoDate(interval.from).epochDay;
  const to = interval.to === null ? null : parseIsoDate(interval.to).epochDay;
  return isWithinHalfOpenRange(parseIsoDate(value).epochDay, from, to);
}

export function isDateTimeWithinHalfOpenInterval(
  value: string,
  interval: HalfOpenInterval<string>,
): boolean {
  const parsedValue = parseUtcDateTime(value);
  const from = parseUtcDateTime(interval.from);
  const to = interval.to === null ? null : parseUtcDateTime(interval.to);
  if (to !== null && compareParsedUtcDateTimes(to, from) <= 0) {
    throw new DslSemanticError(
      "INVALID_INTERVAL",
      "Half-open interval end must be later than its start",
    );
  }
  return (
    compareParsedUtcDateTimes(parsedValue, from) >= 0 &&
    (to === null || compareParsedUtcDateTimes(parsedValue, to) < 0)
  );
}

export function utcDateTimeIntervalsOverlap(
  left: HalfOpenInterval<string>,
  right: HalfOpenInterval<string>,
): boolean {
  const leftFrom = parseUtcDateTime(left.from);
  const leftTo = left.to === null ? null : parseUtcDateTime(left.to);
  const rightFrom = parseUtcDateTime(right.from);
  const rightTo = right.to === null ? null : parseUtcDateTime(right.to);
  if (
    (leftTo !== null && compareParsedUtcDateTimes(leftTo, leftFrom) <= 0) ||
    (rightTo !== null && compareParsedUtcDateTimes(rightTo, rightFrom) <= 0)
  ) {
    throw new DslSemanticError(
      "INVALID_INTERVAL",
      "Half-open interval end must be later than its start",
    );
  }
  return (
    (rightTo === null || compareParsedUtcDateTimes(leftFrom, rightTo) < 0) &&
    (leftTo === null || compareParsedUtcDateTimes(rightFrom, leftTo) < 0)
  );
}

function validateBoundingBox(box: NormalizedBoundingBox): NormalizedBoundingBox {
  const { x, y, width, height } = box;
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > 1 ||
    y + height > 1
  ) {
    throw new DslSemanticError(
      "INVALID_BOUNDING_BOX",
      "Bounding boxes must be finite positive rectangles contained in [0,1]",
    );
  }
  return { x, y, width, height };
}

export function boundingBoxIntersectionOverUnion(
  leftInput: NormalizedBoundingBox,
  rightInput: NormalizedBoundingBox,
): number {
  const left = validateBoundingBox(leftInput);
  const right = validateBoundingBox(rightInput);
  const intersectionWidth = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  const intersection = intersectionWidth * intersectionHeight;
  const union = left.width * left.height + right.width * right.height - intersection;
  return intersection / union;
}

export type VisualRegion = Pick<Evidence, "documentId" | "documentHash" | "page" | "boundingBox">;

const VisualRegionSchema = EvidenceSchema.pick({
  documentId: true,
  documentHash: true,
  page: true,
  boundingBox: true,
});

function validateVisualRegion(region: VisualRegion): VisualRegion {
  const parsed = VisualRegionSchema.safeParse(region);
  if (!parsed.success) {
    throw new DslSemanticError(
      "INVALID_VISUAL_REGION",
      "Visual regions require document identity, content hash, a positive page, and a valid box",
    );
  }
  return parsed.data;
}

/**
 * Returns edge-to-edge Euclidean distance divided by the normalized page diagonal (`sqrt(2)`).
 * Overlapping or edge-touching rectangles therefore have distance zero.
 */
export function normalizedBoundingBoxEdgeDistance(
  leftInput: NormalizedBoundingBox,
  rightInput: NormalizedBoundingBox,
): number {
  const left = validateBoundingBox(leftInput);
  const right = validateBoundingBox(rightInput);
  const horizontalGap = Math.max(
    0,
    left.x - (right.x + right.width),
    right.x - (left.x + left.width),
  );
  const verticalGap = Math.max(
    0,
    left.y - (right.y + right.height),
    right.y - (left.y + left.height),
  );
  return Math.hypot(horizontalGap, verticalGap) / Math.SQRT2;
}

export function sameVisualArea(
  leftInput: VisualRegion,
  rightInput: VisualRegion,
  maximumNormalizedEdgeDistance: number,
): boolean {
  if (
    !Number.isFinite(maximumNormalizedEdgeDistance) ||
    maximumNormalizedEdgeDistance < 0 ||
    maximumNormalizedEdgeDistance > 1
  ) {
    throw new DslSemanticError(
      "INVALID_VISUAL_THRESHOLD",
      "same_visual_area requires an explicit normalized edge-distance threshold in [0,1]",
    );
  }
  const left = validateVisualRegion(leftInput);
  const right = validateVisualRegion(rightInput);
  return (
    left.documentId === right.documentId &&
    left.documentHash === right.documentHash &&
    left.page === right.page &&
    normalizedBoundingBoxEdgeDistance(left.boundingBox, right.boundingBox) <=
      maximumNormalizedEdgeDistance
  );
}
