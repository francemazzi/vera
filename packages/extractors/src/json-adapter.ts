import {
  FactObservationSchema,
  FactValueTypeSchema,
  NormalizedBoundingBoxSchema,
  canonicalizeJson,
  sha256Bytes,
} from "@vera/contracts";
import type {
  EvidenceObservation,
  ExtractionRequest,
  ExtractionResult,
  FactObservation,
  FactValueType,
  JsonValue,
  NormalizedBoundingBox,
} from "@vera/contracts";

import {
  createLocalExtractorRun,
  defaultExtractorRuntime,
  parseExtractionRequest,
  parseExtractionResult,
  parseRuntimeTimestamp,
  requireAdapterIdentity,
  requireInputKind,
  type ExtractorAdapter,
  type ExtractorRuntime,
} from "./adapter.js";
import { ExtractorValidationError } from "./errors.js";
import { normalizeDecimal, normalizeIsoDate, normalizeUnicode } from "./normalization.js";
import { materializeFactObservations } from "./manual-adapter.js";

const FULL_PAGE: NormalizedBoundingBox = { x: 0, y: 0, width: 1, height: 1 };
const MAX_EVIDENCE_TEXT_CHARACTERS = 20_000;
const MAX_JSON_MAPPINGS = 10_000;
const MAX_POINTERS_PER_MAPPING = 100;
const MAX_TOTAL_JSON_POINTERS = 10_000;

export interface JsonFactMapping {
  readonly key: string;
  readonly valueType: FactValueType;
  readonly pointers: readonly [string, ...string[]];
  readonly boundingBox?: NormalizedBoundingBox;
}

interface PointerResult {
  readonly found: boolean;
  readonly value: JsonValue | undefined;
}

interface ReadableObservation {
  readonly originalValue: JsonValue;
  readonly normalizedValue: JsonValue;
  readonly evidence: EvidenceObservation;
}

function decodePointerToken(token: string): string {
  if (/~(?:[^01]|$)/u.test(token)) {
    throw new ExtractorValidationError("INVALID_JSON_MAPPING", "JSON Pointer escape is invalid", {
      token,
    });
  }
  return token.replace(/~1/gu, "/").replace(/~0/gu, "~");
}

export function resolveJsonPointer(value: JsonValue, pointer: string): PointerResult {
  if (pointer === "") return { found: true, value };
  if (!pointer.startsWith("/")) {
    throw new ExtractorValidationError(
      "INVALID_JSON_MAPPING",
      "JSON Pointer must be empty or start with a slash",
      { pointer },
    );
  }

  let current: JsonValue | undefined = value;
  for (const rawToken of pointer.slice(1).split("/")) {
    const token = decodePointerToken(rawToken);
    if (Array.isArray(current)) {
      const values = current as readonly JsonValue[];
      if (!/^(?:0|[1-9]\d*)$/u.test(token)) return { found: false, value: undefined };
      current = values[Number(token)];
      if (current === undefined) return { found: false, value: undefined };
      continue;
    }
    if (current !== null && typeof current === "object") {
      const record = current as Readonly<Record<string, JsonValue>>;
      if (!Object.hasOwn(record, token)) return { found: false, value: undefined };
      current = record[token];
      continue;
    }
    return { found: false, value: undefined };
  }
  return { found: true, value: current };
}

function normalizeJson(value: JsonValue): JsonValue {
  if (typeof value === "string") return normalizeUnicode(value);
  if (typeof value === "number") return normalizeDecimal(value);
  if (Array.isArray(value)) {
    const items = value as readonly JsonValue[];
    return items.map((item) => normalizeJson(item));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, JsonValue>>;
    return Object.fromEntries(
      Object.entries(record)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, normalizeJson(item)]),
    );
  }
  return value;
}

function normalizeMappedValue(value: JsonValue, valueType: FactValueType): JsonValue | undefined {
  switch (valueType) {
    case "STRING":
      return typeof value === "string" ? normalizeUnicode(value) : undefined;
    case "NUMBER":
      return typeof value === "string" || typeof value === "number"
        ? normalizeDecimal(value)
        : undefined;
    case "BOOLEAN":
      return typeof value === "boolean" ? value : undefined;
    case "DATE":
      return typeof value === "string" ? normalizeIsoDate(value) : undefined;
    case "JSON":
      return normalizeJson(value);
  }
}

function boundedEvidenceText(value: JsonValue): string {
  const canonical = canonicalizeJson(value);
  if (canonical.length <= MAX_EVIDENCE_TEXT_CHARACTERS) return canonical;
  const digest = sha256Bytes(new TextEncoder().encode(canonical));
  const suffix = `\n...[truncated; sha256=${digest}; originalCharacters=${String(canonical.length)}]`;
  const prefixLimit = MAX_EVIDENCE_TEXT_CHARACTERS - suffix.length;
  let prefix = canonical.slice(0, prefixLimit);
  const finalCodeUnit = prefix.charCodeAt(prefix.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) prefix = prefix.slice(0, -1);
  return `${prefix}${suffix}`;
}

function evidenceFor(value: JsonValue, mapping: JsonFactMapping): EvidenceObservation {
  return {
    text: boundedEvidenceText(value),
    boundingBox: mapping.boundingBox ?? FULL_PAGE,
  };
}

