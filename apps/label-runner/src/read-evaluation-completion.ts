import { OpenRouterLabelEvaluationError } from "./evaluation-error.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Unwraps the single model completion without including label content in v6 errors. */
export function readEvaluationCompletion(response: unknown, isV6: boolean): Record<string, unknown> {
  const choices = record(response)?.["choices"];
  const choice: unknown = Array.isArray(choices) && choices.length === 1 ? choices[0] : undefined;
  const content = record(record(choice)?.["message"])?.["content"];
  const invalidContract = isV6 ? { failureCode: "EVALUATION_CONTRACT_INVALID" as const } : {};
  if (typeof content !== "string" || !content.length || content.length > 200_000) {
    throw new OpenRouterLabelEvaluationError(
      "OpenRouter did not return valid evaluation JSON",
      false,
      invalidContract,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error: unknown) {
    throw new OpenRouterLabelEvaluationError(
      "OpenRouter did not return valid evaluation JSON",
      false,
      isV6 ? invalidContract : { cause: error },
    );
  }
  const parsed = record(value);
  if (!parsed)
    throw new OpenRouterLabelEvaluationError(
      "OpenRouter evaluation JSON must be an object",
      false,
      invalidContract,
    );
  return parsed;
}
