import { sha256CanonicalJson } from "@vera/contracts";
import { z } from "zod";

const Sha256DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const IsoCountryCodeSchema = z.string().regex(/^[A-Z]{2}$/u);
const OfficialJurisdictionCodeSchema = z.union([z.literal("EU"), IsoCountryCodeSchema]);
const SafeHostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?:\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u,
  )
  .max(253)
  .refine((value) => !/^\.?\d+(?:\.\d+){3}$/u.test(value), {
    message: "allowedHosts must not contain an IP address",
  });

const QueryTemplateSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine(
    (value) => {
      const withoutKnownTokens = value.replace(/\{(?:topics|productCategory|language)\}/gu, "");
      return !/[{}]/u.test(withoutKnownTokens);
    },
    {
      message:
        "queryTemplate may only contain the {topics}, {productCategory}, and {language} placeholders",
    },
  );

/** A result-host allowlist may only narrow an authority profile's host set. */
function hostPatternIsCoveredBy(resultHost: string, allowedHosts: readonly string[]): boolean {
  return allowedHosts.some((allowedHost) => {
    if (resultHost.startsWith(".")) {
      return allowedHost.startsWith(".") && resultHost.endsWith(allowedHost);
    }
    return allowedHost.startsWith(".")
      ? resultHost.endsWith(allowedHost)
      : resultHost === allowedHost;
  });
}

export const RegulatoryAreaSchema = z.enum([
  "EU",
  "EUROPE_NON_EU",
  "AFRICA",
  "AMERICAS",
  "ASIA",
  "OCEANIA",
  "ANTARCTICA",
]);

export const SourceDiscoveryScopeSchema = z
  .object({
    /** ISO 3166-1 alpha-2 market country; `EU` is represented by regulatoryAreas. */
    marketCountryCode: IsoCountryCodeSchema,
    regulatoryAreas: z.array(RegulatoryAreaSchema).min(1).max(7),
    productCategory: z.string().trim().min(1).max(120),
    evaluationDate: z.iso.date(),
    language: z.string().trim().min(2).max(35),
    templateVersion: z.string().trim().min(1).max(120),
    requiredTopics: z.array(z.string().trim().min(1).max(120)).min(1).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.regulatoryAreas).size !== value.regulatoryAreas.length) {
      context.addIssue({
        code: "custom",
        path: ["regulatoryAreas"],
        message: "regulatoryAreas must not contain duplicates",
      });
    }
    if (
      new Set(value.requiredTopics.map((topic) => topic.toLocaleLowerCase("en-US"))).size !==
      value.requiredTopics.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["requiredTopics"],
        message: "requiredTopics must not contain duplicates",
      });
    }
  });

export type SourceDiscoveryScope = z.infer<typeof SourceDiscoveryScopeSchema>;

/**
 * Every endpoint and host is ADMIN-configured in SILTO before it reaches VERA.
 * LangGraph can only invoke this closed set of deterministic tool profiles; it
 * never receives a generic internet-search tool or a browser capability.
 */
export const OfficialAuthorityProfileSchema = z
  .object({
    id: z.uuid(),
    jurisdictionCode: OfficialJurisdictionCodeSchema,
    authorityName: z.string().trim().min(1).max(300),
    allowedHosts: z.array(SafeHostSchema).min(1).max(30),
    /**
     * Optional narrower allowlist for result/document URLs. The backend omits
     * this field when no narrower boundary is configured; an empty legacy
     * value is normalized to the same safe fallback (allowedHosts).
     */
    resultUrlAllowlist: z.array(SafeHostSchema).max(30).optional(),
    searchEndpoint: z.url().max(2_048),
    searchMode: z.enum(["EURLEX_CELLAR_SPARQL", "OFFICIAL_SEARCH_JSON", "OFFICIAL_SEARCH_HTML"]),
    /**
     * A static, ADMIN-configured terms template. It can shape only the query
     * sent to the already-allowlisted endpoint; it can never alter an URL,
     * request method, headers, or the graph's tool set.
     */
    queryTemplate: z.preprocess(
      (value) => (value === null ? undefined : value),
      QueryTemplateSchema.optional(),
    ),
    /** Query-string key for ordinary official search pages/APIs. */
    queryParameter: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u)
      .optional(),
    /** Backend-owned optional projection key used by official JSON APIs. */
    resultUrlFields: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/u),
      )
      .min(1)
      .max(10)
      .optional(),
    resultTitleFields: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/u),
      )
      .min(1)
      .max(10)
      .optional(),
    /** Backend-configured topic coverage; absent means the profile is not topic-limited. */
    supportedTopics: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
    /**
     * Official language coverage is a mandatory, fail-closed discovery
     * boundary.  It prevents an otherwise valid country portal from being
     * searched for an analysis language it cannot serve.
     */
    languages: z.array(z.string().trim().min(2).max(35)).min(1).max(50),
    resultLimit: z.int().min(1).max(20).default(10),
    active: z.boolean(),
  })
  .strict()
  .superRefine((profile, context) => {
    try {
      const endpoint = new URL(profile.searchEndpoint);
      if (
        endpoint.protocol !== "https:" ||
        endpoint.username ||
        endpoint.password ||
        endpoint.port ||
        endpoint.hash
      ) {
        throw new Error("invalid search endpoint");
      }
      const host = endpoint.hostname.toLowerCase();
      const allowed = profile.allowedHosts.some((value) =>
        value.startsWith(".") ? host.endsWith(value) : host === value,
      );
      if (!allowed) throw new Error("endpoint host is not allowlisted");
    } catch {
      context.addIssue({
        code: "custom",
        path: ["searchEndpoint"],
        message: "searchEndpoint must be an allowlisted official HTTPS endpoint",
      });
    }
    if (
      (profile.resultUrlAllowlist ?? []).some(
        (resultHost) => !hostPatternIsCoveredBy(resultHost, profile.allowedHosts),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["resultUrlAllowlist"],
        message: "resultUrlAllowlist must narrow allowedHosts",
      });
    }
  });

