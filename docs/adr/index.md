---
title: Decisioni architetturali
description: Registro delle scelte che definiscono i confini tecnici di VERA.
---

# Decisioni architetturali

Gli Architecture Decision Record conservano il contesto, la scelta e le conseguenze dei confini
principali. Sono parte del registro tecnico: una modifica sostanziale si documenta con un nuovo ADR,
non riscrivendo retroattivamente la motivazione di una decisione accettata.

| ADR                                                   | Decisione                                                   | Tema                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| [0001](./0001-public-core-boundary.md)                | Public core and private evaluation boundary                 | Separazione fra codice pubblicabile e materiali locali |
| [0002](./0002-typescript-monorepo.md)                 | Strict TypeScript monorepo and local-first runtime          | Toolchain, ESM e riproducibilità locale                |
| [0003](./0003-dsl-boundaries-and-value-semantics.md)  | Bounded DSL and explicit value semantics                    | Linguaggio dichiarativo e logica a tre valori          |
| [0004](./0004-deterministic-kernel-and-resolution.md) | Deterministic evaluation and explicit precedence resolution | Purezza del kernel, override e conflitti               |
| [0005](./0005-immutable-rule-pack-ledger.md)          | Immutable Rule Pack snapshots and append-only activation    | Versioni, attivazioni e replay storico                 |
| [0006](./0006-corrective-phase-14-boundary.md)        | Corrective Phase 14 boundary                                | Correzione del confine di persistenza                  |

::: info Regola di lettura

Gli ADR descrivono decisioni tecniche, non attestazioni di conformità. Esempi, identità e dati
dimostrativi restano sintetici e limitati a `TECHNICAL_DEMO`.

:::
