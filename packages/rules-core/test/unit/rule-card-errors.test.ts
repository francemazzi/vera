import { describe, expect, it } from "vitest";

import {
  RULE_CARD_ERROR_CODES,
  RuleCardConflictError,
  RuleCardEligibilityError,
  RuleCardInvariantError,
  RuleCardNotFoundError,
  RuleCardRepositoryError,
  RuleCardValidationError,
} from "../../src/index.js";

describe("Rule Card domain errors", () => {
  it("publishes a stable, unique error-code vocabulary", () => {
    expect(new Set(RULE_CARD_ERROR_CODES).size).toBe(RULE_CARD_ERROR_CODES.length);
    expect(RULE_CARD_ERROR_CODES).toContain("APPROVAL_QUORUM_NOT_MET");
    expect(RULE_CARD_ERROR_CODES).toContain("RULE_CARD_CONTENT_HASH_MISMATCH");
  });

  it.each([
    [
      new RuleCardValidationError("INVALID_RULE_CARD_PAYLOAD", "malformed"),
      "RuleCardValidationError",
      "INVALID_RULE_CARD_PAYLOAD",
    ],
    [
      new RuleCardConflictError("RULE_CARD_ALREADY_EXISTS", "duplicate"),
      "RuleCardConflictError",
      "RULE_CARD_ALREADY_EXISTS",
    ],
    [
      new RuleCardNotFoundError("RULE_CARD_NOT_FOUND", "missing"),
      "RuleCardNotFoundError",
      "RULE_CARD_NOT_FOUND",
    ],
    [
      new RuleCardInvariantError("SOURCE_VERSION_MISMATCH", "detached"),
      "RuleCardInvariantError",
      "SOURCE_VERSION_MISMATCH",
    ],
    [
      new RuleCardEligibilityError("APPROVAL_QUORUM_NOT_MET", "blocked"),
      "RuleCardEligibilityError",
      "APPROVAL_QUORUM_NOT_MET",
    ],
  ])("creates %s with an explicit name and code", (error, name, code) => {
    expect(error).toBeInstanceOf(RuleCardRepositoryError);
    expect(error).toMatchObject({ name, code });
  });

  it("defensively copies structured error details", () => {
    const details: Record<string, string | number | null> = {
      revisionId: "synthetic-revision",
      requiredApprovals: 2,
    };
    const error = new RuleCardEligibilityError("APPROVAL_QUORUM_NOT_MET", "blocked", details);

    details["requiredApprovals"] = 1;

    expect(error.details).toEqual({
      revisionId: "synthetic-revision",
      requiredApprovals: 2,
    });
  });
});
