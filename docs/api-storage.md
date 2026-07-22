# API, persistenza e sicurezza locale

La Fase 14 espone un’API locale Fastify e persistenza PostgreSQL tramite Prisma 7 per gli aggregati
di dominio pubblici, con backup/restore verificabile (ADR 0006 chiuso sul confine durable).

## Componenti

- `@vera/storage`
  - Prisma schema e migration SQL in `packages/storage/prisma`.
  - Client Prisma ESM con adapter PostgreSQL.
  - `VeraStorageRepository` per account locali, sessioni, run di valutazione, decisioni review,
    idempotenza e blob metadata.
  - Repository durable per ComplianceSource, RuleCard, RulePack, ActivationEvent e RuleTestRun /
    impact report (hydrate da storico + invarianti `@vera/rules-core`).
  - Blob store locale content-addressed, con path derivato da SHA-256.
  - Export/restore backup `vera.storage-backup/v3` (include account e aggregati di dominio; le
    sessioni restano effimere e sono omesse).
- `@vera/api`
  - Fastify 5 con OpenAPI `/openapi.json`.
  - Problem Details per errori applicativi.
  - Account locali con password Argon2id, bootstrap iniziale esplicito e sessioni bearer opache.
  - RBAC locale sui ruoli `AUTHOR`, `REVIEWER`, `APPROVER`, `ADMIN`.
  - Rate limit locale.
  - Redazione log per token, cookie e password.
  - Policy egress esplicita: solo endpoint locali.
  - Route `/v1` per aggregati di dominio, review decisions e (se configurato) RAG editoriale.

## Route di dominio

Oltre a account, sessioni, evaluation-runs, review-decisions e blob:

- compliance sources: create, versions, transitions, history;
- rule cards: create, revisions, comments, submit, reviews, approvals, retire;
- rule packs: drafts, replace, publish, clone, versions;
- activations + resolve;
- rule-test-runs e impact reports;
- RAG (opzionale): index, retrieve, rule-card-drafts.

Le mutazioni create/publish/activate/index richiedono `Idempotency-Key`. Le risorse modificabili
usano `expectedRevision` / sequence OCC dal dominio.

## Invarianti di persistenza

- `EvaluationRun` è immutabile: viene solo creato e letto.
- `ReviewDecision` è append-only: la tabella applica unicità `(runId, sequence)` e il repository
  verifica `previousEventHash`.
- Fonti, card, pack e activation usano sequenze/revisioni OCC e payload `jsonb` validati con gli
  schemi Zod pubblici.
- `IdempotencyRecord` usa chiave composta `(scope, key)`, hash della richiesta e transazioni
  atomiche insieme alla mutazione protetta.
- Le tabelle usano vincoli DB per ruoli, outcome, scope demo, sequenze positive e hash blob.
- Le migration sono applicate con `prisma migrate deploy`.

## Test

La suite storage usa PostgreSQL reale via Testcontainers e applica la migration prima dei test. La
suite API mantiene test HTTP isolati (domain + RAG) e un percorso composto MVP → API → PostgreSQL
reale quando il runtime container è disponibile.

## Limiti

La API è locale e dimostrativa. Non include ancora UI collegata, provider di identità esterni,
deployment cloud o gestione multi-tenant. Tutti gli account e gli oggetti dimostrativi restano
`validationScope=TECHNICAL_DEMO`.
