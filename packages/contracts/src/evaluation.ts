import { z } from "zod";

import { DSL_LIMITS, DslOperatorSchema, type DslOperator } from "./dsl.js";
import { JsonValueSchema } from "./extraction.js";
import type { JsonValue } from "./hash.js";
import { snapshotJsonValue } from "./json-snapshot.js";
import {
  aggregateOutcomes,
  allTruth,
  anyTruth,
  deriveRuleFinding,
  negateTruth,
} from "./outcome.js";
import { UtcDateTimeSchema } from "./time.js";
import {
  EvaluationOutcomeSchema,
  TruthValueSchema,
  ValidationScopeSchema,
  type EvaluationOutcome,
  type TruthValue,
  type ValidationScope,
} from "./vocabulary.js";

const Sha256DigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Expected a lowercase SHA-256 digest");
const StableKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z][A-Za-z0-9._-]*$/u, "Expected a stable key");
const JsonPointerSchema = z
  .string()
  .min(1)
  .max(4_096)
  .regex(
    /^(?:\/(?:[^~/]|~[01])+)+$/u,
    "Expected a non-empty RFC 6901 JSON Pointer with non-empty tokens",
  );

const MAX_TRACE_FACT_KEYS = DSL_LIMITS.maxExpressionNodes;
const MAX_TRACE_EVIDENCE_IDS = 10_000;
const MAX_FINDINGS = 10_000;
const MAX_RELATED_RULE_IDS = MAX_FINDINGS;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightValues = new Set(right);
  return rightValues.size === right.length && left.every((value) => rightValues.has(value));
}

function isStrictlySorted(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    /* v8 ignore next -- loop bounds guarantee both entries */
    if (previous === undefined || current === undefined) return false;
    if (compareStrings(previous, current) >= 0) return false;
  }
  return true;
}

function unionChildValues(
  children: readonly ExpressionTrace[],
  select: (child: ExpressionTrace) => readonly string[],
): readonly string[] {
  return [...new Set(children.flatMap((child) => select(child)))].sort(compareStrings);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

const ImmutableJsonValueSchema = JsonValueSchema.overwrite((value) => deepFreeze(value));

class InvalidEvaluationSnapshot {
  public constructor(public readonly issue: string) {}
}

const EvaluationSnapshotSchema = z
  .unknown()
  .overwrite((value) => {
    const result = snapshotJsonValue(value, {
      // Each logical trace level adds an object and a children array to the JSON shape.
      maxDepth: DSL_LIMITS.maxExpressionDepth * 2 + 16,
      maxNodes: 100_000,
      maxCanonicalBytes: 10_000_000,
      rejectNegativeZero: true,
      rejectUnsafeIntegers: true,
    });
    return result.success ? result.value : new InvalidEvaluationSnapshot(result.issue);
  })
  .superRefine((value, context) => {
    if (value instanceof InvalidEvaluationSnapshot) {
      context.addIssue({
        code: "custom",
        message: `Evaluation values must be bounded JSON snapshots: ${value.issue}`,
        path: [],
      });
    }
  });

export const EvaluationTraceReasonSchema = z.enum([
  "EVALUATED",
  "MISSING_FACT",
  "UNRESOLVED_FACT",
  "TYPE_MISMATCH",
  "MISSING_EVIDENCE",
  "RESOURCE_LIMIT",
]);

export type EvaluationTraceReason = z.infer<typeof EvaluationTraceReasonSchema>;

export interface ExpressionTrace {
  readonly path: string;
  readonly op: DslOperator;
  readonly truth: TruthValue;
  readonly reason: EvaluationTraceReason;
  readonly factKeys: readonly string[];
  readonly expected: JsonValue | null;
  readonly observed: JsonValue | null;
  readonly evidenceIds: readonly string[];
  readonly children: readonly ExpressionTrace[];
}

const TYPE_CHECKED_OPERATORS: ReadonlySet<DslOperator> = new Set([
  "eq",
  "not_eq",
  "contains",
  "contains_any",
  "matches",
  "greater_than",
  "less_than",
  "between",
  "date_before",
  "date_after",
  "date_between",
]);
const RESOURCE_LIMITED_OPERATORS: ReadonlySet<DslOperator> = new Set([
  "matches",
  "same_visual_area",
]);

function isLogicalOperator(op: DslOperator): boolean {
  return op === "all" || op === "any" || op === "not";
}

function isFactLeafOperator(op: DslOperator): boolean {
  return op !== "truth" && !isLogicalOperator(op);
}

function isReasonAllowedForOperator(op: DslOperator, reason: EvaluationTraceReason): boolean {
  if (reason === "EVALUATED") return true;
  if (reason === "TYPE_MISMATCH") return TYPE_CHECKED_OPERATORS.has(op);
  if (reason === "RESOURCE_LIMIT") return RESOURCE_LIMITED_OPERATORS.has(op);
  return isFactLeafOperator(op);
}

function negateOnlyTraceChild(children: readonly ExpressionTrace[]): TruthValue {
  const child = children[0];
  /* v8 ignore next -- callers guard the exact-one-child logical invariant */
  if (child === undefined) return "UNKNOWN";
  return negateTruth(child.truth);
}

function addUniqueIssue(
  values: readonly string[],
  label: string,
  path: PropertyKey,
  context: z.core.$RefinementCtx,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", message: `${label} must be unique`, path: [path] });
  }
}

