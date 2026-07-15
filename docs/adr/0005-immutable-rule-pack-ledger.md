# ADR 0005: Immutable Rule Pack snapshots and append-only activation

- **Status:** Accepted
- **Date:** 2026-07-15

## Context

The deterministic kernel evaluates only the rules it receives. A separate boundary must therefore
decide which approved rules belong to an evaluation, preserve their exact bytes for replay and make
activation or rollback choices without rewriting history. Selecting a version by insertion order,
the current clock or a mutable `active` flag would make historical results ambiguous.

## Decision

- A published `RulePackVersion` is a complete, bounded JSON snapshot. It contains the exact
  `RuleDefinition` values, scope, half-open UTC validity interval, SemVer identity, change reason,
  publication metadata and canonical SHA-256. Rules are unique and stored in stable identifier
  order. Published values are returned as detached, deeply frozen snapshots.
- Drafts are separate mutable-by-replacement records. Every update carries the revision observed by
  the caller and is bound to a separately supplied authoritative `AUTHOR` actor; author identifiers
  inside the draft cannot authorize themselves. Cloning a published version creates a new draft with
  a new identifier, requested SemVer and reason; it never reopens the published object.
- Published SemVer precedence must increase for one pack lineage. Build metadata does not create a
  higher precedence. An overlap with an earlier version is permitted only through an explicit
  supersession link to the current lineage; otherwise publication fails closed.
- Publication revalidates every rule hash and exact source/Rule Card bindings. The referenced source
  version and Rule Card revision must be approved at publication, their hashes must match, and the
  authoritative source domain and jurisdiction must exactly match the Rule Pack scope. The Rule Pack
  interval must remain inside the source and rule validity intervals. This deliberately conservative
  interval rule guarantees that every rule in a resolved pack is executable for the pack's complete
  advertised lifetime.
- Publication uses the latest approved Rule Card revision because it creates a new candidate.
  Activation and rollback instead revalidate the exact hash-pinned approved revision carried by the
  immutable version. A later revision does not invalidate an older approved snapshot; retirement
  still blocks a new activation event.
- Activation state is projected exclusively from append-only `ActivationEvent` records. Events are
  strictly sequenced, bound to a separately supplied authoritative actor, timestamped in UTC and
  pinned to both the identifier and canonical hash of an immutable version. Activation, deactivation
  and rollback are new records; none mutates a version or an older event.
- The temporal resolver takes domain, jurisdiction and evaluation instant as explicit input. It
  replays only events effective by that instant, applies the version's half-open validity boundary
  and requires exactly one candidate. No candidate and multiple candidates are distinct controlled
  errors; neither is converted into a compliance outcome.
- A later event cannot be backdated to alter a prior selection. Equal-time ambiguity is rejected at
  append time, and stable identifiers are used only for canonical output ordering, never to choose a
  winner.
- Actor UUIDs are canonicalized to lowercase before storage or comparison. Separation-of-duty checks
  compare canonical identities, and authorization actors are detached through descriptor-only
  snapshots so case aliases, accessors and Proxies cannot self-review, self-publish or
  self-activate.
- The Rule Pack evaluation envelope contains the complete resolved version snapshot and its verified
  hash alongside the deterministic result. It validates a one-to-one rule/finding relationship so
  persistence and later audit can replay the exact rules rather than consulting current repository
  state.
- Standalone version limits and composite resolution/evaluation limits are separate. Composite node,
  depth and byte envelopes reserve capacity for the request, activation event and evaluation result
  while still enforcing the standalone boundary on the nested version.
- All bundled records retain `validationScope=TECHNICAL_DEMO`; publication and activation are
  technical workflow states, not professional approval or certification.

## Consequences

Creating a correction, changing a rule, changing validity or rolling back always adds a record.
Callers must provide an explicit evaluation instant and handle missing or ambiguous selection as an
operational error before invoking the kernel. The conservative validity containment rule may split a
pack into more versions when a source changes mid-period, but it removes per-rule temporal filtering
and prevents a nominally resolved pack from containing an ineligible rule.

Phase 7 keeps the replay ledger in memory and pins each accepted version snapshot. Durable export
and hydration belong to Phases 13 and 14; that path must verify stored event-chain and version
hashes without consulting the current approval projection of a source or Rule Card.
