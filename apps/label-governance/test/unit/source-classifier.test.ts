import { describe, expect, it } from "vitest";

import {
  SOURCE_CLASSIFICATION_MODEL,
  SOURCE_CLASSIFICATION_PROMPT_VERSION,
} from "../../src/contracts.js";
import {
  createOpenRouterSourceClassifier,
  SourceClassificationError,
} from "../../src/source-classifier.js";

const source = {
  sourceId: "00000000-0000-4000-8000-000000000101",
  sourceVersionId: "00000000-0000-4000-8000-000000000102",
  sourceContentHash: "a".repeat(64),
  canonicalUrl: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169",
  sourceTitle: "Synthetic regulation",
  sourceText: "REGULATION (EU) No 1169/2011. This Regulation shall be binding.",
} as const;

function proposal(): Record<string, unknown> {
  return {
    authority: "European Parliament and Council",
    legalNature: "REGULATION",
    jurisdiction: "European Union",
    language: "it",
    actReference: "Regulation (EU) No 1169/2011",
    revisionLabel: null,
    validFrom: null,
    validTo: null,
    bindingForce: "BINDING",
    productCategories: ["Food"],
    labelingTopics: ["Food information"],
    possibleSupersedes: [],
    possibleDuplicates: [],
    confidence: 0.9,
    evidence: [
      {
        field: "actReference",
        pageNumber: 1,
        quote: "REGULATION (EU) No 1169/2011",
      },
    ],
  };
}

function requestUrlString(value: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof value === "string") return value;
  if (value instanceof URL) return value.href;
  return value.url;
}

function requestBodyString(body: unknown): string {
  if (typeof body === "string") return body;
  throw new Error("expected a JSON string request body");
}

function recordFromJson(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("expected a JSON object request body");
  }
  return parsed as Record<string, unknown>;
}

describe("OpenRouter source classifier", () => {
  it("pins Gemini Pro and requests strict structured output without exposing the server key", async () => {
    let requestUrl: string | undefined;
    let requestInit: RequestInit | undefined;
    const classifier = createOpenRouterSourceClassifier({
      apiKey: "synthetic-openrouter-key-1234",
      timeoutMs: 1_000,
      fetch: (input, init) => {
        requestUrl = requestUrlString(input);
        requestInit = init;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              model: SOURCE_CLASSIFICATION_MODEL,
              choices: [{ message: { content: JSON.stringify(proposal()) } }],
            }),
            { status: 200 },
          ),
        );
      },
    });

    const result = await classifier.classify(source);

    expect(requestUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(requestInit?.headers).toMatchObject({
      Authorization: "Bearer synthetic-openrouter-key-1234",
    });
    const request = recordFromJson(requestBodyString(requestInit?.body));
    expect(request).toMatchObject({
      model: SOURCE_CLASSIFICATION_MODEL,
      temperature: 0,
      reasoning: { max_tokens: 512, exclude: true },
      provider: {
        order: ["google-vertex"],
        allow_fallbacks: false,
        require_parameters: true,
        data_collection: "deny",
        zdr: true,
      },
      response_format: {
        type: "json_schema",
        json_schema: { name: "label_source_classification", strict: true },
      },
    });
    expect(JSON.stringify(request["response_format"])).toContain("additionalProperties");
    expect(JSON.stringify(request)).toContain(source.sourceText);
    expect(JSON.stringify(request)).not.toContain("synthetic-openrouter-key-1234");
    expect(result).toMatchObject({
      model: SOURCE_CLASSIFICATION_MODEL,
      promptVersion: SOURCE_CLASSIFICATION_PROMPT_VERSION,
      proposal: { legalNature: "REGULATION", bindingForce: "BINDING" },
    });
  });

  it("fails closed when the provider reports another model", async () => {
    const classifier = createOpenRouterSourceClassifier({
      apiKey: "key",
      timeoutMs: 1_000,
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              model: "other/model",
              choices: [{ message: { content: JSON.stringify(proposal()) } }],
            }),
            { status: 200 },
          ),
        ),
    });

    await expect(classifier.classify(source)).rejects.toBeInstanceOf(SourceClassificationError);
  });

  it("marks provider saturation as retryable without returning raw provider details", async () => {
    const classifier = createOpenRouterSourceClassifier({
      apiKey: "key",
      timeoutMs: 1_000,
      fetch: () => Promise.resolve(new Response("never expose this body", { status: 429 })),
    });

    await expect(classifier.classify(source)).rejects.toMatchObject({
      retryable: true,
      message: "OpenRouter returned HTTP 429",
    });
  });
});
