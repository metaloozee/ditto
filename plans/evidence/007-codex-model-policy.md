# 007 fixture-only execution: initial gate blocked

Disposition: **BLOCKED**, pending independent advisor review of the initial-gate evidence. Plan 007 is not DONE. No dependent request adapter, product request contract, account discovery, configuration intent, or privileged-operation window was implemented.

Execution worktree: `/tmp/ditto-plan-007-3oi7vl`, detached, exact base `0ccc5b20c25a4e63017b3eebf6608dba62253479` (short `0ccc5b2`). The worktree initially had no dirty files. All repository reads, installations, commands and writes used this worktree; no main-checkout dependencies or source were modified. No staging, commit, merge, push, worktree removal, hook/configuration mutation, deployment, live provider operation or remote/shared database operation occurred. No existing environment or credential file was read or copied.

## Stop reason

The integrated mandatory guard cannot successfully resume a compaction interrupted **after Pi prepares its summarize checkpoint but before first host admission**. Pi retains the checkpoint, but the host has not durably associated that prepared request with its summary transcript. After reopen, the provider callback reaches the guard and is rejected with:

```text
Summarization failed: Missing first summary association
```

The final reproduction observes one attempted callback and **zero dispatched provider calls** after reopen. This is a safe denial, not a credential leak or bypass. It nevertheless fails the initial retained-preparation/resumption gate required before dependent 007 implementation.

This is a demonstrated limitation of the **integrated host handoff**, not proof that Pi loses prepared configuration, and not proof that an upstream change is necessarily required. Pi's prepared compaction checkpoint is unchanged across close/reopen. A reviewed supported-API handoff might repair the host; this execution did not invent one, remove the mandatory guard, infer authority from a sole producer, copy private summarizer code, or patch the scheduler to proceed.

### Reproduction and source evidence

The new `apps/runtime/src/pi-durable-model-preparation.gate.test.ts:203` uses actual local Worker/DO SQLite and the existing `PiDurableHost`, `cooperativeFixture`, `HostGuard.model()` and `prepareModel` seams:

1. Complete an initial synthetic generation, retaining a running host run using the same test-only public Harness seam as the existing effects suite.
2. Start manual compaction. Hold `prepareModel` while Pi's task already has `phase: summarize`.
3. Assert the public checkpoint contains the original model. Assert `host_tasks.prepared` and `digest` are both null (`:263–274`). No compaction effect has dispatched.
4. Perform actual host yield/close, open a replacement, and assert checkpoint equality (`:279–281`). No user Stop or abortTask is substituted for host close.
5. Schedule the retained command. Inspect the settled compaction task and attempted/dispatched callback counts (`:286–295`). Expect successful completion (`:298–302`); the assertion remains failing rather than weakened to accept denial.

Observed final synthetic checkpoint:

```json
{"phase":"summarize","attempt":1,"model":{"provider":"faux","modelId":"faux-1"},"thinkingLevel":"off","streamOptions":{},"maxTokens":51,"tail":10,"firstKept":10}
```

Observed final outcome:

```json
{"status":"terminal","outcome":{"status":"failed","error":{"message":"Summarization failed: Missing first summary association","detail":{"reason":"model_error"}}}}
```

Relevant unchanged owning code:

- `apps/runtime/src/pi-durable-host.ts:1242`: the first hook association is held in a WeakMap keyed by the invocation AbortSignal.
- `apps/runtime/src/pi-durable-host.ts:1533–1540`: a reopened summary without that binding requires both the durable prepared tuple and transcript digest; missing association denies.
- `apps/runtime/src/pi-durable-host.ts:1619–1623`: asynchronous preparation may suspend before admission and before prepared/digest persistence.
- `apps/runtime/src/pi-durable-host.ts:1625–1655`: the prepared tuple/digest is saved only after exact admission. In the tested interruption window it is not saved.
- `apps/runtime/src/pi-durable-effects.test.ts:793–811`: inherited regression deliberately expects denial for this same first-summary-association interruption. Its separately rerun test passes. Historical retry-after-admission coverage is not evidence for this earlier window.
- `apps/runtime/src/pi-durable-cooperative-fixture.ts:174–186`: provider start remains inside mandatory `guard.model()` in the guarded fixture composition. The new compaction gate passes the guard; no optional unguarded fallback is used.

Pinned supported/public API inspection (paths are relative to this execution worktree):

- `apps/runtime/node_modules/@earendil-works/pi-durable/dist/harness/types.d.ts:432–433`: conversation `configure()` is a supported committed operation.
- `.../types.d.ts:517–532`: generation has a `beforeRequest` hook on every attempt, including recovery.
- `.../types.d.ts:544–565`: compaction exposes `beforeCompact` during selection, not a corresponding per-summary-request/recovery hook.
- `.../generation.js:32–89`: model, thinking and stream settings are fixed in the request checkpoint. `:94–118` uses that checkpoint. The retry phase `:122–135` prepares again; do not impose command-wide model pinning.
- `.../compaction.js:57–100`: selection resolves configuration, calls `beforeCompact`, then commits `summarize`. `:101–127` reconstructs the summary request from the retained checkpoint without replaying selection or its hook. `:157–170` retains request configuration for compaction retry.

