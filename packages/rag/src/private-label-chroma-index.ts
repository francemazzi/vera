import { sha256CanonicalJson } from "@vera/contracts";

import { splitRagText } from "./chunking.js";
import { RagError } from "./errors.js";
import type { ChromaCollection, ChromaMetadata, ChromaVectorMatch, ChromaVectorStore } from "./chroma-client.js";
import type { PrivateLabelEmbeddingProvider } from "./providers.js";
import {
  PRIVATE_LABEL_APPROVED_COLLECTION,
  PRIVATE_LABEL_SHARED_CATALOG_WORKSPACE_SCOPE,
  PRIVATE_LABEL_VERIFIED_COLLECTION,
  PRIVATE_LABEL_RAG_EMBEDDING_DIMENSIONS,
  PrivateLabelRagChunkSchema,
  PrivateLabelRagQuerySchema,
  PrivateLabelRagRetrievedChunkSchema,
  PrivateLabelRagSectionSchema,
  PrivateLabelRagSourceStateSchema,
  PrivateLabelRagValidityStatusSchema,
  PrivateLabelRagWorkspaceScopeSchema,
} from "./private-label-rag-types.js";
import type {
  ParsedPrivateLabelRagQuery,
  PrivateLabelRagChunk,
  PrivateLabelRagQuery,
  PrivateLabelRagRetrievedChunk,
  PrivateLabelRagSafeRetrievalResult,
  PrivateLabelRagScope,
  PrivateLabelRagSection,
} from "./private-label-rag-types.js";

const OPEN_ENDED_VALID_TO_EPOCH = Number.MAX_SAFE_INTEGER;

export interface PrivateLabelRagIndexResult {
  readonly chunksIndexed: number;
  readonly sourceVersionIds: readonly string[];
}

/** Port consumed by a future private Label governance worker. */
export interface PrivateLabelRagIndex {
  indexPreliminarySections(
    sections: readonly PrivateLabelRagSection[],
  ): Promise<PrivateLabelRagIndexResult>;
  indexApprovedSections(
    sections: readonly PrivateLabelRagSection[],
  ): Promise<PrivateLabelRagIndexResult>;
  removePreliminarySourceVersion(sourceVersionId: string): Promise<void>;
  removeApprovedSourceVersion(sourceVersionId: string): Promise<void>;
  retrievePreliminary(query: PrivateLabelRagQuery): Promise<readonly PrivateLabelRagRetrievedChunk[]>;
  retrieveApproved(query: PrivateLabelRagQuery): Promise<readonly PrivateLabelRagRetrievedChunk[]>;
  retrievePreliminarySafely(query: PrivateLabelRagQuery): Promise<PrivateLabelRagSafeRetrievalResult>;
  retrieveApprovedSafely(query: PrivateLabelRagQuery): Promise<PrivateLabelRagSafeRetrievalResult>;
}

export interface ChromaPrivateLabelRagIndexOptions {
  readonly chroma: ChromaVectorStore;
  readonly embeddingProvider: PrivateLabelEmbeddingProvider;
}

function epoch(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RagError("QUERY_INVALID", "RAG validity date is invalid");
  return parsed;
}

function chunkId(section: PrivateLabelRagSection, chunkOrdinal: number, contentHash: string): string {
  return `${section.sourceVersionId}:${section.sectionId}:${String(chunkOrdinal)}:${contentHash.slice(0, 16)}`;
}

function buildChunks(sections: readonly PrivateLabelRagSection[]): readonly PrivateLabelRagChunk[] {
  return sections.flatMap((section) =>
    splitRagText(section.text).map((text, chunkOrdinal) => {
      const contentHash = sha256CanonicalJson({
        sourceVersionId: section.sourceVersionId,
        sectionId: section.sectionId,
        chunkOrdinal,
        text,
      });
      return PrivateLabelRagChunkSchema.parse({
        ...section,
        chunkId: chunkId(section, chunkOrdinal, contentHash),
        chunkOrdinal,
        text,
        contentHash,
      });
    }),
  );
}

