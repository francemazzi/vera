import { z } from "zod";

const GovernanceActorSchema = z
  .object({
    actorId: z.uuid(),
    actorRole: z.literal("ADMIN"),
    workspaceId: z.uuid(),
  })
  .strict();

export type GovernanceActorContext = z.infer<typeof GovernanceActorSchema>;

export class GovernanceActorError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GovernanceActorError";
  }
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * These headers are accepted only after BackendOidcAuthorizer has proven the
 * caller is the SILTO backend. The backend is responsible for membership and
 * workspace authorization; this service enforces the ADMIN-only operation.
 */
export function governanceActorFromHeaders(headers: {
  readonly [key: string]: string | string[] | undefined;
}): GovernanceActorContext {
  const parsed = GovernanceActorSchema.safeParse({
    actorId: singleHeader(headers["x-silto-actor-id"]),
    actorRole: singleHeader(headers["x-silto-actor-role"]),
    workspaceId: singleHeader(headers["x-silto-workspace-id"]),
  });
  if (!parsed.success)
    throw new GovernanceActorError("Missing or invalid governance actor context");
  return parsed.data;
}
