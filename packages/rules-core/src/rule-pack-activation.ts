import { types } from "node:util";

import {
  ActorSchema,
  ActivationEventSchema,
  ResolvedRulePackSchema,
  RulePackResolutionRequestSchema,
  RulePackVersionSchema,
  canonicalizeJson,
  compareSemVer,
  compareUtcDateTimes,
  isWithinValidityInterval,
  validityIntervalsOverlap,
  type Actor,
  type ActivationEvent,
  type ResolvedRulePack,
  type RulePackResolutionRequest,
  type RulePackVersion,
  type UtcDateTime,
  type ValidityInterval,
} from "@vera/contracts";

import {
  RulePackActivationConflictError,
  RulePackActivationInvariantError,
  RulePackActivationNotFoundError,
  RulePackActivationValidationError,
  RulePackNotFoundError,
} from "./rule-pack-errors.js";

const SHA256_DIGEST = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** State observed by a caller before it attempts to append the next ledger event. */
export interface ActivationAppendExpectation {
  readonly sequence: number;
  readonly previousEventHash: string | null;
  readonly activeVersionId: string | null;
}

/** Authoritative actor plus the ledger state observed before an append attempt. */
export interface ActivationAppendCommand {
  readonly actor: Actor;
  readonly expected: ActivationAppendExpectation;
}

/**
 * Published versions are immutable, while approval eligibility is time- and actor-sensitive.
 * The activation boundary therefore requires both capabilities explicitly.
 */
export interface RulePackActivationVersionReader {
  getVersion(versionId: string): RulePackVersion;
  assertVersionEligibleForActivation(
    versionId: string,
    activationAt: UtcDateTime,
    actorId: string,
  ): RulePackVersion;
}

interface ActiveProjection {
  readonly event: ActivationEvent;
  readonly version: RulePackVersion;
}

function immutableClone<T>(value: T): T {
  const cloned = structuredClone(value);
  const stack: object[] = [];
  if (cloned !== null && typeof cloned === "object") stack.push(cloned);
  while (stack.length > 0) {
    const current = stack.pop();
    /* v8 ignore next -- the loop condition guarantees a populated stack */
    if (current === undefined) break;
    Object.freeze(current);
    for (const nested of Object.values(current as Record<string, unknown>)) {
      if (nested !== null && typeof nested === "object" && !Object.isFrozen(nested)) {
        stack.push(nested);
      }
    }
  }
  return cloned;
}

function isNullableUuid(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && UUID.test(value));
}

function isNullableDigest(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && SHA256_DIGEST.test(value));
}

function assertStrictDataObject(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
  code:
    | "INVALID_ACTIVATION_EVENT"
    | "INVALID_RULE_PACK_RESOLUTION_REQUEST" = "INVALID_ACTIVATION_EVENT",
): void {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) {
    throw new RulePackActivationValidationError(code, `${label} must be a strict object`);
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  const ownKeys = Reflect.ownKeys(value);
  const keys = ownKeys.filter((key): key is string => typeof key === "string").sort();
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== ownKeys.length ||
    canonicalizeJson(keys) !== canonicalizeJson([...expectedKeys].sort())
  ) {
    throw new RulePackActivationValidationError(
      code,
      `${label} contains unexpected or missing fields`,
    );
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new RulePackActivationValidationError(
        code,
        `${label} fields must be enumerable data properties`,
      );
    }
  }
}

function parseExpectation(value: unknown): ActivationAppendExpectation {
  assertStrictDataObject(
    value,
    ["activeVersionId", "previousEventHash", "sequence"],
    "Activation expectation",
  );
  const candidate = value as ActivationAppendExpectation;
  if (
    !Number.isSafeInteger(candidate.sequence) ||
    candidate.sequence < 0 ||
    !isNullableDigest(candidate.previousEventHash) ||
    !isNullableUuid(candidate.activeVersionId)
  ) {
    throw new RulePackActivationValidationError(
      "INVALID_ACTIVATION_EVENT",
      "Activation expectation contains an invalid sequence, hash or version identity",
    );
  }
  return immutableClone(candidate);
}

