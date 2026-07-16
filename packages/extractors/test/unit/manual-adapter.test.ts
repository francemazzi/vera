import type { EvidenceObservation, ExtractionRequest } from "@vera/contracts";
import { describe, expect, it } from "vitest";

import type { ExtractorRuntime } from "../../src/adapter.js";
import {
  defaultExtractorRuntime,
  elapsedMilliseconds,
  parseExtractionResult,
  parseRuntimeTimestamp,
} from "../../src/adapter.js";
import { ExtractorValidationError } from "../../src/errors.js";
import { ManualExtractorAdapter } from "../../src/manual-adapter.js";

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000002";
const HASH = "a".repeat(64);
const START = "2026-07-15T10:00:00.000Z";
const END = "2026-07-15T10:00:00.025Z";

function deterministicRuntime(): ExtractorRuntime {
  let id = 100;
  let clockRead = 0;
  return {
    createId: () => {
      id += 1;
      return `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
    },
    now: () => {
      const read = clockRead++;
      if (read === 1 && id <= 101) {
        throw new Error("Completion was sampled before fact materialization");
      }
      return read === 0 ? START : END;
    },
    runtimeVersion: "synthetic-runtime-1",
  };
}

function manualRequest(): ExtractionRequest {
  const evidence = (text: string): EvidenceObservation => ({
    text,
    boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
  });

  return {
    id: REQUEST_ID,
    adapterId: "manual.local",
    kind: "MANUAL",
    inputHash: HASH,
    requestedAt: START,
    input: {
      kind: "MANUAL",
      documentId: DOCUMENT_ID,
      documentHash: HASH,
      page: 1,
      language: "en",
      observations: [
        {
          key: "synthetic.name",
          valueType: "STRING",
          status: "RESOLVED",
          originalValue: " Ａ value ",
          normalizedValue: "A value",
          rawConfidence: 0.9,
          evidence: [evidence("A value")],
          candidates: [],
        },
        {
          key: "synthetic.null",
          valueType: "STRING",
          status: "NULL",
          originalValue: null,
          normalizedValue: null,
          rawConfidence: null,
          evidence: [evidence("null")],
          candidates: [],
        },
        {
          key: "synthetic.missing",
          valueType: "NUMBER",
          status: "NOT_FOUND",
          originalValue: null,
          normalizedValue: null,
          rawConfidence: null,
          evidence: [],
          candidates: [],
        },
        {
          key: "synthetic.unreadable",
          valueType: "NUMBER",
          status: "NOT_READABLE",
          originalValue: null,
          normalizedValue: null,
          rawConfidence: 0.1,
          evidence: [evidence("blurred")],
          candidates: [],
        },
        {
          key: "synthetic.conflict",
          valueType: "NUMBER",
          status: "CONFLICT",
          originalValue: null,
          normalizedValue: null,
          rawConfidence: null,
          evidence: [],
          candidates: [
            {
              originalValue: "1",
              normalizedValue: 1,
              rawConfidence: 0.8,
              evidence: [evidence("one")],
            },
            {
              originalValue: "2",
              normalizedValue: 2,
              rawConfidence: 0.7,
              evidence: [evidence("two")],
            },
          ],
        },
      ],
    },
    validationScope: "TECHNICAL_DEMO",
  };
}

describe("ManualExtractorAdapter", () => {
  it("materializes every technical fact state with run-bound provenance", async () => {
    const adapter = new ManualExtractorAdapter({ runtime: deterministicRuntime() });
    const result = await adapter.extract(manualRequest());

    expect(result.facts.map(({ status }) => status)).toEqual([
      "RESOLVED",
      "NULL",
      "NOT_FOUND",
      "NOT_READABLE",
      "CONFLICT",
    ]);
    expect(result.run).toMatchObject({
      adapterId: "manual.local",
      kind: "MANUAL",
      startedAt: START,
      completedAt: END,
      model: null,
      prompt: null,
      options: {},
    });
    expect(result.run.rawOutput).toContain('"observations"');
    expect(result.facts.every(({ providerRunId }) => providerRunId === result.run.id)).toBe(true);
    expect(result.evidence.every(({ providerRunId }) => providerRunId === result.run.id)).toBe(
      true,
    );
    expect(result.evidence.every(({ documentHash }) => documentHash === HASH)).toBe(true);
    expect(result.facts.find(({ status }) => status === "CONFLICT")?.candidates).toHaveLength(2);
    expect(result).not.toHaveProperty("outcome");
  });

  it("reports its closed input support", () => {
    const adapter = new ManualExtractorAdapter();

    expect(adapter.supports("MANUAL")).toBe(true);
    expect(adapter.supports("JSON")).toBe(false);
  });

  it("rejects malformed requests, adapter mismatches, and hash mismatches", async () => {
    const adapter = new ManualExtractorAdapter({ runtime: deterministicRuntime() });

    const malformed = { ...manualRequest(), unexpected: true } as ExtractionRequest & {
      readonly unexpected: boolean;
    };
    await expect(adapter.extract(malformed)).rejects.toMatchObject({
      code: "INVALID_EXTRACTION_REQUEST",
    });
    await expect(
      adapter.extract({ ...manualRequest(), adapterId: "manual.other" }),
    ).rejects.toMatchObject({ code: "INVALID_EXTRACTION_REQUEST" });
    await expect(
      adapter.extract({ ...manualRequest(), inputHash: "b".repeat(64) }),
    ).rejects.toMatchObject({ code: "INVALID_EXTRACTION_REQUEST" });
  });

  it("rejects a different input kind without producing partial output", async () => {
    const adapter = new ManualExtractorAdapter({ runtime: deterministicRuntime() });
    const request = manualRequest();
    const mismatched = {
      ...request,
      kind: "JSON",
      input: {
        kind: "JSON",
        documentId: DOCUMENT_ID,
        documentHash: HASH,
        page: 1,
        language: "en",
        value: {},
      },
    } as const;

    await expect(adapter.extract(mismatched)).rejects.toMatchObject({
      code: "UNSUPPORTED_INPUT_KIND",
    });
  });

  it("validates output strictly so a normative outcome field cannot escape", async () => {
    const adapter = new ManualExtractorAdapter({ runtime: deterministicRuntime() });
    const result = await adapter.extract(manualRequest());

    expect(() => parseExtractionResult({ ...result, outcome: "PASS" })).toThrow(
      expect.objectContaining({ code: "INVALID_EXTRACTION_OUTPUT" }),
    );
  });
});

describe("adapter runtime guards", () => {
  it("accepts canonical UTC timestamps and computes elapsed time", () => {
    expect(parseRuntimeTimestamp(START)).toBe(START);
    expect(elapsedMilliseconds(START, END)).toBe(25);
  });

  it("rejects invalid and non-monotonic runtime timestamps", () => {
    expect(() => parseRuntimeTimestamp("not-a-date")).toThrow(ExtractorValidationError);
    expect(() => elapsedMilliseconds(END, START)).toThrow(
      expect.objectContaining({ code: "INVALID_EXTRACTION_OUTPUT" }),
    );
  });

  it("provides a canonical default local runtime", () => {
    expect(defaultExtractorRuntime.createId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(defaultExtractorRuntime.now()).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/u);
    expect(defaultExtractorRuntime.runtimeVersion).not.toBe("");
  });
});
