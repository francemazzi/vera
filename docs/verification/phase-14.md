# Verifica Fase 14 — API, persistenza e sicurezza

Data: 2026-07-15T17:57:24+02:00

## Esito

Fase completata. VERA espone una prima API locale `/v1` con account locali, sessioni opache,
controlli RBAC, idempotenza, errori Problem Details e persistenza PostgreSQL/Prisma. Gli asset
binari sono salvati in un blob store locale content-addressed, mentre run e decisioni restano
immutabili o append-only.

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

## Limiti

La persistenza copre il percorso locale necessario alle fasi successive e non introduce identity
provider, cloud storage o servizi esterni. Le identità, le decisioni e gli asset di test restano
dimostrativi; nessun output costituisce validazione professionale, certificazione o consulenza.
