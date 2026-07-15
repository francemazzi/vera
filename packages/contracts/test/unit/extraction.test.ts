import { describe, expect, it } from "vitest";

import {
  ConflictFactSchema,
  EmbeddingInputEntrySchema,
  EmbeddingSchema,
  EvidenceSchema,
  EvidenceObservationSchema,
  ExtractionInputSchema,
  ExtractionRequestSchema,
  ExtractionResultSchema,
  ExtractorModelSchema,
  ExtractorRunSchema,
  FactCandidateObservationSchema,
  FactCandidateSchema,
  FactObservationSchema,
  FactSchema,
  JsonExtractionInputSchema,
  ManualExtractionInputSchema,
  NormalizedBoundingBoxSchema,
  OllamaEmbeddingExtractionInputSchema,
  OllamaLlmExtractionInputSchema,
  OllamaOcrExtractionInputSchema,
  OllamaVisionExtractionInputSchema,
} from "../../src/index.js";
import type {
  Embedding,
  Evidence,
  ExtractionInput,
  ExtractionRequest,
  ExtractionResult,
  ExtractorRun,
  FactCandidate,
} from "../../src/index.js";

const IDS = {
  request: "00000000-0000-4000-8000-000000000701",
  run: "00000000-0000-4000-8000-000000000702",
  otherRun: "00000000-0000-4000-8000-000000000703",
  document: "00000000-0000-4000-8000-000000000704",
  evidenceA: "00000000-0000-4000-8000-000000000705",
  evidenceB: "00000000-0000-4000-8000-000000000706",
  factA: "00000000-0000-4000-8000-000000000707",
  factB: "00000000-0000-4000-8000-000000000708",
  candidateA: "00000000-0000-4000-8000-000000000709",
  candidateB: "00000000-0000-4000-8000-000000000710",
  embedding: "00000000-0000-4000-8000-000000000711",
} as const;

const HASH = "a".repeat(64);
const MODEL_HASH = "b".repeat(64);
const STARTED = "2026-04-01T00:00:00.000Z";
const COMPLETED = "2026-04-01T00:00:01.000Z";
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: IDS.evidenceA,
    documentId: IDS.document,
    documentHash: HASH,
    page: 1,
    text: "Synthetic visible marker",
    language: "en-GB",
    boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    providerRunId: IDS.run,
    capturedAt: COMPLETED,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

function makeRun(overrides: Partial<ExtractorRun> = {}): ExtractorRun {
  return {
    id: IDS.run,
    adapterId: "synthetic.manual",
    kind: "MANUAL",
    startedAt: STARTED,
    completedAt: COMPLETED,
    model: null,
    prompt: null,
    options: {},
    rawOutput: null,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

function makeOllamaRun(
  kind: "OLLAMA_OCR" | "OLLAMA_VISION" | "OLLAMA_LLM" | "OLLAMA_EMBEDDING",
  overrides: Partial<ExtractorRun> = {},
): ExtractorRun {
  const needsPrompt = kind !== "OLLAMA_EMBEDDING";
  return makeRun({
    adapterId: `synthetic.${kind.toLowerCase()}`,
    kind,
    model: {
      name: "synthetic-model",
      digest: MODEL_HASH,
      runtime: "OLLAMA",
      runtimeVersion: "0.0.0-demo",
    },
    prompt: needsPrompt ? "Extract only the requested synthetic facts" : null,
    options: { temperature: 0, seed: 42 },
    rawOutput: '{"synthetic":true}',
    ...overrides,
  });
}

function makeResolvedFact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: IDS.factA,
    key: "synthetic.marker",
    valueType: "STRING",
    providerRunId: IDS.run,
    observedAt: COMPLETED,
    rawConfidence: null,
    validationScope: "TECHNICAL_DEMO",
    status: "RESOLVED",
    originalValue: " Visible ",
    normalizedValue: "visible",
    evidenceIds: [IDS.evidenceA],
    candidates: [],
    ...overrides,
  };
}

function makeUnresolvedFact(
  status: "NULL" | "NOT_FOUND" | "NOT_READABLE",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: IDS.factA,
    key: "synthetic.marker",
    valueType: "STRING",
    providerRunId: IDS.run,
    observedAt: COMPLETED,
    rawConfidence: null,
    validationScope: "TECHNICAL_DEMO",
    status,
    originalValue: null,
    normalizedValue: null,
    evidenceIds: status === "NOT_FOUND" ? [] : [IDS.evidenceA],
    candidates: [],
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<FactCandidate> = {}): FactCandidate {
  return {
    id: IDS.candidateA,
    originalValue: "Alpha",
    normalizedValue: "alpha",
    evidenceIds: [IDS.evidenceA],
    providerRunId: IDS.run,
    rawConfidence: 0.7,
    ...overrides,
  };
}

