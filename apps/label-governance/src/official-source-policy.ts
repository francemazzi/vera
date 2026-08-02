/**
 * Keep this baseline identical to SILTO's source-governance policy. Extra
 * hosts are configured by `LABEL_SOURCE_ALLOWED_PDF_HOSTS` in both services;
 * the worker still refuses HTTP, credentials, alternate ports and redirects.
 */
export const DEFAULT_OFFICIAL_SOURCE_HOSTS = [
  "eur-lex.europa.eu",
  ".europa.eu",
  "gazzettaufficiale.it",
  ".gazzettaufficiale.it",
  "normattiva.it",
  ".normattiva.it",
  "salute.gov.it",
  ".salute.gov.it",
  "efsa.europa.eu",
  ".efsa.europa.eu",
  // Romanian Ministry of Justice legislative portal, used only by the
  // curated Food Consulting catalogue. As with every other entry, HTTPS,
  // credentials, alternate ports and redirects are rejected below.
  "legislatie.just.ro",
] as const;

function normalizedHost(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || !/^[a-z0-9.-]+$/u.test(normalized) || normalized.includes("..")) {
    throw new Error("Official source host allowlist contains an invalid hostname");
  }
  const hostname = normalized.startsWith(".") ? normalized.slice(1) : normalized;
  if (!hostname || hostname.startsWith("-") || hostname.endsWith("-") || !hostname.includes(".")) {
    throw new Error("Official source host allowlist contains an invalid hostname");
  }
  return normalized;
}

export function parseOfficialSourceHosts(configuredValue: string | undefined): readonly string[] {
  // Cloud Run commonly materializes an optional Terraform string as an empty
  // environment variable. Treat that exactly like an omitted extension list;
  // an empty entry must not make an otherwise valid worker fail at boot.
  const configured =
    configuredValue === undefined
      ? []
      : configuredValue
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
  return Array.from(new Set([...DEFAULT_OFFICIAL_SOURCE_HOSTS, ...configured].map(normalizedHost)));
}

export function isOfficialSourceUrl(value: string, allowedHosts: readonly string[]): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const hostname = url.hostname.toLowerCase();
    return allowedHosts.some((allowedHost) =>
      allowedHost.startsWith(".") ? hostname.endsWith(allowedHost) : hostname === allowedHost,
    );
  } catch {
    return false;
  }
}

export function assertOfficialSourceUrl(value: string, allowedHosts: readonly string[]): URL {
  if (!isOfficialSourceUrl(value, allowedHosts)) {
    throw new Error("Source URL is not an allowed official HTTPS source");
  }
  return new URL(value);
}
