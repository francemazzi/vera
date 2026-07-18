# Runner privato SILTO-LABEL

`@vera/label-runner` è il solo componente VERA destinato al flusso LABEL professionale. Non accetta
file dal browser, non espone storage e non ha alcun fallback a Ollama o a modelli locali.

## Confine di rete

```text
Browser -- URL V4 temporaneo --> bucket GCS privato
Backend SILTO -- Cloud Tasks + OIDC --> Cloud Run VERA privato
Cloud Run VERA -- OIDC --> endpoint interni Backend SILTO
Cloud Run VERA -- HTTPS --> OpenRouter
```

Il payload Cloud Tasks contiene esclusivamente `analysisId`. Il runner recupera la chiave
dell'oggetto normalizzato solo attraverso l'endpoint backend protetto da OIDC, legge il PNG con il
proprio service account e invia al backend esito, metadati di riproducibilità e controlli. Gli
object key non vengono mai inviati al browser, a Cloud Tasks o ai log applicativi.

## Configurazione Cloud Run

Il servizio deve usare il service account dedicato
`silto-vera-label-runner@siltopro.iam.gserviceaccount.com`; sul bucket Label ha unicamente
`roles/storage.objectViewer`. Cloud Tasks usa `silto-label-tasks@siltopro.iam.gserviceaccount.com`
per il token OIDC e il backend usa `silto-label-backend@siltopro.iam.gserviceaccount.com` per
enqueue.

Configurare come variabili non segrete:

- `GCP_PROJECT_ID`, `LABEL_GCS_BUCKET`
- `LABEL_BACKEND_URL`, `LABEL_BACKEND_AUDIENCE`
- `LABEL_RUNNER_AUDIENCE`, `LABEL_TASKS_INVOKER_SERVICE_ACCOUNT_EMAIL`
- `LABEL_OPENROUTER_MODEL`, `LABEL_PROMPT_VERSION`, `LABEL_RULE_PACK_VERSION`
- `LABEL_SOURCE_SNAPSHOT` (SHA-256 dello snapshot approvato)
- `LABEL_OPENROUTER_TIMEOUT_MS`

`OPENROUTER_API_KEY` è obbligatorio ma viene iniettato esclusivamente da Secret Manager. Non va
inserito in file `.env` tracciati, Cloud Build substitutions, log, frontend o codice. Prima del
deploy verificare che il service account Cloud Tasks disponga di `roles/run.invoker` sul servizio
VERA e che il service account VERA sia quello atteso dal middleware OIDC del backend.

## Elaborazione e retry

Il runner acquisisce un lease ottimistico prima di valutare un'analisi. Una task duplicata riceve un
acknowledgement senza eseguire una seconda chiamata al modello. Errori temporanei OpenRouter (`429`,
`5xx`, timeout) ritornano errore a Cloud Tasks e usano il retry configurato; errori non recuperabili
registrano `FAILED` con audit nel backend. Cloud Tasks non ha una DLQ nativa: la coda usa un numero
finito di tentativi e i failure terminali sono conservati nel run/audit.

## Test live

I test normali usano fixture PNG sintetiche e un transport OpenRouter simulato. Lo smoke live
richiede una chiave ruotata già presente in Secret Manager e una variabile di abilitazione
esplicita; non usa dataset o etichette riservati.
