import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { BoundaryConfig } from "../../src/index.js";

describe("boundary rules contract", () => {
  it("contains unique SHA-256 hashes and normalized path rules", () => {
    const config = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../../../public-boundary.rules.json"), "utf8"),
    ) as BoundaryConfig;

    expect(config.forbiddenTokenHashes.length).toBeGreaterThan(0);
    expect(new Set(config.forbiddenTokenHashes).size).toBe(config.forbiddenTokenHashes.length);
    expect(config.forbiddenTokenHashes.every((hash) => /^[a-f0-9]{64}$/.test(hash))).toBe(true);
    expect(config.forbiddenPathSegments.every((path) => !path.startsWith("/"))).toBe(true);
  });
});
