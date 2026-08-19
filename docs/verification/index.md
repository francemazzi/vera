---
title: Registro delle verifiche
description: Evidenze ripetibili dei gate di fase del progetto VERA.
---

# Registro delle verifiche

Ogni voce registra comandi, ambiente, risultati e limiti del gate corrispondente. Il registro rende
le affermazioni della [roadmap](../roadmap.md) ripetibili, senza trasformare una verifica tecnica in
certificazione.

| Fase | Evidenza                                      | Ambito principale                     |
| ---: | --------------------------------------------- | ------------------------------------- |
|    0 | [Confini pubblici e fondazione](./phase-0.md) | Repository, toolchain e scanner       |
|    1 | [Specifica metodologica](./phase-1.md)        | Truth table, workflow e limiti        |
|    2 | [Fonti di conformità](./phase-2.md)           | Versioni, hash e transizioni          |
|    3 | [Rule Card](./phase-3.md)                     | Revisione, autorizzazioni e quorum    |
|    4 | [Facts, evidenze ed estrattori](./phase-4.md) | Contratti di estrazione e provenienza |
|    5 | [DSL dichiarativa](./phase-5.md)              | Schema, operatori e limiti            |
|    6 | [Kernel deterministico](./phase-6.md)         | Valutazione, trace e risoluzione      |
|    7 | [Rule Pack e versionamento](./phase-7.md)     | Snapshot, SemVer e attivazioni        |
|    8 | [Test runner e version diff](./phase-8.md)    | Fixture e regressioni                 |
|    9 | [Benchmark sintetico](./phase-9.md)           | Corpus e metriche riproducibili       |
|   10 | [Calibrazione e astensione](./phase-10.md)    | Soglie e policy di review             |
|   11 | [RAG e ingestione](./phase-11.md)             | Recupero e authoring tracciato        |
|   12 | [UI di revisione](./phase-12.md)              | Flussi umani e accessibilità          |
|   13 | [Provenienza e audit](./phase-13.md)          | Ledger, hash e replay                 |
|   14 | [API, persistenza e sicurezza](./phase-14.md) | Storage e confini locali              |
|   15 | [MVP dimostrativo sintetico](./phase-15.md)   | Pipeline end-to-end                   |
|   16 | [Apertura e release](./phase-16.md)           | Release sorgente `v0.1.0`             |
|   17 | [Readiness npm e GitHub Pages](./phase-17.md) | Tarball, portale e deploy manuale     |

::: warning Interpretazione

Un gate riuscito dimostra la conformità del repository ai propri contratti tecnici nel contesto
registrato. Non dimostra conformità normativa o professionale di casi reali; lo scope resta
`TECHNICAL_DEMO`.

:::
