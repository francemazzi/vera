import { types as nodeUtilTypes } from "node:util";

import {
  canonicalizeJson,
  DslExpressionSchema,
  EvidenceSchema,
  ExpressionTraceSchema,
  FactSchema,
  JsonValueSchema,
  RuleDefinitionSchema,
  RuleFindingSchema,
  UtcDateTimeSchema,
  allTruth,
  anyTruth,
  deriveRuleFinding,
  isWithinValidityInterval,
  negateTruth,
  sha256Bytes,
} from "@vera/contracts";
import type {
  DslExpression,
  EvaluationTraceReason,
  Evidence,
  ExpressionTrace,
  ExtractionFact,
  JsonValue,
  ResolvedFact,
  RuleDefinition,
  RuleFinding,
  RuleOverrideTrace,
  TruthValue,
} from "@vera/contracts";
import { RE2JS } from "re2js";

import {
  compareIsoDates,
  compareJsonNumbers,
  isoDateIsBetween,
  jsonNumberIsBetween,
  normalizeSemanticText,
  sameVisualArea,
  semanticTextContains,
  semanticTextEquals,
} from "./dsl-semantic-primitives.js";

const MAX_EVALUATION_FACTS = 10_000;
const MAX_EVALUATION_EVIDENCE = 10_000;
const MAX_VISUAL_COMPARISONS = 4_096;
const MAX_INLINE_TRACE_VALUE_BYTES = 512;
const MAX_PROXY_PREFLIGHT_NODES = 50_000;
const MAX_PROXY_PREFLIGHT_DEPTH = 64;

interface EvaluationContext {
  readonly factsByKey: ReadonlyMap<string, ExtractionFact>;
  readonly evidenceById: ReadonlyMap<string, Evidence>;
}

interface FactAccessSuccess {
  readonly success: true;
  readonly fact: ResolvedFact;
  readonly evidence: readonly Evidence[];
}

interface FactAccessFailure {
  readonly success: false;
  readonly reason: EvaluationTraceReason;
  readonly observed: JsonValue | null;
  readonly evidenceIds: readonly string[];
}

type FactAccess = FactAccessSuccess | FactAccessFailure;

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function truthFromBoolean(value: boolean): TruthValue {
  return value ? "TRUE" : "FALSE";
}

/**
 * Rejects Proxy values before any schema, reflection or collection operation can invoke a trap.
 * Only own data-property values are traversed; accessors are left untouched and rejected later by
 * the detached JSON schemas. This walk has no user-code callbacks for a Proxy-free object graph.
 */
function assertProxyFreeGraph(value: unknown, label: string): void {
  const stack: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 1 }];
  const seen = new Set<object>();
  let nodes = 0;
  while (stack.length > 0) {
    const currentEntry = stack.pop();
    /* v8 ignore next -- the loop condition guarantees a populated stack */
    if (currentEntry === undefined) break;
    const { value: current, depth } = currentEntry;
    if (current === null || (typeof current !== "object" && typeof current !== "function")) {
      continue;
    }
    if (nodeUtilTypes.isProxy(current)) {
      throw new TypeError(`${label} cannot contain Proxy values`);
    }
    if (seen.has(current)) continue;
    seen.add(current);
    nodes += 1;
    if (nodes > MAX_PROXY_PREFLIGHT_NODES) {
      throw new RangeError(`${label} Proxy preflight node limit exceeded`);
    }
    if (depth > MAX_PROXY_PREFLIGHT_DEPTH) {
      throw new RangeError(`${label} Proxy preflight depth limit exceeded`);
    }

    const prototype = Object.getPrototypeOf(current) as object | null;
    if (prototype !== null && nodeUtilTypes.isProxy(prototype)) {
      throw new TypeError(`${label} cannot contain Proxy prototypes`);
    }
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      /* v8 ignore next -- ownKeys on a non-Proxy object returns existing own keys */
      if (descriptor === undefined) continue;
      if ("value" in descriptor) stack.push({ value: descriptor.value, depth: depth + 1 });
    }
  }
}

/**
 * A valid repeated AST can otherwise duplicate a 100k-string into a trace beyond the bounded
 * evaluation-output envelope. Values over the inline budget are represented by the SHA-256 of
 * their canonical JSON plus its UTF-8 byte and UTF-16 code-unit counts. Evaluation always uses the
 * full value; only the audit trace is projected, deterministically and without truncation claims.
 */
