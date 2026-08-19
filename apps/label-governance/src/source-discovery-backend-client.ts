import { GoogleAuth } from "google-auth-library";
import { z } from "zod";

import {
  SOURCE_DISCOVERY_RANKING_MODEL,
  SOURCE_DISCOVERY_RANKING_PROMPT_VERSION,
  SOURCE_DISCOVERY_RANKING_SCHEMA_HASH,
  SourceDiscoveryDiagnosticsSchema,
  SourceDiscoveryProposalSchema,
  SourceDiscoveryWorkerInputSchema,
} from "./source-discovery-contracts.js";
import type {
  SourceDiscoveryDiagnostics,
  SourceDiscoveryProposal,
  SourceDiscoveryWorkerInput,
} from "./source-discovery-contracts.js";
import { SourceDiscoveryJobSchema } from "./source-discovery-jobs.js";
import type { SourceDiscoveryJob } from "./source-discovery-jobs.js";

const SourceDiscoveryWorkerInputEnvelopeSchema = z
  .object({
    status: z.literal("success"),
    data: SourceDiscoveryWorkerInputSchema,
  })
  .strict();

const SourceDiscoveryClaimEnvelopeSchema = z
  .object({
    status: z.literal("success"),
    data: z
      .object({
        // The backend's private worker DTO uses the resource name `runId`.
        // Keep this strict so an unrelated discovery record can never be
        // mistaken for the one currently leased by the task.
        runId: z.uuid(),
        status: z.enum(["QUEUED", "RUNNING", "COMPLETED", "FAILED"]),
        lease: z.object({ expiresAt: z.iso.datetime({ offset: true }) }).nullable(),
      })
      .strict(),
    meta: z.object({ acquired: z.boolean(), replayed: z.boolean() }).strict(),
  })
  .strict();

export const SourceDiscoveryCompletionSchema = z
  .object({
    kind: z.literal("DISCOVER_OFFICIAL_SOURCES"),
    workerInvocationId: z.uuid(),
    status: z.literal("COMPLETED"),
    // The run-level audit is mandatory even for an empty result set. Proposal
    // audit fields are retained for evidence, but the backend persists these
    // top-level values on SourceDiscoveryRun.
    discoveryModel: z.literal(SOURCE_DISCOVERY_RANKING_MODEL),
    discoveryPromptVersion: z.literal(SOURCE_DISCOVERY_RANKING_PROMPT_VERSION),
    discoveryResponseSchemaHash: z.literal(SOURCE_DISCOVERY_RANKING_SCHEMA_HASH),
    proposals: z.array(SourceDiscoveryProposalSchema).max(50),
    diagnostics: SourceDiscoveryDiagnosticsSchema,
  })
  .strict();

export type SourceDiscoveryCompletion = z.infer<typeof SourceDiscoveryCompletionSchema>;

export const SourceDiscoveryFailureSchema = z
  .object({
    kind: z.literal("DISCOVER_OFFICIAL_SOURCES"),
    workerInvocationId: z.uuid(),
    status: z.literal("FAILED"),
    failure: z
      .object({
        code: z.string().trim().min(1).max(120),
        retryable: z.boolean(),
      })
      .strict(),
    diagnostics: SourceDiscoveryDiagnosticsSchema,
  })
  .strict();

export type SourceDiscoveryFailure = z.infer<typeof SourceDiscoveryFailureSchema>;

export class SourceDiscoveryBackendClientError extends Error {
  public constructor(
    message: string,
    public readonly retryable: boolean,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "SourceDiscoveryBackendClientError";
  }
}

export interface SourceDiscoveryBackendClient {
  getInput(job: SourceDiscoveryJob): Promise<SourceDiscoveryWorkerInput>;
  claim(input: {
    readonly discoveryRunId: string;
    readonly kind: SourceDiscoveryJob["kind"];
    readonly workerInvocationId: string;
  }): Promise<{ readonly acquired: boolean; readonly replayed: boolean }>;
  complete(input: {
    readonly discoveryRunId: string;
    readonly callback: SourceDiscoveryCompletion;
  }): Promise<void>;
  fail(input: {
    readonly discoveryRunId: string;
    readonly callback: SourceDiscoveryFailure;
  }): Promise<void>;
}