function addCanonicalStringArrayIssue(
  values: readonly string[],
  label: string,
  path: readonly PropertyKey[],
  context: z.core.$RefinementCtx,
): void {
  if (!isStrictlySorted(values)) {
    context.addIssue({
      code: "custom",
      message: `${label} must be unique and strictly sorted`,
      path: [...path],
    });
  }
}

function refineExpressionTrace(trace: ExpressionTrace, context: z.core.$RefinementCtx): void {
  addCanonicalStringArrayIssue(trace.factKeys, "Fact keys", ["factKeys"], context);
  addCanonicalStringArrayIssue(trace.evidenceIds, "Evidence IDs", ["evidenceIds"], context);

  const isCollection = trace.op === "all" || trace.op === "any";
  const isLogical = isLogicalOperator(trace.op);
  if (!isReasonAllowedForOperator(trace.op, trace.reason)) {
    context.addIssue({
      code: "custom",
      message: `${trace.reason} is not valid for operator ${trace.op}`,
      path: ["reason"],
    });
  }
  if (isCollection && trace.children.length === 0) {
    context.addIssue({
      code: "custom",
      message: `${trace.op} traces require at least one child`,
      path: ["children"],
    });
  } else if (trace.op === "not" && trace.children.length !== 1) {
    context.addIssue({
      code: "custom",
      message: "not traces require exactly one child",
      path: ["children"],
    });
  } else if (!isLogical && trace.children.length !== 0) {
    context.addIssue({
      code: "custom",
      message: "Leaf traces cannot contain children",
      path: ["children"],
    });
  }

  if (isLogical) {
    if (trace.reason !== "EVALUATED") {
      context.addIssue({
        code: "custom",
        message: "Logical trace results are derived from their children",
        path: ["reason"],
      });
    }
    if (trace.expected !== null || trace.observed !== null) {
      context.addIssue({
        code: "custom",
        message: "Logical traces cannot declare scalar expected or observed values",
        path: [trace.expected !== null ? "expected" : "observed"],
      });
    }

    const childFactKeys = unionChildValues(trace.children, ({ factKeys }) => factKeys);
    const childEvidenceIds = unionChildValues(trace.children, ({ evidenceIds }) => evidenceIds);
    if (!sameStringSet(trace.factKeys, childFactKeys)) {
      context.addIssue({
        code: "custom",
        message: "Logical trace fact keys must be the exact union of child fact keys",
        path: ["factKeys"],
      });
    }
    if (!sameStringSet(trace.evidenceIds, childEvidenceIds)) {
      context.addIssue({
        code: "custom",
        message: "Logical trace evidence IDs must be the exact union of child evidence IDs",
        path: ["evidenceIds"],
      });
    }

    trace.children.forEach((child, index) => {
      const expectedPath =
        trace.op === "not" ? `${trace.path}/operand` : `${trace.path}/operands/${String(index)}`;
      if (child.path !== expectedPath) {
        context.addIssue({
          code: "custom",
          message: `Child trace path must be ${expectedPath}`,
          path: ["children", index, "path"],
        });
      }
    });

    if ((isCollection && trace.children.length > 0) || trace.children.length === 1) {
      const derivedTruth =
        trace.op === "all"
          ? allTruth(trace.children.map(({ truth }) => truth))
          : trace.op === "any"
            ? anyTruth(trace.children.map(({ truth }) => truth))
            : negateOnlyTraceChild(trace.children);
      if (trace.truth !== derivedTruth) {
        context.addIssue({
          code: "custom",
          message: `Logical trace truth must be ${derivedTruth} for its children`,
          path: ["truth"],
        });
      }
    }
  } else if (trace.op === "truth") {
    if (trace.factKeys.length !== 0 || trace.evidenceIds.length !== 0) {
      context.addIssue({
        code: "custom",
        message: "Literal truth traces cannot reference facts or evidence",
        path: [trace.factKeys.length !== 0 ? "factKeys" : "evidenceIds"],
      });
    }
    if (trace.expected !== trace.truth || trace.observed !== trace.truth) {
      context.addIssue({
        code: "custom",
        message: "Literal truth traces must expose their value as both expected and observed",
        path: [trace.expected !== trace.truth ? "expected" : "observed"],
      });
    }
  } else {
    const expectedFactCount = trace.op === "same_visual_area" ? null : 1;
    if (
      (expectedFactCount !== null && trace.factKeys.length !== expectedFactCount) ||
      (trace.op === "same_visual_area" &&
        (trace.factKeys.length < 2 || trace.factKeys.length > DSL_LIMITS.maxVisualAreaFacts))
    ) {
      context.addIssue({
        code: "custom",
        message:
          trace.op === "same_visual_area"
            ? `same_visual_area traces require 2-${String(DSL_LIMITS.maxVisualAreaFacts)} fact keys`
            : "Fact leaf traces require exactly one fact key",
        path: ["factKeys"],
      });
    }
    if (trace.reason === "EVALUATED") {
      if (trace.truth === "UNKNOWN") {
        context.addIssue({
          code: "custom",
          message: "An evaluated fact leaf must have a definite truth value",
          path: ["truth"],
        });
      }
      if (trace.evidenceIds.length === 0) {
        context.addIssue({
          code: "custom",
          message: "An evaluated fact leaf must cite evidence",
          path: ["evidenceIds"],
        });
      }
    }
  }

  if (trace.reason !== "EVALUATED" && trace.truth !== "UNKNOWN") {
    context.addIssue({
      code: "custom",
      message: "A non-evaluated trace reason must preserve UNKNOWN",
      path: ["truth"],
    });
  }
  if (
    (trace.reason === "MISSING_FACT" || trace.reason === "UNRESOLVED_FACT") &&
    trace.observed !== null
  ) {
    context.addIssue({
      code: "custom",
      message: `${trace.reason} cannot have an observed normalized value`,
      path: ["observed"],
    });
  }
  if (
    (trace.reason === "MISSING_FACT" || trace.reason === "MISSING_EVIDENCE") &&
    trace.evidenceIds.length !== 0
  ) {
    context.addIssue({
      code: "custom",
      message: `${trace.reason} cannot claim evidence`,
      path: ["evidenceIds"],
    });
  }
  if (
    (trace.reason === "TYPE_MISMATCH" || trace.reason === "RESOURCE_LIMIT") &&
    trace.evidenceIds.length === 0
  ) {
    context.addIssue({
      code: "custom",
      message: `${trace.reason} requires evidence for the accessed fact`,
      path: ["evidenceIds"],
    });
  }
  if (trace.reason === "TYPE_MISMATCH" && trace.observed === null) {
    context.addIssue({
      code: "custom",
      message: "TYPE_MISMATCH requires the observed normalized value",
      path: ["observed"],
    });
  }
}

