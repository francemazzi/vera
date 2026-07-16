# Rule testing e version diff

La Fase 8 introduce un runner deterministico per impedire la pubblicazione o attivazione di Rule
Pack privi di fixture sintetiche minime.

## Contratti

I contratti pubblici sono in `@vera/contracts`:

- `RuleTestFixture`: caso sintetico hashato con facts, evidenze, data di valutazione, target rule,
  expected finding e tag di copertura.
- `RuleTestRunRequest`: payload comune per API e CLI.
- `RuleTestRunResult`: risultati per fixture, copertura per regola e hash del risultato.
- `RulePackImpactRequest` e `RulePackImpactReport`: confronto deterministico tra due versioni sugli
  stessi casi.

Ogni fixture e report usa `validationScope=TECHNICAL_DEMO`, snapshot JSON bounded e hash SHA-256
canonicale.

## Gate minimo

Il gate predefinito richiede, per ogni regola del Rule Pack:

- `OUTCOME_PASS`
- `OUTCOME_FAIL`
- `OUTCOME_REVIEW`
- `OUTCOME_NOT_APPLICABLE`

Le fixture possono aggiungere tag specifici per `EXCEPTION`, `OVERRIDE`, `EVIDENCE`,
`VALIDITY_START` e `VALIDITY_END`. La suite dimostrativa di Fase 8 esercita tutti questi casi senza
usare dati locali o non pubblicabili.

## Runner

Il package `@vera/rules-testing` espone:

- `runRulePackTests(request)`, usato da API e codice applicativo.
- `runRuleTestingApiRequest(input)`, validazione Zod dello stesso payload JSON accettato dalla CLI.
- `diffRulePackVersions(request)`, che produce cambi di esito, nuovi `REVIEW` e possibili false
  conformità.
- `createRulePackReadinessGate(options)`, adapter per bloccare pubblicazione o attivazione tramite
  l’interfaccia opzionale di `rules-core`.

La CLI `vera-rules-test` legge lo stesso `RuleTestRunRequest` JSON e stampa un `RuleTestRunResult`.
In sviluppo locale può essere eseguita con:

```sh
pnpm --filter @vera/rules-testing exec tsx src/cli.ts request.json
```

## Version diff

Il report di impatto conserva:

- riferimenti a baseline e candidate (`versionId`, `semver`, `contentHash`);
- hash del set fixture;
- outcome baseline/candidate per caso;
- classificazioni derivate:
  - `OUTCOME_CHANGED`
  - `NEW_REVIEW`
  - `POSSIBLE_FALSE_CONFORMITY`
  - `UNCHANGED`

`POSSIBLE_FALSE_CONFORMITY` viene emesso quando una candidate trasforma un baseline `FAIL` o
`REVIEW` in `PASS` o `NOT_APPLICABLE`. Il report è tecnico e sintetico: non costituisce stima di
accuratezza reale.