function boundedTraceValue(value: JsonValue | null): JsonValue | null {
  if (value === null) return null;
  const canonical = canonicalizeJson(value);
  const bytes = new TextEncoder().encode(canonical);
  if (bytes.byteLength <= MAX_INLINE_TRACE_VALUE_BYTES) return value;
  return {
    projection: "CANONICAL_JSON_SHA256_V1",
    sha256: sha256Bytes(bytes),
    canonicalBytes: bytes.byteLength,
    canonicalCodeUnits: canonical.length,
  };
}

function assertJsonPointer(path: string): void {
  if (path.length === 0 || path.length > 4_096 || !path.startsWith("/")) {
    throw new TypeError("Trace paths must be non-empty RFC 6901 JSON Pointers");
  }

  const tokens = path.slice(1).split("/");
  if (tokens.some((token) => token.length === 0)) {
    throw new TypeError("Trace paths must contain non-empty RFC 6901 tokens");
  }
  for (const token of tokens) {
    for (let index = 0; index < token.length; index += 1) {
      if (token[index] === "~" && token[index + 1] !== "0" && token[index + 1] !== "1") {
        throw new TypeError("Trace paths contain an invalid RFC 6901 escape");
      }
      if (token[index] === "~") index += 1;
    }
  }
}

function parseCollection<T>(
  value: unknown,
  label: string,
  limit: number,
  parse: (entry: unknown) => T,
): readonly T[] {
  assertProxyFreeGraph(value, label);
  const snapshot = JsonValueSchema.parse(value);
  if (!Array.isArray(snapshot)) {
    throw new TypeError(`${label} must be an array`);
  }
  if (snapshot.length > limit) {
    throw new RangeError(`${label} cannot exceed ${String(limit)} entries`);
  }
  return snapshot.map((entry) => parse(entry));
}

function createContext(
  factsInput: readonly ExtractionFact[],
  evidenceInput: readonly Evidence[],
): EvaluationContext {
  const facts = parseCollection(factsInput, "Facts", MAX_EVALUATION_FACTS, (fact) =>
    FactSchema.parse(fact),
  );
  const evidence = parseCollection(evidenceInput, "Evidence", MAX_EVALUATION_EVIDENCE, (item) =>
    EvidenceSchema.parse(item),
  );

  const factsByKey = new Map<string, ExtractionFact>();
  const factIds = new Set<string>();
  for (const fact of facts) {
    if (factIds.has(fact.id)) {
      throw new TypeError(`Facts contain duplicate ID: ${fact.id}`);
    }
    if (factsByKey.has(fact.key)) {
      throw new TypeError(`Facts contain duplicate key: ${fact.key}`);
    }
    factIds.add(fact.id);
    factsByKey.set(fact.key, fact);
  }

  const evidenceById = new Map<string, Evidence>();
  for (const item of evidence) {
    if (evidenceById.has(item.id)) {
      throw new TypeError(`Evidence contains duplicate ID: ${item.id}`);
    }
    evidenceById.set(item.id, item);
  }
  return { factsByKey, evidenceById };
}

interface LinkedEvidence {
  readonly items: readonly Evidence[];
  readonly complete: boolean;
}

function linkedEvidence(
  fact: ExtractionFact,
  evidenceById: ReadonlyMap<string, Evidence>,
): LinkedEvidence {
  const items = [...fact.evidenceIds]
    .sort()
    .map((id) => evidenceById.get(id))
    .filter(
      (item): item is Evidence => item !== undefined && item.providerRunId === fact.providerRunId,
    );
  return { items, complete: items.length === fact.evidenceIds.length };
}

