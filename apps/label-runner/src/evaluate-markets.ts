import type { LabelControlSourceContext } from "./source-retriever.js";
import { mapConcurrently } from "./map-concurrently.js";
import type { LabelEvaluator } from "./openrouter-evaluator.js";
import type { RunnerEvaluation } from "./contracts.js";

const RANK = { NOT_APPLICABLE: 0, PASS: 1, REVIEW: 2, FAIL: 3 } as const;

/** Evaluates destinations independently so one country's evidence cannot justify another. */
export async function evaluateMarkets(
  evaluator: LabelEvaluator,
  input: Parameters<LabelEvaluator["evaluate"]>[0],
): Promise<RunnerEvaluation> {
  const markets = input.regulatoryScope.marketScopes;
  if (!markets?.length || input.template.version !== "3") return evaluator.evaluate(input);
  const products = input.productFacts?.products;
  const tasks = markets.flatMap((market) =>
    (products?.length ? products : [undefined]).map((product) => ({ market, product })),
  );
  const startedAt: number = Date.now();
  const results = await mapConcurrently(tasks, 3, async ({ market, product }) => {
    const controls: readonly LabelControlSourceContext[] =
      input.sources.byMarket?.find((entry) => entry.countryCode === market.countryCode)?.controls ??
      input.template.controls.map(({ fieldCode }) => ({ fieldCode, citations: [] }));
    const evaluation: RunnerEvaluation = await evaluator.evaluate({
      ...input,
      countryCodes: [market.countryCode],
      ...(product
        ? {
            focusedProductId: product.id,
            productCategory: product.category,
            productFacts: { products: [product] },
            pages: input.pages.filter((page) => product.pages.includes(page.page)),
          }
        : {}),
      regulatoryScope: { ...input.regulatoryScope, ...market, marketScopes: [market] },
      sources: {
        controls: product
          ? controls.map((control) => ({
              fieldCode: control.fieldCode,
              citations: control.byCategory?.[product.category] ?? control.citations,
            }))
          : controls,
        sourceSnapshot: input.sources.sourceSnapshot,
      },
    });
    return { market: market.countryCode, productId: product?.id, evaluation };
  });
  const first: RunnerEvaluation = results[0]!.evaluation;
  const sum = (
    key: "inputTokens" | "outputTokens" | "totalTokens" | "estimatedCostUsd",
  ): number | null =>
    results.some((entry) => entry.evaluation.usage[key] === null)
      ? null
      : results.reduce((total, entry) => total + (entry.evaluation.usage[key] ?? 0), 0);
  return {
    ...first,
    usage: {
      inputTokens: sum("inputTokens"),
      outputTokens: sum("outputTokens"),
      totalTokens: sum("totalTokens"),
      estimatedCostUsd: sum("estimatedCostUsd"),
      latencyMs: Date.now() - startedAt,
    },
    controls: input.template.controls.map(({ fieldCode }) => {
      const rows = results.map(({ market, productId, evaluation }) => ({
        market,
        productId,
        control: evaluation.controls.find((control) => control.fieldCode === fieldCode)!,
      }));
      const worst = rows.reduce((left, right) =>
        RANK[right.control.outcome] > RANK[left.control.outcome] ? right : left,
      ).control;
      return {
        ...worst,
        citations: [
          ...new Map(
            rows
              .flatMap(({ control }) => control.citations)
              .map((citation) => [citation.chunkId, citation]),
          ).values(),
        ],
        marketFeedback: rows.map(({ market, productId, control }) => ({
          market,
          ...(productId ? { productId } : {}),
          outcome: control.outcome,
          consultantStatus: control.consultantStatus ?? "ATTENZIONE",
          rationale: control.rationale,
          ...(control.assessment ? { assessment: control.assessment } : {}),
          ...(control.boundingBox ? { boundingBox: control.boundingBox } : {}),
          citationChunkIds: control.citations.map((citation) => citation.chunkId),
          ...(control.correctiveSuggestion
            ? { correctiveSuggestion: control.correctiveSuggestion }
            : {}),
        })),
      };
    }),
  };
}
