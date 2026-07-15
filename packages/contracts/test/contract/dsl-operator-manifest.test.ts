import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DSL_VERSION,
  DslExpressionSchema,
  DslOperatorSchema,
  FactValueTypeSchema,
  JsonValueSchema,
  NormalizedBoundingBoxSchema,
  TruthValueSchema,
  ValidationScopeSchema,
} from "../../src/index.js";
import type { DslExpression, FactValueType, JsonValue } from "../../src/index.js";

const StableKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z][A-Za-z0-9._-]*$/u);
const Sha256DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const LanguageTagSchema = z
  .string()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u);

function matchesFixtureValueType(valueType: FactValueType, value: JsonValue): boolean {
  switch (valueType) {
    case "STRING":
      return typeof value === "string";
    case "NUMBER":
      return typeof value === "number";
    case "BOOLEAN":
      return typeof value === "boolean";
    case "DATE":
      return typeof value === "string" && z.iso.date().safeParse(value).success;
    case "JSON":
      return value !== null;
  }
}

const ResolvedFactFixtureSchema = z
  .object({
    key: StableKeySchema,
    status: z.literal("RESOLVED"),
    valueType: FactValueTypeSchema,
    normalizedValue: JsonValueSchema.refine((value) => value !== null),
    evidenceIds: z.array(z.uuid()).min(1).max(10),
  })
  .strict()
  .superRefine(({ valueType, normalizedValue, evidenceIds }, context) => {
    if (!matchesFixtureValueType(valueType, normalizedValue)) {
      context.addIssue({
        code: "custom",
        message: `Fixture value does not match ${valueType}`,
        path: ["normalizedValue"],
      });
    }
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      context.addIssue({
        code: "custom",
        message: "Fixture evidence IDs must be unique",
        path: ["evidenceIds"],
      });
    }
  });

const UnresolvedFactFixtureSchema = z
  .object({
    key: StableKeySchema,
    status: z.enum(["NULL", "NOT_FOUND", "NOT_READABLE", "CONFLICT"]),
    valueType: FactValueTypeSchema,
    normalizedValue: z.null(),
    evidenceIds: z.array(z.uuid()).max(10),
  })
  .strict()
  .superRefine(({ status, evidenceIds }, context) => {
    const minimumEvidence = status === "CONFLICT" ? 2 : 1;
    if (evidenceIds.length < minimumEvidence) {
      context.addIssue({
        code: "custom",
        message: `${status} requires at least ${String(minimumEvidence)} evidence fixture(s)`,
        path: ["evidenceIds"],
      });
    }
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      context.addIssue({
        code: "custom",
        message: "Fixture evidence IDs must be unique",
        path: ["evidenceIds"],
      });
    }
  });

const FactFixtureSchema = z.union([ResolvedFactFixtureSchema, UnresolvedFactFixtureSchema]);

const EvidenceFixtureSchema = z
  .object({
    id: z.uuid(),
    documentId: z.uuid(),
    documentHash: Sha256DigestSchema,
    page: z.int().min(1),
    language: LanguageTagSchema,
    boundingBox: NormalizedBoundingBoxSchema,
  })
  .strict();

function collectReferencedFactKeys(expression: DslExpression): Set<string> {
  const keys = new Set<string>();
  const stack = [expression];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (current.op === "all" || current.op === "any") {
      stack.push(...current.operands);
    } else if (current.op === "not") {
      stack.push(current.operand);
    } else if (current.op === "same_visual_area") {
      current.factKeys.forEach((key) => keys.add(key));
    } else if (current.op !== "truth") {
      keys.add(current.factKey);
    }
  }
  return keys;
}

function containsUnknownTruth(expression: DslExpression): boolean {
  const stack = [expression];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (current.op === "truth" && current.value === "UNKNOWN") return true;
    if (current.op === "all" || current.op === "any") stack.push(...current.operands);
    if (current.op === "not") stack.push(current.operand);
  }
  return false;
}

const EvaluationCaseFixtureSchema = z
  .object({
    caseId: StableKeySchema,
    expression: DslExpressionSchema,
    facts: z.array(FactFixtureSchema).max(10),
    evidence: z.array(EvidenceFixtureSchema).max(20),
    expectedTruth: TruthValueSchema,
  })
  .strict()
  .superRefine(({ expression, facts, evidence }, context) => {
    const referencedFactKeys = collectReferencedFactKeys(expression);
    const factKeys = facts.map(({ key }) => key);
    if (new Set(factKeys).size !== factKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Fixture fact keys must be unique",
        path: ["facts"],
      });
    }
    facts.forEach(({ key }, index) => {
      if (!referencedFactKeys.has(key)) {
        context.addIssue({
          code: "custom",
          message: `Fixture fact is not referenced by the expression: ${key}`,
          path: ["facts", index, "key"],
        });
      }
    });

    const evidenceIds = evidence.map(({ id }) => id);
    const availableEvidenceIds = new Set(evidenceIds);
    if (availableEvidenceIds.size !== evidenceIds.length) {
      context.addIssue({
        code: "custom",
        message: "Fixture evidence IDs must be unique",
        path: ["evidence"],
      });
    }
    const referencedEvidenceIds = new Set(facts.flatMap(({ evidenceIds: ids }) => ids));
    for (const evidenceId of referencedEvidenceIds) {
      if (!availableEvidenceIds.has(evidenceId)) {
        context.addIssue({
          code: "custom",
          message: `Referenced fixture evidence is missing: ${evidenceId}`,
          path: ["evidence"],
        });
      }
    }
    evidence.forEach(({ id }, index) => {
      if (!referencedEvidenceIds.has(id)) {
        context.addIssue({
          code: "custom",
          message: `Fixture evidence is not linked to a fact: ${id}`,
          path: ["evidence", index, "id"],
        });
      }
    });
  });

