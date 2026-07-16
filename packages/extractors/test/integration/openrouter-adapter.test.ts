import { sha256Bytes } from "@vera/contracts";
import type { ExtractionRequest } from "@vera/contracts";
import { describe, expect, it } from "vitest";

import type { ExtractorRuntime } from "../../src/adapter.js";
import { OpenRouterLlmAdapter } from "../../src/openrouter-adapter.js";
import {
  OPENROUTER_CHAT_MODEL,
  OPENROUTER_PROVIDER_POLICY,
  OpenRouterClient,
} from "../../src/openrouter-client.js";
import type { OpenRouterChatRequest } from "../../src/openrouter-client.js";

const SYNTHETIC_KEY = "synthetic-openrouter-test-token-value";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000701";
const REQUEST_ID = "00000000-0000-4000-8000-000000000702";
const TEXT = "Synthetic label appears in this neutral fixture.";
const DOCUMENT_HASH = sha256Bytes(new TextEncoder().encode(TEXT));
const STARTED_AT = "2026-07-16T09:00:00.000Z";
const COMPLETED_AT = "2026-07-16T09:00:00.010Z";

function mockFetch(
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  const transport: typeof fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return handler(url, init ?? {});
  };
  return transport;
}

function jsonResponse(
  value: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function successfulChat(content: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "gen-synthetic-openrouter",
    object: "chat.completion",
    created: 1_768_467_600,
    model: OPENROUTER_CHAT_MODEL,
    provider: "DeepInfra",
    openrouter_metadata: {
      endpoints: {
        available: [{ provider: "Synthetic routed provider", selected: true }],
      },
    },
    system_fingerprint: null,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
        native_finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 10,
      total_tokens: 30,
      cost: 0.000001,
    },
    ...overrides,
  };
}

function factOutput(): string {
  return JSON.stringify({
    facts: [
      {
        key: "record.label",
        valueType: "STRING",
        status: "RESOLVED",
        originalValue: " Synthetic label ",
        normalizedValue: "Synthetic label",
        rawConfidence: 0.75,
        evidence: [
          {
            text: "Synthetic label",
            boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
          },
        ],
        candidates: [],
      },
    ],
  });
}

function request(adapterId = "openrouter.llm"): ExtractionRequest {
  return {
    id: REQUEST_ID,
    adapterId,
    kind: "OPENROUTER_LLM",
    inputHash: DOCUMENT_HASH,
    requestedAt: STARTED_AT,
    input: {
      kind: "OPENROUTER_LLM",
      documentId: DOCUMENT_ID,
      documentHash: DOCUMENT_HASH,
      page: 1,
      language: "en",
      text: TEXT,
    },
    validationScope: "TECHNICAL_DEMO",
  };
}

function runtime(ids: readonly string[]): ExtractorRuntime {
  let idIndex = 0;
  let timeIndex = 0;
  const times = [STARTED_AT, COMPLETED_AT] as const;
  return {
    createId: () => {
      const id = ids[idIndex];
      if (id === undefined) throw new Error("Synthetic runtime exhausted its IDs");
      idIndex += 1;
      return id;
    },
    now: () => {
      const value = times[timeIndex];
      if (value === undefined) throw new Error("Synthetic runtime exhausted its timestamps");
      timeIndex += 1;
      return value;
    },
    runtimeVersion: "node-synthetic",
  };
}

