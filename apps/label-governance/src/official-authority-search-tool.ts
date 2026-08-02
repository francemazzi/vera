import {
  buildOfficialAuthoritySearchRequest,
  parseOfficialAuthoritySearchResponse,
} from "./official-authority-profile.js";
import type { OfficialSearchCandidate } from "./official-authority-profile.js";
import type {
  OfficialAuthorityProfile,
  SourceDiscoveryScope,
} from "./source-discovery-contracts.js";

const MAX_SEARCH_RESPONSE_BYTES = 1 * 1024 * 1024;
const DEFAULT_SEARCH_TIMEOUT_MS = 30_000;

export class OfficialAuthoritySearchError extends Error {
  public constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly code: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "OfficialAuthoritySearchError";
  }
}

export interface OfficialAuthoritySearchTool {
  search(input: {
    readonly profile: OfficialAuthorityProfile;
    readonly scope: SourceDiscoveryScope;
  }): Promise<readonly OfficialSearchCandidate[]>;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function assertSuccessfulSearchResponse(response: Response): void {
  if (!response.ok) {
    throw new OfficialAuthoritySearchError(
      "Official authority search failed",
      retryableStatus(response.status),
      "SEARCH_REQUEST_FAILED",
    );
  }
}

function expectedMediaType(profile: OfficialAuthorityProfile, response: Response): void {
  const raw = response.headers.get("content-type");
  const type = raw?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const valid =
    profile.searchMode === "OFFICIAL_SEARCH_HTML"
      ? type === "text/html" || type === "application/xhtml+xml"
      : type === "application/json" || type === "application/sparql-results+json";
  if (!valid) {
    throw new OfficialAuthoritySearchError(
      "Official authority search returned an unexpected media type",
      false,
      "SEARCH_MEDIA_TYPE_INVALID",
    );
  }
}

async function readBoundedText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_SEARCH_RESPONSE_BYTES) {
    throw new OfficialAuthoritySearchError(
      "Official authority search response exceeds the safety limit",
      false,
      "SEARCH_RESPONSE_TOO_LARGE",
    );
  }
  const body = response.body;
  if (body === null) {
    throw new OfficialAuthoritySearchError(
      "Official authority search returned no response body",
      false,
      "SEARCH_RESPONSE_UNREADABLE",
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
      if (size > MAX_SEARCH_RESPONSE_BYTES) {
        await reader.cancel("Official authority search response is too large");
        throw new OfficialAuthoritySearchError(
          "Official authority search response exceeds the safety limit",
          false,
          "SEARCH_RESPONSE_TOO_LARGE",
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
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new OfficialAuthoritySearchError(
      "Official authority search response is not valid UTF-8",
      false,
      "SEARCH_RESPONSE_UNREADABLE",
      { cause: error },
    );
  }
}

/**
 * Closed-world discovery tool. It fetches a backend-configured official
 * endpoint with redirects disabled, parses at most one bounded response and
 * returns only links whose hosts are configured in the same authority profile.
 */
export function createOfficialAuthoritySearchTool(
  options: {
    readonly fetch?: typeof globalThis.fetch;
    readonly timeoutMs?: number;
  } = {},
): OfficialAuthoritySearchTool {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
    throw new Error(
      "Official authority search timeout must be between 1000 and 300000 milliseconds",
    );
  }
  return {
    async search(input) {
      const request = buildOfficialAuthoritySearchRequest(input);
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetchImplementation(request.url, {
          method: request.method,
          headers: request.headers,
          redirect: "error",
          signal: controller.signal,
        });
        // An official portal's error page is often HTML even when the normal
        // endpoint is JSON. Classify the HTTP failure before MIME validation
        // so a temporary 5xx remains retryable rather than terminal.
        assertSuccessfulSearchResponse(response);
        expectedMediaType(input.profile, response);
        const body = await readBoundedText(response);
        return parseOfficialAuthoritySearchResponse({
          profile: input.profile,
          request,
          body,
        });
      } catch (error) {
        if (error instanceof OfficialAuthoritySearchError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new OfficialAuthoritySearchError(
            "Official authority search timed out",
            true,
            "SEARCH_TIMEOUT",
            { cause: error },
          );
        }
        throw new OfficialAuthoritySearchError(
          "Official authority search request failed",
          true,
          "SEARCH_REQUEST_FAILED",
          { cause: error },
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
