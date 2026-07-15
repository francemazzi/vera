import type {
  Actor,
  ComplianceSource,
  ComplianceSourceTransitionEvent,
  ComplianceSourceVersion,
} from "@vera/contracts";

export const IDS = {
  sourceA: "00000000-0000-4000-8000-000000000101",
  sourceB: "00000000-0000-4000-8000-000000000102",
  versionA1: "00000000-0000-4000-8000-000000000201",
  versionA2: "00000000-0000-4000-8000-000000000202",
  versionA3: "00000000-0000-4000-8000-000000000203",
  versionB1: "00000000-0000-4000-8000-000000000204",
  author: "00000000-0000-4000-8000-000000000301",
  reviewer: "00000000-0000-4000-8000-000000000302",
  approver: "00000000-0000-4000-8000-000000000303",
  secondApprover: "00000000-0000-4000-8000-000000000304",
  event1: "00000000-0000-4000-8000-000000000401",
  event2: "00000000-0000-4000-8000-000000000402",
  event3: "00000000-0000-4000-8000-000000000403",
  event4: "00000000-0000-4000-8000-000000000404",
  event5: "00000000-0000-4000-8000-000000000405",
} as const;

export const HASHES = {
  a1: "a".repeat(64),
  a2: "b".repeat(64),
  a3: "c".repeat(64),
  other: "d".repeat(64),
} as const;

export const TIMES = {
  created: "2026-01-01T00:00:00.000Z",
  uploaded: "2026-01-01T01:00:00.000Z",
  reviewed: "2026-01-01T02:00:00.000Z",
  approved: "2026-01-01T03:00:00.000Z",
  retired: "2026-06-01T00:00:00.000Z",
  beforeValidity: "2025-12-31T23:59:59.999Z",
  validFrom: "2026-01-01T00:00:00.000Z",
  insideValidity: "2026-06-30T00:00:00.000Z",
  validTo: "2027-01-01T00:00:00.000Z",
} as const;

function actor(id: string, role: Actor["role"]): Actor {
  return {
    id,
    displayName: `Synthetic ${role}`,
    role,
    validationScope: "TECHNICAL_DEMO",
  };
}

export const ACTORS = {
  author: actor(IDS.author, "AUTHOR"),
  reviewer: actor(IDS.reviewer, "REVIEWER"),
  approver: actor(IDS.approver, "APPROVER"),
  secondApprover: actor(IDS.secondApprover, "APPROVER"),
} as const;

export function makeSource(overrides: Partial<ComplianceSource> = {}): ComplianceSource {
  return {
    id: IDS.sourceA,
    type: "STANDARD",
    domain: "synthetic-quality",
    jurisdiction: "GLOBAL-DEMO",
    title: "Synthetic Quality Reference",
    stableReference: "urn:vera:synthetic:source:quality-reference",
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

export function makeVersion(
  overrides: Partial<ComplianceSourceVersion> = {},
): ComplianceSourceVersion {
  return {
    id: IDS.versionA1,
    sourceId: IDS.sourceA,
    revision: 1,
    versionLabel: "synthetic-v1",
    license: "CC0-1.0",
    contentHash: HASHES.a1,
    validity: {
      validFrom: TIMES.validFrom,
      validTo: TIMES.validTo,
    },
    createdAt: TIMES.created,
    createdBy: IDS.author,
    replacesVersionId: null,
    replacementReason: null,
    ...overrides,
  };
}

export function makeEvent(
  overrides: Partial<ComplianceSourceTransitionEvent> = {},
): ComplianceSourceTransitionEvent {
  return {
    id: IDS.event1,
    versionId: IDS.versionA1,
    sequence: 1,
    from: null,
    to: "UPLOADED",
    actorId: IDS.author,
    exercisedRole: "AUTHOR",
    at: TIMES.uploaded,
    reason: null,
    contentHash: HASHES.a1,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}