const OperatorFixtureSchema = z
  .object({
    operator: DslOperatorSchema,
    cases: z.array(EvaluationCaseFixtureSchema).length(3),
    invalidExpression: z.unknown(),
    abuseExpression: z.unknown(),
  })
  .strict();

const ManifestSchema = z
  .object({
    dslVersion: z.literal(DSL_VERSION),
    validationScope: ValidationScopeSchema,
    operators: z.array(OperatorFixtureSchema),
  })
  .strict();

type Manifest = z.infer<typeof ManifestSchema>;

function loadManifest(): Manifest {
  const url = new URL("../../../../examples/synthetic-dsl/operator-manifest.json", import.meta.url);
  return ManifestSchema.parse(JSON.parse(readFileSync(url, "utf8")) as unknown);
}

describe("synthetic DSL operator manifest", () => {
  it("covers every discriminant exactly once", () => {
    const manifest = loadManifest();
    const operators = manifest.operators.map(({ operator }) => operator);
    expect(new Set(operators).size).toBe(operators.length);
    expect([...operators].sort()).toEqual([...DslOperatorSchema.options].sort());
  });

  it("provides exactly one concrete TRUE, FALSE and UNKNOWN case per operator", () => {
    const manifest = loadManifest();
    const allCaseIds = manifest.operators.flatMap(({ cases }) => cases.map(({ caseId }) => caseId));
    expect(allCaseIds).toHaveLength(
      DslOperatorSchema.options.length * TruthValueSchema.options.length,
    );
    expect(new Set(allCaseIds).size).toBe(allCaseIds.length);

    for (const entry of manifest.operators) {
      expect(new Set(entry.cases.map(({ expectedTruth }) => expectedTruth))).toEqual(
        new Set(TruthValueSchema.options),
      );
      for (const fixture of entry.cases) {
        expect(fixture.expression.op, fixture.caseId).toBe(entry.operator);
        expect(fixture.caseId).toBe(`${entry.operator}.${fixture.expectedTruth.toLowerCase()}`);
      }
    }
  });

  it("grounds every UNKNOWN in an unresolved or missing fact, or an explicit UNKNOWN literal", () => {
    const manifest = loadManifest();
    for (const entry of manifest.operators) {
      const fixture = entry.cases.find(({ expectedTruth }) => expectedTruth === "UNKNOWN");
      expect(fixture, `${entry.operator}/UNKNOWN`).toBeDefined();
      if (fixture === undefined) continue;

      const factsByKey = new Map(fixture.facts.map((fact) => [fact.key, fact]));
      const hasMissingOrUnresolvedFact = [...collectReferencedFactKeys(fixture.expression)].some(
        (key) => factsByKey.get(key)?.status !== "RESOLVED",
      );
      expect(
        containsUnknownTruth(fixture.expression) || hasMissingOrUnresolvedFact,
        fixture.caseId,
      ).toBe(true);
    }
  });

  it("represents a FALSE present result only with an evidenced NOT_FOUND fact", () => {
    const manifest = loadManifest();
    const present = manifest.operators.find(({ operator }) => operator === "present");
    const fixture = present?.cases.find(({ expectedTruth }) => expectedTruth === "FALSE");
    expect(fixture).toBeDefined();
    expect(fixture?.facts).toHaveLength(1);
    expect(fixture?.facts[0]?.status).toBe("NOT_FOUND");
    expect(fixture?.facts[0]?.evidenceIds.length).toBeGreaterThan(0);
    expect(fixture?.evidence.length).toBeGreaterThan(0);
  });

  it("declares rejected schema-invalid and adversarial inputs for every operator", () => {
    const manifest = loadManifest();
    for (const entry of manifest.operators) {
      expect(
        DslExpressionSchema.safeParse(entry.invalidExpression).success,
        `${entry.operator}/invalid`,
      ).toBe(false);
      expect(
        DslExpressionSchema.safeParse(entry.abuseExpression).success,
        `${entry.operator}/abuse`,
      ).toBe(false);
    }
  });

  it("is explicitly a technical demo reusable by the Phase 6 kernel", () => {
    const manifest = loadManifest();
    expect(manifest.validationScope).toBe("TECHNICAL_DEMO");
    expect(manifest.dslVersion).toBe(DSL_VERSION);
  });
});
