import { randomUUID } from "node:crypto";

import type { LabelBackendClient } from "./backend-client.js";
import { RunnerEvaluationSchema, type PreliminaryTemplate } from "./contracts.js";
import type { LabelEvaluator } from "./openrouter-evaluator.js";
import { OpenRouterLabelEvaluationError } from "./openrouter-evaluator.js";
import type { LabelPageStore } from "./page-store.js";
import { fallbackRegulatoryScope } from "./source-retriever.js";
import type { LabelRetrievedSources, LabelSourceRetriever } from "./source-retriever.js";

export interface LabelJobProcessor {
  process(analysisId: string): Promise<{ readonly replayed: boolean }>;
}

/**
 * A global preliminary analysis must never ask the model to infer legal
 * coverage from an empty RAG result. This is terminal operational readiness,
 * not a model failure and intentionally leaves the ground-truth corpus out of
 * the retrieval path.
 */
export class SourceReadinessBlockedError extends Error {
  public constructor() {
    super("Verified source coverage is incomplete for this analysis");
    this.name = "SourceReadinessBlockedError";
  }
}

function isSourceReadinessBlocked(
  template: PreliminaryTemplate,
  retriever: LabelSourceRetriever | undefined,
  sources: LabelRetrievedSources,
): boolean {
  if (!retriever) return false;
  // The IT pilot degrades uncovered non-sector controls to REVIEW_REQUIRED.
  if (template.id === "eu-it-preliminary-v1") return false;
  const sectorSpecific = new Set<string>(
    template.controls
      .filter((control) => control.sectorSpecific === true)
      .map((control) => control.fieldCode),
  );
  return sources.controls.some(
    (control) => control.citations.length === 0 && !sectorSpecific.has(control.fieldCode),
  );
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
        if (isSourceReadinessBlocked(input.preliminaryTemplate, options.sourceRetriever, sources)) {
          throw new SourceReadinessBlockedError();
        }
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
            error instanceof SourceReadinessBlockedError
              ? "SOURCE_READINESS_BLOCKED"
              : error instanceof OpenRouterLabelEvaluationError
                ? "OPENROUTER_EVALUATION_FAILED"
                : "PRELIMINARY_PROCESSING_FAILED",
        });
        return { replayed: false };
      }
    },
  };
}
