import { describe, expect, it } from "vitest";

import { selectOfficialHtmlBody } from "../../src/official-html-body.js";

describe("official HTML body selection", () => {
  it("prefers main over EUR-Lex navigation chrome", () => {
    const markup = [
      "<html><body>",
      "<nav>Menu EU law ELI background</nav>",
      "<header>Quick search</header>",
      "<main><h1>Regolamento (UE) n. 1169/2011</h1><p>Articolo 7 Pratiche leali d’informazione.</p></main>",
      "<footer>Cookies</footer>",
      "</body></html>",
    ].join("");
    const body = selectOfficialHtmlBody(markup);
    expect(body).toContain("Articolo 7");
    expect(body).not.toContain("Menu EU law");
  });

  it("preserves all articles in a nested act container inside a portal main", () => {
    const markup = [
      '<main><div>Menu EU law Treaties</div><div id="document1">',
      "<div><h2>Article 1</h2><p>First synthetic provision.</p></div>",
      "<div><h2>Article 2</h2><p>Second synthetic provision.</p></div>",
      "</div></main>",
    ].join("");
    const body = selectOfficialHtmlBody(markup);
    expect(body).toContain("Second synthetic provision.");
    expect(body).not.toContain("Menu EU law");
  });
});
