import { inflateRawSync } from "node:zlib";

import { sha256Bytes } from "@vera/contracts";

import type { DatasetArtifactFormat, DatasetAuditIssue, DatasetAuditIssueCode } from "./schema.js";

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const MAX_JSON_NODES = 500_000;
const MAX_JSON_DEPTH = 128;
const MAX_ZIP_ENTRIES = 10_000;
const MAX_ZIP_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_RATIO = 200;
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

export interface FormatValidationResult {
  readonly contentHash: string;
  readonly detectedFormat: DatasetArtifactFormat;
  readonly issues: readonly DatasetAuditIssue[];
  readonly parsedJson?: unknown;
}

function issue(code: DatasetAuditIssueCode, severity: "WARNING" | "ERROR"): DatasetAuditIssue {
  return { code, severity };
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => value[index] === byte);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validatePng(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, PNG_SIGNATURE)) return false;
  let offset = PNG_SIGNATURE.length;
  let chunks = 0;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  while (offset + 12 <= bytes.byteLength) {
    chunks += 1;
    if (chunks > 100_000) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    const length = view.getUint32(0, false);
    const end = offset + 12 + length;
    if (end > bytes.byteLength) return false;
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    if (!typeBytes.every((byte) => byte >= 65 && byte <= 122)) return false;
    const type = String.fromCharCode(...typeBytes);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset + 8 + length,
      4,
    ).getUint32(0, false);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== expectedCrc) return false;
    if (chunks === 1) {
      if (type !== "IHDR" || length !== 13) return false;
      const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (header.getUint32(0, false) === 0 || header.getUint32(4, false) === 0) return false;
      sawHeader = true;
    }
    if (type === "IDAT") sawData = true;
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.byteLength) return false;
      sawEnd = true;
      break;
    }
    offset = end;
  }
  return sawHeader && sawData && sawEnd;
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isBoundedJson(value: unknown): boolean {
  const stack: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 1 }];
  let nodes = 0;
  while (stack.length > 0) {
    const entry = stack.pop();
    /* v8 ignore next -- the loop guard guarantees a populated stack */
    if (entry === undefined) break;
    nodes += 1;
    if (nodes > MAX_JSON_NODES || entry.depth > MAX_JSON_DEPTH) return false;
    if (entry.value === null || typeof entry.value !== "object") continue;
    if (Array.isArray(entry.value)) {
      for (const nested of entry.value) stack.push({ value: nested, depth: entry.depth + 1 });
    } else {
      for (const nested of Object.values(entry.value as Record<string, unknown>)) {
        stack.push({ value: nested, depth: entry.depth + 1 });
      }
    }
  }
  return true;
}

type JsonParseResult =
  { readonly success: true; readonly value: unknown } | { readonly success: false };

function parseJson(text: string): JsonParseResult {
  try {
    const parsed: unknown = JSON.parse(text.startsWith("\ufeff") ? text.slice(1) : text);
    return isBoundedJson(parsed) ? { success: true, value: parsed } : { success: false };
  } catch {
    return { success: false };
  }
}

function parseJsonLines(text: string): readonly unknown[] | null {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length === 0 || lines.length > MAX_JSON_NODES) return null;
  const values: unknown[] = [];
  let nodes = 0;
  for (const line of lines) {
    const parsed = parseJson(line);
    if (!parsed.success) return null;
    values.push(parsed.value);
    nodes += 1;
    if (nodes > MAX_JSON_NODES) return null;
  }
  return values;
}

interface ZipEntry {
  readonly name: string;
  readonly flags: number;
  readonly method: number;
  readonly crc: number;
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
  readonly localOffset: number;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (
      new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true) ===
      ZIP_EOCD_SIGNATURE
    ) {
      return offset;
    }
  }
  return -1;
}

