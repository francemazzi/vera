import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createOpenRouterLabelEvaluator } from "../../src/openrouter-evaluator.js";

const ENABLED =
  process.env["VERA_OPENROUTER_LIVE"] === "1" &&
  process.env["VERA_LABEL_RUNNER_OPENROUTER_LIVE"] === "1";
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==",
  "base64",
);

describe.skipIf(!ENABLED)("Private Label runner OpenRouter smoke", () => {
  it("uses a synthetic PNG and records no credential material", async () => {
    const apiKey = process.env["OPENROUTER_API_KEY"];
    const model = process.env["LABEL_OPENROUTER_MODEL"];
    if (!apiKey || !model)
      throw new Error("OPENROUTER_API_KEY and LABEL_OPENROUTER_MODEL are required");
    const evaluator = createOpenRouterLabelEvaluator({
      apiKey,
      model,
      promptVersion: "label-live-smoke-v1",
      rulePackVersion: "synthetic-live-smoke",
      sourceSnapshot: createHash("sha256").update("synthetic source only", "utf8").digest("hex"),
      timeoutMs: 90_000,
    });

    const result = await evaluator.evaluate({ page: ONE_PIXEL_PNG, countryCodes: ["IT"] });

    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe(model);
    expect(result.controls).toHaveLength(24);
    process.stdout.write(
      `VERA_LABEL_RUNNER_OPENROUTER_SMOKE=${JSON.stringify({
        model: result.model,
        promptVersion: result.promptVersion,
        rulePackVersion: result.rulePackVersion,
        sourceSnapshot: result.sourceSnapshot,
      })}\n`,
    );
  }, 120_000);
});