describe("OpenRouterClient", () => {
  it("rejects missing credentials and invalid bounds before network I/O", () => {
    for (const options of [
      { apiKey: "" },
      { apiKey: "short" },
      { apiKey: SYNTHETIC_KEY, maxRetries: 4 },
      { apiKey: SYNTHETIC_KEY, maxResponseBytes: 2_000_001 },
    ]) {
      expect(() => new OpenRouterClient(options)).toThrow(
        expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
      );
    }
  });

  it("validates strict schemas at runtime while accepting the full extractor text boundary", async () => {
    let calls = 0;
    const client = new OpenRouterClient({
      apiKey: SYNTHETIC_KEY,
      maxRetries: 0,
      fetch: mockFetch(() => {
        calls += 1;
        return jsonResponse(successfulChat('{"ok":true}'));
      }),
    });
    const invalid = {
      messages: [{ role: "user", content: "Synthetic invalid schema." }],
      responseFormat: {
        type: "json_schema",
        json_schema: { name: "invalid", strict: false, schema: { type: "object" } },
      },
      temperature: 0,
    } as unknown as OpenRouterChatRequest;
    await expect(client.chat(invalid)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(calls).toBe(0);

    await expect(
      client.chat({
        messages: [{ role: "user", content: "x".repeat(2_000_100) }],
        responseFormat: { type: "json_object" },
        temperature: 0,
      }),
    ).resolves.toMatchObject({ attempts: 1 });
    expect(calls).toBe(1);
  });

  it("sends one pinned, private structured-output request and normalizes metadata", async () => {
    let receivedBody: Record<string, unknown> | null = null;
    let receivedAuthorization: string | null = null;
    const client = new OpenRouterClient({
      apiKey: SYNTHETIC_KEY,
      maxRetries: 0,
      fetch: mockFetch((url, init) => {
        expect(url.href).toBe("https://openrouter.ai/api/v1/chat/completions");
        expect(init.method).toBe("POST");
        const headers = new Headers(init.headers);
        receivedAuthorization = headers.get("authorization");
        expect(headers.get("x-openrouter-metadata")).toBe("enabled");
        if (typeof init.body !== "string") throw new Error("Expected a JSON string request body");
        receivedBody = JSON.parse(init.body) as Record<string, unknown>;
        return jsonResponse(successfulChat('{"ok":true}'));
      }),
    });

    const result = await client.chat({
      messages: [{ role: "user", content: "Return a synthetic JSON object." }],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "synthetic_smoke",
          strict: true,
          schema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
            additionalProperties: false,
          },
        },
      },
      temperature: 0,
      seed: 42,
      maxTokens: 32,
    });

    expect(receivedAuthorization).toBe(`Bearer ${SYNTHETIC_KEY}`);
    expect(receivedBody).toMatchObject({
      model: OPENROUTER_CHAT_MODEL,
      stream: false,
      temperature: 0,
      seed: 42,
      max_tokens: 32,
      provider: OPENROUTER_PROVIDER_POLICY,
      response_format: { type: "json_schema" },
    });
    expect(result).toMatchObject({
      attempts: 1,
      value: {
        model: OPENROUTER_CHAT_MODEL,
        content: '{"ok":true}',
        generationId: "gen-synthetic-openrouter",
        provider: "Synthetic routed provider",
        systemFingerprint: null,
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30, cost: 0.000001 },
      },
    });
    expect(client.model).toMatchObject({
      name: OPENROUTER_CHAT_MODEL,
      runtime: "OPENROUTER",
      apiVersion: "v1",
    });
    expect(client.model.routingConfigHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("retries bounded transient failures while never retrying authentication failures", async () => {
    let transientRequests = 0;
    const transientStatuses = [429, 520] as const;
    const retrying = new OpenRouterClient({
      apiKey: SYNTHETIC_KEY,
      maxRetries: 2,
      retryDelayMs: 0,
      fetch: mockFetch(() => {
        transientRequests += 1;
        const status = transientStatuses[transientRequests - 1];
        return status === undefined
          ? jsonResponse(successfulChat('{"ok":true}'))
          : jsonResponse(
              { error: { message: "busy" } },
              status,
              status === 429 ? { "retry-after": "0" } : {},
            );
      }),
    });
    const result = await retrying.chat({
      messages: [{ role: "user", content: "Synthetic retry." }],
      responseFormat: { type: "json_object" },
      temperature: 0,
    });
    expect(result.attempts).toBe(3);

    let authRequests = 0;
    const unauthorized = new OpenRouterClient({
      apiKey: SYNTHETIC_KEY,
      maxRetries: 3,
      retryDelayMs: 0,
      fetch: mockFetch(() => {
        authRequests += 1;
        return jsonResponse({ error: { message: "unauthorized" } }, 401);
      }),
    });
    await expect(
      unauthorized.chat({
        messages: [{ role: "user", content: "Synthetic auth failure." }],
        responseFormat: { type: "json_object" },
        temperature: 0,
      }),
    ).rejects.toMatchObject({ code: "HTTP_ERROR", retryable: false });
    expect(authRequests).toBe(1);
  });

  it("rejects model substitution, API errors hidden behind HTTP 200 and oversized bodies", async () => {
    const cases = [
      {
        response: () => jsonResponse(successfulChat('{"ok":true}', { model: "openrouter/auto" })),
        code: "MODEL_MISMATCH",
      },
      {
        response: () => jsonResponse({ error: { message: "synthetic error", code: 429 } }),
        code: "HTTP_ERROR",
        retryable: true,
      },
      {
        response: () =>
          jsonResponse(
            successfulChat('{"partial":true}', {
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: '{"partial":true}' },
                  finish_reason: "error",
                  error: { code: 502, message: "upstream interrupted" },
                },
              ],
            }),
          ),
        code: "HTTP_ERROR",
        retryable: true,
      },
      {
        response: () => new Response("x".repeat(101), { status: 200 }),
        code: "RESPONSE_TOO_LARGE",
        maxResponseBytes: 100,
      },
    ] as const;
    for (const testCase of cases) {
      const client = new OpenRouterClient({
        apiKey: SYNTHETIC_KEY,
        maxRetries: 0,
        ...("maxResponseBytes" in testCase ? { maxResponseBytes: testCase.maxResponseBytes } : {}),
        fetch: mockFetch(testCase.response),
      });
      await expect(
        client.chat({
          messages: [{ role: "user", content: "Synthetic invalid response." }],
          responseFormat: { type: "json_object" },
          temperature: 0,
        }),
      ).rejects.toMatchObject({
        code: testCase.code,
        ...("retryable" in testCase ? { retryable: testCase.retryable } : {}),
      });
    }
  });

  it("turns aborted fetches into sanitized timeout errors", async () => {
    const client = new OpenRouterClient({
      apiKey: SYNTHETIC_KEY,
      timeoutMs: 1,
      maxRetries: 0,
      fetch: mockFetch(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      ),
    });
    let captured: unknown;
    try {
      await client.chat({
        messages: [{ role: "user", content: "Synthetic timeout." }],
        responseFormat: { type: "json_object" },
        temperature: 0,
      });
    } catch (error) {
      captured = error;
    }
    expect(captured).toMatchObject({ code: "TIMEOUT", retryable: true });
    expect(String(captured)).not.toContain(SYNTHETIC_KEY);
  });
});

