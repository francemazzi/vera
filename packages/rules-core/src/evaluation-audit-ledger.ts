import {
  EVALUATION_AUDIT_EXPORT_SCHEMA_VERSION,
  EVALUATION_RUN_SCHEMA_VERSION,
  REVIEW_DECISION_SCHEMA_VERSION,
  EvaluationAuditExportSchema,
  EvaluationRunSchema,
  ReviewDecisionSchema,
  computeEvaluationAuditExportHash,
  computeEvaluationRunHash,
  computeEvaluationSnapshotFindingsHash,
  computeEvaluationSnapshotResultHash,
  computeEvaluationSnapshotTraceHash,
  computeReviewDecisionHash,
  sha256CanonicalJson,
} from "@vera/contracts";
import type {
  ActorRole,
  AuditAgent,
  AuditEntityRef,
  EvaluationAuditExport,
  EvaluationOutcome,
  EvaluationRun,
  JsonValue,
  ReviewDecision,
  ReviewDecisionType,
  RulePackEvaluationSnapshot,
  UtcDateTime,
  ValidationScope,
} from "@vera/contracts";

const TECHNICAL_DEMO_SCOPE = "TECHNICAL_DEMO" as const satisfies ValidationScope;

export interface BuildEvaluationRunInput {
  readonly id: string;
  readonly caseId?: string | null;
  readonly recordedAt: UtcDateTime;
  readonly evaluationSnapshot: RulePackEvaluationSnapshot;
  readonly input: JsonValue;
  readonly facts: JsonValue;
  readonly evidence: JsonValue;
  readonly prompt?: JsonValue | null;
  readonly provider?: JsonValue | null;
  readonly agent: AuditAgent;
}

export interface BuildReviewDecisionInput {
  readonly id: string;
  readonly run: EvaluationRun;
  readonly previousDecision?: ReviewDecision | null;
  readonly decision: ReviewDecisionType;
  readonly findingRuleId?: string | null;
  readonly targetOutcome?: EvaluationOutcome | null;
  readonly reason: string;
  readonly decidedAt: UtcDateTime;
  readonly actorId: string;
  readonly exercisedRole: ActorRole;
}

export interface EvaluationReplayResult {
  readonly run: EvaluationRun;
  readonly evaluationSnapshot: RulePackEvaluationSnapshot;
  readonly reviewDecisions: readonly ReviewDecision[];
}