export type OfficialAuthorityProfile = z.infer<typeof OfficialAuthorityProfileSchema>;

export const SourceDiscoveryWorkerInputSchema = z
  .object({
    runId: z.uuid(),
    // Discovery is allowed for a non-workspace-scoped historical analysis.
    // The backend remains the access-control authority; VERA never uses this
    // field to select data or an egress destination.
    workspaceId: z.uuid().nullable(),
    scope: SourceDiscoveryScopeSchema,
    authorityProfiles: z.array(OfficialAuthorityProfileSchema).max(100),
    /** Backend-provided SHA/canonical keys avoid rediscovering an existing proposal. */
    existingDeduplicationKeys: z.array(Sha256DigestSchema).max(10_000).default([]),
  })
  .strict();

export type SourceDiscoveryWorkerInput = z.infer<typeof SourceDiscoveryWorkerInputSchema>;

export const SourceDiscoveryEvidenceSchema = z
  .object({
    url: z.url().max(2_048),
    title: z.string().trim().min(1).max(500),
    pageNumber: z.int().min(1).nullable(),
    quote: z.string().trim().min(1).max(600),
  })
  .strict();

export type SourceDiscoveryEvidence = z.infer<typeof SourceDiscoveryEvidenceSchema>;

export const SourceDiscoveryProposalSchema = z
  .object({
    authorityProfileId: z.uuid(),
    authorityName: z.string().trim().min(1).max(300),
    sourceTitle: z.string().trim().min(1).max(500),
    canonicalUrl: z.url().max(2_048),
    pdfUrl: z.url().max(2_048).nullable(),
    sourceFormat: z.enum(["PDF", "OFFICIAL_HTML"]),
    storageObjectKey: z.string().trim().min(1).max(1_000),
    sourceSha256: Sha256DigestSchema,
    contentByteSize: z
      .int()
      .min(1)
      .max(50 * 1024 * 1024),
    language: z.string().trim().min(2).max(35).nullable(),
    documentType: z.string().trim().min(1).max(120).nullable(),
    actReference: z.string().trim().min(1).max(500).nullable(),
    revisionLabel: z.string().trim().min(1).max(120).nullable(),
    productCategories: z.array(z.string().trim().min(1).max(120)).max(100),
    labelingTopics: z.array(z.string().trim().min(1).max(120)).max(100),
    discoveryQuery: z.string().trim().min(1).max(2_000),
    rationale: z.string().trim().min(1).max(1_000),
    evidence: z.array(SourceDiscoveryEvidenceSchema).min(1).max(20),
    deduplicationKey: Sha256DigestSchema,
    /** Immutable audit data for the narrow AI ranking, never a governance decision. */
    discoveryModel: z.literal("google/gemini-2.5-pro"),
    discoveryPromptVersion: z.literal("label-source-discovery-rank-v1"),
    discoveryResponseSchemaHash: Sha256DigestSchema,
  })
  .strict();

export type SourceDiscoveryProposal = z.infer<typeof SourceDiscoveryProposalSchema>;

export const SourceDiscoveryDiagnosticsSchema = z
  .object({
    profilesConsulted: z.array(z.uuid()).max(100),
    skippedProfiles: z
      .array(
        z
          .object({
            authorityProfileId: z.uuid(),
            code: z.string().trim().min(1).max(120),
          })
          .strict(),
      )
      .max(100),
    skippedCandidates: z
      .array(
        z
          .object({
            url: z.url().max(2_048),
            code: z.string().trim().min(1).max(120),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

export type SourceDiscoveryDiagnostics = z.infer<typeof SourceDiscoveryDiagnosticsSchema>;

export const SOURCE_DISCOVERY_RANKING_MODEL = "google/gemini-2.5-pro" as const;
export const SOURCE_DISCOVERY_RANKING_PROMPT_VERSION = "label-source-discovery-rank-v1" as const;

export const SourceDiscoveryRankingSchema = z
  .object({
    shouldPropose: z.boolean(),
    rationale: z.string().trim().min(1).max(1_000),
    documentType: z.string().trim().min(1).max(120).nullable(),
    actReference: z.string().trim().min(1).max(500).nullable(),
    revisionLabel: z.string().trim().min(1).max(120).nullable(),
    language: z.string().trim().min(2).max(35).nullable(),
    productCategories: z.array(z.string().trim().min(1).max(120)).max(100),
    labelingTopics: z.array(z.string().trim().min(1).max(120)).max(100),
    evidence: z
      .array(
        z
          .object({
            quote: z.string().trim().min(1).max(600),
            pageNumber: z.int().min(1).nullable(),
          })
          .strict(),
      )
      .min(0)
      .max(10),
  })
  .strict();

export type SourceDiscoveryRanking = z.infer<typeof SourceDiscoveryRankingSchema>;

export const SOURCE_DISCOVERY_RANKING_JSON_SCHEMA = (() => {
  const schema = SourceDiscoveryRankingSchema.toJSONSchema({ target: "draft-07" });
  const clone = structuredClone(schema);
  delete clone.$schema;
  return Object.freeze(clone) as Readonly<Record<string, unknown>>;
})();

export const SOURCE_DISCOVERY_RANKING_SCHEMA_HASH = sha256CanonicalJson(
  SOURCE_DISCOVERY_RANKING_JSON_SCHEMA,
);
