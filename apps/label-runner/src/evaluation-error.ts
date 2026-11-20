export class OpenRouterLabelEvaluationError extends Error {
  public readonly failureCode?: "EVALUATION_CONTRACT_INVALID";

  public constructor(
    message: string,
    public readonly retryable: boolean,
    options: {
      readonly cause?: unknown;
      readonly failureCode?: "EVALUATION_CONTRACT_INVALID";
    } = {},
  ) {
    super(message, options);
    this.name = "OpenRouterLabelEvaluationError";
    if (options.failureCode) this.failureCode = options.failureCode;
  }
}
