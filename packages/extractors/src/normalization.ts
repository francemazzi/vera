import { ExtractorNormalizationError } from "./errors.js";

const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/u;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}

/**
 * Compatibility-normalizes Unicode and collapses Unicode whitespace without locale-dependent case
 * conversion. The result is stable across extraction providers.
 */
export function normalizeUnicode(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\p{White_Space}+/gu, " ")
    .trim();
}

/** Parses an intentionally narrow, locale-independent decimal grammar. */
export function normalizeDecimal(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ExtractorNormalizationError("A numeric fact must be finite");
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new ExtractorNormalizationError(
        "An integral numeric fact must be exactly representable",
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (!DECIMAL_PATTERN.test(value)) {
    throw new ExtractorNormalizationError(
      "A textual decimal must use the canonical ASCII decimal grammar",
      { value },
    );
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ExtractorNormalizationError("A textual decimal is outside the finite range", {
      value,
    });
  }
  if (Number.isInteger(parsed) && !Number.isSafeInteger(parsed)) {
    throw new ExtractorNormalizationError(
      "A textual integral fact is outside the exact IEEE-754 range",
      { value },
    );
  }
  return Object.is(parsed, -0) ? 0 : parsed;
}

/** Validates a calendar date without timezone or rollover coercion. */
export function normalizeIsoDate(value: string): string {
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) {
    throw new ExtractorNormalizationError("A date must use YYYY-MM-DD", { value });
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isCalendarDate(year, month, day)) {
    throw new ExtractorNormalizationError("The calendar date does not exist", { value });
  }
  return value;
}

/** Converts an ISO date-time with an explicit timezone to canonical UTC milliseconds. */
export function normalizeUtcDateTime(value: string): string {
  const match = ISO_DATE_TIME_PATTERN.exec(value);
  if (match === null) {
    throw new ExtractorNormalizationError("A date-time must use strict ISO syntax and timezone", {
      value,
    });
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const timezone = match[7] ?? "";
  const offsetMatch = /^([+-])(\d{2}):(\d{2})$/u.exec(timezone);
  if (
    !isCalendarDate(year, month, day) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    (offsetMatch !== null && (Number(offsetMatch[2]) > 23 || Number(offsetMatch[3]) > 59))
  ) {
    throw new ExtractorNormalizationError("The date-time is invalid", { value });
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new ExtractorNormalizationError("The date-time is invalid", { value });
  }
  return new Date(timestamp).toISOString();
}
