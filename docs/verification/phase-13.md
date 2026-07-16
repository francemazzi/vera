# Verifica Fase 13 — Provenienza e audit

Data: 2026-07-15T17:16:12+02:00

## Esito

Fase completata. Ogni valutazione può essere registrata in un `EvaluationRun` immutabile secondo un
modello Entity–Activity–Agent, esportata in JSON canonico e rigiocata dallo snapshot storico senza
consultare versioni correnti mutate.

## Implementazione verificata

- `@vera/contracts` espone `EvaluationRun`, `ReviewDecision` ed `EvaluationAuditExport`.
- `EvaluationRun` registra hash canonicali di input, prompt, provider, facts, evidence, snapshot,
  evaluation result, findings e trace.
- Gli schemi ricalcolano hash di snapshot/result/findings/trace e rifiutano mismatch.
- `ReviewDecision` è append-only: `sequence`, `runContentHash` e `previousEventHash` formano la
  catena verificabile delle decisioni umane.
- `EvaluationAuditExport` include run e decisioni, applica la catena e calcola `exportHash`.
- `InMemoryEvaluationAuditLedger` conserva copie difensive, rifiuta duplicati, sequenze stale e
  decisioni legate a hash run non corrente.
- `replayEvaluationAuditExport` rilegge lo snapshot storico dall’export, senza accedere a repository
  attuali.
- La documentazione operativa è in `docs/audit.md`.

## Gate locale

Comando principale:

```bash
pnpm verify
```

Risultato:

- format-check, lint, typecheck, unit, integration, contract, build e public-boundary: pass.
- Test: 1262 passati, 1 skipped.
- Coverage globale:
  - statements: 95.97%
  - branch: 92.81%
  - functions: 97.21%
  - lines: 96.37%
- Public boundary standard: 640 text snapshot controllate.

Gate aggiuntivi:

```bash
pnpm security:check
VERA_BOUNDARY_SCOPES=working,index,history pnpm --filter @vera/public-boundary scan
git diff --check
```

Risultato:

- OSV scanner: 216 pacchetti analizzati, nessun issue.
- Boundary working/index/history: 640 text snapshot controllate, nessun finding.
- `git diff --check`: nessun errore whitespace.

## Copertura specifica

- Unit test contratti: canonicalizzazione export, hash run, hash decisioni, chain gap e tampering.
- Integration test ledger: export/import, replay storico, sequenze stale, tampering e snapshot
  difensivi immutabili.

## Limiti

Il ledger è intenzionalmente in memoria. La persistenza durable, vincoli DB, backup/restore e API
sono demandati alla Fase 14. Tutti gli esempi restano `TECHNICAL_DEMO` e non costituiscono
validazione professionale, certificazione o consulenza.
