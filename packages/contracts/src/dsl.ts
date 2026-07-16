import { RE2JS } from "re2js";
import { z } from "zod";

import { sha256CanonicalJson } from "./hash.js";
import { snapshotJsonValue } from "./json-snapshot.js";
import { RuleCardRevisionSchema, type RuleCardRevision } from "./rule-card.js";
import { ValidityIntervalSchema } from "./time.js";
import {
  DeonticCategorySchema,
  RiskLevelSchema,
  TruthValueSchema,
  ValidationScopeSchema,
} from "./vocabulary.js";
import { effectiveRisk } from "./workflow.js";

export const DSL_VERSION = "vera.dsl/v1" as const;

/** Public resource limits shared by schema producers and the deterministic kernel. */
export const DSL_LIMITS = Object.freeze({
  maxExpressionDepth: 32,
  maxExpressionNodes: 2_048,
  maxRuleExpressionNodes: 2_048,
  maxJsonDepth: 64,
  maxJsonNodes: 50_000,
  maxLogicalOperands: 64,
  maxStringCharacters: 20_000,
  maxPatternBytes: 512,
  maxRegexInputCharacters: 20_000,
  maxContainsAnyValues: 64,
  maxVisualAreaFacts: 10,
  maxExceptions: 100,
  maxOverrides: 100,
  maxConflicts: 100,
  maxEvidenceBindings: 256,
  maxEvidenceRequirementsPerFact: 32,
  maxRuleCanonicalBytes: 1_000_000,
} as const);

const Sha256DigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Expected a lowercase SHA-256 digest");
const StableKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z][A-Za-z0-9._-]*$/u, "Expected a stable key");
const EvidenceRequirementKeySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z][A-Za-z0-9._-]*$/u, "Expected a Rule Card evidence requirement key");
const SourceReferenceSchema = z
  .string()
  .min(1)
  .max(500)
  .regex(/^\S(?:[\s\S]*\S)?$/u, "Leading or trailing whitespace is forbidden");
const ReasonSchema = z
  .string()
  .min(1)
  .max(2_000)
  .regex(/^\S(?:[\s\S]*\S)?$/u, "Leading or trailing whitespace is forbidden");
const DslTextSchema = z.string().max(DSL_LIMITS.maxStringCharacters);
const NonEmptyDslTextSchema = DslTextSchema.min(1);
const LanguageTagSchema = z
  .string()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u, "Expected a BCP 47 language tag");
const FiniteNumberSchema = z
  .number()
  .refine((value) => !Object.is(value, -0), "Negative zero is not canonical JSON")
  .refine(
    (value) => !Number.isInteger(value) || Number.isSafeInteger(value),
    "Integral operands must be safely representable",
  );

export const DslOperatorSchema = z.enum([
  "truth",
  "present",
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
  "all",
  "any",
  "not",
  "language_present",
  "same_visual_area",
]);

export type DslOperator = z.infer<typeof DslOperatorSchema>;

export const UnicodeNormalizationSchema = z.enum(["NFC", "NFKC"]);
export const CaseSensitivitySchema = z.enum(["SENSITIVE", "INSENSITIVE"]);
export const WhitespaceHandlingSchema = z.enum(["PRESERVE", "COLLAPSE"]);
export const RegexMatchModeSchema = z.enum(["SEARCH", "FULL"]);
export const LanguageMatchModeSchema = z.enum(["EXACT", "PRIMARY"]);
export const VisualAreaQuantifierSchema = z.literal("ALL_FACTS");

export type UnicodeNormalization = z.infer<typeof UnicodeNormalizationSchema>;
export type CaseSensitivity = z.infer<typeof CaseSensitivitySchema>;
export type WhitespaceHandling = z.infer<typeof WhitespaceHandlingSchema>;
export type RegexMatchMode = z.infer<typeof RegexMatchModeSchema>;
export type LanguageMatchMode = z.infer<typeof LanguageMatchModeSchema>;
export type VisualAreaQuantifier = z.infer<typeof VisualAreaQuantifierSchema>;

