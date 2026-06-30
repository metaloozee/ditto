# Plan 013: Authorize GitHub installation use server-side

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md` unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e632ba0..HEAD -- src/integrations/trpc/routers/github.ts src/integrations/trpc/routers/projects.ts src/integrations/trpc/github-authorization.ts src/integrations/trpc/github-authorization.test.ts src/lib/github-repositories.ts src/lib/github-repositories.test.ts src/integrations/trpc/routers/github.test.ts`
> If any listed file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. On a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/011-add-github-import-regression-tests.md and plans/012-paginate-github-import-state-and-branch-discovery.md
- **Category**: security
- **Planned at**: commit `e632ba0`, 2026-06-30

## Why this matters

Ditto currently trusts the browser to tell the server which GitHub App
installation it should use for privileged operations like listing branches and
cloning a repository into a sandbox. Because the server does not re-check that
the authenticated user can actually see the submitted `installationId` +
`githubRepo` pair, a malicious or buggy client can ask the server to mint an
installation token for data the UI never proved the user could access.

This is a real authorization gap, not a UI bug. The fix must move trust back to
the server while preserving the current happy path for legitimate imports and
keeping scratch-project creation unchanged.

## Current state

Relevant files:

- `src/integrations/trpc/routers/github.ts` - contains the safe user-scoped
  `github.importState` route and the vulnerable `github.listBranches` route.
- `src/integrations/trpc/routers/projects.ts` - contains the vulnerable
  `projects.create` route that accepts and bootstraps a submitted repo/install
  pair.
- `src/lib/github-repositories.ts` - already knows how to fetch the user's
  GitHub-visible installations and repos.
- `src/lib/sandbox-bootstrap.ts` - uses installation access tokens to clone the
  selected repo after `projects.create` accepts the input.
- `src/components/new-project-dialog.tsx` - shows that the client sends back a
  repo/installation pair selected from import-state data, but client selection
  alone is not an authorization boundary.

Current safe pattern for user-scoped GitHub access:

```ts
// src/integrations/trpc/routers/github.ts:8-27
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

Current vulnerable branch route now delegates paginated branch discovery to
`listGitHubBranchNames`, but it still trusts the submitted `installationId`
before it asks the GitHub App for an installation-scoped client:

```ts
// src/integrations/trpc/routers/github.ts:60-83
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
			return await listGitHubBranchNames(octokit, input);
		} catch (err) {
			throw new TRPCError({
				code: "BAD_GATEWAY",
				message:
					err instanceof Error
						? err.message
						: "Failed to list branches. Please try again.",
			});
		}
	}),
```

Current project creation accepts and uses the client-submitted pair without a
server-side visibility check:

```ts
// src/integrations/trpc/routers/projects.ts:94-149
const hasGithubRepo = input.githubRepo !== undefined;
const hasGithubInstallationId = input.githubInstallationId !== undefined;
if (hasGithubRepo !== hasGithubInstallationId) {
	throw new TRPCError({
		code: "BAD_REQUEST",
		message: "Github Repository and Installation ID is required.",
	});
}

const githubImport =
	input.githubRepo !== undefined &&
	input.githubInstallationId !== undefined
		? {
				repo: input.githubRepo,
				installationId: input.githubInstallationId,
			}
		: null;

const sanitizedEnvVars = sanitizeEnvVars(input.envVars);
const encryptedEnvVars = await encryptEnvVars(
	sanitizedEnvVars,
	ctx.env.BETTER_AUTH_SECRET,
);

const db = createDb(ctx.env);
const projectId = nanoid();

const [project] = await db
	.insert(projects)
	.values({
		id: projectId,
		name: projectName,
		description: input.description,
		userId: ctx.user.id,
		githubRepo: githubImport?.repo,
		githubInstallationId: githubImport?.installationId,
		status: githubImport ? "provisioning" : "ready",
		envVars: encryptedEnvVars,
	})
	.returning();

if (!githubImport) {
	const { envVars: _envVars, ...projectResponse } = project;
	return projectResponse;
}

