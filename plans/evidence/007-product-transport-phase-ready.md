# 007 product transport phase execution

Disposition: READY FOR REVIEW for the synthetic product/credential transport and mandatory runtime adapter phase. This is executor verification, not independent acceptance. Full 007 remains NOT DONE. Authenticated configuration intents, snapshots, payload-conflict idempotency and pre-conversation default validation are the retained next phase.

## Workspace and preservation

Execution stayed in detached `/home/ayan/ditto-execution/plan-007-recovery`, HEAD `0ccc5b20c25a4e63017b3eebf6608dba62253479`. Main was read-only. No delegation, installation, dependency change, credential inspection, live provider/account call, fallback, deployment, shared database mutation, stage, commit, push or integration occurred. Outbound requests in tests were mocked fixed `.invalid` fixtures with network connections disabled. Public Cloudflare documentation retrieval was read-only.

Before editing, the existing partial implementation was archived explicitly under `plans/evidence/artifacts/007/product-resumption-current/` as `source.tar.gz`, `source.sha256`, `source.patch` and `status.txt`. The archive contains 25 source/spec files and excludes environment files, dependencies and real credentials. Interrupted work was preserved, not restored or reverted.

The final explicit archive is `candidate-source.tar.gz`, SHA-256 `7696b9dd92d2de73b56f243215f36c403c93a460661a123bcbbf510fb200aa11`. `candidate-source.sha256` lists all 27 candidate source/config/spec files. `resumption-only.patch` compares against the preserved interrupted source; `candidate-base.patch` records tracked changes from HEAD. The explicit archive includes new untracked files omitted by a plain Git diff. `resumption-changed-files.json` lists the 17 files changed in this continuation.

Seven of the eleven accepted host-review identities still match. Host, model tests, model contract and spec differ and require current review. The model test change predates this continuation and was part of the reviewed RPC increment. Accepted effects, summary, preparation, cooperative fixture and original contract tests are unchanged from the resumption archive. The original host probe and configuration-close probe archive match the advisor copies byte-for-byte. See `accepted-preservation.txt` and `preservation.txt`. All six recorded package/lock graph files match HEAD. Root `package.json` changes only suite registration. Whitespace check passes and staging is empty.

## Reproductions and corrections

Both credential and runtime typechecks passed immediately. The prior `.ts` import setting, void-returning callback and unknown-row narrowing repairs were already present in the actual interrupted source. They were verified rather than weakened or replaced. A later web typecheck found a request-test headers array whose inferred union included optional undefined fields; an explicit `Record<string, string>[]` fixes that test typing.

The first combined credential run passed 73 tests and failed two custom-summary observations. `Harness.inspect()` omits settled generation tasks, so polling for a terminal task through inspection could never succeed. The tests now locate the durable task association and query the actual task. The failure test also waits for the DO's known-failure evidence before yielding, rather than observing fetch start and canceling before its result. Both retain their original three-second observation bounds, all assertions and one-attempt accounting. The failure case now additionally asserts the run is failed.

The first aggregate credential gate passed 78 Worker tests but failed the standalone crash bundle. The interrupted fixture entry exported the runtime host, pulling Pi/Sandbox into a credential-only bundle and violating the retained graph boundary. `model-entry.ts` now owns only the combined model-test composition. The original credential entry and standalone crash/RPC assertions remain intact. No Node-module workaround, relaxed assertion or removed check was used.

Additional completion work scopes admission records to the identity-specific window, rather than globally unique runtime-local effect IDs; proves independent sessions with identical effect IDs; proves concurrent duplicate requests consume only one allowance and one live claim; checks expiry after held credential preparation; bounds unacknowledged stream cleanup; bounds product capability description; and makes the host halt flush use the owning cancellation context. Source was formatted without altering accepted test bodies.

## Admission and ownership argument

