export const EXTRACTOR_ERROR_CODES = [
  "INVALID_EXTRACTION_REQUEST",
  "INVALID_EXTRACTION_OUTPUT",
  "UNSUPPORTED_INPUT_KIND",
  "INVALID_JSON_MAPPING",
  "NORMALIZATION_FAILED",
  "DUPLICATE_FACT_KEY",
  "NORMATIVE_OUTPUT_FORBIDDEN",
] as const;

export type ExtractorErrorCode = (typeof EXTRACTOR_ERROR_CODES)[number];
export type ExtractorErrorDetails = Readonly<Record<string, string | number | null>>;

export class ExtractorError extends Error {
  public readonly code: ExtractorErrorCode;
  public readonly details: ExtractorErrorDetails;

  public constructor(
    code: ExtractorErrorCode,
    message: string,
    details: ExtractorErrorDetails = {},
  ) {
    super(message);
    this.name = "ExtractorError";
    this.code = code;
    this.details = { ...details };
  }
}

export class ExtractorValidationError extends ExtractorError {
  public constructor(
    code:
      | "INVALID_EXTRACTION_REQUEST"
      | "INVALID_EXTRACTION_OUTPUT"
      | "UNSUPPORTED_INPUT_KIND"
      | "INVALID_JSON_MAPPING"
      | "DUPLICATE_FACT_KEY"
      | "NORMATIVE_OUTPUT_FORBIDDEN",
    message: string,
    details: ExtractorErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "ExtractorValidationError";
  }
}

export class ExtractorNormalizationError extends ExtractorError {
  public constructor(message: string, details: ExtractorErrorDetails = {}) {
    super("NORMALIZATION_FAILED", message, details);
    this.name = "ExtractorNormalizationError";
  }
}