function assertScope(sections: readonly PrivateLabelRagSection[], scope: PrivateLabelRagScope): void {
  const invalid = sections.find(({ sourceState }) =>
    scope === "APPROVED"
      ? sourceState !== "APPROVED"
      : sourceState !== "VERIFIED" && sourceState !== "APPROVED",
  );
  if (invalid !== undefined) {
    throw new RagError("INDEX_REJECTED", "Source state does not belong to the selected RAG scope", {
      details: { scope, sourceState: invalid.sourceState, sourceVersionId: invalid.sourceVersionId },
    });
  }
  if (scope === "APPROVED") {
    const invalidValidity = sections.find(
      ({ validityStatus }) => validityStatus !== "ADMIN_CONFIRMED",
    );
    if (invalidValidity !== undefined) {
      throw new RagError(
        "INDEX_REJECTED",
        "Approved source versions require an ADMIN-confirmed validity range",
        {
          details: {
            scope,
            validityStatus: invalidValidity.validityStatus,
            sourceVersionId: invalidValidity.sourceVersionId,
          },
        },
      );
    }
  }
}

function collectionName(scope: PrivateLabelRagScope): string {
  return scope === "APPROVED"
    ? PRIVATE_LABEL_APPROVED_COLLECTION
    : PRIVATE_LABEL_VERIFIED_COLLECTION;
}

function collectionMetadata(scope: PrivateLabelRagScope): ChromaMetadata {
  return Object.freeze({
    embedding_dimensions: PRIVATE_LABEL_RAG_EMBEDDING_DIMENSIONS,
    embedding_model: "google/gemini-embedding-001",
    scope,
  });
}

function chunkMetadata(chunk: PrivateLabelRagChunk): ChromaMetadata {
  const metadata: Record<string, ChromaMetadata[keyof ChromaMetadata]> = {
    act_reference: chunk.actReference ?? "",
    canonical_reference: chunk.canonicalReference ?? "",
    pdf_reference: chunk.pdfReference ?? "",
    chunk_ordinal: chunk.chunkOrdinal,
    content_hash: chunk.contentHash,
    document_type: chunk.documentType,
    has_canonical_reference: chunk.canonicalReference !== null,
    has_pdf_reference: chunk.pdfReference !== null,
    has_page_number: chunk.pageNumber !== null,
    has_valid_to: chunk.validity.validTo !== null,
    jurisdiction: chunk.jurisdiction,
    language: chunk.language,
    page_number: chunk.pageNumber ?? 0,
    revision_label: chunk.revisionLabel,
    section_id: chunk.sectionId,
    section_title: chunk.sectionTitle,
    source_content_hash: chunk.sourceContentHash,
    source_id: chunk.sourceId,
    source_state: chunk.sourceState,
    validity_status: chunk.validityStatus,
    validity_known: chunk.validityStatus !== "UNKNOWN",
    source_version_id: chunk.sourceVersionId,
    workspace_scope: chunk.workspaceScope,
    title: chunk.title,
    valid_from: chunk.validity.validFrom,
    valid_from_epoch: epoch(chunk.validity.validFrom),
    valid_to: chunk.validity.validTo ?? "",
    valid_to_epoch:
      chunk.validity.validTo === null ? OPEN_ENDED_VALID_TO_EPOCH : epoch(chunk.validity.validTo),
  };
  if (chunk.productCategories.length > 0) metadata["product_categories"] = chunk.productCategories;
  if ((chunk.labelingTopics?.length ?? 0) > 0) {
    metadata["labeling_topics"] = chunk.labelingTopics ?? [];
  }
  return Object.freeze(metadata);
}

function assertEmbedding(vector: readonly number[]): void {
  if (
    vector.length !== PRIVATE_LABEL_RAG_EMBEDDING_DIMENSIONS ||
    vector.some((component) => !Number.isFinite(component))
  ) {
    throw new RagError("DIMENSION_MISMATCH", "Embedding dimension must be exactly 1536", {
      details: { actual: vector.length, expected: PRIVATE_LABEL_RAG_EMBEDDING_DIMENSIONS },
    });
  }
}

function sourceVersionIds(chunks: readonly PrivateLabelRagChunk[]): readonly string[] {
  return [...new Set(chunks.map(({ sourceVersionId }) => sourceVersionId))].sort();
}

