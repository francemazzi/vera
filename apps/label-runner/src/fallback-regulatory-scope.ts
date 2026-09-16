import type { RegulatoryScope } from "./contracts.js";

const EU_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "EL",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
]);

/**
 * Default market scope when the backend omits an explicit regulatory snapshot.
 */
export function fallbackRegulatoryScope(input: {
  readonly countryCodes: readonly string[];
  readonly now?: Date;
}): RegulatoryScope {
  const countryCode = input.countryCodes[0];
  if (!countryCode) {
    return {
      regulatoryAreas: ["WORLD"],
      jurisdictions: ["CUSTOM"],
      language: "en",
      evaluationDate: (input.now ?? new Date()).toISOString(),
    };
  }
  const isEu = EU_COUNTRIES.has(countryCode);
  return {
    countryCode,
    regulatoryAreas: isEu ? ["EU"] : ["WORLD"],
    jurisdictions: isEu ? ["EU", countryCode] : [countryCode],
    language: countryCode === "IT" ? "it" : "en",
    evaluationDate: (input.now ?? new Date()).toISOString(),
  };
}
