import { createLabelBackendClient } from "./backend-client.js";
import { readLabelRunnerConfig } from "./config.js";
import { createTaskOidcAuthorizer } from "./oidc.js";
import { createOpenRouterLabelEvaluator } from "./openrouter-evaluator.js";
import { createGcsLabelPageStore } from "./page-store.js";
import { createLabelJobProcessor } from "./processor.js";
import { createLabelRunnerServer } from "./server.js";

async function main(): Promise<void> {
  const config = readLabelRunnerConfig();
  const backend = createLabelBackendClient({
    backendUrl: config.backendUrl,
    audience: config.backendAudience,
  });
  const processor = createLabelJobProcessor({
    backend,
    pageStore: createGcsLabelPageStore({
      bucketName: config.bucketName,
      projectId: config.gcpProjectId,
    }),
    evaluator: createOpenRouterLabelEvaluator({
      apiKey: config.openRouterApiKey,
      model: config.openRouterModel,
      promptVersion: config.promptVersion,
      rulePackVersion: config.rulePackVersion,
      sourceSnapshot: config.sourceSnapshot,
      timeoutMs: config.openRouterTimeoutMs,
    }),
  });
  const server = await createLabelRunnerServer({
    authorizer: createTaskOidcAuthorizer({
      audience: config.taskAudience,
      expectedServiceAccountEmail: config.taskInvokerServiceAccountEmail,
    }),
    processor,
    logger: true,
  });
  const port = Number(process.env["PORT"] ?? "8080");
  await server.listen({ host: "0.0.0.0", port });
}

await main();
