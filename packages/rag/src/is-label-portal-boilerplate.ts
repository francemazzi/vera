const PORTAL_TEXT: readonly RegExp[] = [
  /\bnormattiva\s*[-–—:]\s*errore\b/iu,
  /\bmenu\s+eu law\b/iu,
  /\btreaties currently in force\s+founding treaties\b/iu,
  /\beli background\s+why implement eli\b/iu,
  /\bhow to implement eli\s+glossary\b/iu,
  /^(?:quick search|skip to (?:main|content)|cookie (?:policy|settings)|javascript required)(?:[.!])?$/iu,
  /^(?:normattiva|in collaborazione con|con il contributo di|presidenza del consiglio dei ministri)$/iu,
];

/** Matches known portal chrome and failure pages rather than legal provisions. */
export function isLabelPortalBoilerplate(text: string): boolean {
  const normalized: string = text.replace(/\s+/gu, " ").trim();
  return PORTAL_TEXT.some((pattern) => pattern.test(normalized));
}
