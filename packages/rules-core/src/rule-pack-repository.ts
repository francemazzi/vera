import {
  ActorIdSchema,
  ActorSchema,
  RuleDefinitionBindingSchema,
  RulePackDraftSchema,
  RulePackVersionSchema,
  SemVerSchema,
  UtcDateTimeSchema,
  compareSemVer,
  compareUtcDateTimes,
  computeRulePackDraftHash,
  computeRulePackVersionHash,
  isWithinValidityInterval,
  validityIntervalsOverlap,
} from "@vera/contracts";
import { types as nodeUtilTypes } from "node:util";
import type {
  Actor,
  ComplianceSource,
  ComplianceSourceVersion,
  RuleCardRevision,
  RuleCardActivationEligibilityRequest,
  RuleDefinition,
  RuleDraftGenerationReference,
  RuleGenerationEligibilityRequest,
  RulePackDraft,
  RulePackVersion,
  SemVer,
  UtcDateTime,
  ValidityInterval,
} from "@vera/contracts";

import {
  RulePackConflictError,
  RulePackEligibilityError,
  RulePackInvariantError,
  RulePackNotFoundError,
  RulePackValidationError,
} from "./rule-pack-errors.js";

export interface RulePackSourceEligibilityReader {
  getSource(sourceId: string): ComplianceSource;
  assertVersionEligibleForActivation(request: {
    readonly versionId: string;
    readonly activationAt: UtcDateTime;
    readonly evaluationDate: UtcDateTime;
    readonly expectedContentHash: string;
  }): ComplianceSourceVersion;
}

export interface RulePackCardEligibilityReader {
  assertEligibleForRuleGeneration(
    request: RuleGenerationEligibilityRequest,
  ): RuleDraftGenerationReference;
  assertRevisionEligibleForActivation(
    request: RuleCardActivationEligibilityRequest,
  ): RuleCardRevision;
  getRevision(revisionId: string): RuleCardRevision;
}

export type RulePackEligibilityPurpose = "PUBLICATION" | "ACTIVATION";

export interface RulePackReadinessGateContext {
  readonly purpose: RulePackEligibilityPurpose;
  readonly checkedAt: UtcDateTime;
}

/** Optional phase gate used by external test runners before publication or activation. */
export interface RulePackReadinessGate {
  assertRulePackReady(version: RulePackVersion, context: RulePackReadinessGateContext): void;
}

export interface RulePackRuleEligibilitySnapshot {
  readonly source: ComplianceSource;
  readonly sourceVersion: ComplianceSourceVersion;
  readonly ruleCardRevision: RuleCardRevision;
}

/** Boundary used by publication so approval state is read from authoritative repositories. */
export interface RulePackRuleEligibilityReader {
  assertRuleEligible(
    rule: RuleDefinition,
    eligibilityAt: UtcDateTime,
    purpose: RulePackEligibilityPurpose,
  ): RulePackRuleEligibilitySnapshot;
}

/** Connects Rule Pack publication to the append-only source and Rule Card workflows. */
export class RepositoryBackedRulePackEligibilityReader implements RulePackRuleEligibilityReader {
  readonly #sources: RulePackSourceEligibilityReader;
  readonly #cards: RulePackCardEligibilityReader;

  public constructor(
    sources: RulePackSourceEligibilityReader,
    cards: RulePackCardEligibilityReader,
  ) {
    this.#sources = sources;
    this.#cards = cards;
  }

