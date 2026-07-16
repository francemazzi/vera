import { z } from "zod";

import { snapshotJsonValue } from "./json-snapshot.js";
import { ActorRoleSchema, ValidationScopeSchema } from "./vocabulary.js";

/** UUID actor identities have one canonical representation at every trust boundary. */
export const ActorIdSchema = z.uuid().overwrite((value) => value.toLowerCase());

export const ActorSchema = z
  .object({
    id: ActorIdSchema,
    displayName: z.string().trim().min(1).max(200),
    role: ActorRoleSchema,
    validationScope: ValidationScopeSchema,
  })
  .strict();

export type Actor = z.infer<typeof ActorSchema>;

/**
 * Parses an actor from a detached, descriptor-only JSON snapshot. Proxies and accessors are
 * rejected before user-controlled code can influence an authorization decision.
 */
export function parseActorSnapshot(input: unknown): Actor | null {
  const snapshot = snapshotJsonValue(input, {
    maxDepth: 1,
    maxNodes: 5,
    maxCanonicalBytes: 1_024,
    rejectNegativeZero: true,
    rejectUnsafeIntegers: true,
  });
  if (!snapshot.success) return null;
  const parsed = ActorSchema.safeParse(snapshot.value);
  return parsed.success ? parsed.data : null;
}
