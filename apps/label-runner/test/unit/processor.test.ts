import { describe, expect, it, vi } from "vitest";

import { LABEL_FIELD_CODES } from "../../src/contracts.js";
import type { RunnerEvaluation, RunnerInput } from "../../src/contracts.js";
import type { LabelBackendClient } from "../../src/backend-client.js";
import { OpenRouterLabelEvaluationError } from "../../src/openrouter-evaluator.js";
import type { LabelEvaluator } from "../../src/openrouter-evaluator.js";
import type { LabelPageStore } from "../../src/page-store.js";
import { createLabelJobProcessor } from "../../src/processor.js";
import { preliminaryTemplate, sourceSnapshot } from "../fixtures/preliminary-template.js";

const analysisId = "00000000-0000-4000-8000-000000000101";

function input(
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED" = "QUEUED",
): RunnerInput {
  return {
    id: analysisId,
    workspaceId: "00000000-0000-4000-8000-000000000102",
    countryCodes: ["IT"],
    inputSha256: "b".repeat(64),
    normalizedPageObjectKey: "label-analyses/workspace-1/analysis-1/page-1.png",
    normalizedPages: [
      {
        page: 1,
        objectKey: "label-analyses/workspace-1/analysis-1/page-1.png",
        sha256: "c".repeat(64),
      },
    ],
    status,
    version: 2,
    assessmentMode: "PRELIMINARY",
    productCategory: "generic-prepacked",
    preliminaryTemplate,
  };
}

function evaluation(): RunnerEvaluation {
  return {
    provider: "openrouter",
    model: "google/gemini-2.5-flash",
    promptVersion: "label-preliminary-eu-it-v1",
    rulePackVersion: "eu-it-preliminary-v1@1",
    sourceSnapshot,
    usage: {
      inputTokens: 12,
      outputTokens: 34,
      totalTokens: 46,
      estimatedCostUsd: 0.0001,
      latencyMs: 100,
    },
    controls: LABEL_FIELD_CODES.map((fieldCode) => ({
      fieldCode,
      indicator: "REVIEW_REQUIRED" as const,
      rationale: "Synthetic test fixture",
      confidence: 0,
      citations: [],
    })),
  };
}

