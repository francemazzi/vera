import { z } from "zod";

import { RulePackEvaluationSnapshotSchema } from "./rule-pack.js";
import type { RulePackEvaluationSnapshot } from "./rule-pack.js";
import { canonicalizeJson, sha256CanonicalJson } from "./hash.js";
import { snapshotJsonValue } from "./json-snapshot.js";
import { compareUtcDateTimes, UtcDateTimeSchema } from "./time.js";
import { ActorRoleSchema, EvaluationOutcomeSchema, ValidationScopeSchema } from "./vocabulary.js";

export const EVALUATION_RUN_SCHEMA_VERSION = "vera.evaluation-run/v1" as const;
export const REVIEW_DECISION_SCHEMA_VERSION = "vera.review-decision/v1" as const;
export const EVALUATION_AUDIT_EXPORT_SCHEMA_VERSION = "vera.evaluation-audit-export/v1" as const;

export const EVALUATION_AUDIT_LIMITS = Object.freeze({
  maxCanonicalBytes: 50_000_000,
  maxJsonDepth: 180,
  maxJsonNodes: 750_000,
  maxEntities: 100,
  maxAgents: 100,
  maxActivities: 100,
  maxReviewDecisions: 10_000,
  maxTextCharacters: 2_000,
} as const);

const Sha256DigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Expected a lowercase SHA-256 digest");
const StableKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z][A-Za-z0-9._-]*$/u, "Expected a stable key");
const BoundedTextSchema = z
  .string()
  .min(1)
  .max(EVALUATION_AUDIT_LIMITS.maxTextCharacters)
  .regex(/^\S(?:[\s\S]*\S)?$/u, "Leading or trailing whitespace is forbidden");

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

class InvalidAuditSnapshot {
  public constructor(public readonly issue: string) {}
}

const AuditSnapshotSchema = z
  .unknown()
  .overwrite((value) => {
    const result = snapshotJsonValue(value, {
      maxDepth: EVALUATION_AUDIT_LIMITS.maxJsonDepth,
      maxNodes: EVALUATION_AUDIT_LIMITS.maxJsonNodes,
      maxCanonicalBytes: EVALUATION_AUDIT_LIMITS.maxCanonicalBytes,
      rejectNegativeZero: true,
      rejectUnsafeIntegers: true,
    });
    return result.success ? result.value : new InvalidAuditSnapshot(result.issue);
  })
  .superRefine((value, context) => {
    if (value instanceof InvalidAuditSnapshot) {
      context.addIssue({
        code: "custom",
        message: `Audit values must be bounded JSON snapshots: ${value.issue}`,
      });
    }
  });

function addCanonicalUniqueIssues(
  values: readonly string[],
  label: string,
  path: readonly PropertyKey[],
  context: z.core.$RefinementCtx,
): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    /* v8 ignore next -- loop bounds guarantee both entries */
    if (previous === undefined || current === undefined) return;
    if (compareStrings(previous, current) >= 0) {
      context.addIssue({
        code: "custom",
        message: `${label} must be unique and strictly sorted`,
        path: [...path],
      });
      return;
    }
  }
}

function addSubsetIssues(
  values: readonly string[],
  allowed: ReadonlySet<string>,
  label: string,
  path: readonly PropertyKey[],
  context: z.core.$RefinementCtx,
): void {
  values.forEach((value, index) => {
    if (!allowed.has(value)) {
      context.addIssue({
        code: "custom",
        message: `${label} references an unknown identifier: ${value}`,
        path: [...path, index],
      });
    }
  });
}

function requiredEntity(
  entities: ReadonlyMap<string, AuditEntityRef>,
  id: string,
  kind: AuditEntityKind,
  contentHash: string,
  context: z.core.$RefinementCtx,
): void {
  const entity = entities.get(id);
  if (entity === undefined) {
    context.addIssue({
      code: "custom",
      message: `Missing required audit entity: ${id}`,
      path: ["entities"],
    });
    return;
  }
  if (entity.kind !== kind || entity.contentHash !== contentHash) {
    context.addIssue({
      code: "custom",
      message: `Audit entity ${id} is not bound to the expected ${kind} hash`,
      path: ["entities"],
    });
  }
}

