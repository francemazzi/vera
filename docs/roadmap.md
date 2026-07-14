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
|      1 |    0 | Confini pubblici e fondazione | `[~]` |
|      2 |    1 | Specifica metodologica        | `[ ]` |
|      3 |    2 | Fonti di conformità           | `[ ]` |
|      4 |    3 | Rule Card                     | `[ ]` |
|      5 |    4 | Facts, evidenze ed estrattori | `[ ]` |
|      6 |    5 | DSL dichiarativa              | `[ ]` |
|      7 |    6 | Kernel deterministico         | `[ ]` |
|      8 |    7 | Rule Pack e versionamento     | `[ ]` |
|      9 |    8 | Test runner e version diff    | `[ ]` |
|     10 |    9 | Benchmark sintetico           | `[ ]` |
|     11 |   10 | Calibrazione e astensione     | `[ ]` |
|     12 |   13 | Provenienza e audit           | `[ ]` |
|     13 |   14 | API, persistenza e sicurezza  | `[ ]` |
|     14 |   11 | RAG e ingestione              | `[ ]` |
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

## [~] Fase 0 — Confini pubblici e fondazione

**Obiettivo:** predisporre un solo repository genericamente pubblicabile, una toolchain
riproducibile e controlli automatici contro l’inclusione accidentale di materiali locali.

- [ ] Riscrivere README e roadmap senza riferimenti a casi d’uso, organizzazioni, tassonomie o
      corpus riservati.
- [ ] Stabilire il confine unico: codice ed esempi sintetici tracciati; `datasets/` e altri
      materiali locali ignorati da Git.
- [ ] Creare monorepo pnpm TypeScript strict/ESM con runtime e package manager fissati.
- [ ] Aggiungere configurazioni condivise per format-check, lint, typecheck, build e test.
- [ ] Aggiungere Docker Compose per i servizi locali previsti, senza dipendenze cloud obbligatorie.
- [ ] Configurare CI, scansione di segreti, dipendenze, licenze e confine pubblico.
- [ ] Implementare uno scanner configurabile per contenuti vietati e testarlo su working tree,
      indice e cronologia raggiungibile.
- [ ] Verificare che esempi e fixture iniziali siano esclusivamente sintetici.
- [ ] Salvare un bundle Git locale prima di qualsiasi riscrittura della cronologia.
- [ ] Richiedere conferma esplicita prima di riscrivere i commit esistenti e prima dell’unico
      force-push previsto.

### Gate di fase

- [ ] Installazione pulita, lint, typecheck, build e test completano con successo.
- [ ] Scanner di segreti e confine pubblico completano con successo su tutti i ref raggiungibili.
- [ ] `datasets/` e materiali locali risultano ignorati e assenti da indice e cronologia
      pubblicabile.
- [ ] `docs/verification/phase-0.md` registra comandi, versioni, risultati e limiti.

---

## [ ] Fase 1 — Specifica metodologica

**Obiettivo:** rendere la metodologia implementabile senza decisioni interpretative residue.

- [ ] Documentare il flusso `source → rule card → rule → test → approval → activation`.
- [ ] Definire `PASS`, `FAIL`, `REVIEW` e `NOT_APPLICABLE` con truth table completa.
- [ ] Definire categorie `OBLIGATION`, `PROHIBITION` e `PERMISSION`.
- [ ] Formalizzare eccezioni, priorità, conflitti, override e non applicabilità.
- [ ] Definire rischio `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` e costi d’errore.
- [ ] Formalizzare intervalli UTC semiaperti e comportamento di `validTo=null`.
- [ ] Definire workflow, ruoli, separazione dei compiti e approvazioni richieste.
- [ ] Rendere gli esempi metodologici eseguibili come contract test.
- [ ] Dichiarare il limite di validazione tecnica e il divieto di certificazione automatica.

### Gate di fase

- [ ] Schemi, esempi e truth table concordano e superano i contract test.
- [ ] Ogni stato e transizione ha almeno un esempio sintetico valido e uno invalido.
- [ ] `docs/verification/phase-1.md` rende ripetibile la verifica.

---

## [ ] Fase 2 — Fonti di conformità

**Obiettivo:** rendere ogni fonte identificabile, verificabile e temporalmente ricostruibile.

- [ ] Implementare `ComplianceSource` e versioni append-only.
- [ ] Registrare tipo, dominio, giurisdizione, titolo, versione e riferimenti stabili.
- [ ] Registrare licenza, hash SHA-256, `validFrom` e `validTo`.
- [ ] Implementare `UPLOADED → REVIEWED → APPROVED → RETIRED`.
- [ ] Registrare attori e timestamp per ogni transizione.
- [ ] Vietare l’uso in Rule Pack attivi di fonti non approvate.
- [ ] Consentire sostituzioni senza sovrascrivere versioni storiche.
- [ ] Implementare un repository in memoria per i test di integrazione del dominio.

