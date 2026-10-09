# 007 preparation correction advisor review

Verdict: **the narrow preparation correction is verified; the full 007 prerequisite remains BLOCKED**. The original asynchronous `prepareModel` interruption now recovers successfully. An earlier interruption after Pi commits its summarize checkpoint but before its first provider callback still loses the request association and denies recovery. Passing regression suites do not prove that missing successful-continuation guarantee.

Reviewed base: `0ccc5b20c25a4e63017b3eebf6608dba62253479`. Detached execution worktree: `/tmp/ditto-plan-007-3oi7vl`. The separate correction executor used `openai/gpt-6.1-sol` with medium reasoning. Its [correction evidence](007-preparation-handoff-correction.md) preserves failed experiments and limits. The [initial advisor review](007-advisor-initial-review.md) and archived initial candidate remain unchanged.

No dependent request transport, credential-bearing reconstruction, operation-window or configuration-intent implementation was dispatched. No integration, staging or commit is authorized by this review.

## Reviewed correction

Every source hunk traces to the preparation correction:

- `apps/runtime/src/pi-durable-host.ts:1626–1655` seals, transactionally records and flushes the validated prepared tuple/transcript digest before asynchronous preparation and effect admission. The transaction rechecks the original mapping, callback lane and run epoch. Recording provenance creates no effect row and grants no admission authority.
- `:1656–1697` retains current task/mapping comparison, fresh admission, final authority and dispatch checks. Recovered requests still require the durable exact tuple/digest. Missing association, mixed producers and stale epochs are not authorized by a sole eligible producer.
- `:43` changes host compatibility to `pi-1.0.1/ditto-host-2`. Old host state is explicitly rejected. This is a candidate compatibility change, not a retained-state migration or cutover approval.
- The added preparation fault points exercise transaction rollback and post-transaction flush failure. Both paths preserve storage-failure fencing and admit no summary effect.
- The former same-window denial test now expects successful recovery because validated provenance exists. Separate missing and corrupt association tests preserve safe-denial coverage. Additional tests cover selection interruption on both sides of Pi persistence, stale epoch, encrypted provenance/reopen and old-host rejection.

The prepared tuple remains encrypted in retained storage using the existing owned host-field and seal mechanism. The synthetic preparation gate uses disposable plaintext storage, as permitted for feasibility probes. No encryption format, dependency graph, shared product contract, credential boundary or runtime networking configuration changed.

## Independently verified behavior

The advisor reviewed the actual host diff, full strengthened preparation test, all added/modified effects tests and the owning host persistence/admission methods. The pinned Pi task preparation and public Session/Storage ordering were checked directly.

At the corrected interruption window, there is only the completed initial generation effect when the summary is suspended. The validated summary association exists, but summary admission has not occurred. After actual host close/open, the same task completes under fresh admission. Captured configurations are:

1. Initial generation: `faux-1/off`.
2. Recovered prepared summary: `faux-1/low`, `maxTokens: 51`.
3. Newly prepared follow-up: `faux-2/high`.

The summary checkpoint and task identity remain unchanged across reopen. The preparation test checks the complete persisted tuple, including model, thinking, stream options, token limit and context positions. Captures happen inside the guarded dispatch callback. These checks establish synthetic configuration timing and the corrected local guard handoff, not live Codex request bodies or entitlement.

## Remaining preparation gap

The advisor independently ran both selection-boundary tests, first as part of the full effects suite and then with a verbose filter:

```sh
pnpm --filter @ditto/runtime exec vitest run src/pi-durable-effects.test.ts \
  -t 'selection handoff interrupted' --reporter verbose
```

- Before Pi commits `summarize`, close/open replays selection and the summary completes.
- After the real Pi Storage batch commits `summarize`, but before publication and the first provider callback, the selected task/range mapping exists while `prepared` and `digest` are null. Actual close/open retains Pi's prepared task. Recovery fails with `Summarization failed: Missing first summary association` and zero summary dispatches.

