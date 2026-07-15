import type { Actor } from "./actor.js";
import type { ActorRole, ComplianceSourceState, RiskLevel, RuleCardState } from "./vocabulary.js";

const SOURCE_TRANSITIONS: Readonly<
  Record<ComplianceSourceState, readonly ComplianceSourceState[]>
> = {
  UPLOADED: ["REVIEWED"],
  REVIEWED: ["APPROVED"],
  APPROVED: ["RETIRED"],
  RETIRED: [],
};

const RULE_CARD_TRANSITIONS: Readonly<Record<RuleCardState, readonly RuleCardState[]>> = {
  DRAFT: ["IN_REVIEW"],
  IN_REVIEW: ["APPROVED", "CHANGES_REQUESTED"],
  APPROVED: ["RETIRED"],
  CHANGES_REQUESTED: [],
  RETIRED: [],
};

const RISK_ORDER: Readonly<Record<RiskLevel, number>> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

const SOURCE_REQUIRED_ROLE: Readonly<Record<ComplianceSourceState, ActorRole>> = {
  UPLOADED: "AUTHOR",
  REVIEWED: "REVIEWER",
  APPROVED: "APPROVER",
  RETIRED: "APPROVER",
};

const RULE_CARD_REQUIRED_ROLE: Readonly<Record<RuleCardState, ActorRole>> = {
  DRAFT: "AUTHOR",
  IN_REVIEW: "AUTHOR",
  APPROVED: "APPROVER",
  CHANGES_REQUESTED: "REVIEWER",
  RETIRED: "APPROVER",
};

/**
 * Identity context for a workflow decision. `excludedActorIds` contains prior decision makers that
 * must be distinct from the current actor (for example, a reviewer when selecting an approver).
 */
export interface WorkflowTransitionContext {
  readonly actor: Actor;
  readonly contributorIds: readonly string[];
  readonly excludedActorIds: readonly string[];
  readonly reason?: string;
}

export function canTransitionComplianceSource(
  from: ComplianceSourceState | null,
  to: ComplianceSourceState,
): boolean {
  if (from === null) return to === "UPLOADED";
  return SOURCE_TRANSITIONS[from].includes(to);
}

export function canTransitionRuleCard(from: RuleCardState | null, to: RuleCardState): boolean {
  if (from === null) return to === "DRAFT";
  return RULE_CARD_TRANSITIONS[from].includes(to);
}

function isIndependentActor(context: WorkflowTransitionContext): boolean {
  return (
    !context.contributorIds.includes(context.actor.id) &&
    !context.excludedActorIds.includes(context.actor.id)
  );
}

function hasRetirementReason(to: ComplianceSourceState | RuleCardState, reason?: string): boolean {
  return to !== "RETIRED" || (reason?.trim().length ?? 0) > 0;
}

export function canPerformComplianceSourceTransition(
  from: ComplianceSourceState | null,
  to: ComplianceSourceState,
  context: WorkflowTransitionContext,
): boolean {
  if (!canTransitionComplianceSource(from, to)) return false;
  if (context.actor.role !== SOURCE_REQUIRED_ROLE[to]) return false;

  const requiresIndependence = to === "REVIEWED" || to === "APPROVED" || to === "RETIRED";
  if (requiresIndependence && !isIndependentActor(context)) return false;

  return hasRetirementReason(to, context.reason);
}

export function canPerformRuleCardTransition(
  from: RuleCardState | null,
  to: RuleCardState,
  context: WorkflowTransitionContext,
): boolean {
  if (!canTransitionRuleCard(from, to)) return false;
  if (context.actor.role !== RULE_CARD_REQUIRED_ROLE[to]) return false;

  const requiresIndependence = to === "APPROVED" || to === "CHANGES_REQUESTED" || to === "RETIRED";
  if (requiresIndependence && !isIndependentActor(context)) return false;

  return hasRetirementReason(to, context.reason);
}

export function effectiveRisk(levels: readonly [RiskLevel, ...RiskLevel[]]): RiskLevel {
  return levels.reduce((highest, current) =>
    RISK_ORDER[current] > RISK_ORDER[highest] ? current : highest,
  );
}