### Gate di fase

- [ ] Test unitari coprono hash, date, intervalli e transizioni valide/non valide.
- [ ] Test d’integrazione provano immutabilità, ricostruzione e blocco delle fonti non approvate.
- [ ] `docs/verification/phase-2.md` registra i risultati.

---

## [ ] Fase 3 — Rule Card

**Obiettivo:** introdurre un passaggio revisionabile tra fonte e regola eseguibile.

- [ ] Implementare `RuleCard` con attore, oggetto, ambito e categoria deontica.
- [ ] Registrare eccezioni, evidenze richieste, rischio e costi di falso positivo/negativo.
- [ ] Collegare ogni card a fonte e sezione stabili.
- [ ] Implementare commenti, revisioni, optimistic concurrency e audit delle modifiche.
- [ ] Applicare ruoli `AUTHOR`, `REVIEWER`, `APPROVER`, `ADMIN`.
- [ ] Vietare self-approval.
- [ ] Richiedere due approvatori distinti per rischio `HIGH` o `CRITICAL`.
- [ ] Impedire la generazione di una regola attiva da una card non approvata.

### Gate di fase

- [ ] Test unitari coprono autorizzazioni, workflow e quorum.
- [ ] Test d’integrazione coprono conflitti concorrenti e blocco dell’attivazione.
- [ ] Le identità di test sono sintetiche e marcate `TECHNICAL_DEMO`.
- [ ] `docs/verification/phase-3.md` registra i risultati.

---

## [ ] Fase 4 — Facts, evidenze ed estrattori

**Obiettivo:** rappresentare input e provenienza in modo indipendente dal metodo di estrazione.

- [ ] Implementare `Fact<T>` con valore originale, normalizzato, stato, provider e confidence
      grezza.
- [ ] Gestire `NULL`, `NOT_FOUND`, `NOT_READABLE` e `CONFLICT` senza conversioni implicite.
- [ ] Implementare `Evidence` con hash documento, pagina 1-based, testo, lingua e bounding box
      normalizzata `[0,1]`.
- [ ] Definire `ExtractorAdapter` comune che non possa restituire esiti normativi.
- [ ] Implementare adapter manuale e JSON.
- [ ] Implementare adapter OCR, vision, LLM ed embedding tramite Ollama locale.
- [ ] Registrare modello, digest, parametri, prompt e output grezzo.
- [ ] Validare ogni output con gli schemi condivisi.
- [ ] Implementare timeout, retry limitato e fallimento esplicito quando un modello non è
      disponibile.

### Gate di fase

- [ ] Test unitari coprono normalizzazione, contraddizioni e validazione.
- [ ] Test d’integrazione usano un server Ollama simulato in CI.
- [ ] Uno smoke test offline usa modelli locali pinnati e registra l’ambiente.
- [ ] Nessun adapter può produrre `PASS`, `FAIL` o `NOT_APPLICABLE`.
- [ ] `docs/verification/phase-4.md` registra i risultati.

---

## [ ] Fase 5 — DSL dichiarativa

**Obiettivo:** esprimere regole con un AST JSON validabile, limitato e privo di codice arbitrario.

- [ ] Definire un AST discriminato e generare JSON Schema dagli schemi Zod.
- [ ] Implementare `present`, `eq`, `not_eq`, `contains`, `contains_any` e `matches`.
- [ ] Implementare `greater_than`, `less_than`, `between` e operatori temporali.
- [ ] Implementare `all`, `any`, `not`, `language_present` e `same_visual_area`.
- [ ] Separare `appliesWhen` da `satisfiedWhen`.
- [ ] Implementare eccezioni, override e `unknownPolicy=REVIEW`.
- [ ] Definire confronti numerici, Unicode, date e aree visuali senza coercizioni ambigue.
- [ ] Usare regex RE2-compatible con limiti di dimensione, profondità e complessità.
- [ ] Vietare `eval`, codice arbitrario, SQL e rete.

### Gate di fase

- [ ] Ogni operatore ha casi `TRUE`, `FALSE`, `UNKNOWN`, schema invalido e input avverso.
- [ ] I rami degli operatori e delle invarianti critiche hanno copertura completa.
- [ ] `docs/verification/phase-5.md` registra i risultati.

---

## [ ] Fase 6 — Kernel deterministico

**Obiettivo:** valutare facts e regole in memoria con risultati ripetibili e spiegabili.

