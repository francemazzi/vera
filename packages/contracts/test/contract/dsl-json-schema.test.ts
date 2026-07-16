import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  DSL_VERSION,
  DslOperatorSchema,
  RULE_DEFINITION_JSON_SCHEMA_HASH,
  RuleDefinitionJsonSchema,
  RuleDefinitionSchema,
  canonicalizeJson,
  computeRuleDefinitionHash,
  sha256CanonicalJson,
  type RuleDefinitionHashInput,
} from "../../src/index.js";

const UUIDS = {
  rule: "00000000-0000-4000-8000-000000000001",
  source: "00000000-0000-4000-8000-000000000002",
  sourceVersion: "00000000-0000-4000-8000-000000000003",
  card: "00000000-0000-4000-8000-000000000004",
  cardRevision: "00000000-0000-4000-8000-000000000005",
} as const;

const PINNED_V1_SCHEMA_HASH = "35b4925bacca9eb90487f543972cb9b603ca15b603aa074c92a9c9ae1952b01d";

function makeRuleInput(): RuleDefinitionHashInput {
  return {
    dslVersion: DSL_VERSION,
    state: "DRAFT",
    id: UUIDS.rule,
    sourceId: UUIDS.source,
    sourceVersionId: UUIDS.sourceVersion,
    sourceContentHash: "a".repeat(64),
    ruleCardId: UUIDS.card,
    ruleCardRevisionId: UUIDS.cardRevision,
    ruleCardRevisionContentHash: "b".repeat(64),
    normativeKey: "synthetic.rule",
    deonticCategory: "OBLIGATION",
    riskLevel: "LOW",
    validity: {
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: null,
    },
    appliesWhen: { op: "truth", value: "TRUE" },
    satisfiedWhen: { op: "truth", value: "TRUE" },
    exceptions: [],
    overrides: [],
    conflictsWith: [],
    evidenceBindings: [],
    unknownPolicy: "REVIEW",
    validationScope: "TECHNICAL_DEMO",
  };
}

function makeRule(): Record<string, unknown> {
  const input = makeRuleInput();
  return { ...input, contentHash: computeRuleDefinitionHash(input) };
}

function createValidator(): ValidateFunction {
  // Zod emits legal Draft 2020-12 sibling constraints next to `$ref`; Ajv's optional strictTypes
  // lint does not infer the referenced type for those siblings.
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
  ajv.addFormat(
    "uuid",
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
  );
  ajv.addFormat("date", /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u);
  ajv.addFormat("date-time", {
    type: "string",
    validate: (value: string): boolean => Number.isFinite(Date.parse(value)),
  });
  return ajv.compile(RuleDefinitionJsonSchema);
}

function collectObjectSchemas(value: unknown): readonly Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const stack: unknown[] = [value];
  const seen = new WeakSet<object>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const nested of current as unknown[]) stack.push(nested);
      continue;
    }
    const record = current as Record<string, unknown>;
    if (record["type"] === "object") found.push(record);
    stack.push(...Object.values(record));
  }
  return found;
}

describe("RuleDefinition generated JSON Schema", () => {
  it("validates a Zod-accepted synthetic rule with an independent Draft 2020-12 validator", () => {
    const rule = makeRule();
    expect(RuleDefinitionSchema.safeParse(rule).success).toBe(true);
    expect(createValidator()(rule)).toBe(true);
  });

  it("rejects structural drift, configurable unknown policy, and unversioned drafts", () => {
    const validate = createValidator();
    const rule = makeRule();
    expect(validate({ ...rule, unexpected: true })).toBe(false);
    expect(validate({ ...rule, unknownPolicy: "PASS" })).toBe(false);
    expect(validate({ ...rule, dslVersion: "vera.dsl/v2" })).toBe(false);
    expect(validate({ ...rule, state: "ACTIVE" })).toBe(false);
  });

  it("uses strict objects and resolvable recursive references throughout", () => {
    const objectSchemas = collectObjectSchemas(RuleDefinitionJsonSchema);
    expect(objectSchemas.length).toBeGreaterThan(10);
    expect(objectSchemas.every((schema) => schema["additionalProperties"] === false)).toBe(true);
    expect(() => createValidator()).not.toThrow();
  });

  it("contains every public discriminant and the fixed review policy", () => {
    const canonicalSchema = canonicalizeJson(RuleDefinitionJsonSchema);
    for (const operator of DslOperatorSchema.options) {
      expect(canonicalSchema).toContain(`"const":"${operator}"`);
    }
    expect(canonicalSchema).toContain(`"const":"${DSL_VERSION}"`);
    expect(canonicalSchema).toContain('"const":"REVIEW"');
  });

  it("has a stable identifier, deterministic hash, and deeply frozen representation", () => {
    expect(RuleDefinitionJsonSchema["$id"]).toBe(
      "https://vera.local/schemas/rule-definition-vera.dsl-v1.schema.json",
    );
    expect(RULE_DEFINITION_JSON_SCHEMA_HASH).toBe(PINNED_V1_SCHEMA_HASH);
    expect(RULE_DEFINITION_JSON_SCHEMA_HASH).toBe(sha256CanonicalJson(RuleDefinitionJsonSchema));
    expect(RULE_DEFINITION_JSON_SCHEMA_HASH).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(RuleDefinitionJsonSchema)).toBe(true);
    expect(collectObjectSchemas(RuleDefinitionJsonSchema).every(Object.isFrozen)).toBe(true);
  });

  it("keeps runtime-only refinements explicit instead of claiming JSON Schema parity", () => {
    const rule = makeRule();
    const runtimeInvalidCandidates = [
      { ...rule, contentHash: "0".repeat(64) },
      {
        ...rule,
        validity: {
          validFrom: "2027-01-01T00:00:00.000Z",
          validTo: "2026-01-01T00:00:00.000Z",
        },
      },
      {
        ...rule,
        satisfiedWhen: {
          op: "between",
          factKey: "synthetic.score",
          minimum: 10,
          maximum: 1,
          includeMinimum: true,
          includeMaximum: true,
        },
      },
    ];
    const validate = createValidator();
    for (const candidate of runtimeInvalidCandidates) {
      expect(validate(candidate)).toBe(true);
      expect(RuleDefinitionSchema.safeParse(candidate).success).toBe(false);
    }
  });
});
