import { sha256CanonicalJson } from "@vera/contracts";
import { z } from "zod";

export const DATASET_AUDIT_SCHEMA_VERSION = "vera.dataset-audit/v1" as const;

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const SafeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z][A-Za-z0-9._-]*$/u);
const RelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\0") &&
      !value.includes("\\") &&
      value
        .split("/")
        .every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    {
      message: "Expected a relative path",
    },
  );
const JsonPointerSchema = z
  .string()
  .max(4_096)
  .refine(
    (value) =>
      value === "" ||
      (value.startsWith("/") &&
        value
          .slice(1)
          .split("/")
          .every((token) => !/(?:~(?![01]))/u.test(token))),
    { message: "Expected an RFC 6901 JSON Pointer" },
  );

export const DatasetAuditSeveritySchema = z.enum(["WARNING", "ERROR"]);
export type DatasetAuditSeverity = z.infer<typeof DatasetAuditSeveritySchema>;

export const DatasetAuditIssueCodeSchema = z.enum([
  "ARTIFACT_REFERENCE_MISSING",
  "AUXILIARY_FORMAT",
  "COLLECTION_COUNT_MISMATCH",
  "COLLECTION_POINTER_INVALID",
  "COMPLETENESS_CHECK_FAILED",
  "DECLARED_COUNT_MISMATCH",
  "DUPLICATE_COLLECTION_ID",
  "EXTENSION_CONTENT_MISMATCH",
  "FILE_READ_FAILED",
  "FILE_TOO_LARGE",
  "INVALID_JSON",
  "INVALID_JSONL",
  "INVALID_PNG",
  "INVALID_XLSX",
  "MANIFEST_REFERENCE_MISSING",
  "OUTCOME_UNMAPPED",
  "PROJECTION_SOURCE_INVALID",
  "STALE_SOURCE_CANDIDATE",
]);
export type DatasetAuditIssueCode = z.infer<typeof DatasetAuditIssueCodeSchema>;

export const DatasetAuditIssueSchema = z
  .object({
    code: DatasetAuditIssueCodeSchema,
    severity: DatasetAuditSeveritySchema,
  })
  .strict();
export type DatasetAuditIssue = z.infer<typeof DatasetAuditIssueSchema>;

export const DatasetArtifactFormatSchema = z.enum([
  "PNG",
  "JSON",
  "JSONL",
  "XLSX",
  "AUXILIARY",
  "UNKNOWN",
]);
export type DatasetArtifactFormat = z.infer<typeof DatasetArtifactFormatSchema>;

export const DatasetArtifactAuditSchema = z
  .object({
    pathHash: Sha256Schema,
    contentHash: Sha256Schema.nullable(),
    bytes: z.int().nonnegative(),
    extension: z.string().max(32),
    detectedFormat: DatasetArtifactFormatSchema,
    structuralStatus: z.enum(["VALID", "WARNING", "ERROR"]),
    issues: z.array(DatasetAuditIssueSchema).max(32),
    evaluationOutcome: z.literal("REVIEW"),
  })
  .strict();
export type DatasetArtifactAudit = z.infer<typeof DatasetArtifactAuditSchema>;

export const DatasetAuditLimitsSchema = z
  .object({
    maxFiles: z.int().positive().max(100_000),
    maxFileBytes: z.int().positive().max(1_000_000_000),
    maxTotalBytes: z.int().positive().max(10_000_000_000),
    concurrency: z.literal(4),
  })
  .strict();
export type DatasetAuditLimits = z.infer<typeof DatasetAuditLimitsSchema>;

export const DatasetProjectionSourceSchema = z
  .object({
    id: SafeIdSchema,
    file: RelativePathSchema,
    format: z.enum(["JSON", "JSONL"]),
    candidateGroup: SafeIdSchema.optional(),
    selection: z.enum(["SELECTED", "STALE"]).default("SELECTED"),
  })
  .strict();

export const DatasetProjectionCollectionSchema = z
  .object({
    id: SafeIdSchema,
    sourceIds: z.array(SafeIdSchema).min(1).max(100),
    pointer: JsonPointerSchema,
    aggregateRows: z.boolean().default(false),
    expectedCount: z.int().nonnegative().optional(),
    declaredCountPointer: JsonPointerSchema.optional(),
    itemIdPointer: JsonPointerSchema.optional(),
    artifactReferencePointer: JsonPointerSchema.optional(),
    artifactReferenceBase: RelativePathSchema.optional(),
    artifactReferenceRequired: z.boolean().default(true),
    artifactReferenceSeverity: DatasetAuditSeveritySchema.default("ERROR"),
    canonical: z.boolean().default(true),
  })
  .strict();

