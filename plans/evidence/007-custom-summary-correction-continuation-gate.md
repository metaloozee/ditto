# 007 custom-summary correction continuation gate

Status: READY FOR REVIEW for the custom-summary prerequisite only. Both requested correction predicates pass in the executor's synthetic local checks. This is not independent acceptance, integration, or completion of full 007. Remaining product adapters stay blocked pending parent review.

## Restoration and execution boundary

Worktree: `/home/ayan/ditto-execution/plan-007-recovery`, detached at `0ccc5b20c25a4e63017b3eebf6608dba62253479`.
Main `/home/ayan/ditto` was read-only recovery/reference input. No main source or dependency changes occurred.

The earlier mandatory restoration stop remains unchanged in local `plans/evidence/007-custom-summary-correction-gate.md` and its failed-restoration archive. This continuation did not erase that record. Parent supplied the exact final preparation gate. The executor copied only that corrected recovery input, without reapplying the tracked patch or replacing the six matching files:

```sh
cp /home/ayan/ditto/plans/evidence/artifacts/007/custom-summary-advisor-review/recovered/apps/runtime/src/pi-durable-model-preparation.gate.test.ts apps/runtime/src/pi-durable-model-preparation.gate.test.ts
sha256sum -c /home/ayan/ditto/plans/evidence/artifacts/007/custom-summary-advisor-review/source.sha256
```

All seven original source identities passed before correction edits. No expected identity was revised. `custom-summary-correction-verified-baseline.tar.gz` preserves that exact restored baseline. `38-baseline-identities.log` independently checks its seven archived file bytes against the original recorded hashes.

Accepted decision, updated complete handoff, current plan, recovered previous gate, prior correction/API/advisor evidence, full authoritative specification, domain glossary, and applicable Cloudflare/DO/Workers/diagnosing-bugs/unslop skills were read. No ADR files were found in this checkout's `docs/adr`; none were fabricated. No missing improve reference was invented. Planning references were copied into the worktree, not edited as acceptance records.

Observed environment: `PI_PROVIDER=openai`, `PI_MODEL=gpt-6.1-sol`, Node `v24.21.0`, pnpm `11.8.0`. The dispatch requested medium reasoning; `PI_THINKING_LEVEL` was unset, so no separate environment-level verification of that setting is claimed. Pinned Pi Durable 1.0.1, Biome 2.4.5 and runtime Vitest 3.2.7 were retained.

