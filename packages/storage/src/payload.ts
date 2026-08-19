import type { z } from "zod";

import type { Prisma } from "./generated/prisma/client.js";

export function toInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export function parsePayload<Schema extends z.ZodType>(
  schema: Schema,
  payload: unknown,
): z.infer<Schema> {
  return schema.parse(payload);
}
