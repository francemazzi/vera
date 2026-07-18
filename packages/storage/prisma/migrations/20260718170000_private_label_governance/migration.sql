CREATE TABLE "private_label_sources" (
  "id" UUID PRIMARY KEY,
  "stableReference" TEXT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  "createdByActorId" UUID NOT NULL
);

CREATE TABLE "private_label_source_versions" (
  "id" UUID PRIMARY KEY,
  "sourceId" UUID NOT NULL REFERENCES "private_label_sources"("id") ON DELETE RESTRICT,
  "revision" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL UNIQUE,
  "contentObjectRef" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  "createdByActorId" UUID NOT NULL,
  CONSTRAINT "private_label_source_versions_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "private_label_source_versions_hash_check" CHECK ("contentHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "private_label_source_versions_source_revision_key" UNIQUE ("sourceId", "revision")
);

CREATE INDEX "private_label_source_versions_sourceId_idx" ON "private_label_source_versions"("sourceId");

CREATE TABLE "private_label_source_transitions" (
  "id" UUID PRIMARY KEY,
  "sourceVersionId" UUID NOT NULL REFERENCES "private_label_source_versions"("id") ON DELETE RESTRICT,
  "sequence" INTEGER NOT NULL,
  "fromState" TEXT,
  "toState" TEXT NOT NULL,
  "actorId" UUID NOT NULL,
  "actorRole" TEXT NOT NULL,
  "reason" TEXT,
  "contentHash" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "private_label_source_transitions_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "private_label_source_transitions_state_check" CHECK ("toState" IN ('UNVERIFIED', 'VERIFIED', 'APPROVED', 'RETIRED')),
  CONSTRAINT "private_label_source_transitions_role_check" CHECK ("actorRole" IN ('SYNC_AGENT', 'AUTHOR', 'REVIEWER', 'APPROVER', 'ADMIN')),
  CONSTRAINT "private_label_source_transitions_version_sequence_key" UNIQUE ("sourceVersionId", "sequence")
);

CREATE INDEX "private_label_source_transitions_sourceVersionId_idx" ON "private_label_source_transitions"("sourceVersionId");

CREATE TABLE "private_label_rule_pack_versions" (
  "id" UUID PRIMARY KEY,
  "version" TEXT NOT NULL UNIQUE,
  "contentHash" TEXT NOT NULL UNIQUE,
  "sourceSnapshotHash" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  "createdByActorId" UUID NOT NULL,
  CONSTRAINT "private_label_rule_pack_versions_content_hash_check" CHECK ("contentHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "private_label_rule_pack_versions_source_snapshot_hash_check" CHECK ("sourceSnapshotHash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "private_label_rule_pack_activations" (
  "id" UUID PRIMARY KEY,
  "rulePackVersionId" UUID NOT NULL REFERENCES "private_label_rule_pack_versions"("id") ON DELETE RESTRICT,
  "sequence" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "countryCodes" TEXT[] NOT NULL,
  "actorId" UUID NOT NULL,
  "reason" TEXT,
  "previousEventHash" TEXT,
  "contentHash" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "private_label_rule_pack_activations_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "private_label_rule_pack_activations_action_check" CHECK ("action" IN ('ACTIVATED', 'DEACTIVATED')),
  CONSTRAINT "private_label_rule_pack_activations_content_hash_check" CHECK ("contentHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "private_label_rule_pack_activations_version_sequence_key" UNIQUE ("rulePackVersionId", "sequence")
);

CREATE INDEX "private_label_rule_pack_activations_rulePackVersionId_idx" ON "private_label_rule_pack_activations"("rulePackVersionId");

CREATE TABLE "private_label_evaluation_runs" (
  "id" UUID PRIMARY KEY,
  "externalAnalysisId" UUID NOT NULL,
  "inputSha256" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "rulePackVersionId" UUID NOT NULL REFERENCES "private_label_rule_pack_versions"("id") ON DELETE RESTRICT,
  "sourceSnapshotHash" TEXT NOT NULL,
  "controls" JSONB NOT NULL,
  "evidenceRefs" JSONB NOT NULL,
  "contentHash" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "private_label_evaluation_runs_input_hash_check" CHECK ("inputSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "private_label_evaluation_runs_source_snapshot_hash_check" CHECK ("sourceSnapshotHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "private_label_evaluation_runs_content_hash_check" CHECK ("contentHash" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "private_label_evaluation_runs_externalAnalysisId_idx" ON "private_label_evaluation_runs"("externalAnalysisId");
CREATE INDEX "private_label_evaluation_runs_rulePackVersionId_idx" ON "private_label_evaluation_runs"("rulePackVersionId");
