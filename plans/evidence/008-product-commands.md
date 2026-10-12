# 008 execution preflight

Disposition: BLOCKED before implementation. The strict dependency preflight did not pass. Plan 008 and its index remain unchanged and not implemented. This record is not independent acceptance.

## Base and permitted scope

Disposable detached worktree: `/home/ayan/ditto-execution/plan-008-4WXvNW`.
HEAD: `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`.
Initial `git status --short` was empty. All execution commands explicitly changed to this worktree. The only written file is this evidence record. No product source, tests, configuration, manifest, lockfile, plan or index was changed.

Read the complete 008 plan and refresh, the complete authoritative runtime specification, root instructions and README, workspace/package configuration, and all six named 005/006/007 acceptance and integration records. Integrated 007 commits `5a33d81` and `3bdf90a` are ancestors of HEAD. Required storage, host-private, history test, credential DO, model adapter, host and credential request Worker test files are present. Predecessor acceptance remains historical evidence, not a baseline result for this execution.

## Exact dependency checks

Read-only commands checked `pwd`, `git rev-parse HEAD`, `git status --short`, `node --version`, launcher paths, explicit dependency paths, predecessor ancestry and `git diff --check`. No package manager was executed.

- Node is `v24.21.0`, at `/home/ayan/.vite-plus/js_runtime/node/24.21.0/bin/node`.
- `command -v pnpm` resolves to `/home/ayan/.nvm/versions/node/v24.14.1/bin/pnpm`. Its resolved target is Corepack's `dist/pnpm.js`, not an installed project test runner. Reading the shim shows download-prompt setup and delegation to Corepack. Corepack's installed package metadata reports `0.34.6`. No proof that this launcher will avoid automatic installation was established, so neither `pnpm --version` nor any pnpm gate was invoked.
- Installed npm metadata reports `12.0.2`. npm was not executed.
- Root package metadata requests pnpm `11.8.0`. Runtime metadata pins Pi Durable, Pi AI and Chord `1.0.1`, and Sandbox `0.12.3`. Installed project versions cannot be verified because project dependencies are absent. Manifests and lockfiles remain untouched.

The following paths are absent in this worktree:

```text
node_modules
apps/web/node_modules
apps/runtime/node_modules
apps/credential-tests/node_modules
node_modules/.bin/vitest
apps/web/node_modules/.bin/vitest
apps/runtime/node_modules/.bin/vitest
apps/credential-tests/node_modules/.bin/vitest
```

A bounded existence-only check also found no dependency directory at `/home/ayan/ditto-execution/node_modules`, the recorded 007 recovery worktree, or the recorded 005/006 execution worktrees. No usable already-prepared isolated environment was identified. No dependency content, credential file or environment file from the main checkout was read or copied. No install, repair, npx/dlx fallback, cleanup or dependency mutation occurred.

## Gates

| Gate | Status | Result |
| --- | --- | --- |
| Required plan/specification/predecessor reading and integrated file checks | passed | Named records read; prerequisite files present; 007 integration ancestors verified |
| Initial worktree and whitespace checks | passed | Clean initial status; `git diff --check` exit 0 |
| Dependency preflight | failed | No local project dependencies or Vitest runner; Corepack launcher noninstallation guarantee unestablished |
| Web baseline: session-command, session-command-delivery, session-runtime-ownership | not run | Blocked before launching Vitest |
| Runtime baseline: pi-durable-effects, pi-durable-models | not run | Blocked before launching Vitest |
| `credentials:verify` baseline | not run | Dependencies absent; pnpm not invoked |
| Ordered implementation stages 1 through 4 and their gates | not run | Strict stage-0 block; no implementation |
| Contracts, typecheck, brain, runtime and repository aggregate gates | not run | Strict stage-0 block |
| Live provider, hosted, Docker, browser and retained-data checks | not run | Outside authorization |

Tests collected: zero. Tests executed: zero. There is no test failure, timeout, workerd invocation or compatibility-date result from this execution. The first failure is the missing-dependency preflight, not a Pi feasibility failure. No A–E protocol decision was implemented and no cross-store handoff was introduced. Default product composition remains unavailable.

## Stop reason and resumption requirement

Stopped because the mandatory installed-runner prerequisite is missing. Resumption requires separate, narrowly scoped authorization to prepare dependencies only for this disposable worktree, preserving the pinned manifests and lockfiles and avoiding shared hook/dependency mutation, or provision of an explicitly identified already-prepared isolated environment. Main-checkout repair is not required or authorized. No authorization to deploy, use credentials, make provider requests or mutate retained/shared databases follows from preparing dependencies.

After that prerequisite is supplied, establish a noninstalling launcher and rerun all three credential-free baseline gates before any source change. Keep `.env.local` and platform credentials out of the test environment. The parent must independently review the eventual diff and rerun done criteria before any DONE status.

## Independent preflight review and authorized continuation

The advisor independently checked the detached worktree at `2487d56`. Its only untracked file was this evidence record, tracked and staged diffs were empty, and root, web, runtime, credential-test, runtime-contracts, session-brain and sandbox-runner dependency directories were absent. Main source and staging were unchanged. The preflight block is confirmed; no Pi feasibility failure or implementation acceptance is implied.

The user subsequently authorized locked dependency installation only in `/home/ayan/ditto-execution/plan-008-4WXvNW`, with install scripts disabled and manifests/lockfiles preserved, followed by resumed preflight and execution. The same executor was resumed with `openai/gpt-6.1-sol` and medium reasoning. Dependency preparation must use worktree-local HOME, caches and stores without touching main-checkout dependencies or shared hooks. It must not change dependency versions or release-age policy. The three baseline gates must pass before implementation.

Continuation is running. No installation, baseline or implementation result is claimed yet. No staging, commits, integration, deployment, live provider requests, shared database mutation or cleanup was authorized.
