export type RagErrorCode =
  | "CONFIGURATION_INVALID"
  | "DIMENSION_MISMATCH"
  | "DRAFT_INVALID"
  | "EGRESS_UNAVAILABLE"
  | "INDEX_REJECTED"
  | "PROVIDER_UNAVAILABLE"
  | "QUERY_INVALID"
  | "RETRY_EXHAUSTED";

export class RagError extends Error {
  public readonly code: RagErrorCode;
  public readonly details: Readonly<Record<string, unknown>>;
  public readonly retryable: boolean;

  public constructor(
    code: RagErrorCode,
    message: string,
    options: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly retryable?: boolean;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "RagError";
    this.code = code;
    this.details = Object.freeze({ ...(options.details ?? {}) });
    this.retryable = options.retryable ?? false;
  }
}
