import type { RunnerSourceCitation } from "./contracts.js";

type PinnedLedger = Readonly<{
  sourceVersionId: string;
  sourceContentHash: string;
  title: string;
  canonicalReference: string;
}>;

/** Production verified+indexed US catalog rows; titles and URLs must match the ledger. */
const US_LEDGER: Readonly<Record<string, PinnedLedger>> = {
  "21 CFR 101.2": {
    sourceVersionId: "4fa176e7-9bf7-4c9e-ac11-24cac44a46d9",
    sourceContentHash: "fb02068369b1effd9bfe6cd29ebea451d3ec5c6e5bffa9725abf6c93226c8b3c",
    title: "21 CFR 101.2 — Information panel of package form food",
    canonicalReference:
      "https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=101&section=101.2",
  },
  "21 CFR 101.3": {
    sourceVersionId: "d74cdb90-7cfc-4590-8e5e-8e81c22eaeed",
    sourceContentHash: "5a41fbed86b9f37a2cc2b4f2d6d8d38355966c88868fb20c5e7bc8683d93676d",
    title: "21 CFR 101.3 — Identity labeling of food in packaged form",
    canonicalReference:
      "https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=101&section=101.3",
  },
  "21 CFR 101.4": {
    sourceVersionId: "4a2b8cd8-99e2-4508-b3a5-b112f8ec17f9",
    sourceContentHash: "2956b5dfd3e0116f87358e4ae26ed83fef8c68ea463649d64d6e1b1d7c486edb",
    title: "21 CFR 101.4 — Food; designation of ingredients",
    canonicalReference:
      "https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=101&section=101.4",
  },
  "21 CFR 101.7": {
    sourceVersionId: "39935e26-6a6f-4bad-a88d-03e24eafbf3b",
    sourceContentHash: "cdfabeb64caa3569099a3d958b3850e2e618bb4c8fef0935135d0b3289661dc9",
    title: "21 CFR 101.7 — Declaration of net quantity of contents",
    canonicalReference:
      "https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=101&section=101.7",
  },
  "21 CFR 101.9": {
    sourceVersionId: "b93e0f06-7613-4af7-a0be-6fcfd35cfd96",
    sourceContentHash: "bdfb051c0238bd43bbd1a858448d63f21742ef0119a9ee07839a3c9799b4eb02",
    title: "21 CFR 101.9 — Nutrition labeling of food",
    canonicalReference:
      "https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=101&section=101.9",
  },
  "21 CFR 101.12": {
    sourceVersionId: "8b15df6e-7fca-4ea5-ae4a-9622fc76c93c",
    sourceContentHash: "2d0fb6985d4a8a471a00d45cc1fbd712947d8db0b1d9bb6a25929bbbc92c0775",
    title: "21 CFR 101.12 — Reference amounts customarily consumed",
    canonicalReference:
      "https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=101&section=101.12",
  },
  "21 CFR 101.15": {
    sourceVersionId: "87f7d236-81f8-4776-9c47-9eb35dd489a8",
    sourceContentHash: "df8343c3cf1251c8fdf47ab50d6c2bb458a3419e32aea0e2af8582c1bedcfcb9",
    title: "21 CFR 101.15 — Food; prominence of required statements",
    canonicalReference:
      "https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=101&section=101.15",
  },
  "21 CFR 139.150": {
    sourceVersionId: "24e746fe-3a6e-4cce-837c-69f553354cc8",
    sourceContentHash: "4f6f1ba8b259ac336a049479f5c80ffd632642206e5e1cdbb98b1ef747fc6f05",
    title: "21 CFR 139.150 — Noodle products; identity",
    canonicalReference:
      "https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=139&section=139.150",
  },
  "7 CFR 205.303": {
    sourceVersionId: "0dd57c04-fd51-4518-aaee-cfc7cc4bc738",
    sourceContentHash: "954f81e563858d23ed59979fb35fe929296500b1e405ba13fb4cb70c3f48effa",
    title: "7 CFR 205.303 \u2014 Packaged products labeled \u201Corganic\u201D",
    canonicalReference:
      "https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-7.xml?part=205&section=205.303",
  },
  "California AB 660 (2023)": {
    sourceVersionId: "705bac2b-e91f-4f0b-bbcb-6d9c53430ac6",
    sourceContentHash: "65cba2c9022e8899c2d41480e9706eb1f518cab59c148cd8d65d652a34ed6ae4",
    title: "California AB 660 (2023) \u2014 Food date labeling",
    canonicalReference:
      "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202320240AB660",
  },
};

