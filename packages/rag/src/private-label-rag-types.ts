import { UtcDateTimeSchema } from "@vera/contracts";
import { z } from "zod";

const Sha256DigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Expected a lowercase SHA-256 digest");

const NonEmptyTextSchema = z.string().trim().min(1).max(8_000);
const SourceReferenceSchema = z.string().trim().min(1).max(1_000);
const ProductCategorySchema = z.string().trim().min(1).max(120);

/**
 * The informative collection is deliberately restricted to sources that a
 * human expert has verified.  Discovery proposals and unverified sources
 * must never be embedded into a collection that a label analysis can query.
 */
export const PRIVATE_LABEL_VERIFIED_COLLECTION = "silto-label-verified-v1" as const;
/** @deprecated Use PRIVATE_LABEL_VERIFIED_COLLECTION. Kept as an API alias. */
export const PRIVATE_LABEL_PRELIMINARY_COLLECTION = PRIVATE_LABEL_VERIFIED_COLLECTION;
export const PRIVATE_LABEL_APPROVED_COLLECTION = "silto-label-approved-v1" as const;
export const PRIVATE_LABEL_RAG_EMBEDDING_DIMENSIONS = 1_536 as const;

export const PrivateLabelRagSourceStateSchema = z.enum([
  "VERIFIED",
  "APPROVED",
]);

export type PrivateLabelRagSourceState = z.infer<typeof PrivateLabelRagSourceStateSchema>;

/**
 * The temporal range is handled separately from governance state. A
 * classifier may propose it for the informative path, but only an ADMIN-
 * confirmed range may enter the formal collection.
 */
export const PrivateLabelRagValidityStatusSchema = z.enum([
  "ADMIN_DECLARED",
  "ADMIN_CONFIRMED",
  "AI_PROPOSED",
  "UNKNOWN",
]);

export type PrivateLabelRagValidityStatus = z.infer<typeof PrivateLabelRagValidityStatusSchema>;

export const PrivateLabelRagScopeSchema = z.enum(["PRELIMINARY", "APPROVED"]);

export type PrivateLabelRagScope = z.infer<typeof PrivateLabelRagScopeSchema>;

/**
 * Chroma is shared infrastructure, never a shared tenant corpus.  A source
 * belongs to the workspace that admitted it, except for the explicitly
 * curated Food Consulting catalogue represented by the GLOBAL sentinel.
 */
export const PRIVATE_LABEL_SHARED_CATALOG_WORKSPACE_SCOPE = "GLOBAL" as const;
export const PrivateLabelRagWorkspaceScopeSchema = z.union([
  z.uuid(),
  z.literal(PRIVATE_LABEL_SHARED_CATALOG_WORKSPACE_SCOPE),
]);
export type PrivateLabelRagWorkspaceScope = z.infer<typeof PrivateLabelRagWorkspaceScopeSchema>;

export const PrivateLabelRagSectionSchema = z
  .object({
    sourceId: z.uuid(),
    sourceVersionId: z.uuid(),
    workspaceScope: PrivateLabelRagWorkspaceScopeSchema,
    sourceState: PrivateLabelRagSourceStateSchema,
    validityStatus: PrivateLabelRagValidityStatusSchema,
    sourceContentHash: Sha256DigestSchema,
    title: z.string().trim().min(1).max(300),
    jurisdiction: z.string().trim().min(1).max(120),
    language: z.string().trim().min(2).max(35),
    documentType: z.string().trim().min(1).max(120),
    actReference: z.string().trim().min(1).max(500).nullable(),
    canonicalReference: SourceReferenceSchema.nullable(),
    pdfReference: z.url().max(2_000).nullable(),
    revisionLabel: z.string().trim().min(1).max(120),
    validity: z
      .object({
        validFrom: UtcDateTimeSchema,
        validTo: UtcDateTimeSchema.nullable(),
      })
      .strict()
      .refine(
        ({ validFrom, validTo }) => validTo === null || Date.parse(validTo) > Date.parse(validFrom),
        {
          message: "validTo must be after validFrom",
          path: ["validTo"],
        },
      ),
    productCategories: z.array(ProductCategorySchema).max(100),
    /** Template-facing legal topics used as an additional retrieval boundary. */
    labelingTopics: z.array(ProductCategorySchema).max(100).optional(),
    sectionId: z.string().trim().min(1).max(500),
    sectionTitle: z.string().trim().min(1).max(300),
    pageNumber: z.int().min(1).nullable(),
    text: z.string().trim().min(1).max(100_000),
  })
  .strict();

export type PrivateLabelRagSection = z.infer<typeof PrivateLabelRagSectionSchema>;