export const AuditEntityKindSchema = z.enum([
  "INPUT",
  "PROMPT",
  "PROVIDER",
  "FACTS",
  "EVIDENCE",
  "RULE_PACK_SNAPSHOT",
  "EVALUATION_RESULT",
  "FINDINGS",
  "TRACE",
]);
export const AuditActivityTypeSchema = z.enum(["EVALUATION_RUN", "HUMAN_REVIEW"]);
export const AuditAgentKindSchema = z.enum(["LOCAL_ACCOUNT", "SYSTEM", "EXTRACTOR_ADAPTER"]);
export const ReviewDecisionTypeSchema = z.enum([
  "CONFIRM",
  "CORRECT",
  "MARK_NOT_APPLICABLE",
  "REQUEST_MORE_EVIDENCE",
  "OVERRIDE",
]);

export type AuditEntityKind = z.infer<typeof AuditEntityKindSchema>;
export type AuditActivityType = z.infer<typeof AuditActivityTypeSchema>;
export type AuditAgentKind = z.infer<typeof AuditAgentKindSchema>;
export type ReviewDecisionType = z.infer<typeof ReviewDecisionTypeSchema>;

export const AuditEntityRefSchema = z
  .object({
    id: StableKeySchema,
    kind: AuditEntityKindSchema,
    contentHash: Sha256DigestSchema,
    mediaType: z.string().min(1).max(120).nullable(),
    description: z.string().min(1).max(500).nullable(),
  })
  .strict()
  .readonly();

export type AuditEntityRef = z.infer<typeof AuditEntityRefSchema>;

export const AuditAgentSchema = z
  .object({
    id: StableKeySchema,
    actorId: z.uuid(),
    kind: AuditAgentKindSchema,
    role: ActorRoleSchema,
    displayName: z.string().min(1).max(200),
    validationScope: ValidationScopeSchema,
  })
  .strict()
  .readonly();

export type AuditAgent = z.infer<typeof AuditAgentSchema>;

export const AuditActivitySchema = z
  .object({
    id: StableKeySchema,
    type: AuditActivityTypeSchema,
    startedAt: UtcDateTimeSchema,
    endedAt: UtcDateTimeSchema,
    agentId: StableKeySchema,
    usedEntityIds: z.array(StableKeySchema).max(EVALUATION_AUDIT_LIMITS.maxEntities).readonly(),
    generatedEntityIds: z
      .array(StableKeySchema)
      .max(EVALUATION_AUDIT_LIMITS.maxEntities)
      .readonly(),
  })
  .strict()
  .superRefine((activity, context) => {
    if (compareUtcDateTimes(activity.startedAt, activity.endedAt) > 0) {
      context.addIssue({
        code: "custom",
        message: "Audit activity cannot end before it starts",
        path: ["endedAt"],
      });
    }
    addCanonicalUniqueIssues(activity.usedEntityIds, "Used entity IDs", ["usedEntityIds"], context);
    addCanonicalUniqueIssues(
      activity.generatedEntityIds,
      "Generated entity IDs",
      ["generatedEntityIds"],
      context,
    );
  });

export type AuditActivity = z.infer<typeof AuditActivitySchema>;

function traceProjection(snapshot: RulePackEvaluationSnapshot): unknown {
  return snapshot.evaluationResult.findings.map(({ finding }) => ({
    ruleId: finding.ruleId,
    appliesWhen: finding.appliesWhen,
    exceptionTraces: finding.exceptionTraces,
    satisfiedWhen: finding.satisfiedWhen,
    overrideTraces: finding.overrideTraces,
  }));
}

export function computeEvaluationSnapshotResultHash(snapshot: RulePackEvaluationSnapshot): string {
  return sha256CanonicalJson(RulePackEvaluationSnapshotSchema.parse(snapshot).evaluationResult);
}

export function computeEvaluationSnapshotFindingsHash(
  snapshot: RulePackEvaluationSnapshot,
): string {
  return sha256CanonicalJson(
    RulePackEvaluationSnapshotSchema.parse(snapshot).evaluationResult.findings,
  );
}

export function computeEvaluationSnapshotTraceHash(snapshot: RulePackEvaluationSnapshot): string {
  return sha256CanonicalJson(traceProjection(RulePackEvaluationSnapshotSchema.parse(snapshot)));
}

