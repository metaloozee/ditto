# Plan 014: Validate sandbox env-var keys before saving or provisioning

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md` unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat de51de1..HEAD -- src/components/new-project-dialog.tsx src/components/project-settings-dialog.tsx src/integrations/trpc/routers/projects.ts src/lib/env-vars.ts src/lib/env-vars.test.ts src/components/new-project-dialog.test.tsx src/components/project-settings-dialog.test.tsx`
> If any listed file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. On a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `de51de1`, 2026-06-30

## Why this matters

Ditto lets users enter environment-variable names during GitHub import and later
from project settings, but the backend only trims whitespace before saving those
keys and syncing them into a sandbox `.env` file. A malformed key containing
spaces, `=`, or a newline can produce an invalid `.env` file or unintended extra
entries, turning a simple user mistake into a hard-to-diagnose provisioning or
settings failure.

This plan adds one shared validation rule at the API boundary and mirrors it in
both UI entry points so users get a clear error before keys are saved or written
to the sandbox. It should stay small and focused: validate keys, do not redesign
env handling.

## Current state

Relevant files:

- `src/components/new-project-dialog.tsx` - collects env-var rows from the user
  and submits them during GitHub-backed project creation.
- `src/components/project-settings-dialog.tsx` - lets users add or replace
  env-vars after the project exists.
- `src/integrations/trpc/routers/projects.ts` - trims env-var keys but does not
  validate their syntax before encrypting, storing, bootstrapping, or syncing.
- `src/lib/sandbox-bootstrap.ts` - writes env-vars into `/workspace/.env` inside
  the sandbox; read it for context, but do not change it in this plan.

The GitHub import dialog currently accepts arbitrary key text:

```tsx
// src/components/new-project-dialog.tsx:780-807
{envVars.map((envVar) => (
	<div key={envVar.id} className="flex items-center gap-2">
		<Input
			placeholder="KEY"
			autoComplete="off"
			spellCheck={false}
			value={envVar.key}
			disabled={isProvisioning}
			onChange={(e) =>
				updateEnvVar(envVar.id, "key", e.target.value)
			}
			className="flex-1 font-mono text-xs"
			aria-label="Variable name"
		/>
```

Project settings also accept arbitrary new env-var keys before calling the same
server mutation:

```tsx
// src/components/project-settings-dialog.tsx:165-176
async function handleAddEnvVar(): Promise<void> {
	if (!isAddingEnvVar || trimmedNewEnvVarKey.length === 0) {
		return;
	}

	await setEnvVarMutation.mutateAsync({
		id: project.id,
		key: newEnvVarKey,
		value: newEnvVarValue,
	});
	resetNewEnvVarForm();
	await refreshEnvVars();
}
```

```tsx
// src/components/project-settings-dialog.tsx:412-455
{isAddingEnvVar ? (
	<FieldGroup>
		<Field>
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
				<Input
					placeholder="KEY"
					value={newEnvVarKey}
					onChange={(event) =>
						setNewEnvVarKey(event.target.value)
					}
					disabled={isMutatingEnvVars}
					autoComplete="off"
					spellCheck={false}
					className="font-mono text-xs sm:flex-1"
					aria-label="New variable name"
				/>
```

The server only trims, deduplicates by key, and drops empty keys:

```ts
// src/integrations/trpc/routers/projects.ts:28-43
function sanitizeEnvVars(
	envVars: SandboxEnvVar[] | undefined,
): SandboxEnvVar[] {
	const envVarsByKey = new Map<string, string>();

	for (const envVar of envVars ?? []) {
		const key = envVar.key.trim();
		if (key.length === 0) {
			continue;
		}

		envVarsByKey.set(key, envVar.value.trim());
	}

	return Array.from(envVarsByKey, ([key, value]) => ({ key, value }));
}
```

The same sanitizer is used by both creation and later updates:

```ts
// src/integrations/trpc/routers/projects.ts:121-125
const sanitizedEnvVars = sanitizeEnvVars(input.envVars);
const encryptedEnvVars = await encryptEnvVars(
	sanitizedEnvVars,
	ctx.env.BETTER_AUTH_SECRET,
);
```

```ts
// src/integrations/trpc/routers/projects.ts:256-274
const [nextEnvVar] = sanitizeEnvVars([
	{ key: input.key, value: input.value },
]);

if (!nextEnvVar) {
	throw new TRPCError({
		code: "BAD_REQUEST",
		message: "Environment variable name is required.",
	});
}
```

The sandbox bootstrap code interpolates the key directly into `.env` output:

