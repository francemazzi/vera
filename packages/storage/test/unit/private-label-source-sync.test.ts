import { describe, expect, it, vi } from "vitest";

import { assertPrivateLabelSourceUrlAllowed, syncPrivateLabelSource } from "../../src/index.js";

const sourceId = "00000000-0000-4000-8000-000000000501";
const actorId = "00000000-0000-4000-8000-000000000502";

describe("private Label source sync", () => {
  it("downloads only an allowed official URL and stores an UNVERIFIED proposal", async () => {
    const createSourceVersion = vi.fn().mockResolvedValue({
      sourceVersionId: "00000000-0000-4000-8000-000000000503",
      state: "UNVERIFIED",
    });
    const archive = {
      persist: vi.fn().mockResolvedValue({ contentObjectRef: "gs://private/sources/a" }),
    };

    const result = await syncPrivateLabelSource({
      repository: { createSourceVersion },
      archive,
      fetch: vi.fn().mockResolvedValue(
        new Response(new Uint8Array([37, 80, 68, 70]), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
      ),
      request: {
        source: {
          id: sourceId,
          url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32011R1169",
          title: "Synthetic EU source",
          jurisdiction: "EU",
        },
        revision: 1,
        actorId,
        createdAt: "2026-07-18T12:00:00.000Z",
      },
    });

    expect(result.state).toBe("UNVERIFIED");
    expect(createSourceVersion).toHaveBeenCalledWith(
      expect.objectContaining({ actorId, actorRole: "SYNC_AGENT" }),
    );
    expect(archive.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType: "application/pdf",
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) as unknown as string,
      }),
    );
  });

  it("rejects non-official, credentialed and malformed allowlist URLs before network I/O", () => {
    expect(() => assertPrivateLabelSourceUrlAllowed("https://example.test/regulation.pdf")).toThrow(
      "allowlist",
    );
    expect(() =>
      assertPrivateLabelSourceUrlAllowed("https://user:secret@eur-lex.europa.eu/a"),
    ).toThrow("credential-free");
    expect(() => assertPrivateLabelSourceUrlAllowed("http://eur-lex.europa.eu/a")).toThrow(
      "credential-free",
    );
  });
});
