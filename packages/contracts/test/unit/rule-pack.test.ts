import { describe, expect, it } from "vitest";

import {
  DSL_VERSION,
  computeRuleDefinitionHash,
  type RuleDefinition,
  type RuleDefinitionHashInput,
} from "../../src/dsl.js";
import { EVALUATION_SNAPSHOT_LIMITS, type ExpressionTrace } from "../../src/evaluation.js";
import { sha256CanonicalJson } from "../../src/hash.js";
import {
  ACTIVATION_EVENT_SCHEMA_VERSION,
  ActivationEventSchema,
  RULE_PACK_EVALUATION_SCHEMA_VERSION,
  RULE_PACK_LIMITS,
  RULE_PACK_SCHEMA_VERSION,
  ResolvedRulePackSchema,
  RulePackDraftSchema,
  RulePackEvaluationHashInputSchema,
  RulePackEvaluationSnapshotSchema,
  RulePackResolutionRequestSchema,
  RulePackVersionSchema,
  SemVerSchema,
  compareSemVer,
  computeActivationEventHash,
  computeRulePackDraftHash,
  computeRulePackEvaluationHash,
  computeRulePackVersionHash,
  verifyActivationEventHash,
  verifyRulePackDraftHash,
  verifyRulePackEvaluationHash,
  verifyRulePackVersionHash,
  type ActivationEvent,
  type ActivationEventHashInput,
  type RulePackDraft,
  type RulePackDraftHashInput,
  type RulePackEvaluationHashInput,
  type RulePackVersion,
  type RulePackVersionHashInput,
} from "../../src/rule-pack.js";

const IDS = {
  pack: "00000000-0000-4000-8000-000000007001",
  version: "00000000-0000-4000-8000-000000007002",
  priorVersion: "00000000-0000-4000-8000-000000007003",
  draft: "00000000-0000-4000-8000-000000007004",
  author: "00000000-0000-4000-8000-000000007005",
  approver: "00000000-0000-4000-8000-000000007006",
  event: "00000000-0000-4000-8000-000000007007",
  source: "00000000-0000-4000-8000-000000007008",
  sourceVersion: "00000000-0000-4000-8000-000000007009",
  card: "00000000-0000-4000-8000-000000007010",
  cardRevision: "00000000-0000-4000-8000-000000007011",
  ruleA: "00000000-0000-4000-8000-000000007012",
  ruleB: "00000000-0000-4000-8000-000000007013",
  unknownRule: "00000000-0000-4000-8000-000000007014",
  overrideA: "00000000-0000-4000-8000-000000007015",
  overrideB: "00000000-0000-4000-8000-000000007016",
  ruleC: "00000000-0000-4000-8000-000000007017",
} as const;

const TIMES = {
  created: "2025-12-01T00:00:00.000Z",
  published: "2025-12-15T00:00:00.000Z",
  validFrom: "2026-01-01T00:00:00.0000001Z",
  inside: "2026-06-01T00:00:00.0000001Z",
  validTo: "2027-01-01T00:00:00.0000001Z",
} as const;

function makeRuleInput(
  id: string = IDS.ruleA,
  overrides: readonly RuleDefinitionHashInput["overrides"][number][] = [],
  conflictsWith: readonly string[] = [],
): RuleDefinitionHashInput {
  return {
    dslVersion: DSL_VERSION,
    state: "DRAFT",
    id,
    sourceId: IDS.source,
    sourceVersionId: IDS.sourceVersion,
    sourceContentHash: "a".repeat(64),
    ruleCardId: IDS.card,
    ruleCardRevisionId: IDS.cardRevision,
    ruleCardRevisionContentHash: "b".repeat(64),
    normativeKey: `synthetic.rule.${id.slice(-3)}`,
    deonticCategory: "OBLIGATION",
    riskLevel: "LOW",
    validity: { validFrom: TIMES.validFrom, validTo: TIMES.validTo },
    appliesWhen: { op: "truth", value: "TRUE" },
    satisfiedWhen: { op: "truth", value: "TRUE" },
    exceptions: [],
    overrides: [...overrides],
    conflictsWith: [...conflictsWith],
    evidenceBindings: [],
    unknownPolicy: "REVIEW",
    validationScope: "TECHNICAL_DEMO",
  };
}

