import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  EVALUATION_RESULT_JSON_SCHEMA_HASH,
  EvaluationResultJsonSchema,
  EvaluationResultSchema,
  EvaluationTraceReasonSchema,
  RuleFindingResolutionSchema,
} from "../../src/evaluation.js";
import { canonicalizeJson, sha256CanonicalJson } from "../../src/hash.js";

const UUIDS = {
  rule: "00000000-0000-4000-8000-000000000001",
  evidence: "00000000-0000-4000-8000-000000000002",
} as const;

function makeResult(): Record<string, unknown> {
  return {
    findings: [
      {
        finding: {
          ruleId: UUIDS.rule,
          ruleContentHash: "a".repeat(64),
          evaluationDate: "2026-01-01T00:00:00.0000001Z",
          outcome: "PASS",
          appliesWhen: {
            path: "/appliesWhen",
            op: "truth",
            truth: "TRUE",
            reason: "EVALUATED",
            factKeys: [],
            expected: "TRUE",
            observed: "TRUE",
            evidenceIds: [],
            children: [],
          },
          exceptionTraces: [],
          satisfiedWhen: {
            path: "/satisfiedWhen",
            op: "present",
            truth: "TRUE",
            reason: "EVALUATED",
            factKeys: ["synthetic.present"],
            expected: true,
            observed: true,
            evidenceIds: [UUIDS.evidence],
            children: [],
          },
          overrideTraces: [],
          evidenceIds: [UUIDS.evidence],
          validationScope: "TECHNICAL_DEMO",
        },
        resolution: "UNCHANGED",
        effectiveOutcome: "PASS",
        relatedRuleIds: [],
      },
    ],
    aggregateOutcome: "PASS",
  };
}

function createValidator(): ValidateFunction {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
  ajv.addFormat(
    "uuid",
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
  );
  ajv.addFormat("date-time", {
    type: "string",
    validate: (value: string): boolean =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/u.test(value),
  });
  return ajv.compile(EvaluationResultJsonSchema);
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

describe("EvaluationResult generated JSON Schema", () => {
  it("validates a Zod-accepted result with an independent Draft 2020-12 validator", () => {
    const result = makeResult();
    expect(EvaluationResultSchema.safeParse(result).success).toBe(true);
    expect(createValidator()(result)).toBe(true);
  });

  it("is strict and rejects malformed structural data", () => {
    const validate = createValidator();
    expect(validate({ ...makeResult(), extra: true })).toBe(false);
    expect(validate({ ...makeResult(), findings: [] })).toBe(false);
    expect(
      validate({
        ...makeResult(),
        findings: [
          {
            ...(makeResult()["findings"] as Record<string, unknown>[])[0],
            resolution: "SILENTLY_SELECTED",
          },
        ],
      }),
    ).toBe(false);
  });

  it("uses strict object schemas and resolvable recursive references", () => {
    const objectSchemas = collectObjectSchemas(EvaluationResultJsonSchema);
    expect(objectSchemas.length).toBeGreaterThan(4);
    expect(objectSchemas.every((schema) => schema["additionalProperties"] === false)).toBe(true);
    expect(() => createValidator()).not.toThrow();
    expect(canonicalizeJson(EvaluationResultJsonSchema)).toContain('"$ref"');
  });

  it("contains every trace reason, resolution and fixed technical scope", () => {
    const canonical = canonicalizeJson(EvaluationResultJsonSchema);
    for (const reason of EvaluationTraceReasonSchema.options) {
      expect(canonical).toContain(`"${reason}"`);
    }
    for (const resolution of RuleFindingResolutionSchema.options) {
      expect(canonical).toContain(`"${resolution}"`);
    }
    expect(canonical).toContain('"const":"TECHNICAL_DEMO"');
  });

  it("publishes a stable identifier and deeply frozen schema", () => {
    expect(EvaluationResultJsonSchema["$id"]).toBe(
      "https://vera.local/schemas/evaluation-result-v1.schema.json",
    );
    expect(EvaluationResultJsonSchema["title"]).toBe("VERA EvaluationResult v1");
    expect(EVALUATION_RESULT_JSON_SCHEMA_HASH).toBe(
      "ed8f81d7a2477364deb7b3ac9a21f639fd5893bb6769feaa95e3bd9f03eb2bc5",
    );
    expect(EVALUATION_RESULT_JSON_SCHEMA_HASH).toBe(
      sha256CanonicalJson(EvaluationResultJsonSchema),
    );
    expect(Object.isFrozen(EvaluationResultJsonSchema)).toBe(true);
    expect(collectObjectSchemas(EvaluationResultJsonSchema).every(Object.isFrozen)).toBe(true);
  });

  it("keeps cross-field truth-table and aggregation invariants at the runtime boundary", () => {
    const structurallyValid = { ...makeResult(), aggregateOutcome: "FAIL" };
    expect(createValidator()(structurallyValid)).toBe(true);
    expect(EvaluationResultSchema.safeParse(structurallyValid).success).toBe(false);
  });
});
