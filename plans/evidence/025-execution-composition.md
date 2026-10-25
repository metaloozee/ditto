# 025 execution composition evidence

Base commit: `36ae7b4` (`feat/pi-durable`), uncommitted changes in worktree `plan-025`. Versions: `@cloudflare/sandbox` 0.12.3, vitest 3.2.7, Node as installed in WSL2 (see `node --version` during the run), local miniflare R2 binding `RECOVERY_ARTIFACTS`.

## Step 1 seam checks

- `exec(command, options)` in the 0.12.3 types accepts `timeout`, `env` and `signal` and returns `exitCode` and `stdout`: passed (`sandbox-BhIQBik-.d.ts`, `ExecOptions`/`BaseExecOptions`).
- `SandboxTransport` is `'http' | 'websocket' | 'rpc'` and `SandboxOptions.transport` accepts it: passed.
- `readFile(path, { encoding: 'none' })` is typed `Promise<ReadFileStreamResult>` with `content: ReadableStream<Uint8Array>`, rpc only: passed.
- `readFileStream` is SSE framed (not used).
- Baseline `pnpm --filter @ditto/runtime typecheck`: exit 0.

## Commands

| Check | Result |
|---|---|
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-execution.test.ts` | passed (5 tests) |
| checkpoints, restore, workspace-actions, retention, tools tests | passed (5 files, 65 tests) |
| `pnpm runtime:verify` | passed (24 files, 517 tests); the 026 conformance timeout did not appear |
| `pnpm credentials:verify` | combined run failed in `product-commands.worker.test.ts` (isolated-storage flake, different test each run). Each part passed alone: codex-credential-do 22, codex-request-contract 142, candidate-capacity 6, product-commands 96 (third run; first two runs failed on the flake), credential-tests typecheck, `crash.test.mjs` 3 |
| `pnpm typecheck` | passed |
| `pnpm check` | passed (exit 0; existing warnings) |
| `pnpm runner:verify` | passed (14 files, 122 tests including 8 `workspace-git` tests) |
| `npm test --prefix packages/sandbox-runner -- workspace-git.test.ts` | passed (8 tests) |
| diff of `pi-durable-product-session.ts` against `36ae7b4`, `grep -c 008-synthetic` | prints 1: the unchanged gate line appears once as diff context; no added or removed line contains it |
| Docker script `plans/evidence/artifacts/025/docker-workspace.sh` | passed on `ditto-sandbox:025r1` (exit 0, log in `plans/evidence/artifacts/025/docker-workspace.log`). The first build, `ditto-sandbox:025`, exposed a defect: `workspace-cli.js` printed nothing and exited 0 when called through the `/usr/local/bin/ditto-workspace` symlink, because its direct-run guard compared `argv[1]` without resolving symlinks. Fixed with `isDirectRun` (realpath comparison, unit-tested). The hardened script requires positive evidence per case and exits 1 against the old image. `ditto-exec` (009) and `ditto-archive` (011) were rerun on the old image and match their recorded logs, so they are unaffected |
| Provider, hosted and browser checks | not run |

## Execution tests

1. No tool reaches the sandbox before a baseline; after the test baseline `ditto-exec init` and `ditto-exec run` reach it.
2. Baseline publication writes archive and context objects to R2; `restorePair` reads them back and runs `restore` with the published digest.
3. `git_status` and `git_commit` answer from `ditto-workspace` output; the commit message appears in a `writeFile` and in no `exec` command.
4. `preview_start` is rejected and no preview command runs.
5. Retention: after baseline plus three boundary pairs and two periods, the first pair's objects are gone from R2 and the third pair's remain.

## Limits

- The baseline in tests uses a test-only `fetchBranch` and a fake branch authority, because brokered fetch stays unavailable.
- The sandbox is a scripted stub. No real Sandbox, container or Cloudflare service ran.
- The `credentials:verify` combined run was not green on this machine (known WSL storage flake).
- No product path calls `establishBaseline` and `sessionBranch()` returns `undefined`, so product Git actions stay unavailable until plan 029.
