import { describe, expect, it } from "vitest";

import {
  COMPLIANCE_SOURCE_ERROR_CODES,
  ComplianceSourceConflictError,
  ComplianceSourceEligibilityError,
  ComplianceSourceInvariantError,
  ComplianceSourceNotFoundError,
  ComplianceSourceRepositoryError,
  ComplianceSourceValidationError,
} from "../../src/index.js";

describe("compliance source domain errors", () => {
  it("publishes a stable, unique error-code vocabulary", () => {
    expect(new Set(COMPLIANCE_SOURCE_ERROR_CODES).size).toBe(COMPLIANCE_SOURCE_ERROR_CODES.length);
    expect(COMPLIANCE_SOURCE_ERROR_CODES).toContain("TRANSITION_CONCURRENCY_CONFLICT");
  });

  it.each([
    [
      new ComplianceSourceConflictError("SOURCE_ALREADY_EXISTS", "duplicate", { revision: 1 }),
      "ComplianceSourceConflictError",
      "SOURCE_ALREADY_EXISTS",
    ],
    [
      new ComplianceSourceNotFoundError("SOURCE_NOT_FOUND", "missing"),
      "ComplianceSourceNotFoundError",
      "SOURCE_NOT_FOUND",
    ],
    [
      new ComplianceSourceInvariantError("INVALID_REPLACEMENT", "invalid"),
      "ComplianceSourceInvariantError",
      "INVALID_REPLACEMENT",
    ],
    [
      new ComplianceSourceEligibilityError("VERSION_NOT_APPROVED", "blocked"),
      "ComplianceSourceEligibilityError",
      "VERSION_NOT_APPROVED",
    ],
    [
      new ComplianceSourceValidationError("INVALID_SOURCE_PAYLOAD", "malformed"),
      "ComplianceSourceValidationError",
      "INVALID_SOURCE_PAYLOAD",
    ],
  ])("creates %s with its explicit code", (error, name, code) => {
    expect(error).toBeInstanceOf(ComplianceSourceRepositoryError);
    expect(error).toMatchObject({ name, code });
  });

  it("defensively copies error details", () => {
    const details: Record<string, string | number | null> = { sourceId: "synthetic" };
    const error = new ComplianceSourceConflictError("SOURCE_ALREADY_EXISTS", "duplicate", details);

    details["sourceId"] = "changed";

    expect(error.details).toEqual({ sourceId: "synthetic" });
  });
});