export const TextComparisonSchema = z
  .object({
    normalization: UnicodeNormalizationSchema,
    whitespace: WhitespaceHandlingSchema,
    caseSensitivity: CaseSensitivitySchema,
  })
  .strict();

export type TextComparison = z.infer<typeof TextComparisonSchema>;

export const ComparableExpectedValueSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("STRING"),
      value: DslTextSchema,
      comparison: TextComparisonSchema,
    })
    .strict(),
  z.object({ type: z.literal("NUMBER"), value: FiniteNumberSchema }).strict(),
  z.object({ type: z.literal("BOOLEAN"), value: z.boolean() }).strict(),
  z.object({ type: z.literal("DATE"), value: z.iso.date() }).strict(),
]);

export type ComparableExpectedValue = z.infer<typeof ComparableExpectedValueSchema>;

const FactOperandShape = { factKey: StableKeySchema } as const;

const TruthExpressionSchema = z
  .object({ op: z.literal("truth"), value: TruthValueSchema })
  .strict();
const PresentExpressionSchema = z
  .object({ op: z.literal("present"), ...FactOperandShape })
  .strict();
const EqExpressionSchema = z
  .object({
    op: z.literal("eq"),
    ...FactOperandShape,
    expected: ComparableExpectedValueSchema,
  })
  .strict();
const NotEqExpressionSchema = z
  .object({
    op: z.literal("not_eq"),
    ...FactOperandShape,
    expected: ComparableExpectedValueSchema,
  })
  .strict();
function normalizeDslText(value: string, comparison: TextComparison): string {
  let normalized = value.normalize(comparison.normalization);
  if (comparison.whitespace === "COLLAPSE") {
    normalized = normalized.replace(/\p{White_Space}+/gu, " ").trim();
  }
  return comparison.caseSensitivity === "INSENSITIVE" ? normalized.toLowerCase() : normalized;
}

const ContainsExpressionSchema = z
  .object({
    op: z.literal("contains"),
    ...FactOperandShape,
    expected: NonEmptyDslTextSchema,
    comparison: TextComparisonSchema,
  })
  .strict()
  .superRefine(({ expected, comparison }, context) => {
    if (normalizeDslText(expected, comparison).length === 0) {
      context.addIssue({
        code: "custom",
        message: "contains expected value cannot normalize to an empty string",
        path: ["expected"],
      });
    }
  });
const ContainsAnyExpressionSchema = z
  .object({
    op: z.literal("contains_any"),
    ...FactOperandShape,
    expected: z.array(NonEmptyDslTextSchema).min(1).max(DSL_LIMITS.maxContainsAnyValues),
    comparison: TextComparisonSchema,
  })
  .strict()
  .superRefine(({ expected, comparison }, context) => {
    const canonicalValues = expected.map((value) => normalizeDslText(value, comparison));
    canonicalValues.forEach((value, index) => {
      if (value.length === 0) {
        context.addIssue({
          code: "custom",
          message: "contains_any values cannot normalize to an empty string",
          path: ["expected", index],
        });
      }
    });
    if (new Set(canonicalValues).size !== canonicalValues.length) {
      context.addIssue({
        code: "custom",
        message: "contains_any values must be unique after configured normalization",
        path: ["expected"],
      });
    }
  });

function hasImplicitRegexFlags(pattern: string): boolean {
  let escaped = false;
  let characterClass = false;

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") {
      characterClass = true;
      continue;
    }
    if (character === "]") {
      characterClass = false;
      continue;
    }
    if (
      !characterClass &&
      character === "(" &&
      pattern[index + 1] === "?" &&
      pattern[index + 2] !== ":"
    ) {
      return true;
    }
  }

  return false;
}

function isAllowedRe2Pattern(
  pattern: string,
  normalization: z.infer<typeof UnicodeNormalizationSchema>,
  caseSensitivity: z.infer<typeof CaseSensitivitySchema>,
  dotAll: boolean,
  multiline: boolean,
): boolean {
  if (
    new TextEncoder().encode(pattern).byteLength > DSL_LIMITS.maxPatternBytes ||
    pattern.normalize(normalization) !== pattern ||
    hasImplicitRegexFlags(pattern)
  ) {
    return false;
  }

  try {
    let flags = caseSensitivity === "INSENSITIVE" ? RE2JS.CASE_INSENSITIVE : 0;
    if (dotAll) flags |= RE2JS.DOTALL;
    if (multiline) flags |= RE2JS.MULTILINE;
    RE2JS.compile(pattern, flags).reset();
    return true;
  } catch {
    return false;
  }
}

