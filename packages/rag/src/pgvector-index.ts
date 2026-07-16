import type { Pool, PoolClient } from "pg";

import { RagError } from "./errors.js";
import type { EmbeddingProvider } from "./providers.js";
import { citationFromChunk, chunkApprovedSourceSections } from "./chunking.js";
import { RagChunkSchema, RagRetrievalQuerySchema, RagRetrievedChunkSchema } from "./types.js";
import type {
  ParsedRagRetrievalQuery,
  RagChunk,
  RagRetrievalQuery,
  RagRetrievedChunk,
  RagSafeRetrievalResult,
  RagSourceSection,
} from "./types.js";

type Queryable = Pick<Pool | PoolClient, "query">;

const DEFAULT_TABLE_NAME = "rag_chunks";
const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/u;

export interface PgVectorRagIndexOptions {
  readonly db: Queryable;
  readonly embeddingProvider: EmbeddingProvider;
  readonly dimensions: number;
  readonly tableName?: string;
}

export interface RagIndexResult {
  readonly chunksIndexed: number;
  readonly sourceVersionIds: readonly string[];
}

interface StoredChunkRow {
  readonly chunk_id: string;
  readonly source_id: string;
  readonly source_version_id: string;
  readonly source_type: string;
  readonly source_state: "APPROVED";
  readonly domain: string;
  readonly jurisdiction: string;
  readonly title: string;
  readonly stable_reference: string;
  readonly version_label: string;
  readonly license: string;
  readonly source_content_hash: string;
  readonly valid_from: Date;
  readonly valid_to: Date | null;
  readonly section_id: string;
  readonly section_title: string;
  readonly chunk_ordinal: number;
  readonly content: string;
  readonly content_hash: string;
  readonly validation_scope: "TECHNICAL_DEMO";
  readonly score: number;
}

function quoteIdentifier(identifier: string): string {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new RagError("CONFIGURATION_INVALID", "Invalid SQL identifier for RAG table", {
      details: { identifier },
    });
  }
  return `"${identifier}"`;
}

function normalizeDimensions(dimensions: number): number {
  if (!Number.isSafeInteger(dimensions) || dimensions < 2 || dimensions > 4096) {
    throw new RagError("CONFIGURATION_INVALID", "dimensions must be an integer between 2 and 4096");
  }
  return dimensions;
}

function vectorLiteral(vector: readonly number[], dimensions: number): string {
  if (vector.length !== dimensions || vector.some((value) => !Number.isFinite(value))) {
    throw new RagError("DIMENSION_MISMATCH", "Embedding vector dimension mismatch", {
      details: { expected: dimensions, actual: vector.length },
    });
  }
  return `[${vector.map((value) => String(value)).join(",")}]`;
}

function isoDate(value: Date): string {
  return value.toISOString();
}

function rowToChunk(row: StoredChunkRow): RagChunk {
  return RagChunkSchema.parse({
    chunkId: row.chunk_id,
    sourceId: row.source_id,
    sourceVersionId: row.source_version_id,
    sourceType: row.source_type,
    sourceState: row.source_state,
    domain: row.domain,
    jurisdiction: row.jurisdiction,
    title: row.title,
    stableReference: row.stable_reference,
    versionLabel: row.version_label,
    license: row.license,
    sourceContentHash: row.source_content_hash,
    validity: {
      validFrom: isoDate(row.valid_from),
      validTo: row.valid_to === null ? null : isoDate(row.valid_to),
    },
    sectionId: row.section_id,
    sectionTitle: row.section_title,
    chunkOrdinal: row.chunk_ordinal,
    text: row.content,
    contentHash: row.content_hash,
    validationScope: row.validation_scope,
  });
}

function sourceVersionIds(chunks: readonly RagChunk[]): readonly string[] {
  return [...new Set(chunks.map((chunk) => chunk.sourceVersionId))].sort();
}

export class PgVectorRagIndex {
  readonly #db: Queryable;
  readonly #embeddingProvider: EmbeddingProvider;
  readonly #dimensions: number;
  readonly #tableName: string;
  readonly #quotedTableName: string;

