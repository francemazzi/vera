import { createHash } from "node:crypto";
import { cpus, platform, release, totalmem } from "node:os";

import { sha256Bytes, sha256CanonicalJson } from "@vera/contracts";
import type { ExtractionRequest } from "@vera/contracts";
import { describe, expect, it } from "vitest";

import { OllamaClient, OllamaEmbeddingAdapter, OllamaLlmAdapter } from "../../src/index.js";

const ENABLED = process.env["VERA_OLLAMA_LIVE"] === "1";
const OLLAMA_VERSION = "0.24.0";
const CHAT_MODEL = {
  name: "llama3.1:latest",
  digest: "46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e",
  runtimeVersion: OLLAMA_VERSION,
} as const;
const EMBEDDING_MODEL = {
  name: "nomic-embed-text:latest",
  digest: "0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f",
  runtimeVersion: OLLAMA_VERSION,
} as const;
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000401";
const TEXT = "No observable facts are present in this synthetic transport fixture.";

function sha256Text(value: string): string {
  return sha256Bytes(new TextEncoder().encode(value));
}

function rawOutputHash(value: string | null): string {
  if (value === null) throw new Error("A live Ollama run must retain its raw output");
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function assertPinnedRuntime(): Promise<void> {
  const [versionResponse, tagsResponse] = await Promise.all([
    fetch("http://127.0.0.1:11434/api/version"),
    fetch("http://127.0.0.1:11434/api/tags"),
  ]);
  expect(versionResponse.ok).toBe(true);
  expect(tagsResponse.ok).toBe(true);

  const version = (await versionResponse.json()) as { readonly version?: unknown };
  const tags = (await tagsResponse.json()) as {
    readonly models?: readonly { readonly name?: unknown; readonly digest?: unknown }[];
  };
  expect(version.version).toBe(OLLAMA_VERSION);
  expect(tags.models).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: CHAT_MODEL.name, digest: CHAT_MODEL.digest }),
      expect.objectContaining({ name: EMBEDDING_MODEL.name, digest: EMBEDDING_MODEL.digest }),
    ]),
  );
}

describe.skipIf(!ENABLED)("Ollama live offline smoke", () => {
  it("runs pinned fact and embedding adapters and reports reproducibility metadata", async () => {
    await assertPinnedRuntime();
    const client = new OllamaClient({ timeoutMs: 120_000, maxRetries: 1 });
    const llm = new OllamaLlmAdapter({
      id: "ollama.live.llm",
      client,
      model: CHAT_MODEL,
      options: { seed: 42, temperature: 0 },
      prompt: `This is a transport and schema smoke test, not an accuracy evaluation.
Return exactly one JSON object whose facts array is empty. Do not extract any observation.`,
    });
    const documentHash = sha256Text(TEXT);
    const factRequest: ExtractionRequest = {
      id: "00000000-0000-4000-8000-000000000402",
      adapterId: llm.id,
      kind: "OLLAMA_LLM",
      inputHash: documentHash,
      requestedAt: "2026-07-15T00:00:00.000Z",
      input: {
        kind: "OLLAMA_LLM",
        documentId: DOCUMENT_ID,
        documentHash,
        page: 1,
        language: "en",
        text: TEXT,
      },
      validationScope: "TECHNICAL_DEMO",
    };
    const facts = await llm.extract(factRequest);

    const embeddingInput = {
      kind: "OLLAMA_EMBEDDING" as const,
      entries: [
        { key: "chunk.alpha", text: TEXT },
        { key: "chunk.beta", text: "Second synthetic chunk." },
      ],
    };
    const embedding = new OllamaEmbeddingAdapter({
      id: "ollama.live.embedding",
      client,
      model: EMBEDDING_MODEL,
    });
    const embeddingRequest: ExtractionRequest = {
      id: "00000000-0000-4000-8000-000000000403",
      adapterId: embedding.id,
      kind: embedding.kind,
      inputHash: sha256CanonicalJson(embeddingInput),
      requestedAt: "2026-07-15T00:00:00.000Z",
      input: embeddingInput,
      validationScope: "TECHNICAL_DEMO",
    };
    const embeddings = await embedding.extract(embeddingRequest);

    expect(facts.facts).toEqual([]);
    expect(facts.evidence).toEqual([]);
    expect(facts.run.model).toMatchObject(CHAT_MODEL);
    expect(facts.run.prompt).toContain("Do not emit Markdown");
    expect(facts.run.options["formatSchemaHash"]).toMatch(/^[0-9a-f]{64}$/u);
    expect(embeddings.embeddings).toHaveLength(2);
    expect(embeddings.embeddings.every(({ vector }) => vector.length > 0)).toBe(true);
    expect(embeddings.run.model).toMatchObject(EMBEDDING_MODEL);

    const report = {
      validationScope: "TECHNICAL_DEMO",
      ollamaVersion: OLLAMA_VERSION,
      models: [
        { ...CHAT_MODEL, rawOutputSha256: rawOutputHash(facts.run.rawOutput) },
        {
          ...EMBEDDING_MODEL,
          rawOutputSha256: rawOutputHash(embeddings.run.rawOutput),
          dimensions: embeddings.embeddings[0]?.dimensions,
        },
      ],
      options: { seed: 42, temperature: 0, liveNetwork: "loopback-only" },
      factProtocol: {
        promptSha256: sha256Text(facts.run.prompt ?? ""),
        formatSchemaSha256: facts.run.options["formatSchemaHash"],
        inputSha256: factRequest.inputHash,
      },
      embeddingInputSha256: embeddingRequest.inputHash,
      hardware: {
        platform: `${platform()} ${release()}`,
        cpu: cpus()[0]?.model ?? "unknown",
        memoryBytes: totalmem(),
      },
    };
    process.stdout.write(`VERA_OLLAMA_SMOKE=${JSON.stringify(report)}\n`);
  }, 180_000);
});
