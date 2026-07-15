import { RE2JS } from "re2js";
import { describe, expect, it } from "vitest";

import {
  DSL_LIMITS,
  DSL_VERSION,
  DslExpressionSchema,
  RuleDefinitionBindingSchema,
  RuleDefinitionHashInputSchema,
  RuleDefinitionSchema,
  computeRuleCardRevisionHash,
  computeRuleDefinitionHash,
  sha256CanonicalJson,
  verifyRuleDefinitionHash,
  type DslExpression,
  type RuleDefinitionHashInput,
  type RuleCardRevisionHashInput,
} from "../../src/index.js";

const RULE_ID = "00000000-0000-4000-8000-000000000501";
const OVERRIDDEN_RULE_ID = "00000000-0000-4000-8000-000000000502";
const CONFLICTING_RULE_ID = "00000000-0000-4000-8000-000000000503";
const SOURCE_ID = "00000000-0000-4000-8000-000000000504";
const SOURCE_VERSION_ID = "00000000-0000-4000-8000-000000000505";
const CARD_ID = "00000000-0000-4000-8000-000000000506";
const CARD_REVISION_ID = "00000000-0000-4000-8000-000000000507";
const EXCEPTION_ID = "00000000-0000-4000-8000-000000000508";
const OVERRIDE_ID = "00000000-0000-4000-8000-000000000509";

const TEXT_COMPARISON = {
  normalization: "NFC",
  whitespace: "PRESERVE",
  caseSensitivity: "SENSITIVE",
} as const;

const TRUTH = { op: "truth", value: "TRUE" } as const;
const PRESENT = { op: "present", factKey: "subject.name" } as const;

function uuidFromInteger(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function requireItem<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected synthetic fixture item");
  return value;
}