function accessResolvedFact(
  factKey: string,
  expectedType: ResolvedFact["valueType"] | null,
  context: EvaluationContext,
): FactAccess {
  const fact = context.factsByKey.get(factKey);
  if (fact === undefined) {
    return {
      success: false,
      reason: "MISSING_FACT",
      observed: null,
      evidenceIds: [],
    };
  }
  const linked = linkedEvidence(fact, context.evidenceById);
  if (!linked.complete) {
    return {
      success: false,
      reason: "MISSING_EVIDENCE",
      observed: fact.status === "RESOLVED" ? fact.normalizedValue : null,
      evidenceIds: [],
    };
  }
  if (fact.status !== "RESOLVED") {
    return {
      success: false,
      reason: "UNRESOLVED_FACT",
      observed: null,
      evidenceIds: linked.items.map(({ id }) => id),
    };
  }

  const evidence = linked.items;
  if (expectedType !== null && fact.valueType !== expectedType) {
    return {
      success: false,
      reason: "TYPE_MISMATCH",
      observed: fact.normalizedValue,
      evidenceIds: evidence.map(({ id }) => id),
    };
  }
  return { success: true, fact, evidence };
}

function makeLeafTrace(
  path: string,
  op: DslExpression["op"],
  truth: TruthValue,
  reason: EvaluationTraceReason,
  factKeys: readonly string[],
  expected: JsonValue | null,
  observed: JsonValue | null,
  evidenceIds: readonly string[],
): ExpressionTrace {
  return {
    path,
    op,
    truth,
    reason,
    factKeys: sortedUnique(factKeys),
    expected: boundedTraceValue(expected),
    observed: boundedTraceValue(observed),
    evidenceIds: sortedUnique(evidenceIds),
    children: [],
  };
}

function traceAccessFailure(
  expression: DslExpression,
  path: string,
  factKey: string,
  expected: JsonValue | null,
  access: FactAccessFailure,
): ExpressionTrace {
  return makeLeafTrace(
    path,
    expression.op,
    "UNKNOWN",
    access.reason,
    [factKey],
    expected,
    access.observed,
    access.evidenceIds,
  );
}

function comparableEquals(
  fact: ResolvedFact,
  expected: Extract<DslExpression, { readonly op: "eq" | "not_eq" }>["expected"],
): boolean {
  switch (expected.type) {
    case "STRING":
      return semanticTextEquals(
        fact.normalizedValue as string,
        expected.value,
        expected.comparison,
      );
    case "NUMBER":
      return compareJsonNumbers(fact.normalizedValue, expected.value) === 0;
    case "BOOLEAN":
      return fact.normalizedValue === expected.value;
    case "DATE":
      return compareIsoDates(fact.normalizedValue as string, expected.value) === 0;
  }
}

function evaluateComparableExpression(
  expression: Extract<DslExpression, { readonly op: "eq" | "not_eq" }>,
  context: EvaluationContext,
  path: string,
): ExpressionTrace {
  const access = accessResolvedFact(expression.factKey, expression.expected.type, context);
  if (!access.success) {
    return traceAccessFailure(
      expression,
      path,
      expression.factKey,
      expression.expected.value,
      access,
    );
  }
  const equals = comparableEquals(access.fact, expression.expected);
  const truth = truthFromBoolean(expression.op === "eq" ? equals : !equals);
  return makeLeafTrace(
    path,
    expression.op,
    truth,
    "EVALUATED",
    [expression.factKey],
    expression.expected.value,
    access.fact.normalizedValue,
    access.evidence.map(({ id }) => id),
  );
}

function evaluatePresentExpression(
  expression: Extract<DslExpression, { readonly op: "present" }>,
  context: EvaluationContext,
  path: string,
): ExpressionTrace {
  const fact = context.factsByKey.get(expression.factKey);
  if (fact === undefined) {
    return makeLeafTrace(
      path,
      expression.op,
      "UNKNOWN",
      "MISSING_FACT",
      [expression.factKey],
      null,
      null,
      [],
    );
  }
  const linked = linkedEvidence(fact, context.evidenceById);
  if (!linked.complete) {
    return makeLeafTrace(
      path,
      expression.op,
      "UNKNOWN",
      "MISSING_EVIDENCE",
      [expression.factKey],
      null,
      fact.status === "RESOLVED" ? fact.normalizedValue : null,
      [],
    );
  }
  const evidence = linked.items;
  if (evidence.length === 0) {
    return makeLeafTrace(
      path,
      expression.op,
      "UNKNOWN",
      "MISSING_EVIDENCE",
      [expression.factKey],
      null,
      null,
      [],
    );
  }
  if (fact.status === "NOT_FOUND") {
    return makeLeafTrace(
      path,
      expression.op,
      "FALSE",
      "EVALUATED",
      [expression.factKey],
      null,
      null,
      evidence.map(({ id }) => id),
    );
  }
  if (fact.status !== "RESOLVED") {
    return makeLeafTrace(
      path,
      expression.op,
      "UNKNOWN",
      "UNRESOLVED_FACT",
      [expression.factKey],
      null,
      null,
      evidence.map(({ id }) => id),
    );
  }
  return makeLeafTrace(
    path,
    expression.op,
    "TRUE",
    "EVALUATED",
    [expression.factKey],
    null,
    fact.normalizedValue,
    evidence.map(({ id }) => id),
  );
}

