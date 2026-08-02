import { sha256CanonicalJson } from "@vera/contracts";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import {
  OfficialAuthorityProfileError,
  profileAppliesToScope,
} from "./official-authority-profile.js";
import type { OfficialSearchCandidate } from "./official-authority-profile.js";
import { OfficialAuthoritySearchError } from "./official-authority-search-tool.js";
import type { OfficialAuthoritySearchTool } from "./official-authority-search-tool.js";
import { OfficialSourceAcquisitionError } from "./official-source-acquirer.js";
import type { AcquiredOfficialSource, OfficialSourceAcquirer } from "./official-source-acquirer.js";
import type {
  OfficialAuthorityProfile,
  SourceDiscoveryDiagnostics,
  SourceDiscoveryProposal,
  SourceDiscoveryWorkerInput,
} from "./source-discovery-contracts.js";
import {
  SOURCE_DISCOVERY_RANKING_MODEL,
  SOURCE_DISCOVERY_RANKING_PROMPT_VERSION,
  SOURCE_DISCOVERY_RANKING_SCHEMA_HASH,
} from "./source-discovery-contracts.js";
import type { SourceDiscoveryBackendClient } from "./source-discovery-backend-client.js";
import type {
  SourceDiscoveryJobProcessor,
  SourceDiscoveryJobResult,
} from "./source-discovery-jobs.js";
import { SourceDiscoveryJobError, SourceDiscoveryJobSchema } from "./source-discovery-jobs.js";
import { SourceDiscoveryRankerError } from "./source-discovery-ranker.js";
import type { SourceDiscoveryRanker } from "./source-discovery-ranker.js";

const MAX_DISCOVERY_CANDIDATES = 50;

