# Roadmap VERA

Roadmap operativa per costruire VERA come motore generico di conformità, deterministico, versionato
e verificabile, in un unico repository TypeScript.

> **Limite di validazione:** tutte le fonti, identità, approvazioni, regole, fixture, benchmark e
> demo distribuiti con VERA sono sintetici e hanno ambito `TECHNICAL_DEMO`. Gli output attestano
> soltanto il funzionamento tecnico del software; non costituiscono certificazione, consulenza o
> validazione professionale.

## Legenda

- `[ ]` da iniziare
- `[~]` in corso
- `[x]` completato, verificato e sincronizzato
- `[!]` bloccato da una decisione o da una dipendenza esterna

## Ordine di esecuzione

Le fasi vengono eseguite nell’ordine seguente:

`0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 13 → 14 → 11 → 12 → 15 → 16`

Provenienza e persistenza precedono RAG e UI per evitare di aggiungere audit, immutabilità e
sicurezza a posteriori.

| Ordine | Fase | Nome                          | Stato |
| -----: | ---: | ----------------------------- | :---: |
|      1 |    0 | Confini pubblici e fondazione | `[x]` |
|      2 |    1 | Specifica metodologica        | `[x]` |
|      3 |    2 | Fonti di conformità           | `[x]` |
|      4 |    3 | Rule Card                     | `[x]` |
|      5 |    4 | Facts, evidenze ed estrattori | `[x]` |
|      6 |    5 | DSL dichiarativa              | `[x]` |
|      7 |    6 | Kernel deterministico         | `[x]` |
|      8 |    7 | Rule Pack e versionamento     | `[x]` |
|      9 |    8 | Test runner e version diff    | `[x]` |
|     10 |    9 | Benchmark sintetico           | `[x]` |
|     11 |   10 | Calibrazione e astensione     | `[x]` |
|     12 |   13 | Provenienza e audit           | `[x]` |
|     13 |   14 | API, persistenza e sicurezza  | `[x]` |
|     14 |   11 | RAG e ingestione              | `[x]` |
|     15 |   12 | UI di revisione               | `[ ]` |
|     16 |   15 | MVP dimostrativo sintetico    | `[ ]` |
|     17 |   16 | Apertura e release            | `[ ]` |

## Invarianti trasversali

- L’AI produce facts o Rule Card `DRAFT`; non produce né attiva decisioni di conformità.
- La DSL usa logica `TRUE | FALSE | UNKNOWN`; ogni valore sconosciuto o privo di evidenza porta a
  `REVIEW`.
- Le versioni pubblicate sono immutabili; attivazioni e rollback sono eventi append-only.
- Ogni finding identifica fonte, regola, versione, input, evidenze e trace.
- Il kernel è puro e non dipende da rete, database, interfaccia o provider AI.
- Test, benchmark, esempi e MVP usano solo materiali sintetici pubblicabili.
- Il contenuto locale ignorato da Git non è usato come test, benchmark o prova di completamento.
- Ogni identità o approvazione dimostrativa dichiara `validationScope=TECHNICAL_DEMO`.

---

## [x] Fase 0 — Confini pubblici e fondazione

**Obiettivo:** predisporre un solo repository genericamente pubblicabile, una toolchain
riproducibile e controlli automatici contro l’inclusione accidentale di materiali locali.

- [x] Riscrivere README e roadmap senza riferimenti a casi d’uso, organizzazioni, tassonomie o
      corpus riservati.
- [x] Stabilire il confine unico: codice ed esempi sintetici tracciati; `datasets/` e altri
      materiali locali ignorati da Git.
- [x] Creare monorepo pnpm TypeScript strict/ESM con runtime e package manager fissati.
- [x] Aggiungere configurazioni condivise per format-check, lint, typecheck, build e test.
- [x] Aggiungere Docker Compose per i servizi locali previsti, senza dipendenze cloud obbligatorie.
- [x] Configurare CI, scansione di segreti, dipendenze, licenze e confine pubblico.
- [x] Implementare uno scanner configurabile per contenuti vietati e testarlo su working tree,
      indice e cronologia raggiungibile.
- [x] Verificare che esempi e fixture iniziali siano esclusivamente sintetici.
- [x] Salvare un bundle Git locale prima di qualsiasi riscrittura della cronologia.
- [x] Richiedere conferma esplicita prima di riscrivere i commit esistenti e prima dell’unico
      force-push previsto.

