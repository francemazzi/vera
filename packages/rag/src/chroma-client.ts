/** Values supported by Chroma record metadata. */
export type ChromaMetadataValue =
  | boolean
  | number
  | string
  | readonly boolean[]
  | readonly number[]
  | readonly string[];

/** Metadata is deliberately limited to Chroma's primitive and homogeneous-array types. */
export type ChromaMetadata = Readonly<Record<string, ChromaMetadataValue>>;

export interface ChromaCollection {
  readonly id: string;
  readonly name: string;
}

export interface ChromaVectorRecord {
  readonly id: string;
  readonly embedding: readonly number[];
  readonly document: string;
  readonly metadata: ChromaMetadata;
}

export interface ChromaVectorMatch {
  readonly id: string;
  readonly distance: number | null;
  readonly document: string | null;
  readonly metadata: ChromaMetadata | null;
}

export interface ChromaVectorQuery {
  readonly embedding: readonly number[];
  readonly limit: number;
  readonly where: Readonly<Record<string, unknown>>;
}

/**
 * A small, mockable port for Chroma operations used by the private governance
 * worker. Callers supply precomputed embeddings; this port never holds an AI key.
 */
export interface ChromaVectorStore {
  ensureCollection(input: {
    readonly name: string;
    readonly metadata: ChromaMetadata;
  }): Promise<ChromaCollection>;
  upsert(input: {
    readonly collection: ChromaCollection;
    readonly records: readonly ChromaVectorRecord[];
  }): Promise<void>;
  delete(input: {
    readonly collection: ChromaCollection;
    readonly where: Readonly<Record<string, unknown>>;
  }): Promise<void>;
  query(input: {
    readonly collection: ChromaCollection;
    readonly query: ChromaVectorQuery;
  }): Promise<readonly ChromaVectorMatch[]>;
  heartbeat(): Promise<void>;
}
