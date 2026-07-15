import { readFileSync } from "node:fs";

import {
  DslExpressionSchema,
  EvidenceSchema,
  ExpressionTraceSchema,
  FactSchema,
  RuleDefinitionHashInputSchema,
  RuleDefinitionSchema,
  RuleFindingSchema,
  canonicalizeJson,
  computeRuleDefinitionHash,
  sha256CanonicalJson,
} from "@vera/contracts";
import type {
  DslExpression,
  Evidence,
  ExtractionFact,
  FactStatus,
  FactValueType,
  JsonValue,
  RuleDefinition,
  RuleDefinitionHashInput,
  TruthValue,
} from "@vera/contracts";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { evaluateExpression, evaluateRule } from "../../src/dsl-evaluator.js";

const OBSERVED_AT = "2026-07-15T10:00:00.0001Z";
const PROVIDER_RUN_ID = "00000000-0000-4000-8000-000000009001";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000009002";
const DOCUMENT_HASH = "a".repeat(64);
const EVIDENCE_ID = "00000000-0000-4000-8000-000000009003";

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

function makeEvidence(id = EVIDENCE_ID, overrides: Partial<Evidence> = {}): Evidence {
  return EvidenceSchema.parse({
    id,
    documentId: DOCUMENT_ID,
    documentHash: DOCUMENT_HASH,
    page: 1,
    text: "Synthetic evidence",
    language: "en-GB",
    boundingBox: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
    providerRunId: PROVIDER_RUN_ID,
    capturedAt: OBSERVED_AT,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  });
}

function makeResolvedFact(
  key: string,
  valueType: FactValueType,
  normalizedValue: Exclude<JsonValue, null>,
  evidenceIds: readonly string[] = [EVIDENCE_ID],
  id = uuid(1),
): ExtractionFact {
  return FactSchema.parse({
    id,
    key,
    valueType,
    providerRunId: PROVIDER_RUN_ID,
    observedAt: OBSERVED_AT,
    rawConfidence: null,
    validationScope: "TECHNICAL_DEMO",
    status: "RESOLVED",
    originalValue: normalizedValue,
    normalizedValue,
    evidenceIds,
    candidates: [],
  });
}

function makeUnresolvedFact(
  key: string,
  status: Exclude<FactStatus, "RESOLVED" | "CONFLICT">,
  evidenceIds: readonly string[],
  id = uuid(2),
): ExtractionFact {
  return FactSchema.parse({
    id,
    key,
    valueType: "STRING",
    providerRunId: PROVIDER_RUN_ID,
    observedAt: OBSERVED_AT,
    rawConfidence: null,
    validationScope: "TECHNICAL_DEMO",
    status,
    originalValue: null,
    normalizedValue: null,
    evidenceIds,
    candidates: [],
  });
}

interface ManifestFactFixture {
  readonly key: string;
  readonly status: "RESOLVED" | "NULL" | "NOT_FOUND" | "NOT_READABLE" | "CONFLICT";
  readonly valueType: FactValueType;
  readonly normalizedValue: JsonValue;
  readonly evidenceIds: readonly string[];
}

