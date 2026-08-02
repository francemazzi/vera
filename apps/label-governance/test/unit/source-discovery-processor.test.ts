import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { OfficialAuthoritySearchError } from "../../src/official-authority-search-tool.js";
import { createSourceDiscoveryJobProcessor } from "../../src/source-discovery-processor.js";
import { SourceDiscoveryJobError } from "../../src/source-discovery-jobs.js";
import type { SourceDiscoveryBackendClient } from "../../src/source-discovery-backend-client.js";
import {
  SOURCE_DISCOVERY_RANKING_MODEL,
  SOURCE_DISCOVERY_RANKING_PROMPT_VERSION,
  SOURCE_DISCOVERY_RANKING_SCHEMA_HASH,
} from "../../src/source-discovery-contracts.js";
import type { SourceDiscoveryWorkerInput } from "../../src/source-discovery-contracts.js";

const runId = "00000000-0000-4000-8000-000000000621";
const profileId = "00000000-0000-4000-8000-000000000622";

function input(overrides: Partial<SourceDiscoveryWorkerInput> = {}): SourceDiscoveryWorkerInput {
  return {
    runId,
    workspaceId: "00000000-0000-4000-8000-000000000623",
    scope: {
      marketCountryCode: "IT",
      regulatoryAreas: ["EU"],
      productCategory: "Prepacked food",
      evaluationDate: "2026-07-20",
      language: "it",
      templateVersion: "food-label-v1",
      requiredTopics: ["ingredients", "allergens"],
    },
    authorityProfiles: [
      {
        id: profileId,
        jurisdictionCode: "IT",
        authorityName: "Synthetic Italian Official Gazette",
        allowedHosts: ["official.example.gov"],
        searchEndpoint: "https://official.example.gov/search",
        searchMode: "OFFICIAL_SEARCH_HTML",
        resultLimit: 10,
        languages: ["it"],
        active: true,
      },
    ],
    existingDeduplicationKeys: [],
    ...overrides,
  };
}

interface BackendHarness {
  readonly client: SourceDiscoveryBackendClient;
  readonly complete: Mock<SourceDiscoveryBackendClient["complete"]>;
  readonly fail: Mock<SourceDiscoveryBackendClient["fail"]>;
}

function backend(workerInput: SourceDiscoveryWorkerInput): BackendHarness {
  const getInput = vi
    .fn<SourceDiscoveryBackendClient["getInput"]>()
    .mockImplementation(() => Promise.resolve(workerInput));
  const claim = vi
    .fn<SourceDiscoveryBackendClient["claim"]>()
    .mockImplementation(() => Promise.resolve({ acquired: true, replayed: false }));
  const complete = vi
    .fn<SourceDiscoveryBackendClient["complete"]>()
    .mockImplementation(() => Promise.resolve());
  const fail = vi
    .fn<SourceDiscoveryBackendClient["fail"]>()
    .mockImplementation(() => Promise.resolve());
  return {
    client: {
      getInput,
      claim,
      complete,
      fail,
    },
    complete,
    fail,
  };
}

