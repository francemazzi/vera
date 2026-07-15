# Verifica Fase 16 — Apertura e release

Data verifica: 2026-07-15T19:45:40+02:00

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
- Gitleaks `v8.28.0`: 22 commit scansionati, nessun leak rilevato.
- Nessun file tracciato in `datasets/`, `reports/private/` o `.vera-private/`.
- Nessun percorso privato rilevato nella cronologia raggiungibile.
- Ref raggiungibili verificate:
  - `refs/heads/main`
  - `refs/remotes/origin/main`
  - branch remoti Dependabot per aggiornamenti automatici.

## Passi finali ancora richiesti

- Eseguire verifica da clean clone dopo il commit della Fase 16.
- Attendere GitHub Actions dopo il push su `main`.
- Creare la release sperimentale `v0.1.0` senza pubblicazione npm.
- Richiedere conferma esplicita prima di modificare la visibilità del repository.

## Limiti

La release `v0.1.0` resta una demo tecnica. Fonti, Rule Pack, corpus, benchmark, profili di
calibrazione, account e approvazioni incluse nel repository sono sintetici o dimostrativi e marcati
come `TECHNICAL_DEMO`. Nessun risultato costituisce validazione professionale, certificazione o
consulenza.