### Gate di fase

- [x] Installazione pulita, lint, typecheck, build e test completano con successo.
- [x] Scanner di segreti e confine pubblico completano con successo su tutti i ref raggiungibili.
- [x] `datasets/` e materiali locali risultano ignorati e assenti da indice e cronologia
      pubblicabile.
- [x] `docs/verification/phase-0.md` registra comandi, versioni, risultati e limiti.

---

## [x] Fase 1 — Specifica metodologica

**Obiettivo:** rendere la metodologia implementabile senza decisioni interpretative residue.

- [x] Documentare il flusso `source → rule card → rule → test → approval → activation`.
- [x] Definire `PASS`, `FAIL`, `REVIEW` e `NOT_APPLICABLE` con truth table completa.
- [x] Definire categorie `OBLIGATION`, `PROHIBITION` e `PERMISSION`.
- [x] Formalizzare eccezioni, priorità, conflitti, override e non applicabilità.
- [x] Definire rischio `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` e costi d’errore.
- [x] Formalizzare intervalli UTC semiaperti e comportamento di `validTo=null`.
- [x] Definire workflow, ruoli, separazione dei compiti e approvazioni richieste.
- [x] Rendere gli esempi metodologici eseguibili come contract test.
- [x] Dichiarare il limite di validazione tecnica e il divieto di certificazione automatica.

### Gate di fase

- [x] Schemi, esempi e truth table concordano e superano i contract test.
- [x] Ogni stato e transizione ha almeno un esempio sintetico valido e uno invalido.
- [x] `docs/verification/phase-1.md` rende ripetibile la verifica.

---

## [x] Fase 2 — Fonti di conformità

**Obiettivo:** rendere ogni fonte identificabile, verificabile e temporalmente ricostruibile.

- [x] Implementare `ComplianceSource` e versioni append-only.
- [x] Registrare tipo, dominio, giurisdizione, titolo, versione e riferimenti stabili.
- [x] Registrare licenza, hash SHA-256, `validFrom` e `validTo`.
- [x] Implementare `UPLOADED → REVIEWED → APPROVED → RETIRED`.
- [x] Registrare attori e timestamp per ogni transizione.
- [x] Vietare l’uso in Rule Pack attivi di fonti non approvate.
- [x] Consentire sostituzioni senza sovrascrivere versioni storiche.
- [x] Implementare un repository in memoria per i test di integrazione del dominio.

### Gate di fase

- [x] Test unitari coprono hash, date, intervalli e transizioni valide/non valide.
- [x] Test d’integrazione provano immutabilità, ricostruzione e blocco delle fonti non approvate.
- [x] `docs/verification/phase-2.md` registra i risultati.

---

## [x] Fase 3 — Rule Card

**Obiettivo:** introdurre un passaggio revisionabile tra fonte e regola eseguibile.

- [x] Implementare `RuleCard` con attore, oggetto, ambito e categoria deontica.
- [x] Registrare eccezioni, evidenze richieste, rischio e costi di falso positivo/negativo.
- [x] Collegare ogni card a fonte e sezione stabili.
- [x] Implementare commenti, revisioni, optimistic concurrency e audit delle modifiche.
- [x] Applicare ruoli `AUTHOR`, `REVIEWER`, `APPROVER`, `ADMIN`.
- [x] Vietare self-approval.
- [x] Richiedere due approvatori distinti per rischio `HIGH` o `CRITICAL`.
- [x] Impedire la generazione di una regola attiva da una card non approvata.

### Gate di fase

- [x] Test unitari coprono autorizzazioni, workflow e quorum.
- [x] Test d’integrazione coprono conflitti concorrenti e blocco dell’attivazione.
- [x] Le identità di test sono sintetiche e marcate `TECHNICAL_DEMO`.
- [x] `docs/verification/phase-3.md` registra i risultati.

---

## [x] Fase 4 — Facts, evidenze ed estrattori

**Obiettivo:** rappresentare input e provenienza in modo indipendente dal metodo di estrazione.

- [x] Implementare `Fact<T>` con valore originale, normalizzato, stato, provider e confidence
      grezza.
- [x] Gestire `NULL`, `NOT_FOUND`, `NOT_READABLE` e `CONFLICT` senza conversioni implicite.
- [x] Implementare `Evidence` con hash documento, pagina 1-based, testo, lingua e bounding box
      normalizzata `[0,1]`.
