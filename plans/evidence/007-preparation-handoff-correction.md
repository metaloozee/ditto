# 007 preparation handoff correction

Disposition: **BLOCKED for the full prepared-compaction recovery prerequisite.** The narrower `prepareModel` interruption is corrected and passes. An earlier, independently executable boundary remains fail-closed: Pi can durably commit `summarize` before the first provider callback establishes the validated transcript association. Do not dispatch dependent 007 transport/configuration work from this evidence. 007 is not DONE.

Worktree: `/tmp/ditto-plan-007-3oi7vl`, detached at `0ccc5b20c25a4e63017b3eebf6608dba62253479`. No staging, commits, integration, deployment, main-checkout operations, dependency installation/repair, configuration or hook changes occurred. All reads and commands used this worktree. No environment/credential files or real account/provider destinations were read or used. Fixtures use the existing synthetic `faux` provider and synthetic encryption keys; no network request was added.

Historical `007-codex-model-policy.md`, `007-advisor-initial-review.md`, their archives and `node_modules/007-logs` remain unchanged. Complete correction logs, including failures, are retained under ignored `node_modules/007-correction-logs`. The original compaction-success predicate remains an ordinary assertion, not an expected failure or skip.

## Narrow correction

`apps/runtime/src/pi-durable-host.ts:1505–1686` still requires the trusted invocation HookApi binding for first association, exact task/owner/conversation mapping, Pi checkpoint configuration, selection range, bounded transcript digest and allowed options. Recovered compaction still requires exact durable prepared tuple and digest (`:1540–1547`); sole eligible producer selection grants no transcript authority.

After validation, `:1626–1655` seals and transactionally stores the tuple/digest **before** `dependencies.prepareModel` and `admitExact`. The transaction rechecks the original mapping, callback lane and captured run epoch. It uses the existing host-field encryption, seal ownership, transaction rollback and durability barrier. The subsequent mapping equality checks compare the newly persisted validated mapping (`:1664`, `:1682`), rather than either ignoring it or comparing against the old null association.

This association is preparation provenance, not an effect receipt. It creates no `host_effects` row, reserves no allowance and carries no fresh authority. `admitExact` (`:1381`) remains the separate decision with fresh authority, run epoch, deadline, reservation, durable effect receipt and post-admission authority checks; final dispatch checks remain mandatory. Stop, uncertainty, retries, encrypted-field checks and persistence-failure fencing are retained.

Persisted meaning changes are explicit: host compatibility is now `pi-1.0.1/ditto-host-2` (`:43`). Host-1 records fail reopen with `Incompatible host state`; there is no automatic reinterpretation or migration. Pi encrypted-storage format, dependency graph and shared product contracts are unchanged. The old-host rejection regression is at `pi-durable-effects.test.ts:1600`.

## Covered and uncovered interruption boundaries

| Boundary | Evidence and outcome |
|---|---|
| Selection hook has durably mapped the task, but Pi has not committed `summarize` | Supported `bindCompaction` wrapper suspends after trusted binding. Actual close cancels the selection invocation. On reopen Pi replays selection, establishes the exact binding and completes. |
| Pi Storage has committed `summarize`, but commit publication/provider callback has not happened | Supported `Storage.commit` wrapper pauses **after** the real SQLite batch. Close starts, the hook invocation signal is observed aborted, and storage settlement is released and joined before actual close finishes. On reopen there is exact selection/task mapping but no prepared tuple/digest. Recovery denies `Missing first summary association`, dispatching zero summary requests. **Remaining blocker.** |
| Validated association transaction fails after tuple/seal writes, before transaction completion | `preparation-write` fault rolls back tuple/digest/seal SQL, records storage-failure fencing, admits no summary; reopen denies scheduling. |
| Association transaction succeeds but its durability barrier fails before admission | `preparation-flush` fault leaves encrypted provenance visible in SQLite but records storage-failure fencing. No summary effect is admitted; reopen denies scheduling. This is not a claim that an unflushed write survives power loss. |
| Association transaction and barrier complete; first callback waits in `prepareModel` | Actual host yield/close and reopen preserve the original prepared checkpoint. Fresh admission succeeds exactly once for the recovered summary. Changing conversation configuration while waiting does not change that request; later preparation uses current configuration. |
| Epoch/authority/selection changes after recorded preparation | No summary dispatch. New stale-epoch test and inherited authority/mapping/competition/Stop/deadline tests pass. Provenance cannot waive current checks. |

The earliest **successful retained-summary continuation** established here is after the callback has validated and durably flushed its tuple/digest association. Earlier selection replay is safe only when Pi has not committed `summarize`. A successful handoff for the intervening interval is **not implemented or proved**.

