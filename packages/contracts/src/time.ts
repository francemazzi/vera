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
