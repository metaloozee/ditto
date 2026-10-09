# 007 configuration-close advisor probe

Verdict: REPRODUCED. The default-context public configuration operation can keep the owning joined-close operation pending beyond its admitted invocation end deadline while authority remains unresolved. The custom-summary candidate is BLOCKED pending the parent's repair decision. No host fix was made.

## Scope and preserved baseline

Execution used `/home/ayan/ditto-execution/plan-007-recovery` only, on the existing `openai/gpt-6.1-sol` dispatch with requested medium reasoning. Main was read-only. No install, staging, commit, integration, deployment, live network/provider/account/credential operation, deletion or shared-data mutation occurred.

Baseline candidate archive SHA-256 remains `66e023fc61f44e305e0a331a76dc5898de6921866f61e7f69ba944a4c2d2407a`. All seven candidate source identities passed before the probe. The original summary test and candidate hash lists were saved under ignored `node_modules/007-config-close-advisor-probe/`.

Only `apps/runtime/src/pi-durable-summary.test.ts` changed, adding four targeted cases before its final policy-parser test. The test delta is one insertion of 151 lines. Existing fixture, gate and stock controls are unchanged. Host and all five other candidate source/spec files remain byte-identical to their original candidate hashes, verified in `06-preserved-source.log`. The saved original summary test also matches its original hash.

This phase did not rewrite previous evidence or the original candidate archive. Parent's earlier independent summary/runtime passes remain evidence for that earlier candidate, not refutation of the new failing deadline predicate.

## Red-capable test

The new test is named:

`configuration authority wait joins close by admitted deadline, external cancellation=<false|true>, encrypted=<false|true>`

It uses the existing `gate()` and fixture with real Worker/DO SQLite, in disposable plaintext and encrypted modes. After `f.start()` completes, it reads the actual persisted admitted invocation's `id`, `started`, `yield_at` and `end_at`. Only then does it replace the injected authority lookup with a synthetic `pendingRemote` and record lookup entry.

The defect cases call `f.host.configure({ thinkingLevel: "high" })` with no context argument. They neither abort an incoming request nor cancel the authority wait manually before the deadline observation. After lookup entry, they call actual `f.host.yield()`.

The supported synthetic `dependencies.now` advances to that invocation's recorded `yield_at`, then advances monotonically with measured `performance.now()` elapsed time. This models yielding at the invocation work boundary without waiting through the unrelated 10-second work allowance. It preserves the full recorded 1000 ms drain allowance. The observer waits the actual remaining interval through `end_at`, plus 50 ms. It asserts that measured elapsed time spans the drain allowance and recorded observation time exceeds the real persisted `end_at`. A 20 ms delay is not used as deadline evidence.

The required regression predicate is joined close completed at or before `end_at`, with configuration rejected and the independent authority remote still unresolved. The default-context cases fail at `expected 'pending' to be 'complete'` after the deadline.

The contrast cases provide a caller AbortSignal and externally cancel it after the authority wait enters, before yield. They pass with joined close completed in 10–27 ms while the remote authority promise remains unresolved. This establishes that the wait can cooperate when supplied a cancellation signal; the held remote promise itself need not finish for safe local close.

Every case releases the independent authority remote in `finally`, restores the authority dependency, and joins both configuration and host yield before leaving the fixture. Default cases then record configuration rejection and failed close accounting with `Actual close exceeded end deadline`. The gate's repeated cleanup yield returns that same failed close, which is captured outside the gate so it does not replace the original deadline observation. No hanging task or unhandled rejection remains. No Pi checkpoint or task state was patched.

## Exact observations

Times below are the recorded synthetic invocation-clock milliseconds from raw Worker output. Elapsed is real measured wall time from starting yield. All invocations retain a 1000 ms drain allowance.

### First execution, `02-worker-regression.log`

| Storage / context | Invocation ID | yield_at | end_at | Observed at / elapsed | State at observation | Joined after remote release |
|---|---|---:|---:|---|---|---|
| Plaintext / default | `e84d0cd5-d8c0-40d7-84f5-4c9cf5e0f1ea` | 1791464612690 | 1791464613690 | 1791464613742 / 1052 ms | configure pending, close pending, remote unresolved | configure failed at 1791464613743; close failed at 1791464613754 |
| Encrypted / default | `18a7cc84-e44b-4bcc-a07b-2b194c97dc4e` | 1791464615127 | 1791464616127 | 1791464616177 / 1050 ms | configure pending, close pending, remote unresolved | configure failed at 1791464616178; close failed at 1791464616185 |
| Plaintext / external cancellation | `27ce5064-cc35-4b92-9c10-69de8d6ddd96` | 1791464613927 | 1791464614927 | 1791464614979 / 1052 ms | configure aborted, close complete at 1791464613939, remote unresolved | already joined, 12 ms close |
| Encrypted / external cancellation | `0c54802a-999e-441d-ac21-36eeb9f8b67b` | 1791464616327 | 1791464617327 | 1791464617379 / 1052 ms | configure aborted, close complete at 1791464616339, remote unresolved | already joined, 12 ms close |

