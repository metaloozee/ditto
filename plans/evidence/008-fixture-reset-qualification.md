# 008 fixture reset qualification

Status: BLOCKED. Fixture-only qualification, not issuer implementation or 008 acceptance. Stopped for advisor review.

## Disposition

- A is NOT QUALIFIED. Actual admitted candidate work reached the supported abort call in its originating fixture constructor. The outside controller observed `durableObjectReset: true` and `remote: true`, unlike an ordinary same-message throw. However, the old broken stub also reports `durableObjectReset: true`. Classification, lost-delivery controls and a clean integration result remain incomplete. The A test then failed during retirement and isolated-storage teardown. No witness, generation change or successful takeover occurred.
- B reproduces the unsafe final-boundary dispatch twice. The real final permit returned positive after its D1 query and after the real host claim. While its return was held, this test committed a D1 review fence. Releasing the stale result caused one synthetic upstream fetch per repetition. Both zero-dispatch safety assertions remain red. The control with revocation before final-query evaluation passed with zero fetches.
- The four unchanged advisor probes passed. Production source and existing fixture source remain byte-identical to the qualification baseline.

## Scope and preservation

Read the complete handoff, witness protocol and witness review in the MAIN checkout. Did not copy them over prior evidence. All writes are in `/home/ayan/ditto-execution/plan-008-4WXvNW`, under this report or `plans/evidence/artifacts/008/qualification-executor/`. No existing fixture modification was needed. The qualification entrypoint imports/reexports the existing composition and substitutes isolated subclasses through test bindings.

Base `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`. Staging was empty before and after qualification. Before qualification writes, archived 37 current candidate source files selected from tracked diff paths and untracked apps/packages paths plus relevant manifests. Dependencies, `.execution-008`, generated build artifacts and environment files were excluded. This is a changed-candidate source archive, not a complete checkout backup.

Artifacts, relative to the execution root:

- `plans/evidence/artifacts/008/qualification-executor/baseline-source.tar.gz`
- `plans/evidence/artifacts/008/qualification-executor/baseline.patch`
- `plans/evidence/artifacts/008/qualification-executor/baseline-sha256.json`
- `plans/evidence/artifacts/008/qualification-executor/baseline-meta.json`
- `plans/evidence/artifacts/008/qualification-executor/source-preservation.json`
- `plans/evidence/artifacts/008/qualification-executor/preserved-evidence-sha256.json`
- `plans/evidence/artifacts/008/qualification-executor/artifact-sha256.json`

Archive SHA-256 `fa9408ba99b23d8256832feee587a2358c221a9f943ae0f2c5e87ec3c80a5b30`. Final comparison found zero changes in the 37 baseline source files, including the host guard and credential request path. No separately disclosed source diff is needed. Prior advisor/correction evidence was not overwritten. Its ending hash inventory is retained, not misrepresented as a pre-run inventory.

Environment reports `PI_MODEL=gpt-6.1-sol`, `PI_REASONING_LEVEL=medium`. No fallback model was used. Provider-qualified model identity was specified by the invoking user, not separately exposed by these environment fields.

## Toolchain and exact commands

Working directory for every command below was the existing execution worktree. All tests and Node toolchain inspection used `sh .execution-008/clean-run.sh`, with scripts disabled and isolated HOME/cache/store/TMPDIR/TMP/TEMP. No install, cache preparation, dependency change or actual test/runtime deadline increase occurred. Outer tool timeouts were 240 seconds for tests and 30 seconds for metadata inspection.

Installed: Node `24.21.0`, Vitest `3.2.7`, Workers pool `0.12.21`, Miniflare `4.20260310.0`, workerd `1.20260310.1`, workers types `4.20260605.1`, Pi Durable `1.0.1`. Resolved installed package paths are in `toolchain-resolved.json`. Qualification requested and used compatibility date `2026-03-10`. The unchanged advisor config requested `2026-09-16`; its runtime warned and fell back to `2026-03-10`. Test runner compatibility flags are recorded in logs.

