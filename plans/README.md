# Implementation Plans

Generated on 2026-06-24. Execute in the order below unless dependencies say otherwise. Each executor: read the plan fully before starting, honor its STOP conditions, and update your row when done.

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001 | Implement the GitHub App Auth Flow | P1 | M | — | BLOCKED (stale: partial independent implementation changed plan assumptions) |
| 002 | Database Schema and tRPC Projects | P1 | S | — | DONE |
| 003 | Sandbox Provisioning and Bootstrap | P1 | M | 002 | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale — finding fixed independently or approach abandoned)

## Dependency notes

- 002 no longer depends on 001. The current codebase already exposes repository import state and installation ids, so this plan can land independently as the persistence layer.
- 003 depends on 002 because sandbox bootstrap updates `projects` records with `sandboxId` and readiness state.

## Verification baseline

Use these commands when executing plans:

- `pnpm exec tsc --noEmit` — passes typechecking.
- `pnpm lint` — checks linting warnings.
- `pnpm test` — runs unit tests.
