const LEGAL_CONTAINER_IDS = new Set([
  "documentcontent",
  "texteonly",
  "text",
  "document1",
  "eli-container",
]);

/**
 * Prefer the official act body over EUR-Lex/Normattiva portal chrome.
 */
export function selectOfficialHtmlBody(markup: string): string {
  const main = firstElementInnerHtml(markup, "main");
  if (main && main.trim().length > 40) return main;
  const article = firstElementInnerHtml(markup, "article");
  if (article && article.trim().length > 40) return article;
  for (const id of LEGAL_CONTAINER_IDS) {
    const byId = elementInnerHtmlById(markup, id);
    if (byId && byId.trim().length > 40) return byId;
  }
  return markup;
}

function firstElementInnerHtml(markup: string, tag: string): string | null {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "iu");
  const match = open.exec(markup);
  if (!match || match.index === undefined) return null;
  const start = match.index + match[0].length;
  const close = markup.toLowerCase().indexOf(`</${tag}>`, start);
  if (close === -1) return null;
  return markup.slice(start, close);
}

function elementInnerHtmlById(markup: string, id: string): string | null {
  const open = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bid\\s*=\\s*["']${id}["'][^>]*>`, "iu");
  const match = open.exec(markup);
  if (!match || match.index === undefined || match[1] === undefined) return null;
  const tag = match[1];
  const start = match.index + match[0].length;
  const close = markup.toLowerCase().indexOf(`</${tag.toLowerCase()}>`, start);
  if (close === -1) return null;
  return markup.slice(start, close);
}
