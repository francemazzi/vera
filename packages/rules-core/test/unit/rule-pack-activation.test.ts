import {
  ACTIVATION_EVENT_SCHEMA_VERSION,
  RULE_PACK_SCHEMA_VERSION,
  ActivationEventSchema,
  RulePackVersionSchema,
  canonicalizeJson,
  computeActivationEventHash,
  computeRulePackVersionHash,
  type Actor,
  type ActivationEvent,
  type ActivationEventHashInput,
  type RulePackVersion,
  type RulePackVersionHashInput,
  type RulePackResolutionRequest,
  type UtcDateTime,
} from "@vera/contracts";
import { describe, expect, it } from "vitest";

import {
  InMemoryRulePackActivationLedger,
  type ActivationAppendCommand,
  type ActivationAppendExpectation,
  type RulePackActivationVersionReader,
} from "../../src/rule-pack-activation.js";
import { RulePackEligibilityError, RulePackNotFoundError } from "../../src/rule-pack-errors.js";
import {
  RULE_PACK_ACTORS,
  RULE_PACK_IDS,
  RULE_PACK_TIMES,
  makeDraft,
  makeRule,
} from "../fixtures/rule-pack.js";

const IDS = {
  activation1: "00000000-0000-4000-8000-000000000701",
  activation2: "00000000-0000-4000-8000-000000000702",
  rollback1: "00000000-0000-4000-8000-000000000703",
  deactivate1: "00000000-0000-4000-8000-000000000704",
  conflictingEvent: "00000000-0000-4000-8000-000000000705",
  activator: "00000000-0000-4000-8000-000000000706",
} as const;

const TIMES = {
  activation1Recorded: "2026-02-20T00:00:00.000Z",
  activation1Effective: "2026-03-01T00:00:00.000Z",
  activation2Recorded: "2026-05-20T00:00:00.000Z",
  activation2Effective: "2026-06-01T00:00:00.000Z",
  rollbackRecorded: "2026-08-20T00:00:00.000Z",
  rollbackEffective: "2026-09-01T00:00:00.000Z",
  deactivateRecorded: "2026-10-20T00:00:00.000Z",
  deactivateEffective: "2026-11-01T00:00:00.000Z",
  beforeValidity: "2026-02-28T23:59:59.999999999Z",
  beforeSecond: "2026-05-31T23:59:59.999999999Z",
  beforeRollback: "2026-08-31T23:59:59.999999999Z",
  beforeDeactivation: "2026-10-31T23:59:59.999999999Z",
} as const;

const ACTIVATOR: Actor = {
  id: IDS.activator,
  displayName: "Synthetic independent activation approver",
  role: "APPROVER",
  validationScope: "TECHNICAL_DEMO",
};