  public assertRuleEligible(
    rule: RuleDefinition,
    eligibilityAt: UtcDateTime,
    purpose: RulePackEligibilityPurpose,
  ): RulePackRuleEligibilitySnapshot {
    const evaluationDate = purpose === "ACTIVATION" ? eligibilityAt : rule.validity.validFrom;
    const source = this.#sources.getSource(rule.sourceId);
    const sourceVersion = this.#sources.assertVersionEligibleForActivation({
      versionId: rule.sourceVersionId,
      activationAt: eligibilityAt,
      evaluationDate,
      expectedContentHash: rule.sourceContentHash,
    });
    const reference =
      purpose === "PUBLICATION"
        ? this.#cards.assertEligibleForRuleGeneration({
            revisionId: rule.ruleCardRevisionId,
            generationAt: eligibilityAt,
            evaluationDate,
            expectedRevisionContentHash: rule.ruleCardRevisionContentHash,
            expectedSourceContentHash: rule.sourceContentHash,
            targetState: "DRAFT",
          })
        : null;
    const ruleCardRevision =
      purpose === "PUBLICATION"
        ? this.#cards.getRevision(rule.ruleCardRevisionId)
        : this.#cards.assertRevisionEligibleForActivation({
            revisionId: rule.ruleCardRevisionId,
            activationAt: eligibilityAt,
            evaluationDate,
            expectedRevisionContentHash: rule.ruleCardRevisionContentHash,
            expectedSourceContentHash: rule.sourceContentHash,
          });

    if (
      (reference !== null &&
        (reference.cardId !== rule.ruleCardId ||
          reference.cardRevisionId !== rule.ruleCardRevisionId ||
          reference.revisionContentHash !== rule.ruleCardRevisionContentHash ||
          reference.sourceId !== rule.sourceId ||
          reference.sourceVersionId !== rule.sourceVersionId ||
          reference.sourceContentHash !== rule.sourceContentHash)) ||
      source.id !== rule.sourceId ||
      sourceVersion.id !== rule.sourceVersionId ||
      sourceVersion.sourceId !== rule.sourceId ||
      sourceVersion.contentHash !== rule.sourceContentHash ||
      !RuleDefinitionBindingSchema.safeParse({ rule, ruleCardRevision }).success
    ) {
      throw new RulePackEligibilityError(
        "RULE_PACK_RULE_NOT_ELIGIBLE",
        "The authoritative source or Rule Card snapshot does not match the rule provenance",
        { ruleId: rule.id },
      );
    }

    return structuredClone({ source, sourceVersion, ruleCardRevision });
  }
}

export interface CloneRulePackVersionRequest {
  readonly sourceVersionId: string;
  readonly draftId: string;
  readonly semver: SemVer;
  readonly changeReason: string;
  readonly createdAt: UtcDateTime;
}

