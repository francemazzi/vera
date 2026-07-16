# UI di revisione

`apps/web` è l’audit desk locale dimostrativo di VERA. È una app React/Vite con TanStack Query,
asset locali, PDF.js dichiarato come renderer documentale e coda persistente in `localStorage`.

## Flusso

1. L’utente seleziona un ruolo demo locale: `AUTHOR`, `REVIEWER`, `APPROVER` o `ADMIN`.
2. La coda mostra casi sintetici con stato `PENDING` o `REVIEWED`.
3. Il pannello sinistro mostra documento, testo e evidenze.
4. Il pannello destro mostra regola, rischio, provenienza, trace e form di decisione umana.
5. L’export resta disabilitato finché tutti gli elementi richiesti non sono revisionati.

## Invarianti UI

- L’ambito `TECHNICAL_DEMO` è sempre visibile.
- La UI non mostra confidence non calibrata come indicatore di affidabilità.
- I ruoli `AUTHOR` sono read-only; `REVIEWER`, `APPROVER` e `ADMIN` possono salvare decisioni.
- Le decisioni supportate sono conferma, correzione, non applicabilità e approfondimento.
- Gli override su regole `CRITICAL` richiedono motivazione obbligatoria.
- Ogni salvataggio usa una versione vista dalla UI; se la versione corrente cambia, viene mostrato
  un conflitto di concorrenza ottimistica.
- L’export finale è bloccato finché la coda contiene revisioni pendenti.

## Test

- Unit/component test: stati, errori, permessi, coda persistente e accessibilità semantica.
- Integration test: workflow completo su coda persistente ed export bloccato fino a revisione.
- Playwright: login, coda, evidenze, decisione, conflitto, ruolo read-only, export bloccato e
  scansione axe del flusso principale.

La UI è dimostrativa e locale: non costituisce validazione professionale, certificazione o
consulenza.
