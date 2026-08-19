# VERA

**Versioned Evidence-based Rules Assessment**

VERA è un motore generico per valutazioni di conformità documentali, deterministiche, versionate e
verificabili. Separa l’estrazione assistita da AI dalla decisione prodotta dal kernel di regole e
conserva fonti, fatti, evidenze, versioni e revisioni necessarie a ricostruire ogni risultato.

> **Stato del progetto:** sviluppo iniziale. La [roadmap](docs/roadmap.md) è la fonte operativa per
> avanzamento, gate e criteri di completamento.

> **Limite di validazione:** VERA fornisce una verifica esclusivamente tecnica. Esempi, Rule Pack,
> identità, approvazioni, benchmark e report distribuiti con il repository sono sintetici e hanno
> ambito `TECHNICAL_DEMO`. Non costituiscono validazione professionale, certificazione o consulenza.

## Obiettivi

- Rendere le regole serializzabili, testabili e indipendenti da database, interfaccia e provider AI.
- Distinguere sempre applicabilità, rispetto del requisito e qualità delle evidenze.
- Produrre risultati ripetibili con una trace deterministica e un audit trail immutabile.
- Inviare a revisione i casi mancanti, contraddittori o non sufficientemente supportati.
- Conservare un confine netto tra software pubblicabile e materiali locali non tracciati.

## Principi non negoziabili

1. L’AI può estrarre fatti e proporre bozze; non può approvare o attivare regole.
2. Ogni fatto usato da una regola deve essere collegato a un’evidenza verificabile.
3. Ogni finding deve identificare regola, versione, fonte e trace di valutazione.
4. Le versioni pubblicate sono immutabili; attivazioni e rollback sono eventi append-only.
5. Dati sconosciuti, mancanti, illeggibili, contraddittori o privi di evidenza producono `REVIEW`,
   mai un `PASS` implicito.
6. Il kernel non esegue JavaScript arbitrario, `eval`, SQL o chiamate di rete.
7. Nessun risultato dimostrativo viene presentato come validato da un professionista.

## Architettura target

```mermaid
flowchart LR
  I[PDF, immagine, JSON o inserimento manuale]
  X[Adapter di estrazione]
  F[Fact + Evidence]
  P[Rule Pack versionato]
  K[Kernel deterministico]
  O[PASS / FAIL / REVIEW / NOT_APPLICABLE]
  H[Revisione umana]
  A[Audit ed export]

  I --> X --> F
  F --> K
  P --> K
  K --> O --> H --> A
```

Gli adapter producono soltanto facts ed evidenze. Il resolver seleziona il Rule Pack valido per
ambito e data; il kernel riceve il relativo snapshot JSON e produce findings senza dipendere da AI,
storage o UI.

### Semantica essenziale

- Le espressioni DSL restituiscono `TRUE`, `FALSE` o `UNKNOWN`.
- `appliesWhen = FALSE` produce `NOT_APPLICABLE`.
- `appliesWhen = UNKNOWN` oppure un requisito sconosciuto produce `REVIEW`.
- Per i risultati applicabili, un requisito soddisfatto produce `PASS`; uno non soddisfatto produce
  `FAIL`.
- Nell’aggregazione, `FAIL` prevale su `REVIEW`, che prevale su `PASS`; se tutte le regole sono non
  applicabili, il risultato è `NOT_APPLICABLE`.
- Gli intervalli temporali sono UTC e semiaperti: `validFrom <= evaluationDate < validTo`;
  `validTo = null` indica durata indefinita.

## Stack target

- Monorepo TypeScript strict ed ESM, Node.js `22.22.1` e pnpm `10.33.0`.
- Schemi Zod come fonte unica per tipi TypeScript, validazione, JSON Schema e contratti API.
- API REST `/v1` con Fastify, OpenAPI, Problem Details, idempotenza e optimistic concurrency.
- PostgreSQL con Prisma, `jsonb` e `pgvector`; blob store locale content-addressed.
- React e Vite per l’interfaccia di revisione.
- Adapter Ollama predefiniti per OCR, vision, LLM ed embedding; OpenRouter opt-in per il solo LLM
  testuale e le bozze RAG.
- Vitest, fast-check, Testcontainers e Playwright per test unitari, property-based, integrazione ed
  end-to-end.

### Provider AI

Ollama resta il provider predefinito. OpenRouter usa esclusivamente il modello fissato
`meta-llama/llama-3.1-8b-instruct` per estrazione testuale e bozze Rule Card, con Zero Data
Retention e `data_collection=deny`. L’attivazione remota è esplicita e non esiste fallback
automatico da Ollama a OpenRouter; OCR, vision ed embedding restano locali tramite Ollama.

### SILTO-LABEL professionale

