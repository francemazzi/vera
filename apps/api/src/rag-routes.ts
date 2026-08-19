import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { sha256CanonicalJson } from "@vera/contracts";
import type { JsonValue } from "@vera/contracts";
import {
  RagError,
  RagRetrievalQuerySchema,
  RagSourceSectionSchema,
  generateRuleCardDraft,
} from "@vera/rag";
import type { EmbeddingProvider, PgVectorRagIndex, RuleDraftProvider } from "@vera/rag";
import type { DurableComplianceSourceRepository, VeraStorageRepository } from "@vera/storage";

import { assertRole } from "./auth.js";
import type { AuthService, AuthenticatedAccount } from "./auth.js";
import { ApiProblem } from "./errors.js";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const VersionIdParamSchema = z.object({ versionId: z.uuid() }).strict();
const RagIndexBodySchema = z
  .object({
    sections: z.array(RagSourceSectionSchema).min(1).max(200),
  })
  .strict();
const RagDraftBodySchema = z
  .object({
    instruction: z.string().trim().min(1).max(5000),
    retrieval: RagRetrievalQuerySchema,
  })
  .strict();

export interface RagRouteServices {
  readonly ragIndex: PgVectorRagIndex | undefined;
  readonly embeddingProvider: EmbeddingProvider | undefined;
  readonly draftProvider: RuleDraftProvider | undefined;
  readonly complianceSources: DurableComplianceSourceRepository | undefined;
  readonly repository: VeraStorageRepository;
}

interface RegisterRagRoutesOptions extends RagRouteServices {
  readonly auth: AuthService;
  readonly now: () => string;
}

function idempotencyKey(request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length < 8 || value.length > 200) {
    throw new ApiProblem(400, "Bad Request", "Idempotency-Key header is required");
  }
  return value;
}

async function authenticated(
  request: FastifyRequest,
  auth: AuthService,
  now: () => string,
): Promise<AuthenticatedAccount> {
  return auth.authenticate(request.headers.authorization, now());
}

function requireService<T>(service: T | undefined, label: string): T {
  if (service === undefined) {
    throw new ApiProblem(503, "Service Unavailable", `${label} is not configured`);
  }
  return service;
}

function mapRagError(error: unknown): never {
  if (error instanceof ApiProblem) throw error;
  if (error instanceof RagError) {
    if (error.code === "DRAFT_INVALID" || error.code === "QUERY_INVALID") {
      throw new ApiProblem(400, "Bad Request", `${error.code}: ${error.message}`);
    }
    if (error.code === "INDEX_REJECTED" || error.code === "CONFIGURATION_INVALID") {
      throw new ApiProblem(422, "Unprocessable Entity", `${error.code}: ${error.message}`);
    }
    if (
      error.code === "PROVIDER_UNAVAILABLE" ||
      error.code === "EGRESS_UNAVAILABLE" ||
      error.code === "RETRY_EXHAUSTED"
    ) {
      throw new ApiProblem(503, "Service Unavailable", `${error.code}: ${error.message}`);
    }
    throw new ApiProblem(500, "Internal Server Error", `${error.code}: ${error.message}`);
  }
  throw error;
}

async function runIdempotently<T>(input: {
  readonly repository: VeraStorageRepository;
  readonly scope: string;
  readonly key: string;
  readonly request: unknown;
  readonly now: string;
  readonly mutate: () => Promise<T>;
}): Promise<{ readonly value: T; readonly created: boolean }> {
  const result = await input.repository.getOrCreateIdempotency({
    scope: input.scope,
    key: input.key,
    requestHash: sha256CanonicalJson({
      scope: input.scope,
      request: input.request as JsonValue,
    }),
    response: { ok: true },
    createdAt: input.now,
    expiresAt: new Date(Date.parse(input.now) + IDEMPOTENCY_TTL_MS).toISOString(),
  });
  if (!result.created) {
    return { value: await input.mutate(), created: false };
  }
  return { value: await input.mutate(), created: true };
}

