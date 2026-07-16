import { computeRuleCardRevisionHash } from "@vera/contracts";
import type {
  Actor,
  ComplianceSource,
  ComplianceSourceState,
  ComplianceSourceVersion,
  RuleCard,
  RuleCardApprovalDecision,
  RuleCardComment,
  RuleCardReviewDecision,
  RuleCardRevision,
  RuleCardRevisionHashInput,
  RuleCardTransitionEvent,
} from "@vera/contracts";

import type { RuleCardSourceReader, RuleGenerationEligibilityRequest } from "../../src/index.js";
import {
  ACTORS as SOURCE_ACTORS,
  HASHES,
  IDS as SOURCE_IDS,
  TIMES as SOURCE_TIMES,
  makeSource,
  makeVersion,
} from "./compliance-source.js";

export const RULE_CARD_IDS = {
  card: "00000000-0000-4000-8000-000000000501",
  otherCard: "00000000-0000-4000-8000-000000000502",
  revision1: "00000000-0000-4000-8000-000000000511",
  revision2: "00000000-0000-4000-8000-000000000512",
  unknownRevision: "00000000-0000-4000-8000-000000000513",
  requirement: "00000000-0000-4000-8000-000000000521",
  exception: "00000000-0000-4000-8000-000000000522",
  thirdApprover: "00000000-0000-4000-8000-000000000531",
  otherAuthor: "00000000-0000-4000-8000-000000000532",
  audit1: "00000000-0000-4000-8000-000000000541",
  audit2: "00000000-0000-4000-8000-000000000542",
  audit3: "00000000-0000-4000-8000-000000000543",
  audit4: "00000000-0000-4000-8000-000000000544",
  audit5: "00000000-0000-4000-8000-000000000545",
  audit6: "00000000-0000-4000-8000-000000000546",
  audit7: "00000000-0000-4000-8000-000000000547",
} as const;

export const RULE_CARD_TIMES = {
  created: "2026-02-01T00:00:00.000Z",
  draft: "2026-02-01T00:01:00.000Z",
  comment: "2026-02-01T00:02:00.000Z",
  submitted: "2026-02-01T00:03:00.000Z",
  reviewed: "2026-02-01T00:04:00.000Z",
  firstApproval: "2026-02-01T00:05:00.000Z",
  secondApproval: "2026-02-01T00:06:00.000Z",
  retired: "2026-02-01T00:07:00.000Z",
  revision2Created: "2026-02-02T00:00:00.000Z",
  revision2Draft: "2026-02-02T00:01:00.000Z",
  beforeAudit: "2026-01-31T23:59:59.999Z",
  evaluation: "2026-06-30T00:00:00.000Z",
} as const;

export const RULE_CARD_HASHES = {
  otherRevision: "e".repeat(64),
  otherSource: "f".repeat(64),
} as const;

function actor(id: string, role: Actor["role"]): Actor {
  return {
    id,
    displayName: `Synthetic ${role}`,
    role,
    validationScope: "TECHNICAL_DEMO",
  };
}

export const RULE_CARD_ACTORS = {
  ...SOURCE_ACTORS,
  thirdApprover: actor(RULE_CARD_IDS.thirdApprover, "APPROVER"),
  otherAuthor: actor(RULE_CARD_IDS.otherAuthor, "AUTHOR"),
  selfReviewer: actor(SOURCE_IDS.author, "REVIEWER"),
  selfApprover: actor(SOURCE_IDS.author, "APPROVER"),
  reviewerAsApprover: actor(SOURCE_IDS.reviewer, "APPROVER"),
  reviewerAsAuthor: actor(SOURCE_IDS.reviewer, "AUTHOR"),
  invalid: {
    id: "invalid",
    displayName: "Invalid synthetic actor",
    role: "AUTHOR",
    validationScope: "TECHNICAL_DEMO",
  } as Actor,
} as const;