export interface PublishRulePackDraftRequest {
  readonly draftId: string;
  readonly versionId: string;
  readonly publishedAt: UtcDateTime;
  readonly expectedDraftRevision: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CLONE_REQUEST_KEYS = Object.freeze([
  "sourceVersionId",
  "draftId",
  "semver",
  "changeReason",
  "createdAt",
] as const);
const PUBLISH_REQUEST_KEYS = Object.freeze([
  "draftId",
  "versionId",
  "publishedAt",
  "expectedDraftRevision",
] as const);
const ACTOR_KEYS = Object.freeze(["id", "displayName", "role", "validationScope"] as const);

function snapshotPrimitiveRecord(
  input: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, string | number | boolean | null>> | null {
  if (input === null || typeof input !== "object" || nodeUtilTypes.isProxy(input)) return null;
  const prototype = Object.getPrototypeOf(input) as object | null;
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(input);
  if (
    ownKeys.length !== expectedKeys.length ||
    ownKeys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
  ) {
    return null;
  }

  const snapshot: Record<string, string | number | boolean | null> = Object.create(null) as Record<
    string,
    string | number | boolean | null
  >;
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      return null;
    }
    const value: unknown = descriptor.value;
    if (
      (value !== null &&
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean") ||
      (typeof value === "string" && value.length > 4_096)
    ) {
      return null;
    }
    snapshot[key] = value;
  }
  return Object.freeze(snapshot);
}

function parseActorSnapshot(input: unknown): Actor | null {
  const snapshot = snapshotPrimitiveRecord(input, ACTOR_KEYS);
  if (snapshot === null) return null;
  const parsed = ActorSchema.safeParse(snapshot);
  return parsed.success ? parsed.data : null;
}

function parseCloneRequest(input: unknown): CloneRulePackVersionRequest | null {
  const snapshot = snapshotPrimitiveRecord(input, CLONE_REQUEST_KEYS);
  if (snapshot === null) return null;
  const sourceVersionId = snapshot["sourceVersionId"];
  const draftId = snapshot["draftId"];
  const semver = snapshot["semver"];
  const changeReason = snapshot["changeReason"];
  const createdAt = snapshot["createdAt"];
  if (
    typeof sourceVersionId !== "string" ||
    !UUID_PATTERN.test(sourceVersionId) ||
    typeof draftId !== "string" ||
    !UUID_PATTERN.test(draftId) ||
    typeof semver !== "string" ||
    !SemVerSchema.safeParse(semver).success ||
    typeof changeReason !== "string" ||
    changeReason.length === 0 ||
    changeReason.length > 2_000 ||
    changeReason.trim() !== changeReason ||
    typeof createdAt !== "string" ||
    !UtcDateTimeSchema.safeParse(createdAt).success
  ) {
    return null;
  }
  return Object.freeze({ sourceVersionId, draftId, semver, changeReason, createdAt });
}

function parsePublishRequest(input: unknown): PublishRulePackDraftRequest | null {
  const snapshot = snapshotPrimitiveRecord(input, PUBLISH_REQUEST_KEYS);
  if (snapshot === null) return null;
  const draftId = snapshot["draftId"];
  const versionId = snapshot["versionId"];
  const publishedAt = snapshot["publishedAt"];
  const expectedDraftRevision = snapshot["expectedDraftRevision"];
  if (
    typeof draftId !== "string" ||
    !UUID_PATTERN.test(draftId) ||
    typeof versionId !== "string" ||
    !UUID_PATTERN.test(versionId) ||
    typeof publishedAt !== "string" ||
    !UtcDateTimeSchema.safeParse(publishedAt).success ||
    typeof expectedDraftRevision !== "number" ||
    !Number.isSafeInteger(expectedDraftRevision) ||
    expectedDraftRevision < 1
  ) {
    return null;
  }
  return Object.freeze({ draftId, versionId, publishedAt, expectedDraftRevision });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(clone(value));
}

function intervalContains(outer: ValidityInterval, inner: ValidityInterval): boolean {
  return (
    compareUtcDateTimes(outer.validFrom, inner.validFrom) <= 0 &&
    (outer.validTo === null ||
      (inner.validTo !== null && compareUtcDateTimes(inner.validTo, outer.validTo) <= 0))
  );
}

interface RulePackContentSnapshot {
  readonly domain: string;
  readonly id: string;
  readonly jurisdiction: string;
  readonly rules: readonly RuleDefinition[];
  readonly validity: ValidityInterval;
}

export class InMemoryRulePackRepository {
  readonly #eligibility: RulePackRuleEligibilityReader;
  readonly #readinessGate: RulePackReadinessGate | null;
  readonly #drafts = new Map<string, RulePackDraft>();
  readonly #versions = new Map<string, RulePackVersion>();
  readonly #versionIdsByPack = new Map<string, string[]>();
  readonly #publishedVersionIdByDraft = new Map<string, string>();
  readonly #contributorIdsByDraft = new Map<string, Set<string>>();
  readonly #excludedActivatorIdsByVersion = new Map<string, Set<string>>();

  public constructor(
    eligibility: RulePackRuleEligibilityReader,
    readinessGate: RulePackReadinessGate | null = null,
  ) {
    this.#eligibility = eligibility;
    this.#readinessGate = readinessGate;
  }

