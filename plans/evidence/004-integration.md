# 004 branch integration

The user explicitly authorized integrating the accepted 004 core into `feat/pi-durable`, committing dirty plan and evidence work first, and deleting the named execution worktree plus its temporary branch. This is separate from acceptance, which authorized neither commits nor cleanup. No push, pull request, deployment, dependency install or main-checkout repair was authorized.

## Integrated source

Source commit: `5173e12ccdf70db072adaced80c91b6cf57f9dc6` (`feat(runtime): encrypt durable Pi storage`). Its parent is the reviewed base `46bec8519ce7e5bd2cd9dd1880f71dbc20d21d17`.

Acceptance documentation commit: `9433382d5c4a128f125067204437e33189079f31` (`docs(plans): accept encrypted storage core`).

Worktree evidence commit: `e125e455960f948b5038d6ccc14ff98808994be2` (`docs(plans): record storage core evidence`).

Merge commit: `3d45bb02dbc0a48531fdfe9eb8fb0c239ad6dd0e` (`feat(runtime): merge encrypted storage`). Parents are the acceptance documentation commit and the worktree evidence commit. The merge was `--no-ff`. History was not rebased or rewritten.

Only these runtime files changed from the reviewed base:

- `apps/runtime/src/pi-durable-storage.ts`
- `apps/runtime/src/host-private.ts`
- `apps/runtime/src/pi-durable-host.ts`
- `apps/runtime/src/pi-durable-storage.test.ts`
- `apps/runtime/src/pi-durable-encrypted-corrections.test.ts`
- `apps/runtime/src/pi-durable-effects.test.ts`
- `apps/runtime/src/pi-durable-host.test.ts`
- `apps/runtime/vitest.config.ts`

Before the source commit and again after the merge, SHA-256 hashes for all eight files matched [`artifacts/004/accepted-core-source.sha256`](artifacts/004/accepted-core-source.sha256). `git diff --check` passed on the clean merged tree. Commit hooks were disabled for these commits because the configured hook runs `npm run format` and `npm run fix` on staged TypeScript. No formatter, install, build or test ran in the main checkout. Application source was not edited during integration.

## Verification and preserved evidence

No implementation changes were made during integration. Full test gates were not rerun here. The integrated bytes are the independently reviewed candidate. Accepted results remain 182 Worker tests and 6 Node checks under `pnpm runtime:verify`, 808 web and 79 runner tests under `pnpm verify`, 31 additional encrypted L1 cases, 2 counter probes, 6 host probes, 1 complete-apply rollback probe and 3 prior storage probes. Those results are prior worktree evidence, not new main-checkout runs. Integration does not complete L2, hosted execution or product enablement.

Worktree dirty plans and ignored `node_modules/004-*` baselines, logs and evidence were archived before reconciliation. CLI `home` caches and `.env` paths were excluded. Existing candidate archives were not overwritten.

Archive: [`artifacts/004/integration-worktree-evidence.tar.gz`](artifacts/004/integration-worktree-evidence.tar.gz).

SHA-256: `aefaca30388812378998f191b3b0f34e74fdd3b560b8402d034a39ef673f9400`.

`gzip -t` passed. The accepted candidate archive remains `c9891d84d01b899030ac7ed2b0561b63850c26d4746bc14d5a2f8c911819b5da`. Its diff remains `4a5e61433738e3053749818e4523f079f1802b74fa7c394039eccd5961185ca9`. The second-correction archive remains `3a62fae8501540481c7a3dbeb95531a4acf643dc2f9e671dad3111a2a0239fc4`.

Overlapping plan and review text was copied from the committed main versions before the worktree evidence commit. Worktree-only probes were kept and merged. Historical reviews still say the source was not integrated at the time of review. Main dependency repair remains unapproved.

## Cleanup and next step

`git worktree remove --force /tmp/ditto-plan-004-vO7JVp` completed. The path is absent. `git worktree list` shows only `/home/ayan/ditto` on `feat/pi-durable`. `--force` was required because ignored dependency directories remained; every nonignored worktree file was already committed and merged, and the worktree evidence archive existed.

`git branch -d work/plan-004-encrypted-storage` deleted the temporary branch at `e125e45`. `brain`, `feat/pi-durable` and both existing stashes were not modified. Nothing was pushed.

005 awaits a brief refresh and separate execution. It is not accepted. Complete L2 remains pending. No push, pull request, deployment, data reset, live provider request or credential read occurred.
