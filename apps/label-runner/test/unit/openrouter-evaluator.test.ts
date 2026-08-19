import { describe, expect, it } from "vitest";

import { LABEL_FIELD_CODES } from "../../src/contracts.js";
import { fallbackRegulatoryScope } from "../../src/source-retriever.js";
import { createOpenRouterLabelEvaluator } from "../../src/openrouter-evaluator.js";
import type { LabelEvaluator } from "../../src/openrouter-evaluator.js";
import { preliminaryTemplate, sourceSnapshot } from "../fixtures/preliminary-template.js";

function responseForFieldCodes(fieldCodes: readonly string[]): Record<string, unknown> {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            controls: fieldCodes.map((fieldCode) => ({
              fieldCode,
              indicator: "REVIEW_REQUIRED",
              rationale: "Synthetic fixture",
              confidence: 0,
            })),
          }),
        },
      },
    ],
  };
}

function responseForAllPreliminary(): Record<string, unknown> {
  return responseForFieldCodes(LABEL_FIELD_CODES);
}

function responseWithBoundingBox(fieldCode: string, boundingBox: unknown): Record<string, unknown> {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            controls: LABEL_FIELD_CODES.map((code) => ({
              code,
              indicator: "REVIEW_REQUIRED",
              rationale: "Synthetic fixture",
              confidence: 0,
              ...(code === fieldCode ? { boundingBox } : {}),
            })).map(({ code, ...rest }) => ({ fieldCode: code, ...rest })),
          }),
        },
      },
    ],
  };
}

function fetchReturning(payload: Record<string, unknown>): typeof globalThis.fetch {
  return () => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
}

function evaluatorWith(fetch: typeof globalThis.fetch): LabelEvaluator {
  return createOpenRouterLabelEvaluator({
    apiKey: "synthetic-openrouter-key-1234",
    model: "google/gemini-2.5-flash",
    promptVersion: "label-preliminary-eu-it-v1",
    rulePackVersion: "eu-it-preliminary-v1@1",
    sourceSnapshot,
    timeoutMs: 1_000,
    fetch,
  });
}

function evaluationInput(): Parameters<LabelEvaluator["evaluate"]>[0] {
  return {
    pages: [{ page: 1, bytes: new Uint8Array([137, 80, 78, 71]) }],
    countryCodes: ["IT"],
    regulatoryScope: fallbackRegulatoryScope({ countryCodes: ["IT"] }),
    sources: {
      controls: LABEL_FIELD_CODES.map((fieldCode) => ({ fieldCode, citations: [] })),
      sourceSnapshot,
    },
    template: preliminaryTemplate,
  };
}

