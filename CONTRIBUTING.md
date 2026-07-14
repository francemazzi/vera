# Contributing to VERA

VERA is an experimental compliance-engineering project. Contributions must preserve deterministic
evaluation, evidence provenance, immutable published versions, and the public/private boundary.

## Local setup

Requirements:

- Node.js `22.22.1`
- pnpm `10.33.0`
- Docker with Compose
- Ollama only for explicitly marked live integration suites

Install dependencies with `pnpm install --frozen-lockfile` and run the complete local gate with
`pnpm verify`.

## Contribution rules

- Add unit and integration coverage for behavior changes.
- Never commit confidential inputs, generated private reports, credentials, or local environment
  files.
- Keep the rule kernel free of database, network, UI, and model-provider dependencies.
- Treat generated rules and synthetic approvals as technical demonstrations only.
- Update the roadmap and the relevant phase verification record with implementation changes.
