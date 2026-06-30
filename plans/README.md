# Implementation Plans

Generated on 2026-06-24. Updated on 2026-06-30 with plan 016 and reconciled plans 011-014 against commit `8632f47`. Execute in the order below unless dependencies say otherwise. Each executor: read the plan fully before starting, honor its STOP conditions, and update your row when done.

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
| 011 | Create GitHub import regression tests | P1 | M | — | DONE |
| 012 | Paginate GitHub import state and branch discovery | P1 | S | 011 | DONE |
| 013 | Authorize GitHub installation use server-side | P1 | M | 011, 012 | TODO |
| 014 | Validate sandbox env-var keys before saving or provisioning | P2 | S | — | TODO |
| 015 | Persist and restore project sandboxes | P1 | L | — | TODO |
| 016 | Add the Flue project-coder foundation | P1 | L | 013, 014 | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale — finding fixed independently or approach abandoned)

## Dependency notes

- 002 no longer depends on 001. The current codebase already exposes repository import state and installation ids, so this plan can land independently as the persistence layer.
- 003 depends on 002 because sandbox bootstrap updates `projects` records with `sandboxId` and readiness state.
- 004 and 005 should land first because they restore typecheck/lint/whitespace verification for the uncommitted branch.
- 007 was rejected on 2026-06-25 because the maintainer confirmed no private-key normalization should be added.
- 008 depends on the project sandbox bootstrap surface from 003: projects must already have `sandboxId` and `status` before the workspace/run lock can be useful. It intentionally chooses one sandbox per project, with logical sessions and one active mutating run lock inside that project sandbox.
- 009 depends on 008 because it fixes the workspace event API introduced by the agent-run foundation: conversation events must be scoped by selected session, while the mutating-run lock remains project-scoped.
- 010 depends on the workspace/run model from 008 and the current session-scoped workspace behavior from 009. It is a focused reliability fix for `workspace.startRun`: remove unsupported D1 `db.transaction(...)`, preserve the project-level mutating-run lock, and use D1-compatible batched writes for initial session/run/event rows.
- 011 adds the missing regression harness around GitHub import state before more behavioral fixes land in the same area.
- 012 depends on 011 because the pagination fix should extend the shared GitHub import tests instead of inventing a second harness.
- 013 depends on both 011 and 012 because the authorization check must be tested and must validate against the full paginated import-state result, not page 1 only.
- 014 is independent of 011-013, but it stays later in the queue because malformed env-var keys are lower-severity than the GitHub import authorization and pagination bugs. It now covers both GitHub import env-var entry and later project-settings env-var saves.
- 015 has no prior plan dependency because the current source already contains the sandbox bootstrap surface it needs. It should still be reviewed as an extension of the v1 one-sandbox-per-project decision from 003 and the workspace/run model from 008-010.
- 016 depends on 013 and 014 because a real Flue coding agent must not trust client-submitted GitHub repo/install pairs and must not rely on malformed env-var keys being safe to sync into `/workspace/.env`. It can start before 015 only if it keeps sandbox backup/restore and R2 artifacts out of scope; mutating tool hardening should revisit 015 before treating edits as durable across sandbox restarts.

## Verification baseline

Use these commands when executing plans:

- `pnpm exec tsc --noEmit` — passes typechecking.
- `pnpm lint` — exits 0 at plan-writing time with existing warnings in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`; new plans should not add warnings in touched files.
- `pnpm test` — exits 0 with `src/lib/github-repositories.test.ts` passing; plan 016 should not add regression tests per maintainer instruction.
- `git diff --check` — catches whitespace errors before commit.

## Reconciliation notes

- 2026-06-29: plans 011-014 drifted from their original `93db448` assumptions because tRPC procedures moved out of `src/integrations/trpc/router.ts` into split router modules. Refreshed all four plans in place at `8632f47`; none were rejected because the underlying findings still exist.
- 2026-06-29: plan 011 still establishes the first GitHub import regression tests; current `pnpm test` passes with no test files.
- 2026-06-29: plan 011 was reconciled again for external OpenCode/pi.dev execution. Current HEAD is still `8632f47`, its drift check is clean, and the expected GitHub import test files are still absent, so it remains executable as TODO.
- 2026-06-29: plans 012 and 013 now target `src/integrations/trpc/routers/github.ts` and `src/integrations/trpc/routers/projects.ts`; 012 still depends on 011, and 013 still depends on 011 plus 012.
- 2026-06-29: plan 014 now includes `src/components/project-settings-dialog.tsx` and `projects.setEnvVar`, while explicitly preserving deletion of legacy malformed env-var keys.
- 2026-06-30: added plan 016 from `docs/flue-agent-harness-prd.md`. It records the maintainer's decisions to use direct Flue client streaming, OpenCode Go selectable models, Zustand user preferences, full sandbox access after same-worker mount proof, lock checks before edits, future commit-only export, and D1 metadata plus R2 artifacts for oversized outputs.

## Findings considered and rejected / deferred

- Lockfile churn from the uncommitted dependency update was intentionally ignored per maintainer instruction on 2026-06-25.
- Escaped GitHub App private-key normalization: rejected per maintainer instruction on 2026-06-25; current raw-key behavior is intentional.
