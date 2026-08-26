import { createHash } from "node:crypto";

import { Storage } from "@google-cloud/storage";
import { z } from "zod";

import { selectOfficialHtmlBody } from "./official-html-body.js";
import { assertOfficialSourceUrl } from "./official-source-policy.js";
import { isVerifiedDiscoverySnapshotObjectKey } from "./source-discovery-snapshot.js";
import {
  MaterializedSourceDocumentSchema,
  SourceDocumentMaterializationError,
  SourceTextSectionSchema,
} from "./source-document-materializer.js";
import type {
  MaterializedSourceDocument,
  SourceDocumentMaterializer,
  SourceTextSection,
} from "./source-document-materializer.js";
import type { SourceWorkerInput } from "./source-backend-client.js";

const MAX_PDF_BYTES = 50 * 1024 * 1024;
// Official HTML is a curated server-side snapshot rather than an uploaded
// document. Keep its ceiling much lower than PDFs so a malformed portal page
// cannot consume the worker's extraction or classifier budget.
const MAX_OFFICIAL_HTML_BYTES = 5 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 2_000_000;
const MAX_CLASSIFICATION_TEXT_CHARS = 500_000;
const MAX_SECTION_CHARS = 90_000;
const HTML_MEDIA_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const HTML_SUPPRESSED_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "svg",
  "canvas",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "button",
]);
const HTML_BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);
const HTML_HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

const ExtractedTextArchiveSchema = z
  .object({
    sourceSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    // Older PDF archives did not carry a format. They are safely interpreted
    // as PDF so existing governed candidates remain readable after rollout.
    sourceFormat: z.enum(["PDF", "OFFICIAL_HTML"]).default("PDF"),
    pages: z.array(SourceTextSectionSchema).min(1).max(10_000),
  })
  .strict();

interface HtmlTextBlock {
  readonly heading: boolean;
  readonly text: string;
}

interface HtmlTag {
  readonly closing: boolean;
  readonly name: string;
  readonly selfClosing: boolean;
}

interface PdfDocument {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<{
    getTextContent(): Promise<{ readonly items: readonly unknown[] }>;
  }>;
}

interface PdfLoadingTask {
  readonly promise: Promise<PdfDocument>;
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

function sourcePrefix(input: SourceWorkerInput): string {
  return `label-governance/sources/${input.batchId}/${input.candidateId}/`;
}

type PrivateSourceObjectOrigin = "CANDIDATE" | "DISCOVERY";

function assertPrivateObjectKey(
  input: SourceWorkerInput,
  objectKey: string,
): PrivateSourceObjectOrigin {
  if (objectKey.startsWith(sourcePrefix(input))) return "CANDIDATE";
  if (isVerifiedDiscoverySnapshotObjectKey(input, objectKey)) return "DISCOVERY";
  throw new SourceDocumentMaterializationError(
    "Source object is outside its private candidate or verified discovery prefix",
    false,
    "SOURCE_OBJECT_FORBIDDEN",
  );
}

function sourceObjectKey(input: SourceWorkerInput, digest: string): string {
  return `${sourcePrefix(input)}original/${digest}.pdf`;
}

function extractedTextObjectKey(input: SourceWorkerInput, digest: string): string {
  return `${sourcePrefix(input)}extracted/${digest}.json`;
}

function boundedClassificationText(pages: readonly SourceTextSection[]): string {
  const text = pages
    .map((page) => `[${page.title}]\n${page.text}`)
    .join("\n\n")
    .slice(0, MAX_CLASSIFICATION_TEXT_CHARS)
    .trim();
  if (!text) {
    throw new SourceDocumentMaterializationError(
      "The source document contains no extractable text",
      false,
      "SOURCE_NO_TEXT",
    );
  }
  return text;
}

function splitPageText(pageNumber: number, text: string): readonly SourceTextSection[] {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) return [];
  const result: SourceTextSection[] = [];
  let offset = 0;
  let part = 1;
  while (offset < normalized.length) {
    let end = Math.min(offset + MAX_SECTION_CHARS, normalized.length);
    if (end < normalized.length) {
      const whitespace = normalized.lastIndexOf(" ", end);
      if (whitespace > offset + MAX_SECTION_CHARS / 2) end = whitespace;
    }
    const value = normalized.slice(offset, end).trim();
    if (value) {
      result.push({
        id: `page-${String(pageNumber)}-part-${String(part)}`,
        title:
          part === 1
            ? `Page ${String(pageNumber)}`
            : `Page ${String(pageNumber)} (part ${String(part)})`,
        pageNumber,
        text: value,
      });
    }
    offset = end;
    while (normalized[offset] === " ") offset += 1;
    part += 1;
  }
  return result;
}