- [x] Definire `ExtractorAdapter` comune che non possa restituire esiti normativi.
- [x] Implementare adapter manuale e JSON.
- [x] Implementare adapter OCR, vision, LLM ed embedding tramite Ollama locale.
- [x] Registrare modello, digest, parametri, prompt e output grezzo.
- [x] Validare ogni output con gli schemi condivisi.
- [x] Implementare timeout, retry limitato e fallimento esplicito quando un modello non è
      disponibile.

### Gate di fase

- [x] Test unitari coprono normalizzazione, contraddizioni e validazione.
- [x] Test d’integrazione usano un server Ollama simulato in CI.
- [x] Uno smoke test offline usa modelli locali pinnati e registra l’ambiente.
- [x] Nessun adapter può produrre `PASS`, `FAIL` o `NOT_APPLICABLE`.
- [x] `docs/verification/phase-4.md` registra i risultati.

---

## [x] Fase 5 — DSL dichiarativa

**Obiettivo:** esprimere regole con un AST JSON validabile, limitato e privo di codice arbitrario.

- [x] Definire un AST discriminato e generare JSON Schema dagli schemi Zod.
- [x] Implementare `truth`, `present`, `eq`, `not_eq`, `contains`, `contains_any` e `matches`.
- [x] Implementare `greater_than`, `less_than`, `between` e operatori temporali.
- [x] Implementare `all`, `any`, `not`, `language_present` e `same_visual_area`.
- [x] Separare `appliesWhen` da `satisfiedWhen`.
- [x] Implementare eccezioni, override e `unknownPolicy=REVIEW`.
- [x] Definire confronti numerici, Unicode, date e aree visuali senza coercizioni ambigue.
- [x] Usare regex RE2-compatible con limiti di dimensione, profondità e complessità.
- [x] Vietare `eval`, codice arbitrario, SQL e rete.

### Gate di fase

- [x] Ogni operatore ha casi `TRUE`, `FALSE`, `UNKNOWN`, schema invalido e input avverso.
- [x] I rami degli operatori e delle invarianti critiche hanno copertura completa.
- [x] `docs/verification/phase-5.md` registra i risultati.

---

## [x] Fase 6 — Kernel deterministico

**Obiettivo:** valutare facts e regole in memoria con risultati ripetibili e spiegabili.

- [x] Implementare parser ed evaluator puri.
- [x] Valutare applicabilità, requisito, eccezioni e valori sconosciuti separatamente.
- [x] Produrre `RuleFinding` e trace completa di operatori, attesi e osservati.
- [x] Propagare le evidenze usate in ogni nodo della trace.
- [x] Aggregare con precedenza `FAIL > REVIEW > PASS`; tutte non applicabili producono
      `NOT_APPLICABLE`.
- [x] Risolvere override tramite grafo aciclico.
- [x] Produrre `REVIEW` per conflitti privi di precedenza esplicita.
- [x] Garantire assenza di dipendenze da UI, storage, rete e AI.

### Gate di fase

- [x] Test unitari e property-based provano determinismo, idempotenza e combinazioni logiche.
- [x] Test avversi verificano limiti di risorse, cicli e assenza di effetti collaterali.
- [x] Replay dello stesso JSON produce byte canonicalizzati equivalenti.
- [x] `docs/verification/phase-6.md` registra i risultati.

---

## [x] Fase 7 — Rule Pack e versionamento

**Obiettivo:** selezionare una versione immutabile per dominio, giurisdizione e data.

- [x] Implementare `RulePackVersion` con SemVer, intervallo, snapshot e motivo della modifica.
- [x] Implementare clonazione controllata per creare una nuova bozza.
- [x] Separare la versione da `ActivationEvent` append-only.
- [x] Implementare resolver deterministico per dominio, giurisdizione e data.
- [x] Vietare sovrapposizioni non dichiarate.
- [x] Consentire rollback attraverso un nuovo evento, senza mutare lo storico.
- [x] Includere soltanto fonti e Rule Card approvate.
- [x] Salvare hash canonicale e snapshot esatto in ogni valutazione.

### Gate di fase

- [x] Testano boundary temporali, SemVer, sovrapposizioni e risoluzione univoca.
- [x] Testano snapshot/replay, concorrenza e tentativi di mutazione.
- [x] `docs/verification/phase-7.md` registra i risultati.

