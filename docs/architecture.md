# Architettura

VERA è un monorepo TypeScript strict/ESM per valutazioni tecniche di conformità documentale. Il
kernel di regole è separato da AI, storage e UI: riceve snapshot immutabili, facts ed evidenze, e
produce findings deterministici.

## Componenti

| Area           | Package/app           | Responsabilità                                                        |
| -------------- | --------------------- | --------------------------------------------------------------------- |
| Contratti      | `@vera/contracts`     | Schemi Zod, tipi, JSON Schema, hash canonicali e invarianti pubbliche |
| Kernel         | `@vera/rules-core`    | DSL evaluator, resolution, Rule Pack, ledger audit in memoria         |
| Estrazione     | `@vera/extractors`    | Adapter manuale, JSON e Ollama senza esiti normativi                  |
| Testing regole | `@vera/rules-testing` | Fixture gate, diff versioni e impact report                           |
| Benchmark      | `@vera/benchmark`     | Corpus sintetico, runner simulato, metriche e smoke Ollama            |
| Calibrazione   | `@vera/calibration`   | Profili, reliability diagram, risk-coverage e astensione              |
| Persistenza    | `@vera/storage`       | Prisma/PostgreSQL, blob store, backup/restore                         |
| RAG            | `@vera/rag`           | Chunking, pgvector, retrieval e bozze Rule Card `DRAFT`               |
| MVP            | `@vera/demo-mvp`      | Orchestrazione end-to-end sintetica e report hashato                  |
| API            | `@vera/api`           | Fastify `/v1`, OpenAPI, auth locale, RBAC e idempotenza               |
| UI             | `@vera/web`           | Audit desk React/Vite, coda revisione, Playwright                     |

## Flusso dati

```text
documenti sintetici/manuali
  → adapter di estrazione
  → Fact + Evidence
  → RulePackVersion immutabile
  → kernel deterministico
  → RuleFinding / EvaluationRun
  → ReviewDecision umana
  → export audit canonicalizzato
```

Ogni hash è calcolato sui byte originali o su JSON canonicalizzato. Le versioni pubblicate non sono
mutate; attivazioni, rollback e review sono eventi append-only.

## Confine pubblico

Il repository pubblicabile contiene solo codice, documentazione e fixture sintetiche. Materiali
locali restano sotto percorsi ignorati come `datasets/`, `reports/private/` e `.vera-private/`. Il
public-boundary scanner viene eseguito su working tree, indice e cronologia raggiungibile.

## Limiti della release sperimentale

- Nessuna pubblicazione npm.
- Nessun identity provider esterno.
- Nessun claim di accuratezza reale.
- Ogni asset dimostrativo usa `validationScope=TECHNICAL_DEMO`.
- La visibilità pubblica richiede conferma esplicita dell’operatore dopo i gate finali.
