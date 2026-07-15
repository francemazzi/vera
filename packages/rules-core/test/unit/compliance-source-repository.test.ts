import { describe, expect, it } from "vitest";

import {
  ComplianceSourceConflictError,
  ComplianceSourceEligibilityError,
  ComplianceSourceInvariantError,
  ComplianceSourceNotFoundError,
  InMemoryComplianceSourceRepository,
} from "../../src/index.js";
import type {
  ComplianceSourceTransitionAuthorization,
  VersionActivationEligibilityRequest,
} from "../../src/index.js";
import {
  ACTORS,
  HASHES,
  IDS,
  TIMES,
  makeEvent,
  makeSource,
  makeVersion,
} from "../fixtures/compliance-source.js";

function repositoryWithVersion(): InMemoryComplianceSourceRepository {
  const repository = new InMemoryComplianceSourceRepository();
  repository.addSource(makeSource());
  repository.appendVersion(makeVersion(), 0);
  return repository;
}

function upload(repository: InMemoryComplianceSourceRepository): void {
  repository.appendTransition(makeEvent(), { actor: ACTORS.author }, { sequence: 0, state: null });
}

function review(repository: InMemoryComplianceSourceRepository, at: string = TIMES.reviewed): void {
  repository.appendTransition(
    makeEvent({
      id: IDS.event2,
      sequence: 2,
      from: "UPLOADED",
      to: "REVIEWED",
      actorId: IDS.reviewer,
      exercisedRole: "REVIEWER",
      at,
    }),
    { actor: ACTORS.reviewer },
    { sequence: 1, state: "UPLOADED" },
  );
}

function approve(
  repository: InMemoryComplianceSourceRepository,
  at: string = TIMES.approved,
): void {
  repository.appendTransition(
    makeEvent({
      id: IDS.event3,
      sequence: 3,
      from: "REVIEWED",
      to: "APPROVED",
      actorId: IDS.approver,
      exercisedRole: "APPROVER",
      at,
    }),
    { actor: ACTORS.approver },
    { sequence: 2, state: "REVIEWED" },
  );
}

describe("InMemoryComplianceSourceRepository sources", () => {
  it("validates source payloads with the strict runtime contract", () => {
    const repository = new InMemoryComplianceSourceRepository();
    const malformed = { ...makeSource(), unexpected: true };

    expect(() => repository.addSource(malformed)).toThrow(
      expect.objectContaining({ code: "INVALID_SOURCE_PAYLOAD" }),
    );
  });

  it("stores and returns defensive source copies", () => {
    const repository = new InMemoryComplianceSourceRepository();
    const input = makeSource();
    const added = repository.addSource(input);

    input.title = "Mutated input";
    added.title = "Mutated result";
    const read = repository.getSource(IDS.sourceA);
    read.title = "Mutated read";

    expect(repository.getSource(IDS.sourceA).title).toBe("Synthetic Quality Reference");
  });

  it("rejects duplicate and missing sources", () => {
    const repository = new InMemoryComplianceSourceRepository();
    repository.addSource(makeSource());

    expect(() => repository.addSource(makeSource())).toThrow(
      expect.objectContaining({ code: "SOURCE_ALREADY_EXISTS" }),
    );
    expect(() => repository.getSource(IDS.sourceB)).toThrow(
      expect.objectContaining({ code: "SOURCE_NOT_FOUND" }),
    );
    expect(() => repository.getVersions(IDS.sourceB)).toThrow(ComplianceSourceNotFoundError);
  });
});

