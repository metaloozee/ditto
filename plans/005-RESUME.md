# Resume plan 005 after shutdown

Status: RESUMED at the user's request. All 50 saved source hashes still match the shutdown checkpoint; branch/HEAD are unchanged and nothing is staged. Executor `4f07f880-6f93-412` completed its R2 candidate in the retained worktree. All 12 advisor-run gates, 110 focused tests and six probes pass on its 52-path manifest. The authority review found two blockers, independently reproduced by the advisor: ignored expected brain identity and incomplete capacity reservation owner checks. Repair executor `1377ee76-924f-487` is running with `openai-codex/gpt-6.1-sol`, High reasoning. [005-startup-review.md](005-startup-review.md) records findings and failing probes. Its new candidate handoff is `plans/005-execution-evidence/startup-repair/HANDOFF.md`. After review or necessary repair, continue the remaining brokers, UI Git and boundary evidence without another user prompt. No plan decisions changed.

## Where the work lives

- Parent repository: `/home/ayan/ditto`, branch `brain`.
- Source worktree: `/home/ayan/ditto-worktrees/plan-005-codex`.
- Source branch: `codex/plan-005-transport`.
- HEAD: `13480bc7f4daf9489a0aa7cf7fea071a1115c8c3`.
- Source is unstaged and uncommitted. Preserve every existing change.
- Model requirement for every executor: `openai-codex/gpt-6.1-sol`, High reasoning.

The user stopped executor `392d9cad-b1c1-4df` solely to shut down and continue tomorrow. This was not rejection of the design or cancellation of the plan. Its temporary session may not survive. Start a fresh executor in the same worktree if resumption is unavailable, never a replacement clean worktree.

## Durable checkpoint

[Startup interruption evidence](005-review-evidence/startup-interrupted/) holds all 50 source-path hashes, complete tracked/added diffs and copied available executor logs. Seventeen paths changed since the last independently reviewed continuation-3 candidate. No candidate-working-directory process was found when saving this handoff. No source was changed, staged or committed by the advisor.

The executor's worktree-local `plans/005-execution-evidence/startup/HANDOFF.md` is stale: it says no source edits, but source now includes startup contracts/platform observations, product startup service/tests, migration `0022_runtime_startup_assignments.sql`, schema, command, builder and named-entrypoint wiring. Trust the actual source and saved scope over that old statement.

The last available focused startup test log reports 32 PASS. An earlier typecheck log reports unused import, malformed-input test typing and RPC `Disposable` typing errors. No final typecheck/full-gate result exists for the interrupted source. Do not assume those errors remain or were fixed; rerun after inspecting current code. None of this R2 delta has received independent acceptance.

## Next actions

1. Read the original [005 plan](005-privileged-transport-and-remote-execution.md), [latest completed review](005-continuation-3-review.md), this handoff and interrupted scope/logs.
2. Inspect current startup implementation and complete R2, rather than reimplementing prior dispatch/result fixes. Check paired startup, builder/migration/lifecycle intent authorization, idempotent identity assignments, fresh-D1 guarded writes, capacity callbacks and termination-only release. Preserve legacy ownership fences and closed real-user admission.
3. Run startup tests/typechecks, all selected-plan gates, `pnpm verify`, `pnpm runtime:verify`, `pnpm brain:verify`, and `node /home/ayan/ditto/plans/005-review-probes.cjs "$PWD"` in the candidate. Capture new logs separately; never overwrite historical evidence. Advisor independently reviews the R2 delta.
4. Continue R3 model/Git brokers and R4 authenticated model-free UI Git admission, then remaining R1/R5 boundary evidence. The user should not need to keep repeating Continue between partial executor handoffs. Pause only for a real blocker, unresolved decision or another explicit user pause.

The advisor stays source-read-only under improve; separate executors modify the isolated worktree. No staging, source commits, merge, push, PR, production access, real credential reads, deployment, shared database migration or paid tests are authorized. Preserve Sandbox/Pi versions and disabled Git push. P-Bridge/P-Model/P-Git remain NOT RUN. Plan 006 stays blocked until 005 is accepted.

Suggested user prompt: `Resume plan 005 using plans/005-RESUME.md.`
