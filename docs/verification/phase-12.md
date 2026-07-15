# Verifica Fase 12 — UI di revisione

Data verifica: 2026-07-15T18:51:31+02:00

## Ambito implementato

- Aggiunta `apps/web`, applicazione React/Vite locale con TanStack Query, PDF.js come renderer
  documentale dichiarato e asset completamente locali.
- Realizzato audit desk a due pannelli: documento/evidenze a sinistra, regola/trace/decisione a
  destra.
- Implementata coda di revisione persistente in `localStorage` con casi sintetici marcati
  `TECHNICAL_DEMO`.
- Supportate decisioni umane di conferma, correzione, non applicabilità e approfondimento.
- Richiesta motivazione obbligatoria per override su regole `CRITICAL`.
- Applicati ruoli demo locali: `AUTHOR` in sola lettura; `REVIEWER`, `APPROVER` e `ADMIN` abilitati
  al salvataggio delle decisioni.
- Applicata concorrenza ottimistica con versione vista dalla UI e messaggio di conflitto.
- Bloccato l’export finché tutte le revisioni richieste non sono completate.
- Non vengono mostrati valori di confidence non calibrata.
- Aggiunta documentazione operativa in `docs/ui-review.md`.

## Test e gate locali

Comandi eseguiti:

```bash
pnpm verify
pnpm security:check
VERA_BOUNDARY_SCOPES=working,index,history pnpm --filter @vera/public-boundary scan
pnpm licenses list --prod > /tmp/vera-licenses.txt
rg "GPL|AGPL|LGPL" /tmp/vera-licenses.txt || true
git diff --check
```

Risultati registrati prima del commit:

- `pnpm verify`: superato.
- Vitest: 68 file superati, 1 saltato; 1294 test superati, 1 saltato.
- Playwright: 5 test end-to-end superati sul workflow principale.
- Coverage globale: 94,53% statement, 90,96% branch, 95,86% funzioni, 94,96% linee.
- Test componenti: stati, errori, permessi e accessibilità semantica.
- Test integrazione: export bloccato finché la coda persistente non è completamente revisionata.
- Test Playwright: login, coda, evidenze, decisione, conflitto, ruolo read-only, export bloccato e
  scansione axe del flusso principale.
- Scansione sicurezza: superata su 597 pacchetti, nessuna issue rilevata.
- Scansione confine pubblico su working tree, indice e cronologia: superata con 831 snapshot
  testuali.
- Licenze produzione: 359 righe inventario, nessun match `GPL`, `AGPL` o `LGPL`.
- `git diff --check`: nessun errore.

## Limiti

La UI è una dimostrazione tecnica locale. Fonti, regole, evidenze, ruoli e decisioni incluse sono
sintetici e non costituiscono validazione professionale, certificazione o consulenza.