function parseActor(value: unknown): Actor {
  assertStrictDataObject(
    value,
    ["displayName", "id", "role", "validationScope"],
    "Activation actor",
  );
  const parsed = ActorSchema.safeParse(value);
  if (!parsed.success) {
    throw new RulePackActivationValidationError(
      "INVALID_ACTIVATION_EVENT",
      "Activation actor does not satisfy the strict public contract",
      { issueCount: parsed.error.issues.length },
    );
  }
  return immutableClone(parsed.data);
}

function parseAppendCommand(value: unknown): ActivationAppendCommand {
  assertStrictDataObject(value, ["actor", "expected"], "Activation append command");
  const candidate = value as ActivationAppendCommand;
  return immutableClone({
    actor: parseActor(candidate.actor),
    expected: parseExpectation(candidate.expected),
  });
}

function activeVersionIdAfter(event: ActivationEvent | undefined): string | null {
  return event?.type === "DEACTIVATE" ? null : (event?.versionId ?? null);
}

function laterInstant(left: UtcDateTime, right: UtcDateTime): UtcDateTime {
  return compareUtcDateTimes(left, right) >= 0 ? left : right;
}

function earlierNullableInstant(
  left: UtcDateTime | null,
  right: UtcDateTime | null,
): UtcDateTime | null {
  if (left === null) return right;
  if (right === null) return left;
  return compareUtcDateTimes(left, right) <= 0 ? left : right;
}

function activeInterval(
  event: ActivationEvent,
  version: RulePackVersion,
  nextEvent: ActivationEvent | undefined,
): ValidityInterval | null {
  const validFrom = laterInstant(event.effectiveAt, version.validity.validFrom);
  const validTo = earlierNullableInstant(version.validity.validTo, nextEvent?.effectiveAt ?? null);
  if (validTo !== null && compareUtcDateTimes(validFrom, validTo) >= 0) return null;
  return { validFrom, validTo };
}