Frozen scripts-disabled installs occurred only here:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm install --frozen-lockfile --ignore-scripts
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true npm ci --ignore-scripts --prefix packages/sandbox-runner
```

Logs: `01-install.log`, `16-runner-install.log` under `node_modules/007-custom-summary-correction-logs/`. No real environment file, account, credential or live provider operation was used. No staging, commit, merge, push, integration, deployment, worktree deletion, shared-data mutation or billing fallback occurred.

## Correction scope

Correction-only source differences against the verified restored baseline are limited to:

- `apps/runtime/src/pi-durable-host.ts`
- `apps/runtime/src/pi-durable-summary.test.ts`
- `apps/runtime/src/pi-durable-model-preparation.gate.test.ts`, routing its existing host-backed configuration calls through the owner

The restored cooperative fixture, effects tests, summary module, and approved specification remain byte-identical to the original final candidate. `correction-only.patch` separates new hunks from the much larger inherited base diff. Source patch and final seven hashes are also archived.

The host adds one private short transition lane shared by narrow model/thinking configuration and new custom summary preparation. Configuration calls Pi's supported public `Conversation.configure()`, then flushes host/private durability before releasing the lane. New summary preparation resolves configuration inside the same lane and retains it through request hashing, encrypted sealing, preparation transaction and durable flush. Existing prepared requests are reused without configuration reselection.

This is not a configuration-intent adapter, account policy, scheduler or command-wide model pin. Pi remains the task/continuation/placement owner. No private prompt, task checkpoint replacement, fabricated receipt, provider implementation copy or new dependency was added. The Session transaction seam would require nesting public configure or holding the Session line across preparation; the private host lane avoids that coupling. It releases before `prepareModel`, effect admission, provider/model waits, hook result consumption and Pi placement. Actual close joins the lane after Harness close, preventing pending owner operations from surviving replacement.

Cancellation is checked when entering the lane and after asynchronous hashing/sealing before preparation writes. Rejected operations do not poison the queue. Preparation failure, canceled queued configuration, Stop and configuration flush failure are exercised. Configuration grants no model admission authority. The mandatory exact admission, authority, epoch, Stop, unknown-effect block, one-attempt policy, result accounting and placement reconciliation remain intact.

Automatic result-flush fault testing exposed pending assistants after recorded success had already left `admitted`. The existing persistence-failure terminalization now covers both `admitted` and `result-recorded` correlated effects. This preserves the successful evidence and reservation while failing pending projections under the storage fence. Already complete assistants remain complete. It does not retry or refund the summary.

## Forced configuration ordering

Four tests exercise both forced orders in plaintext and encrypted storage. The plaintext probe holds the actual Web Crypto request digest. The encrypted probe holds the actual AES-GCM sealing call for the prepared summary payload. Holds match the application-owned summary request, not a synchronous catalogue/model lookup.

The old candidate was tested before correction with the fixture's original direct configuration path. `02-forced-order-red.log` records two passing configuration-first tests and two failing preparation-first tests. While preparation was held, the configuration promise incorrectly completed. The failing assertion was `expected true to be false`, proving the missing shared ordering rather than accepting whichever order occurred.

Final configuration-winning probes also hold the real storage sync for owning configuration. They start compaction while that configuration operation remains unflushed and assert no preparation crypto entry or preparation commit. Only after configuration durability is released may preparation enter its own crypto hold. Commit order is explicitly `[configuration, preparation]`.

Preparation-winning probes hold request hashing/sealing, start a concurrent owning configuration change, and assert its promise has not resolved and the visible configured model is still `faux-1`. Preparation is then released and committed before configuration. Commit order is explicitly `[preparation, configuration]`.

Captured request predicates are exact:

| Forced order | Retained prepared model/thinking | Guarded recovered request | Next new summary |
|---|---|---|---|
| Configuration wins | `faux/faux-2`, high | `faux-2`, reasoning high | `faux-2`, reasoning high |
| Preparation wins | `faux/faux-1`, low | `faux-1`, reasoning low | `faux-2`, reasoning high |

Both requests retain `maxTokens: 1024`, `maxRetries: 0`, `cacheRetention: none`. The recovered callback transcript and complete non-signal options equal the persisted preparation exactly. Transcript policy is the unchanged `ditto-summary-1`, with the application system prompt and complete public source serialization, both timestamp 0. Actual close/open retains the original preparation while a newly prepared summary observes the changed configuration. No conditional expectation accepts the opposite order.

The extra control tests cover canceled queued configuration, Stop during crypto preparation, preparation transaction failure, and configuration persistence failure, in both storage modes. They verify release or persistent fencing and no hidden summary dispatch. The existing host-backed preparation gate uses the owner too. Raw direct-Harness calls in stock Pi-only generation/storage controls remain unchanged; no serialization guarantee is claimed for those bypasses or reflected Harness access.

## Automatic waiting-parent crash matrix

Twelve tests exercise all six boundaries in both storage modes with automatic compaction still enabled throughout recovery. They schedule an actual follow-up generation, inspect its actual owned compaction, and assert the real generation parent waits on that exact child before closing.

Ordinary holds use supported `Harness.inspect()` task inspection. Placement holds use the injected public `Storage.scanTasks()` and `Storage.task()` seam. An admitted Session commit blocks Session-line inspection, so attempting Harness inspection at that boundary would deadlock. The corrected probe reads the real persisted task records without mutating them, and asserts the generation parent remains `waiting` on the original compaction before close. After-placement reads include the actual terminal child committed by Pi, not a manufactured task or receipt.

| Boundary | Held fact and asserted recovery |
|---|---|
| Before custom preparation | Actual automatic child running; actual parent waiting; no summary preparation/effect yet. Close cancels the cooperative hook hold. Reopen prepares normally and completes the original parent. |
| Prepared before admission | Exact preparation persisted; no summary effect yet. Close cancels `prepareModel`. Reopen retains the same prepared payload and dispatches it once. |
| Admitted unknown result | One attempt and original admitted effect, no evidence. Two actual reopens deny scheduling and tool admission; even adversarial scheduling resume cannot dispatch another summary, generation or tool. The run is failed and no assistant remains pending. |
| Durable result before hook return | Original success and usage recorded while child remains in select and parent waits. Reopen reuses that same evidence without summary redispatch. |
| Before actual Pi placement commit | Public Storage intercepts the real terminal/placement batch before persistence. Close cancels the cooperative hold. Reopen reuses recorded success and Pi places one summary. |
| After actual commit before publication | Real Storage commit finishes, then publication is held. Close must remain incomplete until settlement is released. After actual close/open, Pi's original placement receipt is retained and parent generation continues. |

Every successful case asserts one summary guarded callback, one custom effect row, one reserved attempt, exact retained evidence/usage on reuse, one actual compaction entry, and a real automatic receipt whose `entryId` equals that entry. The original parent reaches terminal completed. Original and follow-up command membership remains exactly two commands; follow-up assistant becomes complete, and no assistant is pending after settlement.

Counts distinguish summary work from legitimate continuation: successful cases have one summary callback plus two ordinary generation callbacks, one initial and one resumed parent, for three synthetic provider calls total. Repeated reopen/reconciliation changes neither those counts nor the original custom effect. Unknown cases stay at one initial generation plus one summary dispatch, two calls total, across both reopens. One admitted nonrefundable attempt remains without result or later effect.

Sixteen additional automatic waiting-parent fault tests cover known failed summary, Stop, stale run epoch, revoked authority, request transaction/flush failure and result transaction/flush failure in both storage modes. Epoch/authority/Stop injections occur after preparation so they exercise stale work rather than legitimizing a new snapshot. No case revives parent generation, places a summary or starts a hidden summary retry. Known failure retains one attempt; unknown result/persistence outcomes remain fenced. All pending assistants settle complete or failed.

Genuine stock-Pi fallback/retry controls and ordinary generation behavior remain unchanged.

## Commands and results

All install, format, typecheck and test execution used the sanitized prefix shown above. Text-only Git/hash/spec checks operated on this worktree. Final verification ran sequentially, not in parallel.

```sh
pnpm --filter @ditto/runtime typecheck
pnpm exec biome check apps/runtime/src/pi-durable-host.ts apps/runtime/src/pi-durable-cooperative-fixture.ts apps/runtime/src/pi-durable-effects.test.ts apps/runtime/src/pi-durable-model-preparation.gate.test.ts apps/runtime/src/pi-durable-summary.ts apps/runtime/src/pi-durable-summary.test.ts
pnpm --filter @ditto/runtime exec vitest run src/pi-durable-summary.test.ts src/pi-durable-model-preparation.gate.test.ts src/pi-durable-effects.test.ts src/pi-durable-host.test.ts src/pi-durable-storage.test.ts src/pi-durable-history.test.ts
pnpm runtime:verify
pnpm verify
python3 node_modules/007-custom-summary-correction-logs/check-spec.py
git diff --check
git diff --cached --exit-code
git diff --exit-code -- '**/package.json' '**/*lock*' '*lock*'
```

| Final check | Result and raw log |
|---|---|
| Runtime typecheck, including forbidden bindings | passed, `29-typecheck.log` |
| Scoped Biome check, no writes | passed, 6 files, 54 warnings, no errors, `30-biome-check.log` |
| Six nearest suites | passed, 294 tests: summary 108, preparation 2, effects 62, host 55, storage 41, history 26, `31-nearest.log` |
| `runtime:verify` | passed, 327 Worker tests across 11 files plus 6 Node tests and runtime typechecks, `32-runtime-verify.log` |
| `verify` | passed, repository Biome, web/credential typechecks, 22 credential Worker tests plus 3 Node tests, 815 web tests across 73 files, web build, runner typecheck, 79 runner tests across 11 files and runner build, `33-verify.log` |
| Complete approved spec equality | passed, base spec plus exactly the accepted three old/new pairs equals the entire current spec, `34-spec-equality.log` |
| Diff whitespace, empty staging, unchanged manifests/lock graph | passed, `35-diff-check.log`, `36-empty-stage.log`, `37-lock-graph.log` |
| Original archived baseline identities | passed, all seven, `38-baseline-identities.log` |

New tests are discovered by aggregate runtime verification. No filtered zero-test run is counted as evidence. Final aggregate checks passed repeatedly during strengthening, including earlier `15-runtime-verify.log`, `17-verify.log`, `26-runtime-verify-final.log` and `27-verify-final.log`.

Intermediate failures are preserved, not rewritten:

- `02-forced-order-red.log`: 2 passed, 2 failed, 68 skipped. Baseline configuration overtook held preparation.
- `05-automatic-matrix.log`: incomplete run, 3 passed, 2 failed and isolated-storage error. Prepared polling assumed its host mapping already existed; placement inspection attempted the blocked Session line. Fixed polling and supported Storage inspection, without changing crash predicates or task checkpoints.
- `07-automatic-faults.log`: 12 passed, 4 failed, 84 skipped. Epoch injected before preparation was legitimately captured as current; moved the injection to the prepared wait. Result-flush failure left two pending assistants; corrected terminalization for recorded-but-unconsumed results.
- `06-automatic-matrix.log`: 12 passed after fixture correction.
- `08-automatic-faults.log`: 16 passed after correction.
- `09-owner-faults.log`: 8 passed.
- `10-forced-both-concurrent.log`: 4 passed after adding the held configuration durability branch.

Pinned formatting used scoped writes only during development, with check mode for final gates. Native-alarm safety checks were not weakened, skipped or given looser deadlines. They pass here, which does not explain historical intermittent failures or establish hosted reliability. Installed workerd still warns that requested `2026-09-16` falls back to `2026-03-10`.

PD38, live subscription authentication/entitlement/model transport, hosted eviction/deployment, quotas and billing are not run and not authorized. Full remaining 007 configuration/credential/product adapters are not implemented. Standalone contracts/brain verification was not run; no shared contracts changed. Historical stock-summary failures and the prior retry's missing raw logs remain limitations of their own records. Previous broad independent verification was interrupted, not passed. No independent acceptance of this correction is claimed.

## Preservation and review handoff

Artifacts under `plans/evidence/artifacts/007/` preserve:

- Failed initial restoration snapshot and original stop evidence.
- Exact verified restored baseline archive.
- Intermediate correction snapshot and raw logs.
- Final seven source identities, tracked patch, correction-only patch and final candidate archive with all new logs and this evidence.

Final archive: `custom-summary-correction-final.tar.gz`. Its sibling `.sha256` records archive identity. The archive excludes installed dependencies, CLI HOME, environment files and credentials. Parent must inspect the actual correction hunks and independently rerun gates before dependent work. Full 007 remains not DONE.