1. The mandatory runtime adapter enters `HostGuard.model` for every generation attempt, Pi retry, accepted custom summary and Git-metadata attempt. Stock summary fallback lacks the owning association and remains denied. The adapter reconstructs its separately versioned synthetic request from the actual prepared model, transcript and options. It has no environmental credential discovery or public-network/API-billing fallback.
2. Deployment-owned `ExactModelClaim.forRequest` creates a live `RpcTarget` around the host-minted dispatch. Its descriptor binds the exact parsed attempt, owned user/project/workspace/identity scope and canonical reconstructed request digest. Its claim is one-use and checks exact attempt and owned digest binding. JSON attempt data is not a capability.
3. The private product Worker routes to the credential DO by the descriptor owner. The real `ProductEntrypoint` contains request/permit/discovery methods, but production request availability and permit availability remain false. Only the disposable test composition opts into synthetic request dispatch and D1 fixture capabilities. Production discovery returns unavailable/revoked, not bundled entitlement.
4. Product policy joins command, membership, workspace, project, user, exact sandbox identity, connection and fixture capability rows. It checks command kind/assistant/deadline and exact command-to-session/run membership; session/project ownership and statuses; trusted runtime owner/version and review state; identity role, controller namespace/class, incarnation, lifecycle, readiness and retirement; retirement/deletion fences; connection generation/revocation/status; and exact capability revision/snapshot/model/thinking. The existing legacy `SandboxAuthority` and its trusted-runtime rejection were not relaxed.
5. Conditional `INSERT ... SELECT ... WHERE EXISTS(...)` opens the model window only under current D1 policy. Existing unique identity/family/open-slot storage prevents two open windows. A transactional D1 batch conditionally inserts one request under current policy, expiry, denial and allowance predicates, then increments consumption only when the insertion changed one row. Window-keyed admission records allow equal runtime-local effect IDs in different owned sessions without mixing evidence. Existing reserved/admitted/unknown evidence prevents a new identity window from bypassing uncertainty. Git metadata's conditional insert checks all prior reservations for that identity/run/epoch, including known failures. No failure refunds consumption.
6. The credential DO validates the complete canonical request and digest before opening credentials. It verifies fresh product policy, current connection/local record, and renewal outcome; reserves the operation; decrypts only product-side; and rechecks local revision after asynchronous work. Held authority, credential and pre-claim preparation are followed by fresh D1 checks.
7. Host claim consumes its live latch, validates the exact current task, protects the consumed receipt in the admitted effect and flushes it. After the flush it rereads host authority and invokes the bound product permit query. The permit checks the exact reserved effect/window/request digest plus current policy. The host then synchronously checks epoch, Stop, fence, uncertainty and deadlines without another awaited operation before acknowledgment. This final successful acknowledgment is the local irrevocable admission point. A supplied epoch matching a D1 row never substitutes for this check.
8. After acknowledgment the credential DO checks cancellation and its local credential revision synchronously, then starts reconstructed credential-bearing fetch without awaited preparation. Stop winning before acknowledgment gives zero fetches. Stop after acknowledgment cannot undo admitted work; late bounded product evidence remains associated with its original request. No transaction spans D1, runtime SQLite and provider I/O. This protocol does not claim distributed atomicity or exactly-once billing.
9. Three contract denials close the affected window and persist session review without deleting evidence. The exact capability invokes a short local host halt, fences admission and fails its own run before a cancellation-aware durability flush. It does not enter a public runtime command, provider lane or configuration lane. Already-admitted/uncertain effects remain tracked.

## Supported RPC and races

The existing eight runtime RPC increment tests still pass. The new 56 request Worker tests exercise the actual mandatory adapter, product Worker RPC entrypoint, credential SQLite DO and D1 schema. The live capability crosses the private Worker/DO RPC boundaries; the host's final product-permit callback crosses back through product RPC without re-entering a runtime command.

Fresh revocation is forced at each held authority, credential and pre-claim phase for eleven D1 mutations: foreign project owner, archived session, runtime owner/version, identity role/retirement/lifecycle/incarnation/controller, connection generation/revocation and model capability. All assert zero credential-bearing calls and unclaimed host receipts. Separate tests hold the actual host claim flush, revoke model capability or apply real epoch-first Stop, and assert zero fetch with retained consumed evidence. Stop before claim leaves the product reservation spent; Stop after acknowledgment retains one start and late completion evidence. Local credential revocation while preparation is held also denies before fetch, even without a D1 projection.

