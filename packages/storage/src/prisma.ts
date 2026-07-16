import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.js";

export type VeraPrismaClient = PrismaClient;

export interface CreatePrismaClientOptions {
  readonly connectionString: string;
  readonly logQueries?: boolean;
}

export function createPrismaClient(options: CreatePrismaClientOptions): VeraPrismaClient {
  const adapter = new PrismaPg({ connectionString: options.connectionString });
  return new PrismaClient({
    adapter,
    log: options.logQueries === true ? ["query", "warn", "error"] : ["warn", "error"],
  });
}