export const EvaluationRunHashInputObjectSchema = z
  .object({
    schemaVersion: z.literal(EVALUATION_RUN_SCHEMA_VERSION),
    id: z.uuid(),
    caseId: StableKeySchema.nullable(),
    recordedAt: UtcDateTimeSchema,
    evaluationDate: UtcDateTimeSchema,
    inputHash: Sha256DigestSchema,
    promptHash: Sha256DigestSchema.nullable(),
    providerHash: Sha256DigestSchema.nullable(),
    factsHash: Sha256DigestSchema,
    evidenceHash: Sha256DigestSchema,
    rulePackVersionId: z.uuid(),
    rulePackVersionContentHash: Sha256DigestSchema,
    evaluationSnapshotHash: Sha256DigestSchema,
    evaluationResultHash: Sha256DigestSchema,
    findingsHash: Sha256DigestSchema,
    traceHash: Sha256DigestSchema,
    evaluationSnapshot: RulePackEvaluationSnapshotSchema,
    entities: z.array(AuditEntityRefSchema).max(EVALUATION_AUDIT_LIMITS.maxEntities).readonly(),
    agents: z.array(AuditAgentSchema).max(EVALUATION_AUDIT_LIMITS.maxAgents).readonly(),
    activities: z
      .array(AuditActivitySchema)
      .min(1)
      .max(EVALUATION_AUDIT_LIMITS.maxActivities)
      .readonly(),
    validationScope: ValidationScopeSchema,
  })
  .strict()
  .superRefine((run, context) => {
    addCanonicalUniqueIssues(
      run.entities.map(({ id }) => id),
      "Audit entity IDs",
      ["entities"],
      context,
    );
    addCanonicalUniqueIssues(
      run.agents.map(({ id }) => id),
      "Audit agent IDs",
      ["agents"],
      context,
    );
    addCanonicalUniqueIssues(
      run.activities.map(({ id }) => id),
      "Audit activity IDs",
      ["activities"],
      context,
    );

    const entityIds = new Set(run.entities.map(({ id }) => id));
    const agentIds = new Set(run.agents.map(({ id }) => id));
    run.activities.forEach((activity, index) => {
      if (!agentIds.has(activity.agentId)) {
        context.addIssue({
          code: "custom",
          message: `Audit activity references an unknown agent: ${activity.agentId}`,
          path: ["activities", index, "agentId"],
        });
      }
      addSubsetIssues(
        activity.usedEntityIds,
        entityIds,
        "Used entity",
        ["activities", index, "usedEntityIds"],
        context,
      );
      addSubsetIssues(
        activity.generatedEntityIds,
        entityIds,
        "Generated entity",
        ["activities", index, "generatedEntityIds"],
        context,
      );
    });

    const snapshot = run.evaluationSnapshot;
    if (run.evaluationDate !== snapshot.evaluationDate) {
      context.addIssue({
        code: "custom",
        message: "EvaluationRun date must match the evaluation snapshot",
        path: ["evaluationDate"],
      });
    }
    if (run.rulePackVersionId !== snapshot.rulePackVersion.id) {
      context.addIssue({
        code: "custom",
        message: "EvaluationRun version ID must match the evaluation snapshot",
        path: ["rulePackVersionId"],
      });
    }
    if (run.rulePackVersionContentHash !== snapshot.rulePackVersion.contentHash) {
      context.addIssue({
        code: "custom",
        message: "EvaluationRun version hash must match the evaluation snapshot",
        path: ["rulePackVersionContentHash"],
      });
    }
    if (run.evaluationSnapshotHash !== snapshot.contentHash) {
      context.addIssue({
        code: "custom",
        message: "EvaluationRun snapshot hash must match the evaluation snapshot",
        path: ["evaluationSnapshotHash"],
      });
    }
    if (run.evaluationResultHash !== computeEvaluationSnapshotResultHash(snapshot)) {
      context.addIssue({
        code: "custom",
        message: "EvaluationRun result hash does not match the evaluation snapshot",
        path: ["evaluationResultHash"],
      });
    }
    if (run.findingsHash !== computeEvaluationSnapshotFindingsHash(snapshot)) {
      context.addIssue({
        code: "custom",
        message: "EvaluationRun findings hash does not match the evaluation snapshot",
        path: ["findingsHash"],
      });
    }
    if (run.traceHash !== computeEvaluationSnapshotTraceHash(snapshot)) {
      context.addIssue({
        code: "custom",
        message: "EvaluationRun trace hash does not match the evaluation snapshot",
        path: ["traceHash"],
      });
    }

    const entities = new Map(run.entities.map((entity) => [entity.id, entity] as const));
    requiredEntity(entities, "input", "INPUT", run.inputHash, context);
    requiredEntity(entities, "facts", "FACTS", run.factsHash, context);
    requiredEntity(entities, "evidence", "EVIDENCE", run.evidenceHash, context);
    requiredEntity(
      entities,
      "rulePackSnapshot",
      "RULE_PACK_SNAPSHOT",
      run.evaluationSnapshotHash,
      context,
    );
    requiredEntity(
      entities,
      "evaluationResult",
      "EVALUATION_RESULT",
      run.evaluationResultHash,
      context,
    );
    requiredEntity(entities, "findings", "FINDINGS", run.findingsHash, context);
    requiredEntity(entities, "trace", "TRACE", run.traceHash, context);
    if (run.promptHash !== null)
      requiredEntity(entities, "prompt", "PROMPT", run.promptHash, context);
    if (run.providerHash !== null)
      requiredEntity(entities, "provider", "PROVIDER", run.providerHash, context);
  });

