import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import { EvaluationRunSchema, ReviewDecisionSchema, sha256CanonicalJson } from "@vera/contracts";
import type { JsonValue } from "@vera/contracts";
import type { VeraStorageRepository } from "@vera/storage";
import { StorageConflictError } from "@vera/storage";
import Fastify from "fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { assertRole, createAuthService } from "./auth.js";
import type { AuthenticatedAccount, AuthService } from "./auth.js";
import { assertLocalEgressAllowed } from "./egress.js";
import { ApiProblem, installProblemHandler } from "./errors.js";

const ActorRoleSchema = z.enum(["AUTHOR", "REVIEWER", "APPROVER", "ADMIN"]);
const AccountCreateSchema = z
  .object({
    email: z.email(),
    displayName: z.string().min(1).max(200),
    password: z.string().min(12).max(256),
    role: ActorRoleSchema,
  })
  .strict();
const LoginSchema = z.object({ email: z.email(), password: z.string().min(1).max(256) }).strict();
const BlobUploadSchema = z
  .object({
    mediaType: z.string().min(1).max(120),
    base64: z.string().min(1).max(20_000_000),
  })
  .strict();

export interface CreateApiServerOptions {
  readonly repository: VeraStorageRepository;
  readonly auth?: AuthService;
  readonly logger?: boolean;
  readonly now?: () => string;
  readonly persistBlob?: (
    bytes: Uint8Array,
    mediaType: string,
  ) => Promise<{ readonly sha256: string; readonly byteLength: number; readonly path: string }>;
}

function problemJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["type", "title", "status", "detail"],
    properties: {
      type: { type: "string" },
      title: { type: "string" },
      status: { type: "integer" },
      detail: { type: "string" },
    },
  };
}

function zodBody(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" }) as Record<
    string,
    unknown
  >;
  delete jsonSchema["$schema"];
  return jsonSchema;
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

async function idempotentResponse(
  repository: VeraStorageRepository,
  scope: string,
  key: string,
  response: JsonValue,
  now: string,
): Promise<JsonValue> {
  const result = await repository.getOrCreateIdempotency({
    scope,
    key,
    response,
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString(),
  });
  return result.response;
}

export async function createApiServer(options: CreateApiServerOptions): Promise<FastifyInstance> {
  const now = options.now ?? (() => new Date().toISOString());
  const auth = options.auth ?? createAuthService(options.repository);
  const server = Fastify({
    logger:
      options.logger === true
        ? {
            redact: ["req.headers.authorization", "req.headers.cookie", "body.password", "token"],
          }
        : false,
  });
  installProblemHandler(server);
  await server.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
  });
  await server.register(swagger, {
    openapi: {
      info: { title: "VERA local API", version: "0.1.0-demo" },
      servers: [{ url: "http://127.0.0.1:3000" }],
    },
  });

  server.get("/health", () => ({ status: "ok", validationScope: "TECHNICAL_DEMO" }));
  server.get("/openapi.json", (_request, reply) => reply.send(server.swagger()));

  server.post(
    "/v1/accounts",
    {
      schema: {
        body: zodBody(AccountCreateSchema),
        response: { 201: { type: "object" }, 409: problemJsonSchema() },
      },
    },
    async (request, reply) => {
      const body = AccountCreateSchema.parse(request.body);
      const account = await auth.createAccount(body);
      return reply.code(201).send({ account });
    },
  );

  server.post(
    "/v1/sessions",
    { schema: { body: zodBody(LoginSchema), response: { 201: { type: "object" } } } },
    async (request, reply) => {
      const body = LoginSchema.parse(request.body);
      return reply.code(201).send(await auth.login({ ...body, now: now() }));
    },
  );

  server.post(
    "/v1/evaluation-runs",
    { schema: { response: { 201: { type: "object" }, 409: problemJsonSchema() } } },
    async (request, reply) => {
      const account = await authenticated(request, auth, now);
      assertRole(account, ["AUTHOR", "ADMIN"]);
      const key = idempotencyKey(request);
      const run = EvaluationRunSchema.parse(request.body);
      let saved;
      try {
        saved = await options.repository.saveEvaluationRun(run);
      } catch (error) {
        if (error instanceof StorageConflictError) {
          saved = await options.repository.getEvaluationRun(run.id);
        } else {
          throw error;
        }
      }
      const response = { evaluationRun: saved } as unknown as JsonValue;
      const replay = await idempotentResponse(
        options.repository,
        "evaluation-runs:create",
        key,
        response,
        now(),
      );
      return reply.code(201).send(replay);
    },
  );

  server.get("/v1/evaluation-runs/:id", async (request, reply) => {
    await authenticated(request, auth, now);
    const id = z.object({ id: z.uuid() }).parse(request.params).id;
    return reply.send({ evaluationRun: await options.repository.getEvaluationRun(id) });
  });

  server.patch("/v1/evaluation-runs/:id", () => {
    throw new ApiProblem(405, "Method Not Allowed", "EvaluationRun records are immutable");
  });

  server.post("/v1/evaluation-runs/:id/review-decisions", async (request, reply) => {
    const account = await authenticated(request, auth, now);
    assertRole(account, ["REVIEWER", "APPROVER", "ADMIN"]);
    const id = z.object({ id: z.uuid() }).parse(request.params).id;
    const key = idempotencyKey(request);
    const decision = ReviewDecisionSchema.parse(request.body);
    if (decision.runId !== id) {
      throw new ApiProblem(400, "Bad Request", "ReviewDecision runId must match the route");
    }
    const saved = await options.repository.appendReviewDecision(decision);
    const response = { reviewDecision: saved } as unknown as JsonValue;
    const replay = await idempotentResponse(
      options.repository,
      `review-decisions:${id}`,
      key,
      response,
      now(),
    );
    return reply.code(201).send(replay);
  });

  server.post("/v1/blobs", async (request, reply) => {
    const account = await authenticated(request, auth, now);
    assertRole(account, ["AUTHOR", "ADMIN"]);
    if (options.persistBlob === undefined) {
      throw new ApiProblem(503, "Service Unavailable", "Blob store is not configured");
    }
    const body = BlobUploadSchema.parse(request.body);
    const bytes = Buffer.from(body.base64, "base64");
    const descriptor = await options.persistBlob(bytes, body.mediaType);
    await options.repository.recordBlob({
      ...descriptor,
      mediaType: body.mediaType,
      createdAt: now(),
    });
    return reply.code(201).send({ blob: descriptor });
  });

  server.post("/v1/egress-check", async (request: FastifyRequest, reply: FastifyReply) => {
    const account = await authenticated(request, auth, now);
    assertRole(account, ["ADMIN"]);
    const body = z.object({ url: z.url() }).strict().parse(request.body);
    const url = assertLocalEgressAllowed(body.url);
    return reply.send({ allowed: true, origin: url.origin, hash: sha256CanonicalJson(url.origin) });
  });

  return server;
}
