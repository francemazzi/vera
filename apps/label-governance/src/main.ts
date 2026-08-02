import {
  ChromaHttpVectorStore,
  ChromaPrivateLabelRagIndex,
  OpenRouterEmbeddingProvider,
} from "@vera/rag";
import { createPrismaClient, PrivateLabelGovernanceRepository } from "@vera/storage";

import { createBackendSourceGovernanceJobProcessor } from "./backend-source-job-processor.js";
import { readLabelGovernanceConfig } from "./config.js";
import { createGcsSourceDocumentMaterializer } from "./gcs-source-document-materializer.js";
import { createBackendOidcAuthorizer, createLocalBearerAuthorizer } from "./oidc.js";
import { createOfficialAuthoritySearchTool } from "./official-authority-search-tool.js";
import { createGcsOfficialSourceAcquirer } from "./official-source-acquirer.js";
import { createLabelGovernanceServer } from "./server.js";
import { createSourceDiscoveryBackendClient } from "./source-discovery-backend-client.js";
import { createSourceDiscoveryJobProcessor } from "./source-discovery-processor.js";
import { createOpenRouterSourceDiscoveryRanker } from "./source-discovery-ranker.js";
import { createSourceBackendClient } from "./source-backend-client.js";
import { createOpenRouterSourceClassifier } from "./source-classifier.js";

async function main(): Promise<void> {
  const config = readLabelGovernanceConfig();
  const prisma = createPrismaClient({
    connectionString: config.databaseUrl,
    schema: config.databaseSchema,
  });
  const port = Number(process.env["PORT"] ?? "8080");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be a valid TCP port");
  }
  const host = process.env["HOST"]?.trim() || "0.0.0.0";
  // The task identity can deliver opaque source jobs only. Formal routes keep
  // a backend-only OIDC verifier because they carry a forwarded ADMIN actor.
  const backendAuthorizer =
    config.localAuthToken === null
      ? createBackendOidcAuthorizer({
          audience: config.audience,
          expectedServiceAccountEmail: config.backendServiceAccountEmail,
        })
      : createLocalBearerAuthorizer(config.localAuthToken);
  const sourceJobAuthorizer =
    config.localAuthToken !== null || config.taskInvokerServiceAccountEmail === null
      ? backendAuthorizer
      : createBackendOidcAuthorizer({
          audience: config.audience,
          expectedServiceAccountEmail: config.backendServiceAccountEmail,
          expectedServiceAccountEmails: [config.taskInvokerServiceAccountEmail],
        });
  const server = await createLabelGovernanceServer({
    authorizer: backendAuthorizer,
    sourceJobAuthorizer,
    classifier: createOpenRouterSourceClassifier({
      apiKey: config.openRouterApiKey,
      timeoutMs: config.openRouterTimeoutMs,
    }),
    sourceJobProcessor: createBackendSourceGovernanceJobProcessor({
      backend: createSourceBackendClient({
        backendUrl: config.backendUrl,
        audience: config.backendAudience,
        ...(config.localAuthToken === null ? {} : { localToken: config.localAuthToken }),
      }),
      documentMaterializer: createGcsSourceDocumentMaterializer({
        bucketName: config.bucketName,
        officialSourceHosts: config.officialSourceHosts,
      }),
      classifier: createOpenRouterSourceClassifier({
        apiKey: config.openRouterApiKey,
        timeoutMs: config.openRouterTimeoutMs,
      }),
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
        }),
      }),
      officialSourceHosts: config.officialSourceHosts,
    }),
    sourceDiscoveryJobProcessor: createSourceDiscoveryJobProcessor({
      backend: createSourceDiscoveryBackendClient({
        backendUrl: config.backendUrl,
        audience: config.backendAudience,
        allowLoopbackHttp: config.localAuthToken !== null,
      }),
      searchTool: createOfficialAuthoritySearchTool(),
      acquirer: createGcsOfficialSourceAcquirer({ bucketName: config.bucketName }),
      ranker: createOpenRouterSourceDiscoveryRanker({
        apiKey: config.openRouterApiKey,
        timeoutMs: config.openRouterTimeoutMs,
      }),
    }),
    sourceLedgerRepository: new PrivateLabelGovernanceRepository(prisma),
    officialSourceHosts: config.officialSourceHosts,
    logger: true,
  });
  server.addHook("onClose", async () => prisma.$disconnect());
  await server.listen({ host, port });
}

await main();
