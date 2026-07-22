# Verifica Fase 14 — API, persistenza e sicurezza

> **Rettifica del 2026-07-16:** l'esito storico seguente verificava soltanto account, sessioni,
> `EvaluationRun`, decisioni, blob metadata, idempotenza ed export backup. Non erano implementati la
> persistenza di fonti, Rule Card, Rule Pack, attivazioni e test-run, né il restore. La Fase 14 è
> pertanto tornata `[~]`; vedere ADR 0006. I risultati originali sono preservati come evidenza dei
> gate effettivamente eseguiti, non come prova dello scope mancante.
>
> **Chiusura del 2026-07-22:** lo scope ADR 0006 è stato completato. Fonti, Rule Card, Rule Pack,
> attivazioni e rule-test runs sono durable via Prisma; backup/restore `vera.storage-backup/v3`
> supera il round-trip; le route `/v1` di dominio e RAG editoriale sono esposte. La Fase 14 è
> tornata `[x]` in roadmap.

Data storica: 2026-07-15T17:57:24+02:00  
Data chiusura scope: 2026-07-22

## Esito

Fase completata. VERA espone un’API locale `/v1` con account locali, sessioni opache, controlli
RBAC, idempotenza, errori Problem Details e persistenza PostgreSQL/Prisma per gli aggregati di
dominio pubblici. Gli asset binari sono salvati in un blob store locale content-addressed; run e
decisioni restano immutabili o append-only; backup/restore v3 include account e aggregati di
dominio.

## Implementazione verificata

- `@vera/storage` introduce Prisma 7 ESM con adapter PostgreSQL e migrazioni SQL riproducibili.
- Le tabelle persistono account locali, sessioni, `EvaluationRun`, decisioni di review, blob e
  record di idempotenza.
- I payload strutturati sono salvati come `jsonb`; vincoli DB e repository impediscono duplicati,
  mutazioni dei run, sequenze stale e hash di decisione non coerenti.
- Il blob store locale calcola SHA-256 sui byte originali e archivia gli asset per contenuto.
- L’export di backup produce JSON canonico con hash complessivo verificabile.
- `@vera/api` introduce Fastify 5, OpenAPI JSON, validazione Zod, rate limit locale, redazione log e
  risposte Problem Details.
- Gli account usano password Argon2id; le sessioni sono token opachi persistiti tramite hash
  SHA-256.
- Le route protette applicano ruoli `AUTHOR`, `REVIEWER`, `APPROVER` e `ADMIN`.
- Le operazioni di creazione richiedono `Idempotency-Key` e riusano la risposta registrata in caso
  di retry coerente.
- La policy di egress consente solo destinazioni locali esplicite per evitare chiamate esterne non
  autorizzate.
- La documentazione operativa è in `docs/api-storage.md`.

## Gate locale

Comando principale:

```bash
pnpm verify
```

Risultato:

- format-check, lint, typecheck, unit, integration, contract, build e public-boundary: pass.
- Test: 1270 passati, 1 skipped.
- Coverage globale:
  - statements: 95.17%
  - branch: 91.76%
  - functions: 96.41%
  - lines: 95.60%
- Public boundary standard: 683 text snapshot controllate.

Gate aggiuntivi:

```bash
pnpm security:check
VERA_BOUNDARY_SCOPES=working,index,history pnpm --filter @vera/public-boundary scan
pnpm licenses list --prod
git diff --check
```

Risultato:

- OSV scanner: 517 pacchetti analizzati, nessun issue.
- Boundary working/index/history: 683 text snapshot controllate, nessun finding.
- Licenze produzione: 347 righe esportate, nessuna occorrenza `GPL`, `AGPL` o `LGPL`.
- `git diff --check`: nessun errore whitespace.

## Copertura specifica

- Test d’integrazione storage con PostgreSQL 17 reale tramite Testcontainers e immagine
  `pgvector/pgvector:0.8.5-pg17`.
- Deploy migrazione Prisma su database vuoto prima dei test repository.
- Test storage su account, sessioni, run immutabili, decisioni append-only, idempotenza,
  content-addressed blob e backup canonico.
- Test API negativi su autenticazione mancante, RBAC, idempotency key mancante, replay idempotente,
  mutazione vietata e ruoli di review.
- Test unitari sulla policy di egress locale.
- Override `@hono/node-server@1.19.13` applicato per mantenere pulita la scansione OSV della
  dependency tree.

## Chiusura 2026-07-22 — evidenza aggiuntiva

Implementazione aggiunta:

- Migration `20260722180000_phase14_domain_aggregates` e repository durable
  (`DurableComplianceSourceRepository`, `DurableRuleCardRepository`, `DurableRulePackRepository`,
  `DurableRulePackActivationLedger`, `DurableRuleTestRunRepository`) con hydrate da storico
  `@vera/rules-core`.
- API domain routes in `apps/api/src/domain-routes.ts` e RAG routes in `apps/api/src/rag-routes.ts`
  (`/v1/rag/retrieve`, `/v1/rag/rule-card-drafts`, index su versioni `APPROVED`, delete indice su
  `RETIRED`).
- Backup/restore `vera.storage-backup/v3` in `packages/storage/src/backup.ts`.
- Hardening RAG: replace atomico per `sourceVersionId`, grounding citazioni draft.

Gate eseguiti in ambiente agent (PostgreSQL 16 locale + pgvector via `VERA_TEST_DATABASE_URL`, in
assenza di Testcontainers/Docker nested):

```bash
VERA_TEST_DATABASE_URL='postgresql://vera:local-only@127.0.0.1:5432/vera' \
  pnpm --filter @vera/storage test:integration
VERA_TEST_DATABASE_URL='postgresql://vera:local-only@127.0.0.1:5432/vera' \
  pnpm --filter @vera/rag test:integration
VERA_TEST_DATABASE_URL='postgresql://vera:local-only@127.0.0.1:5432/vera' \
  pnpm --filter @vera/api exec vitest run test/integration/api-postgres-mvp.test.ts
pnpm --filter @vera/api exec vitest run \
  test/integration/api.test.ts \
  test/integration/domain-routes.test.ts \
  test/integration/rag-routes.test.ts
pnpm --filter @vera/storage test:unit
pnpm --filter @vera/rag test:unit
pnpm --filter @vera/api typecheck
```

Risultato: suite sopra passate (storage integration 10/10, rag integration 6/6, api MVP 1/1, api
HTTP 9/9, unit storage/rag ok).

## Limiti

La persistenza copre il percorso locale necessario alle fasi successive e non introduce identity
provider, cloud storage o servizi esterni. La UI resta su store locale. Le identità, le decisioni e
gli asset di test restano dimostrativi; nessun output costituisce validazione professionale,
certificazione o consulenza.