function makeRule(
  id: string = IDS.ruleA,
  overrides: readonly RuleDefinitionHashInput["overrides"][number][] = [],
  conflictsWith: readonly string[] = [],
): RuleDefinition {
  const input = makeRuleInput(id, overrides, conflictsWith);
  return { ...input, contentHash: computeRuleDefinitionHash(input) };
}

function makeRuleWithValidity(validity: RuleDefinitionHashInput["validity"]): RuleDefinition {
  const input: RuleDefinitionHashInput = { ...makeRuleInput(), validity };
  return { ...input, contentHash: computeRuleDefinitionHash(input) };
}

function makeVersionInput(
  overrides: Partial<RulePackVersionHashInput> = {},
): RulePackVersionHashInput {
  return {
    schemaVersion: RULE_PACK_SCHEMA_VERSION,
    id: IDS.version,
    packId: IDS.pack,
    semver: "1.0.0",
    domain: "synthetic-domain",
    jurisdiction: "ZZ-DEMO",
    validity: { validFrom: TIMES.validFrom, validTo: TIMES.validTo },
    rules: [makeRule()],
    changeReason: "Initial synthetic publication",
    supersedesVersionId: null,
    createdAt: TIMES.created,
    createdBy: IDS.author,
    publishedAt: TIMES.published,
    publishedBy: IDS.approver,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

function makeVersion(overrides: Partial<RulePackVersionHashInput> = {}): RulePackVersion {
  const input = makeVersionInput(overrides);
  return RulePackVersionSchema.parse({ ...input, contentHash: computeRulePackVersionHash(input) });
}

function makeOversizedVersionCandidate(): RulePackVersion {
  const rules = Array.from({ length: 29 }, (_, ruleIndex) => {
    const id = `00000000-0000-4000-8001-${String(ruleIndex + 1).padStart(12, "0")}`;
    const input: RuleDefinitionHashInput = {
      ...makeRuleInput(id),
      appliesWhen: {
        op: "contains_any",
        factKey: "synthetic.marker",
        expected: Array.from(
          { length: 64 },
          (_, valueIndex) => `${"x".repeat(13_900)}-${String(ruleIndex)}-${String(valueIndex)}`,
        ),
        comparison: {
          normalization: "NFC",
          whitespace: "PRESERVE",
          caseSensitivity: "SENSITIVE",
        },
      },
      evidenceBindings: [
        {
          factKey: "synthetic.marker",
          evidenceRequirementKeys: ["synthetic.marker.evidence"],
        },
      ],
    };
    return { ...input, contentHash: computeRuleDefinitionHash(input) };
  });
  const input = makeVersionInput({ rules });
  return { ...input, contentHash: sha256CanonicalJson(input) };
}

function makeMaximumNodeVersion(): RulePackVersion {
  const rules: RuleDefinition[] = Array.from({ length: 10_000 }, (_, ruleIndex) => {
    const id = `00000000-0000-4000-8003-${ruleIndex.toString(16).padStart(12, "0")}`;
    const expectedCount = ruleIndex < 66 ? 4 : ruleIndex < 9_900 ? 3 : 2;
    const input: RuleDefinitionHashInput = {
      ...makeRuleInput(id),
      appliesWhen: {
        op: "contains_any",
        factKey: "synthetic.marker",
        expected: Array.from(
          { length: expectedCount },
          (_, valueIndex) => `x${String(valueIndex)}`,
        ),
        comparison: {
          normalization: "NFC",
          whitespace: "PRESERVE",
          caseSensitivity: "SENSITIVE",
        },
      },
      evidenceBindings: [
        {
          factKey: "synthetic.marker",
          evidenceRequirementKeys: ["synthetic.marker.evidence"],
        },
      ],
    };
    return { ...input, contentHash: computeRuleDefinitionHash(input) };
  });
  const input = makeVersionInput({ rules });
  return RulePackVersionSchema.parse({
    ...input,
    contentHash: computeRulePackVersionHash(input),
  });
}

function makeDraftInput(overrides: Partial<RulePackDraftHashInput> = {}): RulePackDraftHashInput {
  return {
    schemaVersion: RULE_PACK_SCHEMA_VERSION,
    id: IDS.draft,
    packId: IDS.pack,
    revision: 1,
    semver: "1.1.0-alpha.1+demo.7",
    domain: "synthetic-domain",
    jurisdiction: "ZZ-DEMO",
    validity: { validFrom: TIMES.validFrom, validTo: TIMES.validTo },
    rules: [makeRule()],
    changeReason: "Controlled synthetic clone",
    supersedesVersionId: IDS.priorVersion,
    createdAt: TIMES.created,
    createdBy: IDS.author,
    updatedAt: TIMES.published,
    updatedBy: IDS.author,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

function makeDraft(overrides: Partial<RulePackDraftHashInput> = {}): RulePackDraft {
  const input = makeDraftInput(overrides);
  return RulePackDraftSchema.parse({ ...input, contentHash: computeRulePackDraftHash(input) });
}

function makeEventInput(
  overrides: Partial<ActivationEventHashInput> = {},
): ActivationEventHashInput {
  return {
    schemaVersion: ACTIVATION_EVENT_SCHEMA_VERSION,
    id: IDS.event,
    packId: IDS.pack,
    sequence: 1,
    type: "ACTIVATE",
    versionId: IDS.version,
    versionContentHash: makeVersion().contentHash,
    expectedPreviousVersionId: null,
    recordedAt: TIMES.published,
    effectiveAt: TIMES.validFrom,
    actorId: IDS.approver,
    exercisedRole: "APPROVER",
    reason: "Activate the synthetic baseline",
    previousEventHash: null,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<ActivationEventHashInput> = {}): ActivationEvent {
  const input = makeEventInput(overrides);
  return ActivationEventSchema.parse({ ...input, contentHash: computeActivationEventHash(input) });
}

function truthTrace(path: string): ExpressionTrace {
  return {
    path,
    op: "truth" as const,
    truth: "TRUE" as const,
    reason: "EVALUATED" as const,
    factKeys: [],
    expected: "TRUE" as const,
    observed: "TRUE" as const,
    evidenceIds: [],
    children: [],
  };
}

function requireItem<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a synthetic fixture item");
  return value;
}

function adversarialProxy<T extends object>(target: T, onTrap: () => void): T {
  return new Proxy(target, {
    get() {
      onTrap();
      throw new Error("adversarial get trap");
    },
    getOwnPropertyDescriptor() {
      onTrap();
      throw new Error("adversarial descriptor trap");
    },
    getPrototypeOf() {
      onTrap();
      throw new Error("adversarial prototype trap");
    },
    ownKeys() {
      onTrap();
      throw new Error("adversarial ownKeys trap");
    },
  });
}

function makeEvaluationInput(
  version: RulePackVersion = makeVersion(),
): RulePackEvaluationHashInput {
  return {
    schemaVersion: RULE_PACK_EVALUATION_SCHEMA_VERSION,
    rulePackVersion: version,
    evaluationDate: TIMES.inside,
    evaluationResult: {
      findings: version.rules.map((rule) => ({
        finding: {
          ruleId: rule.id,
          ruleContentHash: rule.contentHash,
          evaluationDate: TIMES.inside,
          outcome: "PASS" as const,
          appliesWhen: truthTrace("/appliesWhen"),
          exceptionTraces: [],
          satisfiedWhen: truthTrace("/satisfiedWhen"),
          overrideTraces: [],
          evidenceIds: [],
          validationScope: "TECHNICAL_DEMO" as const,
        },
        resolution: "UNCHANGED" as const,
        effectiveOutcome: "PASS" as const,
        relatedRuleIds: [],
      })),
      aggregateOutcome: "PASS",
    },
    validationScope: "TECHNICAL_DEMO",
  };
}

describe("SemVerSchema and compareSemVer", () => {
  it.each([
    "0.0.0",
    "1.2.3",
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-0.3.7",
    "1.0.0-x.7.z.92+build.5",
  ])("accepts strict SemVer 2.0.0: %s", (value) => {
    expect(SemVerSchema.parse(value)).toBe(value);
  });

  it.each([
    "1",
    "1.2",
    "v1.2.3",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "1.0.0-01",
    "1.0.0-alpha..1",
    "1.0.0+",
    "1.0.0+bad_meta",
  ])("rejects non-canonical versions: %s", (value) => {
    expect(SemVerSchema.safeParse(value).success).toBe(false);
  });

  it("implements every SemVer precedence class without numeric overflow", () => {
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
      "2.0.0",
      "999999999999999999999999999999.0.0",
    ];
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = requireItem(ordered[index - 1]);
      const current = requireItem(ordered[index]);
      expect(compareSemVer(previous, current)).toBe(-1);
      expect(compareSemVer(current, previous)).toBe(1);
    }
    expect(compareSemVer("1.0.0+build.1", "1.0.0+build.2")).toBe(0);
    expect(compareSemVer("1.2.3", "1.2.3")).toBe(0);
    expect(compareSemVer("1.2.3-alpha.1", "1.2.3-alpha.1")).toBe(0);
  });
});

describe("Rule Pack immutable snapshots", () => {
  it("hashes, detaches, and deeply freezes a draft", () => {
    const input = makeDraftInput();
    const candidate = {
      ...input,
      rules: [...input.rules],
      contentHash: computeRulePackDraftHash(input),
    };
    const parsed = RulePackDraftSchema.parse(candidate);
    candidate.rules.length = 0;

    expect(parsed.rules).toHaveLength(1);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.rules)).toBe(true);
    expect(Object.isFrozen(parsed.rules[0])).toBe(true);
    expect(verifyRulePackDraftHash(parsed)).toBe(true);
    expect(verifyRulePackDraftHash({ ...parsed, revision: 2 })).toBe(false);
  });

  it("rejects non-monotonic draft time and a self-superseding version", () => {
    expect(() => makeDraft({ updatedAt: "2025-01-01T00:00:00.000Z" })).toThrow();
    expect(() => makeVersion({ supersedesVersionId: IDS.version })).toThrow();
    expect(() => makeVersion({ publishedAt: "2025-01-01T00:00:00.000Z" })).toThrow();

    const invalidDraft = makeDraftInput({ updatedAt: "2025-01-01T00:00:00.000Z" });
    expect(
      RulePackDraftSchema.safeParse({
        ...invalidDraft,
        contentHash: sha256CanonicalJson(invalidDraft),
      }).success,
    ).toBe(false);
    const invalidVersion = makeVersionInput({ publishedAt: "2025-01-01T00:00:00.000Z" });
    expect(
      RulePackVersionSchema.safeParse({
        ...invalidVersion,
        contentHash: sha256CanonicalJson(invalidVersion),
      }).success,
    ).toBe(false);
  });

  it("requires a sorted, closed rule snapshot", () => {
    const ruleA = makeRule(IDS.ruleA);
    const ruleB = makeRule(IDS.ruleB);
    expect(() => makeVersion({ rules: [ruleB, ruleA] })).toThrow(/strictly sorted/u);
    expect(() => makeVersion({ rules: [ruleA, structuredClone(ruleA)] })).toThrow(
      /strictly sorted/u,
    );
    expect(() => makeVersion({ rules: [makeRule(IDS.ruleA, [], [IDS.unknownRule])] })).toThrow(
      /Conflict target/u,
    );
    expect(() =>
      makeVersion({
        rules: [
          makeRule(IDS.ruleA, [
            {
              id: IDS.overrideA,
              overridingRuleId: IDS.ruleA,
              overriddenRuleId: IDS.unknownRule,
              when: { op: "truth", value: "TRUE" },
              reason: "Synthetic dangling precedence",
              sourceVersionId: IDS.sourceVersion,
              sourceReference: "synthetic-dangling",
            },
          ]),
        ],
      }),
    ).toThrow(/Override target/u);
    expect(
      makeVersion({
        rules: [makeRule(IDS.ruleA, [], [IDS.ruleB]), makeRule(IDS.ruleB)],
      }).rules,
    ).toHaveLength(2);
  });

  it("requires every rule to contain the pack validity, including open-ended boundaries", () => {
    expect(() =>
      makeVersion({
        validity: { validFrom: TIMES.validFrom, validTo: null },
        rules: [makeRule()],
      }),
    ).toThrow(/complete Rule Pack validity/u);
    expect(() =>
      makeVersion({
        rules: [
          makeRuleWithValidity({
            validFrom: "2026-02-01T00:00:00.000Z",
            validTo: TIMES.validTo,
          }),
        ],
      }),
    ).toThrow(/complete Rule Pack validity/u);
    expect(() =>
      makeVersion({
        rules: [
          makeRuleWithValidity({
            validFrom: TIMES.validFrom,
            validTo: "2026-12-01T00:00:00.000Z",
          }),
        ],
      }),
    ).toThrow(/complete Rule Pack validity/u);

    expect(
      makeVersion({
        rules: [makeRuleWithValidity({ validFrom: TIMES.validFrom, validTo: null })],
      }).rules,
    ).toHaveLength(1);
    expect(
      makeVersion({
        validity: { validFrom: TIMES.validFrom, validTo: null },
        rules: [makeRuleWithValidity({ validFrom: TIMES.validFrom, validTo: null })],
      }).validity.validTo,
    ).toBeNull();
  });

  it("requires an acyclic override graph", () => {
    const ruleA = makeRule(IDS.ruleA, [
      {
        id: IDS.overrideA,
        overridingRuleId: IDS.ruleA,
        overriddenRuleId: IDS.ruleB,
        when: { op: "truth", value: "TRUE" },
        reason: "Synthetic A precedence",
        sourceVersionId: IDS.sourceVersion,
        sourceReference: "synthetic-a",
      },
    ]);
    const ruleB = makeRule(IDS.ruleB, [
      {
        id: IDS.overrideB,
        overridingRuleId: IDS.ruleB,
        overriddenRuleId: IDS.ruleA,
        when: { op: "truth", value: "TRUE" },
        reason: "Synthetic B precedence",
        sourceVersionId: IDS.sourceVersion,
        sourceReference: "synthetic-b",
      },
    ]);
    expect(() => makeVersion({ rules: [ruleA, ruleB] })).toThrow(/acyclic/u);
  });

  it("accepts and traverses a precedence DAG with fan-in", () => {
    const ruleA = makeRule(IDS.ruleA, [
      {
        id: IDS.overrideA,
        overridingRuleId: IDS.ruleA,
        overriddenRuleId: IDS.ruleC,
        when: { op: "truth", value: "TRUE" },
        reason: "Synthetic one-way precedence",
        sourceVersionId: IDS.sourceVersion,
        sourceReference: "synthetic-one-way",
      },
    ]);
    const ruleB = makeRule(IDS.ruleB, [
      {
        id: IDS.overrideB,
        overridingRuleId: IDS.ruleB,
        overriddenRuleId: IDS.ruleC,
        when: { op: "truth", value: "TRUE" },
        reason: "Synthetic second one-way precedence",
        sourceVersionId: IDS.sourceVersion,
        sourceReference: "synthetic-one-way-b",
      },
    ]);
    expect(makeVersion({ rules: [ruleA, ruleB, makeRule(IDS.ruleC)] }).rules).toHaveLength(3);
  });

  it("verifies canonical version hashes and rejects spoofing or non-demo scope", () => {
    const version = makeVersion();
    expect(verifyRulePackVersionHash(version)).toBe(true);
    expect(verifyRulePackVersionHash({ ...version, changeReason: "Tampered" })).toBe(false);
    expect(
      RulePackVersionSchema.safeParse({ ...version, validationScope: "PROFESSIONAL" }).success,
    ).toBe(false);
    expect(Object.isFrozen(version.validity)).toBe(true);
  });

  it("rejects accessors and shared references without invoking user code", () => {
    let reads = 0;
    const malicious = Object.defineProperty({}, "schemaVersion", {
      enumerable: true,
      get() {
        reads += 1;
        return RULE_PACK_SCHEMA_VERSION;
      },
    });
    expect(RulePackVersionSchema.safeParse(malicious).success).toBe(false);
    expect(reads).toBe(0);

    const input = makeVersionInput();
    const shared = { validFrom: TIMES.validFrom, validTo: TIMES.validTo };
    expect(
      RulePackVersionSchema.safeParse({
        ...input,
        validity: shared,
        rules: [{ ...input.rules[0], validity: shared }],
        contentHash: "a".repeat(64),
      }).success,
    ).toBe(false);

    let trapCalls = 0;
    const proxiedRule = adversarialProxy(requireItem(input.rules[0]), () => {
      trapCalls += 1;
    });
    expect(
      RulePackVersionSchema.safeParse({
        ...input,
        rules: [proxiedRule],
        contentHash: "a".repeat(64),
      }).success,
    ).toBe(false);
    expect(trapCalls).toBe(0);
  });
});

