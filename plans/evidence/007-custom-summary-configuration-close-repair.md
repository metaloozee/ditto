# 007 configuration-close repair

Status: READY FOR REVIEW for this narrow custom-summary lifecycle repair. Executor checks pass; parent independent acceptance is still required. Full 007 is not DONE and dependent product adapters remain blocked.

## Boundary and baseline

Execution worktree: `/home/ayan/ditto-execution/plan-007-recovery`, detached at `0ccc5b20c25a4e63017b3eebf6608dba62253479`.
The complete repair handoff was read and copied to `plans/decisions/007-configuration-close-repair-handoff.md`. The accepted custom-summary decision, specification, domain context and applicable skills remain the constraints from the preceding execution, not new instructions inferred from repository data.

Execution stayed on the existing requested `openai/gpt-6.1-sol` dispatch with medium reasoning. No model/provider/account/billing change occurred. Main was read-only. No install, stage, commit, merge, push, integration, deployment, deletion, real environment/credential/provider operation or shared database mutation occurred.

Before editing, the current seven source identities were saved to `node_modules/007-configuration-close-repair-logs/baseline-source.sha256`. Baseline host and summary test copies and `plans/evidence/artifacts/007/configuration-close-repair-baseline.tar.gz` preserve the rejected candidate with its exact four-case probe. Historical probe/correction logs, evidence and archives were not rewritten. The original `66e023fc61f44e305e0a331a76dc5898de6921866f61e7f69ba944a4c2d2407a` archive remains historical evidence for the earlier candidate, not this repair.

## Initial red reproduction

The exact authorized filter ran before any repair:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true \
  pnpm --filter @ditto/runtime exec vitest run src/pi-durable-summary.test.ts \
  -t 'configuration authority wait joins close by admitted deadline'