---

## [x] Fase 8 — Test runner e version diff

**Obiettivo:** impedire l’attivazione di regole prive di copertura o con regressioni non accettate.

- [x] Richiedere fixture sintetiche `PASS`, `FAIL`, `REVIEW`, `NOT_APPLICABLE` per ogni regola.
- [x] Richiedere casi per eccezioni, override, evidenze e validità temporale.
- [x] Bloccare l’attivazione se manca una fixture obbligatoria o un test fallisce.
- [x] Confrontare deterministicamente due versioni sugli stessi casi.
- [x] Elencare cambi di esito, nuovi casi incerti e possibili false conformità.
- [x] Salvare l’impact report con hash e riferimenti alle versioni.
- [x] Rendere il runner utilizzabile da CLI e API con lo stesso contratto.

### Gate di fase

- [x] Test unitari coprono classificazione e diff.
- [x] Test d’integrazione provano il blocco di pubblicazione e la stabilità del report.
- [x] Tutte le regole dimostrative hanno la matrice minima completa.
- [x] `docs/verification/phase-8.md` registra i risultati.

---

## [x] Fase 9 — Benchmark sintetico

**Obiettivo:** misurare la pipeline in modo riproducibile senza usare o descrivere materiali non
pubblicabili.

- [x] Generare deterministicamente un corpus neutrale di PDF, immagini e JSON chiaramente fittizi.
- [x] Versionare generatori, seed, manifest, hash e risultati attesi sintetici.
- [x] Congelare lo split per `caseId` con seed `42`: sviluppo 60%, calibrazione 20%, blind 20%.
- [x] Vietare tuning e ispezione orientata alla correzione sullo split blind.
- [x] Eseguire una matrice Ollama configurabile, senza rendere un modello locale specifico requisito
      universale.
- [x] Registrare modello, digest, runtime, prompt, opzioni, hardware, corpus hash e output grezzo.
- [x] Calcolare precision, recall, F1, missing rate e hallucination rate per estrazione.
- [x] Calcolare sensitivity, specificity, macro-F1 e false-negative rate per findings sintetici.
- [x] Calcolare intervalli bootstrap raggruppati per `caseId`.
- [x] Dichiarare che il gate misura riproducibilità e correttezza del runner, non accuratezza su
      scenari reali.

### Gate di fase

- [x] Due run con stessi input producono split, manifest e metriche equivalenti.
- [x] CI verifica generazione, schema e calcolo metriche con provider simulato.
- [x] Smoke test Ollama locale registra modelli disponibili e limiti.
- [x] `docs/verification/phase-9.md` include metriche, numerosità, intervalli e disclaimer.

---

## [x] Fase 10 — Calibrazione e astensione

**Obiettivo:** rendere esplicito quando il sistema deve astenersi, senza trasformare confidence
grezze in garanzie.

- [x] Implementare `CalibrationProfile` versionato per modello, tipo di fatto e corpus hash.
- [x] Separare development, calibration e blind nel calcolo delle soglie.
- [x] Implementare reliability diagram e risk-coverage curve.
- [x] Applicare fallback gerarchico soltanto sopra numerosità minime documentate.
- [x] Produrre `REVIEW` quando non esiste un profilo applicabile o sufficiente.
- [x] Impedire `PASS` automatici per rischio `HIGH` o `CRITICAL` nei profili dimostrativi.
- [x] Marcare ogni profilo sintetico con `validationScope=TECHNICAL_DEMO`.
- [x] Conservare dati, algoritmo, parametri e hash necessari al replay.

### Gate di fase

- [x] Test unitari coprono binning, fallback, soglie e astensione.
- [x] Test d’integrazione provano profili incompatibili, insufficienti e versionati.
- [x] Smoke test locale riproduce curve e report dal corpus sintetico.
- [x] `docs/verification/phase-10.md` registra risultati e limiti.

---

## [x] Fase 13 — Provenienza e audit

**Obiettivo:** rendere ogni valutazione immutabile, esportabile e riproducibile prima di esporla
tramite API o UI.

- [x] Implementare `EvaluationRun` immutabile secondo Entity–Activity–Agent.
- [x] Registrare hash di input, prompt, provider, facts, evidenze, snapshot, findings e trace.
- [x] Registrare decisioni umane e motivazioni come eventi append-only.
- [x] Collegare ogni attività a identità, ruolo e timestamp.
- [x] Canonicalizzare l’export JSON e calcolarne l’hash.
- [x] Implementare una catena verificabile per rilevare manomissioni.
- [x] Implementare replay storico senza accedere a versioni correnti mutate.

