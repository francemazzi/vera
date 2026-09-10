import type { OpenRouterLabelModel } from "./contracts.js";

const MODEL_PRICING_USD_PER_TOKEN: Record<
  OpenRouterLabelModel,
  Readonly<{ input: number; output: number }>
> = {
  "google/gemini-2.5-flash": { input: 0.0000003, output: 0.0000025 },
  "google/gemini-3.7-flash": { input: 0.00000075, output: 0.00000375 },
  "openai/gpt-5.6-sol": { input: 0.000002, output: 0.00001 },
};

/** Records provider usage, falling back to configured token-price estimates. */
export function usageFromResponse(
  value: unknown,
  latencyMs: number,
  model: OpenRouterLabelModel,
): {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly estimatedCostUsd: number | null;
  readonly latencyMs: number;
} {
  const usage =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)["usage"]
      : undefined;
  const source =
    typeof usage === "object" && usage !== null && !Array.isArray(usage)
      ? (usage as Record<string, unknown>)
      : {};
  const nonNegativeInteger = (value: unknown): number | null =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const inputTokens = nonNegativeInteger(source["prompt_tokens"] ?? source["input_tokens"]);
  const outputTokens = nonNegativeInteger(source["completion_tokens"] ?? source["output_tokens"]);
  const totalTokens = nonNegativeInteger(source["total_tokens"]);
  const pricing = MODEL_PRICING_USD_PER_TOKEN[model];
  const estimatedCostUsd =
    inputTokens === null || outputTokens === null
      ? null
      : inputTokens * pricing.input + outputTokens * pricing.output;
  return { inputTokens, outputTokens, totalTokens, estimatedCostUsd, latencyMs };
}
