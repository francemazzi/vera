import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

import { StorageConflictError, StorageNotFoundError } from "@vera/storage";

export class ApiProblem extends Error {
  public constructor(
    public readonly status: number,
    public readonly title: string,
    public override readonly message: string,
    public readonly type = "about:blank",
  ) {
    super(message);
  }
}

export function problemBody(problem: ApiProblem): {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
} {
  return {
    type: problem.type,
    title: problem.title,
    status: problem.status,
    detail: problem.message,
  };
}

export function toProblem(error: FastifyError | Error): ApiProblem {
  if (error instanceof ApiProblem) return error;
  if (error instanceof StorageConflictError) {
    return new ApiProblem(409, "Conflict", error.message);
  }
  if (error instanceof StorageNotFoundError) {
    return new ApiProblem(404, "Not Found", error.message);
  }
  const validation = (error as { readonly validation?: unknown }).validation;
  if (validation !== undefined) {
    return new ApiProblem(400, "Bad Request", "Request validation failed");
  }
  return new ApiProblem(500, "Internal Server Error", "Unexpected API error");
}

export function installProblemHandler(server: {
  setErrorHandler(
    handler: (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => void,
  ): void;
}): void {
  server.setErrorHandler((error, _request, reply) => {
    const problem = toProblem(error);
    reply.code(problem.status).type("application/problem+json").send(problemBody(problem));
  });
}
