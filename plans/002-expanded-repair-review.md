# 002 expanded repair review

Verdict: **ACCEPTED and merged locally into `brain`** at `693a334`. The user approved the R5 adjustment, test changes and both supporting source edits. The final approval-time check found no drift across 691 reviewed regular files and no new regular files. Pre-merge full gates and adversarial probes passed. Phase 003 is ready but not started. Nothing was pushed, deployed, or migrated to a shared database.

This is the current review. [The first repair review](002-repair-review.md) and [the original execution review](002-execution-review.md) remain historical evidence, not descriptions of the current candidate.

## Target and scope

- At review: advisor checkout `/home/ayan/ditto`, branch `brain`, HEAD `d4e447e`; source edits came from the executor only.
- At review: executor checkout `/home/ayan/ditto-worktrees/plan-001-reexecute`, branch `codex/plan-001-reexecute`, HEAD `6eefdd1`, with uncommitted candidate source. That source was later committed and merged into `brain` at `693a334` without changing the reviewed source files.
- Expanded repair and first final corrections: xAI Grok 4.6, agent `c5f44063-c80f-46d`.
- Clean compiler-output correction: xAI Grok 4.6, agent `6dd5c992-5bc9-46c`.
- The user's subsequent instruction changes future subagents to `gpt-6-sol` with medium reasoning. Read-only R5 verification completed as `9ae07aed-23d9-4c2` with that configuration. The advisor checked its cited implementation paths independently.
- The approved type-only cleanup completed as `50efb206-dc41-4aa`, also `gpt-6-sol` with medium reasoning. The advisor verified all three deletion-only diffs, their before-copy hashes, identical emitted JavaScript and passing relevant gates.

The expanded-repair baseline contains 687 regular files. The candidate changes 24 and adds four source/test files; 663 baseline files are unchanged. The final-corrections baseline contains 691 regular files. Before the approved type-only cleanup, four had changed after that snapshot:

- `apps/web/src/lib/workspace-runtime.ts`
- `apps/web/src/lib/workspace-runtime.test.ts`
- `packages/session-brain/scripts/refresh-contracts.mjs`
- `packages/session-brain/src/pi-feasibility.test.ts`

The clean-refresh executor changed only the two brain files. The subsequent approved cleanup changed only `workspace-runtime-policy.ts` and the two binding type-test files, bringing the delta from the final-corrections baseline to seven files. Its 681-file manifest shows three changed and 678 unchanged files; the ten omitted pre-existing security-related source/skill/documentation files match the larger prior baseline. No source files were added or removed. See [approved cleanup evidence](002-latest-review-evidence/approved-cleanup-scope.json).

All 43 checked protected files remain byte-identical to both larger baselines, including runner source, Alchemy, historical migration 0019, runtime feasibility, and Pi recovery/restoration. The ten existing `.claude/skills` symlinks were excluded from the manifests and remain unchanged; they are not new files.

Evidence: [scope comparison](002-latest-review-evidence/scope-comparison.json). Executor before-edit evidence remains in its `plans/002-expanded-repair-evidence/`, `002-final-corrections-evidence/` and `002-clean-refresh-evidence/`. Two missing expanded-repair test copies were reconstructed from the saved binary diff or HEAD and checked against their recorded SHA256 hashes.

## Independent verification

Commands ran in the executor checkout. Node `v24.21.0`, npm `12.0.2`.

| Command | Advisor result |
|---|---|
| `pnpm brain:verify` | PASS. 13 contracts tests; three selected freshness tests; all 43 brain tests; typechecks and builds. |
| `pnpm verify` | PASS. 68 web test files / 722 tests; web typecheck and build; 79 runner tests and runner typecheck/build. |
| `pnpm check`, included in `pnpm verify` | PASS, 11 warnings. |
| `pnpm --filter @ditto/runtime typecheck` | PASS. |
| `pnpm --filter @ditto/runtime test` | PASS, two files / 20 tests. |
| Advisor probes with `--npm --adapter` | PASS, zero residual failures. |
| Advisor probes with `--npm --adapter --tsc-build` | PASS, zero residual failures. |
| `git diff --check` | PASS in both checkouts. |

Logs are under [002-latest-review-evidence](002-latest-review-evidence/). The freshness-only selection skips three unrelated characterization tests; the full brain suite then runs all 43 tests without skips. Root `pnpm verify` does not include brain/runtime gates, so those ran separately.

Both probe variants use disposable local npm fixtures. No working dependency installation is mutated as a test fixture. The `--tsc-build` variant runs the real TypeScript compiler without manually cleaning output before the refresh command.

After the approved type-only cleanup, the advisor independently reran web/runtime typechecks, all 20 runtime tests, 15 focused workspace policy/adapter tests, `pnpm check` with 11 warnings, the full `--npm --adapter --tsc-build` probes with zero failures, and diff checks. All passed. The full repository and brain results above precede this final type-only deletion; transpilation of each changed file produces byte-identical JavaScript.

## What the reviewed corrections establish

### Ownership and accounting

