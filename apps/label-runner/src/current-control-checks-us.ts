type Checks = Readonly<Record<string, string>>;

/** US FDA questions for generic prepacked foods, including dry pasta. */
export function unitedStatesControlChecks(): Checks {
  return {
    campo_visivo:
      "Use verified US sources to identify the principal display panel, information panel, identity placement, net quantity units and layout. Do not import EU placement rules. For a lid-plus-body retail pack, the lid is the PDP unless a different principal panel is proven in normal retail display; Nutrition Facts and the ingredient statement may sit on the container body under 21 CFR 101.2.",
    denominazione_legale_vendita:
      "Require an English statement of identity on the PDP. If the visible food is egg pasta/noodle, do not PASS 21 CFR 139.150 without formula or egg-solids evidence: REQUEST_DATA and REVIEW. Italian form names (Tagliolini, Pappardelle) may remain if an English nature statement is present.",
    quantita_netto_volume_nominale:
      "Require net quantity on the true PDP in metric and US customary units, in the lower 30 percent, without the EU estimated-sign mark. Absence of net quantity from the PDP of a lid-plus-body pack is NON_CONFORME.",
    elenco_ingredienti:
      "If the visible product is olive oil, require “INGREDIENTS: EXTRA VIRGIN OLIVE OIL” on the information panel; its absence is ATTENZIONE. Do not apply that olive-oil wording to other foods. For pasta, confirm descending-order common names from the artwork and REQUEST_DATA for an unsupplied BOM.",
    indicazione_allergeni:
      "Major food allergens require a correct Contains statement. “MAY CONTAIN TRACES OF” is ATTENZIONE wording, not NON_CONFORME; prefer “MAY CONTAIN SOY” only when a residual-risk assessment is supplied.",
    informazioni_nutrizionali:
      "Check Nutrition Facts or Supplement Facts format, serving declaration, % Daily Value and rounding from US sources. For plain dry pasta, 21 CFR 101.12 Table 2 RACC is 55 g dry but the labeled serving must be “2 oz (56 g/[visual unit])”. Serving size 2 oz (55 g) is NON_CONFORME when that excerpt is cited; then recalculate the panel from unrounded values.",
    termine_minimo_conservazione_data_scadenza:
      "FDA quality dating is generally voluntary. California AB 660 requires “BEST if Used by” from 2026-07-01: “BEST BEFORE”, “Best By” or “Expires” is FAIL. A customer GGG supporting document is additional evidence, not a substitute for that statutory wording.",
    origine_ingrediente_primario:
      "A wheat-origin statement is not a substitute for country of origin. REQUEST_DATA when “WHEAT ORIGIN” is printed without substantiation.",
    biologico:
      "USDA Organic and certifier identity (for example CCPB) require NOP evidence. Presence of seals without the organic certificate is ATTENZIONE, not PASS.",
    indicazioni_aggiuntive:
      "Inventory each claim. Contradictory process claims (for example 18 hours versus 14 hours drying) are NON_CONFORME. “NOT FOR RETAIL SALE” is ATTENZIONE to keep consistent with the sale unit. Do not apply olive-oil laudatory rewrites to pasta.",
    etichettatura_specifica_prodotto:
      "Apply sourced US category identity rules only. Egg pasta may implicate 21 CFR 139.150; without that excerpt or egg-solids data, REVIEW with REQUEST_DATA. This is not an unimplemented EU bakery filling check.",
  };
}
