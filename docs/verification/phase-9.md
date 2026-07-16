# Phase 9 verification

- **Status:** complete
- **Recorded at:** 2026-07-15T16:43:08+02:00
- **Validation scope:** `TECHNICAL_DEMO`

## Environment

| Component   | Version   |
| ----------- | --------- |
| Node.js     | `22.22.1` |
| pnpm        | `10.33.0` |
| Vitest      | `4.1.10`  |
| Zod         | `4.4.3`   |
| OSV Scanner | `2.4.0`   |

## Verified artifacts

- `@vera/benchmark` generates a deterministic synthetic corpus of 20 cases with one generated PDF,
  one SVG image and one JSON document per case.
- The split is frozen by `caseId` with seed `42`: 12 development cases, 4 calibration cases and 4
  blind cases.
- The corpus is balanced across `PASS`, `FAIL`, `REVIEW` and `NOT_APPLICABLE`, with five cases per
  outcome.
- The generated corpus hash is `2368ce6f0e8f79049fab19148b74bb6c0651c9b9df10a32db9ff85ce0a40d8ab`.
- `runSyntheticBenchmark` accepts a configurable simulated Ollama matrix and records model name,
  digest, runtime, prompt hash, options hash, hardware, corpus hash, predictions and raw output
  hash.
- Metrics cover extraction precision, recall, F1, missing rate and hallucination rate, plus finding
  sensitivity, specificity, macro-F1 and false-negative rate.
- Bootstrap intervals are deterministic and grouped by case.
- `probeOllama` records local Ollama availability or a hash-pinned limitation without requiring a
  specific local model in CI.

## Completed checks

- `pnpm verify`
- `pnpm --filter @vera/benchmark test:smoke`
- `pnpm security:check`
- `VERA_BOUNDARY_SCOPES=working pnpm --filter @vera/public-boundary scan`
- `VERA_BOUNDARY_SCOPES=index pnpm --filter @vera/public-boundary scan`
- `VERA_BOUNDARY_SCOPES=history pnpm --filter @vera/public-boundary scan`
- `git diff --check`

`pnpm verify` completed format, lint, typecheck, unit tests, integration tests, contract tests,
build, coverage and public-boundary scan. The run recorded 1,248 passing tests across 50 executed
files and one opt-in Ollama extractor smoke file skipped. Overall coverage is 96.34% statements,
93.76% branches, 97.04% functions and 96.77% lines. The default public-boundary scan checked 563
text snapshots.

Explicit boundary scope scans passed on 176 working-tree snapshots, 162 index snapshots and 225
reachable-history snapshots. OSV Scanner 2.4.0 scanned the 216 packages represented by
`pnpm-lock.yaml` and found no known issues.

## Synthetic metric report

With the simulated provider and 50 bootstrap iterations:

| Metric              |  Value | CI low | CI high |
| ------------------- | -----: | -----: | ------: |
| precision           | 0.9620 | 0.9268 |  0.9873 |
| recall              | 0.9500 | 0.9125 |  0.9875 |
| extraction F1       | 0.9560 | 0.9308 |  0.9809 |
| missing rate        | 0.0500 | 0.0125 |  0.0875 |
| hallucination rate  | 0.0380 | 0.0127 |  0.0714 |
| sensitivity         | 0.6000 | 0.2000 |  1.0000 |
| specificity         | 1.0000 | 1.0000 |  1.0000 |
| findings macro-F1   | 0.8920 | 0.7500 |  1.0000 |
| false-negative rate | 0.4000 | 0.0000 |  0.8000 |

The report hash for this local 50-iteration demonstration is
`1762ede7da3a17cfafc2a0bba869644145ed5a72007bbc9b01dd0d0c16c3b4f4`.

## Ollama smoke

The local Ollama probe completed through `pnpm --filter @vera/benchmark test:smoke`. On this
machine, Ollama was not reachable within the configured 500 ms smoke timeout and the limitation was
recorded explicitly: `Ollama local smoke was not available: The operation was aborted.`

## Limits

The benchmark is synthetic and tests reproducibility, schema validity and runner completion. The
metric values above are properties of the generated demo corpus and simulated provider only; they
are not evidence of real-world accuracy, professional validation, certification or advice. No local
ignored dataset was used.