### Gate di fase

- [x] Test unitari coprono canonicalizzazione e catena hash.
- [x] Test d’integrazione coprono tampering, export/import, replay e tentativi di mutazione.
- [x] `docs/verification/phase-13.md` registra i risultati.

---

## [x] Fase 14 — API, persistenza e sicurezza

**Obiettivo:** esporre i workflow senza consentire di aggirare invarianti, ruoli o immutabilità.

- [x] Implementare persistenza PostgreSQL/Prisma per fonti, card, pack, attivazioni, test, run e
      revisioni.
- [x] Usare `jsonb` per AST e snapshot; usare un blob store locale content-addressed per gli asset.
- [x] Implementare API REST `/v1` e OpenAPI dagli stessi schemi Zod.
- [x] Restituire errori Problem Details e validare ogni payload.
- [x] Implementare idempotency key per valutazioni e pubblicazioni.
- [x] Implementare optimistic concurrency sulle risorse modificabili.
- [x] Implementare account locali, Argon2id, sessioni opache e RBAC.
- [x] Applicare rate limit locale, redazione dei log e policy di egress esplicita.
- [x] Implementare migrazioni, backup e restore verificabili.

### Gate di fase

- [x] Test d’integrazione usano PostgreSQL reale tramite Testcontainers.
- [x] Test negativi coprono auth, RBAC, idempotenza, concorrenza e immutabilità.
- [x] Migrazione pulita e backup/restore superano un round trip completo.
- [x] Scansioni di sicurezza, dipendenze e licenze completano con successo.
- [x] `docs/verification/phase-14.md` registra i risultati.

---

## [x] Fase 11 — RAG e ingestione

**Obiettivo:** assistere recupero e authoring senza attribuire autorità decisionale all’AI.

- [x] Indicizzare in pgvector soltanto versioni approvate.
- [x] Conservare fonte, versione e sezione in ogni chunk.
- [x] Filtrare retrieval per dominio, giurisdizione e validità temporale.
- [x] Generare esclusivamente Rule Card in stato `DRAFT`.
- [x] Registrare prompt, modello, citazioni, output e tentativi.
- [x] Richiedere conferma umana per qualsiasi avanzamento di workflow.
- [x] Implementare timeout, retry limitato e comportamento sicuro con Ollama indisponibile.
- [x] Misurare recall@k, citation accuracy, faithfulness e unsupported claim rate su fonti
      sintetiche.

### Gate di fase

- [x] Test unitari coprono chunking, filtri e citazioni.
- [x] Test d’integrazione coprono indice, provider simulato, retry e indisponibilità.
- [x] Nessun percorso rende operativa una fonte o regola generata dalla sola AI.
- [x] Smoke test locale registra modello e digest o una limitazione hashata.
- [x] `docs/verification/phase-11.md` registra i risultati.

---

## [ ] Fase 12 — UI di revisione

**Obiettivo:** offrire una revisione comprensibile, accessibile e tracciata.

- [ ] Realizzare un audit desk con documento/evidenze e regola/trace affiancati.
- [ ] Implementare una coda di revisione persistente.
- [ ] Consentire conferma, correzione, non applicabilità e richiesta di approfondimento.
- [ ] Richiedere motivazione per override critici.
- [ ] Non mostrare confidence non calibrata come indicatore di affidabilità.
- [ ] Rendere visibili limiti, provenienza e ambito `TECHNICAL_DEMO`.
- [ ] Impedire export finale senza revisione richiesta dal workflow.
- [ ] Applicare ruoli e optimistic concurrency anche nell’interfaccia.
- [ ] Raggiungere WCAG 2.2 AA per i flussi principali.

### Gate di fase

- [ ] Test di componenti coprono stati, errori, permessi e accessibilità.
- [ ] Playwright copre login, coda, evidenze, decisione, conflitto ed export bloccato.
- [ ] `docs/verification/phase-12.md` registra i risultati.

---

## [ ] Fase 15 — MVP dimostrativo sintetico

**Obiettivo:** dimostrare l’intero percorso tecnico senza dipendere da scenari o materiali
riservati.

