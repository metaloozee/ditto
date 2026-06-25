# Plan 007: Normalize escaped GitHub App private-key newlines

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in STOP conditions occurs, stop and report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 14c1189..HEAD -- src/lib/github-app.ts README.md`
> If either file changed since this plan was written, compare the excerpts below against live code before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/004-restore-github-app-helper.md
- **Category**: bug
- **Planned at**: commit `14c1189`, 2026-06-25

## Why this matters

The README tells operators that a GitHub App private key stored on one line should encode line breaks as `\n`. The runtime currently passes `env.GITHUB_APP_PRIVATE_KEY` directly to Octokit. If the deployed secret contains literal backslash-n sequences, GitHub App JWT signing can fail because the PEM parser expects real newlines.

## Current state

Relevant files:
- `src/lib/github-app.ts` — constructs the Octokit `App` using GitHub App signer credentials.
- `README.md` — documents env var setup for Better Auth and GitHub App import.

Current excerpts:

`src/lib/github-app.ts:7-10`
```ts
const app = new App({
	appId: env.GITHUB_APP_ID,
	privateKey: env.GITHUB_APP_PRIVATE_KEY,
});
```

`README.md:126-129`
```md
GitHub OAuth must provide email access. Repository import also requires a GitHub
App with repository access. Use the OAuth app's client ID/secret for sign-in, and
use the GitHub App ID plus private key for installation access tokens. If the
private key is stored on one line, encode line breaks as `\n`.
```

Repo conventions:
- Small source-only helpers live near the call site.
- Never write or log secret values. If you need sample strings in tests/docs, use placeholders only.
- Plan 004 should centralize GitHub App construction in `getGitHubApp(env)`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | no errors from `github-app.ts` |
| Lint | `pnpm lint` | no warnings from `github-app.ts` |
| Tests | `pnpm test` | exit 0 |

## Scope

**In scope**:
- `src/lib/github-app.ts`
- `README.md` only if wording must be aligned with code

**Out of scope**:
- Rotating or inspecting real GitHub private keys.
- Changing env var names.
- Better Auth OAuth client behavior.
- Alchemy secret-management behavior.

## Steps

### Step 1: Add a private-key normalization helper

In `src/lib/github-app.ts`, add a small helper such as:

```ts
function normalizeGitHubPrivateKey(privateKey: string) {
	return privateKey.replace(/\\n/g, "\n");
}
```

Do not export it unless needed by tests. Do not log the key.

**Verify**: `pnpm lint` reports no warning from `src/lib/github-app.ts`.

### Step 2: Use the helper when constructing the GitHub App

In `getGitHubApp(env)` from plan 004, pass:

```ts
privateKey: normalizeGitHubPrivateKey(env.GITHUB_APP_PRIVATE_KEY),
```

Keep `appId: env.GITHUB_APP_ID` unchanged.

**Verify**: `pnpm exec tsc --noEmit --pretty false` has no errors from `src/lib/github-app.ts`.

### Step 3: Check README consistency

Read the README env section. If it still says one-line private keys should use `\n`, no README change is required. If the wording drifted, update only that sentence to match the runtime behavior.

**Verify**: `rg "private key.*\\\\n|line breaks as `\\\\n`" README.md` finds the documented guidance.

## Test plan

No new test harness exists for this helper. Do not introduce secret-like fixtures. If adding a unit test later, use placeholder text such as `-----BEGIN PRIVATE KEY-----\\nplaceholder\\n-----END PRIVATE KEY-----` and assert only newline conversion.

## Done criteria

- [ ] `getGitHubApp(env)` normalizes literal `\n` sequences before passing the private key to Octokit.
- [ ] No secret values are written, logged, or committed.
- [ ] README guidance still matches runtime behavior.
- [ ] `pnpm exec tsc --noEmit --pretty false` has no errors from this file.
- [ ] `pnpm lint` has no warnings from this file.

## STOP conditions

Stop and report if:
- Plan 004 has not restored `getGitHubApp(env)`; do plan 004 first.
- The code starts loading private keys from a source other than `env.GITHUB_APP_PRIVATE_KEY`.
- You encounter an actual private key or credential value; do not copy it into code, plans, logs, or chat.

## Maintenance notes

Keep credential normalization inside the GitHub App helper. Future callers should not each remember to call `.replace(/\\n/g, "\n")`.