```ts
// src/lib/sandbox-bootstrap.ts:14-25
function formatEnvFile(envVars: SandboxEnvVar[]): string {
	return envVars
		.map(({ key, value }) => {
			const escapedValue = value
				.replaceAll("\\", "\\\\")
				.replaceAll('"', '\\"')
				.replaceAll("\n", "\\n");

			return `${key}="${escapedValue}"`;
		})
		.join("\n");
}
```

The documented env-vars in the repo all use simple underscore-based names:

```env
// README.md:115-123,148-150
ALCHEMY_PASSWORD=change-me
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
VITE_GITHUB_APP_INSTALL_URL=https://github.com/apps/<your-app-slug>/installations/new
ANTHROPIC_API_KEY=your_anthropic_api_key
```

Repo conventions to follow:

- Reuse one shared validation helper when the same rule is needed in server and
  client code; keep it as a small named-export module under `src/lib/`.
- Existing dialog error copy is concise and uses `role="alert"` or `FieldError`;
  match `src/components/new-project-dialog.tsx:746-749` and
  `src/components/project-settings-dialog.tsx:250-255`.
- Match Biome formatting and the current conventional-commit history.

Product constraints to honor:

```md
// PRODUCT.md:31-35
1. **Make the project feel tangible.** Users should always understand which project, repo, environment, model, and branch they are working with.
2. **Guide without patronizing.** Non-experts need clear choices and consequences; developers need fast paths and accurate technical labels.
3. **Keep AI actions inspectable.** Planning, scaffolding, edits, environment setup, and errors should be visible enough to build trust.
```

Validation errors should therefore be clear, specific, and local to the env-var
row or form state. Do not hide the failure behind a generic provisioning error.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit` | exits 0 |
| Lint | `pnpm lint` | exits 0; existing warnings in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85` only |
| Full tests | `pnpm test` | exits 0 |
| Targeted tests | `pnpm exec vitest run src/lib/env-vars.test.ts` | exits 0 |
| Whitespace check | `git diff --check` | no output |

If you add a dialog-level test file, also use the matching command:

| Purpose | Command | Expected on success |
|---|---|---|
| New-project dialog tests | `pnpm exec vitest run src/components/new-project-dialog.test.tsx` | exits 0 |
| Project-settings dialog tests | `pnpm exec vitest run src/components/project-settings-dialog.test.tsx` | exits 0 |

## Scope

**In scope**:

- `src/components/new-project-dialog.tsx`
- `src/components/project-settings-dialog.tsx`
- `src/integrations/trpc/routers/projects.ts`
- `src/lib/env-vars.ts` (create)
- `src/lib/env-vars.test.ts` (create)
- `src/components/new-project-dialog.test.tsx` only if a small focused component test is practical
- `src/components/project-settings-dialog.test.tsx` only if a small focused component test is practical

**Out of scope**:

- Changing env-var value escaping in `src/lib/sandbox-bootstrap.ts`
- Changing encrypted storage format in `projects.envVars`
- Supporting every possible nonstandard `.env` key syntax
- Migrating, rewriting, or deleting already-stored malformed env-var keys
- Any broader onboarding or dialog redesign

## Git workflow

- Branch: `advisor/014-validate-env-var-keys`
- Commit style: conventional commits; for example
  `fix(workspace): replace D1 transaction in startRun`
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Add one shared env-var key validator

Create `src/lib/env-vars.ts` with a small named helper that validates the env
key syntax Ditto accepts for sandbox provisioning.

Recommended rule:

- trim surrounding whitespace
- accept only keys matching `^[A-Za-z_][A-Za-z0-9_]*$`

This matches the repo's documented examples and avoids malformed `.env` output.
Do not auto-correct invalid keys beyond trimming; reject them.

The helper should be usable from both server and client code so the rule cannot
drift.

Recommended helper shape:

- `normalizeEnvVarKey(rawKey: string): string | null` returns the trimmed key
  only when it matches the accepted syntax, and returns `null` otherwise.
- `ENV_VAR_KEY_DESCRIPTION` or a small message helper can hold the user-facing
  copy so the server and UI do not drift.

Blank or whitespace-only keys should be invalid to the helper. The creation path
may still ignore blank rows before calling the helper so today's optional empty
rows keep working.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0.

### Step 2: Enforce the rule at every server write boundary

Update `src/integrations/trpc/routers/projects.ts` so every server path that
saves env vars rejects invalid keys before encryption, storage, sandbox
bootstrap, or sandbox sync begins.

Required behavior:

- `projects.create` can still ignore empty env-var rows as it does today
- non-empty invalid keys produce a stable `BAD_REQUEST` failure
- valid keys still flow through unchanged after trimming
- `projects.setEnvVar` rejects blank and non-empty invalid keys before it writes
  encrypted state or calls `syncSandboxEnvFile(...)`
