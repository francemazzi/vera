import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { LabelTaskSchema } from "./contracts.js";
import type { TaskOidcAuthorizer } from "./oidc.js";
import type { LabelJobProcessor } from "./processor.js";

export async function createLabelRunnerServer(options: {
  readonly authorizer: TaskOidcAuthorizer;
  readonly processor: LabelJobProcessor;
  readonly logger?: boolean;
}): Promise<FastifyInstance> {
  const server = Fastify({
    bodyLimit: 8 * 1024,
    logger: options.logger === true,
  });
  server.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      request.log.warn({ code: "INVALID_TASK" }, "Rejected a malformed label task");
      return reply.code(400).send({ status: "error", code: "INVALID_TASK" });
    }
    // Only the error name and message are logged: both are built from issue
    // paths and codes, never from model output that may echo label content.
    const failure =
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: "UnknownError", message: "" };
    request.log.error(failure, "Label job failed");
    return reply.code(500).send({ status: "error", code: "RUNNER_FAILURE" });
  });
  server.get("/health", () => ({ status: "ok", service: "vera-label-runner" }));
  server.post("/internal/label-jobs", async (request, reply) => {
    try {
      await options.authorizer.authorize(request.headers.authorization);
    } catch {
      return reply.code(401).send({ status: "error", code: "TASK_OIDC_INVALID" });
    }
    const task = LabelTaskSchema.parse(request.body);
    const result = await options.processor.process(task.analysisId);
    return reply.code(200).send({ status: "success", meta: result });
  });
  return server;
}

/**
 * Cloud Run readiness mode used while the private runner has its identity,
 * storage and OpenRouter secret configured but no active rule-pack snapshot.
 * It deliberately refuses jobs instead of producing a result under an
 * invented configuration.
 */
export async function createLabelRunnerStandbyServer(
  options: {
    readonly logger?: boolean;
  } = {},
): Promise<FastifyInstance> {
  const server = Fastify({
    bodyLimit: 8 * 1024,
    logger: options.logger === true,
  });
  server.get("/health", () => ({
    status: "ok",
    service: "vera-label-runner",
    mode: "standby",
  }));
  server.post("/internal/label-jobs", async (_request, reply) =>
    reply.code(503).send({ status: "error", code: "RUNNER_STANDBY" }),
  );
  return server;
}
