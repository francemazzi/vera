import {
  RULE_PACK_SCHEMA_VERSION,
  RulePackDraftSchema,
  computeRulePackDraftHash,
  verifyRulePackVersionHash,
} from "@vera/contracts";
import type {
  ComplianceSource,
  ComplianceSourceVersion,
  RuleCardRevision,
  RuleDraftGenerationReference,
  RulePackDraft,
  RulePackDraftHashInput,
  RulePackVersion,
} from "@vera/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  type CloneRulePackVersionRequest,
  InMemoryRulePackRepository,
  type PublishRulePackDraftRequest,
  RepositoryBackedRulePackEligibilityReader,
} from "../../src/rule-pack-repository.js";
import { RulePackEligibilityError, RulePackNotFoundError } from "../../src/rule-pack-errors.js";
import { IDS as SOURCE_IDS, makeSource, makeVersion } from "../fixtures/compliance-source.js";
import { makeRuleCardRevision } from "../fixtures/rule-card.js";
import {
  RULE_PACK_ACTORS,
  RULE_PACK_IDS,
  RULE_PACK_TIMES,
  makeDraft,
  makeEligibilityReader,
  makeEligibilitySnapshot,
  makeRule,
} from "../fixtures/rule-pack.js";

function setup(): {
  readonly eligibility: ReturnType<typeof makeEligibilityReader>;
  readonly repository: InMemoryRulePackRepository;
} {
  const eligibility = makeEligibilityReader();
  return {
    eligibility,
    repository: new InMemoryRulePackRepository(eligibility.reader),
  };
}

function publishFirst(repository: InMemoryRulePackRepository): RulePackVersion {
  repository.addDraft(makeDraft(), RULE_PACK_ACTORS.author);
  return repository.publishDraft(
    {
      draftId: RULE_PACK_IDS.draft1,
      versionId: RULE_PACK_IDS.version1,
      publishedAt: RULE_PACK_TIMES.published1,
      expectedDraftRevision: 1,
    },
    RULE_PACK_ACTORS.publisher,
  );
}

function rehashDraft(
  draft: RulePackDraft,
  overrides: Partial<RulePackDraftHashInput>,
): RulePackDraft {
  const current = structuredClone(draft);
  Reflect.deleteProperty(current, "contentHash");
  const input = { ...(current as unknown as RulePackDraftHashInput), ...overrides };
  return RulePackDraftSchema.parse({
    ...input,
    contentHash: computeRulePackDraftHash(input),
  });
}

function trapCountingProxy<T extends object>(
  target: T,
): {
  readonly proxy: T;
  readonly trapCount: () => number;
} {
  let traps = 0;
  const proxy = new Proxy(target, {
    get(current, key, receiver) {
      traps += 1;
      return Reflect.get(current, key, receiver) as unknown;
    },
    getOwnPropertyDescriptor(current, key) {
      traps += 1;
      return Reflect.getOwnPropertyDescriptor(current, key);
    },
    getPrototypeOf(current) {
      traps += 1;
      return Reflect.getPrototypeOf(current);
    },
    ownKeys(current) {
      traps += 1;
      return Reflect.ownKeys(current);
    },
  });
  return { proxy, trapCount: () => traps };
}

function replaceWithAccessor<T extends object>(input: T, key: keyof T, onGet: () => void): T {
  const candidate = { ...input };
  Object.defineProperty(candidate, key, {
    configurable: true,
    enumerable: true,
    get() {
      onGet();
      return Reflect.get(input, key);
    },
  });
  return candidate;
}

