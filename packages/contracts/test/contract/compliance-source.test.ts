import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ComplianceSourceEligibilityRequestSchema,
  ComplianceSourceSchema,
  ComplianceSourceTransitionEventSchema,
  ComplianceSourceTypeSchema,
  ComplianceSourceVersionSchema,
} from "../../src/index.js";

describe("compliance source public schema contract", () => {
  it("keeps the source type vocabulary closed", () => {
    expect(ComplianceSourceTypeSchema.options).toEqual([
      "REGULATION",
      "STANDARD",
      "POLICY",
      "GUIDANCE",
      "CONTRACT",
      "OTHER",
    ]);
  });

  it.each([
    [
      ComplianceSourceEligibilityRequestSchema,
      ["versionId", "activationAt", "evaluationDate", "expectedContentHash"],
    ],
    [
      ComplianceSourceSchema,
      ["id", "type", "domain", "jurisdiction", "title", "stableReference", "validationScope"],
    ],
    [
      ComplianceSourceVersionSchema,
      [
        "id",
        "sourceId",
        "revision",
        "versionLabel",
        "license",
        "contentHash",
        "validity",
        "createdAt",
        "createdBy",
        "replacesVersionId",
        "replacementReason",
      ],
    ],
    [
      ComplianceSourceTransitionEventSchema,
      [
        "id",
        "versionId",
        "sequence",
        "from",
        "to",
        "actorId",
        "exercisedRole",
        "at",
        "contentHash",
        "reason",
        "validationScope",
      ],
    ],
  ] as const)("publishes required strict object fields", (zodSchema, required) => {
    const schema = z.toJSONSchema(zodSchema);

    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(required);
  });

  it("round-trips public JSON without adding a mutable state projection", () => {
    const source = {
      id: "00000000-0000-4000-8000-000000000010",
      type: "GUIDANCE",
      domain: "Synthetic operations",
      jurisdiction: "Synthetic region",
      title: "Synthetic guidance",
      stableReference: "synthetic:guidance:1",
      validationScope: "TECHNICAL_DEMO",
    } as const;

    const parsed = ComplianceSourceSchema.parse(JSON.parse(JSON.stringify(source)));

    expect(parsed).toEqual(source);
    expect(parsed).not.toHaveProperty("state");
  });
});
