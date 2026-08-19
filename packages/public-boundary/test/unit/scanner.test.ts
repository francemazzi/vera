import { describe, expect, it } from "vitest";

import { hashToken, scanContents, type BoundaryConfig } from "../../src/index.js";

const config: BoundaryConfig = {
  forbiddenTokenHashes: [hashToken("restrictedword")],
  forbiddenPathSegments: ["private-area"],
  allowPaths: ["allowed/private-area.md"],
};

describe("scanContents", () => {
  it("finds normalized forbidden tokens without disclosing the token", () => {
    const findings = scanContents(
      [{ path: "notes.md", content: "ok\nRestrictedWord here" }],
      config,
    );
    expect(findings).toEqual([
      expect.objectContaining({
        kind: "FORBIDDEN_TOKEN",
        path: "notes.md",
        line: 2,
        column: 1,
      }),
    ]);
    expect(JSON.stringify(findings)).not.toContain("RestrictedWord");
  });

  it("finds private paths and honors exact allow paths", () => {
    const findings = scanContents(
      [
        { path: "private-area/input.txt", content: "safe" },
        { path: "allowed/private-area.md", content: "safe" },
      ],
      config,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("PRIVATE_PATH");
  });

  it("skips forbidden-token findings on exact allow paths", () => {
    const findings = scanContents(
      [
        { path: "allowed/private-area.md", content: "documents RestrictedWord for operators" },
        { path: "notes.md", content: "RestrictedWord remains blocked" },
      ],
      config,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "FORBIDDEN_TOKEN",
      path: "notes.md",
    });
  });

  it("reports secret patterns without returning the value", () => {
    const value = `AKIA${"A".repeat(16)}`;
    const findings = scanContents([{ path: "config.txt", content: value }], config);
    expect(findings[0]).toMatchObject({
      kind: "POTENTIAL_SECRET",
      ruleId: "secret:aws-access-key",
    });
    expect(JSON.stringify(findings)).not.toContain(value);
  });

  it("returns findings in deterministic path order", () => {
    const targets = [
      { path: "z.md", content: "restrictedword", origin: "index" },
      { path: "a.md", content: "restrictedword" },
    ];
    expect(scanContents(targets, config).map((finding) => finding.path)).toEqual(["a.md", "z.md"]);
  });
});
