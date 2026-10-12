# 008 authority batch advisor checkpoint

Status: query/test increment independently reviewed and retained. 008 remains unfinished and unaccepted.

The advisor verified actual executor response metadata and its first environment-selection tool result. Provider `openai-codex`, model `gpt-6.1-sol`, reasoning `medium`, no fallback. Execution remains `/home/ayan/ditto-execution/plan-008-4WXvNW` at base `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`. No integration or commit occurred.

## Actual diff

All 37 final source hashes and all 37 final archive members independently match the execution candidate. The advisor independently regenerated the exact incremental patch from archived entry bytes and confirmed only three source files changed. The other 34, including all runtime source, credential entry and manifests, match entry. Complete source/evidence is preserved under MAIN `plans/evidence/artifacts/008/authority-batch-advisor/`. Its `independent-verification.json` records the checks.

The advisor read every changed hunk and the complete surrounding authority/read and regression code. `session-command-candidate.ts` extracts the existing prepared owned query and exact row/expected-executor validator. The owned SQL literal is independently byte-identical. `model-entry.ts` batches the latest reset and owned query, then validates the expected executor tuple and original reset evidence. The existing positive-only schema-presence helper is unchanged. Genuinely absent reset tables still use the generation-1 owned path. Unknown batch errors propagate without granting authority. No reset or owned-authority cache was added. This saves one round trip, not proof that all latency failures are fixed.

The added tests exercise actual admission for absent/present reset tables, fresh review/deletion denial, wrong executor incarnation and missing/mismatched observation. The dedicated missing-generation-2-fence regression obtains actual issued/active private recovery, removes only the exact credential-local fence row, then admits a successor prompt. It asserts denied/no additional fetch, no recreated fallback row, retained generation 2 and unchanged admitted/unconsumed effect occupancy across reconciliation. It does not claim consumed-effect refund or replay permission. Existing completed-command/membership data is not seeded.

All host guards, encryption, immutable origin, private adapter, default unavailable production composition, budgets and deadlines remain unchanged. The test-only missing-table setup selects the absent-table case before any positive presence observation rather than swallowing unknown query failures.

## Independent commands on final bytes

Every command ran from execution through `sh .execution-008/clean-run.sh`. The advisor ran the exact executor bounded sequence once to verify the failure as well as the passing increment, not to retry a full suite until green:

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t 'owned authority|settles final-hold|credential-local .*barrier|private fixture reset preserves|private fixture recovery activates|generation-2 admission|credential-local final gate|priority Stop through transport beats held default|queued configuration|real D1 lost started|real admitted Stop repairs candidate-control-intent'
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests typecheck
sh .execution-008/clean-run.sh pnpm --filter @ditto/runtime typecheck
sh .execution-008/clean-run.sh pnpm typecheck
```

The bounded sequence independently reproduces 12 passed, one queued-configuration timeout at 5000ms and one isolated-storage error. Forty-two unrelated cases are explicitly filtered; two selected later cases are not reached after isolation fails. Log `independent-sequence.log` preserves the failure. All three independent typechecks pass, with separate logs. No full product suite or final aggregate ran.

## Remaining diagnosis

The failure is sequence-sensitive. The executor's single stage-instrumented queued case passed alone, while its original-order sequence and the advisor's original-order sequence both fail at queued configuration. Individual cleanup success is not proof of correct failing-sequence resource ownership. The pool reports live runtime SQLite at teardown; the earlier executor sequence additionally reported D1 SQLite. A pending continuation after timeout can explain that symptom, but its exact await is not yet identified.

The advisor inspected the pinned Vitest 3.2.7 runner. It calls beforeEach before invoking the separately timeout-wrapped test function. Do not blame the entire migration hook against the 5000ms test-body budget without evidence. Fixture-owned retirement awaits its native alarm completion, actual host yield and closure before clearing the host and deleting the alarm. Borrowed namespace/service/claim capabilities must not be arbitrarily disposed.

Next is a bounded diagnostic of the already-reproducible original-order sequence with scalar stage times in the queued test and existing fixture alarm/reopen/retire boundaries. No permanent source fix is designed yet. No wider patch, larger deadline, weakened assertion, isolation bypass, replay/refund, dependency repair or standalone reset qualification is authorized. Full suite and the original five sequential aggregate gates remain prerequisites for complete acceptance.
