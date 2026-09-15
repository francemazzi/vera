import { LABEL_CONSULTANT_STATUSES } from "./contracts.js";

type ConsultantStatus = (typeof LABEL_CONSULTANT_STATUSES)[number];

const CONFORME = "CONFORME" satisfies ConsultantStatus;
const NON_CONFORME = "NON_CONFORME" satisfies ConsultantStatus;
const ATTENZIONE = "ATTENZIONE" satisfies ConsultantStatus;
const NON_APPLICABILE = "NON_APPLICABILE" satisfies ConsultantStatus;

export type CiprianiPastaFamily = "retail_250g" | "foodservice_1_5kg";
export type CiprianiPastaSplit = "calibration" | "holdout";

export type CiprianiPastaGoldCase = Readonly<{
  id: string;
  family: CiprianiPastaFamily;
  split: CiprianiPastaSplit;
  productName: string;
  reportFile: string;
  labelFiles: readonly string[];
  lidPage?: number;
  expected: Readonly<Record<string, ConsultantStatus>>;
  blockingFindings: readonly string[];
}>;

const EU_US_NA = {
  atmosfera_protettiva: NON_APPLICABILE,
  bollatura_sanitaria_marchio_identificazione: NON_APPLICABILE,
  denominazioni_dop_igp_stg: NON_APPLICABILE,
  indicazioni_ambientali: NON_APPLICABILE,
  sede_stabilimento_produzione_confezionamento: NON_APPLICABILE,
} as const;

const RETAIL_250G_EXPECTED = {
  ...EU_US_NA,
  altezza_cifre_quantita_nominale: ATTENZIONE,
  altezza_minima_caratteri: ATTENZIONE,
  biologico: ATTENZIONE,
  campo_visivo: ATTENZIONE,
  condizioni_particolari_conservazione: NON_APPLICABILE,
  denominazione_commerciale: CONFORME,
  denominazione_legale_vendita: ATTENZIONE,
  elenco_ingredienti: ATTENZIONE,
  etichettatura_specifica_prodotto: ATTENZIONE,
  indicazione_allergeni: ATTENZIONE,
  indicazioni_aggiuntive: NON_CONFORME,
  informazioni_nutrizionali: NON_CONFORME,
  istruzioni_uso: NON_APPLICABILE,
  lotto_partita: ATTENZIONE,
  origine_ingrediente_primario: ATTENZIONE,
  paese_origine: ATTENZIONE,
  produttore_distributore_indirizzo: ATTENZIONE,
  quantita_netto_volume_nominale: NON_CONFORME,
  termine_minimo_conservazione_data_scadenza: NON_CONFORME,
} as const;

const FOODSERVICE_EXPECTED = {
  ...EU_US_NA,
  altezza_cifre_quantita_nominale: ATTENZIONE,
  altezza_minima_caratteri: ATTENZIONE,
  biologico: NON_APPLICABILE,
  campo_visivo: ATTENZIONE,
  condizioni_particolari_conservazione: ATTENZIONE,
  denominazione_commerciale: CONFORME,
  denominazione_legale_vendita: ATTENZIONE,
  elenco_ingredienti: ATTENZIONE,
  etichettatura_specifica_prodotto: ATTENZIONE,
  indicazione_allergeni: ATTENZIONE,
  indicazioni_aggiuntive: ATTENZIONE,
  informazioni_nutrizionali: NON_CONFORME,
  istruzioni_uso: ATTENZIONE,
  lotto_partita: ATTENZIONE,
  origine_ingrediente_primario: NON_APPLICABILE,
  paese_origine: ATTENZIONE,
  produttore_distributore_indirizzo: ATTENZIONE,
  quantita_netto_volume_nominale: ATTENZIONE,
  termine_minimo_conservazione_data_scadenza: NON_CONFORME,
} as const;

