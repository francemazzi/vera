import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { sha256CanonicalJson } from "@vera/contracts";
import type { ExtractionRequest, JsonValue } from "@vera/contracts";
import { describe, expect, it } from "vitest";

import type { ExtractorRuntime } from "../../src/adapter.js";
import {
  OllamaEmbeddingAdapter,
  OllamaLlmAdapter,
  OllamaOcrAdapter,
  OllamaVisionAdapter,
} from "../../src/ollama-adapters.js";
import { OllamaClient } from "../../src/ollama-client.js";

type MockHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

interface MockServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

async function startMockServer(handler: MockHandler): Promise<MockServer> {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch((error: unknown) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : "Mock server failure");
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, value: unknown, status = 200): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
}

function chatResponse(content: string): Record<string, unknown> {
  return {
    model: "synthetic-chat:1",
    created_at: "2026-07-15T09:00:00.000Z",
    message: { role: "assistant", content, thinking: "", images: [], tool_calls: [] },
    done: true,
    done_reason: "stop",
    total_duration: 10,
    logprobs: [],
  };
}

const FIXTURE = {
  documentId: "00000000-0000-4000-8000-000000000101",
  documentHash: "d".repeat(64),
  requestOcr: "00000000-0000-4000-8000-000000000201",
  requestVision: "00000000-0000-4000-8000-000000000202",
  requestLlm: "00000000-0000-4000-8000-000000000203",
  requestEmbedding: "00000000-0000-4000-8000-000000000204",
  modelDigest: "a".repeat(64),
  startedAt: "2026-07-15T09:00:00.000Z",
  completedAt: "2026-07-15T09:00:00.010Z",
} as const;

const MODEL = {
  name: "synthetic-chat:1",
  digest: FIXTURE.modelDigest,
  runtimeVersion: "0.9.6-synthetic",
} as const;

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const JPEG_1X1_BASE64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=";

interface ModelInspectionFixture {
  readonly version?: string;
  readonly models?: readonly {
    readonly name: string;
    readonly model: string;
    readonly digest: string;
  }[];
}

function handleModelInspection(
  request: IncomingMessage,
  response: ServerResponse,
  fixture: ModelInspectionFixture = {},
): boolean {
  if (request.url === "/api/version") {
    sendJson(response, { version: fixture.version ?? MODEL.runtimeVersion });
    return true;
  }
  if (request.url === "/api/tags") {
    sendJson(response, {
      models: fixture.models ?? [
        { name: MODEL.name, model: MODEL.name, digest: MODEL.digest },
        { name: "synthetic-embed:1", model: "synthetic-embed:1", digest: MODEL.digest },
      ],
    });
    return true;
  }
  return false;
}

function fixtureRuntime(ids: readonly string[]): ExtractorRuntime {
  let idIndex = 0;
  let timeIndex = 0;
  const timestamps = [FIXTURE.startedAt, FIXTURE.completedAt] as const;
  return {
    createId: () => {
      const id = ids[idIndex];
      if (id === undefined) throw new Error("Synthetic runtime exhausted its IDs");
      idIndex += 1;
      return id;
    },
    now: () => {
      const timestamp = timestamps[timeIndex];
      if (timestamp === undefined) throw new Error("Synthetic runtime exhausted its timestamps");
      if (timeIndex === 1 && idIndex !== ids.length) {
        throw new Error("Completion was sampled before Ollama output materialization");
      }
      timeIndex += 1;
      return timestamp;
    },
    runtimeVersion: "node-synthetic",
  };
}