function makeHashInput(overrides: Partial<RuleDefinitionHashInput> = {}): RuleDefinitionHashInput {
  return {
    dslVersion: DSL_VERSION,
    state: "DRAFT",
    id: RULE_ID,
    sourceId: SOURCE_ID,
    sourceVersionId: SOURCE_VERSION_ID,
    sourceContentHash: "a".repeat(64),
    ruleCardId: CARD_ID,
    ruleCardRevisionId: CARD_REVISION_ID,
    ruleCardRevisionContentHash: "b".repeat(64),
    normativeKey: "synthetic.subject.name",
    deonticCategory: "OBLIGATION",
    riskLevel: "LOW",
    validity: {
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2027-01-01T00:00:00.000Z",
    },
    appliesWhen: TRUTH,
    satisfiedWhen: PRESENT,
    exceptions: [
      {
        id: EXCEPTION_ID,
        key: "synthetic.exception",
        when: { op: "present", factKey: "subject.exception" },
        reason: "Synthetic exception",
        sourceVersionId: SOURCE_VERSION_ID,
        sourceReference: "section-exception",
      },
    ],
    overrides: [
      {
        id: OVERRIDE_ID,
        overridingRuleId: RULE_ID,
        overriddenRuleId: OVERRIDDEN_RULE_ID,
        when: { op: "truth", value: "FALSE" },
        reason: "Synthetic explicit precedence",
        sourceVersionId: SOURCE_VERSION_ID,
        sourceReference: "section-override",
      },
    ],
    conflictsWith: [CONFLICTING_RULE_ID],
    evidenceBindings: [
      { factKey: "subject.name", evidenceRequirementKeys: ["subject.name.evidence"] },
      {
        factKey: "subject.exception",
        evidenceRequirementKeys: ["subject.exception.evidence"],
      },
    ],
    unknownPolicy: "REVIEW",
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

function makeRule(overrides: Partial<RuleDefinitionHashInput> = {}): Record<string, unknown> {
  const input = makeHashInput(overrides);
  return { ...input, contentHash: computeRuleDefinitionHash(input) };
}

function makeRuleCardRevision(): RuleCardRevisionHashInput & { contentHash: string } {
  const input: RuleCardRevisionHashInput = {
    id: CARD_REVISION_ID,
    cardId: CARD_ID,
    revision: 1,
    sourceId: SOURCE_ID,
    sourceVersionId: SOURCE_VERSION_ID,
    sourceContentHash: "a".repeat(64),
    sourceSection: "section-main",
    normativeActor: "Synthetic actor",
    object: "Synthetic subject name",
    scope: "Technical demo",
    normativeKey: "synthetic.subject.name",
    deonticCategory: "OBLIGATION",
    exceptions: [
      {
        id: EXCEPTION_ID,
        key: "synthetic.exception",
        description: "Synthetic exception",
        rationale: "Synthetic rationale",
        sourceReference: "section-exception",
      },
    ],
    evidenceRequirements: [
      {
        id: uuidFromInteger(520),
        key: "subject.name.evidence",
        description: "Name evidence",
        rationale: "Required for the synthetic fact",
        sourceReference: "section-name",
      },
      {
        id: uuidFromInteger(521),
        key: "subject.exception.evidence",
        description: "Exception evidence",
        rationale: "Required for the synthetic exception",
        sourceReference: "section-exception",
      },
    ],
    riskLevel: "LOW",
    riskRationale: "Synthetic low risk",
    falsePositiveCost: "LOW",
    falsePositiveCostRationale: "Synthetic low cost",
    falseNegativeCost: "LOW",
    falseNegativeCostRationale: "Synthetic low cost",
    provenance: "MANUAL",
    provider: null,
    validity: {
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2027-01-01T00:00:00.000Z",
    },
    createdAt: "2025-12-01T00:00:00.000Z",
    createdBy: uuidFromInteger(522),
    replacesRevisionId: null,
    revisionReason: null,
  };
  return { ...input, contentHash: computeRuleCardRevisionHash(input) };
}

describe("declarative DSL expressions", () => {
  const expressions: readonly DslExpression[] = [
    TRUTH,
    PRESENT,
    {
      op: "eq",
      factKey: "subject.label",
      expected: { type: "STRING", value: "Synthetic", comparison: TEXT_COMPARISON },
    },
    {
      op: "not_eq",
      factKey: "subject.count",
      expected: { type: "NUMBER", value: 4 },
    },
    {
      op: "contains",
      factKey: "subject.text",
      expected: "neutral fragment",
      comparison: TEXT_COMPARISON,
    },
    {
      op: "contains_any",
      factKey: "subject.text",
      expected: ["alpha", "beta"],
      comparison: TEXT_COMPARISON,
    },
    {
      op: "matches",
      factKey: "subject.code",
      pattern: "^(?:SYN|DEMO)-[0-9]+$",
      mode: "FULL",
      normalization: "NFC",
      whitespace: "PRESERVE",
      caseSensitivity: "INSENSITIVE",
      dotAll: false,
      multiline: false,
      maxInputCharacters: 200,
    },
    { op: "greater_than", factKey: "subject.score", expectedExclusive: 4.5 },
    { op: "less_than", factKey: "subject.score", expectedExclusive: 9 },
    {
      op: "between",
      factKey: "subject.score",
      minimum: 1,
      maximum: 10,
      includeMinimum: true,
      includeMaximum: false,
    },
    { op: "date_before", factKey: "subject.date", expectedExclusive: "2027-01-01" },
    { op: "date_after", factKey: "subject.date", expectedExclusive: "2025-01-01" },
    {
      op: "date_between",
      factKey: "subject.date",
      minimum: "2026-01-01",
      maximum: "2027-01-01",
      includeMinimum: true,
      includeMaximum: false,
    },
    { op: "all", operands: [TRUTH, PRESENT] },
    { op: "any", operands: [TRUTH, PRESENT] },
    { op: "not", operand: PRESENT },
    {
      op: "language_present",
      factKey: "subject.name",
      language: "en-GB",
      matchMode: "PRIMARY",
    },
    {
      op: "same_visual_area",
      factKeys: ["subject.name", "subject.code"],
      maxNormalizedGap: 0.05,
      quantifier: "ALL_FACTS",
      requireSameDocument: true,
      requireSamePage: true,
    },
  ];

  it.each(expressions)("accepts the closed $op representation", (expression) => {
    expect(DslExpressionSchema.parse(JSON.parse(JSON.stringify(expression)))).toEqual(expression);
  });

  it("rejects unknown operators, fields and empty logical combinations", () => {
    expect(DslExpressionSchema.safeParse({ op: "execute", code: "return true" }).success).toBe(
      false,
    );
    expect(DslExpressionSchema.safeParse({ ...TRUTH, sql: "SELECT 1" }).success).toBe(false);
    expect(DslExpressionSchema.safeParse({ op: "all", operands: [] }).success).toBe(false);
    expect(DslExpressionSchema.safeParse({ op: "any", operands: [] }).success).toBe(false);
  });

  it("requires every text comparison decision explicitly", () => {
    expect(
      DslExpressionSchema.safeParse({
        op: "contains",
        factKey: "subject.text",
        expected: "demo",
        comparison: { normalization: "NFC", caseSensitivity: "SENSITIVE" },
      }).success,
    ).toBe(false);
    expect(
      DslExpressionSchema.safeParse({
        op: "eq",
        factKey: "subject.text",
        expected: { type: "STRING", value: "demo" },
      }).success,
    ).toBe(false);
  });

  it("rejects contains_any ambiguity after Unicode, whitespace and case normalization", () => {
    const base = {
      op: "contains_any",
      factKey: "subject.text",
      comparison: {
        normalization: "NFC",
        whitespace: "COLLAPSE",
        caseSensitivity: "INSENSITIVE",
      },
    } as const;

    expect(
      DslExpressionSchema.safeParse({ ...base, expected: ["É  X", "E\u0301 x"] }).success,
    ).toBe(false);
    expect(DslExpressionSchema.safeParse({ ...base, expected: [" \t "] }).success).toBe(false);
    expect(
      DslExpressionSchema.safeParse({
        ...base,
        expected: Array.from(
          { length: DSL_LIMITS.maxContainsAnyValues + 1 },
          (_, index) => `v${String(index)}`,
        ),
      }).success,
    ).toBe(false);
  });

  it("rejects a contains fragment that becomes empty after configured normalization", () => {
    expect(
      DslExpressionSchema.safeParse({
        op: "contains",
        factKey: "subject.text",
        expected: " \t\n ",
        comparison: {
          normalization: "NFC",
          whitespace: "COLLAPSE",
          caseSensitivity: "SENSITIVE",
        },
      }).success,
    ).toBe(false);
  });

  it("accepts only bounded patterns compiled by RE2 with explicit safe flags", () => {
    const valid = {
      op: "matches",
      factKey: "subject.code",
      pattern: "(?:demo|synthetic)-[0-9]+",
      mode: "SEARCH",
      normalization: "NFC",
      whitespace: "PRESERVE",
      caseSensitivity: "SENSITIVE",
      dotAll: false,
      multiline: true,
      maxInputCharacters: DSL_LIMITS.maxRegexInputCharacters,
    } as const;
    expect(DslExpressionSchema.safeParse(valid).success).toBe(true);
    expect(DslExpressionSchema.safeParse({ ...valid, dotAll: true }).success).toBe(true);

    for (const pattern of ["[", "(a)\\1", "a(?=b)", "(?i)demo", "e\u0301"]) {
      expect(DslExpressionSchema.safeParse({ ...valid, pattern }).success, pattern).toBe(false);
    }
    expect(DslExpressionSchema.safeParse({ ...valid, pattern: "é".repeat(257) }).success).toBe(
      false,
    );
    expect(DslExpressionSchema.safeParse({ ...valid, mode: "PARTIAL" }).success).toBe(false);
    expect(
      DslExpressionSchema.safeParse({
        ...valid,
        pattern: "Ａ",
        normalization: "NFKC",
      }).success,
    ).toBe(false);
    expect(
      DslExpressionSchema.safeParse({
        ...valid,
        maxInputCharacters: DSL_LIMITS.maxRegexInputCharacters + 1,
      }).success,
    ).toBe(false);
    expect(
      DslExpressionSchema.safeParse({
        op: "between",
        factKey: "subject.score",
        minimum: 5,
        maximum: 5,
        includeMinimum: true,
        includeMaximum: true,
      }).success,
    ).toBe(true);
  });

  it("routes an adversarial nested repetition through the linear-time RE2 engine", () => {
    const expression = {
      op: "matches",
      factKey: "subject.code",
      pattern: "(a+)+$",
      mode: "SEARCH",
      normalization: "NFC",
      whitespace: "PRESERVE",
      caseSensitivity: "SENSITIVE",
      dotAll: false,
      multiline: false,
      maxInputCharacters: DSL_LIMITS.maxRegexInputCharacters,
    } as const;
    expect(DslExpressionSchema.safeParse(expression).success).toBe(true);
    expect(RE2JS.compile(expression.pattern).test(`${"a".repeat(20_000)}!`)).toBe(false);
  });

  it("does not accept ambiguous or non-canonical numeric operands", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        DslExpressionSchema.safeParse({
          op: "greater_than",
          factKey: "subject.score",
          expectedExclusive: value,
        }).success,
      ).toBe(false);
    }
    expect(
      DslExpressionSchema.safeParse({
        op: "greater_than",
        factKey: "subject.score",
        expectedExclusive: 1.25,
      }).success,
    ).toBe(true);
    expect(
      DslExpressionSchema.safeParse({
        op: "between",
        factKey: "subject.score",
        minimum: 5,
        maximum: 5,
        includeMinimum: true,
        includeMaximum: false,
      }).success,
    ).toBe(false);
    expect(
      DslExpressionSchema.safeParse({
        op: "date_between",
        factKey: "subject.date",
        minimum: "2026-01-01",
        maximum: "2026-01-01",
        includeMinimum: true,
        includeMaximum: true,
      }).success,
    ).toBe(true);
  });

  it("uses strict calendar dates and explicit non-empty boundaries", () => {
    for (const expectedExclusive of [
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T01:00:00+01:00",
      "2026-02-30",
    ]) {
      expect(
        DslExpressionSchema.safeParse({
          op: "date_before",
          factKey: "subject.date",
          expectedExclusive,
        }).success,
      ).toBe(false);
    }
    expect(
      DslExpressionSchema.safeParse({
        op: "date_between",
        factKey: "subject.date",
        minimum: "2026-01-01",
        maximum: "2026-01-01",
        includeMinimum: false,
        includeMaximum: true,
      }).success,
    ).toBe(false);
  });

  it("closes language and visual evidence matching modes", () => {
    expect(
      DslExpressionSchema.safeParse({
        op: "language_present",
        factKey: "subject.name",
        language: "en-GB",
        matchMode: "FALLBACK",
      }).success,
    ).toBe(false);
    const visual = {
      op: "same_visual_area",
      factKeys: ["subject.name", "subject.code"],
      maxNormalizedGap: 0.1,
      quantifier: "ALL_FACTS",
      requireSameDocument: true,
      requireSamePage: true,
    } as const;
    expect(DslExpressionSchema.safeParse({ ...visual, factKeys: ["subject.name"] }).success).toBe(
      false,
    );
    expect(
      DslExpressionSchema.safeParse({
        ...visual,
        factKeys: ["subject.name", "subject.name"],
      }).success,
    ).toBe(false);
    expect(DslExpressionSchema.safeParse({ ...visual, quantifier: "ANY_PAIR" }).success).toBe(
      false,
    );
    expect(DslExpressionSchema.safeParse({ ...visual, requireSamePage: false }).success).toBe(
      false,
    );
    expect(DslExpressionSchema.safeParse({ ...visual, maxNormalizedGap: -0 }).success).toBe(false);
  });
});

