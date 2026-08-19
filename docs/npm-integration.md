---
title: Integrazione npm
description: Guida canonica all’uso futuro di @vera/contracts e @vera/rules-core.
---

# Integrazione npm

Questa guida descrive il confine pubblico previsto per `@vera/contracts` e `@vera/rules-core` nella
versione `0.2.0`. I package sono **preparati per il rilascio, ma non sono ancora pubblicati su
npm**.

::: warning Distribuzione non ancora attiva

I comandi di installazione diventeranno validi soltanto dopo la pubblicazione manuale. Prima di
allora, npm non è un canale supportato e questa pagina non deve essere interpretata come annuncio di
disponibilità.

:::

## Package e requisiti

| Package            | Responsabilità                                                 | Stato                             |
| ------------------ | -------------------------------------------------------------- | --------------------------------- |
| `@vera/contracts`  | Schemi Zod, tipi e funzioni di hash per gli oggetti di dominio | `0.2.0` preparato, non pubblicato |
| `@vera/rules-core` | Kernel deterministico, risoluzione e repository in memoria     | `0.2.0` preparato, non pubblicato |

Il consumer deve usare Node.js `>=22.22.1 <23`, ESM nativo e TypeScript in modalità compatibile con
gli export ESM. I package espongono soltanto l’entrypoint radice: i deep import non fanno parte
dell’interfaccia supportata.

Dopo il futuro rilascio manuale:

```bash
# Valido soltanto dopo la pubblicazione di 0.2.0:
npm install @vera/contracts@0.2.0 @vera/rules-core@0.2.0
```

## Flusso minimo

Il percorso di integrazione è intenzionalmente esplicito:

```text
JSON non fidato
  → parsing con gli schemi di @vera/contracts
  → evaluateRulePackVersion(version, facts, evidence, evaluationDate)
  → snapshot.evaluationResult.aggregateOutcome
  → snapshot.evaluationResult.findings
```

1. Valida ogni oggetto ricevuto al confine dell’applicazione; i tipi TypeScript non sostituiscono il
   parsing runtime.
2. Passa una versione immutabile del Rule Pack, facts ed evidenze già validati.
3. Fornisci sempre una data UTC esplicita: non usare l’orologio di sistema come input implicito.
4. Conserva lo snapshot completo. L’esito aggregato è una sintesi; i finding e le trace spiegano la
   decisione.

## Esempio canonico

L’esempio seguente usa soltanto dati sintetici, viene compilato ed eseguito dalla verifica npm ed è
la sorgente canonica anche per questa pagina.

<<< ../examples/npm-integration/src/index.ts#npm-integration

La funzione restituisce uno snapshot di valutazione, non un semplice booleano. Il consumer dovrebbe
mostrare l’esito aggregato insieme ai finding che lo determinano e conservare `contentHash`, data e
versione per il replay.

## Semantica degli esiti

| Esito            | Significato tecnico                                                                     | Azione del consumer                                                       |
| ---------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `PASS`           | Le regole applicabili risultano soddisfatte con gli input disponibili                   | Conservare comunque finding e trace                                       |
| `FAIL`           | Almeno un finding effettivo indica un requisito non soddisfatto                         | Mostrare le regole coinvolte; non ridurre l’esito a un messaggio generico |
| `REVIEW`         | Applicabilità, evidenza, override o conflitto non consentono una conclusione automatica | Inviare a revisione umana senza convertirlo in `PASS` o `FAIL`            |
| `NOT_APPLICABLE` | Tutti i finding risultano non applicabili alla data e al contesto                       | Conservare la motivazione di non applicabilità                            |

L’aggregazione applica la precedenza `FAIL > REVIEW > PASS`; se tutti i finding sono
`NOT_APPLICABLE`, anche l’esito aggregato è `NOT_APPLICABLE`. L’assenza di una versione risolvibile
o un Rule Pack vuoto è invece un errore, non una non applicabilità.

## Errori e casi limite

### JSON invalido

Usa `.parse()` quando un input non valido deve interrompere il flusso, oppure `.safeParse()` quando
l’applicazione deve trasformare gli issue di Zod in una risposta strutturata. Non passare al kernel
oggetti ottenuti con cast TypeScript o validazione parziale.

### Validità temporale

`evaluateRulePackVersion` rifiuta con `RangeError` una data esterna all’intervallo di validità della
versione. Gli intervalli sono UTC e semiaperti: `validFrom` è incluso, `validTo` è escluso; un
`validTo` nullo lascia aperto il limite superiore.

### Evidenze mancanti o illeggibili

Un input strutturalmente valido può non contenere prova sufficiente per valutare una condizione. In
quel caso il valore logico è `UNKNOWN` e la policy pubblica lo traduce in `REVIEW`. Non colmare
l’assenza con valori predefiniti e non trattare `UNKNOWN` come `FALSE`.

### Determinismo

A parità di Rule Pack, facts, evidenze e data UTC, la valutazione produce lo stesso contenuto
canonico. Il consumer deve evitare di introdurre dati ambientali nel pre-processing e deve
conservare l’esatta versione degli input usati.

## Compatibilità e aggiornamenti

- La versione npm dei package e la SemVer interna di un Rule Pack sono concetti distinti.
- Aggiorna `@vera/contracts` e `@vera/rules-core` insieme alla stessa release compatibile;
  `rules-core` dipende dal corrispondente contratto packed.
- Importa solo da `@vera/contracts` e `@vera/rules-core`. Percorsi come `@vera/contracts/src/...` o
  `@vera/rules-core/dist/...` non sono API pubbliche.
- Prima di un aggiornamento, esegui le fixture del tuo Rule Pack e confronta gli snapshot attesi.
- La futura pubblicazione manuale deve avvenire nell’ordine `@vera/contracts` → `@vera/rules-core`.

Per la semantica completa consulta [Metodologia](./methodology.md), [DSL](./dsl.md),
[Kernel](./kernel.md) e [Rule Pack](./rule-packs.md).

## Limite di validazione

`TECHNICAL_DEMO` è l’unico scope accettato dai contratti distribuiti in questa fase. VERA dimostra
il funzionamento tecnico su materiali sintetici: nessun risultato costituisce certificazione,
consulenza, validazione professionale o decisione normativa automatica. Una revisione umana può
registrare una decisione successiva, ma non deve riscrivere i finding originali.
