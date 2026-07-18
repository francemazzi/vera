import { LABEL_FIELD_CODES, RunnerEvaluationSchema } from "./contracts.js";
import type { RunnerEvaluation } from "./contracts.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

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

export interface LabelEvaluator {
  evaluate(input: {
    readonly page: Uint8Array;
    readonly countryCodes: readonly string[];
  }): Promise<RunnerEvaluation>;
}

function jsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["controls"],
    properties: {
      controls: {
        type: "array",
        minItems: LABEL_FIELD_CODES.length,
        maxItems: LABEL_FIELD_CODES.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fieldCode", "outcome", "rationale", "ruleVersion", "confidence"],
          properties: {
            fieldCode: { type: "string", enum: LABEL_FIELD_CODES },
            countryCode: { type: "string" },
            outcome: { type: "string", enum: ["PASS", "FAIL", "REVIEW", "NOT_APPLICABLE"] },
            rationale: { type: "string" },
            sourceCitation: { type: "string" },
            ruleVersion: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
    },
  };
}

function prompt(countryCodes: readonly string[], rulePackVersion: string): string {
  return [
    "You evaluate a food-label image under the supplied, versioned SILTO rule pack.",
    `Selected EU markets: ${countryCodes.join(", ")}. Rule pack: ${rulePackVersion}.`,
    "Return each listed field code exactly once. Use REVIEW whenever the image or applicable rule evidence is insufficient; never infer PASS from missing information.",
    "The result is a technical assessment, not a certification. Keep rationale concise and cite the applicable rule/source identifier when available.",
  ].join("\n");
}

function responseContent(value: unknown): string {
  if (typeof value !== "object" || value === null)
    throw new OpenRouterLabelEvaluationError("OpenRouter returned an invalid response", false);
  const rawChoices = (value as Record<string, unknown>)["choices"];
  if (!Array.isArray(rawChoices) || rawChoices.length !== 1) {
    throw new OpenRouterLabelEvaluationError("OpenRouter returned no single completion", false);
  }
  const choices = rawChoices as readonly unknown[];
  const choice = choices[0];
  if (typeof choice !== "object" || choice === null) {
    throw new OpenRouterLabelEvaluationError("OpenRouter completion is invalid", false);
  }
  const message = (choice as Record<string, unknown>)["message"];
  if (typeof message !== "object" || message === null) {
    throw new OpenRouterLabelEvaluationError("OpenRouter completion message is invalid", false);
  }
  const content = (message as Record<string, unknown>)["content"];
  if (typeof content !== "string" || content.length === 0 || content.length > 200_000) {
    throw new OpenRouterLabelEvaluationError("OpenRouter completion content is invalid", false);
  }
  return content;
}

export function createOpenRouterLabelEvaluator(options: {
  readonly apiKey: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly rulePackVersion: string;
  readonly sourceSnapshot: string;
  readonly timeoutMs: number;
  readonly fetch?: typeof fetch;
}): LabelEvaluator {
  const fetchImplementation = options.fetch ?? fetch;
  return {
    async evaluate(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, options.timeoutMs);
      try {
        const response = await fetchImplementation(OPENROUTER_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: options.model,
            temperature: 0,
            provider: { allow_fallbacks: false, data_collection: "deny", zdr: true },
            response_format: {
              type: "json_schema",
              json_schema: { name: "silto_label_evaluation", strict: true, schema: jsonSchema() },
            },
            messages: [
              { role: "system", content: prompt(input.countryCodes, options.rulePackVersion) },
              {
                role: "user",
                content: [
                  { type: "text", text: "Evaluate the attached normalized page-1 PNG." },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:image/png;base64,${Buffer.from(input.page).toString("base64")}`,
                    },
                  },
                ],
              },
            ],
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new OpenRouterLabelEvaluationError(
            `OpenRouter returned HTTP ${String(response.status)}`,
            response.status === 408 ||
              response.status === 409 ||
              response.status === 429 ||
              response.status >= 500,
          );
        }
        const body: unknown = await response.json();
        let parsed: unknown;
        try {
          parsed = JSON.parse(responseContent(body));
        } catch (error) {
          throw new OpenRouterLabelEvaluationError(
            "OpenRouter did not return valid evaluation JSON",
            false,
            {
              cause: error,
            },
          );
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new OpenRouterLabelEvaluationError(
            "OpenRouter evaluation JSON must be an object",
            false,
          );
        }
        const evaluation = RunnerEvaluationSchema.parse({
          provider: "openrouter",
          model: options.model,
          promptVersion: options.promptVersion,
          rulePackVersion: options.rulePackVersion,
          sourceSnapshot: options.sourceSnapshot,
          ...(parsed as Record<string, unknown>),
        });
        return evaluation;
      } catch (error) {
        if (error instanceof OpenRouterLabelEvaluationError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new OpenRouterLabelEvaluationError("OpenRouter request timed out", true, {
            cause: error,
          });
        }
        throw new OpenRouterLabelEvaluationError("OpenRouter request failed", true, {
          cause: error,
        });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
