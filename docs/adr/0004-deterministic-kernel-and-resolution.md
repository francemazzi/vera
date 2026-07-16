# ADR 0004: Deterministic evaluation and explicit precedence resolution

- **Status:** Accepted
- **Date:** 2026-07-15

## Context

The rule contract fixes a bounded three-valued AST, but repeatability also depends on how facts,
evidence, exceptions, overrides and conflicts are combined. Host-language short-circuiting,
iteration order, missing provenance or an implicit treatment of an out-of-period rule could make two
evaluations of the same snapshot produce different traces or misleading outcomes.

## Decision

- The kernel is a pure in-memory function. It has no adapter, network, database, clock,
  random-number generator, environment-variable, file-system or UI dependency. The evaluation
  instant is an explicit UTC input.
- Public inputs are validated at the boundary and copied before evaluation. Proxy values are
  rejected before reflective traversal, without executing their traps. Duplicate fact keys, fact
  identifiers or evidence identifiers are invalid rather than resolved by insertion order.
- A Rule Definition outside its own half-open validity interval is not an evaluation result. It is a
  precondition failure because Rule Pack selection must only pass eligible rules to the kernel.
  Converting that condition to `NOT_APPLICABLE` would falsely attribute the result to `appliesWhen`.
  Phase 7 owns temporal Rule Pack resolution.
- Every logical child is evaluated even when Kleene logic could determine the parent early. This
  keeps the trace complete and makes evidence use observable. Child order follows the versioned AST;
  sets in the result are deduplicated and sorted by stable identifier.
- A comparison leaf requires one resolved, type-correct fact and resolvable evidence. Missing facts,
  unresolved facts, type mismatches, missing evidence and deterministic resource exhaustion produce
  `UNKNOWN` with a distinct trace reason. `present` alone may produce `FALSE` for an evidenced
  `NOT_FOUND` observation. A partially resolvable evidence-ID set or evidence from a different
  provider run is missing evidence, not partial support.
- Trace nodes record their stable path, operator, truth value, expected and observed JSON values,
  referenced fact keys, evidence identifiers, reason and child nodes. They never include raw
  confidence as normative input. A canonical value larger than 512 UTF-8 bytes is represented in the
  trace by its SHA-256 and canonical byte/code-unit counts; evaluation still uses the complete value
  and the immutable fact snapshot remains the replay source.
- Applicability is evaluated first. A false applicability yields `NOT_APPLICABLE`; unknown yields
  `REVIEW`. For an applicable rule, all exception predicates are traced and combined with `any`. A
  true exception yields `NOT_APPLICABLE`; an unknown exception yields `REVIEW`. Satisfaction is
  evaluated only when applicability is true and no exception is true or unknown.
- Override predicates are traced by the same evaluator but final precedence is a separate multi-rule
  operation. This separation prevents a single rule from deciding the outcome of another rule in
  isolation.
- Active override edges must form a directed acyclic graph over rules present in the same snapshot.
  A cycle, missing endpoint or otherwise invalid graph does not pick a winner; affected evaluation
  becomes `REVIEW`. Resolution order is derived from stable identifiers and graph structure, never
  input array order.
- An override predicate that is `UNKNOWN` produces reciprocal `UNCERTAIN_OVERRIDE` findings with
  effective outcome `REVIEW`; it is never treated like an inactive edge. An override trace is
  legitimately absent when applicability or an exception caused the evaluator to skip operative
  conditions.
- A declared conflict that remains between applicable rules and has no active precedence edge yields
  `REVIEW` for the affected rules. The resolver also detects the predefined incompatibilities
  `OBLIGATION`–`PROHIBITION` and `PERMISSION`–`PROHIBITION` for one normative key. Explicit active
  precedence can resolve that conflict; an inactive override cannot.
- Final aggregation is over resolved outcomes and uses `FAIL > REVIEW > PASS > NOT_APPLICABLE`.
  `NOT_APPLICABLE` is returned only when every resolved finding has that outcome.
- Replay equality is defined over canonical JSON bytes. Identifier sets and resolved findings are
  emitted in canonical order, and validated results are detached and deeply frozen. The evaluator
  never adds ambient timestamps or runtime metadata, and it does not mutate rules, facts, evidence
  or prior findings.

## Consequences

Callers must resolve a temporally eligible immutable Rule Pack before invoking the kernel and must
treat malformed snapshots as errors, not findings. Complete traces are larger than short-circuited
traces, but they are stable and auditable. Unknown inputs and invalid precedence always abstain
rather than creating implicit compliance. Provider confidence, human review and persistence remain
outside the deterministic decision function.
