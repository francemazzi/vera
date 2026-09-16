import type { RunnerSourceCitation } from "./contracts.js";

const PINNED_SOURCE_VERSION_ID = "00000000-0000-4000-8000-000000000101";
const PINNED_SOURCE_CONTENT_HASH = "b".repeat(64);

function pinnedChunkId(suffix: string): string {
  return `${PINNED_SOURCE_VERSION_ID}:${suffix}`;
}

function citation(input: {
  readonly chunkId: string;
  readonly actReference: string;
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly quote: string;
  readonly canonicalReference: string;
}): RunnerSourceCitation {
  return {
    chunkId: pinnedChunkId(input.chunkId),
    sourceVersionId: PINNED_SOURCE_VERSION_ID,
    sourceContentHash: PINNED_SOURCE_CONTENT_HASH,
    title: input.actReference,
    documentType: "REGULATION",
    actReference: input.actReference,
    canonicalReference: input.canonicalReference,
    pdfReference: null,
    sectionId: input.sectionId,
    sectionTitle: input.sectionTitle,
    pageNumber: null,
    quote: input.quote,
    provenance: "PINNED_OFFICIAL",
  };
}

const US_PINNED: readonly RunnerSourceCitation[] = [
  citation({
    chunkId: "us-cfr-101-12-pasta-racc",
    actReference: "21 CFR 101.12",
    sectionId: "101.12-b-table-2-pastas",
    sectionTitle: "Table 2 — Pastas, plain",
    quote:
      "Reference amount for pastas, plain, dry is 55 g. For bulk products the serving size is expressed as 2 oz (56 g/visual unit of measure).",
    canonicalReference:
      "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/section-101.12",
  }),
  citation({
    chunkId: "us-cfr-101-7-pdp-net-qty",
    actReference: "21 CFR 101.7",
    sectionId: "101.7-a-i",
    sectionTitle: "Declaration of net quantity of contents",
    quote:
      "The principal display panel of a food in package form shall bear a declaration of the net quantity of contents. The declaration shall appear as a distinct item in the lower 30 percent of the area of the label panel in lines generally parallel to the base.",
    canonicalReference:
      "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/section-101.7",
  }),
  citation({
    chunkId: "us-cfr-101-9-nutrition",
    actReference: "21 CFR 101.9",
    sectionId: "101.9-b",
    sectionTitle: "Nutrition labeling of food — serving size",
    quote:
      "The serving size declared on a product shall be determined from the use of the reference amounts customarily consumed and shall be expressed in common household measure and metric measure.",
    canonicalReference:
      "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/section-101.9",
  }),
  citation({
    chunkId: "us-cfr-139-150-egg-noodles",
    actReference: "21 CFR 139.150",
    sectionId: "139.150-a",
    sectionTitle: "Noodle products — identity",
    quote:
      "Noodle products are the class of food each of which is prepared by drying formed units of dough made from semolina, durum flour, farina, flour, or any combination of two or more of these, with liquid eggs, frozen eggs, dried eggs, egg yolks, frozen yolks, dried yolks, or any combination of two or more of these, with or without water.",
    canonicalReference:
      "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-139/section-139.150",
  }),
  citation({
    chunkId: "us-cfr-101-3-identity",
    actReference: "21 CFR 101.3",
    sectionId: "101.3-a",
    sectionTitle: "Identity labeling of food in packaged form",
    quote:
      "The principal display panel of a food in package form shall bear as one of its principal features a statement of the identity of the commodity.",
    canonicalReference:
      "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/section-101.3",
  }),
  citation({
    chunkId: "us-cfr-101-2-panels",
    actReference: "21 CFR 101.2",
    sectionId: "101.2-b",
    sectionTitle: "Information panel of package form food",
    quote:
      "The information panel is that part of the label immediately contiguous and to the right of the principal display panel. Nutrition Facts, the ingredient statement and the name and place of business may appear on the information panel.",
    canonicalReference:
      "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/section-101.2",
  }),
  citation({
    chunkId: "us-7-cfr-205-303",
    actReference: "7 CFR 205.303",
    sectionId: "205.303-a",
    sectionTitle: "Packaged products labeled “organic”",
    quote:
      "Agricultural products in packages described in § 205.301(a) and (b) may display the USDA seal and must identify the certifying agent on the information panel.",
    canonicalReference:
      "https://www.ecfr.gov/current/title-7/subtitle-B/chapter-I/subchapter-M/part-205/section-205.303",
  }),
  citation({
    chunkId: "us-cfr-101-4-ingredients",
    actReference: "21 CFR 101.4",
    sectionId: "101.4-a-1",
    sectionTitle: "Food; designation of ingredients",
    quote:
      "Ingredients required to be declared on the label of a food shall be listed by common or usual name in descending order of predominance by weight.",
    canonicalReference:
      "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/section-101.4",
  }),
  citation({
    chunkId: "us-cfr-101-15-allergen-prominence",
    actReference: "21 CFR 101.15",
    sectionId: "101.15-a",
    sectionTitle: "Food; prominence of required statements",
    quote:
      "A word, statement, or other information required by or under authority of the act to appear on the label shall appear thereon with such conspicuousness and in such terms as to render it likely to be read and understood by the ordinary individual under customary conditions of purchase and use.",
    canonicalReference:
      "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/section-101.15",
  }),
  citation({
    chunkId: "us-ca-ab-660-quality-date",
    actReference: "California AB 660 (2023)",
    sectionId: "ab-660-best-if-used-by",
    sectionTitle: "Food date labeling",
    quote:
      "On and after July 1, 2026, a food manufacturer, processor, or retailer that chooses to include a quality date on a food product shall use the phrase “BEST if Used by” to indicate quality.",
    canonicalReference:
      "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202320240AB660",
  }),
];