interface IdTokenClient {
  request(options: {
    readonly url: string;
    readonly method: string;
    readonly data?: unknown;
  }): Promise<{ readonly data: unknown }>;
}

function trimBaseUrl(value: string, allowLoopbackHttp = false): string {
  try {
    const url = new URL(value);
    const isLoopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" &&
        !(allowLoopbackHttp && url.protocol === "http:" && isLoopback)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("invalid backend URL");
    }
    return url.toString().replace(/\/$/u, "");
  } catch {
    throw new SourceDiscoveryBackendClientError("Governance backend URL is invalid", false);
  }
}

function errorFromBackend(error: unknown): SourceDiscoveryBackendClientError {
  const response =
    typeof error === "object" && error !== null && "response" in error
      ? (error as { readonly response?: { readonly status?: unknown } }).response
      : undefined;
  const status = typeof response?.status === "number" ? response.status : undefined;
  return new SourceDiscoveryBackendClientError(
    status === undefined
      ? "Source discovery backend request failed"
      : `Source discovery backend returned HTTP ${String(status)}`,
    status === undefined || status === 408 || status === 409 || status === 429 || status >= 500,
    { cause: error },
  );
}

/** OIDC client with an explicit development-only local bearer bridge. */
export function createSourceDiscoveryBackendClient(options: {
  readonly backendUrl: string;
  readonly audience: string;
  readonly auth?: Pick<GoogleAuth, "getIdTokenClient">;
  readonly localToken?: string;
}): SourceDiscoveryBackendClient {
  const backendUrl = trimBaseUrl(options.backendUrl, options.localToken !== undefined);
  const auth = options.auth ?? new GoogleAuth();
  let client: Promise<IdTokenClient> | undefined;
  const idTokenClient = (): Promise<IdTokenClient> => {
    client ??= auth.getIdTokenClient(options.audience) as Promise<IdTokenClient>;
    return client;
  };
  const request = async (path: string, method: string, data?: unknown): Promise<unknown> => {
    try {
      if (options.localToken !== undefined) {
        const response = await fetch(`${backendUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${options.localToken}`,
            ...(data === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) {
          throw new Error(`Source discovery backend returned HTTP ${String(response.status)}`);
        }
        return await response.json();
      }
      const response = await (
        await idTokenClient()
      ).request({
        url: `${backendUrl}${path}`,
        method,
        ...(data === undefined ? {} : { data }),
      });
      return response.data;
    } catch (error) {
      throw errorFromBackend(error);
    }
  };
  const encodedRunId = (value: string): string => encodeURIComponent(z.uuid().parse(value));

  return {
    async getInput(job) {
      const parsed = SourceDiscoveryJobSchema.parse(job);
      const response = SourceDiscoveryWorkerInputEnvelopeSchema.parse(
        await request(
          `/internal/label/source-discovery/${encodedRunId(parsed.discoveryRunId)}/worker-input`,
          "GET",
        ),
      );
      return response.data;
    },
    async claim(input) {
      const response = SourceDiscoveryClaimEnvelopeSchema.parse(
        await request(
          `/internal/label/source-discovery/${encodedRunId(input.discoveryRunId)}/worker-claim`,
          "POST",
          {
            kind: input.kind,
            workerInvocationId: input.workerInvocationId,
          },
        ),
      );
      return { acquired: response.meta.acquired, replayed: response.meta.replayed };
    },
    async complete(input) {
      const callback = SourceDiscoveryCompletionSchema.parse(input.callback);
      await request(
        `/internal/label/source-discovery/${encodedRunId(input.discoveryRunId)}/worker-callback`,
        "POST",
        callback,
      );
    },
    async fail(input) {
      const callback = SourceDiscoveryFailureSchema.parse(input.callback);
      await request(
        `/internal/label/source-discovery/${encodedRunId(input.discoveryRunId)}/worker-callback`,
        "POST",
        callback,
      );
    },
  };
}

/** Kept exported for typed test fixtures and processor diagnostics. */
export type { SourceDiscoveryDiagnostics, SourceDiscoveryProposal, SourceDiscoveryWorkerInput };
