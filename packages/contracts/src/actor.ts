import { z } from "zod";

import { ActorRoleSchema, ValidationScopeSchema } from "./vocabulary.js";

export const ActorSchema = z
  .object({
    id: z.uuid(),
    displayName: z.string().trim().min(1).max(200),
    role: ActorRoleSchema,
    validationScope: ValidationScopeSchema,
  })
  .strict();

export type Actor = z.infer<typeof ActorSchema>;