- [ ] Implementare parser ed evaluator puri.
- [ ] Valutare applicabilità, requisito, eccezioni e valori sconosciuti separatamente.
- [ ] Produrre `RuleFinding` e trace completa di operatori, attesi e osservati.
- [ ] Propagare le evidenze usate in ogni nodo della trace.
- [ ] Aggregare con precedenza `FAIL > REVIEW > PASS`; tutte non applicabili producono
      `NOT_APPLICABLE`.
- [ ] Risolvere override tramite grafo aciclico.
- [ ] Produrre `REVIEW` per conflitti privi di precedenza esplicita.
- [ ] Garantire assenza di dipendenze da UI, storage, rete e AI.

### Gate di fase

- [ ] Test unitari e property-based provano determinismo, idempotenza e combinazioni logiche.
- [ ] Test avversi verificano limiti di risorse, cicli e assenza di effetti collaterali.
- [ ] Replay dello stesso JSON produce byte canonicalizzati equivalenti.
- [ ] `docs/verification/phase-6.md` registra i risultati.

---

## [ ] Fase 7 — Rule Pack e versionamento

**Obiettivo:** selezionare una versione immutabile per dominio, giurisdizione e data.

- [ ] Implementare `RulePackVersion` con SemVer, intervallo, snapshot e motivo della modifica.
- [ ] Implementare clonazione controllata per creare una nuova bozza.
- [ ] Separare la versione da `ActivationEvent` append-only.
- [ ] Implementare resolver deterministico per dominio, giurisdizione e data.
- [ ] Vietare sovrapposizioni non dichiarate.
- [ ] Consentire rollback attraverso un nuovo evento, senza mutare lo storico.
- [ ] Includere soltanto fonti e Rule Card approvate.
- [ ] Salvare hash canonicale e snapshot esatto in ogni valutazione.

### Gate di fase

- [ ] Testano boundary temporali, SemVer, sovrapposizioni e risoluzione univoca.
- [ ] Testano snapshot/replay, concorrenza e tentativi di mutazione.
- [ ] `docs/verification/phase-7.md` registra i risultati.

---

## [ ] Fase 8 — Test runner e version diff

**Obiettivo:** impedire l’attivazione di regole prive di copertura o con regressioni non accettate.

- [ ] Richiedere fixture sintetiche `PASS`, `FAIL`, `REVIEW`, `NOT_APPLICABLE` per ogni regola.
- [ ] Richiedere casi per eccezioni, override, evidenze e validità temporale.
- [ ] Bloccare l’attivazione se manca una fixture obbligatoria o un test fallisce.
- [ ] Confrontare deterministicamente due versioni sugli stessi casi.
- [ ] Elencare cambi di esito, nuovi casi incerti e possibili false conformità.
- [ ] Salvare l’impact report con hash e riferimenti alle versioni.
- [ ] Rendere il runner utilizzabile da CLI e API con lo stesso contratto.

### Gate di fase

- [ ] Test unitari coprono classificazione e diff.
- [ ] Test d’integrazione provano il blocco di pubblicazione e la stabilità del report.
- [ ] Tutte le regole dimostrative hanno la matrice minima completa.
- [ ] `docs/verification/phase-8.md` registra i risultati.

---

## [ ] Fase 9 — Benchmark sintetico

**Obiettivo:** misurare la pipeline in modo riproducibile senza usare o descrivere materiali non
pubblicabili.

- [ ] Generare deterministicamente un corpus neutrale di PDF, immagini e JSON chiaramente fittizi.
- [ ] Versionare generatori, seed, manifest, hash e risultati attesi sintetici.
- [ ] Congelare lo split per `caseId` con seed `42`: sviluppo 60%, calibrazione 20%, blind 20%.
- [ ] Vietare tuning e ispezione orientata alla correzione sullo split blind.
- [ ] Eseguire una matrice Ollama configurabile, senza rendere un modello locale specifico requisito
      universale.
- [ ] Registrare modello, digest, runtime, prompt, opzioni, hardware, corpus hash e output grezzo.
- [ ] Calcolare precision, recall, F1, missing rate e hallucination rate per estrazione.
- [ ] Calcolare sensitivity, specificity, macro-F1 e false-negative rate per findings sintetici.
- [ ] Calcolare intervalli bootstrap raggruppati per `caseId`.
- [ ] Dichiarare che il gate misura riproducibilità e correttezza del runner, non accuratezza su
      scenari reali.

### Gate di fase

- [ ] Due run con stessi input producono split, manifest e metriche equivalenti.
- [ ] CI verifica generazione, schema e calcolo metriche con provider simulato.
- [ ] Smoke test Ollama locale registra modelli disponibili e limiti.
- [ ] `docs/verification/phase-9.md` include metriche, numerosità, intervalli e disclaimer.

---

## [ ] Fase 10 — Calibrazione e astensione

**Obiettivo:** rendere esplicito quando il sistema deve astenersi, senza trasformare confidence
grezze in garanzie.

