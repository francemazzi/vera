import { z } from "zod";

import { RuleDefinitionSchema, type RuleDefinition } from "./dsl.js";
import {
  EVALUATION_SNAPSHOT_LIMITS,
  EvaluationResultSchema,
  type EvaluationResult,
} from "./evaluation.js";
import { sha256CanonicalJson } from "./hash.js";
import { snapshotJsonValue } from "./json-snapshot.js";
import {
  compareUtcDateTimes,
  isWithinValidityInterval,
  UtcDateTimeSchema,
  ValidityIntervalSchema,
  type UtcDateTime,
} from "./time.js";
import { ValidationScopeSchema } from "./vocabulary.js";

export const RULE_PACK_SCHEMA_VERSION = "vera.rule-pack/v1" as const;
export const ACTIVATION_EVENT_SCHEMA_VERSION = "vera.rule-pack-activation/v1" as const;
export const RULE_PACK_EVALUATION_SCHEMA_VERSION = "vera.rule-pack-evaluation/v1" as const;

export const RULE_PACK_LIMITS = Object.freeze({
  maxRules: 10_000,
  maxCanonicalBytes: 25_000_000,
  maxEvaluationCanonicalBytes:
    25_000_000 + EVALUATION_SNAPSHOT_LIMITS.maxCanonicalBytes + 5_000_000,
  maxJsonDepth: 112,
  maxJsonNodes: 500_000,
  maxEvaluationJsonDepth: Math.max(112, EVALUATION_SNAPSHOT_LIMITS.maxJsonDepth) + 16,
  maxEvaluationJsonNodes: 500_000 + EVALUATION_SNAPSHOT_LIMITS.maxJsonNodes + 25_000,
  maxTextCharacters: 2_000,
  maxSemVerCharacters: 255,
} as const);

const Sha256DigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Expected a lowercase SHA-256 digest");
const BoundedTextSchema = z
  .string()
  .min(1)
  .max(RULE_PACK_LIMITS.maxTextCharacters)
  .regex(/^\S(?:[\s\S]*\S)?$/u, "Leading or trailing whitespace is forbidden");
const ScopeTextSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^\S(?:[\s\S]*\S)?$/u, "Leading or trailing whitespace is forbidden");

const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

interface ParsedSemVer {
  readonly major: string;
  readonly minor: string;
  readonly patch: string;
  readonly prerelease: readonly string[] | null;
}

function parseSemVer(value: string): ParsedSemVer | null {
  const match = SEMVER_PATTERN.exec(value);
  if (match === null) return null;
  const [, major, minor, patch, prerelease] = match;
  /* v8 ignore next 3 -- the mandatory capture groups are guaranteed by SEMVER_PATTERN */
  if (major === undefined || minor === undefined || patch === undefined) return null;
  const prereleaseIdentifiers = prerelease === undefined ? null : prerelease.split(".");
  if (
    prereleaseIdentifiers?.some(
      (identifier) =>
        /^[0-9]+$/u.test(identifier) && identifier.length > 1 && identifier[0] === "0",
    ) === true
  ) {
    return null;
  }
  return { major, minor, patch, prerelease: prereleaseIdentifiers };
}

/** Strict, bounded SemVer 2.0.0, including pre-release and build identifiers. */
export const SemVerSchema = z
  .string()
  .min(5)
  .max(RULE_PACK_LIMITS.maxSemVerCharacters)
  .superRefine((value, context) => {
    if (parseSemVer(value) === null) {
      context.addIssue({ code: "custom", message: "Expected a strict SemVer 2.0.0 value" });
    }
  });

export type SemVer = z.infer<typeof SemVerSchema>;