describe("OpenRouterLlmAdapter", () => {
  it("materializes facts and records auditable routing metadata", async () => {
    const adapter = new OpenRouterLlmAdapter({
      id: "openrouter.llm",
      client: new OpenRouterClient({
        apiKey: SYNTHETIC_KEY,
        maxRetries: 0,
        fetch: mockFetch(() => jsonResponse(successfulChat(factOutput()))),
      }),
      seed: 42,
      maxTokens: 2048,
      runtime: runtime([
        "00000000-0000-4000-8000-000000000711",
        "00000000-0000-4000-8000-000000000712",
        "00000000-0000-4000-8000-000000000713",
      ]),
    });

    const result = await adapter.extract(request(adapter.id));

    expect(adapter.supports("OPENROUTER_LLM")).toBe(true);
    expect(adapter.supports("OLLAMA_LLM")).toBe(false);
    expect(result.facts[0]).toMatchObject({
      key: "record.label",
      normalizedValue: "Synthetic label",
      evidenceIds: [result.evidence[0]?.id],
    });
    expect(result.run).toMatchObject({
      kind: "OPENROUTER_LLM",
      model: {
        name: OPENROUTER_CHAT_MODEL,
        runtime: "OPENROUTER",
        apiVersion: "v1",
      },
      options: {
        temperature: 0,
        seed: 42,
        maxTokens: 2048,
        transportAttempts: 1,
        generationId: "gen-synthetic-openrouter",
        upstreamProvider: "Synthetic routed provider",
        dataCollection: "deny",
        zeroDataRetention: true,
      },
    });
    expect(result.run.prompt).toContain("Do not emit Markdown");
    expect(result.run.rawOutput).not.toContain(SYNTHETIC_KEY);
  });

  it("rejects tampered requests before egress", async () => {
    let calls = 0;
    const adapter = new OpenRouterLlmAdapter({
      id: "openrouter.llm",
      client: new OpenRouterClient({
        apiKey: SYNTHETIC_KEY,
        fetch: mockFetch(() => {
          calls += 1;
          return jsonResponse(successfulChat(factOutput()));
        }),
      }),
    });
    await expect(
      adapter.extract({ ...request(adapter.id), inputHash: "f".repeat(64) }),
    ).rejects.toMatchObject({ code: "INVALID_EXTRACTION_REQUEST" });
    expect(calls).toBe(0);
  });

  it.each([
    ['{"facts":[],"outcome":"PASS"}', "NORMATIVE_OUTPUT_FORBIDDEN"],
    ['{"facts":[{"key":"incomplete"}]}', "INVALID_EXTRACTION_OUTPUT"],
    ["not-json", "INVALID_EXTRACTION_OUTPUT"],
  ])("rejects unsafe or malformed model output %#", async (content, code) => {
    const adapter = new OpenRouterLlmAdapter({
      id: "openrouter.llm",
      client: new OpenRouterClient({
        apiKey: SYNTHETIC_KEY,
        maxRetries: 0,
        fetch: mockFetch(() => jsonResponse(successfulChat(content))),
      }),
      runtime: runtime(["00000000-0000-4000-8000-000000000721"]),
    });
    await expect(adapter.extract(request(adapter.id))).rejects.toMatchObject({ code });
  });

  it("rejects truncated completions before parsing facts", async () => {
    const response = successfulChat(factOutput()) as Record<string, unknown>;
    response["choices"] = [
      {
        index: 0,
        message: { role: "assistant", content: factOutput() },
        finish_reason: "length",
      },
    ];
    const adapter = new OpenRouterLlmAdapter({
      id: "openrouter.llm",
      client: new OpenRouterClient({
        apiKey: SYNTHETIC_KEY,
        maxRetries: 0,
        fetch: mockFetch(() => jsonResponse(response)),
      }),
      runtime: runtime(["00000000-0000-4000-8000-000000000731"]),
    });
    await expect(adapter.extract(request(adapter.id))).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});
