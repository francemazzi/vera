import { z } from "zod";

import {
  ComplianceSourceStateSchema,
  ComplianceSourceTypeSchema,
  DeonticCategorySchema,
  RiskLevelSchema,
  UtcDateTimeSchema,
  ValidationScopeSchema,
  ValidityIntervalSchema,
} from "@vera/contracts";

const Sha256DigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Expected a lowercase SHA-256 digest");

const StableKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z][A-Za-z0-9._-]*$/u, "Expected a stable structured key");

const NonEmptyTextSchema = z.string().trim().min(1).max(4000);
const SourceReferenceSchema = z.string().trim().min(1).max(500);

export const RagProviderModelSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    digest: Sha256DigestSchema,
    runtimeVersion: z.string().trim().min(1).max(80),
  })
  .strict();

export type RagProviderModel = z.infer<typeof RagProviderModelSchema>;

export const RagSourceSectionSchema = z
  .object({
    sourceId: z.uuid(),
    sourceVersionId: z.uuid(),
    sourceType: ComplianceSourceTypeSchema,
    sourceState: ComplianceSourceStateSchema,
    domain: z.string().trim().min(1).max(120),
    jurisdiction: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(300),
    stableReference: z.string().trim().min(1).max(500),
    versionLabel: z.string().trim().min(1).max(100),
    license: z.string().trim().min(1).max(200),
    sourceContentHash: Sha256DigestSchema,
    validity: ValidityIntervalSchema,
    sectionId: SourceReferenceSchema,
    sectionTitle: z.string().trim().min(1).max(300),
    text: z.string().trim().min(1).max(100_000),
    validationScope: ValidationScopeSchema,
  })
  .strict();

export type RagSourceSection = z.infer<typeof RagSourceSectionSchema>;

export const RagChunkSchema = z
  .object({
    chunkId: z.string().trim().min(1).max(300),
    sourceId: z.uuid(),
    sourceVersionId: z.uuid(),
    sourceType: ComplianceSourceTypeSchema,
    sourceState: z.literal("APPROVED"),
    domain: z.string().trim().min(1).max(120),
    jurisdiction: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(300),
    stableReference: z.string().trim().min(1).max(500),
    versionLabel: z.string().trim().min(1).max(100),
    license: z.string().trim().min(1).max(200),
    sourceContentHash: Sha256DigestSchema,
    validity: ValidityIntervalSchema,
    sectionId: SourceReferenceSchema,
    sectionTitle: z.string().trim().min(1).max(300),
    chunkOrdinal: z.int().min(0),
    text: z.string().trim().min(1).max(8000),
    contentHash: Sha256DigestSchema,
    validationScope: ValidationScopeSchema,
  })
  .strict();

export type RagChunk = z.infer<typeof RagChunkSchema>;

export const RagCitationSchema = z
  .object({
    chunkId: z.string().trim().min(1).max(300),
    sourceId: z.uuid(),
    sourceVersionId: z.uuid(),
    sourceContentHash: Sha256DigestSchema,
    sectionId: SourceReferenceSchema,
    sectionTitle: z.string().trim().min(1).max(300),
    chunkOrdinal: z.int().min(0),
    quote: z.string().trim().min(1).max(1000),
    domain: z.string().trim().min(1).max(120),
    jurisdiction: z.string().trim().min(1).max(120),
    validity: ValidityIntervalSchema,
  })
  .strict();

export type RagCitation = z.infer<typeof RagCitationSchema>;

export const RagRetrievedChunkSchema = RagChunkSchema.extend({
  score: z.number().min(-1).max(1),
  citation: RagCitationSchema,
}).strict();

export type RagRetrievedChunk = z.infer<typeof RagRetrievedChunkSchema>;

export const RagRetrievalQuerySchema = z
  .object({
    queryText: z.string().trim().min(1).max(5000),
    domain: z.string().trim().min(1).max(120),
    jurisdiction: z.string().trim().min(1).max(120),
    evaluationDate: UtcDateTimeSchema,
    topK: z.int().min(1).max(20).default(5),
  })
  .strict();

export type RagRetrievalQuery = z.input<typeof RagRetrievalQuerySchema>;
export type ParsedRagRetrievalQuery = z.output<typeof RagRetrievalQuerySchema>;

