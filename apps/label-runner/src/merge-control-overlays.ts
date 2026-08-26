import { LABEL_FIELD_CODES } from "./contracts.js";
import type { ControlOverlay } from "./product-category-overlay.js";
import { overlayInstructionsForCategory } from "./product-category-overlay.js";
import { overlayInstructionsForMarket } from "./market-overlay.js";

type LabelFieldCode = (typeof LABEL_FIELD_CODES)[number];

/**
 * Concatenates category and market instructions for the same field_code.
 */
export function mergeControlOverlays(
  category: ControlOverlay,
  market: ControlOverlay,
): ControlOverlay {
  const codes = new Set([
    ...(Object.keys(category) as LabelFieldCode[]),
    ...(Object.keys(market) as LabelFieldCode[]),
  ]);
  const merged: Partial<Record<LabelFieldCode, string>> = {};
  for (const fieldCode of codes) {
    const parts = [category[fieldCode], market[fieldCode]].filter(Boolean);
    if (parts.length > 0) merged[fieldCode] = parts.join(" ");
  }
  return merged;
}

/**
 * Overlay text injected into the evaluator prompt for one market and category.
 */
export function overlayInstructionsForEvaluation(input: {
  readonly productCategory: string;
  readonly countryCode: string;
}): ControlOverlay {
  return mergeControlOverlays(
    overlayInstructionsForCategory(input.productCategory),
    overlayInstructionsForMarket(input.countryCode),
  );
}
