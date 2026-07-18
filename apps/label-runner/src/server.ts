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
  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ status: "error", code: "INVALID_TASK" });
    }
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