const sandboxId = crypto.randomUUID().toLowerCase();

await bootstrapSandbox({
	env: ctx.env,
	sandboxId,
	githubRepo: githubImport.repo,
	installationId: githubImport.installationId,
	envVars: sanitizedEnvVars,
});
```

The browser does send a pair chosen from the import-state response, but that is
not sufficient as a security boundary:

```tsx
// src/components/new-project-dialog.tsx:169-182
const selectedGitHubRepo = githubRepos.find(
	(repo) => repo.name === selectedRepo,
);

const project = await createProjectMutation.mutateAsync({
	name: selectedGitHubRepo.repoName,
	githubRepo: selectedGitHubRepo.name,
	githubInstallationId: selectedGitHubRepo.installationId,
	envVars: envVars.map(({ key, value }) => ({ key, value })),
});
```

Repo conventions to follow:

- `protectedProcedure` + `TRPCError` are the standard server boundary; match
  `src/integrations/trpc/init.ts:31-47` and existing router error handling.
- Keep shared logic as a small named helper rather than duplicating it in two
  procedures.
- Match Biome formatting and the current conventional-commit style.

Product and PRD constraints to honor:

```md
// docs/repo-sandbox-coding-workspace-prd.md:73-75
- User can choose a GitHub repository they have access to.
- The selected repo is cloned into a sandboxed workspace.
- The system can re-open the same workspace for the same repo/session identity.
```

```md
// docs/repo-sandbox-coding-workspace-prd.md:134-140
- **Trust:** users need clear visibility into what the agent changed.
- **Security:** untrusted code must stay isolated.
- **GitHub auth and permissions:** import flow must respect repo access.
```

The server must be the component that enforces "repo access", not the browser.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit` | exits 0 |
| Lint | `pnpm lint` | exits 0; existing warnings in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85` only |
| Full tests | `pnpm test` | exits 0 |
| Targeted tests | `pnpm exec vitest run src/lib/github-repositories.test.ts` | exits 0 |
| Whitespace check | `git diff --check` | no output |

If you create a tRPC-adjacent authorization helper test file, also use:

| Purpose | Command | Expected on success |
|---|---|---|
| Authorization helper tests | `pnpm exec vitest run src/integrations/trpc/github-authorization.test.ts` | exits 0 |

If Plan 011 created `src/integrations/trpc/routers/github.test.ts`, also use:

| Purpose | Command | Expected on success |
|---|---|---|
| Router tests | `pnpm exec vitest run src/integrations/trpc/routers/github.test.ts` | exits 0 |

## Scope

**In scope**:

- `src/integrations/trpc/routers/github.ts`
- `src/integrations/trpc/routers/projects.ts`
- `src/integrations/trpc/github-authorization.ts` (create if the shared helper should not live in either router)
- `src/integrations/trpc/github-authorization.test.ts` (create if the helper is testable without a large router harness)
- `src/lib/github-repositories.ts` only if you place the shared authorization helper there
- `src/lib/github-repositories.test.ts`
- `src/integrations/trpc/routers/github.test.ts` if Plan 011 created it or you need it for the shared helper

**Out of scope**:

- UI changes in `src/components/new-project-dialog.tsx`
- Pagination behavior itself; that belongs to Plan 012 and should already be present
- Sandbox bootstrap internals in `src/lib/sandbox-bootstrap.ts`
- Any schema or migration change

## Git workflow

- Branch: `advisor/013-github-authz`
- Commit style: conventional commits; for example
  `fix(workspace): replace D1 transaction in startRun`
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Add one shared server-side authorization helper

Create a small helper used by both `github.listBranches` and `projects.create`.
Its job is to confirm that the currently authenticated user can see the exact
repo/install pair being requested. Because those procedures now live in
separate router modules, prefer a small tRPC-adjacent helper such as
`src/integrations/trpc/github-authorization.ts` over making one router import
from the other.

Recommended behavior:

- fetch the user's GitHub OAuth access token via the existing
  `ctx.auth.api.getAccessToken(...)` path
- if no token exists, preserve the current `UNAUTHORIZED` /
  "GitHub Auth expired, sign in again." behavior
- load the user's accessible GitHub import state using the paginated logic from
  Plan 012
- verify that a repo exists with both:
  - matching full repo name (`owner/repo`)
  - matching `installationId`
- return the matched repo metadata or throw a stable `TRPCError` if the pair is
  not visible to the current user

Use `FORBIDDEN` for the visibility failure unless the live repo already has a
different, clearly established authorization code for this exact case.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0.

### Step 2: Guard `github.listBranches` with the shared helper

Update `github.listBranches` so the server validates the submitted repo/install
pair before it asks the GitHub App for an installation-scoped client.

Required outcome:

- unauthorized or mismatched pairs fail before `getInstallationOctokit(...)`
- valid pairs still return the same `string[]` branch-name shape
- the route keeps translating upstream GitHub failures into `BAD_GATEWAY`

Keep the procedure small. Avoid adding a new service layer.

**Verify**: if a router test file exists, `pnpm exec vitest run src/integrations/trpc/routers/github.test.ts` -> exits 0.

### Step 3: Guard GitHub-backed `projects.create` with the same helper

Before a GitHub-backed project is inserted or bootstrapped in
`src/integrations/trpc/routers/projects.ts`, validate that the submitted
`githubRepo` + `githubInstallationId` pair is visible to the current user.

Required boundaries:

- scratch-project creation stays unchanged
- unauthorized GitHub-backed creation does not call `bootstrapSandbox(...)`
- unauthorized GitHub-backed creation does not persist a new project row with
  that repo/install pair
- valid GitHub-backed creation still provisions as before

Do not add extra product behavior here such as branch selection, repo syncing,
or installation lookup UI.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0.

### Step 4: Add regression tests for authorization failures

Extend the GitHub tests so this gap cannot re-open quietly.

Required cases:

- valid repo/install pair passes authorization
- mismatched installation id is rejected
- repo missing from the authenticated user's visible import state is rejected
- missing/expired GitHub OAuth token preserves the existing `UNAUTHORIZED`
  message path

If Plan 011 created a shared unit-level seam, keep these tests unit-level. Only
write router-level tests if the helper cannot be exercised otherwise.

**Verify**: `pnpm test` -> exits 0.

### Step 5: Run the repo baseline checks

Finish with the standard repo checks.

**Verify**: `pnpm lint && git diff --check` -> lint exits 0 with only the existing warnings in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`, and `git diff --check` prints nothing.