function parseZipEntries(bytes: Uint8Array): readonly ZipEntry[] | null {
  const eocdOffset = findEndOfCentralDirectory(bytes);
  if (eocdOffset < 0) return null;
  const eocd = new DataView(
    bytes.buffer,
    bytes.byteOffset + eocdOffset,
    bytes.byteLength - eocdOffset,
  );
  if (eocd.byteLength < 22 || eocd.getUint16(4, true) !== 0 || eocd.getUint16(6, true) !== 0) {
    return null;
  }
  const entriesOnDisk = eocd.getUint16(8, true);
  const entryCount = eocd.getUint16(10, true);
  const centralBytes = eocd.getUint32(12, true);
  const centralOffset = eocd.getUint32(16, true);
  const commentBytes = eocd.getUint16(20, true);
  if (
    entriesOnDisk !== entryCount ||
    entryCount === 0 ||
    entryCount > MAX_ZIP_ENTRIES ||
    centralOffset === 0xffffffff ||
    centralBytes === 0xffffffff ||
    eocdOffset + 22 + commentBytes !== bytes.byteLength ||
    centralOffset + centralBytes !== eocdOffset
  ) {
    return null;
  }

  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocdOffset) return null;
    const header = new DataView(bytes.buffer, bytes.byteOffset + offset, eocdOffset - offset);
    if (header.getUint32(0, true) !== ZIP_CENTRAL_SIGNATURE) return null;
    const flags = header.getUint16(8, true);
    const method = header.getUint16(10, true);
    const expectedCrc = header.getUint32(16, true);
    const compressedBytes = header.getUint32(20, true);
    const uncompressedBytes = header.getUint32(24, true);
    const nameBytes = header.getUint16(28, true);
    const extraBytes = header.getUint16(30, true);
    const entryCommentBytes = header.getUint16(32, true);
    const localOffset = header.getUint32(42, true);
    const end = offset + 46 + nameBytes + extraBytes + entryCommentBytes;
    if (
      end > eocdOffset ||
      (flags & 0x1) !== 0 ||
      (method !== 0 && method !== 8) ||
      compressedBytes === 0xffffffff ||
      uncompressedBytes === 0xffffffff ||
      uncompressedBytes > MAX_ZIP_ENTRY_BYTES ||
      localOffset === 0xffffffff
    ) {
      return null;
    }
    if (
      uncompressedBytes > 0 &&
      (compressedBytes === 0 || uncompressedBytes / compressedBytes > MAX_ZIP_RATIO)
    ) {
      return null;
    }
    totalUncompressed += uncompressedBytes;
    if (totalUncompressed > MAX_ZIP_TOTAL_BYTES) return null;
    const name = decodeUtf8(bytes.subarray(offset + 46, offset + 46 + nameBytes));
    if (
      name === null ||
      name.length === 0 ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..")
    ) {
      return null;
    }
    entries.push({
      name,
      flags,
      method,
      crc: expectedCrc,
      compressedBytes,
      uncompressedBytes,
      localOffset,
    });
    offset = end;
  }
  return offset === eocdOffset ? entries : null;
}

function extractZipEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array | null {
  if (entry.name.endsWith("/")) return new Uint8Array();
  if (entry.localOffset + 30 > bytes.byteLength) return null;
  const header = new DataView(
    bytes.buffer,
    bytes.byteOffset + entry.localOffset,
    bytes.byteLength - entry.localOffset,
  );
  if (
    header.getUint32(0, true) !== ZIP_LOCAL_SIGNATURE ||
    header.getUint16(6, true) !== entry.flags ||
    header.getUint16(8, true) !== entry.method
  ) {
    return null;
  }
  const nameBytes = header.getUint16(26, true);
  const extraBytes = header.getUint16(28, true);
  const dataOffset = entry.localOffset + 30 + nameBytes + extraBytes;
  const dataEnd = dataOffset + entry.compressedBytes;
  if (dataEnd > bytes.byteLength) return null;
  const compressed = bytes.subarray(dataOffset, dataEnd);
  let output: Uint8Array;
  try {
    output =
      entry.method === 0
        ? Uint8Array.from(compressed)
        : inflateRawSync(compressed, { maxOutputLength: MAX_ZIP_ENTRY_BYTES });
  } catch {
    return null;
  }
  if (output.byteLength !== entry.uncompressedBytes || crc32(output) !== entry.crc) return null;
  return output;
}

