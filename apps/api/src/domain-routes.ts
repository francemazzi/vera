import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  ActorSchema,
  ActivationEventSchema,
  ComplianceSourceSchema,
  ComplianceSourceStateSchema,
  ComplianceSourceTransitionEventSchema,
  ComplianceSourceVersionSchema,
  RuleCardApprovalDecisionSchema,
  RuleCardCommentSchema,
  RuleCardReviewDecisionSchema,
  RuleCardRevisionSchema,
  RuleCardSchema,
  RuleCardTransitionEventSchema,
  RulePackDraftSchema,
  RulePackImpactReportSchema,
  RulePackResolutionRequestSchema,
  RuleTestRunResultSchema,
  SemVerSchema,
  UtcDateTimeSchema,
  sha256CanonicalJson,
} from "@vera/contracts";
import type { Actor, ActorRole, JsonValue } from "@vera/contracts";
import type {
  DurableComplianceSourceRepository,
  DurableRuleCardRepository,
  DurableRulePackActivationLedger,
  DurableRulePackRepository,
  DurableRuleTestRunRepository,
  VeraStorageRepository,
} from "@vera/storage";

import { assertRole } from "./auth.js";
import type { AuthService, AuthenticatedAccount } from "./auth.js";
import { ApiProblem } from "./errors.js";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const ValidationScope = "TECHNICAL_DEMO" as const;

const IdParamSchema = z.object({ id: z.uuid() }).strict();
const PackIdParamSchema = z.object({ packId: z.uuid() }).strict();
const SourceIdParamSchema = z.object({ id: z.uuid() }).strict();
const VersionIdParamSchema = z.object({ versionId: z.uuid() }).strict();
const RevisionIdParamSchema = z.object({ revisionId: z.uuid() }).strict();
const DraftIdParamSchema = z.object({ id: z.uuid() }).strict();

const TransitionExpectationSchema = z
  .object({ sequence: z.int().min(0), state: ComplianceSourceStateSchema.nullable() })
  .strict();