function compareNumericIdentifier(left: string, right: string): -1 | 0 | 1 {
  if (left.length < right.length) return -1;
  if (left.length > right.length) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** SemVer precedence comparison; build metadata intentionally has no effect. */
export function compareSemVer(left: SemVer, right: SemVer): -1 | 0 | 1 {
  const parsedLeft = parseSemVer(SemVerSchema.parse(left));
  const parsedRight = parseSemVer(SemVerSchema.parse(right));
  /* v8 ignore next 2 -- schema parsing guarantees both parser results */
  if (parsedLeft === null || parsedRight === null) throw new TypeError("Invalid SemVer");

  for (const key of ["major", "minor", "patch"] as const) {
    const comparison = compareNumericIdentifier(parsedLeft[key], parsedRight[key]);
    if (comparison !== 0) return comparison;
  }
  if (parsedLeft.prerelease === null && parsedRight.prerelease === null) return 0;
  if (parsedLeft.prerelease === null) return 1;
  if (parsedRight.prerelease === null) return -1;

  const length = Math.max(parsedLeft.prerelease.length, parsedRight.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = parsedLeft.prerelease[index];
    const rightIdentifier = parsedRight.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const leftNumeric = /^[0-9]+$/u.test(leftIdentifier);
    const rightNumeric = /^[0-9]+$/u.test(rightIdentifier);
    if (leftNumeric && !rightNumeric) return -1;
    if (!leftNumeric && rightNumeric) return 1;
    const comparison = leftNumeric
      ? compareNumericIdentifier(leftIdentifier, rightIdentifier)
      : leftIdentifier < rightIdentifier
        ? -1
        : leftIdentifier > rightIdentifier
          ? 1
          : 0;
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (!Object.isFrozen(value)) Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

class InvalidRulePackSnapshot {
  public constructor(public readonly issue: string) {}
}

interface RulePackSnapshotLimits {
  readonly maxCanonicalBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
}

function immutableSnapshotSchema(limits: RulePackSnapshotLimits): z.ZodType {
  return z
    .unknown()
    .overwrite((value) => {
      const result = snapshotJsonValue(value, {
        maxDepth: limits.maxDepth,
        maxNodes: limits.maxNodes,
        maxCanonicalBytes: limits.maxCanonicalBytes,
        rejectNegativeZero: true,
        rejectUnsafeIntegers: true,
      });
      return result.success ? result.value : new InvalidRulePackSnapshot(result.issue);
    })
    .superRefine((value, context) => {
      if (value instanceof InvalidRulePackSnapshot) {
        context.addIssue({
          code: "custom",
          message: `Rule Pack values must be bounded JSON snapshots: ${value.issue}`,
        });
      }
    });
}

const RulePackSnapshotSchema = immutableSnapshotSchema({
  maxCanonicalBytes: RULE_PACK_LIMITS.maxCanonicalBytes,
  maxDepth: RULE_PACK_LIMITS.maxJsonDepth,
  maxNodes: RULE_PACK_LIMITS.maxJsonNodes,
});
const RulePackEvaluationPreflightSchema = immutableSnapshotSchema({
  maxCanonicalBytes: RULE_PACK_LIMITS.maxEvaluationCanonicalBytes,
  maxDepth: RULE_PACK_LIMITS.maxEvaluationJsonDepth,
  maxNodes: RULE_PACK_LIMITS.maxEvaluationJsonNodes,
});

function isStrictlySortedRuleSnapshot(rules: readonly RuleDefinition[]): boolean {
  for (let index = 1; index < rules.length; index += 1) {
    const previous = rules[index - 1];
    const current = rules[index];
    /* v8 ignore next -- loop bounds guarantee both entries */
    if (previous === undefined || current === undefined || previous.id >= current.id) return false;
  }
  return true;
}

interface RulePackContent {
  readonly id: string;
  readonly packId: string;
  readonly validity: z.infer<typeof ValidityIntervalSchema>;
  readonly rules: readonly RuleDefinition[];
  readonly supersedesVersionId: string | null;
}

function ruleValidityContainsPack(
  ruleValidity: z.infer<typeof ValidityIntervalSchema>,
  packValidity: z.infer<typeof ValidityIntervalSchema>,
): boolean {
  if (compareUtcDateTimes(ruleValidity.validFrom, packValidity.validFrom) > 0) return false;
  if (packValidity.validTo === null) return ruleValidity.validTo === null;
  return (
    ruleValidity.validTo === null ||
    compareUtcDateTimes(packValidity.validTo, ruleValidity.validTo) <= 0
  );
}

function requiredMapValue<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  /* v8 ignore next -- callers populate every graph node before traversing it */
  if (value === undefined) throw new TypeError("Incomplete internal Rule Pack graph");
  return value;
}

function refineRulePackContent(pack: RulePackContent, context: z.core.$RefinementCtx): void {
  if (pack.id === pack.supersedesVersionId) {
    context.addIssue({
      code: "custom",
      message: "A Rule Pack version cannot supersede itself",
      path: ["supersedesVersionId"],
    });
  }
  if (!isStrictlySortedRuleSnapshot(pack.rules)) {
    context.addIssue({
      code: "custom",
      message: "Rule snapshots must be unique and strictly sorted by rule ID",
      path: ["rules"],
    });
  }

  const ruleIds = new Set(pack.rules.map(({ id }) => id));
  const overrideInDegree = new Map<string, number>(pack.rules.map(({ id }) => [id, 0] as const));
  const overrideTargets = new Map<string, readonly string[]>();
  pack.rules.forEach((rule, ruleIndex) => {
    if (!ruleValidityContainsPack(rule.validity, pack.validity)) {
      context.addIssue({
        code: "custom",
        message: "Each rule validity must contain the complete Rule Pack validity interval",
        path: ["rules", ruleIndex, "validity"],
      });
    }
    overrideTargets.set(
      rule.id,
      rule.overrides
        .map(({ overriddenRuleId }) => overriddenRuleId)
        .filter((overriddenRuleId) => ruleIds.has(overriddenRuleId)),
    );
    rule.overrides.forEach(({ overriddenRuleId }, overrideIndex) => {
      if (!ruleIds.has(overriddenRuleId)) {
        context.addIssue({
          code: "custom",
          message: `Override target is absent from the Rule Pack: ${overriddenRuleId}`,
          path: ["rules", ruleIndex, "overrides", overrideIndex, "overriddenRuleId"],
        });
      } else {
        overrideInDegree.set(
          overriddenRuleId,
          requiredMapValue(overrideInDegree, overriddenRuleId) + 1,
        );
      }
    });
    rule.conflictsWith.forEach((conflictingRuleId, conflictIndex) => {
      if (!ruleIds.has(conflictingRuleId)) {
        context.addIssue({
          code: "custom",
          message: `Conflict target is absent from the Rule Pack: ${conflictingRuleId}`,
          path: ["rules", ruleIndex, "conflictsWith", conflictIndex],
        });
      }
    });
  });

  const ready = [...overrideInDegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([ruleId]) => ruleId);
  let visited = 0;
  while (ready.length > 0) {
    const ruleId = ready.pop();
    /* v8 ignore next -- the loop condition guarantees a populated work list */
    if (ruleId === undefined) break;
    visited += 1;
    for (const targetId of requiredMapValue(overrideTargets, ruleId)) {
      const nextDegree = requiredMapValue(overrideInDegree, targetId) - 1;
      overrideInDegree.set(targetId, nextDegree);
      if (nextDegree === 0) ready.push(targetId);
    }
  }
  if (visited !== pack.rules.length) {
    context.addIssue({
      code: "custom",
      message: "Rule Pack override precedence must form an acyclic graph",
      path: ["rules"],
    });
  }
}

const RulePackCommonHashInputShape = {
  schemaVersion: z.literal(RULE_PACK_SCHEMA_VERSION),
  id: z.uuid(),
  packId: z.uuid(),
  semver: SemVerSchema,
  domain: ScopeTextSchema,
  jurisdiction: ScopeTextSchema,
  validity: ValidityIntervalSchema,
  rules: z.array(RuleDefinitionSchema).min(1).max(RULE_PACK_LIMITS.maxRules).readonly(),
  changeReason: BoundedTextSchema,
  supersedesVersionId: z.uuid().nullable(),
  createdAt: UtcDateTimeSchema,
  createdBy: z.uuid(),
  validationScope: ValidationScopeSchema,
} as const;

const RulePackDraftHashInputObjectSchema = z
  .object({
    ...RulePackCommonHashInputShape,
    revision: z.int().min(1),
    updatedAt: UtcDateTimeSchema,
    updatedBy: z.uuid(),
  })
  .strict()
  .superRefine((draft, context) => {
    refineRulePackContent(draft, context);
    if (compareUtcDateTimes(draft.updatedAt, draft.createdAt) < 0) {
      context.addIssue({
        code: "custom",
        message: "updatedAt cannot precede createdAt",
        path: ["updatedAt"],
      });
    }
  })
  .readonly();

export const RulePackDraftHashInputSchema = RulePackSnapshotSchema.pipe(
  RulePackDraftHashInputObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RulePackDraftHashInputObjectSchema>
>;

export type RulePackDraftHashInput = z.infer<typeof RulePackDraftHashInputSchema>;

export function computeRulePackDraftHash(input: RulePackDraftHashInput): string {
  return sha256CanonicalJson(RulePackDraftHashInputSchema.parse(input));
}

const RulePackDraftCandidateObjectSchema = z
  .object({
    ...RulePackCommonHashInputShape,
    revision: z.int().min(1),
    updatedAt: UtcDateTimeSchema,
    updatedBy: z.uuid(),
    contentHash: Sha256DigestSchema,
  })
  .strict()
  .superRefine((draft, context) => {
    const { contentHash, ...hashInput } = draft;
    refineRulePackContent(hashInput, context);
    if (compareUtcDateTimes(draft.updatedAt, draft.createdAt) < 0) {
      context.addIssue({
        code: "custom",
        message: "updatedAt cannot precede createdAt",
        path: ["updatedAt"],
      });
    }
    if (contentHash !== sha256CanonicalJson(hashInput)) {
      context.addIssue({
        code: "custom",
        message: "contentHash does not match the canonical Rule Pack draft",
        path: ["contentHash"],
      });
    }
  })
  .readonly();

export const RulePackDraftSchema = RulePackSnapshotSchema.pipe(
  RulePackDraftCandidateObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RulePackDraftCandidateObjectSchema>
>;

export type RulePackDraft = z.infer<typeof RulePackDraftSchema>;

export function verifyRulePackDraftHash(draft: unknown): boolean {
  return RulePackDraftSchema.safeParse(draft).success;
}

const RulePackVersionHashInputObjectSchema = z
  .object({
    ...RulePackCommonHashInputShape,
    publishedAt: UtcDateTimeSchema,
    publishedBy: z.uuid(),
  })
  .strict()
  .superRefine((version, context) => {
    refineRulePackContent(version, context);
    if (compareUtcDateTimes(version.publishedAt, version.createdAt) < 0) {
      context.addIssue({
        code: "custom",
        message: "publishedAt cannot precede createdAt",
        path: ["publishedAt"],
      });
    }
  })
  .readonly();

export const RulePackVersionHashInputSchema = RulePackSnapshotSchema.pipe(
  RulePackVersionHashInputObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RulePackVersionHashInputObjectSchema>
>;

export type RulePackVersionHashInput = z.infer<typeof RulePackVersionHashInputSchema>;

export function computeRulePackVersionHash(input: RulePackVersionHashInput): string {
  return sha256CanonicalJson(RulePackVersionHashInputSchema.parse(input));
}

const RulePackVersionCandidateObjectSchema = z
  .object({
    ...RulePackCommonHashInputShape,
    publishedAt: UtcDateTimeSchema,
    publishedBy: z.uuid(),
    contentHash: Sha256DigestSchema,
  })
  .strict()
  .superRefine((version, context) => {
    const { contentHash, ...hashInput } = version;
    refineRulePackContent(hashInput, context);
    if (compareUtcDateTimes(version.publishedAt, version.createdAt) < 0) {
      context.addIssue({
        code: "custom",
        message: "publishedAt cannot precede createdAt",
        path: ["publishedAt"],
      });
    }
    if (contentHash !== sha256CanonicalJson(hashInput)) {
      context.addIssue({
        code: "custom",
        message: "contentHash does not match the canonical Rule Pack version",
        path: ["contentHash"],
      });
    }
  })
  .readonly();

export const RulePackVersionSchema = RulePackSnapshotSchema.pipe(
  RulePackVersionCandidateObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RulePackVersionCandidateObjectSchema>
>;

export type RulePackVersion = z.infer<typeof RulePackVersionSchema>;

export function verifyRulePackVersionHash(version: unknown): boolean {
  return RulePackVersionSchema.safeParse(version).success;
}

function refineNestedRulePackVersionSnapshot(
  version: RulePackVersion,
  context: z.core.$RefinementCtx,
  path: readonly PropertyKey[],
): void {
  const bounded = snapshotJsonValue(version, {
    maxDepth: RULE_PACK_LIMITS.maxJsonDepth,
    maxNodes: RULE_PACK_LIMITS.maxJsonNodes,
    maxCanonicalBytes: RULE_PACK_LIMITS.maxCanonicalBytes,
    rejectNegativeZero: true,
    rejectUnsafeIntegers: true,
  });
  if (!bounded.success) {
    context.addIssue({
      code: "custom",
      message: `Nested Rule Pack version exceeds its public snapshot boundary: ${bounded.issue}`,
      path: [...path],
    });
  }
}

export const ActivationEventTypeSchema = z.enum(["ACTIVATE", "ROLLBACK", "DEACTIVATE"]);
export type ActivationEventType = z.infer<typeof ActivationEventTypeSchema>;

const ActivationEventHashInputObjectSchema = z
  .object({
    schemaVersion: z.literal(ACTIVATION_EVENT_SCHEMA_VERSION),
    id: z.uuid(),
    packId: z.uuid(),
    sequence: z.int().min(1),
    type: ActivationEventTypeSchema,
    versionId: z.uuid().nullable(),
    versionContentHash: Sha256DigestSchema.nullable(),
    expectedPreviousVersionId: z.uuid().nullable(),
    effectiveAt: UtcDateTimeSchema,
    recordedAt: UtcDateTimeSchema,
    actorId: z.uuid(),
    exercisedRole: z.literal("APPROVER"),
    reason: BoundedTextSchema,
    previousEventHash: Sha256DigestSchema.nullable(),
    validationScope: ValidationScopeSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if ((event.sequence === 1) !== (event.previousEventHash === null)) {
      context.addIssue({
        code: "custom",
        message: "Only the first activation event may omit the previous event hash",
        path: ["previousEventHash"],
      });
    }
    if (
      event.sequence === 1 &&
      (event.type !== "ACTIVATE" || event.expectedPreviousVersionId !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "The first ledger event must activate without a previous version",
        path: ["type"],
      });
    }
    if (compareUtcDateTimes(event.recordedAt, event.effectiveAt) > 0) {
      context.addIssue({
        code: "custom",
        message: "effectiveAt cannot precede recordedAt",
        path: ["effectiveAt"],
      });
    }
    if (event.type === "DEACTIVATE") {
      if (event.versionId !== null) {
        context.addIssue({
          code: "custom",
          message: "DEACTIVATE cannot target a version",
          path: ["versionId"],
        });
      }
      if (event.versionContentHash !== null) {
        context.addIssue({
          code: "custom",
          message: "DEACTIVATE cannot target a version content hash",
          path: ["versionContentHash"],
        });
      }
      if (event.expectedPreviousVersionId === null) {
        context.addIssue({
          code: "custom",
          message: "DEACTIVATE requires the active version identity",
          path: ["expectedPreviousVersionId"],
        });
      }
      return;
    }
    if (event.versionId === null) {
      context.addIssue({
        code: "custom",
        message: `${event.type} requires a target version`,
        path: ["versionId"],
      });
      return;
    }
    if (event.versionContentHash === null) {
      context.addIssue({
        code: "custom",
        message: `${event.type} requires the target version content hash`,
        path: ["versionContentHash"],
      });
    }
    if (event.type === "ROLLBACK") {
      if (event.expectedPreviousVersionId === null) {
        context.addIssue({
          code: "custom",
          message: "ROLLBACK requires the replaced active version",
          path: ["expectedPreviousVersionId"],
        });
      } else if (event.versionId === event.expectedPreviousVersionId) {
        context.addIssue({
          code: "custom",
          message: "ROLLBACK must target a different version",
          path: ["versionId"],
        });
      }
    }
  })
  .readonly();

export const ActivationEventHashInputSchema = RulePackSnapshotSchema.pipe(
  ActivationEventHashInputObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof ActivationEventHashInputObjectSchema>
>;

export type ActivationEventHashInput = z.infer<typeof ActivationEventHashInputSchema>;

export function computeActivationEventHash(input: ActivationEventHashInput): string {
  return sha256CanonicalJson(ActivationEventHashInputSchema.parse(input));
}

const ActivationEventCandidateObjectSchema = z
  .object({
    schemaVersion: z.literal(ACTIVATION_EVENT_SCHEMA_VERSION),
    id: z.uuid(),
    packId: z.uuid(),
    sequence: z.int().min(1),
    type: ActivationEventTypeSchema,
    versionId: z.uuid().nullable(),
    versionContentHash: Sha256DigestSchema.nullable(),
    expectedPreviousVersionId: z.uuid().nullable(),
    effectiveAt: UtcDateTimeSchema,
    recordedAt: UtcDateTimeSchema,
    actorId: z.uuid(),
    exercisedRole: z.literal("APPROVER"),
    reason: BoundedTextSchema,
    previousEventHash: Sha256DigestSchema.nullable(),
    validationScope: ValidationScopeSchema,
    contentHash: Sha256DigestSchema,
  })
  .strict()
  .superRefine((event, context) => {
    const { contentHash, ...hashInput } = event;
    const semanticResult = ActivationEventHashInputObjectSchema.safeParse(hashInput);
    if (!semanticResult.success) {
      semanticResult.error.issues.forEach((issue) => {
        context.addIssue({ ...issue, path: issue.path });
      });
    }
    if (contentHash !== sha256CanonicalJson(hashInput)) {
      context.addIssue({
        code: "custom",
        message: "contentHash does not match the canonical activation event",
        path: ["contentHash"],
      });
    }
  })
  .readonly();

export const ActivationEventSchema = RulePackSnapshotSchema.pipe(
  ActivationEventCandidateObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof ActivationEventCandidateObjectSchema>
>;

export type ActivationEvent = z.infer<typeof ActivationEventSchema>;

export function verifyActivationEventHash(event: unknown): boolean {
  return ActivationEventSchema.safeParse(event).success;
}

const RulePackResolutionRequestObjectSchema = z
  .object({
    domain: ScopeTextSchema,
    jurisdiction: ScopeTextSchema,
    evaluationDate: UtcDateTimeSchema,
  })
  .strict()
  .readonly();

export const RulePackResolutionRequestSchema = RulePackSnapshotSchema.pipe(
  RulePackResolutionRequestObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RulePackResolutionRequestObjectSchema>
>;

export type RulePackResolutionRequest = z.infer<typeof RulePackResolutionRequestSchema>;

export interface ResolvedRulePack {
  readonly request: RulePackResolutionRequest;
  readonly rulePackVersion: RulePackVersion;
  readonly activationEvent: ActivationEvent;
}

const ResolvedRulePackObjectSchema = z
  .object({
    request: RulePackResolutionRequestObjectSchema,
    rulePackVersion: RulePackVersionCandidateObjectSchema,
    activationEvent: ActivationEventCandidateObjectSchema,
  })
  .strict()
  .superRefine(({ request, rulePackVersion, activationEvent }, context) => {
    refineNestedRulePackVersionSnapshot(rulePackVersion, context, ["rulePackVersion"]);
    if (rulePackVersion.domain !== request.domain) {
      context.addIssue({
        code: "custom",
        message: "Resolved Rule Pack domain does not match the request",
        path: ["rulePackVersion", "domain"],
      });
    }
    if (rulePackVersion.jurisdiction !== request.jurisdiction) {
      context.addIssue({
        code: "custom",
        message: "Resolved Rule Pack jurisdiction does not match the request",
        path: ["rulePackVersion", "jurisdiction"],
      });
    }
    if (!isWithinValidityInterval(rulePackVersion.validity, request.evaluationDate)) {
      context.addIssue({
        code: "custom",
        message: "Resolved Rule Pack is outside its half-open validity interval",
        path: ["request", "evaluationDate"],
      });
    }
    if (
      activationEvent.type === "DEACTIVATE" ||
      activationEvent.versionId !== rulePackVersion.id ||
      activationEvent.versionContentHash !== rulePackVersion.contentHash ||
      activationEvent.packId !== rulePackVersion.packId
    ) {
      context.addIssue({
        code: "custom",
        message: "Activation event does not select the resolved Rule Pack version",
        path: ["activationEvent"],
      });
    }
    if (compareUtcDateTimes(activationEvent.effectiveAt, request.evaluationDate) > 0) {
      context.addIssue({
        code: "custom",
        message: "Activation event is not effective at the evaluation date",
        path: ["activationEvent", "effectiveAt"],
      });
    }
  })
  .readonly();

export const ResolvedRulePackSchema = RulePackEvaluationPreflightSchema.pipe(
  ResolvedRulePackObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<ResolvedRulePack>;

const RulePackEvaluationHashInputObjectSchema = z
  .object({
    schemaVersion: z.literal(RULE_PACK_EVALUATION_SCHEMA_VERSION),
    rulePackVersion: RulePackVersionCandidateObjectSchema,
    evaluationDate: UtcDateTimeSchema,
    evaluationResult: EvaluationResultSchema,
    validationScope: ValidationScopeSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    refineNestedRulePackVersionSnapshot(snapshot.rulePackVersion, context, ["rulePackVersion"]);
    refineEvaluationSnapshot(
      snapshot.rulePackVersion,
      snapshot.evaluationDate,
      snapshot.evaluationResult,
      context,
    );
  })
  .readonly();

function refineEvaluationSnapshot(
  version: RulePackVersion,
  evaluationDate: UtcDateTime,
  result: EvaluationResult,
  context: z.core.$RefinementCtx,
): void {
  if (!isWithinValidityInterval(version.validity, evaluationDate)) {
    context.addIssue({
      code: "custom",
      message: "Evaluation date is outside Rule Pack validity",
      path: ["evaluationDate"],
    });
  }
  if (result.findings.length !== version.rules.length) {
    context.addIssue({
      code: "custom",
      message: "Evaluation findings must correspond one-to-one with Rule Pack rules",
      path: ["evaluationResult", "findings"],
    });
    return;
  }
  version.rules.forEach((rule, index) => {
    const finding = result.findings[index]?.finding;
    /* v8 ignore next -- length equality and array bounds guarantee a finding */
    if (finding === undefined) return;
    if (finding.ruleId !== rule.id) {
      context.addIssue({
        code: "custom",
        message: "Finding rule ID does not match the Rule Pack snapshot",
        path: ["evaluationResult", "findings", index, "finding", "ruleId"],
      });
    }
    if (finding.ruleContentHash !== rule.contentHash) {
      context.addIssue({
        code: "custom",
        message: "Finding rule hash does not match the Rule Pack snapshot",
        path: ["evaluationResult", "findings", index, "finding", "ruleContentHash"],
      });
    }
    if (finding.evaluationDate !== evaluationDate) {
      context.addIssue({
        code: "custom",
        message: "Finding evaluation date does not match the snapshot",
        path: ["evaluationResult", "findings", index, "finding", "evaluationDate"],
      });
    }
  });
}

export const RulePackEvaluationHashInputSchema = RulePackEvaluationPreflightSchema.pipe(
  RulePackEvaluationHashInputObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RulePackEvaluationHashInputObjectSchema>
>;

export type RulePackEvaluationHashInput = z.infer<typeof RulePackEvaluationHashInputSchema>;

export function computeRulePackEvaluationHash(input: RulePackEvaluationHashInput): string {
  return sha256CanonicalJson(RulePackEvaluationHashInputSchema.parse(input));
}

const RulePackEvaluationCandidateObjectSchema = z
  .object({
    schemaVersion: z.literal(RULE_PACK_EVALUATION_SCHEMA_VERSION),
    rulePackVersion: RulePackVersionCandidateObjectSchema,
    evaluationDate: UtcDateTimeSchema,
    evaluationResult: EvaluationResultSchema,
    validationScope: ValidationScopeSchema,
    contentHash: Sha256DigestSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    const { contentHash, ...hashInput } = snapshot;
    refineNestedRulePackVersionSnapshot(snapshot.rulePackVersion, context, ["rulePackVersion"]);
    refineEvaluationSnapshot(
      snapshot.rulePackVersion,
      snapshot.evaluationDate,
      snapshot.evaluationResult,
      context,
    );
    if (contentHash !== sha256CanonicalJson(hashInput)) {
      context.addIssue({
        code: "custom",
        message: "contentHash does not match the canonical Rule Pack evaluation snapshot",
        path: ["contentHash"],
      });
    }
  })
  .readonly();

export const RulePackEvaluationSnapshotSchema = RulePackEvaluationPreflightSchema.pipe(
  RulePackEvaluationCandidateObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof RulePackEvaluationCandidateObjectSchema>
>;

export type RulePackEvaluationSnapshot = z.infer<typeof RulePackEvaluationSnapshotSchema>;

export function verifyRulePackEvaluationHash(snapshot: unknown): boolean {
  return RulePackEvaluationSnapshotSchema.safeParse(snapshot).success;
}