Il runner privato SILTO-LABEL è separato dai demo tecnici: per quel flusso OpenRouter è l'unico
provider generativo consentito e non è previsto alcun fallback a Ollama o a un modello locale. Il
runner riceve soltanto identificativi via Cloud Tasks/OIDC, legge la pagina normalizzata da GCS
privato e registra provider, modello, prompt, snapshot fonti e rule pack per ogni run. Vedi
[runner privato SILTO-LABEL](docs/label-runner.md).

## Integrazione npm — in preparazione

> **Non ancora disponibile nel registry:** `@vera/contracts` e `@vera/rules-core` sono in
> preparazione per una futura pubblicazione manuale `0.2.0`. I comandi `npm install` riportati qui
> sotto saranno validi soltanto dopo quel rilascio e oggi non devono essere usati come prova di
> disponibilità dei package.

| Package            | Uso previsto                                                       | Stato          |
| ------------------ | ------------------------------------------------------------------ | -------------- |
| `@vera/contracts`  | Schemi Zod, tipi, hash e contratti JSON pubblici                   | Non pubblicato |
| `@vera/rules-core` | Valutazione deterministica di Rule Pack e risoluzione dei findings | Non pubblicato |

L’integrazione richiede Node.js `>=22.22.1 <23` ed è esclusivamente ESM. Sono supportati soltanto
gli import dalla radice dei package; i deep import verso `src`, `dist` o file interni non fanno
parte dell’interfaccia pubblica.

Dopo la futura pubblicazione, l’installazione prevista sarà:

```bash
# Valido soltanto dopo la pubblicazione manuale della versione 0.2.0.
npm install @vera/contracts@0.2.0 @vera/rules-core@0.2.0
```

Il percorso minimo è `JSON validato → evaluateRulePackVersion → aggregateOutcome/findings`:

```ts
import { EvidenceSchema, FactSchema, RulePackVersionSchema } from "@vera/contracts";
import { evaluateRulePackVersion } from "@vera/rules-core";

const rulePack = RulePackVersionSchema.parse(rulePackJson);
const facts = FactSchema.array().parse(factsJson);
const evidence = EvidenceSchema.array().parse(evidenceJson);

const snapshot = evaluateRulePackVersion(rulePack, facts, evidence, "2026-01-15T00:00:00.000Z");

console.log(snapshot.evaluationResult.aggregateOutcome);
console.log(snapshot.evaluationResult.findings);
```

Nello snippet, `rulePackJson`, `factsJson` ed `evidenceJson` rappresentano JSON caricati
dall’applicazione; la guida completa include un esempio sintetico eseguibile. La data di valutazione
è esplicita per conservare determinismo e corretta risoluzione temporale.

| Esito            | Significato sintetico                                                   |
| ---------------- | ----------------------------------------------------------------------- |
| `PASS`           | Il requisito applicabile è soddisfatto da input ed evidenze valide      |
| `FAIL`           | Il requisito applicabile non è soddisfatto                              |
| `REVIEW`         | Input, applicabilità o evidenze sono mancanti, incerti o contraddittori |
| `NOT_APPLICABLE` | La regola non si applica al caso valutato                               |

Ogni snapshot prodotto da questa integrazione mantiene `validationScope=TECHNICAL_DEMO`: l’esito
dimostra il funzionamento tecnico del kernel e non è una certificazione, una validazione
professionale o una consulenza. Per input completi, errori di parsing, validità temporale e
compatibilità delle versioni, vedere la [guida all’integrazione npm](docs/npm-integration.md).

## Struttura del repository

VERA usa un solo repository. I confini sono applicati tramite struttura, `.gitignore`, controlli
automatici e dati dimostrativi sintetici.

```text
vera/
├── apps/
│   ├── api/
│   └── web/
├── packages/
│   ├── contracts/
│   ├── benchmark/
│   ├── calibration/
│   ├── dataset-harness/
│   ├── demo-mvp/
│   ├── extractors/
│   ├── public-boundary/
│   ├── rag/
│   ├── rules-core/
│   ├── rules-testing/
│   └── storage/
├── examples/                 # solo scenari sintetici pubblicabili
├── docs/
│   ├── npm-integration.md
│   ├── roadmap.md
│   └── verification/         # evidenze dei gate per fase
├── datasets/                 # materiale locale ignorato da Git
└── README.md
```

Il contenuto locale di `datasets/` non è parte del prodotto pubblicabile, non è una fixture di test
e non è un criterio di completamento. Test, benchmark, demo e release usano esclusivamente corpus
sintetici tracciati e chiaramente identificati.

## Modello pubblico

I contratti principali previsti sono:

