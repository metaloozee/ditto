# Implementation Plans

Generated on 2026-06-24. Updated on 2026-06-26 with plan 010. Execute in the order below unless dependencies say otherwise. Each executor: read the plan fully before starting, honor its STOP conditions, and update your row when done.

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
| 008 | Add project-scoped agent run foundation | P1 | L | 003 | DONE |
| 009 | Scope workspace events to the selected session | P1 | S | 008 | DONE |
| 010 | Replace startRun's D1 transaction with batched writes | P1 | M | 008, 009 | DONE |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale — finding fixed independently or approach abandoned)

## Dependency notes

- 002 no longer depends on 001. The current codebase already exposes repository import state and installation ids, so this plan can land independently as the persistence layer.
- 003 depends on 002 because sandbox bootstrap updates `projects` records with `sandboxId` and readiness state.
- 004 and 005 should land first because they restore typecheck/lint/whitespace verification for the uncommitted branch.
- 007 was rejected on 2026-06-25 because the maintainer confirmed no private-key normalization should be added.
- 008 depends on the project sandbox bootstrap surface from 003: projects must already have `sandboxId` and `status` before the workspace/run lock can be useful. It intentionally chooses one sandbox per project, with logical sessions and one active mutating run lock inside that project sandbox.
- 009 depends on 008 because it fixes the workspace event API introduced by the agent-run foundation: conversation events must be scoped by selected session, while the mutating-run lock remains project-scoped.
- 010 depends on the workspace/run model from 008 and the current session-scoped workspace behavior from 009. It is a focused reliability fix for `workspace.startRun`: remove unsupported D1 `db.transaction(...)`, preserve the project-level mutating-run lock, and use D1-compatible batched writes for initial session/run/event rows.

## Verification baseline

Use these commands when executing plans:

- `pnpm exec tsc --noEmit` — passes typechecking.
- `pnpm lint` — exits 0 at plan-writing time with one existing warning in `src/components/ui/sidebar.tsx:85`; new plans should not add warnings in touched files.
- `pnpm test` — runs unit tests.
- `git diff --check` — catches whitespace errors before commit.

## Findings considered and rejected / deferred

- Lockfile churn from the uncommitted dependency update was intentionally ignored per maintainer instruction on 2026-06-25.
- Escaped GitHub App private-key normalization: rejected per maintainer instruction on 2026-06-25; current raw-key behavior is intentional.
