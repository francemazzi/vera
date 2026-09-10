import { z } from "zod";

const resolution = z
  .object({
    markets: z
      .array(
        z
          .object({
            countryCode: z.string().regex(/^[A-Z]{2}$/),
            evidenceText: z.string().min(1).max(300),
            language: z.string().max(12).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    evaluationDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    productCategory: z
      .enum([
        "generic-prepacked",
        "dairy",
        "beverages",
        "coffee",
        "supplements",
        "meat-fish",
        "bakery",
        "confectionery",
      ])
      .optional(),
    reportMetadata: z
      .object({
        clientName: z.string().max(300).optional(),
        brand: z.string().max(300).optional(),
        sampleCode: z.string().max(300).optional(),
      })
      .strict()
      .optional(),
    splitPagesAsSeparateAnalyses: z.boolean().default(false),
    documents: z
      .array(
        z
          .object({
            id: z.uuid(),
            productReference: z.string().min(1).max(300),
            revision: z.string().max(300).optional(),
          })
          .strict(),
      )
      .max(12)
      .default([]),
  })
  .strict();
const result = z.discriminatedUnion("status", [
  z.object({ status: z.literal("RESOLVED"), resolution }).strict(),
  z.object({ status: z.literal("NEEDS_INPUT"), question: z.string().min(1).max(8000) }).strict(),
]);
const input = z.object({
  acquired: z.literal(true),
  analysisId: z.uuid(),
  version: z.number().int(),
  contextRevision: z.number().int(),
  defaultEvaluationDate: z.string(),
  messages: z
    .array(z.object({ role: z.enum(["USER", "ASSISTANT"]), content: z.string().max(8000) }))
    .max(40),
  documents: z
    .array(
      z.object({
        id: z.uuid(),
        fileName: z.string(),
        productReference: z.string().nullable(),
        revision: z.string().nullable(),
      }),
    )
    .max(12),
  countries: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      localizedName: z.string(),
      defaultLanguage: z.string(),
    }),
  ),
});
/** Context tasks never accept legal findings or modifications to regulatory controls. */
export const contextContracts = {
  input,
  result,
  claim: z.union([input, z.object({ acquired: z.literal(false) })]),
};
