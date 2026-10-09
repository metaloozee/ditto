# 007 local host claim correction

Verdict: correction READY FOR REVIEW. This is an executor result, not advisor acceptance. Full 007 remains incomplete. Product transport/account/configuration work was deliberately left for the next reviewed handoff.

## Scope and preservation

Used the same detached `/home/ayan/ditto-execution/plan-007-recovery`, HEAD `0ccc5b20c25a4e63017b3eebf6608dba62253479`. Actual settings remain `openai-codex/gpt-6.1-sol`, medium reasoning. No delegation or fallback occurred.

Read the advisor review, complete unchanged advisor probe/configuration, existing private-field/seal mechanisms and actual host/model test source. Before editing, all seven partial-candidate hashes matched. The previous partial evidence and archives were preserved. Advisor probe source, config and original red log remain byte-identical, verified against `artifacts/007/model-claim-correction/preserved.sha256`.

Only these source files changed in this correction:

| File | SHA-256 |
| --- | --- |
| `apps/runtime/src/pi-durable-host.ts` | `9ced957eebd4950c663ee96fd50740a8fe9b25efa36cc49dc2b0ba654d612eac` |
| `apps/runtime/src/pi-durable-models.test.ts` | `ccf62d913b2e7b33f336d6a85a4714a41a17c549ae1226d0160898d479398372` |

The correction-only patch and before-source snapshots are in `artifacts/007/model-claim-correction/`. The original ten model test bodies are byte-identical; shared fixture scaffolding was extended for held real storage/task reads, reopen, fault injection and bounded diagnostic snapshots. Accepted summary tests, preparation gate, effects tests, summary policy, cooperative fixture and authoritative spec were not edited in this correction. No assertion, deadline or fault was relaxed.

Root and brain manifest/lock hashes are unchanged. No dependency installation or cache operation was needed this turn. Whitespace checks pass; staging remains empty. Main remained read-only.

## Reproduction

Both executable loops reproduced the advisor's exact symptom before the fix:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true \
  pnpm --filter @ditto/runtime exec vitest run \
  --config ../../plans/evidence/artifacts/007/advisor-model-claim.config.ts
```

Result: four failures, in plaintext and encrypted fixtures. The duplicate claim and the claim whose authority was revoked during flush resolved instead of rejecting. New log: `advisor-red.log`; original advisor red log was not overwritten.

Permanent nearest-suite reproduction:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true \
  pnpm --filter @ditto/runtime exec vitest run src/pi-durable-models.test.ts \
  -t 'rewound live|claim denies authority during held flush'
```

Result: four matching failures, 22 intentionally filtered skips in the initial 26-case candidate. Log: `permanent-red.log`. Both loops pass after the correction. No zero-test invocation is counted.

## Corrected safety ownership

### Live one-shot consumption

A valid exact claim consumes its host-created capability synchronously before the first asynchronous authority/task/crypto step. The lexical consumption latch is never reset on failure, cancellation, concurrent calls or SQLite flag rewinding. Invalid association payloads do not consume the legitimate capability. Repeated/concurrent valid calls receive the existing reservation denial.

The live latch is not a new persistent effect ledger. The original `host_effects` admission remains the nonrefundable attempt and uncertainty authority. Restarts do not reconstruct or redispatch an old local capability.

### Retained receipt integrity

The exact versioned attempt and its `reserved`/`consumed` receipt now reside in the existing effect row's `model_dispatch` private field. An additive local host schema initialization adds that column. Minting and consumption update the protected field, the existing `host_seal` digest and the preexisting dispatch index in one synchronous storage transaction.

The field uses the existing `sealHostField`, `rememberSeal`, `rememberPlain`, encrypted reopening and cached-envelope checks. Associated data binds owner, workspace session and `effect:<exact-id>:model_dispatch`. The plaintext-retention prohibition, reopening scan and stored-envelope lookup include the new field. No new encryption system, key, provider dependency or separate outcome/accounting ledger was introduced.

`host_model_dispatch` is no longer sufficient to authorize a claim. Its flag and request digest must agree with the exact protected receipt and expected live state. Final acknowledgment checks them again. Tampering before consumption, wrong-record ciphertext substitution and changed dispatch digests reject without provider start. A live flag reset cannot recreate consumption.

A coherent rollback of an older valid receipt and its matching seal is not claimed to be cryptographically distinguishable after process loss. The tests explicitly restore those bytes and demonstrate that the original admitted effect remains unresolved and prevents scheduling across two reopens. No claim is reconstructed, no attempt is refunded and no provider starts. This relies on the existing effect/uncertainty owner, not on treating a rolled-back receipt as new authority.

### Fresh final authority and linearization

The initial authority/task checks remain preparation checks. After atomically storing the consumed receipt and completing the actual durability barrier, claim obtains another authority result under the original cancellation context. It then synchronously checks cancellation, exact protected receipt, current epoch/Stop/fence, effect identity, uncertainty, invocation and operation deadlines using that fresh result. There is no awaited operation after the final check.