### Supported API basis and why the earlier interval remains blocked

Pinned Pi Durable 1.0.1 public interfaces inspected:

- `apps/runtime/node_modules/@earendil-works/pi-durable/dist/harness/types.d.ts:432–433`: supported committed conversation `configure`.
- `:506–513`: HookApi gives asking task identity and committed memos; it is not passed to the provider callback.
- `:517–532`: generation `beforeRequest` repeats on recovery.
- `:544–565`: compaction `beforeCompact` supplies selected source entries/messages/first-kept entry, but not the actual summary-provider transcript or a per-recovered-summary callback binding.
- `dist/harness/compaction.js:57–100`: selection calls the hook then commits prepared `summarize`.
- `:101–127`: summarize privately constructs its provider transcript and options from the retained checkpoint; it does not replay `beforeCompact`.
- `dist/session/session.js:249–289`: Storage batch settles before adoption and publication. Storage settlement explicitly strips caller cancellation (`:269`). Commit listeners run synchronously after the batch (`:291–307`), so a separate listener-side host write is not a pre-storage atomic guarantee.

The existing selection record can prove exact task/range provenance, not the digest of the actual summary transcript. A publication listener could retain checkpoint metadata but cannot invent that missing request association or close the post-storage/pre-publication interval by itself. This correction therefore does **not** authorize a recovered first callback using only selected configuration or a sole producer. No private summary prompts were copied, no transcript reconstruction or private scheduler patch was introduced, and no second scheduler was added. A supported owning interface that supplies exact request/task provenance before or atomically with prepared-summary persistence remains an engineering requirement; this evidence does not claim that every possible upstream solution is impossible.

The two selection-boundary tests are at `apps/runtime/src/pi-durable-effects.test.ts:861–944`. Both use actual close/open and supported hooks/storage, not user Stop or abortTask. The post-storage case intentionally asserts safe denial, not successful recovery; it is not substituted for the original success gate.

## Request/configuration captures

`apps/runtime/src/pi-durable-model-preparation.gate.test.ts:204–374` changes model/thinking after the summary is prepared and durably associated, before close/reopen. It asserts the unchanged checkpoint, exact task/command association and complete prepared tuple, with no summary effect row before interruption. Captures occur inside the guarded provider `start` callback, not from a selected-model variable.

Observed dispatched configurations in order:

```json
[
  {"model":"faux-1"},
  {"model":"faux-1","thinking":"low","maxTokens":51},
  {"model":"faux-2","thinking":"high"}
]
```

The first is initial generation (`off`, no maxTokens override). The recovered original summary retains `faux-1/low`, maxTokens 51, empty stream options, tail 10 and firstKept 10. It completes with the original task 11 and result submission 13. The newly prepared follow-up uses `faux-2/high` without a summary maxTokens override. There is one recovered summary dispatch and one new generation dispatch on the replacement fixture.

The direct-Harness generation test at `:40` remains Pi-only preparation semantics: original `faux-1/low` survives reopen; continuation in the same instruction uses `faux-2/high`. It does not establish product admission, authenticated configuration intents, entitlement or provider transport.

## Safety and encrypted-store coverage

Nearest existing effects seam now has 62 tests (was 53):

- `:796`: exact first association persists before interruption, with only the initial generation effect; successful recovery admits the summary later.
- `:823`: genuinely missing **and** corrupt durable associations deny the sole retained producer after reopen. Original negative intent is preserved rather than removed.
- `:946`: advancing epoch after validated preparation denies dispatch.
- `:995`: mixed actual generation/compaction producers still deny; inherited foreign producers and mapping mutations remain covered.
- `:1526`: post-write rollback and post-transaction flush failure both deny summary dispatch, preserve encrypted ownership rules and retain the safety fence through reopen.
- `:1559`: encrypted prepared provenance opens with the synthetic owned keyring, contains the exact checkpoint model/range, has no plaintext model in SQLite, and successfully resumes after actual close/reopen before first admission.
- `:1600`: host-1 compatibility rejection.

All inherited post-admission unknown-effect/retry, Stop, fixed recovery/operation deadline, result-loss, key/envelope integrity and encryption regressions remain in the full suite. Only the old same-window missing-association test was changed to success **because provenance now exists**; two separate missing/corrupt denials were added.

## Commands and results

All execution/format/typecheck/test commands used:

```sh
cd /tmp/ditto-plan-007-3oi7vl
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true ...
```

No dependency preparation was needed. Commands below were sequential; no zero-test filter is counted as passing. Exact command arguments are recorded in `node_modules/007-correction-logs/commands.txt`.

