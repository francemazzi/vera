# Verifica Fase 16 — Apertura e release

Data verifica: 2026-07-15T20:08:57+02:00

## Ambito implementato

- Aggiunta licenza Apache-2.0 nel repository e metadato `license` in `package.json`.
- Aggiunta policy di sicurezza in `SECURITY.md`.
- Aggiunta documentazione pubblicabile:
  - `docs/architecture.md`
  - `docs/development.md`
  - `docs/release.md`
- Aggiornato `README.md` con struttura repository, documentazione e limiti della release.
- Generato SBOM CycloneDX in `docs/sbom.cdx.json`.
- Mantenuto il vincolo di non modificare la visibilità GitHub senza conferma esplicita separata.

## SBOM

Comando eseguito:

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

Risultato:

- Formato: CycloneDX `1.6`.
- Componenti: 678.
- Dipendenze: 679.
- `--ignore-npm-errors` è necessario perché il generatore interroga `npm ls`, che segnala peer
  opzionali e workspace pnpm come problemi anche quando il lockfile pnpm è installabile e
  verificato.

## Gate locali

Comandi eseguiti:

```bash
pnpm verify
pnpm security:check
VERA_BOUNDARY_SCOPES=working,index,history pnpm --filter @vera/public-boundary scan
pnpm licenses list --prod > /tmp/vera-licenses.txt
rg "GPL|AGPL|LGPL" /tmp/vera-licenses.txt || true
git diff --check
docker run --rm -v "$PWD:/repo:ro" --entrypoint sh ghcr.io/gitleaks/gitleaks:v8.28.0 \
  -lc "git config --global --add safe.directory /repo && gitleaks detect --source=/repo --no-banner --redact --log-opts='--all'"
git ls-files datasets reports/private .vera-private
git log --all --name-only --pretty=format: | rg '^(datasets/|reports/private/|\.vera-private/)' || true
git for-each-ref --format='%(refname)' refs/heads refs/remotes refs/tags
```

Risultati:

- `pnpm verify`: superato con 71 file test superati, 1 saltato; 1299 test superati, 1 saltato.
- Coverage globale: 94,5% statement, 90,64% branch, 96,08% funzioni, 94,95% linee.
- Scansione sicurezza OSV: superata su 597 pacchetti, nessuna issue rilevata.
- Scansione confine pubblico su working tree, indice e cronologia: superata con 932 snapshot
  testuali.
- Licenze produzione: 359 righe inventario, nessun match `GPL`, `AGPL` o `LGPL`.
- `git diff --check`: nessun errore.
- Gitleaks `v8.28.0`: cronologia raggiungibile scansionata, nessun leak rilevato.
- Nessun file tracciato in `datasets/`, `reports/private/` o `.vera-private/`.
- Nessun percorso privato rilevato nella cronologia raggiungibile.
- Ref raggiungibili verificate:
  - `refs/heads/main`
  - `refs/remotes/origin/main`
  - branch remoti Dependabot per aggiornamenti automatici.

## GitHub Actions

- Workflow richiesti prima della release: `CI` e `Security`.
- Entrambi i workflow devono risultare verdi sul commit pubblicato prima di creare il tag `v0.1.0`.
- Il push di preparazione Fase 16 `099c32c0e3aeac9313cda1eebe96b78b119e8608` ha superato `CI` run
  `29437948922` e `Security` run `29437948874`.

## Clean clone

Comandi eseguiti:

```bash
rm -rf /tmp/vera-clean-phase16
git clone https://github.com/francemazzi/vera.git /tmp/vera-clean-phase16
git -C /tmp/vera-clean-phase16 rev-parse HEAD
NODE22_BIN="$(dirname "$(npx -y -p node@22.22.1 which node)")"
PATH="$NODE22_BIN:$PATH" pnpm install --frozen-lockfile
PATH="$NODE22_BIN:$PATH" pnpm verify
PATH="$NODE22_BIN:$PATH" pnpm security:check
PATH="$NODE22_BIN:$PATH" \
  VERA_BOUNDARY_SCOPES=working,index,history pnpm --filter @vera/public-boundary scan
PATH="$NODE22_BIN:$PATH" pnpm licenses list --prod > /tmp/vera-clean-licenses.txt
rg "GPL|AGPL|LGPL" /tmp/vera-clean-licenses.txt || true
git status --short --branch
```

Risultati:

- Clean clone da `origin/main` del commit di verifica.
- Runtime usato per il gate clean clone: Node `22.22.1`, pnpm `10.33.0`.
- `pnpm verify`: superato.
- `pnpm security:check`: superato su 597 pacchetti, nessuna issue rilevata.
- Scansione confine pubblico clean clone: superata con 949 snapshot testuali dopo build e coverage.
- Licenze produzione clean clone: 359 righe inventario, nessun match `GPL`, `AGPL` o `LGPL`.
- Stato Git clean clone: `main...origin/main`, nessuna modifica tracciata.

La prima esecuzione locale del clean clone con Node `24.3.0` non è stata considerata valida: pnpm ha
emesso warning `Unsupported engine` e ha contaminato l’output stdout di un contract test CLI. La
riesecuzione con Node `22.22.1` corrisponde ai file `.node-version` e `.nvmrc`.

## Release

- Release prevista: `v0.1.0`.
- Stato: release sperimentale tecnica, senza pubblicazione npm.
- Asset pubblicabili: sorgenti, documentazione, SBOM ed esempi sintetici inclusi nel repository.
- Vincolo operativo: la release viene creata soltanto da un commit con gate locali, clean clone e
  GitHub Actions verdi.

## Passo finale ancora richiesto

- Richiedere conferma esplicita prima di modificare la visibilità del repository.

## Limiti

La release `v0.1.0` resta una demo tecnica. Fonti, Rule Pack, corpus, benchmark, profili di
calibrazione, account e approvazioni incluse nel repository sono sintetici o dimostrativi e marcati
come `TECHNICAL_DEMO`. Nessun risultato costituisce validazione professionale, certificazione o
consulenza.
