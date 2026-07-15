# Phase 6 verification

- **Status:** complete
- **Recorded at:** 2026-07-15T13:40:38+02:00
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

- `@vera/contracts` exposes strict, bounded and deeply frozen contracts for expression traces,
  single-rule findings, resolved findings and aggregate evaluation results. The generated
  `EvaluationResult` Draft 2020-12 JSON Schema has a deterministic exported SHA-256 identity.
- `evaluateExpression` implements all 18 `vera.dsl/v1` operators over detached facts and evidence.
  It evaluates every logical child, preserves Kleene three-valued logic, resolves complete evidence
  sets and emits canonical trace paths, expected/observed values and evidence IDs.
- `evaluateRule` separates applicability, exceptions, satisfaction and conditional override traces.
  It validates the exact Rule Definition hash and treats evaluation outside the rule's half-open
  validity interval as a controlled precondition failure owned by Rule Pack selection.
- `resolveRuleFindings` parses bounded input collections, validates the one-to-one rule/finding map,
  resolves a deterministic override DAG and fails cycles or dangling relations closed. `TRUE`
  overrides suppress only the subordinate rule, `FALSE` leaves both unchanged and `UNKNOWN` produces
  reciprocal `UNCERTAIN_OVERRIDE`/`REVIEW` findings.
- The resolver detects explicit conflicts plus the predefined `OBLIGATION`–`PROHIBITION` and
  `PERMISSION`–`PROHIBITION` incompatibilities for one normative key. Aggregate precedence is
  `FAIL > REVIEW > PASS > NOT_APPLICABLE`.
- Outputs are detached, deeply frozen and canonically ordered. Replaying canonical JSON or permuting
  valid rule/finding input arrays produces byte-identical canonical result JSON.
- Proxy-backed expression, rule, fact or evidence graphs are rejected before traps can run. Facts
  cannot splice evidence from another provider run, and canonical expected/observed values over 512
  bytes use a deterministic SHA-256 projection so a valid repeated AST remains inside the bounded
  result envelope.
- A static dependency test proves that the kernel modules import only contracts, the RE2-compatible
  runtime and local semantic primitives; no storage, UI, provider, file-system or network module is
  reachable from production kernel code.

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

The default coverage run records 1,116 passing tests across 37 executed files and one opt-in Ollama
smoke file skipped. Overall coverage is 97.92% statements, 95.68% branches, 98.88% functions and
98.27% lines. The Phase 6 evaluation contract and DSL evaluator each record exactly 100% statements,
branches, functions and lines; the graph resolver records 96.67% statements, 92.95% branches, 97.43%
functions and 98.14% lines. The public-boundary scan checks 408 text snapshots. OSV Scanner 2.4.0
finds no known issue in the 216 packages represented by the lockfile.

## Adversarial review corrections and limits

Independent cross-review closed logical trace truth that was not derived from children; fact leaves
that could claim evaluation without evidence; mutable nested expected/observed values; spoofed or
non-reciprocal cross-finding relations; partial evidence sets; override predicates with `UNKNOWN`
silently treated as inactive; legitimate skipped override traces treated as an invalid graph;
precedence from uncertain applicability; undeclared predefined deontic conflicts; unbounded or
accessor-backed resolver inputs; and fan-in larger than the original related-ID limit. Final
evaluator review also closed oversized repeated trace values, cross-run evidence splicing and
mutating Proxy graphs whose reflection traps could otherwise change consecutive evaluations.

The kernel does not choose a Rule Pack, load facts, calibrate provider confidence, persist an audit
record or make a human disposition. Those responsibilities remain in later phases. These checks
establish deterministic technical behavior only and are not professional validation, certification
or advice.