### Repeat execution, `03-worker-repeat.log`

| Storage / context | Invocation ID | yield_at | end_at | Observed at / elapsed | Close result |
|---|---|---:|---:|---|---|
| Plaintext / default | `0f3b229b-4e89-4d9e-9b8b-eba70f9cbbfb` | 1791464644522 | 1791464645522 | 1791464645573 / 1051 ms | pending past deadline; after release failed at 1791464645582 |
| Encrypted / default | `0f44e51f-d5de-4544-a243-cecf2ef00c2c` | 1791464646953 | 1791464647953 | 1791464648004 / 1051 ms | pending past deadline; after release failed at 1791464648012 |
| Plaintext / external cancellation | `d28dccbb-db8f-44f3-9351-b6d0fac98c5d` | 1791464645752 | 1791464646752 | 1791464646804 / 1052 ms | complete at 1791464645762, 10 ms |
| Encrypted / external cancellation | `730ae3e6-78ef-4cda-8e85-2815e7397c8d` | 1791464648145 | 1791464649145 | 1791464649197 / 1052 ms | complete at 1791464648172, 27 ms |

Both default-context repetitions also retain configuration pending until the remote is released. Their configuration then rejects with `Host admission denied: Unresolved effect blocks admission`. Both external-cancellation repetitions reject configuration with `The operation was aborted` and leave the remote unresolved until cleanup. `observations.json` contains all eight exact structured records, including started times and final outcomes, extracted from real logs rather than invented identities.

## Supported code explanation and limits

The observed behavior matches the unchanged host implementation:

- `pi-durable-host.ts:1365–1378`: the owner queue retains the configuration operation; its wait uses the supplied Context only.
- `:1380–1388`: default configuration Context is `BACKGROUND_CONTEXT`; authority is awaited through `awaitWithContext` without an invocation/host abort signal.
- `:3624–3629`: yield seals admission and starts close, but does not signal that owner operation.
- `:3684–3685`: host close awaits Harness close and then the retained owner queue before deadline accounting.

The failing predicate concerns actual `PiDurableHost.yield()` joined close/accounting. The probe does not independently time the private Harness close substep, prove remote cancellation, or claim an exactly-once authority service. It proves a deadline breach with an unresolved synthetic authority promise and shows that caller cancellation permits bounded local completion. Indefinite waiting is not measured literally; the owning operation stayed pending for the complete admitted drain allowance and beyond, then settled only after explicit cleanup release.

No repair design or host change was implemented. Parent decides the next phase separately.

## Commands and results

All execution used:

```sh
cd /home/ayan/ditto-execution/plan-007-recovery
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true ...
```

Exact regression command, run twice before any fix:

```sh
pnpm --filter @ditto/runtime exec vitest run src/pi-durable-summary.test.ts \
  -t 'configuration authority wait joins close by admitted deadline'
```

Both runs exited 1: 2 failed default-context cases, 2 passing external-cancellation controls, 108 skipped existing tests, 112 discovered. Runtime shutdown completed; no isolated-storage or hanging-cleanup error occurred. Compatibility-date fallback remains unchanged.

Other checks:

- Scoped pinned formatter, `01-format.log`, passed; only the added test insertion differs.
- `pnpm --filter @ditto/runtime typecheck`, `04-typecheck.log`, passed including forbidden bindings.
- `pnpm exec biome check apps/runtime/src/pi-durable-summary.test.ts`, `05-biome.log`, passed with 13 existing warnings and no writes.
- Source identity preservation, diff whitespace, empty staging and unchanged manifest/lock graph passed in logs `06` through `09`.

Full summary suite, runtime/repository aggregate gates, live/provider/hosted checks and downstream 007 work were not run in this targeted probe. The narrow intentional red regression is the finding, not a passing aggregate gate.

## Preservation

Raw logs, original candidate source/archive hash lists, original summary test, test-only delta and eight structured observations are retained under `node_modules/007-config-close-advisor-probe/`.

`plans/evidence/artifacts/007/configuration-close-advisor-probe.tar.gz` preserves those files, the current probe test and this new evidence. Its sibling `.sha256` records archive identity. The original candidate archive is untouched. Full 007 remains blocked pending review and a separately authorized repair.