const MatchesExpressionSchema = z
  .object({
    op: z.literal("matches"),
    ...FactOperandShape,
    pattern: z.string().min(1).max(DSL_LIMITS.maxPatternBytes),
    mode: RegexMatchModeSchema,
    normalization: UnicodeNormalizationSchema,
    whitespace: WhitespaceHandlingSchema,
    caseSensitivity: CaseSensitivitySchema,
    dotAll: z.boolean(),
    multiline: z.boolean(),
    maxInputCharacters: z.int().min(1).max(DSL_LIMITS.maxRegexInputCharacters),
  })
  .strict()
  .superRefine(({ pattern, normalization, caseSensitivity, dotAll, multiline }, context) => {
    if (!isAllowedRe2Pattern(pattern, normalization, caseSensitivity, dotAll, multiline)) {
      context.addIssue({
        code: "custom",
        message: "Pattern must compile with the allowed RE2-compatible feature and flag set",
        path: ["pattern"],
      });
    }
  });
const GreaterThanExpressionSchema = z
  .object({
    op: z.literal("greater_than"),
    ...FactOperandShape,
    expectedExclusive: FiniteNumberSchema,
  })
  .strict();
const LessThanExpressionSchema = z
  .object({
    op: z.literal("less_than"),
    ...FactOperandShape,
    expectedExclusive: FiniteNumberSchema,
  })
  .strict();
const BetweenExpressionSchema = z
  .object({
    op: z.literal("between"),
    ...FactOperandShape,
    minimum: FiniteNumberSchema,
    maximum: FiniteNumberSchema,
    includeMinimum: z.boolean(),
    includeMaximum: z.boolean(),
  })
  .strict()
  .superRefine(({ minimum, maximum, includeMinimum, includeMaximum }, context) => {
    if (minimum > maximum || (minimum === maximum && (!includeMinimum || !includeMaximum))) {
      context.addIssue({
        code: "custom",
        message: "Numeric range must contain at least one value",
        path: ["maximum"],
      });
    }
  });
const DateBeforeExpressionSchema = z
  .object({
    op: z.literal("date_before"),
    ...FactOperandShape,
    expectedExclusive: z.iso.date(),
  })
  .strict();
const DateAfterExpressionSchema = z
  .object({
    op: z.literal("date_after"),
    ...FactOperandShape,
    expectedExclusive: z.iso.date(),
  })
  .strict();
const DateBetweenExpressionSchema = z
  .object({
    op: z.literal("date_between"),
    ...FactOperandShape,
    minimum: z.iso.date(),
    maximum: z.iso.date(),
    includeMinimum: z.boolean(),
    includeMaximum: z.boolean(),
  })
  .strict()
  .superRefine(({ minimum, maximum, includeMinimum, includeMaximum }, context) => {
    if (minimum > maximum || (minimum === maximum && (!includeMinimum || !includeMaximum))) {
      context.addIssue({
        code: "custom",
        message: "Calendar range must contain at least one date",
        path: ["maximum"],
      });
    }
  });
const LanguagePresentExpressionSchema = z
  .object({
    op: z.literal("language_present"),
    ...FactOperandShape,
    language: LanguageTagSchema,
    matchMode: LanguageMatchModeSchema,
  })
  .strict();
const SameVisualAreaExpressionSchema = z
  .object({
    op: z.literal("same_visual_area"),
    factKeys: z.array(StableKeySchema).min(2).max(DSL_LIMITS.maxVisualAreaFacts),
    maxNormalizedGap: z.number().min(0).max(1),
    quantifier: VisualAreaQuantifierSchema,
    requireSameDocument: z.literal(true),
    requireSamePage: z.literal(true),
  })
  .strict()
  .superRefine(({ factKeys }, context) => {
    if (new Set(factKeys).size !== factKeys.length) {
      context.addIssue({
        code: "custom",
        message: "same_visual_area fact keys must be unique",
        path: ["factKeys"],
      });
    }
  });