function queryFilter(query: ParsedPrivateLabelRagQuery, scope: PrivateLabelRagScope): Readonly<Record<string, unknown>> {
  const filters: Readonly<Record<string, unknown>>[] = [
    {
    source_state:
        scope === "APPROVED" ? { $eq: "APPROVED" } : { $in: ["VERIFIED", "APPROVED"] },
    },
    {
      validity_status:
        scope === "APPROVED"
          ? { $eq: "ADMIN_CONFIRMED" }
          : { $in: ["ADMIN_DECLARED", "ADMIN_CONFIRMED", "AI_PROPOSED"] },
    },
    { jurisdiction: { $in: query.jurisdictions } },
    {
      $or: [
        { workspace_scope: { $eq: query.workspaceId } },
        { workspace_scope: { $eq: PRIVATE_LABEL_SHARED_CATALOG_WORKSPACE_SCOPE } },
      ],
    },
    { valid_from_epoch: { $lte: epoch(query.evaluationDate) } },
    { valid_to_epoch: { $gt: epoch(query.evaluationDate) } },
  ];
  if (query.language !== undefined) filters.push({ language: { $eq: query.language } });
  if (query.productCategory !== undefined) {
    filters.push({ product_categories: { $contains: query.productCategory } });
  }
  if (query.labelingTopics !== undefined) {
    filters.push({
      $or: query.labelingTopics.map((topic) => ({ labeling_topics: { $contains: topic } })),
    });
  }
  return { $and: filters };
}

function metadataString(metadata: ChromaMetadata, key: string): string {
  const value = metadata[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new RagError("VECTOR_STORE_INVALID", `Chroma metadata is missing ${key}`);
  }
  return value;
}

function metadataStringOrEmpty(metadata: ChromaMetadata, key: string): string {
  const value = metadata[key];
  if (typeof value !== "string") {
    throw new RagError("VECTOR_STORE_INVALID", `Chroma metadata is missing ${key}`);
  }
  return value;
}

function metadataBoolean(metadata: ChromaMetadata, key: string): boolean {
  const value = metadata[key];
  if (typeof value !== "boolean") {
    throw new RagError("VECTOR_STORE_INVALID", `Chroma metadata is missing ${key}`);
  }
  return value;
}

function metadataInteger(metadata: ChromaMetadata, key: string): number {
  const value = metadata[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RagError("VECTOR_STORE_INVALID", `Chroma metadata is missing ${key}`);
  }
  return value;
}

function metadataCategories(metadata: ChromaMetadata): readonly string[] {
  const value = metadata["product_categories"];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new RagError("VECTOR_STORE_INVALID", "Chroma product_categories metadata is invalid");
  }
  return value;
}

function metadataTopics(metadata: ChromaMetadata): readonly string[] {
  const value = metadata["labeling_topics"];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new RagError("VECTOR_STORE_INVALID", "Chroma labeling_topics metadata is invalid");
  }
  return value;
}

function matchToChunk(match: ChromaVectorMatch): PrivateLabelRagRetrievedChunk {
  if (match.document === null || match.metadata === null || match.distance === null) {
    throw new RagError("VECTOR_STORE_INVALID", "Chroma result omitted a required record field");
  }
  const metadata = match.metadata;
  const canonicalReference = metadataBoolean(metadata, "has_canonical_reference")
    ? metadataString(metadata, "canonical_reference")
    : null;
  const pdfReference = metadataBoolean(metadata, "has_pdf_reference")
    ? metadataString(metadata, "pdf_reference")
    : null;
  const pageNumber = metadataBoolean(metadata, "has_page_number")
    ? metadataInteger(metadata, "page_number")
    : null;
  const validTo = metadataBoolean(metadata, "has_valid_to")
    ? metadataString(metadata, "valid_to")
    : null;
  const chunk = PrivateLabelRagChunkSchema.parse({
    chunkId: match.id,
    sourceId: metadataString(metadata, "source_id"),
    sourceVersionId: metadataString(metadata, "source_version_id"),
    workspaceScope: PrivateLabelRagWorkspaceScopeSchema.parse(
      metadataString(metadata, "workspace_scope"),
    ),
    sourceState: PrivateLabelRagSourceStateSchema.parse(metadataString(metadata, "source_state")),
    validityStatus: PrivateLabelRagValidityStatusSchema.parse(
      metadataString(metadata, "validity_status"),
    ),
    sourceContentHash: metadataString(metadata, "source_content_hash"),
    title: metadataString(metadata, "title"),
    jurisdiction: metadataString(metadata, "jurisdiction"),
    language: metadataString(metadata, "language"),
    documentType: metadataString(metadata, "document_type"),
    actReference: metadataStringOrEmpty(metadata, "act_reference") || null,
    canonicalReference,
    pdfReference,
    revisionLabel: metadataString(metadata, "revision_label"),
    validity: { validFrom: metadataString(metadata, "valid_from"), validTo },
    productCategories: metadataCategories(metadata),
    labelingTopics: metadataTopics(metadata),
    sectionId: metadataString(metadata, "section_id"),
    sectionTitle: metadataString(metadata, "section_title"),
    pageNumber,
    chunkOrdinal: metadataInteger(metadata, "chunk_ordinal"),
    text: match.document,
    contentHash: metadataString(metadata, "content_hash"),
  });
  const score = Math.max(-1, Math.min(1, 1 - match.distance));
  const quote = chunk.text.length <= 280 ? chunk.text : `${chunk.text.slice(0, 277).trimEnd()}…`;
  return PrivateLabelRagRetrievedChunkSchema.parse({
    ...chunk,
    score,
    citation: {
      chunkId: chunk.chunkId,
      sourceVersionId: chunk.sourceVersionId,
      sourceContentHash: chunk.sourceContentHash,
      title: chunk.title,
      documentType: chunk.documentType,
      actReference: chunk.actReference,
      canonicalReference: chunk.canonicalReference,
      pdfReference: chunk.pdfReference,
      sectionId: chunk.sectionId,
      sectionTitle: chunk.sectionTitle,
      pageNumber: chunk.pageNumber,
      quote,
    },
  });
}

