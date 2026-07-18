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

export function createLabelBackendClient(options: {
  readonly backendUrl: string;
  readonly audience: string;
  readonly auth?: Pick<GoogleAuth, "getIdTokenClient">;
}): LabelBackendClient {
  const auth = options.auth ?? new GoogleAuth();
  let client: Promise<IdTokenClient> | undefined;
  const idTokenClient = (): Promise<IdTokenClient> => {
    client ??= auth.getIdTokenClient(options.audience) as Promise<IdTokenClient>;
    return client;
  };
  const request = async (path: string, method: string, data?: unknown): Promise<unknown> => {
    try {
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
      });
    },
  };
}