- `projects.deleteEnvVar` should keep trimming and deleting by key; do not apply
  the new validator there because users may need to remove legacy malformed keys
- do not change how values are escaped or stored in this plan

Keep the validation rule shared with Step 1; do not duplicate regex literals in
multiple files.

**Verify**: `pnpm exec vitest run src/lib/env-vars.test.ts` -> exits 0.

### Step 3: Surface the same validation in both env-var UIs

Mirror the validation in `src/components/new-project-dialog.tsx` and
`src/components/project-settings-dialog.tsx` so the user can see and fix invalid
keys before provisioning or saving starts.

Required `NewProjectDialog` behavior:

- invalid key rows are visually identifiable
- the user sees concise inline error text or a local alert near the env section
- the submit action for GitHub-backed creation is disabled while non-empty
  invalid keys are present
- fixing the key removes the error and re-enables submission
- blank optional rows keep the current behavior: they may be ignored rather than
  blocking initialization

Required `ProjectSettingsDialog` behavior:

- the add-env-var save button stays disabled for blank keys as it does today
- non-empty invalid keys show a local `FieldError` or equivalent concise error
- non-empty invalid keys cannot be submitted to `projects.setEnvVar`
- existing read-only keys are still shown; do not add migration behavior here

Keep this local to the existing env-var sections. Do not introduce a new form
library or restructure either dialog.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0.

### Step 4: Add targeted regression tests

Create `src/lib/env-vars.test.ts` and cover:

- accepts `NODE_ENV`
- accepts `VITE_APP_TITLE`
- rejects blank or whitespace-only keys
- rejects keys containing spaces
- rejects keys containing `=`
- rejects keys containing a newline

Add server/helper coverage for `projects.create` and `projects.setEnvVar` if it
can stay unit-level. If a small dialog-level test is practical without creating a
large harness, add one assertion that invalid keys disable GitHub provisioning or
settings save. If that would cause test-harness sprawl, keep the automated
coverage at the shared helper and server boundary.

**Verify**: `pnpm test` -> exits 0.

### Step 5: Run the repo baseline checks

Finish with the standard repo checks.

**Verify**: `pnpm lint && git diff --check` -> lint exits 0 with only the existing warnings in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`, and `git diff --check` prints nothing.

## Test plan

- New file: `src/lib/env-vars.test.ts`
- Required cases:
  - accepted underscore-style names
  - blank/whitespace rejection at the helper level
  - space rejection
  - `=` rejection
  - newline rejection
- server create behavior: blank rows are ignored, non-empty invalid keys are
  rejected before storage/provisioning
- server set behavior: blank and invalid keys are rejected before storage/sync
- Structural pattern: direct Vitest `describe` / `it` / `expect` imports with
  local module imports
- Optional: `src/components/new-project-dialog.test.tsx` or
  `src/components/project-settings-dialog.test.tsx` for submit-disabled behavior
  only if it stays small and focused

## Done criteria

All of these must hold:

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm lint` exits 0 with only the pre-existing warnings in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`
- [ ] `pnpm test` exits 0
- [ ] `pnpm exec vitest run src/lib/env-vars.test.ts` exits 0
- [ ] Invalid non-empty env-var keys are rejected server-side before project creation, encrypted storage, sandbox provisioning, or sandbox sync
- [ ] `projects.setEnvVar` rejects blank and invalid keys before mutating project env-vars
- [ ] `projects.deleteEnvVar` can still remove existing keys and is not blocked by the new syntax validator
- [ ] The GitHub import dialog blocks submission while non-empty invalid keys are present
- [ ] The project-settings env-var add form blocks saving while non-empty invalid keys are present
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- product requirements or live code reveal that Ditto must support nonstandard
  keys such as dotted or hyphenated names for real imported repos
- adding UI validation requires a broad dialog refactor or a new form library
- the current project creation, env-var settings, or sanitizer code no longer
  resembles the excerpts above
- the smallest safe fix appears to require changing `src/lib/sandbox-bootstrap.ts`
  value escaping or the encrypted storage format
- safely handling existing malformed stored keys requires a migration or cleanup
  workflow; that is out of scope for this plan

## Maintenance notes

- If Ditto later adds env-var presets or import-from-file support, keep this
  helper as the single source of truth for accepted key syntax.
- Reviewers should scrutinize accidental behavior expansion such as duplicate-key
  policy changes or value normalization; neither belongs in this plan.
- Reviewers should confirm that deletion of existing env-vars still works even if
  a legacy malformed key is present.
- This plan intentionally prefers a conservative key syntax because the repo's
  documented examples all use underscore-based names.
