import { randomUUID } from "node:crypto";

import type { LabelBackendClient } from "./backend-client.js";
import type { LabelEvaluator } from "./openrouter-evaluator.js";
import { OpenRouterLabelEvaluationError } from "./openrouter-evaluator.js";
import type { LabelPageStore } from "./page-store.js";

export interface LabelJobProcessor {
  process(analysisId: string): Promise<{ readonly replayed: boolean }>;
}

export function createLabelJobProcessor(options: {
  readonly backend: LabelBackendClient;
  readonly pageStore: LabelPageStore;
  readonly evaluator: LabelEvaluator;
  readonly createInvocationId?: () => string;
}): LabelJobProcessor {
  const createInvocationId = options.createInvocationId ?? randomUUID;
  return {
    async process(analysisId) {
      const input = await options.backend.getInput(analysisId);
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(input.status)) return { replayed: true };

      const runnerInvocationId = createInvocationId();
      const claim = await options.backend.claim({
        analysisId,
        expectedVersion: input.version,
        runnerInvocationId,
      });
      if (!claim.acquired) return { replayed: true };

      try {
        const page = await options.pageStore.loadNormalizedPage(input);
        const evaluation = await options.evaluator.evaluate({
          page,
          countryCodes: input.countryCodes,
        });
        await options.backend.complete({
          analysisId,
          expectedVersion: claim.version,
          runnerInvocationId,
          evaluation,
        });
        return { replayed: false };
      } catch (error) {
        if (error instanceof OpenRouterLabelEvaluationError && error.retryable) throw error;
        await options.backend.fail({
          analysisId,
          expectedVersion: claim.version,
          runnerInvocationId,
        });
        return { replayed: false };
      }
    },
  };
}