export const RagUnavailableResultSchema = z
  .object({
    status: z.literal("UNAVAILABLE"),
    requiresReview: z.literal(true),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

export type RagUnavailableResult = z.infer<typeof RagUnavailableResultSchema>;

export const RagAvailableResultSchema = z
  .object({
    status: z.literal("AVAILABLE"),
    chunks: z.array(RagRetrievedChunkSchema).max(20),
  })
  .strict();

export type RagAvailableResult = z.infer<typeof RagAvailableResultSchema>;

export type RagSafeRetrievalResult = RagAvailableResult | RagUnavailableResult;

export const DraftCitationReferenceSchema = z
  .object({
    chunkId: z.string().trim().min(1).max(300),
    quote: z.string().trim().min(1).max(1000),
  })
  .strict();

export type DraftCitationReference = z.infer<typeof DraftCitationReferenceSchema>;

export const DraftRuleCardEvidenceRequirementSchema = z
  .object({
    key: StableKeySchema,
    description: NonEmptyTextSchema,
    rationale: NonEmptyTextSchema,
    citationChunkIds: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
  })
  .strict();

export type DraftRuleCardEvidenceRequirement = z.infer<
  typeof DraftRuleCardEvidenceRequirementSchema
>;

export const DraftRuleCardExceptionSchema = z
  .object({
    key: StableKeySchema,
    description: NonEmptyTextSchema,
    rationale: NonEmptyTextSchema,
    citationChunkIds: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
  })
  .strict();

export type DraftRuleCardException = z.infer<typeof DraftRuleCardExceptionSchema>;

export const RuleCardDraftSuggestionSchema = z
  .object({
    targetState: z.literal("DRAFT"),
    validationScope: ValidationScopeSchema,
    provenance: z.literal("AI_ASSISTED"),
    sourceId: z.uuid(),
    sourceVersionId: z.uuid(),
    sourceSection: SourceReferenceSchema,
    normativeActor: z.string().trim().min(1).max(300),
    object: z.string().trim().min(1).max(500),
    scope: z.string().trim().min(1).max(1000),
    normativeKey: StableKeySchema,
    deonticCategory: DeonticCategorySchema,
    riskLevel: RiskLevelSchema,
    riskRationale: NonEmptyTextSchema,
    evidenceRequirements: z.array(DraftRuleCardEvidenceRequirementSchema).min(1).max(25),
    exceptions: z.array(DraftRuleCardExceptionSchema).max(25),
    citations: z.array(DraftCitationReferenceSchema).min(1).max(20),
  })
  .strict();

export type RuleCardDraftSuggestion = z.infer<typeof RuleCardDraftSuggestionSchema>;

export const RuleCardDraftGenerationLogSchema = z
  .object({
    prompt: z.string().min(1).max(30_000),
    promptHash: Sha256DigestSchema,
    rawOutput: z.string().min(1).max(200_000),
    attempts: z.int().min(1).max(10),
    generatedAt: UtcDateTimeSchema,
    provider: RagProviderModelSchema,
    citations: z.array(RagCitationSchema).min(1).max(20),
  })
  .strict();

export type RuleCardDraftGenerationLog = z.infer<typeof RuleCardDraftGenerationLogSchema>;

export const RuleCardDraftGenerationResultSchema = z
  .object({
    draft: RuleCardDraftSuggestionSchema,
    log: RuleCardDraftGenerationLogSchema,
    requiresHumanConfirmation: z.literal(true),
  })
  .strict();

export type RuleCardDraftGenerationResult = z.infer<typeof RuleCardDraftGenerationResultSchema>;

export const RuleCardWorkflowAdvancementRequestSchema = z
  .object({
    draftTargetState: z.literal("DRAFT"),
    requestedNextState: z.literal("IN_REVIEW"),
    requiresHumanConfirmation: z.literal(true),
    rationaleRequired: z.literal(true),
    draft: RuleCardDraftSuggestionSchema,
  })
  .strict();

export type RuleCardWorkflowAdvancementRequest = z.infer<
  typeof RuleCardWorkflowAdvancementRequestSchema
>;
