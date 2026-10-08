# 006 implementation execution

Status: implementation candidate awaiting independent advisor review. No advisor acceptance, DONE transition or branch integration is claimed.

Worktree: `/tmp/ditto-plan-006-o6dok7`, detached at `ef172efdfdc575247e39a953ed1b6f74c0d8cead`. All implementation and evidence changes remain uncommitted there. The executor read plan 006, the complete authoritative runtime specification, predecessor integration evidence, product ownership/authentication/crypto/composition code and pinned provider implementation. No nested agents were launched.

## Result and limits

The candidate implements the fixture-only portion of 006. [The provider contract](006-codex-contract.md) separates official documentation, pinned-source observations, local tests and missing external support. Hosted Ditto authentication is unresolved, so connect stays unavailable and no callback/device/token-upload route was added. Production token installation and renewal are disabled. PD38 is `not run`.

Product code owns one SQLite credential DO per user, a separate AEAD keyring, bounded D1 status/revocation projection, authenticated status/disconnect operations and the fixture renewal state machine. It does not change GitHub sign-in or introduce runtime subscription/key bindings, builder authority, UI, plan 007 model requests, an API-billing fallback or a second agent engine.

Observable local guarantees:

- Missing authentication and caller-supplied owner/role/callback data cannot reach credential operations. These are injected-auth handler tests, not real-cookie HTTP coverage.
- Real disposable D1 and DO SQLite hold only a non-secret projection and encrypted token record respectively. Ciphertext tampering, wrong owner/generation, missing keys and unsupported envelope versions fail closed. Historical keys work and renewal encrypts replacements with the current key.
- Two simulated workspace requests share one persisted renewal attempt. Only one fixture fetch occurs. The second sees renewing. Rotated tokens replace the previous token set atomically.
- D1 revocation commits before DO delivery. If delivery fails, the product fence still denies requests. The DO's revoked generation separately denies requests even if D1 remains stale, and retains a tombstone even if initial credential installation never completed.
- A late refresh cannot overwrite reconnect, clear revocation or recreate a deleted user/projection. Projection updates are update-only and version/generation fenced.
- Ambiguous provider failure and interruption after rotation require reconnect. Actual workerd `ctx.abort` after the fixture's upstream rotation survives two reactivations with no blind redispatch. A successfully committed replacement survives a later abort without another rotation.
- Production RPC cannot access JavaScript-private keyring/storage methods or turn on fixture installation. The credential bundle imports neither Pi nor Sandbox. Runtime source/binding checks forbid credential access.

No live credential, authentication, renewal, model-discovery or inference call ran. No existing-environment migration, Alchemy dev/deploy, reset, stage, commit, push, merge or worktree deletion ran. The generated migration was exercised only against disposable test D1.

## Changed files

Product source and composition:

- `alchemy.run.ts`
- `apps/web/src/server.ts`
- `apps/web/src/lib/codex-credential-crypto.ts`
- `apps/web/src/lib/codex-credential-do.ts`
- `apps/web/src/lib/codex-connection.ts`
- `apps/web/src/lib/codex-connection-product.ts`
- `apps/web/src/lib/codex-connection.functions.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/migrations/0021_first_lilandra.sql`
- `apps/web/migrations/meta/0021_snapshot.json`
- `apps/web/migrations/meta/_journal.json`

Tests and verification:

- `apps/web/src/lib/codex-connection.test.ts`
- `apps/web/src/server.test.ts`
- `apps/runtime/src/forbidden-bindings.type-test.ts`
- `apps/runtime/src/forbidden-import-graph.test.ts`
- `apps/credential-tests/package.json`
- `apps/credential-tests/tsconfig.json`
- `apps/credential-tests/vitest.config.ts`
- `apps/credential-tests/src/entry.ts`
- `apps/credential-tests/src/sql.d.ts`
- `apps/credential-tests/src/codex-credential-do.worker.test.ts`
- `apps/credential-tests/crash.test.mjs`
- `package.json`
- `pnpm-lock.yaml`

Evidence:

- `plans/evidence/006-codex-contract.md`
- `plans/evidence/006-execution.md`
- `plans/evidence/006-runtime-verify.log`
- `plans/evidence/006-runtime-verify-concurrent.log`
- `plans/evidence/006-verify-initial.log`
- `plans/evidence/006-verify.log`

The plan and its status were not edited. The existing Sandbox `v1` migration is preserved; credential SQLite has a new `v2` tag. Alchemy remains the deployment owner.

## Preparation and toolchain

Node `v24.21.0`, pnpm `11.8.0`. Web retains locked Vitest `4.1.10`; accepted runtime and new isolated product tests use Vitest `3.2.7`. The new product package pins Workers pool `0.12.21`, Miniflare `4.20260310.0`, esbuild `0.27.3` and TypeScript `5.9.3`. Its effective compatibility date is `2026-03-10`, supported by that workerd build. This is not hosted-date validation.