describe("DSL adversarial preflight", () => {
  it("enforces expression depth before recursive Zod traversal", () => {
    let accepted: unknown = TRUTH;
    for (let index = 1; index < DSL_LIMITS.maxExpressionDepth; index += 1) {
      accepted = { op: "not", operand: accepted };
    }
    expect(DslExpressionSchema.safeParse(accepted).success).toBe(true);

    const tooDeep = { op: "not", operand: accepted };
    expect(() => DslExpressionSchema.safeParse(tooDeep)).not.toThrow();
    expect(DslExpressionSchema.safeParse(tooDeep).success).toBe(false);
  });

  it("rejects excessive breadth and aggregate nodes", () => {
    expect(
      DslExpressionSchema.safeParse({
        op: "all",
        operands: Array.from({ length: DSL_LIMITS.maxLogicalOperands + 1 }, () => ({ ...TRUTH })),
      }).success,
    ).toBe(false);

    const operands = Array.from({ length: 33 }, () => ({
      op: "all",
      operands: Array.from({ length: DSL_LIMITS.maxLogicalOperands }, () => ({ ...TRUTH })),
    }));
    expect(DslExpressionSchema.safeParse({ op: "all", operands }).success).toBe(false);
  });

  it("rejects cycles and shared object references without throwing", () => {
    const cyclic: Record<string, unknown> = { op: "not" };
    cyclic["operand"] = cyclic;
    expect(() => DslExpressionSchema.safeParse(cyclic)).not.toThrow();
    expect(DslExpressionSchema.safeParse(cyclic).success).toBe(false);

    const shared = { ...TRUTH };
    expect(DslExpressionSchema.safeParse({ op: "all", operands: [shared, shared] }).success).toBe(
      false,
    );
  });

  it("rejects accessors before invoking them", () => {
    let invoked = false;
    const accessor: Record<string, unknown> = { op: "truth" };
    Object.defineProperty(accessor, "value", {
      enumerable: true,
      get: () => {
        invoked = true;
        throw new Error("must not execute");
      },
    });

    expect(() => DslExpressionSchema.safeParse(accessor)).not.toThrow();
    expect(invoked).toBe(false);
    expect(DslExpressionSchema.safeParse(accessor).success).toBe(false);
  });

  it("turns throwing proxy traps into a safe preflight failure", () => {
    const expression = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("adversarial getPrototypeOf trap");
        },
      },
    );

    expect(() => DslExpressionSchema.safeParse(expression)).not.toThrow();
    expect(DslExpressionSchema.safeParse(expression).success).toBe(false);
  });

  it("rejects sparse arrays, custom prototypes and non-enumerable properties", () => {
    const sparse = new Array<unknown>(1);
    expect(DslExpressionSchema.safeParse({ op: "all", operands: sparse }).success).toBe(false);

    const inherited = Object.create({ injected: true }) as Record<string, unknown>;
    inherited["op"] = "truth";
    inherited["value"] = "TRUE";
    expect(DslExpressionSchema.safeParse(inherited).success).toBe(false);

    const hidden = { ...TRUTH };
    Object.defineProperty(hidden, "hidden", { value: true, enumerable: false });
    expect(DslExpressionSchema.safeParse(hidden).success).toBe(false);

    const nonStandardArray = [{ ...TRUTH }];
    Object.setPrototypeOf(nonStandardArray, null);
    expect(DslExpressionSchema.safeParse({ op: "all", operands: nonStandardArray }).success).toBe(
      false,
    );

    const customKeyArray = new Array<unknown>(1);
    Object.defineProperty(customKeyArray, "custom", {
      value: { ...TRUTH },
      enumerable: true,
    });
    expect(DslExpressionSchema.safeParse({ op: "all", operands: customKeyArray }).success).toBe(
      false,
    );

    const accessorArray = [{ ...TRUTH }];
    Object.defineProperty(accessorArray, 0, {
      enumerable: true,
      get: () => ({ ...TRUTH }),
    });
    expect(DslExpressionSchema.safeParse({ op: "all", operands: accessorArray }).success).toBe(
      false,
    );
  });

  it("rejects non-JSON primitives, symbol keys, lone surrogates and generic depth abuse", () => {
    for (const value of [undefined, () => true, Symbol("dsl"), 1n]) {
      expect(DslExpressionSchema.safeParse(value).success).toBe(false);
    }

    const symbolKey = { ...TRUTH, [Symbol("hidden")]: true };
    expect(DslExpressionSchema.safeParse(symbolKey).success).toBe(false);
    expect(DslExpressionSchema.safeParse({ ...TRUTH, value: "\uD800" }).success).toBe(false);
    expect(DslExpressionSchema.safeParse({ ...TRUTH, "\uD800": true }).success).toBe(false);

    let deepUnknown: Record<string, unknown> = {};
    const root = deepUnknown;
    for (let index = 0; index <= DSL_LIMITS.maxJsonDepth; index += 1) {
      const nested: Record<string, unknown> = {};
      deepUnknown["nested"] = nested;
      deepUnknown = nested;
    }
    expect(DslExpressionSchema.safeParse({ ...TRUTH, unknown: root }).success).toBe(false);
  });

  it("stops oversized raw JSON before schema traversal", () => {
    const oversized = {
      ...TRUTH,
      unknown: Array.from({ length: DSL_LIMITS.maxJsonNodes }, () => true),
    };
    expect(DslExpressionSchema.safeParse(oversized).success).toBe(false);
  });

  it("validates a descriptor-only snapshot and never re-reads adversarial properties", () => {
    let deep: DslExpression = { ...TRUTH };
    for (let index = 0; index < DSL_LIMITS.maxExpressionDepth + 10; index += 1) {
      deep = { op: "not", operand: deep };
    }
    let getterCalls = 0;
    const target = { op: "not", operand: { ...TRUTH } };
    const changing = new Proxy(target, {
      get(object, key): unknown {
        if (key === "operand") {
          getterCalls += 1;
          return getterCalls === 1 ? object.operand : deep;
        }
        return key === "op" ? object.op : undefined;
      },
    });

    expect(DslExpressionSchema.parse(changing)).toEqual(target);
    expect(getterCalls).toBe(0);
  });
});

