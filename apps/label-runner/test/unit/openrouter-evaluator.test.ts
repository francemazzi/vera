import { describe, expect, it } from "vitest";

import { LABEL_FIELD_CODES } from "../../src/contracts.js";
import { createOpenRouterLabelEvaluator } from "../../src/openrouter-evaluator.js";

const sourceSnapshot = "a".repeat(64);

function responseForAllReview(): Record<string, unknown> {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            controls: LABEL_FIELD_CODES.map((fieldCode) => ({
              fieldCode,
              outcome: "REVIEW",
              rationale: "Synthetic fixture",
              ruleVersion: "eu-v1",
              confidence: 0,
            })),
          }),
        },
      },
    ],
  };
}

describe("OpenRouter label evaluator", () => {
  it("sends a PNG only to OpenRouter and records pinned run metadata", async () => {
    let requestBody: string | undefined;
    const fetch: typeof globalThis.fetch = (_input, init) => {
      requestBody = typeof init?.body === "string" ? init.body : undefined;
      return Promise.resolve(new Response(JSON.stringify(responseForAllReview()), { status: 200 }));
    };
    const evaluator = createOpenRouterLabelEvaluator({
      apiKey: "synthetic-openrouter-key-1234",
      model: "provider/vision-model",
      promptVersion: "label-v1",
      rulePackVersion: "eu-v1",
      sourceSnapshot,
      timeoutMs: 1_000,
      fetch,
    });

    const result = await evaluator.evaluate({
      page: new Uint8Array([137, 80, 78, 71]),
      countryCodes: ["IT", "FR"],
    });

    expect(result).toMatchObject({
      provider: "openrouter",
      model: "provider/vision-model",
      promptVersion: "label-v1",
      rulePackVersion: "eu-v1",
      sourceSnapshot,
    });
    expect(result.controls).toHaveLength(LABEL_FIELD_CODES.length);
    const request = JSON.parse(requestBody ?? "") as Record<string, unknown>;
    expect(request["provider"]).toEqual(
      expect.objectContaining({ allow_fallbacks: false, data_collection: "deny", zdr: true }),
    );
    expect(JSON.stringify(request)).not.toContain("synthetic-openrouter-key-1234");
  });
});