Inspecting installed source explains the result; no private Pi module was imported by the new test, and no installed source was modified. The test-only reflection only reacquires the existing public Harness handle to use `waitForIdle`, as the inherited suite already does. It does not access a private Pi scheduler.

## Generation portion that passed

`apps/runtime/src/pi-durable-model-preparation.gate.test.ts:39` proves, through supported Pi APIs and actual local SQLite:

- Generation preparation with synthetic `faux-1` / `low`.
- A committed configuration change to explicitly registered synthetic `faux-2` / `high` while the original request is waiting before synthetic dispatch.
- Actual Harness close/open with unchanged prepared checkpoint and no first-host dispatch.
- The reopened original request uses `faux-1` / `low`.
- The `onYield` continuation within the same instruction prepares a new request using `faux-2` / `high`.
- Constructed deterministic provider payloads include the original instruction, assistant response and continuation in order (`:180–199`), rather than only asserting a selected-model variable.

This direct-Harness generation probe establishes preparation semantics, **not** Ditto authenticated configuration-intent behavior, mandatory product admission, HTTP Codex request construction, subscription access, entitlement, retry policy, or independent workspace selection. It is deliberately not a replacement for those later suites.

## Integrated product boundary recheck

The authoritative runtime specification and predecessor `006-advisor-final-review.md`, `006-integration.md`, and `006-codex-contract.md` were read completely. The following integrated interfaces were inspected without changing them:

- `apps/web/src/lib/codex-credential-do.ts:31–111`: product credential DO, encrypted credential row, expected persisted revision, fresh D1 authority, private keyring helpers and production fixture denial. `:192–200` keeps production renewal unavailable. `ensureFresh` returns safe status, not credentials or inference access.
- `apps/credential-tests/src/entry.ts:5–70`: isolated synthetic credential subclass; fixed `.invalid` renewal destination. `apps/credential-tests/vitest.config.ts:8–25` configures actual SQLite and synthetic keys. No fixture credential was needed or installed in the new preparation probes.
- `apps/runtime/src/pi-durable-cooperative-fixture.ts:205–224`: closed environmental/file authentication discovery and provider registration with stream and streamSimple. Its unguarded path remains prior art, not production admission.
- `apps/web/src/lib/agent-models.ts:1–2`: legacy fixed project model remains unchanged; no legacy assertion was deleted.
- `packages/runtime-contracts/src/command.ts:14`: V1 thinking meanings remain unchanged. No contract change or payload-idempotency weakening occurred.
- `apps/web/src/lib/session-runtime-client.ts:35,57–61,220`: modelConfiguration remains readiness-only.

Supported LIVE Ditto hosted client/transport/discovery remains unavailable per 006. That is **not** the stop reason. No bundled catalogue was claimed as entitlement, no guessed model URL was probed, no token was exported, and no billed API fallback was added. Exact fixture HTTP/stream schema definition and bounded product reconstruction are **not run** because the initial guarded preparation gate stopped dependent work. Existing runtime per-conversation configuration and payload-conflict requirements remain requirements, not completed implementation claims.

## Toolchain and installation

| Component | Observed version |
|---|---|
| Node | `v24.21.0` |
| pnpm | `11.8.0` |
| npm | `12.0.2` |
| pi-durable / pi-ai / chord | `1.0.1` each |
| Runtime Vitest | `3.2.7` |
| TypeScript | `5.9.3` |
| Workers Vitest pool | `0.12.21` |
| Miniflare | `4.20260310.0` |
| workerd | `1.20260310.1` |

Runtime test configuration requests `2026-09-16`; the installed workerd warns and falls back to supported `2026-03-10`. This inherited warning was preserved, not suppressed. The new probes use the existing actual Worker test configuration, not Node doubles. No container image or deployment was built.

Dependencies were prepared only here with frozen `pnpm install --frozen-lockfile --ignore-scripts`. No lifecycle scripts or Git hooks ran. No runner/session-brain install was needed. Existing manifests and lockfile are unchanged.

## Commands and outcomes