type LeafExpression =
  | z.infer<typeof TruthExpressionSchema>
  | z.infer<typeof PresentExpressionSchema>
  | z.infer<typeof EqExpressionSchema>
  | z.infer<typeof NotEqExpressionSchema>
  | z.infer<typeof ContainsExpressionSchema>
  | z.infer<typeof ContainsAnyExpressionSchema>
  | z.infer<typeof MatchesExpressionSchema>
  | z.infer<typeof GreaterThanExpressionSchema>
  | z.infer<typeof LessThanExpressionSchema>
  | z.infer<typeof BetweenExpressionSchema>
  | z.infer<typeof DateBeforeExpressionSchema>
  | z.infer<typeof DateAfterExpressionSchema>
  | z.infer<typeof DateBetweenExpressionSchema>
  | z.infer<typeof LanguagePresentExpressionSchema>
  | z.infer<typeof SameVisualAreaExpressionSchema>;

export type DslExpression =
  | LeafExpression
  | { op: "all"; operands: DslExpression[] }
  | { op: "any"; operands: DslExpression[] }
  | { op: "not"; operand: DslExpression };

const LEAF_EXPRESSION_SCHEMAS = [
  TruthExpressionSchema,
  PresentExpressionSchema,
  EqExpressionSchema,
  NotEqExpressionSchema,
  ContainsExpressionSchema,
  ContainsAnyExpressionSchema,
  MatchesExpressionSchema,
  GreaterThanExpressionSchema,
  LessThanExpressionSchema,
  BetweenExpressionSchema,
  DateBeforeExpressionSchema,
  DateAfterExpressionSchema,
  DateBetweenExpressionSchema,
  LanguagePresentExpressionSchema,
  SameVisualAreaExpressionSchema,
] as const;

type DslPreflightResult =
  | { readonly success: true; readonly value: unknown }
  | { readonly success: false; readonly issue: string };

function snapshotDslJson(value: unknown): DslPreflightResult {
  const result = snapshotJsonValue(value, {
    maxDepth: DSL_LIMITS.maxJsonDepth,
    maxNodes: DSL_LIMITS.maxJsonNodes,
    maxCanonicalBytes: DSL_LIMITS.maxRuleCanonicalBytes,
    rejectNegativeZero: true,
    rejectUnsafeIntegers: true,
  });
  return result.success
    ? { success: true, value: result.value }
    : { success: false, issue: result.issue };
}

function preflightExpression(value: unknown): DslPreflightResult {
  const jsonResult = snapshotDslJson(value);
  if (!jsonResult.success) return jsonResult;

  const stack: Array<{ readonly value: unknown; readonly depth: number }> = [
    { value: jsonResult.value, depth: 1 },
  ];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    /* v8 ignore next -- the loop condition guarantees a populated stack */
    if (current === undefined) break;
    nodes += 1;
    if (nodes > DSL_LIMITS.maxExpressionNodes) {
      return { success: false, issue: "Expression node limit exceeded" };
    }
    if (current.depth > DSL_LIMITS.maxExpressionDepth) {
      return { success: false, issue: "Expression depth limit exceeded" };
    }
    if (
      current.value === null ||
      typeof current.value !== "object" ||
      Array.isArray(current.value)
    ) {
      continue;
    }
    const candidate = current.value as Readonly<Record<string, unknown>>;
    if (
      (candidate["op"] === "all" || candidate["op"] === "any") &&
      Array.isArray(candidate["operands"])
    ) {
      if (candidate["operands"].length > DSL_LIMITS.maxLogicalOperands) {
        return { success: false, issue: "Logical operand limit exceeded" };
      }
      for (const operand of candidate["operands"]) {
        stack.push({ value: operand, depth: current.depth + 1 });
      }
    } else if (candidate["op"] === "not") {
      stack.push({ value: candidate["operand"], depth: current.depth + 1 });
    }
  }
  return { success: true, value: jsonResult.value };
}