Concurrent identical requests produce one complete and one denied response, one consumption and one host claim. Window expiry during held preparation denies before claim/fetch. Generation 503 produces a separate second admitted attempt. Git metadata's failed attempt is not refunded. Custom summary success uses one fresh private claim, and known failure records one spent attempt and a failed run without automatic summary retry. Malformed/truncated/oversized upstream responses leave `outcome_unknown` evidence and do not redispatch.

Public API references consulted were Cloudflare RPC lifecycle documentation at `https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/` and SQLite DO storage at `https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/`. API feasibility is established here by actual local workerd tests, not a claim about hosted binding authentication or deployment.

## Request and stream observations

`constructed-snapshots.json` preserves exact constructed generation/custom-summary bodies, header names, validated frames and D1/host evidence from the passing candidate run. It contains synthetic data only and never credential header values.

The generation request is POST to the one fixed `.invalid` URL, protocol `ditto-synthetic-ndjson-1`, model `faux-1`, thinking `off`, purpose `generation`, maxTokens 4096 and semantic transcript containing the synthetic prompt. Headers sent are exactly accept, content-type and product-attached authorization. The custom-summary request uses purpose `custom_summary`, maxTokens 1024 and the accepted versioned summary policy prompt. It records two completed windows and two claimed effects, one generation and one summary. The Stop-after snapshot records one fetch, one complete product admission and a stopping host run, while the original host effect remains admitted for reconciliation.

Limits are 131072 encoded request/response bytes, 98304 transcript bytes, 128 frames, 16384 bytes per frame and 65536 output bytes. Strict NDJSON reconstruction rejects redirects, encodings, duplicate/unknown fields, malformed/truncated framing, excess output and split-frame credential echoes. Cancellation is finite even when stream cleanup never acknowledges. No original caller body/headers or upstream response headers are forwarded.

## Verification

Every final verification command used `env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true` in the execution worktree. The five aggregate gates ran sequentially, in the prescribed order. Their final logs have `-candidate.log` suffix under the artifact directory. Nine final behavioral/gate commands passed; no absent or zero-test suite is counted.

| Command | Actual candidate result |
| --- | --- |
| Web agent-models/request-contract/connection nearest suites | 45 passed across 3 files |
| Runtime models/effects/summary/preparation nearest suites | 224 passed: 42 models, 62 effects, 118 summary, 2 preparation |
| Unchanged advisor host probes | 4 passed |
| Original configuration-close probes | 4 passed, 114 unrelated summary cases excluded by the explicit filter |
| `pnpm contracts:verify` | typecheck, 16 tests, build passed |
| `pnpm brain:verify` | contracts 16; feasibility 3 passed/3 explicitly skipped; 43 brain tests; freshness/typecheck/build passed |
| `pnpm credentials:verify` | typecheck, 78 Worker tests including 56 new request cases, 3 standalone import/RPC/crash checks passed |
| `pnpm runtime:verify` | typecheck, 6 Node checks, 379 Worker tests across 12 files passed |
| `pnpm verify` | Biome, typecheck, 78 credential Worker plus 3 Node checks, 848 web tests, web build, 79 runner tests/typecheck/build passed |

`counts.json` provides machine-readable exact counts. Initial red logs and intermediate successful runs are preserved separately; they are not substituted for the candidate gates. `git diff --check` passes and `git diff --cached --stat` is empty. Repository verification retains lint warnings and route-generator test-file warnings. Installed workerd retains the inherited compatibility fallback from 2026-09-16 to 2026-03-10. No unhandled test errors were reported by the passing candidate suites.

## Remaining scope and review

Independent advisor review of the actual complete candidate diff, archive, SQL predicates and race evidence is mandatory before acceptance. Configuration intents/snapshots/default validation and their authenticated idempotency remain the next phase, not dropped from full 007. Prompt admission rollout, UI, retained workspace activation, live Codex discovery/transport, hosted deployment checks and PD38 are not enabled by this increment. PD38 is `not run`. No technical blocker remains for review of this requested synthetic phase.
