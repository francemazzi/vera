import {
  DSL_VERSION,
  RULE_PACK_SCHEMA_VERSION,
  RuleDefinitionHashInputSchema,
  RuleDefinitionSchema,
  RulePackVersionHashInputSchema,
  RulePackVersionSchema,
  computeRuleDefinitionHash,
  computeRulePackVersionHash,
} from "@vera/contracts";

export const EVALUATION_DATE = "2026-07-15T12:00:00.0001Z";

const RULE_ID = "00000000-0000-4000-8000-000000000001";

const ruleHashInput = RuleDefinitionHashInputSchema.parse({
  dslVersion: DSL_VERSION,
  state: "DRAFT",
  id: RULE_ID,
  sourceId: "00000000-0000-4000-8000-000000000002",
  sourceVersionId: "00000000-0000-4000-8000-000000000003",
  sourceContentHash: "a".repeat(64),
  ruleCardId: "00000000-0000-4000-8000-000000000004",
  ruleCardRevisionId: "00000000-0000-4000-8000-000000000005",
  ruleCardRevisionContentHash: "b".repeat(64),
  normativeKey: "synthetic.document.approval",
  deonticCategory: "OBLIGATION",
  riskLevel: "LOW",
  validity: {
    validFrom: "2026-01-01T00:00:00.0001Z",
    validTo: "2027-01-01T00:00:00.0001Z",
  },
  appliesWhen: { op: "truth", value: "TRUE" },
  satisfiedWhen: { op: "present", factKey: "synthetic.approval" },
  exceptions: [],
  overrides: [],
  conflictsWith: [],
  evidenceBindings: [
    {
      factKey: "synthetic.approval",
      evidenceRequirementKeys: ["synthetic.document"],
    },
  ],
  unknownPolicy: "REVIEW",
  validationScope: "TECHNICAL_DEMO",
});

const rule = RuleDefinitionSchema.parse({
  ...ruleHashInput,
  contentHash: computeRuleDefinitionHash(ruleHashInput),
});

const versionHashInput = RulePackVersionHashInputSchema.parse({
  schemaVersion: RULE_PACK_SCHEMA_VERSION,
  id: "00000000-0000-4000-8000-000000000006",
  packId: "00000000-0000-4000-8000-000000000007",
  semver: "1.0.0",
  domain: "synthetic-quality",
  jurisdiction: "GLOBAL-DEMO",
  validity: {
    validFrom: "2026-02-01T00:00:00.0001Z",
    validTo: "2026-12-01T00:00:00.0001Z",
  },
  rules: [rule],
  changeReason: "Esempio sintetico per l'integrazione npm",
  supersedesVersionId: null,
  createdAt: "2026-01-10T00:00:00.0001Z",
  createdBy: "00000000-0000-4000-8000-000000000008",
  publishedAt: "2026-01-20T00:00:00.0001Z",
  publishedBy: "00000000-0000-4000-8000-000000000009",
  validationScope: "TECHNICAL_DEMO",
});

const version = RulePackVersionSchema.parse({
  ...versionHashInput,
  contentHash: computeRulePackVersionHash(versionHashInput),
});

export const SYNTHETIC_RULE_PACK_JSON = JSON.stringify(version);

export const EXPECTED_SUMMARY = {
  aggregateOutcome: "REVIEW",
  findings: [{ ruleId: RULE_ID, outcome: "REVIEW" }],
} as const;