function evaluateTextExpression(
  expression: Extract<DslExpression, { readonly op: "contains" | "contains_any" }>,
  context: EvaluationContext,
  path: string,
): ExpressionTrace {
  const expected: JsonValue =
    expression.op === "contains" ? expression.expected : [...expression.expected];
  const access = accessResolvedFact(expression.factKey, "STRING", context);
  if (!access.success) {
    return traceAccessFailure(expression, path, expression.factKey, expected, access);
  }
  const value = access.fact.normalizedValue as string;
  const matches =
    expression.op === "contains"
      ? semanticTextContains(value, expression.expected, expression.comparison)
      : expression.expected
          .map((candidate) => semanticTextContains(value, candidate, expression.comparison))
          .some(Boolean);
  return makeLeafTrace(
    path,
    expression.op,
    truthFromBoolean(matches),
    "EVALUATED",
    [expression.factKey],
    expected,
    value,
    access.evidence.map(({ id }) => id),
  );
}

function re2Flags(expression: Extract<DslExpression, { readonly op: "matches" }>): number {
  let flags = expression.caseSensitivity === "INSENSITIVE" ? RE2JS.CASE_INSENSITIVE : 0;
  if (expression.dotAll) flags |= RE2JS.DOTALL;
  if (expression.multiline) flags |= RE2JS.MULTILINE;
  return flags;
}

function evaluateMatchesExpression(
  expression: Extract<DslExpression, { readonly op: "matches" }>,
  context: EvaluationContext,
  path: string,
): ExpressionTrace {
  const expected = {
    pattern: expression.pattern,
    mode: expression.mode,
    normalization: expression.normalization,
    whitespace: expression.whitespace,
    caseSensitivity: expression.caseSensitivity,
    dotAll: expression.dotAll,
    multiline: expression.multiline,
    maxInputCharacters: expression.maxInputCharacters,
  } as const satisfies JsonValue;
  const access = accessResolvedFact(expression.factKey, "STRING", context);
  if (!access.success) {
    return traceAccessFailure(expression, path, expression.factKey, expected, access);
  }
  const value = normalizeSemanticText(access.fact.normalizedValue as string, {
    normalization: expression.normalization,
    whitespace: expression.whitespace,
    caseSensitivity: expression.caseSensitivity,
  });
  if (value.length > expression.maxInputCharacters) {
    return makeLeafTrace(
      path,
      expression.op,
      "UNKNOWN",
      "RESOURCE_LIMIT",
      [expression.factKey],
      expected,
      { inputCharacters: value.length },
      access.evidence.map(({ id }) => id),
    );
  }

  const compiled = RE2JS.compile(expression.pattern, re2Flags(expression));
  try {
    const matches = expression.mode === "FULL" ? compiled.testExact(value) : compiled.test(value);
    return makeLeafTrace(
      path,
      expression.op,
      truthFromBoolean(matches),
      "EVALUATED",
      [expression.factKey],
      expected,
      value,
      access.evidence.map(({ id }) => id),
    );
  } finally {
    compiled.reset();
  }
}

