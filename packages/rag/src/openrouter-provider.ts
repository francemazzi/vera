import { sha256CanonicalJson } from "@vera/contracts";
import { OpenRouterClientError } from "@vera/extractors";
import type { OpenRouterClient } from "@vera/extractors";

import { RagError } from "./errors.js";
import type { RuleDraftProvider, RuleDraftProviderResult } from "./providers.js";
import { OpenRouterRagProviderModelSchema, RuleCardDraftSuggestionSchema } from "./types.js";
import type { OpenRouterRagProviderModel } from "./types.js";

export interface OpenRouterRagProviderOptions {
  readonly client: OpenRouterClient;
}

function createRuleCardDraftJsonSchema(): Readonly<Record<string, unknown>> {
  const generated = RuleCardDraftSuggestionSchema.toJSONSchema({ target: "draft-07" });
  const schema = structuredClone(generated);
  delete schema.$schema;
  return Object.freeze(schema);
}

const RULE_CARD_DRAFT_JSON_SCHEMA = createRuleCardDraftJsonSchema();
export const OPENROUTER_RULE_CARD_DRAFT_SCHEMA_HASH = sha256CanonicalJson(
  RULE_CARD_DRAFT_JSON_SCHEMA,
);

function mapOpenRouterError(error: unknown): RagError {
  if (error instanceof RagError) return error;
  if (error instanceof OpenRouterClientError) {
    return new RagError(
      error.retryable ? "PROVIDER_UNAVAILABLE" : "EGRESS_UNAVAILABLE",
      error.message,
      {
        cause: error,
        retryable: error.retryable,
        details: { openRouterCode: error.code, ...error.details },
      },
    );
  }
  return new RagError("PROVIDER_UNAVAILABLE", "OpenRouter provider failed", {
    cause: error,
    retryable: true,
  });
}

export class OpenRouterRuleDraftProvider implements RuleDraftProvider {
  public readonly model: OpenRouterRagProviderModel;
  readonly #client: OpenRouterClient;

  public constructor(options: OpenRouterRagProviderOptions) {
    this.#client = options.client;
    const model = OpenRouterRagProviderModelSchema.safeParse(options.client.model);
    if (!model.success) {
      throw new RagError(
        "CONFIGURATION_INVALID",
        "OpenRouter client model identity is invalid for RAG",
        { details: { issueCount: model.error.issues.length } },
      );
    }
    this.model = model.data;
  }

  public async generateJson(prompt: string): Promise<RuleDraftProviderResult> {
    try {
      const result = await this.#client.chat({
        messages: [
          {
            role: "system",
            content:
              "You draft editorial Rule Cards only. Return strict JSON. Never produce approval or compliance outcomes.",
          },
          { role: "user", content: prompt },
        ],
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "rule_card_draft_suggestion",
            strict: true,
            schema: RULE_CARD_DRAFT_JSON_SCHEMA,
          },
        },
        temperature: 0,
      });

      if (result.value.model !== this.model.name) {
        throw new RagError("EGRESS_UNAVAILABLE", "OpenRouter returned an unexpected model", {
          details: { expectedModel: this.model.name, responseModel: result.value.model },
        });
      }
      if (result.value.finishReason !== "stop") {
        throw new RagError("EGRESS_UNAVAILABLE", "OpenRouter draft did not complete normally", {
          details: { finishReason: result.value.finishReason },
        });
      }

      return {
        rawOutput: result.value.content,
        attempts: result.attempts,
        provider: this.model,
        generationId: result.value.generationId,
        responseModel: result.value.model,
        upstreamProvider: result.value.provider,
        systemFingerprint: result.value.systemFingerprint,
        usage: result.value.usage,
        responseSchemaHash: OPENROUTER_RULE_CARD_DRAFT_SCHEMA_HASH,
      };
    } catch (error) {
      throw mapOpenRouterError(error);
    }
  }
}