interface ManifestEvidenceFixture {
  readonly id: string;
  readonly documentId: string;
  readonly documentHash: string;
  readonly page: number;
  readonly language: string;
  readonly boundingBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

interface ManifestCaseFixture {
  readonly caseId: string;
  readonly expression: DslExpression;
  readonly facts: readonly ManifestFactFixture[];
  readonly evidence: readonly ManifestEvidenceFixture[];
  readonly expectedTruth: TruthValue;
}

interface ManifestFixture {
  readonly operators: readonly {
    readonly operator: string;
    readonly cases: readonly ManifestCaseFixture[];
  }[];
}

function loadManifest(): ManifestFixture {
  const url = new URL("../../../../examples/synthetic-dsl/operator-manifest.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as ManifestFixture;
}

function hydrateManifestFact(fixture: ManifestFactFixture, index: number): ExtractionFact {
  const base = {
    id: uuid(100 + index),
    key: fixture.key,
    valueType: fixture.valueType,
    providerRunId: PROVIDER_RUN_ID,
    observedAt: OBSERVED_AT,
    rawConfidence: null,
    validationScope: "TECHNICAL_DEMO",
    evidenceIds: fixture.evidenceIds,
    candidates: [],
  } as const;
  return FactSchema.parse(
    fixture.status === "RESOLVED"
      ? {
          ...base,
          status: fixture.status,
          originalValue: fixture.normalizedValue,
          normalizedValue: fixture.normalizedValue,
        }
      : {
          ...base,
          status: fixture.status,
          originalValue: null,
          normalizedValue: null,
        },
  );
}

function hydrateManifestEvidence(fixture: ManifestEvidenceFixture): Evidence {
  return EvidenceSchema.parse({
    ...fixture,
    text: "Synthetic manifest evidence",
    providerRunId: PROVIDER_RUN_ID,
    capturedAt: OBSERVED_AT,
    validationScope: "TECHNICAL_DEMO",
  });
}

function factKeys(expression: DslExpression): readonly string[] {
  const keys = new Set<string>();
  const stack = [expression];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (current.op === "all" || current.op === "any") stack.push(...current.operands);
    else if (current.op === "not") stack.push(current.operand);
    else if (current.op === "same_visual_area") current.factKeys.forEach((key) => keys.add(key));
    else if (current.op !== "truth") keys.add(current.factKey);
  }
  return [...keys];
}

interface RuleOptions {
  readonly appliesWhen?: DslExpression;
  readonly satisfiedWhen?: DslExpression;
  readonly exceptions?: RuleDefinitionHashInput["exceptions"];
  readonly overrides?: RuleDefinitionHashInput["overrides"];
  readonly validity?: RuleDefinitionHashInput["validity"];
  readonly evidenceBindings?: RuleDefinitionHashInput["evidenceBindings"];
}

function makeRule(options: RuleOptions = {}): RuleDefinition {
  const id = uuid(500);
  const appliesWhen = options.appliesWhen ?? { op: "truth", value: "TRUE" };
  const satisfiedWhen = options.satisfiedWhen ?? { op: "truth", value: "TRUE" };
  const exceptions = options.exceptions ?? [];
  const overrides = options.overrides ?? [];
  const expressions = [
    appliesWhen,
    satisfiedWhen,
    ...exceptions.map(({ when }) => when),
    ...overrides.map(({ when }) => when),
  ];
  const referencedKeys = [...new Set(expressions.flatMap((expression) => factKeys(expression)))];
  const evidenceBindings =
    options.evidenceBindings ??
    referencedKeys.map((factKey) => ({
      factKey,
      evidenceRequirementKeys: [`${factKey}.evidence`],
    }));
  const input = RuleDefinitionHashInputSchema.parse({
    dslVersion: "vera.dsl/v1",
    state: "DRAFT",
    id,
    sourceId: uuid(501),
    sourceVersionId: uuid(502),
    sourceContentHash: "b".repeat(64),
    ruleCardId: uuid(503),
    ruleCardRevisionId: uuid(504),
    ruleCardRevisionContentHash: "c".repeat(64),
    normativeKey: "synthetic.kernel.rule",
    deonticCategory: "OBLIGATION",
    riskLevel: "LOW",
    validity: options.validity ?? {
      validFrom: "2026-01-01T00:00:00.0001Z",
      validTo: "2027-01-01T00:00:00.0001Z",
    },
    appliesWhen,
    satisfiedWhen,
    exceptions,
    overrides,
    conflictsWith: [],
    evidenceBindings,
    unknownPolicy: "REVIEW",
    validationScope: "TECHNICAL_DEMO",
  });
  return RuleDefinitionSchema.parse({ ...input, contentHash: computeRuleDefinitionHash(input) });
}

describe("evaluateExpression", () => {
  const manifestCases = loadManifest().operators.flatMap(({ operator, cases }) =>
    cases.map((fixture) => ({ operator, fixture })),
  );

  it.each(manifestCases)(
    "evaluates manifest fixture $fixture.caseId for $operator",
    ({ fixture }) => {
      const facts = fixture.facts.map(hydrateManifestFact);
      const evidence = fixture.evidence.map(hydrateManifestEvidence);
      const trace = evaluateExpression(fixture.expression, facts, evidence, "/manifest");

      expect(trace.truth).toBe(fixture.expectedTruth);
      expect(trace.op).toBe(fixture.expression.op);
      expect(ExpressionTraceSchema.parse(trace)).toEqual(trace);
    },
  );

  it("evaluates every logical child without short-circuiting", () => {
    const allTrace = evaluateExpression(
      {
        op: "all",
        operands: [
          { op: "truth", value: "FALSE" },
          { op: "present", factKey: "missing.fact" },
        ],
      },
      [],
      [],
    );
    const anyTrace = evaluateExpression(
      {
        op: "any",
        operands: [
          { op: "truth", value: "TRUE" },
          { op: "present", factKey: "missing.fact" },
        ],
      },
      [],
      [],
    );

    expect(allTrace.truth).toBe("FALSE");
    expect(allTrace.children.map(({ truth }) => truth)).toEqual(["FALSE", "UNKNOWN"]);
    expect(anyTrace.truth).toBe("TRUE");
    expect(anyTrace.children.map(({ truth }) => truth)).toEqual(["TRUE", "UNKNOWN"]);
    expect(allTrace.children.map(({ path }) => path)).toEqual([
      "/expression/operands/0",
      "/expression/operands/1",
    ]);
  });

  it.each([
    {
      label: "missing fact",
      facts: [] as readonly ExtractionFact[],
      evidence: [] as readonly Evidence[],
      reason: "MISSING_FACT",
    },
    {
      label: "unresolved fact",
      facts: [makeUnresolvedFact("sample.value", "NOT_READABLE", [EVIDENCE_ID])],
      evidence: [makeEvidence()],
      reason: "UNRESOLVED_FACT",
    },
    {
      label: "type mismatch",
      facts: [makeResolvedFact("sample.value", "STRING", "4")],
      evidence: [makeEvidence()],
      reason: "TYPE_MISMATCH",
    },
    {
      label: "missing evidence",
      facts: [makeResolvedFact("sample.value", "NUMBER", 4)],
      evidence: [] as readonly Evidence[],
      reason: "MISSING_EVIDENCE",
    },
  ])("abstains for $label", ({ facts, evidence, reason }) => {
    const trace = evaluateExpression(
      { op: "greater_than", factKey: "sample.value", expectedExclusive: 3 },
      facts,
      evidence,
    );
    expect(trace).toMatchObject({ truth: "UNKNOWN", reason });
  });

  it("returns FALSE for evidenced NOT_FOUND only", () => {
    const expression = { op: "present", factKey: "sample.value" } as const;
    const evidenced = evaluateExpression(
      expression,
      [makeUnresolvedFact("sample.value", "NOT_FOUND", [EVIDENCE_ID])],
      [makeEvidence()],
    );
    const unevidenced = evaluateExpression(
      expression,
      [makeUnresolvedFact("sample.value", "NOT_FOUND", [])],
      [],
    );

    expect(evidenced).toMatchObject({ truth: "FALSE", reason: "EVALUATED" });
    expect(unevidenced).toMatchObject({ truth: "UNKNOWN", reason: "MISSING_EVIDENCE" });
  });

  it.each(["present", "comparison"] as const)(
    "abstains from %s when only part of a fact evidence set is available",
    (caseName) => {
      const missingEvidenceId = uuid(10);
      const fact = makeResolvedFact(
        "sample.value",
        caseName === "present" ? "STRING" : "NUMBER",
        caseName === "present" ? "value" : 4,
        [EVIDENCE_ID, missingEvidenceId],
      );
      const expression: DslExpression =
        caseName === "present"
          ? { op: "present", factKey: "sample.value" }
          : { op: "greater_than", factKey: "sample.value", expectedExclusive: 3 };

      const trace = evaluateExpression(expression, [fact], [makeEvidence()]);

      expect(trace).toMatchObject({
        truth: "UNKNOWN",
        reason: "MISSING_EVIDENCE",
        evidenceIds: [],
      });
    },
  );

  it("abstains on partially linked unresolved evidence without exposing an observed value", () => {
    const fact = makeUnresolvedFact("sample.value", "NOT_READABLE", [EVIDENCE_ID, uuid(11)]);
    const presentTrace = evaluateExpression(
      { op: "present", factKey: "sample.value" },
      [fact],
      [makeEvidence()],
    );
    const comparisonTrace = evaluateExpression(
      {
        op: "contains",
        factKey: "sample.value",
        expected: "value",
        comparison: {
          normalization: "NFC",
          whitespace: "PRESERVE",
          caseSensitivity: "SENSITIVE",
        },
      },
      [fact],
      [makeEvidence()],
    );

    for (const trace of [presentTrace, comparisonTrace]) {
      expect(trace).toMatchObject({
        truth: "UNKNOWN",
        reason: "MISSING_EVIDENCE",
        observed: null,
        evidenceIds: [],
      });
    }
  });

  it("treats evidence from a different provider run as missing", () => {
    const mismatchedEvidence = makeEvidence(EVIDENCE_ID, { providerRunId: uuid(12) });
    const fact = makeResolvedFact("sample.value", "NUMBER", 4);
    const comparisonTrace = evaluateExpression(
      { op: "greater_than", factKey: "sample.value", expectedExclusive: 3 },
      [fact],
      [mismatchedEvidence],
    );
    const presentTrace = evaluateExpression(
      { op: "present", factKey: "sample.value" },
      [fact],
      [mismatchedEvidence],
    );

    for (const trace of [comparisonTrace, presentTrace]) {
      expect(trace).toMatchObject({
        truth: "UNKNOWN",
        reason: "MISSING_EVIDENCE",
        evidenceIds: [],
      });
    }
  });

  it("projects repeated large trace values to bounded canonical hashes", () => {
    const largeValue = "x".repeat(100_000);
    const repeatedExpression: DslExpression = {
      op: "all",
      operands: Array.from({ length: 2 }, () => ({
        op: "all",
        operands: Array.from({ length: 64 }, () => ({
          op: "contains",
          factKey: "sample.large",
          expected: "x",
          comparison: {
            normalization: "NFC",
            whitespace: "PRESERVE",
            caseSensitivity: "SENSITIVE",
          },
        })),
      })),
    };
    const fact = makeResolvedFact("sample.large", "STRING", largeValue);
    const first = evaluateExpression(repeatedExpression, [fact], [makeEvidence()]);
    const replay = evaluateExpression(repeatedExpression, [fact], [makeEvidence()]);
    const leaves = first.children.flatMap(({ children }) => children);
    const canonical = canonicalizeJson(largeValue);
    const projection = {
      projection: "CANONICAL_JSON_SHA256_V1",
      sha256: sha256CanonicalJson(largeValue),
      canonicalBytes: new TextEncoder().encode(canonical).byteLength,
      canonicalCodeUnits: canonical.length,
    };

    expect(first.truth).toBe("TRUE");
    expect(leaves).toHaveLength(128);
    expect(
      leaves.every(({ observed }) => canonicalizeJson(observed) === canonicalizeJson(projection)),
    ).toBe(true);
    expect(leaves.every(({ expected }) => expected === "x")).toBe(true);
    expect(first).toEqual(replay);
    expect(ExpressionTraceSchema.parse(first)).toEqual(first);

    const longExpected = "x".repeat(20_000);
    const equalityTrace = evaluateExpression(
      {
        op: "eq",
        factKey: "sample.expected",
        expected: {
          type: "STRING",
          value: longExpected,
          comparison: {
            normalization: "NFC",
            whitespace: "PRESERVE",
            caseSensitivity: "SENSITIVE",
          },
        },
      },
      [makeResolvedFact("sample.expected", "STRING", longExpected)],
      [makeEvidence()],
    );
    expect(equalityTrace.expected).toMatchObject({
      projection: "CANONICAL_JSON_SHA256_V1",
      sha256: sha256CanonicalJson(longExpected),
    });
    expect(equalityTrace.observed).toEqual(equalityTrace.expected);
  });

  it.each([
    {
      expression: {
        op: "eq",
        factKey: "sample.number",
        expected: { type: "NUMBER", value: 42 },
      } satisfies DslExpression,
      fact: makeResolvedFact("sample.number", "NUMBER", 42),
    },
    {
      expression: {
        op: "eq",
        factKey: "sample.date",
        expected: { type: "DATE", value: "2026-07-15" },
      } satisfies DslExpression,
      fact: makeResolvedFact("sample.date", "DATE", "2026-07-15"),
    },
  ])("evaluates comparable NUMBER and DATE values", ({ expression, fact }) => {
    expect(evaluateExpression(expression, [fact], [makeEvidence()]).truth).toBe("TRUE");
  });

  it("uses RE2 modes and flags and abstains before an oversized input is matched", () => {
    const evidence = [makeEvidence()];
    const fact = makeResolvedFact("sample.code", "STRING", "prefix\nSYN-42");
    const searchTrace = evaluateExpression(
      {
        op: "matches",
        factKey: "sample.code",
        pattern: "^syn-[0-9]+$",
        mode: "SEARCH",
        normalization: "NFC",
        whitespace: "PRESERVE",
        caseSensitivity: "INSENSITIVE",
        dotAll: false,
        multiline: true,
        maxInputCharacters: 100,
      },
      [fact],
      evidence,
    );
    const limitedTrace = evaluateExpression(
      {
        op: "matches",
        factKey: "sample.code",
        pattern: ".+",
        mode: "FULL",
        normalization: "NFC",
        whitespace: "PRESERVE",
        caseSensitivity: "SENSITIVE",
        dotAll: true,
        multiline: false,
        maxInputCharacters: 5,
      },
      [fact],
      evidence,
    );
    const dotAllTrace = evaluateExpression(
      {
        op: "matches",
        factKey: "sample.code",
        pattern: "prefix.*SYN-[0-9]+",
        mode: "FULL",
        normalization: "NFC",
        whitespace: "PRESERVE",
        caseSensitivity: "SENSITIVE",
        dotAll: true,
        multiline: false,
        maxInputCharacters: 100,
      },
      [fact],
      evidence,
    );

    expect(searchTrace.truth).toBe("TRUE");
    expect(limitedTrace).toMatchObject({ truth: "UNKNOWN", reason: "RESOURCE_LIMIT" });
    expect(dotAllTrace.truth).toBe("TRUE");
  });

  it("matches languages case-insensitively in EXACT mode", () => {
    const trace = evaluateExpression(
      {
        op: "language_present",
        factKey: "sample.name",
        language: "EN-gb",
        matchMode: "EXACT",
      },
      [makeResolvedFact("sample.name", "STRING", "Synthetic")],
      [makeEvidence(EVIDENCE_ID, { language: "en-GB" })],
    );
    expect(trace).toMatchObject({ truth: "TRUE", evidenceIds: [EVIDENCE_ID] });
  });

  it("requires visual evidence to share ingest identity, content and page", () => {
    const secondEvidenceId = uuid(20);
    const expression: DslExpression = {
      op: "same_visual_area",
      factKeys: ["sample.left", "sample.right"],
      maxNormalizedGap: 0.02,
      quantifier: "ALL_FACTS",
      requireSameDocument: true,
      requireSamePage: true,
    };
    const facts = [
      makeResolvedFact("sample.left", "STRING", "left", [EVIDENCE_ID], uuid(21)),
      makeResolvedFact("sample.right", "STRING", "right", [secondEvidenceId], uuid(22)),
    ];
    const baseEvidence = makeEvidence(EVIDENCE_ID);
    const differentIngest = makeEvidence(secondEvidenceId, {
      documentId: uuid(23),
      boundingBox: { x: 0.21, y: 0.1, width: 0.1, height: 0.1 },
    });

    expect(evaluateExpression(expression, facts, [baseEvidence, differentIngest]).truth).toBe(
      "FALSE",
    );
    expect(
      evaluateExpression(expression, facts, [
        baseEvidence,
        makeEvidence(secondEvidenceId, {
          documentHash: "d".repeat(64),
          boundingBox: { x: 0.21, y: 0.1, width: 0.1, height: 0.1 },
        }),
      ]).truth,
    ).toBe("FALSE");
    expect(
      evaluateExpression(expression, facts, [
        baseEvidence,
        makeEvidence(secondEvidenceId, {
          page: 2,
          boundingBox: { x: 0.21, y: 0.1, width: 0.1, height: 0.1 },
        }),
      ]).truth,
    ).toBe("FALSE");
  });

  it("finds a mutually compatible region for every visual fact deterministically", () => {
    const farId = uuid(30);
    const firstId = uuid(31);
    const secondId = uuid(32);
    const thirdId = uuid(33);
    const evidence = [
      makeEvidence(farId, {
        boundingBox: { x: 0.8, y: 0.8, width: 0.05, height: 0.05 },
      }),
      makeEvidence(firstId, {
        boundingBox: { x: 0.1, y: 0.1, width: 0.05, height: 0.05 },
      }),
      makeEvidence(secondId, {
        boundingBox: { x: 0.15, y: 0.1, width: 0.05, height: 0.05 },
      }),
      makeEvidence(thirdId, {
        boundingBox: { x: 0.2, y: 0.1, width: 0.05, height: 0.05 },
      }),
    ];
    const facts = [
      makeResolvedFact("sample.one", "STRING", "one", [farId, firstId], uuid(34)),
      makeResolvedFact("sample.two", "STRING", "two", [secondId], uuid(35)),
      makeResolvedFact("sample.three", "STRING", "three", [thirdId], uuid(36)),
    ];
    const expression: DslExpression = {
      op: "same_visual_area",
      factKeys: ["sample.one", "sample.two", "sample.three"],
      maxNormalizedGap: 0.04,
      quantifier: "ALL_FACTS",
      requireSameDocument: true,
      requireSamePage: true,
    };

    const forward = evaluateExpression(expression, facts, evidence);
    const reversed = evaluateExpression(expression, [...facts].reverse(), [...evidence].reverse());
    expect(forward).toEqual(reversed);
    expect(forward).toMatchObject({
      truth: "TRUE",
      evidenceIds: [firstId, secondId, thirdId],
    });
  });

  it("abstains deterministically when visual clique search exceeds its budget", () => {
    const firstIds = Array.from({ length: 70 }, (_, index) => uuid(1_000 + index));
    const secondIds = Array.from({ length: 70 }, (_, index) => uuid(2_000 + index));
    const evidence = [
      ...firstIds.map((id) =>
        makeEvidence(id, { boundingBox: { x: 0.01, y: 0.01, width: 0.01, height: 0.01 } }),
      ),
      ...secondIds.map((id) =>
        makeEvidence(id, { boundingBox: { x: 0.9, y: 0.9, width: 0.01, height: 0.01 } }),
      ),
    ];
    const trace = evaluateExpression(
      {
        op: "same_visual_area",
        factKeys: ["sample.first", "sample.second"],
        maxNormalizedGap: 0,
        quantifier: "ALL_FACTS",
        requireSameDocument: true,
        requireSamePage: true,
      },
      [
        makeResolvedFact("sample.first", "STRING", "first", firstIds, uuid(3_000)),
        makeResolvedFact("sample.second", "STRING", "second", secondIds, uuid(3_001)),
      ],
      evidence,
    );

    expect(trace).toMatchObject({
      truth: "UNKNOWN",
      reason: "RESOURCE_LIMIT",
      observed: { candidateCounts: [70, 70], comparisons: 4_096 },
    });
  });

  it("rejects malformed boundary values and ambiguous collections", () => {
    const fact = makeResolvedFact("sample.value", "STRING", "value");
    const duplicateKey = makeResolvedFact(
      "sample.value",
      "STRING",
      "other",
      [EVIDENCE_ID],
      uuid(40),
    );
    const duplicateId = makeResolvedFact("sample.other", "STRING", "other", [EVIDENCE_ID], fact.id);

    expect(() =>
      evaluateExpression({ op: "present" } as unknown as DslExpression, [], []),
    ).toThrow();
    expect(() =>
      evaluateExpression(
        { op: "present", factKey: "sample.value" },
        [fact, duplicateKey],
        [makeEvidence()],
      ),
    ).toThrow(/duplicate key/u);
    expect(() =>
      evaluateExpression(
        { op: "present", factKey: "sample.value" },
        [fact, duplicateId],
        [makeEvidence()],
      ),
    ).toThrow(/duplicate ID/u);
    expect(() =>
      evaluateExpression(
        { op: "present", factKey: "sample.value" },
        [fact],
        [makeEvidence(), makeEvidence()],
      ),
    ).toThrow(/duplicate ID/u);
    expect(() =>
      evaluateExpression(
        { op: "present", factKey: "sample.value" },
        [fact],
        [{ ...makeEvidence(), page: 0 }],
      ),
    ).toThrow();
    expect(() => evaluateExpression({ op: "truth", value: "TRUE" }, [], [], "/bad//path")).toThrow(
      /non-empty/u,
    );
    expect(() => evaluateExpression({ op: "truth", value: "TRUE" }, [], [], "/bad/~2path")).toThrow(
      /invalid RFC 6901/u,
    );
    expect(() => evaluateExpression({ op: "truth", value: "TRUE" }, [], [], "")).toThrow(
      /RFC 6901/u,
    );
    expect(() =>
      evaluateExpression({ op: "truth", value: "TRUE" }, [], [], "not-a-pointer"),
    ).toThrow(/RFC 6901/u);
    expect(() =>
      evaluateExpression({ op: "truth", value: "TRUE" }, [], [], `/${"a".repeat(4_096)}`),
    ).toThrow(/RFC 6901/u);
    expect(evaluateExpression({ op: "truth", value: "TRUE" }, [], [], "/valid/~0~1").truth).toBe(
      "TRUE",
    );
    expect(() =>
      evaluateExpression({ op: "truth", value: "TRUE" }, {} as unknown as ExtractionFact[], []),
    ).toThrow(/array/u);
    expect(() =>
      evaluateExpression(
        { op: "truth", value: "TRUE" },
        Array.from({ length: 10_001 }, () => null) as unknown as ExtractionFact[],
        [],
      ),
    ).toThrow(/cannot exceed/u);
  });

  it("does not mutate caller-owned expression, facts or evidence", () => {
    const expression = { op: "present", factKey: "sample.value" } as const;
    const facts = [makeResolvedFact("sample.value", "STRING", "value")];
    const evidence = [makeEvidence()];
    const before = structuredClone({ expression, facts, evidence });

    evaluateExpression(expression, facts, evidence);

    expect({ expression, facts, evidence }).toEqual(before);
  });

  it("rejects accessors and root or nested Proxies without invoking user code", () => {
    const fact = makeResolvedFact("sample.value", "STRING", "value");
    let accessorCalls = 0;
    const accessorFacts: ExtractionFact[] = [];
    Object.defineProperty(accessorFacts, 0, {
      configurable: true,
      enumerable: true,
      get() {
        accessorCalls += 1;
        return fact;
      },
    });

    expect(() =>
      evaluateExpression({ op: "present", factKey: "sample.value" }, accessorFacts, [
        makeEvidence(),
      ]),
    ).toThrow();
    expect(accessorCalls).toBe(0);

    const trapCalls = { get: 0, ownKeys: 0, descriptor: 0, prototype: 0 };
    const target = [fact];
    const proxy = new Proxy(target, {
      get() {
        trapCalls.get += 1;
        return undefined;
      },
      ownKeys() {
        trapCalls.ownKeys += 1;
        return [];
      },
      getOwnPropertyDescriptor() {
        trapCalls.descriptor += 1;
        return undefined;
      },
      getPrototypeOf() {
        trapCalls.prototype += 1;
        return null;
      },
    });
    expect(() =>
      evaluateExpression({ op: "present", factKey: "sample.value" }, proxy, [makeEvidence()]),
    ).toThrow(/Proxy/u);

    const nestedTarget = { x: 0.1, y: 0.1, width: 0.1, height: 0.1 };
    const nestedProxy = new Proxy(nestedTarget, {
      get() {
        trapCalls.get += 1;
        return undefined;
      },
      ownKeys() {
        trapCalls.ownKeys += 1;
        return [];
      },
      getOwnPropertyDescriptor() {
        trapCalls.descriptor += 1;
        return undefined;
      },
      getPrototypeOf() {
        trapCalls.prototype += 1;
        return null;
      },
    });
    const nestedEvidence = {
      ...makeEvidence(),
      boundingBox: nestedProxy,
    } as Evidence;
    expect(() =>
      evaluateExpression({ op: "present", factKey: "sample.value" }, [fact], [nestedEvidence]),
    ).toThrow(/Proxy/u);

    const proxyPrototype = new Proxy(
      {},
      {
        get() {
          trapCalls.get += 1;
          return undefined;
        },
        ownKeys() {
          trapCalls.ownKeys += 1;
          return [];
        },
        getOwnPropertyDescriptor() {
          trapCalls.descriptor += 1;
          return undefined;
        },
        getPrototypeOf() {
          trapCalls.prototype += 1;
          return null;
        },
      },
    );
    const expressionWithProxyPrototype = Object.assign(Object.create(proxyPrototype) as object, {
      op: "truth",
      value: "TRUE",
    }) as DslExpression;
    expect(() => evaluateExpression(expressionWithProxyPrototype, [], [])).toThrow(
      /Proxy prototypes/u,
    );

    expect(trapCalls).toEqual({ get: 0, ownKeys: 0, descriptor: 0, prototype: 0 });
    expect(target[0]?.key).toBe("sample.value");
  });

  it("bounds the descriptor-only Proxy preflight by unique nodes and depth", () => {
    const cyclic = { op: "not" } as Record<string, unknown>;
    cyclic["operand"] = cyclic;
    expect(() => evaluateExpression(cyclic as DslExpression, [], [])).toThrow();

    const oversized = {
      op: "truth",
      value: "TRUE",
      extra: Array.from({ length: 50_000 }, () => ({})),
    };
    expect(() => evaluateExpression(oversized as DslExpression, [], [])).toThrow(
      /Proxy preflight node limit/u,
    );

    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth < 65; depth += 1) nested = { nested };
    const tooDeep = { op: "truth", value: "TRUE", extra: nested };
    expect(() => evaluateExpression(tooDeep as DslExpression, [], [])).toThrow(
      /Proxy preflight depth limit/u,
    );
  });
});

