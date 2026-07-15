# Phase 7 verification

- **Status:** complete
- **Recorded at:** 2026-07-15T15:52:49+02:00
- **Validation scope:** `TECHNICAL_DEMO`

## Environment

| Component  | Version   |
| ---------- | --------- |
| Node.js    | `22.22.1` |
| pnpm       | `10.33.0` |
| Vitest     | `4.1.10`  |
| fast-check | `4.9.0`   |
| RE2JS      | `2.8.6`   |

## Verified artifacts

- `@vera/contracts` defines bounded `RulePackDraft`, immutable `RulePackVersion`, hash-chained
  `ActivationEvent`, deterministic resolution and evaluation-envelope contracts. Full SemVer 2.0
  precedence ignores build metadata, validity is half-open UTC and all hashes cover exact canonical
  content.
- `InMemoryRulePackRepository` supports optimistic draft replacement, controlled cloning and
  strictly increasing publication. Every publication rechecks exact source-version and Rule Card
  bindings, approval state, hash, validity containment and authoritative domain/jurisdiction scope.
- Published versions are detached and deeply frozen. A publisher must be an independent demo
  approver; recorded contributors cannot publish or activate their own pack. Later publications
  explicitly supersede the immediate predecessor and independent overlapping streams fail closed.
- `InMemoryRulePackActivationLedger` accepts strict append commands with a separately supplied
  authoritative actor. Sequence, previous hash and active-version expectations provide optimistic
  concurrency; accepted events are immutable, hash chained and pinned to the exact version content
  hash.
- Activation, deactivation and rollback never mutate a version or prior event. The ledger rejects
  backdating, equal effective instants, reader identity substitution, snapshot drift, cross-pack
  active-interval overlap and reuse of old versions after deactivation. Exact retries are
  idempotent; conflicting event-ID reuse fails.
- Resolution requires explicit domain, jurisdiction and evaluation instant, applies half-open
  validity and produces exactly one stable candidate. Missing and ambiguous selection are distinct
  controlled errors rather than compliance outcomes.
- Rule Pack evaluation stores the complete resolved version, evaluation date, deterministic result
  and canonical envelope hash. The contract enforces exactly one finding per rule with matching rule
  and version hashes.
- Batch evaluation validates and indexes facts/evidence once for the whole pack. A deterministic
  aggregate output budget fails before trace allocation when an otherwise valid authoring snapshot
  cannot fit the stricter evaluation-result envelope.

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

The default coverage run records 1,227 passing tests across 42 executed files and one opt-in Ollama
smoke file skipped. Overall coverage is 96.97% statements, 95.00% branches, 97.48% functions and
97.41% lines. The Rule Pack contract and evaluation envelope record 100% statements, branches,
functions and lines. The public-boundary scan checks 450 text snapshots. OSV Scanner 2.4.0 finds no
known issue in the 216 packages represented by the lockfile.

## Adversarial review corrections and limits

Independent cross-review closed actor self-assertion, version-reader identity substitution, mutable
cached snapshots, activation without a target content hash, post-deactivation rollback bypass,
request mutation between validation and use, accessor and Proxy traps, authoritative source-scope
drift, mixed-case UUID identity aliases, nested/composite resource-envelope gaps, rollback against a
superseded approved Rule Card revision and repeated fact/evidence validation for every rule.
Boundary inputs now use strict detached snapshots, actor identities are canonicalized before every
separation-of-duty comparison, and Proxy-backed graphs are rejected before any trap can run.

Phase 7 intentionally keeps repositories and replay state in memory. Durable historical export and
hydration are implemented in Phases 13 and 14 and must verify stored event-chain and version hashes
without consulting current source or Rule Card approval projections. Activation fixture coverage and
regression gating belong to Phase 8. These checks establish reproducible technical behavior only and
are not professional validation, certification or advice.
