import {
  DSL_VERSION,
  RULE_PACK_SCHEMA_VERSION,
  RuleDefinitionSchema,
  RulePackDraftSchema,
  computeRuleDefinitionHash,
  computeRulePackDraftHash,
} from "@vera/contracts";
import type {
  Actor,
  RuleDefinition,
  RuleDefinitionHashInput,
  RulePackDraft,
  RulePackDraftHashInput,
} from "@vera/contracts";

import type {
  RulePackRuleEligibilityReader,
  RulePackRuleEligibilitySnapshot,
} from "../../src/rule-pack-repository.js";
import { ACTORS, IDS as SOURCE_IDS, makeSource, makeVersion } from "./compliance-source.js";
import { makeRuleCardRevision } from "./rule-card.js";

export const RULE_PACK_IDS = {
  pack: "00000000-0000-4000-8000-000000000601",
  foreignPack: "00000000-0000-4000-8000-000000000602",
  draft1: "00000000-0000-4000-8000-000000000611",
  draft2: "00000000-0000-4000-8000-000000000612",
  draft3: "00000000-0000-4000-8000-000000000613",
  version1: "00000000-0000-4000-8000-000000000621",
  version2: "00000000-0000-4000-8000-000000000622",
  version3: "00000000-0000-4000-8000-000000000623",
  rule1: "00000000-0000-4000-8000-000000000631",
  rule2: "00000000-0000-4000-8000-000000000632",
  rule3: "00000000-0000-4000-8000-000000000633",
  ruleException1: "00000000-0000-4000-8000-000000000641",
  ruleException2: "00000000-0000-4000-8000-000000000642",
  override1: "00000000-0000-4000-8000-000000000651",
  override2: "00000000-0000-4000-8000-000000000652",
  author2: "00000000-0000-4000-8000-000000000661",
} as const;

export const RULE_PACK_TIMES = {
  created: "2026-02-10T00:00:00.000Z",
  updated: "2026-02-10T01:00:00.000Z",
  published1: "2026-02-11T00:00:00.000Z",
  cloned: "2026-02-12T00:00:00.000Z",
  published2: "2026-02-13T00:00:00.000Z",
  packValidFrom: "2026-03-01T00:00:00.000Z",
  packValidTo: "2026-12-01T00:00:00.000Z",
  foreignValidFrom: "2027-01-01T00:00:00.000Z",
  foreignValidTo: "2027-02-01T00:00:00.000Z",
} as const;

function actor(id: string, role: Actor["role"]): Actor {
  return {
    id,
    displayName: `Synthetic Rule Pack ${role}`,
    role,
    validationScope: "TECHNICAL_DEMO",
  };
}

export const RULE_PACK_ACTORS = {
  author: ACTORS.author,
  otherAuthor: actor(RULE_PACK_IDS.author2, "AUTHOR"),
  publisher: ACTORS.approver,
  invalidPublisher: ACTORS.reviewer,
  selfPublisher: actor(SOURCE_IDS.author, "APPROVER"),
} as const;

export function makeRule(
  id: string = RULE_PACK_IDS.rule1,
  overrides: Partial<RuleDefinitionHashInput> = {},
): RuleDefinition {
  const revision = makeRuleCardRevision();
  const input: RuleDefinitionHashInput = {
    dslVersion: DSL_VERSION,
    state: "DRAFT",
    id,
    sourceId: revision.sourceId,
    sourceVersionId: revision.sourceVersionId,
    sourceContentHash: revision.sourceContentHash,
    ruleCardId: revision.cardId,
    ruleCardRevisionId: revision.id,
    ruleCardRevisionContentHash: revision.contentHash,
    normativeKey: revision.normativeKey,
    deonticCategory: revision.deonticCategory,
    riskLevel: "LOW",
    validity: revision.validity,
    appliesWhen: { op: "truth", value: "TRUE" },
    satisfiedWhen: { op: "present", factKey: "synthetic.marker" },
    exceptions: [
      {
        id:
          id === RULE_PACK_IDS.rule1 ? RULE_PACK_IDS.ruleException1 : RULE_PACK_IDS.ruleException2,
        key: "temporary.exclusion",
        when: { op: "truth", value: "FALSE" },
        reason: "A synthetic exclusion is represented explicitly",
        sourceVersionId: revision.sourceVersionId,
        sourceReference: "synthetic-section-1.3",
      },
    ],
    overrides: [],
    conflictsWith: [],
    evidenceBindings: [
      {
        factKey: "synthetic.marker",
        evidenceRequirementKeys: ["document.marker"],
      },
    ],
    unknownPolicy: "REVIEW",
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
  return RuleDefinitionSchema.parse({
    ...input,
    contentHash: computeRuleDefinitionHash(input),
  });
}

export function makeDraftHashInput(
  overrides: Partial<RulePackDraftHashInput> = {},
): RulePackDraftHashInput {
  return {
    schemaVersion: RULE_PACK_SCHEMA_VERSION,
    id: RULE_PACK_IDS.draft1,
    packId: RULE_PACK_IDS.pack,
    revision: 1,
    semver: "1.0.0",
    domain: "synthetic-quality",
    jurisdiction: "GLOBAL-DEMO",
    validity: {
      validFrom: RULE_PACK_TIMES.packValidFrom,
      validTo: RULE_PACK_TIMES.packValidTo,
    },
    rules: [makeRule()],
    changeReason: "Initial synthetic Rule Pack publication",
    supersedesVersionId: null,
    createdAt: RULE_PACK_TIMES.created,
    createdBy: SOURCE_IDS.author,
    updatedAt: RULE_PACK_TIMES.created,
    updatedBy: SOURCE_IDS.author,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

export function makeDraft(overrides: Partial<RulePackDraftHashInput> = {}): RulePackDraft {
  const input = makeDraftHashInput(overrides);
  return RulePackDraftSchema.parse({
    ...input,
    contentHash: computeRulePackDraftHash(input),
  });
}

export function makeEligibilitySnapshot(
  overrides: Partial<RulePackRuleEligibilitySnapshot> = {},
): RulePackRuleEligibilitySnapshot {
  return {
    source: makeSource(),
    sourceVersion: makeVersion(),
    ruleCardRevision: makeRuleCardRevision(),
    ...overrides,
  };
}

export interface SyntheticEligibilityReader {
  readonly reader: RulePackRuleEligibilityReader;
  readonly calls: readonly { readonly ruleId: string; readonly at: string }[];
  setSnapshot(snapshot: RulePackRuleEligibilitySnapshot): void;
  failWith(error: Error): void;
}

export function makeEligibilityReader(): SyntheticEligibilityReader {
  let snapshot = makeEligibilitySnapshot();
  let failure: Error | undefined;
  const calls: { ruleId: string; at: string }[] = [];
  return {
    reader: {
      assertRuleEligible(rule, publicationAt) {
        calls.push({ ruleId: rule.id, at: publicationAt });
        if (failure !== undefined) throw failure;
        return structuredClone(snapshot);
      },
    },
    calls,
    setSnapshot(next) {
      snapshot = structuredClone(next);
      failure = undefined;
    },
    failWith(error) {
      failure = error;
    },
  };
}
