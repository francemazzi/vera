import { timingSafeEqual } from "node:crypto";

import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import {
  EvaluationRunSchema,
  ReviewDecisionSchema,
  sha256Bytes,
  sha256CanonicalJson,
} from "@vera/contracts";
import type {
  DurableComplianceSourceRepository,
  DurableRuleCardRepository,
  DurableRulePackActivationLedger,
  DurableRulePackRepository,
  DurableRuleTestRunRepository,
  VeraStorageRepository,
} from "@vera/storage";
import Fastify from "fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { assertRole, createAuthService } from "./auth.js";
import type { AuthenticatedAccount, AuthService } from "./auth.js";
import { registerDomainRoutes } from "./domain-routes.js";
import { assertLocalEgressAllowed } from "./egress.js";
import { ApiProblem, installProblemHandler } from "./errors.js";

const ActorRoleSchema = z.enum(["AUTHOR", "REVIEWER", "APPROVER", "ADMIN"]);
const Sha256DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
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
  readonly complianceSources?: DurableComplianceSourceRepository;
  readonly ruleCards?: DurableRuleCardRepository;
  readonly rulePacks?: DurableRulePackRepository;
  readonly activations?: DurableRulePackActivationLedger;
  readonly ruleTestRuns?: DurableRuleTestRunRepository;
  readonly auth?: AuthService;
  readonly bootstrapTokenHash?: string;
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

function openObjectJsonSchema(): Record<string, unknown> {
  return { type: "object", additionalProperties: true };
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

function validBootstrapAuthorization(
  authorization: string | undefined,
  expectedHash: string | undefined,
): boolean {
  const match = /^Bootstrap (?<token>\S{1,512})$/u.exec(authorization ?? "");
  const actualHash = sha256Bytes(Buffer.from(match?.groups?.["token"] ?? "", "utf8"));
  const comparisonHash = expectedHash ?? "0".repeat(64);
  const matches = timingSafeEqual(
    Buffer.from(actualHash, "hex"),
    Buffer.from(comparisonHash, "hex"),
  );
  return expectedHash !== undefined && match !== null && matches;
}

export async function createApiServer(options: CreateApiServerOptions): Promise<FastifyInstance> {
  const now = options.now ?? (() => new Date().toISOString());
  const auth = options.auth ?? createAuthService(options.repository);
  const bootstrapTokenHash =
    options.bootstrapTokenHash === undefined
      ? undefined
      : Sha256DigestSchema.parse(options.bootstrapTokenHash);
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
        response: { 201: openObjectJsonSchema(), 409: problemJsonSchema() },
      },
    },
    async (request, reply) => {
      const body = AccountCreateSchema.parse(request.body);
      const authorization = request.headers.authorization;
      let account: AuthenticatedAccount;
      if ((authorization ?? "").startsWith("Bootstrap")) {
        if (!validBootstrapAuthorization(authorization, bootstrapTokenHash)) {
          throw new ApiProblem(401, "Unauthorized", "Invalid bootstrap credential");
        }
        if (body.role !== "ADMIN") {
          throw new ApiProblem(403, "Forbidden", "Bootstrap can create only the initial ADMIN");
        }
        account = await auth.bootstrapAdmin(body);
      } else {
        const administrator = await authenticated(request, auth, now);
        assertRole(administrator, ["ADMIN"]);
        account = await auth.createAccount(body);
      }
      return reply.code(201).send({ account });
    },
  );

  server.post(
    "/v1/sessions",
    { schema: { body: zodBody(LoginSchema), response: { 201: openObjectJsonSchema() } } },
    async (request, reply) => {
      const body = LoginSchema.parse(request.body);
      return reply.code(201).send(await auth.login({ ...body, now: now() }));
    },
  );

  server.post(
    "/v1/evaluation-runs",
    { schema: { response: { 201: openObjectJsonSchema(), 409: problemJsonSchema() } } },
    async (request, reply) => {
      const account = await authenticated(request, auth, now);
      assertRole(account, ["AUTHOR", "ADMIN"]);
      const key = idempotencyKey(request);
      const run = EvaluationRunSchema.parse(request.body);
      const writtenAt = now();
      const result = await options.repository.saveEvaluationRunIdempotently({
        run,
        scope: `accounts:${account.id}:evaluation-runs`,
        key,
        createdAt: writtenAt,
        expiresAt: new Date(Date.parse(writtenAt) + 24 * 60 * 60 * 1000).toISOString(),
      });
      return reply.code(201).send(result.response);
    },
  );

  server.get("/v1/evaluation-runs/:id", async (request, reply) => {
    await authenticated(request, auth, now);
    const id = z.object({ id: z.uuid() }).parse(request.params).id;
    return reply.send({ evaluationRun: await options.repository.getEvaluationRun(id) });
  });

  server.get("/v1/evaluation-runs/:id/review-decisions", async (request, reply) => {
    await authenticated(request, auth, now);
    const id = z.object({ id: z.uuid() }).parse(request.params).id;
    return reply.send({
      reviewDecisions: await options.repository.listReviewDecisions(id),
    });
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
    if (decision.actorId !== account.id || decision.exercisedRole !== account.role) {
      throw new ApiProblem(
        403,
        "Forbidden",
        "ReviewDecision actor and exercised role must match the authenticated account",
      );
    }
    const writtenAt = now();
    const result = await options.repository.appendReviewDecisionIdempotently({
      decision,
      scope: `accounts:${account.id}:evaluation-runs:${id}:review-decisions`,
      key,
      createdAt: writtenAt,
      expiresAt: new Date(Date.parse(writtenAt) + 24 * 60 * 60 * 1000).toISOString(),
    });
    return reply.code(201).send(result.response);
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

  registerDomainRoutes(server, {
    repository: options.repository,
    complianceSources: options.complianceSources,
    ruleCards: options.ruleCards,
    rulePacks: options.rulePacks,
    activations: options.activations,
    ruleTestRuns: options.ruleTestRuns,
    auth,
    now,
  });

  return server;
}
