import { parseOfficialSourceHosts } from "./official-source-policy.js";

function requiredEnvironment(name: string, environment: NodeJS.ProcessEnv): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

function positiveInteger(
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

function postgresSchema(environment: NodeJS.ProcessEnv): string {
  const value = environment["GOVERNANCE_DATABASE_SCHEMA"]?.trim() || "vera";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new Error("GOVERNANCE_DATABASE_SCHEMA must be a PostgreSQL identifier");
  }
  return value;
}

export interface LabelGovernanceConfig {
  readonly audience: string;
  readonly backendServiceAccountEmail: string;
  readonly taskInvokerServiceAccountEmail: string | null;
  readonly backendUrl: string;
  readonly backendAudience: string;
  readonly bucketName: string;
  readonly chromaEndpoint: string;
  readonly chromaTenant: string;
  readonly chromaDatabase: string;
  readonly chromaToken: string | null;
  readonly chromaTimeoutMs: number;
  readonly databaseUrl: string;
  readonly databaseSchema: string;
  readonly openRouterApiKey: string;
  readonly openRouterTimeoutMs: number;
  readonly officialSourceHosts: readonly string[];
  readonly localAuthToken: string | null;
}

function localAuthToken(environment: NodeJS.ProcessEnv): string | null {
  if (environment["GOVERNANCE_LOCAL_MODE"] !== "true") return null;
  if (environment["NODE_ENV"] !== "development") {
    throw new Error("GOVERNANCE_LOCAL_MODE is restricted to development");
  }
  const token = requiredEnvironment("GOVERNANCE_LOCAL_AUTH_TOKEN", environment);
  if (token.length < 24) throw new Error("GOVERNANCE_LOCAL_AUTH_TOKEN is too short");
  return token;
}

export function readLabelGovernanceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): LabelGovernanceConfig {
  const backendUrl = requiredEnvironment("GOVERNANCE_BACKEND_URL", environment).replace(
    /\/+$/u,
    "",
  );
  return {
    audience: requiredEnvironment("GOVERNANCE_AUDIENCE", environment),
    backendServiceAccountEmail: requiredEnvironment(
      "GOVERNANCE_BACKEND_SERVICE_ACCOUNT_EMAIL",
      environment,
    ),
    taskInvokerServiceAccountEmail:
      environment["GOVERNANCE_TASKS_INVOKER_SERVICE_ACCOUNT_EMAIL"]?.trim() || null,
    backendUrl,
    backendAudience: environment["GOVERNANCE_BACKEND_AUDIENCE"]?.trim() || backendUrl,
    bucketName: requiredEnvironment("GOVERNANCE_GCS_BUCKET", environment),
    chromaEndpoint: requiredEnvironment("CHROMA_ENDPOINT", environment),
    chromaTenant: environment["CHROMA_TENANT"]?.trim() || "default_tenant",
    chromaDatabase: environment["CHROMA_DATABASE"]?.trim() || "default_database",
    chromaToken: environment["CHROMA_TOKEN"]?.trim() || null,
    chromaTimeoutMs: positiveInteger("CHROMA_TIMEOUT_MS", environment, 30_000, 300_000),
    databaseUrl: requiredEnvironment("DATABASE_URL", environment),
    databaseSchema: postgresSchema(environment),
    openRouterApiKey: requiredEnvironment("OPENROUTER_API_KEY", environment),
    openRouterTimeoutMs: positiveInteger(
      "GOVERNANCE_OPENROUTER_TIMEOUT_MS",
      environment,
      60_000,
      300_000,
    ),
    officialSourceHosts: parseOfficialSourceHosts(environment["LABEL_SOURCE_ALLOWED_PDF_HOSTS"]),
    localAuthToken: localAuthToken(environment),
  };
}