export const DatasetProjectionRelationshipSchema = z
  .object({
    id: SafeIdSchema,
    fromCollectionId: SafeIdSchema,
    referencePointer: JsonPointerSchema,
    toCollectionId: SafeIdSchema,
  })
  .strict();

export const DatasetProjectionCompletenessSchema = z
  .object({
    id: SafeIdSchema,
    collectionId: SafeIdSchema,
    pointer: JsonPointerSchema,
    predicate: z.enum([
      "PRESENT",
      "NON_EMPTY",
      "NOT_IN_VALUES",
      "NORMALIZED_BBOX",
      "NORMALIZED_XYXY",
      "POSITIVE_INTEGER",
      "ARTIFACT_EXISTS",
    ]),
    disallowedValues: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(100),
    coordinatePointers: z
      .object({
        minX: JsonPointerSchema,
        minY: JsonPointerSchema,
        maxX: JsonPointerSchema,
        maxY: JsonPointerSchema,
      })
      .strict()
      .optional(),
    artifactReferenceBase: RelativePathSchema.optional(),
  })
  .strict()
  .superRefine(
    ({ predicate, disallowedValues, coordinatePointers, artifactReferenceBase }, context) => {
      if ((predicate === "NOT_IN_VALUES") !== disallowedValues.length > 0) {
        context.addIssue({
          code: "custom",
          message: "Only NOT_IN_VALUES requires one or more disallowed values",
          path: ["disallowedValues"],
        });
      }
      if ((predicate === "NORMALIZED_XYXY") !== (coordinatePointers !== undefined)) {
        context.addIssue({
          code: "custom",
          message: "Only NORMALIZED_XYXY requires coordinate pointers",
          path: ["coordinatePointers"],
        });
      }
      if (predicate !== "ARTIFACT_EXISTS" && artifactReferenceBase !== undefined) {
        context.addIssue({
          code: "custom",
          message: "Only ARTIFACT_EXISTS accepts an artifact reference base",
          path: ["artifactReferenceBase"],
        });
      }
    },
  );

export const DatasetProjectionOutcomeSchema = z
  .object({
    collectionId: SafeIdSchema,
    pointer: JsonPointerSchema,
    mapping: z.record(
      z.string().min(1).max(500),
      z.enum(["PASS", "FAIL", "REVIEW", "NOT_APPLICABLE"]),
    ),
    fallback: z.literal("REVIEW").default("REVIEW"),
  })
  .strict();

export const DatasetProjectionConfigSchema = z
  .object({
    sources: z.array(DatasetProjectionSourceSchema).min(1).max(100),
    staleFiles: z.array(RelativePathSchema).max(100).default([]),
    collections: z.array(DatasetProjectionCollectionSchema).min(1).max(100),
    relationships: z.array(DatasetProjectionRelationshipSchema).max(100).default([]),
    completeness: z.array(DatasetProjectionCompletenessSchema).max(100).default([]),
    outcome: DatasetProjectionOutcomeSchema.optional(),
  })
  .strict()
  .superRefine((config, context) => {
    const sourceIds = new Set(config.sources.map(({ id }) => id));
    const selectedSourceIds = new Set(
      config.sources.filter(({ selection }) => selection === "SELECTED").map(({ id }) => id),
    );
    const collectionIds = new Set(config.collections.map(({ id }) => id));
    if (sourceIds.size !== config.sources.length) {
      context.addIssue({ code: "custom", message: "Source IDs must be unique", path: ["sources"] });
    }
    if (collectionIds.size !== config.collections.length) {
      context.addIssue({
        code: "custom",
        message: "Collection IDs must be unique",
        path: ["collections"],
      });
    }
    if (new Set(config.staleFiles).size !== config.staleFiles.length) {
      context.addIssue({
        code: "custom",
        message: "Stale file paths must be unique",
        path: ["staleFiles"],
      });
    }
    config.collections.forEach(({ sourceIds: referencedSourceIds }, index) => {
      if (
        new Set(referencedSourceIds).size !== referencedSourceIds.length ||
        referencedSourceIds.some((sourceId) => !selectedSourceIds.has(sourceId))
      ) {
        context.addIssue({
          code: "custom",
          message: "Collection source IDs must be unique and known",
          path: ["collections", index, "sourceIds"],
        });
      }
    });
    config.relationships.forEach(({ fromCollectionId, toCollectionId }, index) => {
      if (!collectionIds.has(fromCollectionId) || !collectionIds.has(toCollectionId)) {
        context.addIssue({
          code: "custom",
          message: "Relationship references an unknown collection",
          path: ["relationships", index],
        });
      }
    });
    config.completeness.forEach(({ collectionId }, index) => {
      if (!collectionIds.has(collectionId)) {
        context.addIssue({
          code: "custom",
          message: "Completeness check references an unknown collection",
          path: ["completeness", index, "collectionId"],
        });
      }
    });
    if (config.outcome !== undefined && !collectionIds.has(config.outcome.collectionId)) {
      context.addIssue({
        code: "custom",
        message: "Outcome projection references an unknown collection",
        path: ["outcome", "collectionId"],
      });
    }
    const groups = new Map<string, { selected: number; stale: number }>();
    for (const source of config.sources) {
      if (source.candidateGroup === undefined) continue;
      const group = groups.get(source.candidateGroup) ?? { selected: 0, stale: 0 };
      group[source.selection === "SELECTED" ? "selected" : "stale"] += 1;
      groups.set(source.candidateGroup, group);
    }
    for (const [groupId, counts] of groups) {
      if (counts.selected !== 1) {
        context.addIssue({
          code: "custom",
          message: "Each candidate group requires exactly one selected source",
          path: ["sources", groupId],
        });
      }
    }
  });
