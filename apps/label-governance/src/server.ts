import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { governanceActorFromHeaders, GovernanceActorError } from "./actor.js";
import { SourceClassificationRequestSchema } from "./contracts.js";
import {
  assertOfficialSourceUrl,
  DEFAULT_OFFICIAL_SOURCE_HOSTS,
} from "./official-source-policy.js";
import type { BackendOidcAuthorizer } from "./oidc.js";
import { SourceGovernanceJobError, SourceGovernanceJobSchema } from "./source-jobs.js";
import type { SourceGovernanceJobProcessor } from "./source-jobs.js";
import { SourceClassificationError } from "./source-classifier.js";
import type { SourceClassifier } from "./source-classifier.js";
import { SourceDiscoveryJobError, SourceDiscoveryJobSchema } from "./source-discovery-jobs.js";
import type { SourceDiscoveryJobProcessor } from "./source-discovery-jobs.js";
import {
  applySourceLedgerAction,
  SourceLedgerError,
  SourceLedgerRequestSchema,
} from "./source-ledger.js";
import type { SourceLedgerRepository } from "./source-ledger.js";

function classificationFailureStatus(error: SourceClassificationError): number {
  return error.retryable ? 503 : 502;
}

/**
 * Internal-only governance API. The public SILTO browser calls its own backend;
 * only that backend can invoke this process through Cloud Run IAM + OIDC.
 */
