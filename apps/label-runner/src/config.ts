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
  readonly openRouterModel: string;
  readonly promptVersion: string;
  readonly rulePackVersion: string;
  readonly sourceSnapshot: string;
  readonly openRouterTimeoutMs: number;
}

export function readLabelRunnerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): LabelRunnerConfig {
  const backendUrl = requiredEnvironment("LABEL_BACKEND_URL", environment).replace(/\/+$/u, "");
  const backendAudience = environment["LABEL_BACKEND_AUDIENCE"]?.trim() || backendUrl;
  const taskAudience = requiredEnvironment("LABEL_RUNNER_AUDIENCE", environment);
  const sourceSnapshot = requiredEnvironment("LABEL_SOURCE_SNAPSHOT", environment);
  if (!/^[0-9a-f]{64}$/u.test(sourceSnapshot)) {
    throw new Error("LABEL_SOURCE_SNAPSHOT must be a SHA-256 digest");
  }
  return {
    backendUrl,
    backendAudience,
    bucketName: requiredEnvironment("LABEL_GCS_BUCKET", environment),
    gcpProjectId: requiredEnvironment("GCP_PROJECT_ID", environment),
    taskAudience,
    taskInvokerServiceAccountEmail: requiredEnvironment(
      "LABEL_TASKS_INVOKER_SERVICE_ACCOUNT_EMAIL",
      environment,
    ),
    openRouterApiKey: requiredEnvironment("OPENROUTER_API_KEY", environment),
    openRouterModel: requiredEnvironment("LABEL_OPENROUTER_MODEL", environment),
    promptVersion: requiredEnvironment("LABEL_PROMPT_VERSION", environment),
    rulePackVersion: requiredEnvironment("LABEL_RULE_PACK_VERSION", environment),
    sourceSnapshot,
    openRouterTimeoutMs: optionalPositiveInteger(
      "LABEL_OPENROUTER_TIMEOUT_MS",
      environment,
      60_000,
      300_000,
    ),
  };
}
