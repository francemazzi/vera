import { chmod, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DatasetAuditFatalError,
  DatasetAuditReportSchema,
  DatasetProjectionConfigSchema,
  auditDataset,
  datasetAuditExitCode,
  verifyDatasetAuditReport,
  writePrivateDatasetReport,
} from "../../src/index.js";
import { assertIgnoredPaths } from "../../src/security.js";
import {
  makeTestRepository,
  minimalPng,
  minimalXlsx,
  type TestRepository,
} from "../helpers/fixtures.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })),
  );
});

async function repository(): Promise<TestRepository> {
  const value = await makeTestRepository();
  roots.push(value.root);
  return value;
}

describe("dataset audit integration", () => {
  it("audits a mixed corpus deterministically and keeps every artifact REVIEW-only", async () => {
    const fixture = await repository();
    await Promise.all([
      writeFile(join(fixture.dataset, "data.json"), '{"private":"NEVER_PRINT_THIS_VALUE"}'),
      writeFile(join(fixture.dataset, "rows.jsonl"), 'null\n{"ok":true}\n'),
      writeFile(join(fixture.dataset, "image.png"), minimalPng()),
      writeFile(join(fixture.dataset, "book.xlsx"), minimalXlsx()),
      writeFile(join(fixture.dataset, "notes.secret-extension"), "PRIVATE_AUXILIARY_VALUE"),
    ]);

    const first = await auditDataset({
      root: fixture.dataset,
      gitRoot: fixture.root,
      now: () => "2026-07-16T10:00:00.000Z",
    });
    const second = await auditDataset({
      root: fixture.dataset,
      gitRoot: fixture.root,
      now: () => "2026-07-16T11:00:00.000Z",
    });

    expect(first.summary).toMatchObject({
      files: 5,
      valid: 4,
      warnings: 1,
      errors: 0,
      review: 5,
    });
    expect(first.summary.bytes).toBeGreaterThan(0);
    expect(first.artifacts.map(({ evaluationOutcome }) => evaluationOutcome)).toEqual(
      Array.from({ length: 5 }, () => "REVIEW"),
    );
    expect(first.artifacts.map(({ extension }) => extension)).toContain("other");
    expect(first.corpusHash).toBe(second.corpusHash);
    expect(first.reportHash).not.toBe(second.reportHash);
    expect(verifyDatasetAuditReport(first)).toBe(true);
    expect(DatasetAuditReportSchema.parse(first)).toEqual(first);
    expect(datasetAuditExitCode(first)).toBe(0);
    expect(JSON.stringify(first)).not.toContain("NEVER_PRINT_THIS_VALUE");
    expect(JSON.stringify(first)).not.toContain("PRIVATE_AUXILIARY_VALUE");
    expect(JSON.stringify(first)).not.toContain("notes.secret-extension");
  });

  it("aggregates selected JSONL sources, generic diagnostics, stale candidates, and references", async () => {
    const fixture = await repository();
    await Promise.all([
      writeFile(
        join(fixture.dataset, "selected-a.jsonl"),
        `${JSON.stringify({
          cases: [{ id: "case-a" }],
          validations: [
            {
              id: "v1",
              case: "case-a",
              gold: "confirmed",
              state: "ready",
              minX: 0.1,
              minY: 0.2,
              maxX: 0.5,
              maxY: 0.6,
              page: 1,
              ocr: "available",
              document: "full/document.png",
              result: "local-pass",
            },
            {
              id: "v2",
              case: "case-a",
              gold: "",
              state: "local-pending",
              minX: 10,
              minY: 20,
              maxX: 50,
              maxY: 60,
              page: 0,
              ocr: "",
              document: "missing.png",
              result: "local-fail",
            },
          ],
        })}\n`,
      ),
      writeFile(
        join(fixture.dataset, "selected-b.jsonl"),
        `${JSON.stringify({
          cases: [{ id: "case-b" }],
          validations: [
            {
              id: "v3",
              case: "case-b",
              gold: "confirmed",
              state: "ready",
              page: 2,
              ocr: "available",
              document: "full/document.png",
              result: "local-na",
            },
            {
              id: "v4",
              case: "case-b",
              gold: "confirmed",
              state: "ready",
              minX: 0,
              minY: 0,
              maxX: 1,
              maxY: 1,
              page: 3,
              ocr: "available",
              document: "full/document.png",
              result: "unmapped-local-value",
            },
          ],
        })}\n`,
      ),
      writeFile(
        join(fixture.dataset, "manifest.json"),
        JSON.stringify({
          count: 2,
          assets: [
            { id: "asset-1", path: "full/document.png" },
            { id: "asset-2", path: "thumbnail/missing.png" },
          ],
        }),
      ),
      writeFile(join(fixture.dataset, "stale.json"), "{}"),
      writeFile(join(fixture.dataset, "stale.xlsx"), minimalXlsx()),
      writeFile(join(fixture.dataset, "AA-full-document.tmp"), "auxiliary"),
    ]);
    await mkdir(join(fixture.dataset, "AA/full"), { recursive: true });
    await writeFile(join(fixture.dataset, "AA/full/document.png"), minimalPng());

    const projection = DatasetProjectionConfigSchema.parse({
      sources: [
        { id: "selected-a", file: "selected-a.jsonl", format: "JSONL", selection: "SELECTED" },
        { id: "selected-b", file: "selected-b.jsonl", format: "JSONL", selection: "SELECTED" },
        { id: "manifest", file: "manifest.json", format: "JSON", selection: "SELECTED" },
        { id: "stale-json", file: "stale.json", format: "JSON", selection: "STALE" },
      ],
      staleFiles: ["stale.xlsx"],
      collections: [
        {
          id: "cases",
          sourceIds: ["selected-a", "selected-b"],
          pointer: "/cases",
          aggregateRows: true,
          itemIdPointer: "/id",
          expectedCount: 2,
          canonical: true,
        },
        {
          id: "validations",
          sourceIds: ["selected-a", "selected-b"],
          pointer: "/validations",
          aggregateRows: true,
          itemIdPointer: "/id",
          expectedCount: 4,
          canonical: true,
        },
        {
          id: "assets",
          sourceIds: ["manifest"],
          pointer: "/assets",
          declaredCountPointer: "/count",
          itemIdPointer: "/id",
          artifactReferencePointer: "/path",
          artifactReferenceBase: "AA",
          artifactReferenceRequired: false,
          artifactReferenceSeverity: "WARNING",
          expectedCount: 2,
          canonical: true,
        },
      ],
      relationships: [
        {
          id: "validation-case",
          fromCollectionId: "validations",
          referencePointer: "/case",
          toCollectionId: "cases",
        },
      ],
      completeness: [
        {
          id: "gold",
          collectionId: "validations",
          pointer: "/gold",
          predicate: "NON_EMPTY",
          disallowedValues: [],
        },
        {
          id: "pending",
          collectionId: "validations",
          pointer: "/state",
          predicate: "NOT_IN_VALUES",
          disallowedValues: ["local-pending"],
        },
        {
          id: "bbox",
          collectionId: "validations",
          pointer: "",
          predicate: "NORMALIZED_XYXY",
          disallowedValues: [],
          coordinatePointers: { minX: "/minX", minY: "/minY", maxX: "/maxX", maxY: "/maxY" },
        },
        {
          id: "page",
          collectionId: "validations",
          pointer: "/page",
          predicate: "POSITIVE_INTEGER",
          disallowedValues: [],
        },
        {
          id: "ocr",
          collectionId: "validations",
          pointer: "/ocr",
          predicate: "NON_EMPTY",
          disallowedValues: [],
        },
        {
          id: "full-document",
          collectionId: "validations",
          pointer: "/document",
          predicate: "ARTIFACT_EXISTS",
          disallowedValues: [],
          artifactReferenceBase: "AA",
        },
      ],
      outcome: {
        collectionId: "validations",
        pointer: "/result",
        mapping: {
          "local-pass": "PASS",
          "local-fail": "FAIL",
          "local-na": "NOT_APPLICABLE",
        },
        fallback: "REVIEW",
      },
    });

    const report = await auditDataset({
      root: fixture.dataset,
      gitRoot: fixture.root,
      projection,
      now: () => "2026-07-16T10:00:00.000Z",
    });

    expect(report.projection).not.toBeNull();
    expect(report.projection?.selectedSources).toBe(3);
    expect(report.projection?.staleSources).toBe(2);
    expect(report.projection?.collections.map(({ count }) => count)).toEqual([2, 4, 2]);
    expect(report.projection?.relationships[0]).toMatchObject({
      total: 4,
      resolved: 4,
      missing: 0,
    });
    expect(report.projection?.completeness[2]).toMatchObject({
      total: 4,
      complete: 2,
      missing: 1,
      invalid: 1,
    });
    expect(report.projection?.diagnosticOutcomes).toEqual({
      PASS: 1,
      FAIL: 1,
      REVIEW: 1,
      NOT_APPLICABLE: 1,
    });
    expect(
      report.projection?.issues.filter(({ code }) => code === "STALE_SOURCE_CANDIDATE"),
    ).toHaveLength(2);
    expect(
      report.projection?.issues.filter(({ code }) => code === "COMPLETENESS_CHECK_FAILED"),
    ).toHaveLength(6);
    expect(report.projection?.issues).toContainEqual({
      code: "ARTIFACT_REFERENCE_MISSING",
      severity: "WARNING",
    });
    expect(report.projection?.issues).toContainEqual({
      code: "OUTCOME_UNMAPPED",
      severity: "WARNING",
    });
    expect(report.projection?.issues.every(({ severity }) => severity === "WARNING")).toBe(true);
    expect(datasetAuditExitCode(report)).toBe(0);
    expect(JSON.stringify(report)).not.toContain("local-pending");
    expect(JSON.stringify(report)).not.toContain("unmapped-local-value");
  });

  it("writes atomically into a previously absent private directory with 0700/0600 modes", async () => {
    const fixture = await repository();
    await writeFile(join(fixture.dataset, "data.json"), "null");
    const report = await auditDataset({ root: fixture.dataset, gitRoot: fixture.root });

    await writePrivateDatasetReport(report, fixture.report, { gitRoot: fixture.root });
    await writePrivateDatasetReport(report, fixture.report, { gitRoot: fixture.root });

    expect(JSON.parse(await readFile(fixture.report, "utf8"))).toEqual(report);
    expect((await lstat(join(fixture.root, "reports/private/dataset-audit"))).mode & 0o777).toBe(
      0o700,
    );
    expect((await lstat(fixture.report)).mode & 0o777).toBe(0o600);
  });

  it("classifies per-file errors as exit 1 and global limits as fatal exit 2 inputs", async () => {
    const fixture = await repository();
    await Promise.all([
      writeFile(join(fixture.dataset, "large.json"), '{"value":"long"}'),
      writeFile(join(fixture.dataset, "second.json"), "null"),
    ]);

    const report = await auditDataset({
      root: fixture.dataset,
      gitRoot: fixture.root,
      limits: { maxFileBytes: 4 },
    });
    expect(report.summary.errors).toBe(1);
    expect(report.artifacts).toContainEqual(
      expect.objectContaining({
        contentHash: null,
        issues: [{ code: "FILE_TOO_LARGE", severity: "ERROR" }],
        evaluationOutcome: "REVIEW",
      }),
    );
    expect(datasetAuditExitCode(report)).toBe(1);
    await expect(
      auditDataset({ root: fixture.dataset, gitRoot: fixture.root, limits: { maxFiles: 1 } }),
    ).rejects.toMatchObject({ code: "RESOURCE_LIMIT" });
    await expect(
      auditDataset({ root: fixture.dataset, gitRoot: fixture.root, limits: { maxTotalBytes: 7 } }),
    ).rejects.toMatchObject({ code: "RESOURCE_LIMIT" });
    await expect(
      auditDataset({ root: fixture.dataset, gitRoot: fixture.root, limits: { maxFiles: 0 } }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    await expect(
      auditDataset({
        root: fixture.dataset,
        gitRoot: fixture.root,
        limits: { maxFileBytes: 25 * 1024 * 1024 + 1 },
      }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  it("supports an empty corpus and keeps unreadable artifacts controlled", async () => {
    const fixture = await repository();
    const empty = await auditDataset({ root: fixture.dataset, gitRoot: fixture.root });
    expect(empty.summary).toEqual({
      files: 0,
      bytes: 0,
      valid: 0,
      warnings: 0,
      errors: 0,
      review: 0,
    });

    const unreadable = join(fixture.dataset, "unreadable.json");
    await writeFile(unreadable, "null");
    await chmod(unreadable, 0o000);
    const report = await auditDataset({ root: fixture.dataset, gitRoot: fixture.root });
    await chmod(unreadable, 0o600);
    expect(report.artifacts[0]).toMatchObject({ evaluationOutcome: "REVIEW" });
    if (report.artifacts[0]?.structuralStatus === "ERROR") {
      expect(report.artifacts[0].issues).toContainEqual({
        code: "FILE_READ_FAILED",
        severity: "ERROR",
      });
    }
  });

  it("rejects symlinks and non-ignored paths before retaining content", async () => {
    const fixture = await repository();
    await writeFile(join(fixture.dataset, "target.json"), "null");
    await symlink("target.json", join(fixture.dataset, "link.json"));

    await expect(
      auditDataset({ root: fixture.dataset, gitRoot: fixture.root }),
    ).rejects.toMatchObject({
      code: "SYMLINK_REJECTED",
    });
    await rm(join(fixture.dataset, "link.json"));
    await writeFile(join(fixture.root, ".gitignore"), "datasets/*\n!datasets/target.json\n");
    await expect(
      assertIgnoredPaths(fixture.root, [join(fixture.dataset, "target.json")]),
    ).rejects.toMatchObject({ code: "INPUT_NOT_IGNORED" });
  });

  it("refuses report outputs that are not ignored or are symlinks", async () => {
    const fixture = await repository();
    await writeFile(join(fixture.dataset, "data.json"), "null");
    const report = await auditDataset({ root: fixture.dataset, gitRoot: fixture.root });

    await expect(
      writePrivateDatasetReport(report, join(fixture.root, "public-report.json"), {
        gitRoot: fixture.root,
      }),
    ).rejects.toMatchObject({ code: "OUTPUT_NOT_IGNORED" });
    await mkdir(join(fixture.root, "reports/private/dataset-audit"), { recursive: true });
    await symlink(join(fixture.dataset, "data.json"), fixture.report);
    await expect(
      writePrivateDatasetReport(report, fixture.report, { gitRoot: fixture.root }),
    ).rejects.toMatchObject({ code: "SYMLINK_REJECTED" });
  });

  it("rejects a tampered report hash", async () => {
    const fixture = await repository();
    await writeFile(join(fixture.dataset, "data.json"), "null");
    const report = await auditDataset({ root: fixture.dataset, gitRoot: fixture.root });
    const tampered = { ...report, corpusHash: "f".repeat(64) };

    expect(verifyDatasetAuditReport(tampered)).toBe(false);
    expect(() => DatasetAuditReportSchema.parse(tampered)).toThrow();
    expect(new DatasetAuditFatalError("PRIVACY_GUARD_FAILED").message).not.toContain(fixture.root);
    await expect(
      writePrivateDatasetReport(tampered, fixture.report, {
        gitRoot: fixture.root,
      }),
    ).rejects.toBeDefined();
  });
});
