import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  RuleCardApprovalDecisionSchema,
  RuleCardApprovalDecisionTypeSchema,
  RuleCardCommentSchema,
  RuleCardEvidenceRequirementSchema,
  RuleCardExceptionSchema,
  RuleCardProvenanceSchema,
  RuleDraftGenerationReferenceSchema,
  RuleGenerationEligibilityRequestSchema,
  RuleCardReviewDecisionSchema,
  RuleCardReviewDecisionTypeSchema,
  RuleCardRevisionHashInputSchema,
  RuleCardRevisionSchema,
  RuleCardSchema,
  RuleCardTransitionEventSchema,
} from "../../src/index.js";

describe("Rule Card public schema contract", () => {
  it("keeps review and approval decision vocabularies closed", () => {
    expect(RuleCardReviewDecisionTypeSchema.options).toEqual(["ACCEPTED", "CHANGES_REQUESTED"]);
    expect(RuleCardApprovalDecisionTypeSchema.options).toEqual(["APPROVED", "REJECTED"]);
    expect(RuleCardProvenanceSchema.options).toEqual(["MANUAL", "AI_ASSISTED"]);
  });

  it.each([
    [RuleCardSchema, ["id", "sourceId", "sourceVersionId", "sourceSection", "validationScope"]],
    [RuleCardExceptionSchema, ["id", "key", "description", "rationale", "sourceReference"]],
    [
      RuleGenerationEligibilityRequestSchema,
      [
        "revisionId",
        "generationAt",
        "evaluationDate",
        "expectedRevisionContentHash",
        "expectedSourceContentHash",
        "targetState",
      ],
    ],
    [
      RuleDraftGenerationReferenceSchema,
      [
        "targetState",
        "cardId",
        "cardRevisionId",
        "revisionContentHash",
        "sourceId",
        "sourceVersionId",
        "sourceContentHash",
        "generationAt",
        "evaluationDate",
        "validationScope",
      ],
    ],
    [
      RuleCardEvidenceRequirementSchema,
      ["id", "key", "description", "rationale", "sourceReference"],
    ],
    [
      RuleCardRevisionSchema,
      [
        "id",
        "cardId",
        "revision",
        "sourceId",
        "sourceVersionId",
        "sourceContentHash",
        "sourceSection",
        "normativeActor",
        "object",
        "scope",
        "normativeKey",
        "deonticCategory",
        "exceptions",
        "evidenceRequirements",
        "riskLevel",
        "riskRationale",
        "falsePositiveCost",
        "falsePositiveCostRationale",
        "falseNegativeCost",
        "falseNegativeCostRationale",
        "provenance",
        "provider",
        "validity",
        "createdAt",
        "createdBy",
        "replacesRevisionId",
        "revisionReason",
        "contentHash",
      ],
    ],
    [
      RuleCardCommentSchema,
      [
        "id",
        "revisionId",
        "sequence",
        "actorId",
        "at",
        "revisionContentHash",
        "validationScope",
        "exercisedRole",
        "body",
      ],
    ],
    [
      RuleCardReviewDecisionSchema,
      [
        "id",
        "revisionId",
        "sequence",
        "actorId",
        "at",
        "revisionContentHash",
        "validationScope",
        "exercisedRole",
        "decision",
        "rationale",
      ],
    ],
    [
      RuleCardApprovalDecisionSchema,
      [
        "id",
        "revisionId",
        "sequence",
        "actorId",
        "at",
        "revisionContentHash",
        "validationScope",
        "exercisedRole",
        "decision",
        "rationale",
      ],
    ],
    [
      RuleCardTransitionEventSchema,
      [
        "id",
        "revisionId",
        "sequence",
        "from",
        "to",
        "actorId",
        "exercisedRole",
        "at",
        "revisionContentHash",
        "reason",
        "validationScope",
      ],
    ],
  ] as const)("publishes a required strict object representation", (zodSchema, required) => {
    const schema = z.toJSONSchema(zodSchema);

    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(required);
  });

  it("publishes a separate hash-input boundary without a self-referential digest", () => {
    const schema = z.toJSONSchema(RuleCardRevisionHashInputSchema);

    expect(schema.required).not.toContain("contentHash");
    expect(schema.additionalProperties).toBe(false);
  });

  it("round-trips a stable card without serializing projection state", () => {
    const card = {
      id: "00000000-0000-4000-8000-000000000020",
      sourceId: "00000000-0000-4000-8000-000000000023",
      sourceVersionId: "00000000-0000-4000-8000-000000000024",
      sourceSection: "synthetic-section-1",
      validationScope: "TECHNICAL_DEMO",
    } as const;

    const parsed = RuleCardSchema.parse(JSON.parse(JSON.stringify(card)));

    expect(parsed).toEqual(card);
    expect(parsed).not.toHaveProperty("state");
  });

  it.each([
    ["APPROVED", "APPROVER"],
    ["CHANGES_REQUESTED", "REVIEWER"],
  ] as const)(
    "keeps the projected %s state out of explicit transition events",
    (to, exercisedRole) => {
      expect(
        RuleCardTransitionEventSchema.safeParse({
          id: "00000000-0000-4000-8000-000000000025",
          revisionId: "00000000-0000-4000-8000-000000000024",
          sequence: 3,
          from: "IN_REVIEW",
          to,
          actorId: "00000000-0000-4000-8000-000000000026",
          exercisedRole,
          at: "2026-03-01T00:00:00.000Z",
          revisionContentHash: "a".repeat(64),
          reason: to === "CHANGES_REQUESTED" ? "Synthetic changes requested" : null,
          validationScope: "TECHNICAL_DEMO",
        }).success,
      ).toBe(false);
    },
  );
});
