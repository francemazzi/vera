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
  for (const id of LEGAL_CONTAINER_IDS) {
    const byId = elementInnerHtmlById(markup, id);
    if (byId && byId.trim().length > 40) return byId;
  }
  const main = firstElementInnerHtml(markup, "main");
  if (main && main.trim().length > 40) return main;
  const article = firstElementInnerHtml(markup, "article");
  if (article && article.trim().length > 40) return article;
  return markup;
}

function firstElementInnerHtml(markup: string, tag: string): string | null {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "iu");
  const match = open.exec(markup);
  if (!match || match.index === undefined) return null;
  const start = match.index + match[0].length;
  return readElementBody(markup, tag, start);
}

function elementInnerHtmlById(markup: string, id: string): string | null {
  const open = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bid\\s*=\\s*["']${id}["'][^>]*>`, "iu");
  const match = open.exec(markup);
  if (!match || match.index === undefined || match[1] === undefined) return null;
  const tag = match[1];
  const start = match.index + match[0].length;
  return readElementBody(markup, tag, start);
}

function readElementBody(markup: string, tag: string, start: number): string | null {
  const tags: RegExp = new RegExp(`<(/?)${tag}\\b[^>]*>`, "giu");
  tags.lastIndex = start;
  let depth: number = 1;
  for (let match = tags.exec(markup); match; match = tags.exec(markup)) {
    if (match[1]) depth -= 1;
    else if (!match[0].endsWith("/>")) depth += 1;
    if (depth === 0) return markup.slice(start, match.index);
  }
  return null;
}
