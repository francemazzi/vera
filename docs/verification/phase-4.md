# Phase 4 verification

- **Status:** complete
- **Recorded at:** 2026-07-15T11:51:51+02:00
- **Validation scope:** `TECHNICAL_DEMO`

## Environment

| Component      | Version / value                                         |
| -------------- | ------------------------------------------------------- |
| Node.js        | `22.22.1`                                               |
| pnpm           | `10.33.0`                                               |
| Ollama         | `0.24.0`                                                |
| Host           | `darwin 25.5.0`, Apple M4 Max, 68,719,476,736 bytes RAM |
| Network policy | loopback HTTP only                                      |

## Verified artifacts

- `@vera/contracts` defines strict, bounded contracts for typed facts, original and normalized
  values, all five fact states, evidence provenance, normalized top-left geometry, extraction
  requests/runs/results and embeddings. Candidate IDs, run IDs and evidence references are linked
  and globally checked.
- JSON values are validated iteratively with depth/node budgets before recursive processing. Image
  inputs require canonical base64 plus a PNG, JPEG or WebP signature matching the declared media
  type. Observation materialization has aggregate fact/candidate/evidence budgets.
- `@vera/extractors` provides the shared adapter interface plus manual, JSON, Ollama OCR, vision,
  LLM and embedding implementations. JSON Pointer mapping distinguishes missing, null, unreadable
  and contradictory values without implicit locale conversion.
- Ollama is restricted to unauthenticated loopback HTTP. Responses use bounded streaming reads,
  timeouts and capped retries. Before inference, `/api/tags` and `/api/version` must match the
  configured model name, SHA-256 digest and runtime version.
- Fact generation uses an Ollama-compatible structural JSON Schema derived from the shared Zod
  contract; constraints that would expand the model grammar are enforced again by Zod at runtime.
  Run metadata records the schema hash, prompt, options, transport attempts and raw response.
- The public result vocabulary contains facts, evidence and embeddings only. Strict parsing and
  adversarial tests reject normative fields and disguised decision keys, including `PASS`, `FAIL`
  and `NOT_APPLICABLE` outputs.

## Ollama live offline smoke

The opt-in command `pnpm --filter @vera/extractors test:smoke:ollama` completed against local pinned
models. The fact leg is deliberately a transport/schema abstention with an empty fact set; it is not
an accuracy claim. Mock integration tests separately exercise materialized OCR, vision and LLM facts
with evidence.

| Purpose     | Model                     | Digest                                                             | Raw output SHA-256                                                 | Detail                   |
| ----------- | ------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------ |
| Fact schema | `llama3.1:latest`         | `46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e` | `112f13eac8694594a706172d8a87be2673d0841c59768c300f91a3b09a9f9ff9` | empty validated fact set |
| Embedding   | `nomic-embed-text:latest` | `0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f` | `bfc425824af49e272696c0c3bbdb516960d623b6e3f0b7d64d006ffa8b06245c` | 768 dimensions           |

Reproducibility hashes: prompt `3f054ea6e67d72e6e4fa9c091a1bb0037e6969b778ea6c041342d71577359021`,
format schema `1e42817344e48552a8749d4f1e898505f39d1fc698292cb1035a0fca08397e42`, fact input
`bf338785425ef593ca1b229eeff380d687beeb5b948839844db5bc1dfc707925`, embedding input
`67fd1df765d980350ecc615be81099a15f59df642d89336512ff77ec222617f1`. The fact request used seed `42`
and temperature `0`; full raw responses remain attached to the in-memory run and only their hashes
are recorded here.

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
- `pnpm --filter @vera/extractors test:smoke:ollama`
- `git diff --check`

The default suite records 712 passing tests across 27 files, with the opt-in live smoke skipped by
default and passing separately. Coverage is 96.25% statements, 92.54% branches, 98.27% functions and
97.15% lines. The extractors package itself exceeds every common threshold at 92.49% statements,
86.92% branches, 95.86% functions and 93.49% lines; every fact state and critical provenance,
budget, hash-binding and normative-output invariant has an explicit positive or negative test.

## Review corrections and limits

The phase review closed unverified model metadata, unbounded chunked responses, aggregate
materialization amplification, duplicate/mixed embeddings, malformed images, unsafe numeric
rounding, calendar rollover, deep-JSON stack exhaustion, dangling conflict provenance, oversized
local raw records, embedding hash tampering and completion timestamps sampled before
materialization. It also closed silent non-JSON Ollama option coercion and oversized JSON evidence
with bounded excerpts plus content hashes, then bounded JSON mapping cardinality and strict client
request shapes before network I/O. Raw source preservation becomes durable and content-addressed in
Phase 14. Extraction quality is intentionally not inferred from this technical smoke; balanced
benchmark and blind-set claims belong to Phases 9 and 15. Nothing in this verification is
professional validation, certification or advice.
