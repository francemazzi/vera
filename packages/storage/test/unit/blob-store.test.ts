import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ContentAddressedBlobStore } from "../../src/index.js";

describe("ContentAddressedBlobStore", () => {
  it("stores bytes by SHA-256 and reads them back", async () => {
    const root = await mkdtemp(join(tmpdir(), "vera-blob-test-"));
    try {
      const store = new ContentAddressedBlobStore(root);
      const bytes = new TextEncoder().encode("synthetic blob");
      const descriptor = await store.put(bytes, "text/plain");

      expect(descriptor.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(descriptor.byteLength).toBe(bytes.byteLength);
      expect(await store.has(descriptor.sha256)).toBe(true);
      expect(await store.get(descriptor.sha256)).toEqual(Buffer.from(bytes));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