describe("OpenRouter preliminary label evaluator", () => {
  it("sends a PNG only to OpenRouter and records pinned preliminary metadata", async () => {
    let requestBody: string | undefined;
    const fetch: typeof globalThis.fetch = (_input, init) => {
      requestBody = typeof init?.body === "string" ? init.body : undefined;
      return Promise.resolve(
        new Response(JSON.stringify(responseForAllPreliminary()), { status: 200 }),
      );
    };

    const result = await evaluatorWith(fetch).evaluate(evaluationInput());

    expect(result).toMatchObject({
      provider: "openrouter",
      model: "google/gemini-2.5-flash",
      promptVersion: "label-preliminary-eu-it-v1",
      rulePackVersion: "eu-it-preliminary-v1@1",
      sourceSnapshot,
    });
    expect(result.controls).toHaveLength(LABEL_FIELD_CODES.length);
    const request = JSON.parse(requestBody ?? "") as Record<string, unknown>;
    expect(request["provider"]).toEqual(
      expect.objectContaining({
        allow_fallbacks: true,
        data_collection: "deny",
      }),
    );
    expect(request["response_format"]).toEqual({ type: "json_object" });
    expect(request["max_tokens"]).toBe(8192);
    expect(JSON.stringify(request["messages"])).toContain("The root key must be controls");
    expect(JSON.stringify(request)).not.toContain("synthetic-openrouter-key-1234");
    expect(JSON.stringify(request)).not.toContain("sourceCitation");
  });

  it("instructs the model to copy field codes verbatim", async () => {
    let requestBody: string | undefined;
    const fetch: typeof globalThis.fetch = (_input, init) => {
      requestBody = typeof init?.body === "string" ? init.body : undefined;
      return Promise.resolve(
        new Response(JSON.stringify(responseForAllPreliminary()), { status: 200 }),
      );
    };

    await evaluatorWith(fetch).evaluate(evaluationInput());

    expect(requestBody).toContain(
      "Copy each fieldCode verbatim from the frozen control instructions below",
    );
  });

  it("repairs a single unrecognised field code and abstains on that control", async () => {
    const drifted = LABEL_FIELD_CODES.map((fieldCode) =>
      fieldCode === "elenco_ingredienti" ? "en_ingr" : fieldCode,
    );

    const result = await evaluatorWith(fetchReturning(responseForFieldCodes(drifted))).evaluate(
      evaluationInput(),
    );

    expect(result.controls).toHaveLength(LABEL_FIELD_CODES.length);
    const repaired = result.controls.find((control) => control.fieldCode === "elenco_ingredienti");
    expect(repaired).toMatchObject({
      indicator: "REVIEW_REQUIRED",
      confidence: 0,
      rationale: "Codice controllo non confermato dal modello: esito degradato a revisione.",
    });
    expect(repaired?.citations).toEqual([]);
  });

  it("refuses to guess when more than one field code is unrecognised", async () => {
    const drifted = LABEL_FIELD_CODES.map((fieldCode) => {
      if (fieldCode === "elenco_ingredienti") return "en_ingr";
      if (fieldCode === "lotto_partita") return "lot";
      return fieldCode;
    });

    await expect(
      evaluatorWith(fetchReturning(responseForFieldCodes(drifted))).evaluate(evaluationInput()),
    ).rejects.toMatchObject({ retryable: false });
  });

  it("treats a missing control as a terminal contract violation", async () => {
    const truncated = LABEL_FIELD_CODES.slice(0, LABEL_FIELD_CODES.length - 1);

    await expect(
      evaluatorWith(fetchReturning(responseForFieldCodes(truncated))).evaluate(evaluationInput()),
    ).rejects.toMatchObject({ retryable: false });
  });

  it("keeps a well formed region so the reviewer can be shown the exact zoom", async () => {
    const expectedBox = { page: 1, ymin: 120, xmin: 40, ymax: 260, xmax: 900 };

    const result = await evaluatorWith(
      fetchReturning(responseWithBoundingBox("elenco_ingredienti", expectedBox)),
    ).evaluate(evaluationInput());

    const control = result.controls.find((entry) => entry.fieldCode === "elenco_ingredienti");
    expect(control?.boundingBox).toEqual(expectedBox);
  });

  it("drops a malformed region instead of failing the evaluation", async () => {
    const inverted = { ymin: 800, xmin: 40, ymax: 100, xmax: 900 };

    const result = await evaluatorWith(
      fetchReturning(responseWithBoundingBox("elenco_ingredienti", inverted)),
    ).evaluate(evaluationInput());

    expect(result.controls).toHaveLength(LABEL_FIELD_CODES.length);
    const control = result.controls.find((entry) => entry.fieldCode === "elenco_ingredienti");
    expect(control?.boundingBox).toBeUndefined();
  });

  it("omits the region when the model reports the element as absent", async () => {
    const result = await evaluatorWith(fetchReturning(responseForAllPreliminary())).evaluate(
      evaluationInput(),
    );

    expect(result.controls.every((control) => control.boundingBox === undefined)).toBe(true);
  });

  it("keeps retrieved excerpts on REVIEW_REQUIRED when the model does not cite them", async () => {
    const retrieved = {
      chunkId: "00000000-0000-4000-8000-000000000201:art-9:0:aaaaaaaaaaaaaaaa",
      sourceVersionId: "00000000-0000-4000-8000-000000000201",
      sourceContentHash: "a".repeat(64),
      title: "Regolamento (UE) n. 1169/2011",
      documentType: "REGULATION",
      actReference: "Reg. (UE) 1169/2011",
      canonicalReference: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169",
      pdfReference: null,
      sectionId: "art-9",
      sectionTitle: "Indicazioni obbligatorie",
      pageNumber: 12,
      quote: "L'etichetta deve riportare le informazioni obbligatorie.",
    } as const;
    const base = evaluationInput();
    const input = {
      ...base,
      sources: {
        ...base.sources,
        controls: base.sources.controls.map((control) =>
          control.fieldCode === "elenco_ingredienti"
            ? { ...control, citations: [retrieved] }
            : control,
        ),
      },
    };

    const result = await evaluatorWith(fetchReturning(responseForAllPreliminary())).evaluate(input);
    const control = result.controls.find((entry) => entry.fieldCode === "elenco_ingredienti");
    expect(control).toMatchObject({
      indicator: "REVIEW_REQUIRED",
      citations: [retrieved],
    });
  });

  it("never asks for a paid retry of a deterministic schema violation", async () => {
    const invalid = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              controls: LABEL_FIELD_CODES.map((fieldCode) => ({
                fieldCode,
                indicator: "CONFORME",
                rationale: "Ingredienti: farina di FRUMENTO",
                confidence: 0,
              })),
            }),
          },
        },
      ],
    };

    const failure = await evaluatorWith(fetchReturning(invalid))
      .evaluate(evaluationInput())
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ retryable: false });
    // The diagnostic carries issue paths and codes only: model output can echo
    // confidential label content and must never reach a log or an error string.
    const message = failure instanceof Error ? failure.message : "";
    expect(message).toContain("does not satisfy the runner contract");
    expect(message).not.toContain("CONFORME");
    expect(message).not.toContain("FRUMENTO");
  });
});
