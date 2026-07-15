import { z } from "zod";

import { sha256CanonicalJson } from "./hash.js";
import { UtcDateTimeSchema, ValidityIntervalSchema } from "./time.js";
import {
  ActorRoleSchema,
  DeonticCategorySchema,
  RiskLevelSchema,
  RuleCardStateSchema,
  ValidationScopeSchema,
  type ActorRole,
  type RuleCardState,
} from "./vocabulary.js";

const Sha256DigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Expected a lowercase SHA-256 digest");

const NonEmptyTextSchema = z.string().trim().min(1).max(2000);
const SourceReferenceSchema = z.string().trim().min(1).max(500);
const StructuredKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z][A-Za-z0-9._-]*$/u, "Expected a stable structured key");

export const RuleCardSchema = z
  .object({
    id: z.uuid(),
    sourceId: z.uuid(),
    sourceVersionId: z.uuid(),
    sourceSection: SourceReferenceSchema,
    validationScope: ValidationScopeSchema,
  })
  .strict();

export type RuleCard = z.infer<typeof RuleCardSchema>;

export const RuleCardExceptionSchema = z
  .object({
    id: z.uuid(),
    key: StructuredKeySchema,
    description: NonEmptyTextSchema,
    rationale: NonEmptyTextSchema,
    sourceReference: SourceReferenceSchema,
  })
  .strict();

export type RuleCardException = z.infer<typeof RuleCardExceptionSchema>;

export const RuleCardEvidenceRequirementSchema = z
  .object({
    id: z.uuid(),
    key: StructuredKeySchema,
    description: NonEmptyTextSchema,
    rationale: NonEmptyTextSchema,
    sourceReference: SourceReferenceSchema,
  })
  .strict();

export type RuleCardEvidenceRequirement = z.infer<typeof RuleCardEvidenceRequirementSchema>;

