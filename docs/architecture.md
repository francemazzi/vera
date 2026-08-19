# Architettura

VERA è un monorepo TypeScript strict/ESM per valutazioni tecniche di conformità documentale. Il
kernel di regole è separato da AI, storage e UI: riceve snapshot immutabili, facts ed evidenze, e
produce findings deterministici.

## Componenti

| Area           | Package/app             | Responsabilità                                                        |
| -------------- | ----------------------- | --------------------------------------------------------------------- |
| Contratti      | `@vera/contracts`       | Schemi Zod, tipi, JSON Schema, hash canonicali e invarianti pubbliche |
| Kernel         | `@vera/rules-core`      | DSL evaluator, resolution, Rule Pack, ledger audit in memoria         |
| Estrazione     | `@vera/extractors`      | Adapter manuale, JSON, Ollama e OpenRouter senza esiti normativi      |
| Testing regole | `@vera/rules-testing`   | Fixture gate, diff versioni e impact report                           |
| Benchmark      | `@vera/benchmark`       | Corpus sintetico, runner simulato, metriche e smoke Ollama            |
| Calibrazione   | `@vera/calibration`     | Profili, reliability diagram, risk-coverage e astensione              |
| Persistenza    | `@vera/storage`         | PostgreSQL per run/review/auth, blob store ed export backup           |
| RAG            | `@vera/rag`             | Chunking, pgvector, retrieval e bozze `DRAFT` via provider testuali   |
| MVP            | `@vera/demo-mvp`        | Orchestrazione end-to-end sintetica e report hashato                  |
| API            | `@vera/api`             | Fastify `/v1`, OpenAPI, auth locale, RBAC e idempotenza               |
| UI             | `@vera/web`             | Audit desk React/Vite, coda revisione, Playwright                     |
| Audit locale   | `@vera/dataset-harness` | Controllo strutturale privato con astensione obbligatoria             |

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

## Provider AI ed egress

Ollama è il provider predefinito e resta l’unico backend per OCR, vision ed embedding. OpenRouter è
opt-in e limitato a estrazione LLM testuale e generazione di bozze RAG con il modello fissato
`meta-llama/llama-3.1-8b-instruct`. Le richieste remote impongono Zero Data Retention,
`data_collection=deny` e routing tra provider dello stesso modello; non esiste fallback automatico
da Ollama a OpenRouter.

OpenRouter è l’unico egress remoto esplicitamente supportato. Il controllo API generico
`POST /v1/egress-check` continua ad accettare solo endpoint locali e non abilita destinazioni remote
arbitrarie; gli adapter OpenRouter non sono orchestrati dall’API.

## Confine pubblico

Il repository pubblicabile contiene solo codice, documentazione e fixture sintetiche. Materiali
locali restano sotto percorsi ignorati come `datasets/`, `reports/private/` e `.vera-private/`. Il
public-boundary scanner viene eseguito su working tree, indice e cronologia raggiungibile.

L'API, il database, RAG e la UI hanno test d'integrazione propri. Il percorso composto verificato
collega l'MVP sintetico all'API e a PostgreSQL. Fonti, Rule Card, Rule Pack, attivazioni e test-run
hanno persistenza PostgreSQL durable con backup/restore `v3`. L’API può orchestrare il RAG
editoriale (`/v1/rag/*` e index su versioni `APPROVED`); la UI di revisione usa ancora uno store
locale e non è ancora collegata all’API.

## Limiti della release sperimentale

- Nessuna pubblicazione npm.
- Nessun identity provider esterno.
- Nessun claim di accuratezza reale.
- Ogni asset dimostrativo usa `validationScope=TECHNICAL_DEMO`.
- La visibilità pubblica richiede conferma esplicita dell’operatore dopo i gate finali.
