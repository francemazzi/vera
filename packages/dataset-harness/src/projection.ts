import { canonicalizeJson, sha256Bytes } from "@vera/contracts";

import {
  DatasetProjectionConfigSchema,
  type DatasetAuditIssue,
  type DatasetProjectionAudit,
  type DatasetProjectionConfig,
} from "./schema.js";

export interface ProjectionArtifact {
  readonly relativePath: string;
  readonly format: "PNG" | "JSON" | "JSONL" | "XLSX" | "AUXILIARY" | "UNKNOWN";
  readonly parsedJson?: unknown;
}

interface ResolvedCollection {
  readonly id: string;
  readonly items: readonly unknown[];
  readonly itemIds: ReadonlySet<string>;
}

interface PointerResult {
  readonly found: boolean;
  readonly value: unknown;
}

function hashId(value: string): string {
  return sha256Bytes(new TextEncoder().encode(value.normalize("NFC")));
}

function issue(
  code: DatasetAuditIssue["code"],
  severity: DatasetAuditIssue["severity"],
): DatasetAuditIssue {
  return { code, severity };
}

function pointerTokens(pointer: string): readonly string[] {
  if (pointer === "") return [];
  return pointer
    .slice(1)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function resolvePointer(value: unknown, pointer: string): PointerResult {
  let current = value;
  for (const token of pointerTokens(pointer)) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(token)) return { found: false, value: undefined };
      const index = Number(token);
      if (index >= current.length) return { found: false, value: undefined };
      current = current[index];
      continue;
    }
    if (current === null || typeof current !== "object") {
      return { found: false, value: undefined };
    }
    if (!Object.hasOwn(current, token)) return { found: false, value: undefined };
    current = (current as Record<string, unknown>)[token];
  }
  return { found: true, value: current };
}

function canonicalKey(value: unknown): string | null {
  try {
    return canonicalizeJson(value);
  } catch {
    return null;
  }
}

function safeArtifactReference(value: unknown, base?: string): string | null {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")) return null;
  const combined = base === undefined ? value : `${base}/${value}`;
  const segments = combined.split("/");
  return combined.startsWith("/") || segments.includes("..")
    ? null
    : segments.filter(Boolean).join("/");
}

function isNonEmpty(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && typeof value === "object" && Object.keys(value).length > 0;
}

function isNormalizedBoundingBox(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const x = candidate["x"];
  const y = candidate["y"];
  const width = candidate["width"];
  const height = candidate["height"];
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    typeof width === "number" &&
    typeof height === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1 &&
    y + height <= 1
  );
}

type CompletenessResult = "COMPLETE" | "MISSING" | "INVALID";

function missingValue(value: PointerResult): boolean {
  return !value.found || value.value === null || value.value === undefined;
}

function normalizedXyxy(
  value: PointerResult,
  pointers: NonNullable<DatasetProjectionConfig["completeness"][number]["coordinatePointers"]>,
): CompletenessResult {
  if (missingValue(value)) return "MISSING";
  const coordinates = [pointers.minX, pointers.minY, pointers.maxX, pointers.maxY].map((pointer) =>
    resolvePointer(value.value, pointer),
  );
  if (coordinates.some(missingValue)) return "MISSING";
  const [minX, minY, maxX, maxY] = coordinates.map(({ value: coordinate }) => coordinate);
  return typeof minX === "number" &&
    typeof minY === "number" &&
    typeof maxX === "number" &&
    typeof maxY === "number" &&
    Number.isFinite(minX) &&
    Number.isFinite(minY) &&
    Number.isFinite(maxX) &&
    Number.isFinite(maxY) &&
    minX >= 0 &&
    minY >= 0 &&
    maxX > minX &&
    maxY > minY &&
    maxX <= 1 &&
    maxY <= 1
    ? "COMPLETE"
    : "INVALID";
}

function completenessResult(
  value: PointerResult,
  predicate: DatasetProjectionConfig["completeness"][number]["predicate"],
  disallowedValues: readonly (string | number | boolean | null)[],
  artifactPaths: ReadonlySet<string>,
  coordinatePointers: DatasetProjectionConfig["completeness"][number]["coordinatePointers"],
  artifactReferenceBase: DatasetProjectionConfig["completeness"][number]["artifactReferenceBase"],
): CompletenessResult {
  switch (predicate) {
    case "PRESENT":
      return missingValue(value) ? "MISSING" : "COMPLETE";
    case "NON_EMPTY":
      return missingValue(value) ? "MISSING" : isNonEmpty(value.value) ? "COMPLETE" : "INVALID";
    case "NOT_IN_VALUES": {
      if (missingValue(value)) return "MISSING";
      const key = canonicalKey(value.value);
      return key !== null && !new Set(disallowedValues.map(canonicalizeJson)).has(key)
        ? "COMPLETE"
        : "INVALID";
    }
    case "NORMALIZED_BBOX":
      return missingValue(value)
        ? "MISSING"
        : isNormalizedBoundingBox(value.value)
          ? "COMPLETE"
          : "INVALID";
    case "NORMALIZED_XYXY":
      /* v8 ignore next -- the config schema requires pointers for this predicate */
      return coordinatePointers === undefined
        ? "INVALID"
        : normalizedXyxy(value, coordinatePointers);
    case "POSITIVE_INTEGER":
      return missingValue(value)
        ? "MISSING"
        : Number.isInteger(value.value) && (value.value as number) > 0
          ? "COMPLETE"
          : "INVALID";
    case "ARTIFACT_EXISTS": {
      if (missingValue(value)) return "MISSING";
      const reference = value.found
        ? safeArtifactReference(value.value, artifactReferenceBase)
        : null;
      return reference !== null && artifactPaths.has(reference) ? "COMPLETE" : "INVALID";
    }
  }
}

