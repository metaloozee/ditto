# 003 integration and 004 workspace preparation

003 is committed and merged into local `brain`. 004 has a clean, dependency-installed executor worktree and is ready for a separate execution request. No phase-004 implementation was started.

## Git integration

| Commit | Purpose |
|---|---|
| `237affb` | Recovery command contracts and parser tests |
| `03af7f0` | Accepted web admission, durable delivery, fencing and tests |
| `9db0fbb` | Historical executor evidence, including intermediate failures |
| `dcbd7b3` | Independent acceptance review, probes and evidence |
| `162e134` | Local merge of `grok/plan-003-admission` into `brain` |

The final handoff documentation follows that merge. No source changes were made during integration. All 17 candidate source files in `brain`, the retained 003 worktree and the prepared 004 worktree match the [accepted manifest](../final/scope.json). The full tracked source diff from `d18bf57` contains exactly those 17 paths and no other changes outside `plans/`.

The pre-commit hook automatically formats and fixes staged JavaScript/TypeScript. Integration commits used `LEFTHOOK=0` to preserve reviewed source and historical evidence byte-for-byte. Non-mutating verification ran separately. No hook configuration or package manifest/lockfile was changed.

## Worktrees

| Worktree | Branch | Handoff |
|---|---|---|
| `/home/ayan/ditto` | `brain` | Merged source and committed current plans |
| `/home/ayan/ditto-worktrees/plan-003-grok` | `grok/plan-003-admission` | Retained reviewed work, fast-forwarded to the current handoff |
| `/home/ayan/ditto-worktrees/plan-004-grok` | `grok/plan-004-coordinator` | Prepared executor, same handoff and installed dependencies |

The historical `/home/ayan/ditto-worktrees/plan-001-reexecute` remains untouched. Its old untracked evidence was not staged, deleted or hidden. It is not an execution target.

## Verification

All commands ran against merged source at `162e134`. Later handoff edits change only `plans/`. Node `v24.21.0`, npm `12.0.2`, pnpm `11.8.0`.

Each gate below passed twice: after merging in the retained 003 worktree, then in the fresh 004 worktree after installing its dependencies.

| Gate | Result | Retained 003 log | Fresh 004 log |
|---|---|---|---|
| `pnpm verify` | PASS: check/typecheck/build, 757 web tests and 79 runner tests | [verify.log](verify.log) | [004-verify.log](004-verify.log) |
| `pnpm runtime:verify` | PASS: typechecks and 20 tests | [runtime-verify.log](runtime-verify.log) | [004-runtime-verify.log](004-runtime-verify.log) |
| `pnpm brain:verify` | PASS: 14 contracts tests, consumer freshness, 43 brain tests and typechecks/builds | [brain-verify.log](brain-verify.log) | [004-brain-verify.log](004-brain-verify.log) |
| `003-repair-probes.cjs` with explicit worktree root | PASS: 23 checks, zero failures | [probes.log](probes.log) | [004-probes.log](004-probes.log) |

The `004-*` logs verify the inherited baseline in the new worktree. They do not claim passing coordinator/journal tests that have not been implemented. Raw console logs retain tool-emitted trailing whitespace and final blank lines; Git whitespace checks cover source and edited Markdown, not these unchanged output bytes.

The [setup log](004-setup.log) records:

```sh
pnpm install --frozen-lockfile
pnpm contracts:verify
npm ci --prefix packages/sandbox-runner
npm ci --prefix packages/session-brain
npm run contracts:check --prefix packages/session-brain
```

Contracts were built before the independent npm brain install. The imported consumer passed freshness checks. No dependency upgrades or lockfile edits occurred. Builds and installs wrote only ignored outputs in the isolated executor worktrees.

Existing warnings remain:

- Biome reports 11 warnings.
- The installed local Workers runtime falls back from requested compatibility date `2026-09-16` to `2026-03-10`.
- Each independent npm install reports four dependency vulnerabilities, two moderate and two high. This preparation did not investigate or remediate them.
- npm blocks unapproved dependency install scripts. No additional scripts were approved; all required local gates still pass.
- The focused contracts-consumer selection skips three unrelated tests; the subsequent full brain suite runs all 43.

## Execution handoff

Use the prepared 004 worktree and its committed `plans/004-coordinator-and-encrypted-journal.md`. Recheck Git status before starting. `xai/grok-4.6` remains the recorded subagent preference unless the next execution request changes it.

The refreshed plan records the actual 003 transport acknowledgment shape, persisted-command reconstruction, default-closed eligibility, accepted shared-policy boundary and current source anchors. Existing local gates pass; full T06/T07 coordinator consumption, T08/T25/T31, encrypted journal and projection behavior remain 004 work.

No push, PR operation, deployment, shared migration, production inspection, live credentials, paid platform test or real-user trusted-runtime enablement was performed. This is local implementation readiness, not release approval.
