import { describe, expect, it, vi } from "vitest";

import { createGcsOfficialSourceAcquirer } from "../../src/official-source-acquirer.js";
import type { OfficialSourceDiscoveryStorage } from "../../src/official-source-acquirer.js";
import { OfficialAuthorityProfileSchema } from "../../src/source-discovery-contracts.js";

const profile = OfficialAuthorityProfileSchema.parse({
  id: "00000000-0000-4000-8000-000000000611",
  jurisdictionCode: "IT",
  authorityName: "Synthetic Italian Official Gazette",
  allowedHosts: ["official.example.gov"],
  searchEndpoint: "https://official.example.gov/search",
  searchMode: "OFFICIAL_SEARCH_HTML",
  languages: ["it"],
  active: true,
});

type SaveOptions = {
  readonly resumable: boolean;
  readonly contentType: string;
  readonly metadata: {
    readonly cacheControl: string;
    readonly metadata: Readonly<Record<string, string>>;
  };
  readonly preconditionOpts: { readonly ifGenerationMatch: number };
};

interface StorageHarness {
  readonly files: Map<string, { readonly sha256: string }>;
  readonly save: (key: string, options: SaveOptions) => Promise<void>;
  readonly storage: OfficialSourceDiscoveryStorage;
}

function storageHarness(): StorageHarness {
  const files = new Map<string, { readonly sha256: string }>();
  const save = vi.fn<(key: string, options: SaveOptions) => Promise<void>>(
    (key, options): Promise<void> => {
      files.set(key, { sha256: options.metadata.metadata["sha256"] ?? "" });
      return Promise.resolve();
    },
  );
  return {
    files,
    save,
    storage: {
      bucket: vi.fn(() => ({
        file: (key: string) => ({
          save: (_bytes: Uint8Array, options: SaveOptions): Promise<void> => save(key, options),
          getMetadata: (): Promise<
            readonly [{ readonly metadata?: Readonly<Record<string, string>> }]
          > =>
            Promise.resolve([
              {
                ...(files.has(key) ? { metadata: { sha256: files.get(key)?.sha256 ?? "" } } : {}),
              },
            ]),
        }),
      })),
    },
  };
}

function readablePdfBytes(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(document.length);
    document += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = document.length;
  document += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  document += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  document += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;
  return new TextEncoder().encode(document);
}

describe("official source acquirer", () => {
  it("downloads an allowed PDF without redirects, verifies magic bytes, and stores an opaque private snapshot", async () => {
    const harness = storageHarness();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(readablePdfBytes(), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );
    const acquirer = createGcsOfficialSourceAcquirer({
      bucketName: "private-label-bucket",
      storage: harness.storage,
      fetch,
    });

    const result = await acquirer.acquire(
      {
        profile,
        sourceUrl: "https://official.example.gov/acts/food.pdf",
        sourceTitle: "Food regulation",
        searchEvidence: "Food regulation",
        discoveryQuery: "food allergens",
      },
      "00000000-0000-4000-8000-000000000612",
    );

    expect(result).toMatchObject({
      sourceFormat: "PDF",
      pdfUrl: "https://official.example.gov/acts/food.pdf",
    });
    expect(result.storageObjectKey).toMatch(
      /^label-governance\/source-discovery\/00000000-0000-4000-8000-000000000612\/00000000-0000-4000-8000-000000000611\/original\/[0-9a-f]{64}\.pdf$/u,
    );
    expect(harness.save).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "official.example.gov" }),
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("rejects a claimed PDF whose bytes are not a PDF before it reaches private storage", async () => {
    const harness = storageHarness();
    const acquirer = createGcsOfficialSourceAcquirer({
      bucketName: "private-label-bucket",
      storage: harness.storage,
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response("not a PDF", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
      ),
    });

    await expect(
      acquirer.acquire(
        {
          profile,
          sourceUrl: "https://official.example.gov/acts/not-pdf",
          sourceTitle: "Not PDF",
          searchEvidence: "Not PDF",
          discoveryQuery: "food",
        },
        "00000000-0000-4000-8000-000000000612",
      ),
    ).rejects.toMatchObject({ code: "SOURCE_PDF_MAGIC_INVALID", retryable: false });
    expect(harness.save).not.toHaveBeenCalled();
  });

  it("rejects a malformed PDF with valid magic bytes before it reaches private storage", async () => {
    const harness = storageHarness();
    const acquirer = createGcsOfficialSourceAcquirer({
      bucketName: "private-label-bucket",
      storage: harness.storage,
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response("%PDF-1.7 malformed", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
      ),
    });

    await expect(
      acquirer.acquire(
        {
          profile,
          sourceUrl: "https://official.example.gov/acts/malformed.pdf",
          sourceTitle: "Malformed PDF",
          searchEvidence: "Malformed PDF",
          discoveryQuery: "food",
        },
        "00000000-0000-4000-8000-000000000612",
      ),
    ).rejects.toMatchObject({ code: "SOURCE_PDF_UNREADABLE", retryable: false });
    expect(harness.save).not.toHaveBeenCalled();
  });
});