interface ExpressionTraceStats {
  readonly depth: number;
  readonly nodes: number;
}

function expressionTraceStats(root: ExpressionTrace): ExpressionTraceStats {
  const stack: Array<{ readonly trace: ExpressionTrace; readonly depth: number }> = [
    { trace: root, depth: 1 },
  ];
  let depth = 0;
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    /* v8 ignore next -- the loop condition guarantees a populated stack */
    if (current === undefined) break;
    nodes += 1;
    depth = Math.max(depth, current.depth);
    for (const child of current.trace.children) {
      stack.push({ trace: child, depth: current.depth + 1 });
    }
  }
  return { depth, nodes };
}

function addExpressionTraceBoundIssues(
  trace: ExpressionTrace,
  context: z.core.$RefinementCtx,
  path: readonly PropertyKey[],
): number {
  const stats = expressionTraceStats(trace);
  if (stats.depth > DSL_LIMITS.maxExpressionDepth) {
    context.addIssue({
      code: "custom",
      message: `Expression trace depth cannot exceed ${String(DSL_LIMITS.maxExpressionDepth)}`,
      path: [...path],
    });
  }
  if (stats.nodes > DSL_LIMITS.maxExpressionNodes) {
    context.addIssue({
      code: "custom",
      message: `Expression trace nodes cannot exceed ${String(DSL_LIMITS.maxExpressionNodes)}`,
      path: [...path],
    });
  }
  return stats.nodes;
}