The authority callback path applies current relational ownership/lifecycle predicates to unlimited, non-consuming and bounded operations. Explicit owner-version mismatch is rejected. Conditional operation insertion rejects an actual lifecycle rotation after the earlier read. Production mock-shape fallbacks are gone; authority tests now use SQLite.

Queue insertion is conditioned on current legacy owner/version, and the capacity-failure requeue preserves a leased row after ownership changes. The existing accounting fences and trusted-delivery exclusions remain. This does not certify phase 008's future unified allocator.

New SQL prompt tests also cover new-session rollback when a later batch statement fails and stale owner versions after an owner round trip. Prototype/deep-JSON rejection and existing deletion tests continue to pass.

### Actual policy boundary

The candidate moves real lease policy into `workspace-runtime-policy.ts` and compiles its transitive types separately from product Env. Product wrappers retain provisioning, GitHub, decryption and lock adapters. Queue execution no longer forwards a generic environment.

The first extraction still passed `{...input}` from a product wrapper into shared policy, carrying the full Env despite narrower types. That was independently reproduced and corrected. The wrapper now selects the shared fields explicitly. A wrapper-to-real-policy test and the advisor boundary probe both verify that Env is absent.

The separate review confirmed a gap against the original R5 point 2. `ResolveDefaultBranch` at the pre-cleanup `workspace-runtime-policy.ts:35-38` was not in the actual dependency contract at `:132-148`. Both type tests inspected that unused alias, not a supplied capability. The user approved the coarser design below. The declaration, its imports and the misleading assertions have now been removed.

The actual call chain is `withWorkspaceRuntimeLease` → injected `prepareRuntimeWithRetry` → `prepareRuntimeOnce` → product-only `provisionDedicatedSession` → `resolveDefaultBranch`. The metadata lookup still uses product credentials inside the product adapter, never inside shared policy. The user explicitly accepted this narrower reuse boundary through the R5 adjustment; the original mismatch was not evidence of a credential leak.

Timing matters. `workspace-runtime.ts:589-634` checks the ready-runtime fast path and `ensureReady` before provisioning. The metadata call at `:395-399` occurs during provisioning and before the archive-recovery branch. Moving lookup unconditionally into the outer shared lease would add GitHub calls to ready runtimes and change behavior.

### Actual npm refresh

The brain retains `file:../runtime-contracts` and pins npm `12.0.2`. Its actual `contracts:refresh` command invokes `scripts/refresh-contracts.mjs`.

Independent review found two successive gaps in earlier versions: merge-copy retained deleted consumer artifacts, and the regression manually cleaned producer output although ordinary `tsc` does not. The reviewed helper now validates its source and install paths, cleans the owned generated producer dist, runs the normal build, and replaces copied consumer output. A source-linked consumer remains linked.

The isolated test now leaves obsolete JS/declarations in both ordinary producer and copied consumer output before refresh. After invoking the real helper, both match a separate fresh compile, obsolete files are absent, and actual imports return the changed export. The helper also rejects external consumer symlinks, including with `--preserve-symlinks`; the sentinel files remain unchanged.

## Approved R5 adjustment

The user approved retaining the existing `prepareRuntime` callback as the shared dependency. Plan point 2 now keeps GitHub metadata and provisioning product-only. The executor removed the unused `ResolveDefaultBranch` export from `workspace-runtime-policy.ts` and its imports/assertions from `runtime-policy-bindings.type-test.ts` and `apps/runtime/src/forbidden-bindings.type-test.ts`. Assertions against the actual dependency types and shared implementation imports remain.

This preserves the verified credential boundary and current lookup timing without expanding the provisioning refactor. The tradeoff is narrower reuse: a future runtime adapter supplies preparation rather than reusing product provisioning as shared policy. No executable code moves in this cleanup, and there is no new shared-metadata ownership claim.

## Supporting file scope approved

The user approved the test changes, including `apps/web/src/lib/session-git-backup.test.ts`. That test preserves the checkpoint assertions and checks that the callback is supplied. The user then explicitly approved both supporting source edits:

1. `apps/web/src/db/index.ts`: `createDb` now takes `{ DB: D1Database }` rather than `Pick<Env, "DB">`. The implementation is unchanged; the type no longer drags product Env into shared compilation.
2. `apps/web/src/lib/session-git-backup.ts`: the product caller supplies the existing runtime-lease callback after recovery stopped dynamically importing product orchestration.

Both approved source files still match the reviewed hashes. Approval is recorded in plan 002's file scope. No source changed during this acceptance step; the advisor updated only plan and review records.

## Limits and next step

This review covers the repair deltas and their production paths, not a fresh audit of every unchanged schema/contract invariant or later-phase behavior. Docker boot, paid topology, live deployment, shared D1 migration and real-user trusted routing were not run. Existing local 001 evidence is preserved; paid topology remains NOT RUN and blocks real-user enablement.

Plan 002 is accepted with its approved scope and design adjustment. At the user's later request, source was committed and merged locally into `brain` at `693a334`. Plan 003 is ready for a separate execution request from that baseline; it has not started. This merge does not authorize pushing, deploying or enabling real-user trusted sessions.
