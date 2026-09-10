import { ClaimAssessmentSchema } from "./claim-assessment-schema.js";
import { z } from "zod";

/** Versioned decision evidence, distinct from a display status or narrative. */
export const ControlAssessmentSchema = z
  .object({
    applicability: z.enum(["APPLICABLE", "FACTUALLY_NOT_APPLICABLE", "EXEMPT", "UNRESOLVED"]),
    conditions: z.string().min(1).max(2000).optional(),
    observation: z.enum(["OBSERVED", "ABSENT", "ILLEGIBLE", "NOT_LOCALIZED"]),
    blocker: z
      .object({
        owner: z.enum(["INTERNAL", "CLIENT"]),
        code: z.enum([
          "SOURCE_MISSING",
          "ADOPTION_UNCONFIRMED",
          "PRODUCT_DATA_MISSING",
          "SCALE_UNVERIFIED",
          "UNIMPLEMENTED_CATEGORY",
          "ILLEGIBLE",
        ]),
        detail: z.string().min(1).max(2_000),
      })
      .strict()
      .optional(),
    claims: z.array(ClaimAssessmentSchema).max(30).optional(),
    actions: z
      .array(
        z
          .object({
            kind: z.enum(["ADD", "REPLACE", "REMOVE", "REQUEST_DATA", "RESEARCH"]),
            location: z.string().min(1).max(500),
            language: z.string().min(2).max(35).optional(),
            text: z.string().min(1).max(4_000),
            condition: z.string().min(1).max(1_000).optional(),
            citationChunkIds: z.array(z.string().min(1).max(300)).max(24),
          })
          .strict(),
      )
      .max(12),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.blocker?.owner === "CLIENT" &&
      value.blocker.code !== "PRODUCT_DATA_MISSING" &&
      value.blocker.code !== "ILLEGIBLE" &&
      value.blocker.code !== "SCALE_UNVERIFIED"
    ) {
      context.addIssue({ code: "custom", message: "Legal research must remain an internal task" });
    }
  });