  public constructor(options: PgVectorRagIndexOptions) {
    this.#db = options.db;
    this.#embeddingProvider = options.embeddingProvider;
    this.#dimensions = normalizeDimensions(options.dimensions);
    this.#tableName = options.tableName ?? DEFAULT_TABLE_NAME;
    this.#quotedTableName = quoteIdentifier(this.#tableName);
  }

  public async ensureSchema(): Promise<void> {
    await this.#db.query("CREATE EXTENSION IF NOT EXISTS vector");
    await this.#db.query(`
      CREATE TABLE IF NOT EXISTS ${this.#quotedTableName} (
        chunk_id TEXT PRIMARY KEY,
        source_id UUID NOT NULL,
        source_version_id UUID NOT NULL,
        source_type TEXT NOT NULL,
        source_state TEXT NOT NULL,
        domain TEXT NOT NULL,
        jurisdiction TEXT NOT NULL,
        title TEXT NOT NULL,
        stable_reference TEXT NOT NULL,
        version_label TEXT NOT NULL,
        license TEXT NOT NULL,
        source_content_hash TEXT NOT NULL,
        valid_from TIMESTAMPTZ(6) NOT NULL,
        valid_to TIMESTAMPTZ(6),
        section_id TEXT NOT NULL,
        section_title TEXT NOT NULL,
        chunk_ordinal INTEGER NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding vector(${String(this.#dimensions)}) NOT NULL,
        validation_scope TEXT NOT NULL,
        created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
        CONSTRAINT ${this.#tableName}_approved_only_check CHECK (source_state = 'APPROVED'),
        CONSTRAINT ${this.#tableName}_scope_check CHECK (validation_scope = 'TECHNICAL_DEMO'),
        CONSTRAINT ${this.#tableName}_validity_check CHECK (valid_to IS NULL OR valid_to > valid_from),
        CONSTRAINT ${this.#tableName}_source_section_ordinal_key UNIQUE (
          source_version_id,
          section_id,
          chunk_ordinal
        )
      )
    `);
    await this.#db.query(
      `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${this.#tableName}_scope_idx`)}
       ON ${this.#quotedTableName}(domain, jurisdiction, valid_from, valid_to)`,
    );
    await this.#db.query(
      `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${this.#tableName}_version_idx`)}
       ON ${this.#quotedTableName}(source_version_id)`,
    );
  }

  public async indexApprovedSections(
    sections: readonly RagSourceSection[],
  ): Promise<RagIndexResult> {
    const chunks = chunkApprovedSourceSections(sections);
    if (chunks.length === 0) return { chunksIndexed: 0, sourceVersionIds: [] };

    const embeddings = await this.#embeddingProvider.embedTexts(chunks.map((chunk) => chunk.text));
    if (embeddings.length !== chunks.length) {
      throw new RagError("DIMENSION_MISMATCH", "Embedding provider returned an unexpected count", {
        details: { expected: chunks.length, actual: embeddings.length },
      });
    }

    for (const [index, chunk] of chunks.entries()) {
      const embedding = embeddings[index];
      if (embedding === undefined) {
        throw new RagError("DIMENSION_MISMATCH", "Embedding provider omitted a vector");
      }
      await this.#insertChunk(chunk, vectorLiteral(embedding, this.#dimensions));
    }

    return { chunksIndexed: chunks.length, sourceVersionIds: sourceVersionIds(chunks) };
  }

  public async retrieve(query: RagRetrievalQuery): Promise<readonly RagRetrievedChunk[]> {
    const parsed = RagRetrievalQuerySchema.parse(query);
    const embeddings = await this.#embeddingProvider.embedTexts([parsed.queryText]);
    const embedding = embeddings[0];
    if (embedding === undefined) {
      throw new RagError("DIMENSION_MISMATCH", "Embedding provider omitted the query vector");
    }

    return this.#retrieveByVector(parsed, vectorLiteral(embedding, this.#dimensions));
  }

  public async retrieveSafely(query: RagRetrievalQuery): Promise<RagSafeRetrievalResult> {
    try {
      return { status: "AVAILABLE", chunks: [...(await this.retrieve(query))] };
    } catch (error) {
      if (error instanceof RagError) {
        return {
          status: "UNAVAILABLE",
          requiresReview: true,
          reason: `${error.code}: ${error.message}`,
        };
      }
      return {
        status: "UNAVAILABLE",
        requiresReview: true,
        reason: "UNKNOWN: RAG retrieval failed",
      };
    }
  }

  async #insertChunk(chunk: RagChunk, embedding: string): Promise<void> {
    await this.#db.query(
      `
        INSERT INTO ${this.#quotedTableName} (
          chunk_id,
          source_id,
          source_version_id,
          source_type,
          source_state,
          domain,
          jurisdiction,
          title,
          stable_reference,
          version_label,
          license,
          source_content_hash,
          valid_from,
          valid_to,
          section_id,
          section_title,
          chunk_ordinal,
          content,
          content_hash,
          embedding,
          validation_scope
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13::timestamptz, $14::timestamptz, $15, $16, $17, $18, $19, $20::vector, $21
        )
        ON CONFLICT (source_version_id, section_id, chunk_ordinal)
        DO UPDATE SET
          chunk_id = EXCLUDED.chunk_id,
          source_type = EXCLUDED.source_type,
          source_state = EXCLUDED.source_state,
          domain = EXCLUDED.domain,
          jurisdiction = EXCLUDED.jurisdiction,
          title = EXCLUDED.title,
          stable_reference = EXCLUDED.stable_reference,
          version_label = EXCLUDED.version_label,
          license = EXCLUDED.license,
          source_content_hash = EXCLUDED.source_content_hash,
          valid_from = EXCLUDED.valid_from,
          valid_to = EXCLUDED.valid_to,
          content = EXCLUDED.content,
          content_hash = EXCLUDED.content_hash,
          embedding = EXCLUDED.embedding,
          validation_scope = EXCLUDED.validation_scope
      `,
      [
        chunk.chunkId,
        chunk.sourceId,
        chunk.sourceVersionId,
        chunk.sourceType,
        chunk.sourceState,
        chunk.domain,
        chunk.jurisdiction,
        chunk.title,
        chunk.stableReference,
        chunk.versionLabel,
        chunk.license,
        chunk.sourceContentHash,
        chunk.validity.validFrom,
        chunk.validity.validTo,
        chunk.sectionId,
        chunk.sectionTitle,
        chunk.chunkOrdinal,
        chunk.text,
        chunk.contentHash,
        embedding,
        chunk.validationScope,
      ],
    );
  }

  async #retrieveByVector(
    query: ParsedRagRetrievalQuery,
    embedding: string,
  ): Promise<readonly RagRetrievedChunk[]> {
    const result = await this.#db.query<StoredChunkRow>(
      `
        SELECT
          chunk_id,
          source_id,
          source_version_id,
          source_type,
          source_state,
          domain,
          jurisdiction,
          title,
          stable_reference,
          version_label,
          license,
          source_content_hash,
          valid_from,
          valid_to,
          section_id,
          section_title,
          chunk_ordinal,
          content,
          content_hash,
          validation_scope,
          (1 - (embedding <=> $1::vector))::float8 AS score
        FROM ${this.#quotedTableName}
        WHERE domain = $2
          AND jurisdiction = $3
          AND valid_from <= $4::timestamptz
          AND (valid_to IS NULL OR $4::timestamptz < valid_to)
          AND source_state = 'APPROVED'
        ORDER BY embedding <=> $1::vector, chunk_id
        LIMIT $5
      `,
      [embedding, query.domain, query.jurisdiction, query.evaluationDate, query.topK],
    );

    return result.rows.map((row) => {
      const chunk = rowToChunk(row);
      return RagRetrievedChunkSchema.parse({
        ...chunk,
        score: row.score,
        citation: citationFromChunk(chunk),
      });
    });
  }
}