describe("RuleDefinition invariants", () => {
  it("accepts a canonical draft and verifies its content hash", () => {
    const rule = makeRule();

    expect(RuleDefinitionSchema.parse(rule)).toEqual(rule);
    expect(verifyRuleDefinitionHash(rule)).toBe(true);
    expect(computeRuleDefinitionHash(makeHashInput())).toBe(rule["contentHash"]);
  });

  it("allows a constant rule without synthetic evidence bindings", () => {
    expect(
      RuleDefinitionHashInputSchema.safeParse(
        makeHashInput({
          satisfiedWhen: { op: "truth", value: "TRUE" },
          exceptions: [],
          overrides: [],
          conflictsWith: [],
          evidenceBindings: [],
        }),
      ).success,
    ).toBe(true);
  });

  it("collects fact bindings through not and same_visual_area expressions", () => {
    expect(
      RuleDefinitionHashInputSchema.safeParse(
        makeHashInput({
          satisfiedWhen: {
            op: "all",
            operands: [
              { op: "not", operand: { op: "present", factKey: "subject.hidden" } },
              {
                op: "same_visual_area",
                factKeys: ["subject.name", "subject.code"],
                maxNormalizedGap: 0.02,
                quantifier: "ALL_FACTS",
                requireSameDocument: true,
                requireSamePage: true,
              },
            ],
          },
          exceptions: [],
          overrides: [],
          conflictsWith: [],
          evidenceBindings: [
            { factKey: "subject.hidden", evidenceRequirementKeys: ["hidden.evidence"] },
            { factKey: "subject.name", evidenceRequirementKeys: ["name.evidence"] },
            { factKey: "subject.code", evidenceRequirementKeys: ["code.evidence"] },
          ],
        }),
      ).success,
    ).toBe(true);
  });

  it("fixes DSL version, lifecycle, abstention policy and technical scope", () => {
    for (const override of [
      { dslVersion: "vera.dsl/v2" },
      { state: "ACTIVE" },
      { unknownPolicy: "PASS" },
      { validationScope: "PROFESSIONAL" },
    ]) {
      expect(
        RuleDefinitionHashInputSchema.safeParse({ ...makeHashInput(), ...override }).success,
      ).toBe(false);
    }
  });

  it("requires exact evidence bindings for every referenced fact", () => {
    expect(
      RuleDefinitionHashInputSchema.safeParse(
        makeHashInput({
          evidenceBindings: [
            { factKey: "subject.name", evidenceRequirementKeys: ["subject.name.evidence"] },
          ],
        }),
      ).success,
    ).toBe(false);
    expect(
      RuleDefinitionHashInputSchema.safeParse(
        makeHashInput({
          evidenceBindings: [
            ...makeHashInput().evidenceBindings,
            { factKey: "unused.fact", evidenceRequirementKeys: ["unused.evidence"] },
          ],
        }),
      ).success,
    ).toBe(false);
    expect(
      RuleDefinitionHashInputSchema.safeParse(
        makeHashInput({
          evidenceBindings: [
            ...makeHashInput().evidenceBindings,
            {
              factKey: "subject.name",
              evidenceRequirementKeys: ["subject.name.other-evidence"],
            },
          ],
        }),
      ).success,
    ).toBe(false);
    expect(
      RuleDefinitionHashInputSchema.safeParse(
        makeHashInput({
          evidenceBindings: [
            {
              factKey: "subject.name",
              evidenceRequirementKeys: ["subject.name.evidence", "subject.name.evidence"],
            },
            requireItem(makeHashInput().evidenceBindings[1]),
          ],
        }),
      ).success,
    ).toBe(false);
    expect(
      RuleDefinitionHashInputSchema.safeParse(
        makeHashInput({
          evidenceBindings: [
            {
              factKey: "subject.name",
              evidenceRequirementKeys: [`e${"x".repeat(120)}`],
            },
            requireItem(makeHashInput().evidenceBindings[1]),
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("validates evidence and exception keys against the exact Rule Card revision", () => {
    const revision = makeRuleCardRevision();
    const rule = makeRule({ ruleCardRevisionContentHash: revision.contentHash });
    expect(
      RuleDefinitionBindingSchema.safeParse({ rule, ruleCardRevision: revision }).success,
    ).toBe(true);

    const invalidInput = makeHashInput({
      ruleCardRevisionContentHash: revision.contentHash,
      evidenceBindings: [
        { factKey: "subject.name", evidenceRequirementKeys: ["unknown.evidence"] },
        requireItem(makeHashInput().evidenceBindings[1]),
      ],
    });
    const invalidRule = {
      ...invalidInput,
      contentHash: computeRuleDefinitionHash(invalidInput),
    };
    expect(
      RuleDefinitionBindingSchema.safeParse({ rule: invalidRule, ruleCardRevision: revision })
        .success,
    ).toBe(false);
  });

  it.each([
    ["ruleCardId", { ruleCardId: uuidFromInteger(530) }],
    ["ruleCardRevisionId", { ruleCardRevisionId: uuidFromInteger(531) }],
    ["ruleCardRevisionContentHash", { ruleCardRevisionContentHash: "c".repeat(64) }],
    ["sourceId", { sourceId: uuidFromInteger(532) }],
    ["sourceVersionId", { sourceVersionId: uuidFromInteger(533) }],
    ["sourceContentHash", { sourceContentHash: "d".repeat(64) }],
    ["normativeKey", { normativeKey: "synthetic.other" }],
    ["deonticCategory", { deonticCategory: "PROHIBITION" as const }],
    ["riskLevel", { riskLevel: "CRITICAL" as const }],
    [
      "validity",
      {
        validity: {
          validFrom: "2026-02-01T00:00:00.000Z",
          validTo: "2027-01-01T00:00:00.000Z",
        },
      },
    ],
  ])("rejects a contextual Rule Card mismatch in %s", (_field, override) => {
    const revision = makeRuleCardRevision();
    const rule = makeRule({
      ruleCardRevisionContentHash: revision.contentHash,
      ...override,
    });
    expect(
      RuleDefinitionBindingSchema.safeParse({ rule, ruleCardRevision: revision }).success,
    ).toBe(false);
  });

  it("requires exact exception coverage and provenance from the bound Rule Card", () => {
    const revision = makeRuleCardRevision();
    const exception = requireItem(makeHashInput().exceptions[0]);
    const wrongReferenceRule = makeRule({
      ruleCardRevisionContentHash: revision.contentHash,
      exceptions: [{ ...exception, sourceReference: "section-other" }],
    });
    expect(
      RuleDefinitionBindingSchema.safeParse({
        rule: wrongReferenceRule,
        ruleCardRevision: revision,
      }).success,
    ).toBe(false);

    const missingExceptionRule = makeRule({
      ruleCardRevisionContentHash: revision.contentHash,
      exceptions: [],
      evidenceBindings: [requireItem(makeHashInput().evidenceBindings[0])],
    });
    expect(
      RuleDefinitionBindingSchema.safeParse({
        rule: missingExceptionRule,
        ruleCardRevision: revision,
      }).success,
    ).toBe(false);

    const { contentHash, ...revisionInput } = revision;
    expect(contentHash).toBe(revision.contentHash);
    const revisionWithoutExceptionInput = { ...revisionInput, exceptions: [] };
    const revisionWithoutException = {
      ...revisionWithoutExceptionInput,
      contentHash: computeRuleCardRevisionHash(revisionWithoutExceptionInput),
    };
    const extraExceptionRule = makeRule({
      ruleCardRevisionContentHash: revisionWithoutException.contentHash,
    });
    expect(
      RuleDefinitionBindingSchema.safeParse({
        rule: extraExceptionRule,
        ruleCardRevision: revisionWithoutException,
      }).success,
    ).toBe(false);
  });

  it("enforces local override direction and explicit non-self relations", () => {
    const override = requireItem(makeHashInput().overrides[0]);
    for (const invalidOverride of [
      { ...override, overridingRuleId: CONFLICTING_RULE_ID },
      { ...override, overriddenRuleId: RULE_ID },
    ]) {
      expect(
        RuleDefinitionHashInputSchema.safeParse(makeHashInput({ overrides: [invalidOverride] }))
          .success,
      ).toBe(false);
    }
    expect(
      RuleDefinitionHashInputSchema.safeParse(makeHashInput({ conflictsWith: [RULE_ID] })).success,
    ).toBe(false);
  });

  it("rejects duplicate exception and override identities or targets", () => {
    const exception = requireItem(makeHashInput().exceptions[0]);
    const override = requireItem(makeHashInput().overrides[0]);
    expect(
      RuleDefinitionHashInputSchema.safeParse(
        makeHashInput({ exceptions: [exception, { ...exception }] }),
      ).success,
    ).toBe(false);
    expect(
      RuleDefinitionHashInputSchema.safeParse(
        makeHashInput({
          overrides: [override, { ...override, id: uuidFromInteger(510) }],
        }),
      ).success,
    ).toBe(false);
    expect(
      RuleDefinitionHashInputSchema.safeParse(
        makeHashInput({ conflictsWith: [CONFLICTING_RULE_ID, CONFLICTING_RULE_ID] }),
      ).success,
    ).toBe(false);
  });

  it("rejects aggregate rule expression budgets above the public limit", () => {
    const largeExpression = (): DslExpression => ({
      op: "all",
      operands: Array.from({ length: 16 }, () => ({
        op: "all" as const,
        operands: Array.from({ length: 64 }, () => ({ ...TRUTH })),
      })),
    });
    expect(
      RuleDefinitionHashInputSchema.safeParse(
        makeHashInput({
          appliesWhen: largeExpression(),
          satisfiedWhen: largeExpression(),
          exceptions: [],
          overrides: [],
          conflictsWith: [],
          evidenceBindings: [],
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects a rule above the canonical byte budget", () => {
    const exceptions = Array.from({ length: 60 }, (_, index) => ({
      id: uuidFromInteger(1_000 + index),
      key: `exception.${String(index)}`,
      when: {
        op: "contains" as const,
        factKey: `fact.${String(index)}`,
        expected: "x".repeat(DSL_LIMITS.maxStringCharacters),
        comparison: { ...TEXT_COMPARISON },
      },
      reason: "Synthetic oversized rule fixture",
      sourceVersionId: SOURCE_VERSION_ID,
      sourceReference: `section-${String(index)}`,
    }));
    const evidenceBindings = Array.from({ length: 60 }, (_, index) => ({
      factKey: `fact.${String(index)}`,
      evidenceRequirementKeys: [`fact.${String(index)}.evidence`],
    }));

    const result = RuleDefinitionHashInputSchema.safeParse(
      makeHashInput({
        satisfiedWhen: { op: "truth", value: "TRUE" },
        exceptions,
        overrides: [],
        conflictsWith: [],
        evidenceBindings,
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map(({ message }) => message)).toContain(
        "Canonical JSON byte limit exceeded",
      );
    }
  });

  it("detects tampering and ignores key insertion order", () => {
    const rule = makeRule();
    const reversed = Object.fromEntries(Object.entries(rule).reverse());
    expect(verifyRuleDefinitionHash(reversed)).toBe(true);

    const tampered = { ...rule, riskLevel: "CRITICAL" };
    expect(verifyRuleDefinitionHash(tampered)).toBe(false);
    expect(RuleDefinitionSchema.safeParse(tampered).success).toBe(false);
    expect(verifyRuleDefinitionHash({})).toBe(false);
  });

  it("rejects non-canonical whitespace instead of hashing a transformed draft", () => {
    const spacedNormativeKey = makeHashInput({ normativeKey: " synthetic.subject.name" });
    expect(RuleDefinitionHashInputSchema.safeParse(spacedNormativeKey).success).toBe(false);
    expect(() => computeRuleDefinitionHash(spacedNormativeKey)).toThrow();
    expect(
      verifyRuleDefinitionHash({
        ...spacedNormativeKey,
        contentHash: sha256CanonicalJson(spacedNormativeKey),
      }),
    ).toBe(false);

    const exception = requireItem(makeHashInput().exceptions[0]);
    const spacedSourceReference = makeHashInput({
      exceptions: [{ ...exception, sourceReference: "section-exception " }],
    });
    expect(RuleDefinitionHashInputSchema.safeParse(spacedSourceReference).success).toBe(false);
    expect(
      verifyRuleDefinitionHash({
        ...spacedSourceReference,
        contentHash: sha256CanonicalJson(spacedSourceReference),
      }),
    ).toBe(false);
  });

  it("does not report a matching digest for a semantically invalid rule", () => {
    const invalidInput = makeHashInput({ conflictsWith: [RULE_ID] });
    const candidate = {
      ...invalidInput,
      contentHash: sha256CanonicalJson(invalidInput),
    };
    expect(verifyRuleDefinitionHash(candidate)).toBe(false);
  });
});
