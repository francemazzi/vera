# Benchmark sintetico

La Fase 9 introduce un benchmark interamente sintetico per verificare la riproducibilità del runner,
degli schemi e del calcolo metriche. Non misura accuratezza reale e non costituisce validazione
professionale.

## Corpus

Il package `@vera/benchmark` genera 20 casi fittizi con seed fissato a `42`. Ogni caso contiene:

- un documento PDF sintetico;
- una immagine SVG sintetica;
- un documento JSON sintetico;
- facts attesi;
- outcome atteso tra `PASS`, `FAIL`, `REVIEW` e `NOT_APPLICABLE`;
- `validationScope=TECHNICAL_DEMO`.

Il corpus generato ha hash canonico:

```text
2368ce6f0e8f79049fab19148b74bb6c0651c9b9df10a32db9ff85ce0a40d8ab
```

## Split congelato

Lo split è deterministico per `caseId` e seed `42`:

| Split       | Casi                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| development | `case-0001`, `case-0002`, `case-0003`, `case-0004`, `case-0005`, `case-0007`, `case-0009`, `case-0010`, `case-0012`, `case-0013`, `case-0016`, `case-0019` |
| calibration | `case-0008`, `case-0017`, `case-0018`, `case-0020`                                                                                                         |
| blind       | `case-0006`, `case-0011`, `case-0014`, `case-0015`                                                                                                         |

La distribuzione è 60% sviluppo, 20% calibrazione e 20% blind. Ogni outcome appare cinque volte.

## Provider e matrice

`runSyntheticBenchmark` accetta una matrice configurabile di provider simulati compatibili con il
contratto Ollama: modello, digest, runtime, prompt, opzioni, hardware, corpus hash e raw output sono
registrati in ogni `BenchmarkProviderRun`.

La CI usa `SIMULATED_OLLAMA`. Il probe `probeOllama` tenta anche `/api/tags` su Ollama locale e
produce un risultato hashato sia quando trova modelli locali sia quando registra una limitazione
esplicita.

## Metriche

Il runner calcola:

- estrazione: precision, recall, F1, missing rate e hallucination rate;
- findings: sensitivity, specificity, macro-F1 e false-negative rate;
- intervalli bootstrap raggruppati per caso.

Con il provider simulato e 50 iterazioni bootstrap il report dimostrativo produce:

| Metrica             | Valore | CI low | CI high |
| ------------------- | -----: | -----: | ------: |
| precision           | 0.9620 | 0.9268 |  0.9873 |
| recall              | 0.9500 | 0.9125 |  0.9875 |
| F1 estrazione       | 0.9560 | 0.9308 |  0.9809 |
| missing rate        | 0.0500 | 0.0125 |  0.0875 |
| hallucination rate  | 0.0380 | 0.0127 |  0.0714 |
| sensitivity         | 0.6000 | 0.2000 |  1.0000 |
| specificity         | 1.0000 | 1.0000 |  1.0000 |
| macro-F1 findings   | 0.8920 | 0.7500 |  1.0000 |
| false-negative rate | 0.4000 | 0.0000 |  0.8000 |

Il gate della fase riguarda generazione, schema, riproducibilità, completamento del runner e calcolo
metriche. Questi numeri sono proprietà del corpus e del provider simulato, non claim di accuratezza
su dati reali.
