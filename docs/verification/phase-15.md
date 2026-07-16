# Verifica Fase 15 — MVP dimostrativo sintetico

Data verifica: 2026-07-15T19:25:00+02:00

## Ambito implementato

- Aggiunto `packages/demo-mvp` come orchestratore end-to-end tecnico.
- Il package genera il corpus sintetico congelato della Fase 9 con seed `42`.
- Il flusso definisce fonte sintetica approvata, Rule Pack demo, ingestione documenti, estrazione
  tramite adapter manuale locale, valutazione kernel, revisione demo, audit export, benchmark,
  calibrazione e report finale.
- Aggiunta CLI di report:

  ```bash
  pnpm --filter @vera/demo-mvp build
  pnpm --silent --filter @vera/demo-mvp report > /tmp/vera-demo-mvp-report.json
  ```

- Aggiunta documentazione in `docs/demo-mvp.md`.
- Esteso Playwright web con un caso che esegue il report MVP e completa il workflow di revisione UI.

## Report riproducibile

Report hash: `b4dc4de58e4ef2180165971ff2f62395c7ba8ab9e0503100563b9352d39dcdc4`

Hash principali:

- Corpus: `2368ce6f0e8f79049fab19148b74bb6c0651c9b9df10a32db9ff85ce0a40d8ab`
- Fonte sintetica: `c6526f4bc89b6b95c9b6c1e572ca89b253db48a6e4d09b4a85b92d1b6ae57ffa`
- Rule Pack: `0625edbf80b23d65b0697ad0ca451b762f5354013de501dbf22d9891d7d50edc`
- Gate Rule Pack: `3db7f1bb0193365beba63bbca874a59e57a9e0931832e618f98c7af7eabe352c`
- Snapshot valutazioni: `fe52deb03eddd680f4a49cefae87b635ff34f1c78234e9832248d9225a3987ca`
- Export audit: `4246dd04fce9284431f5ead538ec50ca3ad176ff165041d7964abcfa77572a1d`
- Replay audit: `b423f035bedcd4d49c29829aaeb1d12a52a098fa6f716129eaef2ce02a05b4b1`
- Benchmark: `0c537fe9ed14705b9090cc75098d655f80c87a29f8ca7ad02e0f0eef44d85420`
- Calibrazione: `16c0f0990a2a1a3448f52db3d20415be8fa9512d2484689f9fc9e1ea34463bde`

Risultati principali:

- 20 casi sintetici: 12 development, 4 calibration, 4 blind.
- 60 documenti: 20 PDF, 20 immagini SVG, 20 JSON.
- 20 valutazioni su 20 corrispondono all’esito atteso.
- Esiti bilanciati: 5 `PASS`, 5 `FAIL`, 5 `REVIEW`, 5 `NOT_APPLICABLE`.
- Review rate: `0.25`.
- Export audit: 20 run esportate e riproducibili.
- Tuning: 2 cicli massimi, entrambi limitati al development set; blind immutabile.
- Calibrazione demo: `HIGH_RISK_PASS_BLOCKED`, quindi decisione `REVIEW`.

Metriche sintetiche con CI bootstrap:

- Extraction precision `0.9620`, CI `[0.9259, 1]`.
- Extraction recall `0.95`, CI `[0.9, 0.9875]`.
- Extraction F1 `0.9560`, CI `[0.9290, 0.9814]`.
- Findings macro-F1 `0.8920`, CI `[0.75, 1]`.
- Findings sensitivity `0.6`, CI `[0.2, 1]`.
- Findings specificity `1`, CI `[1, 1]`.
- False-negative rate `0.4`, CI `[0, 0.8]`.
- Latenza sintetica: min `13 ms`, media `22.5 ms`, p95 `31 ms`, max `32 ms`.

## Gate locali

Comandi eseguiti:

```bash
pnpm typecheck
pnpm --filter @vera/demo-mvp test:unit
pnpm --filter @vera/demo-mvp test:integration
pnpm --filter @vera/demo-mvp test:smoke
pnpm --filter @vera/web test:e2e
pnpm verify
pnpm security:check
VERA_BOUNDARY_SCOPES=working,index,history pnpm --filter @vera/public-boundary scan
pnpm licenses list --prod > /tmp/vera-licenses.txt
rg "GPL|AGPL|LGPL" /tmp/vera-licenses.txt || true
git diff --check
```

Risultati:

- Typecheck monorepo: superato.
- `@vera/demo-mvp` unit: 1 file, 2 test superati.
- `@vera/demo-mvp` integration: 1 file, 2 test superati.
- `@vera/demo-mvp` smoke Ollama: 1 file, 1 test superato; registra disponibilità locale o limite
  esplicito.
- Playwright web: 6 test superati, incluso percorso MVP sintetico e workflow revisione/export.
- `pnpm verify`: superato con 71 file test superati, 1 saltato; 1299 test superati, 1 saltato.
- Coverage globale: 94,5% statement, 90,64% branch, 96,08% funzioni, 94,95% linee.
- Scansione sicurezza: superata su 597 pacchetti, nessuna issue rilevata.
- Scansione confine pubblico su working tree, indice e cronologia: superata con 900 snapshot
  testuali.
- Licenze produzione: 359 righe inventario, nessun match `GPL`, `AGPL` o `LGPL`.
- `git diff --check`: nessun errore.

## Limiti

Il risultato misura soltanto riproducibilità, schema, tracciabilità e completamento tecnico della
pipeline. Corpus, fonte, Rule Pack, facts, evidenze, revisioni, benchmark e profili sono sintetici e
marcati `TECHNICAL_DEMO`. Nessun risultato costituisce accuratezza reale, validazione professionale,
certificazione o consulenza.
