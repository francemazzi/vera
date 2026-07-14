# ADR 0002: Strict TypeScript monorepo and local-first runtime

- **Status:** Accepted
- **Date:** 2026-07-15

## Context

The deterministic kernel must stay independent from extraction providers, storage, APIs, and the
review application while still sharing validated contracts.

## Decision

- Use a pnpm workspace on the pinned Node 22 runtime.
- Compile packages as strict ESM TypeScript with project-level build and test scripts.
- Keep the pure domain contracts and evaluator in packages that do not import persistence, HTTP, UI,
  or model-provider code.
- Run the application locally through Docker Compose with PostgreSQL as the durable metadata store
  and a separately configured local model service.
- Validate untrusted boundaries with Zod-derived schemas and test PostgreSQL integration against a
  real container rather than an in-memory substitute.

## Consequences

Package dependency direction is enforced by linting and contract tests. Provider-specific and
framework-specific concerns can be replaced without changing deterministic rule semantics.