describe("append-only activation event contract", () => {
  it("hashes and freezes the first activation", () => {
    const event = makeEvent();
    expect(verifyActivationEventHash(event)).toBe(true);
    expect(Object.isFrozen(event)).toBe(true);
    expect(verifyActivationEventHash({ ...event, reason: "Tampered" })).toBe(false);
    expect(verifyActivationEventHash({ ...event, versionContentHash: "f".repeat(64) })).toBe(false);
  });

  it("enforces event chain, role, type, and non-backdating invariants", () => {
    expect(() => makeEvent({ sequence: 2 })).toThrow(/previous event hash/u);
    expect(() =>
      makeEvent({ sequence: 1, type: "ROLLBACK", expectedPreviousVersionId: IDS.priorVersion }),
    ).toThrow(/first ledger event/u);
    expect(() => makeEvent({ recordedAt: TIMES.inside, effectiveAt: TIMES.validFrom })).toThrow(
      /cannot precede/u,
    );
    expect(
      ActivationEventSchema.safeParse({
        ...makeEvent(),
        exercisedRole: "AUTHOR",
      }).success,
    ).toBe(false);

    const invalidChain = makeEventInput({ sequence: 2 });
    expect(
      ActivationEventSchema.safeParse({
        ...invalidChain,
        contentHash: sha256CanonicalJson(invalidChain),
      }).success,
    ).toBe(false);
  });

  it("requires exact targets for deactivation and rollback", () => {
    const previousEventHash = "c".repeat(64);
    const rollback = makeEvent({
      sequence: 2,
      type: "ROLLBACK",
      versionId: IDS.priorVersion,
      expectedPreviousVersionId: IDS.version,
      previousEventHash,
    });
    expect(rollback.type).toBe("ROLLBACK");

    const deactivate = makeEvent({
      sequence: 2,
      type: "DEACTIVATE",
      versionId: null,
      versionContentHash: null,
      expectedPreviousVersionId: IDS.version,
      previousEventHash,
    });
    expect(deactivate.versionId).toBeNull();
    expect(deactivate.versionContentHash).toBeNull();

    expect(() => makeEvent({ sequence: 2, type: "DEACTIVATE", previousEventHash })).toThrow();
    expect(() =>
      makeEvent({
        sequence: 2,
        type: "ROLLBACK",
        versionId: null,
        versionContentHash: null,
        expectedPreviousVersionId: IDS.version,
        previousEventHash,
      }),
    ).toThrow();
    expect(() =>
      makeEvent({
        sequence: 2,
        type: "ROLLBACK",
        expectedPreviousVersionId: IDS.version,
        previousEventHash,
      }),
    ).toThrow(/different version/u);
    expect(() =>
      makeEvent({
        sequence: 2,
        type: "ROLLBACK",
        versionId: IDS.priorVersion,
        expectedPreviousVersionId: null,
        previousEventHash,
      }),
    ).toThrow(/replaced active version/u);
    expect(() => makeEvent({ versionContentHash: null })).toThrow(/target version content hash/u);
    expect(() =>
      makeEvent({
        sequence: 2,
        type: "ROLLBACK",
        versionId: IDS.priorVersion,
        versionContentHash: null,
        expectedPreviousVersionId: IDS.version,
        previousEventHash,
      }),
    ).toThrow(/target version content hash/u);
  });
});

