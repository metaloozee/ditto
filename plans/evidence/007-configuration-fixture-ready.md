# 007 configuration fixture execution

Disposition: READY FOR REVIEW for the remaining fixture-backed configuration phase. This is not independent acceptance or full-plan completion. Full 007 remains NOT DONE. No integration, staging, commit, push, hosted activation or PD38 execution occurred.

## Source and preservation

Execution stayed in detached `/home/ayan/ditto-execution/plan-007-recovery`, HEAD `0ccc5b20c25a4e63017b3eebf6608dba62253479`. Main was read-only. The selected executor was `gpt-6.1-sol`, medium reasoning, without fallback.

Before edits, all 27 accepted product-correction source hashes matched. All six dependency graph hashes matched current files and HEAD. The baseline archive captures those 27 files plus the four inspected contract/client/server files. All 33 labeled original advisor artifacts remain unchanged. The accepted source archive retains SHA-256 `5a6ae89b8dd948b89b516ac073dc8dfba4fa052ce8a08281c0c378709127a436`. Earlier probes, configurations, archives, red logs and dirty source were preserved.

Artifacts are under [artifacts/007/configuration](artifacts/007/configuration/):

- `baseline.sha256`, `baseline.tar.gz`, `baseline.patch` and `baseline-status.txt` preserve the starting candidate.
- `increment-1.sha256`, `increment-1.tar.gz` and `increment-1.patch` preserve the first request-tested implementation. Its patch is relative to the accepted baseline.
- `increment-2.sha256`, `increment-2.tar.gz` and `increment-2.patch` preserve the completed implementation, including authenticated intent evidence, tamper checks, finite configuration contexts and default-denial coverage. Its patch is relative to increment 1.
- `source.sha256`, `source.tar.gz` and `source.patch` preserve all 34 candidate files and the complete configuration-only change relative to the accepted baseline. The archive SHA-256 is `782495f72e34ee81b546ccfbef72c5e091cced8b71dd41431fdb8efe2b19e442`. The patch SHA-256 is `3fdaa236eba5005a898e50a484ada592fa340801189a9a682acd1199aad2d1e1`.
- `archive-verification.txt`, `source-verification.log`, `graph-verification.log`, `preservation-verification.txt` and `final-preservation.txt` record archive/source/graph and original-artifact checks.
- `counts.json`, `toolchain.txt` and `request-snapshots.json` retain exact gate counts, environment and actual captured request/configuration/admission snapshots.

`packages/runtime-contracts/src/runtime.ts` and `command.ts` remain byte-identical to the baseline. The readiness-only `modelConfiguration()` semantics remain unchanged. Existing package scripts already discover the new contract suite and run the expanded existing credential-request suite. No manifest or lockfile change was needed.

## Implemented boundaries

`packages/runtime-contracts/src/configuration.ts` defines strict bounded configuration intents, reads, acknowledgments, snapshots and private authority replies. Unknown fields, duplicate JSON fields, oversized identifiers, invalid versions and unsupported values reject. Applied acknowledgments require a selected snapshot; denials/conflicts/unavailable/unknown outcomes cannot carry one. Canonical SHA-256 identity scopes the intent key to authenticated owner, project, session, owner version and intent ID. A separate canonical payload digest distinguishes model/thinking payloads.

`ModelProductAuthority.ownedConfiguration()` is a separate actual D1 owned-session policy. It checks the current user/project/session relationship and status, trusted runtime owner version, exact identity role/controller/incarnation/lifecycle, retirement and deletion fences. It does not require or fabricate prompt/run membership. New selections also check the current synthetic connection generation and capability revision/model/thinking. Reads and already-stored receipts do not acquire new model entitlement.

The private Worker RPC fixture binds the authenticated subject in deployment-owned `FixtureProduct` methods, including a separately bound second session. Request fields cannot provide a user or identity permit. Selection checks also read the actual credential DO safe connection status before D1 authorization. Production product/runtime configuration stays unavailable; public fixture fetch remains 404. No token or key enters the runtime.