function makeConflictFact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: IDS.factA,
    key: "synthetic.marker",
    valueType: "STRING",
    providerRunId: IDS.run,
    observedAt: COMPLETED,
    rawConfidence: null,
    validationScope: "TECHNICAL_DEMO",
    status: "CONFLICT",
    originalValue: null,
    normalizedValue: null,
    evidenceIds: [IDS.evidenceA, IDS.evidenceB],
    candidates: [
      makeCandidate(),
      makeCandidate({
        id: IDS.candidateB,
        originalValue: "Beta",
        normalizedValue: "beta",
        evidenceIds: [IDS.evidenceB],
        rawConfidence: 0.6,
      }),
    ],
    ...overrides,
  };
}

function makeEmbedding(overrides: Partial<Embedding> = {}): Embedding {
  return {
    id: IDS.embedding,
    key: "synthetic.chunk",
    inputHash: HASH,
    vector: [0.1, -0.2, 0.3],
    dimensions: 3,
    providerRunId: IDS.run,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

function makeEvidenceObservation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    text: "Synthetic visible marker",
    boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    ...overrides,
  };
}

function makeCandidateObservation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    originalValue: "Alpha",
    normalizedValue: "alpha",
    rawConfidence: 0.7,
    evidence: [makeEvidenceObservation()],
    ...overrides,
  };
}

function makeResolvedObservation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: "synthetic.marker",
    valueType: "STRING",
    status: "RESOLVED",
    originalValue: " Visible ",
    normalizedValue: "visible",
    rawConfidence: null,
    evidence: [makeEvidenceObservation()],
    candidates: [],
    ...overrides,
  };
}

function makeUnresolvedObservation(
  status: "NULL" | "NOT_FOUND" | "NOT_READABLE",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    key: "synthetic.marker",
    valueType: "STRING",
    status,
    originalValue: null,
    normalizedValue: null,
    rawConfidence: null,
    evidence: status === "NOT_FOUND" ? [] : [makeEvidenceObservation()],
    candidates: [],
    ...overrides,
  };
}

function makeConflictObservation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: "synthetic.marker",
    valueType: "STRING",
    status: "CONFLICT",
    originalValue: null,
    normalizedValue: null,
    rawConfidence: null,
    evidence: [],
    candidates: [
      makeCandidateObservation(),
      makeCandidateObservation({ originalValue: "Beta", normalizedValue: "beta" }),
    ],
    ...overrides,
  };
}

function makeInput(kind: ExtractionInput["kind"]): ExtractionInput {
  switch (kind) {
    case "MANUAL":
      return ExtractionInputSchema.parse({
        kind,
        documentId: IDS.document,
        documentHash: HASH,
        page: 1,
        language: "en",
        observations: [makeResolvedObservation()],
      });
    case "JSON":
      return ExtractionInputSchema.parse({
        kind,
        documentId: IDS.document,
        documentHash: HASH,
        page: 1,
        language: "en",
        value: { synthetic: true, count: 1 },
      });
    case "OLLAMA_OCR":
    case "OLLAMA_VISION":
      return ExtractionInputSchema.parse({
        kind,
        documentId: IDS.document,
        documentHash: HASH,
        page: 1,
        language: "en",
        mediaType: "image/png",
        imageBase64: PNG_1PX,
      });
    case "OLLAMA_LLM":
      return ExtractionInputSchema.parse({
        kind,
        documentId: IDS.document,
        documentHash: HASH,
        page: 1,
        language: "en",
        text: "Synthetic document text",
      });
    case "OLLAMA_EMBEDDING":
      return ExtractionInputSchema.parse({
        kind,
        entries: [{ key: "synthetic.chunk", text: "Synthetic document text" }],
      });
  }
}