export function registerRagRoutes(
  server: FastifyInstance,
  options: RegisterRagRoutesOptions,
): void {
  server.post("/v1/compliance-sources/versions/:versionId/rag-index", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    assertRole(account, ["APPROVER", "ADMIN"]);
    const ragIndex = requireService(options.ragIndex, "RAG index");
    const complianceSources = requireService(options.complianceSources, "Compliance sources");
    const versionId = VersionIdParamSchema.parse(request.params).versionId;
    const body = RagIndexBodySchema.parse(request.body);

    try {
      const version = await complianceSources.getVersion(versionId);
      const source = await complianceSources.getSource(version.sourceId);
      const state = await complianceSources.getVersionState(versionId);
      if (state !== "APPROVED") {
        throw new ApiProblem(
          422,
          "Unprocessable Entity",
          "Only APPROVED compliance source versions can be indexed",
        );
      }

      for (const section of body.sections) {
        if (
          section.sourceId !== source.id ||
          section.sourceVersionId !== version.id ||
          section.sourceContentHash !== version.contentHash ||
          section.sourceState !== "APPROVED" ||
          section.domain !== source.domain ||
          section.jurisdiction !== source.jurisdiction
        ) {
          throw new ApiProblem(
            400,
            "Bad Request",
            "RAG section metadata must match the APPROVED durable source version",
          );
        }
      }

      const writtenAt = options.now();
      const result = await runIdempotently({
        repository: options.repository,
        scope: `accounts:${account.id}:compliance-source-versions:${versionId}:rag-index`,
        key: idempotencyKey(request),
        request: body,
        now: writtenAt,
        mutate: async () => {
          await ragIndex.ensureSchema();
          return await ragIndex.indexApprovedSections(body.sections);
        },
      });

      return await reply.code(result.created ? 201 : 200).send({
        ragIndex: {
          sourceVersionId: versionId,
          chunksIndexed: result.value.chunksIndexed,
          sourceVersionIds: result.value.sourceVersionIds,
        },
      });
    } catch (error) {
      mapRagError(error);
    }
  });

  server.post("/v1/rag/retrieve", async (request, reply) => {
    await authenticated(request, options.auth, options.now);
    const ragIndex = requireService(options.ragIndex, "RAG index");
    const query = RagRetrievalQuerySchema.parse(request.body);
    try {
      const result = await ragIndex.retrieveSafely(query);
      return await reply.send({ retrieval: result });
    } catch (error) {
      mapRagError(error);
    }
  });

  server.post("/v1/rag/rule-card-drafts", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    assertRole(account, ["AUTHOR", "ADMIN"]);
    const ragIndex = requireService(options.ragIndex, "RAG index");
    const draftProvider = requireService(options.draftProvider, "RAG draft provider");
    const body = RagDraftBodySchema.parse(request.body);
    const writtenAt = options.now();

    try {
      const result = await runIdempotently({
        repository: options.repository,
        scope: `accounts:${account.id}:rag-rule-card-drafts`,
        key: idempotencyKey(request),
        request: body,
        now: writtenAt,
        mutate: async () => {
          const retrieval = await ragIndex.retrieveSafely(body.retrieval);
          if (retrieval.status === "UNAVAILABLE") {
            return { status: "UNAVAILABLE" as const, retrieval };
          }
          if (retrieval.chunks.length === 0) {
            return {
              status: "UNAVAILABLE" as const,
              retrieval: {
                status: "UNAVAILABLE" as const,
                requiresReview: true as const,
                reason: "No approved source chunks matched the retrieval query",
              },
            };
          }
          const draft = await generateRuleCardDraft({
            instruction: body.instruction,
            chunks: retrieval.chunks,
            provider: draftProvider,
            generatedAt: writtenAt,
          });
          return { status: "AVAILABLE" as const, retrieval, draft };
        },
      });

      if (result.value.status === "UNAVAILABLE") {
        return await reply.code(503).send(result.value);
      }
      return await reply.code(result.created ? 201 : 200).send(result.value);
    } catch (error) {
      mapRagError(error);
    }
  });
}

export async function retireRagSourceVersion(
  ragIndex: PgVectorRagIndex | undefined,
  sourceVersionId: string,
): Promise<void> {
  if (ragIndex === undefined) return;
  await ragIndex.deleteBySourceVersionId(sourceVersionId);
}
