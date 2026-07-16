import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

import {
  DSL_VERSION,
  RuleDefinitionSchema,
  computeRuleDefinitionHash,
  sha256Bytes,
  sha256CanonicalJson,
} from "@vera/contracts";
import type {
  ExtractionRequest,
  FactObservation,
  RuleDefinition,
  RuleDefinitionHashInput,
} from "@vera/contracts";
import { ManualExtractorAdapter } from "@vera/extractors";
import type { ExtractorRuntime } from "@vera/extractors";
import { evaluateRule } from "@vera/rules-core";

import { validateArtifactContent } from "./formats.js";
import { projectDataset, type ProjectionArtifact } from "./projection.js";
import {
  createDatasetAuditReport,
  DatasetProjectionConfigSchema,
  type DatasetArtifactAudit,
  type DatasetAuditIssue,
  type DatasetAuditLimits,
  type DatasetAuditReport,
  type DatasetProjectionConfig,
} from "./schema.js";
import { assertIgnoredInput, assertIgnoredPaths, DatasetAuditFatalError } from "./security.js";

export const DEFAULT_DATASET_AUDIT_LIMITS: DatasetAuditLimits = Object.freeze({
  maxFiles: 10_000,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  concurrency: 4,
});

const EVALUATION_TIME = "2026-07-16T00:00:00.000Z";
const REVIEW_FACT_KEY = "dataset.manual_review_gate";

export interface AuditDatasetOptions {
  readonly root: string;
  readonly gitRoot?: string;
  readonly projection?: DatasetProjectionConfig;
  readonly limits?: Partial<Omit<DatasetAuditLimits, "concurrency">>;
  readonly now?: () => string;
}

interface InventoryEntry {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly size: number;
  readonly device: number;
  readonly inode: number;
}

interface AuditedEntry {
  readonly artifact: DatasetArtifactAudit;
  readonly projectionArtifact: ProjectionArtifact;
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith("/"));
}

function pathHash(relativePath: string): string {
  return sha256Bytes(new TextEncoder().encode(relativePath.normalize("NFC")));
}

