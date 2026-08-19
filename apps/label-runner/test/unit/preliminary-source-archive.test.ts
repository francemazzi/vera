import { describe, expect, it, vi } from "vitest";

import {
  archivePinnedPreliminarySources,
  PRELIMINARY_SOURCE_ARCHIVES,
  readPreliminarySourceArchiveConfig,
} from "../../src/preliminary-source-archive.js";

describe("preliminary source archive", () => {
  it("requires the private bucket, project and a frozen snapshot", () => {
    expect(() => readPreliminarySourceArchiveConfig({})).toThrow("LABEL_SOURCE_SNAPSHOT");
    expect(() =>
      readPreliminarySourceArchiveConfig({
        LABEL_SOURCE_SNAPSHOT: "not-a-hash",
        LABEL_GCS_BUCKET: "private-bucket",
        GCP_PROJECT_ID: "siltopro",
      }),
    ).toThrow("SHA-256");
  });

  it("rejects an invalid source response before touching private storage", async () => {
    const storage = {
      bucket: vi.fn().mockReturnValue({
        file: vi.fn().mockReturnValue({ exists: vi.fn().mockResolvedValue([false]) }),
      }),
    };
    await expect(
      archivePinnedPreliminarySources({
        config: {
          bucketName: "private-bucket",
          projectId: "siltopro",
          sourceSnapshot: "a".repeat(64),
        },
        storage: storage as never,
        fetch: vi.fn().mockResolvedValue(
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "application/pdf" },
          }),
        ),
      }),
    ).rejects.toThrow(
      `Private source ${PRELIMINARY_SOURCE_ARCHIVES[0].id} returned an unexpected media type`,
    );
    expect(storage.bucket).toHaveBeenCalledTimes(1);
  });
});
