# 011 owned seeds and recovery artifacts

Disposition: DONE for the local fixture scope, accepted with limits after one rejected review round; see the acceptance section at the end. Base `c3d0c9b` on `feat/pi-durable`. Executed 2026-10-21 in a credential-free cloud container: Node 24.22.0, npm 12.0.2, pnpm 11.8.0, Docker 29.9.1.

## Refreshed design

The plan was written against `bcce03e`. It was refreshed against the integrated 008 to 010 code before coding:

- Project creation already runs through the authenticated owned `projects.create` procedure, which checks repository access before `buildProjectSeed`. No workspace session is created for it. That wiring is kept.
- `buildProjectSeed` already registered a separate `project_seed` identity with one `git_transport` window for the default branch. It took no execution capacity, and it marked the identity `destroyed` even when `sandbox.destroy()` failed.
- Archive bytes already moved between fixed sandbox paths and the product Worker's R2 binding through bounded streams with hash and length checks. The runtime Worker had no archive path at all.
- The runtime host owns epochs and executor generations but has no mutation-ownership concept yet. 012 publishes pairs, so this plan adds the recovery side and its ledger with the authority read injected; 012 binds it to the host.

## Implementation

| Part | Location |
|---|---|
| Shared archive policy and evidence: format and compatibility key, 1 GiB, 3 GiB and 70 percent ceilings, `ArchiveArtifactV1`, stable failure reasons | `packages/runtime-contracts/src/artifacts.ts`; `apps/web/src/lib/sandbox-archive.ts` imports the same constants |
| Recovery ledger: one exclusive mutation scope at a time, granted only while the workspace is quiescent; each suboperation admitted against the scope's epoch and executor generation, rechecked before dispatch, settled `completed`, `failed` or `unknown`; restart recovery | `apps/runtime/src/pi-durable-artifacts.ts` (`createRecoveryLedger`) |
| Workspace recovery: capture, restore, baseline branch sync and orphan cleanup, returning verified evidence or a classified failure; no publication or conversation activation | same file (`createWorkspaceRecovery`) |
| Narrow execution and storage adapters: fixed-path archive command, closed read-only Git for HEAD, temp-file digest check before the workspace is cleared, fixed-length R2 streams | same file (`sandboxArtifactExecution`, `r2ArtifactStore`) |
| Builder capacity and termination: slot taken before any container starts; released only after a successful destroy and retirement; otherwise held with a never-lapsing expiry before retirement is attempted. The drain cron retries destroy for builders that are retired but not `destroyed`, or unretired and older than 30 minutes | `apps/web/src/lib/project-seed.ts`, `apps/web/src/lib/workspace-runtime-capacity.ts`, `apps/web/src/lib/workspace-runtime.ts` |
| Builder role: a `project_seed` identity may only open or resolve its `git_transport` `project_seed_fetch` window; retirement without termination evidence leaves the identity `destroying` | `apps/web/src/lib/sandbox-authority.ts` |
| Archive command: optional `--expected-sha256` checked before extraction, link listing ambiguity and hard-link target checks, member type allowlist, extracted-tree validation; create measures disk on the archive's directory | `packages/sandbox-runner/src/archive-cli.ts` |

Recovery rules:

- Steps run one at a time inside a scope. `inspect` and `upload` are observations, `pack`, `discard` and `download` touch only the fixed temp file, and `extract` and `fetch` mutate the workspace.
- Once any workspace mutation was admitted in a scope, every later failure in that scope reports the workspace as `unusable`. A denial before a step runs reports the workspace unchanged only if nothing was mutated yet.
- A thrown or lost workspace mutation is `unknown`. It keeps the scope held, denies every later admission and scope, and survives restart. A lost observation or temp-file step is a known failure.
- Capture is verified only when the bytes stored in R2 match the packed archive's SHA-256 and length. The object key is created by the runtime and never reaches execution. A failed or interrupted upload is recorded with its key and deleted by cleanup.
- Restore refuses incompatible or oversized evidence before any step. It verifies the downloaded digest and length, extracts only after the temp file still matches, and compares the restored HEAD with the evidence. A failure after the workspace is cleared reports the workspace as `unusable`; a lost extraction reports `unknown`.
- Every step requires the scope's epoch and executor generation, no block, and continued quiescence. Capture, restore and sync recheck the scope once more before returning verified evidence; a stale capture marks its upload for cleanup.
- Branch sync admits the runtime step first, then asks product authority, then rechecks the runtime guard before any fetch. The product window is closed on every outcome. The Sandbox adapter's fetch stays unavailable until brokered Git is composed in the runtime.

## Checks

