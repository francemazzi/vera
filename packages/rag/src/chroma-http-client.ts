import { RagError } from "./errors.js";
import type {
  ChromaCollection,
  ChromaMetadata,
  ChromaMetadataValue,
  ChromaVectorMatch,
  ChromaVectorStore,
} from "./chroma-client.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_RESPONSE_BYTES = 2_000_000;

export interface ChromaHttpVectorStoreOptions {
  /** Private http(s) endpoint of the Chroma server, never a browser URL. */
  readonly endpoint: string;
  readonly tenant?: string;
  readonly database?: string;
  /** Optional Chroma token when an auth proxy is deployed in front of the VM. */
  readonly token?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

interface NormalizedOptions {
  readonly endpoint: string;
  readonly tenant: string;
  readonly database: string;
  readonly token: string | null;
  readonly timeoutMs: number;
  readonly fetch: typeof globalThis.fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RagError("VECTOR_STORE_INVALID", `Chroma response is missing ${field}`);
  }
  return value;
}

function normalizeName(value: string | undefined, field: string, fallback: string): string {
  const normalized = (value ?? fallback).trim();
  if (!/^[A-Za-z0-9._-]{1,120}$/u.test(normalized)) {
    throw new RagError("CONFIGURATION_INVALID", `${field} must be a safe Chroma identifier`);
  }
  return normalized;
}

function normalizeOptions(options: ChromaHttpVectorStoreOptions): NormalizedOptions {
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint);
  } catch {
    throw new RagError("CONFIGURATION_INVALID", "Chroma endpoint must be an absolute URL");
  }
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username !== "" ||
    endpoint.password !== ""
  ) {
    throw new RagError("CONFIGURATION_INVALID", "Chroma endpoint must use credential-free HTTP(S)");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new RagError(
      "CONFIGURATION_INVALID",
      `timeoutMs must be an integer between 1 and ${String(MAX_TIMEOUT_MS)}`,
    );
  }
  if (options.fetch !== undefined && typeof options.fetch !== "function") {
    throw new RagError("CONFIGURATION_INVALID", "Chroma fetch transport must be a function");
  }
  const token = options.token?.trim() ?? null;
  if (token !== null && (token.length < 16 || token.length > 512 || /\s/u.test(token))) {
    throw new RagError("CONFIGURATION_INVALID", "Chroma token must be a bounded bearer token");
  }
  endpoint.pathname = endpoint.pathname.replace(/\/$/u, "");
  endpoint.search = "";
  endpoint.hash = "";
  return {
    endpoint: endpoint.toString().replace(/\/$/u, ""),
    tenant: normalizeName(options.tenant, "tenant", "default_tenant"),
    database: normalizeName(options.database, "database", "default_database"),
    token,
    timeoutMs,
    fetch: options.fetch ?? globalThis.fetch,
  };
}

function isMetadataValue(value: unknown): value is ChromaMetadataValue {
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!Array.isArray(value) || value.length === 0) return false;
  const type = typeof value[0];
  if (!["string", "number", "boolean"].includes(type)) return false;
  return value.every(
    (entry) =>
      typeof entry === type && (typeof entry !== "number" || Number.isFinite(entry)),
  );
}

function parseMetadata(value: unknown): ChromaMetadata | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new RagError("VECTOR_STORE_INVALID", "Chroma metadata is invalid");
  const entries = Object.entries(value);
  if (entries.some(([, entry]) => !isMetadataValue(entry))) {
    throw new RagError("VECTOR_STORE_INVALID", "Chroma metadata contains an unsupported value");
  }
  return Object.freeze(Object.fromEntries(entries) as Record<string, ChromaMetadataValue>);
}

function parseMatches(value: unknown): readonly ChromaVectorMatch[] {
  if (!isRecord(value)) throw new RagError("VECTOR_STORE_INVALID", "Chroma query response is invalid");
  const ids = value["ids"];
  if (!Array.isArray(ids) || !Array.isArray(ids[0])) {
    throw new RagError("VECTOR_STORE_INVALID", "Chroma query response is missing ids");
  }
  const firstIds = ids[0];
  const documents = Array.isArray(value["documents"]) && Array.isArray(value["documents"][0])
    ? value["documents"][0]
    : [];
  const metadatas = Array.isArray(value["metadatas"]) && Array.isArray(value["metadatas"][0])
    ? value["metadatas"][0]
    : [];
  const distances = Array.isArray(value["distances"]) && Array.isArray(value["distances"][0])
    ? value["distances"][0]
    : [];

  return firstIds.map((id, index) => {
    const document = documents[index];
    const distance = distances[index];
    if (
      typeof id !== "string" ||
      (document !== undefined && document !== null && typeof document !== "string") ||
      (distance !== undefined && distance !== null &&
        (typeof distance !== "number" || !Number.isFinite(distance)))
    ) {
      throw new RagError("VECTOR_STORE_INVALID", "Chroma query record is invalid");
    }
    return {
      id,
      distance: distance === undefined ? null : distance,
      document: document === undefined ? null : document,
      metadata: parseMetadata(metadatas[index] ?? null),
    };
  });
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 524 || status === 529 || status >= 500;
}

