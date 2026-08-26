import type { ControlOverlay } from "./product-category-overlay.js";

const EXTRA_EVALUATION_MARKET_CODES = ["US", "CA", "SA", "GB", "EG", "NZ", "AU"] as const;

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

/**
 * Extra-EU overlay. EU member states keep the frozen template wording.
 */
export function overlayInstructionsForMarket(countryCode: string): ControlOverlay {
  const code = countryCode.trim().toUpperCase();
  return (EXTRA_EVALUATION_MARKET_CODES as readonly string[]).includes(code)
    ? EXTRA_EU_OVERLAYS
    : {};
}