function makeRequest(overrides: Partial<ExtractionRequest> = {}): ExtractionRequest {
  return {
    id: IDS.request,
    adapterId: "synthetic.manual",
    kind: "MANUAL",
    inputHash: HASH,
    requestedAt: STARTED,
    input: makeInput("MANUAL"),
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

function makeResult(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    requestId: IDS.request,
    run: makeRun(),
    facts: [FactSchema.parse(makeResolvedFact())],
    evidence: [makeEvidence()],
    embeddings: [],
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

describe("NormalizedBoundingBoxSchema", () => {
  it.each([
    { x: 0, y: 0, width: 1, height: 1 },
    { x: 0.9, y: 0.8, width: 0.1, height: 0.2 },
  ])("accepts normalized top-left geometry %#", (box) => {
    expect(NormalizedBoundingBoxSchema.parse(box)).toEqual(box);
  });

  it.each([
    { x: -0.1, y: 0, width: 0.5, height: 0.5 },
    { x: 0, y: 1.1, width: 0.5, height: 0.5 },
    { x: 0, y: 0, width: 0, height: 0.5 },
    { x: 0, y: 0, width: 0.5, height: 0 },
    { x: 0.8, y: 0, width: 0.3, height: 0.5 },
    { x: 0, y: 0.8, width: 0.5, height: 0.3 },
    { x: 0, y: 0, width: 0.5, height: 0.5, origin: "bottom-left" },
  ])("rejects invalid or undeclared geometry %#", (box) => {
    expect(NormalizedBoundingBoxSchema.safeParse(box).success).toBe(false);
  });
});

describe("extraction observations", () => {
  it("accepts strict evidence and candidate observations", () => {
    expect(EvidenceObservationSchema.parse(makeEvidenceObservation())).toEqual(
      makeEvidenceObservation(),
    );
    expect(FactCandidateObservationSchema.parse(makeCandidateObservation())).toEqual(
      makeCandidateObservation(),
    );
  });

  it("reports non-canonical Unicode as validation data instead of throwing", () => {
    const observation = makeConflictObservation({
      candidates: [
        makeCandidateObservation({ normalizedValue: "\ud800" }),
        makeCandidateObservation({ originalValue: "Beta", normalizedValue: "beta" }),
      ],
    });

    expect(() => FactObservationSchema.safeParse(observation)).not.toThrow();
    expect(FactObservationSchema.safeParse(observation).success).toBe(false);
  });

  it.each([
    { text: "" },
    { boundingBox: { x: 0.9, y: 0, width: 0.2, height: 1 } },
    { outcome: "PASS" },
  ])("rejects invalid or normative evidence observation data %#", (override) => {
    expect(EvidenceObservationSchema.safeParse(makeEvidenceObservation(override)).success).toBe(
      false,
    );
  });

  it.each([
    { normalizedValue: null },
    { evidence: [] },
    { evidence: [{ ...makeEvidenceObservation(), outcome: "PASS" }] },
    { rawConfidence: -0.01 },
    { rawConfidence: 1.01 },
    { outcome: "FAIL" },
  ])("rejects invalid or normative candidate observation data %#", (override) => {
    expect(
      FactCandidateObservationSchema.safeParse(makeCandidateObservation(override)).success,
    ).toBe(false);
  });

  it.each([
    ["STRING", "normalized text"],
    ["NUMBER", 42.5],
    ["BOOLEAN", true],
    ["DATE", "2026-04-01"],
    ["JSON", { nested: [1, "two", false] }],
  ] as const)("accepts a RESOLVED %s observation", (valueType, normalizedValue) => {
    expect(
      FactObservationSchema.safeParse(makeResolvedObservation({ valueType, normalizedValue }))
        .success,
    ).toBe(true);
  });

  it.each([
    ["STRING", 1],
    ["NUMBER", "1"],
    ["BOOLEAN", 1],
    ["DATE", "01-04-2026"],
    ["JSON", null],
  ] as const)("rejects a RESOLVED %s observation with value %j", (valueType, normalizedValue) => {
    expect(
      FactObservationSchema.safeParse(makeResolvedObservation({ valueType, normalizedValue }))
        .success,
    ).toBe(false);
  });

  it.each([
    { originalValue: null },
    { normalizedValue: null },
    { evidence: [] },
    { candidates: [makeCandidateObservation()] },
    { rawConfidence: 1.01 },
    { outcome: "PASS" },
  ])("rejects a broken RESOLVED observation invariant %#", (override) => {
    expect(FactObservationSchema.safeParse(makeResolvedObservation(override)).success).toBe(false);
  });

  it.each(["NULL", "NOT_FOUND", "NOT_READABLE"] as const)("accepts a %s observation", (status) => {
    expect(FactObservationSchema.safeParse(makeUnresolvedObservation(status)).success).toBe(true);
  });

  it.each(["NULL", "NOT_READABLE"] as const)("requires observation evidence for %s", (status) => {
    expect(
      FactObservationSchema.safeParse(makeUnresolvedObservation(status, { evidence: [] })).success,
    ).toBe(false);
  });

  it.each(["NULL", "NOT_FOUND", "NOT_READABLE"] as const)(
    "keeps values and candidates absent for %s observations",
    (status) => {
      expect(
        FactObservationSchema.safeParse(
          makeUnresolvedObservation(status, { normalizedValue: "implicit" }),
        ).success,
      ).toBe(false);
      expect(
        FactObservationSchema.safeParse(
          makeUnresolvedObservation(status, { originalValue: "implicit" }),
        ).success,
      ).toBe(false);
      expect(
        FactObservationSchema.safeParse(
          makeUnresolvedObservation(status, { candidates: [makeCandidateObservation()] }),
        ).success,
      ).toBe(false);
    },
  );

  it("rejects undeclared normative fields from unresolved observations", () => {
    expect(
      FactObservationSchema.safeParse(makeUnresolvedObservation("NOT_FOUND", { outcome: "PASS" }))
        .success,
    ).toBe(false);
  });

  it("accepts a conflict with two distinct, typed candidates", () => {
    expect(FactObservationSchema.safeParse(makeConflictObservation()).success).toBe(true);
  });

  it.each([
    { originalValue: "selected" },
    { normalizedValue: "selected" },
    { rawConfidence: 0.5 },
    { candidates: [makeCandidateObservation()] },
    { candidates: [makeCandidateObservation(), makeCandidateObservation()] },
    {
      valueType: "NUMBER",
      candidates: [makeCandidateObservation(), makeCandidateObservation({ normalizedValue: 2 })],
    },
    { outcome: "REVIEW" },
  ])("rejects a broken CONFLICT observation invariant %#", (override) => {
    expect(FactObservationSchema.safeParse(makeConflictObservation(override)).success).toBe(false);
  });
});

describe("ExtractionInputSchema", () => {
  it.each([
    ["MANUAL", ManualExtractionInputSchema],
    ["JSON", JsonExtractionInputSchema],
    ["OLLAMA_OCR", OllamaOcrExtractionInputSchema],
    ["OLLAMA_VISION", OllamaVisionExtractionInputSchema],
    ["OLLAMA_LLM", OllamaLlmExtractionInputSchema],
    ["OLLAMA_EMBEDDING", OllamaEmbeddingExtractionInputSchema],
  ] as const)("accepts a strict %s input through its branch and public union", (kind, schema) => {
    const input = makeInput(kind);
    expect(schema.safeParse(input).success).toBe(true);
    expect(ExtractionInputSchema.parse(input)).toEqual(input);
  });

  it.each([
    { documentId: "not-a-uuid" },
    { documentHash: "A".repeat(64) },
    { page: 0 },
    { page: 1.5 },
    { language: "not a tag" },
    { observations: [{ ...makeResolvedObservation(), outcome: "PASS" }] },
    { outcome: "PASS" },
  ])("rejects invalid or normative manual input data %#", (override) => {
    expect(
      ManualExtractionInputSchema.safeParse({ ...makeInput("MANUAL"), ...override }).success,
    ).toBe(false);
  });

  it("accepts every JSON value, including null, but no undeclared fields", () => {
    expect(JsonExtractionInputSchema.safeParse({ ...makeInput("JSON"), value: null }).success).toBe(
      true,
    );
    expect(
      JsonExtractionInputSchema.safeParse({ ...makeInput("JSON"), outcome: "PASS" }).success,
    ).toBe(false);
  });

  it("rejects deeply nested JSON without overflowing safeParse", () => {
    let value: unknown = "leaf";
    for (let depth = 0; depth < 10_000; depth += 1) value = { nested: value };
    const input = { ...makeInput("JSON"), value };

    expect(() => JsonExtractionInputSchema.safeParse(input)).not.toThrow();
    expect(JsonExtractionInputSchema.safeParse(input).success).toBe(false);
  });

  it.each([OllamaOcrExtractionInputSchema, OllamaVisionExtractionInputSchema])(
    "enforces image metadata and strict fields",
    (schema) => {
      const kind = schema === OllamaOcrExtractionInputSchema ? "OLLAMA_OCR" : "OLLAMA_VISION";
      const input = makeInput(kind);
      expect(schema.safeParse({ ...input, mediaType: "image/gif" }).success).toBe(false);
      expect(schema.safeParse({ ...input, imageBase64: "" }).success).toBe(false);
      expect(schema.safeParse({ ...input, imageBase64: "definitely not base64 !!!" }).success).toBe(
        false,
      );
      expect(
        schema.safeParse({ ...input, mediaType: "image/jpeg", imageBase64: PNG_1PX }).success,
      ).toBe(false);
      expect(schema.safeParse({ ...input, outcome: "PASS" }).success).toBe(false);
    },
  );

  it("requires non-empty strict LLM text", () => {
    expect(
      OllamaLlmExtractionInputSchema.safeParse({ ...makeInput("OLLAMA_LLM"), text: "" }).success,
    ).toBe(false);
    expect(
      OllamaLlmExtractionInputSchema.safeParse({
        ...makeInput("OLLAMA_LLM"),
        outcome: "REVIEW",
      }).success,
    ).toBe(false);
  });

  it("requires strict, non-empty embedding entries", () => {
    expect(
      EmbeddingInputEntrySchema.safeParse({ key: "synthetic.chunk", text: "Synthetic text" })
        .success,
    ).toBe(true);
    expect(EmbeddingInputEntrySchema.safeParse({ key: "invalid key", text: "x" }).success).toBe(
      false,
    );
    expect(
      EmbeddingInputEntrySchema.safeParse({ key: "synthetic.chunk", text: "", outcome: "PASS" })
        .success,
    ).toBe(false);
    expect(
      OllamaEmbeddingExtractionInputSchema.safeParse({
        ...makeInput("OLLAMA_EMBEDDING"),
        entries: [],
      }).success,
    ).toBe(false);
    expect(
      OllamaEmbeddingExtractionInputSchema.safeParse({
        ...makeInput("OLLAMA_EMBEDDING"),
        outcome: "PASS",
      }).success,
    ).toBe(false);
    expect(
      OllamaEmbeddingExtractionInputSchema.safeParse({
        ...makeInput("OLLAMA_EMBEDDING"),
        entries: [
          { key: "synthetic.chunk", text: "first" },
          { key: "synthetic.chunk", text: "second" },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects observation sets whose aggregate materialization budget is excessive", () => {
    const observations = Array.from({ length: 101 }, (_, observationIndex) =>
      makeConflictObservation({
        key: `synthetic.conflict.${String(observationIndex)}`,
        candidates: Array.from({ length: 100 }, (_, candidateIndex) =>
          makeCandidateObservation({
            originalValue: candidateIndex,
            normalizedValue: candidateIndex,
          }),
        ),
      }),
    );

    expect(
      ManualExtractionInputSchema.safeParse({
        ...makeInput("MANUAL"),
        observations,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown and cross-branch input shapes", () => {
    expect(
      ExtractionInputSchema.safeParse({ kind: "REMOTE", endpoint: "https://invalid" }).success,
    ).toBe(false);
    expect(ExtractionInputSchema.safeParse({ ...makeInput("MANUAL"), kind: "JSON" }).success).toBe(
      false,
    );
  });
});

describe("EvidenceSchema", () => {
  it("accepts a page-1 evidence region with a lowercase document hash", () => {
    expect(EvidenceSchema.parse(makeEvidence())).toEqual(makeEvidence());
  });

  it.each([
    { page: 0 },
    { page: 1.5 },
    { documentHash: "A".repeat(64) },
    { documentHash: "a".repeat(63) },
    { text: "" },
    { language: "x" },
    { language: "not a tag" },
    { capturedAt: "2026-04-01T01:00:00.000+01:00" },
    { validationScope: "PROFESSIONAL" },
    { outcome: "PASS" },
  ])("rejects invalid evidence metadata %#", (override) => {
    expect(EvidenceSchema.safeParse({ ...makeEvidence(), ...override }).success).toBe(false);
  });
});

describe("FactSchema resolved facts", () => {
  it.each([
    ["STRING", "normalized text"],
    ["NUMBER", 42.5],
    ["BOOLEAN", true],
    ["DATE", "2026-04-01"],
    ["JSON", { nested: [1, "two", false] }],
  ] as const)("accepts a %s normalized value", (valueType, normalizedValue) => {
    expect(FactSchema.safeParse(makeResolvedFact({ valueType, normalizedValue })).success).toBe(
      true,
    );
  });

  it.each([
    ["STRING", 1],
    ["NUMBER", "1"],
    ["BOOLEAN", 1],
    ["DATE", "01-04-2026"],
    ["STRING", null],
  ] as const)("rejects %s with mismatched value %j", (valueType, normalizedValue) => {
    expect(FactSchema.safeParse(makeResolvedFact({ valueType, normalizedValue })).success).toBe(
      false,
    );
  });

  it.each([
    { originalValue: null },
    { evidenceIds: [] },
    { evidenceIds: [IDS.evidenceA, IDS.evidenceA] },
    { candidates: [makeCandidate()] },
    { rawConfidence: -0.01 },
    { rawConfidence: 1.01 },
    { observedAt: "not-a-date" },
    { outcome: "FAIL" },
  ])("rejects a broken RESOLVED invariant %#", (override) => {
    expect(FactSchema.safeParse(makeResolvedFact(override)).success).toBe(false);
  });
});

describe("FactSchema unresolved facts", () => {
  it.each(["NULL", "NOT_FOUND", "NOT_READABLE"] as const)("accepts %s", (status) => {
    expect(FactSchema.safeParse(makeUnresolvedFact(status)).success).toBe(true);
  });

  it.each(["NULL", "NOT_READABLE"] as const)("requires evidence for %s", (status) => {
    expect(FactSchema.safeParse(makeUnresolvedFact(status, { evidenceIds: [] })).success).toBe(
      false,
    );
  });

  it.each(["NULL", "NOT_FOUND", "NOT_READABLE"] as const)(
    "keeps values and candidates absent for %s",
    (status) => {
      expect(
        FactSchema.safeParse(makeUnresolvedFact(status, { normalizedValue: "implicit" })).success,
      ).toBe(false);
      expect(
        FactSchema.safeParse(makeUnresolvedFact(status, { originalValue: "implicit" })).success,
      ).toBe(false);
      expect(
        FactSchema.safeParse(makeUnresolvedFact(status, { candidates: [makeCandidate()] })).success,
      ).toBe(false);
    },
  );

  it("rejects duplicate unresolved evidence IDs and undeclared outcomes", () => {
    expect(
      FactSchema.safeParse(
        makeUnresolvedFact("NOT_FOUND", { evidenceIds: [IDS.evidenceA, IDS.evidenceA] }),
      ).success,
    ).toBe(false);
    expect(FactSchema.safeParse(makeUnresolvedFact("NOT_FOUND", { outcome: "PASS" })).success).toBe(
      false,
    );
  });
});

describe("FactSchema conflicts", () => {
  it("accepts two contradictory, typed candidates", () => {
    expect(ConflictFactSchema.safeParse(makeConflictFact()).success).toBe(true);
  });

  it.each([
    { rawConfidence: 0.5 },
    { evidenceIds: [IDS.evidenceA] },
    { evidenceIds: [IDS.evidenceA, IDS.evidenceA] },
    { candidates: [makeCandidate()] },
    {
      candidates: [makeCandidate(), makeCandidate({ id: IDS.candidateB })],
    },
    {
      valueType: "NUMBER",
      candidates: [makeCandidate(), makeCandidate({ id: IDS.candidateB, normalizedValue: 2 })],
    },
    { originalValue: "selected" },
    { normalizedValue: "selected" },
    { outcome: "NOT_APPLICABLE" },
  ])("rejects a broken CONFLICT invariant %#", (override) => {
    expect(ConflictFactSchema.safeParse(makeConflictFact(override)).success).toBe(false);
  });

  it("validates candidate provenance, confidence, and strict fields", () => {
    expect(FactCandidateSchema.safeParse(makeCandidate()).success).toBe(true);
    expect(
      FactCandidateSchema.safeParse({ ...makeCandidate(), normalizedValue: null }).success,
    ).toBe(false);
    expect(
      FactCandidateSchema.safeParse(makeCandidate({ evidenceIds: [IDS.evidenceA, IDS.evidenceA] }))
        .success,
    ).toBe(false);
    expect(FactCandidateSchema.safeParse(makeCandidate({ rawConfidence: 2 })).success).toBe(false);
    expect(FactCandidateSchema.safeParse({ ...makeCandidate(), outcome: "PASS" }).success).toBe(
      false,
    );
  });
});

describe("ExtractorRunSchema", () => {
  it.each(["MANUAL", "JSON"] as const)("accepts a model-free %s run", (kind) => {
    expect(ExtractorRunSchema.safeParse(makeRun({ kind })).success).toBe(true);
  });

  it.each(["OLLAMA_OCR", "OLLAMA_VISION", "OLLAMA_LLM", "OLLAMA_EMBEDDING"] as const)(
    "accepts a pinned %s run",
    (kind) => {
      expect(ExtractorRunSchema.safeParse(makeOllamaRun(kind)).success).toBe(true);
    },
  );

  it.each([
    { completedAt: "2026-03-31T23:59:59.999Z" },
    { model: { name: "model", digest: MODEL_HASH, runtime: "OLLAMA", runtimeVersion: "1" } },
    { prompt: "Unexpected prompt" },
    { outcome: "PASS" },
  ])("rejects invalid model-free run metadata %#", (override) => {
    expect(ExtractorRunSchema.safeParse({ ...makeRun(), ...override }).success).toBe(false);
  });

  it("allows a model-free adapter to preserve raw source output", () => {
    expect(ExtractorRunSchema.safeParse(makeRun({ rawOutput: '{"synthetic":true}' })).success).toBe(
      true,
    );
  });

  it.each([{ model: null }, { rawOutput: null }, { prompt: null }])(
    "rejects incomplete prompt-based Ollama metadata %#",
    (override) => {
      expect(
        ExtractorRunSchema.safeParse({ ...makeOllamaRun("OLLAMA_LLM"), ...override }).success,
      ).toBe(false);
    },
  );

  it("rejects prompts for embedding runs and validates model digests strictly", () => {
    expect(
      ExtractorRunSchema.safeParse(makeOllamaRun("OLLAMA_EMBEDDING", { prompt: "No prompt" }))
        .success,
    ).toBe(false);
    expect(
      ExtractorModelSchema.safeParse({
        ...makeOllamaRun("OLLAMA_LLM").model,
        digest: "B".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      ExtractorModelSchema.safeParse({
        ...makeOllamaRun("OLLAMA_LLM").model,
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe("EmbeddingSchema and ExtractionRequestSchema", () => {
  it("accepts a finite dimension-matched embedding", () => {
    expect(EmbeddingSchema.parse(makeEmbedding())).toEqual(makeEmbedding());
  });

  it.each([
    { dimensions: 2 },
    { dimensions: 0 },
    { vector: [] },
    { vector: [Number.POSITIVE_INFINITY] },
    { inputHash: "A".repeat(64) },
    { outcome: "PASS" },
  ])("rejects an invalid embedding %#", (override) => {
    expect(EmbeddingSchema.safeParse({ ...makeEmbedding(), ...override }).success).toBe(false);
  });

  it.each([
    "MANUAL",
    "JSON",
    "OLLAMA_OCR",
    "OLLAMA_VISION",
    "OLLAMA_LLM",
    "OLLAMA_EMBEDDING",
  ] as const)("accepts a strict %s extraction request", (kind) => {
    expect(
      ExtractionRequestSchema.safeParse(makeRequest({ kind, input: makeInput(kind) })).success,
    ).toBe(true);
  });

  it("requires the request kind to match its input discriminator", () => {
    expect(
      ExtractionRequestSchema.safeParse(makeRequest({ kind: "JSON", input: makeInput("MANUAL") }))
        .success,
    ).toBe(false);
  });

  it.each([
    { inputHash: "invalid" },
    { adapterId: "invalid adapter" },
    { requestedAt: "2026-04-01T01:00:00.000+01:00" },
    { kind: "REMOTE" },
    { validationScope: "PROFESSIONAL" },
    { outcome: "NOT_APPLICABLE" },
  ])("rejects an invalid extraction request %#", (override) => {
    expect(ExtractionRequestSchema.safeParse({ ...makeRequest(), ...override }).success).toBe(
      false,
    );
  });
});

describe("ExtractionResultSchema", () => {
  it("accepts linked facts and evidence from one extraction run", () => {
    expect(ExtractionResultSchema.safeParse(makeResult()).success).toBe(true);
  });

  it("accepts embedding-only output from an embedding run", () => {
    expect(
      ExtractionResultSchema.safeParse(
        makeResult({
          run: makeOllamaRun("OLLAMA_EMBEDDING"),
          facts: [],
          evidence: [],
          embeddings: [makeEmbedding()],
        }),
      ).success,
    ).toBe(true);
  });

  it("requires unique embedding keys and uniform dimensions within one run", () => {
    const embeddingRun = makeOllamaRun("OLLAMA_EMBEDDING");
    expect(
      ExtractionResultSchema.safeParse(
        makeResult({
          run: embeddingRun,
          facts: [],
          evidence: [],
          embeddings: [
            makeEmbedding(),
            makeEmbedding({
              id: IDS.factB,
              vector: [0.1, 0.2],
              dimensions: 2,
            }),
          ],
        }),
      ).success,
    ).toBe(false);
    expect(
      ExtractionResultSchema.safeParse(
        makeResult({
          run: embeddingRun,
          facts: [],
          evidence: [],
          embeddings: [makeEmbedding(), makeEmbedding({ id: IDS.factB, key: "synthetic.other" })],
        }),
      ).success,
    ).toBe(true);
  });

  it("rejects duplicate entity IDs and duplicate fact keys", () => {
    const secondFact = FactSchema.parse(
      makeResolvedFact({ id: IDS.factB, evidenceIds: [IDS.evidenceB] }),
    );
    expect(
      ExtractionResultSchema.safeParse(
        makeResult({
          facts: [FactSchema.parse(makeResolvedFact()), { ...secondFact, id: IDS.factA }],
          evidence: [makeEvidence(), makeEvidence({ id: IDS.evidenceB })],
        }),
      ).success,
    ).toBe(false);
    expect(
      ExtractionResultSchema.safeParse(
        makeResult({
          facts: [FactSchema.parse(makeResolvedFact()), secondFact],
          evidence: [makeEvidence(), makeEvidence({ id: IDS.evidenceB })],
        }),
      ).success,
    ).toBe(false);
    expect(
      ExtractionResultSchema.safeParse(
        makeResult({
          facts: [
            FactSchema.parse(
              makeConflictFact({
                candidates: [
                  makeCandidate({ id: IDS.factA }),
                  makeCandidate({
                    id: IDS.candidateB,
                    originalValue: "Beta",
                    normalizedValue: "beta",
                    evidenceIds: [IDS.evidenceB],
                  }),
                ],
              }),
            ),
          ],
          evidence: [makeEvidence(), makeEvidence({ id: IDS.evidenceB })],
        }),
      ).success,
    ).toBe(false);
  });

  it.each([
    [{ facts: [FactSchema.parse(makeResolvedFact({ providerRunId: IDS.otherRun }))] }, "fact run"],
    [
      { facts: [FactSchema.parse(makeResolvedFact({ evidenceIds: [IDS.evidenceB] }))] },
      "evidence link",
    ],
    [{ evidence: [makeEvidence({ providerRunId: IDS.otherRun })] }, "evidence run"],
    [
      {
        facts: [
          FactSchema.parse(
            makeConflictFact({
              candidates: [
                makeCandidate({ providerRunId: IDS.otherRun }),
                makeCandidate({
                  id: IDS.candidateB,
                  originalValue: "Beta",
                  normalizedValue: "beta",
                  evidenceIds: [IDS.evidenceB],
                }),
              ],
            }),
          ),
        ],
        evidence: [makeEvidence(), makeEvidence({ id: IDS.evidenceB })],
      },
      "candidate run",
    ],
    [
      {
        facts: [
          FactSchema.parse(
            makeConflictFact({
              candidates: [
                makeCandidate({ evidenceIds: [IDS.otherRun] }),
                makeCandidate({
                  id: IDS.candidateB,
                  originalValue: "Beta",
                  normalizedValue: "beta",
                  evidenceIds: [IDS.evidenceB],
                }),
              ],
            }),
          ),
        ],
        evidence: [makeEvidence(), makeEvidence({ id: IDS.evidenceB })],
      },
      "candidate evidence",
    ],
    [
      {
        facts: [
          FactSchema.parse(
            makeConflictFact({
              evidenceIds: [IDS.evidenceB, IDS.otherRun],
            }),
          ),
        ],
        evidence: [makeEvidence(), makeEvidence({ id: IDS.evidenceB })],
      },
      "candidate propagation",
    ],
    [
      {
        run: makeOllamaRun("OLLAMA_EMBEDDING"),
        facts: [],
        evidence: [],
        embeddings: [makeEmbedding({ providerRunId: IDS.otherRun })],
      },
      "embedding run",
    ],
  ])("rejects a broken result %s", (override, label) => {
    void label;
    expect(ExtractionResultSchema.safeParse(makeResult(override)).success).toBe(false);
  });

  it("never mixes embedding and fact extraction outputs", () => {
    expect(
      ExtractionResultSchema.safeParse(makeResult({ embeddings: [makeEmbedding()] })).success,
    ).toBe(false);
    expect(
      ExtractionResultSchema.safeParse(
        makeResult({
          run: makeOllamaRun("OLLAMA_EMBEDDING"),
          embeddings: [makeEmbedding()],
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects undeclared normative outcome fields", () => {
    expect(ExtractionResultSchema.safeParse({ ...makeResult(), outcome: "PASS" }).success).toBe(
      false,
    );
  });
});
