import { describe, expect, it } from "vitest";

import {
  ComplianceSourceEligibilityRequestSchema,
  ComplianceSourceSchema,
  ComplianceSourceTransitionEventSchema,
  ComplianceSourceVersionSchema,
} from "../../src/index.js";

const IDS = {
  source: "00000000-0000-4000-8000-000000000010",
  version: "00000000-0000-4000-8000-000000000011",
  previousVersion: "00000000-0000-4000-8000-000000000012",
  actor: "00000000-0000-4000-8000-000000000013",
  event: "00000000-0000-4000-8000-000000000014",
} as const;

const CONTENT_HASH = "a".repeat(64);
const CREATED_AT = "2026-01-01T00:00:00.000Z";

const SOURCE = {
  id: IDS.source,
  type: "STANDARD",
  domain: "Synthetic operations",
  jurisdiction: "Synthetic region",
  title: "Demonstration source",
  stableReference: "synthetic:source:operations:1",
  validationScope: "TECHNICAL_DEMO",
} as const;

const VERSION = {
  id: IDS.version,
  sourceId: IDS.source,
  revision: 1,
  versionLabel: "1.0",
  license: "Synthetic permissive fixture license",
  contentHash: CONTENT_HASH,
  validity: { validFrom: CREATED_AT, validTo: null },
  createdAt: CREATED_AT,
  createdBy: IDS.actor,
  replacesVersionId: null,
  replacementReason: null,
} as const;

function transition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: IDS.event,
    versionId: IDS.version,
    sequence: 1,
    from: null,
    to: "UPLOADED",
    actorId: IDS.actor,
    exercisedRole: "AUTHOR",
    at: CREATED_AT,
    contentHash: CONTENT_HASH,
    reason: null,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

describe("ComplianceSourceSchema", () => {
  it("accepts generic metadata and trims human-readable fields", () => {
    expect(ComplianceSourceSchema.parse({ ...SOURCE, domain: "  Synthetic operations  " })).toEqual(
      SOURCE,
    );
  });

  it.each([
    { id: "invalid" },
    { type: "UNSUPPORTED" },
    { domain: " " },
    { jurisdiction: " " },
    { title: "" },
    { stableReference: "" },
    { validationScope: "PROFESSIONAL" },
  ])("rejects invalid source metadata %#", (override) => {
    expect(ComplianceSourceSchema.safeParse({ ...SOURCE, ...override }).success).toBe(false);
  });

  it("rejects projection state and any other undeclared field", () => {
    expect(ComplianceSourceSchema.safeParse({ ...SOURCE, state: "APPROVED" }).success).toBe(false);
  });
});

describe("ComplianceSourceVersionSchema", () => {
  it("accepts an initial immutable version", () => {
    expect(ComplianceSourceVersionSchema.parse(VERSION)).toEqual(VERSION);
  });

  it("accepts a replacement linked to a distinct historical version", () => {
    const replacement = {
      ...VERSION,
      revision: 2,
      replacesVersionId: IDS.previousVersion,
      replacementReason: "Clarified synthetic wording",
    };

    expect(ComplianceSourceVersionSchema.parse(replacement)).toEqual(replacement);
  });

  it.each([
    { revision: 0 },
    { revision: 1.5 },
    { contentHash: "A".repeat(64) },
    { contentHash: "a".repeat(63) },
    { versionLabel: " " },
    { license: " " },
    { createdAt: "2026-01-01T01:00:00.000+01:00" },
    { validity: { validFrom: CREATED_AT, validTo: CREATED_AT } },
    { replacesVersionId: IDS.previousVersion, replacementReason: null },
    { replacesVersionId: null, replacementReason: "Missing prior version" },
    { replacesVersionId: IDS.version, replacementReason: "Self replacement" },
  ])("rejects an invalid version invariant %#", (override) => {
    expect(ComplianceSourceVersionSchema.safeParse({ ...VERSION, ...override }).success).toBe(
      false,
    );
  });

  it("rejects undeclared mutable state", () => {
    expect(ComplianceSourceVersionSchema.safeParse({ ...VERSION, state: "UPLOADED" }).success).toBe(
      false,
    );
  });
});

describe("ComplianceSourceTransitionEventSchema", () => {
  it.each([
    [{ sequence: 1, from: null, to: "UPLOADED", exercisedRole: "AUTHOR" }],
    [{ sequence: 2, from: "UPLOADED", to: "REVIEWED", exercisedRole: "REVIEWER" }],
    [{ sequence: 3, from: "REVIEWED", to: "APPROVED", exercisedRole: "APPROVER" }],
    [
      {
        sequence: 4,
        from: "APPROVED",
        to: "RETIRED",
        exercisedRole: "APPROVER",
        reason: "Superseded by a synthetic revision",
      },
    ],
  ])("accepts a valid append-only transition %#", (override) => {
    expect(ComplianceSourceTransitionEventSchema.safeParse(transition(override)).success).toBe(
      true,
    );
  });

  it.each([
    { sequence: 2, from: null, to: "UPLOADED", exercisedRole: "AUTHOR" },
    { sequence: 1, from: "UPLOADED", to: "REVIEWED", exercisedRole: "REVIEWER" },
    { sequence: 1, from: null, to: "APPROVED", exercisedRole: "APPROVER" },
    { sequence: 2, from: "UPLOADED", to: "APPROVED", exercisedRole: "APPROVER" },
    { sequence: 2, from: "UPLOADED", to: "REVIEWED", exercisedRole: "AUTHOR" },
    { sequence: 4, from: "APPROVED", to: "RETIRED", exercisedRole: "APPROVER" },
    {
      sequence: 4,
      from: "APPROVED",
      to: "RETIRED",
      exercisedRole: "APPROVER",
      reason: " ",
    },
    { contentHash: "not-a-digest" },
    { at: "2026-01-01T00:00:00.000+00:00" },
  ])("rejects an invalid transition invariant %#", (override) => {
    expect(ComplianceSourceTransitionEventSchema.safeParse(transition(override)).success).toBe(
      false,
    );
  });

  it("rejects undeclared event fields", () => {
    expect(
      ComplianceSourceTransitionEventSchema.safeParse(transition({ mutable: true })).success,
    ).toBe(false);
  });
});

describe("ComplianceSourceEligibilityRequestSchema", () => {
  const request = {
    versionId: IDS.version,
    activationAt: CREATED_AT,
    evaluationDate: CREATED_AT,
    expectedContentHash: CONTENT_HASH,
  } as const;

  it("accepts a hash-pinned request with separate activation and evaluation instants", () => {
    expect(ComplianceSourceEligibilityRequestSchema.parse(request)).toEqual(request);
  });

  it.each([
    { activationAt: "not-a-date" },
    { evaluationDate: "2026-01-01T01:00:00.000+01:00" },
    { expectedContentHash: "not-a-digest" },
    { versionId: "not-a-uuid" },
    { unexpected: true },
  ])("rejects an invalid eligibility request %#", (override) => {
    expect(
      ComplianceSourceEligibilityRequestSchema.safeParse({ ...request, ...override }).success,
    ).toBe(false);
  });
});