The irreversible live claim linearizes when the capability latch is consumed. Durable dispatch reservation linearizes at the existing synchronous admission transaction that stores `consumed`. Successful acknowledgment requires the later durability barrier, fresh authority and final synchronous checks. Stop/revocation winning before those final checks denies acknowledgment. Consumption and the already-admitted effect remain accounted for even when acknowledgment fails. If successful acknowledgment wins, later Stop does not erase admitted work.

Claim still does not acquire `providerQueue` or `ownerQueue` and does not call a public runtime command. Actual held task and flush races exercise authority changes and epoch-first Stop. The new held-flush close test proves actual joined Harness close before releasing the hold, retains consumed receipt/admitted effect and denies reopened scheduling. Final aggregate observations are 22 ms plaintext and 16 ms encrypted against the unchanged 1000 ms drain allowance.

These are local host guarantees only. They do not prove product ownership, account entitlement, credential attachment, service-binding capability transport or end-to-end model authorization.

## Permanent tests and actual snapshots

The existing model suite now has 34 Worker/SQLite cases: the original ten plus 24 correction cases across plaintext/encrypted fixtures. Added coverage includes:

- Live flag rewind, repeated and concurrent claims.
- Held actual Pi task lookup and storage flush with current-authority and Stop changes.
- Lost acknowledgment after real claim persistence, followed by two reopens and rejected original/replacement scheduling.
- Corrupted or authentic foreign-record receipt substitution, live denial and reopened denial.
- Older valid reserved receipt/seal restoration without refund or redispatch.
- Dispatch-digest substitution.
- Actual joined close while the claim flush remains held.

Snapshots capture actual receipt state, dispatch index, original effect state, run epoch, encrypted-receipt classification and provider call count. They contain only synthetic routing/status metadata. `snapshots.json` extracts 38 state snapshots and two close observations from the final runtime aggregate log. The held-flush revocation/Stop cases show consumed receipt and admitted effect retained with zero provider calls. Lost-ack snapshots preserve the same consumption through both reopens. Coherent receipt rollback snapshots show the old reserved projection but still-admitted blocking effect and zero provider calls.

The suite remains automatically registered by the existing runtime Vitest include and `runtime:verify`; no scripts, existing suites or crash/RPC checks were removed. Original 192 nearest behaviors still pass within the expanded 216 nearest cases, including all 118 summary tests and the four original close-deadline regressions.

## Commands and results

All verification ran sequentially in the execution worktree with:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true
```

| Command | Runs this correction | Actual result |
| --- | ---: | --- |
| Unchanged advisor config probe | 3 | red: 4 failed; both green runs: 4 passed |
| Permanent regression filter above | 2 | red: 4 failed; green: 4 passed |
| Whole models suite | 2 | intermediate 26 and 32 tests passed; current final 34 cases pass in nearest/aggregate runs |
| Four nearest suites | 2 | intermediate 214 passed; final 216 passed across 4 files: models 34, effects 62, summary 118, preparation 2 |
| New actual joined-close filter | 1 | 2 passed, 32 intentionally filtered skips |
| Direct runtime `tsc --noEmit` | 1 | passed |
| Scoped Biome check/format | 3 | passed, only the two correction source files targeted |
| `pnpm runtime:verify` | 2 | intermediate 369 Worker tests; final 371 Worker tests across 12 files plus 6 Node checks; runtime and forbidden-binding typechecks passed |
| `pnpm verify` | 2 | both passed |

There were ten direct Vitest invocations, one direct typecheck, three scoped Biome invocations and four aggregate invocations, eighteen verification commands total. The two expected red commands are retained as failure evidence, not described as passing. Counts are per run, not unique totals summed across repetitions.

Final repository verification passes Biome, web/credential typechecks, 22 credential Worker tests plus 3 standalone Node crash/RPC checks, 815 web tests across 73 files, web build, runner typecheck, 79 runner tests across 11 files and runner build. Shared contracts were not changed; separate contracts/brain gates were not repeated for this narrow correction. The existing offline fixture and warmed public cache remain untouched.

Final gate logs are `advisor-green-final.log`, `nearest-final.log`, `runtime-final.log` and `repository-final.log`. Original advisor probe/config/red-log and graph preservation checks all pass. No unhandled rejection is reported in the probe loops. The known installed-workerd compatibility fallback remains `2026-09-16` to `2026-03-10`; this is not hosted validation.

## Review boundary and remaining 007

Advisor must inspect every correction hunk and independently rerun the unchanged probes, permanent tests and nearest safety suites before acceptance. This executor does not declare the correction independently accepted or full 007 DONE.

Still missing from full 007: fresh product exact ownership/identity/lifecycle/model authorization, reviewed private service-binding capability transport, complete bounded synthetic request/account contracts, credential-DO reconstruction/streaming, trusted-runtime operation-window/denial/halt policy, mandatory generation/retry/custom-summary/Git adapter composition, authenticated configuration intents/snapshots/default validation and remaining web/credential suite registration. Existing fixture starts may still ignore `ModelDispatch`; this correction does not enable a production request path.

PD38 is not run. Live discovery and transport remain unavailable. No credential inspection, live request, authentication repair, model/billing fallback, new dependency, deployment, shared database mutation, legacy bypass, retained workspace activation, UI work, main source change, stage, commit, push, integration, new worktree or deletion occurred.