- `ComplianceSource` e versioni append-only;
- `RuleCard` e workflow di revisione/approvazione;
- `Fact<T>` ed `Evidence` con localizzazione normalizzata;
- `RuleDefinition`, AST DSL e `RuleFinding`;
- `RulePackVersion` e `ActivationEvent` separati;
- `EvaluationRun`, `ReviewDecision` e `CalibrationProfile` immutabili;
- `ExtractorAdapter` comune per input manuali, JSON e provider locali.

Le evidenze usano pagine 1-based e bounding box normalizzate in `[0,1]`, con origine nell’angolo
superiore sinistro. Hash di file e snapshot canonicalizzati sono SHA-256.

## Strategia di test e rilascio

Ogni fase deve superare i gate pertinenti prima di essere chiusa:

- format-check, lint, typecheck e build;
- test unitari, di integrazione, contract e property-based;
- soglie di copertura definite nella roadmap;
- scansioni di sicurezza, licenze, segreti e confine pubblico;
- Playwright dalla fase UI;
- smoke test locali Ollama nelle fasi che esercitano adapter o benchmark;
- smoke test OpenRouter separato, sintetico e opt-in, escluso dai gate normali.

Al termine di una fase vengono salvate le evidenze in `docs/verification/phase-N.md`, aggiornata la
roadmap, creato un commit dedicato e verificata la CI prima di iniziare la fase seguente.

## Ordine di sviluppo

| Ordine | Fase | Risultato                       | Stato |
| -----: | ---: | ------------------------------- | :---: |
|      1 |    0 | Confini pubblici e fondazione   | `[x]` |
|      2 |    1 | Specifica metodologica          | `[x]` |
|      3 |    2 | Fonti di conformità             | `[x]` |
|      4 |    3 | Rule Card                       | `[x]` |
|      5 |    4 | Facts, evidenze ed estrattori   | `[x]` |
|      6 |    5 | DSL dichiarativa                | `[x]` |
|      7 |    6 | Kernel deterministico           | `[x]` |
|      8 |    7 | Rule Pack e versionamento       | `[x]` |
|      9 |    8 | Test runner e version diff      | `[x]` |
|     10 |    9 | Benchmark sintetico             | `[x]` |
|     11 |   10 | Calibrazione e astensione       | `[x]` |
|     12 |   13 | Provenienza e audit             | `[x]` |
|     13 |   14 | API, persistenza e sicurezza    | `[~]` |
|     14 |   11 | RAG e ingestione                | `[x]` |
|     15 |   12 | UI di revisione                 | `[x]` |
|     16 |   15 | MVP dimostrativo sintetico      | `[x]` |
|     17 |   16 | Apertura e release sperimentale | `[~]` |
|     18 |   17 | Readiness npm e GitHub Pages    | `[~]` |

L’ordine intenzionale porta audit e persistenza prima di RAG e UI, così queste funzionalità nascono
già sopra contratti stabili e tracciabili.

## Materiali pubblicabili

- Sono ammessi soltanto esempi, corpus, fonti, Rule Pack e identità sintetici.
- Gli asset sintetici devono riportare chiaramente `validationScope=TECHNICAL_DEMO`.
- Scanner automatici controllano working tree, indice e cronologia raggiungibile prima di una
  release.
- L’apertura del repository richiede l’ultimo gate della Fase 16 e una conferma esplicita
  dell’operatore.

## Documentazione

- [Roadmap completa](docs/roadmap.md)
- [Architettura](docs/architecture.md)
- [Sviluppo locale](docs/development.md)
- [Metodologia normativa](docs/methodology.md)
- [DSL dichiarativa](docs/dsl.md)
- [Kernel deterministico](docs/kernel.md)
- [Rule Pack e risoluzione temporale](docs/rule-packs.md)
- [Rule testing e version diff](docs/rule-testing.md)
- [Benchmark sintetico](docs/benchmark.md)
- [Calibrazione e astensione](docs/calibration.md)
- [Provenienza e audit](docs/audit.md)
- [API, persistenza e sicurezza locale](docs/api-storage.md)
- [Audit locale di dataset](docs/local-dataset-audit.md)
- [RAG e ingestione editoriale](docs/rag.md)
- [UI di revisione](docs/ui-review.md)
- [MVP dimostrativo sintetico](docs/demo-mvp.md)
- [Runner privato SILTO-LABEL](docs/label-runner.md)
- [Release sperimentale](docs/release.md)
- [Integrazione npm](docs/npm-integration.md)
- [Security policy](SECURITY.md)

## Licenza

VERA è distribuito con licenza [Apache-2.0](LICENSE). La release `v0.1.0` è sperimentale e non
include pubblicazione npm: resta la release storica source-only. Anche i package candidati per la
versione `0.2.0` non sono ancora pubblicati.
