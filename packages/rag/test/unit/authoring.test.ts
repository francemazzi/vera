import { describe, expect, it } from "vitest";

import {
  RetryingRuleDraftProvider,
  buildRuleCardDraftPrompt,
  createRuleCardWorkflowAdvancementRequest,
  generateRuleCardDraft,
} from "../../src/index.js";
import { StaticDraftProvider, retrievedChunk, validDraftOutput } from "../fixtures/rag.js";

const GENERATED_AT = "2026-07-15T16:20:00.000Z";

describe("Rule Card draft authoring", () => {
  it("generates only DRAFT suggestions and records prompt/model/citations", async () => {
    const chunk = retrievedChunk();
    const result = await generateRuleCardDraft({
      instruction: "Draft one synthetic label rule.",
      chunks: [chunk],
      provider: new StaticDraftProvider(validDraftOutput(chunk.chunkId)),
      generatedAt: GENERATED_AT,
    });

    expect(result.draft.targetState).toBe("DRAFT");
    expect(result.requiresHumanConfirmation).toBe(true);
    expect(result.log.promptHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.log.citations).toHaveLength(1);
  });

  it("rejects provider output that tries to make a rule operational", async () => {
    const chunk = retrievedChunk();
    await expect(
      generateRuleCardDraft({
        instruction: "Draft one synthetic label rule.",
        chunks: [chunk],
        provider: new StaticDraftProvider({
          ...(validDraftOutput(chunk.chunkId) as Record<string, unknown>),
          targetState: "APPROVED",
        }),
        generatedAt: GENERATED_AT,
      }),
    ).rejects.toThrow();
  });

  it("rejects unsupported citation references", async () => {
    const chunk = retrievedChunk();
    await expect(
      generateRuleCardDraft({
        instruction: "Draft one synthetic label rule.",
        chunks: [chunk],
        provider: new StaticDraftProvider(validDraftOutput("missing-chunk")),
        generatedAt: GENERATED_AT,
      }),
    ).rejects.toThrow("unknown citation");
  });

  it("requires human confirmation for workflow advancement", () => {
    const draft = validDraftOutput(retrievedChunk().chunkId);
    const result = createRuleCardWorkflowAdvancementRequest(draft as never);

    expect(result).toMatchObject({
      draftTargetState: "DRAFT",
      requestedNextState: "IN_REVIEW",
      requiresHumanConfirmation: true,
      rationaleRequired: true,
    });
  });

  it("retries transient draft provider failures", async () => {
    const chunk = retrievedChunk();
    const provider = new RetryingRuleDraftProvider(
      new StaticDraftProvider(validDraftOutput(chunk.chunkId), 1),
      { maxRetries: 1, retryDelayMs: 0 },
    );
    const result = await generateRuleCardDraft({
      instruction: "Draft one synthetic label rule.",
      chunks: [chunk],
      provider,
      generatedAt: GENERATED_AT,
    });

    expect(result.log.attempts).toBe(2);
  });

  it("includes explicit draft-only instructions in prompts", () => {
    const prompt = buildRuleCardDraftPrompt({
      instruction: "Draft one synthetic label rule.",
      chunks: [retrievedChunk()],
    });

    expect(prompt).toContain('The only allowed targetState is "DRAFT"');
    expect(prompt).toContain("Never produce");
  });
});