function simpleFactOutput(): string {
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

function factRequest(
  kind: "OLLAMA_LLM" | "OLLAMA_OCR" | "OLLAMA_VISION",
  adapterId: string,
): ExtractionRequest {
  const common = {
    adapterId,
    kind,
    inputHash: FIXTURE.documentHash,
    requestedAt: FIXTURE.startedAt,
    validationScope: "TECHNICAL_DEMO" as const,
  };
  switch (kind) {
    case "OLLAMA_OCR":
      return {
        ...common,
        id: FIXTURE.requestOcr,
        kind,
        input: {
          kind,
          documentId: FIXTURE.documentId,
          documentHash: FIXTURE.documentHash,
          page: 1,
          language: "en",
          mediaType: "image/png",
          imageBase64: PNG_1X1_BASE64,
        },
      };
    case "OLLAMA_VISION":
      return {
        ...common,
        id: FIXTURE.requestVision,
        kind,
        input: {
          kind,
          documentId: FIXTURE.documentId,
          documentHash: FIXTURE.documentHash,
          page: 1,
          language: "en",
          mediaType: "image/jpeg",
          imageBase64: JPEG_1X1_BASE64,
        },
      };
    case "OLLAMA_LLM":
      return {
        ...common,
        id: FIXTURE.requestLlm,
        kind,
        input: {
          kind,
          documentId: FIXTURE.documentId,
          documentHash: FIXTURE.documentHash,
          page: 1,
          language: "en",
          text: "Synthetic label appears in this neutral fixture.",
        },
      };
  }
}

describe("OllamaClient integration", () => {
  it("keeps the transport byte budget within the shared raw output contract", () => {
    expect(() => new OllamaClient({ maxResponseBytes: 2_000_000 })).not.toThrow();
    expect(() => new OllamaClient({ maxResponseBytes: 2_000_001 })).toThrow(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  });

  it("calls the local chat and embed endpoints with non-streaming strict responses", async () => {
    const received: Array<{ readonly path: string; readonly body: Record<string, unknown> }> = [];
    const server = await startMockServer(async (request, response) => {
      const body = await readJsonBody(request);
      received.push({ path: request.url ?? "", body });
      if (request.url === "/api/chat") {
        sendJson(response, chatResponse('{"facts":[]}'));
        return;
      }
      sendJson(response, {
        model: "synthetic-embed:1",
        embeddings: [
          [0.25, -0.5],
          [1, 0],
        ],
        total_duration: 5,
      });
    });

    try {
      const client = new OllamaClient({ baseUrl: server.baseUrl, maxRetries: 0 });
      const chat = await client.chat({
        model: "synthetic-chat:1",
        messages: [{ role: "user", content: "Return synthetic facts" }],
        format: "json",
      });
      const embed = await client.embed({
        model: "synthetic-embed:1",
        input: ["alpha", "beta"],
      });

      expect(chat).toMatchObject({
        attempts: 1,
        value: { model: "synthetic-chat:1", content: '{"facts":[]}' },
      });
      expect(JSON.parse(chat.rawOutput)).toMatchObject({ done: true });
      expect(embed.value.embeddings).toEqual([
        [0.25, -0.5],
        [1, 0],
      ]);
      expect(received).toHaveLength(2);
      expect(received[0]).toMatchObject({ path: "/api/chat", body: { stream: false } });
      expect(received[1]).toMatchObject({ path: "/api/embed" });
      expect(received[1]?.body).not.toHaveProperty("stream");
    } finally {
      await server.close();
    }
  });

  it("rejects invalid or unexpectedly extended transport schemas without retry", async () => {
    let requests = 0;
    const server = await startMockServer((_request, response) => {
      requests += 1;
      sendJson(response, { ...chatResponse("{}"), unexpected: true });
    });

    try {
      const client = new OllamaClient({
        baseUrl: server.baseUrl,
        maxRetries: 2,
        retryDelayMs: 0,
      });
      await expect(
        client.chat({
          model: "synthetic-chat:1",
          messages: [{ role: "user", content: "Return JSON" }],
        }),
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: false });
      expect(requests).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("rejects non-JSON options before any network request", async () => {
    let requests = 0;
    const server = await startMockServer((_request, response) => {
      requests += 1;
      sendJson(response, chatResponse('{"facts":[]}'));
    });

    try {
      const client = new OllamaClient({ baseUrl: server.baseUrl, maxRetries: 0 });
      const invalidValues: readonly unknown[] = [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        undefined,
        (): void => undefined,
      ];
      for (const invalidValue of invalidValues) {
        await expect(
          client.chat({
            model: "synthetic-chat:1",
            messages: [{ role: "user", content: "Return JSON" }],
            options: { invalidValue },
          }),
        ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      }
      const malformedRequests = [{ options: null }, { options: [] }, { format: [] }] as const;
      for (const malformed of malformedRequests) {
        const request = {
          model: "synthetic-chat:1",
          messages: [{ role: "user", content: "Return JSON" }],
          ...malformed,
        } as unknown as Parameters<OllamaClient["chat"]>[0];
        await expect(client.chat(request)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      }
      expect(requests).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("stops a chunked response as soon as the streaming byte budget is exceeded", async () => {
    let chunksSent = 0;
    const server = await startMockServer((_request, response) => {
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.write('{"padding":"');
      const interval = setInterval(() => {
        chunksSent += 1;
        response.write("x".repeat(16));
        if (chunksSent === 100) response.end('"}');
      }, 2);
      response.once("close", () => {
        clearInterval(interval);
      });
    });

    try {
      const client = new OllamaClient({
        baseUrl: server.baseUrl,
        maxResponseBytes: 64,
        maxRetries: 0,
      });
      await expect(
        client.chat({
          model: "synthetic-chat:1",
          messages: [{ role: "user", content: "Return JSON" }],
        }),
      ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
      expect(chunksSent).toBeLessThan(100);
    } finally {
      await server.close();
    }
  });

  it("retries only within the configured budget for transient HTTP failures", async () => {
    let requests = 0;
    const server = await startMockServer((_request, response) => {
      requests += 1;
      if (requests === 1) {
        sendJson(response, { error: "synthetic overload" }, 503);
        return;
      }
      sendJson(response, chatResponse("{}"));
    });

    try {
      const client = new OllamaClient({
        baseUrl: server.baseUrl,
        maxRetries: 1,
        retryDelayMs: 0,
      });
      await expect(
        client.chat({
          model: "synthetic-chat:1",
          messages: [{ role: "user", content: "Return JSON" }],
        }),
      ).resolves.toMatchObject({ attempts: 2 });
      expect(requests).toBe(2);
    } finally {
      await server.close();
    }
  });

  it("reports timeout explicitly", async () => {
    const server = await startMockServer((_request, response) => {
      setTimeout(() => {
        sendJson(response, chatResponse("{}"));
      }, 80);
    });

    try {
      const client = new OllamaClient({
        baseUrl: server.baseUrl,
        timeoutMs: 10,
        maxRetries: 0,
      });
      await expect(
        client.chat({
          model: "synthetic-chat:1",
          messages: [{ role: "user", content: "Return JSON" }],
        }),
      ).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
    } finally {
      await server.close();
    }
  });

  it("reports a locally unavailable Ollama endpoint explicitly", async () => {
    const server = await startMockServer((_request, response) => {
      sendJson(response, {});
    });
    const baseUrl = server.baseUrl;
    await server.close();
    const client = new OllamaClient({ baseUrl, timeoutMs: 100, maxRetries: 0 });

    await expect(
      client.embed({ model: "synthetic-embed:1", input: "synthetic input" }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE", retryable: true });
  });
});

describe("Ollama ExtractorAdapter integration", () => {
  it("rejects invalid adapter options during construction", () => {
    const invalidOptions: readonly unknown[] = [{ temperature: Number.NaN }, null, []];
    for (const value of invalidOptions) {
      const options = value as Readonly<Record<string, JsonValue>>;
      expect(
        () =>
          new OllamaLlmAdapter({
            id: "ollama.invalid-options",
            client: new OllamaClient({ maxRetries: 0 }),
            model: MODEL,
            options,
          }),
      ).toThrow(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
    }
  });

  it("materializes strict facts and evidence for OCR, vision and LLM adapters", async () => {
    const receivedBodies: Record<string, unknown>[] = [];
    const server = await startMockServer(async (request, response) => {
      if (handleModelInspection(request, response)) return;
      receivedBodies.push(await readJsonBody(request));
      sendJson(response, chatResponse(simpleFactOutput()));
    });

    try {
      const client = new OllamaClient({ baseUrl: server.baseUrl, maxRetries: 0 });
      const adapters = [
        new OllamaOcrAdapter({
          id: "ollama.ocr",
          client,
          model: MODEL,
          runtime: fixtureRuntime([
            "00000000-0000-4000-8000-000000000301",
            "00000000-0000-4000-8000-000000000302",
            "00000000-0000-4000-8000-000000000303",
          ]),
        }),
        new OllamaVisionAdapter({
          id: "ollama.vision",
          client,
          model: MODEL,
          options: { seed: 42 },
          runtime: fixtureRuntime([
            "00000000-0000-4000-8000-000000000311",
            "00000000-0000-4000-8000-000000000312",
            "00000000-0000-4000-8000-000000000313",
          ]),
        }),
        new OllamaLlmAdapter({
          id: "ollama.llm",
          client,
          model: MODEL,
          prompt: "Extract neutral synthetic facts.",
          runtime: fixtureRuntime([
            "00000000-0000-4000-8000-000000000321",
            "00000000-0000-4000-8000-000000000322",
            "00000000-0000-4000-8000-000000000323",
          ]),
        }),
      ] as const;
      const requests = [
        factRequest("OLLAMA_OCR", "ollama.ocr"),
        factRequest("OLLAMA_VISION", "ollama.vision"),
        factRequest("OLLAMA_LLM", "ollama.llm"),
      ] as const;

      for (const [index, adapter] of adapters.entries()) {
        const request = requests[index];
        if (request === undefined) throw new Error("Missing synthetic request");
        const result = await adapter.extract(request);

        expect(adapter.supports(adapter.kind)).toBe(true);
        expect(adapter.supports("OLLAMA_EMBEDDING")).toBe(false);
        expect(result.requestId).toBe(request.id);
        expect(result.facts).toHaveLength(1);
        expect(result.evidence).toHaveLength(1);
        expect(result.embeddings).toEqual([]);
        expect(result.facts[0]).toMatchObject({
          key: "record.label",
          normalizedValue: "Synthetic label",
          evidenceIds: [result.evidence[0]?.id],
        });
        expect(result.run).toMatchObject({
          adapterId: adapter.id,
          kind: adapter.kind,
          model: {
            name: MODEL.name,
            digest: MODEL.digest,
            runtime: "OLLAMA",
            runtimeVersion: MODEL.runtimeVersion,
          },
          options: {
            format: "json-schema",
            think: false,
            transportAttempts: 1,
          },
        });
        expect(result.run.options["formatSchemaHash"]).toMatch(/^[0-9a-f]{64}$/u);
        expect(result.run.prompt).toContain("Do not emit Markdown");
        expect(JSON.parse(result.run.rawOutput ?? "null")).toMatchObject({ done: true });
      }

      expect(receivedBodies).toHaveLength(3);
      expect(receivedBodies[0]).toMatchObject({
        format: {
          type: "object",
          properties: {
            facts: { type: "array", items: { additionalProperties: false } },
          },
          required: ["facts"],
          additionalProperties: false,
        },
        messages: [{ role: "system" }, { role: "user", images: [expect.any(String)] }],
      });
      expect(receivedBodies[1]).toMatchObject({
        messages: [{ role: "system" }, { role: "user", images: [expect.any(String)] }],
      });
      expect(receivedBodies[2]).toMatchObject({
        messages: [{ role: "system" }, { role: "user" }],
      });
      expect(JSON.stringify(receivedBodies[2])).toContain("Source text");
    } finally {
      await server.close();
    }
  });

  it("materializes one pinned embedding per input without fact outputs", async () => {
    let receivedBody: Record<string, unknown> | null = null;
    const server = await startMockServer(async (request, response) => {
      if (handleModelInspection(request, response)) return;
      receivedBody = await readJsonBody(request);
      sendJson(response, {
        model: "synthetic-embed:1",
        embeddings: [
          [0.25, -0.5],
          [1, 0],
        ],
        total_duration: 5,
      });
    });

    try {
      const adapter = new OllamaEmbeddingAdapter({
        id: "ollama.embedding",
        client: new OllamaClient({ baseUrl: server.baseUrl, maxRetries: 0 }),
        model: { ...MODEL, name: "synthetic-embed:1" },
        dimensions: 2,
        truncate: false,
        runtime: fixtureRuntime([
          "00000000-0000-4000-8000-000000000331",
          "00000000-0000-4000-8000-000000000332",
          "00000000-0000-4000-8000-000000000333",
        ]),
      });
      const input: Extract<ExtractionRequest["input"], { readonly kind: "OLLAMA_EMBEDDING" }> = {
        kind: adapter.kind,
        entries: [
          { key: "chunk.alpha", text: "alpha" },
          { key: "chunk.beta", text: "beta" },
        ],
      };
      const request: ExtractionRequest = {
        id: FIXTURE.requestEmbedding,
        adapterId: adapter.id,
        kind: adapter.kind,
        inputHash: sha256CanonicalJson(input),
        requestedAt: FIXTURE.startedAt,
        input,
        validationScope: "TECHNICAL_DEMO",
      };

      const result = await adapter.extract(request);

      expect(result.facts).toEqual([]);
      expect(result.evidence).toEqual([]);
      expect(result.embeddings).toHaveLength(2);
      expect(result.embeddings.map(({ key, dimensions }) => ({ key, dimensions }))).toEqual([
        { key: "chunk.alpha", dimensions: 2 },
        { key: "chunk.beta", dimensions: 2 },
      ]);
      expect(result.run).toMatchObject({
        prompt: null,
        options: { dimensions: 2, truncate: false, transportAttempts: 1 },
        model: { name: "synthetic-embed:1", digest: MODEL.digest },
      });
      expect(receivedBody).toMatchObject({
        model: "synthetic-embed:1",
        input: ["alpha", "beta"],
        dimensions: 2,
        truncate: false,
      });
      expect(receivedBody).not.toHaveProperty("stream");
    } finally {
      await server.close();
    }
  });

  it("rejects a tampered embedding input hash before contacting Ollama", async () => {
    let requests = 0;
    const server = await startMockServer((_request, response) => {
      requests += 1;
      sendJson(response, {});
    });

    try {
      const adapter = new OllamaEmbeddingAdapter({
        id: "ollama.embedding",
        client: new OllamaClient({ baseUrl: server.baseUrl, maxRetries: 0 }),
        model: { ...MODEL, name: "synthetic-embed:1" },
      });
      const input: Extract<ExtractionRequest["input"], { readonly kind: "OLLAMA_EMBEDDING" }> = {
        kind: adapter.kind,
        entries: [{ key: "chunk.alpha", text: "alpha" }],
      };
      const request: ExtractionRequest = {
        id: FIXTURE.requestEmbedding,
        adapterId: adapter.id,
        kind: adapter.kind,
        inputHash: "e".repeat(64),
        requestedAt: FIXTURE.startedAt,
        input,
        validationScope: "TECHNICAL_DEMO",
      };

      await expect(adapter.extract(request)).rejects.toMatchObject({
        code: "INVALID_EXTRACTION_REQUEST",
      });
      expect(requests).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("verifies model availability, digest and daemon version before generation", async () => {
    const cases: readonly {
      readonly fixture: ModelInspectionFixture;
      readonly code: "MODEL_METADATA_MISMATCH" | "MODEL_NOT_AVAILABLE" | "RUNTIME_VERSION_MISMATCH";
    }[] = [
      { fixture: { models: [] }, code: "MODEL_NOT_AVAILABLE" },
      {
        fixture: {
          models: [{ name: MODEL.name, model: MODEL.name, digest: "b".repeat(64) }],
        },
        code: "MODEL_METADATA_MISMATCH",
      },
      { fixture: { version: "9.9.9-synthetic" }, code: "RUNTIME_VERSION_MISMATCH" },
    ];

    for (const testCase of cases) {
      let generationRequests = 0;
      const server = await startMockServer((request, response) => {
        if (handleModelInspection(request, response, testCase.fixture)) return;
        generationRequests += 1;
        sendJson(response, chatResponse(simpleFactOutput()));
      });

      try {
        const adapter = new OllamaLlmAdapter({
          id: "ollama.llm",
          client: new OllamaClient({ baseUrl: server.baseUrl, maxRetries: 0 }),
          model: MODEL,
          runtime: fixtureRuntime(["00000000-0000-4000-8000-000000000339"]),
        });

        await expect(adapter.extract(factRequest("OLLAMA_LLM", adapter.id))).rejects.toMatchObject({
          code: testCase.code,
        });
        expect(generationRequests).toBe(0);
      } finally {
        await server.close();
      }
    }
  });

  it("rejects a model fact envelope that violates the shared strict schema", async () => {
    const server = await startMockServer((request, response) => {
      if (handleModelInspection(request, response)) return;
      sendJson(response, chatResponse('{"facts":[{"key":"incomplete"}]}'));
    });

    try {
      const adapter = new OllamaLlmAdapter({
        id: "ollama.llm",
        client: new OllamaClient({ baseUrl: server.baseUrl, maxRetries: 0 }),
        model: MODEL,
        runtime: fixtureRuntime(["00000000-0000-4000-8000-000000000341"]),
      });

      await expect(adapter.extract(factRequest("OLLAMA_LLM", adapter.id))).rejects.toMatchObject({
        code: "INVALID_EXTRACTION_OUTPUT",
      });
    } finally {
      await server.close();
    }
  });

  it("rejects a document hash mismatch before contacting Ollama", async () => {
    let requests = 0;
    const server = await startMockServer((_request, response) => {
      requests += 1;
      sendJson(response, chatResponse(simpleFactOutput()));
    });

    try {
      const adapter = new OllamaOcrAdapter({
        id: "ollama.ocr",
        client: new OllamaClient({ baseUrl: server.baseUrl, maxRetries: 0 }),
        model: MODEL,
      });
      const request = {
        ...factRequest("OLLAMA_OCR", adapter.id),
        inputHash: "e".repeat(64),
      };

      await expect(adapter.extract(request)).rejects.toMatchObject({
        code: "INVALID_EXTRACTION_REQUEST",
      });
      expect(requests).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("rejects a response from a model other than the pinned model", async () => {
    const server = await startMockServer((request, response) => {
      if (handleModelInspection(request, response)) return;
      sendJson(response, {
        ...chatResponse(simpleFactOutput()),
        model: "unexpected-model:1",
      });
    });

    try {
      const adapter = new OllamaLlmAdapter({
        id: "ollama.llm",
        client: new OllamaClient({ baseUrl: server.baseUrl, maxRetries: 0 }),
        model: MODEL,
        runtime: fixtureRuntime(["00000000-0000-4000-8000-000000000345"]),
      });

      await expect(adapter.extract(factRequest("OLLAMA_LLM", adapter.id))).rejects.toMatchObject({
        code: "INVALID_EXTRACTION_OUTPUT",
      });
    } finally {
      await server.close();
    }
  });

  it("rejects any attempted normative outcome before materialization", async () => {
    const server = await startMockServer((request, response) => {
      if (handleModelInspection(request, response)) return;
      sendJson(response, chatResponse('{"facts":[],"outcome":"PASS"}'));
    });

    try {
      const adapter = new OllamaVisionAdapter({
        id: "ollama.vision",
        client: new OllamaClient({ baseUrl: server.baseUrl, maxRetries: 0 }),
        model: MODEL,
        runtime: fixtureRuntime(["00000000-0000-4000-8000-000000000351"]),
      });

      await expect(adapter.extract(factRequest("OLLAMA_VISION", adapter.id))).rejects.toMatchObject(
        { code: "NORMATIVE_OUTPUT_FORBIDDEN" },
      );
    } finally {
      await server.close();
    }
  });

  it("records the bounded retry count in successful run metadata", async () => {
    let requests = 0;
    const server = await startMockServer((request, response) => {
      if (handleModelInspection(request, response)) return;
      requests += 1;
      if (requests === 1) {
        sendJson(response, { error: "synthetic overload" }, 503);
        return;
      }
      sendJson(response, chatResponse('{"facts":[]}'));
    });

    try {
      const adapter = new OllamaLlmAdapter({
        id: "ollama.llm",
        client: new OllamaClient({
          baseUrl: server.baseUrl,
          maxRetries: 1,
          retryDelayMs: 0,
        }),
        model: MODEL,
        runtime: fixtureRuntime(["00000000-0000-4000-8000-000000000361"]),
      });

      const result = await adapter.extract(factRequest("OLLAMA_LLM", adapter.id));

      expect(requests).toBe(2);
      expect(result.run.options).toMatchObject({ transportAttempts: 2 });
    } finally {
      await server.close();
    }
  });
});
