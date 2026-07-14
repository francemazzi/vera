# ADR 0001: Public core and private evaluation boundary

- **Status:** Accepted
- **Date:** 2026-07-15

## Context

VERA is intended to become a reusable open-source compliance engine. Development may happen
alongside confidential evaluation material, but that material must never shape the public API or
enter the repository history.

## Decision

- The repository contains only domain-neutral code, documentation, schemas, generated examples, and
  synthetic fixtures.
- Confidential material remains under ignored local paths. It is never a release or quality gate.
- Public examples describe fictional sources and explicitly carry `validationScope: TECHNICAL_DEMO`.
- A boundary scanner runs locally and in CI before a phase can be completed.
- Model outputs, prompts, reports, and audit exports derived from confidential inputs must be
  written only to ignored private-report directories.

## Consequences

The public benchmark demonstrates reproducibility and engineering behavior, not professional or
legal validity. Adapters may accept other datasets, but no private schema or taxonomy is encoded in
the core.