  public addDraft(draft: RulePackDraft, actor: Actor): RulePackDraft {
    const parsed = RulePackDraftSchema.safeParse(draft);
    if (!parsed.success) {
      throw new RulePackValidationError(
        "INVALID_RULE_PACK_DRAFT_PAYLOAD",
        "Rule Pack draft does not satisfy its strict canonical contract",
        { issueCount: parsed.error.issues.length },
      );
    }
    const validDraft = parsed.data;
    const validActor = parseActorSnapshot(actor);
    if (
      validActor?.role !== "AUTHOR" ||
      validActor.id !== validDraft.createdBy ||
      validActor.id !== validDraft.updatedBy
    ) {
      throw new RulePackEligibilityError(
        "RULE_PACK_AUTHOR_NOT_AUTHORIZED",
        "Draft creation requires the authoritative demo author bound to creation metadata",
        { draftId: validDraft.id },
      );
    }
    if (this.#drafts.has(validDraft.id)) {
      throw new RulePackConflictError(
        "RULE_PACK_DRAFT_ALREADY_EXISTS",
        `Rule Pack draft ${validDraft.id} already exists`,
        { draftId: validDraft.id },
      );
    }
    if (
      validDraft.revision !== 1 ||
      validDraft.createdAt !== validDraft.updatedAt ||
      validDraft.createdBy !== validDraft.updatedBy
    ) {
      throw new RulePackInvariantError(
        "RULE_PACK_DRAFT_REVISION_NOT_MONOTONIC",
        "A new Rule Pack draft must start at revision 1 and its creation snapshot",
        { draftId: validDraft.id, revision: validDraft.revision },
      );
    }
    this.#assertPackScope(validDraft);
    const stored = immutableCopy(validDraft);
    this.#drafts.set(stored.id, stored);
    this.#contributorIdsByDraft.set(stored.id, new Set([stored.createdBy, stored.updatedBy]));
    return clone(stored);
  }

  public replaceDraft(draft: RulePackDraft, expectedRevision: number, actor: Actor): RulePackDraft {
    const parsed = RulePackDraftSchema.safeParse(draft);
    if (!parsed.success) {
      throw new RulePackValidationError(
        "INVALID_RULE_PACK_DRAFT_PAYLOAD",
        "Rule Pack draft update does not satisfy its strict canonical contract",
        { issueCount: parsed.error.issues.length },
      );
    }
    const next = parsed.data;
    const validActor = parseActorSnapshot(actor);
    if (validActor?.role !== "AUTHOR" || validActor.id !== next.updatedBy) {
      throw new RulePackEligibilityError(
        "RULE_PACK_AUTHOR_NOT_AUTHORIZED",
        "Draft replacement requires the authoritative demo author bound to updatedBy",
        { draftId: next.id },
      );
    }
    const current = this.#requireDraft(next.id);
    this.#assertDraftIsUnpublished(next.id);
    if (expectedRevision !== current.revision) {
      throw new RulePackConflictError(
        "RULE_PACK_DRAFT_REVISION_CONFLICT",
        "The Rule Pack draft revision expectation is stale",
        {
          actualRevision: current.revision,
          draftId: next.id,
          expectedRevision,
        },
      );
    }
    if (next.revision !== current.revision + 1) {
      throw new RulePackInvariantError(
        "RULE_PACK_DRAFT_REVISION_NOT_MONOTONIC",
        "Rule Pack draft revisions must increase by exactly one",
        { draftId: next.id, revision: next.revision },
      );
    }
    if (
      next.id !== current.id ||
      next.packId !== current.packId ||
      next.domain !== current.domain ||
      next.jurisdiction !== current.jurisdiction ||
      next.createdAt !== current.createdAt ||
      next.createdBy !== current.createdBy
    ) {
      throw new RulePackInvariantError(
        "RULE_PACK_DRAFT_IDENTITY_MISMATCH",
        "A draft update cannot change pack identity, scope, or creation metadata",
        { draftId: next.id },
      );
    }
    if (compareUtcDateTimes(next.updatedAt, current.updatedAt) <= 0) {
      throw new RulePackInvariantError(
        "RULE_PACK_DRAFT_TIME_NOT_MONOTONIC",
        "A draft update timestamp must be later than the preceding revision",
        { draftId: next.id },
      );
    }

    const stored = immutableCopy(next);
    this.#drafts.set(stored.id, stored);
    // Every stored draft is inserted by addDraft, which initializes this append-only stream.
    const contributors = this.#contributorIdsByDraft.get(stored.id) as Set<string>;
    contributors.add(stored.updatedBy);
    this.#contributorIdsByDraft.set(stored.id, contributors);
    return clone(stored);
  }