const RecursiveExpressionTraceSchema: z.ZodType<ExpressionTrace> = z.lazy(
  (): z.ZodType<ExpressionTrace> => ExpressionTraceObjectSchema,
);

const ExpressionTraceObjectSchema = z
  .object({
    path: JsonPointerSchema,
    op: DslOperatorSchema,
    truth: TruthValueSchema,
    reason: EvaluationTraceReasonSchema,
    factKeys: z.array(StableKeySchema).max(MAX_TRACE_FACT_KEYS).readonly(),
    expected: ImmutableJsonValueSchema.nullable(),
    observed: ImmutableJsonValueSchema.nullable(),
    evidenceIds: z.array(z.uuid()).max(MAX_TRACE_EVIDENCE_IDS).readonly(),
    children: z.array(RecursiveExpressionTraceSchema).max(DSL_LIMITS.maxLogicalOperands).readonly(),
  })
  .strict()
  .superRefine(refineExpressionTrace)
  .readonly();

const BoundedExpressionTraceSchema = RecursiveExpressionTraceSchema.superRefine(
  (trace, context) => {
    addExpressionTraceBoundIssues(trace, context, []);
  },
);

export const ExpressionTraceSchema = EvaluationSnapshotSchema.pipe(
  BoundedExpressionTraceSchema,
) as z.ZodType<ExpressionTrace>;

export interface RuleOverrideTrace {
  readonly overrideId: string;
  readonly overriddenRuleId: string;
  readonly trace: ExpressionTrace;
}

const RuleOverrideTraceObjectSchema = z
  .object({
    overrideId: z.uuid(),
    overriddenRuleId: z.uuid(),
    trace: RecursiveExpressionTraceSchema,
  })
  .strict()
  .superRefine(({ trace }, context) => {
    addExpressionTraceBoundIssues(trace, context, ["trace"]);
  })
  .readonly();

export const RuleOverrideTraceSchema = EvaluationSnapshotSchema.pipe(
  RuleOverrideTraceObjectSchema,
) as z.ZodType<RuleOverrideTrace>;