function validateXlsx(bytes: Uint8Array): boolean {
  const entries = parseZipEntries(bytes);
  if (entries === null) return false;
  const names = new Set(entries.map(({ name }) => name));
  if (!names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")) return false;
  let contentTypes: string | null = null;
  let workbook: string | null = null;
  for (const entry of entries) {
    const extracted = extractZipEntry(bytes, entry);
    if (extracted === null) return false;
    if (entry.name === "[Content_Types].xml") contentTypes = decodeUtf8(extracted);
    if (entry.name === "xl/workbook.xml") workbook = decodeUtf8(extracted);
  }
  return (
    contentTypes !== null &&
    workbook !== null &&
    /spreadsheetml/u.test(contentTypes) &&
    /<(?:[A-Za-z][\w.-]*:)?workbook(?:\s|>)/u.test(workbook)
  );
}

type KnownFormat = "PNG" | "JSON" | "JSONL" | "XLSX";

function extensionExpectedFormat(extension: string): KnownFormat | null {
  switch (extension.toLocaleLowerCase("en-US")) {
    case ".png":
      return "PNG";
    case ".json":
      return "JSON";
    case ".jsonl":
    case ".ndjson":
      return "JSONL";
    case ".xlsx":
      return "XLSX";
    default:
      return null;
  }
}

function invalidCode(format: KnownFormat): DatasetAuditIssueCode {
  switch (format) {
    case "PNG":
      return "INVALID_PNG";
    case "JSON":
      return "INVALID_JSON";
    case "JSONL":
      return "INVALID_JSONL";
    case "XLSX":
      return "INVALID_XLSX";
  }
}

function parseTextFormat(
  bytes: Uint8Array,
  preferred: DatasetArtifactFormat | null,
): { readonly format: "JSON" | "JSONL"; readonly parsed: unknown } | null {
  const text = decodeUtf8(bytes);
  if (text === null || text.trim().length === 0) return null;
  if (preferred === "JSONL") {
    const jsonLines = parseJsonLines(text);
    if (jsonLines !== null) return { format: "JSONL", parsed: jsonLines };
  }
  const json = parseJson(text);
  if (json.success) return { format: "JSON", parsed: json.value };
  const jsonLines = parseJsonLines(text);
  return jsonLines === null ? null : { format: "JSONL", parsed: jsonLines };
}

export function validateArtifactContent(
  bytes: Uint8Array,
  extension: string,
): FormatValidationResult {
  const expected = extensionExpectedFormat(extension);
  const issues: DatasetAuditIssue[] = [];
  let detectedFormat: DatasetArtifactFormat = "UNKNOWN";
  let parsedJson: unknown;
  let valid = false;

  if (startsWith(bytes, PNG_SIGNATURE)) {
    detectedFormat = "PNG";
    valid = validatePng(bytes);
  } else if (
    bytes.byteLength >= 4 &&
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) ===
      ZIP_LOCAL_SIGNATURE
  ) {
    const isXlsx = validateXlsx(bytes);
    detectedFormat = isXlsx ? "XLSX" : expected === "XLSX" ? "XLSX" : "AUXILIARY";
    valid = isXlsx;
  } else {
    const parsed = parseTextFormat(bytes, expected);
    if (parsed !== null) {
      detectedFormat = parsed.format;
      parsedJson = parsed.parsed;
      valid = true;
    }
  }

  if (!valid && expected !== null) {
    issues.push(issue(invalidCode(expected), "ERROR"));
  } else if (!valid) {
    detectedFormat = "AUXILIARY";
    issues.push(issue("AUXILIARY_FORMAT", "WARNING"));
  }
  if (valid && expected === null) {
    issues.push(issue("EXTENSION_CONTENT_MISMATCH", "WARNING"));
  }
  if (expected !== null && detectedFormat !== expected) {
    issues.push(issue("EXTENSION_CONTENT_MISMATCH", "WARNING"));
  }

  return {
    contentHash: sha256Bytes(bytes),
    detectedFormat,
    issues,
    ...(parsedJson === undefined ? {} : { parsedJson }),
  };
}
