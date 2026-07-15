CREATE TABLE "local_accounts" (
  "id" UUID PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "displayName" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "disabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "local_accounts_role_check" CHECK ("role" IN ('AUTHOR', 'REVIEWER', 'APPROVER', 'ADMIN'))
);

CREATE TABLE "sessions" (
  "id" UUID PRIMARY KEY,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "accountId" UUID NOT NULL REFERENCES "local_accounts"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "revokedAt" TIMESTAMPTZ(6)
);

CREATE INDEX "sessions_accountId_idx" ON "sessions"("accountId");
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

CREATE TABLE "evaluation_runs" (
  "id" UUID PRIMARY KEY,
  "contentHash" TEXT NOT NULL UNIQUE,
  "aggregateOutcome" TEXT NOT NULL,
  "validationScope" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "evaluation_runs_outcome_check" CHECK (
    "aggregateOutcome" IN ('PASS', 'FAIL', 'REVIEW', 'NOT_APPLICABLE')
  ),
  CONSTRAINT "evaluation_runs_scope_check" CHECK ("validationScope" = 'TECHNICAL_DEMO')
);

CREATE TABLE "review_decisions" (
  "id" UUID PRIMARY KEY,
  "runId" UUID NOT NULL REFERENCES "evaluation_runs"("id") ON DELETE CASCADE,
  "sequence" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL UNIQUE,
  "previousEventHash" TEXT,
  "actorId" UUID NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "review_decisions_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "review_decisions_run_sequence_key" UNIQUE ("runId", "sequence")
);

CREATE INDEX "review_decisions_runId_idx" ON "review_decisions"("runId");

CREATE TABLE "blob_objects" (
  "sha256" TEXT PRIMARY KEY,
  "byteLength" INTEGER NOT NULL,
  "mediaType" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "blob_objects_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "blob_objects_byte_length_check" CHECK ("byteLength" >= 0)
);

CREATE TABLE "idempotency_records" (
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "responseHash" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("scope", "key")
);

CREATE INDEX "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");
