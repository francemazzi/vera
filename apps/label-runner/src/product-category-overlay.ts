import { LABEL_FIELD_CODES } from "./contracts.js";

type LabelFieldCode = (typeof LABEL_FIELD_CODES)[number];
export type ControlOverlay = Readonly<Partial<Record<LabelFieldCode, string>>>;

const CONFECTIONERY_OVERLAYS: ControlOverlay = {
  denominazione_legale_vendita:
    "For chocolate and confectionery, check the legal name and cocoa solids only when a sector source excerpt is supplied; otherwise REVIEW.",
  etichettatura_specifica_prodotto:
    "Chocolate/confectionery category: apply only retrieved sector excerpts. If none are supplied, REVIEW. Do not invent Directive 2000/36/EC.",
  indicazioni_aggiuntive:
    "Negative claims such as “senza strutto” on chocolate are FAIL when misleading relative to the sources, even if the text is present.",
};

const COFFEE_OVERLAYS: ControlOverlay = {
  elenco_ingredienti:
    "Return NOT_APPLICABLE only when a retrieved excerpt exempts single-ingredient roasted coffee from an ingredients list. If no such excerpt exists, REVIEW — do not FAIL merely because the list is absent.",
  informazioni_nutrizionali:
    "Return NOT_APPLICABLE only when a retrieved excerpt exempts coffee from a nutrition declaration. Otherwise REVIEW; do not invent exemptions.",
  etichettatura_specifica_prodotto:
    "Apply only retrieved sector excerpts (for example decaffeination or botanical species). If none are supplied, REVIEW. Do not invent Standard 2.10.4 or caffeine limits.",
  indicazioni_aggiuntive:
    "Composition claims such as “100% Arabica” or “decaffeinated” are FAIL when present and contradicted by the sources; REVIEW when the sources are silent.",
};

const BEVERAGE_OVERLAYS: ControlOverlay = {
  elenco_ingredienti:
    "Return NOT_APPLICABLE only when retrieved sources exempt this beverage from an ingredients list. Otherwise assess completeness; without a source, REVIEW.",
  informazioni_nutrizionali:
    "Return NOT_APPLICABLE only when a retrieved excerpt exempts this beverage. Without an excerpt, REVIEW.",
};

const BAKERY_OVERLAYS: ControlOverlay = {
  denominazione_legale_vendita:
    "For filled biscuits and similar bakery products, a generic name such as “biscotti” can be incomplete. Verify that the filling and characterising flavour are described; use ATTENZIONE and propose a descriptive name when they are omitted.",
  elenco_ingredienti:
    "Scrutinise compound ingredients and characterising fillings. Verify their component list and QUID; use NON_CONFORME when a characterising filling percentage or required compound composition is absent.",
  indicazione_allergeni:
    "Check that intentionally added allergens are visually distinguished from every surrounding ingredient. If typography is ambiguous in the image, use ATTENZIONE rather than assuming compliance.",
  indicazioni_aggiuntive:
    "For “senza glutine” and “senza lattosio” claims, use ATTENZIONE when the label omits the applicable residual-threshold information or the claim needs documentary confirmation.",
};

const BY_CATEGORY: Readonly<Record<string, ControlOverlay>> = {
  bakery: BAKERY_OVERLAYS,
  confectionery: CONFECTIONERY_OVERLAYS,
  coffee: COFFEE_OVERLAYS,
  beverages: BEVERAGE_OVERLAYS,
};

/**
 * Extra control instructions keyed by product category. Not a new template.
 */
export function overlayInstructionsForCategory(productCategory: string): ControlOverlay {
  return BY_CATEGORY[productCategory.trim().toLowerCase()] ?? {};
}
