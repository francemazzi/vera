/**
 * Ops helper: the three IT/EU verified HTML sources already in production
 * must be rematerialized after chrome suppression, then re-indexed into
 * `silto-label-verified-v1`. This module documents the CELEX/Normattiva
 * keys; it does not auto-approve or talk to production Chroma.
 */
export const VERIFIED_IT_EU_REINDEX_SOURCES = [
  {
    key: "eu-reg-1169-2011",
    canonicalUrl: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02011R1169-20250401",
  },
  {
    key: "eu-dir-2011-91",
    canonicalUrl: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32011L0091",
  },
  {
    key: "it-d-lgs-231-2017",
    canonicalUrl: "https://www.normattiva.it/uri-res/N2Ls?urn%3Anir%3Astato%3Adecreto%3A2017-12-15%3B231=",
  },
] as const;
