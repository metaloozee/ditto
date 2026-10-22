# 008 native RPC fixture contrast

Status: maintainer approved a bounded fixture-only probe. This does not authorize a permanent topology change or 008 acceptance.
Execution remains `/home/ayan/ditto-execution/plan-008-4WXvNW`, detached base `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`. Separate executor uses `openai/gpt-6.1-sol`, medium reasoning, with no fallback. Advisor writes only MAIN `plans/`.

## Question and approved boundary

The current candidate's repeated 47–54ms RPC entry gaps include the pinned Workers pool's current-Worker export resolution and singleton runner-DO fetch. Measurements do not isolate native service RPC. The previous bounded original-order product run remains red. See `plans/evidence/008-rpc-completion-advisor-checkpoint.md`.

Test one specific prediction: compiling an otherwise identical fixture receiver into an auxiliary Worker removes most of that receiver-entry gap. The alternative prediction is that a similar delay remains, implicating another part of the caller/runtime path. This is a causal diagnostic, not a performance acceptance threshold or a claimed product fix.

Use existing Workers pool 0.12.21 and Miniflare 4.20260310.0 with the already installed esbuild 0.27.3. Native auxiliary Workers are a supported pool option. Do not use newer plugin configuration APIs, patch dependencies or derive private runner names.

## Exact probe design

1. Verify all 37 candidate hashes against MAIN `plans/evidence/artifacts/008/command-read-batch-advisor/final-source-sha256.json`, archive their exact bytes including untracked source, and preserve selected prior evidence under a new execution `plans/evidence/artifacts/008/native-rpc-fixture/`. No environment/dependency/cache archive.
2. Create a scratch fixture receiver and probe test/config under that evidence directory. Compile the receiver with the existing esbuild API to a worktree-local ignored output path under `.execution-008/`. The same receiver implementation must be used for both a named current-Worker binding and a named auxiliary-Worker binding. Receiver methods return bounded scalar echo/timing evidence and fresh candidate ordinary-authority reads. No model/provider dispatch, new transcript, arbitrary SQL interface or runtime owner is introduced.
3. For fresh D1 reads, reuse actual exported `prepareCandidateRuntimeAuthority` and `validateCandidateRuntimeAuthority` from `apps/web/src/lib/session-command-candidate.ts`, not copied or weakened ownership SQL. This subset covers the no-reset ordinary generation-1 case only. Do not claim reset/configuration-policy equivalence from it. There must be no reset row in these probe cases. Keep all actual policy predicates and fail-closed behavior.
4. Re-export the scratch receiver from execution `apps/credential-tests/src/model-entry.ts` temporarily. Add a scratch named current-Worker binding and an auxiliary Worker in a separate probe config based on the existing config. Bind both to the SAME disposable D1 database through supported public Miniflare options. Confirm shared visibility empirically. Keep compatibility date/flags and existing DO namespaces unchanged. No public route or deployment binding.
5. Time a small fixed alternating sample from both test context and the existing candidate fixture DO caller. A temporary method on `CandidateFixtureSession` may select only the two fixed scratch bindings and perform the bounded probe. It must not activate/open/configure/schedule the host or mint authority. Measure before RPC creation, receiver entry/exit and after await with scalar evidence. Use the same cancellation adapter when testing its behavior. No raw prompt, claim, secret, capability URL or IDs in logs. No new DO namespace, arbitrary callback or general transport abstraction.
6. Admit a real synthetic first prompt through existing `CandidateFixtureProduct.admitOwned`, never seed successful commands or memberships. Use the resulting owned scope for fresh-read comparisons. Mutate the existing review/deletion fence and prove both receivers immediately deny. A subsequent isolated test must observe no prior test's D1 rows through EITHER receiver. Disable external network as in existing fixtures. Do not move provider fetch into an auxiliary Worker or assume main-isolate fetch mocks would apply there.
7. Run one focused probe invocation at existing test/hook deadlines through `sh .execution-008/clean-run.sh`, using an adequate outer tool budget. At most one corrected rerun is allowed for a concrete binding/build/test-harness defect, with the initial failure preserved. Do not install missing prerequisites, disable isolation, change budgets or retry until green.
8. Restore all 37 source files exactly. Keep scratch code, bundle, config and complete logs as evidence, not permanent application source. Prove hashes, no remaining diagnostic hooks in application code, empty staging and `git diff --check`. Do not rerun the full product suite or aggregates on this diagnostic-only increment.

## Interpretation and stop

Report actual sample counts, caller contexts, receiver code/bundle hashes, D1 shared-visibility/freshness/isolation results, command exit status and every failure. Identify whether a native receiver contrast supports a fixture-wrapper contribution, but do not assign all product latency to it. A small native receiver cannot prove that the complete product slice meets 008 or that all remaining failure paths disappear.

If binding the same disposable D1 or accessing the existing DO caller requires private pool APIs, altered namespace ownership, capability-lifetime changes or an unreviewed permission shortcut, stop and name the limitation. Do not design a whole replacement test topology as a workaround.

A successful result gates a separate advisor design for any product fixture-composition correction. That design must address full private product/credential/runtime bindings, fetch mocks, D1/DO isolation, priority controls, reset proofs and original assertions before permanent implementation. It is not authorized by this probe.

Keep all seven product authorization stages, five local-authority reads, exact host claims, encrypted format-4 state, origin/generation guards, conservative occupancy, default unavailable production composition and every runtime/effect/window/test/poll/queue/recovery deadline unchanged. No refund/replay, dependency/manifest/lockfile change, MAIN source writes, stage/commit/merge/push, deployment, live provider, retained/shared DB operation, external cleanup or worktree removal.
