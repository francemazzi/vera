import { isLabelPortalBoilerplate } from "./is-label-portal-boilerplate.js";

const NORMATIVE_SIGNAL =
  /\b(art\.?|articolo|article|regolamento|regulation|direttiva|directive|decreto|d\.lgs|allegato|annex|considerando|recital|legge|legea|lege|hotarare|ordonanta|comma|paragrafo|paragraph|cfr|u\.?s\.?c\.?|section|sec\.|subsection)\b|§/iu;

/**
 * Chunks without a legal-act signal are portal chrome, not citable law.
 */
export function hasNormativeSignal(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 40) return false;
  return !isLabelPortalBoilerplate(normalized) && NORMATIVE_SIGNAL.test(normalized);
}
