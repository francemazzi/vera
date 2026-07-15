import {
  ComplianceSourceEligibilityRequestSchema,
  ComplianceSourceSchema,
  ComplianceSourceTransitionEventSchema,
  ComplianceSourceVersionSchema,
  UtcDateTimeSchema,
  canPerformComplianceSourceTransition,
  compareUtcDateTimes,
  isWithinValidityInterval,
} from "@vera/contracts";
import type {
  ComplianceSource,
  ComplianceSourceEligibilityRequest,
  ComplianceSourceState,
  ComplianceSourceTransitionEvent,
  ComplianceSourceVersion,
  UtcDateTime,
  WorkflowTransitionContext,
} from "@vera/contracts";

import {
  ComplianceSourceConflictError,
  ComplianceSourceEligibilityError,
  ComplianceSourceInvariantError,
  ComplianceSourceNotFoundError,
  ComplianceSourceValidationError,
} from "./errors.js";

export interface TransitionExpectation {
  /** Sequence observed by the caller before appending the next event. */
  readonly sequence: number;
  /** State observed by the caller before appending the next event. */
  readonly state: ComplianceSourceState | null;
}

export interface ComplianceSourceTransitionAuthorization {
  readonly actor: WorkflowTransitionContext["actor"];
  readonly reason?: string;
}

export type VersionActivationEligibilityRequest = ComplianceSourceEligibilityRequest;

export interface ComplianceSourceVersionSnapshot {
  readonly version: ComplianceSourceVersion;
  readonly state: ComplianceSourceState | null;
  readonly transitions: readonly ComplianceSourceTransitionEvent[];
}

