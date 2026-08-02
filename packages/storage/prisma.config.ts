import { defineConfig } from "prisma/config";

function schemaQualifiedDatabaseUrl(connectionString: string, schema: string | undefined): string {
  const normalizedSchema = schema?.trim();
  if (!normalizedSchema) return connectionString;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(normalizedSchema)) {
    throw new Error("VERA_DATABASE_SCHEMA must be a PostgreSQL identifier");
  }

  // Prisma Migrate uses the `schema` URL query parameter both for SQL object
  // resolution and for its `_prisma_migrations` table. This keeps the VERA
  // history independent when it shares a PostgreSQL database with SILTO.
  const url = new URL(connectionString);
  url.searchParams.set("schema", normalizedSchema);
  return url.toString();
}

const connectionString =
  process.env["VERA_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgresql://vera:local-only@127.0.0.1:5432/vera";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: schemaQualifiedDatabaseUrl(connectionString, process.env["VERA_DATABASE_SCHEMA"]),
  },
});