const RecursiveDslExpressionSchema: z.ZodType<DslExpression> = z.lazy(() => {
  const allSchema = z
    .object({
      op: z.literal("all"),
      operands: z.array(RecursiveDslExpressionSchema).min(1).max(DSL_LIMITS.maxLogicalOperands),
    })
    .strict();
  const anySchema = z
    .object({
      op: z.literal("any"),
      operands: z.array(RecursiveDslExpressionSchema).min(1).max(DSL_LIMITS.maxLogicalOperands),
    })
    .strict();
  const notSchema = z
    .object({ op: z.literal("not"), operand: RecursiveDslExpressionSchema })
    .strict();
  return z.discriminatedUnion("op", [...LEAF_EXPRESSION_SCHEMAS, allSchema, anySchema, notSchema]);
});

function expressionNodeCount(expression: DslExpression): number {
  const stack = [expression];
  let count = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    /* v8 ignore next -- the loop condition guarantees a populated stack */
    if (current === undefined) break;
    count += 1;
    if (current.op === "all" || current.op === "any") stack.push(...current.operands);
    if (current.op === "not") stack.push(current.operand);
  }

  return count;
}

const ExpressionPreflightSchema = z.unknown().transform((value, context) => {
  const result = preflightExpression(value);
  if (!result.success) {
    context.addIssue({ code: "custom", message: result.issue, path: [] });
    return z.NEVER;
  }
  return result.value;
});

export const DslExpressionSchema = ExpressionPreflightSchema.pipe(
  RecursiveDslExpressionSchema,
) as z.ZodType<DslExpression>;

export const RuleExceptionDefinitionSchema = z
  .object({
    id: z.uuid(),
    key: StableKeySchema,
    when: DslExpressionSchema,
    reason: ReasonSchema,
    sourceVersionId: z.uuid(),
    sourceReference: SourceReferenceSchema,
  })
  .strict();

export type RuleExceptionDefinition = z.infer<typeof RuleExceptionDefinitionSchema>;

export const RuleOverrideDefinitionSchema = z
  .object({
    id: z.uuid(),
    overridingRuleId: z.uuid(),
    overriddenRuleId: z.uuid(),
    when: DslExpressionSchema,
    reason: ReasonSchema,
    sourceVersionId: z.uuid(),
    sourceReference: SourceReferenceSchema,
  })
  .strict()
  .superRefine(({ overridingRuleId, overriddenRuleId }, context) => {
    if (overridingRuleId === overriddenRuleId) {
      context.addIssue({
        code: "custom",
        message: "An override cannot target its overriding rule",
        path: ["overriddenRuleId"],
      });
    }
  });

export type RuleOverrideDefinition = z.infer<typeof RuleOverrideDefinitionSchema>;

export const RuleEvidenceBindingSchema = z
  .object({
    factKey: StableKeySchema,
    evidenceRequirementKeys: z
      .array(EvidenceRequirementKeySchema)
      .min(1)
      .max(DSL_LIMITS.maxEvidenceRequirementsPerFact),
  })
  .strict()
  .superRefine(({ evidenceRequirementKeys }, context) => {
    if (new Set(evidenceRequirementKeys).size !== evidenceRequirementKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Evidence requirement keys must be unique per fact",
        path: ["evidenceRequirementKeys"],
      });
    }
  });

export type RuleEvidenceBinding = z.infer<typeof RuleEvidenceBindingSchema>;

function addExpressionFactKeys(expression: DslExpression, keys: Set<string>): void {
  const stack = [expression];
  while (stack.length > 0) {
    const current = stack.pop();
    /* v8 ignore next -- the loop condition guarantees a populated stack */
    if (current === undefined) break;
    if (current.op === "all" || current.op === "any") {
      stack.push(...current.operands);
    } else if (current.op === "not") {
      stack.push(current.operand);
    } else if (current.op === "same_visual_area") {
      current.factKeys.forEach((key) => keys.add(key));
    } else if (current.op === "truth") {
      continue;
    } else {
      keys.add(current.factKey);
    }
  }
}

