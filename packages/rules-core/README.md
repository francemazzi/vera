# `@vera/rules-core`

Kernel deterministico di VERA per valutare regole e Rule Pack immutabili, risolvere finding e
gestire repository in memoria con vincoli espliciti. I tipi e gli schemi di input provengono da
`@vera/contracts`.

Il tarball di rilascio deve essere creato esclusivamente con pnpm: `npm pack` e `npm publish` sono
bloccati perché npm non applica le riscritture `publishConfig` usate dal monorepo.

> **In preparazione:** la versione `0.2.0` non è ancora pubblicata su npm. Il comando seguente sarà
> valido soltanto dopo il rilascio manuale di `@vera/contracts`, seguito da `@vera/rules-core`.

```sh
npm install @vera/contracts@0.2.0 @vera/rules-core@0.2.0
```

## Requisiti

- Node.js `>=22.22.1 <23`.
- Progetto ESM (`"type": "module"`) o bundler compatibile con package ESM.
- Import esclusivamente dall'entry point pubblico; i deep import non sono supportati.

## Flusso di valutazione

```ts
import { RulePackVersionSchema } from "@vera/contracts";
import { evaluateRulePackVersion } from "@vera/rules-core";

const version = RulePackVersionSchema.parse(JSON.parse(rulePackJson));
const snapshot = evaluateRulePackVersion(version, facts, evidence, "2026-07-15T12:00:00.0001Z");

console.log(snapshot.evaluationResult.aggregateOutcome);
console.log(snapshot.evaluationResult.findings);
```

La data di valutazione è obbligatoria e rende la selezione temporale riproducibile. Un input non
valido viene rifiutato dagli schemi; un fatto o un'evidenza non disponibili possono produrre
`REVIEW`, in base alla regola e alla sua `unknownPolicy`.

## Stabilità e responsabilità

La `0.2.0` espone soltanto `@vera/rules-core`; percorsi come `@vera/rules-core/src/...` non fanno
parte dell'API. `PASS`, `FAIL`, `REVIEW` e `NOT_APPLICABLE` sono risultati tecnici deterministici.
Gli snapshot con `validationScope: "TECHNICAL_DEMO"` non costituiscono certificazione, parere legale
o prova autonoma di conformità.

La guida completa e l'esempio eseguibile sono nel repository:
[integrazione npm](https://github.com/francemazzi/vera/blob/main/docs/npm-integration.md).

## Licenza

Apache-2.0. Vedere [LICENSE](./LICENSE).