function addDuplicateFieldIssues(
  entries: readonly { readonly id: string; readonly key: string }[],
  path: "exceptions" | "evidenceRequirements",
  field: "id" | "key",
  context: z.core.$RefinementCtx,
): void {
  const seen = new Set<string>();

  entries.forEach((entry, index) => {
    const value = entry[field];
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate ${field}: ${value}`,
        path: [path, index, field],
      });
    }

    seen.add(value);
  });
}

export const RuleCardProvenanceSchema = z.enum(["MANUAL", "AI_ASSISTED"]);

export type RuleCardProvenance = z.infer<typeof RuleCardProvenanceSchema>;

const RuleCardRevisionHashInputShape = {
  id: z.uuid(),
  cardId: z.uuid(),
  revision: z.int().min(1),
  sourceId: z.uuid(),
  sourceVersionId: z.uuid(),
  sourceContentHash: Sha256DigestSchema,
  sourceSection: SourceReferenceSchema,
  normativeActor: z.string().trim().min(1).max(300),
  object: z.string().trim().min(1).max(500),
  scope: z.string().trim().min(1).max(1000),
  normativeKey: StructuredKeySchema,
  deonticCategory: DeonticCategorySchema,
  exceptions: z.array(RuleCardExceptionSchema).max(100),
  evidenceRequirements: z.array(RuleCardEvidenceRequirementSchema).min(1).max(100),
  riskLevel: RiskLevelSchema,
  riskRationale: NonEmptyTextSchema,
  falsePositiveCost: RiskLevelSchema,
  falsePositiveCostRationale: NonEmptyTextSchema,
  falseNegativeCost: RiskLevelSchema,
  falseNegativeCostRationale: NonEmptyTextSchema,
  provenance: RuleCardProvenanceSchema,
  provider: z.string().trim().min(1).max(500).nullable(),
  validity: ValidityIntervalSchema,
  createdAt: UtcDateTimeSchema,
  createdBy: z.uuid(),
  replacesRevisionId: z.uuid().nullable(),
  revisionReason: NonEmptyTextSchema.nullable(),
} as const;

const RuleCardRevisionHashInputObjectSchema = z.object(RuleCardRevisionHashInputShape).strict();

type RuleCardRevisionHashInputData = z.infer<typeof RuleCardRevisionHashInputObjectSchema>;

function refineRuleCardRevisionHashInput(
  {
    id,
    revision,
    replacesRevisionId,
    revisionReason,
    provenance,
    provider,
    exceptions,
    evidenceRequirements,
  }: RuleCardRevisionHashInputData,
  context: z.core.$RefinementCtx,
): void {
  if (id === replacesRevisionId) {
    context.addIssue({
      code: "custom",
      message: "A Rule Card revision cannot replace itself",
      path: ["replacesRevisionId"],
    });
  }

  if ((revision === 1) !== (replacesRevisionId === null)) {
    context.addIssue({
      code: "custom",
      message: "Revision 1 must have no predecessor; later revisions must have one",
      path: ["replacesRevisionId"],
    });
  }

  if ((replacesRevisionId === null) !== (revisionReason === null)) {
    context.addIssue({
      code: "custom",
      message: "Replacement revision and reason must be provided together",
      path: [replacesRevisionId === null ? "replacesRevisionId" : "revisionReason"],
    });
  }

  if ((provenance === "AI_ASSISTED") !== (provider !== null)) {
    context.addIssue({
      code: "custom",
      message: "A provider is required only for AI-assisted provenance",
      path: ["provider"],
    });
  }

  addDuplicateFieldIssues(exceptions, "exceptions", "id", context);
  addDuplicateFieldIssues(exceptions, "exceptions", "key", context);
  addDuplicateFieldIssues(evidenceRequirements, "evidenceRequirements", "id", context);
  addDuplicateFieldIssues(evidenceRequirements, "evidenceRequirements", "key", context);
}

export const RuleCardRevisionHashInputSchema = RuleCardRevisionHashInputObjectSchema.superRefine(
  refineRuleCardRevisionHashInput,
);

export type RuleCardRevisionHashInput = z.infer<typeof RuleCardRevisionHashInputSchema>;

/** Hashes the normalized, canonical Rule Card revision snapshot before `contentHash` is attached. */
export function computeRuleCardRevisionHash(input: RuleCardRevisionHashInput): string {
  return sha256CanonicalJson(RuleCardRevisionHashInputSchema.parse(input));
}

const RuleCardRevisionCandidateSchema = z
  .object({ ...RuleCardRevisionHashInputShape, contentHash: Sha256DigestSchema })
  .strict();

/** Verifies a declared revision hash without trusting its insertion or object-key order. */
export function verifyRuleCardRevisionHash(revision: unknown): boolean {
  const parsed = RuleCardRevisionCandidateSchema.safeParse(revision);
  if (!parsed.success) return false;

  const { contentHash, ...hashInput } = parsed.data;
  return contentHash === sha256CanonicalJson(hashInput);
}

export const RuleCardRevisionSchema = RuleCardRevisionCandidateSchema.superRefine(
  (revision, context) => {
    const { contentHash, ...hashInput } = revision;
    refineRuleCardRevisionHashInput(hashInput, context);

    if (contentHash !== sha256CanonicalJson(hashInput)) {
      context.addIssue({
        code: "custom",
        message: "contentHash does not match the canonical Rule Card revision snapshot",
        path: ["contentHash"],
      });
    }
  },
);

export type RuleCardRevision = z.infer<typeof RuleCardRevisionSchema>;

export const RuleGenerationEligibilityRequestSchema = z
  .object({
    revisionId: z.uuid(),
    generationAt: UtcDateTimeSchema,
    evaluationDate: UtcDateTimeSchema,
    expectedRevisionContentHash: Sha256DigestSchema,
    expectedSourceContentHash: Sha256DigestSchema,
    targetState: z.literal("DRAFT"),
  })
  .strict();

export type RuleGenerationEligibilityRequest = z.infer<
  typeof RuleGenerationEligibilityRequestSchema
>;

export const RuleDraftGenerationReferenceSchema = z
  .object({
    targetState: z.literal("DRAFT"),
    cardId: z.uuid(),
    cardRevisionId: z.uuid(),
    revisionContentHash: Sha256DigestSchema,
    sourceId: z.uuid(),
    sourceVersionId: z.uuid(),
    sourceContentHash: Sha256DigestSchema,
    generationAt: UtcDateTimeSchema,
    evaluationDate: UtcDateTimeSchema,
    validationScope: ValidationScopeSchema,
  })
  .strict();

export type RuleDraftGenerationReference = z.infer<typeof RuleDraftGenerationReferenceSchema>;

const RuleCardAuditBaseSchema = z
  .object({
    id: z.uuid(),
    revisionId: z.uuid(),
    sequence: z.int().min(1),
    actorId: z.uuid(),
    at: UtcDateTimeSchema,
    revisionContentHash: Sha256DigestSchema,
    validationScope: ValidationScopeSchema,
  })
  .strict();

export const RuleCardCommentSchema = RuleCardAuditBaseSchema.extend({
  exercisedRole: ActorRoleSchema,
  body: NonEmptyTextSchema,
}).strict();

export type RuleCardComment = z.infer<typeof RuleCardCommentSchema>;

export const RuleCardReviewDecisionTypeSchema = z.enum(["ACCEPTED", "CHANGES_REQUESTED"]);

export type RuleCardReviewDecisionType = z.infer<typeof RuleCardReviewDecisionTypeSchema>;

export const RuleCardReviewDecisionSchema = RuleCardAuditBaseSchema.extend({
  exercisedRole: z.literal("REVIEWER"),
  decision: RuleCardReviewDecisionTypeSchema,
  rationale: NonEmptyTextSchema,
}).strict();

export type RuleCardReviewDecision = z.infer<typeof RuleCardReviewDecisionSchema>;

export const RuleCardApprovalDecisionTypeSchema = z.enum(["APPROVED", "REJECTED"]);

export type RuleCardApprovalDecisionType = z.infer<typeof RuleCardApprovalDecisionTypeSchema>;

export const RuleCardApprovalDecisionSchema = RuleCardAuditBaseSchema.extend({
  exercisedRole: z.literal("APPROVER"),
  decision: RuleCardApprovalDecisionTypeSchema,
  rationale: NonEmptyTextSchema,
}).strict();

export type RuleCardApprovalDecision = z.infer<typeof RuleCardApprovalDecisionSchema>;

const TRANSITION_ROLE: Readonly<Record<RuleCardState, ActorRole>> = {
  DRAFT: "AUTHOR",
  IN_REVIEW: "AUTHOR",
  APPROVED: "APPROVER",
  CHANGES_REQUESTED: "REVIEWER",
  RETIRED: "APPROVER",
};

function isExplicitRuleCardTransition(from: RuleCardState | null, to: RuleCardState): boolean {
  return (
    (from === null && to === "DRAFT") ||
    (from === "DRAFT" && to === "IN_REVIEW") ||
    (from === "APPROVED" && to === "RETIRED")
  );
}

function hasValidSequenceBoundary(sequence: number, from: RuleCardState | null): boolean {
  return sequence === 1 ? from === null : from !== null;
}

export const RuleCardTransitionEventSchema = z
  .object({
    id: z.uuid(),
    revisionId: z.uuid(),
    sequence: z.int().min(1),
    from: RuleCardStateSchema.nullable(),
    to: RuleCardStateSchema,
    actorId: z.uuid(),
    exercisedRole: ActorRoleSchema,
    at: UtcDateTimeSchema,
    revisionContentHash: Sha256DigestSchema,
    reason: NonEmptyTextSchema.nullable(),
    validationScope: ValidationScopeSchema,
  })
  .strict()
  .superRefine(({ sequence, from, to, exercisedRole, reason }, context) => {
    if (!hasValidSequenceBoundary(sequence, from)) {
      context.addIssue({
        code: "custom",
        message: "Only sequence 1 may start from null",
        path: ["from"],
      });
    }

    if (!isExplicitRuleCardTransition(from, to)) {
      context.addIssue({
        code: "custom",
        message: `Invalid explicit Rule Card transition from ${from ?? "null"} to ${to}`,
        path: ["to"],
      });
    }

    if (exercisedRole !== TRANSITION_ROLE[to]) {
      context.addIssue({
        code: "custom",
        message: `${to} requires the ${TRANSITION_ROLE[to]} role`,
        path: ["exercisedRole"],
      });
    }

    if ((to === "CHANGES_REQUESTED" || to === "RETIRED") && reason === null) {
      context.addIssue({
        code: "custom",
        message: `${to} requires a reason`,
        path: ["reason"],
      });
    }
  });

export type RuleCardTransitionEvent = z.infer<typeof RuleCardTransitionEventSchema>;