function citation(input: {
  readonly chunkId: string;
  readonly actReference: string;
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly quote: string;
}): RunnerSourceCitation {
  const ledger = US_LEDGER[input.actReference];
  if (!ledger) throw new Error(`Pinned US ledger missing ${input.actReference}`);
  return {
    chunkId: `${ledger.sourceVersionId}:${input.chunkId}`,
    sourceVersionId: ledger.sourceVersionId,
    sourceContentHash: ledger.sourceContentHash,
    title: ledger.title,
    documentType: "REGULATION",
    actReference: input.actReference,
    canonicalReference: ledger.canonicalReference,
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
  }),
  citation({
    chunkId: "us-cfr-101-7-pdp-net-qty",
    actReference: "21 CFR 101.7",
    sectionId: "101.7-a-i",
    sectionTitle: "Declaration of net quantity of contents",
    quote:
      "The principal display panel of a food in package form shall bear a declaration of the net quantity of contents. The declaration shall appear as a distinct item in the lower 30 percent of the area of the label panel in lines generally parallel to the base.",
  }),
  citation({
    chunkId: "us-cfr-101-9-nutrition",
    actReference: "21 CFR 101.9",
    sectionId: "101.9-b",
    sectionTitle: "Nutrition labeling of food — serving size",
    quote:
      "The serving size declared on a product shall be determined from the use of the reference amounts customarily consumed and shall be expressed in common household measure and metric measure.",
  }),
  citation({
    chunkId: "us-cfr-139-150-egg-noodles",
    actReference: "21 CFR 139.150",
    sectionId: "139.150-a",
    sectionTitle: "Noodle products — identity",
    quote:
      "Noodle products are the class of food each of which is prepared by drying formed units of dough made from semolina, durum flour, farina, flour, or any combination of two or more of these, with liquid eggs, frozen eggs, dried eggs, egg yolks, frozen yolks, dried yolks, or any combination of two or more of these, with or without water.",
  }),
  citation({
    chunkId: "us-cfr-101-3-identity",
    actReference: "21 CFR 101.3",
    sectionId: "101.3-a",
    sectionTitle: "Identity labeling of food in packaged form",
    quote:
      "The principal display panel of a food in package form shall bear as one of its principal features a statement of the identity of the commodity.",
  }),
  citation({
    chunkId: "us-cfr-101-2-panels",
    actReference: "21 CFR 101.2",
    sectionId: "101.2-b",
    sectionTitle: "Information panel of package form food",
    quote:
      "The information panel is that part of the label immediately contiguous and to the right of the principal display panel. Nutrition Facts, the ingredient statement and the name and place of business may appear on the information panel.",
  }),
  citation({
    chunkId: "us-7-cfr-205-303",
    actReference: "7 CFR 205.303",
    sectionId: "205.303-a",
    sectionTitle: "Packaged products labeled “organic”",
    quote:
      "Agricultural products in packages described in § 205.301(a) and (b) may display the USDA seal and must identify the certifying agent on the information panel.",
  }),
  citation({
    chunkId: "us-cfr-101-4-ingredients",
    actReference: "21 CFR 101.4",
    sectionId: "101.4-a-1",
    sectionTitle: "Food; designation of ingredients",
    quote:
      "Ingredients required to be declared on the label of a food shall be listed by common or usual name in descending order of predominance by weight.",
  }),
  citation({
    chunkId: "us-cfr-101-15-allergen-prominence",
    actReference: "21 CFR 101.15",
    sectionId: "101.15-a",
    sectionTitle: "Food; prominence of required statements",
    quote:
      "A word, statement, or other information required by or under authority of the act to appear on the label shall appear thereon with such conspicuousness and in such terms as to render it likely to be read and understood by the ordinary individual under customary conditions of purchase and use.",
  }),
  citation({
    chunkId: "us-ca-ab-660-quality-date",
    actReference: "California AB 660 (2023)",
    sectionId: "ab-660-best-if-used-by",
    sectionTitle: "Food date labeling",
    quote:
      "On and after July 1, 2026, a food manufacturer, processor, or retailer that chooses to include a quality date on a food product shall use the phrase “BEST if Used by” to indicate quality.",
  }),
];

const US_FIELD_CHUNK_SUFFIXES: Readonly<Record<string, readonly string[]>> = {
  campo_visivo: ["us-cfr-101-7-pdp-net-qty", "us-cfr-101-3-identity", "us-cfr-101-2-panels"],
  denominazione_commerciale: ["us-cfr-101-3-identity"],
  denominazione_legale_vendita: ["us-cfr-101-3-identity", "us-cfr-139-150-egg-noodles"],
  etichettatura_specifica_prodotto: ["us-cfr-139-150-egg-noodles"],
  elenco_ingredienti: ["us-cfr-101-4-ingredients"],
  indicazione_allergeni: ["us-cfr-101-15-allergen-prominence"],
  informazioni_nutrizionali: ["us-cfr-101-12-pasta-racc", "us-cfr-101-9-nutrition"],
  quantita_netto_volume_nominale: ["us-cfr-101-7-pdp-net-qty"],
  biologico: ["us-7-cfr-205-303"],
  termine_minimo_conservazione_data_scadenza: ["us-ca-ab-660-quality-date"],
  indicazioni_aggiuntive: ["us-cfr-101-15-allergen-prominence"],
  atmosfera_protettiva: ["us-cfr-101-2-panels"],
  bollatura_sanitaria_marchio_identificazione: ["us-cfr-101-2-panels"],
  denominazioni_dop_igp_stg: ["us-cfr-101-3-identity"],
  indicazioni_ambientali: ["us-cfr-101-2-panels"],
  sede_stabilimento_produzione_confezionamento: ["us-cfr-101-2-panels"],
  origine_ingrediente_primario: ["us-cfr-101-3-identity"],
  condizioni_particolari_conservazione: ["us-cfr-101-2-panels"],
  istruzioni_uso: ["us-cfr-101-2-panels"],
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
  const suffixes = US_FIELD_CHUNK_SUFFIXES[input.fieldCode] ?? [];
  if (suffixes.length === 0) return [];
  return US_PINNED.filter((item) => suffixes.some((suffix) => item.chunkId.endsWith(suffix)));
}

/**
 * Deterministic US pasta citation bundle for replay and unit tests.
 */
export function usPastaReplayCitations(): readonly RunnerSourceCitation[] {
  return US_PINNED;
}
