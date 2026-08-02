import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.js";

export type VeraPrismaClient = PrismaClient;

export interface CreatePrismaClientOptions {
  readonly connectionString: string;
  /**
   * PostgreSQL schema used by the generated Prisma queries. Keeping VERA in a
   * dedicated schema lets it share a managed database with SILTO without
   * sharing either tables or Prisma's migration ledger.
   */
  readonly schema?: string;
  readonly logQueries?: boolean;
}

export function createPrismaClient(options: CreatePrismaClientOptions): VeraPrismaClient {
  const adapter = new PrismaPg(
    { connectionString: options.connectionString },
    options.schema === undefined ? undefined : { schema: options.schema },
  );
  return new PrismaClient({
    adapter,
    log: options.logQueries === true ? ["query", "warn", "error"] : ["warn", "error"],
  });
}
