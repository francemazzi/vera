import { describe, expect, it, vi } from "vitest";

import {
  OfficialAuthorityProfileSchema,
  SourceDiscoveryScopeSchema,
  SourceDiscoveryWorkerInputSchema,
} from "../../src/source-discovery-contracts.js";
import {
  assertOfficialAuthorityUrl,
  buildOfficialAuthoritySearchRequest,
  parseOfficialAuthoritySearchResponse,
  profileAppliesToScope,
} from "../../src/official-authority-profile.js";
import { createOfficialAuthoritySearchTool } from "../../src/official-authority-search-tool.js";

const profile = OfficialAuthorityProfileSchema.parse({
  id: "00000000-0000-4000-8000-000000000601",
  jurisdictionCode: "IT",
  authorityName: "Synthetic Italian Official Gazette",
  allowedHosts: ["official.example.gov"],
  searchEndpoint: "https://official.example.gov/search",
  searchMode: "OFFICIAL_SEARCH_HTML",
  resultLimit: 5,
  languages: ["it"],
  active: true,
});

const scope = SourceDiscoveryScopeSchema.parse({
  marketCountryCode: "IT",
  regulatoryAreas: ["EU"],
  productCategory: "Prepacked food",
  evaluationDate: "2026-07-20",
  language: "it",
  templateVersion: "food-label-v1",
  requiredTopics: ["ingredients", "allergens"],
});

describe("configured official-authority discovery tool", () => {
  it("accepts the Antarctic territory regulatory area without weakening the ISO country boundary", () => {
    expect(
      SourceDiscoveryScopeSchema.parse({
        ...scope,
        marketCountryCode: "AQ",
        regulatoryAreas: ["ANTARCTICA"],
      }),
    ).toMatchObject({
      marketCountryCode: "AQ",
      regulatoryAreas: ["ANTARCTICA"],
    });
  });

  it("builds a bounded official search request and keeps dynamic terms in a query parameter", () => {
    const request = buildOfficialAuthoritySearchRequest({ profile, scope });

    expect(request.url.toString()).toContain("official.example.gov/search?");
    expect(request.url.searchParams.get("q")).toBe("Prepacked food ingredients allergens");
    expect(request.headers["Accept"]).toContain("text/html");
  });

  it("uses only supported static profile placeholders to localize a configured official query", () => {
    const configured = OfficialAuthorityProfileSchema.parse({
      ...profile,
      queryTemplate: "etichettatura {productCategory} {topics} {language}",
    });

    const request = buildOfficialAuthoritySearchRequest({ profile: configured, scope });

    expect(request.url.searchParams.get("q")).toBe(
      "etichettatura Prepacked food ingredients allergens it",
    );
    expect(() =>
      OfficialAuthorityProfileSchema.parse({ ...profile, queryTemplate: "{untrusted}" }),
    ).toThrow("placeholders");
  });

  it("accepts the backend's nullable workspace scope without using it for discovery", () => {
    expect(
      SourceDiscoveryWorkerInputSchema.parse({
        runId: "00000000-0000-4000-8000-000000000604",
        workspaceId: null,
        scope,
        authorityProfiles: [profile],
        existingDeduplicationKeys: [],
      }),
    ).toMatchObject({ workspaceId: null });
  });

  it("never accepts an endpoint or source URL outside the configured authority host", () => {
    expect(() =>
      assertOfficialAuthorityUrl("https://search.example.test/?q=food", profile),
    ).toThrow("outside the configured profile");
    expect(() =>
      assertOfficialAuthorityUrl("https://official.example.gov/act.pdf#page=1", profile),
    ).toThrow("outside the configured profile");
    expect(() =>
      OfficialAuthorityProfileSchema.parse({ ...profile, allowedHosts: ["127.0.0.1"] }),
    ).toThrow("IP address");
  });

  it("returns only allowlisted result links from official HTML, never a third-party link", () => {
    const request = buildOfficialAuthoritySearchRequest({ profile, scope });
    const candidates = parseOfficialAuthoritySearchResponse({
      profile,
      request,
      body: [
        '<a href="/acts/food-label.pdf">Food label regulation</a>',
        '<a href="https://evil.example.test/other.pdf">Ignore this</a>',
      ].join("\n"),
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        sourceUrl: "https://official.example.gov/acts/food-label.pdf",
        sourceTitle: "Food label regulation",
      }),
    ]);
  });

  it("can narrow document links below the configured authority search hosts", () => {
    const narrowed = OfficialAuthorityProfileSchema.parse({
      ...profile,
      allowedHosts: ["official.example.gov", "documents.example.gov"],
      resultUrlAllowlist: ["documents.example.gov"],
    });
    const request = buildOfficialAuthoritySearchRequest({ profile: narrowed, scope });
    const candidates = parseOfficialAuthoritySearchResponse({
      profile: narrowed,
      request,
      body: [
        '<a href="https://official.example.gov/act/123">Search-page link is not a document</a>',
        '<a href="https://documents.example.gov/act/123.pdf">Official document</a>',
      ].join("\n"),
    });

    expect(candidates).toEqual([
      expect.objectContaining({ sourceUrl: "https://documents.example.gov/act/123.pdf" }),
    ]);
    expect(() =>
      OfficialAuthorityProfileSchema.parse({
        ...profile,
        resultUrlAllowlist: ["unrelated.example.test"],
      }),
    ).toThrow("resultUrlAllowlist must narrow allowedHosts");
  });

  it("uses redirect:error and a closed configured endpoint, not a generic web-search tool", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response('<a href="/acts/food-label.pdf">Food label regulation</a>', {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    const tool = createOfficialAuthoritySearchTool({ fetch });

    await expect(tool.search({ profile, scope })).resolves.toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "official.example.gov" }),
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("keeps a temporary official-portal error retryable even when its error page has another MIME type", async () => {
    const tool = createOfficialAuthoritySearchTool({
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response("temporary outage", {
          status: 503,
          headers: { "content-type": "text/html" },
        }),
      ),
    });

    await expect(
      tool.search({ profile: { ...profile, searchMode: "OFFICIAL_SEARCH_JSON" }, scope }),
    ).rejects.toMatchObject({ code: "SEARCH_REQUEST_FAILED", retryable: true });
  });

  it("applies country profiles only to the selected country and adds EU only when selected", () => {
    const eu = OfficialAuthorityProfileSchema.parse({
      ...profile,
      id: "00000000-0000-4000-8000-000000000602",
      jurisdictionCode: "EU",
      authorityName: "EUR-Lex",
    });
    const romanian = OfficialAuthorityProfileSchema.parse({
      ...profile,
      id: "00000000-0000-4000-8000-000000000603",
      jurisdictionCode: "RO",
    });

    expect(profileAppliesToScope(profile, scope)).toBe(true);
    expect(profileAppliesToScope(eu, scope)).toBe(true);
    expect(profileAppliesToScope(romanian, scope)).toBe(false);
    expect(profileAppliesToScope(eu, { ...scope, regulatoryAreas: ["EUROPE_NON_EU"] })).toBe(false);
  });

  it("fails closed when a country profile does not serve the requested language", () => {
    const romanianLanguageOnly = OfficialAuthorityProfileSchema.parse({
      ...profile,
      languages: ["ro"],
    });

    expect(profileAppliesToScope(romanianLanguageOnly, scope)).toBe(false);
    expect(profileAppliesToScope(profile, { ...scope, language: "it-IT" })).toBe(true);
    expect(() => OfficialAuthorityProfileSchema.parse({ ...profile, languages: [] })).toThrow();
  });
});
