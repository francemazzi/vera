import { GoogleAuth } from "google-auth-library";

import { ClaimResponseSchema, RunnerEvaluationSchema, RunnerInputSchema } from "./contracts.js";
import type { RunnerEvaluation, RunnerInput } from "./contracts.js";

export interface LabelBackendClient {
  getInput(analysisId: string): Promise<RunnerInput>;
  claim(input: {
    readonly analysisId: string;
    readonly expectedVersion: number;
    readonly runnerInvocationId: string;
  }): Promise<{ readonly acquired: boolean; readonly version: number }>;
  complete(input: {
    readonly analysisId: string;
    readonly expectedVersion: number;
    readonly runnerInvocationId: string;
    readonly evaluation: RunnerEvaluation;
  }): Promise<void>;
  fail(input: {
    readonly analysisId: string;
    readonly expectedVersion: number;
    readonly runnerInvocationId: string;
    readonly failureCode?: string;
  }): Promise<void>;
}

interface IdTokenClient {
  request(options: {
    readonly url: string;
    readonly method: string;
    readonly data?: unknown;
  }): Promise<{
    readonly data: unknown;
  }>;
}

function errorMessage(response: unknown): string {
  if (typeof response !== "object" || response === null) return "backend request failed";
  const candidate = response as Record<string, unknown>;
  return typeof candidate["message"] === "string" ? candidate["message"] : "backend request failed";
}

async function localFetchRequest(
  backendUrl: string,
  localAuthToken: string,
  path: string,
  method: string,
  data?: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${localAuthToken}`,
  };
  const init: RequestInit = { method, headers };
  if (data !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(data);
  }
  const response = await fetch(`${backendUrl}${path}`, init);
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(errorMessage(body));
  }
  return body;
}

export function createLabelBackendClient(options: {
  readonly backendUrl: string;
  readonly audience: string;
  /** Explicit loopback-only development bridge; production omits this. */
  readonly localToken?: string | null;
  readonly auth?: Pick<GoogleAuth, "getIdTokenClient">;
  readonly localMode?: boolean;
  readonly localAuthToken?: string;
}): LabelBackendClient {
  const localMode = options.localMode === true || process.env["LABEL_LOCAL_MODE"] === "true";
  const localAuthToken =
    options.localAuthToken ?? process.env["LABEL_LOCAL_AUTH_TOKEN"] ?? "local-dev";
  const auth = options.auth ?? new GoogleAuth();
  let client: Promise<IdTokenClient> | undefined;
  const idTokenClient = (): Promise<IdTokenClient> => {
    client ??= auth.getIdTokenClient(options.audience) as Promise<IdTokenClient>;
    return client;
  };
  const request = async (path: string, method: string, data?: unknown): Promise<unknown> => {
    if (localMode) {
      return localFetchRequest(options.backendUrl, localAuthToken, path, method, data);
    }
    try {
      if (options.localToken) {
        const response = await fetch(`${options.backendUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${options.localToken}`,
            ...(data === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        const body: unknown = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(errorMessage(body));
        return body;
      }
      const response = await (
        await idTokenClient()
      ).request({
        url: `${options.backendUrl}${path}`,
        method,
        ...(data === undefined ? {} : { data }),
      });
      return response.data;
    } catch (error: unknown) {
      const response =
        typeof error === "object" && error !== null && "response" in error
          ? (error as { readonly response?: { readonly data?: unknown } }).response?.data
          : undefined;
      throw new Error(errorMessage(response), { cause: error });
    }
  };
  return {
    async getInput(analysisId) {
      const response = await request(`/internal/label/analyses/${analysisId}/runner-input`, "GET");
      return RunnerInputSchema.parse((response as { readonly data: unknown }).data);
    },
    async claim(input) {
      const response = ClaimResponseSchema.parse(
        await request(`/internal/label/analyses/${input.analysisId}/runner-claim`, "POST", {
          expectedVersion: input.expectedVersion,
          runnerInvocationId: input.runnerInvocationId,
        }),
      );
      return { acquired: response.meta.acquired, version: response.data.version };
    },
    async complete(input) {
      await request(`/internal/label/analyses/${input.analysisId}/runner-callback`, "POST", {
        status: "COMPLETED",
        expectedVersion: input.expectedVersion,
        runnerInvocationId: input.runnerInvocationId,
        evaluation: RunnerEvaluationSchema.parse(input.evaluation),
      });
    },
    async fail(input) {
      await request(`/internal/label/analyses/${input.analysisId}/runner-callback`, "POST", {
        status: "FAILED",
        expectedVersion: input.expectedVersion,
        runnerInvocationId: input.runnerInvocationId,
        ...(input.failureCode ? { failureCode: input.failureCode } : {}),
      });
    },
  };
}
