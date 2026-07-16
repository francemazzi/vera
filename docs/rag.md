# RAG e ingestione editoriale

VERA usa il RAG solo come assistenza editoriale per fonti sintetiche o approvate. Il retrieval non
produce decisioni di conformità e l’authoring AI può generare esclusivamente suggerimenti di Rule
Card in stato `DRAFT`.

## Confini

- Solo sezioni con `sourceState=APPROVED` possono essere indicizzate.
- Ogni chunk conserva `sourceId`, `sourceVersionId`, `sourceContentHash`, sezione, dominio,
  giurisdizione, validità temporale, licenza e `validationScope=TECHNICAL_DEMO`.
- Il retrieval filtra sempre per dominio, giurisdizione e data di valutazione usando intervalli
  semiaperti `validFrom <= evaluationDate < validTo`.
- L’indice usa PostgreSQL con estensione `pgvector`; Prisma non viene usato per il calcolo
  vettoriale.
- Se embedding, Ollama o retrieval non sono disponibili, il risultato sicuro è `UNAVAILABLE` con
  `requiresReview=true`.

## Authoring

`generateRuleCardDraft` costruisce un prompt con citazioni esplicite e accetta soltanto JSON che
rispetta `RuleCardDraftSuggestionSchema`.

Il draft contiene:

- `targetState=DRAFT`;
- `provenance=AI_ASSISTED`;
- citazioni ai chunk usati;
- requisiti evidenziali ed eccezioni con `citationChunkIds`;
- nessun esito normativo, finding, verdict, approvazione o attivazione.

Qualsiasi avanzamento verso `IN_REVIEW` produce solo una richiesta con
`requiresHumanConfirmation=true` e `rationaleRequired=true`. Non esiste un percorso nel package che
approvi o attivi una regola generata dalla sola AI.

## Provider

Il package espone provider astratti per embedding e draft. Gli adapter Ollama riusano il client
loopback già limitato dagli estrattori e possono essere avvolti con retry bounded:

- `RetryingEmbeddingProvider`;
- `RetryingRuleDraftProvider`;
- `OllamaEmbeddingProvider`;
- `OllamaRuleDraftProvider`.

Lo smoke test locale `pnpm --filter @vera/rag test:smoke` registra un hash di limitazione quando
Ollama non è configurato. Quando sono presenti `VERA_OLLAMA_RAG_MODEL`, `VERA_OLLAMA_RAG_DIGEST` e
`VERA_OLLAMA_RUNTIME_VERSION`, registra modello, digest, dimensioni embedding e hash dell’output
grezzo.

## Metriche sintetiche

`computeRetrievalMetrics` calcola, su casi sintetici:

- recall@k;
- citation accuracy;
- faithfulness;
- unsupported claim rate.

Queste metriche misurano riproducibilità tecnica sul corpus dimostrativo e non validano qualità
professionale o accuratezza reale.