```

`01-red.log` exited 1: two default-context failures, two passing caller-canceled controls, 108 skipped, 112 discovered. Against the unchanged actual 1000 ms drain allowance:

- Plaintext default configuration and host yield were pending at 1052 ms, 52 ms past `end_at`. Cleanup release then produced `Actual close exceeded end deadline`.
- Encrypted default configuration and host yield were pending at 1051 ms, 51 ms past `end_at`. Cleanup release produced the same close failure.
- Externally canceled controls completed joined close in 10 ms plaintext and 15 ms encrypted while their authority remote was independently unresolved.

The exact original four-case probe, including clock, deadline, remote-release cleanup, assertions and external controls, remains byte-identical after repair. `16-source-preservation.log` checks its complete original suffix against the saved baseline. No budget or safety predicate was relaxed.

## Narrow source repair

Only these source files changed:

- `apps/runtime/src/pi-durable-host.ts`
- `apps/runtime/src/pi-durable-summary.test.ts`

All five other candidate source/spec identities remain unchanged. No spec, policy, compatibility, successful response validator, provider, task definition, scheduler or dependency changed.

The host now owns one lifecycle AbortController for its short owner operations. `ownerTransition` derives a context using the supported Chord `withAbortSignal`, which combines the lifecycle signal with the existing caller/task signal. Its callback receives that derived context explicitly. Both configuration and new summary preparation use the callback context for actual awaited work rather than retaining their original captured context.

Yield first seals admission, then aborts owner operations. This cancels the local authority waiter for a default-context configuration operation even while the independent authority promise remains unresolved. Queued callbacks check the same canceled context before executing. Rejection still drains the queue without poisoning it. Reopen creates a new host lifecycle controller; the closed host's controller is never reset.

Configuration's authority, public root/configure operations and durability path use the bound context. After an already-admitted public configure commit returns, an explicit cancellation check rejects the canceled operation before calling the host durability helper. This avoids treating successful mandatory Session settlement followed by lifecycle cancellation as a new storage-flush failure. Genuine configuration flush failures still reach the unchanged failure fence and existing regression.

Summary request hashing and encrypted sealing are awaited with the bound owner context before the existing cancellation/epoch checks and preparation transaction. Late crypto completion cannot advance the canceled owner callback to its write. The lane still covers preparation through commit/flush and releases before `prepareModel`, effect admission, provider/model waits and Pi placement.

No timeout race, longer allowance, unjoined return or removed queue join was introduced. `closeAndAccount()` still awaits real Harness close and then the real owner queue before accounting. Public Pi Storage settlement already admitted by Session remains mandatory and is joined, not canceled or falsely reported as rolled back.

## Green deadline evidence

The same exact filter passed immediately after repair in `02-green.log`, then again on final source in `06-green-final.log`: four tests passed, 114 skipped, 118 discovered after the six additional safety cases.

Final exact observations retain the full 1000 ms drain allowance and independently unresolved authority remote:

| Mode | Recorded yield_at | Recorded end_at | Actual joined close at | Close elapsed | Configuration outcome |
|---|---:|---:|---:|---:|---|
| Plaintext, default context | 1791465345659 | 1791465346659 | 1791465345670 | 11 ms | rejected, operation aborted |
| Encrypted, default context | 1791465348084 | 1791465349084 | 1791465348096 | 12 ms | rejected, operation aborted |
| Plaintext, caller canceled | 1791465346892 | 1791465347892 | 1791465346906 | 14 ms | rejected, operation aborted |
| Encrypted, caller canceled | 1791465349277 | 1791465350277 | 1791465349288 | 11 ms | rejected, operation aborted |

The observer still waits 1051–1052 ms and verifies completion happened before `end_at`. It does not mistake that observation delay for close duration. Late authority release in cleanup does not change the recorded rejected configuration or completed close.

## Additional queue and admitted-settlement evidence

Six new cases extend only the existing summary fixture:

- Two queued-owner tests, one per storage mode, start three default-context configuration changes while the first authority lookup is held. Actual yield completes and all three changes reject while the remote is still unresolved. After releasing that remote and reopening, model and thinking equal their original values, and provider calls stay at one initial generation. A new configuration operation on the replacement host succeeds. This proves cancellation before admission does not mutate configuration or produce a late write after release/reopen.
- Four public Storage settlement tests hold an already-admitted configuration batch immediately before its real storage commit or after that real commit but before publication, in both storage modes. They verify Storage receives the mandatory settlement context with no caller abort signal. Yield remains unjoined while settlement is held. Releasing it allows actual close/accounting to complete. The canceled configuration caller rejects, but reopen retains the legitimately admitted high-thinking configuration. No safety marker or provider redispatch is fabricated. This distinguishes canceled pre-admission work from already-admitted persistence.

The 20 ms observation in these settlement tests proves only that close waits for an explicitly held mandatory commit; it is not deadline-breach evidence. The unchanged four-case probe supplies the actual deadline predicates.

All previous forced configuration/preparation ordering, queued caller cancellation, Stop, configuration/preparation flush-failure fencing, exact prepared request retention, automatic six-boundary waiting-parent recovery, one-attempt/result/usage reuse, unknown-outcome blocking and assistant-settlement checks pass in the complete nearest and aggregate suites. Stock controls are unchanged.

## Verification

All formatting, typecheck and test commands used the sanitized environment prefix above, in this worktree. Checks ran sequentially. No zero-test filter is counted.

```sh
pnpm --filter @ditto/runtime typecheck
pnpm exec biome check apps/runtime/src/pi-durable-host.ts apps/runtime/src/pi-durable-summary.test.ts
pnpm --filter @ditto/runtime exec vitest run src/pi-durable-summary.test.ts src/pi-durable-model-preparation.gate.test.ts src/pi-durable-effects.test.ts src/pi-durable-host.test.ts src/pi-durable-storage.test.ts src/pi-durable-history.test.ts
pnpm runtime:verify
pnpm verify
python3 node_modules/007-custom-summary-correction-logs/check-spec.py
git diff --check
git diff --cached --exit-code
git diff --exit-code -- '**/package.json' '**/*lock*' '*lock*'
```

| Check | Result and raw log |
|---|---|
| Exact red filter before repair | failed as expected, 2 failed / 2 passed, `01-red.log` |
| Exact green filter after repair and on final source | passed, 4 tests, `02-green.log`, `06-green-final.log` |
| Runtime typecheck including forbidden bindings | passed, `07-typecheck.log` |
| Scoped Biome check, no writes | passed, two files, 37 warnings, no errors, `08-biome.log` |
| Six nearest suites | passed, 304 tests: summary 118, preparation 2, effects 62, host 55, storage 41, history 26, `09-nearest.log` |
| Runtime aggregate | passed, 337 Worker tests across 11 files plus 6 Node checks and runtime typechecks, `10-runtime-verify.log` |
| Repository verify | passed, repository Biome, web/credential typechecks, 22 credential Worker and 3 Node tests, 815 web tests across 73 files, web build, runner typecheck, 79 runner tests across 11 files and runner build, `11-verify.log` |
| Exact full-file spec equality | passed, base plus only the three approved replacements, `12-spec-equality.log` |
| Whitespace, empty stage and unchanged manifest/lock graph | passed, logs `13`–`15` |
| Other five source identities and original probe preservation | passed, `16-source-preservation.log` |

One intermediate safety-test failure remains recorded in `04-owner-settlement.log`: four admitted-settlement cases passed; two new queue cases compared the entire resolved Agent across reopen, including recreated fixture extension identities. The assertions were corrected to compare the actual persisted model and thinking configuration. All original deadline and stock assertions were untouched. The six new cases then passed as part of the final complete suite. Pinned formatting writes are recorded in `03-format.log` and `05-format.log`; final Biome ran in check mode.

A diagnostic CommonJS `require.resolve` lookup failed on Chord's import-only context export. The installed ESM context implementation was read directly instead; no dependency change followed. That tool output was not saved as a raw execution log.

Native-alarm checks were not weakened, skipped or given longer deadlines. Final gates pass, but do not explain historical alarm flakiness or prove hosted reliability. Workerd still warns that requested `2026-09-16` falls back to `2026-03-10`.

No live/provider/hosted checks, PD38, downstream adapters, account policy, subscription credentials or billing fallback were run. Standalone contracts/brain gates were not run; their source/contracts are unchanged. The old missing-log and interrupted-independent-verification limitations remain historical, not newly claimed passes.

## Archive and next review

`node_modules/007-configuration-close-repair-logs/` contains baseline/final source hashes, baseline host/test, actual red/green/intermediate/final raw logs, source preservation checks and `repair-only.patch`.

Artifacts under `plans/evidence/artifacts/007/` preserve the baseline, intermediate snapshot and `configuration-close-repair-final.tar.gz`. The final archive contains all seven candidate source/spec files, new evidence, repair handoff, exact repair delta, baseline/final hashes and complete new logs. Its sibling `.sha256` records archive identity. It excludes installed dependencies, CLI HOME, environment files and credentials. Earlier logs and archives remain intact.

Parent must inspect the actual repair hunks and independently rerun the exact deadline and aggregate gates. READY FOR REVIEW is executor evidence only, not acceptance or integration. Full 007 remains not DONE and dependent adapters remain blocked.