Public registry compatibility check:

```sh
npm view @cloudflare/vitest-pool-workers@0.12.21 peerDependencies --json
```

It returned Vitest/runner/snapshot support only through 3.2.x, so a web Vitest-4 pool config was not added. Exact replacement for the plan's illustrative web Workers command:

```sh
pnpm --filter @ditto/credential-tests exec vitest run src/codex-credential-do.worker.test.ts
```

Preparation inside this worktree:

```sh
pnpm install --frozen-lockfile
pnpm install --ignore-scripts
pnpm --filter @ditto/web db:generate
npm ci --prefix packages/sandbox-runner --ignore-scripts
```

The migration command generated artifacts only. No migration application command ran. Dependency resolution reused existing package versions but normalized some pre-existing peer/transitive snapshots, including esbuild/undici and optional metadata; this appears in the lockfile diff. Web Vitest was not upgraded. Runner audit reported 9 inherited vulnerabilities; no audit repair was attempted.

Preparation caution: the initial frozen pnpm install ran the inherited Lefthook postinstall and reported hook synchronization. Git hook storage is shared with the main repository. There is no pre-install hook-byte baseline, so this evidence cannot certify that shared hook bytes were untouched. No tracked main-checkout source was intentionally edited, and no hook, stage or commit was invoked. Later explicit installs used `--ignore-scripts`. This incidental hook synchronization should be reviewed by the parent/advisor rather than silently repaired outside the permitted worktree.

Final verification removed inherited environment variables with `env -i`, kept only PATH, an isolated HOME under this worktree's ignored `node_modules`, and CI. It did not read private environment/credential files. Switching back to inherited HOME once caused pnpm's module-status check to request a reinstall and abort for lack of TTY; subsequent checks consistently used the isolated environment.

## Exact checks and results

All commands ran from the disposable worktree. Final aggregate commands:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm runtime:verify
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm verify
```

| Check | Result |
|---|---|
| `pnpm --filter @ditto/web typecheck` | passed |
| `pnpm --filter @ditto/web exec vitest run src/lib/codex-connection.test.ts` | passed, 7 tests |
| `pnpm --filter @ditto/web exec vitest run src/server.test.ts src/lib/codex-connection.test.ts` | passed, 18 tests |
| `pnpm --filter @ditto/credential-tests typecheck` | passed |
| isolated product Workers command above | passed, 17 tests, actual SQLite/workerd |
| `pnpm --filter @ditto/credential-tests exec node --test crash.test.mjs` | passed, 3 tests, including separate real workerd abort/RPC probes |
| `pnpm credentials:verify` | passed; wired into `pnpm verify` |
| `pnpm runtime:verify` | passed, both typechecks, 208 Worker tests, 6 Node tests |
| `pnpm verify` | passed, repository check/typecheck, 17 credential Worker tests, 3 credential Node tests, 815 web tests, web build, runner typecheck, 79 runner tests and runner build |
| `git diff --check` | passed |
| PD38, hosted auth/discovery/networking/eviction/billing | not run, no approval or supported Ditto hosted contract |

No zero-test pass was counted. Final aggregate logs are [runtime verification](006-runtime-verify.log) and [repository verification](006-verify.log).

The initial repository run failed because `server.test.ts` mocked WorkerEntrypoint but not the newly imported DurableObject base. The mock was extended without replacing the routing assertions. [The initial failed run](006-verify-initial.log) is preserved and is not acceptance evidence.

Fixture development also caught a mock-runtime restriction: the pinned fetch mock rejects `redirect: "error"`. The test-only transport now uses manual redirects and rejects non-OK responses without following them. No production provider transport exists. An attempted pool-based `ctx.abort` probe produced unhandled reset events, so the actual-abort probe runs in standalone Miniflare instead of suppressing runner errors. Temporary debug instrumentation was removed.

Running the two aggregate suites concurrently caused one inherited runtime assertion to fail: `denies adversarial capacity before dispatch` expected `Executor generation/capacity` but received `Host admission denied`. The failed run is preserved in `006-runtime-verify-concurrent.log`. A subsequent standalone `pnpm runtime:verify` passed all 208 Worker and 6 Node tests. No runtime timing assertion or implementation was changed to hide this failure. Advisor review should keep this timing-sensitive observation separate from the new credential tests.

Repository check still reports inherited warnings, and web routing/build reports inherited warning messages. Final process exit codes are zero. Local fixture success does not prove provider permission, OAuth correctness, account model capability or hosted readiness.

Independent advisor review is the next step. Keep this worktree and every uncommitted change intact for diff/test review; no branch integration is authorized.
