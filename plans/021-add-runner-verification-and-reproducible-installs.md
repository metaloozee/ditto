# Plan 021: Add runner verification and reproducible installs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat bb00b96..HEAD -- package.json pnpm-workspace.yaml Dockerfile biome.json tsconfig.json sandbox/runner/package.json sandbox/runner/tsconfig.json sandbox/runner/index.ts src/lib/runner-protocol.ts
> git diff --stat -- package.json pnpm-workspace.yaml Dockerfile biome.json tsconfig.json sandbox/runner/package.json sandbox/runner/tsconfig.json sandbox/runner/index.ts src/lib/runner-protocol.ts
> ```
>
> This plan was written against commit `bb00b96` while the working tree already
> contained the post-plan-020 runner files. If either command shows changes,
> compare the "Current state" excerpts below against the live code before
> proceeding. If a cited excerpt no longer matches and the difference is not
> merely formatting, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/018-runner-contract-and-pi-sdk-runner.md, plans/019-broker-launches-pi-sdk-runner.md, plans/020-harden-runner-broker-path.md (all DONE)
- **Category**: tests / dx / dependencies
- **Planned at**: commit `bb00b96`, 2026-07-02

## Why this matters

Ditto's sandbox runner is now production-critical: the `WorkspaceSessionBroker`
launches `sandbox/runner/index.ts` inside the Cloudflare Sandbox container to
run the Pi SDK agent. Today that runner is not part of the normal repo
verification path. The root TypeScript config excludes `sandbox/runner`, the
runner's own `tsconfig` inherits that exclusion, Biome ignores the runner, and
Docker installs the runner's npm dependencies without a committed lockfile.

That means a broken runner can pass `pnpm exec tsc --noEmit`, `pnpm lint`, and
`pnpm test`, then fail only in the container. This plan makes the runner a
first-class checked artifact without changing agent behavior.

## Current state

Relevant files:

- `sandbox/runner/index.ts` — Node.js runner baked into the sandbox image; imports `@earendil-works/pi-coding-agent`, `typebox`, and `../../src/lib/runner-protocol`.
- `sandbox/runner/package.json` — runner-only npm package, currently no lockfile.
- `sandbox/runner/tsconfig.json` — intended runner typecheck config, but currently inherits root excludes.
- `Dockerfile` — installs runner dependencies in the image.
- `tsconfig.json` — root app typecheck intentionally excludes `sandbox/runner`.
- `biome.json` — Biome only includes `src`, `.vscode`, `index.html`, and `vite.config.ts`.
- `package.json` — root scripts do not check the runner.

Current excerpts:

```json
// tsconfig.json:1-4
{
  "include": ["**/*.ts", "**/*.tsx", "alchemy.run.ts", "types/**/*.ts"],
  "exclude": ["node_modules", "dist", ".alchemy", ".wrangler", "sandbox/runner"],
```

```json
// sandbox/runner/tsconfig.json:1-8
{
  "extends": "../../tsconfig.json",
  "include": ["./**/*.ts", "../../src/lib/runner-protocol.ts"],
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  }
}
```

`tsc --showConfig --project sandbox/runner/tsconfig.json` currently lists only
`../../src/lib/runner-protocol.ts` under `files`; it does not include
`sandbox/runner/index.ts` because the inherited root `exclude` still applies.

```json
// biome.json:8-17
"files": {
  "ignoreUnknown": false,
  "includes": [
    "**/src/**/*",
    "**/.vscode/**/*",
    "**/index.html",
    "**/vite.config.ts",
    "!**/src/routeTree.gen.ts",
    "!**/src/styles.css"
  ]
}
```

```json
// package.json:8-16
"scripts": {
  "dev": "alchemy dev",
  "build": "vite build",
  "preview": "vite preview",
  "test": "vitest run --passWithNoTests",
  "format": "biome format --write",
  "lint": "biome lint",
  "check": "biome check",
  "fix": "biome check --write",
```

```dockerfile
// Dockerfile:1-10
FROM docker.io/cloudflare/sandbox:0.12.1

RUN npm install -g --ignore-scripts tsx

WORKDIR /opt/ditto/sandbox/runner
COPY sandbox/runner/package.json ./
RUN npm install --omit=dev --ignore-scripts --package-lock=false

COPY sandbox/runner/ ./
COPY src/lib/runner-protocol.ts /opt/ditto/src/lib/runner-protocol.ts
```

```json
// sandbox/runner/package.json:1-8
{
  "private": true,
  "type": "module",
  "dependencies": {
    "@earendil-works/pi-coding-agent": "0.80.3",
    "typebox": "1.1.38"
  }
}
```

Repo conventions to match:

- TypeScript is strict (`strict`, `noUnusedLocals`, `noUnusedParameters`).
- Biome uses tabs and double quotes.
- Root source imports use `#/` aliases; the runner deliberately uses a relative import for `../../src/lib/runner-protocol` because it runs from `/opt/ditto/sandbox/runner` in the image.
- Existing commits use Conventional Commit style, e.g. `feat(runner): add ditto ndjson contract and pi sdk runner`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Root typecheck | `pnpm exec tsc --noEmit --pretty false` | exit 0 |
| Root lint | `pnpm lint` | exit 0; only the two pre-existing warnings in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85` |
| Root tests | `pnpm test` | exit 0; existing tests pass |
| Runner dependency install | `npm --prefix sandbox/runner ci --ignore-scripts` | exit 0 after `sandbox/runner/package-lock.json` exists |
| Runner typecheck | `pnpm runner:typecheck` | exit 0 and includes `sandbox/runner/index.ts` in the checked project |
| Whitespace | `git diff --check` | exit 0 |

## Scope

**In scope**:

- `package.json`
- `biome.json`
- `Dockerfile`
- `sandbox/runner/package.json`
- `sandbox/runner/package-lock.json` (create)
- `sandbox/runner/tsconfig.json`
- `sandbox/runner/index.ts` only if lint/typecheck reveals real issues in the runner
- `src/lib/runner-protocol.ts` only if lint/typecheck reveals issues caused by runner verification
- `plans/README.md`

**Out of scope**:

- Changing runner protocol semantics.
- Changing `WorkspaceSessionBroker` behavior.
- Changing Pi SDK model/provider behavior.
- Adding new runner features.
- Changing root app dependency versions except scripts/config needed for verification.

## Git workflow

- Branch: `advisor/021-runner-verification`
- Commit message style: Conventional Commits, e.g. `test(runner): add verification gates`
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Commit a reproducible runner install

From the repo root, generate an npm lockfile for the runner package:

```bash
npm --prefix sandbox/runner install --package-lock-only --ignore-scripts
```

Then update `Dockerfile` so Docker copies the lockfile and uses `npm ci`:

```dockerfile
WORKDIR /opt/ditto/sandbox/runner
COPY sandbox/runner/package*.json ./
RUN npm ci --omit=dev --ignore-scripts
```

Keep the existing `COPY sandbox/runner/ ./` and `COPY src/lib/runner-protocol.ts ...` lines after the dependency install. Do not change the base image or the global `tsx` install in this plan.

**Verify**:

```bash
npm --prefix sandbox/runner ci --ignore-scripts
```

Expected: exit 0, `sandbox/runner/node_modules` may be created but remains ignored by git.

### Step 2: Make the runner TypeScript project actually include the runner

Update `sandbox/runner/tsconfig.json` to override the inherited root exclude.
Add a top-level empty exclude:

```json
"exclude": []
```

The file should still extend `../../tsconfig.json`, include `./**/*.ts` and
`../../src/lib/runner-protocol.ts`, and set `types: ["node"]`.

Add root scripts in `package.json`:

```json
"runner:deps": "npm --prefix sandbox/runner ci --ignore-scripts",
"runner:typecheck": "pnpm runner:deps && tsc --project sandbox/runner/tsconfig.json --noEmit --pretty false"
```

Then update `check` to include the runner typecheck after Biome:

```json
"check": "biome check && pnpm runner:typecheck"
```

Do not change `pnpm test`; runner runtime smoke still requires sandbox credentials and remains manual.

**Verify**:

```bash
pnpm runner:typecheck
pnpm exec tsc --project sandbox/runner/tsconfig.json --noEmit --listFiles --pretty false | rg 'sandbox/runner/index.ts|src/lib/runner-protocol.ts'
```

Expected: first command exits 0. Second command prints both the runner file and
`src/lib/runner-protocol.ts`.

### Step 3: Include the runner in Biome lint/check

Update `biome.json` `files.includes` to include runner source while still
excluding generated/irrelevant files:

```json
"sandbox/runner/**/*.ts",
"!sandbox/runner/node_modules/**"
```

Keep `!**/src/routeTree.gen.ts` and `!**/src/styles.css` exclusions.

If Biome reports style issues in `sandbox/runner/index.ts`, fix only those
style/type issues. Do not change runner behavior.

**Verify**:

```bash
pnpm lint
pnpm check
```

Expected: `pnpm lint` exits 0 with only the two pre-existing warnings in
`grainient.tsx` and `sidebar.tsx`; `pnpm check` exits 0 and runs the runner
typecheck via the script added in Step 2.

### Step 4: Run the full verification baseline

Run:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm test
git diff --check
```

Expected: all exit 0. `pnpm test` should still pass the existing test suite.

### Step 5: Update the plan index verification notes

In `plans/README.md`, update this plan's status if you are the executor, and
add a note that after plan 021 the verification baseline includes:

```bash
pnpm runner:typecheck
```

If a reviewer told you they maintain the index, skip this step.

**Verify**:

```bash
rg "runner:typecheck|021" plans/README.md
```

Expected: both terms appear.

## Test plan

No new runtime tests are required. This plan adds verification coverage for
existing runner code.

Required checks:

- `pnpm runner:typecheck` includes and typechecks `sandbox/runner/index.ts`.
- `pnpm lint` processes runner files instead of ignoring them.
- `npm --prefix sandbox/runner ci --ignore-scripts` succeeds from the committed lockfile.
- Root `pnpm check` includes the runner typecheck.

## Done criteria

- [ ] `sandbox/runner/package-lock.json` exists and is committed.
- [ ] `Dockerfile` uses `COPY sandbox/runner/package*.json ./` and `npm ci --omit=dev --ignore-scripts`.
- [ ] `sandbox/runner/tsconfig.json` overrides inherited excludes so `sandbox/runner/index.ts` is typechecked.
- [ ] Root `package.json` has `runner:deps` and `runner:typecheck` scripts.
- [ ] `pnpm check` runs Biome and the runner typecheck.
- [ ] `biome.json` includes `sandbox/runner/**/*.ts`.
- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0.
- [ ] `pnpm runner:typecheck` exits 0.
- [ ] `pnpm lint` exits 0 with no new warnings.
- [ ] `pnpm test` exits 0.
- [ ] `git diff --check` exits 0.

## STOP conditions

Stop and report back if:

- `sandbox/runner/index.ts` no longer imports the Pi SDK or no longer exists.
- `npm --prefix sandbox/runner install --package-lock-only --ignore-scripts` changes dependency versions away from the pinned versions in `sandbox/runner/package.json`.
- Making the runner typecheck requires changing runner protocol behavior.
- Biome reports large unrelated formatting churn outside the in-scope files.
- The runner package cannot install without running lifecycle scripts.

## Maintenance notes

The runner is a separate Node.js program, not a Worker module. Keep its
verification explicit: root Worker typecheck should continue to exclude it, and
`sandbox/runner/tsconfig.json` should continue to typecheck it with Node types.
If future runner dependencies are added, update `sandbox/runner/package-lock.json`
and keep Docker on `npm ci` so image builds are reproducible.