function compareStrings(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

export type ActivationHistoryInput =
  | ReadonlyMap<string, readonly ActivationEvent[]>
  | Readonly<Record<string, readonly ActivationEvent[]>>
  | readonly ActivationEvent[];

/** In-memory append-only activation ledger and deterministic temporal resolver. */
export class InMemoryRulePackActivationLedger {
  readonly #versionReader: RulePackActivationVersionReader;
  readonly #eventsByPack = new Map<string, ActivationEvent[]>();
  readonly #eventsById = new Map<string, ActivationEvent>();
  readonly #versionSnapshots = new Map<string, RulePackVersion>();

  public constructor(versionReader: RulePackActivationVersionReader) {
    this.#versionReader = versionReader;
  }

  /**
   * Hydrates a trusted durable activation ledger without re-running eligibility authorization.
   * Events are Zod-validated and inserted directly; version snapshots are loaded via getVersion.
   */
  public static fromHistory(
    eventsByPackId: ActivationHistoryInput,
    versionReader: RulePackActivationVersionReader,
  ): InMemoryRulePackActivationLedger {
    const ledger = new InMemoryRulePackActivationLedger(versionReader);
    const grouped = new Map<string, ActivationEvent[]>();

    if (eventsByPackId instanceof Map) {
      for (const [packId, history] of eventsByPackId) {
        grouped.set(packId, [...history]);
      }
    } else if (Array.isArray(eventsByPackId)) {
      for (const eventInput of eventsByPackId) {
        const parsed = ActivationEventSchema.safeParse(eventInput);
        if (!parsed.success) {
          throw new RulePackActivationValidationError(
            "INVALID_ACTIVATION_EVENT",
            "Activation event does not satisfy its strict, hash-verified public contract",
            { issueCount: parsed.error.issues.length },
          );
        }
        const bucket = grouped.get(parsed.data.packId) ?? [];
        bucket.push(parsed.data);
        grouped.set(parsed.data.packId, bucket);
      }
    } else {
      for (const packId of Object.keys(eventsByPackId)) {
        const history = eventsByPackId[packId];
        if (history === undefined) continue;
        grouped.set(packId, [...history]);
      }
    }

    for (const [packId, history] of grouped) {
      const parsedHistory: ActivationEvent[] = [];
      for (const eventInput of history) {
        const parsed = ActivationEventSchema.safeParse(eventInput);
        if (!parsed.success) {
          throw new RulePackActivationValidationError(
            "INVALID_ACTIVATION_EVENT",
            "Activation event does not satisfy its strict, hash-verified public contract",
            { issueCount: parsed.error.issues.length },
          );
        }
        if (parsed.data.packId !== packId) {
          throw new RulePackActivationInvariantError(
            "ACTIVATION_VERSION_MISMATCH",
            "Hydrated activation event packId does not match its history bucket",
            {
              eventId: parsed.data.id,
              expectedPackId: packId,
              packId: parsed.data.packId,
            },
          );
        }
        parsedHistory.push(immutableClone(parsed.data));
      }
      parsedHistory.sort((left, right) => left.sequence - right.sequence);

      const storedHistory: ActivationEvent[] = [];
      for (const event of parsedHistory) {
        if (ledger.#eventsById.has(event.id)) {
          throw new RulePackActivationConflictError(
            "ACTIVATION_EVENT_ALREADY_EXISTS",
            `Activation event ${event.id} already exists`,
            { eventId: event.id },
          );
        }
        const previous = storedHistory.at(-1);
        const expectedSequence = (previous?.sequence ?? 0) + 1;
        if (event.sequence !== expectedSequence) {
          throw new RulePackActivationInvariantError(
            "ACTIVATION_SEQUENCE_MISMATCH",
            "Hydrated activation event does not continue the stored sequence",
            { eventId: event.id, packId, sequence: event.sequence },
          );
        }
        if (event.previousEventHash !== (previous?.contentHash ?? null)) {
          throw new RulePackActivationInvariantError(
            "ACTIVATION_SEQUENCE_MISMATCH",
            "Hydrated activation event does not continue the stored hash chain",
            { eventId: event.id, packId, sequence: event.sequence },
          );
        }
        if (event.versionId !== null) {
          try {
            const version = RulePackVersionSchema.parse(versionReader.getVersion(event.versionId));
            if (version.packId !== event.packId) {
              throw new RulePackActivationInvariantError(
                "ACTIVATION_VERSION_MISMATCH",
                "Hydrated activation target belongs to another pack",
                { eventId: event.id, packId: event.packId, versionId: version.id },
              );
            }
            const cached = ledger.#versionSnapshots.get(version.id);
            if (
              cached !== undefined &&
              (cached.contentHash !== version.contentHash ||
                canonicalizeJson(cached) !== canonicalizeJson(version))
            ) {
              throw new RulePackActivationInvariantError(
                "ACTIVATION_VERSION_MISMATCH",
                "Hydrated activation attempted to replace a cached immutable version snapshot",
                { versionId: version.id },
              );
            }
            if (cached === undefined) {
              ledger.#versionSnapshots.set(version.id, immutableClone(version));
            }
          } catch (error) {
            if (error instanceof RulePackNotFoundError) {
              throw new RulePackActivationNotFoundError(
                "ACTIVATION_VERSION_NOT_FOUND",
                `Activation target version ${event.versionId} does not exist`,
                { versionId: event.versionId },
              );
            }
            throw error;
          }
        }
        storedHistory.push(event);
        ledger.#eventsById.set(event.id, event);
      }
      if (storedHistory.length > 0) {
        ledger.#eventsByPack.set(packId, storedHistory);
      }
    }

    return ledger;
  }

  /**
   * Appends exactly one event. An exact event-ID retry is idempotent; reusing an ID for different
   * bytes, or presenting a stale caller expectation, fails without changing the ledger.
   */
  public appendEvent(
    eventInput: ActivationEvent,
    commandInput: ActivationAppendCommand,
  ): ActivationEvent {
    const parsed = ActivationEventSchema.safeParse(eventInput);
    if (!parsed.success) {
      throw new RulePackActivationValidationError(
        "INVALID_ACTIVATION_EVENT",
        "Activation event does not satisfy its strict, hash-verified public contract",
        { issueCount: parsed.error.issues.length },
      );
    }
    const event = parsed.data;
    const command = parseAppendCommand(commandInput);
    if (command.actor.role !== "APPROVER" || event.actorId !== command.actor.id) {
      throw new RulePackActivationInvariantError(
        "ACTIVATION_NOT_AUTHORIZED",
        "Activation event identity and role must match an authoritative demo approver",
        { actorId: command.actor.id, eventActorId: event.actorId, eventId: event.id },
      );
    }
    const duplicate = this.#eventsById.get(event.id);
    if (duplicate !== undefined) {
      if (canonicalizeJson(duplicate) === canonicalizeJson(event)) return immutableClone(duplicate);
      throw new RulePackActivationConflictError(
        "ACTIVATION_EVENT_ALREADY_EXISTS",
        `Activation event ${event.id} already exists with different content`,
        { eventId: event.id },
      );
    }

    const expectation = command.expected;
    const history = this.#eventsByPack.get(event.packId) ?? [];
    const previous = history.at(-1);
    const currentSequence = previous?.sequence ?? 0;
    const currentHash = previous?.contentHash ?? null;
    const currentVersionId = activeVersionIdAfter(previous);

    if (
      expectation.sequence !== currentSequence ||
      expectation.previousEventHash !== currentHash ||
      expectation.activeVersionId !== currentVersionId
    ) {
      throw new RulePackActivationConflictError(
        "ACTIVATION_CONCURRENCY_CONFLICT",
        "Activation append expectation is stale",
        {
          actualActiveVersionId: currentVersionId,
          actualSequence: currentSequence,
          expectedActiveVersionId: expectation.activeVersionId,
          expectedSequence: expectation.sequence,
          packId: event.packId,
        },
      );
    }
    if (event.sequence !== currentSequence + 1 || event.previousEventHash !== currentHash) {
      throw new RulePackActivationInvariantError(
        "ACTIVATION_SEQUENCE_MISMATCH",
        "Activation event does not continue the stored sequence and hash chain",
        { eventId: event.id, packId: event.packId, sequence: event.sequence },
      );
    }
    if (event.expectedPreviousVersionId !== currentVersionId) {
      throw new RulePackActivationInvariantError(
        "ACTIVATION_VERSION_MISMATCH",
        "Activation event does not name the currently projected version",
        {
          actualActiveVersionId: currentVersionId,
          eventId: event.id,
          expectedPreviousVersionId: event.expectedPreviousVersionId,
          packId: event.packId,
        },
      );
    }

    this.#assertMonotonicTime(event, previous);
    const targetVersion = this.#validateTarget(event, history, currentVersionId);
    if (targetVersion !== null) this.#assertNoScopeAmbiguity(event, targetVersion);

    const storedEvent = immutableClone(event);
    if (targetVersion !== null) this.#versionSnapshots.set(targetVersion.id, targetVersion);
    if (history.length === 0) this.#eventsByPack.set(event.packId, [storedEvent]);
    else history.push(storedEvent);
    this.#eventsById.set(storedEvent.id, storedEvent);
    return immutableClone(storedEvent);
  }

  public getHistory(packId: string): readonly ActivationEvent[] {
    const history = this.#eventsByPack.get(packId);
    if (history === undefined) {
      throw new RulePackActivationNotFoundError(
        "ACTIVATION_PACK_NOT_FOUND",
        `No activation history exists for Rule Pack ${packId}`,
        { packId },
      );
    }
    return immutableClone(history);
  }

  /** Replays the ledger at the requested instant and requires exactly one eligible candidate. */
  public resolve(requestInput: RulePackResolutionRequest): ResolvedRulePack {
    assertStrictDataObject(
      requestInput,
      ["domain", "evaluationDate", "jurisdiction"],
      "Rule Pack resolution request",
      "INVALID_RULE_PACK_RESOLUTION_REQUEST",
    );
    const parsed = RulePackResolutionRequestSchema.safeParse(requestInput);
    if (!parsed.success) {
      throw new RulePackActivationValidationError(
        "INVALID_RULE_PACK_RESOLUTION_REQUEST",
        "Rule Pack resolution request does not satisfy its strict public contract",
        { issueCount: parsed.error.issues.length },
      );
    }
    const request = parsed.data;
    const candidates: ActiveProjection[] = [];
    for (const [packId, history] of [...this.#eventsByPack.entries()].sort(([left], [right]) =>
      compareStrings(left, right),
    )) {
      const projection = this.#projectAt(history, request.evaluationDate);
      if (projection === null) continue;
      /* v8 ignore next 7 -- projection filters DEACTIVATE and event schema binds every selector */
      if (projection.versionId === null) {
        throw new RulePackActivationInvariantError(
          "ACTIVATION_VERSION_MISMATCH",
          "Projected activation event has no version target",
          { eventId: projection.id, packId },
        );
      }
      const version = this.#getVersionSnapshot(projection.versionId, packId);
      if (
        version.domain === request.domain &&
        version.jurisdiction === request.jurisdiction &&
        isWithinValidityInterval(version.validity, request.evaluationDate)
      ) {
        candidates.push({ event: projection, version });
      }
    }
    if (candidates.length === 0) {
      throw new RulePackActivationNotFoundError(
        "RULE_PACK_RESOLUTION_NOT_FOUND",
        "No active Rule Pack matches the requested domain, jurisdiction and evaluation date",
        {
          domain: request.domain,
          evaluationDate: request.evaluationDate,
          jurisdiction: request.jurisdiction,
        },
      );
    }
    /* v8 ignore next 12 -- append-time interval checks prevent ambiguity in a valid ledger */
    if (candidates.length > 1) {
      throw new RulePackActivationInvariantError(
        "RULE_PACK_RESOLUTION_AMBIGUOUS",
        "More than one active Rule Pack matches the requested scope and date",
        {
          candidateCount: candidates.length,
          domain: request.domain,
          evaluationDate: request.evaluationDate,
          jurisdiction: request.jurisdiction,
        },
      );
    }

    const candidate = candidates[0];
    /* v8 ignore next -- the preceding cardinality checks guarantee one candidate */
    if (candidate === undefined) throw new TypeError("Missing Rule Pack resolution candidate");
    return immutableClone(
      ResolvedRulePackSchema.parse({
        request,
        rulePackVersion: candidate.version,
        activationEvent: candidate.event,
      }),
    );
  }

  #assertMonotonicTime(event: ActivationEvent, previous: ActivationEvent | undefined): void {
    if (previous === undefined) return;
    const effectiveComparison = compareUtcDateTimes(event.effectiveAt, previous.effectiveAt);
    if (effectiveComparison === 0) {
      throw new RulePackActivationInvariantError(
        "ACTIVATION_OVERLAP_AMBIGUOUS",
        "Two activation events for one pack cannot share an effective instant",
        { effectiveAt: event.effectiveAt, eventId: event.id, packId: event.packId },
      );
    }
    if (effectiveComparison < 0 || compareUtcDateTimes(event.recordedAt, previous.recordedAt) < 0) {
      throw new RulePackActivationInvariantError(
        "ACTIVATION_TIME_NOT_MONOTONIC",
        "Activation events cannot be backdated relative to the stored ledger",
        { eventId: event.id, packId: event.packId, previousEventId: previous.id },
      );
    }
  }

  #validateTarget(
    event: ActivationEvent,
    history: readonly ActivationEvent[],
    currentVersionId: string | null,
  ): RulePackVersion | null {
    if (event.type === "DEACTIVATE") return null;
    const versionId = event.versionId;
    /* v8 ignore next -- ActivationEventSchema requires a target for non-deactivation events */
    if (versionId === null) {
      throw new RulePackActivationInvariantError(
        "ACTIVATION_VERSION_MISMATCH",
        "Activation event has no target version",
        { eventId: event.id },
      );
    }

    const version = this.#readEligibleVersion(versionId, event.effectiveAt, event.actorId);
    if (
      version.packId !== event.packId ||
      event.versionContentHash !== version.contentHash ||
      !isWithinValidityInterval(version.validity, event.effectiveAt)
    ) {
      throw new RulePackActivationInvariantError(
        "ACTIVATION_VERSION_MISMATCH",
        "Activation target identity, content hash, lineage or temporal validity does not match",
        { eventId: event.id, packId: event.packId, versionId },
      );
    }
    if (compareUtcDateTimes(event.recordedAt, version.publishedAt) < 0) {
      throw new RulePackActivationInvariantError(
        "ACTIVATION_TIME_NOT_MONOTONIC",
        "An activation event cannot predate publication of its target version",
        { eventId: event.id, publishedAt: version.publishedAt, versionId },
      );
    }

    const lineageVersion = history.find(({ versionId: historicalId }) => historicalId !== null);
    if (lineageVersion !== undefined && lineageVersion.versionId !== null) {
      const firstVersion = this.#getVersionSnapshot(lineageVersion.versionId, event.packId);
      if (
        firstVersion.domain !== version.domain ||
        firstVersion.jurisdiction !== version.jurisdiction
      ) {
        throw new RulePackActivationInvariantError(
          "ACTIVATION_VERSION_MISMATCH",
          "Every version in one activation ledger must preserve domain and jurisdiction",
          { eventId: event.id, packId: event.packId, versionId },
        );
      }
    }

    if (event.type === "ROLLBACK") {
      const wasPreviouslyActivated = history.some(
        (historicalEvent) =>
          historicalEvent.type !== "DEACTIVATE" && historicalEvent.versionId === version.id,
      );
      /* v8 ignore next -- rollback contracts and state matching require a current version */
      const currentVersion =
        currentVersionId === null ? null : this.#getVersionSnapshot(currentVersionId, event.packId);
      if (
        !wasPreviouslyActivated ||
        currentVersion === null ||
        compareSemVer(version.semver, currentVersion.semver) >= 0
      ) {
        throw new RulePackActivationInvariantError(
          "ACTIVATION_VERSION_MISMATCH",
          "ROLLBACK must select a previously active version with lower SemVer precedence",
          { eventId: event.id, versionId: version.id },
        );
      }
    } else {
      const previousActiveVersionId =
        currentVersionId ??
        [...history].reverse().find((historicalEvent) => historicalEvent.versionId !== null)
          ?.versionId ??
        null;
      if (previousActiveVersionId === null) return version;
      const currentVersion = this.#getVersionSnapshot(previousActiveVersionId, event.packId);
      if (
        version.id === currentVersion.id ||
        compareSemVer(version.semver, currentVersion.semver) <= 0
      ) {
        throw new RulePackActivationInvariantError(
          "ACTIVATION_VERSION_MISMATCH",
          "ACTIVATE must advance beyond the current or last deactivated SemVer precedence",
          { eventId: event.id, versionId: version.id },
        );
      }
    }
    return version;
  }

  #readEligibleVersion(
    versionId: string,
    effectiveAt: UtcDateTime,
    actorId: string,
  ): RulePackVersion {
    try {
      const eligible = this.#versionReader.assertVersionEligibleForActivation(
        versionId,
        effectiveAt,
        actorId,
      );
      const version = RulePackVersionSchema.parse(eligible);
      if (version.id !== versionId) {
        throw new RulePackActivationInvariantError(
          "ACTIVATION_VERSION_MISMATCH",
          "Eligibility reader returned a different immutable version identity",
          { actualVersionId: version.id, versionId },
        );
      }
      const cached = this.#versionSnapshots.get(versionId);
      if (
        cached !== undefined &&
        (cached.contentHash !== version.contentHash ||
          canonicalizeJson(cached) !== canonicalizeJson(version))
      ) {
        throw new RulePackActivationInvariantError(
          "ACTIVATION_VERSION_MISMATCH",
          "Eligibility reader attempted to replace a cached immutable version snapshot",
          { versionId },
        );
      }
      return cached ?? version;
    } catch (error) {
      if (error instanceof RulePackNotFoundError) {
        throw new RulePackActivationNotFoundError(
          "ACTIVATION_VERSION_NOT_FOUND",
          `Activation target version ${versionId} does not exist`,
          { versionId },
        );
      }
      throw error;
    }
  }

  #getVersionSnapshot(versionId: string, expectedPackId: string): RulePackVersion {
    const cached = this.#versionSnapshots.get(versionId);
    /* v8 ignore next 6 -- every stored selecting event caches its target atomically */
    if (cached === undefined) {
      throw new RulePackActivationNotFoundError(
        "ACTIVATION_VERSION_NOT_FOUND",
        `Activation target version ${versionId} is absent from the immutable ledger snapshot`,
        { versionId },
      );
    }
    /* v8 ignore next 7 -- append binds a cached version to the event's pack before storage */
    if (cached.packId !== expectedPackId) {
      throw new RulePackActivationInvariantError(
        "ACTIVATION_VERSION_MISMATCH",
        "Cached activation version belongs to another pack",
        { expectedPackId, versionId },
      );
    }
    return cached;
  }

  #assertNoScopeAmbiguity(event: ActivationEvent, version: RulePackVersion): void {
    const candidateInterval = activeInterval(event, version, undefined);
    /* v8 ignore next -- target eligibility requires the activation instant inside validity */
    if (candidateInterval === null) return;
    for (const [otherPackId, history] of this.#eventsByPack) {
      if (otherPackId === event.packId) continue;
      for (let index = 0; index < history.length; index += 1) {
        const otherEvent = history[index];
        /* v8 ignore next -- bounded loop indices always identify an event */
        if (otherEvent === undefined || otherEvent.type === "DEACTIVATE") continue;
        const otherVersionId = otherEvent.versionId;
        /* v8 ignore next -- non-deactivation event contracts always carry a version */
        if (otherVersionId === null) continue;
        const otherVersion = this.#getVersionSnapshot(otherVersionId, otherPackId);
        if (
          otherVersion.domain !== version.domain ||
          otherVersion.jurisdiction !== version.jurisdiction
        ) {
          continue;
        }
        const otherInterval = activeInterval(otherEvent, otherVersion, history[index + 1]);
        if (otherInterval !== null && validityIntervalsOverlap(candidateInterval, otherInterval)) {
          throw new RulePackActivationInvariantError(
            "ACTIVATION_OVERLAP_AMBIGUOUS",
            "Activation would create two candidates for the same scope and instant",
            {
              eventId: event.id,
              otherPackId,
              packId: event.packId,
              versionId: version.id,
            },
          );
        }
      }
    }
  }

  #projectAt(
    history: readonly ActivationEvent[],
    evaluationDate: UtcDateTime,
  ): ActivationEvent | null {
    let selected: ActivationEvent | null = null;
    for (const event of history) {
      if (compareUtcDateTimes(event.effectiveAt, evaluationDate) > 0) break;
      selected = event;
    }
    return selected?.type === "DEACTIVATE" ? null : selected;
  }
}
