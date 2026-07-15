import { sha256CanonicalJson } from "@vera/contracts";

import { RagError } from "./errors.js";
import { RagChunkSchema, RagSourceSectionSchema } from "./types.js";
import type { RagChunk, RagCitation, RagSourceSection } from "./types.js";

const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_OVERLAP_CHARS = 160;
const MIN_MAX_CHARS = 200;
const MAX_MAX_CHARS = 8000;

export interface ChunkingOptions {
  readonly maxChars?: number;
  readonly overlapChars?: number;
}

interface NormalizedChunkingOptions {
  readonly maxChars: number;
  readonly overlapChars: number;
}

function normalizeOptions(options: ChunkingOptions = {}): NormalizedChunkingOptions {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  if (!Number.isSafeInteger(maxChars) || maxChars < MIN_MAX_CHARS || maxChars > MAX_MAX_CHARS) {
    throw new RagError(
      "CONFIGURATION_INVALID",
      `maxChars must be an integer between ${String(MIN_MAX_CHARS)} and ${String(MAX_MAX_CHARS)}`,
    );
  }

  if (
    !Number.isSafeInteger(overlapChars) ||
    overlapChars < 0 ||
    overlapChars >= Math.floor(maxChars / 2)
  ) {
    throw new RagError(
      "CONFIGURATION_INVALID",
      "overlapChars must be a non-negative integer smaller than half of maxChars",
    );
  }

  return { maxChars, overlapChars };
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function findBreak(text: string, start: number, hardEnd: number): number {
  if (hardEnd >= text.length) return text.length;

  const softWindowStart = Math.max(start + 1, hardEnd - 160);
  const candidates = [". ", "; ", ": ", "\n", " "];
  for (const candidate of candidates) {
    const index = text.lastIndexOf(candidate, hardEnd);
    if (index >= softWindowStart) return index + candidate.length;
  }

  return hardEnd;
}

function splitText(text: string, options: NormalizedChunkingOptions): readonly string[] {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= options.maxChars) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const hardEnd = Math.min(normalized.length, start + options.maxChars);
    const end = findBreak(normalized, start, hardEnd);
    const chunk = normalized.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    if (end >= normalized.length) break;
    start = Math.max(0, end - options.overlapChars);
  }

  return chunks;
}

function computeChunkId(
  section: RagSourceSection,
  chunkOrdinal: number,
  contentHash: string,
): string {
  return `${section.sourceVersionId}:${section.sectionId}:${String(chunkOrdinal)}:${contentHash.slice(
    0,
    16,
  )}`;
}

export function chunkApprovedSourceSections(
  sections: readonly RagSourceSection[],
  options: ChunkingOptions = {},
): readonly RagChunk[] {
  const parsedSections = sections.map((section) => RagSourceSectionSchema.parse(section));
  const normalizedOptions = normalizeOptions(options);
  const chunks: RagChunk[] = [];

  for (const section of parsedSections) {
    if (section.sourceState !== "APPROVED") {
      throw new RagError("INDEX_REJECTED", "Only APPROVED source versions may be indexed", {
        details: {
          sourceVersionId: section.sourceVersionId,
          sourceState: section.sourceState,
        },
      });
    }

    splitText(section.text, normalizedOptions).forEach((text, chunkOrdinal) => {
      const contentHash = sha256CanonicalJson({
        sourceVersionId: section.sourceVersionId,
        sectionId: section.sectionId,
        chunkOrdinal,
        text,
      });
      chunks.push(
        RagChunkSchema.parse({
          chunkId: computeChunkId(section, chunkOrdinal, contentHash),
          sourceId: section.sourceId,
          sourceVersionId: section.sourceVersionId,
          sourceType: section.sourceType,
          sourceState: "APPROVED",
          domain: section.domain,
          jurisdiction: section.jurisdiction,
          title: section.title,
          stableReference: section.stableReference,
          versionLabel: section.versionLabel,
          license: section.license,
          sourceContentHash: section.sourceContentHash,
          validity: section.validity,
          sectionId: section.sectionId,
          sectionTitle: section.sectionTitle,
          chunkOrdinal,
          text,
          contentHash,
          validationScope: section.validationScope,
        }),
      );
    });
  }

  return chunks;
}

export function citationFromChunk(chunk: RagChunk): RagCitation {
  const quote = chunk.text.length <= 280 ? chunk.text : `${chunk.text.slice(0, 277).trimEnd()}…`;
  return {
    chunkId: chunk.chunkId,
    sourceId: chunk.sourceId,
    sourceVersionId: chunk.sourceVersionId,
    sourceContentHash: chunk.sourceContentHash,
    sectionId: chunk.sectionId,
    sectionTitle: chunk.sectionTitle,
    chunkOrdinal: chunk.chunkOrdinal,
    quote,
    domain: chunk.domain,
    jurisdiction: chunk.jurisdiction,
    validity: chunk.validity,
  };
}