export interface RuleFinding {
  readonly ruleId: string;
  readonly ruleContentHash: string;
  readonly evaluationDate: string;
  readonly outcome: EvaluationOutcome;
  readonly appliesWhen: ExpressionTrace;
  readonly exceptionTraces: readonly ExpressionTrace[];
  readonly satisfiedWhen: ExpressionTrace | null;
  readonly overrideTraces: readonly RuleOverrideTrace[];
  readonly evidenceIds: readonly string[];
  readonly validationScope: ValidationScope;
}

function exceptionTruth(traces: readonly ExpressionTrace[]): TruthValue {
  return traces.length === 0 ? "FALSE" : anyTruth(traces.map(({ truth }) => truth));
}

function refineRuleFinding(finding: RuleFinding, context: z.core.$RefinementCtx): void {
  addCanonicalStringArrayIssue(finding.evidenceIds, "Evidence IDs", ["evidenceIds"], context);
  addUniqueIssue(
    finding.exceptionTraces.map(({ path }) => path),
    "Exception trace paths",
    "exceptionTraces",
    context,
  );

  let traceNodes = addExpressionTraceBoundIssues(finding.appliesWhen, context, ["appliesWhen"]);
  finding.exceptionTraces.forEach((trace, index) => {
    traceNodes += addExpressionTraceBoundIssues(trace, context, ["exceptionTraces", index]);
  });
  if (finding.satisfiedWhen !== null) {
    traceNodes += addExpressionTraceBoundIssues(finding.satisfiedWhen, context, ["satisfiedWhen"]);
  }
  finding.overrideTraces.forEach((override, index) => {
    traceNodes += addExpressionTraceBoundIssues(override.trace, context, [
      "overrideTraces",
      index,
      "trace",
    ]);
  });
  if (traceNodes > DSL_LIMITS.maxRuleExpressionNodes) {
    context.addIssue({
      code: "custom",
      message: `Finding traces cannot exceed ${String(DSL_LIMITS.maxRuleExpressionNodes)} total expression nodes`,
      path: [],
    });
  }
  addUniqueIssue(
    finding.overrideTraces.map(({ overrideId }) => overrideId),
    "Override IDs",
    "overrideTraces",
    context,
  );
  addUniqueIssue(
    finding.overrideTraces.map(({ overriddenRuleId }) => overriddenRuleId),
    "Overridden rule IDs",
    "overrideTraces",
    context,
  );

  if (finding.appliesWhen.path !== "/appliesWhen") {
    context.addIssue({
      code: "custom",
      message: "Applicability trace must start at /appliesWhen",
      path: ["appliesWhen", "path"],
    });
  }
  finding.exceptionTraces.forEach((trace, index) => {
    const expectedPath = `/exceptions/${String(index)}/when`;
    if (trace.path !== expectedPath) {
      context.addIssue({
        code: "custom",
        message: `Exception trace path must be ${expectedPath}`,
        path: ["exceptionTraces", index, "path"],
      });
    }
  });
  if (finding.satisfiedWhen !== null && finding.satisfiedWhen.path !== "/satisfiedWhen") {
    context.addIssue({
      code: "custom",
      message: "Satisfaction trace must start at /satisfiedWhen",
      path: ["satisfiedWhen", "path"],
    });
  }
  if (finding.satisfiedWhen === null && finding.overrideTraces.length !== 0) {
    context.addIssue({
      code: "custom",
      message: "Override traces must be skipped when satisfaction is not evaluated",
      path: ["overrideTraces"],
    });
  }
  finding.overrideTraces.forEach((override, index) => {
    const expectedPath = `/overrides/${String(index)}/when`;
    if (override.trace.path !== expectedPath) {
      context.addIssue({
        code: "custom",
        message: `Override trace path must be ${expectedPath}`,
        path: ["overrideTraces", index, "trace", "path"],
      });
    }
    if (override.overriddenRuleId === finding.ruleId) {
      context.addIssue({
        code: "custom",
        message: "A finding cannot contain a self-override trace",
        path: ["overrideTraces", index, "overriddenRuleId"],
      });
    }
  });

  if (finding.appliesWhen.truth !== "TRUE" && finding.exceptionTraces.length !== 0) {
    context.addIssue({
      code: "custom",
      message: "Exceptions must be skipped when applicability is not TRUE",
      path: ["exceptionTraces"],
    });
  }

  const combinedException = exceptionTruth(finding.exceptionTraces);
  const satisfactionRequired =
    finding.appliesWhen.truth === "TRUE" && combinedException === "FALSE";
  if (satisfactionRequired === (finding.satisfiedWhen === null)) {
    context.addIssue({
      code: "custom",
      message: satisfactionRequired
        ? "Satisfaction trace is required for an applicable rule without an active exception"
        : "Satisfaction trace must be null when evaluation is legitimately skipped",
      path: ["satisfiedWhen"],
    });
  }

  if (!satisfactionRequired || finding.satisfiedWhen !== null) {
    const expectedOutcome = deriveRuleFinding(
      finding.appliesWhen.truth,
      combinedException,
      finding.satisfiedWhen?.truth ?? null,
    );
    if (finding.outcome !== expectedOutcome) {
      context.addIssue({
        code: "custom",
        message: `Outcome must be ${expectedOutcome} for the supplied traces`,
        path: ["outcome"],
      });
    }
  }

  const traceEvidence = new Set(finding.appliesWhen.evidenceIds);
  for (const trace of finding.exceptionTraces) {
    trace.evidenceIds.forEach((id) => traceEvidence.add(id));
  }
  finding.satisfiedWhen?.evidenceIds.forEach((id) => traceEvidence.add(id));
  for (const override of finding.overrideTraces) {
    override.trace.evidenceIds.forEach((id) => traceEvidence.add(id));
  }
  if (!sameStringSet(finding.evidenceIds, [...traceEvidence])) {
    context.addIssue({
      code: "custom",
      message: "Finding evidence IDs must be the exact union of all trace evidence IDs",
      path: ["evidenceIds"],
    });
  }
}