export const EvaluationRunHashInputSchema = AuditSnapshotSchema.pipe(
  EvaluationRunHashInputObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof EvaluationRunHashInputObjectSchema>
>;

export type EvaluationRunHashInput = z.infer<typeof EvaluationRunHashInputSchema>;

export function computeEvaluationRunHash(input: EvaluationRunHashInput): string {
  return sha256CanonicalJson(EvaluationRunHashInputSchema.parse(input));
}

export const EvaluationRunObjectSchema = EvaluationRunHashInputObjectSchema.extend({
  contentHash: Sha256DigestSchema,
})
  .strict()
  .superRefine((run, context) => {
    const { contentHash, ...hashInput } = run;
    const parsed = EvaluationRunHashInputSchema.safeParse(hashInput);
    if (!parsed.success || contentHash !== sha256CanonicalJson(parsed.data)) {
      context.addIssue({
        code: "custom",
        message: "contentHash does not match the canonical EvaluationRun",
        path: ["contentHash"],
      });
    }
  });

export const EvaluationRunSchema = AuditSnapshotSchema.pipe(EvaluationRunObjectSchema).overwrite(
  (value) => deepFreeze(value),
) as z.ZodType<z.infer<typeof EvaluationRunObjectSchema>>;

export type EvaluationRun = z.infer<typeof EvaluationRunSchema>;

export function verifyEvaluationRunHash(run: unknown): boolean {
  return EvaluationRunSchema.safeParse(run).success;
}

export const ReviewDecisionHashInputObjectSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_DECISION_SCHEMA_VERSION),
    id: z.uuid(),
    runId: z.uuid(),
    runContentHash: Sha256DigestSchema,
    sequence: z.int().min(1).max(EVALUATION_AUDIT_LIMITS.maxReviewDecisions),
    previousEventHash: Sha256DigestSchema.nullable(),
    decision: ReviewDecisionTypeSchema,
    findingRuleId: z.uuid().nullable(),
    targetOutcome: EvaluationOutcomeSchema.nullable(),
    reason: BoundedTextSchema,
    decidedAt: UtcDateTimeSchema,
    actorId: z.uuid(),
    exercisedRole: ActorRoleSchema,
    validationScope: ValidationScopeSchema,
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.sequence === 1 && decision.previousEventHash !== null) {
      context.addIssue({
        code: "custom",
        message: "The first review decision cannot reference a previous event",
        path: ["previousEventHash"],
      });
    }
    if (decision.sequence > 1 && decision.previousEventHash === null) {
      context.addIssue({
        code: "custom",
        message: "Subsequent review decisions must reference the previous event hash",
        path: ["previousEventHash"],
      });
    }
    if (decision.decision === "REQUEST_MORE_EVIDENCE" && decision.targetOutcome !== null) {
      context.addIssue({
        code: "custom",
        message: "A request for more evidence cannot set a target outcome",
        path: ["targetOutcome"],
      });
    }
  });