const ComplianceTransitionAuthorizationBodySchema = z
  .object({
    actor: ActorSchema.optional(),
    reason: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();
const ComplianceVersionAppendBodySchema = z
  .object({
    version: ComplianceSourceVersionSchema,
    expectedCurrentRevision: z.int().min(0),
  })
  .strict();
const ComplianceTransitionBodySchema = z
  .object({
    event: ComplianceSourceTransitionEventSchema,
    authorization: ComplianceTransitionAuthorizationBodySchema,
    expected: TransitionExpectationSchema,
  })
  .strict();

const RuleCardAuditExpectationSchema = z.object({ sequence: z.int().min(0) }).strict();
const RuleCardRevisionAppendBodySchema = z
  .object({
    revision: RuleCardRevisionSchema,
    creationEvent: RuleCardTransitionEventSchema,
    actor: ActorSchema,
    expectedCurrentRevision: z.int().min(0),
  })
  .strict();
const RuleCardCommentBodySchema = z
  .object({
    comment: RuleCardCommentSchema,
    actor: ActorSchema,
    expected: RuleCardAuditExpectationSchema,
  })
  .strict();
const RuleCardTransitionBodySchema = z
  .object({
    transition: RuleCardTransitionEventSchema,
    actor: ActorSchema,
    expected: RuleCardAuditExpectationSchema,
  })
  .strict();
const RuleCardReviewBodySchema = z
  .object({
    decision: RuleCardReviewDecisionSchema,
    actor: ActorSchema,
    expected: RuleCardAuditExpectationSchema,
  })
  .strict();
const RuleCardApprovalBodySchema = z
  .object({
    decision: RuleCardApprovalDecisionSchema,
    actor: ActorSchema,
    expected: RuleCardAuditExpectationSchema,
  })
  .strict();

const RulePackDraftReplaceBodySchema = z
  .object({ draft: RulePackDraftSchema, expectedRevision: z.int().min(1) })
  .strict();
const RulePackPublishBodySchema = z
  .object({
    draftId: z.uuid().optional(),
    versionId: z.uuid(),
    publishedAt: UtcDateTimeSchema,
    expectedDraftRevision: z.int().min(1),
  })
  .strict();
const RulePackCloneBodySchema = z
  .object({
    sourceVersionId: z.uuid().optional(),
    draftId: z.uuid(),
    semver: SemVerSchema,
    changeReason: z.string().trim().min(1).max(2_000),
    createdAt: UtcDateTimeSchema,
  })
  .strict();

const ActivationAppendExpectationSchema = z
  .object({
    sequence: z.int().min(0),
    previousEventHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .nullable(),
    activeVersionId: z.uuid().nullable(),
  })
  .strict();
const ActivationAppendBodySchema = z
  .object({
    event: ActivationEventSchema,
    command: z
      .object({
        actor: ActorSchema.optional(),
        expected: ActivationAppendExpectationSchema,
      })
      .strict(),
  })
  .strict();

export interface DomainRouteRepositories {
  readonly repository: VeraStorageRepository;
  readonly complianceSources: DurableComplianceSourceRepository | undefined;
  readonly ruleCards: DurableRuleCardRepository | undefined;
  readonly rulePacks: DurableRulePackRepository | undefined;
  readonly activations: DurableRulePackActivationLedger | undefined;
  readonly ruleTestRuns: DurableRuleTestRunRepository | undefined;
}

interface RegisterDomainRoutesOptions extends DomainRouteRepositories {
  readonly auth: AuthService;
  readonly now: () => string;
  readonly onComplianceSourceRetired?: (sourceVersionId: string) => Promise<void>;
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

function requireRepository<T>(repository: T | undefined, label: string): T {
  if (repository === undefined) {
    throw new ApiProblem(503, "Service Unavailable", `${label} repository is not configured`);
  }
  return repository;
}

function actorFor(account: AuthenticatedAccount): Actor {
  return {
    id: account.id,
    displayName: account.displayName,
    role: account.role,
    validationScope: ValidationScope,
  };
}

function assertActorMatchesAccount(actor: Actor, account: AuthenticatedAccount): void {
  if (
    actor.id !== account.id ||
    actor.role !== account.role ||
    actor.displayName !== account.displayName
  ) {
    throw new ApiProblem(403, "Forbidden", "Actor must match the authenticated account");
  }
}

function assertRecordActor(
  record: { readonly actorId: string; readonly exercisedRole: ActorRole },
  account: AuthenticatedAccount,
): void {
  if (record.actorId !== account.id || record.exercisedRole !== account.role) {
    throw new ApiProblem(
      403,
      "Forbidden",
      "Audit actor and exercised role must match the authenticated account",
    );
  }
}

function jsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

async function runIdempotently<T>(input: {
  readonly repository: VeraStorageRepository;
  readonly scope: string;
  readonly key: string;
  readonly request: unknown;
  readonly now: string;
  readonly mutate: () => Promise<T>;
  readonly replay: () => Promise<T>;
}): Promise<{ readonly value: T; readonly created: boolean }> {
  const result = await input.repository.getOrCreateIdempotency({
    scope: input.scope,
    key: input.key,
    requestHash: sha256CanonicalJson({ scope: input.scope, request: jsonValue(input.request) }),
    response: { ok: true },
    createdAt: input.now,
    expiresAt: new Date(Date.parse(input.now) + IDEMPOTENCY_TTL_MS).toISOString(),
  });
  if (!result.created) return { value: await input.replay(), created: false };
  return { value: await input.mutate(), created: true };
}

function codeForCreated(created: boolean): 200 | 201 {
  return created ? 201 : 200;
}

export function registerDomainRoutes(
  server: FastifyInstance,
  options: RegisterDomainRoutesOptions,
): void {
  server.post("/v1/compliance-sources", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    assertRole(account, ["AUTHOR", "ADMIN"]);
    const repository = requireRepository(options.complianceSources, "Compliance sources");
    const source = ComplianceSourceSchema.parse(request.body);
    const writtenAt = options.now();
    const result = await runIdempotently({
      repository: options.repository,
      scope: `accounts:${account.id}:compliance-sources`,
      key: idempotencyKey(request),
      request: source,
      now: writtenAt,
      mutate: () => repository.addSource(source),
      replay: () => repository.getSource(source.id),
    });
    return reply.code(codeForCreated(result.created)).send({ complianceSource: result.value });
  });

  server.post("/v1/compliance-sources/versions/:versionId/transitions", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    const repository = requireRepository(options.complianceSources, "Compliance sources");
    const versionId = VersionIdParamSchema.parse(request.params).versionId;
    const body = ComplianceTransitionBodySchema.parse(request.body);
    if (body.event.versionId !== versionId) {
      throw new ApiProblem(400, "Bad Request", "Transition versionId must match the route");
    }
    assertRole(account, [body.event.exercisedRole]);
    assertRecordActor(body.event, account);
    if (body.authorization.actor !== undefined) {
      assertActorMatchesAccount(body.authorization.actor, account);
    }
    const authorization =
      body.authorization.reason === undefined
        ? { actor: actorFor(account) }
        : { actor: actorFor(account), reason: body.authorization.reason };
    const writtenAt = options.now();
    const result = await runIdempotently({
      repository: options.repository,
      scope: `accounts:${account.id}:compliance-source-versions:${versionId}:transitions`,
      key: idempotencyKey(request),
      request: body,
      now: writtenAt,
      mutate: async () => {
        const transition = await repository.appendTransition(
          body.event,
          authorization,
          body.expected,
        );
        if (transition.to === "RETIRED" && options.onComplianceSourceRetired !== undefined) {
          await options.onComplianceSourceRetired(versionId);
        }
        return transition;
      },
      replay: () => Promise.resolve(body.event),
    });
    return reply
      .code(codeForCreated(result.created))
      .send({ complianceSourceTransition: result.value });
  });

  server.get("/v1/compliance-sources/versions/:versionId", async (request, reply) => {
    await authenticated(request, options.auth, options.now);
    const repository = requireRepository(options.complianceSources, "Compliance sources");
    const versionId = VersionIdParamSchema.parse(request.params).versionId;
    return reply.send({ complianceSourceVersion: await repository.getVersion(versionId) });
  });

  server.get("/v1/compliance-sources/versions/:versionId/transitions", async (request, reply) => {
    await authenticated(request, options.auth, options.now);
    const repository = requireRepository(options.complianceSources, "Compliance sources");
    const versionId = VersionIdParamSchema.parse(request.params).versionId;
    return reply.send({
      complianceSourceTransitions: await repository.getTransitionHistory(versionId),
    });
  });

  server.get("/v1/compliance-sources/:id", async (request, reply) => {
    await authenticated(request, options.auth, options.now);
    const repository = requireRepository(options.complianceSources, "Compliance sources");
    const id = SourceIdParamSchema.parse(request.params).id;
    return reply.send({ complianceSource: await repository.getSource(id) });
  });

  server.get("/v1/compliance-sources/:id/history", async (request, reply) => {
    await authenticated(request, options.auth, options.now);
    const repository = requireRepository(options.complianceSources, "Compliance sources");
    const id = SourceIdParamSchema.parse(request.params).id;
    return reply.send({ complianceSourceHistory: await repository.getSourceHistory(id) });
  });

  server.post("/v1/compliance-sources/:id/versions", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    assertRole(account, ["AUTHOR", "ADMIN"]);
    const repository = requireRepository(options.complianceSources, "Compliance sources");
    const sourceId = SourceIdParamSchema.parse(request.params).id;
    const body = ComplianceVersionAppendBodySchema.parse(request.body);
    if (body.version.sourceId !== sourceId) {
      throw new ApiProblem(400, "Bad Request", "ComplianceSourceVersion sourceId must match route");
    }
    const writtenAt = options.now();
    const result = await runIdempotently({
      repository: options.repository,
      scope: `accounts:${account.id}:compliance-sources:${sourceId}:versions`,
      key: idempotencyKey(request),
      request: body,
      now: writtenAt,
      mutate: () => repository.appendVersion(body.version, body.expectedCurrentRevision),
      replay: () => repository.getVersion(body.version.id),
    });
    return reply
      .code(codeForCreated(result.created))
      .send({ complianceSourceVersion: result.value });
  });

  server.post("/v1/rule-cards", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    assertRole(account, ["AUTHOR", "ADMIN"]);
    const repository = requireRepository(options.ruleCards, "Rule Cards");
    const card = RuleCardSchema.parse(request.body);
    const writtenAt = options.now();
    const result = await runIdempotently({
      repository: options.repository,
      scope: `accounts:${account.id}:rule-cards`,
      key: idempotencyKey(request),
      request: card,
      now: writtenAt,
      mutate: () => repository.addCard(card),
      replay: () => repository.getCard(card.id),
    });
    return reply.code(codeForCreated(result.created)).send({ ruleCard: result.value });
  });

  server.post("/v1/rule-cards/revisions/:revisionId/comments", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    const repository = requireRepository(options.ruleCards, "Rule Cards");
    const revisionId = RevisionIdParamSchema.parse(request.params).revisionId;
    const body = RuleCardCommentBodySchema.parse(request.body);
    if (body.comment.revisionId !== revisionId) {
      throw new ApiProblem(400, "Bad Request", "RuleCardComment revisionId must match route");
    }
    assertActorMatchesAccount(body.actor, account);
    assertRecordActor(body.comment, account);
    const writtenAt = options.now();
    const result = await runIdempotently({
      repository: options.repository,
      scope: `accounts:${account.id}:rule-card-revisions:${revisionId}:comments`,
      key: idempotencyKey(request),
      request: body,
      now: writtenAt,
      mutate: () => repository.appendComment(body.comment, actorFor(account), body.expected),
      replay: () => Promise.resolve(body.comment),
    });
    return reply.code(codeForCreated(result.created)).send({ ruleCardComment: result.value });
  });

  server.post("/v1/rule-cards/revisions/:revisionId/submit", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    assertRole(account, ["AUTHOR"]);
    const repository = requireRepository(options.ruleCards, "Rule Cards");
    const revisionId = RevisionIdParamSchema.parse(request.params).revisionId;
    const body = RuleCardTransitionBodySchema.parse(request.body);
    if (body.transition.revisionId !== revisionId) {
      throw new ApiProblem(400, "Bad Request", "RuleCard transition revisionId must match route");
    }
    assertActorMatchesAccount(body.actor, account);
    assertRecordActor(body.transition, account);
    const writtenAt = options.now();
    const result = await runIdempotently({
      repository: options.repository,
      scope: `accounts:${account.id}:rule-card-revisions:${revisionId}:submit`,
      key: idempotencyKey(request),
      request: body,
      now: writtenAt,
      mutate: () => repository.submitForReview(body.transition, actorFor(account), body.expected),
      replay: () => Promise.resolve(body.transition),
    });
    return reply.code(codeForCreated(result.created)).send({ ruleCardTransition: result.value });
  });

  server.post("/v1/rule-cards/revisions/:revisionId/reviews", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    assertRole(account, ["REVIEWER"]);
    const repository = requireRepository(options.ruleCards, "Rule Cards");
    const revisionId = RevisionIdParamSchema.parse(request.params).revisionId;
    const body = RuleCardReviewBodySchema.parse(request.body);
    if (body.decision.revisionId !== revisionId) {
      throw new ApiProblem(400, "Bad Request", "RuleCard review revisionId must match route");
    }
    assertActorMatchesAccount(body.actor, account);
    assertRecordActor(body.decision, account);
    const writtenAt = options.now();
    const result = await runIdempotently({
      repository: options.repository,
      scope: `accounts:${account.id}:rule-card-revisions:${revisionId}:reviews`,
      key: idempotencyKey(request),
      request: body,
      now: writtenAt,
      mutate: () => repository.recordReview(body.decision, actorFor(account), body.expected),
      replay: () => Promise.resolve(body.decision),
    });
    return reply.code(codeForCreated(result.created)).send({ ruleCardReview: result.value });
  });

  server.post("/v1/rule-cards/revisions/:revisionId/approvals", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    assertRole(account, ["APPROVER"]);
    const repository = requireRepository(options.ruleCards, "Rule Cards");
    const revisionId = RevisionIdParamSchema.parse(request.params).revisionId;
    const body = RuleCardApprovalBodySchema.parse(request.body);
    if (body.decision.revisionId !== revisionId) {
      throw new ApiProblem(400, "Bad Request", "RuleCard approval revisionId must match route");
    }
    assertActorMatchesAccount(body.actor, account);
    assertRecordActor(body.decision, account);
    const writtenAt = options.now();
    const result = await runIdempotently({
      repository: options.repository,
      scope: `accounts:${account.id}:rule-card-revisions:${revisionId}:approvals`,
      key: idempotencyKey(request),
      request: body,
      now: writtenAt,
      mutate: () => repository.recordApproval(body.decision, actorFor(account), body.expected),
      replay: () => Promise.resolve(body.decision),
    });
    return reply.code(codeForCreated(result.created)).send({ ruleCardApproval: result.value });
  });

  server.post("/v1/rule-cards/revisions/:revisionId/retire", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    assertRole(account, ["APPROVER", "ADMIN"]);
    const repository = requireRepository(options.ruleCards, "Rule Cards");
    const revisionId = RevisionIdParamSchema.parse(request.params).revisionId;
    const body = RuleCardTransitionBodySchema.parse(request.body);
    if (body.transition.revisionId !== revisionId) {
      throw new ApiProblem(400, "Bad Request", "RuleCard transition revisionId must match route");
    }
    assertActorMatchesAccount(body.actor, account);
    assertRecordActor(body.transition, account);
    const writtenAt = options.now();
    const result = await runIdempotently({
      repository: options.repository,
      scope: `accounts:${account.id}:rule-card-revisions:${revisionId}:retire`,
      key: idempotencyKey(request),
      request: body,
      now: writtenAt,
      mutate: () => repository.retireRevision(body.transition, actorFor(account), body.expected),
      replay: () => Promise.resolve(body.transition),
    });
    return reply.code(codeForCreated(result.created)).send({ ruleCardTransition: result.value });
  });

  server.get("/v1/rule-cards/:id", async (request, reply) => {
    await authenticated(request, options.auth, options.now);
    const repository = requireRepository(options.ruleCards, "Rule Cards");
    const id = IdParamSchema.parse(request.params).id;
    return reply.send({ ruleCard: await repository.getCard(id) });
  });

  server.get("/v1/rule-cards/:id/history", async (request, reply) => {
    await authenticated(request, options.auth, options.now);
    const repository = requireRepository(options.ruleCards, "Rule Cards");
    const id = IdParamSchema.parse(request.params).id;
    return reply.send({ ruleCardHistory: await repository.getHistory(id) });
  });

  server.post("/v1/rule-cards/:id/revisions", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    assertRole(account, ["AUTHOR", "ADMIN"]);
    const repository = requireRepository(options.ruleCards, "Rule Cards");
    const cardId = IdParamSchema.parse(request.params).id;
    const body = RuleCardRevisionAppendBodySchema.parse(request.body);
    if (body.revision.cardId !== cardId) {
      throw new ApiProblem(400, "Bad Request", "RuleCardRevision cardId must match route");
    }
    assertActorMatchesAccount(body.actor, account);
    assertRecordActor(body.creationEvent, account);
    const writtenAt = options.now();
    const result = await runIdempotently({
      repository: options.repository,
      scope: `accounts:${account.id}:rule-cards:${cardId}:revisions`,
      key: idempotencyKey(request),
      request: body,
      now: writtenAt,
      mutate: () =>
        repository.appendRevision(
          body.revision,
          body.creationEvent,
          actorFor(account),
          body.expectedCurrentRevision,
        ),
      replay: () => repository.getRevision(body.revision.id),
    });
    return reply.code(codeForCreated(result.created)).send({ ruleCardRevision: result.value });
  });

  server.post("/v1/rule-packs/drafts", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    assertRole(account, ["AUTHOR", "ADMIN"]);
    const repository = requireRepository(options.rulePacks, "Rule Packs");
    const draft = RulePackDraftSchema.parse(request.body);
    const writtenAt = options.now();
    const result = await runIdempotently({
      repository: options.repository,
      scope: `accounts:${account.id}:rule-pack-drafts`,
      key: idempotencyKey(request),
      request: draft,
      now: writtenAt,
      mutate: () => repository.addDraft(draft, actorFor(account)),
      replay: () => repository.getDraft(draft.id),
    });
    return reply.code(codeForCreated(result.created)).send({ rulePackDraft: result.value });
  });

  server.get("/v1/rule-packs/drafts/:id", async (request, reply) => {
    await authenticated(request, options.auth, options.now);
    const repository = requireRepository(options.rulePacks, "Rule Packs");
    const id = DraftIdParamSchema.parse(request.params).id;
    return reply.send({ rulePackDraft: await repository.getDraft(id) });
  });

  server.put("/v1/rule-packs/drafts/:id", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    assertRole(account, ["AUTHOR", "ADMIN"]);
    const repository = requireRepository(options.rulePacks, "Rule Packs");
    const id = DraftIdParamSchema.parse(request.params).id;
    const body = RulePackDraftReplaceBodySchema.parse(request.body);
    if (body.draft.id !== id) {
      throw new ApiProblem(400, "Bad Request", "RulePackDraft id must match route");
    }
    return reply.send({
      rulePackDraft: await repository.replaceDraft(
        body.draft,
        body.expectedRevision,
        actorFor(account),
      ),
    });
  });

  server.post("/v1/rule-packs/drafts/:id/publish", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    assertRole(account, ["APPROVER", "ADMIN"]);
    const repository = requireRepository(options.rulePacks, "Rule Packs");
    const draftId = DraftIdParamSchema.parse(request.params).id;
    const body = RulePackPublishBodySchema.parse(request.body);
    if (body.draftId !== undefined && body.draftId !== draftId) {
      throw new ApiProblem(400, "Bad Request", "Publish request draftId must match route");
    }
    const publishRequest = {
      draftId,
      versionId: body.versionId,
      publishedAt: body.publishedAt,
      expectedDraftRevision: body.expectedDraftRevision,
    };
    const writtenAt = options.now();
    const result = await runIdempotently({
      repository: options.repository,
      scope: `accounts:${account.id}:rule-pack-drafts:${draftId}:publish`,
      key: idempotencyKey(request),
      request: publishRequest,
      now: writtenAt,
      mutate: () => repository.publishDraft(publishRequest, actorFor(account)),
      replay: () => repository.getVersion(body.versionId),
    });
    return reply.code(codeForCreated(result.created)).send({ rulePackVersion: result.value });
  });

  server.post("/v1/rule-packs/versions/:id/clone", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    assertRole(account, ["AUTHOR", "ADMIN"]);
    const repository = requireRepository(options.rulePacks, "Rule Packs");
    const sourceVersionId = IdParamSchema.parse(request.params).id;
    const body = RulePackCloneBodySchema.parse(request.body);
    if (body.sourceVersionId !== undefined && body.sourceVersionId !== sourceVersionId) {
      throw new ApiProblem(400, "Bad Request", "Clone request sourceVersionId must match route");
    }
    const cloneRequest = {
      sourceVersionId,
      draftId: body.draftId,
      semver: body.semver,
      changeReason: body.changeReason,
      createdAt: body.createdAt,
    };
    const writtenAt = options.now();
    const result = await runIdempotently({
      repository: options.repository,
      scope: `accounts:${account.id}:rule-pack-versions:${sourceVersionId}:clone`,
      key: idempotencyKey(request),
      request: cloneRequest,
      now: writtenAt,
      mutate: () => repository.cloneVersion(cloneRequest, actorFor(account)),
      replay: () => repository.getDraft(body.draftId),
    });
    return reply.code(codeForCreated(result.created)).send({ rulePackDraft: result.value });
  });

  server.get("/v1/rule-packs/versions/:id", async (request, reply) => {
    await authenticated(request, options.auth, options.now);
    const repository = requireRepository(options.rulePacks, "Rule Packs");
    const id = IdParamSchema.parse(request.params).id;
    return reply.send({ rulePackVersion: await repository.getVersion(id) });
  });

  server.get("/v1/rule-packs/:packId/versions", async (request, reply) => {
    await authenticated(request, options.auth, options.now);
    const repository = requireRepository(options.rulePacks, "Rule Packs");
    const packId = PackIdParamSchema.parse(request.params).packId;
    return reply.send({ rulePackVersions: await repository.getVersions(packId) });
  });

  server.post("/v1/rule-packs/:packId/activations", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    assertRole(account, ["APPROVER", "ADMIN"]);
    const repository = requireRepository(options.activations, "Rule Pack activations");
    const packId = PackIdParamSchema.parse(request.params).packId;
    const body = ActivationAppendBodySchema.parse(request.body);
    if (body.event.packId !== packId) {
      throw new ApiProblem(400, "Bad Request", "Activation event packId must match route");
    }
    if (body.command.actor !== undefined) {
      assertActorMatchesAccount(body.command.actor, account);
    }
    assertRecordActor(body.event, account);
    const command = { actor: actorFor(account), expected: body.command.expected };
    const writtenAt = options.now();
    const result = await runIdempotently({
      repository: options.repository,
      scope: `accounts:${account.id}:rule-packs:${packId}:activations`,
      key: idempotencyKey(request),
      request: body,
      now: writtenAt,
      mutate: () => repository.appendEvent(body.event, command),
      replay: () => Promise.resolve(body.event),
    });
    return reply.code(codeForCreated(result.created)).send({ activationEvent: result.value });
  });

  server.get("/v1/rule-packs/:packId/activations", async (request, reply) => {
    await authenticated(request, options.auth, options.now);
    const repository = requireRepository(options.activations, "Rule Pack activations");
    const packId = PackIdParamSchema.parse(request.params).packId;
    return reply.send({ activationEvents: await repository.getHistory(packId) });
  });

  server.post("/v1/rule-packs/resolve", async (request, reply) => {
    await authenticated(request, options.auth, options.now);
    const repository = requireRepository(options.activations, "Rule Pack activations");
    const body = RulePackResolutionRequestSchema.parse(request.body);
    return reply.send({ resolvedRulePack: await repository.resolve(body) });
  });

  server.post("/v1/rule-test-runs", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    assertRole(account, ["AUTHOR", "ADMIN"]);
    const repository = requireRepository(options.ruleTestRuns, "Rule test runs");
    const result = RuleTestRunResultSchema.parse(request.body);
    return reply.code(201).send({ ruleTestRun: await repository.saveTestRun(result) });
  });

  server.get("/v1/rule-test-runs/:id", async (request, reply) => {
    await authenticated(request, options.auth, options.now);
    const repository = requireRepository(options.ruleTestRuns, "Rule test runs");
    const id = IdParamSchema.parse(request.params).id;
    return reply.send({ ruleTestRun: await repository.getTestRun(id) });
  });

  server.post("/v1/rule-pack-impact-reports", async (request, reply) => {
    const account = await authenticated(request, options.auth, options.now);
    assertRole(account, ["AUTHOR", "ADMIN"]);
    const repository = requireRepository(options.ruleTestRuns, "Rule test runs");
    const report = RulePackImpactReportSchema.parse(request.body);
    return reply
      .code(201)
      .send({ rulePackImpactReport: await repository.saveImpactReport(report) });
  });

  server.get("/v1/rule-pack-impact-reports/:id", async (request, reply) => {
    await authenticated(request, options.auth, options.now);
    const repository = requireRepository(options.ruleTestRuns, "Rule test runs");
    const id = IdParamSchema.parse(request.params).id;
    return reply.send({ rulePackImpactReport: await repository.getImpactReport(id) });
  });
}