function makePublishedVersion(overrides: Partial<RulePackVersionHashInput> = {}): RulePackVersion {
  const draft = makeDraft();
  const input: RulePackVersionHashInput = {
    schemaVersion: RULE_PACK_SCHEMA_VERSION,
    id: RULE_PACK_IDS.version1,
    packId: RULE_PACK_IDS.pack,
    semver: "1.0.0",
    domain: draft.domain,
    jurisdiction: draft.jurisdiction,
    validity: draft.validity,
    rules: draft.rules,
    changeReason: draft.changeReason,
    supersedesVersionId: null,
    createdAt: draft.createdAt,
    createdBy: draft.createdBy,
    publishedAt: RULE_PACK_TIMES.published1,
    publishedBy: RULE_PACK_ACTORS.publisher.id,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
  return RulePackVersionSchema.parse({
    ...input,
    contentHash: computeRulePackVersionHash(input),
  });
}

function makeSecondVersion(overrides: Partial<RulePackVersionHashInput> = {}): RulePackVersion {
  return makePublishedVersion({
    id: RULE_PACK_IDS.version2,
    semver: "1.1.0",
    supersedesVersionId: RULE_PACK_IDS.version1,
    createdAt: RULE_PACK_TIMES.cloned,
    createdBy: RULE_PACK_ACTORS.otherAuthor.id,
    publishedAt: RULE_PACK_TIMES.published2,
    changeReason: "Second synthetic immutable version",
    ...overrides,
  });
}

function makeActivationEvent(overrides: Partial<ActivationEventHashInput> = {}): ActivationEvent {
  const input: ActivationEventHashInput = {
    schemaVersion: ACTIVATION_EVENT_SCHEMA_VERSION,
    id: IDS.activation1,
    packId: RULE_PACK_IDS.pack,
    sequence: 1,
    type: "ACTIVATE",
    versionId: RULE_PACK_IDS.version1,
    versionContentHash: makePublishedVersion().contentHash,
    expectedPreviousVersionId: null,
    effectiveAt: TIMES.activation1Effective,
    recordedAt: TIMES.activation1Recorded,
    actorId: IDS.activator,
    exercisedRole: "APPROVER",
    reason: "Activate the first synthetic Rule Pack version",
    previousEventHash: null,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
  return ActivationEventSchema.parse({
    ...input,
    contentHash: computeActivationEventHash(input),
  });
}

function secondEvent(first: ActivationEvent): ActivationEvent {
  return makeActivationEvent({
    id: IDS.activation2,
    sequence: 2,
    versionId: RULE_PACK_IDS.version2,
    versionContentHash: makeSecondVersion().contentHash,
    expectedPreviousVersionId: RULE_PACK_IDS.version1,
    effectiveAt: TIMES.activation2Effective,
    recordedAt: TIMES.activation2Recorded,
    previousEventHash: first.contentHash,
    reason: "Activate the second synthetic Rule Pack version",
  });
}

function rollbackEvent(second: ActivationEvent): ActivationEvent {
  return makeActivationEvent({
    id: IDS.rollback1,
    sequence: 3,
    type: "ROLLBACK",
    versionId: RULE_PACK_IDS.version1,
    versionContentHash: makePublishedVersion().contentHash,
    expectedPreviousVersionId: RULE_PACK_IDS.version2,
    effectiveAt: TIMES.rollbackEffective,
    recordedAt: TIMES.rollbackRecorded,
    previousEventHash: second.contentHash,
    reason: "Rollback to the first immutable synthetic version",
  });
}

function deactivateEvent(previous: ActivationEvent): ActivationEvent {
  return makeActivationEvent({
    id: IDS.deactivate1,
    sequence: 4,
    type: "DEACTIVATE",
    versionId: null,
    versionContentHash: null,
    expectedPreviousVersionId: RULE_PACK_IDS.version1,
    effectiveAt: TIMES.deactivateEffective,
    recordedAt: TIMES.deactivateRecorded,
    previousEventHash: previous.contentHash,
    reason: "Deactivate the synthetic Rule Pack lineage",
  });
}

function expectation(
  sequence: number,
  previousEventHash: string | null,
  activeVersionId: string | null,
): ActivationAppendCommand {
  return {
    actor: ACTIVATOR,
    expected: { sequence, previousEventHash, activeVersionId },
  };
}

interface SyntheticVersionReader extends RulePackActivationVersionReader {
  readonly calls: readonly {
    readonly versionId: string;
    readonly activationAt: UtcDateTime;
    readonly actorId: string;
  }[];
  failWith(error: Error): void;
  clearFailure(): void;
}

function makeVersionReader(versions: readonly RulePackVersion[]): SyntheticVersionReader {
  const byId = new Map(versions.map((version) => [version.id, version]));
  const calls: Array<{
    readonly versionId: string;
    readonly activationAt: UtcDateTime;
    readonly actorId: string;
  }> = [];
  let failure: Error | undefined;
  const getVersion = (versionId: string): RulePackVersion => {
    const version = byId.get(versionId);
    if (version === undefined) {
      throw new RulePackNotFoundError(
        "RULE_PACK_VERSION_NOT_FOUND",
        `Synthetic Rule Pack version ${versionId} was not found`,
        { versionId },
      );
    }
    return structuredClone(version);
  };
  return {
    calls,
    getVersion,
    assertVersionEligibleForActivation(versionId, activationAt, actorId) {
      calls.push({ versionId, activationAt, actorId });
      if (failure !== undefined) throw failure;
      return getVersion(versionId);
    },
    failWith(error) {
      failure = error;
    },
    clearFailure() {
      failure = undefined;
    },
  };
}

function setup(): {
  readonly first: RulePackVersion;
  readonly second: RulePackVersion;
  readonly reader: SyntheticVersionReader;
  readonly ledger: InMemoryRulePackActivationLedger;
} {
  const first = makePublishedVersion();
  const second = makeSecondVersion();
  const reader = makeVersionReader([first, second]);
  return { first, second, reader, ledger: new InMemoryRulePackActivationLedger(reader) };
}

function resolutionRequest(evaluationDate: UtcDateTime): RulePackResolutionRequest {
  return {
    domain: "synthetic-quality",
    jurisdiction: "GLOBAL-DEMO",
    evaluationDate,
  } as const;
}

describe("InMemoryRulePackActivationLedger temporal replay", () => {
  it("selects exactly at half-open activation boundaries and replays rollback/deactivation", () => {
    const { ledger } = setup();
    const first = makeActivationEvent();
    ledger.appendEvent(first, expectation(0, null, null));

    expect(() => ledger.resolve(resolutionRequest(TIMES.beforeValidity))).toThrow(
      expect.objectContaining({ code: "RULE_PACK_RESOLUTION_NOT_FOUND" }),
    );
    expect(ledger.resolve(resolutionRequest(TIMES.activation1Effective)).rulePackVersion.id).toBe(
      RULE_PACK_IDS.version1,
    );

    const second = secondEvent(first);
    ledger.appendEvent(second, expectation(1, first.contentHash, RULE_PACK_IDS.version1));
    expect(ledger.resolve(resolutionRequest(TIMES.beforeSecond)).rulePackVersion.id).toBe(
      RULE_PACK_IDS.version1,
    );
    expect(ledger.resolve(resolutionRequest(TIMES.activation2Effective)).rulePackVersion.id).toBe(
      RULE_PACK_IDS.version2,
    );

    const rollback = rollbackEvent(second);
    ledger.appendEvent(rollback, expectation(2, second.contentHash, RULE_PACK_IDS.version2));
    expect(ledger.resolve(resolutionRequest(TIMES.beforeRollback)).rulePackVersion.id).toBe(
      RULE_PACK_IDS.version2,
    );
    const rolledBack = ledger.resolve(resolutionRequest(TIMES.rollbackEffective));
    expect(rolledBack.rulePackVersion.id).toBe(RULE_PACK_IDS.version1);
    expect(rolledBack.activationEvent.type).toBe("ROLLBACK");

    const deactivation = deactivateEvent(rollback);
    ledger.appendEvent(deactivation, expectation(3, rollback.contentHash, RULE_PACK_IDS.version1));
    expect(ledger.resolve(resolutionRequest(TIMES.beforeDeactivation)).rulePackVersion.id).toBe(
      RULE_PACK_IDS.version1,
    );
    expect(() => ledger.resolve(resolutionRequest(TIMES.deactivateEffective))).toThrow(
      expect.objectContaining({ code: "RULE_PACK_RESOLUTION_NOT_FOUND" }),
    );
  });

  it("treats validTo as exclusive and never falls back to an expired predecessor", () => {
    const { ledger } = setup();
    const first = makeActivationEvent();
    ledger.appendEvent(first, expectation(0, null, null));
    expect(
      ledger.resolve(resolutionRequest("2026-11-30T23:59:59.999999999Z")).rulePackVersion.id,
    ).toBe(RULE_PACK_IDS.version1);
    expect(() => ledger.resolve(resolutionRequest(RULE_PACK_TIMES.packValidTo))).toThrow(
      expect.objectContaining({ code: "RULE_PACK_RESOLUTION_NOT_FOUND" }),
    );
  });

  it("resolves open-ended validity and sorts reverse-inserted pack identities", () => {
    const openEndedRule = makeRule(RULE_PACK_IDS.rule1, {
      validity: {
        validFrom: RULE_PACK_TIMES.packValidFrom,
        validTo: null,
      },
    });
    const openEnded = makePublishedVersion({
      validity: {
        validFrom: RULE_PACK_TIMES.packValidFrom,
        validTo: null,
      },
      rules: [openEndedRule],
    });
    const foreign = makePublishedVersion({
      id: RULE_PACK_IDS.version3,
      packId: RULE_PACK_IDS.foreignPack,
      domain: "separate-synthetic-domain",
    });
    const ledger = new InMemoryRulePackActivationLedger(makeVersionReader([openEnded, foreign]));

    const foreignActivation = makeActivationEvent({
      id: IDS.activation2,
      packId: foreign.packId,
      versionId: foreign.id,
      versionContentHash: foreign.contentHash,
      reason: "Insert the lexicographically later synthetic pack first",
    });
    ledger.appendEvent(foreignActivation, expectation(0, null, null));
    const openEndedActivation = makeActivationEvent({
      versionContentHash: openEnded.contentHash,
      reason: "Activate an open-ended synthetic Rule Pack",
    });
    ledger.appendEvent(openEndedActivation, expectation(0, null, null));

    expect(ledger.resolve(resolutionRequest("2030-01-01T00:00:00.000Z")).rulePackVersion.id).toBe(
      openEnded.id,
    );
    expect(
      ledger.resolve({
        ...resolutionRequest(TIMES.activation1Effective),
        domain: foreign.domain,
      }).rulePackVersion.id,
    ).toBe(foreign.id);
  });

  it("closes a historical interval at validity before a later deactivation", () => {
    const expiry = "2026-04-01T00:00:00.000Z";
    const first = makePublishedVersion({
      validity: {
        validFrom: RULE_PACK_TIMES.packValidFrom,
        validTo: expiry,
      },
    });
    const foreign = makePublishedVersion({
      id: RULE_PACK_IDS.version3,
      packId: RULE_PACK_IDS.foreignPack,
    });
    const ledger = new InMemoryRulePackActivationLedger(makeVersionReader([first, foreign]));
    const firstActivation = makeActivationEvent({ versionContentHash: first.contentHash });
    ledger.appendEvent(firstActivation, expectation(0, null, null));

    const laterDeactivation = makeActivationEvent({
      id: IDS.deactivate1,
      sequence: 2,
      type: "DEACTIVATE",
      versionId: null,
      versionContentHash: null,
      expectedPreviousVersionId: first.id,
      effectiveAt: "2026-05-01T00:00:00.000Z",
      recordedAt: "2026-04-20T00:00:00.000Z",
      previousEventHash: firstActivation.contentHash,
      reason: "Deactivate after the synthetic version has already expired",
    });
    ledger.appendEvent(laterDeactivation, expectation(1, firstActivation.contentHash, first.id));

    const adjacentActivation = makeActivationEvent({
      id: IDS.activation2,
      packId: foreign.packId,
      versionId: foreign.id,
      versionContentHash: foreign.contentHash,
      effectiveAt: expiry,
      recordedAt: "2026-03-25T00:00:00.000Z",
      reason: "Start at the predecessor validity's exclusive boundary",
    });
    ledger.appendEvent(adjacentActivation, expectation(0, null, null));

    expect(
      ledger.resolve(resolutionRequest("2026-03-31T23:59:59.999999999Z")).rulePackVersion.id,
    ).toBe(first.id);
    expect(ledger.resolve(resolutionRequest(expiry)).rulePackVersion.id).toBe(foreign.id);
  });

  it("replays byte-identically in a second ledger and returns deeply frozen detached snapshots", () => {
    const firstSetup = setup();
    const firstEvent = makeActivationEvent();
    const secondActivation = secondEvent(firstEvent);
    const rollback = rollbackEvent(secondActivation);
    const replay = [
      { event: firstEvent, expected: expectation(0, null, null) },
      {
        event: secondActivation,
        expected: expectation(1, firstEvent.contentHash, RULE_PACK_IDS.version1),
      },
      {
        event: rollback,
        expected: expectation(2, secondActivation.contentHash, RULE_PACK_IDS.version2),
      },
    ] as const;
    replay.forEach(({ event, expected }) => firstSetup.ledger.appendEvent(event, expected));

    const secondSetup = setup();
    replay.forEach(({ event, expected }) => secondSetup.ledger.appendEvent(event, expected));
    const request = resolutionRequest(TIMES.rollbackEffective);
    const firstResult = firstSetup.ledger.resolve(request);
    const secondResult = secondSetup.ledger.resolve(request);

    expect(canonicalizeJson(firstResult)).toBe(canonicalizeJson(secondResult));
    expect(Object.isFrozen(firstResult)).toBe(true);
    expect(Object.isFrozen(firstResult.rulePackVersion.rules)).toBe(true);
    expect(Object.isFrozen(firstResult.activationEvent)).toBe(true);
    expect(Reflect.set(firstResult.rulePackVersion, "semver", "9.0.0")).toBe(false);

    const history = firstSetup.ledger.getHistory(RULE_PACK_IDS.pack);
    const firstHistoryEvent = history[0];
    if (firstHistoryEvent === undefined) throw new Error("Expected synthetic activation history");
    expect(Object.isFrozen(history)).toBe(true);
    expect(Object.isFrozen(firstHistoryEvent)).toBe(true);
    expect(Reflect.set(firstHistoryEvent, "reason", "mutated")).toBe(false);
    expect(firstSetup.ledger.getHistory(RULE_PACK_IDS.pack)[0]?.reason).toBe(firstEvent.reason);
  });
});

describe("InMemoryRulePackActivationLedger append invariants", () => {
  it("is idempotent for an exact retry but rejects conflicting event-ID reuse", () => {
    const { ledger, reader } = setup();
    const first = makeActivationEvent();
    expect(ledger.appendEvent(first, expectation(0, null, null))).toEqual(first);
    expect(ledger.appendEvent(first, expectation(99, "f".repeat(64), null))).toEqual(first);
    expect(reader.calls).toHaveLength(1);

    const conflicting = makeActivationEvent({
      id: first.id,
      sequence: 2,
      type: "DEACTIVATE",
      versionId: null,
      versionContentHash: null,
      expectedPreviousVersionId: RULE_PACK_IDS.version1,
      effectiveAt: TIMES.deactivateEffective,
      recordedAt: TIMES.deactivateRecorded,
      previousEventHash: first.contentHash,
      reason: "Conflicting reuse of a synthetic event ID",
    });
    expect(() =>
      ledger.appendEvent(conflicting, expectation(1, first.contentHash, RULE_PACK_IDS.version1)),
    ).toThrow(expect.objectContaining({ code: "ACTIVATION_EVENT_ALREADY_EXISTS" }));
    expect(ledger.getHistory(RULE_PACK_IDS.pack)).toHaveLength(1);
  });

  it("rejects invalid payloads, stale expectations, sequence/hash gaps and state mismatches", () => {
    const { ledger } = setup();
    const first = makeActivationEvent();
    expect(() =>
      ledger.appendEvent({ ...first, contentHash: "0".repeat(64) }, expectation(0, null, null)),
    ).toThrow(expect.objectContaining({ code: "INVALID_ACTIVATION_EVENT" }));
    expect(() => ledger.appendEvent(first, expectation(1, null, null))).toThrow(
      expect.objectContaining({ code: "ACTIVATION_CONCURRENCY_CONFLICT" }),
    );

    const sequenceGap = makeActivationEvent({
      id: IDS.conflictingEvent,
      sequence: 2,
      previousEventHash: "a".repeat(64),
    });
    expect(() => ledger.appendEvent(sequenceGap, expectation(0, null, null))).toThrow(
      expect.objectContaining({ code: "ACTIVATION_SEQUENCE_MISMATCH" }),
    );

    ledger.appendEvent(first, expectation(0, null, null));
    const wrongPrevious = makeActivationEvent({
      id: IDS.conflictingEvent,
      sequence: 2,
      versionId: RULE_PACK_IDS.version2,
      versionContentHash: makeSecondVersion().contentHash,
      expectedPreviousVersionId: null,
      effectiveAt: TIMES.activation2Effective,
      recordedAt: TIMES.activation2Recorded,
      previousEventHash: first.contentHash,
    });
    expect(() =>
      ledger.appendEvent(wrongPrevious, expectation(1, first.contentHash, RULE_PACK_IDS.version1)),
    ).toThrow(expect.objectContaining({ code: "ACTIVATION_VERSION_MISMATCH" }));
    expect(ledger.getHistory(RULE_PACK_IDS.pack)).toHaveLength(1);
  });

  it("rejects equal effective instants, backdating and publication-time violations", () => {
    const { ledger } = setup();
    const first = makeActivationEvent({
      effectiveAt: "2026-04-01T00:00:00.000Z",
      recordedAt: "2026-03-01T00:00:00.000Z",
    });
    ledger.appendEvent(first, expectation(0, null, null));

    const equalTime = secondEvent(first);
    const { contentHash: _equalTimeHash, ...equalTimeInput } = equalTime;
    void _equalTimeHash;
    const equal = makeActivationEvent({
      ...equalTimeInput,
      effectiveAt: first.effectiveAt,
      recordedAt: "2026-03-02T00:00:00.000Z",
    });
    expect(() =>
      ledger.appendEvent(equal, expectation(1, first.contentHash, RULE_PACK_IDS.version1)),
    ).toThrow(expect.objectContaining({ code: "ACTIVATION_OVERLAP_AMBIGUOUS" }));

    const backdated = makeActivationEvent({
      ...equalTimeInput,
      effectiveAt: "2026-03-15T00:00:00.000Z",
      recordedAt: "2026-03-10T00:00:00.000Z",
    });
    expect(() =>
      ledger.appendEvent(backdated, expectation(1, first.contentHash, RULE_PACK_IDS.version1)),
    ).toThrow(expect.objectContaining({ code: "ACTIVATION_TIME_NOT_MONOTONIC" }));

    const version = makePublishedVersion({
      id: RULE_PACK_IDS.version3,
      packId: RULE_PACK_IDS.foreignPack,
      publishedAt: "2026-03-10T00:00:00.000Z",
    });
    const otherReader = makeVersionReader([version]);
    const otherLedger = new InMemoryRulePackActivationLedger(otherReader);
    const predating = makeActivationEvent({
      packId: version.packId,
      versionId: version.id,
      versionContentHash: version.contentHash,
      effectiveAt: "2026-03-11T00:00:00.000Z",
      recordedAt: "2026-03-05T00:00:00.000Z",
    });
    expect(() => otherLedger.appendEvent(predating, expectation(0, null, null))).toThrow(
      expect.objectContaining({ code: "ACTIVATION_TIME_NOT_MONOTONIC" }),
    );
  });

  it("requires an eligible target, correct lineage, higher activation and historical rollback", () => {
    const { ledger, reader } = setup();
    reader.failWith(
      new RulePackEligibilityError(
        "RULE_PACK_RULE_NOT_ELIGIBLE",
        "Synthetic source is no longer approved",
      ),
    );
    const first = makeActivationEvent();
    expect(() => ledger.appendEvent(first, expectation(0, null, null))).toThrow(
      expect.objectContaining({ code: "RULE_PACK_RULE_NOT_ELIGIBLE" }),
    );
    expect(() => ledger.getHistory(RULE_PACK_IDS.pack)).toThrow(
      expect.objectContaining({ code: "ACTIVATION_PACK_NOT_FOUND" }),
    );
    reader.clearFailure();
    ledger.appendEvent(first, expectation(0, null, null));
    expect(reader.calls.at(-1)).toEqual({
      versionId: RULE_PACK_IDS.version1,
      activationAt: TIMES.activation1Effective,
      actorId: IDS.activator,
    });

    const sameVersion = makeActivationEvent({
      id: IDS.conflictingEvent,
      sequence: 2,
      expectedPreviousVersionId: RULE_PACK_IDS.version1,
      effectiveAt: TIMES.activation2Effective,
      recordedAt: TIMES.activation2Recorded,
      previousEventHash: first.contentHash,
    });
    expect(() =>
      ledger.appendEvent(sameVersion, expectation(1, first.contentHash, RULE_PACK_IDS.version1)),
    ).toThrow(expect.objectContaining({ code: "ACTIVATION_VERSION_MISMATCH" }));

    const prematureRollback = makeActivationEvent({
      id: IDS.rollback1,
      sequence: 2,
      type: "ROLLBACK",
      versionId: RULE_PACK_IDS.version2,
      versionContentHash: makeSecondVersion().contentHash,
      expectedPreviousVersionId: RULE_PACK_IDS.version1,
      effectiveAt: TIMES.activation2Effective,
      recordedAt: TIMES.activation2Recorded,
      previousEventHash: first.contentHash,
    });
    expect(() =>
      ledger.appendEvent(
        prematureRollback,
        expectation(1, first.contentHash, RULE_PACK_IDS.version1),
      ),
    ).toThrow(expect.objectContaining({ code: "ACTIVATION_VERSION_MISMATCH" }));
  });

  it("pins the event to the target version hash and translates a missing authoritative version", () => {
    const { ledger } = setup();
    expect(() =>
      ledger.appendEvent(
        makeActivationEvent({ versionContentHash: "f".repeat(64) }),
        expectation(0, null, null),
      ),
    ).toThrow(expect.objectContaining({ code: "ACTIVATION_VERSION_MISMATCH" }));
    expect(() => ledger.getHistory(RULE_PACK_IDS.pack)).toThrow(
      expect.objectContaining({ code: "ACTIVATION_PACK_NOT_FOUND" }),
    );

    const missingLedger = new InMemoryRulePackActivationLedger(makeVersionReader([]));
    expect(() =>
      missingLedger.appendEvent(makeActivationEvent(), expectation(0, null, null)),
    ).toThrow(expect.objectContaining({ code: "ACTIVATION_VERSION_NOT_FOUND" }));
  });

  it("binds reader responses to the requested ID and preserves the first cached version bytes", () => {
    const first = makePublishedVersion();
    const second = makeSecondVersion();
    const wrongIdentityReader: RulePackActivationVersionReader = {
      getVersion() {
        return second;
      },
      assertVersionEligibleForActivation() {
        return second;
      },
    };
    const wrongIdentityLedger = new InMemoryRulePackActivationLedger(wrongIdentityReader);
    expect(() =>
      wrongIdentityLedger.appendEvent(makeActivationEvent(), expectation(0, null, null)),
    ).toThrow(expect.objectContaining({ code: "ACTIVATION_VERSION_MISMATCH" }));

    const alteredFirst = makePublishedVersion({
      changeReason: "Attempted replacement of an immutable cached version",
    });
    let replaceFirst = false;
    const replacingReader: RulePackActivationVersionReader = {
      getVersion(versionId) {
        if (versionId === first.id) return replaceFirst ? alteredFirst : first;
        if (versionId === second.id) return second;
        throw new RulePackNotFoundError(
          "RULE_PACK_VERSION_NOT_FOUND",
          "Synthetic version not found",
          { versionId },
        );
      },
      assertVersionEligibleForActivation(versionId) {
        return this.getVersion(versionId);
      },
    };
    const ledger = new InMemoryRulePackActivationLedger(replacingReader);
    const firstEvent = makeActivationEvent();
    ledger.appendEvent(firstEvent, expectation(0, null, null));
    const nextEvent = secondEvent(firstEvent);
    ledger.appendEvent(nextEvent, expectation(1, firstEvent.contentHash, first.id));
    replaceFirst = true;
    expect(() =>
      ledger.appendEvent(
        rollbackEvent(nextEvent),
        expectation(2, nextEvent.contentHash, second.id),
      ),
    ).toThrow(expect.objectContaining({ code: "ACTIVATION_VERSION_MISMATCH" }));
    expect(ledger.getHistory(first.packId)).toHaveLength(2);
    expect(
      ledger.resolve(resolutionRequest(TIMES.activation1Effective)).rulePackVersion.contentHash,
    ).toBe(first.contentHash);
  });

  it("makes deactivation terminal for old versions while allowing a higher SemVer reactivation", () => {
    const { ledger } = setup();
    const first = makeActivationEvent();
    ledger.appendEvent(first, expectation(0, null, null));
    const deactivation = makeActivationEvent({
      id: IDS.deactivate1,
      sequence: 2,
      type: "DEACTIVATE",
      versionId: null,
      versionContentHash: null,
      expectedPreviousVersionId: RULE_PACK_IDS.version1,
      effectiveAt: "2026-04-01T00:00:00.000Z",
      recordedAt: "2026-03-20T00:00:00.000Z",
      previousEventHash: first.contentHash,
      reason: "Temporarily deactivate the synthetic lineage",
    });
    ledger.appendEvent(deactivation, expectation(1, first.contentHash, RULE_PACK_IDS.version1));

    const staleReactivation = makeActivationEvent({
      id: IDS.activation2,
      sequence: 3,
      versionId: RULE_PACK_IDS.version1,
      versionContentHash: makePublishedVersion().contentHash,
      expectedPreviousVersionId: null,
      effectiveAt: "2026-05-01T00:00:00.000Z",
      recordedAt: "2026-04-20T00:00:00.000Z",
      previousEventHash: deactivation.contentHash,
      reason: "Attempt to reactivate a stale immutable version",
    });
    expect(() =>
      ledger.appendEvent(staleReactivation, expectation(2, deactivation.contentHash, null)),
    ).toThrow(expect.objectContaining({ code: "ACTIVATION_VERSION_MISMATCH" }));

    const second = makeSecondVersion();
    const advancingReactivation = makeActivationEvent({
      id: IDS.conflictingEvent,
      sequence: 3,
      versionId: second.id,
      versionContentHash: second.contentHash,
      expectedPreviousVersionId: null,
      effectiveAt: "2026-05-01T00:00:00.000Z",
      recordedAt: "2026-04-20T00:00:00.000Z",
      previousEventHash: deactivation.contentHash,
      reason: "Reactivate with a higher immutable SemVer",
    });
    ledger.appendEvent(advancingReactivation, expectation(2, deactivation.contentHash, null));
    expect(ledger.resolve(resolutionRequest("2026-03-15T00:00:00.000Z")).rulePackVersion.id).toBe(
      RULE_PACK_IDS.version1,
    );
    expect(ledger.resolve(resolutionRequest("2026-05-01T00:00:00.000Z")).rulePackVersion.id).toBe(
      RULE_PACK_IDS.version2,
    );
  });

  it("rejects a target from another pack and cross-lineage temporal scope overlap", () => {
    const first = makePublishedVersion();
    const foreign = makePublishedVersion({
      id: RULE_PACK_IDS.version3,
      packId: RULE_PACK_IDS.foreignPack,
    });
    const reader = makeVersionReader([first, foreign]);
    const ledger = new InMemoryRulePackActivationLedger(reader);
    const wrongPack = makeActivationEvent({
      versionId: foreign.id,
      versionContentHash: foreign.contentHash,
    });
    expect(() => ledger.appendEvent(wrongPack, expectation(0, null, null))).toThrow(
      expect.objectContaining({ code: "ACTIVATION_VERSION_MISMATCH" }),
    );

    const firstEvent = makeActivationEvent();
    ledger.appendEvent(firstEvent, expectation(0, null, null));
    const overlapping = makeActivationEvent({
      id: IDS.conflictingEvent,
      packId: RULE_PACK_IDS.foreignPack,
      versionId: foreign.id,
      versionContentHash: foreign.contentHash,
    });
    expect(() => ledger.appendEvent(overlapping, expectation(0, null, null))).toThrow(
      expect.objectContaining({ code: "ACTIVATION_OVERLAP_AMBIGUOUS" }),
    );
    expect(() => ledger.getHistory(RULE_PACK_IDS.foreignPack)).toThrow(
      expect.objectContaining({ code: "ACTIVATION_PACK_NOT_FOUND" }),
    );
  });

  it("preserves one scope per lineage and permits adjacent half-open cross-pack intervals", () => {
    const first = makePublishedVersion();
    const wrongScopeSecond = makeSecondVersion({ domain: "different-synthetic-domain" });
    const scopeLedger = new InMemoryRulePackActivationLedger(
      makeVersionReader([first, wrongScopeSecond]),
    );
    const firstEvent = makeActivationEvent();
    scopeLedger.appendEvent(firstEvent, expectation(0, null, null));
    const wrongScopeEvent = makeActivationEvent({
      id: IDS.activation2,
      sequence: 2,
      versionId: wrongScopeSecond.id,
      versionContentHash: wrongScopeSecond.contentHash,
      expectedPreviousVersionId: first.id,
      effectiveAt: TIMES.activation2Effective,
      recordedAt: TIMES.activation2Recorded,
      previousEventHash: firstEvent.contentHash,
      reason: "Attempt to change one lineage scope",
    });
    expect(() =>
      scopeLedger.appendEvent(wrongScopeEvent, expectation(1, firstEvent.contentHash, first.id)),
    ).toThrow(expect.objectContaining({ code: "ACTIVATION_VERSION_MISMATCH" }));

    const foreign = makePublishedVersion({
      id: RULE_PACK_IDS.version3,
      packId: RULE_PACK_IDS.foreignPack,
    });
    const adjacentLedger = new InMemoryRulePackActivationLedger(
      makeVersionReader([first, foreign]),
    );
    adjacentLedger.appendEvent(firstEvent, expectation(0, null, null));
    const deactivation = makeActivationEvent({
      id: IDS.deactivate1,
      sequence: 2,
      type: "DEACTIVATE",
      versionId: null,
      versionContentHash: null,
      expectedPreviousVersionId: first.id,
      effectiveAt: "2026-04-01T00:00:00.000Z",
      recordedAt: "2026-03-20T00:00:00.000Z",
      previousEventHash: firstEvent.contentHash,
      reason: "End the first adjacent synthetic interval",
    });
    adjacentLedger.appendEvent(deactivation, expectation(1, firstEvent.contentHash, first.id));
    const adjacentActivation = makeActivationEvent({
      id: IDS.activation2,
      packId: foreign.packId,
      versionId: foreign.id,
      versionContentHash: foreign.contentHash,
      effectiveAt: deactivation.effectiveAt,
      recordedAt: "2026-03-25T00:00:00.000Z",
      reason: "Start the second interval exactly at the first exclusive boundary",
    });
    adjacentLedger.appendEvent(adjacentActivation, expectation(0, null, null));
    expect(
      adjacentLedger.resolve(resolutionRequest("2026-03-31T23:59:59.999999999Z")).rulePackVersion
        .packId,
    ).toBe(first.packId);
    expect(
      adjacentLedger.resolve(resolutionRequest("2026-04-01T00:00:00.000Z")).rulePackVersion.packId,
    ).toBe(foreign.packId);

    const differentScope = makePublishedVersion({
      id: RULE_PACK_IDS.version3,
      packId: RULE_PACK_IDS.foreignPack,
      domain: "separate-synthetic-domain",
    });
    const separateScopeLedger = new InMemoryRulePackActivationLedger(
      makeVersionReader([first, differentScope]),
    );
    separateScopeLedger.appendEvent(firstEvent, expectation(0, null, null));
    const separateScopeEvent = makeActivationEvent({
      id: IDS.activation2,
      packId: differentScope.packId,
      versionId: differentScope.id,
      versionContentHash: differentScope.contentHash,
      reason: "Activate a concurrent but separate synthetic scope",
    });
    separateScopeLedger.appendEvent(separateScopeEvent, expectation(0, null, null));
    expect(
      separateScopeLedger.resolve(resolutionRequest(TIMES.activation1Effective)).rulePackVersion
        .packId,
    ).toBe(first.packId);
    expect(
      separateScopeLedger.resolve({
        ...resolutionRequest(TIMES.activation1Effective),
        domain: differentScope.domain,
      }).rulePackVersion.packId,
    ).toBe(differentScope.packId);
  });

  it("rejects Proxy commands and accessor expectations without executing user code", () => {
    const { ledger } = setup();
    const first = makeActivationEvent();
    let eventTraps = 0;
    const eventProxy = new Proxy(first, {
      get() {
        eventTraps += 1;
        throw new Error("event get trap executed");
      },
      getPrototypeOf() {
        eventTraps += 1;
        throw new Error("event prototype trap executed");
      },
      ownKeys() {
        eventTraps += 1;
        throw new Error("event ownKeys trap executed");
      },
    });
    expect(() => ledger.appendEvent(eventProxy, expectation(0, null, null))).toThrow(
      expect.objectContaining({ code: "INVALID_ACTIVATION_EVENT" }),
    );
    expect(eventTraps).toBe(0);

    let traps = 0;
    const proxy = new Proxy(expectation(0, null, null), {
      get() {
        traps += 1;
        throw new Error("expectation get trap executed");
      },
      getPrototypeOf() {
        traps += 1;
        throw new Error("expectation prototype trap executed");
      },
      ownKeys() {
        traps += 1;
        throw new Error("expectation ownKeys trap executed");
      },
    });
    expect(() => ledger.appendEvent(first, proxy)).toThrow(
      expect.objectContaining({ code: "INVALID_ACTIVATION_EVENT" }),
    );
    expect(traps).toBe(0);

    let getterCalls = 0;
    const accessorExpectation = {
      activeVersionId: null,
      previousEventHash: null,
      get sequence() {
        getterCalls += 1;
        return 0;
      },
    } as ActivationAppendExpectation;
    expect(() =>
      ledger.appendEvent(first, { actor: ACTIVATOR, expected: accessorExpectation }),
    ).toThrow(expect.objectContaining({ code: "INVALID_ACTIVATION_EVENT" }));
    expect(getterCalls).toBe(0);
  });

  it("requires the event identity to match an authoritative non-Proxy APPROVER actor", () => {
    const { ledger } = setup();
    const first = makeActivationEvent();
    expect(() =>
      ledger.appendEvent(first, {
        actor: RULE_PACK_ACTORS.invalidPublisher,
        expected: expectation(0, null, null).expected,
      }),
    ).toThrow(expect.objectContaining({ code: "ACTIVATION_NOT_AUTHORIZED" }));
    expect(() =>
      ledger.appendEvent(first, {
        actor: RULE_PACK_ACTORS.publisher,
        expected: expectation(0, null, null).expected,
      }),
    ).toThrow(expect.objectContaining({ code: "ACTIVATION_NOT_AUTHORIZED" }));

    let actorTraps = 0;
    const actorProxy = new Proxy(ACTIVATOR, {
      get() {
        actorTraps += 1;
        throw new Error("actor get trap executed");
      },
      getPrototypeOf() {
        actorTraps += 1;
        throw new Error("actor prototype trap executed");
      },
      ownKeys() {
        actorTraps += 1;
        throw new Error("actor ownKeys trap executed");
      },
    });
    expect(() =>
      ledger.appendEvent(first, {
        actor: actorProxy,
        expected: expectation(0, null, null).expected,
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_ACTIVATION_EVENT" }));
    expect(actorTraps).toBe(0);
  });

  it("rejects malformed append commands, actors and observed state values", () => {
    const { ledger } = setup();
    const first = makeActivationEvent();
    const expected = expectation(0, null, null).expected;
    const invalidCommands = [
      { actor: { ...ACTIVATOR, displayName: "" }, expected },
      { actor: ACTIVATOR, expected: { ...expected, sequence: -1 } },
      { actor: ACTIVATOR, expected: { ...expected, previousEventHash: "invalid" } },
      { actor: ACTIVATOR, expected: { ...expected, activeVersionId: "invalid" } },
      { actor: ACTIVATOR, expected: { ...expected, extra: true } },
      { actor: ACTIVATOR },
    ];
    for (const command of invalidCommands) {
      expect(() => ledger.appendEvent(first, command as never)).toThrow(
        expect.objectContaining({ code: "INVALID_ACTIVATION_EVENT" }),
      );
    }

    class NonPlainCommand {
      public readonly actor = ACTIVATOR;
      public readonly expected = expected;
    }
    expect(() => ledger.appendEvent(first, new NonPlainCommand())).toThrow(
      expect.objectContaining({ code: "INVALID_ACTIVATION_EVENT" }),
    );

    const hidden = { ...expectation(0, null, null) };
    Object.defineProperty(hidden, "hidden", { value: true, enumerable: false });
    expect(() => ledger.appendEvent(first, hidden)).toThrow(
      expect.objectContaining({ code: "INVALID_ACTIVATION_EVENT" }),
    );
    const symbolKey = { ...expectation(0, null, null), [Symbol("hidden")]: true };
    expect(() => ledger.appendEvent(first, symbolKey)).toThrow(
      expect.objectContaining({ code: "INVALID_ACTIVATION_EVENT" }),
    );
  });

  it("rejects malformed resolution requests and reports missing scopes deterministically", () => {
    const { ledger } = setup();
    expect(() =>
      ledger.resolve({ ...resolutionRequest(TIMES.activation1Effective), extra: true } as never),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_PACK_RESOLUTION_REQUEST" }));
    expect(() =>
      ledger.resolve({
        ...resolutionRequest(TIMES.activation1Effective),
        evaluationDate: "not-a-UTC-instant",
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_PACK_RESOLUTION_REQUEST" }));
    let requestTraps = 0;
    const requestProxy = new Proxy(resolutionRequest(TIMES.activation1Effective), {
      get() {
        requestTraps += 1;
        throw new Error("request get trap executed");
      },
      getPrototypeOf() {
        requestTraps += 1;
        throw new Error("request prototype trap executed");
      },
      ownKeys() {
        requestTraps += 1;
        throw new Error("request ownKeys trap executed");
      },
    });
    expect(() => ledger.resolve(requestProxy)).toThrow(
      expect.objectContaining({ code: "INVALID_RULE_PACK_RESOLUTION_REQUEST" }),
    );
    expect(requestTraps).toBe(0);
    let requestGetterCalls = 0;
    const accessorRequest = {
      domain: "synthetic-quality",
      jurisdiction: "GLOBAL-DEMO",
      get evaluationDate() {
        requestGetterCalls += 1;
        return TIMES.activation1Effective;
      },
    };
    expect(() => ledger.resolve(accessorRequest)).toThrow(
      expect.objectContaining({ code: "INVALID_RULE_PACK_RESOLUTION_REQUEST" }),
    );
    expect(requestGetterCalls).toBe(0);
    const first = makeActivationEvent();
    ledger.appendEvent(first, expectation(0, null, null));
    expect(() =>
      ledger.resolve({
        ...resolutionRequest(TIMES.activation1Effective),
        domain: "unmatched-synthetic-domain",
      }),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_RESOLUTION_NOT_FOUND" }));
  });
});