describe("resolution and evaluation snapshots", () => {
  it("detaches and freezes standalone resolution requests", () => {
    const request = RulePackResolutionRequestSchema.parse({
      domain: "synthetic-domain",
      jurisdiction: "ZZ-DEMO",
      evaluationDate: TIMES.inside,
    });
    expect(Object.isFrozen(request)).toBe(true);

    let reads = 0;
    const malicious = Object.defineProperty({}, "domain", {
      enumerable: true,
      get() {
        reads += 1;
        return "synthetic-domain";
      },
    });
    expect(RulePackResolutionRequestSchema.safeParse(malicious).success).toBe(false);
    expect(reads).toBe(0);

    let trapCalls = 0;
    const proxy = adversarialProxy({}, () => {
      trapCalls += 1;
    });
    expect(RulePackResolutionRequestSchema.safeParse(proxy).success).toBe(false);
    expect(trapCalls).toBe(0);
  });

  it("binds resolution to scope, half-open time, version, and activation identity", () => {
    const version = makeVersion();
    const activationEvent = makeEvent();
    const resolved = ResolvedRulePackSchema.parse({
      request: {
        domain: version.domain,
        jurisdiction: version.jurisdiction,
        evaluationDate: TIMES.validFrom,
      },
      rulePackVersion: version,
      activationEvent,
    });
    expect(Object.isFrozen(resolved.rulePackVersion.rules[0])).toBe(true);

    const base = {
      request: {
        domain: version.domain,
        jurisdiction: version.jurisdiction,
        evaluationDate: TIMES.inside,
      },
      rulePackVersion: version,
      activationEvent,
    };
    expect(
      ResolvedRulePackSchema.safeParse({
        ...base,
        request: { ...base.request, evaluationDate: TIMES.validTo },
      }).success,
    ).toBe(false);
    expect(
      ResolvedRulePackSchema.safeParse({
        ...base,
        request: { ...base.request, domain: "other-domain" },
      }).success,
    ).toBe(false);
    expect(
      ResolvedRulePackSchema.safeParse({
        ...base,
        request: { ...base.request, jurisdiction: "OTHER-DEMO" },
      }).success,
    ).toBe(false);
    expect(
      ResolvedRulePackSchema.safeParse({
        ...base,
        activationEvent: makeEvent({ versionId: IDS.priorVersion }),
      }).success,
    ).toBe(false);
    expect(
      ResolvedRulePackSchema.safeParse({
        ...base,
        activationEvent: makeEvent({ versionContentHash: "f".repeat(64) }),
      }).success,
    ).toBe(false);
    expect(
      ResolvedRulePackSchema.safeParse({
        ...base,
        activationEvent: makeEvent({
          effectiveAt: "2026-07-01T00:00:00.000Z",
        }),
      }).success,
    ).toBe(false);
  });

  it("preserves the standalone version boundary inside composed snapshots", () => {
    const oversizedVersion = makeOversizedVersionCandidate();
    expect(RulePackVersionSchema.safeParse(oversizedVersion).success).toBe(false);

    const activationEvent = makeEvent({ versionContentHash: oversizedVersion.contentHash });
    expect(
      ResolvedRulePackSchema.safeParse({
        request: {
          domain: oversizedVersion.domain,
          jurisdiction: oversizedVersion.jurisdiction,
          evaluationDate: TIMES.inside,
        },
        rulePackVersion: oversizedVersion,
        activationEvent,
      }).success,
    ).toBe(false);

    const evaluationInput = makeEvaluationInput(oversizedVersion);
    expect(RulePackEvaluationHashInputSchema.safeParse(evaluationInput).success).toBe(false);
    expect(
      RulePackEvaluationSnapshotSchema.safeParse({
        ...evaluationInput,
        contentHash: sha256CanonicalJson(evaluationInput),
      }).success,
    ).toBe(false);
  }, 30_000);

  it("reserves composite capacity for a complete version and evaluation result", () => {
    expect(RULE_PACK_LIMITS.maxEvaluationJsonNodes).toBeGreaterThan(
      RULE_PACK_LIMITS.maxJsonNodes + EVALUATION_SNAPSHOT_LIMITS.maxJsonNodes,
    );
    expect(RULE_PACK_LIMITS.maxEvaluationCanonicalBytes).toBeGreaterThan(
      RULE_PACK_LIMITS.maxCanonicalBytes + EVALUATION_SNAPSHOT_LIMITS.maxCanonicalBytes,
    );
    expect(RULE_PACK_LIMITS.maxEvaluationJsonDepth).toBeGreaterThan(
      Math.max(RULE_PACK_LIMITS.maxJsonDepth, EVALUATION_SNAPSHOT_LIMITS.maxJsonDepth),
    );
  });

  it("resolves a standalone-valid version at the maximum JSON-node boundary", () => {
    const version = makeMaximumNodeVersion();
    const resolved = ResolvedRulePackSchema.parse({
      request: {
        domain: version.domain,
        jurisdiction: version.jurisdiction,
        evaluationDate: TIMES.inside,
      },
      rulePackVersion: version,
      activationEvent: makeEvent({ versionContentHash: version.contentHash }),
    });

    expect(resolved.rulePackVersion.rules).toHaveLength(RULE_PACK_LIMITS.maxRules);
  }, 30_000);

  it("records an exact one-to-one evaluation snapshot and canonical hash", () => {
    const input = makeEvaluationInput();
    const snapshot = RulePackEvaluationSnapshotSchema.parse({
      ...input,
      contentHash: computeRulePackEvaluationHash(input),
    });
    expect(verifyRulePackEvaluationHash(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.evaluationResult.findings)).toBe(true);
    expect(verifyRulePackEvaluationHash({ ...snapshot, evaluationDate: TIMES.validFrom })).toBe(
      false,
    );
  });

  it("rejects missing, substituted, hash-mismatched, and wrong-date findings", () => {
    const base = makeEvaluationInput();
    const finding = requireItem(base.evaluationResult.findings[0]);
    const variants = [
      { ...base, evaluationResult: { ...base.evaluationResult, findings: [] } },
      {
        ...base,
        evaluationResult: {
          ...base.evaluationResult,
          findings: [{ ...finding, finding: { ...finding.finding, ruleId: IDS.ruleB } }],
        },
      },
      {
        ...base,
        evaluationResult: {
          ...base.evaluationResult,
          findings: [
            { ...finding, finding: { ...finding.finding, ruleContentHash: "d".repeat(64) } },
          ],
        },
      },
      {
        ...base,
        evaluationResult: {
          ...base.evaluationResult,
          findings: [
            { ...finding, finding: { ...finding.finding, evaluationDate: TIMES.validFrom } },
          ],
        },
      },
    ];
    variants.forEach((variant) => {
      expect(
        RulePackEvaluationSnapshotSchema.safeParse({ ...variant, contentHash: "e".repeat(64) })
          .success,
      ).toBe(false);
    });

    const outsideInput: RulePackEvaluationHashInput = {
      ...base,
      evaluationDate: TIMES.validTo,
      evaluationResult: {
        ...base.evaluationResult,
        findings: [
          {
            ...finding,
            finding: { ...finding.finding, evaluationDate: TIMES.validTo },
          },
        ],
      },
    };
    expect(
      RulePackEvaluationSnapshotSchema.safeParse({
        ...outsideInput,
        contentHash: sha256CanonicalJson(outsideInput),
      }).success,
    ).toBe(false);
  });
});