export function makeRuleCard(overrides: Partial<RuleCard> = {}): RuleCard {
  return {
    id: RULE_CARD_IDS.card,
    sourceId: SOURCE_IDS.sourceA,
    sourceVersionId: SOURCE_IDS.versionA1,
    sourceSection: "synthetic-section-1",
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

export function makeRuleCardRevisionHashInput(
  overrides: Partial<RuleCardRevisionHashInput> = {},
): RuleCardRevisionHashInput {
  return {
    id: RULE_CARD_IDS.revision1,
    cardId: RULE_CARD_IDS.card,
    revision: 1,
    sourceId: SOURCE_IDS.sourceA,
    sourceVersionId: SOURCE_IDS.versionA1,
    sourceContentHash: HASHES.a1,
    sourceSection: "synthetic-section-1",
    normativeActor: "Synthetic operator",
    object: "Synthetic operational record",
    scope: "Locally generated demonstration cases",
    normativeKey: "synthetic.record.marker",
    deonticCategory: "OBLIGATION",
    exceptions: [
      {
        id: RULE_CARD_IDS.exception,
        key: "temporary.exclusion",
        description: "A documented synthetic exclusion applies",
        rationale: "The source explicitly defines the exclusion",
        sourceReference: "synthetic-section-1.3",
      },
    ],
    evidenceRequirements: [
      {
        id: RULE_CARD_IDS.requirement,
        key: "document.marker",
        description: "A synthetic marker is visible",
        rationale: "The marker demonstrates evidence linkage",
        sourceReference: "synthetic-section-1.2",
      },
    ],
    riskLevel: "LOW",
    riskRationale: "The synthetic impact is local and reversible",
    falsePositiveCost: "LOW",
    falsePositiveCostRationale: "A false alert is locally reversible",
    falseNegativeCost: "LOW",
    falseNegativeCostRationale: "A missed synthetic marker has limited impact",
    provenance: "MANUAL",
    provider: null,
    validity: {
      validFrom: SOURCE_TIMES.validFrom,
      validTo: SOURCE_TIMES.validTo,
    },
    createdAt: RULE_CARD_TIMES.created,
    createdBy: SOURCE_IDS.author,
    replacesRevisionId: null,
    revisionReason: null,
    ...overrides,
  };
}

export function makeRuleCardRevision(
  overrides: Partial<RuleCardRevisionHashInput> = {},
  declaredContentHash?: string,
): RuleCardRevision {
  const input = makeRuleCardRevisionHashInput(overrides);
  return {
    ...input,
    contentHash: declaredContentHash ?? computeRuleCardRevisionHash(input),
  };
}

export function makeRuleCardTransition(
  revision: RuleCardRevision,
  overrides: Partial<RuleCardTransitionEvent> = {},
): RuleCardTransitionEvent {
  return {
    id: RULE_CARD_IDS.audit1,
    revisionId: revision.id,
    sequence: 1,
    from: null,
    to: "DRAFT",
    actorId: SOURCE_IDS.author,
    exercisedRole: "AUTHOR",
    at: RULE_CARD_TIMES.draft,
    revisionContentHash: revision.contentHash,
    reason: null,
    validationScope: "TECHNICAL_DEMO",
    ...overrides,
  };
}

export function makeRuleCardComment(
  revision: RuleCardRevision,
  overrides: Partial<RuleCardComment> = {},
): RuleCardComment {
  return {
    id: RULE_CARD_IDS.audit2,
    revisionId: revision.id,
    sequence: 2,
    actorId: SOURCE_IDS.author,
    exercisedRole: "AUTHOR",
    at: RULE_CARD_TIMES.comment,
    revisionContentHash: revision.contentHash,
    validationScope: "TECHNICAL_DEMO",
    body: "Synthetic audit comment",
    ...overrides,
  };
}

export function makeRuleCardReviewDecision(
  revision: RuleCardRevision,
  overrides: Partial<RuleCardReviewDecision> = {},
): RuleCardReviewDecision {
  return {
    id: RULE_CARD_IDS.audit4,
    revisionId: revision.id,
    sequence: 3,
    actorId: SOURCE_IDS.reviewer,
    at: RULE_CARD_TIMES.reviewed,
    revisionContentHash: revision.contentHash,
    validationScope: "TECHNICAL_DEMO",
    exercisedRole: "REVIEWER",
    decision: "ACCEPTED",
    rationale: "The synthetic source binding and interpretation are consistent",
    ...overrides,
  };
}

export function makeRuleCardApprovalDecision(
  revision: RuleCardRevision,
  overrides: Partial<RuleCardApprovalDecision> = {},
): RuleCardApprovalDecision {
  return {
    id: RULE_CARD_IDS.audit5,
    revisionId: revision.id,
    sequence: 4,
    actorId: SOURCE_IDS.approver,
    at: RULE_CARD_TIMES.firstApproval,
    revisionContentHash: revision.contentHash,
    validationScope: "TECHNICAL_DEMO",
    exercisedRole: "APPROVER",
    decision: "APPROVED",
    rationale: "The synthetic revision meets the technical demonstration gate",
    ...overrides,
  };
}

export function makeRuleGenerationRequest(
  revision: RuleCardRevision,
  overrides: Readonly<Record<string, unknown>> = {},
): RuleGenerationEligibilityRequest {
  return {
    revisionId: revision.id,
    generationAt: RULE_CARD_TIMES.evaluation,
    evaluationDate: RULE_CARD_TIMES.evaluation,
    expectedRevisionContentHash: revision.contentHash,
    expectedSourceContentHash: HASHES.a1,
    targetState: "DRAFT",
    ...overrides,
  };
}

export interface SourceReaderHarness {
  readonly reader: RuleCardSourceReader;
  setState(state: ComplianceSourceState | null): void;
  setSource(source: ComplianceSource): void;
  setVersion(version: ComplianceSourceVersion): void;
}

export function makeSourceReader(
  initialState: ComplianceSourceState | null = "APPROVED",
): SourceReaderHarness {
  let source = makeSource();
  let version = makeVersion();
  let state = initialState;

  return {
    reader: {
      getSource(sourceId) {
        if (sourceId !== source.id) throw new Error(`Unknown synthetic source: ${sourceId}`);
        return structuredClone(source);
      },
      getVersion(versionId) {
        if (versionId !== version.id) throw new Error(`Unknown synthetic version: ${versionId}`);
        return structuredClone(version);
      },
      getVersionState(versionId) {
        if (versionId !== version.id) throw new Error(`Unknown synthetic version: ${versionId}`);
        return state;
      },
      getVersionStateAt(versionId, at) {
        if (versionId !== version.id) throw new Error(`Unknown synthetic version: ${versionId}`);
        if (state === null || Date.parse(at) < Date.parse(SOURCE_TIMES.uploaded)) return null;
        if (state === "UPLOADED" || Date.parse(at) < Date.parse(SOURCE_TIMES.reviewed)) {
          return "UPLOADED";
        }
        if (state === "REVIEWED" || Date.parse(at) < Date.parse(SOURCE_TIMES.approved)) {
          return "REVIEWED";
        }
        if (state === "RETIRED" && Date.parse(at) >= Date.parse(RULE_CARD_TIMES.created)) {
          return "RETIRED";
        }
        return "APPROVED";
      },
    },
    setState(nextState) {
      state = nextState;
    },
    setSource(nextSource) {
      source = structuredClone(nextSource);
    },
    setVersion(nextVersion) {
      version = structuredClone(nextVersion);
    },
  };
}
