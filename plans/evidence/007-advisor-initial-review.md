# 007 initial advisor review

Verdict: **BLOCKED at the initial prepared-compaction recovery gate**. The stop is justified and independently reproduced. This is not acceptance of plan 007, an upstream-library failure verdict, or authorization to integrate the failing probe. No dependent adapters were implemented.

Reviewed base: `0ccc5b20c25a4e63017b3eebf6608dba62253479`. Execution worktree: `/tmp/ditto-plan-007-3oi7vl`, detached and uncommitted. The separate executor used `openai/gpt-6.1-sol` with medium reasoning, as requested. See [executor evidence](007-codex-model-policy.md), [independent logs](artifacts/007/initial-gate/) and [archived candidate and complete logs](artifacts/007/initial-gate-candidate.tar.gz).

## Independent reproduction

The advisor read the entire new 304-line test and executor evidence, inspected the unchanged host association/admission code and inherited summary recovery tests, and checked the pinned Pi generation, compaction and public configuration/hook interfaces. The sole candidate source file is new and untracked. All existing tracked source, manifests and lockfile remain byte-identical to the execution base; the staged diff is empty.

The independent preparation command exits 1 with one passing generation test and one failing compaction test. The failure occurs at the success predicate, not fixture setup:

```text
Summarization failed: Missing first summary association
attempts: 1
provider dispatches: 0
```

The test completes a synthetic generation, starts compaction, and suspends the existing asynchronous preparation seam after Pi has committed its summarize checkpoint but before host admission. It asserts that the host's durable `prepared` and `digest` association is still absent. Actual host yield/close completes, a replacement opens, and the checkpoint remains equal. Resuming the retained command then fails compaction through the mandatory guard.

This establishes a recoverable-preparation integration gap. It does not establish loss of Pi configuration. It also does not demonstrate compaction retention under a changed selection, which remains unproved because successful guarded recovery already fails without that change.

## Cause and safety disposition

- `apps/runtime/src/pi-durable-host.ts:1242` stores the first hook association in a WeakMap keyed by the invocation's AbortSignal.
- `apps/runtime/src/pi-durable-host.ts:1533–1540` requires the durable prepared tuple and transcript digest when a recovered summary has no invocation binding.
- `apps/runtime/src/pi-durable-host.ts:1619–1623` can suspend in asynchronous preparation before admission.
- `apps/runtime/src/pi-durable-host.ts:1625–1655` persists the prepared tuple and digest only after admission. The interrupted first request therefore lacks the association required by the replacement host.
- `apps/runtime/src/pi-durable-effects.test.ts:793–811` deliberately verifies safe denial in this window. The advisor independently reran that test and it passes.

The rejection is intentional fail-closed behavior in the current safety implementation, not a new admission bypass introduced by 007. The missing successful handoff prevents the stronger 007 continuation requirement. Do not remove the safety assertion merely to make the new acceptance predicate pass.

Pinned Pi 1.0.1 source commits compaction configuration in the summarize checkpoint and reconstructs that request after reopen without replaying the selection hook. The public `beforeCompact` hook belongs to selection; generation separately has `beforeRequest` on each attempt. This explains why the current invocation-local summary association is insufficient. It does not prove that supported interfaces cannot support a corrected durable handoff. No private scheduler patch, fork or second continuation engine is justified by this result.

## What passes and what remains unproved

The generation probe uses public Harness/conversation APIs, actual local SQLite and a deterministic registered provider. It changes model and thinking while the first prepared request is suspended, closes and reopens, then checks captured payloads. The original request retains `faux-1`/`low`; the continuation inside the same instruction uses `faux-2`/`high` with the expected message sequence.

That passing probe bypasses the product/runtime admission integration intentionally to establish Pi preparation semantics. It is not evidence for authenticated configuration intents, mandatory privileged product requests, account entitlement, model-policy retries, independent workspace selections or live Codex transport. The executor states these limits correctly.

The failed compaction probe uses the integrated mandatory guard and existing synthetic host. Its test-only access to the public Harness handle matches the inherited effects-suite seam; it does not patch Pi internals. The suspended fixture promise is wrapped by the host's cancellable preparation wait. No credential-bearing request occurs, and no credential fixture is installed.

## Independently executed checks

All commands ran sequentially in the disposable execution worktree with this prefix:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true
```

| Command/check | Result |
|---|---|
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-model-preparation.gate.test.ts` | failed, exit 1; generation passed, guarded compaction recovery failed |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-effects.test.ts -t 'first summary association missing after close'` | passed, exit 0; 1 test, 52 skipped; not a full effects-suite pass |
| `pnpm --filter @ditto/runtime typecheck` | passed, exit 0, including forbidden-binding typecheck |
| `pnpm exec biome check apps/runtime/src/pi-durable-model-preparation.gate.test.ts` | passed, exit 0, no writes |
| Execution-worktree tracked and staged diff preservation | passed, both empty, unchanged base HEAD |
| Initial main-checkout preservation | passed, clean before advisor evidence writes; no main source or dependency changes |
| Archive integrity | passed, `gzip -t` |
| `credentials:verify`, `runtime:verify`, `verify` | not run, dependent implementation stopped; automatic runtime discovery would include the deliberately failing gate |
| `contracts:verify`, `brain:verify` | not run, shared contracts unchanged and initial gate blocked |
| Exact fixture HTTP/stream contract, credential-bearing reconstruction, operation windows and configuration intents | not run, not implemented |
| PD38, live provider, hosted platform and deployment checks | not run, not authorized |

The installed workerd warns that requested compatibility date `2026-09-16` falls back to `2026-03-10`. The inherited warning remains visible in independent logs. This review claims local fixture behavior only.

Earlier executor setup/typecheck failures remain preserved and are not counted as passing gates. The improve skill's referenced `closing-the-loop.md` is absent from the installation; review followed the supplied execution contract without inventing that document's contents.

## Preserved artifacts and disposition

Archive SHA-256:

```text
813baa9b596aa0d36eadca3e30a7b1f63bfa61cd61575cb403e717de86cb0e95
```

Reviewed probe SHA-256:

```text
24c0a801e6570997bf336b70da0c6868a808f1b6b9d49df83bca79155b4cc3ea
```

The archive contains the probe, executor evidence, complete executor logs and independent review logs. It excludes installed dependencies, CLI HOME and environment/credential files. The original worktree and logs remain available. The probe is not copied into main-checkout source and must not be integrated as a passing implementation.

Only `plans/` evidence and status documentation changed in the main checkout. No source edit, staging, commit, merge, push, reset, worktree deletion, deployment or live provider request occurred.

007 remains BLOCKED, and 008 remains blocked behind it. A separately requested correction should first establish a supported durable pre-admission compaction association, retaining exact task/request identity and fresh admission checks, and prove interruption on both sides of that handoff. Then rerun successful compaction recovery with configuration changes before continuing the rest of 007. Do not substitute a sole-producer guess, copied private summary construction, optional guard, command-wide model pin or weakened requirement. An upstream change is not yet shown to be necessary.
