import { describe, expect, it, vi } from "vitest";

import { OpenRouterClientError } from "@vera/extractors";

import {
  OPENROUTER_RULE_CARD_DRAFT_SCHEMA_HASH,
  OpenRouterRuleDraftProvider,
  RagProviderModelSchema,
  generateRuleCardDraft,
} from "../../src/index.js";
import type { OpenRouterRagProviderModel, RagError } from "../../src/index.js";
import { retrievedChunk, validDraftOutput } from "../fixtures/rag.js";

const OPENROUTER_MODEL: OpenRouterRagProviderModel = {
  name: "meta-llama/llama-3.1-8b-instruct",
  runtime: "OPENROUTER",
  apiVersion: "v1",
  routingConfigHash: "c".repeat(64),
};

interface FakeChatResult {
  readonly value: {
    readonly model: string;
    readonly content: string;
    readonly generationId: string;
    readonly provider: string | null;
    readonly systemFingerprint: string | null;
    readonly finishReason: string;
    readonly usage: {
      readonly promptTokens: number;
      readonly completionTokens: number;
      readonly totalTokens: number;
      readonly cost: number | null;
    } | null;
  };
  readonly rawOutput: string;
  readonly attempts: number;
}

function successfulChatResult(content: string): FakeChatResult {
  return {
    value: {
      model: OPENROUTER_MODEL.name,
      content,
      generationId: "gen-123",
      provider: "Synthetic upstream",
      systemFingerprint: "fp-123",
      finishReason: "stop",
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cost: 0.00015,
      },
    },
    rawOutput: '{"id":"gen-123"}',
    attempts: 2,
  };
}

describe("OpenRouter Rule Card draft provider", () => {
  it("accepts the OpenRouter identity while preserving the legacy Ollama identity", () => {
    expect(RagProviderModelSchema.parse(OPENROUTER_MODEL)).toEqual(OPENROUTER_MODEL);
    expect(
      RagProviderModelSchema.parse({
        name: "llama3.1:latest",
        digest: "a".repeat(64),
        runtimeVersion: "0.9.0",
      }),
    ).toEqual({
      name: "llama3.1:latest",
      digest: "a".repeat(64),
      runtimeVersion: "0.9.0",
    });
  });

  it("requests strict structured output at temperature zero and exposes audit metadata", async () => {
    const chunk = retrievedChunk();
    const content = JSON.stringify(validDraftOutput(chunk.chunkId));
    const chat = vi.fn().mockResolvedValue(successfulChatResult(content));
    const provider = new OpenRouterRuleDraftProvider({
      client: { model: OPENROUTER_MODEL, chat } as never,
    });

    const result = await provider.generateJson("Draft one synthetic label rule.");

    expect(chat).toHaveBeenCalledTimes(1);
    const request = chat.mock.calls[0]?.[0] as {
      readonly temperature: number;
      readonly messages: readonly { readonly role: string; readonly content: string }[];
      readonly responseFormat: {
        readonly type: string;
        readonly json_schema: {
          readonly name: string;
          readonly strict: boolean;
          readonly schema: Readonly<Record<string, unknown>>;
        };
      };
    };
    expect(request.temperature).toBe(0);
    expect(request.messages).toEqual([
      expect.objectContaining({ role: "system" }),
      { role: "user", content: "Draft one synthetic label rule." },
    ]);
    expect(request.responseFormat).toMatchObject({
      type: "json_schema",
      json_schema: { name: "rule_card_draft_suggestion", strict: true },
    });
    expect(request.responseFormat.json_schema.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(result).toEqual({
      rawOutput: content,
      attempts: 2,
      provider: OPENROUTER_MODEL,
      generationId: "gen-123",
      responseModel: OPENROUTER_MODEL.name,
      upstreamProvider: "Synthetic upstream",
      systemFingerprint: "fp-123",
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cost: 0.00015,
      },
      responseSchemaHash: OPENROUTER_RULE_CARD_DRAFT_SCHEMA_HASH,
    });
  });

  it("propagates OpenRouter metadata into the generation log", async () => {
    const chunk = retrievedChunk();
    const content = JSON.stringify(validDraftOutput(chunk.chunkId));
    const provider = new OpenRouterRuleDraftProvider({
      client: {
        model: OPENROUTER_MODEL,
        chat: vi.fn().mockResolvedValue(successfulChatResult(content)),
      } as never,
    });

    const result = await generateRuleCardDraft({
      instruction: "Draft one synthetic label rule.",
      chunks: [chunk],
      provider,
      generatedAt: "2026-07-15T16:20:00.000Z",
    });

    expect(result.log).toMatchObject({
      provider: OPENROUTER_MODEL,
      generationId: "gen-123",
      responseModel: OPENROUTER_MODEL.name,
      upstreamProvider: "Synthetic upstream",
      systemFingerprint: "fp-123",
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cost: 0.00015,
      },
      responseSchemaHash: OPENROUTER_RULE_CARD_DRAFT_SCHEMA_HASH,
    });
  });

  it("rejects a response attributed to a different model", async () => {
    const response = successfulChatResult("{}");
    const provider = new OpenRouterRuleDraftProvider({
      client: {
        model: OPENROUTER_MODEL,
        chat: vi.fn().mockResolvedValue({
          ...response,
          value: { ...response.value, model: "different/model" },
        }),
      } as never,
    });

    await expect(provider.generateJson("Draft a rule.")).rejects.toMatchObject({
      code: "EGRESS_UNAVAILABLE",
      retryable: false,
    } satisfies Partial<RagError>);
  });

  it("rejects a partial completion even when its content is valid JSON", async () => {
    const response = successfulChatResult(JSON.stringify(validDraftOutput()));
    const provider = new OpenRouterRuleDraftProvider({
      client: {
        model: OPENROUTER_MODEL,
        chat: vi.fn().mockResolvedValue({
          ...response,
          value: { ...response.value, finishReason: "length" },
        }),
      } as never,
    });

    await expect(provider.generateJson("Draft a rule.")).rejects.toMatchObject({
      code: "EGRESS_UNAVAILABLE",
      retryable: false,
    } satisfies Partial<RagError>);
  });

  it("maps unexpected client failures to retryable provider errors", async () => {
    const provider = new OpenRouterRuleDraftProvider({
      client: {
        model: OPENROUTER_MODEL,
        chat: vi.fn().mockRejectedValue(new Error("synthetic transport failure")),
      } as never,
    });

    await expect(provider.generateJson("Draft a rule.")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
    } satisfies Partial<RagError>);
  });

  it("preserves retryability and the normalized code from client errors", async () => {
    const provider = new OpenRouterRuleDraftProvider({
      client: {
        model: OPENROUTER_MODEL,
        chat: vi.fn().mockRejectedValue(
          new OpenRouterClientError("HTTP_ERROR", "OpenRouter request failed with HTTP 429", {
            retryable: true,
            details: { status: 429 },
          }),
        ),
      } as never,
    });

    await expect(provider.generateJson("Draft a rule.")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      details: { openRouterCode: "HTTP_ERROR", status: 429 },
    } satisfies Partial<RagError>);
  });
});