function addDuplicateIssues(
  values: readonly string[],
  path: "exceptions" | "overrides" | "conflictsWith" | "evidenceBindings",
  field: string | null,
  context: z.core.$RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate ${field ?? path}: ${value}`,
        path: field === null ? [path, index] : [path, index, field],
      });
    }
    seen.add(value);
  });
}

const RuleDefinitionHashInputShape = {
  dslVersion: z.literal(DSL_VERSION),
  state: z.literal("DRAFT"),
  id: z.uuid(),
  sourceId: z.uuid(),
  sourceVersionId: z.uuid(),
  sourceContentHash: Sha256DigestSchema,
  ruleCardId: z.uuid(),
  ruleCardRevisionId: z.uuid(),
  ruleCardRevisionContentHash: Sha256DigestSchema,
  normativeKey: StableKeySchema,
  deonticCategory: DeonticCategorySchema,
  riskLevel: RiskLevelSchema,
  validity: ValidityIntervalSchema,
  appliesWhen: DslExpressionSchema,
  satisfiedWhen: DslExpressionSchema,
  exceptions: z.array(RuleExceptionDefinitionSchema).max(DSL_LIMITS.maxExceptions),
  overrides: z.array(RuleOverrideDefinitionSchema).max(DSL_LIMITS.maxOverrides),
  conflictsWith: z.array(z.uuid()).max(DSL_LIMITS.maxConflicts),
  evidenceBindings: z.array(RuleEvidenceBindingSchema).max(DSL_LIMITS.maxEvidenceBindings),
  unknownPolicy: z.literal("REVIEW"),
  validationScope: ValidationScopeSchema,
} as const;

const RuleDefinitionHashInputObjectSchema = z.object(RuleDefinitionHashInputShape).strict();
type RuleDefinitionHashInputData = z.infer<typeof RuleDefinitionHashInputObjectSchema>;

function refineRuleDefinition(
  rule: RuleDefinitionHashInputData,
  context: z.core.$RefinementCtx,
): void {
  addDuplicateIssues(
    rule.exceptions.map(({ id }) => id),
    "exceptions",
    "id",
    context,
  );
  addDuplicateIssues(
    rule.exceptions.map(({ key }) => key),
    "exceptions",
    "key",
    context,
  );
  addDuplicateIssues(
    rule.overrides.map(({ id }) => id),
    "overrides",
    "id",
    context,
  );
  addDuplicateIssues(
    rule.overrides.map(({ overriddenRuleId }) => overriddenRuleId),
    "overrides",
    "overriddenRuleId",
    context,
  );
  addDuplicateIssues(rule.conflictsWith, "conflictsWith", null, context);
  addDuplicateIssues(
    rule.evidenceBindings.map(({ factKey }) => factKey),
    "evidenceBindings",
    "factKey",
    context,
  );

  rule.overrides.forEach((override, index) => {
    if (override.overridingRuleId !== rule.id) {
      context.addIssue({
        code: "custom",
        message: "Override direction must originate from this rule",
        path: ["overrides", index, "overridingRuleId"],
      });
    }
  });
  rule.conflictsWith.forEach((conflictingRuleId, index) => {
    if (conflictingRuleId === rule.id) {
      context.addIssue({
        code: "custom",
        message: "A rule cannot conflict with itself",
        path: ["conflictsWith", index],
      });
    }
  });

  const expressions = [
    rule.appliesWhen,
    rule.satisfiedWhen,
    ...rule.exceptions.map(({ when }) => when),
    ...rule.overrides.map(({ when }) => when),
  ];
  const ruleNodeCount = expressions.reduce(
    (total, expression) => total + expressionNodeCount(expression),
    0,
  );
  if (ruleNodeCount > DSL_LIMITS.maxRuleExpressionNodes) {
    context.addIssue({
      code: "custom",
      message: `A rule cannot exceed ${String(DSL_LIMITS.maxRuleExpressionNodes)} expression nodes`,
      path: [],
    });
  }

  const referencedFactKeys = new Set<string>();
  expressions.forEach((expression) => {
    addExpressionFactKeys(expression, referencedFactKeys);
  });
  const boundFactKeys = new Set(rule.evidenceBindings.map(({ factKey }) => factKey));
  for (const factKey of referencedFactKeys) {
    if (!boundFactKeys.has(factKey)) {
      context.addIssue({
        code: "custom",
        message: `Referenced fact has no evidence binding: ${factKey}`,
        path: ["evidenceBindings"],
      });
    }
  }
  rule.evidenceBindings.forEach(({ factKey }, index) => {
    if (!referencedFactKeys.has(factKey)) {
      context.addIssue({
        code: "custom",
        message: `Evidence binding does not reference a fact used by the rule: ${factKey}`,
        path: ["evidenceBindings", index, "factKey"],
      });
    }
  });
}

const RulePreflightSchema = z.unknown().transform((value, context) => {
  const result = snapshotDslJson(value);
  if (!result.success) {
    context.addIssue({ code: "custom", message: result.issue, path: [] });
    return z.NEVER;
  }
  return result.value;
});

const RefinedRuleDefinitionHashInputSchema =
  RuleDefinitionHashInputObjectSchema.superRefine(refineRuleDefinition);

export const RuleDefinitionHashInputSchema = RulePreflightSchema.pipe(
  RefinedRuleDefinitionHashInputSchema,
) as z.ZodType<RuleDefinitionHashInputData>;

export type RuleDefinitionHashInput = z.infer<typeof RuleDefinitionHashInputSchema>;

/** Hashes the exact validated DSL draft before its declared content hash is attached. */
export function computeRuleDefinitionHash(input: RuleDefinitionHashInput): string {
  return sha256CanonicalJson(RuleDefinitionHashInputSchema.parse(input));
}

const RuleDefinitionCandidateObjectSchema = z
  .object({ ...RuleDefinitionHashInputShape, contentHash: Sha256DigestSchema })
  .strict();

const RefinedRuleDefinitionCandidateSchema = RuleDefinitionCandidateObjectSchema.superRefine(
  (rule, context) => {
    const { contentHash, ...hashInput } = rule;
    refineRuleDefinition(hashInput, context);
    if (contentHash !== sha256CanonicalJson(hashInput)) {
      context.addIssue({
        code: "custom",
        message: "contentHash does not match the canonical RuleDefinition draft",
        path: ["contentHash"],
      });
    }
  },
);

export const RuleDefinitionSchema = RulePreflightSchema.pipe(
  RefinedRuleDefinitionCandidateSchema,
) as z.ZodType<z.infer<typeof RuleDefinitionCandidateObjectSchema>>;

export type RuleDefinition = z.infer<typeof RuleDefinitionSchema>;

/** Verifies both the declared hash and every semantic invariant on a detached rule snapshot. */
export function verifyRuleDefinitionHash(rule: unknown): boolean {
  return RuleDefinitionSchema.safeParse(rule).success;
}

function addRuleCardBindingIssue(
  condition: boolean,
  message: string,
  path: readonly PropertyKey[],
  context: z.core.$RefinementCtx,
): void {
  if (condition) return;
  context.addIssue({ code: "custom", message, path: [...path] });
}

function refineRuleCardBinding(
  rule: RuleDefinition,
  revision: RuleCardRevision,
  context: z.core.$RefinementCtx,
): void {
  const scalarBindings = [
    [
      rule.ruleCardId === revision.cardId,
      "Rule Card ID does not match the bound revision",
      "ruleCardId",
    ],
    [
      rule.ruleCardRevisionId === revision.id,
      "Rule Card revision ID does not match",
      "ruleCardRevisionId",
    ],
    [
      rule.ruleCardRevisionContentHash === revision.contentHash,
      "Rule Card revision hash does not match",
      "ruleCardRevisionContentHash",
    ],
    [rule.sourceId === revision.sourceId, "Source ID does not match the Rule Card", "sourceId"],
    [
      rule.sourceVersionId === revision.sourceVersionId,
      "Source version does not match the Rule Card",
      "sourceVersionId",
    ],
    [
      rule.sourceContentHash === revision.sourceContentHash,
      "Source hash does not match the Rule Card",
      "sourceContentHash",
    ],
    [
      rule.normativeKey === revision.normativeKey,
      "Normative key does not match the Rule Card",
      "normativeKey",
    ],
    [
      rule.deonticCategory === revision.deonticCategory,
      "Deontic category does not match the Rule Card",
      "deonticCategory",
    ],
    [
      rule.riskLevel ===
        effectiveRisk([revision.riskLevel, revision.falsePositiveCost, revision.falseNegativeCost]),
      "Risk level must preserve the Rule Card effective risk",
      "riskLevel",
    ],
    [
      rule.validity.validFrom === revision.validity.validFrom &&
        rule.validity.validTo === revision.validity.validTo,
      "Validity must exactly match the Rule Card revision snapshot",
      "validity",
    ],
  ] as const;
  for (const [condition, message, path] of scalarBindings) {
    addRuleCardBindingIssue(condition, message, ["rule", path], context);
  }

  const revisionExceptions = new Map(revision.exceptions.map((item) => [item.key, item]));
  const ruleExceptionKeys = new Set(rule.exceptions.map(({ key }) => key));
  rule.exceptions.forEach((exception, index) => {
    const expected = revisionExceptions.get(exception.key);
    addRuleCardBindingIssue(
      expected !== undefined &&
        exception.sourceVersionId === revision.sourceVersionId &&
        exception.sourceReference === expected.sourceReference,
      `Exception is not traceable to the bound Rule Card revision: ${exception.key}`,
      ["rule", "exceptions", index],
      context,
    );
  });
  for (const key of revisionExceptions.keys()) {
    addRuleCardBindingIssue(
      ruleExceptionKeys.has(key),
      `Rule Card exception is missing from the rule: ${key}`,
      ["rule", "exceptions"],
      context,
    );
  }

  const expectedEvidenceKeys = new Set(revision.evidenceRequirements.map(({ key }) => key));
  const boundEvidenceKeys = new Set(
    rule.evidenceBindings.flatMap(({ evidenceRequirementKeys }) => evidenceRequirementKeys),
  );
  for (const key of boundEvidenceKeys) {
    addRuleCardBindingIssue(
      expectedEvidenceKeys.has(key),
      `Evidence requirement is not present in the bound Rule Card revision: ${key}`,
      ["rule", "evidenceBindings"],
      context,
    );
  }
  for (const key of expectedEvidenceKeys) {
    addRuleCardBindingIssue(
      boundEvidenceKeys.has(key),
      `Rule Card evidence requirement is not bound to a fact: ${key}`,
      ["rule", "evidenceBindings"],
      context,
    );
  }
}

/** Contextual boundary required before a RuleDefinition may enter a Rule Pack. */
export const RuleDefinitionBindingSchema = z
  .object({
    rule: RuleDefinitionSchema,
    ruleCardRevision: RuleCardRevisionSchema,
  })
  .strict()
  .superRefine(({ rule, ruleCardRevision }, context) => {
    refineRuleCardBinding(rule, ruleCardRevision, context);
  });

export type RuleDefinitionBinding = z.infer<typeof RuleDefinitionBindingSchema>;

const generatedRuleDefinitionJsonSchema = z.toJSONSchema(RuleDefinitionCandidateObjectSchema, {
  target: "draft-2020-12",
  io: "output",
  cycles: "ref",
  reused: "ref",
}) as Record<string, unknown>;
generatedRuleDefinitionJsonSchema["$id"] =
  "https://vera.local/schemas/rule-definition-vera.dsl-v1.schema.json";
generatedRuleDefinitionJsonSchema["title"] = "VERA RuleDefinition vera.dsl/v1";

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

export const RuleDefinitionJsonSchema = deepFreeze(generatedRuleDefinitionJsonSchema);
/** Pinned schema identity for `vera.dsl/v1`; schema drift requires an explicit reviewed update. */
export const RULE_DEFINITION_JSON_SCHEMA_HASH =
  "35b4925bacca9eb90487f543972cb9b603ca15b603aa074c92a9c9ae1952b01d";
