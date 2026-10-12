# Final-hold correction and bounded substage trace

Executor environment verified without secrets: `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-6.1-sol`, `PI_REASONING_LEVEL=medium`. No fallback. Writable EXECUTION remained detached at `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`; MAIN was read-only. Read the complete bounded-diagnosis report and MAIN continuation decision. No policy, deadline, dependency, cache, deployment, commit or retained/shared database change.

## Permanent patch

Exactly two candidate source files changed, relative to the independently preserved 37-file baseline:

- `apps/credential-tests/src/entry.ts`: final preparation resolves Boolean true only at the fourth real positive permit, false when its request settles earlier. Both request settlement and per-request policy capture their own wait. Promise settlement is idempotent; finally-false cannot replace true. The held positive response and real descriptor remain intact.
- `apps/credential-tests/src/product-commands.worker.test.ts`: all four existing final-wait call sites explicitly assert true inside cleanup scopes. New actual product-admission/leased-delivery/private-adapter regression holds the existing preclaim phase for 1100 ms across unchanged HOST WORK_MS=1000. It asserts false preparation, denied credential outcome, zero fetches, failed run/member/projection, closed invocation, still-admitted effect and claimed=0. This tests denial/cleanup, not successful progress or refunded occupancy.

`permanent.patch` is the exact incremental diff. Final SHA-256:

- entry: `be5cf472de1b9cc3989a46167f9cd093cd204fe4b02fba0b2655e32bdeb3cfa0`
- test: `e92e332a6eeefe577d00640a1ee9172a3898eba7ec292f797a4ec8fa04c35b10`

`entry-source.tar` archived intended source only before editing; `entry-hashes.json` matched all 37 source-base hashes. `restoration.json` verifies the other 35 files unchanged. Temporary runtime instrumentation was removed by exact inverse edits. Restored `pi-durable-host.ts` SHA-256 is `0e32d9fba479a77249a415651e55f5869592405999fe4d71b49bf2b61dae60dc`.

## Commands and matrix

All toolchain/tests used `sh .execution-008/clean-run.sh`. Vitest commands used `pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts` with these filters, or no filter. Original deadlines retained.

| Log | Scope | Outcome |
| --- | --- | --- |
| finalhold.log | negative preparation, three positive-held barriers, permit-window regression | 5 passed; clean teardown |
| typecheck.log | credential-tests typecheck | passed |
| reset-three-trace.log | reset origin both observation modes, exact successor | 3 passed; clean teardown |
| full-original-trace.log | sole unfiltered causal run | 39 passed, 7 failed, 1 isolation error; incomplete 54-case suite |
| final-narrow.log | final bytes, all eight above cases, diagnostics removed | 8 passed; clean teardown |
| final-typecheck.log | final bytes typecheck | passed |

Full-run failures were both reset claim-preparation false assertions, successor final-preparation false, permit-window final-preparation false, queued-configuration polling failure, lost-started acknowledgment timeout and control-intent Stop timeout. Isolation reported D1/credential sqlite-shm stack-pop failure. Resource ownership for that full run remains unproven; no borrowed RPC capability was blindly disposed. Individual cleanup success does not explain full-run teardown. Test-log hashes are in `test-log-sha256.json`.

## Causal observation and next decision

Synchronous scalar logs added no awaits or SQL reads. Reset observation=false consumed claimed=1 at 122 ms yield remaining, durability completed at 117 ms, product check at 29 ms. Cancellation occurred during EXISTING fresh-authority await; last completed stage was boundProductCheck, HOST signal aborted at -42 ms with 59149 ms operation budget.

Successor preparation showed the same substage, 17 ms to -65 ms, claimed=1. Observation=true fresh authority returned at -10 ms with signal still live; final synchronous permit then rejected, claimed=1. Neither consumption nor encryption should be undone. Controlled preclaim fault instead aborted before receipt validation; the final regression independently reads claimed=0. Initial prompt and three native turns were healthy.

For parent decision only: consider batching the fresh candidate reset-row and owned-authority reads within `CandidateFixtureProduct.readRuntimeAuthority`, retaining table-existence handling and every tuple/generation predicate. Current serial reads are a concrete latency target, not a proven unique fix. No fresh checks may be cached away. This trace narrows these failures, not every historical failure or teardown. Stop here for independent review; 008 is not accepted or complete.
