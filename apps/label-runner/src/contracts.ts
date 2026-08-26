import { z } from "zod";

export const LABEL_FIELD_CODES = [
  "altezza_cifre_quantita_nominale",
  "altezza_minima_caratteri",
  "atmosfera_protettiva",
  "biologico",
  "bollatura_sanitaria_marchio_identificazione",
  "campo_visivo",
  "condizioni_particolari_conservazione",
  "denominazione_commerciale",
  "denominazione_legale_vendita",
  "denominazioni_dop_igp_stg",
  "elenco_ingredienti",
  "etichettatura_specifica_prodotto",
  "indicazione_allergeni",
  "indicazioni_aggiuntive",
  "indicazioni_ambientali",
  "informazioni_nutrizionali",
  "istruzioni_uso",
  "lotto_partita",
  "origine_ingrediente_primario",
  "paese_origine",
  "produttore_distributore_indirizzo",
  "quantita_netto_volume_nominale",
  "sede_stabilimento_produzione_confezionamento",
  "termine_minimo_conservazione_data_scadenza",
] as const;

export const LABEL_OUTCOMES = ["PASS", "FAIL", "REVIEW", "NOT_APPLICABLE"] as const;

export const PRELIMINARY_INDICATORS = [
  "COVERAGE_DETECTED",
  "POSSIBLE_ISSUE",
  "REVIEW_REQUIRED",
  "NOT_APPLICABLE",
] as const;

export const LabelTaskSchema = z.object({ analysisId: z.uuid() }).strict();
export type LabelTask = z.infer<typeof LabelTaskSchema>;

export const RegulatoryScopeSchema = z
  .object({
    countryCode: z.string().regex(/^[A-Z]{2}$/u),
    /** EU is added only for a market country that belongs to the Union. */
    regulatoryAreas: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
    jurisdictions: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
    language: z.string().trim().min(2).max(35),
    evaluationDate: z.iso.datetime({ offset: true }),
  })
  .strict();
export type RegulatoryScope = z.infer<typeof RegulatoryScopeSchema>;

const PreliminaryTemplateIdSchema = z.enum([
  "eu-it-preliminary-v1",
  "global-food-label-preliminary-v1",
]);
const PreliminaryPromptVersionSchema = z.enum([
  "label-preliminary-eu-it-v1",
  "label-preliminary-rag-v1",
  "label-evaluation-v1",
  "label-evaluation-v2",
]);

const PreliminaryCitationSchema = z
  .object({
    id: z.enum(["eu-1169", "eu-lot-2011-91", "it-231-2017"]),
    label: z.string().min(1).max(240),
    url: z.url().max(2_000),
    reference: z.string().min(1).max(500),
  })
  .strict();

const PreliminaryTemplateControlSchema = z
  .object({
    fieldCode: z.enum(LABEL_FIELD_CODES),
    instruction: z.string().min(1).max(1_000),
    /** Legacy static citations are retained only to read historical IT runs. */
    citationIds: z.array(PreliminaryCitationSchema.shape.id).max(3).default([]),
    /** Retrieval topics are part of the immutable template, not model output. */
    topics: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
    sectorSpecific: z.literal(true).optional(),
  })
  .strict();

const PreliminarySourceArchiveSchema = z
  .object({
    id: PreliminaryCitationSchema.shape.id,
    url: z.url().max(2_000),
    mediaType: z.literal("text/html"),
  })
  .strict();

export const PreliminaryTemplateSchema = z
  .object({
    id: PreliminaryTemplateIdSchema,
    version: z.enum(["1", "2"]),
    promptVersion: PreliminaryPromptVersionSchema,
    sourceSnapshot: z.string().regex(/^[0-9a-f]{64}$/u),
    /** Historical metadata only; live source citations are supplied by Chroma. */
    citations: z.array(PreliminaryCitationSchema).max(3).default([]),
    sourceArchives: z.array(PreliminarySourceArchiveSchema).max(3).default([]),
    controls: z.array(PreliminaryTemplateControlSchema).length(LABEL_FIELD_CODES.length),
  })
  .strict()
  .superRefine((value, context) => {
    const codes = new Set(value.controls.map((control) => control.fieldCode));
    if (codes.size !== LABEL_FIELD_CODES.length) {
      context.addIssue({
        code: "custom",
        message: "The preliminary template must contain every field code exactly once",
      });
    }
    const archiveIds = new Set(value.sourceArchives.map((source) => source.id));
    if (value.sourceArchives.length > 0 && archiveIds.size !== value.citations.length) {
      context.addIssue({
        code: "custom",
        message: "Each preliminary citation must have one immutable source archive",
      });
    }
  });
