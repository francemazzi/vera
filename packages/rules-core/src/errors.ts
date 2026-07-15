export const COMPLIANCE_SOURCE_ERROR_CODES = [
  "INVALID_SOURCE_PAYLOAD",
  "INVALID_VERSION_PAYLOAD",
  "INVALID_TRANSITION_PAYLOAD",
  "INVALID_STATE_AT",
  "INVALID_ELIGIBILITY_REQUEST",
  "SOURCE_ALREADY_EXISTS",
  "SOURCE_NOT_FOUND",
  "VERSION_ALREADY_EXISTS",
  "VERSION_NOT_FOUND",
  "VERSION_REVISION_CONFLICT",
  "REVISION_NOT_MONOTONIC",
  "INVALID_REPLACEMENT",
  "TRANSITION_ALREADY_EXISTS",
  "TRANSITION_CONCURRENCY_CONFLICT",
  "TRANSITION_EVENT_MISMATCH",
  "TRANSITION_TIME_NOT_MONOTONIC",
  "TRANSITION_NOT_AUTHORIZED",
  "CONTENT_HASH_MISMATCH",
  "VERSION_NOT_APPROVED",
  "VERSION_OUTSIDE_VALIDITY",
] as const;

export type ComplianceSourceErrorCode = (typeof COMPLIANCE_SOURCE_ERROR_CODES)[number];

export type ComplianceSourceErrorDetails = Readonly<Record<string, string | number | null>>;

export class ComplianceSourceRepositoryError extends Error {
  public readonly code: ComplianceSourceErrorCode;
  public readonly details: ComplianceSourceErrorDetails;

  public constructor(
    code: ComplianceSourceErrorCode,
    message: string,
    details: ComplianceSourceErrorDetails = {},
  ) {
    super(message);
    this.name = "ComplianceSourceRepositoryError";
    this.code = code;
    this.details = { ...details };
  }
}

export class ComplianceSourceValidationError extends ComplianceSourceRepositoryError {
  public constructor(
    code:
      | "INVALID_SOURCE_PAYLOAD"
      | "INVALID_VERSION_PAYLOAD"
      | "INVALID_TRANSITION_PAYLOAD"
      | "INVALID_STATE_AT"
      | "INVALID_ELIGIBILITY_REQUEST",
    message: string,
    details: ComplianceSourceErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "ComplianceSourceValidationError";
  }
}

export class ComplianceSourceConflictError extends ComplianceSourceRepositoryError {
  public constructor(
    code:
      | "SOURCE_ALREADY_EXISTS"
      | "VERSION_ALREADY_EXISTS"
      | "VERSION_REVISION_CONFLICT"
      | "TRANSITION_ALREADY_EXISTS"
      | "TRANSITION_CONCURRENCY_CONFLICT",
    message: string,
    details: ComplianceSourceErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "ComplianceSourceConflictError";
  }
}

export class ComplianceSourceNotFoundError extends ComplianceSourceRepositoryError {
  public constructor(
    code: "SOURCE_NOT_FOUND" | "VERSION_NOT_FOUND",
    message: string,
    details: ComplianceSourceErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "ComplianceSourceNotFoundError";
  }
}

export class ComplianceSourceInvariantError extends ComplianceSourceRepositoryError {
  public constructor(
    code:
      | "REVISION_NOT_MONOTONIC"
      | "INVALID_REPLACEMENT"
      | "TRANSITION_EVENT_MISMATCH"
      | "TRANSITION_TIME_NOT_MONOTONIC"
      | "TRANSITION_NOT_AUTHORIZED",
    message: string,
    details: ComplianceSourceErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "ComplianceSourceInvariantError";
  }
}

export class ComplianceSourceEligibilityError extends ComplianceSourceRepositoryError {
  public constructor(
    code: "CONTENT_HASH_MISMATCH" | "VERSION_NOT_APPROVED" | "VERSION_OUTSIDE_VALIDITY",
    message: string,
    details: ComplianceSourceErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "ComplianceSourceEligibilityError";
  }
}
