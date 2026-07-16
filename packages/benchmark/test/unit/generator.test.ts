import { describe, expect, it } from "vitest";

import { sha256CanonicalJson } from "@vera/contracts";

import { SyntheticBenchmarkCorpusSchema, generateSyntheticCorpus } from "../../src/index.js";

describe("synthetic benchmark corpus generator", () => {
  it("generates deterministic balanced cases with a frozen seed-42 split", () => {
    const first = generateSyntheticCorpus();
    const replay = generateSyntheticCorpus();

    expect(first).toEqual(replay);
    expect(first.cases).toHaveLength(20);
    expect(first.corpusHash).toBe(
      sha256CanonicalJson({
        schemaVersion: first.schemaVersion,
        seed: first.seed,
        cases: first.cases,
        validationScope: first.validationScope,
      }),
    );
    expect(first.cases.filter(({ split }) => split === "development")).toHaveLength(12);
    expect(first.cases.filter(({ split }) => split === "calibration")).toHaveLength(4);
    expect(first.cases.filter(({ split }) => split === "blind")).toHaveLength(4);

    for (const outcome of ["PASS", "FAIL", "REVIEW", "NOT_APPLICABLE"] as const) {
      expect(first.cases.filter(({ expectedOutcome }) => expectedOutcome === outcome)).toHaveLength(
        5,
      );
    }
    for (const item of first.cases) {
      expect(item.documents.map(({ kind }) => kind).sort()).toEqual(["IMAGE", "JSON", "PDF"]);
      expect(item.documents.every(({ sha256 }) => /^[0-9a-f]{64}$/u.test(sha256))).toBe(true);
    }
  });

  it("rejects tampered corpus hashes", () => {
    const corpus = generateSyntheticCorpus();

    expect(() =>
      SyntheticBenchmarkCorpusSchema.parse({ ...corpus, corpusHash: "0".repeat(64) }),
    ).toThrow(/corpusHash/u);
  });
});
