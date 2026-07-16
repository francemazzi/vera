# ADR 0003: Bounded DSL and explicit value semantics

- **Status:** Accepted
- **Date:** 2026-07-15

## Context

The rule language accepts untrusted JSON and must produce deterministic three-valued results. A
schema that only names operators would leave text normalization, numeric coercion, temporal
boundaries, regular-expression behavior and visual proximity dependent on the host runtime. It would
also make resource exhaustion part of the evaluator's implicit behavior.

## Decision

- The public DSL is a strict discriminated JSON AST. Unknown keys, empty logical nodes, unsupported
  operators and configurable unknown policies are rejected at the boundary.
- A `truth` literal provides explicit constant predicates, including an always-applicable rule,
  without inventing a synthetic fact or bypassing the evaluator.
- Text predicates declare normalization and case behavior. They select Unicode NFC or NFKC and
  locale-independent lowercasing explicitly; no locale is inferred. The schema and semantic
  primitives share the exact `normalization`, `whitespace` and `caseSensitivity` option shape.
  Regular-expression patterns must already use their declared NFC or NFKC form.
- Numeric predicates accept JSON numbers only. They use finite IEEE 754 binary64 values, never parse
  strings, and reject unsafe integral operands and negative zero rather than silently rounding or
  allowing two inputs to share one canonical representation. The same canonical-number boundary is
  applied to public fact JSON.
- A resolved string fact is bounded to 100,000 UTF-16 code units, matching the semantic primitive's
  maximum instead of admitting a fact that the kernel cannot evaluate.
- Date predicates accept canonical ISO calendar dates (`YYYY-MM-DD`) only. `date_between` supports
  all four explicit minimum/maximum inclusivity combinations and rejects empty ranges. Rule validity
  continues to use validated UTC-Z instants and half-open intervals, comparing every
  fractional-second digit without millisecond truncation.
- Regular expressions are compiled by an RE2-compatible engine. Pattern size, evaluated text size,
  AST depth and node count are bounded; backreferences, look-around and arbitrary host-language
  execution are unavailable.
- Visual proximity is evaluated only across evidence with the same `documentId`, `documentHash` and
  page. Content equality without ingest identity is insufficient. Distance is the normalized
  edge-to-edge rectangle gap and the threshold is explicit in the AST.
- `present` returns `FALSE` only for an evidenced `NOT_FOUND` observation. A missing fact or an
  unevidenced `NOT_FOUND`, `NULL`, `NOT_READABLE` or `CONFLICT` remains `UNKNOWN`. Other predicates
  require a resolved, type-correct and evidenced fact.
- DSL parsing and semantic primitives perform no network, database, file-system, SQL or dynamic code
  execution. Full fact lookup, trace generation and three-valued composition remain kernel
  responsibilities.
- Untrusted values are detached through own data-property descriptors before validation. Accessors,
  exotic containers and non-JSON object graphs are rejected; resource checks, refinements and
  hashing then consume the same snapshot, closing property re-read and TOCTOU gaps.
- `RuleDefinitionSchema` validates local references and invariants. The contextual
  `RuleDefinitionBindingSchema` additionally validates the definition together with its exact Rule
  Card revision, including provenance hashes, effective risk, validity, exceptions and evidence
  requirements. Workflow approval remains a separate eligibility check.
- `verifyRuleDefinitionHash` performs full local Rule Definition validation on a detached snapshot,
  not only digest comparison. A successful result therefore covers the declared hash and local
  semantic invariants, but not an external Rule Card binding.
- The generated Draft 2020-12 JSON Schema is intentionally structural. It covers shapes,
  discriminants, required fields and local bounds; runtime Zod validation remains authoritative for
  canonical hashing, aggregate budgets, contextual or cross-field invariants, normalized text and
  RE2 compilation.

## Consequences

Rule authors must state comparison behavior rather than relying on coercion or locale defaults. Some
patterns and numerals accepted by JavaScript are intentionally invalid in VERA. Resource limit
failures are controlled validation errors, and a future engine cannot change operator meaning
without a versioned contract and migration. Consumers may use the JSON Schema for transport and
editor support, but JSON-Schema-only acceptance never establishes that a rule is executable or
eligible for publication.
