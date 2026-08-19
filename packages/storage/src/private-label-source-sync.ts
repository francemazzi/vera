import { sha256Bytes } from "@vera/contracts";

import type { PrivateLabelGovernanceRepository } from "./private-label-governance-repository.js";

export const DEFAULT_PRIVATE_LABEL_SOURCE_ORIGINS = [
  "https://eur-lex.europa.eu",
  "https://food.ec.europa.eu",
] as const;

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

export interface PrivateLabelSourceArchive {
  /** Persists a source body in a private store and returns an opaque reference only. */
  persist(input: {
    readonly bytes: Uint8Array;
    readonly mediaType: string;
    readonly sha256: string;
  }): Promise<{ readonly contentObjectRef: string }>;
}

export interface PrivateLabelSourceSyncInput {
  readonly source: {
    readonly id: string;
    readonly url: string;
    readonly title: string;
    readonly jurisdiction: string;
  };
  readonly revision: number;
  readonly actorId: string;
  readonly createdAt: string;
  readonly additionalAllowedOrigins?: readonly string[];
}

function normalizedOrigin(value: string): string {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    (parsed.port !== "" && parsed.port !== "443") ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("An allowlist entry must be a bare HTTPS origin");
  }
  return parsed.origin;
}

/** Ensures the sync agent can download only explicitly allowed HTTPS origins. */
export function assertPrivateLabelSourceUrlAllowed(
  input: string,
  additionalAllowedOrigins: readonly string[] = [],
): URL {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new Error("Private Label sources must use credential-free HTTPS URLs");
  }
  const origins = new Set<string>([
    ...DEFAULT_PRIVATE_LABEL_SOURCE_ORIGINS,
    ...additionalAllowedOrigins.map(normalizedOrigin),
  ]);
  if (!origins.has(url.origin)) {
    throw new Error("Private Label source URL is not in the approved allowlist");
  }
  return url;
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
  if (!response.ok || response.body === null) {
    throw new Error("Private Label source download failed");
  }
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const value = result.value;
      total += value.byteLength;
      if (total > MAX_SOURCE_BYTES) {
        await reader.cancel("Private Label source exceeds the bounded download size");
        throw new Error("Private Label source exceeds the maximum download size");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Fetches and archives a source as an immutable UNVERIFIED proposal. This
 * function never performs human verification, approval or activation.
 */
export async function syncPrivateLabelSource(input: {
  readonly repository: Pick<PrivateLabelGovernanceRepository, "createSourceVersion">;
  readonly archive: PrivateLabelSourceArchive;
  readonly fetch: typeof globalThis.fetch;
  readonly request: PrivateLabelSourceSyncInput;
}): Promise<{ readonly sourceVersionId: string; readonly state: "UNVERIFIED" }> {
  const request = input.request;
  const url = assertPrivateLabelSourceUrlAllowed(
    request.source.url,
    request.additionalAllowedOrigins,
  );
  const response = await input.fetch(url, {
    method: "GET",
    redirect: "error",
    headers: { Accept: "application/pdf,text/html,application/xml,text/plain;q=0.9,*/*;q=0.1" },
  });
  const bytes = await readBoundedResponse(response);
  const sha256 = sha256Bytes(bytes);
  const mediaType =
    response.headers.get("content-type")?.split(";", 1)[0]?.trim() || "application/octet-stream";
  const archived = await input.archive.persist({ bytes, mediaType, sha256 });
  const sourceVersion = await input.repository.createSourceVersion({
    source: {
      id: request.source.id,
      stableReference: url.toString(),
      title: request.source.title,
      jurisdiction: request.source.jurisdiction,
    },
    version: {
      id: crypto.randomUUID(),
      revision: request.revision,
      contentHash: sha256,
      contentObjectRef: archived.contentObjectRef,
    },
    actorId: request.actorId,
    actorRole: "SYNC_AGENT",
    createdAt: request.createdAt,
  });
  return { sourceVersionId: sourceVersion.sourceVersionId, state: sourceVersion.state };
}
