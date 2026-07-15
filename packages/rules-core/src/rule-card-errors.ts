export const RULE_CARD_ERROR_CODES = [
  "INVALID_RULE_CARD_PAYLOAD",
  "INVALID_RULE_CARD_REVISION_PAYLOAD",
  "INVALID_RULE_CARD_TRANSITION_PAYLOAD",
  "INVALID_RULE_CARD_COMMENT_PAYLOAD",
  "INVALID_REVIEW_DECISION_PAYLOAD",
  "INVALID_APPROVAL_DECISION_PAYLOAD",
  "INVALID_RULE_GENERATION_REQUEST",
  "INVALID_RULE_CARD_ACTIVATION_REQUEST",
  "RULE_CARD_ALREADY_EXISTS",
  "RULE_CARD_NOT_FOUND",
  "RULE_CARD_REVISION_ALREADY_EXISTS",
  "RULE_CARD_REVISION_NOT_FOUND",
  "RULE_CARD_REVISION_CONFLICT",
  "RULE_CARD_REVISION_NOT_MONOTONIC",
  "INVALID_RULE_CARD_REVISION_REPLACEMENT",
  "AUDIT_RECORD_ALREADY_EXISTS",
  "AUDIT_SEQUENCE_CONFLICT",
  "AUDIT_RECORD_MISMATCH",
  "AUDIT_TIME_NOT_MONOTONIC",
  "RULE_CARD_TRANSITION_NOT_AUTHORIZED",
  "SOURCE_VERSION_MISMATCH",
  "SOURCE_VERSION_NOT_APPROVED",
  "DECISION_NOT_AUTHORIZED",
  "DECISION_NOT_ALLOWED",
  "DUPLICATE_REVIEW_DECISION",
  "DUPLICATE_APPROVAL_DECISION",
  "REVIEW_ACCEPTANCE_REQUIRED",
  "APPROVAL_QUORUM_NOT_MET",
  "BLOCKING_DECISION_PRESENT",
  "RULE_CARD_REVISION_NOT_APPROVED",
  "RULE_CARD_REVISION_SUPERSEDED",
  "RULE_CARD_CONTENT_HASH_MISMATCH",
] as const;

export type RuleCardErrorCode = (typeof RULE_CARD_ERROR_CODES)[number];
export type RuleCardErrorDetails = Readonly<Record<string, string | number | null>>;

export class RuleCardRepositoryError extends Error {
  public readonly code: RuleCardErrorCode;
  public readonly details: RuleCardErrorDetails;

  public constructor(code: RuleCardErrorCode, message: string, details: RuleCardErrorDetails = {}) {
    super(message);
    this.name = "RuleCardRepositoryError";
    this.code = code;
    this.details = { ...details };
  }
}

export class RuleCardValidationError extends RuleCardRepositoryError {
  public constructor(
    code:
      | "INVALID_RULE_CARD_PAYLOAD"
      | "INVALID_RULE_CARD_REVISION_PAYLOAD"
      | "INVALID_RULE_CARD_TRANSITION_PAYLOAD"
      | "INVALID_RULE_CARD_COMMENT_PAYLOAD"
      | "INVALID_REVIEW_DECISION_PAYLOAD"
      | "INVALID_APPROVAL_DECISION_PAYLOAD"
      | "INVALID_RULE_GENERATION_REQUEST"
      | "INVALID_RULE_CARD_ACTIVATION_REQUEST",
    message: string,
    details: RuleCardErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "RuleCardValidationError";
  }
}

export class RuleCardConflictError extends RuleCardRepositoryError {
  public constructor(
    code:
      | "RULE_CARD_ALREADY_EXISTS"
      | "RULE_CARD_REVISION_ALREADY_EXISTS"
      | "RULE_CARD_REVISION_CONFLICT"
      | "AUDIT_RECORD_ALREADY_EXISTS"
      | "AUDIT_SEQUENCE_CONFLICT"
      | "DUPLICATE_REVIEW_DECISION"
      | "DUPLICATE_APPROVAL_DECISION",
    message: string,
    details: RuleCardErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "RuleCardConflictError";
  }
}

export class RuleCardNotFoundError extends RuleCardRepositoryError {
  public constructor(
    code: "RULE_CARD_NOT_FOUND" | "RULE_CARD_REVISION_NOT_FOUND",
    message: string,
    details: RuleCardErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "RuleCardNotFoundError";
  }
}

export class RuleCardInvariantError extends RuleCardRepositoryError {
  public constructor(
    code:
      | "RULE_CARD_REVISION_NOT_MONOTONIC"
      | "INVALID_RULE_CARD_REVISION_REPLACEMENT"
      | "AUDIT_RECORD_MISMATCH"
      | "AUDIT_TIME_NOT_MONOTONIC"
      | "RULE_CARD_TRANSITION_NOT_AUTHORIZED"
      | "SOURCE_VERSION_MISMATCH"
      | "SOURCE_VERSION_NOT_APPROVED"
      | "DECISION_NOT_AUTHORIZED"
      | "DECISION_NOT_ALLOWED",
    message: string,
    details: RuleCardErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "RuleCardInvariantError";
  }
}

export class RuleCardEligibilityError extends RuleCardRepositoryError {
  public constructor(
    code:
      | "REVIEW_ACCEPTANCE_REQUIRED"
      | "APPROVAL_QUORUM_NOT_MET"
      | "BLOCKING_DECISION_PRESENT"
      | "RULE_CARD_REVISION_NOT_APPROVED"
      | "RULE_CARD_REVISION_SUPERSEDED"
      | "RULE_CARD_CONTENT_HASH_MISMATCH"
      | "SOURCE_VERSION_MISMATCH"
      | "SOURCE_VERSION_NOT_APPROVED",
    message: string,
    details: RuleCardErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "RuleCardEligibilityError";
  }
}