| Check | Result |
|---|---|
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-artifacts.test.ts` | passed, 25 tests, including the real R2 binding in miniflare; removing the upload, download or fetch recheck, the upload, download or extraction digest check, the mutation-to-unknown rule or the final capture recheck each fails a test |
| `node --test apps/runtime/src/pi-durable-imports.test.mjs` | passed, 5 tests, including: the tool module never imports recovery, and recovery imports only the shared contract |
| `pnpm --filter @ditto/web exec vitest run src/lib/project-seed.test.ts src/lib/sandbox-authority.test.ts src/lib/sandbox-authority.ownership.test.ts` | passed, 41 tests |
| `npm test --prefix packages/sandbox-runner -- src/archive.test.ts` | passed, 20 tests; the real-disk, ambiguous-symlink and digest-mismatch tests fail on the base code |
| Local Docker: `sh plans/evidence/artifacts/011/docker-seed-artifacts.sh ditto-sandbox:009 packages/sandbox-runner/dist <hostile-dir>` after `node plans/evidence/artifacts/011/hostile-archives.mjs <hostile-dir>` | passed; log in `artifacts/011/docker-seed-artifacts.log` |
| `pnpm contracts:verify`, `brain:verify`, `credentials:verify`, `runtime:verify`, `typecheck`, `runner:verify` | passed: contracts 54, brain 43 plus 3 recovery checks, credentials 230, runtime 442 plus 8 Node checks, runner 107 |
| `pnpm verify` | passed: credentials 230, web 869, runner 107 |
| `git diff --check` | clean |

Docker fixture results, on `ditto-sandbox:009` with the rebuilt runner `dist` copied in (Ubuntu 22.04, GNU tar 1.34, `--network none`):

- The builder captured a Git source fixture. `node_modules` was excluded and `.env` kept. The bytes copied out of the fixed temp path matched the packed SHA-256 and length. The builder container was removed and confirmed gone before the executor started, so only one fixture container was ever live.
- The executor restored the archive with the runtime's exact extract command. HEAD matched the builder, the symlink survived, and a stale file was removed.
- A partial temp file with the full digest stopped at the precheck and left the workspace untouched. A corrupt archive passed with its own digest failed in extraction and left the workspace empty, which the runtime reports as `unusable`.
- Traversal, absolute, escaping-symlink, ambiguous-symlink and device members were rejected before extraction. The hostile hard link was sanitized by GNU tar itself, passed the listing check, and failed during extraction with "Cannot hard link to 'etc/passwd'"; that case is credited to tar, not to the new validator. No file appeared outside the workspace.
- The fixture found a real defect: `archive-cli create` ran `df` on the archive path before the file existed, so archive creation always failed outside unit tests, which inject the disk reading. Fixed.

## Limits

- The recovery ledger is not yet wired into the runtime host. Epoch, executor generation, quiescence and block state are injected, and ordinary run admission does not consult the scope. 012 must bind it, and publication must recheck scope and epoch itself because `ArchiveArtifactV1` does not carry them.
- `mutated` is tracked per scope. A later scope can be acquired after a restore left the workspace `unusable`; a workspace-level unusable state must block capture once the module is wired.
- An `unknown` outcome blocks the workspace permanently. There is no reconcile or operator resolve path yet.
- Branch sync cannot run in production: the Sandbox adapter's `fetchBranch` always rejects until brokered Git is composed in the runtime. Only the order runtime admission, product authority, recheck, fetch is proven, with fixtures.
- Completed uploads whose evidence is never published are not cleaned; only failed or stale uploads are. Retention belongs to 012 and 017.
- The R2 adapter is tested in miniflare only. Stored bytes are verified by hashing the sent stream and the fixed length, not by asking R2 for a checksum.
- Builder capacity uses the legacy D1 lease pool, not 015's global accounting. Leases are not renewed during a build; a build longer than 20 minutes frees its slot while live. The termination sweep destroys any unretired builder older than 30 minutes, which ends a stuck build. If destroy fails and the hold write also fails, the original lease can lapse while the builder is live. Release does nothing after the capacity mode leaves `legacy`.
- The sweep's database filter is not exercised by a test; the test database ignores the `where` clause.
- Symlinks with absolute targets inside `/workspace` are captured but refused on restore.
- Archive listings are GNU tar text. Names containing a link separator are refused, and the extracted tree is walked again afterwards, but hostile hard-link targets are sanitized by tar rather than seen by the validator.
- No hosted Sandbox, live GitHub fetch, deployment or retained data was used. L4 is not complete; retained mutations stay blocked until 014 records full L4 acceptance.

## Acceptance

First independent review: REJECT. Three blocking findings:

1. A denial after extraction reported the workspace as `unchanged`. Now any failure after a workspace mutation was admitted in the scope reports `unusable`.
2. The archive command's own `digest_mismatch`, which happens after the workspace is cleared, was treated as untouched. The precheck now prints its own code, and only that one counts as untouched.
3. If retirement threw after a failed destroy, the builder's slot was never held and nothing retried it. The slot is now held before retirement, and the sweep also covers unretired builders older than 30 minutes.

The review also found quiescence was not rechecked, two key checks had no test, and a capture could return evidence after authority changed mid-upload. All were fixed with tests.

Second review of the fixes: ACCEPT WITH LIMITS, with no blocking findings. It asked for tests of the final restore recheck and of an inspection denial after extraction, both now added, and for branch authority denials to stop marking the workspace unusable, now marked untouched. Its remaining limits are listed above.
