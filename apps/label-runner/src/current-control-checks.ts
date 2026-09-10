type Checks = Readonly<Record<string, string>>;

/** Domain questions guide retrieval/assessment; they never assert unverified legal rules. */
export function currentControlChecks(category: string, country?: string): Checks {
  const common: Checks = {
    termine_minimo_conservazione_data_scadenza:
      "Compare every language, artwork panel and supplied supporting document for date type, printed values, introductory wording and print-area references. Distinguish production, best-before, expiry, lot and sample-document dates. Do not assume one day/month/year format for every shelf life.",
    etichettatura_specifica_prodotto:
      "Separate outer sale unit from inner units. Establish whether capsules are sold individually; never silently transfer outer-pack obligations to each capsule. Compare denomination, composition and claims across languages and panels.",
    indicazioni_aggiuntive:
      "Inventory each claim separately, including compatibility, origin, nutrition, health and environmental claims. For each, document source, conditions of use, supporting evidence and exact multilingual rewrite. A shared chat is a comparison example, never legal authority.",
    indicazioni_ambientali:
      "Inspect graphical symbols visually and distinguish material, component, destination scheme and optional claim. Establish obligations from the selected destination sources and actual unit of sale.",
  };
  const categoryChecks: Readonly<Record<string, Checks>> = {
    coffee: {
      informazioni_nutrizionali:
        "Establish any single-ingredient coffee exemption and its conditions from the nationally applicable edition. Added sugar, other ingredients and nutrition/health claims may change applicability. Compare the evaluated date with national adoption and future commencement.",
      etichettatura_specifica_prodotto:
        "For decaffeinated coffee separate the legal residual-caffeine limit, stated extraction process/solvent, and available laboratory evidence. Capsule compatibility with Nespresso does not describe decaffeination. Do not infer decaf from another SKU. Assess inner/outer packaging independently.",
      elenco_ingredienti:
        "Distinguish a verified single-ingredient exemption from an incomplete extraction. Never infer 100% Arabica, single ingredient, or a solvent from capsule compatibility.",
    },
    beverages: {
      elenco_ingredienti:
        "Check additive identities, functions, compound ingredients and characterising fruit/juice percentages. Use the recipe or laboratory data only if actually supplied; request specific missing values, not legal research.",
      indicazione_allergeni:
        "Check sulphite declarations using the applicable threshold and supplied analytical or recipe evidence. Do not invent concentration or transfer it between products.",
      informazioni_nutrizionali:
        "Determine the destination-specific nutrition format, serving size, basis, units, rounding and any exemption conditions. Identify every missing product value needed for the final table.",
    },
    supplements: {
      denominazione_legale_vendita:
        "Establish classification from ingredients, intended use and dose. A Coffee brand is not a coffee classification. State unresolved food/supplement classification as an internal question with its legal source.",
      elenco_ingredienti:
        "Check botanical identity and part, extract specification, active constituents, daily dose, units and mass balance. Compare ingredient amounts with total serving mass; never fill missing doses by assumption.",
      istruzioni_uso:
        "Assess daily dose, target population, use instructions and contraindications against applicable sources and actual dossier evidence. Produce exact wording and necessary placeholders.",
      indicazioni_aggiuntive:
        "Build a separate claim-by-claim dossier in the rationale and corrective actions: literal claim, legal basis, conditions of use, measured dose/evidence, conclusion and rewrite/removal. Do not generalise one authorised claim to a whole formulation.",
    },
  };
  const us: Checks =
    country === "US"
      ? {
          campo_visivo:
            "Use verified US sources to identify the principal display panel, information panel, identity placement, net quantity units and layout. Do not import EU placement rules.",
          informazioni_nutrizionali:
            "Check the applicable Nutrition Facts or Supplement Facts format, serving declaration, % Daily Value, added sugars, required nutrients and conditional exemptions using US sources and actual product values.",
          indicazioni_aggiuntive:
            "Assess juice-percentage disclosure, alcohol-free/zero claims, nutrient and health claims, language coverage and relevant state requirements only when the applicable jurisdiction is established.",
        }
      : {};
  const keys: Set<string> = new Set([
    ...Object.keys(common),
    ...Object.keys(categoryChecks[category] ?? {}),
    ...Object.keys(us),
  ]);
  return Object.fromEntries(
    [...keys].map((key) => [
      key,
      [common[key], categoryChecks[category]?.[key], us[key]].filter(Boolean).join(" "),
    ]),
  );
}
