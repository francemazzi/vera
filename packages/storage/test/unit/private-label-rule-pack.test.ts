import { describe, expect, it } from "vitest";

import {
  PRIVATE_LABEL_FIELD_CODES,
  PrivateLabelRulePackSnapshotSchema,
  computePrivateLabelSourceSnapshotHash,
  privateLabelSourceBindings,
  resolvePrivateLabelRulePack,
} from "../../src/index.js";
import type { PrivateLabelFieldCode, PrivateLabelRulePackSnapshot } from "../../src/index.js";

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function rule(
  fieldCode: PrivateLabelFieldCode,
  source = 1,
): PrivateLabelRulePackSnapshot["baseline"][number] {
  return {
    fieldCode,
    source: {
      sourceVersionId: uuid(source),
      sourceContentHash: source.toString(16).padStart(64, "0"),
      citation: `Synthetic citation for ${fieldCode}`,
    },
    ruleVersion: "synthetic-v1",
  };
}

function snapshot(): PrivateLabelRulePackSnapshot {
  return {
    schemaVersion: "silto-label-rule-pack/v1" as const,
    baseline: PRIVATE_LABEL_FIELD_CODES.filter(
      (fieldCode) => fieldCode !== "etichettatura_specifica_prodotto",
    ).map((fieldCode) => rule(fieldCode)),
    countryOverlays: [
      {
        countryCode: "IT" as const,
        controls: [rule("indicazioni_ambientali", 2)],
      },
    ],
    categoryExtensions: [
      {
        categoryCode: "wine",
        controls: [rule("etichettatura_specifica_prodotto", 3)],
      },
    ],
  };
}

describe("private Label rule-pack snapshot", () => {
  it("binds all baseline controls to hash-pinned sources and resolves only selected overlays", () => {
    const value = PrivateLabelRulePackSnapshotSchema.parse(snapshot());
    const resolved = resolvePrivateLabelRulePack(value, {
      countryCodes: ["IT", "FR"],
      categoryCode: "wine",
    });

    expect(resolved).toHaveLength(PRIVATE_LABEL_FIELD_CODES.length);
    expect(resolved.find(({ fieldCode }) => fieldCode === "indicazioni_ambientali")).toMatchObject({
      applicable: true,
      countryOverlays: [{ countryCode: "IT" }],
    });
    expect(
      resolved.find(({ fieldCode }) => fieldCode === "etichettatura_specifica_prodotto"),
    ).toMatchObject({
      applicable: true,
      categoryExtension: { fieldCode: "etichettatura_specifica_prodotto" },
    });
    expect(privateLabelSourceBindings(value)).toHaveLength(3);
    expect(computePrivateLabelSourceSnapshotHash(value)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("keeps the category-specific field explicitly not applicable without an approved extension", () => {
    const resolved = resolvePrivateLabelRulePack(
      PrivateLabelRulePackSnapshotSchema.parse(snapshot()),
      {
        countryCodes: ["IT"],
        categoryCode: "pasta",
      },
    );

    expect(
      resolved.find(({ fieldCode }) => fieldCode === "etichettatura_specifica_prodotto"),
    ).toEqual({
      fieldCode: "etichettatura_specifica_prodotto",
      applicable: false,
      baseline: null,
      countryOverlays: [],
      categoryExtension: null,
    });
  });

  it("uses the same EU Greece code as the public Label API", () => {
    expect(() =>
      PrivateLabelRulePackSnapshotSchema.parse({
        ...snapshot(),
        countryOverlays: [{ countryCode: "EL", controls: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrivateLabelRulePackSnapshotSchema.parse({
        ...snapshot(),
        countryOverlays: [{ countryCode: "GR", controls: [] }],
      }),
    ).toThrow();
  });
});