function evaluateNumericExpression(
  expression: Extract<DslExpression, { readonly op: "greater_than" | "less_than" | "between" }>,
  context: EvaluationContext,
  path: string,
): ExpressionTrace {
  const expected: JsonValue =
    expression.op === "between"
      ? {
          minimum: expression.minimum,
          maximum: expression.maximum,
          includeMinimum: expression.includeMinimum,
          includeMaximum: expression.includeMaximum,
        }
      : expression.expectedExclusive;
  const access = accessResolvedFact(expression.factKey, "NUMBER", context);
  if (!access.success) {
    return traceAccessFailure(expression, path, expression.factKey, expected, access);
  }

  const value = access.fact.normalizedValue;
  const matches =
    expression.op === "greater_than"
      ? compareJsonNumbers(value, expression.expectedExclusive) > 0
      : expression.op === "less_than"
        ? compareJsonNumbers(value, expression.expectedExclusive) < 0
        : jsonNumberIsBetween(value, expression.minimum, expression.maximum, {
            includeMinimum: expression.includeMinimum,
            includeMaximum: expression.includeMaximum,
          });
  return makeLeafTrace(
    path,
    expression.op,
    truthFromBoolean(matches),
    "EVALUATED",
    [expression.factKey],
    expected,
    value,
    access.evidence.map(({ id }) => id),
  );
}

function evaluateDateExpression(
  expression: Extract<
    DslExpression,
    { readonly op: "date_before" | "date_after" | "date_between" }
  >,
  context: EvaluationContext,
  path: string,
): ExpressionTrace {
  const expected: JsonValue =
    expression.op === "date_between"
      ? {
          minimum: expression.minimum,
          maximum: expression.maximum,
          includeMinimum: expression.includeMinimum,
          includeMaximum: expression.includeMaximum,
        }
      : expression.expectedExclusive;
  const access = accessResolvedFact(expression.factKey, "DATE", context);
  if (!access.success) {
    return traceAccessFailure(expression, path, expression.factKey, expected, access);
  }

  const value = access.fact.normalizedValue as string;
  const matches =
    expression.op === "date_before"
      ? compareIsoDates(value, expression.expectedExclusive) < 0
      : expression.op === "date_after"
        ? compareIsoDates(value, expression.expectedExclusive) > 0
        : isoDateIsBetween(value, expression.minimum, expression.maximum, {
            includeMinimum: expression.includeMinimum,
            includeMaximum: expression.includeMaximum,
          });
  return makeLeafTrace(
    path,
    expression.op,
    truthFromBoolean(matches),
    "EVALUATED",
    [expression.factKey],
    expected,
    value,
    access.evidence.map(({ id }) => id),
  );
}

function languageMatches(left: string, right: string, mode: "EXACT" | "PRIMARY"): boolean {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  if (mode === "EXACT") return normalizedLeft === normalizedRight;
  return normalizedLeft.split("-", 1)[0] === normalizedRight.split("-", 1)[0];
}

function evaluateLanguageExpression(
  expression: Extract<DslExpression, { readonly op: "language_present" }>,
  context: EvaluationContext,
  path: string,
): ExpressionTrace {
  const expected = {
    language: expression.language,
    matchMode: expression.matchMode,
  } as const satisfies JsonValue;
  const access = accessResolvedFact(expression.factKey, null, context);
  if (!access.success) {
    return traceAccessFailure(expression, path, expression.factKey, expected, access);
  }
  const matchingEvidence = access.evidence.filter(({ language }) =>
    languageMatches(language, expression.language, expression.matchMode),
  );
  const matches = matchingEvidence.length > 0;
  return makeLeafTrace(
    path,
    expression.op,
    truthFromBoolean(matches),
    "EVALUATED",
    [expression.factKey],
    expected,
    access.evidence.map(({ language }) => language),
    (matches ? matchingEvidence : access.evidence).map(({ id }) => id),
  );
}

interface VisualSearchResult {
  readonly selected: readonly Evidence[] | null;
  readonly comparisons: number;
  readonly exhaustedBudget: boolean;
}

