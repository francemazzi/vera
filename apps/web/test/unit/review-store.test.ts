// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  OptimisticConcurrencyError,
  canExport,
  canRoleReview,
  readReviewQueue,
  requiresCriticalRationale,
  resetReviewQueue,
  saveReviewDecision,
  simulateConcurrentChange,
} from "../../src/index.js";

describe("review-store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetReviewQueue();
  });

  it("persists review decisions and blocks export until all items are reviewed", () => {
    const initial = readReviewQueue();
    const first = initial[0];
    if (first === undefined) throw new Error("missing first review item");
    expect(canExport(initial)).toBe(false);

    const updated = saveReviewDecision({
      itemId: first.id,
      expectedVersion: first.version,
      decisionType: "CONFIRM",
      rationale: "",
      role: "REVIEWER",
      now: "2026-07-15T18:40:00.000Z",
    });

    expect(updated[0]?.status).toBe("REVIEWED");
    expect(readReviewQueue()[0]?.decision?.decidedByRole).toBe("REVIEWER");
    expect(canExport(readReviewQueue())).toBe(false);
  });

  it("requires rationale for critical overrides", () => {
    const critical = readReviewQueue()[0];
    if (critical === undefined) throw new Error("missing critical review item");
    expect(requiresCriticalRationale(critical, "NOT_APPLICABLE")).toBe(true);

    expect(() =>
      saveReviewDecision({
        itemId: critical.id,
        expectedVersion: critical.version,
        decisionType: "NOT_APPLICABLE",
        rationale: "",
        role: "APPROVER",
        now: "2026-07-15T18:40:00.000Z",
      }),
    ).toThrow("Motivazione obbligatoria");
  });

  it("rejects stale optimistic concurrency versions", () => {
    const first = readReviewQueue()[0];
    if (first === undefined) throw new Error("missing first review item");
    simulateConcurrentChange(first.id);

    expect(() =>
      saveReviewDecision({
        itemId: first.id,
        expectedVersion: first.version,
        decisionType: "CONFIRM",
        rationale: "",
        role: "REVIEWER",
        now: "2026-07-15T18:40:00.000Z",
      }),
    ).toThrow(OptimisticConcurrencyError);
  });

  it("keeps AUTHOR read-only", () => {
    expect(canRoleReview("AUTHOR")).toBe(false);
    expect(canRoleReview("REVIEWER")).toBe(true);
  });
});
