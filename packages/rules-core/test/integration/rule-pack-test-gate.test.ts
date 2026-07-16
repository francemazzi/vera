import { describe, expect, it } from "vitest";

import type { RulePackReadinessGate } from "../../src/index.js";
import { InMemoryRulePackRepository, RulePackEligibilityError } from "../../src/index.js";
import {
  RULE_PACK_ACTORS,
  RULE_PACK_IDS,
  RULE_PACK_TIMES,
  makeDraft,
  makeEligibilityReader,
} from "../fixtures/rule-pack.js";

describe("Rule Pack test gate integration", () => {
  it("blocks publication when the injected synthetic test gate fails", () => {
    const eligibility = makeEligibilityReader();
    const gate: RulePackReadinessGate = {
      assertRulePackReady() {
        throw new Error("synthetic gate failure");
      },
    };
    const repository = new InMemoryRulePackRepository(eligibility.reader, gate);
    repository.addDraft(makeDraft(), RULE_PACK_ACTORS.author);

    expect(() =>
      repository.publishDraft(
        {
          draftId: RULE_PACK_IDS.draft1,
          versionId: RULE_PACK_IDS.version1,
          publishedAt: RULE_PACK_TIMES.published1,
          expectedDraftRevision: 1,
        },
        RULE_PACK_ACTORS.publisher,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "RULE_PACK_TEST_GATE_FAILED",
        name: "RulePackEligibilityError",
      }),
    );
  });

  it("rechecks the same gate before activation eligibility", () => {
    const eligibility = makeEligibilityReader();
    const gate: RulePackReadinessGate = {
      assertRulePackReady(_version, context) {
        if (context.purpose === "ACTIVATION") {
          throw new RulePackEligibilityError(
            "RULE_PACK_TEST_GATE_FAILED",
            "Synthetic activation gate failed",
          );
        }
      },
    };
    const repository = new InMemoryRulePackRepository(eligibility.reader, gate);
    repository.addDraft(makeDraft(), RULE_PACK_ACTORS.author);
    const version = repository.publishDraft(
      {
        draftId: RULE_PACK_IDS.draft1,
        versionId: RULE_PACK_IDS.version1,
        publishedAt: RULE_PACK_TIMES.published1,
        expectedDraftRevision: 1,
      },
      RULE_PACK_ACTORS.publisher,
    );

    expect(() =>
      repository.assertVersionEligibleForActivation(
        version.id,
        RULE_PACK_TIMES.packValidFrom,
        RULE_PACK_ACTORS.publisher.id,
      ),
    ).toThrow(expect.objectContaining({ code: "RULE_PACK_TEST_GATE_FAILED" }));
  });
});