export type PreliminaryTemplate = z.infer<typeof PreliminaryTemplateSchema>;

// This service has no formal-evaluation path. A formal payload cannot pass
// the discriminator and is rejected before any page is loaded or model used.
export const RunnerInputSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    countryCodes: z
      .array(z.string().regex(/^[A-Z]{2}$/u))
      .min(1)
      .max(1),
    inputSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    normalizedPageObjectKey: z
      .string()
      .regex(/^label-analyses\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/page-1\.png$/u),
    normalizedPages: z
      .array(
        z
          .object({
            page: z.int().min(1).max(100),
            objectKey: z
              .string()
              .regex(/^label-analyses\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/page-\d+\.png$/u),
            sha256: z.string().regex(/^[0-9a-f]{64}$/u),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .superRefine((pages, context) => {
        pages.forEach((entry, index) => {
          if (entry.page !== index + 1) {
            context.addIssue({
              code: "custom",
              message: "Normalized pages must be sorted and contiguous",
              path: [index, "page"],
            });
          }
        });
      }),
    status: z.enum(["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"]),
    version: z.int().nonnegative(),
    assessmentMode: z.enum(["PRELIMINARY", "APPROVED"]),
    productCategory: z.string().trim().min(1).max(120),
    regulatoryScope: RegulatoryScopeSchema.optional(),
    preliminaryTemplate: PreliminaryTemplateSchema,
    goldExamples: z
      .array(
        z
          .object({
            fieldCode: z.enum(LABEL_FIELD_CODES),
            goldOutcome: z.enum(LABEL_OUTCOMES),
            rationale: z.string().trim().min(1).max(500),
            countryCode: z.string().regex(/^[A-Z]{2}$/u),
            productCategory: z.string().trim().min(1).max(120),
          })
          .strict(),
      )
      .max(3)
      .default([]),
  })
  .strict();
export type RunnerInput = z.infer<typeof RunnerInputSchema>;

/** A source supplied by private Chroma retrieval, never by the browser or model. */
export const RunnerSourceCitationSchema = z
  .object({
    chunkId: z.string().trim().min(1).max(300),
    sourceVersionId: z.uuid(),
    sourceContentHash: z.string().regex(/^[0-9a-f]{64}$/u),
    title: z.string().trim().min(1).max(300),
    documentType: z.string().trim().min(1).max(120),
    actReference: z.string().trim().min(1).max(500).nullable(),
    canonicalReference: z.string().trim().min(1).max(2_000).nullable(),
    pdfReference: z.url().max(2_000).nullable(),
    sectionId: z.string().trim().min(1).max(500),
    sectionTitle: z.string().trim().min(1).max(300),
    pageNumber: z.int().min(1).nullable(),
    quote: z.string().trim().min(1).max(1_000),
  })
  .strict();
export type RunnerSourceCitation = z.infer<typeof RunnerSourceCitationSchema>;

/**
 * Immutable retrieval manifest persisted with a global analysis callback.
 * It records the complete evidence set frozen before the model invocation;
 * evaluation controls may cite a strict subset of these chunks.
 */
export const RunnerSourceManifestControlSchema = z
  .object({
    fieldCode: z.enum(LABEL_FIELD_CODES),
    citations: z.array(RunnerSourceCitationSchema).max(3),
  })
  .strict();

export const RunnerSourceManifestSchema = z
  .object({
    controls: z.array(RunnerSourceManifestControlSchema).length(LABEL_FIELD_CODES.length),
  })
  .strict()
  .superRefine((value, context) => {
    const codes = new Set(value.controls.map((control) => control.fieldCode));
    if (codes.size !== LABEL_FIELD_CODES.length) {
      context.addIssue({
        code: "custom",
        message: "The source manifest must retain every template field code exactly once",
        path: ["controls"],
      });
    }
  });
export type RunnerSourceManifest = z.infer<typeof RunnerSourceManifestSchema>;

/**
 * Region of the normalized page the assessment looked at, in the model's
 * normalized 0-1000 space so it stays independent of the page pixel size.
 * Absent when the element is not on the label: in a verification report the
 * missing zoom is itself the finding, and an invented region would be
 * misleading evidence.
 */
export const RunnerBoundingBoxSchema = z
  .object({
    page: z.int().min(1).max(100),
    ymin: z.int().min(0).max(1_000),
    xmin: z.int().min(0).max(1_000),
    ymax: z.int().min(0).max(1_000),
    xmax: z.int().min(0).max(1_000),
  })
  .strict()
  .refine((box) => box.ymin < box.ymax && box.xmin < box.xmax, {
    message: "A bounding box must have a positive area",
  });
export type RunnerBoundingBox = z.infer<typeof RunnerBoundingBoxSchema>;

export const EvaluationRunnerControlSchema = z
  .object({
    fieldCode: z.enum(LABEL_FIELD_CODES),
    outcome: z.enum(LABEL_OUTCOMES),
    rationale: z.string().min(1).max(8_000),
    correctiveSuggestion: z.string().min(1).max(500).optional(),
    confidence: z.number().min(0).max(1),
    citations: z.array(RunnerSourceCitationSchema).max(3).default([]),
    boundingBox: RunnerBoundingBoxSchema.optional(),
  })
  .strict();

export const PreliminaryRunnerControlSchema = z
  .object({
    fieldCode: z.enum(LABEL_FIELD_CODES),
    indicator: z.enum(PRELIMINARY_INDICATORS),
    rationale: z.string().min(1).max(8_000),
    confidence: z.number().min(0).max(1),
    citations: z.array(RunnerSourceCitationSchema).max(3).default([]),
    boundingBox: RunnerBoundingBoxSchema.optional(),
  })
  .strict();

export const RunnerEvaluationSchema = z
  .object({
    provider: z.literal("openrouter"),
    model: z.literal("google/gemini-2.5-flash"),
    promptVersion: PreliminaryPromptVersionSchema,
    rulePackVersion: z.enum([
      "eu-it-preliminary-v1@1",
      "eu-it-preliminary-v1@2",
      "global-food-label-preliminary-v1@1",
      "global-food-label-preliminary-v1@2",
    ]),
    sourceSnapshot: z.string().regex(/^[0-9a-f]{64}$/u),
    /** Required by the backend for global RAG runs; absent for legacy IT history. */
    sourceManifest: RunnerSourceManifestSchema.optional(),
    usage: z
      .object({
        inputTokens: z.int().nonnegative().nullable(),
        outputTokens: z.int().nonnegative().nullable(),
        totalTokens: z.int().nonnegative().nullable(),
        estimatedCostUsd: z.number().nonnegative().nullable(),
        latencyMs: z.int().nonnegative().max(600_000),
      })
      .strict(),
    controls: z.array(EvaluationRunnerControlSchema).length(LABEL_FIELD_CODES.length),
  })
  .strict()
  .superRefine((value, context) => {
    const codes = new Set(value.controls.map((control) => control.fieldCode));
    if (codes.size !== LABEL_FIELD_CODES.length) {
      context.addIssue({
        code: "custom",
        message: "Each required field code must be evaluated once",
      });
    }
  });
export type RunnerEvaluation = z.infer<typeof RunnerEvaluationSchema>;

export const ClaimResponseSchema = z
  .object({
    status: z.literal("success"),
    data: z.object({ version: z.int().nonnegative() }).loose(),
    meta: z.object({ acquired: z.boolean(), replayed: z.boolean() }).strict(),
  })
  .strict();
