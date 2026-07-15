import { ApiProblem } from "./errors.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function assertLocalEgressAllowed(urlInput: string): URL {
  const url = new URL(urlInput);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new ApiProblem(
      403,
      "Forbidden",
      "Outbound network access is limited to explicit local endpoints",
    );
  }
  return url;
}
