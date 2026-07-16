# VERA deterministic kernel

The kernel evaluates a validated Rule Definition against explicit facts and evidence. It returns a
technical finding and a complete expression trace without reading a clock, database, model, file or
network resource. The same canonical input therefore produces the same canonical output.

## Evaluation boundary

The caller supplies:

- one immutable Rule Definition;
- a UTC evaluation instant inside the rule's half-open validity interval;
- facts with unique keys and identifiers; and
- evidence with unique identifiers, whose document identity and normalized geometry are preserved.

Schema-invalid, duplicated, Proxy-backed or temporally ineligible input is a precondition error.
Proxy graphs are rejected before any user trap is invoked. In particular, an out-of-period rule is
not reported as `NOT_APPLICABLE`: Rule Pack selection owns temporal eligibility, while
`NOT_APPLICABLE` describes the rule's declared applicability or exception logic.

## Expression trace

Each expression node records its AST path, operator, truth value, reason, referenced fact keys,
expected and observed values, evidence identifiers and child traces. Logical nodes evaluate every
child in AST order even if the parent result is already known. Evidence identifiers exposed by a
parent are the deterministic, deduplicated union of evidence actually used below it. Runtime
contracts independently derive logical truth from the children and reject an evaluated fact leaf
without evidence, so a forged trace cannot turn into a technical `PASS`.

Expected and observed JSON stays inline up to 512 canonical UTF-8 bytes. Larger values are projected
as `CANONICAL_JSON_SHA256_V1`, containing the SHA-256 plus canonical byte and UTF-16 code-unit
counts. Predicates always evaluate the full value; projection bounds repeated trace payloads without
claiming truncation, and the fact snapshot remains available for replay.

Leaf evaluation distinguishes these abstention causes:

| Condition                                       | Truth       | Trace reason       |
| ----------------------------------------------- | ----------- | ------------------ |
| Expression evaluated with usable input          | node result | `EVALUATED`        |
| Referenced fact does not exist                  | `UNKNOWN`   | `MISSING_FACT`     |
| Fact is null, unreadable, conflicting or absent | `UNKNOWN`   | `UNRESOLVED_FACT`  |
| Resolved value has the wrong declared type      | `UNKNOWN`   | `TYPE_MISMATCH`    |
| Required evidence cannot be resolved            | `UNKNOWN`   | `MISSING_EVIDENCE` |
| A bounded operation exceeds its declared limit  | `UNKNOWN`   | `RESOURCE_LIMIT`   |

`present` is the only special case: a resolved, evidenced fact is `TRUE`, and an evidenced
`NOT_FOUND` observation is `FALSE`. Other unresolved states remain `UNKNOWN`. Every evidence ID in a
fact must resolve, and each resolved evidence item must carry the same provider-run identity as the
fact; partial or cross-run provenance produces `MISSING_EVIDENCE`.

## Rule pipeline

1. Evaluate `appliesWhen`.
2. If it is `TRUE`, evaluate every declared exception and combine them with three-valued `any`.
3. Evaluate `satisfiedWhen` only when applicability is true and exceptions are all false.
4. Trace every override predicate, but defer its effect until all rules have findings.
5. Resolve active or uncertain precedence and explicit or predefined deontic conflicts.
6. Aggregate resolved outcomes with `FAIL > REVIEW > PASS > NOT_APPLICABLE`.

An unknown applicability, exception or satisfaction result always produces `REVIEW`. A true
exception and false applicability produce `NOT_APPLICABLE`; neither path is an implicit pass.

## Override and conflict resolution

Resolution validates that both endpoints belong to the evaluated snapshot and that declared edges
form a directed acyclic graph. A `TRUE` predicate makes the subordinate rule `NOT_APPLICABLE` with
resolution `OVERRIDDEN`; `FALSE` leaves both rules unchanged; `UNKNOWN` makes both related rules
`REVIEW` with resolution `UNCERTAIN_OVERRIDE`. Override traces are omitted, and accepted as omitted,
when applicability or an exception legitimately skipped operative evaluation.

The resolver also detects explicit `conflictsWith` relations and predefined incompatibilities for
one `normativeKey`: `OBLIGATION` against `PROHIBITION`, and `PERMISSION` against `PROHIBITION`.
Without active precedence, applicable peers become reciprocal `CONFLICT_REVIEW` findings. Invalid
endpoints, cycles and unresolved conflicts never select a winner. Input collections are bounded,
validated and detached before graph traversal.

The resolver returns the original finding beside its effective outcome and resolution reason. It
does not mutate the single-rule trace, which remains a record of what that rule evaluated before
cross-rule precedence was applied.

## Replay

Rules, facts, evidence and results are JSON values with deterministic ordering rules. Canonical JSON
of a repeated result must be byte-identical across input permutations. Public result contracts
enforce canonical ordering, cross-finding relation integrity and deep freezing of nested expected or
observed values. The structural `EvaluationResult` JSON Schema has an exported SHA-256 identity.
Provider runtime data can be retained by extraction and audit records, but it is not consulted by
the kernel and cannot alter a replayed decision.

All bundled examples and results have `validationScope=TECHNICAL_DEMO`. They demonstrate software
behavior only and are not professional validation, certification or advice.
