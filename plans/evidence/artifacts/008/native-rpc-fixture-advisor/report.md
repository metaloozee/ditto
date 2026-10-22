# 008 native RPC fixture probe

Verdict: inconclusive. The permitted invocation and one corrected harness rerun both exited 1. No causal timing sample was collected. No permanent application change remains. 008 is still blocked and unaccepted.

## Execution boundary

Existing detached execution worktree `/home/ayan/ditto-execution/plan-008-4WXvNW`, HEAD `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`. Actual PI environment reported provider `openai`, model `gpt-6.1-sol`, reasoning `medium`. No fallback or subagent was used. MAIN was read-only. Repo documentation was treated as design data. No prompt injection or real credential finding was encountered.

All 37 candidate files, including untracked candidate implementation files, matched the MAIN baseline inventory before any probe edits. Exact bytes are in `entry-source/`. Selected prior evidence and approved design are retained beside this report. All test and toolchain commands used `sh .execution-008/clean-run.sh`, preserving its isolated HOME/cache/TMP and credential-free environment. No installation, cache repair, dependency/manifest/lockfile change, full product run, aggregate, typecheck, live provider request, shared/retained DB operation, staging, commit, integration, deployment or external cleanup occurred.

## What was built

`receiver.ts` is the single implementation for both named scratch services. Current Worker temporarily re-exported it from existing `model-entry.ts`; the native Worker used its esbuild bundle. Echo returns scalar value and receiver entry/exit timestamps. Authority calls actual exported `prepareCandidateRuntimeAuthority` and `validateCandidateRuntimeAuthority`, with their original ownership SQL and fail-closed missing/error behavior. Inventory is limited to fixed table counts; there is no arbitrary SQL, callback, model dispatch, runtime activation or new DO namespace.

The custom config inherits the existing optimizer, aliases, compatibility date/flags, product binding, four DO namespaces and synthetic private bindings. Both scratch services receive `DB` mapped to the same explicit disposable D1 ID through public `d1Databases` record options. Native receiver outbound network is denied by public `outboundService`. Main test fetchMock disables external network; no provider fetch was moved to the auxiliary Worker.

Temporary `CandidateFixtureSession.fixtureNativeRpc008` parses the ordinary scope, checks disposable fixture and existing namespace correspondence, then runs a fixed sample loop. It never opens/configures/schedules the host or mints authority. Caller code alternates current then native for three iterations, echo then authority each time, measuring before creation, after creation, receiver entry/exit and after await. Planned counts were 12 calls per context, 24 total, split equally between receivers and between methods. Actual counts are zero in BOTH test and DO contexts.

## Invocations and failures

Exact argv, cwd, exit, elapsed time and unchanged 5000ms test/10000ms hook deadlines are in `command-original.json` and `command-corrected.json`. Neither test uses a timeout override or timing threshold.

1. Original invocation: exit 1, outer elapsed 1.871s, Vitest duration 735ms, no collected tests, one unhandled runtime-start error. Inherited relative main resolved under the scratch config directory rather than apps/credential-tests. Auxiliary bundle module name was relative to process cwd and began with ../../. Workerd rejected it with `can't use ".." to break out of starting directory`. Complete log, original config, metafile and bundle are retained. Close also reported the same Miniflare runtime-start failure.
2. One permitted correction: absolute existing main path plus public auxiliary `modulesRoot` set to the bundle directory. No other probe behavior, binding, deadline or assertion changed. `corrected-rerun.md` records the concrete harness defect.
3. Corrected invocation: exit 1, outer elapsed 4.010s, Vitest duration 3.09s. Runtime started and two tests collected, both failed. First failed at real `CandidateFixtureProduct.admitOwned` with `CandidateCommandError: model_unconfigured`. Second failed at `expect(admittedScope).toBeDefined()` because no first command was admitted. It did not reach its isolation assertions. No timeout or storage-isolation error was reported in this invocation.

The corrected test installed only the existing `CodexCredential` synthetic fixture, but actual admission uses `CandidateCredential`. Restored `apps/credential-tests/src/model-entry.ts:1085` passes that credential into the commands policy. `apps/web/src/lib/session-command-candidate.ts:267-268` rejects disconnected status. The established product test explicitly installs CandidateCredential too, at `apps/credential-tests/src/product-commands.worker.test.ts:69-77`, before its owned-admission cases. This was an executor scratch setup omission, not evidence of a candidate product defect.

