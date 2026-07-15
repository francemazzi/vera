import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";

import {
  readReviewQueue,
  resetReviewQueue,
  saveReviewDecision,
  simulateConcurrentChange,
} from "./review-store.js";
import type { DecisionType, ReviewItem, UserRole } from "./types.js";

const REVIEW_QUEUE_KEY = ["review-queue"] as const;

interface SaveDecisionInput {
  readonly itemId: string;
  readonly expectedVersion: number;
  readonly decisionType: DecisionType;
  readonly rationale: string;
  readonly role: UserRole;
}

export interface UseReviewQueueResult {
  readonly queue: UseQueryResult<readonly ReviewItem[]>;
  readonly saveDecision: UseMutationResult<readonly ReviewItem[], Error, SaveDecisionInput>;
  readonly conflict: UseMutationResult<readonly ReviewItem[], Error, string>;
  readonly reset: UseMutationResult<readonly ReviewItem[], Error, undefined>;
}

export function useReviewQueue(): UseReviewQueueResult {
  const queryClient = useQueryClient();
  const queue = useQuery({
    queryKey: REVIEW_QUEUE_KEY,
    queryFn: () => readReviewQueue(),
  });
  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: REVIEW_QUEUE_KEY });
  };
  const saveDecision = useMutation<readonly ReviewItem[], Error, SaveDecisionInput>({
    mutationFn: (input) =>
      Promise.resolve(
        saveReviewDecision({
          ...input,
          now: new Date().toISOString(),
        }),
      ),
    onSuccess: invalidate,
  });
  const conflict = useMutation<readonly ReviewItem[], Error, string>({
    mutationFn: (itemId: string) => Promise.resolve(simulateConcurrentChange(itemId)),
    onSuccess: invalidate,
  });
  const reset = useMutation<readonly ReviewItem[], Error, undefined>({
    mutationFn: () => Promise.resolve(resetReviewQueue()),
    onSuccess: invalidate,
  });

  return { queue, saveDecision, conflict, reset };
}