  public cloneVersion(request: CloneRulePackVersionRequest, actor: Actor): RulePackDraft {
    const validRequest = parseCloneRequest(request);
    const validActor = parseActorSnapshot(actor);
    if (validRequest === null || validActor?.role !== "AUTHOR") {
      throw new RulePackValidationError(
        "INVALID_RULE_PACK_CLONE_REQUEST",
        "A controlled clone requires a strict request and a demo author",
      );
    }
    const source = this.#versions.get(validRequest.sourceVersionId);
    if (
      source === undefined ||
      this.#drafts.has(validRequest.draftId) ||
      compareUtcDateTimes(validRequest.createdAt, source.publishedAt) < 0
    ) {
      throw new RulePackValidationError(
        "INVALID_RULE_PACK_CLONE_REQUEST",
        "A controlled clone requires an existing version, a new draft ID, and a demo author",
      );
    }

    const hashInput = {
      schemaVersion: source.schemaVersion,
      id: validRequest.draftId,
      packId: source.packId,
      revision: 1,
      semver: validRequest.semver,
      domain: source.domain,
      jurisdiction: source.jurisdiction,
      validity: source.validity,
      rules: source.rules,
      changeReason: validRequest.changeReason,
      supersedesVersionId: source.id,
      createdAt: validRequest.createdAt,
      createdBy: validActor.id,
      updatedAt: validRequest.createdAt,
      updatedBy: validActor.id,
      validationScope: source.validationScope,
    };
    const draft = RulePackDraftSchema.parse({
      ...hashInput,
      contentHash: computeRulePackDraftHash(hashInput),
    });
    return this.addDraft(draft, validActor);
  }

  public publishDraft(request: PublishRulePackDraftRequest, publisher: Actor): RulePackVersion {
    const validRequest = parsePublishRequest(request);
    if (validRequest === null) {
      throw new RulePackValidationError(
        "INVALID_RULE_PACK_PUBLISH_REQUEST",
        "Rule Pack publication requires a strict bounded request snapshot",
      );
    }
    const draft = this.#requireDraft(validRequest.draftId);
    const validPublisher = parseActorSnapshot(publisher);
    // A retrievable draft and its contributor stream are created atomically by addDraft.
    const contributors = this.#contributorIdsByDraft.get(draft.id) as ReadonlySet<string>;
    if (validPublisher?.role !== "APPROVER" || contributors.has(validPublisher.id)) {
      throw new RulePackEligibilityError(
        "RULE_PACK_PUBLISHER_NOT_AUTHORIZED",
        "Publication requires an independent demo approver",
        { draftId: draft.id },
      );
    }
    this.#assertDraftIsUnpublished(draft.id);
    if (validRequest.expectedDraftRevision !== draft.revision) {
      throw new RulePackConflictError(
        "RULE_PACK_DRAFT_REVISION_CONFLICT",
        "The published Rule Pack draft revision expectation is stale",
        {
          actualRevision: draft.revision,
          draftId: draft.id,
          expectedRevision: validRequest.expectedDraftRevision,
        },
      );
    }
    if (this.#versions.has(validRequest.versionId)) {
      throw new RulePackConflictError(
        "RULE_PACK_VERSION_ALREADY_EXISTS",
        `Rule Pack version ${validRequest.versionId} already exists`,
        { versionId: validRequest.versionId },
      );
    }
    if (compareUtcDateTimes(validRequest.publishedAt, draft.updatedAt) < 0) {
      throw new RulePackInvariantError(
        "RULE_PACK_PUBLISH_TIME_INVALID",
        "A Rule Pack cannot be published before its final draft revision",
        { draftId: draft.id, publishedAt: validRequest.publishedAt },
      );
    }

    this.#assertSeriesEligibility(draft, validRequest.publishedAt);
    this.#assertRulesEligible(draft, validRequest.publishedAt, "PUBLICATION");

    const hashInput = {
      schemaVersion: draft.schemaVersion,
      id: validRequest.versionId,
      packId: draft.packId,
      semver: draft.semver,
      domain: draft.domain,
      jurisdiction: draft.jurisdiction,
      validity: draft.validity,
      rules: draft.rules,
      changeReason: draft.changeReason,
      supersedesVersionId: draft.supersedesVersionId,
      createdAt: draft.createdAt,
      createdBy: draft.createdBy,
      publishedAt: validRequest.publishedAt,
      publishedBy: validPublisher.id,
      validationScope: draft.validationScope,
    };
    const candidate = {
      ...hashInput,
      contentHash: computeRulePackVersionHash(hashInput),
    };
    const parsedVersion = RulePackVersionSchema.safeParse(candidate);
    /* v8 ignore next 7 -- candidate is derived solely from already parsed values and its hash helper */
    if (!parsedVersion.success) {
      throw new RulePackValidationError(
        "INVALID_RULE_PACK_VERSION_PAYLOAD",
        "The derived Rule Pack version does not satisfy its strict canonical contract",
        { issueCount: parsedVersion.error.issues.length },
      );
    }

    this.#assertReadinessGate(parsedVersion.data, "PUBLICATION", validRequest.publishedAt);

    const stored = immutableCopy(parsedVersion.data);
    this.#versions.set(stored.id, stored);
    const versionIds = this.#versionIdsByPack.get(stored.packId) ?? [];
    versionIds.push(stored.id);
    this.#versionIdsByPack.set(stored.packId, versionIds);
    this.#publishedVersionIdByDraft.set(draft.id, stored.id);
    this.#excludedActivatorIdsByVersion.set(
      stored.id,
      new Set(this.#contributorIdsByDraft.get(draft.id) as ReadonlySet<string>),
    );
    return immutableCopy(stored);
  }

