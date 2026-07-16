import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  EmbeddingInputEntrySchema,
  EmbeddingSchema,
  EvidenceSchema,
  EvidenceObservationSchema,
  ExtractionInputSchema,
  ExtractionRequestSchema,
  ExtractionResultSchema,
  ExtractorKindSchema,
  ExtractorModelSchema,
  ExtractorRunSchema,
  FactCandidateObservationSchema,
  FactCandidateSchema,
  FactObservationSchema,
  FactSchema,
  FactStatusSchema,
  FactValueTypeSchema,
  JsonExtractionInputSchema,
  ManualExtractionInputSchema,
  NormalizedBoundingBoxSchema,
  OllamaEmbeddingExtractionInputSchema,
  OllamaExtractorModelSchema,
  OllamaLlmExtractionInputSchema,
  OllamaOcrExtractionInputSchema,
  OllamaVisionExtractionInputSchema,
  OpenRouterExtractorModelSchema,
  OpenRouterLlmExtractionInputSchema,
} from "../../src/index.js";

describe("extraction public vocabulary contract", () => {
  it("keeps fact, value, and adapter vocabularies closed", () => {
    expect(FactStatusSchema.options).toEqual([
      "RESOLVED",
      "NULL",
      "NOT_FOUND",
      "NOT_READABLE",
      "CONFLICT",
    ]);
    expect(FactValueTypeSchema.options).toEqual(["STRING", "NUMBER", "BOOLEAN", "DATE", "JSON"]);
    expect(ExtractorKindSchema.options).toEqual([
      "MANUAL",
      "JSON",
      "OLLAMA_OCR",
      "OLLAMA_VISION",
      "OLLAMA_LLM",
      "OLLAMA_EMBEDDING",
      "OPENROUTER_LLM",
    ]);
  });
});

