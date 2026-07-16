import { describe, expect, it } from "vitest";

import { projectDataset } from "../../src/projection.js";
import {
  DatasetProjectionCompletenessSchema,
  DatasetProjectionConfigSchema,
} from "../../src/schema.js";

describe("private dataset projection", () => {
  it("aggregates structural failures without copying source values", () => {
    const config = DatasetProjectionConfigSchema.parse({
      sources: [
        { id: "source", file: "source.json", format: "JSON" },
        { id: "missing", file: "missing.json", format: "JSON" },
      ],
      staleFiles: ["absent-stale.xlsx"],
      collections: [
        {
          id: "items",
          sourceIds: ["source"],
          pointer: "/items",
          expectedCount: 4,
          declaredCountPointer: "/declared",
          itemIdPointer: "/id",
          artifactReferencePointer: "/file",
          artifactReferenceRequired: true,
        },
        {
          id: "missing-items",
          sourceIds: ["missing"],
          pointer: "/items",
        },
      ],
      relationships: [
        {
          id: "self-reference",
          fromCollectionId: "items",
          referencePointer: "/references",
          toCollectionId: "items",
        },
      ],
      completeness: [
        {
          id: "present",
          collectionId: "items",
          pointer: "/present",
          predicate: "PRESENT",
          disallowedValues: [],
        },
        {
          id: "bbox",
          collectionId: "items",
          pointer: "/bbox",
          predicate: "NORMALIZED_BBOX",
          disallowedValues: [],
        },
        {
          id: "state",
          collectionId: "items",
          pointer: "/state",
          predicate: "NOT_IN_VALUES",
          disallowedValues: ["pending-private-value"],
        },
      ],
      outcome: {
        collectionId: "items",
        pointer: "/outcome",
        mapping: { ok: "PASS" },
      },
    });
    const result = projectDataset(config, [
      {
        relativePath: "source.json",
        format: "JSON",
        parsedJson: {
          declared: 99,
          items: [
            {
              id: "duplicate",
              file: "../escape.png",
              references: ["duplicate", "missing"],
              present: true,
              bbox: { x: 0, y: 0, width: 1, height: 1 },
              state: "ready",
              outcome: "ok",
            },
            {
              id: "duplicate",
              file: "missing.png",
              references: "duplicate",
              present: null,
              bbox: { x: 2, y: 0, width: 1, height: 1 },
              state: "pending-private-value",
              outcome: 42,
            },
            {
              references: [],
            },
          ],
        },
      },
    ]);

    expect(result.collections.map(({ count }) => count)).toEqual([3, 0]);
    expect(result.relationships[0]).toMatchObject({ total: 3, resolved: 2, missing: 1 });
    expect(result.completeness[0]).toMatchObject({ complete: 1, missing: 2, invalid: 0 });
    expect(result.completeness[1]).toMatchObject({ complete: 1, missing: 1, invalid: 1 });
    expect(result.completeness[2]).toMatchObject({ complete: 1, missing: 1, invalid: 1 });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        { code: "PROJECTION_SOURCE_INVALID", severity: "WARNING" },
        { code: "PROJECTION_SOURCE_INVALID", severity: "ERROR" },
        { code: "COLLECTION_POINTER_INVALID", severity: "ERROR" },
        { code: "DUPLICATE_COLLECTION_ID", severity: "ERROR" },
        { code: "ARTIFACT_REFERENCE_MISSING", severity: "ERROR" },
        { code: "COLLECTION_COUNT_MISMATCH", severity: "ERROR" },
        { code: "DECLARED_COUNT_MISMATCH", severity: "ERROR" },
        { code: "MANIFEST_REFERENCE_MISSING", severity: "ERROR" },
        { code: "OUTCOME_UNMAPPED", severity: "WARNING" },
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("pending-private-value");
  });

  it("rejects ambiguous completeness options and cross-reference configuration", () => {
    for (const value of [
      {
        id: "bad-values",
        collectionId: "items",
        pointer: "",
        predicate: "PRESENT",
        disallowedValues: ["not-allowed-here"],
      },
      {
        id: "bad-coordinates",
        collectionId: "items",
        pointer: "",
        predicate: "NORMALIZED_XYXY",
        disallowedValues: [],
      },
      {
        id: "bad-base",
        collectionId: "items",
        pointer: "",
        predicate: "PRESENT",
        disallowedValues: [],
        artifactReferenceBase: "country",
      },
    ]) {
      expect(DatasetProjectionCompletenessSchema.safeParse(value).success).toBe(false);
    }

    const invalid = DatasetProjectionConfigSchema.safeParse({
      sources: [
        { id: "source", file: "a.json", format: "JSON", selection: "SELECTED" },
        { id: "source", file: "b.json", format: "JSON", selection: "SELECTED" },
        {
          id: "stale-a",
          file: "stale-a.json",
          format: "JSON",
          candidateGroup: "candidates",
          selection: "STALE",
        },
        {
          id: "stale-b",
          file: "stale-b.json",
          format: "JSON",
          candidateGroup: "candidates",
          selection: "STALE",
        },
      ],
      staleFiles: ["old.xlsx", "old.xlsx"],
      collections: [
        { id: "items", sourceIds: ["source", "source"], pointer: "" },
        { id: "items", sourceIds: ["stale-a"], pointer: "" },
      ],
      relationships: [
        {
          id: "unknown",
          fromCollectionId: "items",
          referencePointer: "",
          toCollectionId: "absent",
        },
      ],
      completeness: [
        {
          id: "unknown",
          collectionId: "absent",
          pointer: "",
          predicate: "PRESENT",
          disallowedValues: [],
        },
      ],
      outcome: { collectionId: "absent", pointer: "", mapping: {} },
    });

    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues.length).toBeGreaterThanOrEqual(8);
    }
  });
});
