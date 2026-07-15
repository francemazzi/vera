import { z } from "zod";

import { ActorIdSchema } from "./actor.js";
import { ValidityIntervalSchema, UtcDateTimeSchema } from "./time.js";
import {
  ActorRoleSchema,
  ComplianceSourceStateSchema,
  ValidationScopeSchema,
  type ActorRole,
  type ComplianceSourceState,
} from "./vocabulary.js";
import { canTransitionComplianceSource } from "./workflow.js";

export const ComplianceSourceTypeSchema = z.enum([
  "REGULATION",
  "STANDARD",
  "POLICY",
  "GUIDANCE",
  "CONTRACT",
  "OTHER",
]);

export type ComplianceSourceType = z.infer<typeof ComplianceSourceTypeSchema>;

export const ComplianceSourceSchema = z
  .object({
    id: z.uuid(),
    type: ComplianceSourceTypeSchema,
    domain: z.string().trim().min(1).max(120),
    jurisdiction: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(300),
    stableReference: z.string().trim().min(1).max(500),
    validationScope: ValidationScopeSchema,
  })
  .strict();

export type ComplianceSource = z.infer<typeof ComplianceSourceSchema>;

const Sha256DigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Expected a lowercase SHA-256 digest");

export const ComplianceSourceVersionSchema = z
  .object({
    id: z.uuid(),
    sourceId: z.uuid(),
    revision: z.int().min(1),
    versionLabel: z.string().trim().min(1).max(100),
    license: z.string().trim().min(1).max(200),
    contentHash: Sha256DigestSchema,
    validity: ValidityIntervalSchema,
    createdAt: UtcDateTimeSchema,
    createdBy: ActorIdSchema,
    replacesVersionId: z.uuid().nullable(),
    replacementReason: z.string().trim().min(1).max(1000).nullable(),
  })
  .strict()
  .superRefine(({ id, replacesVersionId, replacementReason }, context) => {
    if (id === replacesVersionId) {
      context.addIssue({
        code: "custom",
        message: "A source version cannot replace itself",
        path: ["replacesVersionId"],
      });
    }

    if ((replacesVersionId === null) !== (replacementReason === null)) {
      context.addIssue({
        code: "custom",
        message: "Replacement version and reason must be provided together",
        path: [replacesVersionId === null ? "replacesVersionId" : "replacementReason"],
      });
    }
  });

export type ComplianceSourceVersion = z.infer<typeof ComplianceSourceVersionSchema>;

function hasValidSequenceBoundary(sequence: number, from: ComplianceSourceState | null): boolean {
  return sequence === 1 ? from === null : from !== null;
}

const TRANSITION_ROLE: Readonly<Record<ComplianceSourceState, ActorRole>> = {
  UPLOADED: "AUTHOR",
  REVIEWED: "REVIEWER",
  APPROVED: "APPROVER",
  RETIRED: "APPROVER",
};

export const ComplianceSourceTransitionEventSchema = z
  .object({
    id: z.uuid(),
    versionId: z.uuid(),
    sequence: z.int().min(1),
    from: ComplianceSourceStateSchema.nullable(),
    to: ComplianceSourceStateSchema,
    actorId: ActorIdSchema,
    exercisedRole: ActorRoleSchema,
    at: UtcDateTimeSchema,
    contentHash: Sha256DigestSchema,
    reason: z.string().trim().min(1).max(1000).nullable(),
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

    if (!canTransitionComplianceSource(from, to)) {
      context.addIssue({
        code: "custom",
        message: `Invalid compliance source transition from ${from ?? "null"} to ${to}`,
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

    if (to === "RETIRED" && reason === null) {
      context.addIssue({
        code: "custom",
        message: "Retirement requires a reason",
        path: ["reason"],
      });
    }
  });

export type ComplianceSourceTransitionEvent = z.infer<typeof ComplianceSourceTransitionEventSchema>;

export const ComplianceSourceEligibilityRequestSchema = z
  .object({
    versionId: z.uuid(),
    activationAt: UtcDateTimeSchema,
    evaluationDate: UtcDateTimeSchema,
    expectedContentHash: Sha256DigestSchema,
  })
  .strict();

export type ComplianceSourceEligibilityRequest = z.infer<
  typeof ComplianceSourceEligibilityRequestSchema
>;
