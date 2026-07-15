import { z } from "zod";

export const UtcDateTimeSchema = z.iso
  .datetime({ local: false, offset: false })
  .refine((value) => value.endsWith("Z"), { message: "Date-time must use UTC (Z)" });

export type UtcDateTime = z.infer<typeof UtcDateTimeSchema>;

export type UtcDateTimeComparison = -1 | 0 | 1;

interface UtcDateTimeParts {
  readonly wholeSecond: string;
  readonly fractionalSecond: string;
}

function utcDateTimeParts(value: UtcDateTime): UtcDateTimeParts {
  const withoutZulu = value.slice(0, -1);
  const fractionalSeparator = withoutZulu.indexOf(".");
  const timeWithoutFraction =
    fractionalSeparator === -1 ? withoutZulu : withoutZulu.slice(0, fractionalSeparator);
  const fractionalSecond =
    fractionalSeparator === -1
      ? ""
      : withoutZulu.slice(fractionalSeparator + 1).replace(/0+$/u, "");

  return {
    wholeSecond:
      timeWithoutFraction.length === "YYYY-MM-DDTHH:mm".length
        ? `${timeWithoutFraction}:00`
        : timeWithoutFraction,
    fractionalSecond,
  };
}

function compareValidUtcDateTimes(left: UtcDateTime, right: UtcDateTime): UtcDateTimeComparison {
  const leftParts = utcDateTimeParts(left);
  const rightParts = utcDateTimeParts(right);

  if (leftParts.wholeSecond < rightParts.wholeSecond) return -1;
  if (leftParts.wholeSecond > rightParts.wholeSecond) return 1;

  const fractionLength = Math.max(
    leftParts.fractionalSecond.length,
    rightParts.fractionalSecond.length,
  );
  const leftFraction = leftParts.fractionalSecond.padEnd(fractionLength, "0");
  const rightFraction = rightParts.fractionalSecond.padEnd(fractionLength, "0");
  if (leftFraction < rightFraction) return -1;
  if (leftFraction > rightFraction) return 1;
  return 0;
}

/** Compares two UTC-Z instants without truncating fractional seconds. */
export function compareUtcDateTimes(left: UtcDateTime, right: UtcDateTime): UtcDateTimeComparison {
  return compareValidUtcDateTimes(UtcDateTimeSchema.parse(left), UtcDateTimeSchema.parse(right));
}

export const ValidityIntervalSchema = z
  .object({
    validFrom: UtcDateTimeSchema,
    validTo: UtcDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine(({ validFrom, validTo }, context) => {
    if (validTo !== null && compareValidUtcDateTimes(validTo, validFrom) <= 0) {
      context.addIssue({
        code: "custom",
        message: "validTo must be later than validFrom",
        path: ["validTo"],
      });
    }
  });

export type ValidityInterval = z.infer<typeof ValidityIntervalSchema>;

/** Returns whether two validated half-open UTC validity intervals share at least one instant. */
export function validityIntervalsOverlap(left: ValidityInterval, right: ValidityInterval): boolean {
  const parsedLeft = ValidityIntervalSchema.parse(left);
  const parsedRight = ValidityIntervalSchema.parse(right);

  return (
    (parsedRight.validTo === null ||
      compareValidUtcDateTimes(parsedLeft.validFrom, parsedRight.validTo) < 0) &&
    (parsedLeft.validTo === null ||
      compareValidUtcDateTimes(parsedRight.validFrom, parsedLeft.validTo) < 0)
  );
}

/** Evaluates the public half-open validity rule: validFrom <= date < validTo. */
export function isWithinValidityInterval(
  interval: ValidityInterval,
  evaluationDate: UtcDateTime,
): boolean {
  const parsedInterval = ValidityIntervalSchema.parse(interval);
  const parsedEvaluationDate = UtcDateTimeSchema.parse(evaluationDate);

  return (
    compareValidUtcDateTimes(parsedEvaluationDate, parsedInterval.validFrom) >= 0 &&
    (parsedInterval.validTo === null ||
      compareValidUtcDateTimes(parsedEvaluationDate, parsedInterval.validTo) < 0)
  );
}