const RuleFindingObjectSchema = z
  .object({
    ruleId: z.uuid(),
    ruleContentHash: Sha256DigestSchema,
    evaluationDate: UtcDateTimeSchema,
    outcome: EvaluationOutcomeSchema,
    appliesWhen: RecursiveExpressionTraceSchema,
    exceptionTraces: z
      .array(RecursiveExpressionTraceSchema)
      .max(DSL_LIMITS.maxExceptions)
      .readonly(),
    satisfiedWhen: RecursiveExpressionTraceSchema.nullable(),
    overrideTraces: z.array(RuleOverrideTraceObjectSchema).max(DSL_LIMITS.maxOverrides).readonly(),
    evidenceIds: z.array(z.uuid()).max(MAX_TRACE_EVIDENCE_IDS).readonly(),
    validationScope: ValidationScopeSchema,
  })
  .strict()
  .superRefine(refineRuleFinding)
  .readonly();

export const RuleFindingSchema = EvaluationSnapshotSchema.pipe(
  RuleFindingObjectSchema,
) as z.ZodType<RuleFinding>;

export const RuleFindingResolutionSchema = z.enum([
  "UNCHANGED",
  "OVERRIDDEN",
  "UNCERTAIN_OVERRIDE",
  "CONFLICT_REVIEW",
  "INVALID_OVERRIDE_GRAPH",
]);

export type RuleFindingResolution = z.infer<typeof RuleFindingResolutionSchema>;

export interface ResolvedRuleFinding {
  readonly finding: RuleFinding;
  readonly resolution: RuleFindingResolution;
  readonly effectiveOutcome: EvaluationOutcome;
  readonly relatedRuleIds: readonly string[];
}

