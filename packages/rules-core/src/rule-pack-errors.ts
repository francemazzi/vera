export const RULE_PACK_ERROR_CODES = [
  "INVALID_RULE_PACK_DRAFT_PAYLOAD",
  "INVALID_RULE_PACK_VERSION_PAYLOAD",
  "INVALID_RULE_PACK_CLONE_REQUEST",
  "INVALID_RULE_PACK_PUBLISH_REQUEST",
  "RULE_PACK_DRAFT_ALREADY_EXISTS",
  "RULE_PACK_DRAFT_NOT_FOUND",
  "RULE_PACK_VERSION_NOT_FOUND",
  "RULE_PACK_VERSION_ALREADY_EXISTS",
  "RULE_PACK_VERSION_ALREADY_PUBLISHED",
  "RULE_PACK_DRAFT_REVISION_CONFLICT",
  "RULE_PACK_DRAFT_REVISION_NOT_MONOTONIC",
  "RULE_PACK_DRAFT_IDENTITY_MISMATCH",
  "RULE_PACK_DRAFT_TIME_NOT_MONOTONIC",
  "RULE_PACK_VERSION_NOT_MONOTONIC",
  "RULE_PACK_SCOPE_MISMATCH",
  "RULE_PACK_OVERLAP_NOT_DECLARED",
  "RULE_PACK_SUPERSESSION_INVALID",
  "RULE_PACK_RULE_DUPLICATE",
  "RULE_PACK_RULE_ORDER_INVALID",
  "RULE_PACK_RULE_RELATION_INVALID",
  "RULE_PACK_OVERRIDE_CYCLE",
  "RULE_PACK_RULE_OUTSIDE_VALIDITY",
  "RULE_PACK_RULE_NOT_ELIGIBLE",
  "RULE_PACK_AUTHOR_NOT_AUTHORIZED",
  "RULE_PACK_PUBLISHER_NOT_AUTHORIZED",
  "RULE_PACK_ACTIVATOR_NOT_AUTHORIZED",
  "RULE_PACK_ACTIVATION_OUTSIDE_VALIDITY",
  "RULE_PACK_TEST_GATE_FAILED",
  "RULE_PACK_HASH_MISMATCH",
  "RULE_PACK_PUBLISH_TIME_INVALID",
  "INVALID_ACTIVATION_EVENT",
  "INVALID_RULE_PACK_RESOLUTION_REQUEST",
  "ACTIVATION_EVENT_ALREADY_EXISTS",
  "ACTIVATION_PACK_NOT_FOUND",
  "ACTIVATION_VERSION_NOT_FOUND",
  "ACTIVATION_CONCURRENCY_CONFLICT",
  "ACTIVATION_SEQUENCE_MISMATCH",
  "ACTIVATION_TIME_NOT_MONOTONIC",
  "ACTIVATION_VERSION_MISMATCH",
  "ACTIVATION_NOT_AUTHORIZED",
  "ACTIVATION_OVERLAP_AMBIGUOUS",
  "RULE_PACK_RESOLUTION_NOT_FOUND",
  "RULE_PACK_RESOLUTION_AMBIGUOUS",
] as const;

export type RulePackErrorCode = (typeof RULE_PACK_ERROR_CODES)[number];

export type RulePackErrorDetails = Readonly<Record<string, string | number | null>>;

export class RulePackRepositoryError extends Error {
  public readonly code: RulePackErrorCode;
  public readonly details: RulePackErrorDetails;

  public constructor(code: RulePackErrorCode, message: string, details: RulePackErrorDetails = {}) {
    super(message);
    this.name = "RulePackRepositoryError";
    this.code = code;
    this.details = { ...details };
  }
}

export class RulePackValidationError extends RulePackRepositoryError {
  public constructor(
    code:
      | "INVALID_RULE_PACK_DRAFT_PAYLOAD"
      | "INVALID_RULE_PACK_VERSION_PAYLOAD"
      | "INVALID_RULE_PACK_CLONE_REQUEST"
      | "INVALID_RULE_PACK_PUBLISH_REQUEST",
    message: string,
    details: RulePackErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "RulePackValidationError";
  }
}

