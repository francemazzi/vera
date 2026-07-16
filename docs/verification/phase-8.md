# Phase 8 verification

- **Status:** complete
- **Recorded at:** 2026-07-15T16:21:54+02:00
- **Validation scope:** `TECHNICAL_DEMO`

## Environment

| Component | Version   |
| --------- | --------- |
| Node.js   | `22.22.1` |
| pnpm      | `10.33.0` |
| Vitest    | `4.1.10`  |
| RE2JS     | `2.8.6`   |
| Zod       | `4.4.3`   |

## Verified artifacts

- `@vera/contracts` now exposes bounded, hash-pinned contracts for `RuleTestFixture`,
  `RuleTestRunRequest`, `RuleTestRunResult`, `RulePackImpactRequest` and `RulePackImpactReport`.
- `@vera/rules-testing` evaluates fixture suites through the deterministic Rule Pack evaluator,
  derives per-rule coverage and emits canonical run-result hashes.
- The same `RuleTestRunRequest` contract is accepted by `runRuleTestingApiRequest` and by the
  `vera-rules-test` CLI.
- `diffRulePackVersions` compares baseline and candidate versions on the same synthetic cases,
  records version references and fixture-set hash, and classifies `OUTCOME_CHANGED`, `NEW_REVIEW`
  and `POSSIBLE_FALSE_CONFORMITY`.
- `rules-core` exposes an optional `RulePackReadinessGate`; the in-memory repository rechecks it
  before publication and activation without depending on the runner package.
- The synthetic demo matrix covers `PASS`, `FAIL`, `REVIEW` and `NOT_APPLICABLE` for every demo
  rule, plus explicit evidence, exception, override, validity-start and validity-end cases.

## Completed checks

- `pnpm verify`
- `pnpm security:check`
- `VERA_BOUNDARY_SCOPES=working pnpm --filter @vera/public-boundary scan`
- `VERA_BOUNDARY_SCOPES=index pnpm --filter @vera/public-boundary scan`
- `VERA_BOUNDARY_SCOPES=history pnpm --filter @vera/public-boundary scan`
- `git diff --check`

`pnpm verify` completed format, lint, typecheck, unit tests, integration tests, contract tests,
build, coverage and public-boundary scan. The run recorded 1,242 passing tests across 46 executed
files and one opt-in Ollama smoke file skipped. Overall coverage is 96.49% statements, 94.43%
branches, 97.16% functions and 96.92% lines. `@vera/rules-testing` records 95.18% statements, 82.60%
branches, 97.36% functions and 95.00% lines; global branch coverage remains above the configured 85%
gate.

The default public-boundary scan checked 515 text snapshots. Explicit scope scans passed on 161
working-tree snapshots, 148 index snapshots and 206 reachable-history snapshots. OSV Scanner 2.4.0
scanned the 216 packages represented by `pnpm-lock.yaml` and found no known issues.

## Limits

The runner verifies synthetic fixture coverage and deterministic regression behavior only. It does
not validate real-world accuracy, professional interpretation or certification. All demo rules,
facts, evidences, approvals and reports remain `TECHNICAL_DEMO`; local ignored datasets were not
used as tests, benchmarks or completion criteria.
