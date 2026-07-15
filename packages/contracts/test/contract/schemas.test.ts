import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ActorRoleSchema,
  ActorSchema,
  ComplianceSourceStateSchema,
  DeonticCategorySchema,
  EvaluationOutcomeSchema,
  RiskLevelSchema,
  RuleCardStateSchema,
  TruthValueSchema,
  UtcDateTimeSchema,
  ValidationScopeSchema,
  ValidityIntervalSchema,
} from "../../src/index.js";

describe("methodology vocabulary contract", () => {
  it("exposes the complete, closed vocabulary", () => {
    expect(TruthValueSchema.options).toEqual(["TRUE", "FALSE", "UNKNOWN"]);
    expect(EvaluationOutcomeSchema.options).toEqual(["PASS", "FAIL", "REVIEW", "NOT_APPLICABLE"]);
    expect(DeonticCategorySchema.options).toEqual(["OBLIGATION", "PROHIBITION", "PERMISSION"]);
    expect(RiskLevelSchema.options).toEqual(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
    expect(ActorRoleSchema.options).toEqual(["AUTHOR", "REVIEWER", "APPROVER", "ADMIN"]);
    expect(ComplianceSourceStateSchema.options).toEqual([
      "UPLOADED",
      "REVIEWED",
      "APPROVED",
      "RETIRED",
    ]);
    expect(RuleCardStateSchema.options).toEqual([
      "DRAFT",
      "IN_REVIEW",
      "APPROVED",
      "CHANGES_REQUESTED",
      "RETIRED",
    ]);
  });

  it("restricts public fixture validation to technical demonstrations", () => {
    expect(ValidationScopeSchema.parse("TECHNICAL_DEMO")).toBe("TECHNICAL_DEMO");
    expect(ValidationScopeSchema.safeParse("PROFESSIONAL_VALIDATION").success).toBe(false);
  });
});

describe("actor serialization contract", () => {
  const actor = {
    id: "00000000-0000-4000-8000-000000000001",
    displayName: "Synthetic Reviewer",
    role: "REVIEWER",
    validationScope: "TECHNICAL_DEMO",
  } as const;

  it("round-trips through JSON without changing the public representation", () => {
    expect(ActorSchema.parse(JSON.parse(JSON.stringify(actor)))).toEqual(actor);
  });

  it("rejects unknown fields", () => {
    expect(ActorSchema.safeParse({ ...actor, professionalApproval: true }).success).toBe(false);
  });

  it("has a JSON Schema generated from the same Zod contract", () => {
    const schema = z.toJSONSchema(ActorSchema);

    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["id", "displayName", "role", "validationScope"]);
  });
});

describe("temporal serialization contract", () => {
  it("round-trips a bounded interval and preserves its half-open endpoints", () => {
    const interval = {
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2027-01-01T00:00:00.000Z",
    } as const;

    expect(ValidityIntervalSchema.parse(JSON.parse(JSON.stringify(interval)))).toEqual(interval);
  });

  it("publishes UTC date-time format in JSON Schema", () => {
    const schema = z.toJSONSchema(UtcDateTimeSchema);

    expect(schema.type).toBe("string");
    expect(schema.format).toBe("date-time");
  });
});