describe("LangGraph source-discovery processor", () => {
  it("creates only staged official-source proposals and never has an index/Chroma capability", async () => {
    const workerInput = input();
    const backendHarness = backend(workerInput);
    const authorityProfile = workerInput.authorityProfiles.at(0);
    if (authorityProfile === undefined)
      throw new Error("Test fixture requires an authority profile");
    const processor = createSourceDiscoveryJobProcessor({
      backend: backendHarness.client,
      searchTool: {
        search: vi.fn().mockResolvedValue([
          {
            profile: authorityProfile,
            sourceUrl: "https://official.example.gov/acts/food.pdf",
            sourceTitle: "Food labeling regulation",
            searchEvidence: "Food labeling regulation",
            discoveryQuery: "Prepacked food ingredients allergens",
          },
        ]),
      },
      acquirer: {
        acquire: vi.fn().mockResolvedValue({
          candidate: {
            profile: authorityProfile,
            sourceUrl: "https://official.example.gov/acts/food.pdf",
            sourceTitle: "Food labeling regulation",
            searchEvidence: "Food labeling regulation",
            discoveryQuery: "Prepacked food ingredients allergens",
          },
          sourceFormat: "PDF",
          canonicalUrl: "https://official.example.gov/acts/food.pdf",
          pdfUrl: "https://official.example.gov/acts/food.pdf",
          storageObjectKey:
            "label-governance/source-discovery/00000000-0000-4000-8000-000000000621/00000000-0000-4000-8000-000000000622/original/a.pdf",
          sourceSha256: "a".repeat(64),
          contentByteSize: 1_024,
        }),
      },
      ranker: {
        rank: vi.fn().mockResolvedValue({
          ranking: {
            shouldPropose: true,
            rationale: "The official result title covers food labeling.",
            documentType: "REGULATION",
            actReference: "Synthetic 1/2026",
            revisionLabel: null,
            language: "it",
            productCategories: ["Untrusted suggestion ignored"],
            labelingTopics: ["ingredients"],
            evidence: [{ quote: "Food labeling regulation", pageNumber: null }],
          },
          model: "google/gemini-2.5-pro",
          promptVersion: "label-source-discovery-rank-v1",
          responseSchemaHash: "b".repeat(64),
        }),
      },
      createInvocationId: () => "00000000-0000-4000-8000-000000000624",
    });

    const result = await processor.process({
      kind: "DISCOVER_OFFICIAL_SOURCES",
      discoveryRunId: runId,
    });

    expect(result).toEqual({
      discoveryRunId: runId,
      kind: "DISCOVER_OFFICIAL_SOURCES",
      proposalsCreated: 1,
      skippedCandidates: 0,
    });
    const completion = backendHarness.complete.mock.calls[0]?.[0];
    expect(completion?.discoveryRunId).toBe(runId);
    if (completion === undefined)
      throw new Error("Expected a source-discovery completion callback");
    const callback = completion.callback;
    expect(callback.status).toBe("COMPLETED");
    expect(callback.discoveryModel).toBe(SOURCE_DISCOVERY_RANKING_MODEL);
    expect(callback.discoveryPromptVersion).toBe(SOURCE_DISCOVERY_RANKING_PROMPT_VERSION);
    expect(callback.discoveryResponseSchemaHash).toBe(SOURCE_DISCOVERY_RANKING_SCHEMA_HASH);
    const proposal = callback.proposals[0];
    expect(proposal?.authorityProfileId).toBe(profileId);
    expect(proposal?.sourceFormat).toBe("PDF");
    expect(proposal?.productCategories).toEqual(["Prepacked food"]);
    expect(proposal?.labelingTopics).toEqual(["ingredients"]);
    expect(proposal?.evidence[0]?.url).toBe("https://official.example.gov/acts/food.pdf");
    expect(proposal?.evidence[0]?.quote).toBe("Food labeling regulation");
    expect(proposal?.discoveryModel).toBe("google/gemini-2.5-pro");
    expect(proposal?.discoveryPromptVersion).toBe("label-source-discovery-rank-v1");
    expect(JSON.stringify(completion)).not.toContain("chroma");
  });

  it("completes a country without an active official profile with zero proposals rather than a web-search fallback", async () => {
    const workerInput = input({ authorityProfiles: [] });
    const backendHarness = backend(workerInput);
    const search = vi.fn();
    const processor = createSourceDiscoveryJobProcessor({
      backend: backendHarness.client,
      searchTool: { search },
      acquirer: { acquire: vi.fn() },
      ranker: { rank: vi.fn() },
      createInvocationId: () => "00000000-0000-4000-8000-000000000624",
    });

    await expect(
      processor.process({ kind: "DISCOVER_OFFICIAL_SOURCES", discoveryRunId: runId }),
    ).resolves.toMatchObject({ proposalsCreated: 0 });
    expect(search).not.toHaveBeenCalled();
    const completion = backendHarness.complete.mock.calls[0]?.[0];
    expect(completion?.callback.status).toBe("COMPLETED");
    if (completion?.callback.status === "COMPLETED") {
      expect(completion.callback.proposals).toEqual([]);
    }
  });

  it("persists a retryable official-search failure before Cloud Tasks retries", async () => {
    const workerInput = input();
    const backendHarness = backend(workerInput);
    const processor = createSourceDiscoveryJobProcessor({
      backend: backendHarness.client,
      searchTool: {
        search: vi
          .fn()
          .mockRejectedValue(
            new OfficialAuthoritySearchError(
              "temporary official portal outage",
              true,
              "SEARCH_REQUEST_FAILED",
            ),
          ),
      },
      acquirer: { acquire: vi.fn() },
      ranker: { rank: vi.fn() },
      createInvocationId: () => "00000000-0000-4000-8000-000000000624",
    });

    await expect(
      processor.process({ kind: "DISCOVER_OFFICIAL_SOURCES", discoveryRunId: runId }),
    ).rejects.toBeInstanceOf(SourceDiscoveryJobError);
    const failure = backendHarness.fail.mock.calls[0]?.[0];
    expect(failure?.callback.status).toBe("FAILED");
    if (failure?.callback.status === "FAILED") {
      expect(failure.callback.failure).toEqual({
        code: "SOURCE_DISCOVERY_FAILED",
        retryable: true,
      });
    }
  });
});
