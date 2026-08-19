import { createHash } from "node:crypto";

import type { Storage } from "@google-cloud/storage";
import { describe, expect, it, vi } from "vitest";

import { createGcsSourceDocumentMaterializer } from "../../src/gcs-source-document-materializer.js";
import type { SourceWorkerInput } from "../../src/source-backend-client.js";

const batchId = "00000000-0000-4000-8000-000000000801";
const candidateId = "00000000-0000-4000-8000-000000000802";
const sourcePrefix = `label-governance/sources/${batchId}/${candidateId}`;

type StoredObject = {
  body: Buffer;
  contentType: string;
  metadata?: Readonly<Record<string, string>>;
};

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function including(value: string): string {
  const matcher: unknown = expect.stringContaining(value);
  return matcher as string;
}

function createFakeStorage(objects: Map<string, StoredObject>): Storage {
  return {
    bucket: vi.fn(() => ({
      file: vi.fn((objectKey: string) => ({
        exists: vi.fn(() => Promise.resolve([objects.has(objectKey)])),
        getMetadata: vi.fn(() => {
          const object = objects.get(objectKey);
          if (!object) return Promise.reject(new Error(`missing ${objectKey}`));
          return Promise.resolve([
            {
              size: String(object.body.byteLength),
              contentType: object.contentType,
              metadata: object.metadata ?? {},
            },
          ]);
        }),
        download: vi.fn(() => {
          const object = objects.get(objectKey);
          if (!object) return Promise.reject(new Error(`missing ${objectKey}`));
          return Promise.resolve([Buffer.from(object.body)]);
        }),
        save: vi.fn((contents: Uint8Array, options: { contentType?: string }) => {
          objects.set(objectKey, {
            body: Buffer.from(contents),
            contentType: options.contentType ?? "application/octet-stream",
          });
          return Promise.resolve();
        }),
      })),
    })),
  } as unknown as Storage;
}

function htmlCandidate(
  body: Uint8Array,
  overrides: Partial<SourceWorkerInput> = {},
): SourceWorkerInput {
  return {
    candidateId,
    batchId,
    classificationRunId: "00000000-0000-4000-8000-000000000803",
    kind: "CLASSIFY",
    sourceKind: "TABULAR",
    sourceFormat: "OFFICIAL_HTML",
    stageStatus: "CLASSIFICATION_QUEUED",
    governanceStatus: null,
    classificationStatus: "QUEUED",
    verifiedRagStatus: "NOT_REQUESTED",
    ragStatus: "NOT_REQUESTED",
    sourceVersion: 1,
    ragWorkspaceScope: "00000000-0000-4000-8000-000000000801",
    sourceTitle: "Decreto legislativo di esempio",
    pdfUrl: null,
    canonicalUrl: "https://normattiva.it/uri-res/N2Ls?urn:nir:stato:test",
    // The backend owns the naming; VERA accepts any opaque object key only
    // within this candidate's private prefix.
    storageObjectKey: `${sourcePrefix}/source.html`,
    extractedTextObjectKey: null,
    sourceSha256: digest(body),
    contentByteSize: body.byteLength,
    jurisdiction: "IT",
    language: "it",
    documentType: "Decreto legislativo",
    actReference: "D.Lgs. 231/2017",
    revisionLabel: "testo-vigente",
    validFrom: null,
    validTo: null,
    productCategories: ["generic-prepacked"],
    notes: null,
    classificationJson: null,
    ...overrides,
  };
}

function readablePdf(): Buffer {
  const textStream = "BT /F1 12 Tf 72 720 Td (Regulation 1169/2011) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${String(Buffer.byteLength(textStream, "ascii"))} >>\nstream\n${textStream}\nendstream`,
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
  return Buffer.from(document, "ascii");
}

function pdfCandidate(body: Uint8Array): SourceWorkerInput {
  return {
    ...htmlCandidate(body),
    sourceKind: "PDF_UPLOAD",
    sourceFormat: "PDF",
    canonicalUrl: null,
    storageObjectKey: `${sourcePrefix}/source.pdf`,
  };
}

