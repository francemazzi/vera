# Sviluppo locale

## Requisiti

- Node.js `22.22.1`
- pnpm `10.33.0`
- Docker, per PostgreSQL/Testcontainers e scansione OSV
- Playwright Chromium installato con:

  ```bash
  pnpm --filter @vera/web exec playwright install chromium
  ```

## Setup

```bash
pnpm install --frozen-lockfile
pnpm generate
```

Servizi locali opzionali:

```bash
docker compose up -d
```

## Gate principali

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contract
pnpm build
pnpm test:e2e
pnpm test:coverage
pnpm public-boundary:check
pnpm security:check
```

Il gate completo è:

```bash
pnpm verify
```

## MVP sintetico

```bash
pnpm --filter @vera/demo-mvp build
pnpm --silent --filter @vera/demo-mvp report > /tmp/vera-demo-mvp-report.json
```

Il report è deterministicamente hashato e non usa materiali reali.

## Smoke test Ollama

Gli smoke test Ollama sono offline-safe: se il runtime locale non è configurato, registrano un
limite esplicito invece di fallire la CI. Per eseguire gli smoke live, configurare i modelli locali
richiesti dalla singola suite e lanciare gli script `test:smoke` dei package interessati.

## Release locale

La release `v0.1.0` richiede:

1. working tree pulita;
2. clean clone;
3. `pnpm verify`;
4. `pnpm security:check`;
5. public-boundary scan su working tree, indice e history;
6. gitleaks su tutti i ref;
7. inventario licenze e SBOM;
8. tag/release GitHub;
9. conferma esplicita prima di eventuale cambio visibilità del repository.
