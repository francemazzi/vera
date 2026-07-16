import { describe, expect, it } from "vitest";

import { sha256CanonicalJson } from "@vera/contracts";
import { OPENROUTER_CHAT_MODEL, OpenRouterClient } from "@vera/extractors";

import { OpenRouterRuleDraftProvider, RuleCardDraftSuggestionSchema } from "../../src/index.js";
import { validDraftOutput } from "../fixtures/rag.js";

const LIVE_ENABLED = process.env["VERA_OPENROUTER_LIVE"] === "1";

function requireApiKey(): string {
  const apiKey = process.env["OPENROUTER_API_KEY"]?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("VERA_OPENROUTER_LIVE=1 requires OPENROUTER_API_KEY");
  }
  return apiKey;
}

describe("OpenRouter RAG live smoke", () => {
  it("generates a schema-valid synthetic Rule Card draft with the pinned model", async () => {
    if (!LIVE_ENABLED) {
      const limitation = {
        available: false,
        limitation: "OpenRouter RAG live smoke is opt-in via VERA_OPENROUTER_LIVE=1.",
      };
      expect(sha256CanonicalJson(limitation)).toMatch(/^[0-9a-f]{64}$/u);
      return;
    }

    const expectedDraft = RuleCardDraftSuggestionSchema.parse(
      validDraftOutput("synthetic-openrouter-chunk-1"),
    );
    const apiKey = requireApiKey();
    const client = new OpenRouterClient({
      apiKey,
      timeoutMs: 45_000,
      maxRetries: 1,
    });
    const provider = new OpenRouterRuleDraftProvider({ client });
    const result = await provider.generateJson(
      `Return exactly this synthetic RuleCardDraftSuggestion as JSON without markdown:\n${JSON.stringify(expectedDraft)}`,
    );
    const decoded: unknown = JSON.parse(result.rawOutput) as unknown;
    const draft = RuleCardDraftSuggestionSchema.parse(decoded);

    expect(provider.model.name).toBe(OPENROUTER_CHAT_MODEL);
    expect(result.provider).toEqual(client.model);
    expect(result.responseModel).toBe(OPENROUTER_CHAT_MODEL);
    expect(result.generationId).toMatch(/\S/u);
    expect(result.responseSchemaHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.rawOutput).not.toContain(apiKey);
    expect(draft).toMatchObject({
      targetState: "DRAFT",
      validationScope: "TECHNICAL_DEMO",
      provenance: "AI_ASSISTED",
    });
    expect(sha256CanonicalJson({ rawOutput: result.rawOutput })).toMatch(/^[0-9a-f]{64}$/u);
  }, 120_000);
});
