-- Phase 14 public durable domain aggregates (TECHNICAL_DEMO).

CREATE TABLE "compliance_sources" (
  "id" UUID PRIMARY KEY,
  "type" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "stableReference" TEXT NOT NULL,
  "validationScope" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "compliance_sources_scope_check" CHECK ("validationScope" = 'TECHNICAL_DEMO')
);

CREATE INDEX "compliance_sources_domain_jurisdiction_idx"
  ON "compliance_sources"("domain", "jurisdiction");

CREATE TABLE "compliance_source_versions" (
  "id" UUID PRIMARY KEY,
  "sourceId" UUID NOT NULL REFERENCES "compliance_sources"("id") ON DELETE RESTRICT,
  "revision" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL UNIQUE,
  "replacesVersionId" UUID,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "compliance_source_versions_sourceId_revision_key" UNIQUE ("sourceId", "revision")
);

CREATE INDEX "compliance_source_versions_sourceId_idx"
  ON "compliance_source_versions"("sourceId");

CREATE TABLE "compliance_source_transitions" (
  "id" UUID PRIMARY KEY,
  "versionId" UUID NOT NULL REFERENCES "compliance_source_versions"("id") ON DELETE RESTRICT,
  "sequence" INTEGER NOT NULL,
  "fromState" TEXT,
  "toState" TEXT NOT NULL,
  "actorId" UUID NOT NULL,
  "contentHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "compliance_source_transitions_versionId_sequence_key" UNIQUE ("versionId", "sequence")
);

CREATE INDEX "compliance_source_transitions_versionId_idx"
  ON "compliance_source_transitions"("versionId");

CREATE TABLE "rule_cards" (
  "id" UUID PRIMARY KEY,
  "sourceId" UUID NOT NULL,
  "sourceVersionId" UUID NOT NULL,
  "sourceSection" TEXT NOT NULL,
  "validationScope" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "rule_cards_scope_check" CHECK ("validationScope" = 'TECHNICAL_DEMO')
);

CREATE INDEX "rule_cards_sourceId_sourceVersionId_idx"
  ON "rule_cards"("sourceId", "sourceVersionId");

CREATE TABLE "rule_card_revisions" (
  "id" UUID PRIMARY KEY,
  "cardId" UUID NOT NULL REFERENCES "rule_cards"("id") ON DELETE RESTRICT,
  "revision" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL UNIQUE,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "rule_card_revisions_cardId_revision_key" UNIQUE ("cardId", "revision")
);

CREATE INDEX "rule_card_revisions_cardId_idx" ON "rule_card_revisions"("cardId");

CREATE TABLE "rule_card_audit" (
  "id" UUID PRIMARY KEY,
  "revisionId" UUID NOT NULL REFERENCES "rule_card_revisions"("id") ON DELETE RESTRICT,
  "sequence" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "actorId" UUID NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "rule_card_audit_revisionId_sequence_key" UNIQUE ("revisionId", "sequence"),
  CONSTRAINT "rule_card_audit_kind_check" CHECK (
    "kind" IN ('TRANSITION', 'COMMENT', 'REVIEW', 'APPROVAL')
  )
);

CREATE INDEX "rule_card_audit_revisionId_idx" ON "rule_card_audit"("revisionId");

CREATE TABLE "rule_pack_drafts" (
  "id" UUID PRIMARY KEY,
  "packId" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX "rule_pack_drafts_packId_idx" ON "rule_pack_drafts"("packId");

CREATE TABLE "rule_pack_draft_contributors" (
  "draftId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  CONSTRAINT "rule_pack_draft_contributors_pkey" PRIMARY KEY ("draftId", "actorId")
);

CREATE INDEX "rule_pack_draft_contributors_draftId_idx"
  ON "rule_pack_draft_contributors"("draftId");

CREATE TABLE "rule_pack_versions" (
  "id" UUID PRIMARY KEY,
  "packId" UUID NOT NULL,
  "semver" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL UNIQUE,
  "payload" JSONB NOT NULL,
  "publishedAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "rule_pack_versions_packId_semver_key" UNIQUE ("packId", "semver")
);

CREATE INDEX "rule_pack_versions_packId_idx" ON "rule_pack_versions"("packId");

CREATE TABLE "rule_pack_version_excluded_activators" (
  "versionId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  CONSTRAINT "rule_pack_version_excluded_activators_pkey" PRIMARY KEY ("versionId", "actorId")
);

CREATE INDEX "rule_pack_version_excluded_activators_versionId_idx"
  ON "rule_pack_version_excluded_activators"("versionId");

CREATE TABLE "rule_pack_draft_publications" (
  "draftId" UUID PRIMARY KEY,
  "publishedVersionId" UUID NOT NULL UNIQUE
);

CREATE TABLE "activation_events" (
  "id" UUID PRIMARY KEY,
  "packId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "versionId" UUID NOT NULL,
  "contentHash" TEXT NOT NULL UNIQUE,
  "previousEventHash" TEXT,
  "payload" JSONB NOT NULL,
  "recordedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "activation_events_packId_sequence_key" UNIQUE ("packId", "sequence")
);

CREATE INDEX "activation_events_packId_idx" ON "activation_events"("packId");

CREATE TABLE "rule_test_runs" (
  "id" UUID PRIMARY KEY,
  "requestId" TEXT NOT NULL UNIQUE,
  "rulePackVersionId" UUID NOT NULL,
  "rulePackVersionContentHash" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL UNIQUE,
  "passed" BOOLEAN NOT NULL,
  "validationScope" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "rule_test_runs_scope_check" CHECK ("validationScope" = 'TECHNICAL_DEMO')
);

CREATE INDEX "rule_test_runs_rulePackVersionId_idx" ON "rule_test_runs"("rulePackVersionId");

CREATE TABLE "rule_pack_impact_reports" (
  "id" UUID PRIMARY KEY,
  "contentHash" TEXT NOT NULL UNIQUE,
  "validationScope" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "rule_pack_impact_reports_scope_check" CHECK ("validationScope" = 'TECHNICAL_DEMO')
);
