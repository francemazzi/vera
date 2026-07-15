import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FailingEmbeddingProvider,
  KeywordEmbeddingProvider,
  section,
  uuid,
} from "../fixtures/rag.js";
import { PgVectorRagIndex } from "../../src/index.js";

describe("PgVectorRagIndex", () => {
  let container: StartedTestContainer;
  let pool: Pool;

  beforeAll(async () => {
    container = await new GenericContainer("pgvector/pgvector:0.8.5-pg17")
      .withEnvironment({
        POSTGRES_DB: "vera",
        POSTGRES_USER: "vera",
        POSTGRES_PASSWORD: "local-only",
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections", 2))
      .start();
    pool = new Pool({
      connectionString: `postgresql://vera:local-only@${container.getHost()}:${container
        .getMappedPort(5432)
        .toString()}/vera`,
    });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it("indexes only approved chunks and retrieves with scope and temporal filters", async () => {
    const index = new PgVectorRagIndex({
      db: pool,
      embeddingProvider: new KeywordEmbeddingProvider(),
      dimensions: 4,
      tableName: "rag_chunks_test",
    });
    await index.ensureSchema();
    const indexed = await index.indexApprovedSections([
      section({
        sourceVersionId: uuid(20),
        sectionId: "retention",
        sectionTitle: "Retention",
        text: "Retention text says synthetic records must retain a visible label for seven days.",
      }),
      section({
        sourceVersionId: uuid(21),
        sectionId: "archive",
        sectionTitle: "Archive",
        text: "Archive text is unrelated to visible labels.",
      }),
      section({
        sourceVersionId: uuid(22),
        sectionId: "expired",
        sectionTitle: "Expired",
        text: "Retention expired text should not be returned.",
        validity: {
          validFrom: "2025-01-01T00:00:00.000Z",
          validTo: "2025-12-31T00:00:00.000Z",
        },
      }),
      section({
        sourceVersionId: uuid(23),
        sectionId: "other-domain",
        sectionTitle: "Other",
        domain: "other-domain",
        text: "Retention other domain text should not be returned.",
      }),
    ]);

    expect(indexed.chunksIndexed).toBe(4);
    const results = await index.retrieve({
      queryText: "retention label",
      domain: "synthetic-domain",
      jurisdiction: "DEMO",
      evaluationDate: "2026-07-15T00:00:00.000Z",
      topK: 5,
    });

    expect(results.map((result) => result.sectionId)).toContain("retention");
    expect(results.map((result) => result.sectionId)).not.toContain("expired");
    expect(results.map((result) => result.sectionId)).not.toContain("other-domain");
    expect(results[0]?.citation.sourceVersionId).toBe(results[0]?.sourceVersionId);
  });

  it("fails closed when the embedding provider is unavailable", async () => {
    const index = new PgVectorRagIndex({
      db: pool,
      embeddingProvider: new FailingEmbeddingProvider(),
      dimensions: 4,
      tableName: "rag_chunks_unavailable_test",
    });
    await index.ensureSchema();
    const result = await index.retrieveSafely({
      queryText: "retention label",
      domain: "synthetic-domain",
      jurisdiction: "DEMO",
      evaluationDate: "2026-07-15T00:00:00.000Z",
      topK: 5,
    });

    expect(result).toMatchObject({ status: "UNAVAILABLE", requiresReview: true });
  });
});
