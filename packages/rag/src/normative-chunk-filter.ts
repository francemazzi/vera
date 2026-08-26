const NORMATIVE_SIGNAL =
  /\b(art\.?|articolo|article|regolamento|regulation|direttiva|directive|decreto|d\.lgs|allegato|annex|considerando|recital|legge|legea|lege|hotarare|ordonanta|comma|paragrafo|paragraph)\b/iu;

const PORTAL_CHROME =
  /\b(menu eu law|eli background|quick search|skip to (main|content)|cookie (policy|settings)|javascript required)\b/iu;

/**
 * Chunks without a legal-act signal are portal chrome, not citable law.
 */
export function hasNormativeSignal(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 40) return false;
  if (PORTAL_CHROME.test(normalized) && !NORMATIVE_SIGNAL.test(normalized)) return false;
  return NORMATIVE_SIGNAL.test(normalized);
}