/** Chroma-backed RAG index with hard separation between preliminary and approved sources. */
export class ChromaPrivateLabelRagIndex implements PrivateLabelRagIndex {
  readonly #chroma: ChromaVectorStore;
  readonly #embeddingProvider: PrivateLabelEmbeddingProvider;
  readonly #collections = new Map<PrivateLabelRagScope, Promise<ChromaCollection>>();

  public constructor(options: ChromaPrivateLabelRagIndexOptions) {
    this.#chroma = options.chroma;
    this.#embeddingProvider = options.embeddingProvider;
  }

  public async indexPreliminarySections(
    sections: readonly PrivateLabelRagSection[],
  ): Promise<PrivateLabelRagIndexResult> {
    return this.#index(sections, "PRELIMINARY");
  }

  public async indexApprovedSections(
    sections: readonly PrivateLabelRagSection[],
  ): Promise<PrivateLabelRagIndexResult> {
    return this.#index(sections, "APPROVED");
  }

  public async removePreliminarySourceVersion(sourceVersionId: string): Promise<void> {
    await this.#removeSourceVersion(sourceVersionId, "PRELIMINARY");
  }

  public async removeApprovedSourceVersion(sourceVersionId: string): Promise<void> {
    await this.#removeSourceVersion(sourceVersionId, "APPROVED");
  }

  public async retrievePreliminary(
    query: PrivateLabelRagQuery,
  ): Promise<readonly PrivateLabelRagRetrievedChunk[]> {
    return this.#retrieve(query, "PRELIMINARY");
  }

  public async retrieveApproved(
    query: PrivateLabelRagQuery,
  ): Promise<readonly PrivateLabelRagRetrievedChunk[]> {
    return this.#retrieve(query, "APPROVED");
  }

  public async retrievePreliminarySafely(
    query: PrivateLabelRagQuery,
  ): Promise<PrivateLabelRagSafeRetrievalResult> {
    return this.#retrieveSafely(query, "PRELIMINARY");
  }

  public async retrieveApprovedSafely(
    query: PrivateLabelRagQuery,
  ): Promise<PrivateLabelRagSafeRetrievalResult> {
    return this.#retrieveSafely(query, "APPROVED");
  }

