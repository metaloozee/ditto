# Plan 006: Restore Yarn lockfile handling in sandbox bootstrap

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in STOP conditions occurs, stop and report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 14c1189..HEAD -- src/lib/sandbox-bootstrap.ts`
> If the file changed since this plan was written, compare the excerpts below against live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `14c1189`, 2026-06-25

## Why this matters

The uncommitted bootstrap change added a Corepack/npm fallback path for pnpm, but accidentally removed the existing `yarn.lock` branch. GitHub imports for Yarn projects will now run `npm install`, which can ignore or rewrite the intended dependency graph. Restoring Yarn handling preserves package-manager selection by lockfile.

## Current state

Relevant file:
- `src/lib/sandbox-bootstrap.ts` — clones a GitHub repo into a Cloudflare sandbox, writes env vars, and installs dependencies.

Current excerpts:

`src/lib/sandbox-bootstrap.ts:62-91`
```ts
async function installWithNpmFallback(
	sandbox: ReturnType<typeof getSandbox>,
	preferredCommand: string,
	installCommand: string,
	errorPrefix: string,
) {
	if (!(await commandExists(sandbox, preferredCommand))) {
		if (await commandExists(sandbox, "corepack")) {
			await runCommand(sandbox, "corepack enable", {
				cwd: WORKSPACE_PATH,
				timeout: INSTALL_TIMEOUT_MS,
				errorPrefix: `Failed to enable Corepack for ${preferredCommand}`,
			});
		}
	}

	if (await commandExists(sandbox, preferredCommand)) {
		await runCommand(sandbox, installCommand, {
			cwd: WORKSPACE_PATH,
			timeout: INSTALL_TIMEOUT_MS,
			errorPrefix,
		});
		return;
	}

	await runCommand(sandbox, "npm install", {
		cwd: WORKSPACE_PATH,
		timeout: INSTALL_TIMEOUT_MS,
		errorPrefix: `Failed to install dependencies with npm fallback for ${preferredCommand}`,
	});
}
```

`src/lib/sandbox-bootstrap.ts:102-117`
```ts
const hasPnpmLock = await sandbox.exists(`${WORKSPACE_PATH}/pnpm-lock.yaml`);
if (hasPnpmLock.exists) {
	await installWithNpmFallback(
		sandbox,
		"pnpm",
		"pnpm install --no-frozen-lockfile",
		"Failed to install dependencies with pnpm",
	);
	return;
}

await runCommand(sandbox, "npm install", {
	cwd: WORKSPACE_PATH,
	timeout: INSTALL_TIMEOUT_MS,
	errorPrefix: "Failed to install dependencies with npm",
});
```

Repo conventions:
- Helper functions are small and local to the module.
- Shell arguments must be quoted through `quoteShellArg` where dynamic input is included.
- `runCommand` centralizes sandbox command failure messages.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | no errors from `sandbox-bootstrap.ts` |
| Lint | `pnpm lint` | no warnings from `sandbox-bootstrap.ts` |
| Tests | `pnpm test` | exit 0 |

## Scope

**In scope**:
- `src/lib/sandbox-bootstrap.ts`

**Out of scope**:
- Cloudflare sandbox API changes.
- Git clone/auth behavior.
- package-lock/npm fallback behavior for repos without pnpm/yarn locks.
- Lockfile/package dependency updates.

## Steps

### Step 1: Restore Yarn lock detection

In `installDependencies`, after the `pnpm-lock.yaml` branch and before the final npm fallback, add a `yarn.lock` branch:

- Check `await sandbox.exists(`${WORKSPACE_PATH}/yarn.lock`)`.
- If present, call `installWithNpmFallback(sandbox, "yarn", "yarn install", "Failed to install dependencies with yarn")`.
- Return after the Yarn install path, matching the pnpm branch shape.

**Verify**: `pnpm exec tsc --noEmit --pretty false` has no errors from `src/lib/sandbox-bootstrap.ts`.

### Step 2: Confirm package-manager precedence

Ensure the order is:
1. no `package.json` → return
2. `pnpm-lock.yaml` → pnpm install path
3. `yarn.lock` → yarn install path
4. otherwise → npm install

**Verify**: `rg "pnpm-lock.yaml|yarn.lock|npm install" src/lib/sandbox-bootstrap.ts` shows all three paths in that order.

## Test plan

No test harness currently covers sandbox command selection, and `pnpm test` reports no test files. Do not add a broad test harness in this small fix. If a test framework for sandbox-bootstrap is added later, cover lockfile precedence there.

## Done criteria

- [ ] `installDependencies` checks `yarn.lock` before npm fallback.
- [ ] Yarn path uses `installWithNpmFallback` with preferred command `yarn` and install command `yarn install`.
- [ ] `pnpm exec tsc --noEmit --pretty false` has no errors from this file.
- [ ] `pnpm lint` has no warnings from this file.
- [ ] No files outside Scope were modified.

## STOP conditions

Stop and report if:
- `installWithNpmFallback` has been removed or substantially changed.
- Supporting Yarn appears to require mutating package metadata or lockfiles.
- You discover sandbox images intentionally do not support Yarn and product direction has changed.

## Maintenance notes

If future package-manager support is added, keep lockfile-based selection explicit and ordered. Do not silently fall through to npm for known lockfiles unless the product intentionally accepts lockfile drift.
