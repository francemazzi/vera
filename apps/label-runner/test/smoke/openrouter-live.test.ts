import { describe, expect, it } from "vitest";

import { createOpenRouterLabelEvaluator } from "../../src/openrouter-evaluator.js";
import { fallbackRegulatoryScope } from "../../src/source-retriever.js";
import { LABEL_FIELD_CODES } from "../../src/contracts.js";
import { preliminaryTemplate, sourceSnapshot } from "../fixtures/preliminary-template.js";

const ENABLED =
  process.env["VERA_OPENROUTER_LIVE"] === "1" &&
  process.env["VERA_LABEL_RUNNER_OPENROUTER_LIVE"] === "1";
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==",
  "base64",
);

describe.skipIf(!ENABLED)("Private preliminary label service OpenRouter smoke", () => {
  it("uses a synthetic PNG and records no credential material", async () => {
    const apiKey = process.env["OPENROUTER_API_KEY"];
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");
    const evaluator = createOpenRouterLabelEvaluator({
      apiKey,
      model: "google/gemini-3.7-flash",
      promptVersion: "label-evaluation-v1",
      rulePackVersion: "eu-it-preliminary-v1@1",
      sourceSnapshot,
      timeoutMs: 90_000,
    });

    const result = await evaluator.evaluate({
      pages: [{ page: 1, bytes: ONE_PIXEL_PNG }],
      countryCodes: ["IT"],
      productCategory: "generic-prepacked",
      regulatoryScope: fallbackRegulatoryScope({ countryCodes: ["IT"] }),
      sources: {
        controls: LABEL_FIELD_CODES.map((fieldCode) => ({ fieldCode, citations: [] })),
        sourceSnapshot,
      },
      template: preliminaryTemplate,
    });

    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe("google/gemini-3.7-flash");
    expect(result.controls).toHaveLength(24);
    process.stdout.write(
      `LABEL_PRELIMINARY_OPENROUTER_SMOKE=${JSON.stringify({
        model: result.model,
        promptVersion: result.promptVersion,
        rulePackVersion: result.rulePackVersion,
        sourceSnapshot: result.sourceSnapshot,
      })}\n`,
    );
  }, 120_000);
});