- [ ] Definire fonti e Rule Pack interamente sintetici e neutrali.
- [ ] Eseguire ingestione, estrazione, valutazione, revisione, audit ed export end-to-end.
- [ ] Usare il corpus sintetico congelato della Fase 9.
- [ ] Consentire al massimo due cicli di tuning sul solo split development.
- [ ] Non modificare calibration o blind in seguito all’osservazione dei risultati finali.
- [ ] Misurare metriche, intervalli, latenza, errori tecnici e review rate.
- [ ] Produrre model card e report di limiti per ogni configurazione eseguita.
- [ ] Dichiarare in UI ed export che la validazione è esclusivamente tecnica.

### Gate di fase

- [ ] Playwright completa il percorso end-to-end con asset sintetici.
- [ ] Il report è riproducibile da seed, hash, snapshot e digest registrati.
- [ ] Nessun claim estende i risultati oltre il corpus dimostrativo.
- [ ] `docs/verification/phase-15.md` registra i risultati.

---

## [ ] Fase 16 — Apertura e release

**Obiettivo:** produrre una release sperimentale autonoma e verificare il confine pubblico su tutti
i ref.

- [ ] Eseguire la verifica da clean clone.
- [ ] Scansionare working tree, indice, cronologia, tag e ref remoti per segreti e contenuti
      vietati.
- [ ] Verificare assenza di materiali locali, identificatori riservati e metadati non pubblicabili.
- [ ] Completare documentazione di architettura, API, sviluppo, sicurezza e limiti.
- [ ] Includere esclusivamente esempi, fonti, Rule Pack e corpus sintetici.
- [ ] Aggiungere licenza Apache-2.0 e generare SBOM.
- [ ] Verificare attribuzioni e compatibilità delle licenze.
- [ ] Creare la release sperimentale `v0.1.0` senza pubblicazione npm.
- [ ] Richiedere conferma esplicita immediatamente prima di modificare la visibilità del repository.

### Gate di fase

- [ ] Tutti i gate locali e CI sono verdi da clean clone.
- [ ] Scanner di confine, segreti, licenze e SBOM sono verdi su tutti i ref.
- [ ] La release contiene soltanto asset sintetici e documentazione coerente.
- [ ] `main` è pulita, sincronizzata e tutte le fasi risultano `[x]`.
- [ ] `docs/verification/phase-16.md` registra la verifica finale.

---

## Gate comuni

Salvo eccezioni motivate per fasi esclusivamente documentali, ogni fase applicabile deve superare:

- format-check;
- lint;
- typecheck;
- build;
- test unitari;
- test di integrazione;
- contract test;
- coverage;
- scansioni di sicurezza, dipendenze e licenze;
- scansione del confine pubblico.

Soglie minime: 90% linee e funzioni, 85% branch, 100% dei rami relativi a operatori DSL, transizioni
e invarianti critiche. Le fasi documentali verificano link, schemi, esempi e clean clone senza
introdurre test artificiali. Dalla Fase 12 si aggiunge Playwright. Le Fasi 4, 9, 10, 11 e 15
includono uno smoke test Ollama locale oltre ai test con provider simulato.

## Protocollo per fase, roadmap e Git

1. Impostare la fase corrente a `[~]` senza anticipare il completamento.
2. Implementare soltanto lo scope della fase e aggiornare test/documentazione insieme al codice.
3. Eseguire i gate locali pertinenti e registrare risultati e versioni in
   `docs/verification/phase-N.md`.
4. Impostare la fase a `[x]` solo quando tutti i criteri risultano verificati.
5. Creare un commit dedicato con messaggio `phase(N): descrizione` e fare push su `main`.
6. Attendere GitHub Actions; in caso di errore, correggere nella stessa fase e non iniziare quella
   successiva.

Una modifica sostanziale all’ordine, allo scope o ai gate della roadmap richiede un ADR con
motivazione e conseguenze. Nessuna ottimizzazione può indebolire determinismo, test, audit,
astensione o confine pubblico.

La riscrittura della cronologia e il relativo force-push richiedono conferma esplicita e sono
previsti una sola volta nella Fase 0, dopo aver creato un bundle locale. Anche il cambio di
visibilità richiede una conferma separata nella Fase 16.

Il lavoro termina soltanto quando tutte le fasi sono `[x]`, i gate finali sono verdi, `main` è
pulita e sincronizzata e la release è verificata.