describe("evaluateExpression properties", () => {
  const truthValueArbitrary = fc.constantFrom<TruthValue>("TRUE", "FALSE", "UNKNOWN");
  const truthValuesArbitrary = fc.array(truthValueArbitrary, { minLength: 1, maxLength: 64 });

  it("implements Kleene all, any and not for every non-empty truth vector", () => {
    fc.assert(
      fc.property(truthValuesArbitrary, (values) => {
        const operands: DslExpression[] = values.map((value) => ({ op: "truth", value }));
        const all = evaluateExpression({ op: "all", operands }, [], []);
        const any = evaluateExpression({ op: "any", operands }, [], []);
        const expectedAll = values.includes("FALSE")
          ? "FALSE"
          : values.includes("UNKNOWN")
            ? "UNKNOWN"
            : "TRUE";
        const expectedAny = values.includes("TRUE")
          ? "TRUE"
          : values.includes("UNKNOWN")
            ? "UNKNOWN"
            : "FALSE";

        expect(all.truth).toBe(expectedAll);
        expect(any.truth).toBe(expectedAny);
        values.forEach((value) => {
          const negated = evaluateExpression(
            { op: "not", operand: { op: "truth", value } },
            [],
            [],
          );
          expect(negated.truth).toBe(
            value === "TRUE" ? "FALSE" : value === "FALSE" ? "TRUE" : "UNKNOWN",
          );
        });
      }),
    );
  });

  it("is deterministic under canonical JSON replay and never mutates generated ASTs", () => {
    fc.assert(
      fc.property(truthValuesArbitrary, (values) => {
        const expression: DslExpression = {
          op: "any",
          operands: values.map((value) => ({
            op: "not",
            operand: { op: "truth", value },
          })),
        };
        const before = structuredClone(expression);
        const replay = JSON.parse(JSON.stringify(expression)) as DslExpression;

        const first = evaluateExpression(expression, [], []);
        const second = evaluateExpression(replay, [], []);

        expect(first).toEqual(second);
        expect(expression).toEqual(before);
      }),
    );
  });
});