describe("InMemoryRulePackRepository drafts", () => {
  it("validates hashes, starts at revision one, and stores defensive copies", () => {
    const { repository } = setup();
    const tampered = { ...makeDraft(), contentHash: "0".repeat(64) };
    expect(() => repository.addDraft(tampered, RULE_PACK_ACTORS.author)).toThrow(
      expect.objectContaining({ code: "INVALID_RULE_PACK_DRAFT_PAYLOAD" }),
    );

    const revisionTwo = makeDraft({
      revision: 2,
      updatedAt: RULE_PACK_TIMES.updated,
    });
    expect(() => repository.addDraft(revisionTwo, RULE_PACK_ACTORS.author)).toThrow(
      expect.objectContaining({ code: "RULE_PACK_DRAFT_REVISION_NOT_MONOTONIC" }),
    );

    const input = structuredClone(makeDraft());
    const returned = repository.addDraft(input, RULE_PACK_ACTORS.author);
    Reflect.set(input, "changeReason", "Mutated input");
    Reflect.set(returned, "changeReason", "Mutated result");
    const firstRule = repository.getDraft(input.id).rules[0];
    if (firstRule === undefined) throw new Error("Expected a synthetic rule");
    firstRule.validity.validTo = null;

    expect(repository.getDraft(input.id).changeReason).toBe(
      "Initial synthetic Rule Pack publication",
    );
    expect(repository.getDraft(input.id).validity.validTo).toBe(RULE_PACK_TIMES.packValidTo);
    expect(() => repository.addDraft(makeDraft(), RULE_PACK_ACTORS.author)).toThrow(
      expect.objectContaining({ code: "RULE_PACK_DRAFT_ALREADY_EXISTS" }),
    );
  });

  it("uses optimistic concurrency and immutable draft identity", () => {
    const { repository } = setup();
    const first = repository.addDraft(makeDraft(), RULE_PACK_ACTORS.author);
    expect(() =>
      repository.replaceDraft(
        { ...first, contentHash: "0".repeat(64) },
        1,
        RULE_PACK_ACTORS.author,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_PACK_DRAFT_PAYLOAD" }));
    const second = rehashDraft(first, {
      revision: 2,
      semver: "1.1.0",
      updatedAt: RULE_PACK_TIMES.updated,
      updatedBy: RULE_PACK_IDS.author2,
      changeReason: "Synthetic revision before publication",
    });

    expect(() => repository.replaceDraft(second, 0, RULE_PACK_ACTORS.otherAuthor)).toThrow(
      expect.objectContaining({ code: "RULE_PACK_DRAFT_REVISION_CONFLICT" }),
    );
    expect(repository.replaceDraft(second, 1, RULE_PACK_ACTORS.otherAuthor).revision).toBe(2);

    const nonMonotonicRevision = rehashDraft(second, {
      revision: 2,
      updatedAt: RULE_PACK_TIMES.cloned,
    });
    expect(() =>
      repository.replaceDraft(nonMonotonicRevision, 2, RULE_PACK_ACTORS.otherAuthor),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_DRAFT_REVISION_NOT_MONOTONIC" }));

    const wrongIdentity = rehashDraft(second, {
      revision: 3,
      packId: RULE_PACK_IDS.foreignPack,
      updatedAt: RULE_PACK_TIMES.cloned,
    });
    expect(() => repository.replaceDraft(wrongIdentity, 2, RULE_PACK_ACTORS.otherAuthor)).toThrow(
      expect.objectContaining({ code: "RULE_PACK_DRAFT_IDENTITY_MISMATCH" }),
    );

    const staleTime = rehashDraft(second, { revision: 3 });
    expect(() => repository.replaceDraft(staleTime, 2, RULE_PACK_ACTORS.otherAuthor)).toThrow(
      expect.objectContaining({ code: "RULE_PACK_DRAFT_TIME_NOT_MONOTONIC" }),
    );
  });

  it("binds creation and replacement metadata to an authoritative demo author", () => {
    const forgedCreation = makeDraft({
      createdBy: RULE_PACK_ACTORS.otherAuthor.id,
      updatedBy: RULE_PACK_ACTORS.otherAuthor.id,
    });
    expect(() => setup().repository.addDraft(forgedCreation, RULE_PACK_ACTORS.author)).toThrow(
      expect.objectContaining({ code: "RULE_PACK_AUTHOR_NOT_AUTHORIZED" }),
    );
    expect(() => setup().repository.addDraft(makeDraft(), RULE_PACK_ACTORS.publisher)).toThrow(
      expect.objectContaining({ code: "RULE_PACK_AUTHOR_NOT_AUTHORIZED" }),
    );
    expect(() =>
      setup().repository.addDraft(makeDraft(), {
        ...RULE_PACK_ACTORS.author,
        validationScope: "PROFESSIONAL" as "TECHNICAL_DEMO",
      }),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_AUTHOR_NOT_AUTHORIZED" }));

    const { repository } = setup();
    const first = repository.addDraft(makeDraft(), RULE_PACK_ACTORS.author);
    const second = rehashDraft(first, {
      revision: 2,
      updatedAt: RULE_PACK_TIMES.updated,
      updatedBy: RULE_PACK_ACTORS.otherAuthor.id,
    });
    expect(() => repository.replaceDraft(second, 1, RULE_PACK_ACTORS.author)).toThrow(
      expect.objectContaining({ code: "RULE_PACK_AUTHOR_NOT_AUTHORIZED" }),
    );
    expect(repository.replaceDraft(second, 1, RULE_PACK_ACTORS.otherAuthor).updatedBy).toBe(
      RULE_PACK_ACTORS.otherAuthor.id,
    );
  });

  it("rejects Proxy and accessor author identities without executing traps or getters", () => {
    const proxiedAuthor = trapCountingProxy(RULE_PACK_ACTORS.author);
    expect(() => setup().repository.addDraft(makeDraft(), proxiedAuthor.proxy)).toThrow(
      expect.objectContaining({ code: "RULE_PACK_AUTHOR_NOT_AUTHORIZED" }),
    );
    expect(proxiedAuthor.trapCount()).toBe(0);

    let addGetterCalls = 0;
    const accessorAuthor = replaceWithAccessor(RULE_PACK_ACTORS.author, "id", () => {
      addGetterCalls += 1;
    });
    expect(() => setup().repository.addDraft(makeDraft(), accessorAuthor)).toThrow(
      expect.objectContaining({ code: "RULE_PACK_AUTHOR_NOT_AUTHORIZED" }),
    );
    expect(addGetterCalls).toBe(0);

    const { repository } = setup();
    const first = repository.addDraft(makeDraft(), RULE_PACK_ACTORS.author);
    const second = rehashDraft(first, {
      revision: 2,
      updatedAt: RULE_PACK_TIMES.updated,
      updatedBy: RULE_PACK_ACTORS.otherAuthor.id,
    });
    const proxiedReplacementAuthor = trapCountingProxy(RULE_PACK_ACTORS.otherAuthor);
    expect(() => repository.replaceDraft(second, 1, proxiedReplacementAuthor.proxy)).toThrow(
      expect.objectContaining({ code: "RULE_PACK_AUTHOR_NOT_AUTHORIZED" }),
    );
    expect(proxiedReplacementAuthor.trapCount()).toBe(0);

    let replaceGetterCalls = 0;
    const accessorReplacementAuthor = replaceWithAccessor(
      RULE_PACK_ACTORS.otherAuthor,
      "id",
      () => {
        replaceGetterCalls += 1;
      },
    );
    expect(() => repository.replaceDraft(second, 1, accessorReplacementAuthor)).toThrow(
      expect.objectContaining({ code: "RULE_PACK_AUTHOR_NOT_AUTHORIZED" }),
    );
    expect(replaceGetterCalls).toBe(0);
  });

  it("keeps a stable scope for every pack ID and reports missing records", () => {
    const { repository } = setup();
    repository.addDraft(makeDraft(), RULE_PACK_ACTORS.author);
    expect(() =>
      repository.addDraft(
        makeDraft({ id: RULE_PACK_IDS.draft2, domain: "different-synthetic-domain" }),
        RULE_PACK_ACTORS.author,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_SCOPE_MISMATCH" }));
    expect(() => repository.getDraft(RULE_PACK_IDS.draft3)).toThrow(RulePackNotFoundError);
    expect(() => repository.getVersion(RULE_PACK_IDS.version3)).toThrow(
      expect.objectContaining({ code: "RULE_PACK_VERSION_NOT_FOUND" }),
    );
    expect(repository.getVersions(RULE_PACK_IDS.foreignPack)).toEqual([]);
  });
});

describe("RepositoryBackedRulePackEligibilityReader", () => {
  function referenceForRule(): RuleDraftGenerationReference {
    const rule = makeRule();
    return {
      targetState: "DRAFT",
      cardId: rule.ruleCardId,
      cardRevisionId: rule.ruleCardRevisionId,
      revisionContentHash: rule.ruleCardRevisionContentHash,
      sourceId: rule.sourceId,
      sourceVersionId: rule.sourceVersionId,
      sourceContentHash: rule.sourceContentHash,
      generationAt: RULE_PACK_TIMES.published1,
      evaluationDate: rule.validity.validFrom,
      validationScope: "TECHNICAL_DEMO",
    };
  }

  it("pins every authoritative request and returns a detached provenance snapshot", () => {
    const rule = makeRule();
    const complianceSource = makeSource();
    const sourceVersion = makeVersion();
    const revision = makeRuleCardRevision();
    const sourceLookup = vi.fn(() => complianceSource);
    const sourceAssertion = vi.fn(() => sourceVersion);
    const cardAssertion = vi.fn(() => referenceForRule());
    const activationAssertion = vi.fn(() => revision);
    const adapter = new RepositoryBackedRulePackEligibilityReader(
      { getSource: sourceLookup, assertVersionEligibleForActivation: sourceAssertion },
      {
        assertEligibleForRuleGeneration: cardAssertion,
        assertRevisionEligibleForActivation: activationAssertion,
        getRevision: () => revision,
      },
    );

    const result = adapter.assertRuleEligible(rule, RULE_PACK_TIMES.published1, "PUBLICATION");
    expect(sourceLookup).toHaveBeenCalledWith(rule.sourceId);
    expect(sourceAssertion).toHaveBeenCalledWith({
      versionId: rule.sourceVersionId,
      activationAt: RULE_PACK_TIMES.published1,
      evaluationDate: rule.validity.validFrom,
      expectedContentHash: rule.sourceContentHash,
    });
    expect(cardAssertion).toHaveBeenCalledWith({
      revisionId: rule.ruleCardRevisionId,
      generationAt: RULE_PACK_TIMES.published1,
      evaluationDate: rule.validity.validFrom,
      expectedRevisionContentHash: rule.ruleCardRevisionContentHash,
      expectedSourceContentHash: rule.sourceContentHash,
      targetState: "DRAFT",
    });
    expect(activationAssertion).not.toHaveBeenCalled();
    result.sourceVersion.license = "Mutated detached result";
    result.source.title = "Mutated detached source";
    expect(sourceVersion.license).toBe("CC0-1.0");
    expect(complianceSource.title).toBe("Synthetic Quality Reference");
  });

  it("revalidates an exact Rule Card revision for activation without invoking generation", () => {
    const rule = makeRule();
    const revision = makeRuleCardRevision();
    const generationAssertion = vi.fn(() => referenceForRule());
    const activationAssertion = vi.fn(() => revision);
    const adapter = new RepositoryBackedRulePackEligibilityReader(
      {
        getSource: () => makeSource(),
        assertVersionEligibleForActivation: () => makeVersion(),
      },
      {
        assertEligibleForRuleGeneration: generationAssertion,
        assertRevisionEligibleForActivation: activationAssertion,
        getRevision: () => revision,
      },
    );

    expect(
      adapter.assertRuleEligible(rule, RULE_PACK_TIMES.packValidFrom, "ACTIVATION").ruleCardRevision
        .id,
    ).toBe(revision.id);
    expect(generationAssertion).not.toHaveBeenCalled();
    expect(activationAssertion).toHaveBeenCalledWith({
      revisionId: rule.ruleCardRevisionId,
      activationAt: RULE_PACK_TIMES.packValidFrom,
      evaluationDate: RULE_PACK_TIMES.packValidFrom,
      expectedRevisionContentHash: rule.ruleCardRevisionContentHash,
      expectedSourceContentHash: rule.sourceContentHash,
    });
  });

  it("rejects every forged source, reference, and Rule Card binding", () => {
    const rule = makeRule();
    const mismatch = RULE_PACK_IDS.rule3;
    interface ForgeryCase {
      readonly complianceSource?: Partial<ComplianceSource>;
      readonly sourceVersion?: Partial<ComplianceSourceVersion>;
      readonly reference?: Partial<RuleDraftGenerationReference>;
      readonly revision?: RuleCardRevision;
    }
    const cases: readonly ForgeryCase[] = [
      { complianceSource: { id: mismatch } },
      { sourceVersion: { id: mismatch } },
      { sourceVersion: { sourceId: mismatch } },
      { sourceVersion: { contentHash: "f".repeat(64) } },
      { reference: { cardId: mismatch } },
      { reference: { cardRevisionId: mismatch } },
      { reference: { revisionContentHash: "f".repeat(64) } },
      { reference: { sourceId: mismatch } },
      { reference: { sourceVersionId: mismatch } },
      { reference: { sourceContentHash: "f".repeat(64) } },
      { revision: makeRuleCardRevision({ normativeKey: "different.synthetic.key" }) },
    ];

    for (const candidate of cases) {
      const complianceSource = makeSource(candidate.complianceSource ?? {});
      const sourceVersion = makeVersion(candidate.sourceVersion ?? {});
      const reference = { ...referenceForRule(), ...(candidate.reference ?? {}) };
      const revision = candidate.revision ?? makeRuleCardRevision();
      const adapter = new RepositoryBackedRulePackEligibilityReader(
        {
          getSource: () => complianceSource,
          assertVersionEligibleForActivation: () => sourceVersion,
        },
        {
          assertEligibleForRuleGeneration: () => reference,
          assertRevisionEligibleForActivation: () => revision,
          getRevision: () => revision,
        },
      );
      expect(() =>
        adapter.assertRuleEligible(rule, RULE_PACK_TIMES.published1, "PUBLICATION"),
      ).toThrow(expect.objectContaining({ code: "RULE_PACK_RULE_NOT_ELIGIBLE" }));
    }
  });
});

describe("Rule Pack request snapshot boundary", () => {
  const cloneRequest: CloneRulePackVersionRequest = {
    sourceVersionId: RULE_PACK_IDS.version1,
    draftId: RULE_PACK_IDS.draft2,
    semver: "1.1.0",
    changeReason: "Controlled snapshot clone",
    createdAt: RULE_PACK_TIMES.cloned,
  };
  const publishRequest: PublishRulePackDraftRequest = {
    draftId: RULE_PACK_IDS.draft1,
    versionId: RULE_PACK_IDS.version1,
    publishedAt: RULE_PACK_TIMES.published1,
    expectedDraftRevision: 1,
  };

  it("rejects Proxy requests and actors without invoking a single trap", () => {
    const cloneSetup = setup();
    publishFirst(cloneSetup.repository);
    const proxiedClone = trapCountingProxy(cloneRequest);
    expect(() =>
      cloneSetup.repository.cloneVersion(proxiedClone.proxy, RULE_PACK_ACTORS.otherAuthor),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_PACK_CLONE_REQUEST" }));
    expect(proxiedClone.trapCount()).toBe(0);

    const proxiedAuthor = trapCountingProxy(RULE_PACK_ACTORS.otherAuthor);
    expect(() => cloneSetup.repository.cloneVersion(cloneRequest, proxiedAuthor.proxy)).toThrow(
      expect.objectContaining({ code: "INVALID_RULE_PACK_CLONE_REQUEST" }),
    );
    expect(proxiedAuthor.trapCount()).toBe(0);

    const publishSetup = setup();
    publishSetup.repository.addDraft(makeDraft(), RULE_PACK_ACTORS.author);
    const proxiedPublish = trapCountingProxy(publishRequest);
    expect(() =>
      publishSetup.repository.publishDraft(proxiedPublish.proxy, RULE_PACK_ACTORS.publisher),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_PACK_PUBLISH_REQUEST" }));
    expect(proxiedPublish.trapCount()).toBe(0);

    const proxiedPublisher = trapCountingProxy(RULE_PACK_ACTORS.publisher);
    expect(() =>
      publishSetup.repository.publishDraft(publishRequest, proxiedPublisher.proxy),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_PUBLISHER_NOT_AUTHORIZED" }));
    expect(proxiedPublisher.trapCount()).toBe(0);
  });

  it("rejects accessors and unknown keys without invoking getters", () => {
    const cloneSetup = setup();
    publishFirst(cloneSetup.repository);
    let cloneGetterCalls = 0;
    const accessorClone = replaceWithAccessor(cloneRequest, "draftId", () => {
      cloneGetterCalls += 1;
    });
    expect(() =>
      cloneSetup.repository.cloneVersion(accessorClone, RULE_PACK_ACTORS.otherAuthor),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_PACK_CLONE_REQUEST" }));
    expect(cloneGetterCalls).toBe(0);
    expect(() =>
      cloneSetup.repository.cloneVersion(
        { ...cloneRequest, unexpected: true } as unknown as CloneRulePackVersionRequest,
        RULE_PACK_ACTORS.otherAuthor,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_PACK_CLONE_REQUEST" }));
    expect(() =>
      cloneSetup.repository.cloneVersion(
        { ...cloneRequest, changeReason: "x".repeat(4_097) },
        RULE_PACK_ACTORS.otherAuthor,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_PACK_CLONE_REQUEST" }));

    let actorGetterCalls = 0;
    const accessorActor = replaceWithAccessor(RULE_PACK_ACTORS.otherAuthor, "id", () => {
      actorGetterCalls += 1;
    });
    expect(() => cloneSetup.repository.cloneVersion(cloneRequest, accessorActor)).toThrow(
      expect.objectContaining({ code: "INVALID_RULE_PACK_CLONE_REQUEST" }),
    );
    expect(actorGetterCalls).toBe(0);

    const publishSetup = setup();
    publishSetup.repository.addDraft(makeDraft(), RULE_PACK_ACTORS.author);
    let publishGetterCalls = 0;
    const accessorPublish = replaceWithAccessor(publishRequest, "expectedDraftRevision", () => {
      publishGetterCalls += 1;
    });
    expect(() =>
      publishSetup.repository.publishDraft(accessorPublish, RULE_PACK_ACTORS.publisher),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_PACK_PUBLISH_REQUEST" }));
    expect(publishGetterCalls).toBe(0);
    expect(() =>
      publishSetup.repository.publishDraft(
        { ...publishRequest, unexpected: true } as unknown as PublishRulePackDraftRequest,
        RULE_PACK_ACTORS.publisher,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_PACK_PUBLISH_REQUEST" }));
    expect(() =>
      publishSetup.repository.publishDraft(
        { ...publishRequest, expectedDraftRevision: 0 },
        RULE_PACK_ACTORS.publisher,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_PACK_PUBLISH_REQUEST" }));
  });

  it("accepts null-prototype snapshots and rejects custom prototypes or invalid primitives", () => {
    const cloneSetup = setup();
    publishFirst(cloneSetup.repository);
    const customPrototypeRequest = Object.assign(Object.create({ inherited: true }) as object, {
      ...cloneRequest,
      draftId: RULE_PACK_IDS.draft3,
    }) as CloneRulePackVersionRequest;
    expect(() =>
      cloneSetup.repository.cloneVersion(customPrototypeRequest, RULE_PACK_ACTORS.otherAuthor),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_PACK_CLONE_REQUEST" }));
    expect(() =>
      cloneSetup.repository.cloneVersion(
        { ...cloneRequest, draftId: null } as unknown as CloneRulePackVersionRequest,
        RULE_PACK_ACTORS.otherAuthor,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_PACK_CLONE_REQUEST" }));
    expect(() =>
      cloneSetup.repository.cloneVersion(
        { ...cloneRequest, draftId: {} } as unknown as CloneRulePackVersionRequest,
        RULE_PACK_ACTORS.otherAuthor,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_PACK_CLONE_REQUEST" }));
    expect(() =>
      cloneSetup.repository.cloneVersion(cloneRequest, {
        ...RULE_PACK_ACTORS.otherAuthor,
        id: "invalid-actor-id",
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_PACK_CLONE_REQUEST" }));

    const nullPrototypeRequest = Object.assign(Object.create(null) as object, cloneRequest);
    const nullPrototypeActor = Object.assign(
      Object.create(null) as object,
      RULE_PACK_ACTORS.otherAuthor,
    );
    expect(cloneSetup.repository.cloneVersion(nullPrototypeRequest, nullPrototypeActor).id).toBe(
      RULE_PACK_IDS.draft2,
    );

    const publishSetup = setup();
    publishSetup.repository.addDraft(makeDraft(), RULE_PACK_ACTORS.author);
    expect(() =>
      publishSetup.repository.publishDraft(
        {
          ...publishRequest,
          expectedDraftRevision: true,
        } as unknown as PublishRulePackDraftRequest,
        RULE_PACK_ACTORS.publisher,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_PACK_PUBLISH_REQUEST" }));
  });

  it("uses one detached request and actor snapshot despite mid-publication mutation", () => {
    const mutableRequest = structuredClone(publishRequest);
    const mutablePublisher = structuredClone(RULE_PACK_ACTORS.publisher);
    let internalRuleMutationSucceeded: boolean | undefined;
    const repository = new InMemoryRulePackRepository({
      assertRuleEligible(rule) {
        Reflect.set(mutableRequest, "versionId", RULE_PACK_IDS.version3);
        Reflect.set(mutableRequest, "publishedAt", RULE_PACK_TIMES.published2);
        Reflect.set(mutableRequest, "expectedDraftRevision", 999);
        Reflect.set(mutablePublisher, "id", RULE_PACK_ACTORS.author.id);
        Reflect.set(mutablePublisher, "role", "AUTHOR");
        internalRuleMutationSucceeded = Reflect.set(rule, "normativeKey", "forged.key");
        return makeEligibilitySnapshot();
      },
    });
    repository.addDraft(makeDraft(), RULE_PACK_ACTORS.author);

    const version = repository.publishDraft(mutableRequest, mutablePublisher);
    expect(version).toMatchObject({
      id: RULE_PACK_IDS.version1,
      publishedAt: RULE_PACK_TIMES.published1,
      publishedBy: RULE_PACK_ACTORS.publisher.id,
    });
    expect(internalRuleMutationSucceeded).toBe(false);
    expect(version.rules[0]?.normativeKey).toBe("synthetic.record.marker");
  });
});

describe("InMemoryRulePackRepository publication", () => {
  it("publishes one immutable, hash-verifiable snapshot only after eligibility", () => {
    const { eligibility, repository } = setup();
    const published = publishFirst(repository);

    expect(published).toMatchObject({
      schemaVersion: RULE_PACK_SCHEMA_VERSION,
      id: RULE_PACK_IDS.version1,
      packId: RULE_PACK_IDS.pack,
      semver: "1.0.0",
      publishedAt: RULE_PACK_TIMES.published1,
      publishedBy: RULE_PACK_ACTORS.publisher.id,
    });
    expect(verifyRulePackVersionHash(published)).toBe(true);
    expect(eligibility.calls).toEqual([
      { ruleId: RULE_PACK_IDS.rule1, at: RULE_PACK_TIMES.published1 },
    ]);
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(published.rules[0]?.validity)).toBe(true);
    expect(Reflect.set(published, "semver", "9.9.9")).toBe(false);
    expect(repository.getVersion(RULE_PACK_IDS.version1).semver).toBe("1.0.0");
    expect(repository.getVersionBySemVer(RULE_PACK_IDS.pack, "1.0.0").id).toBe(
      RULE_PACK_IDS.version1,
    );
    expect(() => repository.getVersionBySemVer(RULE_PACK_IDS.pack, "9.9.9")).toThrow(
      RulePackNotFoundError,
    );

    expect(() =>
      repository.publishDraft(
        {
          draftId: RULE_PACK_IDS.draft1,
          versionId: RULE_PACK_IDS.version2,
          publishedAt: RULE_PACK_TIMES.published2,
          expectedDraftRevision: 1,
        },
        RULE_PACK_ACTORS.publisher,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_VERSION_ALREADY_PUBLISHED" }));
    const publishedDraftUpdate = rehashDraft(repository.getDraft(RULE_PACK_IDS.draft1), {
      revision: 2,
      updatedAt: RULE_PACK_TIMES.cloned,
      updatedBy: RULE_PACK_IDS.author2,
    });
    expect(() =>
      repository.replaceDraft(publishedDraftUpdate, 1, RULE_PACK_ACTORS.otherAuthor),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_VERSION_ALREADY_PUBLISHED" }));
  });

  it("rejects self-publication, wrong roles, stale revisions, and non-monotonic time", () => {
    const { repository } = setup();
    repository.addDraft(makeDraft(), RULE_PACK_ACTORS.author);
    const request = {
      draftId: RULE_PACK_IDS.draft1,
      versionId: RULE_PACK_IDS.version1,
      publishedAt: RULE_PACK_TIMES.published1,
      expectedDraftRevision: 1,
    } as const;

    expect(() => repository.publishDraft(request, RULE_PACK_ACTORS.invalidPublisher)).toThrow(
      expect.objectContaining({ code: "RULE_PACK_PUBLISHER_NOT_AUTHORIZED" }),
    );
    expect(() => repository.publishDraft(request, RULE_PACK_ACTORS.selfPublisher)).toThrow(
      expect.objectContaining({ code: "RULE_PACK_PUBLISHER_NOT_AUTHORIZED" }),
    );
    expect(() =>
      repository.publishDraft({ ...request, expectedDraftRevision: 2 }, RULE_PACK_ACTORS.publisher),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_DRAFT_REVISION_CONFLICT" }));
    expect(() =>
      repository.publishDraft(
        { ...request, publishedAt: "2026-02-09T23:59:59.999Z" },
        RULE_PACK_ACTORS.publisher,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_PUBLISH_TIME_INVALID" }));
  });

  it("treats mixed-case UUID spellings as the same contributor identity", () => {
    const identity = "00000000-0000-4000-8000-00000000abcd";
    const { repository } = setup();
    repository.addDraft(makeDraft({ createdBy: identity, updatedBy: identity }), {
      ...RULE_PACK_ACTORS.author,
      id: identity,
    });

    expect(() =>
      repository.publishDraft(
        {
          draftId: RULE_PACK_IDS.draft1,
          versionId: RULE_PACK_IDS.version1,
          publishedAt: RULE_PACK_TIMES.published1,
          expectedDraftRevision: 1,
        },
        { ...RULE_PACK_ACTORS.publisher, id: identity.toUpperCase() },
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_PUBLISHER_NOT_AUTHORIZED" }));

    const published = repository.publishDraft(
      {
        draftId: RULE_PACK_IDS.draft1,
        versionId: RULE_PACK_IDS.version1,
        publishedAt: RULE_PACK_TIMES.published1,
        expectedDraftRevision: 1,
      },
      RULE_PACK_ACTORS.publisher,
    );
    expect(() =>
      repository.assertVersionEligibleForActivation(
        published.id,
        RULE_PACK_TIMES.packValidFrom,
        identity.toUpperCase(),
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_ACTIVATOR_NOT_AUTHORIZED" }));
  });

  it("retains every draft contributor when enforcing independent publication", () => {
    const { repository } = setup();
    const first = repository.addDraft(makeDraft(), RULE_PACK_ACTORS.author);
    const second = rehashDraft(first, {
      revision: 2,
      updatedAt: RULE_PACK_TIMES.updated,
      updatedBy: RULE_PACK_ACTORS.otherAuthor.id,
      changeReason: "Edited by a second synthetic author",
    });
    repository.replaceDraft(second, 1, RULE_PACK_ACTORS.otherAuthor);
    const third = rehashDraft(second, {
      revision: 3,
      updatedAt: RULE_PACK_TIMES.cloned,
      updatedBy: RULE_PACK_ACTORS.author.id,
      changeReason: "Final edit returned to the original author",
    });
    repository.replaceDraft(third, 2, RULE_PACK_ACTORS.author);

    expect(() =>
      repository.publishDraft(
        {
          draftId: RULE_PACK_IDS.draft1,
          versionId: RULE_PACK_IDS.version1,
          publishedAt: RULE_PACK_TIMES.published2,
          expectedDraftRevision: 3,
        },
        { ...RULE_PACK_ACTORS.otherAuthor, role: "APPROVER" },
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_PUBLISHER_NOT_AUTHORIZED" }));

    const published = repository.publishDraft(
      {
        draftId: RULE_PACK_IDS.draft1,
        versionId: RULE_PACK_IDS.version1,
        publishedAt: RULE_PACK_TIMES.published2,
        expectedDraftRevision: 3,
      },
      RULE_PACK_ACTORS.publisher,
    );
    expect(() =>
      repository.assertVersionEligibleForActivation(
        published.id,
        RULE_PACK_TIMES.packValidFrom,
        RULE_PACK_ACTORS.otherAuthor.id,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_ACTIVATOR_NOT_AUTHORIZED" }));
  });

  it("makes publication transactional and wraps authoritative eligibility failures", () => {
    const { eligibility, repository } = setup();
    repository.addDraft(makeDraft(), RULE_PACK_ACTORS.author);
    eligibility.failWith(new Error("synthetic unavailable reader"));
    expect(() =>
      repository.publishDraft(
        {
          draftId: RULE_PACK_IDS.draft1,
          versionId: RULE_PACK_IDS.version1,
          publishedAt: RULE_PACK_TIMES.published1,
          expectedDraftRevision: 1,
        },
        RULE_PACK_ACTORS.publisher,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_RULE_NOT_ELIGIBLE" }));
    expect(() => repository.getVersion(RULE_PACK_IDS.version1)).toThrow(RulePackNotFoundError);

    eligibility.failWith(
      new RulePackEligibilityError(
        "RULE_PACK_RULE_NOT_ELIGIBLE",
        "Synthetic explicit eligibility denial",
      ),
    );
    expect(() =>
      repository.publishDraft(
        {
          draftId: RULE_PACK_IDS.draft1,
          versionId: RULE_PACK_IDS.version1,
          publishedAt: RULE_PACK_TIMES.published1,
          expectedDraftRevision: 1,
        },
        RULE_PACK_ACTORS.publisher,
      ),
    ).toThrow("Synthetic explicit eligibility denial");
  });

  it("rejects forged provenance and pack validity outside any bound snapshot", () => {
    const forgedCases = [
      {
        snapshot: makeEligibilitySnapshot({
          source: makeSource({ id: RULE_PACK_IDS.foreignPack }),
        }),
        code: "RULE_PACK_RULE_NOT_ELIGIBLE",
      },
      {
        snapshot: makeEligibilitySnapshot({
          sourceVersion: makeVersion({ contentHash: "f".repeat(64) }),
        }),
        code: "RULE_PACK_RULE_NOT_ELIGIBLE",
      },
      {
        snapshot: makeEligibilitySnapshot({
          ruleCardRevision: makeRuleCardRevision({ id: RULE_PACK_IDS.rule3 }),
        }),
        code: "RULE_PACK_RULE_NOT_ELIGIBLE",
      },
      {
        snapshot: makeEligibilitySnapshot({
          source: makeSource({ domain: "different-synthetic-domain" }),
        }),
        code: "RULE_PACK_SCOPE_MISMATCH",
      },
      {
        snapshot: makeEligibilitySnapshot({
          source: makeSource({ jurisdiction: "OTHER-DEMO" }),
        }),
        code: "RULE_PACK_SCOPE_MISMATCH",
      },
    ];
    for (const forged of forgedCases) {
      const { eligibility, repository } = setup();
      repository.addDraft(makeDraft(), RULE_PACK_ACTORS.author);
      eligibility.setSnapshot(forged.snapshot);
      expect(() =>
        repository.publishDraft(
          {
            draftId: RULE_PACK_IDS.draft1,
            versionId: RULE_PACK_IDS.version1,
            publishedAt: RULE_PACK_TIMES.published1,
            expectedDraftRevision: 1,
          },
          RULE_PACK_ACTORS.publisher,
        ),
      ).toThrow(expect.objectContaining({ code: forged.code }));
    }

    const { eligibility, repository } = setup();
    repository.addDraft(makeDraft(), RULE_PACK_ACTORS.author);
    eligibility.setSnapshot(
      makeEligibilitySnapshot({
        sourceVersion: makeVersion({
          validity: {
            validFrom: "2026-01-01T00:00:00.000Z",
            validTo: "2026-06-01T00:00:00.000Z",
          },
        }),
      }),
    );
    expect(() =>
      repository.publishDraft(
        {
          draftId: RULE_PACK_IDS.draft1,
          versionId: RULE_PACK_IDS.version1,
          publishedAt: RULE_PACK_TIMES.published1,
          expectedDraftRevision: 1,
        },
        RULE_PACK_ACTORS.publisher,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_RULE_OUTSIDE_VALIDITY" }));
  });

  it("requires a unique increasing SemVer, declared predecessor, and publication order", () => {
    const cases = [
      {
        semver: "1.0.0",
        supersedesVersionId: RULE_PACK_IDS.version1,
        publishedAt: RULE_PACK_TIMES.published2,
        code: "RULE_PACK_VERSION_ALREADY_EXISTS",
      },
      {
        semver: "0.9.0",
        supersedesVersionId: RULE_PACK_IDS.version1,
        publishedAt: RULE_PACK_TIMES.published2,
        code: "RULE_PACK_VERSION_NOT_MONOTONIC",
      },
      {
        semver: "1.1.0",
        supersedesVersionId: RULE_PACK_IDS.version3,
        publishedAt: RULE_PACK_TIMES.published2,
        code: "RULE_PACK_SUPERSESSION_INVALID",
      },
      {
        semver: "1.1.0",
        supersedesVersionId: RULE_PACK_IDS.version1,
        publishedAt: RULE_PACK_TIMES.published1,
        draftCreatedAt: RULE_PACK_TIMES.created,
        code: "RULE_PACK_PUBLISH_TIME_INVALID",
      },
    ] as const;

    for (const item of cases) {
      const { repository } = setup();
      publishFirst(repository);
      repository.addDraft(
        makeDraft({
          id: RULE_PACK_IDS.draft2,
          semver: item.semver,
          supersedesVersionId: item.supersedesVersionId,
          createdAt: "draftCreatedAt" in item ? item.draftCreatedAt : RULE_PACK_TIMES.cloned,
          createdBy: RULE_PACK_IDS.author2,
          updatedAt: "draftCreatedAt" in item ? item.draftCreatedAt : RULE_PACK_TIMES.cloned,
          updatedBy: RULE_PACK_IDS.author2,
          changeReason: "Synthetic next version",
        }),
        RULE_PACK_ACTORS.otherAuthor,
      );
      expect(() =>
        repository.publishDraft(
          {
            draftId: RULE_PACK_IDS.draft2,
            versionId: RULE_PACK_IDS.version2,
            publishedAt: item.publishedAt,
            expectedDraftRevision: 1,
          },
          RULE_PACK_ACTORS.publisher,
        ),
      ).toThrow(expect.objectContaining({ code: item.code }));
    }
  });

  it("requires first versions to have no predecessor and prevents duplicate version IDs", () => {
    const { repository } = setup();
    repository.addDraft(
      makeDraft({ supersedesVersionId: RULE_PACK_IDS.version3 }),
      RULE_PACK_ACTORS.author,
    );
    expect(() =>
      repository.publishDraft(
        {
          draftId: RULE_PACK_IDS.draft1,
          versionId: RULE_PACK_IDS.version1,
          publishedAt: RULE_PACK_TIMES.published1,
          expectedDraftRevision: 1,
        },
        RULE_PACK_ACTORS.publisher,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_SUPERSESSION_INVALID" }));

    const secondSetup = setup();
    publishFirst(secondSetup.repository);
    secondSetup.repository.addDraft(
      makeDraft({
        id: RULE_PACK_IDS.draft2,
        semver: "1.1.0",
        supersedesVersionId: RULE_PACK_IDS.version1,
      }),
      RULE_PACK_ACTORS.author,
    );
    expect(() =>
      secondSetup.repository.publishDraft(
        {
          draftId: RULE_PACK_IDS.draft2,
          versionId: RULE_PACK_IDS.version1,
          publishedAt: RULE_PACK_TIMES.published2,
          expectedDraftRevision: 1,
        },
        RULE_PACK_ACTORS.publisher,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_VERSION_ALREADY_EXISTS" }));
  });

  it("rejects overlapping independent streams for the same domain and jurisdiction", () => {
    const { repository } = setup();
    publishFirst(repository);
    repository.addDraft(
      makeDraft({
        id: RULE_PACK_IDS.draft2,
        packId: RULE_PACK_IDS.foreignPack,
        createdBy: RULE_PACK_IDS.author2,
        updatedBy: RULE_PACK_IDS.author2,
      }),
      RULE_PACK_ACTORS.otherAuthor,
    );
    expect(() =>
      repository.publishDraft(
        {
          draftId: RULE_PACK_IDS.draft2,
          versionId: RULE_PACK_IDS.version2,
          publishedAt: RULE_PACK_TIMES.published2,
          expectedDraftRevision: 1,
        },
        RULE_PACK_ACTORS.publisher,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_OVERLAP_NOT_DECLARED" }));
  });

  it("supports controlled cloning and blocks malformed or stale clones", () => {
    const { repository } = setup();
    publishFirst(repository);
    const clone = repository.cloneVersion(
      {
        sourceVersionId: RULE_PACK_IDS.version1,
        draftId: RULE_PACK_IDS.draft2,
        semver: "1.1.0",
        changeReason: "Controlled synthetic clone",
        createdAt: RULE_PACK_TIMES.cloned,
      },
      RULE_PACK_ACTORS.otherAuthor,
    );
    expect(clone).toMatchObject({
      id: RULE_PACK_IDS.draft2,
      packId: RULE_PACK_IDS.pack,
      revision: 1,
      semver: "1.1.0",
      supersedesVersionId: RULE_PACK_IDS.version1,
      createdBy: RULE_PACK_ACTORS.otherAuthor.id,
    });
    expect(clone.rules).toEqual(repository.getVersion(RULE_PACK_IDS.version1).rules);
    const publishedClone = repository.publishDraft(
      {
        draftId: RULE_PACK_IDS.draft2,
        versionId: RULE_PACK_IDS.version2,
        publishedAt: RULE_PACK_TIMES.published2,
        expectedDraftRevision: 1,
      },
      RULE_PACK_ACTORS.publisher,
    );
    expect(publishedClone).toMatchObject({
      semver: "1.1.0",
      supersedesVersionId: RULE_PACK_IDS.version1,
    });

    const invalidRequests = [
      {
        request: {
          sourceVersionId: RULE_PACK_IDS.version3,
          draftId: RULE_PACK_IDS.draft3,
          semver: "1.2.0" as const,
          changeReason: "Missing source",
          createdAt: RULE_PACK_TIMES.cloned,
        },
        actor: RULE_PACK_ACTORS.otherAuthor,
      },
      {
        request: {
          sourceVersionId: RULE_PACK_IDS.version1,
          draftId: RULE_PACK_IDS.draft3,
          semver: "1.2.0" as const,
          changeReason: " ",
          createdAt: RULE_PACK_TIMES.cloned,
        },
        actor: RULE_PACK_ACTORS.otherAuthor,
      },
      {
        request: {
          sourceVersionId: RULE_PACK_IDS.version1,
          draftId: RULE_PACK_IDS.draft3,
          semver: "1.2.0" as const,
          changeReason: "Wrong role",
          createdAt: RULE_PACK_TIMES.cloned,
        },
        actor: RULE_PACK_ACTORS.invalidPublisher,
      },
      {
        request: {
          sourceVersionId: RULE_PACK_IDS.version1,
          draftId: RULE_PACK_IDS.draft2,
          semver: "1.2.0" as const,
          changeReason: "Duplicate draft",
          createdAt: RULE_PACK_TIMES.cloned,
        },
        actor: RULE_PACK_ACTORS.otherAuthor,
      },
      {
        request: {
          sourceVersionId: RULE_PACK_IDS.version1,
          draftId: RULE_PACK_IDS.draft3,
          semver: "1.2.0" as const,
          changeReason: "Predates source publication",
          createdAt: RULE_PACK_TIMES.created,
        },
        actor: RULE_PACK_ACTORS.otherAuthor,
      },
    ];
    for (const { request, actor } of invalidRequests) {
      expect(() => repository.cloneVersion(request, actor)).toThrow(
        expect.objectContaining({ code: "INVALID_RULE_PACK_CLONE_REQUEST" }),
      );
    }
  });

  it("rechecks source and Rule Card eligibility at activation time", () => {
    const { eligibility, repository } = setup();
    publishFirst(repository);
    const activated = repository.assertVersionEligibleForActivation(
      RULE_PACK_IDS.version1,
      RULE_PACK_TIMES.packValidFrom,
      SOURCE_IDS.secondApprover,
    );
    expect(activated.id).toBe(RULE_PACK_IDS.version1);
    expect(eligibility.calls.at(-1)).toEqual({
      ruleId: RULE_PACK_IDS.rule1,
      at: RULE_PACK_TIMES.packValidFrom,
    });
    expect(
      repository.assertVersionEligibleForActivation(
        RULE_PACK_IDS.version1,
        RULE_PACK_TIMES.packValidFrom,
        RULE_PACK_ACTORS.publisher.id,
      ).id,
    ).toBe(RULE_PACK_IDS.version1);
    expect(() =>
      repository.assertVersionEligibleForActivation(
        RULE_PACK_IDS.version1,
        RULE_PACK_TIMES.packValidFrom,
        RULE_PACK_ACTORS.author.id,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_ACTIVATOR_NOT_AUTHORIZED" }));
    expect(() =>
      repository.assertVersionEligibleForActivation(
        RULE_PACK_IDS.version1,
        RULE_PACK_TIMES.packValidFrom,
        "not-an-actor-id",
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_ACTIVATOR_NOT_AUTHORIZED" }));
    expect(() =>
      repository.assertVersionEligibleForActivation(
        RULE_PACK_IDS.version1,
        RULE_PACK_TIMES.packValidTo,
        SOURCE_IDS.secondApprover,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_ACTIVATION_OUTSIDE_VALIDITY" }));
  });
});

describe("InMemoryRulePackRepository.fromSnapshot", () => {
  it("hydrates drafts and versions and preserves OCC on subsequent draft updates", () => {
    const { repository: seeded, eligibility } = setup();
    const publishedDraft = makeDraft();
    seeded.addDraft(publishedDraft, RULE_PACK_ACTORS.author);
    const version = seeded.publishDraft(
      {
        draftId: RULE_PACK_IDS.draft1,
        versionId: RULE_PACK_IDS.version1,
        publishedAt: RULE_PACK_TIMES.published1,
        expectedDraftRevision: 1,
      },
      RULE_PACK_ACTORS.publisher,
    );
    const unpublished = makeDraft({
      id: RULE_PACK_IDS.draft2,
      packId: RULE_PACK_IDS.foreignPack,
      domain: "synthetic-quality",
      jurisdiction: "OTHER-DEMO",
      semver: "1.0.0",
    });
    seeded.addDraft(unpublished, RULE_PACK_ACTORS.author);

    const hydrated = InMemoryRulePackRepository.fromSnapshot(
      {
        drafts: [seeded.getDraft(RULE_PACK_IDS.draft1), seeded.getDraft(RULE_PACK_IDS.draft2)],
        versions: [version],
        contributorIdsByDraftId: {
          [RULE_PACK_IDS.draft1]: [SOURCE_IDS.author],
          [RULE_PACK_IDS.draft2]: [SOURCE_IDS.author],
        },
        excludedActivatorIdsByVersionId: {
          [RULE_PACK_IDS.version1]: [SOURCE_IDS.author],
        },
        publishedVersionIdByDraftId: {
          [RULE_PACK_IDS.draft1]: RULE_PACK_IDS.version1,
        },
      },
      eligibility.reader,
    );

    expect(hydrated.getVersion(RULE_PACK_IDS.version1).id).toBe(RULE_PACK_IDS.version1);
    expect(() =>
      hydrated.replaceDraft(
        rehashDraft(unpublished, {
          revision: 2,
          updatedAt: RULE_PACK_TIMES.updated,
          updatedBy: SOURCE_IDS.author,
          changeReason: "Hydrated OCC update",
        }),
        1,
        RULE_PACK_ACTORS.author,
      ),
    ).not.toThrow();
    expect(() =>
      hydrated.replaceDraft(
        rehashDraft(unpublished, {
          revision: 2,
          updatedAt: RULE_PACK_TIMES.updated,
          updatedBy: SOURCE_IDS.author,
          changeReason: "Stale OCC update",
        }),
        1,
        RULE_PACK_ACTORS.author,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_DRAFT_REVISION_CONFLICT" }));
    expect(() =>
      hydrated.replaceDraft(
        rehashDraft(publishedDraft, {
          revision: 2,
          updatedAt: RULE_PACK_TIMES.updated,
          updatedBy: SOURCE_IDS.author,
        }),
        1,
        RULE_PACK_ACTORS.author,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_VERSION_ALREADY_PUBLISHED" }));
  });

  it("rejects invalid hydrated draft and version payloads", () => {
    const { eligibility } = setup();
    const malformedDraft = { ...makeDraft(), unexpected: true };
    expect(() =>
      InMemoryRulePackRepository.fromSnapshot(
        {
          drafts: [malformedDraft],
          versions: [],
          contributorIdsByDraftId: {},
          excludedActivatorIdsByVersionId: {},
        },
        eligibility.reader,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_PACK_DRAFT_PAYLOAD" }));

    const malformedVersion = { ...publishFirst(setup().repository), unexpected: true };
    expect(() =>
      InMemoryRulePackRepository.fromSnapshot(
        {
          drafts: [],
          versions: [malformedVersion],
          contributorIdsByDraftId: {},
          excludedActivatorIdsByVersionId: {},
        },
        eligibility.reader,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_RULE_PACK_VERSION_PAYLOAD" }));
  });
});
