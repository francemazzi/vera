import { createHash } from "node:crypto";

import { sha256Bytes } from "@vera/contracts";
import type { ExtractionRequest } from "@vera/contracts";
import { describe, expect, it } from "vitest";

import { OPENROUTER_CHAT_MODEL, OpenRouterClient, OpenRouterLlmAdapter } from "../../src/index.js";

const ENABLED = process.env["VERA_OPENROUTER_LIVE"] === "1";
const TEXT = "This is a synthetic transport fixture with no document facts to extract.";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000741";

function rawOutputHash(value: string | null): string {
  if (value === null) throw new Error("An OpenRouter live run must retain its raw output");
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe.skipIf(!ENABLED)("OpenRouter live synthetic smoke", () => {
  it("runs the pinned text adapter without exposing credentials", async () => {
    const apiKey = process.env["OPENROUTER_API_KEY"];
    if (apiKey === undefined || apiKey.trim().length === 0) {
      throw new Error(
        "OPENROUTER_API_KEY is required when VERA_OPENROUTER_LIVE=1; load the ignored .env file",
      );
    }
    const client = new OpenRouterClient({ apiKey, timeoutMs: 60_000, maxRetries: 1 });
    const adapter = new OpenRouterLlmAdapter({
      id: "openrouter.live.llm",
      client,
      prompt:
        "This is a transport and schema smoke test, not an accuracy evaluation. Return exactly one JSON object whose facts array is empty.",
      seed: 42,
      maxTokens: 512,
    });
    const documentHash = sha256Bytes(new TextEncoder().encode(TEXT));
    const request: ExtractionRequest = {
      id: "00000000-0000-4000-8000-000000000742",
      adapterId: adapter.id,
      kind: "OPENROUTER_LLM",
      inputHash: documentHash,
      requestedAt: "2026-07-16T00:00:00.000Z",
      input: {
        kind: "OPENROUTER_LLM",
        documentId: DOCUMENT_ID,
        documentHash,
        page: 1,
        language: "en",
        text: TEXT,
      },
      validationScope: "TECHNICAL_DEMO",
    };

    const result = await adapter.extract(request);

    expect(result.facts).toEqual([]);
    expect(result.evidence).toEqual([]);
    expect(result.run.model).toMatchObject({
      name: OPENROUTER_CHAT_MODEL,
      runtime: "OPENROUTER",
      apiVersion: "v1",
    });
    expect(result.run.options["generationId"]).toEqual(expect.any(String));
    expect(result.run.options["formatSchemaHash"]).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.run.rawOutput).not.toContain(apiKey);

    process.stdout.write(
      `VERA_OPENROUTER_SMOKE=${JSON.stringify({
        validationScope: "TECHNICAL_DEMO",
        model: OPENROUTER_CHAT_MODEL,
        runtime: "OPENROUTER",
        upstreamProvider: result.run.options["upstreamProvider"],
        rawOutputSha256: rawOutputHash(result.run.rawOutput),
        formatSchemaSha256: result.run.options["formatSchemaHash"],
        routingConfigSha256: result.run.options["routingConfigHash"],
      })}\n`,
    );
  }, 90_000);
});