## Test plan

- Extend `src/lib/github-repositories.test.ts`,
  `src/integrations/trpc/github-authorization.test.ts`, or
  `src/integrations/trpc/routers/github.test.ts`
- Cover:
  - authorized repo/install pair
  - mismatched installation id
  - repo not visible in import-state data
  - missing GitHub OAuth token
- Pattern: follow the direct Vitest style and helper seams created in Plan 011

## Done criteria

All of these must hold:

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm lint` exits 0 with only the pre-existing warnings in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`
- [ ] `pnpm test` exits 0
- [ ] Unauthorized repo/install pairs are covered by automated tests and fail before installation-scoped GitHub access is requested
- [ ] Scratch-project creation behavior is unchanged
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Plan 012 has not landed and the shared import-state lookup still only sees the
  first page of accessible repos
- the same repo can legitimately appear under multiple user-visible
  installations and the UI lacks a stable way to disambiguate which one the user
  picked
- you cannot add this validation without touching `src/components/new-project-dialog.tsx`
  or `src/lib/sandbox-bootstrap.ts`
- the current code no longer resembles the excerpts above

## Maintenance notes

- Reviewers should check that every path from user input to
  `getInstallationOctokit(...)` or `bootstrapSandbox(...)` now passes through a
  user-scoped visibility check.
- If Ditto later adds branch-level or org-level policy, extend the shared helper
  instead of sprinkling ad hoc checks through the router.
- This plan intentionally does not add UI affordances for expired auth; it keeps
  the current re-auth message path.
