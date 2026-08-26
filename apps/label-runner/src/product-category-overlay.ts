import { LABEL_FIELD_CODES } from "./contracts.js";

type LabelFieldCode = (typeof LABEL_FIELD_CODES)[number];

const CONFECTIONERY_OVERLAYS: Readonly<Partial<Record<LabelFieldCode, string>>> = {
  denominazione_legale_vendita:
    "For chocolate and confectionery, check the legal name and cocoa solids only when a sector source excerpt is supplied; otherwise REVIEW.",
  etichettatura_specifica_prodotto:
    "Chocolate/confectionery category: apply only retrieved sector excerpts. If none are supplied, REVIEW. Do not invent Directive 2000/36/EC.",
  indicazioni_aggiuntive:
    "Negative claims such as “senza strutto” on chocolate are FAIL when misleading relative to the sources, even if the text is present.",
};

/**
 * Extra control instructions keyed by product category. Not a new template.
 */
export function overlayInstructionsForCategory(
  productCategory: string,
): Readonly<Partial<Record<LabelFieldCode, string>>> {
  return productCategory.trim().toLowerCase() === "confectionery" ? CONFECTIONERY_OVERLAYS : {};
}
