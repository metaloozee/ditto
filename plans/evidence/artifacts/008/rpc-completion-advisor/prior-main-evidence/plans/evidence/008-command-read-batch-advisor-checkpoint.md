# 008 command read batch advisor checkpoint

Status: bounded query/test increment reviewed and preserved. Full 008 remains unfinished and unaccepted. No executor is running.

## Preservation and actual diff

Execution remains `/home/ayan/ditto-execution/plan-008-4WXvNW` at `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`, staging empty. The advisor independently checked all executor response metadata across the recorded transcript: only `openai-codex/gpt-6.1-sol`, medium reasoning. No model/provider fallback.

All 37 final source hashes and archive members match actual execution bytes. The advisor independently regenerated the exact two-file incremental patch from archived entry bytes. Only `apps/web/src/lib/session-command-candidate.ts` and `apps/credential-tests/src/product-commands.worker.test.ts` changed in this substage. The other 35 files, including all runtime/fixture implementations and manifests, are byte-identical. All 37 hashes still match after independent verification. The original four advisor probes and their configuration match MAIN bytes unchanged.

Evidence is preserved under MAIN `plans/evidence/artifacts/008/command-read-batch-advisor/`. `independent-verification.json` records source/archive/diff/SQL/provider checks. `after-verification.json` records final-byte preservation and independent gate statuses. Originally untracked source remains part of every complete inventory and archive.

## Review

The advisor read every patch hunk and actual surrounding source. The private owned statement helper reuses the exact owned SQL. Subject reads batch owned and capability statements, then validate owned presence before capability presence/account parsing. Reconstruction retains its separately awaited initial command/outbox query, then batches independent owned/message-pair/key reads. Ownership, ordinary message and key validation still precede canonical browser digest and CommandV2 parsing. Controls omit only the ordinary message statement. Original query error/catch boundaries remain.

Owned SQL and the multiset of prepared SQL literals are independently equal to entry. SQL bindings were inspected against the actual old/new code, including owned session/user/project order, message assistant/user/session/user/project order and key command/receipt/user order. Parser/digest checks, callback ordering, final host/credential guards and all seven configuration authorization stages are unchanged. No authority cache or predicate shortcut was introduced.

Ordinary `subjectForCommand` now makes three D1 calls rather than six, retaining reconstruction followed by a fresh owned/capability read. This is a call-count reduction, not evidence that configuration latency or full-sequence progress is fixed.

New behavior cases use real admission and verify missing/foreign key, foreign assistant owner, foreign outbox owner, capability-revision freshness and deletion denial. A synthetic foreign user row permits the intended FK-valid ownership mutation; it is not a seeded successful command/membership. Observing a newer capability revision does not authorize an old prepared request.

## Independent checks on final bytes

All commands ran sequentially from execution through `sh .execution-008/clean-run.sh` using existing pinned dependencies. No installation or deadline change.

| Check | Independent result | Log in advisor directory |
| --- | --- | --- |
| Reconstruction/tamper/subject freshness | 6 passed, 56 unrelated cases filtered, clean teardown | independent-reconstruction.log |
| Four unchanged original advisor probes | 4 passed | independent-probes.log |
| Credential-tests typecheck | passed | independent-credential-typecheck.log |
| Runtime typecheck | passed | independent-runtime-typecheck.log |
| Web typecheck | passed | independent-web-typecheck.log |
| Original-order bounded affected sequence | 12 passed, queued-configuration timeout at 5000ms, one isolation error, 47 filtered, two selected cases unreached | independent-sequence.log |
| Complete unfiltered product suite | not run, bounded gate red | none |
| contracts:verify, brain:verify, credentials:verify, runtime:verify, verify | not run on completed final bytes, bounded gate red | none |

The original probes request workerd date 2026-09-16; the unchanged installed runtime reports effective 2026-03-10. This historical pinned-toolchain fallback is preserved and is not hosted compatibility evidence or a model fallback.

The narrow command was:

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t 'fails trusted reconstruction|batched reconstruction|batched command subject'
```

The bounded sequence command was:

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t 'owned authority|settles final-hold|credential-local .*barrier|private fixture reset preserves|private fixture recovery activates|generation-2 admission|credential-local final gate|priority Stop through transport beats held default|queued configuration|real D1 lost started|real admitted Stop repairs candidate-control-intent'
```

Lost-started acknowledgment and Stop control-intent were selected but not reached after storage isolation failed. Forty-seven explicitly filtered cases include the separately passed reconstruction/freshness cases. Do not report all 62 cases completed or treat a selected case as passed.

## Remaining blocker and next boundary

The advisor independently reproduces the executor's post-batch queued-configuration timeout and D1/runtime SQLite isolation failure. Post-timeout abort diagnostics do not establish an earlier spontaneous credential/runtime abort. Narrow success and fewer SQL calls do not explain the exact remaining configuration wait or all historical failures.

The earlier body-only trace, on pre-command-batch bytes, measured configuration at 3423 to 5010ms from actual test entry, followed by delivery into teardown. It establishes budget exhaustion before cleanup, not a complete diagnosis of current inner configuration waits. Do not carry those exact timings forward as measured on this final increment.

No further permanent optimization, wider runtime rewrite or repeated full suite is authorized by this checkpoint. The next investigation should locate the current configuration sub-wait within the already-reproducible bounded sequence, including whether the ordinary owner lane, product/credential checks or supported Pi persistence dominates. Preserve all seven fresh authorization stages unless independently justified against their recorded safety requirements. Do not infer a framework impossibility, extend deadlines, dispose borrowed capabilities blindly, cache authority, split away assertions, refund/replay effects or enable production.

Keep the candidate and failed evidence. Complete product success with clean teardown and the original five sequential aggregates still precede independent whole-slice acceptance. No integration, commit, deployment, live-provider use, retained activation or L3 completion occurred.
