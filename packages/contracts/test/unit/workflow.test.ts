import { describe, expect, it } from "vitest";

import {
  canTransitionComplianceSource,
  canTransitionRuleCard,
  effectiveRisk,
} from "../../src/index.js";
import type { Actor } from "../../src/index.js";
import {
  canPerformComplianceSourceTransition,
  canPerformRuleCardTransition,
} from "../../src/workflow.js";
import type { WorkflowTransitionContext } from "../../src/workflow.js";

const ACTOR_IDS = {
  author: "00000000-0000-4000-8000-000000000001",
  reviewer: "00000000-0000-4000-8000-000000000002",
  approver: "00000000-0000-4000-8000-000000000003",
  admin: "00000000-0000-4000-8000-000000000004",
} as const;

function actor(role: Actor["role"]): Actor {
  const id = ACTOR_IDS[role.toLowerCase() as Lowercase<Actor["role"]>];

  return {
    id,
    displayName: `Synthetic ${role}`,
    role,
    validationScope: "TECHNICAL_DEMO",
  };
}

function context(
  role: Actor["role"],
  overrides: Partial<Omit<WorkflowTransitionContext, "actor">> = {},
): WorkflowTransitionContext {
  return {
    actor: actor(role),
    contributorIds: [],
    excludedActorIds: [],
    ...overrides,
  };
}

describe("compliance source workflow", () => {
  it.each([
    [null, "UPLOADED"],
    ["UPLOADED", "REVIEWED"],
    ["REVIEWED", "APPROVED"],
    ["APPROVED", "RETIRED"],
  ] as const)("allows %s to %s", (from, to) => {
    expect(canTransitionComplianceSource(from, to)).toBe(true);
  });

  it.each([
    [null, "APPROVED"],
    ["UPLOADED", "APPROVED"],
    ["REVIEWED", "UPLOADED"],
    ["RETIRED", "APPROVED"],
  ] as const)("rejects %s to %s", (from, to) => {
    expect(canTransitionComplianceSource(from, to)).toBe(false);
  });

  describe("authorization-aware guard", () => {
    it.each([
      [null, "UPLOADED", context("AUTHOR")],
      ["UPLOADED", "REVIEWED", context("REVIEWER")],
      ["REVIEWED", "APPROVED", context("APPROVER", { excludedActorIds: [ACTOR_IDS.reviewer] })],
      ["APPROVED", "RETIRED", context("APPROVER", { reason: "Superseded" })],
    ] as const)("allows an authorized %s to %s transition", (from, to, authorization) => {
      expect(canPerformComplianceSourceTransition(from, to, authorization)).toBe(true);
    });

    it.each([
      [null, "APPROVED", context("APPROVER")],
      [null, "UPLOADED", context("ADMIN")],
      ["UPLOADED", "REVIEWED", context("AUTHOR")],
      ["REVIEWED", "APPROVED", context("REVIEWER")],
      ["APPROVED", "RETIRED", context("ADMIN", { reason: "Requested" })],
    ] as const)("rejects unauthorized %s to %s transition", (from, to, authorization) => {
      expect(canPerformComplianceSourceTransition(from, to, authorization)).toBe(false);
    });

    it("rejects review or approval by a contributor", () => {
      expect(
        canPerformComplianceSourceTransition(
          "UPLOADED",
          "REVIEWED",
          context("REVIEWER", { contributorIds: [ACTOR_IDS.reviewer] }),
        ),
      ).toBe(false);
      expect(
        canPerformComplianceSourceTransition(
          "REVIEWED",
          "APPROVED",
          context("APPROVER", { contributorIds: [ACTOR_IDS.approver] }),
        ),
      ).toBe(false);
    });

    it("treats mixed-case UUID spellings as the same source contributor", () => {
      const mixedCaseId = "00000000-0000-4000-8000-00000000aBcD";
      expect(
        canPerformComplianceSourceTransition(
          "UPLOADED",
          "REVIEWED",
          context("REVIEWER", { contributorIds: [mixedCaseId.toLowerCase()] }),
        ),
      ).toBe(true);

      expect(
        canPerformComplianceSourceTransition("UPLOADED", "REVIEWED", {
          ...context("REVIEWER", { contributorIds: [mixedCaseId.toLowerCase()] }),
          actor: { ...actor("REVIEWER"), id: mixedCaseId.toUpperCase() },
        }),
      ).toBe(false);
    });

    it("rejects an approver excluded by separation of duties", () => {
      expect(
        canPerformComplianceSourceTransition(
          "REVIEWED",
          "APPROVED",
          context("APPROVER", { excludedActorIds: [ACTOR_IDS.approver] }),
        ),
      ).toBe(false);
    });

    it.each([undefined, "", "   "])("rejects retirement without a reason (%s)", (reason) => {
      expect(
        canPerformComplianceSourceTransition(
          "APPROVED",
          "RETIRED",
          context("APPROVER", reason === undefined ? {} : { reason }),
        ),
      ).toBe(false);
    });
  });
});

