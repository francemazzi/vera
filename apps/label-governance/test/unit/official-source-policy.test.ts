import { describe, expect, it } from "vitest";

import {
  DEFAULT_OFFICIAL_SOURCE_HOSTS,
  isOfficialSourceUrl,
  parseOfficialSourceHosts,
} from "../../src/official-source-policy.js";

describe("official source host policy", () => {
  it("treats an empty Cloud Run extension variable as an omitted allowlist", () => {
    expect(parseOfficialSourceHosts("")).toEqual(DEFAULT_OFFICIAL_SOURCE_HOSTS);
    expect(parseOfficialSourceHosts(" , ")).toEqual(DEFAULT_OFFICIAL_SOURCE_HOSTS);
  });

  it("permits the curated Romanian legislative portal only over its canonical HTTPS host", () => {
    const hosts = parseOfficialSourceHosts(undefined);
    expect(
      isOfficialSourceUrl("https://legislatie.just.ro/Public/DetaliiDocument/261454", hosts),
    ).toBe(true);
    expect(
      isOfficialSourceUrl("https://evil.legislatie.just.ro/Public/DetaliiDocument/261454", hosts),
    ).toBe(false);
  });
});