`PiDurableHost.configureOwned()` uses the existing owner queue, without calling public `configure()` recursively. An owned host rejects raw fixture configuration. The configuration lane has finite contexts using the existing synthetic transport deadline and joins host cancellation/close. It rechecks product and local authority around asynchronous identity/encryption/persistence preparation, and applies accepted values through supported Pi `root.configure()`. Configuration can change during tracked in-flight model work but grants no effect admission. The original effect/admission/result validation code remains in force.

The runtime persists a pending intent before changing Pi and a completed outcome only after Pi durability and a persisted-state snapshot. Retained evidence encrypts the original strict intent, acknowledgment and pending/complete phase. Recomputed identity/payload hashes and the encrypted phase authenticate the queryable metadata. Tampered ciphertext, payload digest or phase rejects. D1 never stores a second selected-model authority.

The supported Pi and host commits are separate. Reopen observes Pi instead of replaying pending configuration. An exact persisted match completes the original acknowledgment; a mismatch becomes a durable `outcome_unknown`. A pending intent prevents a later selection in that live owner until reopen accounts for it. Once accounted for, an explicit newer intent may select another value. A duplicate of the older intent returns its original outcome and never rolls back the newer selection. Snapshots read persisted Pi agent state, not the intent ledger.

First owned initialization validates the explicit default before calling supported `Harness.root(context, { agent })`. Rejected defaults leave zero Pi conversations. The default policy works with all prompt/run membership records removed. Standalone explicit synthetic fixtures retain their previous initialization path.

## Acceptance evidence

The actual `codex-request-contract.worker.test.ts` suite now has 114 passing tests: the original 64 plus 50 configuration cases. These compose real local Worker RPC, D1, Pi host/SQLite, the mandatory private adapter and credential DO. Every transport uses the mocked fixed `.invalid` destination with other networking disabled.

| Requirement | Executed evidence |
| --- | --- |
| Strict contracts and scoped canonical identity | Nine new registered contract tests, including reordered payload equality, owner/session separation, changed-payload identity, malformed/duplicate fields and strict snapshots/acknowledgments. |
| Exact ownership/version/identity/lifecycle | Fourteen actual D1 configuration denial cases cover foreign user/project, archived/deleting targets, owner-version mismatch, stale incarnation, wrong role, retirement, lifecycle, revoked/disconnected connection and stale connection/capability generations. Actual persisted Pi table fingerprints stay unchanged and fetch count is zero. Caller-supplied user IDs and foreign query scopes separately reject. |
| Fresh capability validation | Unavailable/revoked accounts and unsupported model/thinking selections deny with unchanged persisted Pi fingerprints and zero fetches. Actual local credential revocation also denies new selection. |
| Duplicate/conflict/lost acknowledgment | Concurrent identical intents return exactly equal original acknowledgments; changed payload conflicts. A concurrent changed payload has one durable winner. Older duplicates after newer selections, including close/reopen, do not reapply. Reads after connection revocation remain usable, and duplicate receipts do not acquire new entitlement. |
| Crash and encrypted recovery | Plaintext and encrypted fixtures interrupt after pending-intent durability, Pi-configuration durability and completed-outcome durability. Reopen returns applied or unknown according to persisted Pi evidence; an older duplicate after a newer choice cannot roll back. Retained outcomes contain no plaintext selection fields. Three tamper cases check ciphertext, phase and payload digest without changing Pi or fetching. |
| Held authority | Actual D1-backed Worker RPC results are held while capability revision is revoked. Separately, host authority results are held while local authority is revoked. Configuration denies with unchanged Pi state and zero fetches. Held configuration authority is canceled by actual host close; the owner lane joins before reopen. |
| Session isolation | Two actual D1-owned sessions, distinct identities/DOs and separately deployment-bound RPC subject contexts retain different Pi choices. Foreign session intents deny. |
| First defaults | With command/run memberships removed, valid defaults create exactly one owned conversation. Unsupported model/thinking, unavailable/revoked account and disconnected credential defaults create zero conversations and fetch zero times. A valid default followed by entitlement revocation at actual request admission dispatches zero requests. |
| Actual preparation and requests | Captured credential-owned bodies show selected faux-2/low generation; an in-flight prepared faux-1/off request stays unchanged while the next custom summary uses faux-2/low. A queued follow-up uses the new selection at preparation, not acceptance. A separately admitted retry uses its new preparation-time selection and retains nonrefundable per-attempt accounting. |
| Prepared close/reopen retention | Actual mandatory-adapter generation and custom-summary preparation are held before admission in encrypted fixtures. Selection changes, the host closes/reopens, and outgoing requests retain the original faux-1/off preparation. Current configuration remains faux-2/low. `request-snapshots.json` contains the actual captured metadata and admission/window records. |
| Existing safety and summary policy | All original preparation, effects, summary, credential, model, import/auth-boundary and repository suites pass. The existing one-attempt summary crash/result-reuse/accounting matrix and four unchanged configuration-close regressions remain intact. All nine unchanged advisor probes pass. |

