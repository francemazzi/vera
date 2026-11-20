import type { RunnerBoundingBox, RunnerEvaluation } from "./contracts.js";

/** Resolves a model-selected fact to the original artwork of the focused product. */
export function resolveControlEvidence(input: {
  readonly fieldCode: string;
  readonly observation: string;
  readonly reference?: Readonly<{ factIndex: number; regionIndex: number }>;
  readonly productFacts: RunnerEvaluation["productFacts"];
  readonly focusedProductId: string | undefined;
}): Readonly<{ boundingBox: RunnerBoundingBox; observedText: string }> | undefined {
  if (input.observation !== "OBSERVED" || !input.reference) return undefined;
  const products = input.productFacts?.products ?? [];
  const product = input.focusedProductId
    ? products.find(({ id }) => id === input.focusedProductId)
    : products.length === 1
      ? products[0]
      : undefined;
  const fact = product?.facts[input.reference.factIndex];
  if (!product || fact?.field !== input.fieldCode || fact.status !== "OBSERVED") return undefined;
  const region = fact.evidence[input.reference.regionIndex];
  if (!region || region.documentId || !product.pages.includes(region.page)) return undefined;
  const observedText: string = fact.text.trim();
  const spanX: number = region.xmax - region.xmin;
  const spanY: number = region.ymax - region.ymin;
  if (!observedText || (spanX >= 940 && spanY >= 940)) return undefined;

  const marginX: number = Math.max(6, Math.ceil(spanX * 0.12));
  const marginY: number = Math.max(6, Math.ceil(spanY * 0.12));
  return {
    observedText,
    boundingBox: {
      page: region.page,
      xmin: Math.max(region.xmin - marginX, 0),
      ymin: Math.max(region.ymin - marginY, 0),
      xmax: Math.min(region.xmax + marginX, 1_000),
      ymax: Math.min(region.ymax + marginY, 1_000),
    },
  };
}