- [ ] Implementare `CalibrationProfile` versionato per modello, tipo di fatto e corpus hash.
- [ ] Separare development, calibration e blind nel calcolo delle soglie.
- [ ] Implementare reliability diagram e risk-coverage curve.
- [ ] Applicare fallback gerarchico soltanto sopra numerosità minime documentate.
- [ ] Produrre `REVIEW` quando non esiste un profilo applicabile o sufficiente.
- [ ] Impedire `PASS` automatici per rischio `HIGH` o `CRITICAL` nei profili dimostrativi.
- [ ] Marcare ogni profilo sintetico con `validationScope=TECHNICAL_DEMO`.
- [ ] Conservare dati, algoritmo, parametri e hash necessari al replay.

### Gate di fase

- [ ] Test unitari coprono binning, fallback, soglie e astensione.
- [ ] Test d’integrazione provano profili incompatibili, insufficienti e versionati.
- [ ] Smoke test locale riproduce curve e report dal corpus sintetico.
- [ ] `docs/verification/phase-10.md` registra risultati e limiti.

---

## [ ] Fase 13 — Provenienza e audit

**Obiettivo:** rendere ogni valutazione immutabile, esportabile e riproducibile prima di esporla
tramite API o UI.

- [ ] Implementare `EvaluationRun` immutabile secondo Entity–Activity–Agent.
- [ ] Registrare hash di input, prompt, provider, facts, evidenze, snapshot, findings e trace.
- [ ] Registrare decisioni umane e motivazioni come eventi append-only.
- [ ] Collegare ogni attività a identità, ruolo e timestamp.
- [ ] Canonicalizzare l’export JSON e calcolarne l’hash.
- [ ] Implementare una catena verificabile per rilevare manomissioni.
- [ ] Implementare replay storico senza accedere a versioni correnti mutate.

### Gate di fase

- [ ] Test unitari coprono canonicalizzazione e catena hash.
- [ ] Test d’integrazione coprono tampering, export/import, replay e tentativi di mutazione.
- [ ] `docs/verification/phase-13.md` registra i risultati.

---

## [ ] Fase 14 — API, persistenza e sicurezza

**Obiettivo:** esporre i workflow senza consentire di aggirare invarianti, ruoli o immutabilità.

- [ ] Implementare persistenza PostgreSQL/Prisma per fonti, card, pack, attivazioni, test, run e
      revisioni.
- [ ] Usare `jsonb` per AST e snapshot; usare un blob store locale content-addressed per gli asset.
- [ ] Implementare API REST `/v1` e OpenAPI dagli stessi schemi Zod.
- [ ] Restituire errori Problem Details e validare ogni payload.
- [ ] Implementare idempotency key per valutazioni e pubblicazioni.
- [ ] Implementare optimistic concurrency sulle risorse modificabili.
- [ ] Implementare account locali, Argon2id, sessioni opache e RBAC.
- [ ] Applicare rate limit locale, redazione dei log e policy di egress esplicita.
- [ ] Implementare migrazioni, backup e restore verificabili.

### Gate di fase

- [ ] Test d’integrazione usano PostgreSQL reale tramite Testcontainers.
- [ ] Test negativi coprono auth, RBAC, idempotenza, concorrenza e immutabilità.
- [ ] Migrazione pulita e backup/restore superano un round trip completo.
- [ ] Scansioni di sicurezza, dipendenze e licenze completano con successo.
- [ ] `docs/verification/phase-14.md` registra i risultati.

---

## [ ] Fase 11 — RAG e ingestione

**Obiettivo:** assistere recupero e authoring senza attribuire autorità decisionale all’AI.

- [ ] Indicizzare in pgvector soltanto versioni approvate.
- [ ] Conservare fonte, versione e sezione in ogni chunk.
- [ ] Filtrare retrieval per dominio, giurisdizione e validità temporale.
- [ ] Generare esclusivamente Rule Card in stato `DRAFT`.
- [ ] Registrare prompt, modello, citazioni, output e tentativi.
- [ ] Richiedere conferma umana per qualsiasi avanzamento di workflow.
- [ ] Implementare timeout, retry limitato e comportamento sicuro con Ollama indisponibile.
- [ ] Misurare recall@k, citation accuracy, faithfulness e unsupported claim rate su fonti
      sintetiche.

### Gate di fase

- [ ] Test unitari coprono chunking, filtri e citazioni.
- [ ] Test d’integrazione coprono indice, provider simulato, retry e indisponibilità.
- [ ] Nessun percorso rende operativa una fonte o regola generata dalla sola AI.
- [ ] Smoke test locale registra modello e digest.
- [ ] `docs/verification/phase-11.md` registra i risultati.

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