describe("GCS source document materializer", () => {
  it("extracts a readable private PDF and releases its pdfjs loading task", async () => {
    const body = readablePdf();
    const input = pdfCandidate(body);
    const objects = new Map<string, StoredObject>([
      [input.storageObjectKey ?? "", { body, contentType: "application/pdf" }],
    ]);
    const materializer = createGcsSourceDocumentMaterializer({
      bucketName: "private-label-test",
      officialSourceHosts: ["normattiva.it"],
      storage: createFakeStorage(objects),
      fetch: vi.fn(),
    });

    const materialized = await materializer.materialize(input);

    expect(materialized.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pageNumber: 1,
          text: including("Regulation 1169/2011"),
        }),
      ]),
    );
    expect(materialized.artifacts.extractedTextObjectKey).toBe(
      `${sourcePrefix}/extracted/${digest(body)}.json`,
    );
  });

  it("reads only a private verified snapshot, strips scriptable markup, and archives retrievable sections", async () => {
    const body = Buffer.from(
      `<!doctype html><html><body><h1>Disciplina delle etichette</h1><p>Art. 1 &amp; obblighi informativi.</p><script>window.exfiltrate('never')</script><h2>Campo di applicazione</h2><p>Prodotti preimballati.</p></body></html>`,
      "utf8",
    );
    const input = htmlCandidate(body);
    const objects = new Map<string, StoredObject>([
      [input.storageObjectKey ?? "", { body, contentType: "text/html; charset=utf-8" }],
    ]);
    const fetch = vi.fn();
    const materializer = createGcsSourceDocumentMaterializer({
      bucketName: "private-label-test",
      officialSourceHosts: ["normattiva.it"],
      storage: createFakeStorage(objects),
      fetch,
    });

    const materialized = await materializer.materialize(input);

    expect(fetch).not.toHaveBeenCalled();
    expect(materialized.artifacts).toMatchObject({
      sourceSha256: digest(body),
      storageObjectKey: input.storageObjectKey,
      contentByteSize: body.byteLength,
    });
    expect(materialized.artifacts.extractedTextObjectKey).toBe(
      `${sourcePrefix}/extracted/${digest(body)}.json`,
    );
    expect(materialized.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Disciplina delle etichette",
          pageNumber: null,
          text: including("Art. 1 & obblighi informativi."),
        }),
        expect.objectContaining({
          title: "Campo di applicazione",
          pageNumber: null,
          text: including("Prodotti preimballati."),
        }),
      ]),
    );
    expect(materialized.classificationText).not.toContain("exfiltrate");
    const archived = objects.get(materialized.artifacts.extractedTextObjectKey);
    expect(archived?.contentType).toBe("application/json");
    expect(JSON.parse(archived?.body.toString("utf8") ?? "{}")).toMatchObject({
      sourceSha256: digest(body),
      sourceFormat: "OFFICIAL_HTML",
    });
  });

  it("accepts an exact backend-verified discovery snapshot without applying the static host allowlist", async () => {
    const body = Buffer.from(
      "<h1>Lege oficială</h1><p>Etichetarea produselor lactate.</p>",
      "utf8",
    );
    const sourceSha256 = digest(body);
    const storageObjectKey =
      "label-governance/source-discovery/00000000-0000-4000-8000-000000000804/" +
      `00000000-0000-4000-8000-000000000805/original/${sourceSha256}.html`;
    const input = htmlCandidate(body, {
      canonicalUrl: "https://legislatie.just.ro/Public/DetaliiDocument/261454",
      storageObjectKey,
    });
    const materializer = createGcsSourceDocumentMaterializer({
      bucketName: "private-label-test",
      // This intentionally excludes the Romanian authority. Its versioned
      // profile and exact immutable snapshot key were already verified by the
      // backend before the worker received this candidate.
      officialSourceHosts: ["normattiva.it"],
      storage: createFakeStorage(
        new Map([[storageObjectKey, { body, contentType: "text/html; charset=utf-8" }]]),
      ),
      fetch: vi.fn(),
    });

    await expect(materializer.materialize(input)).resolves.toMatchObject({
      artifacts: { sourceSha256, storageObjectKey },
    });
  });

  it("rejects discovery snapshot keys unless run, profile, hash, and extension match exactly", async () => {
    const body = Buffer.from("<p>Testo ufficiale</p>", "utf8");
    const sourceSha256 = digest(body);
    const validPrefix =
      "label-governance/source-discovery/00000000-0000-4000-8000-000000000804/" +
      "00000000-0000-4000-8000-000000000805/original/";
    const materializer = createGcsSourceDocumentMaterializer({
      bucketName: "private-label-test",
      officialSourceHosts: ["normattiva.it"],
      storage: createFakeStorage(new Map()),
      fetch: vi.fn(),
    });

    for (const storageObjectKey of [
      `${validPrefix}${"a".repeat(64)}.html`,
      `${validPrefix}${sourceSha256}.pdf`,
      `label-governance/source-discovery/not-a-uuid/00000000-0000-4000-8000-000000000805/original/${sourceSha256}.html`,
    ]) {
      await expect(
        materializer.materialize(
          htmlCandidate(body, {
            canonicalUrl: "https://legislatie.just.ro/Public/DetaliiDocument/261454",
            storageObjectKey,
          }),
        ),
      ).rejects.toMatchObject({ failureCode: "SOURCE_OBJECT_FORBIDDEN", retryable: false });
    }
  });

  it("rejects an HTML snapshot outside the candidate's private prefix before reading it", async () => {
    const body = Buffer.from("<p>Testo ufficiale</p>", "utf8");
    const input = htmlCandidate(body, {
      storageObjectKey: "label-governance/sources/other/candidate/original.html",
    });
    const materializer = createGcsSourceDocumentMaterializer({
      bucketName: "private-label-test",
      officialSourceHosts: ["normattiva.it"],
      storage: createFakeStorage(new Map()),
      fetch: vi.fn(),
    });

    await expect(materializer.materialize(input)).rejects.toMatchObject({
      failureCode: "SOURCE_OBJECT_FORBIDDEN",
      retryable: false,
    });
  });

  it("rejects a snapshot whose content type or hash does not match the curated metadata", async () => {
    const body = Buffer.from("<p>Testo ufficiale</p>", "utf8");
    const input = htmlCandidate(body);
    const objects = new Map<string, StoredObject>([
      [input.storageObjectKey ?? "", { body, contentType: "application/json" }],
    ]);
    const materializer = createGcsSourceDocumentMaterializer({
      bucketName: "private-label-test",
      officialSourceHosts: ["normattiva.it"],
      storage: createFakeStorage(objects),
      fetch: vi.fn(),
    });

    await expect(materializer.materialize(input)).rejects.toMatchObject({
      failureCode: "HTML_MEDIA_TYPE_INVALID",
      retryable: false,
    });

    objects.set(input.storageObjectKey ?? "", { body, contentType: "text/html" });
    await expect(
      materializer.materialize(htmlCandidate(body, { contentByteSize: body.byteLength + 1 })),
    ).rejects.toMatchObject({
      failureCode: "HTML_SIZE_MISMATCH",
      retryable: false,
    });
    await expect(
      materializer.materialize(htmlCandidate(body, { sourceSha256: "a".repeat(64) })),
    ).rejects.toMatchObject({
      failureCode: "SOURCE_HASH_MISMATCH",
      retryable: false,
    });
  });

  it("never follows a canonical URL when the private HTML snapshot is absent", async () => {
    const body = Buffer.from("<p>Testo ufficiale</p>", "utf8");
    const fetch = vi.fn();
    const materializer = createGcsSourceDocumentMaterializer({
      bucketName: "private-label-test",
      officialSourceHosts: ["normattiva.it"],
      storage: createFakeStorage(new Map()),
      fetch,
    });

    await expect(
      materializer.materialize(htmlCandidate(body, { storageObjectKey: null })),
    ).rejects.toMatchObject({ failureCode: "HTML_SNAPSHOT_MISSING", retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});
