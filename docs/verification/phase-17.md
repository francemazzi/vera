# Verifica Fase 17 — Readiness npm e GitHub Pages

Data verifica: 2026-07-16

Stato: readiness locale completata. La fase resta `[~]` esclusivamente perché pubblicazione npm,
attivazione Pages e qualsiasi modifica di visibilità sono operazioni esterne manuali non eseguite.

## Ambiente

| Componente | Versione  |
| ---------- | --------- |
| Node.js    | `22.22.1` |
| pnpm       | `10.33.0` |
| VitePress  | `1.6.4`   |
| Vite       | `6.4.3`   |

## Ambito implementato

- Preparati `@vera/contracts` e `@vera/rules-core` `0.2.0` come package ESM per un futuro rilascio
  manuale, mantenendo privati gli altri workspace.
- Configurati tarball con soli `dist`, README, LICENSE e manifest riscritto da pnpm; `npm pack` e
  `npm publish` nativi vengono bloccati perché non applicano `publishConfig`.
- Aggiunti controllo packed, installazione npm esterna, typecheck, deep-import probe ed esempio
  sintetico deterministico con esito `REVIEW`.
- Aggiunti README, guida canonica, landing e portale VitePress italiano con base `/vera/`, ricerca
  locale e tema editoriale accessibile senza font, analytics o asset remoti.
- Aggiunto un workflow Pages solo `workflow_dispatch`, con build read-only e permessi Pages/OIDC
  confinati al job di deploy.
- Aggiornati architettura, release, roadmap, indici documentali e SBOM CycloneDX.

## Comandi eseguiti

```bash
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm npm:verify
pnpm docs:build
pnpm verify
pnpm security:check
VERA_BOUNDARY_SCOPES=working,index,history pnpm public-boundary:check
pnpm licenses list --prod > /tmp/vera-phase17-licenses.txt
git diff --check
```

SBOM:

```bash
pnpm dlx @cyclonedx/cyclonedx-npm@3.0.0 \
  --ignore-npm-errors \
  --output-reproducible \
  --output-format JSON \
  --spec-version 1.6 \
  --no-validate \
  --output-file docs/sbom.cdx.json \
  package.json
```

`--ignore-npm-errors` resta necessario perché il generatore interroga `npm ls`, che non rappresenta
correttamente peer/dev opzionali e workspace pnpm. Il comando ha terminato con exit code `0`; il
JSON risultante è stato verificato separatamente.

## Risultati

- `pnpm install --frozen-lockfile`: superato su 16 progetti workspace, senza warning peer.
- `pnpm npm:verify`: superato; entrambi i manifest sorgente sono validi, `npm pack` nativo è
  bloccato, i tarball pnpm rispettano l’allowlist, un progetto npm temporaneo installa i due `.tgz`,
  compila TypeScript, esegue l’esempio su Node `22.22.1` e rifiuta i deep import.
- I comandi manuali previsti `pnpm publish packages/contracts` e `pnpm publish packages/rules-core`
  sono stati verificati esclusivamente con `--dry-run` e non hanno scritto sul registry.
- `pnpm docs:build`: superato con dead-link checking; asset e route root-relative usano il prefisso
  `/vera/` e non vengono prodotti file font.
- `pnpm verify`: superato con 81 file test eseguiti e 2 saltati; 1.364 test superati e 2 saltati; 6
  test Playwright E2E superati.
- Coverage globale: 93,85% statement, 89,41% branch, 96,40% function e 94,90% linee.
- `pnpm security:check`: superato su 760 package, nessuna issue nota. Una prima scansione aveva
  rilevato quattro advisory nel Vite 5 annidato da VitePress; l’override mirato
  `vitepress>vite=6.4.3` porta Vite ed esbuild alle versioni corrette `6.4.3` e `0.25.12` senza
  cambiare il pin VitePress `1.6.4`.
- Scansione `working,index,history`: superata su 1.105 snapshot testuali.
- Inventario licenze produzione: 359 righe, nessun match `GPL`, `AGPL` o `LGPL`.
- SBOM CycloneDX 1.6: JSON valido con 935 componenti e 936 relazioni di dipendenza; include
  VitePress `1.6.4`, Vite `6.4.3` ed esbuild `0.25.12`.
- `pnpm format:check`, lint globale e `git diff --check`: superati dopo l’integrazione.

## Ispezione del portale

- Home desktop in tema chiaro e guida npm mobile in tema scuro ispezionate tramite Chromium.
- Nessun overflow a livello documento; tabelle e blocchi di codice conservano lo scroll interno.
- Navigazione responsive, switch tema, skip link, focus da tastiera a 3 px e preferenza
  `prefers-reduced-motion` verificati.
- La localizzazione visibile, la ricerca e il titolo del pulsante copia sono in italiano. Alcuni
  testi ARIA interni restano in inglese perché hardcoded nel tema predefinito VitePress 1.6.4.
- VitePress 1.6.4 emette un warning di hydration sullo stile calcolato di `VPHomeContent`; il
  warning è upstream, non modifica layout o contenuti e viene conservato come limite noto del pin
  richiesto.

## Operazioni esterne non eseguite

La Fase 17 non esegue `npm login`, publish reale, tag, GitHub Release, abilitazione Pages, avvio del
workflow di deploy o cambio di visibilità. Prima della pubblicazione l’operatore deve verificare la
proprietà dello scope `@vera`; prima del deploy Pages deve verificare il piano GitHub e configurare
Pages con sorgente GitHub Actions.

La release `v0.1.0` resta storica, immutabile e source-only. Il repository resta privato.