1. Full isolated qualification attempt, exit 1:

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run --config ../../plans/evidence/artifacts/008/qualification-executor/qualification.config.ts > plans/evidence/artifacts/008/qualification-executor/qualification-run-1.log 2>&1
```

A produced controller observations, then failed at `fresh.retireFixture()` with `Prior host termination required`. Its inherited retirement awaited rejected alarm completion from ordinary activation of the replacement. The pool additionally reported `Expected .sqlite, got ...sqlite-shm` and `Isolated storage failed`. B did not run in this aggregate. This is a failed integration/tooling result, not an abort qualification pass. No production or fixture change was made to conceal it; A was not rerun or repaired after this block.

2. Independent B-only qualification command, exit 1 from the two deliberate safety failures:

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run --config ../../plans/evidence/artifacts/008/qualification-executor/qualification.config.ts -t 'B ' > plans/evidence/artifacts/008/qualification-executor/qualification-b-run-1.log 2>&1
```

Two failed safety assertions, one passing revoked-query control, A skipped. Each failure was `expected 1 to be +0`. No pool teardown error in this run. Its tests retain their original 3000 ms polling bounds and default test/runtime deadlines. The two repetitions use new disposable test state and unchanged source/deadline limits.

3. Four unchanged advisor probes, exit 0:

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/runtime exec vitest run --config ../../plans/evidence/artifacts/008/advisor-current/runtime-probes.config.ts > plans/evidence/artifacts/008/qualification-executor/advisor-probes.log 2>&1
```

Passed duplicate Stop, duplicate cancel, start-commit expiry and held-callback yield probes. This command and B-only command ran concurrently in separate isolated runtimes. No existing fixture source changed, so no additional fixture regression gate was required. No full aggregates ran.

Metadata inspection first tried `require.resolve(id + '/package.json')` through the credential package runner. It failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` for the installed Workers pool. This was an inspection error, not a missing dependency. The initially redirected `toolchain.json` is empty; it is preserved. Successful inspection used the installed exported entrypoints and walked to their existing package metadata:

```sh
sh .execution-008/clean-run.sh node plans/evidence/artifacts/008/qualification-executor/toolchain.cjs > plans/evidence/artifacts/008/qualification-executor/toolchain-resolved.json 2>&1
```

The baseline/final archive and hashing operations used Python standard-library file reads and Git read-only inventory commands. No package tooling was invoked outside the launcher.

## A observations and limits

The test admitted a prompt through the real `CandidateProductCommands` service, drained the actual leased delivery, used local D1 and the encrypted candidate DO, and held work at the existing credential `claim` phase before upstream dispatch. It asserted an actual `started` product decision and one real membership. It did not seed commands, runs or successful membership.

The isolated session subclass creates an in-memory constructor nonce. The controller captured that nonce before delivery, then captured the active invocation, full retained scope, named DO identity and encrypted association digest from the same constructor. The abort callback checked both nonce and exact invocation again before calling the installed one-argument `state.abort('008-qualification-opaque-abort')`. This is diagnostic same-instance evidence, not an immutable durable invocation-to-boot association or a future issuer.

The controller logged only allowlisted error fields, not error objects, stacks or credentials:

| Observation | name | message | remote | durableObjectReset | code/retryable |
| --- | --- | --- | --- | --- | --- |
| Ordinary callback throw | Error | 008-qualification-opaque-abort | absent | absent | absent |
| Uninvoked local rejection | Error | 008-qualification-opaque-abort | absent | absent | absent |
| Actual supported abort callback | Error | 008-qualification-opaque-abort | true | true | absent |
| Reuse of old broken stub | Error | 008-qualification-opaque-abort | absent | true | absent |
| Ordinary replacement activation | Error | Prior host termination required | true | absent | absent |

