import { randomUUID, timingSafeEqual } from "node:crypto";

import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import {
  EvaluationRunSchema,
  ReviewDecisionSchema,
  sha256Bytes,
  sha256CanonicalJson,
} from "@vera/contracts";
import {
  PrivateLabelEuCountryCodeSchema,
  PrivateLabelRulePackSnapshotSchema,
  type PrivateLabelGovernanceRepository,
  type VeraStorageRepository,
} from "@vera/storage";
import Fastify from "fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { assertRole, createAuthService } from "./auth.js";
import type { AuthenticatedAccount, AuthService } from "./auth.js";
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
const PrivateLabelSourceCreateSchema = z
  .object({
    source: z
      .object({
        id: z.uuid().optional(),
        stableReference: z.url().max(500),
        title: z.string().trim().min(1).max(300),
        jurisdiction: z.string().trim().min(1).max(120),
      })
      .strict(),
    version: z
      .object({
        id: z.uuid().optional(),
        revision: z.int().min(1),
        contentHash: Sha256DigestSchema,
        contentObjectRef: z.string().trim().min(1).max(1_000),
      })
      .strict(),
  })
  .strict();
const PrivateLabelSourceTransitionSchema = z
  .object({
    expectedSequence: z.int().min(1),
    expectedState: z.enum(["UNVERIFIED", "VERIFIED", "APPROVED"]),
    toState: z.enum(["VERIFIED", "APPROVED", "RETIRED"]),
    reason: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();
const PrivateLabelRulePackCreateSchema = z
  .object({
    id: z.uuid().optional(),
    version: z.string().trim().min(1).max(120),
    sourceSnapshotHash: Sha256DigestSchema,
    snapshot: PrivateLabelRulePackSnapshotSchema,
  })
  .strict();
const PrivateLabelRulePackActivationSchema = z
  .object({
    action: z.enum(["ACTIVATED", "DEACTIVATED"]),
    countryCodes: z.array(PrivateLabelEuCountryCodeSchema).min(1).max(27),
    reason: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();

export interface CreateApiServerOptions {
  readonly repository: VeraStorageRepository;
  /** Optional because the technical-demo API can be embedded without Label governance. */
  readonly privateLabelGovernance?: PrivateLabelGovernanceRepository;
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

function labelGovernance(options: CreateApiServerOptions): PrivateLabelGovernanceRepository {
  if (options.privateLabelGovernance === undefined) {
    throw new ApiProblem(503, "Service Unavailable", "Private Label governance is not configured");
  }
  return options.privateLabelGovernance;
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

  // Food Consulting back-office. These routes keep source bodies private: callers
  // submit only the hash and opaque archive reference created by the private store.
  server.get("/v1/private-label/sources", async (request, reply) => {
    const account = await authenticated(request, auth, now);
    assertRole(account, ["ADMIN"]);
    return reply.send({ sourceVersions: await labelGovernance(options).listSourceVersions() });
  });

  server.post(
    "/v1/private-label/sources",
    {
      schema: {
        body: zodBody(PrivateLabelSourceCreateSchema),
        response: { 201: openObjectJsonSchema() },
      },
    },
    async (request, reply) => {
      const account = await authenticated(request, auth, now);
      assertRole(account, ["ADMIN"]);
      const body = PrivateLabelSourceCreateSchema.parse(request.body);
      const sourceVersion = await labelGovernance(options).createSourceVersion({
        source: {
          id: body.source.id ?? randomUUID(),
          stableReference: body.source.stableReference,
          title: body.source.title,
          jurisdiction: body.source.jurisdiction,
        },
        version: {
          id: body.version.id ?? randomUUID(),
          revision: body.version.revision,
          contentHash: body.version.contentHash,
          contentObjectRef: body.version.contentObjectRef,
        },
        actorId: account.id,
        actorRole: "ADMIN",
        createdAt: now(),
      });
      return reply.code(201).send({ sourceVersion });
    },
  );

  server.post(
    "/v1/private-label/source-versions/:id/transitions",
    {
      schema: {
        body: zodBody(PrivateLabelSourceTransitionSchema),
        response: { 201: openObjectJsonSchema() },
      },
    },
    async (request, reply) => {
      const account = await authenticated(request, auth, now);
      assertRole(account, ["ADMIN"]);
      const sourceVersionId = z.object({ id: z.uuid() }).parse(request.params).id;
      const body = PrivateLabelSourceTransitionSchema.parse(request.body);
      const transition = await labelGovernance(options).appendSourceTransition({
        sourceVersionId,
        expectedSequence: body.expectedSequence,
        expectedState: body.expectedState,
        toState: body.toState,
        actorId: account.id,
        actorRole: "ADMIN",
        ...(body.reason === undefined ? {} : { reason: body.reason }),
        createdAt: now(),
      });
      return reply.code(201).send({ transition });
    },
  );

  server.post(
    "/v1/private-label/rule-packs",
    {
      schema: {
        body: zodBody(PrivateLabelRulePackCreateSchema),
        response: { 201: openObjectJsonSchema() },
      },
    },
    async (request, reply) => {
      const account = await authenticated(request, auth, now);
      assertRole(account, ["ADMIN"]);
      const body = PrivateLabelRulePackCreateSchema.parse(request.body);
      const rulePack = await labelGovernance(options).saveRulePackSnapshot({
        id: body.id ?? randomUUID(),
        version: body.version,
        sourceSnapshotHash: body.sourceSnapshotHash,
        snapshot: body.snapshot,
        createdByActorId: account.id,
        createdAt: now(),
      });
      return reply.code(201).send({ rulePack });
    },
  );

  server.post(
    "/v1/private-label/rule-packs/:id/activations",
    {
      schema: {
        body: zodBody(PrivateLabelRulePackActivationSchema),
        response: { 201: openObjectJsonSchema() },
      },
    },
    async (request, reply) => {
      const account = await authenticated(request, auth, now);
      assertRole(account, ["ADMIN"]);
      const rulePackVersionId = z.object({ id: z.uuid() }).parse(request.params).id;
      const body = PrivateLabelRulePackActivationSchema.parse(request.body);
      const activation = await labelGovernance(options).appendRulePackActivation({
        rulePackVersionId,
        action: body.action,
        countryCodes: body.countryCodes,
        actorId: account.id,
        ...(body.reason === undefined ? {} : { reason: body.reason }),
        createdAt: now(),
      });
      return reply.code(201).send({ activation });
    },
  );

  return server;
}
