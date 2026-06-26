# Implementation Plans

Generated on 2026-06-24. Execute in the order below unless dependencies say otherwise. Each executor: read the plan fully before starting, honor its STOP conditions, and update your row when done.

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001 | Implement the GitHub App Auth Flow | P1 | M | — | BLOCKED (stale: partial independent implementation changed plan assumptions) |
| 002 | Database Schema and tRPC Projects | P1 | S | — | DONE |
| 003 | Sandbox Provisioning and Bootstrap | P1 | M | 002 | BLOCKED (local `pnpm dev` container support unavailable on Windows; use WSL for final dev verification) |
| 004 | Restore GitHub App helper and branch-list typecheck | P1 | S | — | TODO |
| 005 | Remove dead project-route UI code and restore verification | P1 | S | — | TODO |
| 006 | Restore Yarn lockfile handling in sandbox bootstrap | P1 | S | — | TODO |
| 007 | Normalize escaped GitHub App private-key newlines | P2 | S | 004 | REJECTED (intentional behavior: do not normalize escaped key newlines) |
| 008 | Add project-scoped agent run foundation | P1 | L | 003 | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale — finding fixed independently or approach abandoned)

## Dependency notes

- 002 no longer depends on 001. The current codebase already exposes repository import state and installation ids, so this plan can land independently as the persistence layer.
- 003 depends on 002 because sandbox bootstrap updates `projects` records with `sandboxId` and readiness state.
- 004 and 005 should land first because they restore typecheck/lint/whitespace verification for the uncommitted branch.
- 007 was rejected on 2026-06-25 because the maintainer confirmed no private-key normalization should be added.
- 008 depends on the project sandbox bootstrap surface from 003: projects must already have `sandboxId` and `status` before the workspace/run lock can be useful. It intentionally chooses one sandbox per project, with logical sessions and one active mutating run lock inside that project sandbox.

## Verification baseline

Use these commands when executing plans:

- `pnpm exec tsc --noEmit` — passes typechecking.
- `pnpm lint` — checks linting warnings.
- `pnpm test` — runs unit tests.
- `git diff --check` — catches whitespace errors before commit.

## Findings considered and rejected / deferred

- Lockfile churn from the uncommitted dependency update was intentionally ignored per maintainer instruction on 2026-06-25.
- Escaped GitHub App private-key normalization: rejected per maintainer instruction on 2026-06-25; current raw-key behavior is intentional.
