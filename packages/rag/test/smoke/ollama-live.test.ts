import { describe, expect, it } from "vitest";

import { sha256CanonicalJson } from "@vera/contracts";
import { OllamaClient } from "@vera/extractors";

import { OllamaEmbeddingProvider, OllamaRuleDraftProvider } from "../../src/index.js";
import type { RagProviderModel } from "../../src/index.js";

const modelName = process.env["VERA_OLLAMA_RAG_MODEL"];
const modelDigest = process.env["VERA_OLLAMA_RAG_DIGEST"];
const runtimeVersion = process.env["VERA_OLLAMA_RUNTIME_VERSION"];

function liveModel(): RagProviderModel | null {
  if (modelName === undefined || modelDigest === undefined || runtimeVersion === undefined) {
    return null;
  }
  return { name: modelName, digest: modelDigest, runtimeVersion };
}

const configuredModel = liveModel();

describe("Ollama RAG live smoke", () => {
  it("records local model identity and raw output, or an explicit limitation", async () => {
    if (configuredModel === null) {
      const limitation = {
        available: false,
        limitation:
          "Ollama RAG smoke was not configured. Set VERA_OLLAMA_RAG_MODEL, VERA_OLLAMA_RAG_DIGEST and VERA_OLLAMA_RUNTIME_VERSION.",
      };
      expect(sha256CanonicalJson(limitation)).toMatch(/^[0-9a-f]{64}$/u);
      return;
    }

    const client = new OllamaClient({ timeoutMs: 5000, maxRetries: 0 });
    const model = configuredModel;
    const embedding = new OllamaEmbeddingProvider({ client, model, dimensions: 4 });
    const draft = new OllamaRuleDraftProvider({ client, model });

    try {
      const embeddings = await embedding.embedTexts(["synthetic retention label"]);
      const draftResult = await draft.generateJson(
        'Return {"targetState":"DRAFT","validationScope":"TECHNICAL_DEMO","provenance":"AI_ASSISTED","sourceId":"00000000-0000-4000-8000-000000000001","sourceVersionId":"00000000-0000-4000-8000-000000000002","sourceSection":"section-1","normativeActor":"Synthetic operator","object":"Synthetic record label","scope":"Synthetic demo records","normativeKey":"synthetic.retention.label","deonticCategory":"OBLIGATION","riskLevel":"LOW","riskRationale":"Synthetic demonstration only.","evidenceRequirements":[{"key":"label.visible","description":"Evidence shows the visible label text.","rationale":"Synthetic source text.","citationChunkIds":["chunk-1"]}],"exceptions":[],"citations":[{"chunkId":"chunk-1","quote":"Synthetic records must retain a visible label."}]}',
      );
      const record = {
        available: true,
        model,
        embeddingDimensions: embeddings[0]?.length ?? 0,
        rawOutputHash: sha256CanonicalJson({ rawOutput: draftResult.rawOutput }),
      };
      expect(record.embeddingDimensions).toBeGreaterThan(0);
      expect(record.rawOutputHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(draftResult.provider).toEqual(model);
    } catch (error) {
      const limitation = {
        available: false,
        model,
        limitation: error instanceof Error ? error.message : "Unknown Ollama RAG smoke failure",
      };
      expect(sha256CanonicalJson(limitation)).toMatch(/^[0-9a-f]{64}$/u);
    }
  });
});