The fresh passive callback read storage without opening Pi. Retained scope and exact invocation were unchanged; the constructor nonce changed. There was already one conversation from admitted predecessor work. The passive probe did not create another root or call a provider. Zero synthetic upstream fetches were observed in A. The replacement's ordinary activation denied with the untouched predecessor guard. Product authority remained generation 1 with no witness.

`observations.json` preserves original opaque receipt IDs, command/message/session IDs, nonce, DO identity, invocation ID/generation/start/yield/end times, scope and encrypted association digest. No encrypted payload or raw model/credential content was logged. The platform emitted its own native stack diagnostics into the run log; those are not used as controller completion evidence.

Important limitations:

- The local uninvoked rejection is only a supplemental negative, not a real transport failed-delivery qualification.
- The test annotated a lost-observation disposition but did not run a separate actual aborted-and-discarded-outcome case. That remains unqualified.
- The reset property is observed, not proven exclusive to the exact requested abort. Reusing a broken old stub also carries it. A same-message throw alone cannot spoof the observed flags in this test, but arbitrary thrown flagged errors and other reset/storage failures were not fully qualified.
- Integration teardown failed. No clean supplemental/independent classification run was added after that block.
- Replacement construction and unchanged storage are not proof that all old non-storage work completed. No hosted eviction, provider cancellation or occupancy release is claimed.

Accordingly A remains NOT QUALIFIED even though the observed error flags are a useful lead for advisor review.

## B exact final boundary

`QualificationCredential.modelProductAuthority()` returns an isolated subclass of the real `ModelProductAuthority`. Its override calls `super.permit` and retains the actual Boolean result. No positive policy stub exists. Call numbering is local to the policy object created for the real credential request:

1. Permit inside real reservation.
2. Permit after the credentials phase.
3. Permit before the host claim.
4. Final permit after the real host capability claim.

Each race asserted calls `[1,2,3,4]` were positive while call 4 was held. A separate same-host SQL read asserted one `host_model_dispatch` row with `claimed=1` and the same effect ID as the final permit. The test then committed `workspace_sessions.runtimeFailureReasonCode='model_contract_review'` in its disposable D1 and confirmed that field before releasing the held return. Synthetic network access was restricted by `fetchMock.disableNetConnect()` and an existing-style `.invalid` mock. No request body, bearer header or token value was captured.

In both runs, release produced exactly one fetch. The original effect admission ended `complete`; the original window had `consumedRequests=1`, `maxRequests=1`, `closeReason='complete'`. IDs, request digest, generation 1, original attempt deadline, receipt and accounting are in `observations.json` and the B log. No authority restoration, generation advance, successor activation or witness was involved.

The control held entry to call 4 before its query, confirmed the real host claim, committed the same review fence, then evaluated the actual final query. Calls 1 through 3 stayed positive; call 4 was false; zero fetches occurred. This establishes the contrast between ordinary current denial and an already evaluated positive result released after revocation.

## Smallest proposed dispatch/reset mechanism

Design only, not implemented or accepted. The existing protected policy factory is enough to expose the race. It is not enough to close it because control returns from that asynchronous permit directly into production `fetch` without a candidate-local synchronous gate.

Use a candidate-only dispatch fence in the existing owner credential DO, keyed by validated candidate owner/session/namespace and host-authority generation. Do not add another DO namespace. Retain an admission epoch and phase in its SQLite plus a conservative per-effect dispatch-intent journal. Reset requires a private trusted credential-DO revocation RPC and a final synchronous dispatch hook in `CodexCredential.requestModel`. These hooks require new scoped permission beyond the existing policy factory.

Suggested sequence:

