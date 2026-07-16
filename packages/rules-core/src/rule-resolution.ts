import {
  EvaluationResultSchema,
  RuleDefinitionSchema,
  RuleFindingSchema,
  aggregateOutcomes,
  canonicalizeJson,
  type EvaluationOutcome,
  type EvaluationResult,
  type ResolvedRuleFinding,
  type RuleDefinition,
  type RuleFinding,
  type RuleOverrideDefinition,
  type RuleOverrideTrace,
} from "@vera/contracts";

import { utcDateTimeIntervalsOverlap } from "./dsl-semantic-primitives.js";

type RuleId = string;
const MAX_RESOLUTION_ITEMS = 10_000;
const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/u;

interface OverrideEdge {
  readonly definition: RuleOverrideDefinition;
  readonly trace: RuleOverrideTrace;
}

interface ResolutionState {
  readonly finding: RuleFinding;
  resolution: ResolvedRuleFinding["resolution"];
  effectiveOutcome: EvaluationOutcome;
  readonly relatedRuleIds: Set<RuleId>;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareRules(left: RuleDefinition, right: RuleDefinition): number {
  return compareStrings(left.id, right.id) || compareStrings(left.contentHash, right.contentHash);
}

function compareFindings(left: RuleFinding, right: RuleFinding): number {
  return (
    compareStrings(left.ruleId, right.ruleId) ||
    compareStrings(left.ruleContentHash, right.ruleContentHash) ||
    compareStrings(left.evaluationDate, right.evaluationDate) ||
    compareStrings(left.outcome, right.outcome) ||
    compareStrings(canonicalizeJson(left), canonicalizeJson(right))
  );
}

function parseBoundedArray<T>(
  input: readonly unknown[],
  label: string,
  parse: (value: unknown) => T,
): readonly T[] {
  if (!Array.isArray(input)) throw new TypeError(`${label} must be an array`);

  const prototype = Object.getPrototypeOf(input) as object | null;
  const ownKeys = Reflect.ownKeys(input);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
  if (
    prototype !== Array.prototype ||
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    throw new TypeError(`${label} must be a plain dense array`);
  }

  const length = lengthDescriptor.value as number;
  if (length > MAX_RESOLUTION_ITEMS) {
    throw new RangeError(`${label} cannot exceed ${String(MAX_RESOLUTION_ITEMS)} entries`);
  }
  const stringKeys = ownKeys.filter((key): key is string => typeof key === "string");
  if (
    ownKeys.some((key) => typeof key === "symbol") ||
    stringKeys.length !== length + 1 ||
    !stringKeys.includes("length") ||
    stringKeys.some((key) => key !== "length" && (!ARRAY_INDEX.test(key) || Number(key) >= length))
  ) {
    throw new TypeError(`${label} must not contain sparse entries or custom properties`);
  }

  const result: T[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label} entries must be enumerable data properties`);
    }
    result.push(parse(descriptor.value));
  }
  return Object.freeze(result);
}

function addToSetMap(map: Map<RuleId, Set<RuleId>>, key: RuleId, value: RuleId): void {
  const values = map.get(key);
  if (values === undefined) {
    map.set(key, new Set([value]));
  } else {
    values.add(value);
  }
}

function addUndirectedRelation(map: Map<RuleId, Set<RuleId>>, left: RuleId, right: RuleId): void {
  if (left === right) return;
  addToSetMap(map, left, right);
  addToSetMap(map, right, left);
}

function addDirectedEdge(map: Map<RuleId, Set<RuleId>>, source: RuleId, target: RuleId): void {
  addToSetMap(map, source, target);
  if (!map.has(target)) map.set(target, new Set());
}

function uniqueByRuleId<T extends { readonly ruleId: string }>(
  values: readonly T[],
  duplicateIds: Set<RuleId>,
): Map<RuleId, T> {
  const result = new Map<RuleId, T>();
  for (const value of values) {
    if (result.has(value.ruleId)) {
      duplicateIds.add(value.ruleId);
    } else {
      result.set(value.ruleId, value);
    }
  }
  return result;
}

function uniqueRules(
  values: readonly RuleDefinition[],
  duplicateIds: Set<RuleId>,
): Map<RuleId, RuleDefinition> {
  const result = new Map<RuleId, RuleDefinition>();
  for (const value of values) {
    if (result.has(value.id)) {
      duplicateIds.add(value.id);
    } else {
      result.set(value.id, value);
    }
  }
  return result;
}

/**
 * Returns every node that participates in a directed cycle. The iterative walk
 * avoids making graph size an implicit JavaScript call-stack limit.
 */
function findCycleNodes(adjacency: ReadonlyMap<RuleId, ReadonlySet<RuleId>>): Set<RuleId> {
  const color = new Map<RuleId, 0 | 1 | 2>();
  const cyclic = new Set<RuleId>();
  const sortedNodes = [...adjacency.keys()].sort(compareStrings);

  interface Frame {
    readonly id: RuleId;
    readonly neighbors: readonly RuleId[];
    nextIndex: number;
  }

  for (const start of sortedNodes) {
    if ((color.get(start) ?? 0) !== 0) continue;

    const path: RuleId[] = [];
    const pathIndex = new Map<RuleId, number>();
    const stack: Frame[] = [];
    const push = (id: RuleId): void => {
      color.set(id, 1);
      pathIndex.set(id, path.length);
      path.push(id);
      stack.push({
        id,
        neighbors: [...(adjacency.get(id) ?? [])].sort(compareStrings),
        nextIndex: 0,
      });
    };

    push(start);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      /* v8 ignore next -- the loop condition guarantees a populated stack */
      if (frame === undefined) break;
      const neighbor = frame.neighbors[frame.nextIndex];
      if (neighbor === undefined) {
        stack.pop();
        path.pop();
        pathIndex.delete(frame.id);
        color.set(frame.id, 2);
        continue;
      }

      frame.nextIndex += 1;
      const neighborColor = color.get(neighbor) ?? 0;
      if (neighborColor === 0) {
        push(neighbor);
      } else if (neighborColor === 1) {
        const cycleStart = pathIndex.get(neighbor);
        /* v8 ignore next -- a gray node is necessarily present in the active path */
        if (cycleStart === undefined) continue;
        for (let index = cycleStart; index < path.length; index += 1) {
          const cycleNode = path[index];
          /* v8 ignore next -- the loop bounds guarantee an existing path element */
          if (cycleNode !== undefined) cyclic.add(cycleNode);
        }
      }
    }
  }

  return cyclic;
}

function propagateInvalidComponents(
  invalidIds: Set<RuleId>,
  overrideNeighbors: ReadonlyMap<RuleId, ReadonlySet<RuleId>>,
  knownIds: ReadonlySet<RuleId>,
): void {
  const queue = [...invalidIds].filter((id) => knownIds.has(id)).sort(compareStrings);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    /* v8 ignore next -- the loop bounds guarantee an existing queue element */
    if (current === undefined) continue;
    const neighbors = [...(overrideNeighbors.get(current) ?? [])].sort(compareStrings);
    for (const neighbor of neighbors) {
      if (!knownIds.has(neighbor) || invalidIds.has(neighbor)) continue;
      invalidIds.add(neighbor);
      queue.push(neighbor);
    }
  }
}

function topologicalRuleOrder(
  ruleIds: readonly RuleId[],
  edges: readonly OverrideEdge[],
): readonly RuleId[] {
  const allowed = new Set(ruleIds);
  const indegree = new Map<RuleId, number>(ruleIds.map((id) => [id, 0]));
  const outgoing = new Map<RuleId, RuleId[]>();

  for (const { definition } of edges) {
    const source = definition.overridingRuleId;
    const target = definition.overriddenRuleId;
    if (!allowed.has(source) || !allowed.has(target)) continue;
    outgoing.set(source, [...(outgoing.get(source) ?? []), target]);
    indegree.set(target, (indegree.get(target) ?? 0) + 1);
  }

  const ready = ruleIds.filter((id) => indegree.get(id) === 0).sort(compareStrings);
  const result: RuleId[] = [];
  while (ready.length > 0) {
    const current = ready.shift();
    /* v8 ignore next -- ready was checked immediately before shift */
    if (current === undefined) break;
    result.push(current);
    for (const target of [...(outgoing.get(current) ?? [])].sort(compareStrings)) {
      const nextIndegree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(target);
        ready.sort(compareStrings);
      }
    }
  }

  return result;
}

function markUncertainOverride(
  states: ReadonlyMap<RuleId, ResolutionState>,
  leftId: RuleId,
  rightId: RuleId,
): void {
  const left = states.get(leftId);
  const right = states.get(rightId);
  if (
    left === undefined ||
    right === undefined ||
    left.resolution === "INVALID_OVERRIDE_GRAPH" ||
    right.resolution === "INVALID_OVERRIDE_GRAPH"
  ) {
    return;
  }

  if (left.resolution !== "UNCERTAIN_OVERRIDE") {
    left.relatedRuleIds.clear();
  }
  left.resolution = "UNCERTAIN_OVERRIDE";
  left.effectiveOutcome = "REVIEW";
  left.relatedRuleIds.add(rightId);
  if (right.resolution !== "UNCERTAIN_OVERRIDE") {
    right.relatedRuleIds.clear();
  }
  right.resolution = "UNCERTAIN_OVERRIDE";
  right.effectiveOutcome = "REVIEW";
  right.relatedRuleIds.add(leftId);
}

function markConflict(state: ResolutionState, relatedRuleId: RuleId): void {
  if (state.resolution === "INVALID_OVERRIDE_GRAPH" || state.resolution === "UNCERTAIN_OVERRIDE") {
    return;
  }
  if (state.resolution !== "CONFLICT_REVIEW") {
    state.relatedRuleIds.clear();
  }
  state.resolution = "CONFLICT_REVIEW";
  state.effectiveOutcome = "REVIEW";
  state.relatedRuleIds.add(relatedRuleId);
}

function resolveConflictPair(
  states: ReadonlyMap<RuleId, ResolutionState>,
  leftId: RuleId,
  rightId: RuleId,
): void {
  const left = states.get(leftId);
  const right = states.get(rightId);
  if (
    left === undefined ||
    right === undefined ||
    left.resolution === "INVALID_OVERRIDE_GRAPH" ||
    right.resolution === "INVALID_OVERRIDE_GRAPH" ||
    left.resolution === "UNCERTAIN_OVERRIDE" ||
    right.resolution === "UNCERTAIN_OVERRIDE" ||
    left.effectiveOutcome === "NOT_APPLICABLE" ||
    right.effectiveOutcome === "NOT_APPLICABLE"
  ) {
    return;
  }
  markConflict(left, rightId);
  markConflict(right, leftId);
}

/**
 * Resolves an already-evaluated set of rule findings without re-evaluating any
 * DSL expression. Invalid graph snapshots fail closed to REVIEW rather than
 * allowing load order to choose a winner.
 */
export function resolveRuleFindings(
  rules: readonly RuleDefinition[],
  findings: readonly RuleFinding[],
): EvaluationResult {
  const parsedRules = parseBoundedArray(rules, "Rules", (value) =>
    RuleDefinitionSchema.parse(value),
  );
  const parsedFindings = parseBoundedArray(findings, "Findings", (value) =>
    RuleFindingSchema.parse(value),
  );

  if (parsedFindings.length === 0) {
    throw new RangeError("Rule finding resolution requires at least one finding");
  }
  const evaluationDate = parsedFindings[0]?.evaluationDate;
  if (!parsedFindings.every((finding) => finding.evaluationDate === evaluationDate)) {
    throw new RangeError("Rule finding resolution requires one common evaluation date");
  }

  const duplicateRuleIds = new Set<RuleId>();
  const duplicateFindingIds = new Set<RuleId>();
  const sortedRules = [...parsedRules].sort(compareRules);
  const sortedFindings = [...parsedFindings].sort(compareFindings);
  const ruleById = uniqueRules(sortedRules, duplicateRuleIds);
  const findingById = uniqueByRuleId(sortedFindings, duplicateFindingIds);
  const knownIds = new Set([...ruleById.keys(), ...findingById.keys()]);
  const invalidIds = new Set<RuleId>([...duplicateRuleIds, ...duplicateFindingIds]);
  const invalidRelations = new Map<RuleId, Set<RuleId>>();
  const overrideNeighbors = new Map<RuleId, Set<RuleId>>();
  const declaredAdjacency = new Map<RuleId, Set<RuleId>>();
  const validEdges: OverrideEdge[] = [];

  const missingRuleIds = [...findingById.keys()].filter((id) => !ruleById.has(id));
  const missingFindingIds = [...ruleById.keys()].filter((id) => !findingById.has(id));
  if (missingRuleIds.length > 0 || missingFindingIds.length > 0) {
    const unmatched = [...missingRuleIds, ...missingFindingIds].sort(compareStrings);
    for (const id of knownIds) {
      invalidIds.add(id);
      for (const unmatchedId of unmatched) addUndirectedRelation(invalidRelations, id, unmatchedId);
    }
  }

  for (const [id, finding] of findingById) {
    const rule = ruleById.get(id);
    if (rule !== undefined && finding.ruleContentHash !== rule.contentHash) invalidIds.add(id);
  }

  for (const rule of sortedRules) {
    const finding = findingById.get(rule.id);
    const traceByOverrideId = new Map<string, RuleOverrideTrace>();
    const duplicateTraceIds = new Set<string>();
    for (const trace of finding?.overrideTraces ?? []) {
      if (traceByOverrideId.has(trace.overrideId)) duplicateTraceIds.add(trace.overrideId);
      else traceByOverrideId.set(trace.overrideId, trace);
    }

    const declaredOverrideIds = new Set(rule.overrides.map(({ id }) => id));
    for (const trace of finding?.overrideTraces ?? []) {
      if (!declaredOverrideIds.has(trace.overrideId)) {
        invalidIds.add(rule.id);
        addUndirectedRelation(invalidRelations, rule.id, trace.overriddenRuleId);
      }
    }

    for (const definition of rule.overrides) {
      const source = definition.overridingRuleId;
      const target = definition.overriddenRuleId;
      addDirectedEdge(declaredAdjacency, source, target);
      addUndirectedRelation(overrideNeighbors, source, target);

      const trace = traceByOverrideId.get(definition.id);
      const targetRule = ruleById.get(target);
      const targetFinding = findingById.get(target);
      const endpointsAreValid =
        source === rule.id &&
        source !== target &&
        finding !== undefined &&
        targetRule !== undefined &&
        targetFinding !== undefined &&
        utcDateTimeIntervalsOverlap(
          { from: rule.validity.validFrom, to: rule.validity.validTo },
          { from: targetRule.validity.validFrom, to: targetRule.validity.validTo },
        );
      const traceIsRequired = finding !== undefined && finding.satisfiedWhen !== null;
      const traceIsValid = traceIsRequired
        ? trace !== undefined &&
          !duplicateTraceIds.has(definition.id) &&
          trace.overriddenRuleId === target
        : trace === undefined;

      if (!endpointsAreValid || !traceIsValid) {
        invalidIds.add(source);
        if (knownIds.has(target)) invalidIds.add(target);
        addUndirectedRelation(invalidRelations, source, target);
        continue;
      }
      if (trace !== undefined) validEdges.push({ definition, trace });
    }

    for (const conflictingRuleId of rule.conflictsWith) {
      if (
        conflictingRuleId === rule.id ||
        !ruleById.has(conflictingRuleId) ||
        !findingById.has(conflictingRuleId)
      ) {
        invalidIds.add(rule.id);
        if (knownIds.has(conflictingRuleId)) invalidIds.add(conflictingRuleId);
        addUndirectedRelation(invalidRelations, rule.id, conflictingRuleId);
      }
    }
  }

  const cycleNodes = findCycleNodes(declaredAdjacency);
  for (const id of cycleNodes) invalidIds.add(id);
  propagateInvalidComponents(invalidIds, overrideNeighbors, knownIds);

  const states = new Map<RuleId, ResolutionState>();
  for (const finding of sortedFindings) {
    if (states.has(finding.ruleId)) continue;
    const related = new Set(invalidRelations.get(finding.ruleId) ?? []);
    for (const neighbor of overrideNeighbors.get(finding.ruleId) ?? []) {
      if (invalidIds.has(neighbor)) related.add(neighbor);
    }
    related.delete(finding.ruleId);
    states.set(finding.ruleId, {
      finding,
      resolution: invalidIds.has(finding.ruleId) ? "INVALID_OVERRIDE_GRAPH" : "UNCHANGED",
      effectiveOutcome: invalidIds.has(finding.ruleId) ? "REVIEW" : finding.outcome,
      relatedRuleIds: related,
    });
  }

  const resolvableRuleIds = [...ruleById.keys()]
    .filter((id) => findingById.has(id) && !invalidIds.has(id))
    .sort(compareStrings);
  const usableEdges = validEdges
    .filter(
      ({ definition }) =>
        !invalidIds.has(definition.overridingRuleId) &&
        !invalidIds.has(definition.overriddenRuleId),
    )
    .sort(
      (left, right) =>
        compareStrings(left.definition.overridingRuleId, right.definition.overridingRuleId) ||
        compareStrings(left.definition.overriddenRuleId, right.definition.overriddenRuleId) ||
        compareStrings(left.definition.id, right.definition.id),
    );
  const edgesBySource = new Map<RuleId, OverrideEdge[]>();
  for (const edge of usableEdges) {
    const source = edge.definition.overridingRuleId;
    edgesBySource.set(source, [...(edgesBySource.get(source) ?? []), edge]);
  }

  for (const sourceId of topologicalRuleOrder(resolvableRuleIds, usableEdges)) {
    const source = states.get(sourceId);
    if (
      source === undefined ||
      source.effectiveOutcome === "NOT_APPLICABLE" ||
      source.finding.appliesWhen.truth !== "TRUE"
    ) {
      continue;
    }
    for (const edge of edgesBySource.get(sourceId) ?? []) {
      const targetId = edge.definition.overriddenRuleId;
      const target = states.get(targetId);
      if (target === undefined || target.resolution === "INVALID_OVERRIDE_GRAPH") continue;
      if (edge.trace.trace.truth === "UNKNOWN") {
        markUncertainOverride(states, sourceId, targetId);
        continue;
      }
      if (edge.trace.trace.truth !== "TRUE") continue;
      if (target.resolution === "UNCERTAIN_OVERRIDE") continue;
      if (target.resolution !== "OVERRIDDEN") {
        target.relatedRuleIds.clear();
      }
      target.resolution = "OVERRIDDEN";
      target.effectiveOutcome = "NOT_APPLICABLE";
      target.relatedRuleIds.add(sourceId);
    }
  }

  const conflictPairs = new Map<string, readonly [RuleId, RuleId]>();
  for (const rule of sortedRules) {
    for (const conflictingRuleId of rule.conflictsWith) {
      if (!ruleById.has(conflictingRuleId) || rule.id === conflictingRuleId) continue;
      const pair = [rule.id, conflictingRuleId].sort(compareStrings) as [RuleId, RuleId];
      conflictPairs.set(`${pair[0]}\u0000${pair[1]}`, pair);
    }
  }

  for (const [leftId, rightId] of [...conflictPairs.values()].sort((left, right) => {
    return compareStrings(left[0], right[0]) || compareStrings(left[1], right[1]);
  })) {
    resolveConflictPair(states, leftId, rightId);
  }

  const rulesByNormativeKey = new Map<string, RuleDefinition[]>();
  for (const rule of ruleById.values()) {
    rulesByNormativeKey.set(rule.normativeKey, [
      ...(rulesByNormativeKey.get(rule.normativeKey) ?? []),
      rule,
    ]);
  }
  for (const group of rulesByNormativeKey.values()) {
    const applicable = group
      .filter((rule) => {
        const state = states.get(rule.id);
        return (
          state !== undefined &&
          state.resolution !== "INVALID_OVERRIDE_GRAPH" &&
          state.effectiveOutcome !== "NOT_APPLICABLE"
        );
      })
      .sort(compareRules);
    const prohibitions = applicable.filter(
      ({ deonticCategory }) => deonticCategory === "PROHIBITION",
    );
    const counterparts = applicable.filter(
      ({ deonticCategory }) => deonticCategory === "OBLIGATION" || deonticCategory === "PERMISSION",
    );
    const canonicalProhibition = prohibitions[0];
    const canonicalCounterpart = counterparts[0];
    if (canonicalProhibition === undefined || canonicalCounterpart === undefined) continue;

    for (const prohibition of prohibitions) {
      resolveConflictPair(states, prohibition.id, canonicalCounterpart.id);
    }
    for (const counterpart of counterparts) {
      resolveConflictPair(states, canonicalProhibition.id, counterpart.id);
    }
  }

  const resolvedFindings: ResolvedRuleFinding[] = [...states.values()]
    .sort((left, right) => compareStrings(left.finding.ruleId, right.finding.ruleId))
    .map(({ finding, resolution, effectiveOutcome, relatedRuleIds }) => ({
      finding,
      resolution,
      effectiveOutcome,
      relatedRuleIds: [...relatedRuleIds]
        .filter((id) => id !== finding.ruleId && states.has(id))
        .sort(compareStrings),
    }));

  return EvaluationResultSchema.parse({
    findings: resolvedFindings,
    aggregateOutcome: aggregateOutcomes(
      resolvedFindings.map(({ effectiveOutcome }) => effectiveOutcome),
    ),
  });
}
