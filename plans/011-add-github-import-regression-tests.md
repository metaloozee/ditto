# Plan 011: Create GitHub import regression tests

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md` unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 8632f47..HEAD -- src/lib/github-repositories.ts src/lib/github-repositories.test.ts src/integrations/trpc/routers/github.ts src/integrations/trpc/routers/github.test.ts`
> If any listed file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. On a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `8632f47`, 2026-06-29
- **Reconciled**: 2026-06-29 at commit `8632f47`; drift check is clean and the expected test files do not exist yet

## Execution handoff

This plan is ready for an OpenCode or pi.dev executor. Use this exact framing if
you dispatch it manually:

```text
You are the executor for plans/011-add-github-import-regression-tests.md. Follow
the plan step by step. Touch only the files listed as in scope. Run every
verification command named by the plan and report the exact command result. If a
STOP condition occurs, stop immediately and report the observed mismatch instead
of improvising. Skip any instruction to commit, push, or update plans/README.md
unless the operator explicitly asks you to do that.
```

Advisor reconciliation found no source drift from the plan's `8632f47` baseline:
`src/lib/github-repositories.ts` and
`src/integrations/trpc/routers/github.ts` still match the current-state excerpts,
and `src/lib/github-repositories.test.ts` plus
`src/integrations/trpc/routers/github.test.ts` are still absent. The correct next
action is implementation, not another rewrite of this plan.

## Why this matters

Ditto's GitHub import path is currently one of the highest-churn areas in the
repo, but the current test command passes with no test files. The next two
plans change pagination and authorization in the same GitHub import flow, and
making those changes without a regression harness would force the executor to
rely on manual reasoning instead of repeatable checks.

This plan is intentionally a test-baseline plan, not a behavior-change plan.
Its job is to create narrow seams and passing tests around today's GitHub import
code so later fixes can extend those tests instead of inventing ad hoc coverage.

## Current state

Relevant files:

- `src/lib/github-repositories.ts` - fetches GitHub installations and repos and
  maps them into Ditto's `GitHubImportState` shape.
- `src/integrations/trpc/routers/github.ts` - defines `github.importState` and
  `github.listBranches`, the GitHub import entry points after the router split.
- `src/integrations/trpc/routers/projects.ts` - owns project creation, but this
  plan should not touch it.

There are currently no test files under `src/`. The repo's test script is
`vitest run --passWithNoTests`, so the baseline can pass without proving the
GitHub import behavior. This plan creates the first focused regression tests for
that flow.

Current GitHub import logic has no automated tests:

```ts
// src/lib/github-repositories.ts:28-49
export async function getGitHubImportState({
	accessToken,
	installUrl,
}: {
	accessToken: string;
	installUrl: string;
}): Promise<GitHubImportState> {
	const octokit = new Octokit({ auth: accessToken });

	const installationsResponse =
		await octokit.rest.apps.listInstallationsForAuthenticatedUser();
	const installations = installationsResponse.data.installations;

	const repositories: GitHubRepo[] = [];

	for (const inst of installations) {
		try {
			const reposResponse =
				await octokit.rest.apps.listInstallationReposForAuthenticatedUser({
					installation_id: inst.id,
				});
```

Current GitHub router code calls the import helper directly and has no test seam
for branch listing:

```ts
// src/integrations/trpc/routers/github.ts:7-27
export const githubRouter = createTRPCRouter({
	importState: protectedProcedure.query(async ({ ctx }) => {
		const installUrl = ctx.env.VITE_GITHUB_APP_INSTALL_URL;
		const res = await ctx.auth.api.getAccessToken({
			body: {
				providerId: "github",
				userId: ctx.user.id,
			},
			headers: ctx.request.headers,
		});

		const accessToken = res.accessToken;
		if (!accessToken) {
			throw new TRPCError({
				code: "UNAUTHORIZED",
				message: "GitHub Auth expired, sign in again.",
			});
		}

		return await getGitHubImportState({ accessToken, installUrl });
	}),
```

```ts
// src/integrations/trpc/routers/github.ts:29-47
listBranches: protectedProcedure
	.input(
		z.object({
			owner: z.string(),
			repo: z.string(),
			installationId: z.number(),
		}),
	)
	.query(async ({ ctx, input }) => {
		try {
			const app = getGitHubApp(ctx.env);
			const octokit = await app.getInstallationOctokit(input.installationId);
			const res = await octokit.rest.repos.listBranches({
				owner: input.owner,
				repo: input.repo,
				per_page: 100,
			});

			return res.data.map((b) => b.name);
```

Repo conventions to follow:

- Formatting and imports are enforced by Biome with tabs and double quotes;
  match `biome.json:19-33`.
- Small named helper modules live under `src/lib/` with named exports and no
  default export; see `src/lib/crypto.ts`.
- Tests should use direct Vitest `describe` / `it` / `expect` imports and local
  module imports. Because no test files currently exist, keep the first test
  simple and colocated as `src/lib/github-repositories.test.ts`.

Product constraints to honor:

```md
// docs/repo-sandbox-coding-workspace-prd.md:64-67
- **Chat is the control plane.** Users should be able to steer the workspace conversationally.
- **Sandbox is the safety boundary.** All execution happens inside isolated infrastructure.
- **Evidence over claims.** The agent should show file diffs, command output, and previews.
- **User approval matters.** Destructive or repo-wide actions require explicit confirmation.
```

