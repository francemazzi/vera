import { createBackendRequest } from "./backend-request.js";
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

export function createLabelBackendClient(options: {
  readonly backendUrl: string;
  readonly audience: string;
  /** Explicit loopback-only development bridge; production omits this. */
  readonly localToken?: string | null;
  readonly auth?: Pick<GoogleAuth, "getIdTokenClient">;
  readonly localMode?: boolean;
  readonly localAuthToken?: string;
}): LabelBackendClient {
  const request = createBackendRequest(options);
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