export async function createLabelGovernanceServer(options: {
  /**
   * The SILTO backend identity. It is the only identity allowed to carry a
   * user actor and make formal governance/ledger mutations.
   */
  readonly authorizer: BackendOidcAuthorizer;
  /**
   * Optional, narrower exception for Cloud Tasks delivery. A task invoker may
   * invoke source jobs, but never classification or immutable ledger routes.
   */
  readonly sourceJobAuthorizer?: BackendOidcAuthorizer;
  readonly classifier: SourceClassifier;
  readonly sourceJobProcessor?: SourceGovernanceJobProcessor;
  /** Cloud Tasks-only discovery worker; it returns staging proposals only. */
  readonly sourceDiscoveryJobProcessor?: SourceDiscoveryJobProcessor;
  readonly sourceLedgerRepository?: SourceLedgerRepository;
  /** Must match the backend's LABEL_SOURCE_ALLOWED_PDF_HOSTS policy. */
  readonly officialSourceHosts?: readonly string[];
  readonly logger?: boolean;
}): Promise<FastifyInstance> {
  const server = Fastify({
    // `sourceText` is capped at 500k Unicode code units; allow its worst-case
    // UTF-8 representation plus JSON framing, but never accept a PDF here.
    bodyLimit: 2_200_000,
    logger:
      options.logger === true
        ? {
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.x-silto-actor-id",
                "req.body.sourceText",
                "req.body.canonicalUrl",
                "req.body.pdfUrl",
                "req.body.openRouterApiKey",
                "req.body.OPENROUTER_API_KEY",
                "req.body.*.sourceText",
              ],
              censor: "[REDACTED]",
            },
          }
        : false,
  });

  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ status: "error", code: "INVALID_CLASSIFICATION_REQUEST" });
    }
    return reply.code(500).send({ status: "error", code: "GOVERNANCE_FAILURE" });
  });

  // This endpoint carries no source or governance state and is intended only
  // for Cloud Run/container readiness. The private mutation route below is
  // always authenticated before it parses source text.
  server.get("/health", () => ({ status: "ok", service: "silto-vera-governance" }));

  server.post("/internal/source-jobs", async (request, reply) => {
    try {
      await (options.sourceJobAuthorizer ?? options.authorizer).authorize(
        request.headers.authorization,
      );
    } catch {
      return reply.code(401).send({ status: "error", code: "BACKEND_OIDC_INVALID" });
    }

    const job = SourceGovernanceJobSchema.parse(request.body);
    if (options.sourceJobProcessor === undefined) {
      return reply.code(503).send({ status: "error", code: "SOURCE_JOB_PROCESSOR_UNAVAILABLE" });
    }
    try {
      const result = await options.sourceJobProcessor.process(job);
      return reply.code(200).send({ status: "success", meta: result });
    } catch (error) {
      if (error instanceof SourceGovernanceJobError) {
        if (!error.retryable) {
          // The processor has already stored a terminal FAILED state. A 2xx
          // acknowledgement is essential: Cloud Tasks retries every non-2xx.
          return reply.code(200).send({
            status: "success",
            meta: { terminalFailure: true },
          });
        }
        return reply.code(503).header("retry-after", "60").send({
          status: "error",
          code: "SOURCE_JOB_RETRYABLE",
        });
      }
      throw error;
    }
  });

  // Source discovery is a separate Cloud Tasks lane from classification and
  // indexing. Its payload contains only an opaque discovery run ID and it can
  // never carry an ADMIN actor, source bytes, or a Chroma operation.
  server.post("/internal/source-discovery-jobs", async (request, reply) => {
    try {
      await (options.sourceJobAuthorizer ?? options.authorizer).authorize(
        request.headers.authorization,
      );
    } catch {
      return reply.code(401).send({ status: "error", code: "BACKEND_OIDC_INVALID" });
    }
    const job = SourceDiscoveryJobSchema.parse(request.body);
    if (options.sourceDiscoveryJobProcessor === undefined) {
      return reply
        .code(503)
        .send({ status: "error", code: "SOURCE_DISCOVERY_PROCESSOR_UNAVAILABLE" });
    }
    try {
      const result = await options.sourceDiscoveryJobProcessor.process(job);
      return reply.code(200).send({ status: "success", meta: result });
    } catch (error) {
      if (error instanceof SourceDiscoveryJobError) {
        if (!error.retryable) {
          return reply.code(200).send({ status: "success", meta: { terminalFailure: true } });
        }
        return reply.code(503).header("retry-after", "60").send({
          status: "error",
          code: "SOURCE_DISCOVERY_RETRYABLE",
        });
      }
      throw error;
    }
  });

  server.post("/internal/source-classifications", async (request, reply) => {
    try {
      await options.authorizer.authorize(request.headers.authorization);
    } catch {
      return reply.code(401).send({ status: "error", code: "BACKEND_OIDC_INVALID" });
    }

    let actor;
    try {
      actor = governanceActorFromHeaders(request.headers);
    } catch (error) {
      if (error instanceof GovernanceActorError) {
        return reply.code(403).send({ status: "error", code: "GOVERNANCE_ACTOR_FORBIDDEN" });
      }
      throw error;
    }

    const body = SourceClassificationRequestSchema.parse(request.body);
    try {
      // This direct endpoint is reserved for official-reference work. The
      // asynchronous job path may classify a private PDF in staging, but it
      // can never promote or index that candidate without this reference.
      if (body.canonicalUrl === null) {
        return reply.code(400).send({ status: "error", code: "OFFICIAL_SOURCE_URL_REQUIRED" });
      }
      assertOfficialSourceUrl(
        body.canonicalUrl,
        options.officialSourceHosts ?? DEFAULT_OFFICIAL_SOURCE_HOSTS,
      );
    } catch {
      return reply.code(400).send({ status: "error", code: "OFFICIAL_SOURCE_URL_REQUIRED" });
    }

    try {
      const classification = await options.classifier.classify(body);
      // Structured operational audit; deliberately excludes source text, URL,
      // Authorization, and the OpenRouter key.
      server.log.info({
        event: "source_classification_completed",
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        workspaceId: actor.workspaceId,
        sourceId: body.sourceId,
        sourceVersionId: body.sourceVersionId,
        sourceContentHash: body.sourceContentHash,
        model: classification.model,
        promptVersion: classification.promptVersion,
        responseSchemaHash: classification.responseSchemaHash,
      });
      return reply.code(200).send({
        status: "success",
        classification,
        audit: {
          actorId: actor.actorId,
          actorRole: actor.actorRole,
          workspaceId: actor.workspaceId,
          sourceId: body.sourceId,
          sourceVersionId: body.sourceVersionId,
        },
      });
    } catch (error) {
      if (error instanceof SourceClassificationError) {
        return reply.code(classificationFailureStatus(error)).send({
          status: "error",
          code: error.retryable ? "CLASSIFICATION_RETRYABLE" : "CLASSIFICATION_REJECTED",
        });
      }
      throw error;
    }
  });

  server.post("/internal/source-versions", async (request, reply) => {
    try {
      await options.authorizer.authorize(request.headers.authorization);
    } catch {
      return reply.code(401).send({ status: "error", code: "BACKEND_OIDC_INVALID" });
    }
    if (options.sourceLedgerRepository === undefined) {
      return reply.code(503).send({ status: "error", code: "SOURCE_LEDGER_UNAVAILABLE" });
    }
    const sourceAction = SourceLedgerRequestSchema.parse(request.body);
    // This is deliberately sourced from the authenticated backend payload,
    // not from browser-controlled headers. The backend has already checked
    // role/workspace before forwarding the ADMIN identity for ledger audit.
    const actor = {
      actorId: sourceAction.actor.id,
      actorRole: sourceAction.actor.role,
    } as const;
    try {
      const result = await applySourceLedgerAction({
        repository: options.sourceLedgerRepository,
        request: sourceAction,
        actor,
      });
      server.log.info({
        event: "source_ledger_action_completed",
        action: sourceAction.action,
        candidateId: sourceAction.candidateId,
        sourceVersionId: result.sourceVersionId,
        state: result.state,
        sequence: result.sequence,
        actorId: actor.actorId,
      });
      return reply.code(200).send({ status: "success", data: result });
    } catch (error) {
      if (error instanceof SourceLedgerError) {
        return reply.code(error.retryable ? 503 : 409).send({
          status: "error",
          code: error.retryable ? "SOURCE_LEDGER_RETRYABLE" : "SOURCE_LEDGER_REJECTED",
        });
      }
      throw error;
    }
  });

  return server;
}
