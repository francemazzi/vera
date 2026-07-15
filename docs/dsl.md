# VERA declarative rule language

The VERA DSL is a strict, versioned JSON AST. It describes predicates; it never embeds JavaScript,
SQL, network calls, templates or provider instructions. Parsing is deterministic and has no I/O. The
initial public contract is `vera.dsl/v1` and is defined by the Zod schemas exported from
`@vera/contracts`. Its generated JSON Schema is the machine-readable structural projection for
transport and tooling; it is not a substitute for runtime Zod validation.

## Truth and evidence

Every expression produces `TRUE`, `FALSE` or `UNKNOWN`. Comparison operators only inspect a
`RESOLVED`, type-correct fact whose required evidence binding can be satisfied. Missing facts,
`NULL`, `NOT_READABLE`, `CONFLICT`, type mismatches and missing evidence produce `UNKNOWN`.

`present` is deliberately narrower: a resolved evidenced fact is `TRUE`; an evidenced `NOT_FOUND`
fact is `FALSE`; every other unresolved or unevidenced state is `UNKNOWN`. No expression may choose
what `UNKNOWN` means. A rule fixes `unknownPolicy` to `REVIEW`. A resolved `STRING` fact is
evaluable only when its normalized value contains at most 100,000 UTF-16 code units; larger values
are rejected at the fact contract boundary rather than partially compared.

## Operators

| Family   | Operators                                   | Deterministic meaning               |
| -------- | ------------------------------------------- | ----------------------------------- |
| Constant | `truth`                                     | explicit three-valued literal       |
| Presence | `present`                                   | evidenced availability              |
| Equality | `eq`, `not_eq`                              | typed equality without coercion     |
| Text     | `contains`, `contains_any`, `matches`       | explicit Unicode and case behavior  |
| Numeric  | `greater_than`, `less_than`, `between`      | finite JSON-number comparison       |
| Calendar | `date_before`, `date_after`, `date_between` | canonical calendar-date comparison  |
| Logical  | `all`, `any`, `not`                         | Kleene three-valued logic           |
| Evidence | `language_present`, `same_visual_area`      | evidence language and page geometry |

`all` and `any` contain at least one child. `not` contains exactly one child. Numeric and calendar
ranges declare both boundaries explicitly; an empty or reversed range is invalid. Equality never
converts a string to a number, date or boolean. Text predicates require string facts.

## Text and regular expressions

Text nodes use the exact option vocabulary of the public schema: `normalization` is `NFC` or `NFKC`,
`whitespace` is `PRESERVE` or `COLLAPSE`, and `caseSensitivity` is `SENSITIVE` or `INSENSITIVE`. The
`comparison` object contains exactly those three fields; `matches` exposes the same three choices
beside its pattern controls. Normalization is applied first, optional whitespace collapse second and
locale-independent Unicode lowercasing last. Locale collation is never used. Lone Unicode surrogates
and over-limit strings are invalid inputs.

`matches` patterns are compiled at the contract boundary with an RE2-compatible engine. Native
JavaScript regular expressions are not used. Backreferences, look-around assertions and malformed
patterns are rejected. `SEARCH` means an unanchored substring search and `FULL` means an exact
whole-string match; case, dot-all and multiline behavior are required fields. A pattern must already
be normalized according to its declared `NFC` or `NFKC` mode: validation never silently rewrites the
pattern before compilation. The contract bounds pattern length, flags, AST depth and total node
count; the kernel additionally bounds evaluated text length.

## Numbers, dates and visual areas

Numbers are finite IEEE 754 binary64 JSON values. There is no tolerance or string parsing. Unsafe
integral values are rejected because precision may already have been lost, and negative zero is
rejected because canonical JSON would otherwise alias it with positive zero. These restrictions
apply to facts and other public JSON snapshots as well as numeric DSL operands.

