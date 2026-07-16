# Security policy

VERA is an experimental local-first compliance engine. The public repository contains only source
code, documentation and synthetic `TECHNICAL_DEMO` assets.

## Supported versions

| Version | Supported                                                   |
| ------- | ----------------------------------------------------------- |
| 0.1.x   | Security fixes on `main` only during the experimental phase |

No npm package is published for `v0.1.0`.

## Reporting a vulnerability

Open a private GitHub security advisory if available for the repository, or contact the repository
owner directly before publishing details. Do not include private datasets, credentials, model
outputs containing sensitive data, or exploit payloads that are not required to reproduce the issue.

Please include:

- affected commit or release;
- minimal reproduction using synthetic inputs;
- expected and observed behavior;
- whether the issue can affect local files, audit integrity, auth/session handling, or outbound
  network access.

## Security boundaries

- The kernel must not execute arbitrary JavaScript, `eval`, SQL or network calls.
- `datasets/`, `.env*`, local reports and private bundles are ignored and must not be committed.
- AI adapters may extract facts or draft Rule Cards, but cannot approve, activate or certify rules.
- Demo identities and approvals are synthetic and carry `validationScope=TECHNICAL_DEMO`.
- Ollama remains the default provider and the only backend for OCR, vision and embeddings; its smoke
  tests are loopback/local only.
- OpenRouter is the sole explicitly supported remote egress and is opt-in for text extraction and
  RAG drafts using the pinned `meta-llama/llama-3.1-8b-instruct` model.
- OpenRouter requests require an explicit server-side API key, Zero Data Retention and
  `data_collection=deny`; credentials and authorization headers must never be logged or exposed via
  `VITE_*` variables.
- There is no automatic Ollama-to-OpenRouter fallback. The generic API egress check remains
  local-only and does not authorize arbitrary remote endpoints.

## Release checks

Before a release or visibility change, run:

```bash
pnpm verify
pnpm security:check
VERA_BOUNDARY_SCOPES=working,index,history pnpm --filter @vera/public-boundary scan
pnpm licenses list --prod > /tmp/vera-licenses.txt
rg "GPL|AGPL|LGPL" /tmp/vera-licenses.txt || true
```

The repository must also have a clean clone verification and an SBOM generated for the release.
