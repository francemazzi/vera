# ADR 0006: Corrective Phase 14 boundary

- **Status:** Accepted (scope completed 2026-07-22)
- **Date:** 2026-07-16

## Context

The Phase 14 roadmap entry was marked complete after the local API, authentication, evaluation-run
storage, review decisions, blob metadata and backup export were implemented. A post-release
integration review found that this status overstated the durable boundary: compliance sources, Rule
Cards, Rule Packs, activation events and rule-test runs still use in-memory repositories, and
storage restore is not implemented.

The same review found that API tests used a fake repository, leaving the real
MVP-to-API-to-PostgreSQL path, atomic idempotency and authenticated review identity unverified.

## Decision

- Reopen Phase 14 until every durable aggregate named by the roadmap and backup restore are
  implemented and verified.
- Keep the implemented API and storage surface available, but document its exact resource set.
- Harden the implemented surface now: one-time authenticated bootstrap, authenticated review
  identity binding and transactional idempotency.
- Add a composed synthetic integration test from the demo MVP through the real API and PostgreSQL.
- Keep RAG and browser integration as separate verified paths until explicit application interfaces
  connect them.
- Keep local dataset execution optional, ignored and diagnostic. It does not become a public gate or
  evidence that Phase 14 is complete.

## Consequences

The experimental `v0.1.0` tag remains an immutable historical release, but it does not prove the
reopened Phase 14 scope. Later phases may retain their completed status for their independently
verified synthetic behavior. The repository must not claim durable persistence or restore for
resources that are still in memory.