Calendar predicates accept only real ISO dates in `YYYY-MM-DD` form. `date_between` declares
`includeMinimum` and `includeMaximum` explicitly and supports all four inclusivity combinations; a
singleton range is valid only when both boundaries are included. Validity intervals remain validated
UTC-Z instants and use `validFrom <= evaluationDate < validTo`; `validTo=null` is unbounded. UTC
comparison preserves every fractional-second digit rather than truncating to milliseconds, and
fractions that differ only by trailing zeroes denote the same instant.

`same_visual_area` compares normalized top-left-origin rectangles. Candidate evidence must belong to
the same ingested document identity (`documentId`), the same original content (`documentHash`) and
the same 1-based page. Sharing a content hash alone is insufficient. The edge-to-edge distance must
be at most the threshold declared by the node. Its `ALL_FACTS` quantifier requires one mutually
compatible evidence region for every referenced fact. `language_present` separately declares exact
BCP 47 matching or primary-language matching. Missing usable evidence produces `UNKNOWN`, while
complete evidence outside the declared condition produces `FALSE`.

## Detached input snapshots

Every expression and Rule Definition is copied into a detached JSON snapshot before structural or
semantic validation. The snapshot reads own data-property descriptors, never invokes property
getters, and rejects accessors, non-enumerable or symbol properties, non-plain containers, sparse or
extended arrays, cycles and shared object references. Downstream validation, canonical hashing and
hash verification consume the detached value and do not re-read the caller's object. This gives a
single validation-time view and prevents a caller from changing a property between resource checks,
invariant checks and hashing (a TOCTOU mismatch).

## Rule definition

A `RuleDefinition` locally declares the Rule Card revision and source version it is derived from:

- a validity interval, normative key, deontic category and risk level;
- the DSL version, draft state, source and Rule Card revision hashes, and its own canonical hash;
- separate `appliesWhen` and `satisfiedWhen` expressions;
- zero or more identified exceptions, each with a predicate, reason and stable source reference;
- explicit evidence bindings for every fact key used by the AST;
- explicit override and conflict relations; and
- `unknownPolicy: "REVIEW"` plus `validationScope: "TECHNICAL_DEMO"`.

Exceptions are combined with `any`. Override graph validation, fact evaluation, trace generation and
final finding aggregation are kernel responsibilities; the contract only admits bounded, well-formed
declarative data.

Local validation cannot establish claims about a separately supplied Rule Card. Before a definition
may enter a Rule Pack, `RuleDefinitionBindingSchema` validates `{ rule, ruleCardRevision }`
together. It requires matching card/revision/source identifiers and hashes, normative key, deontic
category, effective risk and exact validity, and checks that every Rule Card exception and evidence
requirement is traced by the rule without foreign keys. Approval and generation-time eligibility
remain workflow checks outside this contextual value contract.

`verifyRuleDefinitionHash` is intentionally stronger than a digest-only comparison: it takes a
detached snapshot and returns true only when the declared canonical hash and all local
`RuleDefinitionSchema` invariants are valid. Contextual Rule Card binding still requires
`RuleDefinitionBindingSchema` because the revision is not an argument to hash verification.

## Resource limits

The v1 contract rejects an expression deeper than 32 nodes or a rule containing more than 2,048
expression nodes. Individual arrays, strings, references and patterns have smaller exported limits.
These are validation failures, never partial evaluations or implicit `FALSE` results.

The generated Draft 2020-12 JSON Schema represents object shape, discriminants, required fields,
local scalar/array bounds and recursive references. It is useful for editors, transport validation
and independent structural checks, and its frozen representation has a deterministic schema hash. It
deliberately cannot express every runtime refinement.

Runtime Zod validation remains authoritative for descriptor-only snapshot safety, canonical number
and content hashes, aggregate node/byte budgets, non-empty ranges, post-normalization text checks,
evidence-binding coverage, normalized uniqueness, override direction and RE2 compilation. The
standalone JSON Schema also has no external Rule Card revision with which to perform contextual
binding. JSON-Schema-only acceptance therefore never makes a rule executable, publishable or
eligible for a Rule Pack.
