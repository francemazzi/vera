# `@vera/contracts`

Schemi runtime Zod, tipi TypeScript e funzioni pure che definiscono il confine pubblico di VERA. Il
package include i contratti versionati per fonti, estrazioni, regole, Rule Pack, valutazioni e
snapshot di audit.

Il tarball di rilascio deve essere creato esclusivamente con pnpm: `npm pack` e `npm publish` sono
bloccati perché npm non applica le riscritture `publishConfig` usate dal monorepo.

> **In preparazione:** la versione `0.2.0` non è ancora pubblicata su npm. Il comando seguente sarà
> valido soltanto dopo il rilascio manuale.

```sh
npm install @vera/contracts@0.2.0
```

## Requisiti

- Node.js `>=22.22.1 <23`.
- Progetto ESM (`"type": "module"`) o bundler compatibile con package ESM.
- Import esclusivamente dall'entry point pubblico; i deep import non sono supportati.

## Esempio

```ts
import { EvaluationOutcomeSchema, aggregateOutcomes } from "@vera/contracts";

const outcomes = ["PASS", "REVIEW"].map((value) => EvaluationOutcomeSchema.parse(value));
const aggregateOutcome = aggregateOutcomes(outcomes);

console.log(aggregateOutcome); // REVIEW
```

Gli schemi devono validare dati provenienti da JSON o da confini esterni prima che questi vengano
passati al motore. I tipi TypeScript, da soli, non validano input runtime.

## Stabilità e responsabilità

La `0.2.0` espone soltanto `@vera/contracts`; percorsi come `@vera/contracts/src/...` non fanno
parte dell'API. Gli snapshot con `validationScope: "TECHNICAL_DEMO"` sono artefatti tecnici e non
costituiscono certificazione, parere legale o prova autonoma di conformità.

La guida completa è nel repository:
[integrazione npm](https://github.com/francemazzi/vera/blob/main/docs/npm-integration.md).

## Licenza

Apache-2.0. Vedere [LICENSE](./LICENSE).
