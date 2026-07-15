import type { ExtractionRequest } from "@vera/contracts";
import { describe, expect, it } from "vitest";

import type { ExtractorRuntime } from "../../src/adapter.js";
import { ExtractorValidationError } from "../../src/errors.js";
import {
  JsonExtractorAdapter,
  type JsonFactMapping,
  resolveJsonPointer,
} from "../../src/json-adapter.js";

const REQUEST_ID = "00000000-0000-4000-8000-000000000011";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000012";
const HASH = "b".repeat(64);
const AT = "2026-07-15T11:00:00.000Z";
type JsonInputValue = Extract<ExtractionRequest["input"], { readonly kind: "JSON" }>["value"];

function deterministicRuntime(): ExtractorRuntime {
  let id = 500;
  return {
    createId: () => {
      id += 1;
      return `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
    },
    now: () => AT,
    runtimeVersion: "synthetic-runtime-1",
  };
}

const VALUE: JsonInputValue = {
  name: "  Ａ\u00a0value  ",
  nullable: null,
  unreadable: { source: "blurred" },
  left: "1.50",
  right: 2,
  same: 1.5,
  calendar: "2024-02-29",
  flag: true,
  badDecimal: "01",
  complex: { z: [" Ａ ", 2, true, null], a: " first " },
  nested: { "a/b": ["first", "second"] },
};

function jsonRequest(value: JsonInputValue = VALUE): ExtractionRequest {
  return {
    id: REQUEST_ID,
    adapterId: "json.local",
    kind: "JSON",
    inputHash: HASH,
    requestedAt: AT,
    input: {
      kind: "JSON",
      documentId: DOCUMENT_ID,
      documentHash: HASH,
      page: 1,
      language: "en",
      value,
    },
    validationScope: "TECHNICAL_DEMO",
  };
}

const MAPPINGS: readonly JsonFactMapping[] = [
  { key: "synthetic.name", valueType: "STRING", pointers: ["/name"] },
  { key: "synthetic.null", valueType: "STRING", pointers: ["/nullable"] },
  { key: "synthetic.missing", valueType: "STRING", pointers: ["/missing"] },
  { key: "synthetic.unreadable", valueType: "NUMBER", pointers: ["/unreadable"] },
  { key: "synthetic.conflict", valueType: "NUMBER", pointers: ["/left", "/right"] },
  { key: "synthetic.same", valueType: "NUMBER", pointers: ["/left", "/same"] },
  { key: "synthetic.date", valueType: "DATE", pointers: ["/calendar"] },
];

describe("resolveJsonPointer", () => {
  it("supports root, escaped object keys, and canonical array indexes", () => {
    expect(resolveJsonPointer(VALUE, "")).toEqual({ found: true, value: VALUE });
    expect(resolveJsonPointer(VALUE, "/nested/a~1b/1")).toEqual({
      found: true,
      value: "second",
    });
    expect(resolveJsonPointer({ "a~b": true }, "/a~0b")).toEqual({ found: true, value: true });
  });

  it("distinguishes missing paths from present null values", () => {
    expect(resolveJsonPointer(VALUE, "/missing")).toEqual({ found: false, value: undefined });
    expect(resolveJsonPointer(VALUE, "/nullable")).toEqual({ found: true, value: null });
    expect(resolveJsonPointer(VALUE, "/nested/a~1b/01")).toEqual({
      found: false,
      value: undefined,
    });
    expect(resolveJsonPointer(VALUE, "/name/child")).toEqual({
      found: false,
      value: undefined,
    });
  });

  it.each(["not-a-pointer", "/invalid~2escape", "/trailing~"])(
    "rejects invalid JSON Pointer %s",
    (pointer) => {
      expect(() => resolveJsonPointer(VALUE, pointer)).toThrow(ExtractorValidationError);
    },
  );
});

describe("JsonExtractorAdapter", () => {
  it("normalizes mapped facts while preserving missing, null, unreadable, and conflict", async () => {
    const adapter = new JsonExtractorAdapter(MAPPINGS, { runtime: deterministicRuntime() });
    const result = await adapter.extract(jsonRequest());

    expect(result.facts.map(({ key, status }) => [key, status])).toEqual([
      ["synthetic.name", "RESOLVED"],
      ["synthetic.null", "NULL"],
      ["synthetic.missing", "NOT_FOUND"],
      ["synthetic.unreadable", "NOT_READABLE"],
      ["synthetic.conflict", "CONFLICT"],
      ["synthetic.same", "RESOLVED"],
      ["synthetic.date", "RESOLVED"],
    ]);
    expect(result.facts.find(({ key }) => key === "synthetic.name")?.normalizedValue).toBe(
      "A value",
    );
    expect(result.facts.find(({ key }) => key === "synthetic.same")?.normalizedValue).toBe(1.5);
    expect(result.facts.find(({ key }) => key === "synthetic.date")?.normalizedValue).toBe(
      "2024-02-29",
    );
    const conflict = result.facts.find(({ key }) => key === "synthetic.conflict");
    expect(conflict?.candidates.map(({ normalizedValue }) => normalizedValue)).toEqual([1.5, 2]);
    expect(conflict?.rawConfidence).toBeNull();
    expect(result.evidence).not.toHaveLength(0);
    expect(result).not.toHaveProperty("outcome");
  });

  it("treats a mixture of readable and null observations as not readable", async () => {
    const adapter = new JsonExtractorAdapter(
      [{ key: "synthetic.mixed", valueType: "NUMBER", pointers: ["/left", "/nullable"] }],
      { runtime: deterministicRuntime() },
    );

    const result = await adapter.extract(jsonRequest());

    expect(result.facts[0]).toMatchObject({
      key: "synthetic.mixed",
      status: "NOT_READABLE",
      originalValue: null,
      normalizedValue: null,
    });
  });

  it("normalizes boolean and recursively canonical JSON mappings", async () => {
    const adapter = new JsonExtractorAdapter(
      [
        { key: "synthetic.flag", valueType: "BOOLEAN", pointers: ["/flag"] },
        { key: "synthetic.json", valueType: "JSON", pointers: ["/complex"] },
        { key: "synthetic.badDecimal", valueType: "NUMBER", pointers: ["/badDecimal"] },
      ],
      { runtime: deterministicRuntime() },
    );

    const result = await adapter.extract(jsonRequest());

    expect(result.facts[0]?.normalizedValue).toBe(true);
    expect(result.facts[1]?.normalizedValue).toEqual({
      a: "first",
      z: ["A", 2, true, null],
    });
    expect(result.facts[2]?.status).toBe("NOT_READABLE");
    expect(adapter.supports("JSON")).toBe(true);
    expect(adapter.supports("MANUAL")).toBe(false);
  });

  it("rejects duplicate keys, invalid pointers, and wrong adapter kinds", async () => {
    expect(
      () =>
        new JsonExtractorAdapter([
          { key: "synthetic.duplicate", valueType: "STRING", pointers: ["/name"] },
          { key: "synthetic.duplicate", valueType: "STRING", pointers: ["/name"] },
        ]),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_FACT_KEY" }));
    expect(
      () =>
        new JsonExtractorAdapter([
          { key: "synthetic.invalid", valueType: "STRING", pointers: ["bad"] },
        ]),
    ).toThrow(expect.objectContaining({ code: "INVALID_JSON_MAPPING" }));
    expect(
      () =>
        new JsonExtractorAdapter([
          {
            key: "synthetic.too-many",
            valueType: "STRING",
            pointers: Array.from({ length: 101 }, (_, index) => `/value/${String(index)}`) as [
              string,
              ...string[],
            ],
          },
        ]),
    ).toThrow(expect.objectContaining({ code: "INVALID_JSON_MAPPING" }));
    expect(
      () =>
        new JsonExtractorAdapter([
          { key: `a${"b".repeat(200)}`, valueType: "STRING", pointers: ["/value"] },
        ]),
    ).toThrow(expect.objectContaining({ code: "INVALID_JSON_MAPPING" }));
    expect(
      () =>
        new JsonExtractorAdapter([
          { key: "synthetic.duplicate-pointer", valueType: "STRING", pointers: ["/a", "/a"] },
        ]),
    ).toThrow(expect.objectContaining({ code: "INVALID_JSON_MAPPING" }));
    expect(
      () =>
        new JsonExtractorAdapter(
          Array.from({ length: 10_001 }, (_, index) => ({
            key: `synthetic.budget.${String(index)}`,
            valueType: "STRING" as const,
            pointers: ["/value"] as const,
          })),
        ),
    ).toThrow(expect.objectContaining({ code: "INVALID_JSON_MAPPING" }));
    expect(
      () =>
        new JsonExtractorAdapter([
          {
            key: "synthetic.invalidBox",
            valueType: "STRING",
            pointers: ["/name"],
            boundingBox: { x: 0.9, y: 0, width: 0.2, height: 1 },
          },
        ]),
    ).toThrow(expect.objectContaining({ code: "INVALID_JSON_MAPPING" }));

    const adapter = new JsonExtractorAdapter(MAPPINGS, { runtime: deterministicRuntime() });
    const manual: ExtractionRequest = {
      ...jsonRequest(),
      kind: "MANUAL",
      input: {
        kind: "MANUAL",
        documentId: DOCUMENT_ID,
        documentHash: HASH,
        page: 1,
        language: "en",
        observations: [],
      },
    };
    await expect(adapter.extract(manual)).rejects.toMatchObject({ code: "UNSUPPORTED_INPUT_KIND" });
  });

  it("defensively snapshots mappings at construction", async () => {
    const mappings: JsonFactMapping[] = [
      { key: "synthetic.name", valueType: "STRING", pointers: ["/name"] },
    ];
    const adapter = new JsonExtractorAdapter(mappings, { runtime: deterministicRuntime() });
    mappings[0] = { key: "synthetic.changed", valueType: "STRING", pointers: ["/missing"] };

    const result = await adapter.extract(jsonRequest());

    expect(result.facts[0]?.key).toBe("synthetic.name");
  });

  it("records a content-addressed summary when local raw input exceeds the run limit", async () => {
    const adapter = new JsonExtractorAdapter([], { runtime: deterministicRuntime() });
    const result = await adapter.extract(jsonRequest({ payload: "x".repeat(2_000_001) }));

    expect(result.run.rawOutput?.length).toBeLessThan(2_000_000);
    expect(result.run.options).toMatchObject({
      rawOutputTruncated: true,
    });
    expect(typeof result.run.options["canonicalInputSha256"]).toBe("string");
    expect(result.run.options["canonicalInputSha256"]).toMatch(/^[0-9a-f]{64}$/u);
    expect(typeof result.run.options["originalCharacters"]).toBe("number");
    expect(typeof result.run.options["originalBytes"]).toBe("number");
    expect(JSON.parse(result.run.rawOutput ?? "null")).toMatchObject({
      preservation: "CONTENT_ADDRESSED_SOURCE_REQUIRED",
    });
  });

  it("bounds long evidence excerpts and retains a content hash", async () => {
    const mapping = [
      { key: "synthetic.payload", valueType: "STRING", pointers: ["/payload"] },
    ] as const;
    const exactAdapter = new JsonExtractorAdapter(mapping, { runtime: deterministicRuntime() });
    const exact = await exactAdapter.extract(jsonRequest({ payload: "x".repeat(19_998) }));
    expect(exact.evidence[0]?.text).toHaveLength(20_000);
    expect(exact.evidence[0]?.text).not.toContain("[truncated;");

    const longAdapter = new JsonExtractorAdapter(mapping, { runtime: deterministicRuntime() });
    const long = await longAdapter.extract(jsonRequest({ payload: "x".repeat(20_001) }));
    expect(long.evidence[0]?.text.length).toBeLessThanOrEqual(20_000);
    expect(long.evidence[0]?.text).toMatch(
      /\[truncated; sha256=[0-9a-f]{64}; originalCharacters=20003\]$/u,
    );
    expect(long.facts[0]?.normalizedValue).toBe("x".repeat(20_001));
  });
});