export const ReviewDecisionHashInputSchema = AuditSnapshotSchema.pipe(
  ReviewDecisionHashInputObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof ReviewDecisionHashInputObjectSchema>
>;

export type ReviewDecisionHashInput = z.infer<typeof ReviewDecisionHashInputSchema>;

export function computeReviewDecisionHash(input: ReviewDecisionHashInput): string {
  return sha256CanonicalJson(ReviewDecisionHashInputSchema.parse(input));
}

export const ReviewDecisionObjectSchema = ReviewDecisionHashInputObjectSchema.extend({
  contentHash: Sha256DigestSchema,
})
  .strict()
  .superRefine((decision, context) => {
    const { contentHash, ...hashInput } = decision;
    const parsed = ReviewDecisionHashInputSchema.safeParse(hashInput);
    if (!parsed.success || contentHash !== sha256CanonicalJson(parsed.data)) {
      context.addIssue({
        code: "custom",
        message: "contentHash does not match the canonical ReviewDecision",
        path: ["contentHash"],
      });
    }
  });

export const ReviewDecisionSchema = AuditSnapshotSchema.pipe(ReviewDecisionObjectSchema).overwrite(
  (value) => deepFreeze(value),
) as z.ZodType<z.infer<typeof ReviewDecisionObjectSchema>>;

export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export function verifyReviewDecisionHash(decision: unknown): boolean {
  return ReviewDecisionSchema.safeParse(decision).success;
}

function refineReviewDecisionChain(
  run: EvaluationRun,
  decisions: readonly ReviewDecision[],
  context: z.core.$RefinementCtx,
): void {
  decisions.forEach((decision, index) => {
    if (decision.runId !== run.id || decision.runContentHash !== run.contentHash) {
      context.addIssue({
        code: "custom",
        message: "Review decision is not bound to the exported EvaluationRun",
        path: ["reviewDecisions", index, "runId"],
      });
    }
    if (decision.sequence !== index + 1) {
      context.addIssue({
        code: "custom",
        message: "Review decision sequence must be contiguous from one",
        path: ["reviewDecisions", index, "sequence"],
      });
    }
    const expectedPrevious = index === 0 ? null : decisions[index - 1]?.contentHash;
    if (decision.previousEventHash !== expectedPrevious) {
      context.addIssue({
        code: "custom",
        message: "Review decision chain hash does not match the previous event",
        path: ["reviewDecisions", index, "previousEventHash"],
      });
    }
  });
}

export const EvaluationAuditExportHashInputObjectSchema = z
  .object({
    schemaVersion: z.literal(EVALUATION_AUDIT_EXPORT_SCHEMA_VERSION),
    exportedAt: UtcDateTimeSchema,
    run: EvaluationRunSchema,
    reviewDecisions: z
      .array(ReviewDecisionSchema)
      .max(EVALUATION_AUDIT_LIMITS.maxReviewDecisions)
      .readonly(),
  })
  .strict()
  .superRefine((exported, context) => {
    refineReviewDecisionChain(exported.run, exported.reviewDecisions, context);
  });

export const EvaluationAuditExportHashInputSchema = AuditSnapshotSchema.pipe(
  EvaluationAuditExportHashInputObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof EvaluationAuditExportHashInputObjectSchema>
>;

export type EvaluationAuditExportHashInput = z.infer<typeof EvaluationAuditExportHashInputSchema>;

export function computeEvaluationAuditExportHash(input: EvaluationAuditExportHashInput): string {
  return sha256CanonicalJson(EvaluationAuditExportHashInputSchema.parse(input));
}

export const EvaluationAuditExportObjectSchema = EvaluationAuditExportHashInputObjectSchema.extend({
  exportHash: Sha256DigestSchema,
})
  .strict()
  .superRefine((exported, context) => {
    const { exportHash, ...hashInput } = exported;
    const parsed = EvaluationAuditExportHashInputSchema.safeParse(hashInput);
    if (!parsed.success || exportHash !== sha256CanonicalJson(parsed.data)) {
      context.addIssue({
        code: "custom",
        message: "exportHash does not match the canonical audit export",
        path: ["exportHash"],
      });
    }
  })
  .readonly();

export const EvaluationAuditExportSchema = AuditSnapshotSchema.pipe(
  EvaluationAuditExportObjectSchema,
).overwrite((value) => deepFreeze(value)) as z.ZodType<
  z.infer<typeof EvaluationAuditExportObjectSchema>
>;

export type EvaluationAuditExport = z.infer<typeof EvaluationAuditExportSchema>;

export function verifyEvaluationAuditExportHash(exported: unknown): boolean {
  return EvaluationAuditExportSchema.safeParse(exported).success;
}

export function canonicalizeEvaluationAuditExport(exported: EvaluationAuditExport): string {
  return canonicalizeJson(EvaluationAuditExportSchema.parse(exported));
}