The test baseline should reinforce "evidence over claims": the later fixes need
repeatable proof, not just a plausible diff.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit` | exits 0 |
| Lint | `pnpm lint` | exits 0; existing warnings in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85` only |
| Full tests | `pnpm test` | exits 0 |
| Targeted tests | `pnpm exec vitest run src/lib/github-repositories.test.ts` | exits 0 |
| Whitespace check | `git diff --check` | no output |

## Scope

**In scope**:

- `src/lib/github-repositories.ts`
- `src/lib/github-repositories.test.ts` (create)
- `src/integrations/trpc/routers/github.ts` only if you need a tiny non-behavioral branch-list test seam
- `src/integrations/trpc/routers/github.test.ts` (create only if the seam above is necessary)

**Out of scope**:

- Changing GitHub pagination behavior itself; that belongs to Plan 012.
- Changing server-side authorization semantics; that belongs to Plan 013.
- Changing sandbox bootstrap behavior; that belongs to Plan 014 only for env-key validation.
- Any UI refactor in `src/components/new-project-dialog.tsx`.

## Git workflow

- Branch: `advisor/011-github-import-regression-tests`
- Commit style: conventional commits; match the existing history, for example
  `fix(workspace): replace D1 transaction in startRun`
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Add a narrow test seam around GitHub import fetching

Make the smallest possible code change that allows deterministic unit tests for
`getGitHubImportState`.

Preferred approach:

- Keep `getGitHubImportState(...)` as the public entry point.
- Add a tiny internal helper or injectable client seam so tests can supply a
  fake Octokit-like object instead of making live GitHub calls.
- Do not change the runtime return shape or public API used by the router.

If you can add the seam inside `src/lib/github-repositories.ts` without touching
the router, do that. Only touch `src/integrations/trpc/routers/github.ts` if
there is no other clean way to expose a branch-listing helper for later plans.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0.

### Step 2: Create passing baseline tests for import-state mapping

Create `src/lib/github-repositories.test.ts` and cover the invariants that are
already true today and must stay true through later fixes:

- maps installation and repository API payloads into Ditto's
  `GitHubImportState` shape
- preserves the caller-provided `installUrl`
- continues returning partial results when one installation's repo listing fails
- preserves the current `GitHubRepo` fields: `name`, `owner`, `repoName`,
  `language`, `isPrivate`, `stars`, `installationId`

Do not write tests that lock in today's pagination bug or today's authorization
gap as desired behavior.

**Verify**: `pnpm exec vitest run src/lib/github-repositories.test.ts` -> exits 0 and the new tests pass.

### Step 3: Add a reusable branch-list test seam only if needed

If Plan 012's branch-pagination fix would otherwise force router-level live API
testing, add one small helper seam now so later plans can test branch-name
mapping without Cloudflare bindings or real GitHub traffic.

Good outcomes:

- a tiny helper under `src/lib/` that receives an Octokit-like client and
  returns `string[]` branch names, or
- a tiny exported internal helper in `src/integrations/trpc/routers/github.ts`
  with no runtime behavior change.

Bad outcomes:

- creating a large router test harness
- introducing a mock database
- moving GitHub logic into a new abstraction layer unrelated to testability

If you add this seam, add one happy-path test for it now. If you do not need
the seam, skip this step and note that in the PR description or handoff.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0.

### Step 4: Run the repo baseline checks

Run the full checks after the test additions so later plans can rely on the new
baseline.

**Verify**: `pnpm lint && pnpm test && git diff --check` -> lint exits 0 with only the existing warnings in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`, tests exit 0, and `git diff --check` prints nothing.

## Test plan

- New file: `src/lib/github-repositories.test.ts`
- Cover:
  - single-installation happy path
  - partial failure on one installation repo listing
  - exact field mapping for Ditto's repo/install DTOs
  - preserved `installUrl`
- Structural pattern: direct Vitest `describe` / `it` / `expect` imports with
  local module imports
- If Step 3 adds a helper seam, add one focused unit test for branch-name
  mapping in the same file or in `src/integrations/trpc/routers/github.test.ts`

## Done criteria

All of these must hold:

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm lint` exits 0 with only the pre-existing warnings in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`
- [ ] `pnpm test` exits 0
- [ ] `pnpm exec vitest run src/lib/github-repositories.test.ts` exits 0
- [ ] A new regression test file exists for GitHub import state under `src/lib/`
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `src/lib/github-repositories.ts` or `src/integrations/trpc/routers/github.ts`
  no longer resembles the excerpts above
- adding tests requires real Better Auth, D1, or Cloudflare Sandbox bindings
  instead of a unit-level seam
- the smallest testable change requires moving GitHub logic into multiple new
  modules or changing public runtime behavior
- a later plan has already landed and made this baseline redundant

## Maintenance notes

- Plans 012 and 013 should extend these tests instead of creating parallel
  harnesses.
- Reviewers should look for accidental behavior changes disguised as
  "testability" refactors.
- This plan intentionally does not fix pagination or authorization; it only
  creates the regression net needed to land those fixes safely.