function mappingToObservation(value: JsonValue, mapping: JsonFactMapping): FactObservation {
  const resolved = mapping.pointers.map((pointer) => resolveJsonPointer(value, pointer));
  const found = resolved.filter(
    (item): item is { readonly found: true; readonly value: JsonValue } =>
      item.found && item.value !== undefined,
  );
  if (found.length === 0) {
    return FactObservationSchema.parse({
      key: mapping.key,
      valueType: mapping.valueType,
      status: "NOT_FOUND",
      originalValue: null,
      normalizedValue: null,
      rawConfidence: null,
      evidence: [],
      candidates: [],
    });
  }

  const nullValues = found.filter(({ value: item }) => item === null);
  const readable: ReadableObservation[] = [];
  let hasUnreadable = false;
  for (const { value: originalValue } of found) {
    if (originalValue === null) continue;
    try {
      const normalizedValue = normalizeMappedValue(originalValue, mapping.valueType);
      if (normalizedValue === undefined) {
        hasUnreadable = true;
      } else {
        readable.push({
          originalValue,
          normalizedValue,
          evidence: evidenceFor(originalValue, mapping),
        });
      }
    } catch {
      hasUnreadable = true;
    }
  }

  if (readable.length === 0 && !hasUnreadable) {
    return FactObservationSchema.parse({
      key: mapping.key,
      valueType: mapping.valueType,
      status: "NULL",
      originalValue: null,
      normalizedValue: null,
      rawConfidence: null,
      evidence: nullValues.map(({ value: item }) => evidenceFor(item, mapping)),
      candidates: [],
    });
  }

  if (hasUnreadable || nullValues.length > 0) {
    return FactObservationSchema.parse({
      key: mapping.key,
      valueType: mapping.valueType,
      status: "NOT_READABLE",
      originalValue: null,
      normalizedValue: null,
      rawConfidence: null,
      evidence: found.map(({ value: item }) => evidenceFor(item, mapping)),
      candidates: [],
    });
  }

  const distinct = new Set(
    readable.map(({ normalizedValue }) => canonicalizeJson(normalizedValue)),
  );
  if (distinct.size > 1) {
    return FactObservationSchema.parse({
      key: mapping.key,
      valueType: mapping.valueType,
      status: "CONFLICT",
      originalValue: null,
      normalizedValue: null,
      rawConfidence: null,
      evidence: [],
      candidates: readable.map((item) => ({
        originalValue: item.originalValue,
        normalizedValue: item.normalizedValue,
        rawConfidence: 1,
        evidence: [item.evidence],
      })),
    });
  }

  const first = readable[0] as ReadableObservation;
  return FactObservationSchema.parse({
    key: mapping.key,
    valueType: mapping.valueType,
    status: "RESOLVED",
    originalValue: first.originalValue,
    normalizedValue: first.normalizedValue,
    rawConfidence: 1,
    evidence: readable.map(({ evidence }) => evidence),
    candidates: [],
  });
}

export class JsonExtractorAdapter implements ExtractorAdapter {
  public readonly id: string;
  public readonly kind = "JSON" as const;
  readonly #mappings: readonly JsonFactMapping[];
  readonly #runtime: ExtractorRuntime;

  public constructor(
    mappings: readonly JsonFactMapping[],
    options: { readonly id?: string; readonly runtime?: ExtractorRuntime } = {},
  ) {
    const totalPointers = mappings.reduce((total, mapping) => total + mapping.pointers.length, 0);
    if (mappings.length > MAX_JSON_MAPPINGS || totalPointers > MAX_TOTAL_JSON_POINTERS) {
      throw new ExtractorValidationError(
        "INVALID_JSON_MAPPING",
        "JSON adapter mapping budgets were exceeded",
        { mappingCount: mappings.length, pointerCount: totalPointers },
      );
    }
    const keys = mappings.map(({ key }) => key);
    if (new Set(keys).size !== keys.length) {
      throw new ExtractorValidationError(
        "DUPLICATE_FACT_KEY",
        "JSON adapter mappings must use unique fact keys",
      );
    }
    for (const mapping of mappings) {
      if (
        !/^[A-Za-z][A-Za-z0-9._-]*$/u.test(mapping.key) ||
        mapping.key.length > 200 ||
        !FactValueTypeSchema.safeParse(mapping.valueType).success ||
        mapping.pointers.length === 0 ||
        mapping.pointers.length > MAX_POINTERS_PER_MAPPING ||
        new Set(mapping.pointers).size !== mapping.pointers.length ||
        (mapping.boundingBox !== undefined &&
          !NormalizedBoundingBoxSchema.safeParse(mapping.boundingBox).success)
      ) {
        throw new ExtractorValidationError(
          "INVALID_JSON_MAPPING",
          "JSON fact mapping does not satisfy key, type, pointer, or bounding-box constraints",
          { key: mapping.key },
        );
      }
      for (const pointer of mapping.pointers) resolveJsonPointer(null, pointer);
    }
    this.id = options.id ?? "json.local";
    this.#mappings = structuredClone(mappings);
    this.#runtime = options.runtime ?? defaultExtractorRuntime;
  }

  public supports(kind: ExtractionRequest["kind"]): boolean {
    return kind === this.kind;
  }

  public async extract(value: ExtractionRequest): Promise<ExtractionResult> {
    await Promise.resolve();
    const request = parseExtractionRequest(value);
    requireInputKind(request, this.kind);
    requireAdapterIdentity(request, this.id);

    const startedAt = parseRuntimeTimestamp(this.#runtime.now());
    const runContext = createLocalExtractorRun(request, this.#runtime, startedAt, startedAt);
    const observations = this.#mappings.map((mapping) =>
      mappingToObservation(request.input.value, mapping),
    );
    const { facts, evidence } = materializeFactObservations(
      observations,
      request,
      runContext,
      this.#runtime,
    );
    const completedAt = parseRuntimeTimestamp(this.#runtime.now());
    const run = { ...runContext, completedAt };

    return parseExtractionResult({
      requestId: request.id,
      run,
      facts,
      evidence,
      embeddings: [],
      validationScope: request.validationScope,
    });
  }
}
