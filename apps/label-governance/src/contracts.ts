import { sha256CanonicalJson } from "@vera/contracts";
import { z } from "zod";

const Sha256DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const SOURCE_CLASSIFICATION_PROMPT_VERSION = "label-source-classification-v1" as const;
export const SOURCE_CLASSIFICATION_MODEL = "google/gemini-2.5-pro" as const;

const ClassificationEvidenceSchema = z
  .object({
    field: z.string().trim().min(1).max(80),
    pageNumber: z.int().min(1).nullable(),
    quote: z.string().trim().min(1).max(600),
  })
  .strict();

export const SourceClassificationProposalSchema = z
  .object({
    authority: z.string().trim().min(1).max(300),
    legalNature: z.enum(["REGULATION", "DIRECTIVE", "DECISION", "GUIDANCE", "STANDARD", "OTHER"]),
    jurisdiction: z.string().trim().min(1).max(120),
    language: z.string().trim().min(2).max(35),
    actReference: z.string().trim().min(1).max(500).nullable(),
    revisionLabel: z.string().trim().min(1).max(120).nullable(),
    validFrom: z.iso.datetime({ offset: true }).nullable(),
    validTo: z.iso.datetime({ offset: true }).nullable(),
    bindingForce: z.enum(["BINDING", "NON_BINDING", "UNKNOWN"]),
    productCategories: z.array(z.string().trim().min(1).max(120)).max(100),
    labelingTopics: z.array(z.string().trim().min(1).max(120)).max(100),
    possibleSupersedes: z.array(z.string().trim().min(1).max(500)).max(25),
    possibleDuplicates: z.array(z.string().trim().min(1).max(500)).max(25),
    confidence: z.number().min(0).max(1),
    evidence: z.array(ClassificationEvidenceSchema).min(1).max(30),
  })
  .strict()
  .superRefine(({ validFrom, validTo }, context) => {
    if (validFrom !== null && validTo !== null && Date.parse(validTo) <= Date.parse(validFrom)) {
      context.addIssue({
        code: "custom",
        message: "validTo must be after validFrom",
        path: ["validTo"],
      });
    }
  });

export type SourceClassificationProposal = z.infer<typeof SourceClassificationProposalSchema>;

export const SourceClassificationRequestSchema = z
  .object({
    sourceId: z.uuid(),
    sourceVersionId: z.uuid(),
    sourceContentHash: Sha256DigestSchema,
    // Uploaded PDFs may be classified in private staging before an ADMIN
    // supplies a canonical official URL. They remain outside all retrievable
    // RAG collections until the source is expert-verified.
    canonicalUrl: z.url().max(1_000).nullable(),
    sourceTitle: z.string().trim().min(1).max(300),
    sourceText: z.string().trim().min(1).max(500_000),
  })
  .strict();

export type SourceClassificationRequest = z.infer<typeof SourceClassificationRequestSchema>;

const PROVIDER_SCHEMA_CONSTRAINTS = new Set([
  "format",
  "pattern",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
]);

function providerCompatibleSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(providerCompatibleSchema);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PROVIDER_SCHEMA_CONSTRAINTS.has(key))
      .map(([key, nested]) => [key, providerCompatibleSchema(nested)]),
  );
}

export const SOURCE_CLASSIFICATION_JSON_SCHEMA = (() => {
  const schema = SourceClassificationProposalSchema.toJSONSchema({ target: "draft-07" });
  const clone = providerCompatibleSchema(structuredClone(schema)) as Record<string, unknown>;
  delete clone["$schema"];
  return Object.freeze(clone) as Readonly<Record<string, unknown>>;
})();

export const SOURCE_CLASSIFICATION_SCHEMA_HASH = sha256CanonicalJson(
  SOURCE_CLASSIFICATION_JSON_SCHEMA,
);
