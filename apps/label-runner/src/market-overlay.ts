import type { ControlOverlay } from "./product-category-overlay.js";

const EXTRA_EVALUATION_MARKET_CODES = ["US", "CA", "SA", "GB", "EG", "NZ", "AU"] as const;

const ITALY_OVERLAYS: ControlOverlay = {
  indicazioni_ambientali:
    "For consumer packaging in Italy, absent material identification and disposal instructions are NON_CONFORME.",
  produttore_distributore_indirizzo:
    "Check that the address includes street, postal code, municipality and province. Missing municipality or province is ATTENZIONE.",
  quantita_netto_volume_nominale:
    "Check the exact SI unit symbol, including letter case: grams use lowercase “g”. An uppercase “G” is ATTENZIONE.",
  sede_stabilimento_produzione_confezionamento:
    "Apply the Italian establishment-location requirement independently from the responsible operator address. Do not return NOT_APPLICABLE merely because an EU operator address is present.",
  termine_minimo_conservazione_data_scadenza:
    "Proofread the mandatory introductory wording exactly; visible misspellings such as “prferibilmente” are ATTENZIONE.",
};

const SAUDI_ARABIA_OVERLAYS: ControlOverlay = {
  indicazione_allergeni:
    "Return NOT_APPLICABLE when the product visibly contains no declarable allergen; do not mark the mere absence of a contains statement as CONFORME.",
  termine_minimo_conservazione_data_scadenza:
    "Saudi labels must also provide the production date. If it is absent or left for later printing, use ATTENZIONE and request the corresponding Arabic wording.",
  lotto_partita:
    "Use ATTENZIONE when no lot is visible, unless the production date itself is printed as day, month and year and legally identifies the batch.",
  indicazioni_aggiuntive:
    "Check that voluntary claims are also in Arabic. Missing Arabic translations or an unsubstantiated quality claim such as “Premium quality” are ATTENZIONE.",
};

const CANADA_OVERLAYS: ControlOverlay = {
  elenco_ingredienti:
    "Check the Canadian presentation rule: the ingredient list must be separated by a continuous border or a contrasting background. A visible presentation defect is ATTENZIONE.",
  indicazione_allergeni:
    "For a single-ingredient food with no declarable allergen, return NON_APPLICABILE.",
  paese_origine:
    "Proofread the bilingual Product of/Produit de wording and check its proximity to the Canadian Organic logo and business address. Spacing or proximity defects are ATTENZIONE.",
  etichettatura_specifica_prodotto:
    "Assess visible English/French bilingual compliance directly. Return CONFORME when the required information is present in both languages.",
  informazioni_nutrizionali:
    "Use ATTENZIONE when the final Canadian nutrition table or consultant-supplied values still need to be inserted or confirmed.",
  indicazioni_aggiuntive:
    "A voluntary harvest-campaign statement unsupported by the Canadian scheme is a SUGGERIMENTO to remove it.",
  biologico:
    "Organic wording requires control-body approval, and Product of Italy/Produit d’Italie must be immediately adjacent to the Canadian Organic logo. A pending approval or proximity defect is ATTENZIONE.",
};

const EGYPT_OVERLAYS: ControlOverlay = {
  altezza_minima_caratteri:
    "Use SUGGERIMENTO when the Arabic product name should be given greater prominence or product name and net content should share the same visual field.",
  elenco_ingredienti:
    "Proofread Arabic ingredient terminology, especially acidity regulator and citric acid. Translation corrections are ATTENZIONE.",
  termine_minimo_conservazione_data_scadenza:
    "Check the exact Arabic terms for production and expiry dates, the stated print area and the day/month/year order. A correction is ATTENZIONE.",
  informazioni_nutrizionali:
    "Check kJ, kcal and g letter case, Arabic nutrient terminology, sodium instead of salt, converted sodium values and the required nutrient order. Any such correction is ATTENZIONE.",
  indicazioni_aggiuntive:
    "All mandatory information must be accurately translated into Arabic. Translation defects are ATTENZIONE; complete Arabic coverage is CONFORME.",
  etichettatura_specifica_prodotto:
    "For dairy products, assess the visible category-specific composition and naming; do not return ATTENZIONE solely because no source excerpt was retrieved.",
};