const DiscoveryGraphState = Annotation.Root({
  input: Annotation<SourceDiscoveryWorkerInput>,
  profiles: Annotation<readonly OfficialAuthorityProfile[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  candidates: Annotation<readonly OfficialSearchCandidate[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  acquired: Annotation<readonly AcquiredOfficialSource[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  proposals: Annotation<readonly SourceDiscoveryProposal[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  diagnostics: Annotation<SourceDiscoveryDiagnostics>({
    reducer: (_current, update) => update,
    default: () => ({ profilesConsulted: [], skippedProfiles: [], skippedCandidates: [] }),
  }),
});

function emptyDiagnostics(): SourceDiscoveryDiagnostics {
  return { profilesConsulted: [], skippedProfiles: [], skippedCandidates: [] };
}

function withSkippedProfile(
  diagnostics: SourceDiscoveryDiagnostics,
  authorityProfileId: string,
  code: string,
): SourceDiscoveryDiagnostics {
  return {
    ...diagnostics,
    skippedProfiles: [...diagnostics.skippedProfiles, { authorityProfileId, code }].slice(0, 100),
  };
}

function withSkippedCandidate(
  diagnostics: SourceDiscoveryDiagnostics,
  url: string,
  code: string,
): SourceDiscoveryDiagnostics {
  return {
    ...diagnostics,
    skippedCandidates: [...diagnostics.skippedCandidates, { url, code }].slice(0, 200),
  };
}

function sourceDiscoveryDeduplicationKey(input: AcquiredOfficialSource): string {
  return sha256CanonicalJson({
    canonicalUrl: input.canonicalUrl,
    sourceSha256: input.sourceSha256,
  });
}

function errorDetails(error: unknown): { readonly retryable: boolean; readonly code: string } {
  if (
    error instanceof OfficialAuthorityProfileError ||
    error instanceof OfficialAuthoritySearchError ||
    error instanceof OfficialSourceAcquisitionError
  ) {
    return { retryable: error.retryable, code: error.code };
  }
  if (error instanceof SourceDiscoveryRankerError) {
    return { retryable: error.retryable, code: "OPENROUTER_DISCOVERY_RANKING_FAILED" };
  }
  if (error instanceof SourceDiscoveryJobError) {
    return { retryable: error.retryable, code: "SOURCE_DISCOVERY_FAILED" };
  }
  return { retryable: true, code: "SOURCE_DISCOVERY_FAILED" };
}

function deterministicEvidence(input: AcquiredOfficialSource): SourceDiscoveryProposal["evidence"] {
  const quote = input.candidate.searchEvidence.replace(/\s+/gu, " ").trim().slice(0, 600);
  return [
    {
      url: input.canonicalUrl,
      title: input.candidate.sourceTitle,
      pageNumber: null,
      quote: quote || input.candidate.sourceTitle,
    },
  ];
}

function matchingTopics(input: {
  readonly proposed: readonly string[];
  readonly required: readonly string[];
}): readonly string[] {
  const requiredByNormalized = new Map(
    input.required.map((topic) => [topic.toLocaleLowerCase("en-US"), topic] as const),
  );
  const matches: string[] = [];
  for (const value of input.proposed) {
    const normalized = value.toLocaleLowerCase("en-US");
    const canonical = requiredByNormalized.get(normalized);
    if (canonical !== undefined && !matches.includes(canonical)) matches.push(canonical);
  }
  // A positive rank is still useful when the authority title cannot repeat
  // the exact template vocabulary. The scope topics remain a human-visible
  // requirement, never an AI-created legal classification.
  return matches.length > 0 ? matches : input.required;
}

interface SourceDiscoveryGraph {
  invoke(input: { readonly input: SourceDiscoveryWorkerInput }): Promise<{
    readonly proposals: readonly SourceDiscoveryProposal[];
    readonly diagnostics: SourceDiscoveryDiagnostics;
  }>;
}

function createDiscoveryGraph(options: {
  readonly searchTool: OfficialAuthoritySearchTool;
  readonly acquirer: OfficialSourceAcquirer;
  readonly ranker: SourceDiscoveryRanker;
}): SourceDiscoveryGraph {
  const graph = new StateGraph(DiscoveryGraphState)
    .addNode("resolve_official_profiles", (state) => {
      const profiles = state.input.authorityProfiles.filter((profile) =>
        profileAppliesToScope(profile, state.input.scope),
      );
      return { profiles, diagnostics: emptyDiagnostics() };
    })
    .addNode("search_configured_authorities", async (state) => {
      let diagnostics = state.diagnostics;
      const candidates: OfficialSearchCandidate[] = [];
      const seenUrls = new Set<string>();
      for (const profile of state.profiles) {
        diagnostics = {
          ...diagnostics,
          profilesConsulted: [...diagnostics.profilesConsulted, profile.id].slice(0, 100),
        };
        try {
          const found = await options.searchTool.search({ profile, scope: state.input.scope });
          for (const candidate of found) {
            if (seenUrls.has(candidate.sourceUrl)) continue;
            seenUrls.add(candidate.sourceUrl);
            candidates.push(candidate);
            if (candidates.length >= MAX_DISCOVERY_CANDIDATES) break;
          }
        } catch (error) {
          const details = errorDetails(error);
          if (details.retryable) {
            throw new SourceDiscoveryJobError(
              "Official authority search is temporarily unavailable",
              true,
              {
                cause: error,
              },
            );
          }
          diagnostics = withSkippedProfile(diagnostics, profile.id, details.code);
        }
        if (candidates.length >= MAX_DISCOVERY_CANDIDATES) break;
      }
      return { candidates, diagnostics };
    })
    .addNode("acquire_official_snapshots", async (state) => {
      let diagnostics = state.diagnostics;
      const acquired: AcquiredOfficialSource[] = [];
      for (const candidate of state.candidates) {
        try {
          acquired.push(await options.acquirer.acquire(candidate, state.input.runId));
        } catch (error) {
          const details = errorDetails(error);
          if (details.retryable) {
            throw new SourceDiscoveryJobError(
              "Official source acquisition is temporarily unavailable",
              true,
              {
                cause: error,
              },
            );
          }
          diagnostics = withSkippedCandidate(diagnostics, candidate.sourceUrl, details.code);
        }
      }
      return { acquired, diagnostics };
    })
    .addNode("rank_official_proposals", async (state) => {
      let diagnostics = state.diagnostics;
      const proposals: SourceDiscoveryProposal[] = [];
      const seenDeduplicationKeys = new Set(state.input.existingDeduplicationKeys);
      for (const acquired of state.acquired) {
        const deduplicationKey = sourceDiscoveryDeduplicationKey(acquired);
        if (seenDeduplicationKeys.has(deduplicationKey)) {
          diagnostics = withSkippedCandidate(
            diagnostics,
            acquired.canonicalUrl,
            "SOURCE_ALREADY_DISCOVERED",
          );
          continue;
        }
        let result;
        try {
          result = await options.ranker.rank({
            authorityName: acquired.candidate.profile.authorityName,
            jurisdictionCode: acquired.candidate.profile.jurisdictionCode,
            sourceTitle: acquired.candidate.sourceTitle,
            officialSearchEvidence: acquired.candidate.searchEvidence,
            discoveryQuery: acquired.candidate.discoveryQuery,
            scope: state.input.scope,
          });
        } catch (error) {
          const details = errorDetails(error);
          if (details.retryable) {
            throw new SourceDiscoveryJobError(
              "Source discovery ranking is temporarily unavailable",
              true,
              {
                cause: error,
              },
            );
          }
          diagnostics = withSkippedCandidate(diagnostics, acquired.canonicalUrl, details.code);
          continue;
        }
        if (!result.ranking.shouldPropose) {
          diagnostics = withSkippedCandidate(
            diagnostics,
            acquired.canonicalUrl,
            "NOT_TEMPLATE_RELEVANT",
          );
          continue;
        }
        const scope = state.input.scope;
        proposals.push({
          authorityProfileId: acquired.candidate.profile.id,
          authorityName: acquired.candidate.profile.authorityName,
          sourceTitle: acquired.candidate.sourceTitle,
          canonicalUrl: acquired.canonicalUrl,
          pdfUrl: acquired.pdfUrl,
          sourceFormat: acquired.sourceFormat,
          storageObjectKey: acquired.storageObjectKey,
          sourceSha256: acquired.sourceSha256,
          contentByteSize: acquired.contentByteSize,
          language: result.ranking.language ?? scope.language,
          documentType: result.ranking.documentType,
          actReference: result.ranking.actReference,
          revisionLabel: result.ranking.revisionLabel,
          productCategories: [scope.productCategory],
          labelingTopics: Array.from(
            matchingTopics({
              proposed: result.ranking.labelingTopics,
              required: scope.requiredTopics,
            }),
          ),
          discoveryQuery: acquired.candidate.discoveryQuery,
          rationale: result.ranking.rationale,
          // Evidence is deterministic provenance from the official search
          // response. Model-generated evidence is intentionally not trusted.
          evidence: deterministicEvidence(acquired),
          deduplicationKey,
          discoveryModel: result.model,
          discoveryPromptVersion: result.promptVersion,
          discoveryResponseSchemaHash: result.responseSchemaHash,
        });
        seenDeduplicationKeys.add(deduplicationKey);
      }
      return { proposals, diagnostics };
    })
    .addEdge(START, "resolve_official_profiles")
    .addEdge("resolve_official_profiles", "search_configured_authorities")
    .addEdge("search_configured_authorities", "acquire_official_snapshots")
    .addEdge("acquire_official_snapshots", "rank_official_proposals")
    .addEdge("rank_official_proposals", END)
    .compile();
  return graph;
}

/**
 * LangGraph orchestration for the private discovery flow. All nodes are
 * deterministic except the narrowly-scoped ranker; no node can call a web
 * search engine, create a governed source, transition governance state, or
 * write an embedding/vector. The backend persists returned proposals as
 * DISCOVERED staging records and human verification triggers later indexing.
 */
export function createSourceDiscoveryJobProcessor(options: {
  readonly backend: SourceDiscoveryBackendClient;
  readonly searchTool: OfficialAuthoritySearchTool;
  readonly acquirer: OfficialSourceAcquirer;
  readonly ranker: SourceDiscoveryRanker;
  readonly createInvocationId?: () => string;
}): SourceDiscoveryJobProcessor {
  const createInvocationId = options.createInvocationId ?? (() => crypto.randomUUID());
  const graph = createDiscoveryGraph(options);

  return {
    async process(job): Promise<SourceDiscoveryJobResult> {
      const inputJob = SourceDiscoveryJobSchema.parse(job);
      const input = await options.backend.getInput(inputJob);
      const invocationId = createInvocationId();
      const claim = await options.backend.claim({
        discoveryRunId: input.runId,
        kind: inputJob.kind,
        workerInvocationId: invocationId,
      });
      if (!claim.acquired) {
        return { discoveryRunId: input.runId, kind: inputJob.kind, replayed: true };
      }
      let diagnostics = emptyDiagnostics();
      try {
        const result = await graph.invoke({ input });
        diagnostics = result.diagnostics;
        await options.backend.complete({
          discoveryRunId: input.runId,
          callback: {
            kind: inputJob.kind,
            workerInvocationId: invocationId,
            status: "COMPLETED",
            discoveryModel: SOURCE_DISCOVERY_RANKING_MODEL,
            discoveryPromptVersion: SOURCE_DISCOVERY_RANKING_PROMPT_VERSION,
            discoveryResponseSchemaHash: SOURCE_DISCOVERY_RANKING_SCHEMA_HASH,
            proposals: result.proposals.slice(0, MAX_DISCOVERY_CANDIDATES),
            diagnostics,
          },
        });
        return {
          discoveryRunId: input.runId,
          kind: inputJob.kind,
          proposalsCreated: result.proposals.length,
          skippedCandidates: diagnostics.skippedCandidates.length,
        };
      } catch (error) {
        const details = errorDetails(error);
        try {
          await options.backend.fail({
            discoveryRunId: input.runId,
            callback: {
              kind: inputJob.kind,
              workerInvocationId: invocationId,
              status: "FAILED",
              failure: { code: details.code, retryable: details.retryable },
              diagnostics,
            },
          });
        } catch (callbackError) {
          throw new SourceDiscoveryJobError("Unable to persist source discovery failure", true, {
            cause: callbackError,
          });
        }
        if (details.retryable) {
          throw new SourceDiscoveryJobError("Retryable source discovery failure persisted", true, {
            cause: error,
          });
        }
        return {
          discoveryRunId: input.runId,
          kind: inputJob.kind,
          proposalsCreated: 0,
          skippedCandidates: diagnostics.skippedCandidates.length,
        };
      }
    },
  };
}