  public getDraft(draftId: string): RulePackDraft {
    return clone(this.#requireDraft(draftId));
  }

  public getVersion(versionId: string): RulePackVersion {
    return immutableCopy(this.#requireVersion(versionId));
  }

  public getVersions(packId: string): readonly RulePackVersion[] {
    return (this.#versionIdsByPack.get(packId) ?? []).map((id) => this.getVersion(id));
  }

  public getVersionBySemVer(packId: string, semver: SemVer): RulePackVersion {
    const version = this.getVersions(packId).find((candidate) => candidate.semver === semver);
    if (version === undefined) {
      throw new RulePackNotFoundError(
        "RULE_PACK_VERSION_NOT_FOUND",
        `Rule Pack ${packId} has no version ${semver}`,
        { packId, semver },
      );
    }
    return version;
  }

  /** Rechecks authoritative approval state before an immutable version may be activated. */
  public assertVersionEligibleForActivation(
    versionId: string,
    activationAt: UtcDateTime,
    actorId: string,
  ): RulePackVersion {
    const version = this.#requireVersion(versionId);
    const parsedActorId = ActorIdSchema.safeParse(actorId);
    if (!parsedActorId.success) {
      throw new RulePackEligibilityError(
        "RULE_PACK_ACTIVATOR_NOT_AUTHORIZED",
        "Rule Pack activation requires a canonical actor identity",
        { actorId, versionId },
      );
    }
    const canonicalActorId = parsedActorId.data;
    // Publication stores immutable versions and their contributor exclusions together.
    const excludedActorIds = this.#excludedActivatorIdsByVersion.get(
      version.id,
    ) as ReadonlySet<string>;
    if (excludedActorIds.has(canonicalActorId)) {
      throw new RulePackEligibilityError(
        "RULE_PACK_ACTIVATOR_NOT_AUTHORIZED",
        "A Rule Pack contributor cannot activate that immutable version",
        { actorId: canonicalActorId, versionId },
      );
    }
    if (!isWithinValidityInterval(version.validity, activationAt)) {
      throw new RulePackEligibilityError(
        "RULE_PACK_ACTIVATION_OUTSIDE_VALIDITY",
        "A Rule Pack version can be activated only within its half-open validity interval",
        { activationAt, versionId },
      );
    }
    this.#assertRulesEligible(version, activationAt, "ACTIVATION");
    this.#assertReadinessGate(version, "ACTIVATION", activationAt);
    return immutableCopy(version);
  }

  #assertReadinessGate(
    version: RulePackVersion,
    purpose: RulePackEligibilityPurpose,
    checkedAt: UtcDateTime,
  ): void {
    if (this.#readinessGate === null) return;
    try {
      this.#readinessGate.assertRulePackReady(version, { purpose, checkedAt });
    } catch (error) {
      if (error instanceof RulePackEligibilityError) throw error;
      throw new RulePackEligibilityError(
        "RULE_PACK_TEST_GATE_FAILED",
        "Rule Pack test gate failed before publication or activation",
        { checkedAt, purpose, versionId: version.id },
      );
    }
  }

  #assertDraftIsUnpublished(draftId: string): void {
    const publishedVersionId = this.#publishedVersionIdByDraft.get(draftId);
    if (publishedVersionId !== undefined) {
      throw new RulePackConflictError(
        "RULE_PACK_VERSION_ALREADY_PUBLISHED",
        "A published draft is immutable and cannot be changed or published again",
        { draftId, publishedVersionId },
      );
    }
  }

  #assertPackScope(candidate: Pick<RulePackDraft, "packId" | "domain" | "jurisdiction">): void {
    const existing = [...this.#drafts.values(), ...this.#versions.values()].find(
      ({ packId }) => packId === candidate.packId,
    );
    if (
      existing !== undefined &&
      (existing.domain !== candidate.domain || existing.jurisdiction !== candidate.jurisdiction)
    ) {
      throw new RulePackInvariantError(
        "RULE_PACK_SCOPE_MISMATCH",
        "A Rule Pack ID has one stable domain and jurisdiction",
        { packId: candidate.packId },
      );
    }
  }

