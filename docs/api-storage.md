# API, persistenza e sicurezza locale

La Fase 14 introduce una API locale Fastify e persistenza PostgreSQL tramite Prisma 7.

## Componenti

- `@vera/storage`
  - Prisma schema e migration SQL in `packages/storage/prisma`.
  - Client Prisma ESM con adapter PostgreSQL.
  - Repository per account locali, sessioni, run di valutazione, decisioni review, idempotenza e
    blob metadata.
  - Blob store locale content-addressed, con path derivato da SHA-256.
  - Export backup canonico per round trip tecnico.
- `@vera/api`
  - Fastify 5 con OpenAPI `/openapi.json`.
  - Problem Details per errori applicativi.
  - Account locali con password Argon2id e sessioni bearer opache.
  - RBAC locale sui ruoli `AUTHOR`, `REVIEWER`, `APPROVER`, `ADMIN`.
  - Rate limit locale.
  - Redazione log per token, cookie e password.
  - Policy egress esplicita: solo endpoint locali.

## Invarianti di persistenza

- `EvaluationRun` è immutabile: viene solo creato e letto.
- `ReviewDecision` è append-only: la tabella applica unicità `(runId, sequence)` e il repository
  verifica `previousEventHash`.
- `IdempotencyRecord` usa chiave composta `(scope, key)` e confronta hash canonico della risposta.
- Le tabelle usano vincoli DB per ruoli, outcome, scope demo, sequenze positive e hash blob.
- Le migration sono applicate con `prisma migrate deploy`.

## Test

La suite storage usa PostgreSQL reale via Testcontainers e applica la migration prima dei test. La
suite API usa repository/auth finti per coprire i negativi HTTP senza moltiplicare container:

- auth mancante;
- RBAC insufficiente;
- idempotency key mancante;
- replay idempotente;
- blocco mutation su `EvaluationRun`;
- creazione review decision;
- policy egress locale.

## Limiti

La API è locale e dimostrativa. Non include ancora UI, provider di identità esterni, deployment
cloud o gestione multi-tenant. Tutti gli account e gli oggetti dimostrativi restano
`validationScope=TECHNICAL_DEMO`.