function sourceValue(
  source: DatasetProjectionConfig["sources"][number],
  artifactsByPath: ReadonlyMap<string, ProjectionArtifact>,
): PointerResult {
  const artifact = artifactsByPath.get(source.file);
  if (
    artifact === undefined ||
    artifact.parsedJson === undefined ||
    artifact.format !== source.format
  ) {
    return { found: false, value: undefined };
  }
  return { found: true, value: artifact.parsedJson };
}

function resolveCollectionItems(
  source: unknown,
  pointer: string,
  aggregateRows: boolean,
): { readonly valid: boolean; readonly items: readonly unknown[] } {
  if (!aggregateRows) {
    const resolved = resolvePointer(source, pointer);
    return resolved.found && Array.isArray(resolved.value)
      ? { valid: true, items: resolved.value }
      : { valid: false, items: [] };
  }
  if (!Array.isArray(source)) return { valid: false, items: [] };
  const items: unknown[] = [];
  for (const row of source) {
    const resolved = resolvePointer(row, pointer);
    if (!resolved.found || !Array.isArray(resolved.value)) return { valid: false, items: [] };
    for (const item of resolved.value as readonly unknown[]) items.push(item);
  }
  return { valid: true, items };
}

function resolveDeclaredCount(
  source: unknown,
  pointer: string,
  aggregateRows: boolean,
): number | null {
  const roots = aggregateRows && Array.isArray(source) ? source : [source];
  let total = 0;
  for (const root of roots) {
    const declared = resolvePointer(root, pointer);
    if (
      !declared.found ||
      !Number.isSafeInteger(declared.value) ||
      (declared.value as number) < 0
    ) {
      return null;
    }
    total += declared.value as number;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

export function projectDataset(
  configInput: DatasetProjectionConfig,
  artifacts: readonly ProjectionArtifact[],
): DatasetProjectionAudit {
  const config = DatasetProjectionConfigSchema.parse(configInput);
  const artifactsByPath = new Map(artifacts.map((artifact) => [artifact.relativePath, artifact]));
  const artifactPaths = new Set(artifacts.map(({ relativePath }) => relativePath));
  const sourceValues = new Map<string, unknown>();
  const issues: DatasetAuditIssue[] = [];

  for (const staleFile of config.staleFiles) {
    issues.push(issue("STALE_SOURCE_CANDIDATE", "WARNING"));
    if (!artifactsByPath.has(staleFile)) issues.push(issue("PROJECTION_SOURCE_INVALID", "WARNING"));
  }

  for (const source of config.sources) {
    if (source.selection === "STALE") {
      issues.push(issue("STALE_SOURCE_CANDIDATE", "WARNING"));
      continue;
    }
    const resolved = sourceValue(source, artifactsByPath);
    if (!resolved.found) issues.push(issue("PROJECTION_SOURCE_INVALID", "ERROR"));
    else sourceValues.set(source.id, resolved.value);
  }

  const resolvedCollections = new Map<string, ResolvedCollection>();
  const collectionReports: DatasetProjectionAudit["collections"][number][] = [];
  for (const collection of config.collections) {
    const sources = collection.sourceIds.map((sourceId) => sourceValues.get(sourceId));
    const resolutions = sources.map((source) =>
      source === undefined
        ? { valid: false, items: [] }
        : resolveCollectionItems(source, collection.pointer, collection.aggregateRows),
    );
    const items = resolutions.flatMap(({ items: resolvedItems }) => resolvedItems);
    if (resolutions.some(({ valid }) => !valid)) {
      issues.push(issue("COLLECTION_POINTER_INVALID", "ERROR"));
    }
    const itemIds = new Set<string>();
    let artifactReferenceMissing = false;
    for (const item of items) {
      const candidate =
        collection.itemIdPointer === undefined
          ? { found: true, value: item }
          : resolvePointer(item, collection.itemIdPointer);
      const key = candidate.found ? canonicalKey(candidate.value) : null;
      if (key === null || itemIds.has(key)) {
        issues.push(issue("DUPLICATE_COLLECTION_ID", "ERROR"));
      } else {
        itemIds.add(key);
      }

      if (collection.artifactReferencePointer !== undefined) {
        const reference = resolvePointer(item, collection.artifactReferencePointer);
        const normalized = reference.found
          ? safeArtifactReference(reference.value, collection.artifactReferenceBase)
          : null;
        const missing = normalized === null || !artifactPaths.has(normalized);
        if (missing && (collection.artifactReferenceRequired || normalized !== null)) {
          artifactReferenceMissing = true;
        }
      }
    }
    if (artifactReferenceMissing) {
      issues.push(issue("ARTIFACT_REFERENCE_MISSING", collection.artifactReferenceSeverity));
    }
    if (collection.expectedCount !== undefined && collection.expectedCount !== items.length) {
      issues.push(issue("COLLECTION_COUNT_MISMATCH", "ERROR"));
    }
    let declaredCount: number | null = null;
    if (collection.declaredCountPointer !== undefined) {
      const counts = sources.map((source) =>
        source === undefined
          ? null
          : resolveDeclaredCount(
              source,
              collection.declaredCountPointer ?? "",
              collection.aggregateRows,
            ),
      );
      if (counts.every((count): count is number => count !== null)) {
        declaredCount = counts.reduce((total, count) => total + count, 0);
      }
      if (declaredCount === null || declaredCount !== items.length) {
        issues.push(issue("DECLARED_COUNT_MISMATCH", "ERROR"));
      }
    }
    resolvedCollections.set(collection.id, { id: collection.id, items, itemIds });
    collectionReports.push({
      idHash: hashId(collection.id),
      count: items.length,
      expectedCount: collection.expectedCount ?? null,
      declaredCount,
      canonical: collection.canonical,
    });
  }

  const relationshipReports: DatasetProjectionAudit["relationships"][number][] = [];
  for (const relationship of config.relationships) {
    const from = resolvedCollections.get(relationship.fromCollectionId);
    const to = resolvedCollections.get(relationship.toCollectionId);
    let total = 0;
    let resolved = 0;
    let missingReference = false;
    if (from !== undefined && to !== undefined) {
      for (const item of from.items) {
        const reference = resolvePointer(item, relationship.referencePointer);
        const references = reference.found
          ? Array.isArray(reference.value)
            ? reference.value
            : [reference.value]
          : [undefined];
        for (const candidate of references) {
          total += 1;
          const key = canonicalKey(candidate);
          if (key !== null && to.itemIds.has(key)) resolved += 1;
          else missingReference = true;
        }
      }
    }
    if (missingReference) issues.push(issue("MANIFEST_REFERENCE_MISSING", "ERROR"));
    relationshipReports.push({
      idHash: hashId(relationship.id),
      total,
      resolved,
      missing: total - resolved,
    });
  }

  const completenessReports: DatasetProjectionAudit["completeness"][number][] = [];
  for (const check of config.completeness) {
    const collection = resolvedCollections.get(check.collectionId);
    const items = collection?.items ?? [];
    let complete = 0;
    let missing = 0;
    let invalid = 0;
    let hasIncomplete = false;
    for (const item of items) {
      const result = completenessResult(
        resolvePointer(item, check.pointer),
        check.predicate,
        check.disallowedValues,
        artifactPaths,
        check.coordinatePointers,
        check.artifactReferenceBase,
      );
      if (result === "COMPLETE") {
        complete += 1;
      } else {
        hasIncomplete = true;
        if (result === "MISSING") missing += 1;
        else invalid += 1;
      }
    }
    if (hasIncomplete) issues.push(issue("COMPLETENESS_CHECK_FAILED", "WARNING"));
    completenessReports.push({
      idHash: hashId(check.id),
      total: items.length,
      complete,
      incomplete: items.length - complete,
      missing,
      invalid,
    });
  }

  const diagnosticOutcomes = { PASS: 0, FAIL: 0, REVIEW: 0, NOT_APPLICABLE: 0 };
  if (config.outcome !== undefined) {
    const collection = resolvedCollections.get(config.outcome.collectionId);
    let unmapped = false;
    for (const item of collection?.items ?? []) {
      const raw = resolvePointer(item, config.outcome.pointer);
      const mapped =
        raw.found && typeof raw.value === "string" ? config.outcome.mapping[raw.value] : undefined;
      if (mapped === undefined) unmapped = true;
      diagnosticOutcomes[mapped ?? config.outcome.fallback] += 1;
    }
    if (unmapped) issues.push(issue("OUTCOME_UNMAPPED", "WARNING"));
  }

  return {
    selectedSources: config.sources.filter(({ selection }) => selection === "SELECTED").length,
    staleSources:
      config.sources.filter(({ selection }) => selection === "STALE").length +
      config.staleFiles.length,
    collections: collectionReports,
    relationships: relationshipReports,
    completeness: completenessReports,
    diagnosticOutcomes,
    issues,
  };
}
