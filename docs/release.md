# Release sperimentale v0.1.0

La prima release è una release sorgente sperimentale. Non pubblica pacchetti npm e non cambia la
visibilità del repository senza conferma esplicita.

## Contenuto previsto

- Monorepo TypeScript strict/ESM.
- API locale Fastify e UI audit desk.
- Kernel, DSL, Rule Pack, audit, RAG, calibrazione e MVP sintetico.
- Corpus, fonti, Rule Pack e report esclusivamente sintetici.
- Licenza Apache-2.0.
- SBOM CycloneDX in `docs/sbom.cdx.json`.

## Comandi di verifica

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

## Dichiarazione di limite

La release dimostra il funzionamento tecnico del software. Non contiene validazione professionale,
certificazione o consulenza; tutti gli asset dimostrativi hanno ambito `TECHNICAL_DEMO`.
