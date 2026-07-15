# Phase 2 verification

- **Status:** complete
- **Recorded at:** 2026-07-15T10:02:27+02:00
- **Validation scope:** `TECHNICAL_DEMO`

## Environment

| Component | Version   |
| --------- | --------- |
| Node.js   | `22.22.1` |
| pnpm      | `10.33.0` |

## Verified artifacts

- `@vera/contracts` defines strict source, immutable version, append-only transition and
  activation-eligibility schemas.
- SHA-256 helpers hash exact bytes or deterministic canonical JSON and reject values outside the
  JSON data model.
- `@vera/rules-core` reconstructs state from ordered events, derives separation of duties from the
  stored history and returns defensive copies.
- Version revision and event sequence expectations prevent stale concurrent appends.
- Every revision after the first replaces the immediately preceding version with a reason; prior
  snapshots remain unchanged and replayable.
- Activation eligibility requires the pinned hash, `APPROVED` state at the activation instant and a
  half-open validity match at the evaluation instant. A later retirement does not alter replay.

## Completed checks

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm test:contract`
- `pnpm build`
- `pnpm test:coverage`
- `pnpm public-boundary:check`
- `pnpm security:check`
- `git diff --check`

The suite contains 255 tests across fourteen files: 233 unit tests, three integration tests and
nineteen contract tests. Coverage is 100% for statements, functions and lines, and 99.17% for
branches. Contracts and `rules-core`, including all Phase 2 state and invariant branches, have full
branch coverage; the two residual branches belong to the Phase 0 boundary scanner.

## Limits and deferred storage binding

The source contract stores a declared lowercase SHA-256 digest and provides the function used to
compute it from original bytes. This in-memory phase has no blob payload to recalculate. Phase 14
will bind the same digest to content-addressed persisted bytes and verify it on storage reads. This
does not make a non-approved source eligible, and no private or professional material is used by the
tests.
