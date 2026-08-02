import { createHash } from "node:crypto";

import { Storage } from "@google-cloud/storage";

import { assertOfficialAuthorityResultUrl } from "./official-authority-profile.js";
import type { OfficialSearchCandidate } from "./official-authority-profile.js";

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_OFFICIAL_HTML_BYTES = 5 * 1024 * 1024;
const SEARCH_DOWNLOAD_TIMEOUT_MS = 45_000;

export class OfficialSourceAcquisitionError extends Error {
  public constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly code: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "OfficialSourceAcquisitionError";
  }
}

export interface AcquiredOfficialSource {
  readonly candidate: OfficialSearchCandidate;
  readonly sourceFormat: "PDF" | "OFFICIAL_HTML";
  readonly canonicalUrl: string;
  readonly pdfUrl: string | null;
  readonly storageObjectKey: string;
  readonly sourceSha256: string;
  readonly contentByteSize: number;
}

export interface OfficialSourceAcquirer {
  acquire(candidate: OfficialSearchCandidate, runId: string): Promise<AcquiredOfficialSource>;
}

interface StoredObject {
  save(
    bytes: Uint8Array,
    options: {
      readonly resumable: boolean;
      readonly contentType: string;
      readonly metadata: {
        readonly cacheControl: string;
        readonly metadata: Readonly<Record<string, string>>;
      };
      readonly preconditionOpts: { readonly ifGenerationMatch: number };
    },
  ): Promise<void>;
  getMetadata(): Promise<readonly [{ readonly metadata?: Readonly<Record<string, string>> }]>;
}

interface StorageBucket {
  file(name: string): StoredObject;
}

interface PdfDocumentPreview {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<unknown>;
}

interface PdfLoadingTask {
  readonly promise: Promise<PdfDocumentPreview>;
  destroy(): Promise<void>;
}

interface PdfJsModule {
  getDocument(input: {
    readonly data: Uint8Array;
    readonly disableWorker: boolean;
    readonly isEvalSupported: boolean;
    readonly useWorkerFetch: boolean;
  }): PdfLoadingTask;
}

/** Small structural boundary keeps GCS calls easy to test without credentials. */
export interface OfficialSourceDiscoveryStorage {
  bucket(name: string): StorageBucket;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isPdfMagicBytes(bytes: Uint8Array): boolean {
  const marker = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  const ceiling = Math.min(bytes.length - marker.length, 1_024);
  for (let offset = 0; offset <= ceiling; offset += 1) {
    if (marker.every((value, index) => bytes[offset + index] === value)) return true;
  }
  return false;
}

function isGcsPreconditionFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === 412
  );
}

function retryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function mediaType(response: Response): string | null {
  const value = response.headers.get("content-type");
  if (value === null) return null;
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

async function readBoundedBytes(response: Response, maximum: number): Promise<Uint8Array> {
  if (!response.ok) {
    throw new OfficialSourceAcquisitionError(
      "Official document download failed",
      retryableHttpStatus(response.status),
      "SOURCE_DOWNLOAD_FAILED",
    );
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximum) {
    throw new OfficialSourceAcquisitionError(
      "Official document exceeds the configured size limit",
      false,
      "SOURCE_TOO_LARGE",
    );
  }
  const body = response.body;
  if (body === null) {
    throw new OfficialSourceAcquisitionError(
      "Official source returned no response body",
      false,
      "SOURCE_UNREADABLE",
    );
  }
  const reader = body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const value = result.value;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel("Official source exceeds governance size limit");
        throw new OfficialSourceAcquisitionError(
          "Official document exceeds the configured size limit",
          false,
          "SOURCE_TOO_LARGE",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function discoveryObjectKey(input: {
  readonly runId: string;
  readonly authorityProfileId: string;
  readonly digest: string;
  readonly sourceFormat: "PDF" | "OFFICIAL_HTML";
}): string {
  const extension = input.sourceFormat === "PDF" ? "pdf" : "html";
  return [
    "label-governance",
    "source-discovery",
    input.runId,
    input.authorityProfileId,
    "original",
    `${input.digest}.${extension}`,
  ].join("/");
}

function sourceKind(response: Response, bytes: Uint8Array): "PDF" | "OFFICIAL_HTML" {
  const type = mediaType(response);
  if (type === "application/pdf") {
    if (!isPdfMagicBytes(bytes)) {
      throw new OfficialSourceAcquisitionError(
        "Official source claims to be a PDF but its bytes are invalid",
        false,
        "SOURCE_PDF_MAGIC_INVALID",
      );
    }
    return "PDF";
  }
  if (type === "text/html" || type === "application/xhtml+xml") {
    // We intentionally do not parse or execute markup here. It is persisted
    // as a reproducible, private snapshot; the existing materializer later
    // removes scriptable content before any classifier/retrieval use.
    return "OFFICIAL_HTML";
  }
  throw new OfficialSourceAcquisitionError(
    "Official source returned an unsupported media type",
    false,
    "SOURCE_MEDIA_TYPE_INVALID",
  );
}

/**
 * A PDF header alone is not evidence of a readable normative document. Parse
 * the catalogue/page structure without executing PDF JavaScript or using a
 * worker. The full text extraction still occurs only in the later source
 * governance job, after the backend has persisted the staged candidate.
 */
async function assertReadablePdf(bytes: Uint8Array): Promise<void> {
  let loadingTask: PdfLoadingTask | undefined;
  try {
    const module = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJsModule;
    loadingTask = module.getDocument({
      // pdfjs can detach the supplied ArrayBuffer; keep the immutable bytes
      // intact for hashing and private GCS persistence below.
      data: new Uint8Array(bytes),
      disableWorker: true,
      isEvalSupported: false,
      useWorkerFetch: false,
    });
    const document = await loadingTask.promise;
    if (!Number.isSafeInteger(document.numPages) || document.numPages < 1) {
      throw new Error("PDF has no readable pages");
    }
    await document.getPage(1);
  } catch (error) {
    throw new OfficialSourceAcquisitionError(
      "Official source PDF is encrypted or cannot be read",
      false,
      "SOURCE_PDF_UNREADABLE",
      { cause: error },
    );
  } finally {
    await loadingTask?.destroy().catch(() => undefined);
  }
}

function assertReadableOfficialHtml(bytes: Uint8Array): void {
  try {
    const markup = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const text = markup
      .replace(/<[^>]*>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    if (!text) throw new Error("HTML has no readable text");
  } catch (error) {
    throw new OfficialSourceAcquisitionError(
      "Official source HTML snapshot cannot be read",
      false,
      "SOURCE_HTML_UNREADABLE",
      { cause: error },
    );
  }
}

/**
 * Fetches only a link emitted by a configured authority-search tool, with no
 * redirects. The original is stored under the discovery run's opaque private
 * prefix. It never reads from or writes to Chroma and never exposes bytes to
 * the caller or browser.
 */
export function createGcsOfficialSourceAcquirer(options: {
  readonly bucketName: string;
  readonly storage?: OfficialSourceDiscoveryStorage;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}): OfficialSourceAcquirer {
  const bucketName = options.bucketName.trim();
  if (!bucketName) throw new Error("GOVERNANCE_GCS_BUCKET must be configured");
  const storage = options.storage ?? (new Storage() as unknown as OfficialSourceDiscoveryStorage);
  const bucket = storage.bucket(bucketName);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? SEARCH_DOWNLOAD_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
    throw new Error("Discovery document timeout must be between 1000 and 300000 milliseconds");
  }

  const persist = async (input: {
    readonly objectKey: string;
    readonly bytes: Uint8Array;
    readonly digest: string;
    readonly sourceFormat: "PDF" | "OFFICIAL_HTML";
  }): Promise<void> => {
    const file = bucket.file(input.objectKey);
    const contentType =
      input.sourceFormat === "PDF" ? "application/pdf" : "text/html; charset=utf-8";
    try {
      await file.save(input.bytes, {
        resumable: false,
        contentType,
        metadata: {
          cacheControl: "no-store",
          metadata: {
            sha256: input.digest,
            sourceType:
              input.sourceFormat === "PDF" ? "official-normative-pdf" : "official-normative-html",
          },
        },
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    } catch (error) {
      if (!isGcsPreconditionFailure(error)) {
        throw new OfficialSourceAcquisitionError(
          "Unable to persist the private official-source snapshot",
          true,
          "SOURCE_ARCHIVE_FAILED",
          { cause: error },
        );
      }
      const [metadata] = await file.getMetadata();
      if (metadata.metadata?.["sha256"] !== input.digest) {
        throw new OfficialSourceAcquisitionError(
          "A discovery snapshot conflicts with a different source hash",
          false,
          "SOURCE_ARCHIVE_CONFLICT",
        );
      }
    }
  };

  return {
    async acquire(candidate, runId) {
      const target = assertOfficialAuthorityResultUrl(candidate.sourceUrl, candidate.profile);
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetchImplementation(target, {
          method: "GET",
          redirect: "error",
          headers: { Accept: "application/pdf,text/html,application/xhtml+xml" },
          signal: controller.signal,
        });
        const type = mediaType(response);
        const maximum = type === "application/pdf" ? MAX_PDF_BYTES : MAX_OFFICIAL_HTML_BYTES;
        const bytes = await readBoundedBytes(response, maximum);
        const sourceFormat = sourceKind(response, bytes);
        if (sourceFormat === "PDF") {
          await assertReadablePdf(bytes);
        } else {
          assertReadableOfficialHtml(bytes);
        }
        const digest = sha256(bytes);
        const objectKey = discoveryObjectKey({
          runId,
          authorityProfileId: candidate.profile.id,
          digest,
          sourceFormat,
        });
        await persist({ objectKey, bytes, digest, sourceFormat });
        return {
          candidate,
          sourceFormat,
          canonicalUrl: target.toString(),
          pdfUrl: sourceFormat === "PDF" ? target.toString() : null,
          storageObjectKey: objectKey,
          sourceSha256: digest,
          contentByteSize: bytes.byteLength,
        };
      } catch (error) {
        if (error instanceof OfficialSourceAcquisitionError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new OfficialSourceAcquisitionError(
            "Official source download timed out",
            true,
            "SOURCE_DOWNLOAD_TIMEOUT",
            { cause: error },
          );
        }
        throw new OfficialSourceAcquisitionError(
          "Official source download failed",
          true,
          "SOURCE_DOWNLOAD_FAILED",
          { cause: error },
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