The post-storage test **passes because it asserts safe denial**. It is an executable demonstration of the unmet successful-recovery requirement, not a successful 007 gate. Neither the original correction nor a green aggregate suite may be presented as complete prepared-compaction recovery.

Pinned Pi 1.0.1 confirms the relevant ordering:

- Public `beforeCompact` exposes selected source entries/messages and task identity, not the constructed summary-provider transcript. It is not replayed in the recovered summarize phase.
- `compaction.js:57–127` commits summarize configuration after selection and later constructs the summary request.
- `session/session.js:249–307` settles Storage before adoption/publication. Admitted Storage settlement strips caller cancellation. A post-adoption commit listener cannot provide a pre-storage atomic association on its own.

The boundary fixture follows that contract: it pauses after the real SQLite batch, starts close, observes the original invocation's abort signal, releases admitted storage settlement and joins actual close. It does not use a canceled outer waiter as evidence of close or replace host yield with user Stop.

This proves the current integration lacks a verified owning handoff at that boundary. It does not prove that every supported design is impossible or that Pi loses configuration. No private summary prompt copy, scheduler patch, fork or weakened guard was introduced.

## Independent commands

All checks ran sequentially in the disposable execution worktree with this prefix:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true
```

| Command/check | Result |
|---|---|
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-model-preparation.gate.test.ts` | passed, 2 tests |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-effects.test.ts` | passed, 62 tests, including rollback, flush failure, encrypted reopen and safe-denial boundary checks |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-host.test.ts` | passed, 55 tests |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-storage.test.ts` | passed, 41 tests |
| `pnpm runtime:verify` | passed, typechecks, 6 Node checks and 219 actual Worker tests across 10 files |
| Selection-boundary verbose filter | passed, 2 tests, 60 skipped; after-commit case asserts failed compaction, not successful recovery |
| Scoped Biome on all three candidate source/test files | passed, no writes |
| `git diff --check` | passed |
| Manifest, lockfile and runtime test-config preservation | passed, unchanged |
| Staged diff and base HEAD preservation | passed, empty staged diff and unchanged base |
| Candidate archive integrity | passed, `gzip -t` |
| `pnpm verify`, web/credential/contracts/brain gates | not run, full prerequisite remains blocked and dependent implementation is absent |
| PD38, actual provider/auth/account discovery, hosted platform and deployment checks | not run, not authorized |

The executor's final aggregate run failed an inherited native-alarm retry test with `Invocation authority expired`. The advisor's full host suite and aggregate rerun both pass, but that does not erase the failed run or establish its cause. No baseline causality experiment or timing fix was performed; no assertion was weakened. The earlier failure and setup/timeout experiments remain archived. Stable alarm acceptance is not claimed from one passing rerun.

The requested compatibility date still falls back from `2026-09-16` to installed workerd's `2026-03-10`. These are local fixture results, not hosted evidence.

## Preserved candidate and next decision

[Independent logs, source patch and hashes](artifacts/007/correction-review/) identify the reviewed candidate. [Candidate archive](artifacts/007/preparation-correction-candidate.tar.gz) contains all three source/test files, executor/review evidence and complete initial/correction/independent logs. It excludes installed dependencies, CLI HOME and environment/credential files.

Archive SHA-256:

```text
26506775c6a31d0b56a5757e1cbeeeda86bf88e094308add740e27525fa700d9
```

The live worktree remains detached and uncommitted. Only `plans/` evidence/status files changed in the main checkout. No main source/dependency change, staging, commit, integration, worktree deletion, deployment or live request occurred.

007 and dependent 008 remain BLOCKED. Before another execution attempt, review a supported owning API or integration design that supplies exact task/request provenance for the first recovered summary, including the post-checkpoint/pre-callback interruption. A per-attempt summary-request hook carrying task identity and the exact request is one concrete upstream API candidate to investigate, not an implemented or necessarily exclusive solution. Do not file an upstream issue without separate authorization, assume an upgrade fixes it, copy private prompts or remove the admission check to continue.