function deterministicUuid(seed: string): string {
  const digest = sha256Bytes(new TextEncoder().encode(seed));
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function deterministicRuntime(seed: string): ExtractorRuntime {
  let sequence = 0;
  return {
    createId: () => deterministicUuid(`${seed}:entity:${String(sequence++)}`),
    now: () => EVALUATION_TIME,
    runtimeVersion: "vera-dataset-harness-v1",
  };
}

function reviewOnlyRule(): RuleDefinition {
  const input: RuleDefinitionHashInput = {
    dslVersion: DSL_VERSION,
    state: "DRAFT",
    id: "00000000-0000-4000-8000-000000009001",
    sourceId: "00000000-0000-4000-8000-000000009002",
    sourceVersionId: "00000000-0000-4000-8000-000000009003",
    sourceContentHash: "a".repeat(64),
    ruleCardId: "00000000-0000-4000-8000-000000009004",
    ruleCardRevisionId: "00000000-0000-4000-8000-000000009005",
    ruleCardRevisionContentHash: "b".repeat(64),
    normativeKey: "dataset.diagnostic.review_only",
    deonticCategory: "OBLIGATION",
    riskLevel: "LOW",
    validity: {
      validFrom: "2020-01-01T00:00:00.000Z",
      validTo: "2100-01-01T00:00:00.000Z",
    },
    appliesWhen: { op: "truth", value: "TRUE" },
    satisfiedWhen: { op: "present", factKey: REVIEW_FACT_KEY },
    exceptions: [],
    overrides: [],
    conflictsWith: [],
    evidenceBindings: [
      { factKey: REVIEW_FACT_KEY, evidenceRequirementKeys: ["diagnostic.manual_review"] },
    ],
    unknownPolicy: "REVIEW",
    validationScope: "TECHNICAL_DEMO",
  };
  return RuleDefinitionSchema.parse({ ...input, contentHash: computeRuleDefinitionHash(input) });
}

const REVIEW_ONLY_RULE = reviewOnlyRule();

function technicalObservations(metadata: {
  readonly bytes: number;
  readonly contentHash: string | null;
  readonly detectedFormat: DatasetArtifactAudit["detectedFormat"];
  readonly issueCount: number;
  readonly pathHash: string;
}): FactObservation[] {
  return [
    {
      key: "dataset.artifact.technical_metadata",
      valueType: "JSON",
      status: "RESOLVED",
      originalValue: metadata,
      normalizedValue: metadata,
      rawConfidence: null,
      evidence: [
        {
          text: "Technical metadata only; source content is not retained.",
          boundingBox: { x: 0, y: 0, width: 1, height: 1 },
        },
      ],
      candidates: [],
    },
    {
      key: REVIEW_FACT_KEY,
      valueType: "BOOLEAN",
      status: "NOT_FOUND",
      originalValue: null,
      normalizedValue: null,
      rawConfidence: null,
      evidence: [],
      candidates: [],
    },
  ];
}

async function assertReviewOnly(artifact: DatasetArtifactAudit): Promise<void> {
  const documentHash =
    artifact.contentHash ??
    sha256CanonicalJson({
      bytes: artifact.bytes,
      pathHash: artifact.pathHash,
      issues: artifact.issues,
    });
  const input = {
    kind: "MANUAL" as const,
    documentId: deterministicUuid(`${artifact.pathHash}:document`),
    documentHash,
    page: 1,
    language: "en",
    observations: technicalObservations({
      bytes: artifact.bytes,
      contentHash: artifact.contentHash,
      detectedFormat: artifact.detectedFormat,
      issueCount: artifact.issues.length,
      pathHash: artifact.pathHash,
    }),
  };
  const request: ExtractionRequest = {
    id: deterministicUuid(`${artifact.pathHash}:request`),
    adapterId: "dataset-harness.manual",
    kind: "MANUAL",
    inputHash: documentHash,
    requestedAt: EVALUATION_TIME,
    input,
    validationScope: "TECHNICAL_DEMO",
  };
  try {
    const adapter = new ManualExtractorAdapter({
      id: request.adapterId,
      runtime: deterministicRuntime(artifact.pathHash),
    });
    const extraction = await adapter.extract(request);
    const finding = evaluateRule(
      REVIEW_ONLY_RULE,
      extraction.facts,
      extraction.evidence,
      EVALUATION_TIME,
    );
    if (finding.outcome !== "REVIEW") throw new DatasetAuditFatalError("INVARIANT_VIOLATION");
  } catch (error) {
    if (error instanceof DatasetAuditFatalError) throw error;
    throw new DatasetAuditFatalError("INVARIANT_VIOLATION", { cause: error });
  }
}

function resolveLimits(input: AuditDatasetOptions["limits"]): DatasetAuditLimits {
  const limits = { ...DEFAULT_DATASET_AUDIT_LIMITS, ...input, concurrency: 4 as const };
  if (
    !Number.isSafeInteger(limits.maxFiles) ||
    !Number.isSafeInteger(limits.maxFileBytes) ||
    !Number.isSafeInteger(limits.maxTotalBytes) ||
    limits.maxFiles <= 0 ||
    limits.maxFileBytes <= 0 ||
    limits.maxTotalBytes <= 0 ||
    limits.maxFiles > DEFAULT_DATASET_AUDIT_LIMITS.maxFiles ||
    limits.maxFileBytes > DEFAULT_DATASET_AUDIT_LIMITS.maxFileBytes ||
    limits.maxTotalBytes > DEFAULT_DATASET_AUDIT_LIMITS.maxTotalBytes
  ) {
    throw new DatasetAuditFatalError("CONFIG_INVALID");
  }
  return limits;
}

async function inventoryDataset(
  root: string,
  limits: DatasetAuditLimits,
): Promise<readonly InventoryEntry[]> {
  const entries: InventoryEntry[] = [];
  const directories: Array<{ readonly absolute: string; readonly relative: string }> = [
    { absolute: root, relative: "" },
  ];
  let totalBytes = 0;
  while (directories.length > 0) {
    const directory = directories.pop();
    /* v8 ignore next -- the loop guard guarantees a populated stack */
    if (directory === undefined) break;
    let children;
    try {
      children = (await readdir(directory.absolute, { withFileTypes: true })).toSorted(
        (left, right) => left.name.localeCompare(right.name),
      );
    } catch (error) {
      throw new DatasetAuditFatalError("CONFIG_INVALID", { cause: error });
    }
    for (const child of children) {
      const absolutePath = resolve(directory.absolute, child.name);
      const relativePath =
        directory.relative === "" ? child.name : `${directory.relative}/${child.name}`;
      if (!isWithin(root, absolutePath)) throw new DatasetAuditFatalError("PATH_ESCAPE");
      let stat;
      try {
        stat = await lstat(absolutePath);
      } catch (error) {
        throw new DatasetAuditFatalError("INVARIANT_VIOLATION", { cause: error });
      }
      if (stat.isSymbolicLink()) throw new DatasetAuditFatalError("SYMLINK_REJECTED");
      if (stat.isDirectory()) {
        directories.push({ absolute: absolutePath, relative: relativePath });
        continue;
      }
      if (!stat.isFile()) throw new DatasetAuditFatalError("INVARIANT_VIOLATION");
      entries.push({
        absolutePath,
        relativePath,
        size: stat.size,
        device: stat.dev,
        inode: stat.ino,
      });
      if (entries.length > limits.maxFiles) throw new DatasetAuditFatalError("RESOURCE_LIMIT");
      totalBytes += stat.size;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
        throw new DatasetAuditFatalError("RESOURCE_LIMIT");
      }
    }
  }
  return entries.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function secureRead(root: string, entry: InventoryEntry): Promise<Uint8Array> {
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(entry.absolutePath);
  } catch (error) {
    throw new DatasetAuditFatalError("INVARIANT_VIOLATION", { cause: error });
  }
  if (!isWithin(root, resolvedPath)) throw new DatasetAuditFatalError("PATH_ESCAPE");
  let handle;
  try {
    handle = await open(entry.absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const current = await handle.stat();
    if (
      !current.isFile() ||
      current.dev !== entry.device ||
      current.ino !== entry.inode ||
      current.size !== entry.size
    ) {
      throw new DatasetAuditFatalError("INVARIANT_VIOLATION");
    }
    return await handle.readFile();
  } catch (error) {
    if (error instanceof DatasetAuditFatalError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new DatasetAuditFatalError("SYMLINK_REJECTED", { cause: error });
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function sanitizedExtension(path: string): string {
  const extension = extname(path).toLocaleLowerCase("en-US");
  return [".png", ".json", ".jsonl", ".ndjson", ".xlsx"].includes(extension)
    ? extension
    : extension === ""
      ? ""
      : "other";
}

function structuralStatus(
  issues: readonly DatasetAuditIssue[],
): DatasetArtifactAudit["structuralStatus"] {
  if (issues.some(({ severity }) => severity === "ERROR")) return "ERROR";
  return issues.length > 0 ? "WARNING" : "VALID";
}

async function auditEntry(
  root: string,
  entry: InventoryEntry,
  limits: DatasetAuditLimits,
  retainParsedJson: boolean,
): Promise<AuditedEntry> {
  const hashedPath = pathHash(entry.relativePath);
  const rawExtension = extname(entry.relativePath).toLocaleLowerCase("en-US");
  let contentHash: string | null = null;
  let detectedFormat: DatasetArtifactAudit["detectedFormat"] = "UNKNOWN";
  let issues: DatasetAuditIssue[];
  let parsedJson: unknown;
  if (entry.size > limits.maxFileBytes) {
    issues = [{ code: "FILE_TOO_LARGE", severity: "ERROR" }];
  } else {
    try {
      const bytes = await secureRead(root, entry);
      const validated = validateArtifactContent(bytes, rawExtension);
      contentHash = validated.contentHash;
      detectedFormat = validated.detectedFormat;
      issues = [...validated.issues];
      parsedJson = validated.parsedJson;
    } catch (error) {
      if (error instanceof DatasetAuditFatalError) throw error;
      issues = [{ code: "FILE_READ_FAILED", severity: "ERROR" }];
    }
  }
  const artifact: DatasetArtifactAudit = {
    pathHash: hashedPath,
    contentHash,
    bytes: entry.size,
    extension: sanitizedExtension(entry.relativePath),
    detectedFormat,
    structuralStatus: structuralStatus(issues),
    issues,
    evaluationOutcome: "REVIEW",
  };
  await assertReviewOnly(artifact);
  return {
    artifact,
    projectionArtifact: {
      relativePath: entry.relativePath,
      format: detectedFormat,
      ...(!retainParsedJson || parsedJson === undefined ? {} : { parsedJson }),
    },
  };
}

async function mapFour<T, U>(
  values: readonly T[],
  operation: (value: T) => Promise<U>,
): Promise<readonly U[]> {
  const results: U[] = new Array<U>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      const value = values[index];
      /* v8 ignore next -- index is allocated only while it remains in range */
      if (value === undefined) break;
      results[index] = await operation(value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, values.length) }, worker));
  return results;
}

/** Audits an ignored local corpus without retaining source content or producing compliance verdicts. */
export async function auditDataset(options: AuditDatasetOptions): Promise<DatasetAuditReport> {
  const limits = resolveLimits(options.limits);
  const { root, gitRoot } = await assertIgnoredInput(options.root, options.gitRoot);
  const projection =
    options.projection === undefined
      ? undefined
      : DatasetProjectionConfigSchema.parse(options.projection);
  const entries = await inventoryDataset(root, limits);
  await assertIgnoredPaths(
    gitRoot,
    entries.map(({ absolutePath }) => absolutePath),
  );
  const projectedSourcePaths = new Set(
    projection?.sources
      .filter(({ selection }) => selection === "SELECTED")
      .map(({ file }) => file) ?? [],
  );
  const audited = await mapFour(entries, async (entry) =>
    auditEntry(root, entry, limits, projectedSourcePaths.has(entry.relativePath)),
  );
  const artifacts = audited.map(({ artifact }) => artifact);
  const projectionReport =
    projection === undefined
      ? null
      : projectDataset(
          projection,
          audited.map(({ projectionArtifact }) => projectionArtifact),
        );
  const generatedAt = options.now?.() ?? new Date().toISOString();
  const summary = {
    files: artifacts.length,
    bytes: entries.reduce((total, { size }) => total + size, 0),
    valid: artifacts.filter(({ structuralStatus: status }) => status === "VALID").length,
    warnings: artifacts.filter(({ structuralStatus: status }) => status === "WARNING").length,
    errors: artifacts.filter(({ structuralStatus: status }) => status === "ERROR").length,
    review: artifacts.length,
  };
  const corpusHash = sha256CanonicalJson(
    artifacts.map(({ pathHash: path, contentHash: content, bytes, detectedFormat, issues }) => ({
      path,
      content,
      bytes,
      detectedFormat,
      issues,
    })),
  );
  const report = createDatasetAuditReport({
    schemaVersion: "vera.dataset-audit/v1",
    generatedAt,
    corpusHash,
    limits,
    summary,
    artifacts,
    projection: projectionReport,
  });
  return report;
}

export function datasetAuditExitCode(report: DatasetAuditReport): 0 | 1 {
  return report.summary.errors > 0 ||
    report.projection?.issues.some(({ severity }) => severity === "ERROR") === true
    ? 1
    : 0;
}