The supported API evidence is the pinned 1.0.1 public `Harness.root(..., { agent })`, `conversation()`, `agent()` and `root.configure()` implementations and actual Worker tests. No private scheduler patch, fork or second continuation engine was used.

## Verification

All commands ran in the execution worktree with `env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true`. Test deadlines and probe sources/configurations were unchanged. No zero-test result is counted as passing.

Nearest checks passed: contracts 25, credential request Worker 114, runtime models/effects/summary/preparation 232, and web model/request/connection policy 45. The original advisor probes pass 4 + 3 + 2. The final D1 probe command uses the unchanged config with `-t '^advisor:'`, yielding two passes and 114 explicitly filtered skips. The final configuration-close run yields four passes and 114 explicitly filtered skips.

The required gates then ran sequentially, not concurrently:

| Gate | Result and retained log |
| --- | --- |
| `contracts:verify` | 25 tests, typecheck and build passed, `contracts.log`. |
| `brain:verify` | Contracts 25, freshness 3 with 3 explicit filtered skips, brain 43; typechecks and builds passed, `brain.log`. |
| `credentials:verify` | 136 Worker tests and 3 Node checks, typecheck passed, `credentials.log`. |
| `runtime:verify` | 387 Worker tests and 6 Node checks; both typechecks passed, `runtime.log`. |
| `verify` | 848 web, 79 runner, 136 credential Worker tests and 3 Node checks; formatting, typechecks and builds passed, `repository.log`. |

Whitespace checks pass and staging is empty. The final source/archive/graph checks pass after verification.

Earlier failing implementation test runs remain preserved. They exposed missing foreign fixture rows, a settlement observation that needed the supported `waitIdle()` call, an incorrect follow-up D1 shape, misuse of the fixture revoke method, cross-DO I/O in a nested isolation assertion, and an incorrect expectation that a newly prepared retry would keep the previous model. None of the original assertions or deadlines was weakened. The final tests distinguish retained preparation from a new retry preparation.

One extra final advisor rerun omitted the name filter and imported the entire expanded request suite. Its 180-second shell allowance expired before a complete verdict. `advisor-d1-final.log` is preserved and is not counted as a pass. No matching verification process remained. The unchanged two advisor cases were rerun with the explicit name filter and passed in `advisor-d1-final-rerun.log`. The complete expanded request suite had already passed independently in the nearest run and both required full gates.

## Remaining limits

This is injected deployment-owned fixture authentication, not cookie authentication, live account discovery or hosted service-binding validation. Production configuration/discovery/transport remains unavailable. No real subscription/model/billing fallback, UI, 008 rollout, retained-workspace activation, deployment, shared database operation or dependency repair/upgrade occurred. PD38 remains `not run`.

Product authority, local runtime state and Pi commits do not form a distributed transaction. A configuration acknowledgment may be lost. Pending evidence is observed on reopen, never silently replayed. Unknown configuration outcomes require an explicit new intent rather than retrying the old selection as new work. Provider admission retains its independent checks and the previously accepted nonrefundable/uncertain accounting rules. No exactly-once provider billing claim is made.

Independent advisor review and the full-plan disposition remain unfinished. Source is uncommitted and unintegrated.