const RETAIL_BLOCKING = [
  "serving_size_56g",
  "nutrition_facts_recalculate",
  "quality_date_ggg",
  "net_quantity_pdp",
  "process_claim_18h_vs_14h",
] as const;

const FOODSERVICE_BLOCKING = [
  "serving_size_56g",
  "nutrition_facts_recalculate",
  "quality_date_ggg",
] as const;

/**
 * Cipriani USA pasta gold cases mapped from ChatGPT Food Consulting reports.
 */
export const CIPRIANI_PASTA_GOLD_CASES: readonly CiprianiPastaGoldCase[] = [
  {
    id: "cipriani-pappardelle-classica-250g",
    family: "retail_250g",
    split: "calibration",
    productName: "Pappardelle Classica BIO 250 g",
    reportFile: "reports/Validazione_etichettatura_Cipriani_Pappardelle_Classica_BIO_250g_USA_10.09.2026.pdf",
    labelFiles: ["coperchi-250g.pdf", "fondo-classica.pdf", "variable-print.jpeg"],
    lidPage: 1,
    expected: RETAIL_250G_EXPECTED,
    blockingFindings: RETAIL_BLOCKING,
  },
  {
    id: "cipriani-tagliardi-classica-250g",
    family: "retail_250g",
    split: "calibration",
    productName: "Tagliardi Classica BIO 250 g",
    reportFile: "reports/Validazione_etichettatura_Cipriani_Tagliardi_Classica_BIO_250g_USA_10.09.2026.pdf",
    labelFiles: ["coperchi-250g.pdf", "fondo-classica.pdf", "variable-print.jpeg"],
    lidPage: 2,
    expected: RETAIL_250G_EXPECTED,
    blockingFindings: RETAIL_BLOCKING,
  },
  {
    id: "cipriani-tagliarelle-classica-250g",
    family: "retail_250g",
    split: "calibration",
    productName: "Tagliarelle Classica BIO 250 g",
    reportFile: "reports/Validazione_etichettatura_Cipriani_Tagliarelle_Classica_BIO_250g_USA_10.09.2026.pdf",
    labelFiles: ["coperchi-250g.pdf", "fondo-classica.pdf", "variable-print.jpeg"],
    lidPage: 3,
    expected: RETAIL_250G_EXPECTED,
    blockingFindings: RETAIL_BLOCKING,
  },
  {
    id: "cipriani-tagliarelle-spinaci-250g",
    family: "retail_250g",
    split: "holdout",
    productName: "Tagliarelle Spinaci BIO 250 g",
    reportFile: "reports/Validazione_etichettatura_Cipriani_Tagliarelle_Spinaci_BIO_250g_USA_10.09.2026.pdf",
    labelFiles: ["coperchi-250g.pdf", "fondo-verde.pdf", "variable-print.jpeg"],
    lidPage: 4,
    expected: RETAIL_250G_EXPECTED,
    blockingFindings: RETAIL_BLOCKING,
  },
  {
    id: "cipriani-tagliolini-classica-250g",
    family: "retail_250g",
    split: "calibration",
    productName: "Tagliolini Classica BIO 250 g",
    reportFile: "reports/Validazione_etichettatura_Cipriani_Tagliolini_Classica_BIO_250g_USA_10.09.2026.pdf",
    labelFiles: ["coperchi-250g.pdf", "fondo-classica.pdf", "variable-print.jpeg"],
    lidPage: 5,
    expected: RETAIL_250G_EXPECTED,
    blockingFindings: RETAIL_BLOCKING,
  },
  {
    id: "cipriani-tagliolini-spinaci-250g",
    family: "retail_250g",
    split: "calibration",
    productName: "Tagliolini Spinaci BIO 250 g",
    reportFile: "reports/Validazione_etichettatura_Cipriani_Tagliolini_Spinaci_BIO_250g_USA_10.09.2026.pdf",
    labelFiles: ["coperchi-250g.pdf", "fondo-verde.pdf", "variable-print.jpeg"],
    lidPage: 6,
    expected: RETAIL_250G_EXPECTED,
    blockingFindings: RETAIL_BLOCKING,
  },
  {
    id: "cipriani-pappardelle-white-1_5kg",
    family: "foodservice_1_5kg",
    split: "holdout",
    productName: "Pappardelle White 1.5 kg",
    reportFile: "reports/Validazione_etichettatura_Cipriani_Pappardelle_White_1.5kg_USA_10.09.2026.pdf",
    labelFiles: ["4197-family/4204-pappardelle-bianchi.pdf"],
    expected: FOODSERVICE_EXPECTED,
    blockingFindings: FOODSERVICE_BLOCKING,
  },
  {
    id: "cipriani-tagliardi-green-1_5kg",
    family: "foodservice_1_5kg",
    split: "calibration",
    productName: "Tagliardi Green 1.5 kg",
    reportFile: "reports/Validazione_etichettatura_Cipriani_Tagliardi_Green_1.5kg_USA_10.09.2026.pdf",
    labelFiles: ["4197-family/4202-tagliardi-verdi.pdf"],
    expected: FOODSERVICE_EXPECTED,
    blockingFindings: FOODSERVICE_BLOCKING,
  },
  {
    id: "cipriani-tagliardi-white-1_5kg",
    family: "foodservice_1_5kg",
    split: "calibration",
    productName: "Tagliardi White 1.5 kg",
    reportFile: "reports/Validazione_etichettatura_Cipriani_Tagliardi_White_1.5kg_USA_10.09.2026.pdf",
    labelFiles: ["4197-family/4199-tagliardi-bianchi.pdf"],
    expected: FOODSERVICE_EXPECTED,
    blockingFindings: FOODSERVICE_BLOCKING,
  },
  {
    id: "cipriani-tagliarelle-green-1_5kg",
    family: "foodservice_1_5kg",
    split: "calibration",
    productName: "Tagliarelle Green 1.5 kg",
    reportFile: "reports/Validazione_etichettatura_Cipriani_Tagliarelle_Green_1.5kg_USA_10.09.2026.pdf",
    labelFiles: ["4197-family/4203-tagliarelle-verdi.pdf"],
    expected: FOODSERVICE_EXPECTED,
    blockingFindings: FOODSERVICE_BLOCKING,
  },
  {
    id: "cipriani-tagliarelle-white-1_5kg",
    family: "foodservice_1_5kg",
    split: "calibration",
    productName: "Tagliarelle White 1.5 kg",
    reportFile: "reports/Validazione_etichettatura_Cipriani_Tagliarelle_White_1.5kg_USA_10.09.2026.pdf",
    labelFiles: ["4197-family/4212-tagliarelle-bianchi.pdf"],
    expected: FOODSERVICE_EXPECTED,
    blockingFindings: FOODSERVICE_BLOCKING,
  },
  {
    id: "cipriani-tagliolini-green-1_5kg",
    family: "foodservice_1_5kg",
    split: "calibration",
    productName: "Tagliolini Green 1.5 kg",
    reportFile: "reports/Validazione_etichettatura_Cipriani_Tagliolini_Green_1.5kg_USA_10.09.2026.pdf",
    labelFiles: ["4197-family/4198-tagliolini-verdi.pdf"],
    expected: FOODSERVICE_EXPECTED,
    blockingFindings: FOODSERVICE_BLOCKING,
  },
  {
    id: "cipriani-tagliolini-white-1_5kg",
    family: "foodservice_1_5kg",
    split: "calibration",
    productName: "Tagliolini White 1.5 kg",
    reportFile: "reports/Validazione_etichettatura_Cipriani_Tagliolini_White_1.5kg_USA_10.09.2026.pdf",
    labelFiles: ["4197-family/4197-tagliolini-bianchi.pdf"],
    expected: FOODSERVICE_EXPECTED,
    blockingFindings: FOODSERVICE_BLOCKING,
  },
];