const HTML_CONTROL_CHAR_PATTERN = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  "gu",
);

function normalizeExtractedHtmlText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\u00a0/gu, " ")
    .replace(HTML_CONTROL_CHAR_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    copy: "©",
    gt: ">",
    laquo: "«",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    mdash: "—",
    nbsp: " ",
    ndash: "–",
    quot: '"',
    raquo: "»",
    rdquo: "”",
    reg: "®",
    rsquo: "’",
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/giu, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return namedEntities[normalized] ?? match;
  });
}

function findHtmlTagEnd(markup: string, start: number): number {
  let quote: "'" | '"' | null = null;
  for (let index = start + 1; index < markup.length; index += 1) {
    const character = markup[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function parseHtmlTag(rawTag: string): HtmlTag | null {
  const content = rawTag.slice(1, -1).trim();
  if (!content || content.startsWith("!") || content.startsWith("?")) return null;
  const closing = content.startsWith("/");
  const name = (closing ? content.slice(1) : content).match(/^[a-z][a-z0-9:-]*/iu)?.[0];
  if (!name) return null;
  return {
    closing,
    name: name.toLowerCase(),
    selfClosing: !closing && /\/\s*$/u.test(content),
  };
}

/**
 * A deliberately non-DOM HTML extractor. It never evaluates markup, loads
 * subresources, resolves links or instantiates a browser. Scriptable and
 * non-content elements are dropped while basic block and heading boundaries
 * are retained for retrieval sections.
 */
function extractHtmlBlocks(markup: string): readonly HtmlTextBlock[] {
  const blocks: HtmlTextBlock[] = [];
  let buffer = "";
  let heading = false;
  let suppressed: { readonly tag: string; depth: number } | null = null;
  let totalCharacters = 0;

  const flush = (): void => {
    const text = normalizeExtractedHtmlText(buffer);
    buffer = "";
    if (!text) return;
    totalCharacters += text.length;
    if (totalCharacters > MAX_EXTRACTED_TEXT_CHARS) {
      throw new SourceDocumentMaterializationError(
        "The extracted official HTML text exceeds the worker safety limit",
        false,
        "HTML_TEXT_TOO_LARGE",
      );
    }
    blocks.push({ heading, text });
  };

  let index = 0;
  while (index < markup.length) {
    if (markup.startsWith("<!--", index)) {
      const commentEnd = markup.indexOf("-->", index + 4);
      index = commentEnd === -1 ? markup.length : commentEnd + 3;
      continue;
    }
    const character = markup[index];
    if (character !== "<") {
      if (suppressed === null && character !== undefined) buffer += character;
      index += 1;
      continue;
    }
    const tagEnd = findHtmlTagEnd(markup, index);
    if (tagEnd === -1) {
      // Treat a malformed trailing tag as inert text only when it was not in
      // a suppressed script/style area; it cannot cause code execution.
      if (suppressed === null) buffer += markup.slice(index);
      break;
    }
    const tag = parseHtmlTag(markup.slice(index, tagEnd + 1));
    index = tagEnd + 1;
    if (tag === null) continue;

    if (suppressed !== null) {
      if (tag.name === suppressed.tag) {
        if (tag.closing) {
          suppressed.depth -= 1;
          if (suppressed.depth === 0) suppressed = null;
        } else if (!tag.selfClosing) {
          suppressed.depth += 1;
        }
      }
      continue;
    }

    if (!tag.closing && HTML_SUPPRESSED_TAGS.has(tag.name)) {
      flush();
      heading = false;
      if (!tag.selfClosing) suppressed = { tag: tag.name, depth: 1 };
      continue;
    }

    if (HTML_HEADING_TAGS.has(tag.name)) {
      if (tag.closing) {
        flush();
        heading = false;
      } else {
        flush();
        heading = true;
      }
      continue;
    }

    if (HTML_BLOCK_TAGS.has(tag.name)) {
      flush();
      heading = false;
    }
  }
  flush();
  if (blocks.length === 0) {
    throw new SourceDocumentMaterializationError(
      "The official HTML snapshot contains no extractable text",
      false,
      "HTML_NO_TEXT",
    );
  }
  return blocks;
}

function splitHtmlText(
  sectionNumber: number,
  title: string,
  text: string,
): readonly SourceTextSection[] {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) return [];
  const result: SourceTextSection[] = [];
  let offset = 0;
  let part = 1;
  while (offset < normalized.length) {
    let end = Math.min(offset + MAX_SECTION_CHARS, normalized.length);
    if (end < normalized.length) {
      const whitespace = normalized.lastIndexOf(" ", end);
      if (whitespace > offset + MAX_SECTION_CHARS / 2) end = whitespace;
    }
    const value = normalized.slice(offset, end).trim();
    if (value) {
      const suffix = part === 1 ? "" : ` (part ${String(part)})`;
      result.push({
        id: `section-${String(sectionNumber)}-part-${String(part)}`,
        title: `${title}${suffix}`.slice(0, 300),
        pageNumber: null,
        text: value,
      });
    }
    offset = end;
    while (normalized[offset] === " ") offset += 1;
    part += 1;
  }
  return result;
}

function extractHtmlSections(
  bytes: Uint8Array,
  fallbackTitle: string | null,
): readonly SourceTextSection[] {
  let markup: string;
  try {
    markup = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new SourceDocumentMaterializationError(
      "The official HTML snapshot is not valid UTF-8",
      false,
      "HTML_UNREADABLE",
      { cause: error },
    );
  }
  const blocks = extractHtmlBlocks(selectOfficialHtmlBody(markup));
  const sections: SourceTextSection[] = [];
  let title = fallbackTitle?.slice(0, 300) || "Official source snapshot";
  let buffer: string[] = [];
  let sectionNumber = 1;
  const flush = (): void => {
    const text = buffer.join("\n\n").trim();
    buffer = [];
    if (!text) return;
    sections.push(...splitHtmlText(sectionNumber, title, text));
    sectionNumber += 1;
  };
  for (const block of blocks) {
    if (block.heading) {
      flush();
      title = block.text.slice(0, 300);
    }
    buffer.push(block.text);
  }
  flush();
  if (sections.length === 0) {
    throw new SourceDocumentMaterializationError(
      "The official HTML snapshot contains no retrievable sections",
      false,
      "HTML_NO_TEXT",
    );
  }
  return sections;
}

function textFromPdfItem(item: unknown): string {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return "";
  const value = (item as Record<string, unknown>)["str"];
  return typeof value === "string" ? value : "";
}

async function extractPdfPages(bytes: Uint8Array): Promise<readonly SourceTextSection[]> {
  let pdf: PdfDocument | undefined;
  let loadingTask: PdfLoadingTask | undefined;
  try {
    const module = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJsModule;
    loadingTask = module.getDocument({
      // pdfjs may transfer/detach the supplied ArrayBuffer. Preserve the
      // archived-source buffer for its SHA-256 and byte-size audit values.
      data: new Uint8Array(bytes),
      disableWorker: true,
      isEvalSupported: false,
      useWorkerFetch: false,
    });
    pdf = await loadingTask.promise;
    const pages: SourceTextSection[] = [];
    let characterCount = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.map(textFromPdfItem).join(" ");
      const sections = splitPageText(pageNumber, pageText);
      characterCount += sections.reduce((total, section) => total + section.text.length, 0);
      if (characterCount > MAX_EXTRACTED_TEXT_CHARS) {
        throw new SourceDocumentMaterializationError(
          "The extracted PDF text exceeds the worker safety limit",
          false,
          "PDF_TEXT_TOO_LARGE",
        );
      }
      pages.push(...sections);
    }
    if (pages.length === 0) {
      throw new SourceDocumentMaterializationError(
        "The PDF contains no extractable text",
        false,
        "PDF_NO_TEXT",
      );
    }
    return pages;
  } catch (error) {
    if (error instanceof SourceDocumentMaterializationError) throw error;
    throw new SourceDocumentMaterializationError(
      "The PDF is encrypted or cannot be read",
      false,
      "PDF_UNREADABLE",
      { cause: error },
    );
  } finally {
    // pdfjs owns the worker/document lifecycle on the loading task (not on
    // PDFDocumentProxy). Destroy it even after an unreadable/encrypted PDF so
    // a failed source cannot retain worker resources in a warm Cloud Run VM.
    await loadingTask?.destroy().catch(() => undefined);
  }
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
  if (!response.ok || response.body === null) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new SourceDocumentMaterializationError(
      "Official source PDF download failed",
      retryable,
      "SOURCE_DOWNLOAD_FAILED",
    );
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES) {
    throw new SourceDocumentMaterializationError(
      "Official source PDF exceeds the maximum size",
      false,
      "PDF_TOO_LARGE",
    );
  }
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const value = result.value;
      size += value.byteLength;
      if (size > MAX_PDF_BYTES) {
        await reader.cancel("PDF exceeds governance size limit");
        throw new SourceDocumentMaterializationError(
          "Official source PDF exceeds the maximum size",
          false,
          "PDF_TOO_LARGE",
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

function isGcsPreconditionFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === 412
  );
}

/**
 * Server-side materializer for the private Label bucket. It is the only
 * component that reads source documents; browser uploads use a signed write
 * directly to the same private prefix and never receive an extraction/result
 * URL. Official HTML is always already snapshotted there by the backend.
 */
export function createGcsSourceDocumentMaterializer(options: {
  readonly bucketName: string;
  readonly officialSourceHosts: readonly string[];
  readonly storage?: Storage;
  readonly fetch?: typeof globalThis.fetch;
}): SourceDocumentMaterializer {
  const bucketName = options.bucketName.trim();
  if (!bucketName) throw new Error("GOVERNANCE_GCS_BUCKET must be configured");
  const storage = options.storage ?? new Storage();
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const bucket = storage.bucket(bucketName);

  const archiveBytes = async (
    objectKey: string,
    bytes: Uint8Array,
    digest: string,
  ): Promise<void> => {
    const file = bucket.file(objectKey);
    try {
      await file.save(bytes, {
        resumable: false,
        contentType: "application/pdf",
        metadata: {
          cacheControl: "no-store",
          metadata: { sha256: digest, sourceType: "normative-pdf" },
        },
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    } catch (error) {
      if (!isGcsPreconditionFailure(error)) {
        throw new SourceDocumentMaterializationError(
          "Unable to archive the private source PDF",
          true,
          "SOURCE_ARCHIVE_FAILED",
          { cause: error },
        );
      }
      const [metadata] = await file.getMetadata();
      if (metadata.metadata?.["sha256"] !== digest) {
        throw new SourceDocumentMaterializationError(
          "A private source object conflicts with its content hash",
          false,
          "SOURCE_ARCHIVE_CONFLICT",
        );
      }
    }
  };

  const downloadPrivatePdf = async (
    input: SourceWorkerInput,
  ): Promise<{ bytes: Uint8Array; objectKey: string }> => {
    if (input.storageObjectKey === null) {
      if (input.pdfUrl === null) {
        throw new SourceDocumentMaterializationError(
          "Source has neither a private PDF nor an official PDF URL",
          false,
          "SOURCE_DOCUMENT_MISSING",
        );
      }
      assertOfficialSourceUrl(input.pdfUrl, options.officialSourceHosts);
      const response = await fetchImplementation(input.pdfUrl, {
        method: "GET",
        redirect: "error",
        headers: { Accept: "application/pdf" },
      });
      const mediaType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (mediaType !== "application/pdf") {
        throw new SourceDocumentMaterializationError(
          "Official source URL did not return a PDF media type",
          false,
          "SOURCE_MEDIA_TYPE_INVALID",
        );
      }
      const bytes = await readBoundedResponse(response);
      const digest = sha256(bytes);
      const objectKey = sourceObjectKey(input, digest);
      await archiveBytes(objectKey, bytes, digest);
      return { bytes, objectKey };
    }

    assertPrivateObjectKey(input, input.storageObjectKey);
    const file = bucket.file(input.storageObjectKey);
    try {
      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size ?? "0");
      if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PDF_BYTES) {
        throw new SourceDocumentMaterializationError(
          "Private source PDF has an invalid size",
          false,
          "PDF_SIZE_INVALID",
        );
      }
      const mediaType = metadata.contentType?.split(";", 1)[0]?.trim().toLowerCase();
      if (mediaType !== "application/pdf") {
        throw new SourceDocumentMaterializationError(
          "Private source object does not have a PDF media type",
          false,
          "SOURCE_MEDIA_TYPE_INVALID",
        );
      }
      const [downloaded] = await file.download();
      const bytes = new Uint8Array(downloaded);
      return { bytes, objectKey: input.storageObjectKey };
    } catch (error) {
      if (error instanceof SourceDocumentMaterializationError) throw error;
      throw new SourceDocumentMaterializationError(
        "Unable to read the private source PDF",
        true,
        "SOURCE_ARCHIVE_READ_FAILED",
        { cause: error },
      );
    }
  };

  /**
   * Curated HTML is deliberately not fetched from canonicalUrl here. The
   * backend snapshotter validates the official URL and writes a bounded,
   * immutable copy into this candidate's private GCS prefix first. This keeps
   * the worker away from the public internet and makes source hash/audit
   * evidence reproducible.
   */
  const downloadPrivateOfficialHtml = async (
    input: SourceWorkerInput,
  ): Promise<{ bytes: Uint8Array; objectKey: string }> => {
    if (input.storageObjectKey === null) {
      throw new SourceDocumentMaterializationError(
        "Official HTML sources require a private snapshot",
        false,
        "HTML_SNAPSHOT_MISSING",
      );
    }
    if (input.canonicalUrl === null) {
      throw new SourceDocumentMaterializationError(
        "Official HTML sources require an official canonical URL",
        false,
        "HTML_CANONICAL_URL_MISSING",
      );
    }
    if (input.sourceSha256 === null) {
      throw new SourceDocumentMaterializationError(
        "Official HTML snapshots require a declared source hash",
        false,
        "HTML_HASH_MISSING",
      );
    }
    if (input.contentByteSize === null) {
      throw new SourceDocumentMaterializationError(
        "Official HTML snapshots require a declared source size",
        false,
        "HTML_SIZE_MISSING",
      );
    }
    const sourceOrigin = assertPrivateObjectKey(input, input.storageObjectKey);
    // A discovery snapshot has already been accepted by the backend against
    // its versioned authority profile. Do not replace that per-country policy
    // with the deployment's intentionally narrow static allowlist. Generic
    // candidate snapshots retain the static-host guard.
    if (sourceOrigin !== "DISCOVERY") {
      try {
        assertOfficialSourceUrl(input.canonicalUrl, options.officialSourceHosts);
      } catch (error) {
        throw new SourceDocumentMaterializationError(
          "Official HTML source URL is not allowed",
          false,
          "HTML_CANONICAL_URL_INVALID",
          { cause: error },
        );
      }
    }
    const file = bucket.file(input.storageObjectKey);
    try {
      const [metadata] = await file.getMetadata();
      const declaredSize = Number(metadata.size ?? "0");
      if (
        !Number.isSafeInteger(declaredSize) ||
        declaredSize < 1 ||
        declaredSize > MAX_OFFICIAL_HTML_BYTES
      ) {
        throw new SourceDocumentMaterializationError(
          "Private official HTML snapshot has an invalid size",
          false,
          "HTML_SIZE_INVALID",
        );
      }
      if (input.contentByteSize !== declaredSize) {
        throw new SourceDocumentMaterializationError(
          "Private official HTML snapshot size does not match its candidate metadata",
          false,
          "HTML_SIZE_MISMATCH",
        );
      }
      const mediaType = metadata.contentType?.split(";", 1)[0]?.trim().toLowerCase();
      if (mediaType === undefined || !HTML_MEDIA_TYPES.has(mediaType)) {
        throw new SourceDocumentMaterializationError(
          "Private official HTML snapshot has an invalid media type",
          false,
          "HTML_MEDIA_TYPE_INVALID",
        );
      }
      const [downloaded] = await file.download();
      const bytes = new Uint8Array(downloaded);
      if (bytes.byteLength !== declaredSize) {
        throw new SourceDocumentMaterializationError(
          "Private official HTML snapshot size does not match its metadata",
          false,
          "HTML_SIZE_MISMATCH",
        );
      }
      const digest = sha256(bytes);
      if (digest !== input.sourceSha256) {
        throw new SourceDocumentMaterializationError(
          "Private official HTML snapshot hash does not match its source hash",
          false,
          "SOURCE_HASH_MISMATCH",
        );
      }
      return { bytes, objectKey: input.storageObjectKey };
    } catch (error) {
      if (error instanceof SourceDocumentMaterializationError) throw error;
      throw new SourceDocumentMaterializationError(
        "Unable to read the private official HTML snapshot",
        true,
        "HTML_ARCHIVE_READ_FAILED",
        { cause: error },
      );
    }
  };

  const loadOrExtractText = async (input: {
    readonly source: SourceWorkerInput;
    readonly digest: string;
    readonly extract: () => Promise<readonly SourceTextSection[]>;
  }): Promise<{ readonly objectKey: string; readonly pages: readonly SourceTextSection[] }> => {
    const objectKey = extractedTextObjectKey(input.source, input.digest);
    const file = bucket.file(objectKey);
    try {
      const [exists] = await file.exists();
      if (exists) {
        const [data] = await file.download();
        const parsed = ExtractedTextArchiveSchema.parse(JSON.parse(data.toString("utf8")));
        if (parsed.sourceSha256 !== input.digest) {
          throw new SourceDocumentMaterializationError(
            "Extracted text archive does not match its source hash",
            false,
            "EXTRACTED_TEXT_CONFLICT",
          );
        }
        if (parsed.sourceFormat !== input.source.sourceFormat) {
          throw new SourceDocumentMaterializationError(
            "Extracted text archive does not match its source format",
            false,
            "EXTRACTED_TEXT_CONFLICT",
          );
        }
        return { objectKey, pages: parsed.pages };
      }
    } catch (error) {
      if (error instanceof SourceDocumentMaterializationError) throw error;
      throw new SourceDocumentMaterializationError(
        "Unable to read the private extracted text archive",
        true,
        "EXTRACTED_TEXT_READ_FAILED",
        { cause: error },
      );
    }

    const pages = await input.extract();
    const content = Buffer.from(
      JSON.stringify({
        sourceSha256: input.digest,
        sourceFormat: input.source.sourceFormat,
        pages,
      }),
      "utf8",
    );
    try {
      await file.save(content, {
        resumable: false,
        contentType: "application/json",
        metadata: { cacheControl: "no-store", metadata: { sourceSha256: input.digest } },
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    } catch (error) {
      if (!isGcsPreconditionFailure(error)) {
        throw new SourceDocumentMaterializationError(
          "Unable to persist private extracted text",
          true,
          "EXTRACTED_TEXT_ARCHIVE_FAILED",
          { cause: error },
        );
      }
    }
    return { objectKey, pages };
  };

  return {
    async materialize(input): Promise<MaterializedSourceDocument> {
      if (input.sourceFormat === "OFFICIAL_HTML") {
        const source = await downloadPrivateOfficialHtml(input);
        const digest = sha256(source.bytes);
        const extracted = await loadOrExtractText({
          source: input,
          digest,
          extract: async () =>
            await Promise.resolve(extractHtmlSections(source.bytes, input.sourceTitle)),
        });
        return MaterializedSourceDocumentSchema.parse({
          artifacts: {
            sourceSha256: digest,
            storageObjectKey: source.objectKey,
            extractedTextObjectKey: extracted.objectKey,
            contentByteSize: source.bytes.byteLength,
          },
          classificationText: boundedClassificationText(extracted.pages),
          sections: extracted.pages,
        });
      }
      const source = await downloadPrivatePdf(input);
      const contentByteSize = source.bytes.byteLength;
      if (!isPdfMagicBytes(source.bytes)) {
        throw new SourceDocumentMaterializationError(
          "Source does not contain PDF magic bytes",
          false,
          "PDF_MAGIC_BYTES_INVALID",
        );
      }
      const digest = sha256(source.bytes);
      if (input.sourceSha256 !== null && input.sourceSha256 !== digest) {
        throw new SourceDocumentMaterializationError(
          "Private source hash does not match its bytes",
          false,
          "SOURCE_HASH_MISMATCH",
        );
      }
      const extracted = await loadOrExtractText({
        source: input,
        digest,
        extract: async () => await extractPdfPages(source.bytes),
      });
      return MaterializedSourceDocumentSchema.parse({
        artifacts: {
          sourceSha256: digest,
          storageObjectKey: source.objectKey,
          extractedTextObjectKey: extracted.objectKey,
          contentByteSize,
        },
        classificationText: boundedClassificationText(extracted.pages),
        sections: extracted.pages,
      });
    },
  };
}
