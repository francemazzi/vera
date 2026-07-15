# Rule Pack versioning and temporal resolution

VERA treats a Rule Pack as an immutable, technically scoped input to the deterministic kernel. A
published version is not an `active` database row: activation is an independent append-only event
stream, and every evaluation keeps the exact version snapshot it used.

> Rule Pack publication and activation establish only a reproducible software workflow. Bundled
> examples use `validationScope=TECHNICAL_DEMO` and do not represent professional approval,
> certification or advice.

## Public records

`RulePackDraft` is a bounded candidate with an optimistic-concurrency `revision`. Its canonical hash
covers its complete state, including rules and provenance bindings. Updating a draft replaces the
stored candidate only when the caller's expected revision matches. Creation and replacement receive
an authoritative demo `AUTHOR` separately and bind that identity to `createdBy` or `updatedBy`; the
draft payload cannot self-authorize its contributor metadata.

`RulePackVersion` is the publication snapshot. It records:

- a pack lineage and immutable version identifier;
- a SemVer 2.0 identity, domain and jurisdiction;
- one half-open UTC validity interval;
- complete `RuleDefinition` snapshots, unique and ordered by identifier;
- the change reason and any explicitly superseded version;
- author and publisher identities and timestamps;
- the canonical SHA-256 and `TECHNICAL_DEMO` scope.

Published snapshots are detached from caller-owned objects and deeply frozen. The repository does
not expose an update operation for them. A correction starts with a controlled clone into a new
draft and must use a strictly higher SemVer precedence. Build metadata is preserved in the identity
but does not increase precedence.

`ActivationEvent` is separately hashed and chained to the previous event. Its sequence, pack, event
type, target version and target content hash, previous active version, effective/recording
timestamps, actor, role and reason are part of that hash. The supported projections are:

- `ACTIVATE`: select the first version or a different version with higher SemVer precedence;
- `ROLLBACK`: select a lower-precedence version that was previously active;
- `DEACTIVATE`: leave the lineage without an active version.

The append command supplies an authoritative actor separately from the event payload and the two
identities and roles must match. The actor exercises `APPROVER`; an `ADMIN` role does not imply that
authority. Events cannot be rewritten, inserted into an earlier sequence or backdated to change a
completed historical selection. After deactivation, the next `ACTIVATE` must advance beyond the last
active SemVer; an older snapshot cannot bypass `ROLLBACK` semantics.

Actor UUIDs have one lowercase canonical representation. Every separation-of-duty comparison uses
that representation, including source and Rule Card contributors, publishers and activators.
Authorization actors are parsed from detached data-property snapshots; accessors, Proxies and UUID
case aliases fail closed.

## Publication eligibility

Publication validates the entire candidate again rather than trusting draft state. For every rule:

1. the declared `RuleDefinition` hash must match its canonical content;
2. the exact source version and Rule Card revision IDs and hashes must exist;
3. both records must be `APPROVED` at publication;
4. every authoritative source domain and jurisdiction must exactly match the Rule Pack scope;
5. the Rule Pack interval must be contained by every included rule and referenced source interval;
6. overrides and conflicts must remain internal to the same snapshot.

The containment rule is intentionally stricter than checking for a one-instant intersection. It
means a version selected anywhere in its advertised interval never hands an out-of-period rule to
the kernel. A changed validity boundary therefore creates a new version.

Temporal overlap with an earlier version is rejected unless the new version explicitly continues the
same lineage through `supersedesVersionId`. The declaration permits storing the new immutable
snapshot; it does not activate it.

Publication uses the latest approved Rule Card revision. Activation and rollback have a different
purpose: they revalidate the exact revision and hash embedded in the published snapshot without
requiring that revision to remain latest. An approved revision may therefore have an immutable
successor while remaining eligible for historical rollback; a retired revision still blocks the new
event.

## Deterministic resolution

Resolution requires three explicit values: domain, jurisdiction and evaluation timestamp. For each
pack lineage, the ledger is replayed through that timestamp. A candidate survives only when:

- its last effective projection selects that exact version;
- the version domain and jurisdiction match exactly;
- `validFrom <= evaluationDate < validTo`, with `validTo=null` unbounded.

Exactly one surviving version is required. Zero candidates is `RULE_PACK_RESOLUTION_NOT_FOUND`; more
than one is `RULE_PACK_RESOLUTION_AMBIGUOUS`. These are controlled selection errors, not `REVIEW` or
`NOT_APPLICABLE`, because no rules were evaluated.

Resolver outputs are stable regardless of repository insertion order. The selected version is
returned as its verified, deeply frozen snapshot. Replay of an earlier timestamp ignores later
activation and rollback events.

The Phase 7 in-memory ledger pins each version snapshot at its first accepted event. Durable export
and hydration are introduced with audit and persistence in Phases 13 and 14. That hydration path
must verify the stored event chain and pinned version hashes directly; it must not reinterpret a
historical event using the current approval state of a source or Rule Card.

## Evaluation snapshot

The Rule Pack evaluation entry point evaluates every rule in the selected immutable version and then
applies deterministic override/conflict resolution. Facts and evidence are validated and indexed
once for the entire pack. A deterministic aggregate budget covers expression nodes and finding
structure, repeated evidence references, projected trace values and possible resolution relations.
An authoring-valid pack that cannot fit the stricter result envelope fails with a public controlled
resource error before traces or findings are allocated. Its envelope stores:

- the complete `RulePackVersion` and verified version hash;
- the explicit evaluation timestamp;
- the complete deterministic `EvaluationResult`;
- a canonical envelope hash.

The contract requires exactly one finding per snapshotted rule, equal evaluation timestamps and
matching rule IDs and content hashes. Replaying the envelope therefore does not query the current
source, Rule Card or activation repositories.
