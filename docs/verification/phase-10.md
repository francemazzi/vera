# Verifica Fase 10 — Calibrazione e astensione

Data: 2026-07-15T16:57:03+02:00

## Esito

Fase completata. La calibrazione è implementata come profilo dimostrativo versionato e
riproducibile, con astensione esplicita quando mancano profili compatibili, campioni sufficienti o
soglie adeguate. Ogni profilo sintetico usa `validationScope=TECHNICAL_DEMO`.

## Implementazione verificata

- Package `@vera/calibration` con schemi Zod, hash canonico e modello `CalibrationProfile`.
- Calcolo soglie esclusivamente dallo split `calibration`; development e blind non contribuiscono
  alla soglia.
- Reliability diagram e curva risk-coverage serializzati nel profilo.
- Fallback gerarchico solo verso profili `factKey=null` sufficienti e dotati di soglia.
- `applyCalibration` produce `REVIEW` per profilo assente, incompatibile, insufficiente, score sotto
  soglia e `PASS` dimostrativi con rischio `HIGH` o `CRITICAL`.
- Adapter verso il benchmark sintetico della Fase 9, senza usare dataset locali ignorati.

## Profilo demo riprodotto

```text
contentHash = 1ef8f3064c91d467a862a48ada1caa1d1e6a41b402c09522899bb9b9b92e95be
threshold   = 0.9
samples     = 4 calibration cases
```

Reliability diagram:

| Bin       | Campioni | Mean score | Accuracy |
| --------- | -------- | ---------- | -------- |
| [0, 0.2)  | 0        | 0          | 0        |
| [0.2,0.4) | 0        | 0          | 0        |
| [0.4,0.6) | 1        | 0.4        | 0        |
| [0.6,0.8) | 0        | 0          | 0        |
| [0.8,1]   | 3        | 0.9        | 1        |

Risk-coverage:

| Soglia | Coverage | Risk | Campioni |
| ------ | -------- | ---- | -------- |
| 0.9    | 0.75     | 0    | 3        |
| 0.4    | 1        | 0.25 | 4        |

## Gate locale

Comando principale:

```bash
pnpm verify
```

Risultato:

- format-check, lint, typecheck, unit, integration, contract, build e public-boundary: pass.
- Test: 1256 passati, 1 skipped.
- Coverage globale:
  - statements: 96.34%
  - branch: 93.69%
  - functions: 97.13%
  - lines: 96.78%
- Public boundary standard: 609 text snapshot controllate.

Gate aggiuntivi:

```bash
pnpm --filter @vera/calibration test:smoke
pnpm security:check
VERA_BOUNDARY_SCOPES=working,index,history pnpm --filter @vera/public-boundary scan
git diff --check
```

Risultato:

- Smoke calibrazione: 1 test passato.
- OSV scanner: 216 pacchetti analizzati, nessun issue.
- Boundary working/index/history: 609 text snapshot controllate, nessun finding.
- `git diff --check`: nessun errore whitespace.

## Limiti

Il profilo deriva da corpus e provider sintetici. Misura la riproducibilità tecnica del meccanismo
di calibrazione e astensione, non l’accuratezza reale di modelli o regole. Non costituisce
validazione professionale, certificazione o consulenza.
