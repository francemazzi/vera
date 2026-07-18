import { describe, expect, it, vi } from "vitest";

import { LABEL_FIELD_CODES } from "../../src/contracts.js";
import type { RunnerEvaluation, RunnerInput } from "../../src/contracts.js";
import type { LabelBackendClient } from "../../src/backend-client.js";
import { OpenRouterLabelEvaluationError } from "../../src/openrouter-evaluator.js";
import type { LabelEvaluator } from "../../src/openrouter-evaluator.js";
import type { LabelPageStore } from "../../src/page-store.js";
import { createLabelJobProcessor } from "../../src/processor.js";

const analysisId = "00000000-0000-4000-8000-000000000101";
const sourceSnapshot = "a".repeat(64);

function input(
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED" = "QUEUED",
): RunnerInput {
  return {
    id: analysisId,
    workspaceId: "00000000-0000-4000-8000-000000000102",
    countryCodes: ["IT"],
    inputSha256: "b".repeat(64),
    normalizedPageObjectKey: "label-analyses/workspace-1/analysis-1/page-1.png",
    status,
    version: 2,
  };
}

function evaluation(): RunnerEvaluation {
  return {
    provider: "openrouter" as const,
    model: "test/vision",
    promptVersion: "label-v1",
    rulePackVersion: "eu-v1",
    sourceSnapshot,
    controls: LABEL_FIELD_CODES.map((fieldCode) => ({
      fieldCode,
      outcome: "REVIEW" as const,
      rationale: "Synthetic test fixture",
      ruleVersion: "eu-v1",
      confidence: 0,
    })),
  };
}

describe("LabelJobProcessor", () => {
  it("claims once, evaluates the private page and completes with reproducibility metadata", async () => {
    const claim = vi.fn<LabelBackendClient["claim"]>(() =>
      Promise.resolve({ acquired: true, version: 3 }),
    );
    const complete = vi.fn<LabelBackendClient["complete"]>((payload) => {
      expect(payload).toMatchObject({ analysisId, expectedVersion: 3 });
      expect(payload.evaluation.sourceSnapshot).toBe(sourceSnapshot);
      return Promise.resolve();
    });
    const backend: LabelBackendClient = {
      getInput: vi.fn<LabelBackendClient["getInput"]>(() => Promise.resolve(input())),
      claim,
      complete,
      fail: vi.fn<LabelBackendClient["fail"]>(() => Promise.resolve()),
    };
    const pageStore: LabelPageStore = {
      loadNormalizedPage: vi.fn<LabelPageStore["loadNormalizedPage"]>(() =>
        Promise.resolve(new Uint8Array([137, 80, 78, 71])),
      ),
    };
    const evaluator: LabelEvaluator = {
      evaluate: vi.fn<LabelEvaluator["evaluate"]>(() => Promise.resolve(evaluation())),
    };
    const processor = createLabelJobProcessor({
      backend,
      pageStore,
      evaluator,
      createInvocationId: () => "runner-invocation-0001",
    });

    await expect(processor.process(analysisId)).resolves.toEqual({ replayed: false });
    expect(claim).toHaveBeenCalledWith({
      analysisId,
      expectedVersion: 2,
      runnerInvocationId: "runner-invocation-0001",
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("acknowledges a duplicate job without downloading or evaluating the image", async () => {
    const loadNormalizedPage = vi.fn<LabelPageStore["loadNormalizedPage"]>(() =>
      Promise.resolve(new Uint8Array([1])),
    );
    const evaluate = vi.fn<LabelEvaluator["evaluate"]>(() => Promise.resolve(evaluation()));
    const backend: LabelBackendClient = {
      getInput: vi.fn<LabelBackendClient["getInput"]>(() => Promise.resolve(input("PROCESSING"))),
      claim: vi.fn<LabelBackendClient["claim"]>(() =>
        Promise.resolve({ acquired: false, version: 2 }),
      ),
      complete: vi.fn<LabelBackendClient["complete"]>(() => Promise.resolve()),
      fail: vi.fn<LabelBackendClient["fail"]>(() => Promise.resolve()),
    };
    const pageStore: LabelPageStore = { loadNormalizedPage };
    const evaluator: LabelEvaluator = { evaluate };
    const processor = createLabelJobProcessor({ backend, pageStore, evaluator });

    await expect(processor.process(analysisId)).resolves.toEqual({ replayed: true });
    expect(loadNormalizedPage).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("lets Cloud Tasks retry only transient OpenRouter failures", async () => {
    const fail = vi.fn<LabelBackendClient["fail"]>(() => Promise.resolve());
    const backend: LabelBackendClient = {
      getInput: vi.fn<LabelBackendClient["getInput"]>(() => Promise.resolve(input())),
      claim: vi.fn<LabelBackendClient["claim"]>(() =>
        Promise.resolve({ acquired: true, version: 3 }),
      ),
      complete: vi.fn<LabelBackendClient["complete"]>(() => Promise.resolve()),
      fail,
    };
    const processor = createLabelJobProcessor({
      backend,
      pageStore: {
        loadNormalizedPage: vi.fn<LabelPageStore["loadNormalizedPage"]>(() =>
          Promise.resolve(new Uint8Array([1])),
        ),
      },
      evaluator: {
        evaluate: vi.fn<LabelEvaluator["evaluate"]>(() =>
          Promise.reject(new OpenRouterLabelEvaluationError("upstream", true)),
        ),
      },
    });

    await expect(processor.process(analysisId)).rejects.toMatchObject({ retryable: true });
    expect(fail).not.toHaveBeenCalled();
  });
});
