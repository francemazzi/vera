# API, persistenza e sicurezza locale

La Fase 14 introduce una API locale Fastify e una prima persistenza PostgreSQL tramite Prisma 7. Lo
scope durable è ancora parziale ed è tracciato dall'ADR 0006.

## Componenti

- `@vera/storage`
  - Prisma schema e migration SQL in `packages/storage/prisma`.
  - Client Prisma ESM con adapter PostgreSQL.
  - Repository per account locali, sessioni, run di valutazione, decisioni review, idempotenza e
    blob metadata.
  - Blob store locale content-addressed, con path derivato da SHA-256.
  - Export backup canonico; il restore non è ancora implementato.
- `@vera/api`
  - Fastify 5 con OpenAPI `/openapi.json`.
  - Problem Details per errori applicativi.
  - Account locali con password Argon2id, bootstrap iniziale esplicito e sessioni bearer opache.
  - RBAC locale sui ruoli `AUTHOR`, `REVIEWER`, `APPROVER`, `ADMIN`.
  - Rate limit locale.
  - Redazione log per token, cookie e password.
  - Policy egress esplicita: solo endpoint locali.

## Invarianti di persistenza

- `EvaluationRun` è immutabile: viene solo creato e letto.
- `ReviewDecision` è append-only: la tabella applica unicità `(runId, sequence)` e il repository
  verifica `previousEventHash`.
- `IdempotencyRecord` usa chiave composta `(scope, key)`, hash della richiesta e transazioni
  atomiche insieme alla mutazione protetta.
- Le tabelle usano vincoli DB per ruoli, outcome, scope demo, sequenze positive e hash blob.
- Le migration sono applicate con `prisma migrate deploy`.

## Test

La suite storage usa PostgreSQL reale via Testcontainers e applica la migration prima dei test. La
suite API mantiene test HTTP isolati e aggiunge un percorso composto MVP → API → PostgreSQL reale:

- auth mancante;
- RBAC insufficiente;
- idempotency key mancante;
- replay idempotente;
- blocco mutation su `EvaluationRun`;
- creazione review decision;
- binding fra decisione e identità autenticata;
- bootstrap ADMIN una tantum;
- policy egress locale.

## Limiti

La API è locale e dimostrativa. Non include ancora UI, provider di identità esterni, deployment
cloud o gestione multi-tenant. La persistenza non copre ancora fonti, Rule Card, Rule Pack,
attivazioni o test-run e non implementa restore. Tutti gli account e gli oggetti dimostrativi
restano `validationScope=TECHNICAL_DEMO`.