function sorted<T extends { readonly id: string }>(items: readonly T[]): readonly T[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

function sortedStrings(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function entity(
  id: string,
  kind: AuditEntityRef["kind"],
  contentHash: string,
  description: string,
  mediaType: string | null = "application/json",
): AuditEntityRef {
  return { id, kind, contentHash, mediaType, description };
}

function parseRun(value: unknown): EvaluationRun {
  return EvaluationRunSchema.parse(structuredClone(value));
}

function parseDecision(value: unknown): ReviewDecision {
  return ReviewDecisionSchema.parse(structuredClone(value));
}

function parseExport(value: unknown): EvaluationAuditExport {
  return EvaluationAuditExportSchema.parse(structuredClone(value));
}

export function buildEvaluationRun(input: BuildEvaluationRunInput): EvaluationRun {
  const snapshot = input.evaluationSnapshot;
  const inputHash = sha256CanonicalJson(input.input);
  const factsHash = sha256CanonicalJson(input.facts);
  const evidenceHash = sha256CanonicalJson(input.evidence);
  const promptHash =
    input.prompt === undefined || input.prompt === null ? null : sha256CanonicalJson(input.prompt);
  const providerHash =
    input.provider === undefined || input.provider === null
      ? null
      : sha256CanonicalJson(input.provider);
  const evaluationSnapshotHash = snapshot.contentHash;
  const evaluationResultHash = computeEvaluationSnapshotResultHash(snapshot);
  const findingsHash = computeEvaluationSnapshotFindingsHash(snapshot);
  const traceHash = computeEvaluationSnapshotTraceHash(snapshot);

  const entities = sorted([
    entity("evaluationResult", "EVALUATION_RESULT", evaluationResultHash, "Resolved findings"),
    entity("evidence", "EVIDENCE", evidenceHash, "Evidence supplied to the evaluator"),
    entity("facts", "FACTS", factsHash, "Facts supplied to the evaluator"),
    entity("findings", "FINDINGS", findingsHash, "Rule finding collection"),
    entity("input", "INPUT", inputHash, "Original evaluation input"),
    ...(promptHash === null
      ? []
      : [entity("prompt", "PROMPT", promptHash, "Prompt or extraction instruction")]),
    ...(providerHash === null
      ? []
      : [entity("provider", "PROVIDER", providerHash, "Provider and runtime metadata")]),
    entity(
      "rulePackSnapshot",
      "RULE_PACK_SNAPSHOT",
      evaluationSnapshotHash,
      "Immutable Rule Pack evaluation snapshot",
    ),
    entity("trace", "TRACE", traceHash, "Expression trace projection"),
  ]);
  const usedEntityIds = sortedStrings([
    "evidence",
    "facts",
    "input",
    ...(promptHash === null ? [] : ["prompt"]),
    ...(providerHash === null ? [] : ["provider"]),
    "rulePackSnapshot",
  ]);
  const generatedEntityIds = sortedStrings(["evaluationResult", "findings", "trace"]);
  const hashInput = {
    schemaVersion: EVALUATION_RUN_SCHEMA_VERSION,
    id: input.id,
    caseId: input.caseId ?? null,
    recordedAt: input.recordedAt,
    evaluationDate: snapshot.evaluationDate,
    inputHash,
    promptHash,
    providerHash,
    factsHash,
    evidenceHash,
    rulePackVersionId: snapshot.rulePackVersion.id,
    rulePackVersionContentHash: snapshot.rulePackVersion.contentHash,
    evaluationSnapshotHash,
    evaluationResultHash,
    findingsHash,
    traceHash,
    evaluationSnapshot: snapshot,
    entities,
    agents: sorted([input.agent]),
    activities: [
      {
        id: "evaluation",
        type: "EVALUATION_RUN" as const,
        startedAt: input.recordedAt,
        endedAt: input.recordedAt,
        agentId: input.agent.id,
        usedEntityIds,
        generatedEntityIds,
      },
    ],
    validationScope: TECHNICAL_DEMO_SCOPE,
  };
  return EvaluationRunSchema.parse({
    ...hashInput,
    contentHash: computeEvaluationRunHash(hashInput),
  });
}

export function buildReviewDecision(input: BuildReviewDecisionInput): ReviewDecision {
  const sequence = (input.previousDecision?.sequence ?? 0) + 1;
  const hashInput = {
    schemaVersion: REVIEW_DECISION_SCHEMA_VERSION,
    id: input.id,
    runId: input.run.id,
    runContentHash: input.run.contentHash,
    sequence,
    previousEventHash: input.previousDecision?.contentHash ?? null,
    decision: input.decision,
    findingRuleId: input.findingRuleId ?? null,
    targetOutcome: input.targetOutcome ?? null,
    reason: input.reason,
    decidedAt: input.decidedAt,
    actorId: input.actorId,
    exercisedRole: input.exercisedRole,
    validationScope: TECHNICAL_DEMO_SCOPE,
  };
  return ReviewDecisionSchema.parse({
    ...hashInput,
    contentHash: computeReviewDecisionHash(hashInput),
  });
}

export class EvaluationAuditLedgerError extends Error {}

export class InMemoryEvaluationAuditLedger {
  readonly #runs = new Map<string, EvaluationRun>();
  readonly #reviewDecisionsByRun = new Map<string, ReviewDecision[]>();
  readonly #reviewDecisionIds = new Set<string>();

  public recordRun(runInput: EvaluationRun): EvaluationRun {
    const run = parseRun(runInput);
    if (this.#runs.has(run.id)) {
      throw new EvaluationAuditLedgerError(`EvaluationRun already exists: ${run.id}`);
    }
    this.#runs.set(run.id, run);
    this.#reviewDecisionsByRun.set(run.id, []);
    return parseRun(run);
  }

  public appendReviewDecision(decisionInput: ReviewDecision): ReviewDecision {
    const decision = parseDecision(decisionInput);
    const run = this.#runs.get(decision.runId);
    if (run === undefined) {
      throw new EvaluationAuditLedgerError(`Unknown EvaluationRun: ${decision.runId}`);
    }
    if (decision.runContentHash !== run.contentHash) {
      throw new EvaluationAuditLedgerError(
        "Review decision is bound to a stale EvaluationRun hash",
      );
    }
    if (this.#reviewDecisionIds.has(decision.id)) {
      throw new EvaluationAuditLedgerError(`ReviewDecision already exists: ${decision.id}`);
    }
    const decisions = this.#reviewDecisionsByRun.get(decision.runId);
    /* v8 ignore next -- recordRun always initializes the decision stream */
    if (decisions === undefined) throw new EvaluationAuditLedgerError("Missing decision stream");
    const previous = decisions.at(-1);
    const expectedSequence = decisions.length + 1;
    if (decision.sequence !== expectedSequence) {
      throw new EvaluationAuditLedgerError("Review decision sequence is stale or non-contiguous");
    }
    if (decision.previousEventHash !== (previous?.contentHash ?? null)) {
      throw new EvaluationAuditLedgerError("Review decision previous hash is stale");
    }
    decisions.push(decision);
    this.#reviewDecisionIds.add(decision.id);
    return parseDecision(decision);
  }

  public getRun(id: string): EvaluationRun {
    const run = this.#runs.get(id);
    if (run === undefined) throw new EvaluationAuditLedgerError(`Unknown EvaluationRun: ${id}`);
    return parseRun(run);
  }

  public getReviewDecisions(runId: string): readonly ReviewDecision[] {
    if (!this.#runs.has(runId)) {
      throw new EvaluationAuditLedgerError(`Unknown EvaluationRun: ${runId}`);
    }
    return (this.#reviewDecisionsByRun.get(runId) ?? []).map((decision) => parseDecision(decision));
  }

  public exportRun(runId: string, exportedAt: UtcDateTime): EvaluationAuditExport {
    const run = this.getRun(runId);
    const reviewDecisions = this.getReviewDecisions(runId);
    const hashInput = {
      schemaVersion: EVALUATION_AUDIT_EXPORT_SCHEMA_VERSION,
      exportedAt,
      run,
      reviewDecisions,
    };
    return EvaluationAuditExportSchema.parse({
      ...hashInput,
      exportHash: computeEvaluationAuditExportHash(hashInput),
    });
  }

  public importExport(exportInput: EvaluationAuditExport): EvaluationAuditExport {
    const exported = parseExport(exportInput);
    this.recordRun(exported.run);
    for (const decision of exported.reviewDecisions) {
      this.appendReviewDecision(decision);
    }
    return parseExport(exported);
  }
}

export function replayEvaluationAuditExport(
  exportInput: EvaluationAuditExport,
): EvaluationReplayResult {
  const exported = parseExport(exportInput);
  return {
    run: exported.run,
    evaluationSnapshot: exported.run.evaluationSnapshot,
    reviewDecisions: exported.reviewDecisions,
  };
}
