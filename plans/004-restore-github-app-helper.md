# Plan 004: Restore GitHub App helper and branch-list typecheck

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in STOP conditions occurs, stop and report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 14c1189..HEAD -- src/lib/github-app.ts src/integrations/trpc/router.ts`
> If either file changed since this plan was written, compare the excerpts below against live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `14c1189`, 2026-06-25

## Why this matters

The uncommitted change removed `getGitHubApp` from `src/lib/github-app.ts`, but `src/integrations/trpc/router.ts` still imports and calls it for `github.listBranches`. TypeScript now fails before the branch can merge. Restoring one shared helper keeps installation-token creation and branch listing on the same GitHub App credential path.

## Current state

Relevant files:
- `src/lib/github-app.ts` — GitHub App construction and installation-token helper.
- `src/integrations/trpc/router.ts` — tRPC GitHub procedures, including `listBranches`.

Current excerpts:

`src/lib/github-app.ts:1-10`
```ts
import { App } from "octokit";

export async function getInstallationAccessToken(
	env: Env,
	installationId: number,
): Promise<string> {
	const app = new App({
		appId: env.GITHUB_APP_ID,
		privateKey: env.GITHUB_APP_PRIVATE_KEY,
	});
```

`src/integrations/trpc/router.ts:8,52-59`
```ts
import { getGitHubApp } from "#/lib/github-app";
// ...
const app = getGitHubApp(ctx.env);
const octokit = await app.getInstallationOctokit(input.installationId);
const response = await octokit.rest.repos.listBranches({
	owner: input.owner,
	repo: input.repo,
	per_page: 100,
});
return response.data.map((b) => b.name);
```

Repo conventions:
- TypeScript ESM imports use the `#/` alias for source modules.
- Verification baseline from `plans/README.md`: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`.
- Recent commits use Conventional Commit style, e.g. `feat(projects): provision github projects`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exit 0, no TypeScript errors from these files |
| Lint | `pnpm lint` | no new warnings in touched files |
| Tests | `pnpm test` | exit 0 |

## Scope

**In scope**:
- `src/lib/github-app.ts`
- `src/integrations/trpc/router.ts` only if needed to match the helper API

**Out of scope**:
- Auth flow redesign.
- GitHub OAuth settings.
- Lockfile/package changes.
- Any secret values.

## Steps

### Step 1: Reintroduce a shared GitHub App factory

In `src/lib/github-app.ts`, export `getGitHubApp(env: Env)` that returns `new App({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY })`.

Then update `getInstallationAccessToken` to call `const app = getGitHubApp(env);` instead of constructing a separate `App` inline.

**Verify**: `pnpm exec tsc --noEmit --pretty false` should no longer report `Module '"#/lib/github-app"' has no exported member 'getGitHubApp'` or the implicit `any` on `b` caused by the missing helper.

### Step 2: Confirm branch-list typing remains inferred

If TypeScript still reports `Parameter 'b' implicitly has an 'any' type` in `src/integrations/trpc/router.ts`, do not silence it with `any`. Instead, inspect the Octokit response type and either keep inference working through `getGitHubApp` or add a precise type annotation derived from the Octokit response data.

**Verify**: `pnpm exec tsc --noEmit --pretty false` exits 0 or only reports unrelated errors from plans 005-007 not yet executed.

## Test plan

No new tests are required for this small compile fix. The regression is covered by TypeScript because the failing import/call path must typecheck.

## Done criteria

- [ ] `src/lib/github-app.ts` exports `getGitHubApp`.
- [ ] `getInstallationAccessToken` reuses `getGitHubApp`.
- [ ] `pnpm exec tsc --noEmit --pretty false` no longer reports errors from `src/lib/github-app.ts` or `src/integrations/trpc/router.ts`.
- [ ] No files outside Scope were modified for this plan.

## STOP conditions

Stop and report if:
- `src/lib/github-app.ts` no longer contains the current excerpt.
- Fixing the compile error appears to require changing auth/session behavior.
- You find real credential values while inspecting env-related code; do not copy them.

## Maintenance notes

Keep all server-side GitHub App construction in this helper so future credential normalization and Octokit configuration have one place to live.
