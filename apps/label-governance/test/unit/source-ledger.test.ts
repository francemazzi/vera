import { describe, expect, it, vi } from "vitest";
import { StorageConflictError } from "@vera/storage";

import { applySourceLedgerAction } from "../../src/source-ledger.js";

const actor = {
  actorId: "00000000-0000-4000-8000-000000000501",
  actorRole: "ADMIN" as const,
  workspaceId: "00000000-0000-4000-8000-000000000502",
};

const request = {
  action: "CREATE_UNVERIFIED" as const,
  candidateId: "00000000-0000-4000-8000-000000000503",
  source: {
    id: "00000000-0000-4000-8000-000000000504",
    stableReference: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169",
    title: "Regulation (EU) 1169/2011",
    jurisdiction: "European Union",
  },
  version: {
    id: "00000000-0000-4000-8000-000000000505",
    revision: 1,
    contentHash: "a".repeat(64),
    contentObjectRef: "gs://private-label/label-governance/sources/example.pdf",
  },
  actor: { id: actor.actorId, role: "ADMIN" as const },
  createdAt: "2026-07-19T00:00:00.000Z",
};

describe("immutable source ledger bridge", () => {
  it("creates UNVERIFIED with the forwarded ADMIN actor and no source body", async () => {
    const repository = {
      createSourceVersion: vi.fn().mockResolvedValue({
        sourceVersionId: request.version.id,
        state: "UNVERIFIED",
        transitionHash: "b".repeat(64),
      }),
      appendSourceTransition: vi.fn(),
      getSourceVersion: vi.fn(),
    };

    const result = await applySourceLedgerAction({ repository, request, actor });

    expect(result).toEqual({
      sourceVersionId: request.version.id,
      state: "UNVERIFIED",
      sequence: 1,
    });
    expect(repository.createSourceVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: actor.actorId,
        actorRole: "ADMIN",
        version: request.version,
      }),
    );
  });

  it("is idempotent when the same immutable version was already created", async () => {
    const repository = {
      createSourceVersion: vi.fn().mockRejectedValue(new StorageConflictError("conflict")),
      appendSourceTransition: vi.fn(),
      getSourceVersion: vi.fn().mockResolvedValue({
        id: request.version.id,
        contentHash: request.version.contentHash,
        state: "UNVERIFIED",
        transitions: [{ sequence: 1, toState: "UNVERIFIED", actorId: actor.actorId }],
      }),
    };

    await expect(applySourceLedgerAction({ repository, request, actor })).resolves.toEqual({
      sourceVersionId: request.version.id,
      state: "UNVERIFIED",
      sequence: 1,
    });
  });

  it("rejects a forged forwarded actor that does not match the ledger request", async () => {
    const repository = {
      createSourceVersion: vi.fn(),
      appendSourceTransition: vi.fn(),
      getSourceVersion: vi.fn(),
    };

    await expect(
      applySourceLedgerAction({
        repository,
        request: {
          ...request,
          actor: { id: "00000000-0000-4000-8000-000000000506", role: "ADMIN" },
        },
        actor,
      }),
    ).rejects.toMatchObject({ retryable: false });
  });
});