function refineResolvedRuleFinding(
  resolved: ResolvedRuleFinding,
  context: z.core.$RefinementCtx,
): void {
  addCanonicalStringArrayIssue(
    resolved.relatedRuleIds,
    "Related rule IDs",
    ["relatedRuleIds"],
    context,
  );
  if (resolved.relatedRuleIds.includes(resolved.finding.ruleId)) {
    context.addIssue({
      code: "custom",
      message: "A finding cannot relate to itself",
      path: ["relatedRuleIds"],
    });
  }

  if (resolved.resolution === "UNCHANGED") {
    if (resolved.effectiveOutcome !== resolved.finding.outcome) {
      context.addIssue({
        code: "custom",
        message: "UNCHANGED must preserve the base finding outcome",
        path: ["effectiveOutcome"],
      });
    }
    if (resolved.relatedRuleIds.length !== 0) {
      context.addIssue({
        code: "custom",
        message: "UNCHANGED cannot declare related rules",
        path: ["relatedRuleIds"],
      });
    }
    return;
  }

  if (resolved.resolution === "OVERRIDDEN") {
    if (resolved.effectiveOutcome !== "NOT_APPLICABLE") {
      context.addIssue({
        code: "custom",
        message: "OVERRIDDEN must resolve to NOT_APPLICABLE",
        path: ["effectiveOutcome"],
      });
    }
    if (resolved.relatedRuleIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "OVERRIDDEN requires the overriding rule ID",
        path: ["relatedRuleIds"],
      });
    }
    return;
  }

  if (resolved.effectiveOutcome !== "REVIEW") {
    context.addIssue({
      code: "custom",
      message: `${resolved.resolution} must resolve to REVIEW`,
      path: ["effectiveOutcome"],
    });
  }
  if (
    (resolved.resolution === "CONFLICT_REVIEW" || resolved.resolution === "UNCERTAIN_OVERRIDE") &&
    resolved.relatedRuleIds.length === 0
  ) {
    context.addIssue({
      code: "custom",
      message: `${resolved.resolution} requires at least one related rule ID`,
      path: ["relatedRuleIds"],
    });
  }
}

const ResolvedRuleFindingObjectSchema = z
  .object({
    finding: RuleFindingObjectSchema,
    resolution: RuleFindingResolutionSchema,
    effectiveOutcome: EvaluationOutcomeSchema,
    relatedRuleIds: z.array(z.uuid()).max(MAX_RELATED_RULE_IDS).readonly(),
  })
  .strict()
  .superRefine(refineResolvedRuleFinding)
  .readonly();

export const ResolvedRuleFindingSchema = EvaluationSnapshotSchema.pipe(
  ResolvedRuleFindingObjectSchema,
) as z.ZodType<ResolvedRuleFinding>;

export interface EvaluationResult {
  readonly findings: readonly ResolvedRuleFinding[];
  readonly aggregateOutcome: EvaluationOutcome;
}

