# 008 configuration sub-wait advisor checkpoint

Status: diagnosis reviewed, no permanent source increment. Plan 008 remains BLOCKED and unaccepted. The executor has stopped.

## Preserved execution

The maintainer requested resumed execution in the existing detached worktree `/home/ayan/ditto-execution/plan-008-4WXvNW`, HEAD `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`. Executor `7b53cfe9-e824-4a1` used `openai/gpt-6.1-sol` with medium reasoning. The dispatch and actual response metadata match the requested model, provider and reasoning. No fallback was used.

The advisor dispatched one bounded diagnostic investigation rather than another speculative optimization. Three execution files were temporarily instrumented: `apps/runtime/src/pi-durable-host.ts`, `apps/credential-tests/src/model-entry.ts` and `apps/credential-tests/src/product-commands.worker.test.ts`. The probe adds scalar timing markers around existing awaits only. The advisor read the patch and surrounding configuration, fixture and authority source. No permanent correction follows from this run.

All 37 source files, including untracked implementation files, are restored. The advisor independently compared actual bytes against both the archived entry files and the prior accepted inventory. Every hash matches. No diagnostic marker remains in application TypeScript, staging is empty, and `git diff --check` passes. MAIN source was not changed. No install, dependency change, widened deadline, stage, commit, merge, deployment, live-provider request or retained/shared DB operation occurred.

Evidence is preserved under `plans/evidence/artifacts/008/config-subwait-advisor/`. The advisor independently regenerated the host boundary intervals from the scalar events rather than trusting the report totals. `independent-verification.json` records source/archive equality, calculated durations, test counts, restoration and staging checks. The existing improve skill's `references/closing-the-loop.md` is absent; no substitute reference or contents were invented.

## Result and interpretation

This instrumented run does not reproduce an indefinitely pending configuration sub-wait. Configuration returns `applied`, then the test exhausts its unchanged 5000ms deadline during the final follow-up completion poll.

| Measured configuration work | Duration |
| --- | ---: |
| Seven fresh product authorization stages | 843ms |
| Five fresh local-authority callbacks | 324ms |
| Owner-lane entry wait | 1ms |
| Supported Pi `root.configure` | 2ms |
| Entire host configuration through final finish marker | 1196ms |

The twelve fresh authorization callbacks account for 1167ms, approximately 98 percent of measured host configuration time. This supports distributed fresh authorization as the dominant measured configuration cost, not an owner-lane stall or Pi persistence stall. It does not identify a unique underlying transport cause or establish that any authority check is redundant.

Measured from actual test-body entry, first completion polling spans 1072–2757ms, reopen spans 2810–3136ms, configuration enters the host at 3273ms and returns to the test at 4489ms. Second delivery finishes at 4670ms, leaving approximately 330ms for two follow-up completions, remaining assertions and retirement. No assertions-end or retirement-entry marker appears before timeout.

Six selection callbacks total 350ms inside the instrumented fixture body, while their host-boundary intervals total 742ms. The 392ms difference is outside that instrumented body. The callback entry gaps are 55–108ms. These gaps remain unexplained; RPC transport/scheduling, other runtime work and probe overhead are possibilities, not proven causes. All six subject reads together take 115ms, so another subject-only query optimization cannot be presented as a demonstrated complete solution.

The earlier pre-command-batch trace timed out inside configuration. This run reaches further on current restored candidate bytes with temporary logging. Neither timing supersedes the actual failed verdict, and neither is a latency guarantee. The post-timeout storage-isolation failure and later configuration-unavailable error do not prove an earlier spontaneous authority or configuration failure.

## Exact verification boundary

The executor ran the original-order bounded selection once through the existing confined launcher:

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t 'owned authority|settles final-hold|credential-local .*barrier|private fixture reset preserves|private fixture recovery activates|generation-2 admission|credential-local final gate|priority Stop through transport beats held default|queued configuration|real D1 lost started|real admitted Stop repairs candidate-control-intent'
```

Result: exit 1, 12 passed, queued-configuration timeout at 5000ms, 47 name-filter exclusions and one unhandled isolated-storage error. Fifteen cases were selected among 62 collected. Two selected cases were not reached: lost-started acknowledgment and Stop control-intent repair. They are neither passes nor ordinary filtered cases.

The advisor inspected the actual command log, temporary patch, scalar events and preservation records. No additional independent test invocation was run for this diagnostic-only increment. Full product suite, new typechecks and all five final aggregates are `not run` in this continuation. Historical passes do not establish complete final-byte acceptance.

## Next boundary

Keep all seven product authorization stages, five local-authority reads, their fresh predicates and ordering, exact claim/reset guards, encrypted storage, conservative occupancy and existing budgets. Do not fix a red gate by caching authority, disposing borrowed capabilities blindly, removing assertion chains, raising deadlines or retrying until green.

A further permanent optimization is not specified by this evidence. The next useful investigation is the unexplained host-to-fixture RPC boundary cost and the admitted-work completion path, not the 2ms Pi configuration call. It should test a concrete transport or scheduling prediction against the same bounded sequence before choosing a correction. Existing local-authority reads already batch owned/reset queries, and subject reconstruction already batches independent reads; do not assume another safe batch exists without inspecting its actual dependencies.

No wider runtime rewrite or framework impossibility is established. Complete product success with clean teardown, the original sequential aggregates and independent whole-slice review remain required. No source integration, DONE status, L3 completion, production activation or hosted/live guarantee is claimed.
