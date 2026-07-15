import { describe, expect, it } from "vitest";

import {
  EXTRACTOR_ERROR_CODES,
  ExtractorError,
  ExtractorNormalizationError,
  ExtractorValidationError,
} from "../../src/errors.js";

describe("extractor errors", () => {
  it("publishes unique stable codes", () => {
    expect(new Set(EXTRACTOR_ERROR_CODES).size).toBe(EXTRACTOR_ERROR_CODES.length);
  });

  it("keeps code, category, and defensive scalar details", () => {
    const details: Record<string, string | number | null> = { adapterId: "synthetic" };
    const error = new ExtractorValidationError("INVALID_EXTRACTION_REQUEST", "invalid", details);
    details["adapterId"] = "changed";

    expect(error).toBeInstanceOf(ExtractorError);
    expect(error).toMatchObject({
      name: "ExtractorValidationError",
      code: "INVALID_EXTRACTION_REQUEST",
      details: { adapterId: "synthetic" },
    });
  });

  it("uses a dedicated normalization category", () => {
    expect(new ExtractorNormalizationError("invalid")).toMatchObject({
      name: "ExtractorNormalizationError",
      code: "NORMALIZATION_FAILED",
    });
  });
});
