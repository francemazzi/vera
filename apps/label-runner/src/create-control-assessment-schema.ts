import { z } from "zod";
import { ClaimAssessmentSchema } from "./claim-assessment-schema.js";

/** Builds the strict model contract or the tolerant reader for legacy callbacks. */
export function createControlAssessmentSchema(isStrict: boolean) {
  const observation = z.enum(["OBSERVED", "ABSENT", "ILLEGIBLE", "NOT_LOCALIZED"]);
  const citationChunkIds = z.array(z.string().min(1).max(300)).max(24);
  const actions = z
    .array(
      z.strictObject({
        kind: z.enum(["ADD", "REPLACE", "REMOVE", "REQUEST_DATA", "RESEARCH"]),
        location: z.string().trim().min(1).max(500),
        language: z.string().min(2).max(35).optional(),
        text: z.string().trim().min(1).max(4_000),
        condition: z.string().min(1).max(1_000).optional(),
        citationChunkIds: isStrict ? citationChunkIds : citationChunkIds.catch([]),
      }),
    )
    .max(12);

  return z
    .strictObject({
      applicability: z.enum(["APPLICABLE", "FACTUALLY_NOT_APPLICABLE", "EXEMPT", "UNRESOLVED"]),
      conditions: z.string().min(1).max(2_000).optional(),
      observation: isStrict ? observation : observation.catch("NOT_LOCALIZED"),
      blocker: z
        .strictObject({
          owner: z.enum(["INTERNAL", "CLIENT"]),
          code: z.enum([
            "SOURCE_MISSING",
            "ADOPTION_UNCONFIRMED",
            "PRODUCT_DATA_MISSING",
            "SCALE_UNVERIFIED",
            "UNIMPLEMENTED_CATEGORY",
            "ILLEGIBLE",
          ]),
          detail: z.string().trim().min(1).max(2_000),
        })
        .optional(),
      claims: z.array(ClaimAssessmentSchema).max(30).optional(),
      actions: isStrict ? actions : actions.catch([]),
    })
    .superRefine((value, context) => {
      if (
        value.blocker?.owner === "CLIENT" &&
        value.blocker.code !== "PRODUCT_DATA_MISSING" &&
        value.blocker.code !== "ILLEGIBLE" &&
        value.blocker.code !== "SCALE_UNVERIFIED"
      ) {
        context.addIssue({
          code: "custom",
          message: "Legal research must remain an internal task",
        });
      }
    });
}
