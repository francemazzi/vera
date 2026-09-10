import { describe, expect, it } from "vitest";
import { createProductFactExtractor } from "../../src/create-product-fact-extractor.js";

const page = {
  page: 1,
  bytes: new Uint8Array([137, 80, 78, 71]),
  text: "Untrusted PDF text layer",
};
const documentId = "00000000-0000-4000-8000-000000000111";
function payload(id: string = documentId): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              products: [
                {
                  id: "sku-1",
                  name: "Synthetic coffee",
                  category: "coffee",
                  pages: [1],
                  facts: [
                    {
                      field: "analytical-result",
                      text: "Synthetic supplied result",
                      status: "OBSERVED",
                      evidence: [
                        { documentId: id, page: 2, ymin: 0, xmin: 0, ymax: 100, xmax: 100 },
                      ],
                    },
                  ],
                },
              ],
            }),
          },
        },
      ],
    }),
  );
}
describe("separate product evidence extraction", () => {
  it("retains a support document page independently of the artwork page", async () => {
    const extractor = createProductFactExtractor({
      apiKey: "synthetic-key",
      model: "google/gemini-2.5-flash",
      timeoutMs: 1000,
      fetch: async () => payload(),
    });
    const result = await extractor.extract(
      [page],
      [
        {
          id: documentId,
          fileName: "certificate.pdf",
          productReference: "sku-1",
          revision: "r1",
          pages: [{ ...page, page: 2 }],
        },
      ],
    );
    expect(result.facts.products[0]?.facts[0]?.evidence[0]).toMatchObject({ documentId, page: 2 });
    expect(result.facts.products[0]?.pages).toEqual([1]);
  });
  it("rejects a documentary reference that was never supplied", async () => {
    const extractor = createProductFactExtractor({
      apiKey: "synthetic-key",
      model: "google/gemini-2.5-flash",
      timeoutMs: 1000,
      fetch: async () => payload(),
    });
    await expect(extractor.extract([page])).rejects.toThrow(
      "Unknown supporting evidence reference",
    );
  });
  it("marks provider timeouts retryable while preserving the original upload", async () => {
    const extractor = createProductFactExtractor({
      apiKey: "synthetic-key",
      model: "google/gemini-2.5-flash",
      timeoutMs: 1000,
      fetch: async () => {
        throw new DOMException("Synthetic timeout", "TimeoutError");
      },
    });
    await expect(extractor.extract([page])).rejects.toMatchObject({ retryable: true });
  });
});