const US_FIELD_CHUNK_IDS: Readonly<Record<string, readonly string[]>> = {
  campo_visivo: [
    pinnedChunkId("us-cfr-101-7-pdp-net-qty"),
    pinnedChunkId("us-cfr-101-3-identity"),
    pinnedChunkId("us-cfr-101-2-panels"),
  ],
  denominazione_commerciale: [pinnedChunkId("us-cfr-101-3-identity")],
  denominazione_legale_vendita: [
    pinnedChunkId("us-cfr-101-3-identity"),
    pinnedChunkId("us-cfr-139-150-egg-noodles"),
  ],
  etichettatura_specifica_prodotto: [pinnedChunkId("us-cfr-139-150-egg-noodles")],
  elenco_ingredienti: [pinnedChunkId("us-cfr-101-4-ingredients")],
  indicazione_allergeni: [pinnedChunkId("us-cfr-101-15-allergen-prominence")],
  informazioni_nutrizionali: [
    pinnedChunkId("us-cfr-101-12-pasta-racc"),
    pinnedChunkId("us-cfr-101-9-nutrition"),
  ],
  quantita_netto_volume_nominale: [pinnedChunkId("us-cfr-101-7-pdp-net-qty")],
  biologico: [pinnedChunkId("us-7-cfr-205-303")],
  termine_minimo_conservazione_data_scadenza: [pinnedChunkId("us-ca-ab-660-quality-date")],
  indicazioni_aggiuntive: [pinnedChunkId("us-cfr-101-15-allergen-prominence")],
  atmosfera_protettiva: [pinnedChunkId("us-cfr-101-2-panels")],
  bollatura_sanitaria_marchio_identificazione: [pinnedChunkId("us-cfr-101-2-panels")],
  denominazioni_dop_igp_stg: [pinnedChunkId("us-cfr-101-3-identity")],
  indicazioni_ambientali: [pinnedChunkId("us-cfr-101-2-panels")],
  sede_stabilimento_produzione_confezionamento: [pinnedChunkId("us-cfr-101-2-panels")],
  origine_ingrediente_primario: [pinnedChunkId("us-cfr-101-3-identity")],
  condizioni_particolari_conservazione: [pinnedChunkId("us-cfr-101-2-panels")],
  istruzioni_uso: [pinnedChunkId("us-cfr-101-2-panels")],
};

/**
 * Versioned official excerpts used when Chroma returns no chunk for a control.
 * They remain distinguishable from retrieved RAG evidence via provenance.
 */
export function pinnedCitationsForControl(input: {
  readonly fieldCode: string;
  readonly countryCode?: string;
}): readonly RunnerSourceCitation[] {
  if (input.countryCode !== "US") return [];
  const ids = US_FIELD_CHUNK_IDS[input.fieldCode] ?? [];
  if (ids.length === 0) return [];
  return US_PINNED.filter((item) => ids.includes(item.chunkId));
}

/**
 * Deterministic US pasta citation bundle for replay and unit tests.
 */
export function usPastaReplayCitations(): readonly RunnerSourceCitation[] {
  return US_PINNED;
}
