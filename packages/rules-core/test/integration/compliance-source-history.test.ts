import { describe, expect, it } from "vitest";

import { InMemoryComplianceSourceRepository } from "../../src/index.js";
import {
  ACTORS,
  HASHES,
  IDS,
  TIMES,
  makeEvent,
  makeSource,
  makeVersion,
} from "../fixtures/compliance-source.js";

describe("compliance source history reconstruction", () => {
  it("reconstructs immutable revisions, state, actors, and replacement lineage", () => {
    const repository = new InMemoryComplianceSourceRepository();
    repository.addSource(makeSource());
    repository.appendVersion(makeVersion(), 0);
    repository.appendTransition(
      makeEvent(),
      { actor: ACTORS.author },
      { sequence: 0, state: null },
    );
    repository.appendTransition(
      makeEvent({
        id: IDS.event2,
        sequence: 2,
        from: "UPLOADED",
        to: "REVIEWED",
        actorId: IDS.reviewer,
        exercisedRole: "REVIEWER",
        at: TIMES.reviewed,
      }),
      { actor: ACTORS.reviewer },
      { sequence: 1, state: "UPLOADED" },
    );
    repository.appendTransition(
      makeEvent({
        id: IDS.event3,
        sequence: 3,
        from: "REVIEWED",
        to: "APPROVED",
        actorId: IDS.approver,
        exercisedRole: "APPROVER",
        at: TIMES.approved,
      }),
      { actor: ACTORS.approver },
      { sequence: 2, state: "REVIEWED" },
    );

    repository.appendVersion(
      makeVersion({
        id: IDS.versionA2,
        revision: 2,
        versionLabel: "synthetic-v2",
        contentHash: HASHES.a2,
        createdAt: TIMES.retired,
        replacesVersionId: IDS.versionA1,
        replacementReason: "Synthetic clarification",
      }),
      1,
    );

    const history = repository.getSourceHistory(IDS.sourceA);
    expect(history.source.stableReference).toBe("urn:vera:synthetic:source:quality-reference");
    expect(history.versions).toHaveLength(2);
    const firstVersion = history.versions.at(0);
    const secondVersion = history.versions.at(1);
    if (firstVersion === undefined || secondVersion === undefined) {
      throw new Error("Expected two synthetic source revisions");
    }
    expect(firstVersion.version).toEqual(makeVersion());
    expect(firstVersion.state).toBe("APPROVED");
    expect(
      firstVersion.transitions.map(({ sequence, actorId }) => ({ sequence, actorId })),
    ).toEqual([
      { sequence: 1, actorId: IDS.author },
      { sequence: 2, actorId: IDS.reviewer },
      { sequence: 3, actorId: IDS.approver },
    ]);
    expect(secondVersion.version).toMatchObject({
      id: IDS.versionA2,
      revision: 2,
      replacesVersionId: IDS.versionA1,
      replacementReason: "Synthetic clarification",
    });
    expect(secondVersion.state).toBeNull();
    expect(secondVersion.transitions).toEqual([]);

    firstVersion.version.versionLabel = "Mutated snapshot";
    expect(repository.getVersion(IDS.versionA1).versionLabel).toBe("synthetic-v1");
    expect(repository.getVersions(IDS.sourceA).map(({ revision }) => revision)).toEqual([1, 2]);
  });

  it("detects concurrent writers at revision and transition boundaries", () => {
    const repository = new InMemoryComplianceSourceRepository();
    repository.addSource(makeSource());
    repository.appendVersion(makeVersion(), 0);

    const writerA = makeVersion({
      id: IDS.versionA2,
      revision: 2,
      contentHash: HASHES.a2,
      replacesVersionId: IDS.versionA1,
      replacementReason: "Writer A",
    });
    const writerB = makeVersion({
      id: IDS.versionA3,
      revision: 2,
      contentHash: HASHES.a3,
      replacesVersionId: IDS.versionA1,
      replacementReason: "Writer B",
    });
    repository.appendVersion(writerA, 1);
    expect(() => repository.appendVersion(writerB, 1)).toThrow(
      expect.objectContaining({ code: "VERSION_REVISION_CONFLICT" }),
    );

    repository.appendTransition(
      makeEvent(),
      { actor: ACTORS.author },
      { sequence: 0, state: null },
    );
    expect(() =>
      repository.appendTransition(
        makeEvent({ id: IDS.event5 }),
        { actor: ACTORS.author },
        { sequence: 0, state: null },
      ),
    ).toThrow(expect.objectContaining({ code: "TRANSITION_CONCURRENCY_CONFLICT" }));
  });
});
