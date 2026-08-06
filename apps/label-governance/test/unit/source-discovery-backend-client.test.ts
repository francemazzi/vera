import { afterEach, describe, expect, it, vi } from "vitest";

import { createSourceDiscoveryBackendClient } from "../../src/source-discovery-backend-client.js";
import {
  OfficialAuthorityProfileSchema,
  SOURCE_DISCOVERY_RANKING_MODEL,
  SOURCE_DISCOVERY_RANKING_PROMPT_VERSION,
  SOURCE_DISCOVERY_RANKING_SCHEMA_HASH,
} from "../../src/source-discovery-contracts.js";

const runId = "00000000-0000-4000-8000-000000000641";
const profileId = "00000000-0000-4000-8000-000000000642";
const invocationId = "00000000-0000-4000-8000-000000000643";

type PrivateBackendRequest = Readonly<{
  url: string;
  method: string;
  data?: unknown;
}>;

describe("source discovery backend client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes optional authority-profile metadata emitted by the backend", () => {
    const profile = OfficialAuthorityProfileSchema.parse({
      id: profileId,
      jurisdictionCode: "RO",
      authorityName: "Romanian official legislation portal",
      allowedHosts: ["legislatie.just.ro"],
      searchEndpoint: "https://legislatie.just.ro/search",
      searchMode: "OFFICIAL_SEARCH_HTML",
      queryTemplate: null,
      supportedTopics: ["ingredients", "allergens"],
      languages: ["ro", "en"],
      active: true,
    });

    expect(profile.queryTemplate).toBeUndefined();
    expect(profile.resultUrlAllowlist).toBeUndefined();
    expect(profile.supportedTopics).toEqual(["ingredients", "allergens"]);
    expect(profile.languages).toEqual(["ro", "en"]);
  });

  it("uses private worker endpoints and preserves the structured terminal failure contract", async () => {
    const workerInput = {
      runId,
      workspaceId: null,
      scope: {
        marketCountryCode: "IT",
        regulatoryAreas: ["EU"],
        productCategory: "Prepacked food",
        evaluationDate: "2026-07-20",
        language: "it",
        templateVersion: "food-label-v1",
        requiredTopics: ["ingredients"],
      },
      authorityProfiles: [
        {
          id: profileId,
          jurisdictionCode: "IT",
          authorityName: "Synthetic Italian Official Gazette",
          allowedHosts: ["official.example.gov"],
          searchEndpoint: "https://official.example.gov/search",
          searchMode: "OFFICIAL_SEARCH_HTML",
          queryTemplate: "etichettatura {topics}",
          queryParameter: "q",
          languages: ["it"],
          active: true,
        },
      ],
      existingDeduplicationKeys: [],
    };
    const request = vi
      .fn<(input: PrivateBackendRequest) => Promise<{ readonly data: unknown }>>()
      .mockImplementation(({ url }) => {
        if (url.endsWith("/worker-input")) {
          return Promise.resolve({ data: { status: "success", data: workerInput } });
        }
        if (url.endsWith("/worker-claim")) {
          return Promise.resolve({
            data: {
              status: "success",
              data: {
                runId,
                status: "RUNNING",
                lease: { expiresAt: "2026-07-20T12:00:00.000Z" },
              },
              meta: { acquired: true, replayed: false },
            },
          });
        }
        return Promise.resolve({ data: { status: "success" } });
      });
    const getIdTokenClient = vi.fn().mockResolvedValue({ request });
    const client = createSourceDiscoveryBackendClient({
      backendUrl: "https://silto-gfsi-be.internal.example",
      audience: "https://silto-gfsi-be.internal.example",
      auth: { getIdTokenClient },
    });

    await expect(
      client.getInput({ kind: "DISCOVER_OFFICIAL_SOURCES", discoveryRunId: runId }),
    ).resolves.toMatchObject({
      workspaceId: null,
      authorityProfiles: [expect.objectContaining({ queryTemplate: "etichettatura {topics}" })],
    });
    await expect(
      client.claim({
        discoveryRunId: runId,
        kind: "DISCOVER_OFFICIAL_SOURCES",
        workerInvocationId: invocationId,
      }),
    ).resolves.toEqual({ acquired: true, replayed: false });
    await client.complete({
      discoveryRunId: runId,
      callback: {
        kind: "DISCOVER_OFFICIAL_SOURCES",
        workerInvocationId: invocationId,
        status: "COMPLETED",
        discoveryModel: SOURCE_DISCOVERY_RANKING_MODEL,
        discoveryPromptVersion: SOURCE_DISCOVERY_RANKING_PROMPT_VERSION,
        discoveryResponseSchemaHash: SOURCE_DISCOVERY_RANKING_SCHEMA_HASH,
        proposals: [],
        diagnostics: { profilesConsulted: [profileId], skippedProfiles: [], skippedCandidates: [] },
      },
    });
    await client.fail({
      discoveryRunId: runId,
      callback: {
        kind: "DISCOVER_OFFICIAL_SOURCES",
        workerInvocationId: invocationId,
        status: "FAILED",
        failure: { code: "SEARCH_REQUEST_FAILED", retryable: true },
        diagnostics: { profilesConsulted: [profileId], skippedProfiles: [], skippedCandidates: [] },
      },
    });

    expect(getIdTokenClient).toHaveBeenCalledWith("https://silto-gfsi-be.internal.example");
    const inputRequest = request.mock.calls[0]?.[0];
    const claimRequest = request.mock.calls[1]?.[0];
    const completionRequest = request.mock.calls[2]?.[0];
    const failureRequest = request.mock.calls[3]?.[0];
    if (!inputRequest || !claimRequest || !completionRequest || !failureRequest) {
      throw new Error("Expected the discovery worker to issue input, claim, and terminal callbacks");
    }
    expect(inputRequest).toEqual({
      method: "GET",
      url: `https://silto-gfsi-be.internal.example/internal/label/source-discovery/${runId}/worker-input`,
    });
    expect(claimRequest).toEqual({
      method: "POST",
      url: `https://silto-gfsi-be.internal.example/internal/label/source-discovery/${runId}/worker-claim`,
      data: { kind: "DISCOVER_OFFICIAL_SOURCES", workerInvocationId: invocationId },
    });
    expect(completionRequest).toEqual({
      method: "POST",
      url: `https://silto-gfsi-be.internal.example/internal/label/source-discovery/${runId}/worker-callback`,
      data: {
        kind: "DISCOVER_OFFICIAL_SOURCES",
        workerInvocationId: invocationId,
        status: "COMPLETED",
        discoveryModel: SOURCE_DISCOVERY_RANKING_MODEL,
        discoveryPromptVersion: SOURCE_DISCOVERY_RANKING_PROMPT_VERSION,
        discoveryResponseSchemaHash: SOURCE_DISCOVERY_RANKING_SCHEMA_HASH,
        proposals: [],
        diagnostics: { profilesConsulted: [profileId], skippedProfiles: [], skippedCandidates: [] },
      },
    });
    expect(failureRequest).toEqual({
      method: "POST",
      url: `https://silto-gfsi-be.internal.example/internal/label/source-discovery/${runId}/worker-callback`,
      data: {
        kind: "DISCOVER_OFFICIAL_SOURCES",
        workerInvocationId: invocationId,
        status: "FAILED",
        failure: { code: "SEARCH_REQUEST_FAILED", retryable: true },
        diagnostics: { profilesConsulted: [profileId], skippedProfiles: [], skippedCandidates: [] },
      },
    });
  });

  it("uses the explicit local bearer without requesting a Google identity token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            runId,
            workspaceId: null,
            scope: {
              marketCountryCode: "IT",
              regulatoryAreas: ["EU"],
              productCategory: "generic-prepacked",
              evaluationDate: "2026-08-05",
              language: "it",
              templateVersion: "global-food-label-preliminary-v1@1",
              requiredTopics: ["ingredients"],
            },
            authorityProfiles: [],
            existingDeduplicationKeys: [],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const getIdTokenClient = vi.fn();
    const client = createSourceDiscoveryBackendClient({
      backendUrl: "http://127.0.0.1:8084",
      audience: "http://127.0.0.1:8084",
      localToken: "local-governance-token",
      auth: { getIdTokenClient },
    });

    await client.getInput({ kind: "DISCOVER_OFFICIAL_SOURCES", discoveryRunId: runId });

    expect(getIdTokenClient).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:8084/internal/label/source-discovery/${runId}/worker-input`,
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer local-governance-token",
        }),
      }),
    );
  });
});