function searchCompatibleVisualEvidence(
  candidates: readonly (readonly Evidence[])[],
  maximumGap: number,
): VisualSearchResult {
  let comparisons = 0;
  let exhaustedBudget = false;
  const selected: Evidence[] = [];

  function visit(index: number): readonly Evidence[] | null {
    if (index === candidates.length) return [...selected];
    const currentCandidates = candidates[index];
    /* v8 ignore next -- index is strictly below candidates.length after the equality guard */
    if (currentCandidates === undefined) return null;

    for (const candidate of currentCandidates) {
      let compatible = true;
      for (const previous of selected) {
        if (comparisons >= MAX_VISUAL_COMPARISONS) {
          exhaustedBudget = true;
          return null;
        }
        comparisons += 1;
        if (
          !sameVisualArea(
            {
              documentId: previous.documentId,
              documentHash: previous.documentHash,
              page: previous.page,
              boundingBox: previous.boundingBox,
            },
            {
              documentId: candidate.documentId,
              documentHash: candidate.documentHash,
              page: candidate.page,
              boundingBox: candidate.boundingBox,
            },
            maximumGap,
          )
        ) {
          compatible = false;
        }
      }
      if (!compatible) continue;

      selected.push(candidate);
      const result = visit(index + 1);
      selected.pop();
      if (result !== null || exhaustedBudget) return result;
    }
    return null;
  }

  return { selected: visit(0), comparisons, exhaustedBudget };
}

function evaluateVisualExpression(
  expression: Extract<DslExpression, { readonly op: "same_visual_area" }>,
  context: EvaluationContext,
  path: string,
): ExpressionTrace {
  const expected = {
    maxNormalizedGap: expression.maxNormalizedGap,
    quantifier: expression.quantifier,
    requireSameDocument: expression.requireSameDocument,
    requireSamePage: expression.requireSamePage,
  } as const satisfies JsonValue;
  const candidates: Array<readonly Evidence[]> = [];
  const allAvailableEvidence: Evidence[] = [];

  for (const factKey of expression.factKeys) {
    const access = accessResolvedFact(factKey, null, context);
    if (!access.success) {
      return makeLeafTrace(
        path,
        expression.op,
        "UNKNOWN",
        access.reason,
        expression.factKeys,
        expected,
        access.observed,
        access.evidenceIds,
      );
    }
    candidates.push(access.evidence);
    allAvailableEvidence.push(...access.evidence);
  }

  const result = searchCompatibleVisualEvidence(candidates, expression.maxNormalizedGap);
  const observed = {
    candidateCounts: candidates.map(({ length }) => length),
    comparisons: result.comparisons,
  } as const satisfies JsonValue;
  if (result.exhaustedBudget) {
    return makeLeafTrace(
      path,
      expression.op,
      "UNKNOWN",
      "RESOURCE_LIMIT",
      expression.factKeys,
      expected,
      observed,
      allAvailableEvidence.map(({ id }) => id),
    );
  }
  const matches = result.selected !== null;
  return makeLeafTrace(
    path,
    expression.op,
    truthFromBoolean(matches),
    "EVALUATED",
    expression.factKeys,
    expected,
    observed,
    (result.selected ?? allAvailableEvidence).map(({ id }) => id),
  );
}

function evaluateLogicalExpression(
  expression: Extract<DslExpression, { readonly op: "all" | "any" | "not" }>,
  context: EvaluationContext,
  path: string,
): ExpressionTrace {
  let children: readonly ExpressionTrace[];
  let truth: TruthValue;
  if (expression.op === "not") {
    const child = evaluateParsedExpression(expression.operand, context, `${path}/operand`);
    children = [child];
    truth = negateTruth(child.truth);
  } else {
    children = expression.operands.map((operand, index) =>
      evaluateParsedExpression(operand, context, `${path}/operands/${String(index)}`),
    );
    truth =
      expression.op === "all"
        ? allTruth(children.map(({ truth: childTruth }) => childTruth))
        : anyTruth(children.map(({ truth: childTruth }) => childTruth));
  }
  return {
    path,
    op: expression.op,
    truth,
    reason: "EVALUATED",
    factKeys: sortedUnique(children.flatMap(({ factKeys }) => factKeys)),
    expected: null,
    observed: null,
    evidenceIds: sortedUnique(children.flatMap(({ evidenceIds }) => evidenceIds)),
    children,
  };
}