| Command/run | Result | Log |
|---|---|---|
| Scoped `pnpm exec biome check --write` | passed, formatting only | `format-01.log` through `format-04.log` |
| Runtime typecheck 01 | failed, two test accesses incorrectly used `SettledTask.outcome` instead of `state.outcome`; fixed without changing behavioral predicates | `typecheck-01.log` |
| Focused four suites 01 | failed: 150 passed, 3 failed test-shape assertions; original strengthened compaction gate passed | `focused-01.log` |
| Runtime typechecks 02, 03, 04 | passed, including forbidden-binding typecheck | `typecheck-02.log` through `typecheck-04.log` |
| Focused four suites 02 | failed: 105 passed, 2 failed, 2 unhandled isolated-storage errors, 160 discovered. New selection fixture held uncancellable Storage settlement across awaited close; inherited native alarm test also timed out. Incomplete run is not a suite pass. | `focused-02.log` |
| Selection boundary filter after fixture correction | passed, 2 tests, 60 skipped | `boundary-01.log` |
| Preparation suite 03 and final 04 | passed, 2 tests each | `pi-durable-model-preparation.gate-03.log`, `preparation-04.log` |
| Full effects suite 03 | passed, 62 tests | `pi-durable-effects-03.log` |
| Host suite 03 | failed: native alarm retry timeout, 35 passed, 1 failed, 1 isolated-storage error, 55 discovered; not a full pass | `pi-durable-host-03.log` |
| Native alarm retry filter 04 | passed, 1 test, 54 skipped | `host-alarm-04.log` |
| Full host suite 04 | passed, 55 tests | `pi-durable-host-04.log` |
| Full storage suite 03 | passed, 41 tests | `pi-durable-storage-03.log` |
| `pnpm runtime:verify` 01 | passed: typechecks, 6 Node checks, 219 Worker tests across 10 files | `runtime-verify-01.log` |
| `pnpm runtime:verify` 02 after final stronger tuple assertion | **failed**: 6 Node checks passed; 218 Worker tests passed, 1 native alarm retry test failed with `Invocation authority expired` | `runtime-verify-02.log` |
| Final scoped Biome (no writes), tracked diff whitespace, manifest/lock preservation | passed | `final-biome.log`, `final-diff-check.log`, `manifest-preservation.log` |

The latest aggregate gate is not green. The intermittent inherited native-alarm test uses the older unguarded fixture path (`pi-durable-host.test.ts:140–145`), not the changed correlated model-preparation path. No baseline experiment was made to prove causality, and no timing/safety assertion was weakened or unrelated alarm source edited. Both pass and failure are reported. Independent review must rerun it; this correction cannot claim stable aggregate acceptance.

The selection fixture failure is explained and corrected: Pi removes cancellation from admitted Storage settlement. The corrected post-write fixture starts close, observes the original hook invocation aborted, releases settlement and **joins actual close**. It does not falsely treat an abandoned storage promise as a crash. Original failed logs remain intact.

Installed Node/pnpm/Pi/Workers graph is unchanged from initial execution. Actual local workerd continues warning that requested `2026-09-16` falls back to supported `2026-03-10`; warning suppression/configuration changes were not made. No hosted evidence is claimed.

`pnpm verify`, credentials/web/contracts/brain verification and dependent product adapters were not run: this is a narrow runtime correction with the earlier preparation handoff still blocked. PD38 and live/hosted provider identity, entitlement, networking, eviction, quota and billing remain **not run**, not authorized.

The repository-local Cloudflare, Durable Objects and Workers skills and authoritative spec were read. The globally installed diagnosing/unslop skill paths are outside the authorized worktree; no outside-worktree read was performed. No missing `closing-the-loop.md` contents were invented.

## Exact changed files and handoff

Correction writes:

1. `apps/runtime/src/pi-durable-host.ts`
2. `apps/runtime/src/pi-durable-effects.test.ts`
3. `apps/runtime/src/pi-durable-model-preparation.gate.test.ts` (inherited untracked probe strengthened; compaction-success predicate retained)
4. `plans/evidence/007-preparation-handoff-correction.md` (new evidence)

The two inherited untracked initial evidence files remain present but were not changed. Manifests, lockfile, web/credential/product adapters, shared contracts and verification scripts are unchanged. Full logs stay ignored; no files were staged.

**BLOCKED**: the `prepareModel` suspension correction is reviewable, but the post-Pi-checkpoint/pre-first-provider-callback association gap and latest native-alarm aggregate failure prevent claiming a fully corrected supported gate. The parent should independently validate this narrower candidate and decide the remaining supported owning handoff before dependent 007 implementation. Do not mark 007 DONE or enable retained mutation.