describe("rule card revision workflow", () => {
  it.each([
    [null, "DRAFT"],
    ["DRAFT", "IN_REVIEW"],
    ["IN_REVIEW", "APPROVED"],
    ["IN_REVIEW", "CHANGES_REQUESTED"],
    ["APPROVED", "RETIRED"],
  ] as const)("allows %s to %s", (from, to) => {
    expect(canTransitionRuleCard(from, to)).toBe(true);
  });

  it.each([
    [null, "APPROVED"],
    ["DRAFT", "APPROVED"],
    ["CHANGES_REQUESTED", "DRAFT"],
    ["RETIRED", "IN_REVIEW"],
  ] as const)("rejects %s to %s", (from, to) => {
    expect(canTransitionRuleCard(from, to)).toBe(false);
  });

  describe("authorization-aware guard", () => {
    it.each([
      [null, "DRAFT", context("AUTHOR")],
      ["DRAFT", "IN_REVIEW", context("AUTHOR")],
      ["IN_REVIEW", "CHANGES_REQUESTED", context("REVIEWER")],
      ["IN_REVIEW", "APPROVED", context("APPROVER", { excludedActorIds: [ACTOR_IDS.reviewer] })],
      ["APPROVED", "RETIRED", context("APPROVER", { reason: "Rule replaced" })],
    ] as const)("allows an authorized %s to %s transition", (from, to, authorization) => {
      expect(canPerformRuleCardTransition(from, to, authorization)).toBe(true);
    });

    it.each([
      [null, "APPROVED", context("APPROVER")],
      [null, "DRAFT", context("ADMIN")],
      ["DRAFT", "IN_REVIEW", context("REVIEWER")],
      ["IN_REVIEW", "CHANGES_REQUESTED", context("AUTHOR")],
      ["IN_REVIEW", "APPROVED", context("REVIEWER")],
      ["APPROVED", "RETIRED", context("ADMIN", { reason: "Requested" })],
    ] as const)("rejects unauthorized %s to %s transition", (from, to, authorization) => {
      expect(canPerformRuleCardTransition(from, to, authorization)).toBe(false);
    });

    it("rejects review decisions or approval by a contributor", () => {
      expect(
        canPerformRuleCardTransition(
          "IN_REVIEW",
          "CHANGES_REQUESTED",
          context("REVIEWER", { contributorIds: [ACTOR_IDS.reviewer] }),
        ),
      ).toBe(false);
      expect(
        canPerformRuleCardTransition(
          "IN_REVIEW",
          "APPROVED",
          context("APPROVER", { contributorIds: [ACTOR_IDS.approver] }),
        ),
      ).toBe(false);
    });

    it("treats mixed-case UUID spellings as the same Rule Card decision maker", () => {
      const mixedCaseId = "00000000-0000-4000-8000-00000000aBcD";
      expect(
        canPerformRuleCardTransition("IN_REVIEW", "CHANGES_REQUESTED", {
          ...context("REVIEWER", { contributorIds: [mixedCaseId.toLowerCase()] }),
          actor: { ...actor("REVIEWER"), id: mixedCaseId.toUpperCase() },
        }),
      ).toBe(false);
    });

    it("rejects an approver excluded by separation of duties", () => {
      expect(
        canPerformRuleCardTransition(
          "IN_REVIEW",
          "APPROVED",
          context("APPROVER", { excludedActorIds: [ACTOR_IDS.approver] }),
        ),
      ).toBe(false);
    });

    it.each([undefined, "", "  "])("rejects retirement without a reason (%s)", (reason) => {
      expect(
        canPerformRuleCardTransition(
          "APPROVED",
          "RETIRED",
          context("APPROVER", reason === undefined ? {} : { reason }),
        ),
      ).toBe(false);
    });
  });
});

describe("effectiveRisk", () => {
  it("selects the highest intrinsic or error-cost level", () => {
    expect(effectiveRisk(["LOW", "CRITICAL", "MEDIUM"])).toBe("CRITICAL");
    expect(effectiveRisk(["HIGH", "LOW", "MEDIUM"])).toBe("HIGH");
    expect(effectiveRisk(["LOW"])).toBe("LOW");
  });
});
