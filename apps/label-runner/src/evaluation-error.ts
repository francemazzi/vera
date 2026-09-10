export class OpenRouterLabelEvaluationError extends Error {
  public constructor(
    message: string,
    public readonly retryable: boolean,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "OpenRouterLabelEvaluationError";
  }
}