export type DatasetProjectionConfig = z.infer<typeof DatasetProjectionConfigSchema>;

const ProjectionCountSchema = z
  .object({
    idHash: Sha256Schema,
    count: z.int().nonnegative(),
    expectedCount: z.int().nonnegative().nullable(),
    declaredCount: z.int().nonnegative().nullable(),
    canonical: z.boolean(),
  })
  .strict();

const ProjectionRelationshipSchema = z
  .object({
    idHash: Sha256Schema,
    total: z.int().nonnegative(),
    resolved: z.int().nonnegative(),
    missing: z.int().nonnegative(),
  })
  .strict()
  .refine(({ total, resolved, missing }) => total === resolved + missing);

const ProjectionCompletenessSchema = z
  .object({
    idHash: Sha256Schema,
    total: z.int().nonnegative(),
    complete: z.int().nonnegative(),
    incomplete: z.int().nonnegative(),
    missing: z.int().nonnegative(),
    invalid: z.int().nonnegative(),
  })
  .strict()
  .refine(
    ({ total, complete, incomplete, missing, invalid }) =>
      total === complete + incomplete && incomplete === missing + invalid,
  );

export const DatasetProjectionAuditSchema = z
  .object({
    selectedSources: z.int().nonnegative(),
    staleSources: z.int().nonnegative(),
    collections: z.array(ProjectionCountSchema).max(100),
    relationships: z.array(ProjectionRelationshipSchema).max(100),
    completeness: z.array(ProjectionCompletenessSchema).max(100),
    diagnosticOutcomes: z
      .object({
        PASS: z.int().nonnegative(),
        FAIL: z.int().nonnegative(),
        REVIEW: z.int().nonnegative(),
        NOT_APPLICABLE: z.int().nonnegative(),
      })
      .strict(),
    issues: z.array(DatasetAuditIssueSchema).max(10_000),
  })
  .strict();
export type DatasetProjectionAudit = z.infer<typeof DatasetProjectionAuditSchema>;

const DatasetAuditReportCoreSchema = z
  .object({
    schemaVersion: z.literal(DATASET_AUDIT_SCHEMA_VERSION),
    generatedAt: z.iso.datetime({ offset: true }),
    corpusHash: Sha256Schema,
    limits: DatasetAuditLimitsSchema,
    summary: z
      .object({
        files: z.int().nonnegative(),
        bytes: z.int().nonnegative(),
        valid: z.int().nonnegative(),
        warnings: z.int().nonnegative(),
        errors: z.int().nonnegative(),
        review: z.int().nonnegative(),
      })
      .strict()
      .refine(
        ({ files, valid, warnings, errors, review }) =>
          files === valid + warnings + errors && review === files,
      ),
    artifacts: z.array(DatasetArtifactAuditSchema).max(100_000),
    projection: DatasetProjectionAuditSchema.nullable(),
  })
  .strict();

export type DatasetAuditReportCore = z.infer<typeof DatasetAuditReportCoreSchema>;

export const DatasetAuditReportSchema = DatasetAuditReportCoreSchema.extend({
  reportHash: Sha256Schema,
})
  .strict()
  .superRefine(({ reportHash, ...core }, context) => {
    if (reportHash !== sha256CanonicalJson(core)) {
      context.addIssue({
        code: "custom",
        message: "reportHash does not match the canonical report",
        path: ["reportHash"],
      });
    }
  });
export type DatasetAuditReport = z.infer<typeof DatasetAuditReportSchema>;

export function createDatasetAuditReport(core: DatasetAuditReportCore): DatasetAuditReport {
  const parsed = DatasetAuditReportCoreSchema.parse(core);
  return DatasetAuditReportSchema.parse({ ...parsed, reportHash: sha256CanonicalJson(parsed) });
}

export function verifyDatasetAuditReport(value: unknown): boolean {
  return DatasetAuditReportSchema.safeParse(value).success;
}
