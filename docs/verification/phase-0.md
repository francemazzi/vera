# Phase 0 verification

- **Status:** complete
- **Recorded at:** 2026-07-15T09:17:00+02:00
- **Validation scope:** `TECHNICAL_DEMO`

## Environment

| Component      | Version   |
| -------------- | --------- |
| Node.js        | `22.22.1` |
| pnpm           | `10.33.0` |
| Docker         | `29.5.2`  |
| Docker Compose | `5.1.3`   |
| Ollama         | `0.24.0`  |

## Completed checks

- `pnpm install --frozen-lockfile`
- `VERA_BOUNDARY_SCOPES=working pnpm verify`
- `VERA_BOUNDARY_SCOPES=working,index pnpm public-boundary:check`
- `pnpm verify` against the amended, reachable history
- `pnpm security:check` using OSV-Scanner `2.4.0`
- `docker compose config --quiet`
- `git diff --cached --check`
- `git check-ignore -v datasets`
- Git bundle creation and verification outside the repository

All checks above passed. Coverage for the boundary package is 100% statements, functions, and lines,
with 88.88% branch coverage.

The private backup bundle has SHA-256
`26a6e0370c340bfaa90c761f98e583242460b721d464cc44699d9f82fc020519` and is not part of the
repository.

## History rewrite and CI

The operator explicitly authorized the planned history rewrite. Commit `cb86262` replaced the
previous private remote root using force-with-lease, and the complete verification suite found no
boundary findings in its reachable history. The original private history remains recoverable only
from the external backup bundle.

Both required remote workflows completed successfully:

- [CI](https://github.com/francemazzi/vera/actions/runs/29396772331)
- [Security](https://github.com/francemazzi/vera/actions/runs/29396772423)
