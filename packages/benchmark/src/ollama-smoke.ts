import { setTimeout as delay } from "node:timers/promises";

import { sha256CanonicalJson } from "@vera/contracts";

export interface OllamaModelSummary {
  readonly name: string;
  readonly digest: string;
}

export interface OllamaSmokeResult {
  readonly available: boolean;
  readonly endpoint: string;
  readonly runtimeVersion: string | null;
  readonly models: readonly OllamaModelSummary[];
  readonly checkedAt: string;
  readonly limitation: string | null;
  readonly contentHash: string;
}

interface OllamaTagsResponse {
  readonly models?: readonly {
    readonly name?: unknown;
    readonly digest?: unknown;
  }[];
}

export async function probeOllama(
  endpoint = process.env["OLLAMA_HOST"] ?? "http://127.0.0.1:11434",
  timeoutMs = 1_000,
): Promise<OllamaSmokeResult> {
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = delay(timeoutMs, undefined, { signal: controller.signal })
    .then(() => {
      controller.abort();
    })
    .catch(() => undefined);
  try {
    const response = await fetch(new URL("/api/tags", endpoint), { signal: controller.signal });
    controller.abort();
    await timeout;
    if (!response.ok) {
      throw new Error(`Ollama tags returned HTTP ${String(response.status)}`);
    }
    const payload = (await response.json()) as OllamaTagsResponse;
    const models = (payload.models ?? [])
      .map((model) => ({
        name: typeof model.name === "string" && model.name.length > 0 ? model.name : "unknown",
        digest:
          typeof model.digest === "string" && /^[0-9a-f]{64}$/u.test(model.digest)
            ? model.digest
            : sha256CanonicalJson(model),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const result = {
      available: true,
      endpoint,
      runtimeVersion: "ollama-tags-api",
      models,
      checkedAt,
      limitation:
        models.length === 0 ? "Ollama is reachable but no local models are installed." : null,
    };
    return { ...result, contentHash: sha256CanonicalJson(result) };
  } catch (error) {
    controller.abort();
    await timeout;
    const message = error instanceof Error ? error.message : "Unknown Ollama probe failure";
    const result = {
      available: false,
      endpoint,
      runtimeVersion: null,
      models: [],
      checkedAt,
      limitation: `Ollama local smoke was not available: ${message}`,
    };
    return { ...result, contentHash: sha256CanonicalJson(result) };
  }
}
