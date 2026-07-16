# Verifica Fase 11 — RAG e ingestione

Data: 2026-07-15T18:22:35+02:00

## Esito

Fase completata. VERA include un package RAG locale separato dal kernel deterministico: indicizza in
pgvector solo sezioni di fonti approvate, recupera chunk filtrando per dominio, giurisdizione e
validità temporale, e genera esclusivamente suggerimenti editoriali di Rule Card in stato `DRAFT`.

## Implementazione verificata

- `@vera/rag` espone schemi Zod per sezioni indicizzabili, chunk, citazioni, query, risultati,
  suggerimenti draft e log di generazione.
- `chunkApprovedSourceSections` rifiuta qualsiasi fonte non `APPROVED` prima di calcolare chunk o
  embedding.
- Ogni chunk conserva fonte, versione, sezione, dominio, giurisdizione, licenza, hash contenuto,
  validità e `validationScope=TECHNICAL_DEMO`.
- `PgVectorRagIndex` crea una tabella PostgreSQL con `vector(n)` e vincoli `APPROVED` /
  `TECHNICAL_DEMO`, poi interroga con similarità pgvector.
- Il retrieval filtra sempre per `domain`, `jurisdiction` ed intervallo semiaperto
  `validFrom <= evaluationDate < validTo`.
- `retrieveSafely` fallisce chiuso con `UNAVAILABLE` e `requiresReview=true` quando embedding o
  provider non sono disponibili.
- `generateRuleCardDraft` registra prompt, hash prompt, provider, output grezzo, tentativi e
  citazioni; il JSON accettato deve avere `targetState=DRAFT`.
- `createRuleCardWorkflowAdvancementRequest` produce soltanto una richiesta verso `IN_REVIEW` con
  conferma umana e motivazione obbligatorie.
- `RetryingEmbeddingProvider` e `RetryingRuleDraftProvider` applicano retry bounded.
- `OllamaEmbeddingProvider` e `OllamaRuleDraftProvider` riusano il client Ollama loopback già
  vincolato dagli estrattori.
- `computeRetrievalMetrics` calcola recall@k, citation accuracy, faithfulness e unsupported claim
  rate su casi sintetici.
- La documentazione operativa è in `docs/rag.md`.

## Gate locale

Comando principale:

```bash
pnpm verify
```

Risultato:

- format-check, lint, typecheck, unit, integration, contract, build e public-boundary: pass.
- Test: 1285 passati, 1 skipped.
- Coverage globale:
  - statements: 94.53%
  - branch: 90.96%
  - functions: 95.86%
  - lines: 94.96%
- Public boundary standard: 764 text snapshot controllate.

Gate aggiuntivo Ollama:

```bash
pnpm --filter @vera/rag test:smoke
```

Risultato:

- Smoke RAG: 1 test passato.
- In questo ambiente non erano configurate `VERA_OLLAMA_RAG_MODEL`, `VERA_OLLAMA_RAG_DIGEST` e
  `VERA_OLLAMA_RUNTIME_VERSION`; lo smoke ha registrato la limitazione con hash
  `e2d6076c3e1a73594df05ed75140e751a0ed9b56d9201fc1f29b04028d5ae815`.
- Quando le variabili sono presenti, lo stesso test registra modello, digest, versione runtime,
  dimensione embedding e hash dell’output grezzo.

Gate aggiuntivi:

```bash
pnpm security:check
VERA_BOUNDARY_SCOPES=working,index,history pnpm --filter @vera/public-boundary scan
pnpm licenses list --prod
git diff --check
```

Risultato:

- OSV scanner: 517 pacchetti analizzati, nessun issue.
- Boundary working/index/history: 764 text snapshot controllate, nessun finding.
- Licenze produzione: 347 righe esportate, nessuna occorrenza `GPL`, `AGPL` o `LGPL`.
- `git diff --check` senza errori whitespace.

## Copertura specifica

- Unit test: chunking deterministico, rifiuto fonti non approvate, citazioni bounded, draft-only,
  citazioni sconosciute, richiesta di conferma umana, retry e metriche sintetiche.
- Integration test: PostgreSQL 17 reale con immagine `pgvector/pgvector:0.8.5-pg17`, schema
  pgvector, indicizzazione, filtri dominio/giurisdizione/validità, provider simulati, retry e
  indisponibilità sicura.
- Smoke test: limitazione locale hashata quando Ollama non è configurato; registrazione di
  modello/digest/output quando configurato.

## Limiti

Il package assiste authoring e retrieval editoriale; non approva fonti, non attiva Rule Card, non
produce finding e non valuta conformità. Le metriche sono sintetiche e misurano solo riproducibilità
tecnica. Nessun risultato costituisce validazione professionale, certificazione o consulenza.