describe("InMemoryComplianceSourceRepository versions", () => {
  it("validates version payloads with the strict runtime contract", () => {
    const repository = new InMemoryComplianceSourceRepository();
    repository.addSource(makeSource());
    const malformed = { ...makeVersion(), contentHash: "not-a-hash" };

    expect(() => repository.appendVersion(malformed, 0)).toThrow(
      expect.objectContaining({ code: "INVALID_VERSION_PAYLOAD" }),
    );
  });

  it("stores nested values defensively and preserves append-only history", () => {
    const repository = new InMemoryComplianceSourceRepository();
    repository.addSource(makeSource());
    const input = makeVersion();
    const added = repository.appendVersion(input, 0);

    input.validity.validTo = null;
    added.validity.validFrom = TIMES.beforeValidity;
    const read = repository.getVersion(IDS.versionA1);
    read.validity.validFrom = TIMES.beforeValidity;

    expect(repository.getVersion(IDS.versionA1).validity).toEqual({
      validFrom: TIMES.validFrom,
      validTo: TIMES.validTo,
    });
  });

  it("rejects a version for a missing source and duplicate version IDs", () => {
    const repository = new InMemoryComplianceSourceRepository();

    expect(() => repository.appendVersion(makeVersion(), 0)).toThrow(
      expect.objectContaining({ code: "SOURCE_NOT_FOUND" }),
    );

    repository.addSource(makeSource());
    repository.appendVersion(makeVersion(), 0);

    expect(() => repository.appendVersion(makeVersion(), 1)).toThrow(
      expect.objectContaining({ code: "VERSION_ALREADY_EXISTS" }),
    );
  });

  it("separates stale revision expectations from malformed next revisions", () => {
    const repository = repositoryWithVersion();
    const second = makeVersion({
      id: IDS.versionA2,
      revision: 2,
      contentHash: HASHES.a2,
      versionLabel: "synthetic-v2",
      replacesVersionId: IDS.versionA1,
      replacementReason: "Synthetic correction",
    });

    expect(() => repository.appendVersion(second, 0)).toThrow(
      expect.objectContaining({ code: "VERSION_REVISION_CONFLICT" }),
    );
    expect(() => repository.appendVersion({ ...second, revision: 3 }, 1)).toThrow(
      expect.objectContaining({ code: "REVISION_NOT_MONOTONIC" }),
    );
  });

  it("requires a replacement and reason to be paired", () => {
    const repository = repositoryWithVersion();

    expect(() =>
      repository.appendVersion(
        makeVersion({
          id: IDS.versionA2,
          revision: 2,
          contentHash: HASHES.a2,
          replacesVersionId: IDS.versionA1,
          replacementReason: null,
        }),
        1,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_VERSION_PAYLOAD" }));

    expect(() =>
      repository.appendVersion(
        makeVersion({
          id: IDS.versionA2,
          revision: 2,
          contentHash: HASHES.a2,
          replacesVersionId: null,
          replacementReason: "No target",
        }),
        1,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_VERSION_PAYLOAD" }));
  });

  it("requires a replacement target from the same source history", () => {
    const repository = repositoryWithVersion();
    repository.addSource(
      makeSource({ id: IDS.sourceB, stableReference: "urn:synthetic:source:b" }),
    );
    repository.appendVersion(
      makeVersion({ id: IDS.versionB1, sourceId: IDS.sourceB, contentHash: HASHES.other }),
      0,
    );

    expect(() =>
      repository.appendVersion(
        makeVersion({
          id: IDS.versionA2,
          revision: 2,
          contentHash: HASHES.a2,
          replacesVersionId: IDS.versionB1,
          replacementReason: "Wrong source",
        }),
        1,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_REPLACEMENT" }));

    expect(() =>
      repository.appendVersion(
        makeVersion({
          id: IDS.versionA2,
          revision: 2,
          contentHash: HASHES.a2,
          replacesVersionId: IDS.versionA3,
          replacementReason: "Unknown target",
        }),
        1,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_REPLACEMENT" }));
  });

  it("requires every later revision to replace the immediately preceding version", () => {
    const repository = repositoryWithVersion();

    expect(() =>
      repository.appendVersion(
        makeVersion({
          id: IDS.versionA2,
          revision: 2,
          contentHash: HASHES.a2,
        }),
        1,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_REPLACEMENT" }));

    repository.appendVersion(
      makeVersion({
        id: IDS.versionA2,
        revision: 2,
        contentHash: HASHES.a2,
        replacesVersionId: IDS.versionA1,
        replacementReason: "First correction",
      }),
      1,
    );

    expect(() =>
      repository.appendVersion(
        makeVersion({
          id: IDS.versionA3,
          revision: 3,
          contentHash: HASHES.a3,
          replacesVersionId: IDS.versionA1,
          replacementReason: "Skipped latest revision",
        }),
        2,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_REPLACEMENT" }));
    expect(repository.getVersion(IDS.versionA1).contentHash).toBe(HASHES.a1);
  });
});

describe("InMemoryComplianceSourceRepository transitions", () => {
  it("validates transition payloads with the strict runtime contract", () => {
    const repository = repositoryWithVersion();
    const malformed = { ...makeEvent(), unexpected: true };

    expect(() =>
      repository.appendTransition(
        malformed,
        { actor: ACTORS.author },
        { sequence: 0, state: null },
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_TRANSITION_PAYLOAD" }));
  });

  it("records an authorized lifecycle and returns defensive event history", () => {
    const repository = repositoryWithVersion();
    upload(repository);
    review(repository);
    approve(repository);

    const history = repository.getTransitionHistory(IDS.versionA1);
    const firstEvent = history.at(0);
    if (firstEvent === undefined) throw new Error("Expected a synthetic upload event");
    firstEvent.reason = "Mutated";

    expect(repository.getVersionState(IDS.versionA1)).toBe("APPROVED");
    expect(repository.getTransitionHistory(IDS.versionA1)).toHaveLength(3);
    expect(repository.getTransitionHistory(IDS.versionA1).at(0)?.reason).toBeNull();
  });

  it("blocks mixed-case UUID aliases from reviewing or approving their own source", () => {
    const identity = "00000000-0000-4000-8000-00000000abcd";
    const selfReview = new InMemoryComplianceSourceRepository();
    selfReview.addSource(makeSource());
    selfReview.appendVersion(makeVersion({ createdBy: identity }), 0);
    selfReview.appendTransition(
      makeEvent({ actorId: identity }),
      { actor: { ...ACTORS.author, id: identity } },
      { sequence: 0, state: null },
    );

    expect(() =>
      selfReview.appendTransition(
        makeEvent({
          id: IDS.event2,
          sequence: 2,
          from: "UPLOADED",
          to: "REVIEWED",
          actorId: identity.toUpperCase(),
          exercisedRole: "REVIEWER",
          at: TIMES.reviewed,
        }),
        { actor: { ...ACTORS.reviewer, id: identity.toUpperCase() } },
        { sequence: 1, state: "UPLOADED" },
      ),
    ).toThrow(expect.objectContaining({ code: "TRANSITION_NOT_AUTHORIZED" }));

    const selfApproval = new InMemoryComplianceSourceRepository();
    selfApproval.addSource(makeSource());
    selfApproval.appendVersion(makeVersion({ createdBy: identity }), 0);
    selfApproval.appendTransition(
      makeEvent({ actorId: identity }),
      { actor: { ...ACTORS.author, id: identity } },
      { sequence: 0, state: null },
    );
    review(selfApproval);

    expect(() =>
      selfApproval.appendTransition(
        makeEvent({
          id: IDS.event3,
          sequence: 3,
          from: "REVIEWED",
          to: "APPROVED",
          actorId: identity.toUpperCase(),
          exercisedRole: "APPROVER",
          at: TIMES.approved,
        }),
        { actor: { ...ACTORS.approver, id: identity.toUpperCase() } },
        { sequence: 2, state: "REVIEWED" },
      ),
    ).toThrow(expect.objectContaining({ code: "TRANSITION_NOT_AUTHORIZED" }));
  });

  it("rejects an authorization actor outside the public identity contract", () => {
    const repository = repositoryWithVersion();

    expect(() =>
      repository.appendTransition(
        makeEvent(),
        { actor: { ...ACTORS.author, id: "not-an-actor-id" } },
        { sequence: 0, state: null },
      ),
    ).toThrow(expect.objectContaining({ code: "TRANSITION_NOT_AUTHORIZED" }));
  });

  it("rejects Proxy and accessor authorizations without invoking user code", () => {
    const repository = repositoryWithVersion();
    let getterCalls = 0;
    const accessorAuthorization = {} as ComplianceSourceTransitionAuthorization;
    Object.defineProperty(accessorAuthorization, "actor", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return ACTORS.author;
      },
    });
    expect(() =>
      repository.appendTransition(makeEvent(), accessorAuthorization, {
        sequence: 0,
        state: null,
      }),
    ).toThrow(expect.objectContaining({ code: "TRANSITION_NOT_AUTHORIZED" }));
    expect(getterCalls).toBe(0);

    const proxyAuthorization = new Proxy(
      { actor: ACTORS.author },
      {
        get() {
          throw new Error("Authorization Proxy must not be inspected");
        },
      },
    );
    expect(() =>
      repository.appendTransition(makeEvent(), proxyAuthorization, {
        sequence: 0,
        state: null,
      }),
    ).toThrow(expect.objectContaining({ code: "TRANSITION_NOT_AUTHORIZED" }));
  });

  it("rejects missing versions and duplicate event IDs", () => {
    const repository = repositoryWithVersion();

    expect(() =>
      repository.appendTransition(
        makeEvent({ versionId: IDS.versionA2 }),
        { actor: ACTORS.author },
        { sequence: 0, state: null },
      ),
    ).toThrow(expect.objectContaining({ code: "VERSION_NOT_FOUND" }));

    upload(repository);
    expect(() =>
      repository.appendTransition(
        makeEvent(),
        { actor: ACTORS.author },
        { sequence: 1, state: "UPLOADED" },
      ),
    ).toThrow(expect.objectContaining({ code: "TRANSITION_ALREADY_EXISTS" }));
    expect(() => repository.getVersionState(IDS.versionA2)).toThrow(ComplianceSourceNotFoundError);
    expect(() => repository.getTransitionHistory(IDS.versionA2)).toThrow(
      ComplianceSourceNotFoundError,
    );
  });

  it.each([[{ sequence: 1, state: null }], [{ sequence: 0, state: "UPLOADED" as const }]])(
    "rejects stale optimistic transition expectation %j",
    (expected) => {
      const repository = repositoryWithVersion();

      expect(() =>
        repository.appendTransition(makeEvent(), { actor: ACTORS.author }, expected),
      ).toThrow(expect.objectContaining({ code: "TRANSITION_CONCURRENCY_CONFLICT" }));
    },
  );

  it("rejects an event sequence detached from the stored head", () => {
    const repository = repositoryWithVersion();
    upload(repository);

    expect(() =>
      repository.appendTransition(
        makeEvent({
          id: IDS.event2,
          sequence: 3,
          from: "UPLOADED",
          to: "REVIEWED",
          actorId: IDS.reviewer,
          exercisedRole: "REVIEWER",
          at: TIMES.reviewed,
        }),
        { actor: ACTORS.reviewer },
        { sequence: 1, state: "UPLOADED" },
      ),
    ).toThrow(expect.objectContaining({ code: "TRANSITION_EVENT_MISMATCH" }));
  });

  it("rejects an event state detached from the stored head", () => {
    const repository = repositoryWithVersion();
    upload(repository);
    review(repository);

    expect(() =>
      repository.appendTransition(
        makeEvent({
          id: IDS.event3,
          sequence: 3,
          from: "UPLOADED",
          to: "REVIEWED",
          actorId: IDS.reviewer,
          exercisedRole: "REVIEWER",
          at: TIMES.approved,
        }),
        { actor: ACTORS.reviewer },
        { sequence: 2, state: "REVIEWED" },
      ),
    ).toThrow(expect.objectContaining({ code: "TRANSITION_EVENT_MISMATCH" }));
  });

  it("binds every transition to the immutable version hash", () => {
    const repository = repositoryWithVersion();

    expect(() =>
      repository.appendTransition(
        makeEvent({ contentHash: HASHES.other }),
        { actor: ACTORS.author },
        { sequence: 0, state: null },
      ),
    ).toThrow(expect.objectContaining({ code: "TRANSITION_EVENT_MISMATCH" }));
  });

  it("rejects timestamps before version creation or a prior event", () => {
    const repository = repositoryWithVersion();
    expect(() =>
      repository.appendTransition(
        makeEvent({ at: TIMES.beforeValidity }),
        { actor: ACTORS.author },
        { sequence: 0, state: null },
      ),
    ).toThrow(expect.objectContaining({ code: "TRANSITION_TIME_NOT_MONOTONIC" }));

    upload(repository);
    expect(() => {
      review(repository, TIMES.created);
    }).toThrow(expect.objectContaining({ code: "TRANSITION_TIME_NOT_MONOTONIC" }));
  });

  it("orders transition history exactly below millisecond precision", () => {
    const repository = repositoryWithVersion();
    repository.appendTransition(
      makeEvent({ at: "2026-01-01T00:00:00.0001Z" }),
      { actor: ACTORS.author },
      { sequence: 0, state: null },
    );
    review(repository, "2026-01-01T00:00:00.0002Z");

    expect(repository.getVersionStateAt(IDS.versionA1, "2026-01-01T00:00:00.00015Z")).toBe(
      "UPLOADED",
    );

    const regressive = repositoryWithVersion();
    regressive.appendTransition(
      makeEvent({ at: "2026-01-01T00:00:00.0002Z" }),
      { actor: ACTORS.author },
      { sequence: 0, state: null },
    );
    expect(() => {
      review(regressive, "2026-01-01T00:00:00.0001Z");
    }).toThrow(expect.objectContaining({ code: "TRANSITION_TIME_NOT_MONOTONIC" }));
  });

  it("orders equal event timestamps by sequence", () => {
    const repository = repositoryWithVersion();
    upload(repository);
    review(repository, TIMES.uploaded);
    approve(repository, TIMES.uploaded);

    expect(repository.getVersionStateAt(IDS.versionA1, TIMES.uploaded)).toBe("APPROVED");
    expect(repository.getVersionStateAt(IDS.versionA1, TIMES.created)).toBeNull();
  });

  it.each([
    {
      event: makeEvent({ actorId: IDS.reviewer }),
      authorization: { actor: ACTORS.author },
      label: "event actor differs",
    },
    {
      event: makeEvent(),
      authorization: { actor: { ...ACTORS.reviewer, id: IDS.author } },
      label: "exercised role differs",
    },
    {
      event: makeEvent({ reason: "Recorded" }),
      authorization: { actor: ACTORS.author },
      label: "reason differs",
    },
    {
      event: makeEvent(),
      authorization: { actor: ACTORS.reviewer },
      label: "role cannot upload",
    },
  ] as const)("rejects unauthorized transition when $label", ({ event, authorization }) => {
    const repository = repositoryWithVersion();

    expect(() =>
      repository.appendTransition(event, authorization, { sequence: 0, state: null }),
    ).toThrow(expect.objectContaining({ code: "TRANSITION_NOT_AUTHORIZED" }));
  });

  it("derives contributors and prior reviewers instead of trusting caller exclusions", () => {
    const repository = repositoryWithVersion();
    upload(repository);

    const authorAsReviewer = { ...ACTORS.reviewer, id: IDS.author };
    const forgedReviewAuthorization = {
      actor: authorAsReviewer,
      contributorIds: [],
      excludedActorIds: [],
    } as ComplianceSourceTransitionAuthorization;
    expect(() =>
      repository.appendTransition(
        makeEvent({
          id: IDS.event2,
          sequence: 2,
          from: "UPLOADED",
          to: "REVIEWED",
          actorId: IDS.author,
          exercisedRole: "REVIEWER",
          at: TIMES.reviewed,
        }),
        forgedReviewAuthorization,
        { sequence: 1, state: "UPLOADED" },
      ),
    ).toThrow(expect.objectContaining({ code: "TRANSITION_NOT_AUTHORIZED" }));

    review(repository);
    const reviewerAsApprover = { ...ACTORS.approver, id: IDS.reviewer };
    const forgedApprovalAuthorization = {
      actor: reviewerAsApprover,
      excludedActorIds: [],
    } as ComplianceSourceTransitionAuthorization;
    expect(() =>
      repository.appendTransition(
        makeEvent({
          id: IDS.event3,
          sequence: 3,
          from: "REVIEWED",
          to: "APPROVED",
          actorId: IDS.reviewer,
          exercisedRole: "APPROVER",
          at: TIMES.approved,
        }),
        forgedApprovalAuthorization,
        { sequence: 2, state: "REVIEWED" },
      ),
    ).toThrow(expect.objectContaining({ code: "TRANSITION_NOT_AUTHORIZED" }));
  });
});

describe("InMemoryComplianceSourceRepository activation eligibility", () => {
  function eligibility(
    overrides: Partial<VersionActivationEligibilityRequest> = {},
  ): VersionActivationEligibilityRequest {
    return {
      versionId: IDS.versionA1,
      activationAt: TIMES.approved,
      evaluationDate: TIMES.insideValidity,
      expectedContentHash: HASHES.a1,
      ...overrides,
    };
  }

  it("returns an approved, hash-pinned version inside its half-open validity", () => {
    const repository = repositoryWithVersion();
    upload(repository);
    review(repository);
    approve(repository);

    expect(repository.assertVersionEligibleForActivation(eligibility())).toEqual(makeVersion());
    expect(
      repository.assertVersionEligibleForActivation(
        eligibility({ evaluationDate: TIMES.validFrom }),
      ),
    ).toEqual(makeVersion());
  });

  it("rejects malformed runtime timestamps and eligibility requests", () => {
    const repository = repositoryWithVersion();

    expect(() => repository.getVersionStateAt(IDS.versionA1, "not-a-date")).toThrow(
      expect.objectContaining({ code: "INVALID_STATE_AT" }),
    );
    expect(() =>
      repository.assertVersionEligibleForActivation({
        ...eligibility(),
        activationAt: "not-a-date",
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_ELIGIBILITY_REQUEST" }));
  });

  it("blocks changed content, non-approved state, and dates outside validity", () => {
    const repository = repositoryWithVersion();
    upload(repository);
    review(repository);
    approve(repository);

    expect(() =>
      repository.assertVersionEligibleForActivation(
        eligibility({ expectedContentHash: HASHES.other }),
      ),
    ).toThrow(expect.objectContaining({ code: "CONTENT_HASH_MISMATCH" }));
    expect(() =>
      repository.assertVersionEligibleForActivation(eligibility({ activationAt: TIMES.reviewed })),
    ).toThrow(expect.objectContaining({ code: "VERSION_NOT_APPROVED" }));
    expect(() =>
      repository.assertVersionEligibleForActivation(
        eligibility({ evaluationDate: TIMES.beforeValidity }),
      ),
    ).toThrow(expect.objectContaining({ code: "VERSION_OUTSIDE_VALIDITY" }));
    expect(() =>
      repository.assertVersionEligibleForActivation(eligibility({ evaluationDate: TIMES.validTo })),
    ).toThrow(ComplianceSourceEligibilityError);
  });

  it("replays approval at activation even after a later retirement", () => {
    const repository = repositoryWithVersion();
    upload(repository);
    review(repository);
    approve(repository);
    repository.appendTransition(
      makeEvent({
        id: IDS.event4,
        sequence: 4,
        from: "APPROVED",
        to: "RETIRED",
        actorId: IDS.secondApprover,
        exercisedRole: "APPROVER",
        at: TIMES.retired,
        reason: "Synthetic replacement",
      }),
      { actor: ACTORS.secondApprover, reason: "Synthetic replacement" },
      { sequence: 3, state: "APPROVED" },
    );

    expect(repository.getVersionState(IDS.versionA1)).toBe("RETIRED");
    expect(repository.assertVersionEligibleForActivation(eligibility()).id).toBe(IDS.versionA1);
    expect(() =>
      repository.assertVersionEligibleForActivation(eligibility({ activationAt: TIMES.retired })),
    ).toThrow(expect.objectContaining({ code: "VERSION_NOT_APPROVED" }));
  });
});

describe("error class identities", () => {
  it("uses conflict, invariant, and not-found categories", () => {
    const repository = repositoryWithVersion();

    expect(() => repository.appendVersion(makeVersion(), 1)).toThrow(ComplianceSourceConflictError);
    expect(() =>
      repository.appendVersion(
        makeVersion({ id: IDS.versionA2, revision: 4, contentHash: HASHES.a2 }),
        1,
      ),
    ).toThrow(ComplianceSourceInvariantError);
    expect(() => repository.getVersion(IDS.versionA2)).toThrow(ComplianceSourceNotFoundError);
  });
});
