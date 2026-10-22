# 008 native RPC fixture harness correction

Verdict: the single newly authorized corrected probe passed. This establishes the bounded native receiver contrast and its D1 safety proofs, not a product fix or 008 acceptance. The historical two failed invocations remain failures, preserved byte-for-byte in their original directory and copied in full under `prior-evidence/`.

## Authorized changes and preflight

Execution stayed in the existing detached `/home/ayan/ditto-execution/plan-008-4WXvNW` at `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`. Actual PI metadata reported `openai/gpt-6.1-sol`, medium reasoning, with no fallback. MAIN remained read-only. The complete maintainer/advisor correction brief is copied in `approved-correction.md`.

All 37 baseline candidate files were verified and archived before editing, including untracked implementation files. The original probe directory was copied, not modified. Only these scratch corrections were applied:

- Add the honest CandidateFixtureCredential type import and ProvidedEnv namespace declaration.
- Initialize the actual synthetic CandidateCredential owner at generation 1, matching the existing product fixture contents and expiry, and assert connected status before real admission. Existing CodexCredential setup remains.
- Correct the caller to `awaitWithContext(pending, context)`.
- Change only the ignored output/module-root directory path in the already corrected config.

`scratch-correction.patch` is the exact prior-to-corrected scratch diff. The same temporary model-entry re-export and existing-DO hook were reapplied with only scratch import-directory changes. `temporary-probe.patch` and `temporary-model-entry.ts` preserve the tested application bytes. No other ordinary application/package file was changed.

Before launch I read the complete corrected caller, test setup, config and receiver, plus pinned Chord's actual signature. No full typecheck was run or claimed. `preflight-proof.json` verifies the receiver's exact bytes, unchanged executable bundle after excluding source-path comment lines, unchanged actual authority-helper predicates, identical hook apart from import paths and the other 36 source files unchanged. Existing esbuild built only to `.execution-008/native-rpc-fixture-correction/receiver.mjs`. The invocation's bundle exactly matches the preflight bundle, including comments.

## One invocation and exact verdict