Post-run source review also found an UNREACHED scratch caller defect. `caller.ts:19` passes `context, pending` to `awaitWithContext`; pinned Chord requires `promise, context` at `dist/context/index.js:75`. It uses the correct adapter symbol but has the arguments reversed, so it cannot establish cancellation-adapter equivalence. This source remains exactly as tested for review. Neither defect was corrected or rerun after the single rerun allowance was consumed. There was no attempt to bypass admission, seed commands/memberships, change authority or extend the deadline.

## Proof matrix and causal interpretation

| Check | Actual verdict |
| --- | --- |
| Same receiver TS imported/current and bundled/native | Source construction established; no method reached |
| Auxiliary bundle loads after public path correction | Runtime started without runtime-start errors |
| Same disposable D1 ID configured | Established in config/public pinned APIs |
| Empirical shared D1 visibility | NOT REACHED |
| Real synthetic first admission | FAILED, model_unconfigured |
| Fresh ordinary owned generation-1 authority | NOT REACHED |
| Wrong-owner denial | NOT REACHED |
| Immediate review fence denial and recovery | NOT REACHED |
| Immediate deletion fence denial | NOT REACHED |
| No reset row/table in measured cases | No measured case; scratch never creates reset table |
| Next-test rows absent through both receivers | NOT REACHED; second test failed at prerequisite |
| Test-context timing samples | 0 |
| Existing-DO timing samples | 0 |
| Cancellation behavior/equivalence | NOT REACHED and latent argument defect |

No comparison supports or rejects the fixture-wrapper contribution prediction. Prior measured 47-54ms product receiver-entry gaps are historical advisor evidence, not samples from this probe. A native Worker starting does not prove native RPC, same-D1 visibility, authority freshness, storage isolation or complete product policy equivalence. No reset/configuration policy, capability lifetime, host claim or full-topology conclusion is justified.

The next action requires parent synthesis and fresh explicit execution authorization. The two scratch omissions are bounded test setup/call-signature defects, but this executor has exhausted its rerun allowance. No replacement topology is proposed.

## Pinned APIs and hashes

`pinned-source-excerpts.json` retains exact installed source paths, file SHA256 and line-numbered passages. Workers pool 0.12.21 `dist/pool/index.mjs:7596-7613` supports named auxiliary Workers, and `:7676-7693` retains them alongside the isolated test Worker. Miniflare 4.20260310.0 supports string-record D1 IDs and named service entrypoints; its `dist/src/index.js:75872-76020` maps D1 service/object routing by database ID. `:70607-70638,72876-72908` defines public `modulesRoot` and module naming. No private runner names were derived or invoked, namespace ownership altered, output gates bypassed, or capability lifetimes changed.

Current public Cloudflare configuration documentation was fetched at `https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/`. It describes compiled auxiliary Workers and warns that global mocks do not affect them, but now documents the newer plugin API. Those newer APIs were not used; pinned installed source controlled this config.

Existing esbuild 0.27.3 built only into ignored `.execution-008/native-rpc-fixture/receiver.mjs`. The same original/corrected bundle is retained in the evidence directory. `build-metafile.json` and `bundle-input-sha256.json` capture inputs, including the unchanged actual authority helper source. `probe-artifact-sha256.json` captures scratch source, exact temporary application bytes/patch, configs, bundles, metafiles and full logs.

- Receiver TS SHA256: `d5db0b5d5e6f0edcf6974971f47e023fbae96c27e950780e328af9385f853171`
- Receiver bundle SHA256: `7953c0ad2a0c243a0271905fdc24da767fb7fb739d526897aba6e8e3cc6fb43b`
- Caller TS SHA256: `d65a24909df978a6900ae4c40518643f2989375987ba37e650d0b7027c493d42`

## Restoration

All 37 candidate files were restored from entry bytes and match both entry inventory and MAIN baseline. `final-source-sha256.json` and `restoration-proof.json` record the proof. Probe-marker scan covers git-listed tracked and untracked application/package source, with zero diagnostic hooks remaining. Staging is empty and `git diff --check` exits 0. Only the temporary existing model-entry file was edited outside the scratch evidence directory; its exact tested bytes and incremental patch remain as evidence. All scratch files, both logs and bundle copies are preserved. No worktree or external artifacts were removed.
