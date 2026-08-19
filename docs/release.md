# Release sperimentale v0.1.0

La prima release è una release sorgente sperimentale. Non pubblica pacchetti npm e non cambia la
visibilità del repository senza conferma esplicita.

Il tag `v0.1.0` è storico e immutabile. Una verifica correttiva successiva ha riaperto la Fase 14:
la release non include persistenza di tutti gli aggregati dichiarati né restore storage. Vedere
l'ADR 0006 e la roadmap corrente.

## Readiness `0.2.0` — non pubblicata

La Fase 17 prepara `@vera/contracts` e `@vera/rules-core` per una futura pubblicazione npm manuale
alla versione `0.2.0`. La preparazione non cambia lo stato della release storica: nessuno dei due
package è ancora disponibile nel registry e il repository non dichiara un’installazione npm già
operativa.

La distribuzione prevista è ESM-only per Node.js `>=22.22.1 <23`, con soli import dalla radice dei
package. I tarball includono l’output `dist`, README, licenza e manifest; gli export di sviluppo da
`src` restano un dettaglio del workspace. La pubblicazione futura deve avvenire nell’ordine:

1. `@vera/contracts@0.2.0`;
2. `@vera/rules-core@0.2.0`, dipendente dalla stessa versione di `@vera/contracts`.

Prima di qualsiasi publish, l’operatore deve verificare la proprietà dello scope npm `@vera`,
autenticarsi e ispezionare i tarball prodotti da `pnpm npm:verify`. Login e publish sono
deliberatamente fuori dallo scope automatizzato della Fase 17.

Il rilascio deve usare esclusivamente pnpm, perché è il package manager che riscrive export, tipi e
dipendenze workspace nel manifest distribuito. I lifecycle dei due package bloccano deliberatamente
`npm pack` e `npm publish`. Dopo autenticazione e verifica, la sequenza manuale prevista è:

```bash
pnpm publish packages/contracts
pnpm publish packages/rules-core
```

La stessa fase prepara un portale VitePress con base `/vera/` e un workflow GitHub Pages solo
manuale. Il repository resta privato; compatibilità del piano GitHub, abilitazione della sorgente
GitHub Actions e primo avvio del workflow restano operazioni esterne. L’URL previsto
`https://francemazzi.github.io/vera/` non è considerato attivo finché il deploy manuale non è stato
completato.

## Contenuto previsto

- Monorepo TypeScript strict/ESM.
- API locale Fastify e UI audit desk.
- Kernel, DSL, Rule Pack, audit, RAG, calibrazione e MVP sintetico.
- Corpus, fonti, Rule Pack e report esclusivamente sintetici.
- Licenza Apache-2.0.
- SBOM CycloneDX in `docs/sbom.cdx.json`.

## Comandi di verifica

Readiness npm e documentazione, da completare prima della pubblicazione o dell’attivazione Pages:

```bash
pnpm install --frozen-lockfile
pnpm npm:verify
pnpm docs:build
pnpm verify
pnpm security:check
VERA_BOUNDARY_SCOPES=working,index,history pnpm public-boundary:check
```

I risultati correnti della Fase 17 sono registrati in
[`docs/verification/phase-17.md`](verification/phase-17.md). L’elenco seguente conserva i comandi
usati per verificare la release storica `v0.1.0`.

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm security:check
VERA_BOUNDARY_SCOPES=working,index,history pnpm --filter @vera/public-boundary scan
pnpm licenses list --prod > /tmp/vera-licenses.txt
rg "GPL|AGPL|LGPL" /tmp/vera-licenses.txt || true
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

`--ignore-npm-errors` è necessario perché il tool interroga `npm ls`, che non rappresenta
correttamente alcuni workspace pnpm e peer/dev opzionali. L’SBOM generato viene comunque validato
come JSON CycloneDX e accompagnato da inventario licenze pnpm.

L’SBOM è stato rigenerato dopo l’aggiunta di VitePress e validato come CycloneDX 1.6. Componenti,
versioni della toolchain documentale e risultati dei gate sono registrati nella verifica di Fase 17.

## Operazioni manuali non eseguite

- `npm login`, `pnpm login` e qualsiasi publish reale con npm o pnpm;
- creazione di tag o GitHub Release per `0.2.0`;
- abilitazione o deploy di GitHub Pages;
- modifica della visibilità del repository.

## Dichiarazione di limite

La release dimostra il funzionamento tecnico del software. Non contiene validazione professionale,
certificazione o consulenza; tutti gli asset dimostrativi hanno ambito `TECHNICAL_DEMO`.