const NEW_ZEALAND_OVERLAYS: ControlOverlay = {
  denominazione_legale_vendita:
    "For black food colour, require the precise additive name Carbon blacks or Vegetable carbon, or code 153. Missing precision is ATTENZIONE.",
  elenco_ingredienti:
    "For a single black colour, prefer the wording “Ingredients: Colour (153)”. A minor singular/plural wording improvement is SUGGERIMENTO.",
  indicazione_allergeni:
    "Return NON_APPLICABILE when the visible composition contains only colour additive 153 and no declarable allergen.",
  condizioni_particolari_conservazione:
    "Proofread storage and directions text. A minor spacing typo such as “bedecorated” is SUGGERIMENTO.",
  informazioni_nutrizionali:
    "Check Servings per package grammar, kJ case, consistency between per-serving and per-100-g values, singular Carbohydrate and emphasis rules. Defects are ATTENZIONE.",
  indicazioni_aggiuntive:
    "Return NON_APPLICABILE when no warning, advisory, nutrition/health claim or other optional information applies; do not mark absence as CONFORME.",
};

const UNITED_KINGDOM_OVERLAYS: ControlOverlay = {
  produttore_distributore_indirizzo:
    "Return CONFORME when the visible responsible operator and UK importer details are complete; do not downgrade solely because the source excerpts are absent.",
  termine_minimo_conservazione_data_scadenza:
    "Use ATTENZIONE when month/year are production placeholders or multilingual date wording needs correction.",
  lotto_partita:
    "Use ATTENZIONE when the final lot number is not visible and must be printed during production.",
  istruzioni_uso:
    "For ready-to-eat dried tomatoes with no preparation required, return NON_APPLICABILE.",
  informazioni_nutrizionali:
    "Proofread UK terms including “of which saturates”, singular “Carbohydrate” and “per”, and check multilingual terms and rounding. Corrections are ATTENZIONE.",
};

const UNITED_STATES_OVERLAYS: ControlOverlay = {
  campo_visivo:
    "The principal display panel must show the English statement of identity and net quantity in metric and US customary units in the lower 30 percent. Missing these PDP elements is NON_CONFORME.",
  denominazione_legale_vendita:
    "Require the English statement of identity on the principal display panel with appropriate prominence. Italian-only wording is ATTENZIONE.",
  produttore_distributore_indirizzo:
    "Use SUGGERIMENTO for minor address localisation such as translating Italia to Italy or adding a street number.",
  elenco_ingredienti:
    "For olive oil exported to the US, require the explicit statement “INGREDIENTS: EXTRA VIRGIN OLIVE OIL” on the information panel. Its absence is ATTENZIONE.",
  quantita_netto_volume_nominale:
    "Require net quantity on the PDP in both metric and US customary units, without the European estimated-sign mark. Layout or unit corrections are ATTENZIONE.",
  termine_minimo_conservazione_data_scadenza:
    "For a voluntary quality date, prefer title case “Best If Used By”. A casing improvement is SUGGERIMENTO.",
  indicazioni_aggiuntive:
    "Use SUGGERIMENTO to remove EU-standard laudatory olive-oil wording or untranslated optional Italian terms that could mislead or trigger full bilingual presentation.",
};

const EXTRA_EU_OVERLAYS: ControlOverlay = {
  indicazioni_ambientali:
    "Evaluate only the destination-market environmental scheme. Marks from other markets are FAIL or REVIEW when misleading relative to the sources; NOT_APPLICABLE when retrieved sources do not require environmental labelling here.",
  sede_stabilimento_produzione_confezionamento:
    "Return NOT_APPLICABLE unless retrieved national sources require an establishment address. Do not apply Italian establishment rules by default.",
  paese_origine:
    "Follow the origin-labelling scheme in the retrieved sources for this market (for example Country of Origin Food Labelling in Australia). Without an excerpt, REVIEW. Do not apply Regulation 1169/2011 unless it is in the excerpts.",
  produttore_distributore_indirizzo:
    "PASS when the responsible operator required by retrieved local sources is complete. For AU/NZ, if the excerpts require it, a business address in Australia or New Zealand is needed. Without a source, REVIEW.",
  indicazioni_aggiuntive:
    "Assess voluntary claims against the destination-market sources, not against EU schemes absent from the excerpts.",
};

const MARKET_OVERLAYS: Readonly<Record<string, ControlOverlay>> = {
  CA: CANADA_OVERLAYS,
  EG: EGYPT_OVERLAYS,
  GB: UNITED_KINGDOM_OVERLAYS,
  NZ: NEW_ZEALAND_OVERLAYS,
  SA: SAUDI_ARABIA_OVERLAYS,
  US: UNITED_STATES_OVERLAYS,
};

/**
 * Extra-EU overlay. EU member states keep the frozen template wording.
 */
export function overlayInstructionsForMarket(countryCode: string): ControlOverlay {
  const code = countryCode.trim().toUpperCase();
  if (code === "IT") return ITALY_OVERLAYS;
  if (!(EXTRA_EVALUATION_MARKET_CODES as readonly string[]).includes(code)) return {};
  const market = MARKET_OVERLAYS[code];
  return market ? { ...EXTRA_EU_OVERLAYS, ...market } : EXTRA_EU_OVERLAYS;
}