  #assertSeriesEligibility(draft: RulePackDraft, publishedAt: UtcDateTime): void {
    this.#assertPackScope(draft);
    const existing = this.getVersions(draft.packId);
    const predecessor = existing.at(-1);

    if (predecessor === undefined) {
      if (draft.supersedesVersionId !== null) {
        throw new RulePackInvariantError(
          "RULE_PACK_SUPERSESSION_INVALID",
          "The first version in a Rule Pack cannot supersede another version",
          { draftId: draft.id, supersedesVersionId: draft.supersedesVersionId },
        );
      }
    } else {
      if (existing.some(({ semver }) => semver === draft.semver)) {
        throw new RulePackConflictError(
          "RULE_PACK_VERSION_ALREADY_EXISTS",
          `Rule Pack ${draft.packId} already contains SemVer ${draft.semver}`,
          { packId: draft.packId, semver: draft.semver },
        );
      }
      if (compareSemVer(draft.semver, predecessor.semver) <= 0) {
        throw new RulePackInvariantError(
          "RULE_PACK_VERSION_NOT_MONOTONIC",
          "Rule Pack SemVer precedence must increase at every publication",
          { packId: draft.packId, semver: draft.semver },
        );
      }
      if (compareUtcDateTimes(publishedAt, predecessor.publishedAt) <= 0) {
        throw new RulePackInvariantError(
          "RULE_PACK_PUBLISH_TIME_INVALID",
          "Successive Rule Pack publications must have strictly increasing timestamps",
          { packId: draft.packId, publishedAt },
        );
      }
      if (draft.supersedesVersionId !== predecessor.id) {
        throw new RulePackInvariantError(
          "RULE_PACK_SUPERSESSION_INVALID",
          "Each later Rule Pack version must explicitly supersede its immediate predecessor",
          {
            expectedPredecessorId: predecessor.id,
            supersedesVersionId: draft.supersedesVersionId,
          },
        );
      }
    }