1. Product commits reset intent/ordinary-admission denial. This commit alone is not the dispatch barrier. Existing effects may still dispatch until the credential-local fence is acknowledged.
2. Trusted product calls the owned credential DO to revoke the exact candidate epoch. A synchronous SQLite transition closes that scope's dispatch fence. Await its durable storage acknowledgment, then return a receipt identifying scope, revoked epoch, reset ID and current boot. Retrying is idempotent. No provider or host closure wait is on this lane.
3. A model request captures its immutable admitted generation/dispatch epoch before preparation. It may await descriptor description, digest, model phase, current policy, credential freshness, reservation, decryption, later model phases, policy calls and host claim. All results remain preparations, never permission to bypass the local gate. Final policy evaluation still runs unchanged.
4. Before actual dispatch, persist a conservative prepared dispatch intent tied to original effect, claim, request digest and captured epoch; await storage sync. This is the last new suspension. On return, recheck deadlines, signal, credential version, candidate scope and captured epoch against the current local fence. Also check on return from every earlier suspension wherever it could mutate or schedule candidate work. Reject a stale preparation, including a held positive final response.
5. The exact final transition has no await: check the candidate-local fence/epoch, synchronously record the intent as potentially dispatched, then invoke `fetch`. The JavaScript turn cannot interleave the revocation callback between this check and `fetch` invocation. That invocation is the dispatch linearization point. Requests linearized before the fence transition remain potentially live, even if storage output gating delays external delivery. Requests reaching it afterward deny. Record completion separately through existing accounting.
6. The reset barrier acknowledgment requires persisted fence closure, not just D1 reset intent. Retain all possibly dispatched intents and original effect/window/executor occupancy. A crash between prepared intent and actual fetch is conservatively unknown, never refunded. On reconstruction load the durable fence before request admission; missing/corrupt state denies. Do not silently reopen it because D1 is active. Reactivation must bind a newer immutable generation/epoch and current validated recovery acknowledgment. Old continuations keep their captured older epoch and cannot adopt the newly active epoch.

This is a proposed local ordering proof, not a claim that workerd network delivery, output gates or cross-store crash acknowledgment have been qualified. Persistent intent handling and restart defaults need dedicated tests before acceptance. Repeat asynchronous reads cannot supply this no-await final transition.

Expected files/hooks for a separately approved implementation:

- `apps/web/src/lib/codex-credential-do.ts`: candidate-only protected final dispatch hook, after all awaited preparation and immediately before synchronous fetch; unchanged noncandidate default. A policy-only override cannot put a check after its own suspended return.
- `apps/credential-tests/src/entry.ts` or an isolated future issuer entrypoint: candidate fence storage, private trusted revoke/ack methods and injected gate. No public HTTP reset endpoint.
- `apps/web/src/lib/model-product-authority.ts`: shared candidate generation/phase predicates for current/open/reserve/permit. These complement the local gate, not replace it.
- `apps/web/src/lib/session-command-candidate.ts` and candidate fixture product composition: authority injection, review-fence checks, reset intent and durable credential barrier acknowledgment. Do not reinterpret executor lifecycle generation as host takeover generation.
- `apps/runtime/src/pi-durable-product-session.ts` and `pi-durable-host.ts`: separately approved immutable invocation-to-boot association, exact originating reset target, passive probe and recovery-only admission/control barrier. Preserve the existing newer-generation/exact-priorTerminated guard unchanged.
- New disposable handwritten fixture tables/tests only after approval; no shared DB migration for this qualification.

Priority Stop remains admitted/deliverable independent of ordinary capacity and model entitlement. Neither credential fencing nor host recovery may hold that lane across policy, credential or provider waits. Default noncandidate credential behavior must remain unchanged. Reset must not acknowledge remote cancellation or unknown executor completion. The design needs more permission and review; no prototype or issuer was implemented here.

## Review stop

Full 008 remains blocked. A needs a clean distinguishable completion qualification and stronger negative controls. B has preserved actual-path red evidence and an unaccepted design requiring another credential hook. No further implementation, installation, full gate run, staging, commit, merge, push, deployment, retained/shared DB mutation, external cleanup or worktree operation was performed or implied.
