# 004 encrypted storage evidence

Disposition: **candidate implementation, not accepted.** No DONE claim. Base `46bec8519ce7e5bd2cd9dd1880f71dbc20d21d17`. Worktree `/tmp/ditto-plan-004-vO7JVp`. Executor requested as xai/grok-4.7, Medium reasoning. 001, 002 and 003 are already accepted and integrated at this base. This file does not relabel those reviews.

## Confirmed 1.0.1 seam

Installed package version is 1.0.1. `package.json` exports `./testing`. `dist/testing/index.d.ts` exports `registerStorageConformance`. Public `Storage` methods used by the adapter are `commit`, `mintId`, `conversation`, `scanConversations`, `entry`, `findLatestHeadMarker`, `scanEntries`, `task`, `scanTasks`, `submission`, `scanSubmissions`, `submissionByRequest`, `findDocument`, `document`, `scanDocuments` and `close`. The researched 1.0.0 revision is not the authority. The seam exists, so execution did not stop and did not replace it with a homemade suite.

DO writes use `storage.transaction(async callback)`. SQL issued on `storage.sql` inside that callback joins the transaction. The adapter does not emit `BEGIN`, `COMMIT`, `ROLLBACK` or `SAVEPOINT`. `transactionSync` is not given an async callback. Asynchronous AES-GCM runs inside the supported async transaction, before the SQL writes of that same callback. A thrown callback rolls the SQL back.

## Record inventory

Format version is 1. Engine compatibility is `pi-durable-1.0.1`. Task compatibility is `pi-task-v1`. Tool compatibility is `pi-tool-v1`. Provider compatibility is `provider-request-v1`. Adapter compatibility is `ditto-encrypted-storage-1`. Crypto format remains `RUNTIME_CRYPTO_FORMAT_VERSION` 1. AAD binds owner, workspace session, record id and crypto format. Runtime keys are the retained keyring only. They are not authentication or project-credential keys.

Queryable structural columns:

- Conversation, entry, task, submission and document ids, owner edges, entry head, commit sequence.
- Task status, abort flag and background flag.
- Submission status.
- Document scope kind, owner id, family flag, created and retired sequences, revision sequence, revision kind and definition version.
- Indexed routing strings required by the public scan contract: task kind, submission request id, document kind and document key. These are JSON-encoded so lone surrogates stay lossless. They are not payload bodies.
- Host effect route columns `run`, `operation` and `task`. Expiry and reconcile filter on these columns when the retained binding is set. Ciphertext is not passed to `json_extract`.

Encrypted private payloads:

- Conversation, entry, task and submission `record` JSON, including checkpoints, model-visible messages, tool arguments and submission details.
- Document `record` JSON and every base or delta in `document_revisions.content`.
- Host `host_inbox.content`, `host_effects.evidence`, `host_effects.correlation`, `host_effects.retry_evidence`, and `host_tasks.selection` / `prepared` when selection is not the structural marker `pending`.

Future large reference, not accepted in 004: an object `{ kind: "external", version: 1, digest, byteCount, locator }` may appear only as an unresolved marker. The adapter rejects it and does not return truncated plaintext. 005 must prove content exists before a commit can adopt that reference. Payloads above the crypto maximum fail closed and write nothing.

Plaintext `fixtureDatabase` and stock `SqliteStorage` remain only when `HostFixtureDependencies.retained` is absent. That is the explicit L0/L1 fixture path. A database that already has retained metadata cannot be opened without the binding. A retained open of plaintext private rows fails closed. No in-place migration is claimed.

Passive open decrypts retained Pi rows and host private columns before `Harness.open`. A version, key, owner, session or integrity failure throws before the host is returned, so the caller cannot schedule that open.

Crash orderings stay on the original effect ids and the public Pi `Storage.commit` seam. There is no second transcript and no private scheduler. Safety-result persistence and Pi tool-result commit remain separate transactions.

## Verification

Candidate only. Not accepted. Commands ran from `/tmp/ditto-plan-004-vO7JVp` under `env -i`, `CI=1`, `NO_COLOR=1`, and `HOME=$PWD/node_modules/004-executor-logs/home`. No `.env` read, no live provider, no staging, no commit. Logs are under `node_modules/004-executor-logs/`.

| Command | Result |
|---|---|
| `pnpm --filter @ditto/runtime typecheck` | passed, exit 0. Both runtime typechecks. `typecheck.log` |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-storage.test.ts` | passed, exit 0, 27 tests in 1 file. 23 are the upstream conformance cases on real DO SQLite. `storage-second.log` |
| `pnpm --filter @ditto/runtime exec vitest run src/runtime-crypto.test.ts` | passed, exit 0, 5 tests. `crypto.log` |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-host.test.ts -t "encrypted adapter"` | passed, exit 0, 2 tests, 53 existing host tests skipped by the filter. `host-encrypted-2.log` |
| `pnpm runtime:verify` | passed, exit 0. Both typechecks, 6 Node checks, 150 Worker tests in 7 files, including 55 host tests, 40 effects tests, 27 storage tests and 5 crypto tests. `runtime-verify.log` |
| `pnpm verify` | passed, exit 0, after frozen install and `npm ci --prefix packages/sandbox-runner`. Biome reported 36 warnings and no errors. Web typecheck, 808 web tests in 72 files, web build, runner typecheck, 79 runner tests in 11 files, runner build. `verify-3.log` |
| Brain verification | not run. Shared brain inputs did not change |

Earlier failed logs are kept. `storage-first.log` failed one tamper update because a truncated ciphertext was not valid JSON. `host-encrypted.log` failed before scheduling because a six-way `UNION` exceeded the DO SQLite compound-select limit. `verify.log` failed Biome format. `verify-2.log` failed runner `tsc` before the runner's own `npm ci`. None of those failures were relabeled as passes.

Effective compatibility remains the installed fallback `2026-03-10` against requested `2026-09-16`. No September, hosted, or new Docker claim. Pi Durable, pi-ai and Chord remain 1.0.1. Worker pool remains 0.12.21. No lockfile or dependency version change.

## Limits

005 still has to prove exact document history and oversized content before L2 or full PD19 can pass. The external reference shape is rejected, not accepted. Benchmarks were not run. Product enablement, legacy import, R2 acceptance and deployment were not done. Plaintext `fixtureDatabase` remains only when `retained` is absent. This candidate does not claim advisor acceptance or DONE.