function evaluateParsedExpression(
  expression: DslExpression,
  context: EvaluationContext,
  path: string,
): ExpressionTrace {
  switch (expression.op) {
    case "truth":
      return makeLeafTrace(
        path,
        expression.op,
        expression.value,
        "EVALUATED",
        [],
        expression.value,
        expression.value,
        [],
      );
    case "present":
      return evaluatePresentExpression(expression, context, path);
    case "eq":
    case "not_eq":
      return evaluateComparableExpression(expression, context, path);
    case "contains":
    case "contains_any":
      return evaluateTextExpression(expression, context, path);
    case "matches":
      return evaluateMatchesExpression(expression, context, path);
    case "greater_than":
    case "less_than":
    case "between":
      return evaluateNumericExpression(expression, context, path);
    case "date_before":
    case "date_after":
    case "date_between":
      return evaluateDateExpression(expression, context, path);
    case "language_present":
      return evaluateLanguageExpression(expression, context, path);
    case "same_visual_area":
      return evaluateVisualExpression(expression, context, path);
    case "all":
    case "any":
    case "not":
      return evaluateLogicalExpression(expression, context, path);
  }
}

/** Evaluates one detached, validated expression without I/O or host-language execution. */
export function evaluateExpression(
  expressionInput: DslExpression,
  factsInput: readonly ExtractionFact[],
  evidenceInput: readonly Evidence[],
  path = "/expression",
): ExpressionTrace {
  assertProxyFreeGraph(expressionInput, "Expression");
  assertJsonPointer(path);
  const expression = DslExpressionSchema.parse(expressionInput);
  const context = createContext(factsInput, evidenceInput);
  return ExpressionTraceSchema.parse(evaluateParsedExpression(expression, context, path));
}

function findingEvidenceIds(
  appliesWhen: ExpressionTrace,
  exceptionTraces: readonly ExpressionTrace[],
  satisfiedWhen: ExpressionTrace | null,
  overrideTraces: readonly RuleOverrideTrace[],
): readonly string[] {
  return sortedUnique([
    ...appliesWhen.evidenceIds,
    ...exceptionTraces.flatMap(({ evidenceIds }) => evidenceIds),
    ...(satisfiedWhen?.evidenceIds ?? []),
    ...overrideTraces.flatMap(({ trace }) => trace.evidenceIds),
  ]);
}

/** Evaluates one valid Rule Definition; temporal selection remains an explicit precondition. */
export function evaluateRule(
  ruleInput: RuleDefinition,
  factsInput: readonly ExtractionFact[],
  evidenceInput: readonly Evidence[],
  evaluationDateInput: string,
): RuleFinding {
  assertProxyFreeGraph(ruleInput, "Rule Definition");
  const rule = RuleDefinitionSchema.parse(ruleInput);
  const evaluationDate = UtcDateTimeSchema.parse(evaluationDateInput);
  if (!isWithinValidityInterval(rule.validity, evaluationDate)) {
    throw new RangeError("Rule is not valid at the requested evaluation date");
  }
  const context = createContext(factsInput, evidenceInput);
  const appliesWhen = evaluateParsedExpression(rule.appliesWhen, context, "/appliesWhen");

  const exceptionTraces =
    appliesWhen.truth === "TRUE"
      ? rule.exceptions.map(({ when }, index) =>
          evaluateParsedExpression(when, context, `/exceptions/${String(index)}/when`),
        )
      : [];
  const exceptionTruth =
    exceptionTraces.length === 0 ? "FALSE" : anyTruth(exceptionTraces.map(({ truth }) => truth));
  const shouldEvaluateOperativeConditions =
    appliesWhen.truth === "TRUE" && exceptionTruth === "FALSE";
  const satisfiedWhen = shouldEvaluateOperativeConditions
    ? evaluateParsedExpression(rule.satisfiedWhen, context, "/satisfiedWhen")
    : null;
  const overrideTraces: readonly RuleOverrideTrace[] = shouldEvaluateOperativeConditions
    ? rule.overrides.map(({ id, overriddenRuleId, when }, index) => ({
        overrideId: id,
        overriddenRuleId,
        trace: evaluateParsedExpression(when, context, `/overrides/${String(index)}/when`),
      }))
    : [];
  const outcome = deriveRuleFinding(
    appliesWhen.truth,
    exceptionTruth,
    satisfiedWhen?.truth ?? null,
  );

  return RuleFindingSchema.parse({
    ruleId: rule.id,
    ruleContentHash: rule.contentHash,
    evaluationDate,
    outcome,
    appliesWhen,
    exceptionTraces,
    satisfiedWhen,
    overrideTraces,
    evidenceIds: findingEvidenceIds(appliesWhen, exceptionTraces, satisfiedWhen, overrideTraces),
    validationScope: rule.validationScope,
  });
}
