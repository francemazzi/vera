# Phase 5 verification

- **Status:** complete
- **Recorded at:** 2026-07-15T12:54:47+02:00
- **Validation scope:** `TECHNICAL_DEMO`

## Environment

| Component | Version   |
| --------- | --------- |
| Node.js   | `22.22.1` |
| pnpm      | `10.33.0` |
| Zod       | `4.4.3`   |
| RE2JS     | `2.8.6`   |
| Ajv       | `8.20.0`  |

## Verified artifacts

- `@vera/contracts` exposes the closed `vera.dsl/v1` discriminated AST with 18 operators, separate
  `appliesWhen` and `satisfiedWhen`, exceptions, explicit override/conflict relations, exact
  evidence bindings and the fixed `unknownPolicy=REVIEW` policy.
- `RuleDefinition` drafts bind source and Rule Card revision hashes and carry a canonical SHA-256
  content hash. `verifyRuleDefinitionHash` validates the complete local contract, while
  `RuleDefinitionBindingSchema` checks source, card, effective risk, validity, exception and
  evidence-requirement correspondence against the exact Rule Card revision.
- Untrusted AST and rule inputs are detached through data-property descriptors before parsing.
  Accessors, throwing or changing proxies, inherited values, exotic containers, sparse arrays,
  symbols, cycles, shared references and over-budget input are rejected without re-reading the
  caller's object.
- Text comparison fixes normalization, whitespace and case behavior. Patterns compile with RE2JS,
  must already match their declared NFC/NFKC form and have explicit search/full, case, dot-all,
  multiline and input limits. No JavaScript regex fallback, `eval`, SQL or network capability is
  present.
- Numbers reject non-finite values, unsafe integers and negative zero. Calendar comparison is exact,
  `date_between` implements all four boundary combinations and public UTC-Z interval comparison
  preserves arbitrary fractional-second precision.
- Visual-area primitives require the same ingested `documentId`, content hash and 1-based page, then
  apply an explicit normalized edge-distance threshold.
- The frozen Draft 2020-12 structural schema has ID
  `https://vera.local/schemas/rule-definition-vera.dsl-v1.schema.json` and pinned SHA-256
  `35b4925bacca9eb90487f543972cb9b603ca15b603aa074c92a9c9ae1952b01d`. Ajv independently validates
  its structure; runtime-only Zod refinements and their documented divergence are covered by
  contract tests.
- `examples/synthetic-dsl/operator-manifest.json` contains 54 neutral fixtures: one concrete `TRUE`,
  `FALSE` and `UNKNOWN` case for every operator, with facts, evidence and expected result, plus one
  schema-invalid and one adversarial expression per operator. These cases are the input corpus for
  the Phase 6 kernel tests.

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

The default suite records 883 passing tests across 32 executed files; the opt-in Ollama smoke file
is skipped because Phase 5 has no provider dependency. Coverage is 97.55% statements, 94.90%
branches, 98.70% functions and 97.84% lines. The DSL schema, descriptor-only JSON snapshot and
semantic-primitives files each record exactly 100% statements, branches, functions and lines. The
public-boundary scan checks 357 text snapshots, and OSV Scanner reports no known issue in the 214
packages represented by the lockfile.

## Review corrections and limits

Adversarial review closed property re-read/TOCTOU expansion beyond depth, node and canonical-byte
budgets; sub-millisecond timestamp truncation; facts accepted but not evaluable; empty normalized
containment; DSL/primitive option drift; NFKC pattern ambiguity; document identity reduced to a
content hash; digest-only validation; unpinned schema drift; and nominal operator fixtures without
facts or evidence. The JSON Schema remains intentionally structural and never authorizes execution
by itself. Rule evaluation, evidence propagation, trace construction, override graph resolution and
finding aggregation belong to Phase 6. These checks establish technical behavior only and are not
professional validation, certification or advice.