describe("extraction JSON Schema contract", () => {
  it.each([
    [NormalizedBoundingBoxSchema, ["x", "y", "width", "height"]],
    [EvidenceObservationSchema, ["text", "boundingBox"]],
    [
      FactCandidateObservationSchema,
      ["originalValue", "normalizedValue", "rawConfidence", "evidence"],
    ],
    [
      FactObservationSchema,
      [
        "key",
        "valueType",
        "status",
        "originalValue",
        "normalizedValue",
        "rawConfidence",
        "evidence",
        "candidates",
      ],
    ],
    [
      ManualExtractionInputSchema,
      ["kind", "documentId", "documentHash", "page", "language", "observations"],
    ],
    [
      JsonExtractionInputSchema,
      ["kind", "documentId", "documentHash", "page", "language", "value"],
    ],
    [
      OllamaOcrExtractionInputSchema,
      ["kind", "documentId", "documentHash", "page", "language", "mediaType", "imageBase64"],
    ],
    [
      OllamaVisionExtractionInputSchema,
      ["kind", "documentId", "documentHash", "page", "language", "mediaType", "imageBase64"],
    ],
    [
      OllamaLlmExtractionInputSchema,
      ["kind", "documentId", "documentHash", "page", "language", "text"],
    ],
    [
      OpenRouterLlmExtractionInputSchema,
      ["kind", "documentId", "documentHash", "page", "language", "text"],
    ],
    [EmbeddingInputEntrySchema, ["key", "text"]],
    [OllamaEmbeddingExtractionInputSchema, ["kind", "entries"]],
    [
      EvidenceSchema,
      [
        "id",
        "documentId",
        "documentHash",
        "page",
        "text",
        "language",
        "boundingBox",
        "providerRunId",
        "capturedAt",
        "validationScope",
      ],
    ],
    [
      FactCandidateSchema,
      ["id", "originalValue", "normalizedValue", "evidenceIds", "providerRunId", "rawConfidence"],
    ],
    [OllamaExtractorModelSchema, ["name", "digest", "runtime", "runtimeVersion"]],
    [OpenRouterExtractorModelSchema, ["name", "runtime", "apiVersion", "routingConfigHash"]],
    [
      ExtractorRunSchema,
      [
        "id",
        "adapterId",
        "kind",
        "startedAt",
        "completedAt",
        "model",
        "prompt",
        "options",
        "rawOutput",
        "validationScope",
      ],
    ],
    [
      EmbeddingSchema,
      ["id", "key", "inputHash", "vector", "dimensions", "providerRunId", "validationScope"],
    ],
    [
      ExtractionRequestSchema,
      ["id", "adapterId", "kind", "inputHash", "requestedAt", "input", "validationScope"],
    ],
    [
      ExtractionResultSchema,
      ["requestId", "run", "facts", "evidence", "embeddings", "validationScope"],
    ],
  ] as const)("publishes required strict fields", (zodSchema, required) => {
    const schema = z.toJSONSchema(zodSchema);

    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(required);
    expect(schema.properties).not.toHaveProperty("outcome");
    expect(schema.properties).not.toHaveProperty("finding");
  });

  it("publishes every Fact status as a strict union branch", () => {
    const schema = z.toJSONSchema(FactSchema);

    expect(schema.anyOf).toHaveLength(5);
    const statuses = schema.anyOf?.map((branch) => {
      if (typeof branch === "boolean" || branch.properties === undefined) return undefined;
      const status = branch.properties["status"];
      return typeof status === "boolean" || status === undefined ? undefined : status.const;
    });
    expect(statuses).toEqual(["RESOLVED", "NULL", "NOT_FOUND", "NOT_READABLE", "CONFLICT"]);
    for (const branch of schema.anyOf ?? []) {
      if (typeof branch !== "boolean") {
        expect(branch.additionalProperties).toBe(false);
        expect(branch.required).toContain("status");
      }
    }
  });

  it("publishes every extraction input as a strict discriminated union branch", () => {
    const schema = z.toJSONSchema(ExtractionInputSchema);

    expect(schema.anyOf).toHaveLength(7);
    const kinds = schema.anyOf?.map((branch) => {
      if (typeof branch === "boolean" || branch.properties === undefined) return undefined;
      const kind = branch.properties["kind"];
      return typeof kind === "boolean" || kind === undefined ? undefined : kind.const;
    });
    expect(kinds).toEqual([
      "MANUAL",
      "JSON",
      "OLLAMA_OCR",
      "OLLAMA_VISION",
      "OLLAMA_LLM",
      "OLLAMA_EMBEDDING",
      "OPENROUTER_LLM",
    ]);
    for (const branch of schema.anyOf ?? []) {
      if (typeof branch !== "boolean") {
        expect(branch.additionalProperties).toBe(false);
        expect(branch.required).toContain("kind");
        expect(branch.properties).not.toHaveProperty("outcome");
      }
    }
  });

  it("publishes the backward-compatible Ollama and OpenRouter model identity branches", () => {
    const schema = z.toJSONSchema(ExtractorModelSchema);

    expect(schema.anyOf).toHaveLength(2);
    const runtimes = schema.anyOf?.map((branch) => {
      if (typeof branch === "boolean" || branch.properties === undefined) return undefined;
      const runtime = branch.properties["runtime"];
      return typeof runtime === "boolean" || runtime === undefined ? undefined : runtime.const;
    });
    expect(runtimes).toEqual(["OLLAMA", "OPENROUTER"]);
    for (const branch of schema.anyOf ?? []) {
      if (typeof branch !== "boolean") {
        expect(branch.additionalProperties).toBe(false);
        expect(branch.required).toContain("name");
        expect(branch.required).toContain("runtime");
      }
    }
  });

  it("publishes lowercase SHA-256 and date-time boundaries", () => {
    const evidence = z.toJSONSchema(EvidenceSchema);
    const documentHash = evidence.properties?.["documentHash"];
    const capturedAt = evidence.properties?.["capturedAt"];

    expect(typeof documentHash === "boolean" ? undefined : documentHash?.pattern).toBe(
      "^[0-9a-f]{64}$",
    );
    expect(typeof capturedAt === "boolean" ? undefined : capturedAt?.format).toBe("date-time");
  });
});

describe("extraction serialization contract", () => {
  it("round-trips evidence with 1-based pages and normalized top-left geometry", () => {
    const evidence = {
      id: "00000000-0000-4000-8000-000000000705",
      documentId: "00000000-0000-4000-8000-000000000704",
      documentHash: "a".repeat(64),
      page: 1,
      text: "Synthetic evidence",
      language: "en",
      boundingBox: { x: 0, y: 0, width: 0.25, height: 0.5 },
      providerRunId: "00000000-0000-4000-8000-000000000702",
      capturedAt: "2026-04-01T00:00:01.000Z",
      validationScope: "TECHNICAL_DEMO",
    } as const;

    expect(EvidenceSchema.parse(JSON.parse(JSON.stringify(evidence)))).toEqual(evidence);
  });

  it("round-trips a typed RESOLVED fact without a normative result field", () => {
    const fact = {
      id: "00000000-0000-4000-8000-000000000707",
      key: "synthetic.count",
      valueType: "NUMBER",
      providerRunId: "00000000-0000-4000-8000-000000000702",
      observedAt: "2026-04-01T00:00:01.000Z",
      rawConfidence: 0.75,
      validationScope: "TECHNICAL_DEMO",
      status: "RESOLVED",
      originalValue: "42",
      normalizedValue: 42,
      evidenceIds: ["00000000-0000-4000-8000-000000000705"],
      candidates: [],
    } as const;

    const parsed = FactSchema.parse(JSON.parse(JSON.stringify(fact)));
    expect(parsed).toEqual(fact);
    expect(parsed).not.toHaveProperty("outcome");
  });
});