export interface ComplianceSourceHistory {
  readonly source: ComplianceSource;
  readonly versions: readonly ComplianceSourceVersionSnapshot[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryComplianceSourceRepository {
  readonly #sources = new Map<string, ComplianceSource>();
  readonly #versions = new Map<string, ComplianceSourceVersion>();
  readonly #versionIdsBySource = new Map<string, string[]>();
  readonly #eventsByVersion = new Map<string, ComplianceSourceTransitionEvent[]>();
  readonly #eventIds = new Set<string>();

  public addSource(source: ComplianceSource): ComplianceSource {
    const parsed = ComplianceSourceSchema.safeParse(source);
    if (!parsed.success) {
      throw new ComplianceSourceValidationError(
        "INVALID_SOURCE_PAYLOAD",
        "Compliance source payload does not satisfy the strict public contract",
        { issueCount: parsed.error.issues.length },
      );
    }
    const validSource = parsed.data;

    if (this.#sources.has(validSource.id)) {
      throw new ComplianceSourceConflictError(
        "SOURCE_ALREADY_EXISTS",
        `Compliance source ${validSource.id} already exists`,
        { sourceId: validSource.id },
      );
    }

    const stored = clone(validSource);
    this.#sources.set(stored.id, stored);
    this.#versionIdsBySource.set(stored.id, []);
    return clone(stored);
  }

  public appendVersion(
    version: ComplianceSourceVersion,
    expectedCurrentRevision: number,
  ): ComplianceSourceVersion {
    const parsed = ComplianceSourceVersionSchema.safeParse(version);
    if (!parsed.success) {
      throw new ComplianceSourceValidationError(
        "INVALID_VERSION_PAYLOAD",
        "Compliance source version payload does not satisfy the strict public contract",
        { issueCount: parsed.error.issues.length },
      );
    }
    const validVersion = parsed.data;

    if (this.#versions.has(validVersion.id)) {
      throw new ComplianceSourceConflictError(
        "VERSION_ALREADY_EXISTS",
        `Compliance source version ${validVersion.id} already exists`,
        { versionId: validVersion.id },
      );
    }

    const versionIds = this.#versionIdsBySource.get(validVersion.sourceId);
    if (versionIds === undefined) {
      throw new ComplianceSourceNotFoundError(
        "SOURCE_NOT_FOUND",
        `Compliance source ${validVersion.sourceId} does not exist`,
        { sourceId: validVersion.sourceId },
      );
    }

    const currentRevision = versionIds.length;
    if (expectedCurrentRevision !== currentRevision) {
      throw new ComplianceSourceConflictError(
        "VERSION_REVISION_CONFLICT",
        `Expected current revision ${String(expectedCurrentRevision)} but found ${String(currentRevision)}`,
        {
          actualRevision: currentRevision,
          expectedRevision: expectedCurrentRevision,
          sourceId: validVersion.sourceId,
        },
      );
    }

    const expectedRevision = currentRevision + 1;
    if (validVersion.revision !== expectedRevision) {
      throw new ComplianceSourceInvariantError(
        "REVISION_NOT_MONOTONIC",
        `Revision ${String(validVersion.revision)} must be the next revision (${String(expectedRevision)})`,
        {
          actualRevision: validVersion.revision,
          expectedRevision,
          sourceId: validVersion.sourceId,
        },
      );
    }

    this.#assertValidReplacement(validVersion, versionIds);

    const stored = clone(validVersion);
    this.#versions.set(stored.id, stored);
    versionIds.push(stored.id);
    this.#eventsByVersion.set(stored.id, []);
    return clone(stored);
  }

  public appendTransition(
    event: ComplianceSourceTransitionEvent,
    authorization: ComplianceSourceTransitionAuthorization,
    expected: TransitionExpectation,
  ): ComplianceSourceTransitionEvent {
    const parsed = ComplianceSourceTransitionEventSchema.safeParse(event);
    if (!parsed.success) {
      throw new ComplianceSourceValidationError(
        "INVALID_TRANSITION_PAYLOAD",
        "Compliance source transition payload does not satisfy the strict public contract",
        { issueCount: parsed.error.issues.length },
      );
    }
    const validEvent = parsed.data;

    if (this.#eventIds.has(validEvent.id)) {
      throw new ComplianceSourceConflictError(
        "TRANSITION_ALREADY_EXISTS",
        `Compliance source transition ${validEvent.id} already exists`,
        { eventId: validEvent.id },
      );
    }

    const history = this.#eventsByVersion.get(validEvent.versionId);
    if (history === undefined) {
      throw new ComplianceSourceNotFoundError(
        "VERSION_NOT_FOUND",
        `Compliance source version ${validEvent.versionId} does not exist`,
        { versionId: validEvent.versionId },
      );
    }

    const last = history.at(-1);
    const currentSequence = last?.sequence ?? 0;
    const currentState = last?.to ?? null;

    if (expected.sequence !== currentSequence || expected.state !== currentState) {
      throw new ComplianceSourceConflictError(
        "TRANSITION_CONCURRENCY_CONFLICT",
        `Expected sequence/state ${String(expected.sequence)}/${String(expected.state)} but found ${String(currentSequence)}/${String(currentState)}`,
        {
          actualSequence: currentSequence,
          actualState: currentState,
          expectedSequence: expected.sequence,
          expectedState: expected.state,
          versionId: validEvent.versionId,
        },
      );
    }

    if (validEvent.sequence !== currentSequence + 1 || validEvent.from !== currentState) {
      throw new ComplianceSourceInvariantError(
        "TRANSITION_EVENT_MISMATCH",
        "Transition event does not continue the stored sequence and state",
        {
          eventFrom: validEvent.from,
          eventSequence: validEvent.sequence,
          versionId: validEvent.versionId,
        },
      );
    }

    const version = this.#requireVersion(validEvent.versionId);
    if (validEvent.contentHash !== version.contentHash) {
      throw new ComplianceSourceInvariantError(
        "TRANSITION_EVENT_MISMATCH",
        "Transition event content hash does not match its immutable source version",
        {
          eventContentHash: validEvent.contentHash,
          versionContentHash: version.contentHash,
          versionId: validEvent.versionId,
        },
      );
    }

    const previousTimestamp = last?.at ?? version.createdAt;
    if (compareUtcDateTimes(validEvent.at, previousTimestamp) < 0) {
      throw new ComplianceSourceInvariantError(
        "TRANSITION_TIME_NOT_MONOTONIC",
        "Transition event timestamp cannot precede the version or prior event timestamp",
        {
          at: validEvent.at,
          previousAt: previousTimestamp,
          versionId: validEvent.versionId,
        },
      );
    }

    const contextReason = authorization.reason ?? null;
    const derivedContext = this.#deriveTransitionContext(version, history, authorization);
    if (
      validEvent.actorId !== authorization.actor.id ||
      validEvent.exercisedRole !== authorization.actor.role ||
      validEvent.reason !== contextReason ||
      !canPerformComplianceSourceTransition(currentState, validEvent.to, derivedContext)
    ) {
      throw new ComplianceSourceInvariantError(
        "TRANSITION_NOT_AUTHORIZED",
        "Actor, reason, role, independence, or workflow does not authorize the transition",
        {
          actorId: authorization.actor.id,
          eventActorId: validEvent.actorId,
          from: validEvent.from,
          to: validEvent.to,
          versionId: validEvent.versionId,
        },
      );
    }

    const stored = clone(validEvent);
    history.push(stored);
    this.#eventIds.add(stored.id);
    return clone(stored);
  }

  public getSource(sourceId: string): ComplianceSource {
    return clone(this.#requireSource(sourceId));
  }

  public getVersion(versionId: string): ComplianceSourceVersion {
    return clone(this.#requireVersion(versionId));
  }

  public getVersions(sourceId: string): readonly ComplianceSourceVersion[] {
    const versionIds = this.#versionIdsBySource.get(sourceId);
    if (versionIds === undefined) {
      throw new ComplianceSourceNotFoundError(
        "SOURCE_NOT_FOUND",
        `Compliance source ${sourceId} does not exist`,
        { sourceId },
      );
    }

    return versionIds.map((versionId) => this.getVersion(versionId));
  }

  public getVersionState(versionId: string): ComplianceSourceState | null {
    const history = this.#eventsByVersion.get(versionId);
    if (history === undefined) {
      throw new ComplianceSourceNotFoundError(
        "VERSION_NOT_FOUND",
        `Compliance source version ${versionId} does not exist`,
        { versionId },
      );
    }

    return history.at(-1)?.to ?? null;
  }

  public getVersionStateAt(versionId: string, at: UtcDateTime): ComplianceSourceState | null {
    const parsedAt = UtcDateTimeSchema.safeParse(at);
    if (!parsedAt.success) {
      throw new ComplianceSourceValidationError(
        "INVALID_STATE_AT",
        "Historical source state requires a canonical UTC timestamp",
        { issueCount: parsedAt.error.issues.length },
      );
    }
    const history = this.getTransitionHistory(versionId);
    let state: ComplianceSourceState | null = null;

    for (const event of history) {
      if (compareUtcDateTimes(event.at, parsedAt.data) > 0) break;
      state = event.to;
    }

    return state;
  }

  public getTransitionHistory(versionId: string): readonly ComplianceSourceTransitionEvent[] {
    const history = this.#eventsByVersion.get(versionId);
    if (history === undefined) {
      throw new ComplianceSourceNotFoundError(
        "VERSION_NOT_FOUND",
        `Compliance source version ${versionId} does not exist`,
        { versionId },
      );
    }

    return clone(history);
  }

  public getSourceHistory(sourceId: string): ComplianceSourceHistory {
    const source = this.getSource(sourceId);
    const versions = this.getVersions(sourceId).map((version) => ({
      version,
      state: this.getVersionState(version.id),
      transitions: this.getTransitionHistory(version.id),
    }));

    return { source, versions };
  }

  public assertVersionEligibleForActivation(
    request: VersionActivationEligibilityRequest,
  ): ComplianceSourceVersion {
    const parsed = ComplianceSourceEligibilityRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ComplianceSourceValidationError(
        "INVALID_ELIGIBILITY_REQUEST",
        "Source eligibility request does not satisfy the strict public contract",
        { issueCount: parsed.error.issues.length },
      );
    }
    const validRequest = parsed.data;
    const version = this.getVersion(validRequest.versionId);

    if (version.contentHash !== validRequest.expectedContentHash) {
      throw new ComplianceSourceEligibilityError(
        "CONTENT_HASH_MISMATCH",
        `Compliance source version ${validRequest.versionId} does not match the activating snapshot hash`,
        {
          actualContentHash: version.contentHash,
          expectedContentHash: validRequest.expectedContentHash,
          versionId: validRequest.versionId,
        },
      );
    }

    const state = this.getVersionStateAt(validRequest.versionId, validRequest.activationAt);

    if (state !== "APPROVED") {
      throw new ComplianceSourceEligibilityError(
        "VERSION_NOT_APPROVED",
        `Compliance source version ${validRequest.versionId} was ${String(state)}, not APPROVED, at activation`,
        { activationAt: validRequest.activationAt, state, versionId: validRequest.versionId },
      );
    }

    if (!isWithinValidityInterval(version.validity, validRequest.evaluationDate)) {
      throw new ComplianceSourceEligibilityError(
        "VERSION_OUTSIDE_VALIDITY",
        `Compliance source version ${validRequest.versionId} is not valid at ${validRequest.evaluationDate}`,
        { evaluationDate: validRequest.evaluationDate, versionId: validRequest.versionId },
      );
    }

    return version;
  }

  #assertValidReplacement(
    version: ComplianceSourceVersion,
    existingVersionIds: readonly string[],
  ): void {
    const expectedPredecessorId = existingVersionIds.at(-1) ?? null;
    if (version.replacesVersionId !== expectedPredecessorId) {
      throw new ComplianceSourceInvariantError(
        "INVALID_REPLACEMENT",
        "Each revision must replace the immediately preceding version in the source history",
        {
          expectedPredecessorId,
          replacesVersionId: version.replacesVersionId,
          sourceId: version.sourceId,
          versionId: version.id,
        },
      );
    }
  }

  #deriveTransitionContext(
    version: ComplianceSourceVersion,
    history: readonly ComplianceSourceTransitionEvent[],
    authorization: ComplianceSourceTransitionAuthorization,
  ): WorkflowTransitionContext {
    const contributorIds = new Set<string>([version.createdBy]);
    const excludedActorIds = new Set<string>();

    for (const event of history) {
      if (event.exercisedRole === "AUTHOR") contributorIds.add(event.actorId);
      if (event.exercisedRole === "REVIEWER") excludedActorIds.add(event.actorId);
    }

    const base = {
      actor: authorization.actor,
      contributorIds: [...contributorIds],
      excludedActorIds: [...excludedActorIds],
    };
    return authorization.reason === undefined ? base : { ...base, reason: authorization.reason };
  }

  #requireSource(sourceId: string): ComplianceSource {
    const source = this.#sources.get(sourceId);
    if (source === undefined) {
      throw new ComplianceSourceNotFoundError(
        "SOURCE_NOT_FOUND",
        `Compliance source ${sourceId} does not exist`,
        { sourceId },
      );
    }
    return source;
  }

  #requireVersion(versionId: string): ComplianceSourceVersion {
    const version = this.#versions.get(versionId);
    if (version === undefined) {
      throw new ComplianceSourceNotFoundError(
        "VERSION_NOT_FOUND",
        `Compliance source version ${versionId} does not exist`,
        { versionId },
      );
    }
    return version;
  }
}
