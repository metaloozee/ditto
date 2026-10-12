# 008 qualification advisor review

Status: local private RPC fixture tests independently pass; issuer implementation and full 008 remain unaccepted. The maintainer requested the scoped implementation continuation recorded below.
Base: `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`.
Execution worktree: `/home/ayan/ditto-execution/plan-008-4WXvNW`.
Authorization remains the [qualification-only handoff](../decisions/008-fixture-reset-qualification-handoff.md). No issuer, production change or integration is authorized.

## Independent evidence review

The advisor read the executor report, complete isolated entrypoint/config/tests, baseline inventory/hash manifest and failed A integration log. The artifacts import the existing product/credential composition and only substitute qualification subclasses. The admission path uses actual `CandidateProductCommands`, test D1 and encrypted host storage. Tests seed the synthetic owned project/account, not successful commands or membership.

The final-permit override calls the real `ModelProductAuthority.permit`. It holds the actual positive fourth result, not a stubbed permit or a query that has not yet evaluated. The test verifies earlier positives and a real `host_model_dispatch` row with `claimed=1` for the same effect before committing the D1 review fence. The last production credential permit await is after the host claim and immediately before fetch.

The advisor independently ran, unchanged, inside the isolated launcher:

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run --config ../../plans/evidence/artifacts/008/qualification-executor/qualification.config.ts -t 'B '
sh .execution-008/clean-run.sh pnpm --filter @ditto/runtime exec vitest run --config ../../plans/evidence/artifacts/008/advisor-current/runtime-probes.config.ts
```

| Check | Result |
|---|---|
| Held-positive final permit, repetition 1 | failed safety assertion, one synthetic fetch instead of zero |
| Held-positive final permit, repetition 2 | failed safety assertion, one synthetic fetch instead of zero |
| Review revocation before final query evaluation | passed, zero fetches and actual final query false |
| Four unchanged correction probes | passed, 4 tests |
| A independent rerun | not run, inspected executor's failed integration first |
| Full original 008 matrix/final aggregates | not run in qualification review |

The B-only command exits 1 from precisely two `expected 1 to be +0` assertions, not a toolchain or pool-teardown error. Logs retain original admission/window accounting. A stale request completed under the original reserved operation; no attempt refund, authority generation advance or actual takeover was tested. This is concrete evidence of the reset proposal's final-dispatch safety gap, not hosted/provider acceptance or independent revocation of all accepted predecessor decisions.

## Abort limitation and continuation

The first A experiment observed `remote: true` and `durableObjectReset: true` after the supported abort, whereas a same-message ordinary callback throw did not. The old broken stub also exposed the reset flag, so the flag alone cannot bind a newly executed reset. A lost outcome was annotated but not exercised, and the local uninvoked rejection was not a real transport negative control.

The actual untouched predecessor guard rejected replacement activation. Native alarm activation also left a rejected completion promise; inherited `retireFixture` awaited it before deleting the alarm. The test failed at retirement, then the pool failed isolated-storage teardown. These failures remain preserved. No generic rejection or replacement nonce is accepted as termination proof.

The advisor resumed the SAME qualification executor, still `openai-codex/gpt-6.1-sol`, medium, with an explicit fixture-only correction brief. It must write separate continuation test/config/entrypoint/log files, fix only isolated diagnostic alarm/cleanup ordering, exercise spoofed flags, real failed delivery, lost abort observation and broken-stub replay, and keep actual production takeover denied. No original A/B evidence may be overwritten. No production host/credential change, witness, generation increment, deadline increase or pool-isolation suppression is permitted. Agent `21f93215-8ed3-440` completed that continuation and stopped on another isolated-storage failure. Its results are reviewed below.

The separate read-only critic, `31a00aa2-38d3-46d`, completed its review of only the proposed dispatch fence's ordering/scope/crash argument. Its [design review](../reviews/008-dispatch-fence-review.md) finds the direction conceptually viable but requires live SQLite fencing, immutable exact-attempt binding, durable idempotent revoke/reopen receipts, an invocation-versus-delivery definition and preservation of all window/effect deadlines. It also recommends reusing existing effect accounting before adding a second journal. No implementation is accepted; new preparation/final-dispatch hooks require separate permission.

## Preservation and archives

The advisor recomputed all 37 baseline candidate source hashes and inspected the source archive's exact entry set and bytes. Every hash matches. Archive SHA-256 is `fa9408ba99b23d8256832feee587a2358c221a9f943ae0f2c5e87ec3c80a5b30`. Staging is empty. No candidate source or existing fixture file changed in the initial qualification.

Executor report is preserved in main at `plans/evidence/008-fixture-reset-qualification.md`. Original executor artifacts and independent logs/preservation result are copied under main `plans/evidence/artifacts/008/qualification-executor/` and `qualification-advisor/`. The original execution copies remain intact. No cleanup, dependency change, deployment, shared database operation, staging, commit or integration occurred.

## Continuation review

The advisor read the complete new isolated entrypoint/config/test and failure log, plus the appended executor report. The [chronological report](008-fixture-reset-qualification-continuation.md) and nine new `a-continuation*` artifacts are preserved in main under the existing qualification-executor artifact directory. The initial report and all 17 original artifacts remain byte-identical. The advisor again recomputed all 37 candidate source hashes; none changed. The appended report begins with the exact original report bytes.

The new fixture alarm checks a diagnostic reset-pending intent before ordinary activation. It is a no-new-work marker, not authority. The credential observer delegates to the actual inherited request and observes its denied result. The test deletes only its own disposable DO alarm using supported storage methods, releases the fixture wait and checks that the original invocation/effect, receipt and encrypted association remain. No existing fixture or production source changes were made.

| Continuation observation | Disposition |
|---|---|
| Normal callback error with forged `remote` and `durableObjectReset` | Its allowlisted fields matched the genuine supported abort error. A fields-only classifier at this callback seam is insufficient. |
| Normal fixture RPC error with the same forged fields | Actual RPC did not preserve the forged reset property. This does not yet qualify genuine abort through that RPC path, which was not tested. |
| Second abort attempted through old broken stub | Execution marker absent; old label and reset error replayed. No newly executed reset can be inferred. |
| Fresh passive proof and ordinary activation | Original retained records survived, zero upstream requests; untouched predecessor guard denied activation. |
| Test-body cleanup | Alarm deletion and inherited denied request outcome completed; original unresolved effect and occupancy remained. |
| Pool teardown | failed again with `.sqlite-shm` / isolated-storage error. The remaining cause is not established. |
| Discarded-outcome/controller-restart control | not run, suite stopped at first test teardown. Authored test is preserved, not passing evidence. |
| Four unchanged advisor probes | executor passed all four again; advisor already independently passed the same unchanged bytes before this continuation. |

No independent rerun of the failing A integration was performed. Its body observations are inspected executor evidence, not a passing suite or independently reproduced complete classifier. Callback spoofing does not prove every possible supported abort observation is impossible; the actual RPC serialization result is a lead for a different controlled experiment.

The qualification executor complied with the explicit stop condition instead of suppressing storage isolation, retrying until green, extending deadlines or mutating the host guard. The executor stopped at that checkpoint. The earlier B safety failures remain unchanged and independently reproduced.

## Next decision

008 remains BLOCKED. Recommend a narrowly scoped diagnosis of the isolated-storage teardown, followed by a real supported abort through private fixture RPC if clean lifecycle qualification can be established. Preserve the callback counterexample and test exact-origin binding, stale delivery and lost observation there. Do not treat RPC flag stripping as proof of genuine abort completion before running that experiment. This is fixture qualification, not issuer or credential-hook implementation.

The maintainer approved that narrowly scoped continuation. The [diagnosis handoff](../decisions/008-abort-teardown-diagnosis-handoff.md) keeps source, dependencies, deadlines, isolation and takeover guards unchanged. Attempted resume of `21f93215-8ed3-440` failed because its handle had been cleaned up, before any new work. Fresh executor `d9573825-a142-484`, `openai-codex/gpt-6.1-sol` with medium reasoning, is running in the same preserved worktree. It must reproduce/minimize the teardown failure, test falsifiable hypotheses one variable at a time, then exercise actual private RPC abort only if clean lifecycle is established. No new result is recorded yet.

At that checkpoint, new credential hooks and issuer implementation still required separate permission. No fallback witness, weaker takeover guard or whole-candidate acceptance was authorized.

## Local RPC pass and implementation continuation

The diagnosis executor completed and preserved its detailed report under `artifacts/008/qualification-executor/teardown-diagnosis/report.md`. It narrowed teardown to a pinned-pool direct error-RPC limitation even without Pi or abort. The supported callback seam executes the actual unchanged expected guard denial without that teardown failure. The advisor inspected the complete actual RPC fixture/test/config and independently ran both tests unchanged: [two tests passed with clean teardown](008-private-rpc-test-run.md), including actual discarded outside observation/controller restart. This is accepted local fixture evidence, not production termination authority or a working issuer. The full diagnosis artifact directory is archived in main; all 37 candidate source hashes matched before implementation began.

The maintainer then requested continued plan execution. [The implementation handoff](../decisions/008-implementation-continuation.md) limits the next code delta to candidate preparation/final-dispatch hooks, existing fixture credential/reset composition, host-owned origin/recovery barriers and remaining 008 tests/gates. The separate fresh executor `a346735e-b600-46c`, `openai-codex/gpt-6.1-sol` with medium reasoning, completed a [partial four-file dispatch increment](008-dispatch-increment-advisor-review.md) and stopped at the unchanged offline brain-cache prerequisite. Three final-byte barrier tests and four unchanged probes independently pass. Reset/recovery remains unfinished. No production lifecycle service, default activation, live operation, dependency/cache repair, source integration or weaker guard is authorized. No full implementation acceptance is claimed.