All install/format/typecheck/test commands ran from the execution worktree with this exact sanitized prefix:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true
```

Logs remain complete under `/tmp/ditto-plan-007-3oi7vl/node_modules/007-logs/`, ignored and retained. `commands.txt` preserves the exact command strings, including both inline version-inventory scripts. No secrets are present. Commands below follow that prefix unless explicitly marked as read-only Git inspection.

| Command | Exit/result | Log |
|---|---|---|
| `sh -c 'node --version; pnpm --version; npm --version; pnpm install --frozen-lockfile --ignore-scripts'` | 0, passed | `install.log` |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-model-preparation.gate.test.ts` (experiment 01) | 1, failed fixture setup: second model not registered; 1 failed test | `preparation-01.log` |
| Same command (02), after explicit synthetic second-model registration | 0, passed generation-only probe, 1 test | `preparation-02.log` |
| Same command (03), first compaction probe | 1, fixture setup error: host.waitIdle had settled run, `Compaction requires live run`; generation passed | `preparation-03.log` |
| Same command (04), using inherited public-Harness idle seam | 1, actual guarded-compaction gate failed; generation passed | `preparation-04.log` |
| `pnpm exec biome check --write apps/runtime/src/pi-durable-model-preparation.gate.test.ts` | 0, passed | `format.log` |
| `pnpm --filter @ditto/runtime typecheck` | 2, two new probe typing errors: union option reasoning access and unsupported faux helper model option | `typecheck.log` |
| Scoped biome command again after type-safe probe fixes | 0, passed | `format-02.log` |
| Runtime typecheck again | 0, passed, includes forbidden-binding typecheck | `typecheck-02.log` |
| Preparation command (05), final payload assertions added | 1, failed initial compaction gate; 1 passed generation test, 1 failed compaction test | `preparation-05.log` |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-effects.test.ts -t 'first summary association missing after close'` | 0, passed inherited safe-denial regression; 1 passed, 52 skipped, not a full effects-suite pass | `inherited-denial.log` |
| Inline installed-package inventory, Node/fs/createRequire | 1, direct Miniflare resolution assumption failed; preceding six package versions printed | `versions.log` |
| Corrected inventory using Workers pool's createRequire, then Miniflare's for workerd | 0, passed | `versions-02.log` |
| `git diff --check` (read-only, no sanitized env needed) | 0, passed for tracked diff; probe is untracked and was separately checked by Biome | terminal |
| `git diff --exit-code -- pnpm-lock.yaml package.json apps/runtime/package.json` (read-only) | 0, unchanged | terminal |
| `pnpm exec biome check apps/runtime/src/pi-durable-model-preparation.gate.test.ts` (final, no writes) | 0, passed; final Git diff/manifest checks also 0 | `final-biome.log` |

The earlier setup/type errors are not the final blocker and are not counted as successful runs. They remain in the complete logs. The final failing assertion is intentionally retained as the acceptance predicate for the requested gate, not marked skipped, expected-failure or passing.

### Remaining specified verification

| Gate | Status/reason |
|---|---|
| Initial prepared generation retention and next preparation inside one instruction | passed, bounded synthetic supported-API probe only |
| Initial prepared compaction successful guarded resume before first admission | **failed**, exact result above |
| Exact fixture request/stream reconstruction and product-side credential admission | not run, dependent implementation stopped |
| New per-conversation config intent, idempotency conflict and account capability contract | not run, dependent implementation stopped |
| `pnpm --filter @ditto/web exec vitest run src/lib/agent-models.test.ts` | not run, no contract/legacy model changes |
| New web request/connection suite command | not run, no new request contract implemented |
| New credential Worker request/denial/race suites | not run |
| New runtime models/effects suite command | not run; only the focused inherited denial regression ran |
| `pnpm credentials:verify` | not run, initial-gate stop |
| `pnpm runtime:verify` | not run, initial-gate stop; the new reproduction would fail its automatic test discovery |
| `pnpm verify` | not run, initial-gate stop |
| `pnpm contracts:verify` / `pnpm brain:verify` | not run; shared contracts unchanged and initial-gate stop |
| PD38 / actual auth, discovery, renewal or inference | **not run**, not authorized |
| Hosted identity, eviction, networking, quota and billing | not run |

## Dirty scope and review handoff

Only two new untracked files are part of the candidate diff:

- `apps/runtime/src/pi-durable-model-preparation.gate.test.ts` — executable initial-gate probes; one deliberately red acceptance assertion remains.
- `plans/evidence/007-codex-model-policy.md` — this evidence and stop record.

Installed dependencies, isolated CLI HOME and full logs stay ignored under this worktree's `node_modules`. No application implementation, shared contract, dependency graph, verification script, production fixture gate or plan status was changed. This is a blocked feasibility candidate, not source ready for integration.

An independent advisor can rerun the exact final preparation and inherited-denial commands. Review should distinguish retained Pi checkpoint semantics (observed) from successful safe host continuation (failed). Any next implementation must establish a durable pre-admission summary association and prove both crash orderings through supported interfaces before adding the product transport or changing configuration semantics. Do not cure this result by bypassing `HostGuard.model()` or pinning requests to a command.
