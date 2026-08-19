import { describe, expect, it, vi } from "vitest";

import { LABEL_FIELD_CODES } from "../../src/contracts.js";
import { createChromaLabelSourceRetriever } from "../../src/source-retriever.js";
import { preliminaryTemplate } from "../fixtures/preliminary-template.js";

const citation = {
  chunkId: "00000000-0000-4000-8000-000000000201:art-9:0:aaaaaaaaaaaaaaaa",
  sourceVersionId: "00000000-0000-4000-8000-000000000201",
  sourceContentHash: "a".repeat(64),
  title: "Regolamento (UE) n. 1169/2011",
  documentType: "REGULATION",
  actReference: "Reg. (UE) 1169/2011",
  canonicalReference: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169",
  pdfReference: null,
  sectionId: "art-9",
  sectionTitle: "Indicazioni obbligatorie",
  pageNumber: 12,
  quote: "L'etichetta deve riportare le informazioni obbligatorie.",
} as const;

describe("Chroma label source retriever", () => {
  it("queries only the frozen EU+market scope and returns auditable citations", async () => {
    const retrievePreliminarySafely = vi.fn(() =>
      Promise.resolve({
        status: "AVAILABLE" as const,
        scope: "PRELIMINARY" as const,
        requiresReview: true as const,
        chunks: [
          {
            ...citation,
            sourceId: "00000000-0000-4000-8000-000000000202",
            workspaceScope: "00000000-0000-4000-8000-000000000203",
            sourceState: "VERIFIED" as const,
            validityStatus: "ADMIN_DECLARED" as const,
            jurisdiction: "EU",
            language: "it",
            revisionLabel: "2026-01",
            validity: { validFrom: "2020-01-01T00:00:00.000Z", validTo: null },
            productCategories: ["generic-prepacked"],
            chunkOrdinal: 0,
            text: citation.quote,
            contentHash: "b".repeat(64),
            score: 0.9,
            citation,
          },
        ],
      }),
    );
    const retriever = createChromaLabelSourceRetriever({ ragIndex: { retrievePreliminarySafely } });

    const result = await retriever.retrieve({
      workspaceId: "00000000-0000-4000-8000-000000000203",
      scope: {
        countryCode: "IT",
        regulatoryAreas: ["EU"],
        jurisdictions: ["EU", "IT"],
        language: "it",
        evaluationDate: "2026-07-20T00:00:00.000Z",
      },
      productCategory: "generic-prepacked",
      template: preliminaryTemplate,
    });

    expect(retrievePreliminarySafely).toHaveBeenCalledTimes(LABEL_FIELD_CODES.length);
    expect(retrievePreliminarySafely).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "00000000-0000-4000-8000-000000000203",
        jurisdictions: ["EU", "IT"],
        language: "it",
        productCategory: "generic-prepacked",
      }),
    );
    expect(result.controls).toHaveLength(LABEL_FIELD_CODES.length);
    expect(result.controls[0]?.citations).toEqual([citation]);
    expect(result.sourceSnapshot).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("retries without topic and category filters when the first query is empty", async () => {
    const retrievePreliminarySafely = vi.fn(async (query: { labelingTopics?: unknown; productCategory?: unknown }) => {
      if (query.labelingTopics !== undefined || query.productCategory !== undefined) {
        return {
          status: "UNAVAILABLE" as const,
          scope: "PRELIMINARY" as const,
          requiresReview: true as const,
          reason: "VECTOR_STORE_INVALID: filter",
        };
      }
      return {
        status: "AVAILABLE" as const,
        scope: "PRELIMINARY" as const,
        requiresReview: true as const,
        chunks: [
          {
            ...citation,
            sourceId: "00000000-0000-4000-8000-000000000202",
            workspaceScope: "00000000-0000-4000-8000-000000000203",
            sourceState: "VERIFIED" as const,
            validityStatus: "ADMIN_DECLARED" as const,
            jurisdiction: "EU",
            language: "it",
            revisionLabel: "2026-01",
            validity: { validFrom: "2020-01-01T00:00:00.000Z", validTo: null },
            productCategories: ["generic-prepacked"],
            chunkOrdinal: 0,
            text: citation.quote,
            contentHash: "b".repeat(64),
            score: 0.9,
            citation,
          },
        ],
      };
    });
    const retriever = createChromaLabelSourceRetriever({ ragIndex: { retrievePreliminarySafely } });
    const result = await retriever.retrieve({
      workspaceId: "00000000-0000-4000-8000-000000000203",
      scope: {
        countryCode: "IT",
        regulatoryAreas: ["EU"],
        jurisdictions: ["EU", "IT"],
        language: "it",
        evaluationDate: "2026-07-20T00:00:00.000Z",
      },
      productCategory: "generic-prepacked",
      template: preliminaryTemplate,
    });
    expect(result.controls[0]?.citations).toEqual([citation]);
    expect(retrievePreliminarySafely).toHaveBeenCalled();
  });

  it("turns a RAG outage into an empty evidence set, never an invented citation", async () => {
    const retriever = createChromaLabelSourceRetriever({
      ragIndex: {
        retrievePreliminarySafely: () =>
          Promise.resolve({
            status: "UNAVAILABLE" as const,
            scope: "PRELIMINARY" as const,
            requiresReview: true as const,
            reason: "PROVIDER_UNAVAILABLE: offline",
          }),
      },
    });

    const result = await retriever.retrieve({
      workspaceId: "00000000-0000-4000-8000-000000000204",
      scope: {
        countryCode: "RO",
        regulatoryAreas: ["EU"],
        jurisdictions: ["EU", "RO"],
        language: "ro",
        evaluationDate: "2026-07-20T00:00:00.000Z",
      },
      productCategory: "generic-prepacked",
      template: preliminaryTemplate,
    });

    expect(result.controls.every((control) => control.citations.length === 0)).toBe(true);
  });
});
