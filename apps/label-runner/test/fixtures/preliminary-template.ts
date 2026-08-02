import { LABEL_FIELD_CODES } from "../../src/contracts.js";
import type { PreliminaryTemplate } from "../../src/contracts.js";

export const sourceSnapshot = "a".repeat(64);

export const preliminaryTemplate: PreliminaryTemplate = {
  id: "eu-it-preliminary-v1",
  version: "1",
  promptVersion: "label-preliminary-eu-it-v1",
  sourceSnapshot,
  citations: [
    { id: "eu-1169", label: "EU 1169", url: "https://example.test/eu-1169", reference: "Food information" },
    { id: "eu-lot-2011-91", label: "EU lot", url: "https://example.test/lot", reference: "Lot" },
    { id: "it-231-2017", label: "IT 231", url: "https://example.test/it", reference: "Italy" },
  ],
  sourceArchives: [
    { id: "eu-1169", url: "https://example.test/eu-1169", mediaType: "text/html" },
    { id: "eu-lot-2011-91", url: "https://example.test/lot", mediaType: "text/html" },
    { id: "it-231-2017", url: "https://example.test/it", mediaType: "text/html" },
  ],
  controls: LABEL_FIELD_CODES.map((fieldCode) => ({
    fieldCode,
    instruction: "Synthetic preliminary instruction",
    citationIds: ["eu-1169"] as const,
    topics: ["food-labelling"],
    ...(fieldCode === "biologico" ? { sectorSpecific: true as const } : {}),
  })),
};
