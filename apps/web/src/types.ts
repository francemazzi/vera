export type UserRole = "AUTHOR" | "REVIEWER" | "APPROVER" | "ADMIN";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ReviewStatus = "PENDING" | "REVIEWED";

export type DecisionType = "CONFIRM" | "CORRECT" | "NOT_APPLICABLE" | "DEEPEN";

export interface EvidenceBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface EvidenceItem {
  readonly id: string;
  readonly page: number;
  readonly text: string;
  readonly language: "it" | "en";
  readonly boundingBox: EvidenceBox;
}

export interface TraceStep {
  readonly id: string;
  readonly label: string;
  readonly value: "TRUE" | "FALSE" | "UNKNOWN";
  readonly explanation: string;
}

export interface ReviewDecision {
  readonly type: DecisionType;
  readonly rationale: string;
  readonly decidedByRole: UserRole;
  readonly decidedAt: string;
}

export interface ReviewItem {
  readonly id: string;
  readonly caseId: string;
  readonly documentTitle: string;
  readonly documentKind: "PDF" | "IMAGE" | "JSON" | "MANUAL";
  readonly pageText: string;
  readonly evidence: readonly EvidenceItem[];
  readonly rule: {
    readonly id: string;
    readonly title: string;
    readonly sourceSection: string;
    readonly riskLevel: RiskLevel;
    readonly validationScope: "TECHNICAL_DEMO";
    readonly provenance: "MANUAL" | "AI_ASSISTED";
  };
  readonly trace: readonly TraceStep[];
  readonly status: ReviewStatus;
  readonly version: number;
  readonly decision: ReviewDecision | null;
  readonly exportBlockedReason: string;
}
