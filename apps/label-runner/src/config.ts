function requiredEnvironment(name: string, environment: NodeJS.ProcessEnv): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

function optionalPositiveInteger(
  name: string,
  environment: NodeJS.ProcessEnv,
  fallback: number,
  maximum: number,
): number {
  const raw = environment[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${String(maximum)}`);
  }
  return value;
}

export interface LabelRunnerConfig {
  readonly backendUrl: string;
  readonly backendAudience: string;
  readonly bucketName: string;
  readonly gcpProjectId: string;
  readonly taskAudience: string;
  readonly taskInvokerServiceAccountEmail: string;
  readonly openRouterApiKey: string;
  readonly openRouterModel: "google/gemini-2.5-flash";
  readonly promptVersion: "label-preliminary-eu-it-v1" | "label-preliminary-rag-v1" | null;
  readonly rulePackVersion: "eu-it-preliminary-v1@1" | "global-food-label-preliminary-v1@1" | null;
  readonly sourceSnapshot: string;
  readonly openRouterTimeoutMs: number;
  /** Private Chroma configuration. This endpoint is never exposed to a browser. */
  readonly chromaEndpoint: string;
  readonly chromaTenant: string;
  readonly chromaDatabase: string;
  readonly chromaToken: string | null;
  readonly chromaTimeoutMs: number;
  readonly localToken: string | null;
}

export function readLabelRunnerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): LabelRunnerConfig {
  if (environment["LABEL_RUNNER_MODE"] !== "preliminary") {
    throw new Error("LABEL_RUNNER_MODE must be preliminary");
  }
  const backendUrl = requiredEnvironment("LABEL_BACKEND_URL", environment).replace(/\/+$/u, "");
  const backendAudience = environment["LABEL_BACKEND_AUDIENCE"]?.trim() || backendUrl;
  const localMode =
    environment["NODE_ENV"] === "development" && environment["LABEL_RUNNER_LOCAL_MODE"] === "true";
  const localToken = environment["LABEL_RUNNER_LOCAL_TOKEN"]?.trim() || null;
  if (localMode && (!localToken || localToken.length < 24)) {
    throw new Error("LABEL_RUNNER_LOCAL_TOKEN must be configured in local development mode");
  }
  const taskAudience = localMode
    ? "local"
    : requiredEnvironment("LABEL_RUNNER_AUDIENCE", environment);
  const sourceSnapshot = requiredEnvironment("LABEL_SOURCE_SNAPSHOT", environment);
  if (!/^[0-9a-f]{64}$/u.test(sourceSnapshot)) {
    throw new Error("LABEL_SOURCE_SNAPSHOT must be a SHA-256 digest");
  }
  const openRouterModel = requiredEnvironment("LABEL_OPENROUTER_MODEL", environment);
  const promptVersion = environment["LABEL_PROMPT_VERSION"]?.trim() || null;
  const rulePackVersion = environment["LABEL_RULE_PACK_VERSION"]?.trim() || null;
  if (openRouterModel !== "google/gemini-2.5-flash") {
    throw new Error("LABEL_OPENROUTER_MODEL must be google/gemini-2.5-flash");
  }
  if (!localMode && !promptVersion) throw new Error("LABEL_PROMPT_VERSION must be configured");
  if (!localMode && !rulePackVersion) throw new Error("LABEL_RULE_PACK_VERSION must be configured");
  if (
    promptVersion !== null &&
    promptVersion !== "label-preliminary-eu-it-v1" &&
    promptVersion !== "label-preliminary-rag-v1"
  ) {
    throw new Error(
      "LABEL_PROMPT_VERSION must be label-preliminary-eu-it-v1 or label-preliminary-rag-v1",
    );
  }
  if (
    rulePackVersion !== null &&
    rulePackVersion !== "eu-it-preliminary-v1@1" &&
    rulePackVersion !== "global-food-label-preliminary-v1@1"
  ) {
    throw new Error(
      "LABEL_RULE_PACK_VERSION must be eu-it-preliminary-v1@1 or global-food-label-preliminary-v1@1",
    );
  }
  return {
    backendUrl,
    backendAudience,
    bucketName: requiredEnvironment("LABEL_GCS_BUCKET", environment),
    gcpProjectId: requiredEnvironment("GCP_PROJECT_ID", environment),
    taskAudience,
    taskInvokerServiceAccountEmail: localMode
      ? "local"
      : requiredEnvironment("LABEL_TASKS_INVOKER_SERVICE_ACCOUNT_EMAIL", environment),
    openRouterApiKey: requiredEnvironment("OPENROUTER_API_KEY", environment),
    openRouterModel,
    promptVersion: promptVersion,
    rulePackVersion: rulePackVersion,
    sourceSnapshot,
    openRouterTimeoutMs: optionalPositiveInteger(
      "LABEL_OPENROUTER_TIMEOUT_MS",
      environment,
      60_000,
      300_000,
    ),
    chromaEndpoint: requiredEnvironment("CHROMA_ENDPOINT", environment),
    chromaTenant: environment["CHROMA_TENANT"]?.trim() || "default_tenant",
    chromaDatabase: environment["CHROMA_DATABASE"]?.trim() || "default_database",
    chromaToken: environment["CHROMA_TOKEN"]?.trim() || null,
    chromaTimeoutMs: optionalPositiveInteger("CHROMA_TIMEOUT_MS", environment, 30_000, 300_000),
    localToken,
  };
}
