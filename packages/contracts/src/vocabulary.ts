import { z } from "zod";

export const EvaluationOutcomeSchema = z.enum(["PASS", "FAIL", "REVIEW", "NOT_APPLICABLE"]);

export type EvaluationOutcome = z.infer<typeof EvaluationOutcomeSchema>;

export const TruthValueSchema = z.enum(["TRUE", "FALSE", "UNKNOWN"]);

export type TruthValue = z.infer<typeof TruthValueSchema>;

export const DeonticCategorySchema = z.enum(["OBLIGATION", "PROHIBITION", "PERMISSION"]);

export type DeonticCategory = z.infer<typeof DeonticCategorySchema>;

export const RiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const ActorRoleSchema = z.enum(["AUTHOR", "REVIEWER", "APPROVER", "ADMIN"]);

export type ActorRole = z.infer<typeof ActorRoleSchema>;

export const ComplianceSourceStateSchema = z.enum(["UPLOADED", "REVIEWED", "APPROVED", "RETIRED"]);

export type ComplianceSourceState = z.infer<typeof ComplianceSourceStateSchema>;

export const RuleCardStateSchema = z.enum([
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "CHANGES_REQUESTED",
  "RETIRED",
]);

export type RuleCardState = z.infer<typeof RuleCardStateSchema>;

/** Public fixtures are technical demonstrations and never professional approvals. */
export const ValidationScopeSchema = z.literal("TECHNICAL_DEMO");

export type ValidationScope = z.infer<typeof ValidationScopeSchema>;