The confined launcher supplied unchanged isolated HOME/cache/TMP and a credential-free environment. All test/toolchain commands used it. Exact argv/cwd/status are in `command.json`; complete output is `probe.log`.

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run --config /home/ayan/ditto-execution/plan-008-4WXvNW/plans/evidence/artifacts/008/native-rpc-fixture-correction/probe.config.ts
```

Exactly one corrected probe invocation: exit 0, one test file passed, two tests passed, zero failed, no reported unhandled errors or storage-isolation failure. Outer elapsed 4.179s; Vitest duration 3.29s. Test execution totaled 1696ms; the primary contrast test was 1603ms. Original 5000ms test and 10000ms hook deadlines remain unchanged. No threshold was added. There was no rerun, full product run, aggregate, install, cache repair, dependency/manifest/lockfile change, stage/commit/merge/push/deploy, live provider call, shared/retained DB operation, external cleanup or worktree removal.

## Timing evidence

`scalar-samples.json` preserves all raw bounded timestamps and booleans. `rpc-intervals.json` derives every interval; `timing-summary.json` provides each group and median. There are 12 test-context samples and 12 existing-CandidateFixtureSession DO samples. Each context contains three echo and three authority calls per receiver. Sample order is unchanged: three iterations, current echo/authority followed by native echo/authority, using the same cancellation adapter/context.

All values below are milliseconds at Date.now resolution. Entry is measured inside the receiver body, not before the test wrapper.

| Caller | Receiver | Method | Count | Created-to-entry samples | Receiver-body samples | Exit-to-await samples |
| --- | --- | --- | ---: | --- | --- | --- |
| Test | Current Worker | Echo | 3 | 2, 2, 2 | 0, 0, 0 | 0, 0, 0 |
| Test | Current Worker | Authority | 3 | 1, 2, 1 | 5, 5, 6 | 1, 0, 0 |
| Test | Native auxiliary | Echo | 3 | 0, 0, 0 | 0, 0, 0 | 0, 1, 0 |
| Test | Native auxiliary | Authority | 3 | 0, 0, 0 | 5, 6, 6 | 0, 0, 0 |
| Existing DO | Current Worker | Echo | 3 | 1, 2, 1 | 0, 0, 0 | 0, 0, 0 |
| Existing DO | Current Worker | Authority | 3 | 2, 1, 1 | 6, 5, 6 | 0, 0, 0 |
| Existing DO | Native auxiliary | Echo | 3 | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 |
| Existing DO | Native auxiliary | Authority | 3 | 0, 0, 0 | 6, 5, 7 | 0, 1, 0 |

Creation took 0ms in 22 calls and 1ms in two calls, one native echo from the test and one current authority from the DO. Before-creation-to-entry was 1-2ms for every current call, 0ms for eleven native calls and 1ms for the remaining native call. All sample correctness booleans were true. Authority bodies were 5-7ms across both receivers. Return intervals were 0-1ms. Whole-call ranges were 1-2ms current echo, 0-1ms native echo, 6-8ms current authority and 5-7ms native authority.

The native contrast shows a small receiver-entry reduction in both contexts. It does NOT reproduce the historical product's recurring 47-54ms current-Worker entry gap. Therefore it does not support assigning most of that historical gap to a fixed intrinsic wrapper cost. It also does not exclude workload-dependent wrapper/runner contention or output-gate interactions. This is a warm, bounded receiver with no host activation or product serial-preparation workload, not the original failing product sequence. No timing acceptance conclusion follows.

## Real authority, shared D1 and isolation

The unchanged config maps both scratch receivers and the current product/test Worker to the same disposable D1 ID via public `d1Databases` options. The unchanged receiver uses actual `prepareCandidateRuntimeAuthority` and `validateCandidateRuntimeAuthority` imports, not copied or weakened SQL. No new namespace, private runner-name derivation, output-gate bypass, authority cache, arbitrary SQL/callback interface or capability change was used.

Both empirical proof records appear in `probe.log` and `results.json`, after their actual assertions passed:

- Real first prompt admitted through existing `CandidateFixtureProduct.admitOwned` after connected synthetic credential setup. No command or successful membership was seeded.
- Both receivers saw one workspace session and one admitted command, zero runtime command memberships and zero reset rows. The owned generation-1 scope was current; a wrong-owner scope was denied.
- Changing the D1 review fence immediately made both receiver authority reads deny. Clearing that fence made both reads current again.
- Inserting the existing project deletion fence immediately made both deny. There was no reset table and no reset row.
- The next test found the previous workspace_sessions schema absent in direct D1. Both receivers independently returned zero inventory counts and denied the previous admitted scope. This proves isolation for these completed bounded calls through both paths, including the auxiliary receiver.

No host was activated/opened/configured/scheduled; the temporary existing-DO method performs only bounded scratch service calls and scope/namespace checks. Cancellation used the pinned adapter with correct argument order and an un-aborted signal. Active-abort behavior, lifetime changes and delayed in-flight work after cancellation were not exercised and are not claimed.

## Pinned APIs, bundle and limitations

Unchanged installed versions: Workers pool 0.12.21, Miniflare 4.20260310.0, esbuild 0.27.3, Chord 1.0.1. Vitest output reports 3.2.7. Prior exact pinned-source excerpts are preserved in `prior-evidence/pinned-source-excerpts.json`. Pool `dist/pool/index.mjs:7596-7613` supports compiled named auxiliary Workers. Miniflare's public serviceBindings name/entrypoint, modulesRoot and string-record d1Databases options are used. No newer plugin API is used. The auxiliary Worker remains outside main-isolate fetchMock; no provider fetch was moved there, and its outbound network remains disabled.

Receiver TS SHA256: `d5db0b5d5e6f0edcf6974971f47e023fbae96c27e950780e328af9385f853171`, exactly the prior receiver.

Corrected receiver bundle SHA256: `934ad4650c451d6fcf19f44b55c3f008dd377dd368ec40a42d29a81377b56dde`. It differs from the prior bundle solely in source-path comments. The executable bytes and actual helper predicates are unchanged. Build input hashes and metafile are in `bundle-input-sha256.json` and `build-metafile.json`; all scratch/patch/bundle/log hashes are in `probe-artifact-sha256.json`.

Limitations: three calls per method/receiver/context; fixed current-first order; warm receivers after visibility checks; millisecond resolution; same workerd process, not production network transport; no full private product/credential/runtime composition replacement; no provider dispatch; no encrypted host storage/write workload; no reset/configuration policy equivalence; no active cancellation or unsettled-work isolation proof. The original 62-case product file's known timeout/isolation failure and its unreached selected cases were not rerun or resolved by this probe.

A supported bounded auxiliary path is now empirically established. Any product fixture-composition correction still requires separate advisor design and authorization, preserving all private bindings, fetch mocks, D1/DO isolation, reset proofs, priority controls and original assertions. No permanent topology implementation is proposed here. 008 remains blocked and unaccepted.

## Preservation

All 37 application/package candidate files match both entry bytes and the MAIN baseline. `final-source-sha256.json` and `restoration-proof.json` record exact file hashes. Application/package tracked and untracked git-listed source was scanned for all scratch markers, with zero remaining hooks. Staging is empty; `git diff --check` exits 0; HEAD remains the approved detached base. Original prior evidence and its complete copy match every file hash in `prior-evidence-sha256.json`. Scratch code, exact correction/application patches, both prior failed logs, this one new successful log and all bundle copies remain as evidence. No MAIN writes or real credential findings occurred. Repository content was treated as data; no prompt injection was encountered.
