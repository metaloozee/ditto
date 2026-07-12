# Plan 011: Establish one clean repository verification baseline

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not suppress a failing check.
> Update this plan's row in `plans/README.md` when done unless a reviewer owns
> the index.
>
> **Drift check (run first)**:
> `git diff --stat 5ad5e0c..HEAD -- package.json pnpm-lock.yaml README.md Dockerfile src/lib/agent-git-jwt.ts src/lib/agent-git-jwt.test.ts sandbox/runner/package.json sandbox/runner/package-lock.json .github/workflows`
> Compare live code with the excerpts below if anything changed.

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx, tests
- **Planned at**: commit `5ad5e0c`, 2026-07-11
- **Execution**: DONE on `advisor/011-verification-baseline` @ `052774d` (2026-07-12)
- **Worktree**: `/home/ayan/.grok/worktrees/ayan-ditto/subagent-019f5519-b055-7251-9327-78f29a66bc78`

## Why this matters

`pnpm check` and both test suites pass, but the root TypeScript check fails and
the separately packaged runner is not installed or verified by the documented
root setup. There is no CI workflow and no single command that proves the
Worker, React app, and Docker-baked runner are mutually buildable. This plan
creates that baseline before riskier security, persistence, or streaming work.

## Current state

- Root `package.json:8-24` has `build`, `test`, and Biome commands, but no
  `typecheck`, `verify`, or runner commands. Root tests use
  `vitest run --passWithNoTests` even though 19 test files now exist.
- `src/lib/agent-git-jwt.ts:112-118` passes a
  `Uint8Array<ArrayBufferLike>` to `crypto.subtle.verify`; TypeScript 6 rejects
  it as a `BufferSource`.
- `sandbox/runner/package.json:8-12` has independent `build`, `test`, and
  `typecheck` scripts. Its lockfile is npm-owned; it is intentionally not a
  pnpm workspace package (decision recorded in plan 001).
- `README.md:19-29` tells developers only to run `pnpm install` and `pnpm dev`.
- There is no `.github/workflows/` directory.
- Match the existing Web Crypto normalization convention in
  `src/lib/crypto.ts:9-13`, which copies bytes into a fresh `ArrayBuffer`.
- Git history uses Conventional Commits, for example
  `fix(secrets): inject env vars via process env, block .env commits`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Root install | `pnpm install --frozen-lockfile` | exit 0 |
| Runner install | `npm ci --prefix sandbox/runner` | exit 0 |
| Root checks | `pnpm check && pnpm typecheck && pnpm test` | exit 0; no type errors; tests found |
| Runner checks | `npm run typecheck --prefix sandbox/runner && npm test --prefix sandbox/runner && npm run build --prefix sandbox/runner` | exit 0 |
| Full gate | `pnpm verify` | exit 0 |

## Scope

**In scope**:

- `package.json`, `pnpm-lock.yaml`
- `src/lib/agent-git-jwt.ts`, `src/lib/agent-git-jwt.test.ts`
- `sandbox/runner/package.json`, its lockfile only if metadata changes
- `README.md`, `Dockerfile` only to align documented/image Node requirements
- `.github/workflows/ci.yml` (create)
- `plans/README.md` status only

**Out of scope**:

- Changing the runner from npm to pnpm or adding it to a workspace.
- Upgrading TypeScript, Vitest, PI, TanStack, or other dependencies.
- Fixing unrelated lint/test failures by weakening rules or excluding files.
- Changing JWT behavior; plan 016 handles malformed-token behavior.

## Git workflow

- Branch: `advisor/011-verification-baseline`
- Suggested commit: `ci: enforce app and runner verification`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Repair the root TypeScript failure with no runtime change

Add a small local byte-copy helper in `agent-git-jwt.ts`, matching
`src/lib/crypto.ts:9-13`, and pass an `ArrayBuffer`-backed value to
`crypto.subtle.verify`. Add a regression assertion to the existing JWT tests;
do not rewrite JWT encoding or verification.

**Verify**: `pnpm exec tsc --noEmit && pnpm test -- src/lib/agent-git-jwt.test.ts`
-> exit 0 and focused tests pass.

### Step 2: Add explicit root and runner scripts

In root `package.json`:

- add `typecheck: "tsc --noEmit"`;
- remove `--passWithNoTests` from `test`;
- add `runner:install`, `runner:verify`, and an aggregate `verify` covering
  root check/typecheck/tests/build plus runner typecheck/tests/build;
- keep installation separate from `verify`, so verification never mutates the
  dependency graph.

Raise `sandbox/runner`'s Node engine floor from `>=22` to `>=22.19.0`, matching
both pinned PI 0.80.3 packages. Ensure the Docker base satisfies it; change the
base only if its live version is lower.

**Verify**: `npm ci --prefix sandbox/runner && pnpm verify` -> exit 0.

### Step 3: Document the two-package bootstrap

Update README install/development sections with the exact root and runner
install commands, when a runner change requires rebuilding the sandbox image,
and `pnpm verify` as the pre-PR gate. Preserve the documented npm isolation.

**Verify**: `rg -n "npm ci --prefix sandbox/runner|pnpm verify" README.md`
-> both commands appear.

### Step 4: Enforce the same gate in CI

Create `.github/workflows/ci.yml` using Node 22.19 or newer and the pnpm version
declared in `packageManager`. Install root with frozen pnpm lock, runner with
`npm ci`, then run `pnpm verify`. Cache pnpm/npm data, not `node_modules` or
build output. Give the workflow read-only repository permissions.

**Verify**: `pnpm verify && pnpm check` -> exit 0.

## Test plan

- Keep all existing JWT cases green after the byte normalization.
- Prove malformed valid-base64 signatures still return `bad_signature`.
- Run all 139 existing tests plus both builds through `pnpm verify`.
- Use `src/lib/agent-git-jwt.test.ts` as the Vitest style exemplar.

## Done criteria

- [ ] Fresh root + runner installs complete from documented commands.
- [ ] `pnpm verify` exits 0 and includes both packages plus builds.
- [ ] Root test discovery cannot silently pass with zero tests.
- [ ] CI runs the same gate with read-only permissions.
- [ ] No dependency/toolchain upgrade or workspace conversion was included.
- [ ] Only in-scope files changed; plan index status updated.

## STOP conditions

- Runner `npm ci` cannot resolve the pinned PI packages from its committed lock.
- Fixing typecheck requires weakening `strict`, `skipLibCheck`, or exclusions.
- The Docker image cannot support Node 22.19 without a platform migration.
- A build requires deployment credentials or mutates external resources; use
  the local Vite/TypeScript build only and report the blocker.

## Maintenance notes

Keep `pnpm verify` and CI identical. When the runner's lock, Docker image, or PI
SDK changes, review all three together. This plan intentionally leaves hook
behavior and dependency upgrades for separate work.