function refineEvaluationResult(result: EvaluationResult, context: z.core.$RefinementCtx): void {
  if (result.findings.length === 0) return;

  const ruleIds = result.findings.map(({ finding }) => finding.ruleId);
  addCanonicalStringArrayIssue(ruleIds, "Finding rule IDs", ["findings"], context);
  const findingById = new Map(
    result.findings.map((resolved) => [resolved.finding.ruleId, resolved] as const),
  );
  const relatedById = new Map(
    result.findings.map(
      ({ finding, relatedRuleIds }) => [finding.ruleId, new Set(relatedRuleIds)] as const,
    ),
  );
  const overrideTruthBySource = new Map(
    result.findings.map(({ finding }) => [
      finding.ruleId,
      new Map(
        finding.overrideTraces.map(({ overriddenRuleId, trace }) => [
          overriddenRuleId,
          trace.truth,
        ]),
      ),
    ]),
  );

  result.findings.forEach((resolved, findingIndex) => {
    resolved.relatedRuleIds.forEach((relatedRuleId, relatedIndex) => {
      const peer = findingById.get(relatedRuleId);
      if (peer === undefined) {
        context.addIssue({
          code: "custom",
          message: `Related rule is absent from the evaluation result: ${relatedRuleId}`,
          path: ["findings", findingIndex, "relatedRuleIds", relatedIndex],
        });
        return;
      }
      const peerIsReciprocal = relatedById.get(relatedRuleId)?.has(resolved.finding.ruleId);
      if (
        resolved.resolution === "OVERRIDDEN" &&
        overrideTruthBySource.get(relatedRuleId)?.get(resolved.finding.ruleId) !== "TRUE"
      ) {
        context.addIssue({
          code: "custom",
          message: "OVERRIDDEN relationships require a TRUE override trace from each source",
          path: ["findings", findingIndex, "relatedRuleIds", relatedIndex],
        });
      }
      if (
        resolved.resolution === "UNCERTAIN_OVERRIDE" &&
        (peer.resolution !== "UNCERTAIN_OVERRIDE" ||
          !peerIsReciprocal ||
          (overrideTruthBySource.get(resolved.finding.ruleId)?.get(relatedRuleId) !== "UNKNOWN" &&
            overrideTruthBySource.get(relatedRuleId)?.get(resolved.finding.ruleId) !== "UNKNOWN"))
      ) {
        context.addIssue({
          code: "custom",
          message:
            "UNCERTAIN_OVERRIDE relationships must be reciprocal uncertain peers supported by an UNKNOWN override trace",
          path: ["findings", findingIndex, "relatedRuleIds", relatedIndex],
        });
      }
      if (
        resolved.resolution === "CONFLICT_REVIEW" &&
        (peer.resolution !== "CONFLICT_REVIEW" || !peerIsReciprocal)
      ) {
        context.addIssue({
          code: "custom",
          message: "CONFLICT_REVIEW relationships must be reciprocal between conflict peers",
          path: ["findings", findingIndex, "relatedRuleIds", relatedIndex],
        });
      }
    });
  });

  const evaluationDates = result.findings.map(({ finding }) => finding.evaluationDate);
  if (!evaluationDates.every((date) => date === evaluationDates[0])) {
    context.addIssue({
      code: "custom",
      message: "All findings in an evaluation result must use the same evaluation date",
      path: ["findings"],
    });
  }

  const expectedAggregate = aggregateOutcomes(
    result.findings.map(({ effectiveOutcome }) => effectiveOutcome),
  );
  if (result.aggregateOutcome !== expectedAggregate) {
    context.addIssue({
      code: "custom",
      message: `Aggregate outcome must be ${expectedAggregate}`,
      path: ["aggregateOutcome"],
    });
  }
}

const EvaluationResultObjectSchema = z
  .object({
    findings: z.array(ResolvedRuleFindingObjectSchema).min(1).max(MAX_FINDINGS).readonly(),
    aggregateOutcome: EvaluationOutcomeSchema,
  })
  .strict()
  .superRefine(refineEvaluationResult)
  .readonly();

export const EvaluationResultSchema = EvaluationSnapshotSchema.pipe(
  EvaluationResultObjectSchema,
) as z.ZodType<EvaluationResult>;

const generatedEvaluationResultJsonSchema = z.toJSONSchema(EvaluationResultObjectSchema, {
  target: "draft-2020-12",
  io: "output",
  cycles: "ref",
  reused: "ref",
}) as Record<string, unknown>;
generatedEvaluationResultJsonSchema["$id"] =
  "https://vera.local/schemas/evaluation-result-v1.schema.json";
generatedEvaluationResultJsonSchema["title"] = "VERA EvaluationResult v1";

/** Structural interchange schema; runtime-only cross-field invariants remain enforced by Zod. */
export const EvaluationResultJsonSchema = deepFreeze(generatedEvaluationResultJsonSchema);
/** Pinned identity of the published EvaluationResult structural schema. */
export const EVALUATION_RESULT_JSON_SCHEMA_HASH =
  "ed8f81d7a2477364deb7b3ac9a21f639fd5893bb6769feaa95e3bd9f03eb2bc5";