    const foreignOverlap = [...this.#versions.values()].find(
      (version) =>
        version.packId !== draft.packId &&
        version.domain === draft.domain &&
        version.jurisdiction === draft.jurisdiction &&
        validityIntervalsOverlap(version.validity, draft.validity),
    );
    if (foreignOverlap !== undefined) {
      throw new RulePackInvariantError(
        "RULE_PACK_OVERLAP_NOT_DECLARED",
        "A domain and jurisdiction cannot contain overlapping independent Rule Pack streams",
        { conflictingVersionId: foreignOverlap.id, packId: draft.packId },
      );
    }
  }

  #assertRulesEligible(
    snapshot: RulePackContentSnapshot,
    eligibilityAt: UtcDateTime,
    purpose: RulePackEligibilityPurpose,
  ): void {
    for (const rule of snapshot.rules) {
      let eligibilitySnapshot: RulePackRuleEligibilitySnapshot;
      try {
        eligibilitySnapshot = this.#eligibility.assertRuleEligible(rule, eligibilityAt, purpose);
      } catch (error) {
        if (error instanceof RulePackEligibilityError) throw error;
        throw new RulePackEligibilityError(
          "RULE_PACK_RULE_NOT_ELIGIBLE",
          "Rule Pack publication requires an approved source and Rule Card for every rule",
          { ruleId: rule.id },
        );
      }
      const binding = RuleDefinitionBindingSchema.safeParse({
        rule,
        ruleCardRevision: eligibilitySnapshot.ruleCardRevision,
      });
      if (
        !binding.success ||
        eligibilitySnapshot.sourceVersion.id !== rule.sourceVersionId ||
        eligibilitySnapshot.sourceVersion.sourceId !== rule.sourceId ||
        eligibilitySnapshot.sourceVersion.contentHash !== rule.sourceContentHash ||
        eligibilitySnapshot.source.id !== rule.sourceId ||
        eligibilitySnapshot.source.id !== eligibilitySnapshot.sourceVersion.sourceId ||
        eligibilitySnapshot.ruleCardRevision.id !== rule.ruleCardRevisionId ||
        eligibilitySnapshot.ruleCardRevision.contentHash !== rule.ruleCardRevisionContentHash
      ) {
        throw new RulePackEligibilityError(
          "RULE_PACK_RULE_NOT_ELIGIBLE",
          "Rule eligibility returned provenance that differs from the immutable rule snapshot",
          { ruleId: rule.id },
        );
      }
      if (
        eligibilitySnapshot.source.domain !== snapshot.domain ||
        eligibilitySnapshot.source.jurisdiction !== snapshot.jurisdiction
      ) {
        throw new RulePackInvariantError(
          "RULE_PACK_SCOPE_MISMATCH",
          "Every rule source must match the Rule Pack domain and jurisdiction",
          { ruleId: rule.id, sourceId: eligibilitySnapshot.source.id },
        );
      }
      if (
        !intervalContains(rule.validity, snapshot.validity) ||
        !intervalContains(eligibilitySnapshot.sourceVersion.validity, snapshot.validity) ||
        !intervalContains(eligibilitySnapshot.ruleCardRevision.validity, snapshot.validity)
      ) {
        throw new RulePackInvariantError(
          "RULE_PACK_RULE_OUTSIDE_VALIDITY",
          "Pack validity must be contained by every rule, source, and Rule Card interval",
          { ruleId: rule.id },
        );
      }
    }
  }

  #requireDraft(draftId: string): RulePackDraft {
    const draft = this.#drafts.get(draftId);
    if (draft === undefined) {
      throw new RulePackNotFoundError(
        "RULE_PACK_DRAFT_NOT_FOUND",
        `Rule Pack draft ${draftId} does not exist`,
        { draftId },
      );
    }
    return draft;
  }

  #requireVersion(versionId: string): RulePackVersion {
    const version = this.#versions.get(versionId);
    if (version === undefined) {
      throw new RulePackNotFoundError(
        "RULE_PACK_VERSION_NOT_FOUND",
        `Rule Pack version ${versionId} does not exist`,
        { versionId },
      );
    }
    return version;
  }
}