/** HTTP implementation for a private Chroma v2 server. */
export class ChromaHttpVectorStore implements ChromaVectorStore {
  readonly #options: NormalizedOptions;

  public constructor(options: ChromaHttpVectorStoreOptions) {
    this.#options = normalizeOptions(options);
  }

  public async ensureCollection(input: {
    readonly name: string;
    readonly metadata: ChromaMetadata;
  }): Promise<ChromaCollection> {
    const name = normalizeName(input.name, "collection name", "");
    const response = await this.#requestJson(
      `collections`,
      "POST",
      {
        name,
        get_or_create: true,
        metadata: input.metadata,
        configuration: { hnsw: { space: "cosine" } },
      },
    );
    if (!isRecord(response)) throw new RagError("VECTOR_STORE_INVALID", "Chroma collection is invalid");
    return Object.freeze({
      id: requireNonEmptyString(response["id"], "collection id"),
      name: requireNonEmptyString(response["name"], "collection name"),
    });
  }

  public async upsert(input: {
    readonly collection: ChromaCollection;
    readonly records: readonly {
      readonly id: string;
      readonly embedding: readonly number[];
      readonly document: string;
      readonly metadata: ChromaMetadata;
    }[];
  }): Promise<void> {
    if (input.records.length === 0) return;
    await this.#requestVoid(`collections/${encodeURIComponent(input.collection.id)}/upsert`, "POST", {
      ids: input.records.map(({ id }) => id),
      embeddings: input.records.map(({ embedding }) => embedding),
      documents: input.records.map(({ document }) => document),
      metadatas: input.records.map(({ metadata }) => metadata),
    });
  }

  public async delete(input: {
    readonly collection: ChromaCollection;
    readonly where: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    await this.#requestVoid(`collections/${encodeURIComponent(input.collection.id)}/delete`, "POST", {
      where: input.where,
    });
  }

  public async query(input: {
    readonly collection: ChromaCollection;
    readonly query: {
      readonly embedding: readonly number[];
      readonly limit: number;
      readonly where: Readonly<Record<string, unknown>>;
    };
  }): Promise<readonly ChromaVectorMatch[]> {
    const response = await this.#requestJson(
      `collections/${encodeURIComponent(input.collection.id)}/query`,
      "POST",
      {
        query_embeddings: [input.query.embedding],
        n_results: input.query.limit,
        where: input.query.where,
        include: ["documents", "metadatas", "distances"],
      },
    );
    return parseMatches(response);
  }

  public async heartbeat(): Promise<void> {
    await this.#requestAbsoluteVoid(`${this.#options.endpoint}/api/v2/heartbeat`);
  }

  async #requestJson(path: string, method: "POST", body: Readonly<Record<string, unknown>>): Promise<unknown> {
    const response = await this.#request(path, method, body);
    const text = await this.#readResponse(response);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new RagError("VECTOR_STORE_INVALID", "Chroma returned invalid JSON");
    }
  }

  async #requestVoid(path: string, method: "GET" | "POST", body?: Readonly<Record<string, unknown>>): Promise<void> {
    const response = await this.#request(path, method, body);
    await response.body?.cancel();
  }

  async #requestAbsoluteVoid(url: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#options.timeoutMs);
    try {
      const response = await this.#options.fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new RagError("VECTOR_STORE_UNAVAILABLE", "Chroma request failed", {
          details: { status: response.status },
          retryable: isRetryableStatus(response.status),
        });
      }
      await response.body?.cancel();
    } catch (error) {
      if (error instanceof RagError) throw error;
      throw new RagError("VECTOR_STORE_UNAVAILABLE", "Chroma request is unavailable", {
        cause: error,
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async #request(
    path: string,
    method: "GET" | "POST",
    body?: Readonly<Record<string, unknown>>,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#options.timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (this.#options.token !== null) headers["x-chroma-token"] = this.#options.token;
      const response = await this.#options.fetch(this.#url(path), {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new RagError("VECTOR_STORE_UNAVAILABLE", "Chroma request failed", {
          details: { status: response.status },
          retryable: isRetryableStatus(response.status),
        });
      }
      return response;
    } catch (error) {
      if (error instanceof RagError) throw error;
      throw new RagError("VECTOR_STORE_UNAVAILABLE", "Chroma request is unavailable", {
        cause: error,
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async #readResponse(response: Response): Promise<string> {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new RagError("VECTOR_STORE_INVALID", "Chroma response exceeds the configured limit");
    }
    return text;
  }

  #url(path: string): string {
    const root = `${this.#options.endpoint}/api/v2/tenants/${encodeURIComponent(
      this.#options.tenant,
    )}/databases/${encodeURIComponent(this.#options.database)}`;
    return new URL(path, `${root}/`).toString();
  }
}