describe("evaluateRule", () => {
  it.each([
    { applies: "FALSE", satisfied: "TRUE", expected: "NOT_APPLICABLE" },
    { applies: "UNKNOWN", satisfied: "TRUE", expected: "REVIEW" },
    { applies: "TRUE", satisfied: "TRUE", expected: "PASS" },
    { applies: "TRUE", satisfied: "FALSE", expected: "FAIL" },
    { applies: "TRUE", satisfied: "UNKNOWN", expected: "REVIEW" },
  ] as const)(
    "derives $expected from applies=$applies and satisfied=$satisfied",
    ({ applies, satisfied, expected }) => {
      const finding = evaluateRule(
        makeRule({
          appliesWhen: { op: "truth", value: applies },
          satisfiedWhen: { op: "truth", value: satisfied },
        }),
        [],
        [],
        "2026-07-15T10:00:00.0001Z",
      );

      expect(finding.outcome).toBe(expected);
      expect(finding.satisfiedWhen === null).toBe(applies !== "TRUE");
      expect(RuleFindingSchema.parse(finding)).toEqual(finding);
    },
  );

  it.each([
    { exception: "TRUE", expected: "NOT_APPLICABLE" },
    { exception: "UNKNOWN", expected: "REVIEW" },
  ] as const)(
    "skips satisfaction and overrides for an $exception exception",
    ({ exception, expected }) => {
      const ruleId = uuid(500);
      const finding = evaluateRule(
        makeRule({
          exceptions: [
            {
              id: uuid(510),
              key: "synthetic.exception",
              when: { op: "truth", value: exception },
              reason: "Synthetic exception",
              sourceVersionId: uuid(502),
              sourceReference: "section.synthetic.exception",
            },
          ],
          overrides: [
            {
              id: uuid(511),
              overridingRuleId: ruleId,
              overriddenRuleId: uuid(512),
              when: { op: "truth", value: "TRUE" },
              reason: "Synthetic precedence",
              sourceVersionId: uuid(502),
              sourceReference: "section.synthetic.override",
            },
          ],
        }),
        [],
        [],
        "2026-07-15T10:00:00.0001Z",
      );

      expect(finding).toMatchObject({
        outcome: expected,
        satisfiedWhen: null,
        overrideTraces: [],
      });
      expect(finding.exceptionTraces).toHaveLength(1);
    },
  );

  it("evaluates every exception before combining them with Kleene any", () => {
    const finding = evaluateRule(
      makeRule({
        exceptions: [
          {
            id: uuid(520),
            key: "synthetic.unknown",
            when: { op: "truth", value: "UNKNOWN" },
            reason: "Unknown synthetic exception",
            sourceVersionId: uuid(502),
            sourceReference: "section.synthetic.unknown",
          },
          {
            id: uuid(521),
            key: "synthetic.active",
            when: { op: "truth", value: "TRUE" },
            reason: "Active synthetic exception",
            sourceVersionId: uuid(502),
            sourceReference: "section.synthetic.active",
          },
        ],
      }),
      [],
      [],
      "2026-07-15T10:00:00.0001Z",
    );

    expect(finding.outcome).toBe("NOT_APPLICABLE");
    expect(finding.exceptionTraces.map(({ truth }) => truth)).toEqual(["UNKNOWN", "TRUE"]);
    expect(finding.satisfiedWhen).toBeNull();
  });

  it("evaluates conditional overrides for an operative rule without changing its base outcome", () => {
    const ruleId = uuid(500);
    const finding = evaluateRule(
      makeRule({
        overrides: [
          {
            id: uuid(530),
            overridingRuleId: ruleId,
            overriddenRuleId: uuid(531),
            when: { op: "truth", value: "TRUE" },
            reason: "Synthetic precedence",
            sourceVersionId: uuid(502),
            sourceReference: "section.synthetic.override",
          },
        ],
      }),
      [],
      [],
      "2026-07-15T10:00:00.0001Z",
    );

    expect(finding.outcome).toBe("PASS");
    expect(finding.overrideTraces).toMatchObject([
      {
        overrideId: uuid(530),
        overriddenRuleId: uuid(531),
        trace: { path: "/overrides/0/when", truth: "TRUE" },
      },
    ]);
  });

  it("propagates the exact deterministic evidence union from all evaluated traces", () => {
    const evidenceIds = [uuid(540), uuid(541), uuid(542)];
    const ruleId = uuid(500);
    const rule = makeRule({
      appliesWhen: { op: "present", factKey: "sample.applies" },
      satisfiedWhen: { op: "present", factKey: "sample.satisfied" },
      exceptions: [
        {
          id: uuid(543),
          key: "synthetic.inactive",
          when: { op: "truth", value: "FALSE" },
          reason: "Inactive synthetic exception",
          sourceVersionId: uuid(502),
          sourceReference: "section.synthetic.inactive",
        },
      ],
      overrides: [
        {
          id: uuid(544),
          overridingRuleId: ruleId,
          overriddenRuleId: uuid(545),
          when: { op: "present", factKey: "sample.override" },
          reason: "Synthetic precedence",
          sourceVersionId: uuid(502),
          sourceReference: "section.synthetic.override",
        },
      ],
    });
    const facts = [
      makeResolvedFact("sample.applies", "BOOLEAN", true, [evidenceIds[0] as string], uuid(546)),
      makeResolvedFact("sample.satisfied", "BOOLEAN", true, [evidenceIds[1] as string], uuid(547)),
      makeResolvedFact("sample.override", "BOOLEAN", true, [evidenceIds[2] as string], uuid(548)),
    ];
    const evidence = evidenceIds.map((id) => makeEvidence(id));

    const finding = evaluateRule(
      rule,
      [...facts].reverse(),
      [...evidence].reverse(),
      "2026-07-15T10:00:00.0001Z",
    );

    expect(finding.evidenceIds).toEqual(evidenceIds);
    expect(finding.appliesWhen.path).toBe("/appliesWhen");
    expect(finding.exceptionTraces[0]?.path).toBe("/exceptions/0/when");
    expect(finding.satisfiedWhen?.path).toBe("/satisfiedWhen");
    expect(finding.overrideTraces[0]?.trace.path).toBe("/overrides/0/when");
  });

  it("accepts validFrom exactly and rejects instants outside the half-open validity interval", () => {
    const rule = makeRule({
      validity: {
        validFrom: "2026-01-01T00:00:00.0001Z",
        validTo: "2026-01-01T00:00:00.0003Z",
      },
    });

    expect(evaluateRule(rule, [], [], "2026-01-01T00:00:00.0001Z").outcome).toBe("PASS");
    expect(evaluateRule(rule, [], [], "2026-01-01T00:00:00.0002Z").outcome).toBe("PASS");
    expect(() => evaluateRule(rule, [], [], "2026-01-01T00:00:00.00009Z")).toThrow(RangeError);
    expect(() => evaluateRule(rule, [], [], "2026-01-01T00:00:00.0003Z")).toThrow(RangeError);
  });

  it("validates the rule hash and evaluation date at the boundary", () => {
    const rule = makeRule();
    expect(() =>
      evaluateRule({ ...rule, contentHash: "0".repeat(64) }, [], [], OBSERVED_AT),
    ).toThrow();
    expect(() => evaluateRule(rule, [], [], "2026-07-15T10:00:00+02:00")).toThrow();
  });

  it("is deterministic and does not mutate the validated rule snapshot", () => {
    const rule = makeRule();
    const before = structuredClone(rule);
    const first = evaluateRule(rule, [], [], OBSERVED_AT);
    const second = evaluateRule(rule, [], [], OBSERVED_AT);

    expect(first).toEqual(second);
    expect(rule).toEqual(before);
  });
});

describe("contract assumptions", () => {
  it("keeps test expressions on the public DSL boundary", () => {
    expect(DslExpressionSchema.parse({ op: "truth", value: "TRUE" })).toEqual({
      op: "truth",
      value: "TRUE",
    });
  });
});