  async #index(
    sectionsInput: readonly PrivateLabelRagSection[],
    scope: PrivateLabelRagScope,
  ): Promise<PrivateLabelRagIndexResult> {
    const sections = sectionsInput.map((section) => PrivateLabelRagSectionSchema.parse(section));
    assertScope(sections, scope);
    const chunks = buildChunks(sections);
    if (chunks.length === 0) return { chunksIndexed: 0, sourceVersionIds: [] };
    const embeddings = await this.#embeddingProvider.embedDocuments(chunks.map(({ text }) => text));
    if (embeddings.length !== chunks.length) {
      throw new RagError("DIMENSION_MISMATCH", "Embedding provider returned an unexpected count", {
        details: { actual: embeddings.length, expected: chunks.length },
      });
    }
    embeddings.forEach(assertEmbedding);
    const collection = await this.#collection(scope);
    await this.#chroma.upsert({
      collection,
      records: chunks.map((chunk, index) => ({
        id: chunk.chunkId,
        embedding: embeddings[index] ?? [],
        document: chunk.text,
        metadata: chunkMetadata(chunk),
      })),
    });
    // Upsert succeeds before any cleanup. A transient failure in the next
    // collection (notably APPROVED during promotion) therefore leaves the
    // verified collection queryable instead of deleting its prior evidence.
    await this.#pruneStaleSourceContent(chunks, collection);
    return { chunksIndexed: chunks.length, sourceVersionIds: sourceVersionIds(chunks) };
  }

  async #retrieve(
    queryInput: PrivateLabelRagQuery,
    scope: PrivateLabelRagScope,
  ): Promise<readonly PrivateLabelRagRetrievedChunk[]> {
    const query = PrivateLabelRagQuerySchema.parse(queryInput);
    const embedding = await this.#embeddingProvider.embedQuery(query.queryText);
    assertEmbedding(embedding);
    const matches = await this.#chroma.query({
      collection: await this.#collection(scope),
      query: { embedding, limit: query.topK, where: queryFilter(query, scope) },
    });
    return matches.map(matchToChunk);
  }

  async #removeSourceVersion(sourceVersionId: string, scope: PrivateLabelRagScope): Promise<void> {
    const parsedId = PrivateLabelRagSectionSchema.shape.sourceVersionId.parse(sourceVersionId);
    await this.#chroma.delete({
      collection: await this.#collection(scope),
      where: { source_version_id: { $eq: parsedId } },
    });
  }

  /**
   * A source version may be re-materialized with a new document hash. Only
   * records from an older hash are deleted, and only after all replacement
   * records were upserted. This is deliberately not a delete-and-rebuild
   * operation: an outage can leave duplicate evidence temporarily, never an
   * empty verified source.
   */
  async #pruneStaleSourceContent(
    chunks: readonly PrivateLabelRagChunk[],
    collection: ChromaCollection,
  ): Promise<void> {
    const hashesBySourceVersion = new Map<string, string>();
    for (const chunk of chunks) {
      const existing = hashesBySourceVersion.get(chunk.sourceVersionId);
      if (existing !== undefined && existing !== chunk.sourceContentHash) {
        throw new RagError(
          "INDEX_REJECTED",
          "A source version cannot contain multiple content hashes in one index operation",
          { details: { sourceVersionId: chunk.sourceVersionId } },
        );
      }
      hashesBySourceVersion.set(chunk.sourceVersionId, chunk.sourceContentHash);
    }
    for (const [sourceVersionId, sourceContentHash] of hashesBySourceVersion) {
      await this.#chroma.delete({
        collection,
        where: {
          $and: [
            { source_version_id: { $eq: sourceVersionId } },
            { source_content_hash: { $ne: sourceContentHash } },
          ],
        },
      });
    }
  }

  async #retrieveSafely(
    query: PrivateLabelRagQuery,
    scope: PrivateLabelRagScope,
  ): Promise<PrivateLabelRagSafeRetrievalResult> {
    try {
      return {
        status: "AVAILABLE",
        scope,
        requiresReview: scope === "PRELIMINARY",
        chunks: await this.#retrieve(query, scope),
      };
    } catch (error) {
      const reason = error instanceof RagError ? `${error.code}: ${error.message}` : "UNKNOWN: RAG retrieval failed";
      return { status: "UNAVAILABLE", scope, requiresReview: true, reason };
    }
  }

  #collection(scope: PrivateLabelRagScope): Promise<ChromaCollection> {
    const existing = this.#collections.get(scope);
    if (existing !== undefined) return existing;
    const created = this.#chroma.ensureCollection({
      name: collectionName(scope),
      metadata: collectionMetadata(scope),
    });
    this.#collections.set(scope, created);
    void created.catch(() => this.#collections.delete(scope));
    return created;
  }
}
