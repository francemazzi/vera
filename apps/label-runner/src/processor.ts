import { randomUUID } from "node:crypto";

import type { LabelBackendClient } from "./backend-client.js";
import { RunnerEvaluationSchema } from "./contracts.js";
import type { LabelEvaluator } from "./openrouter-evaluator.js";
import { OpenRouterLabelEvaluationError } from "./openrouter-evaluator.js";
import type { LabelPageStore } from "./page-store.js";
import { fallbackRegulatoryScope } from "./source-retriever.js";
import type { LabelSourceRetriever } from "./source-retriever.js";

export interface LabelJobProcessor {
  process(analysisId: string): Promise<{ readonly replayed: boolean }>;
}

export function createLabelJobProcessor(options: {
  readonly backend: LabelBackendClient;
  readonly pageStore: LabelPageStore;
  readonly evaluator: LabelEvaluator;
  readonly sourceRetriever?: LabelSourceRetriever;
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
        const pages = await options.pageStore.loadNormalizedPages(input);
        const scope =
          input.regulatoryScope ?? fallbackRegulatoryScope({ countryCodes: input.countryCodes });
        const sources = options.sourceRetriever
          ? await options.sourceRetriever.retrieve({
              workspaceId: input.workspaceId,
              scope,
              productCategory: input.productCategory,
              template: input.preliminaryTemplate,
            })
          : {
              controls: input.preliminaryTemplate.controls.map(({ fieldCode }) => ({
                fieldCode,
                citations: [],
              })),
              sourceSnapshot: input.preliminaryTemplate.sourceSnapshot,
            };
        const evaluated = await options.evaluator.evaluate({
          pages,
          countryCodes: input.countryCodes,
          regulatoryScope: scope,
          sources,
          template: input.preliminaryTemplate,
        });
        // `sources.controls` is the canonical retrieval order and evidence
        // set used to derive sources.sourceSnapshot. Pass it through without
        // mapping, sorting, filtering, or re-hashing so the backend can pin
        // the exact frozen manifest for a global analysis.
        const evaluation = RunnerEvaluationSchema.parse({
          ...evaluated,
          ...(input.preliminaryTemplate.id === "global-food-label-preliminary-v1"
            ? { sourceManifest: { controls: sources.controls } }
            : {}),
        });
        await options.backend.complete({
          analysisId,
          expectedVersion: claim.version,
          runnerInvocationId,
          evaluation,
        });
        return { replayed: false };
      } catch (error) {
        if (process.env["LABEL_LOCAL_MODE"] === "true") {
          console.error("Label runner evaluation failed", error);
        }
        if (error instanceof OpenRouterLabelEvaluationError && error.retryable) throw error;
        await options.backend.fail({
          analysisId,
          expectedVersion: claim.version,
          runnerInvocationId,
          failureCode:
            error instanceof OpenRouterLabelEvaluationError
              ? "OPENROUTER_EVALUATION_FAILED"
              : "EVALUATION_PROCESSING_FAILED",
        });
        return { replayed: false };
      }
    },
  };
}
