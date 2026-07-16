import { DEMO_QUEUE } from "./seed.js";
import type { DecisionType, ReviewDecision, ReviewItem, UserRole } from "./types.js";

const STORAGE_KEY = "vera.reviewQueue.v1";

export class OptimisticConcurrencyError extends Error {
  public constructor() {
    super("La risorsa è stata modificata da un’altra sessione. Ricarica la coda.");
    this.name = "OptimisticConcurrencyError";
  }
}

function storage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function cloneQueue(queue: readonly ReviewItem[]): ReviewItem[] {
  return queue.map((item) => ({
    ...item,
    evidence: item.evidence.map((evidence) => ({ ...evidence })),
    trace: item.trace.map((step) => ({ ...step })),
    decision: item.decision === null ? null : { ...item.decision },
  }));
}

export function resetReviewQueue(): readonly ReviewItem[] {
  const queue = cloneQueue(DEMO_QUEUE);
  storage()?.setItem(STORAGE_KEY, JSON.stringify(queue));
  return queue;
}

export function readReviewQueue(): readonly ReviewItem[] {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (raw === null || raw === undefined) return resetReviewQueue();
  try {
    const parsed = JSON.parse(raw) as ReviewItem[];
    if (!Array.isArray(parsed)) return resetReviewQueue();
    return cloneQueue(parsed);
  } catch {
    return resetReviewQueue();
  }
}

function writeReviewQueue(queue: readonly ReviewItem[]): readonly ReviewItem[] {
  const cloned = cloneQueue(queue);
  storage()?.setItem(STORAGE_KEY, JSON.stringify(cloned));
  return cloned;
}

export function canRoleReview(role: UserRole): boolean {
  return role === "REVIEWER" || role === "APPROVER" || role === "ADMIN";
}

export function requiresCriticalRationale(item: ReviewItem, decisionType: DecisionType): boolean {
  return item.rule.riskLevel === "CRITICAL" && decisionType !== "CONFIRM";
}

export function canExport(queue: readonly ReviewItem[]): boolean {
  return queue.every((item) => item.status === "REVIEWED");
}

export function saveReviewDecision(input: {
  readonly itemId: string;
  readonly expectedVersion: number;
  readonly decisionType: DecisionType;
  readonly rationale: string;
  readonly role: UserRole;
  readonly now: string;
}): readonly ReviewItem[] {
  const queue = readReviewQueue();
  const index = queue.findIndex((item) => item.id === input.itemId);
  if (index < 0) throw new Error("Elemento di revisione non trovato.");

  const item = queue[index];
  if (item === undefined) throw new Error("Elemento di revisione non trovato.");
  if (item.version !== input.expectedVersion) throw new OptimisticConcurrencyError();
  if (!canRoleReview(input.role)) throw new Error("Il ruolo corrente non può decidere revisioni.");
  if (requiresCriticalRationale(item, input.decisionType) && input.rationale.trim().length === 0) {
    throw new Error("Motivazione obbligatoria per override critici.");
  }

  const decision: ReviewDecision = {
    type: input.decisionType,
    rationale: input.rationale.trim(),
    decidedByRole: input.role,
    decidedAt: input.now,
  };
  const next = [...queue];
  next[index] = {
    ...item,
    status: "REVIEWED",
    version: item.version + 1,
    decision,
  };
  return writeReviewQueue(next);
}

export function simulateConcurrentChange(itemId: string): readonly ReviewItem[] {
  const queue = readReviewQueue();
  const next = queue.map((item) =>
    item.id === itemId ? { ...item, version: item.version + 1 } : item,
  );
  return writeReviewQueue(next);
}
