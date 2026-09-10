import { z } from "zod";

/** Observed facts stay separate from legal conclusions and documentary assumptions. */
export const ProductFactsSchema = z
  .object({
    products: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(120),
            name: z.string().trim().min(1).max(300),
            category: z.enum([
              "generic-prepacked",
              "dairy",
              "beverages",
              "coffee",
              "supplements",
              "meat-fish",
              "bakery",
              "confectionery",
            ]),
            pages: z.array(z.int().min(1).max(100)).min(1).max(100),
            unitOfSale: z.string().max(1_000).optional(),
            facts: z
              .array(
                z
                  .object({
                    field: z.string().min(1).max(120),
                    text: z.string().min(1).max(4_000),
                    language: z.string().min(2).max(35).optional(),
                    status: z.enum(["OBSERVED", "ABSENT", "ILLEGIBLE", "NOT_LOCALIZED"]),
                    evidence: z
                      .array(
                        z
                          .object({
                            page: z.int().min(1).max(100),
                            documentId: z.uuid().optional(),
                            ymin: z.int().min(0).max(1_000),
                            xmin: z.int().min(0).max(1_000),
                            ymax: z.int().min(0).max(1_000),
                            xmax: z.int().min(0).max(1_000),
                          })
                          .strict()
                          .refine((box) => box.ymin < box.ymax && box.xmin < box.xmax),
                      )
                      .max(12),
                  })
                  .strict(),
              )
              .min(1)
              .max(100),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.products.map((product) => product.id)).size !== value.products.length) {
      context.addIssue({ code: "custom", message: "Product IDs must be unique" });
    }
    for (const product of value.products)
      for (const fact of product.facts) {
        if (fact.evidence.some((box) => !box.documentId && !product.pages.includes(box.page)))
          context.addIssue({
            code: "custom",
            message: "Evidence must belong to the product pages",
          });
        if (fact.status === "ABSENT" && fact.evidence.length)
          context.addIssue({
            code: "custom",
            message: "An absent element cannot have an invented region",
          });
      }
  });
