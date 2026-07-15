# Phase 3 verification

- **Status:** complete
- **Recorded at:** 2026-07-15T10:54:37+02:00
- **Validation scope:** `TECHNICAL_DEMO`

## Environment

| Component | Version   |
| --------- | --------- |
| Node.js   | `22.22.1` |
| pnpm      | `10.33.0` |

## Verified artifacts

- `@vera/contracts` defines strict Zod contracts for stable Rule Cards, immutable hashed revisions,
  structured exceptions and evidence requirements, comments, review decisions, approval decisions,
  explicit transitions and hash-pinned generation requests/references.
- `@vera/rules-core` stores defensive snapshots and one append-only audit sequence per revision.
  Optimistic expectations reject stale revision and audit writes.
- Only explicit `DRAFT`, review-submission and retirement events can be appended. `APPROVED` and
  `CHANGES_REQUESTED` are projections of immutable decisions, so a consumer cannot bypass review or
  quorum with a direct transition.
- Authors, reviewers and approvers are separated by identity. `HIGH` and `CRITICAL` effective risk
  require two distinct approvers; all exercised identities are synthetic `TECHNICAL_DEMO` actors.
- A retired Rule Card is terminal. Replacement revisions are allowed only from `DRAFT` or
  `CHANGES_REQUESTED`, remain linearly linked and cannot predate predecessor audit history.
- Rule generation returns only a `DRAFT` reference pinned to card/source hashes. `generationAt` is
  distinct from `evaluationDate`: quorum and source approval are checked at generation, current
  source approval is also required, and half-open validity is evaluated separately.

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

The suite contains 444 tests across twenty files: 401 unit tests, nine integration tests and 34
contract tests. The final coverage gate records 99.56% statements, 98.52% branches, 100% functions
and 99.55% lines. Every publicly reachable Phase 3 workflow, state and invariant branch is covered;
the residual branches are defensive guards for impossible private-map corruption plus the Phase 0
boundary scanner fallbacks.

## Review corrections and limits

The phase review closed direct-approval bypass, reopening after retirement, source-state backdating,
cross-revision timestamp regression, malformed generation IDs and ambiguous generation/evaluation
time semantics before completion. Storage is intentionally in-memory in this phase; durable audit,
database constraints and replay exports are delivered by Phases 13 and 14. These technical checks
are not professional validation, certification or advice.