export const PrivateLabelRagChunkSchema = z
  .object({
    chunkId: z.string().trim().min(1).max(300),
    sourceId: z.uuid(),
    sourceVersionId: z.uuid(),
    workspaceScope: PrivateLabelRagWorkspaceScopeSchema,
    sourceState: PrivateLabelRagSourceStateSchema,
    validityStatus: PrivateLabelRagValidityStatusSchema,
    sourceContentHash: Sha256DigestSchema,
    title: z.string().trim().min(1).max(300),
    jurisdiction: z.string().trim().min(1).max(120),
    language: z.string().trim().min(2).max(35),
    documentType: z.string().trim().min(1).max(120),
    actReference: z.string().trim().min(1).max(500).nullable(),
    canonicalReference: SourceReferenceSchema.nullable(),
    pdfReference: z.url().max(2_000).nullable(),
    revisionLabel: z.string().trim().min(1).max(120),
    validity: z
      .object({
        validFrom: UtcDateTimeSchema,
        validTo: UtcDateTimeSchema.nullable(),
      })
      .strict(),
    productCategories: z.array(ProductCategorySchema).max(100),
    labelingTopics: z.array(ProductCategorySchema).max(100).optional(),
    sectionId: z.string().trim().min(1).max(500),
    sectionTitle: z.string().trim().min(1).max(300),
    pageNumber: z.int().min(1).nullable(),
    chunkOrdinal: z.int().min(0),
    text: NonEmptyTextSchema,
    contentHash: Sha256DigestSchema,
  })
  .strict();

export type PrivateLabelRagChunk = z.infer<typeof PrivateLabelRagChunkSchema>;

export const PrivateLabelRagQuerySchema = z
  .object({
    queryText: z.string().trim().min(1).max(5_000),
    /** Caller workspace; mandatory so records without scope stay invisible. */
    workspaceId: z.uuid(),
    /** Legacy single-jurisdiction input; normalized into jurisdictions. */
    jurisdiction: z.string().trim().min(1).max(120).optional(),
    /**
     * A market can be governed by a supranational layer plus its national
     * layer, for example [EU, IT].  They are retrieved together but remain
     * individually visible in each citation.
     */
    jurisdictions: z.array(z.string().trim().min(1).max(120)).min(1).max(8).optional(),
    evaluationDate: UtcDateTimeSchema,
    language: z.string().trim().min(2).max(35).optional(),
    productCategory: ProductCategorySchema.optional(),
    /** Any matching required topic is relevant to a template control. */
    labelingTopics: z.array(ProductCategorySchema).min(1).max(12).optional(),
    topK: z.int().min(1).max(20).default(5),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.jurisdiction && (!value.jurisdictions || value.jurisdictions.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "At least one jurisdiction is required",
        path: ["jurisdictions"],
      });
    }
  })
  .transform((value) => ({
    ...value,
    jurisdictions: [...new Set(value.jurisdictions ?? [value.jurisdiction!])],
  }));

export type PrivateLabelRagQuery = z.input<typeof PrivateLabelRagQuerySchema>;
export type ParsedPrivateLabelRagQuery = z.output<typeof PrivateLabelRagQuerySchema>;

export const PrivateLabelRagCitationSchema = z
  .object({
    chunkId: z.string().trim().min(1).max(300),
    sourceVersionId: z.uuid(),
    sourceContentHash: Sha256DigestSchema,
    title: z.string().trim().min(1).max(300),
    documentType: z.string().trim().min(1).max(120),
    actReference: z.string().trim().min(1).max(500).nullable(),
    canonicalReference: SourceReferenceSchema.nullable(),
    pdfReference: z.url().max(2_000).nullable(),
    sectionId: z.string().trim().min(1).max(500),
    sectionTitle: z.string().trim().min(1).max(300),
    pageNumber: z.int().min(1).nullable(),
    quote: z.string().trim().min(1).max(1_000),
  })
  .strict();

export type PrivateLabelRagCitation = z.infer<typeof PrivateLabelRagCitationSchema>;

export const PrivateLabelRagRetrievedChunkSchema = PrivateLabelRagChunkSchema.extend({
  score: z.number().min(-1).max(1),
  citation: PrivateLabelRagCitationSchema,
}).strict();

export type PrivateLabelRagRetrievedChunk = z.infer<typeof PrivateLabelRagRetrievedChunkSchema>;

export type PrivateLabelRagSafeRetrievalResult =
  | {
      readonly status: "AVAILABLE";
      readonly scope: PrivateLabelRagScope;
      readonly requiresReview: boolean;
      readonly chunks: readonly PrivateLabelRagRetrievedChunk[];
    }
  | {
      readonly status: "UNAVAILABLE";
      readonly scope: PrivateLabelRagScope;
      readonly requiresReview: true;
      readonly reason: string;
    };