export class RulePackConflictError extends RulePackRepositoryError {
  public constructor(
    code:
      | "RULE_PACK_DRAFT_ALREADY_EXISTS"
      | "RULE_PACK_VERSION_ALREADY_EXISTS"
      | "RULE_PACK_VERSION_ALREADY_PUBLISHED"
      | "RULE_PACK_DRAFT_REVISION_CONFLICT",
    message: string,
    details: RulePackErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "RulePackConflictError";
  }
}

export class RulePackNotFoundError extends RulePackRepositoryError {
  public constructor(
    code: "RULE_PACK_DRAFT_NOT_FOUND" | "RULE_PACK_VERSION_NOT_FOUND",
    message: string,
    details: RulePackErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "RulePackNotFoundError";
  }
}

export class RulePackInvariantError extends RulePackRepositoryError {
  public constructor(
    code:
      | "RULE_PACK_VERSION_NOT_MONOTONIC"
      | "RULE_PACK_DRAFT_REVISION_NOT_MONOTONIC"
      | "RULE_PACK_DRAFT_IDENTITY_MISMATCH"
      | "RULE_PACK_DRAFT_TIME_NOT_MONOTONIC"
      | "RULE_PACK_SCOPE_MISMATCH"
      | "RULE_PACK_OVERLAP_NOT_DECLARED"
      | "RULE_PACK_SUPERSESSION_INVALID"
      | "RULE_PACK_RULE_DUPLICATE"
      | "RULE_PACK_RULE_ORDER_INVALID"
      | "RULE_PACK_RULE_RELATION_INVALID"
      | "RULE_PACK_OVERRIDE_CYCLE"
      | "RULE_PACK_RULE_OUTSIDE_VALIDITY"
      | "RULE_PACK_HASH_MISMATCH"
      | "RULE_PACK_PUBLISH_TIME_INVALID",
    message: string,
    details: RulePackErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "RulePackInvariantError";
  }
}

export class RulePackEligibilityError extends RulePackRepositoryError {
  public constructor(
    code:
      | "RULE_PACK_RULE_NOT_ELIGIBLE"
      | "RULE_PACK_AUTHOR_NOT_AUTHORIZED"
      | "RULE_PACK_PUBLISHER_NOT_AUTHORIZED"
      | "RULE_PACK_ACTIVATOR_NOT_AUTHORIZED"
      | "RULE_PACK_ACTIVATION_OUTSIDE_VALIDITY"
      | "RULE_PACK_TEST_GATE_FAILED",
    message: string,
    details: RulePackErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "RulePackEligibilityError";
  }
}

export class RulePackActivationValidationError extends RulePackRepositoryError {
  public constructor(
    code: "INVALID_ACTIVATION_EVENT" | "INVALID_RULE_PACK_RESOLUTION_REQUEST",
    message: string,
    details: RulePackErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "RulePackActivationValidationError";
  }
}

export class RulePackActivationConflictError extends RulePackRepositoryError {
  public constructor(
    code: "ACTIVATION_EVENT_ALREADY_EXISTS" | "ACTIVATION_CONCURRENCY_CONFLICT",
    message: string,
    details: RulePackErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "RulePackActivationConflictError";
  }
}

export class RulePackActivationNotFoundError extends RulePackRepositoryError {
  public constructor(
    code:
      | "ACTIVATION_PACK_NOT_FOUND"
      | "ACTIVATION_VERSION_NOT_FOUND"
      | "RULE_PACK_RESOLUTION_NOT_FOUND",
    message: string,
    details: RulePackErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "RulePackActivationNotFoundError";
  }
}

export class RulePackActivationInvariantError extends RulePackRepositoryError {
  public constructor(
    code:
      | "ACTIVATION_SEQUENCE_MISMATCH"
      | "ACTIVATION_TIME_NOT_MONOTONIC"
      | "ACTIVATION_VERSION_MISMATCH"
      | "ACTIVATION_NOT_AUTHORIZED"
      | "ACTIVATION_OVERLAP_AMBIGUOUS"
      | "RULE_PACK_RESOLUTION_AMBIGUOUS",
    message: string,
    details: RulePackErrorDetails = {},
  ) {
    super(code, message, details);
    this.name = "RulePackActivationInvariantError";
  }
}