describe("LabelJobProcessor", () => {
  it("claims once, evaluates the private page and completes with preliminary metadata", async () => {
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
      loadNormalizedPages: vi.fn<LabelPageStore["loadNormalizedPages"]>(() =>
        Promise.resolve([{ page: 1, bytes: new Uint8Array([137, 80, 78, 71]) }]),
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
    expect(evaluator.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ countryCodes: ["IT"], template: preliminaryTemplate }),
    );
  });

  it("passes the frozen global retrieval manifest through to the callback without changing its controls or citations", async () => {
    const retrievedControls = LABEL_FIELD_CODES.map((fieldCode) => ({
      fieldCode,
      citations: [
        {
          chunkId: `source-version-1:${fieldCode}:0:deadbeef`,
          sourceVersionId: "00000000-0000-4000-8000-000000000109",
          sourceContentHash: "c".repeat(64),
          title: "Verified official source",
          documentType: "REGULATION",
          actReference: "Regulation 1/2026",
          canonicalReference: "https://official.example.test/act/1",
          pdfReference: null,
          sectionId: "article-1",
          sectionTitle: "Article 1",
          pageNumber: 1,
          quote: "Mandatory food-label information.",
        },
      ],
    }));
    const globalInput: RunnerInput = {
      ...input(),
      regulatoryScope: {
        countryCode: "RO",
        regulatoryAreas: ["EU"],
        jurisdictions: ["EU", "RO"],
        language: "ro",
        evaluationDate: "2026-07-20T00:00:00.000Z",
      },
      preliminaryTemplate: {
        ...preliminaryTemplate,
        id: "global-food-label-preliminary-v1",
        promptVersion: "label-preliminary-rag-v1",
        citations: [],
        sourceArchives: [],
      },
    };
    const retrievedSnapshot = "d".repeat(64);
    const complete = vi.fn<LabelBackendClient["complete"]>(() => Promise.resolve());
    const backend: LabelBackendClient = {
      getInput: vi.fn<LabelBackendClient["getInput"]>(() => Promise.resolve(globalInput)),
      claim: vi.fn<LabelBackendClient["claim"]>(() => Promise.resolve({ acquired: true, version: 3 })),
      complete,
      fail: vi.fn<LabelBackendClient["fail"]>(() => Promise.resolve()),
    };
    const processor = createLabelJobProcessor({
      backend,
      pageStore: {
        loadNormalizedPages: vi.fn<LabelPageStore["loadNormalizedPages"]>(() =>
          Promise.resolve([{ page: 1, bytes: new Uint8Array([137, 80, 78, 71]) }]),
        ),
      },
      evaluator: {
        evaluate: vi.fn<LabelEvaluator["evaluate"]>(() =>
          Promise.resolve({
            ...evaluation(),
            promptVersion: "label-preliminary-rag-v1",
            rulePackVersion: "global-food-label-preliminary-v1@1",
            sourceSnapshot: retrievedSnapshot,
          }),
        ),
      },
      sourceRetriever: {
        retrieve: vi.fn().mockResolvedValue({
          controls: retrievedControls,
          sourceSnapshot: retrievedSnapshot,
        }),
      },
      createInvocationId: () => "00000000-0000-4000-8000-000000000108",
    });

    await expect(processor.process(analysisId)).resolves.toEqual({ replayed: false });
    const completed = complete.mock.calls[0]?.[0];
    expect(completed?.evaluation.sourceManifest).toEqual({ controls: retrievedControls });
    expect(completed?.evaluation.sourceSnapshot).toBe(retrievedSnapshot);
  });

  it("acknowledges a duplicate job without downloading or evaluating the image", async () => {
    const loadNormalizedPages = vi.fn<LabelPageStore["loadNormalizedPages"]>(() =>
      Promise.resolve([{ page: 1, bytes: new Uint8Array([1]) }]),
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
    const processor = createLabelJobProcessor({
      backend,
      pageStore: { loadNormalizedPages },
      evaluator: { evaluate },
    });

    await expect(processor.process(analysisId)).resolves.toEqual({ replayed: true });
    expect(loadNormalizedPages).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("records source readiness instead of calling the model when any governed RAG control is uncovered", async () => {
    const fail = vi.fn<LabelBackendClient["fail"]>(() => Promise.resolve());
    const evaluate = vi.fn<LabelEvaluator["evaluate"]>(() => Promise.resolve(evaluation()));
    const processor = createLabelJobProcessor({
      backend: {
        getInput: vi.fn<LabelBackendClient["getInput"]>(() => Promise.resolve(input())),
        claim: vi.fn<LabelBackendClient["claim"]>(() => Promise.resolve({ acquired: true, version: 3 })),
        complete: vi.fn<LabelBackendClient["complete"]>(() => Promise.resolve()),
        fail,
      },
      pageStore: {
        loadNormalizedPages: vi.fn<LabelPageStore["loadNormalizedPages"]>(() =>
          Promise.resolve([{ page: 1, bytes: new Uint8Array([1]) }]),
        ),
      },
      evaluator: { evaluate },
      sourceRetriever: {
        retrieve: vi.fn().mockResolvedValue({
          controls: LABEL_FIELD_CODES.map((fieldCode) => ({ fieldCode, citations: [] })),
          sourceSnapshot,
        }),
      },
      createInvocationId: () => "runner-invocation-readiness",
    });

    await expect(processor.process(analysisId)).resolves.toEqual({ replayed: false });
    expect(evaluate).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ analysisId, expectedVersion: 3, failureCode: "SOURCE_READINESS_BLOCKED" }),
    );
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
        loadNormalizedPages: vi.fn<LabelPageStore["loadNormalizedPages"]>(() =>
          Promise.resolve([{ page: 1, bytes: new Uint8Array([1]) }]),
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
