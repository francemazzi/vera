import { z } from "zod";

export const UtcDateTimeSchema = z.iso
  .datetime({ local: false, offset: false })
  .refine((value) => value.endsWith("Z"), { message: "Date-time must use UTC (Z)" });

export type UtcDateTime = z.infer<typeof UtcDateTimeSchema>;

export const ValidityIntervalSchema = z
  .object({
    validFrom: UtcDateTimeSchema,
    validTo: UtcDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine(({ validFrom, validTo }, context) => {
    if (validTo !== null && Date.parse(validTo) <= Date.parse(validFrom)) {
      context.addIssue({
        code: "custom",
        message: "validTo must be later than validFrom",
        path: ["validTo"],
      });
    }
  });

export type ValidityInterval = z.infer<typeof ValidityIntervalSchema>;

/** Evaluates the public half-open validity rule: validFrom <= date < validTo. */
export function isWithinValidityInterval(
  interval: ValidityInterval,
  evaluationDate: UtcDateTime,
): boolean {
  const parsedInterval = ValidityIntervalSchema.parse(interval);
  const parsedEvaluationDate = UtcDateTimeSchema.parse(evaluationDate);
  const evaluationTimestamp = Date.parse(parsedEvaluationDate);

  return (
    evaluationTimestamp >= Date.parse(parsedInterval.validFrom) &&
    (parsedInterval.validTo === null || evaluationTimestamp < Date.parse(parsedInterval.validTo))
  );
}
