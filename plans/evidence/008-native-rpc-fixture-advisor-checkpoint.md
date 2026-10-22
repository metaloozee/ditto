# 008 native RPC fixture advisor checkpoint

Status: approved bounded probe completed and reviewed. No permanent source increment or product fix. Plan 008 remains BLOCKED and unaccepted. No executor is running.

## Execution and preserved failures

Executor `03050660-20a9-414` used the existing detached `/home/ayan/ditto-execution/plan-008-4WXvNW`, base `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`. The advisor independently checked all recorded response metadata, including the resumed correction: only `openai/gpt-6.1-sol`, medium reasoning. No fallback.

The [approved probe](../decisions/008-native-rpc-fixture-probe.md) originally failed twice without collecting timing samples. The first invocation could not load the scratch main/module paths. The corrected path invocation reached real admission but omitted the candidate credential fixture and failed `model_unconfigured`; its dependent isolation assertion then failed before observing isolation. A separate unreached caller defect reversed Chord's promise/context arguments.

The advisor read the actual scratch source, existing credential setup and pinned Chord signature, then issued the [specific harness correction](../decisions/008-native-rpc-probe-harness-correction.md). This authorized one additional invocation, not a hidden extension of the original retry allowance. It initialized the required synthetic candidate credential, corrected `awaitWithContext(pending, context)`, added its honest namespace type and changed only generated output paths. No receiver policy, binding topology, assertion or deadline changed. The earlier failures remain preserved as failures.

Evidence is archived under `plans/evidence/artifacts/008/native-rpc-fixture-advisor/` for the failed attempts and `plans/evidence/artifacts/008/native-rpc-fixture-correction-advisor/` for the correction and successful probe.

## Review and result

The corrected command was:

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run --config /home/ayan/ditto-execution/plan-008-4WXvNW/plans/evidence/artifacts/008/native-rpc-fixture-correction/probe.config.ts
```

The executor ran this once: exit 0, one file and two tests passed, no reported unhandled or storage-isolation errors. Vitest reports 3.29s total and 1696ms test execution. Original 5000ms test and 10000ms hook deadlines remained unchanged. No timing threshold was introduced.

The advisor read the complete scratch correction/application patches and actual log. It independently regenerated the exact correction patch, verified identical receiver source and identical executable bundle bytes after excluding source-path comment lines, and recomputed 24 timing samples from the actual log. `independent-verification.json` records those checks. No additional independent test invocation was performed; these are reviewed executor test results, not a separately reproduced pass.

The samples comprise 12 test-context calls and 12 calls from the existing candidate fixture DO, each containing three echo and three authority calls per receiver. Created-to-receiver-entry took 1–2ms for current-Worker calls and 0ms at millisecond resolution for native auxiliary calls. Authority receiver bodies took 5–7ms for both paths. Return-side intervals were 0–1ms. Zero measured time means below this clock's resolution, not zero work.

The two tests passed these behavioral assertions through both receivers:

- A first prompt admitted through actual candidate product policy produced one workspace session and command, with no manually seeded successful command/membership.
- Both receivers saw the same disposable D1 state. Owned generation-1 authority was current and wrong-owner authority denied.
- Review and deletion fence mutations were immediately reflected in fresh reads. Clearing the review fence restored current authority before deletion.
- The next isolated test observed no prior schema/rows through direct D1 or either receiver and denied the prior owned scope.

The same compiled receiver reused the actual ordinary-authority preparation/validation helpers. There was no reset table or row. No host activation, provider dispatch, new DO namespace, arbitrary SQL/callback interface, private runner-name derivation, output-gate bypass or capability-lifetime change occurred. The auxiliary Worker had outbound network disabled. Main-isolate fetch mocks were not assumed to cover it.

## Interpretation

The successful contrast does not reproduce the original product's recurring 47–54ms receiver-entry gap. It therefore does not support assigning that gap to a fixed intrinsic current-Worker wrapper cost. A permanent auxiliary-Worker topology rewrite is not justified by this result.

The result also does not rule out workload-dependent wrapper/runner contention or storage/output-gate interactions. It measures warm, bounded receivers with no active encrypted host or serial product/model preparation workload. Three samples per method/receiver/context, current-first ordering and millisecond resolution limit generalization. Active cancellation, unsettled-work isolation, reset/configuration-policy equivalence and complete private product/credential/runtime composition were not tested.

The unresolved difference is the actual host workload: the earlier product run incurred the large entry gaps during configuration/model preparation, while this inactive existing-DO probe did not. Any further investigation should contrast that workload or pending storage/gate state directly. It should not start a topology rewrite or another authority-query optimization based solely on this probe.

## Restoration and scope

All 37 application/package files independently match archived entry bytes and the expected baseline hashes, including untracked candidate implementation files. Earlier probe evidence and its copied archive are byte-identical. The advisor checked empty staging and passing execution `git diff --check`. Temporary re-export/caller hooks are removed; scratch source, bundles and logs remain in the evidence directories.

MAIN application source, installed dependencies, manifests and lockfiles remain unchanged. No install, cache repair, deadline widening, full product run, final aggregate, stage/commit/merge/push, deployment, live provider/credential use, retained/shared DB operation, external cleanup or worktree removal occurred.

The original product sequence's timeout/isolation failure remains unresolved. Full product success with clean teardown, the five original sequential aggregates and independent whole-slice review remain required. This probe does not complete 008, L3 or any hosted/live/retained activation gate.
