import { createLabelBackendClient } from "./backend-client.js";
import {
  ChromaHttpVectorStore,
  ChromaPrivateLabelRagIndex,
  OpenRouterEmbeddingProvider,
} from "@vera/rag";
import { readLabelRunnerConfig } from "./config.js";
import { createLocalTaskAuthorizer, createTaskOidcAuthorizer } from "./oidc.js";
import { createOpenRouterLabelEvaluator } from "./openrouter-evaluator.js";
import { createGcsLabelPageStore } from "./page-store.js";
import { createLabelJobProcessor } from "./processor.js";
import { createLabelRunnerServer, createLabelRunnerStandbyServer } from "./server.js";
import { createChromaLabelSourceRetriever } from "./source-retriever.js";

async function main(): Promise<void> {
  const port = Number(process.env["PORT"] ?? "8080");
  if (process.env["LABEL_RUNNER_MODE"] === "standby") {
    const server = await createLabelRunnerStandbyServer({ logger: true });
    await server.listen({ host: "0.0.0.0", port });
    return;
  }

  const config = readLabelRunnerConfig();
  const backend = createLabelBackendClient({
    backendUrl: config.backendUrl,
    audience: config.backendAudience,
    localToken: config.localToken,
  });
  // The runner reads only the verified Chroma collection through the private
  // VPC endpoint.  OpenRouter is used solely to create query embeddings; its
  // API key never reaches a browser or the Chroma VM.
  const sourceRetriever = createChromaLabelSourceRetriever({
    ragIndex: new ChromaPrivateLabelRagIndex({
      chroma: new ChromaHttpVectorStore({
        endpoint: config.chromaEndpoint,
        tenant: config.chromaTenant,
        database: config.chromaDatabase,
        ...(config.chromaToken === null ? {} : { token: config.chromaToken }),
        timeoutMs: config.chromaTimeoutMs,
      }),
      embeddingProvider: new OpenRouterEmbeddingProvider({
        apiKey: config.openRouterApiKey,
        timeoutMs: config.openRouterTimeoutMs,
      }),
    }),
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
    sourceRetriever,
  });
  const server = await createLabelRunnerServer({
    authorizer: config.localToken
      ? createLocalTaskAuthorizer(config.localToken)
      : createTaskOidcAuthorizer({
          audience: config.taskAudience,
          expectedServiceAccountEmail: config.taskInvokerServiceAccountEmail,
        }),
    processor,
    logger: true,
  });
  await server.listen({ host: "0.0.0.0", port });
}

await main();
