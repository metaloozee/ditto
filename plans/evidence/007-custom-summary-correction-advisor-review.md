# 007 custom-summary correction advisor review

Historical verdict: **REJECTED FOR ACCEPTANCE pending the configuration-close repair**. The later repair is [independently accepted for the scoped prerequisite](007-custom-summary-advisor-final-review.md); the rejection and red evidence below remain valid for their archived candidate. The advisor independently confirms the runtime test counts and exact approved spec edits, but an additional actual Worker regression reproduces a close-deadline breach in the new owner lane. The targeted probe and independent rerun both fail the two default-context cases while passing the two caller-canceled controls. See the [narrow repair handoff](../decisions/007-configuration-close-repair-handoff.md). Remaining 007 adapters stay blocked.

## Reviewed candidate

Detached execution worktree: `/home/ayan/ditto-execution/plan-007-recovery`, base `0ccc5b20c25a4e63017b3eebf6608dba62253479`.

The advisor preserved the [final executor archive](artifacts/007/custom-summary-correction/custom-summary-correction-final.tar.gz) in the main planning artifacts before further review. SHA-256:

```text
66e023fc61f44e305e0a331a76dc5898de6921866f61e7f69ba944a4c2d2407a
```

All seven archived source bytes independently match [the source identities](artifacts/007/custom-summary-correction-review/source.sha256) captured before any additional probe tests. The complete approved spec equals the base plus exactly the accepted three replacements. Evidence is in [spec and archive check output](artifacts/007/custom-summary-correction-review/spec-and-archive.log). The executor's [continuation evidence](007-custom-summary-correction-continuation-gate.md) is preserved separately from advisor acceptance.

## Actual diff review

The advisor read the complete correction-only patch, including all new ordering, owner-fault and automatic waiting-parent assertions. New code is limited to the host, summary test and owner routing in the existing preparation gate. Restored fixture/effects/summary-policy/spec identities remain unchanged by this correction.

The short host lane now shares model/thinking configuration and new custom preparation through configuration resolution, hashing, sealing, prepared-request commit and flush. It releases before provider preparation, effect admission and model completion. Existing prepared requests retain their exact payload. Deterministic plaintext digest and encrypted AES-GCM holds force both configuration-winning and preparation-winning orders. The old conditional model-lookup race assertion was replaced.

Automatic tests now inspect the actual compaction's generation owner and waiting dependency at each of six boundaries. Placement probes read real persisted public Storage tasks rather than deadlocking on the Session line held by the intercepted commit. Success asserts one summary attempt, unchanged result/usage on reuse, one placement receipt, the original parent's completion, and two legitimate generation calls separately. Unknown outcomes block later model/tool effects across two reopens. Failure/Stop/authority/persistence controls retain settled-assistant checks. The persistence-failure terminalization change includes correlated result-recorded effects, addressing pending projections after a failed result flush without refunding or replaying the attempt.

## Independent checks completed

Execution was sanitized in the isolated worktree:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true \
  pnpm --filter @ditto/runtime exec vitest run src/pi-durable-summary.test.ts

env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true \
  pnpm runtime:verify
```

[Independent command statuses](artifacts/007/custom-summary-correction-review/results.txt): both exited 0. [Summary output](artifacts/007/custom-summary-correction-review/summary.log) records **108 passing tests**. [Runtime output](artifacts/007/custom-summary-correction-review/runtime.log) records runtime typechecks, **327 Worker tests across 11 files plus 6 Node tests**. All seven source hashes still matched after these checks. Empty staging and unchanged manifests/lock graph were also verified.

Independent repository `pnpm verify` and final scoped Biome remain not run at this review stage. The executor reports they pass; that report is not substituted for an independent command. Installed workerd's compatibility-date fallback remains unchanged. Live authentication, entitlement, actual provider transport, PD38, hosted eviction/deployment and remaining product adapters are not run or authorized.

## Outstanding lifecycle probe

`ownerTransition()` joins its pending operation into `ownerQueue`. `configure()` defaults to `BACKGROUND_CONTEXT` and awaits the authority lookup using only that caller context. `closeAndAccount()` now joins `ownerQueue` after Harness close; `yield()` seals the host but does not visibly cancel a host-owned owner-operation signal. The existing tests cancel a queued configuration caller explicitly, not a configuration operation already waiting for authority when the host closes.

The probe now [reproduces this defect](007-custom-summary-configuration-close-probe.md), keeping host code unchanged and releasing held synthetic lookup work only after measuring the full recorded deadline. The advisor read its complete test insertion and independently ran the exact four-case filter. [Independent red output](artifacts/007/configuration-close-advisor-review/independent-red.log) and [exit status](artifacts/007/configuration-close-advisor-review/result.txt) record exit 1, two failures and two controls passing. Both default-context cases remained pending at 1051 ms against the actual 1000 ms drain allowance; only cleanup release settled close, with `Actual close exceeded end deadline`. Both caller-canceled controls actually closed in 10 ms while remote work was still unresolved. The probe archive, original test delta and evidence are preserved in main planning artifacts.

This is a host integration regression, not an upstream incompatibility verdict. The [repair handoff](../decisions/007-configuration-close-repair-handoff.md) requires host-owned cancellation propagated into the retained operation, combined with the caller/task signal, while retaining actual queue joining and admitted Session settlement. It prohibits a close timeout race, longer budgets, abandonment of owned work or weakening the unchanged regression predicates. Passing earlier counts do not supersede this independent failure.

No main source changes, integration, staging, commits, deployment, live provider/account call, credential access, shared-data mutation, worktree deletion or billing fallback occurred. Full 007 is not DONE.
