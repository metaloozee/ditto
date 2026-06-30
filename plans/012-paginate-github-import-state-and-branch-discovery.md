# Plan 012: Paginate GitHub import state and branch discovery

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md` unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 8632f47..HEAD -- src/lib/github-repositories.ts src/lib/github-repositories.test.ts src/integrations/trpc/routers/github.ts src/integrations/trpc/routers/github.test.ts src/components/new-project-dialog.tsx`
> If any listed file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. On a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/011-add-github-import-regression-tests.md
- **Category**: bug
- **Planned at**: commit `8632f47`, 2026-06-29

## Why this matters

The import UI tells users to search and select any repository they have access
to, but the server currently reads only the first page of installations,
repositories, and branches. On accounts with more than one page of GitHub data,
Ditto silently hides valid repos and branches instead of explaining why they are
missing.

This plan fixes a user-visible correctness bug with a small blast radius.
Landing it before the authorization hardening in Plan 013 matters because the
auth fix should validate access against the full repo list, not a truncated one.

## Current state

Relevant files:

- `src/lib/github-repositories.ts` - builds the repo/install list shown in the
  GitHub import dialog.
- `src/integrations/trpc/routers/github.ts` - `github.listBranches` returns
  branch names for the selected repo after the router split.
- `src/components/new-project-dialog.tsx` - the UI assumes importState contains
  the complete repo list a user can choose from.
- `src/lib/github-repositories.test.ts` - added by Plan 011; extend it rather
  than inventing a second test harness.

Current import-state implementation only reads page 1:

```ts
// src/lib/github-repositories.ts:35-49
const octokit = new Octokit({ auth: accessToken });

const installationsResponse =
	await octokit.rest.apps.listInstallationsForAuthenticatedUser();
const installations = installationsResponse.data.installations;

for (const inst of installations) {
	const reposResponse =
		await octokit.rest.apps.listInstallationReposForAuthenticatedUser({
			installation_id: inst.id,
		});
```

Current branch discovery only reads the first 100 branches:

```ts
// src/integrations/trpc/routers/github.ts:37-47
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

The UI expects the server list to be complete enough for search and selection:

```tsx
// src/components/new-project-dialog.tsx:94-109
const importStateQuery = useQuery(
	trpc.github.importState.queryOptions(undefined, {
		enabled: open && step === "github",
		refetchOnWindowFocus: false,
		staleTime: 5 * 60 * 1000,
	}),
);

const githubRepos = importStateQuery.data?.repositories ?? [];
const installations = importStateQuery.data?.installations ?? [];
```

```tsx
// src/components/new-project-dialog.tsx:372-383
<CommandList>
	{githubLoading ? (
		<CommandEmpty>Loading repositories...</CommandEmpty>
	) : githubError ? (
		<CommandEmpty>{githubError}</CommandEmpty>
	) : githubRepos.length === 0 ? (
		<CommandEmpty>No repositories found.</CommandEmpty>
	) : (
		<CommandGroup heading="Your repositories">
```

Repo conventions to follow:

- Keep GitHub integration logic small and local. Existing code keeps DTO mapping
  in `src/lib/github-repositories.ts` and routing in
  `src/integrations/trpc/routers/github.ts`; match that split.
- Match the current named-export helper style in `src/lib/crypto.ts:61-112`.
- Extend the test file added by Plan 011 instead of creating a parallel test
  style.

Product requirements to honor:

```md
// docs/repo-sandbox-coding-workspace-prd.md:72-76
### 8.1 Repository import
- User can choose a GitHub repository they have access to.
- The selected repo is cloned into a sandboxed workspace.
- The system can re-open the same workspace for the same repo/session identity.
```

If page 2+ repositories or branches are invisible, Ditto is violating the first
requirement above.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit` | exits 0 |
| Lint | `pnpm lint` | exits 0; existing warnings in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85` only |
| Full tests | `pnpm test` | exits 0 |
| GitHub repo tests | `pnpm exec vitest run src/lib/github-repositories.test.ts` | exits 0 |
| Whitespace check | `git diff --check` | no output |

## Scope

**In scope**:

- `src/lib/github-repositories.ts`
- `src/lib/github-repositories.test.ts`
- `src/integrations/trpc/routers/github.ts`
- `src/integrations/trpc/routers/github.test.ts` only if Plan 011 created it or a router-level test is unavoidable

**Out of scope**:

- Server-side authorization policy; that belongs to Plan 013.
- Any UI redesign in `src/components/new-project-dialog.tsx`.
- Sandbox bootstrap, project persistence, or env-var validation.

## Git workflow

- Branch: `advisor/012-github-pagination`
- Commit style: conventional commits; for example
  `fix(workspace): replace D1 transaction in startRun`
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Exhaust all installation and repository pages in import-state fetching

Update `getGitHubImportState(...)` so it loads all pages of:

- installations returned by GitHub for the authenticated user
- repositories under each installation

Preferred implementation:

- use GitHub's built-in pagination helper if it is available on the current
  Octokit surface and keeps the code small
- otherwise use an explicit page loop with `page` and `per_page`

Constraints:

- keep the public return shape unchanged
- preserve the current best-effort behavior where one installation's failure
  does not abort the whole import-state response
- do not change sort order unless the existing order becomes unstable while
  paginating; if you must sort for determinism, do it once after all pages are
  collected and mention it in the PR notes

**Verify**: `pnpm exec vitest run src/lib/github-repositories.test.ts` -> exits 0.

### Step 2: Exhaust all branch pages in `github.listBranches`

Update `src/integrations/trpc/routers/github.ts` so `github.listBranches`
returns all branch names, not only the first 100.

Keep these boundaries:

- response shape stays `string[]`
- the route still catches GitHub API failures and converts them to
  `TRPCError({ code: "BAD_GATEWAY", ... })`
- do not mix authorization-policy changes into this plan; that comes next

If Plan 011 added a branch-list helper seam, extend it. If not, keep the change
local to the procedure or a tiny helper and avoid a larger refactor.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0.

### Step 3: Add regression tests for page 2+ data

Extend the GitHub tests so later reviewers can prove this bug stays fixed.

Required cases:

- 2+ installation pages are flattened into one `installations` result
- 2+ repository pages under one installation are flattened into one
  `repositories` result
- a failing installation still does not hide successful installations
- branch listing returns names beyond the first 100 entries

If router-level branch tests are too heavy, use the small helper seam from
Plan 011 and keep this unit-level.

**Verify**: `pnpm test` -> exits 0.

### Step 4: Run full repo verification

Finish with the repo baseline checks.

**Verify**: `pnpm lint && git diff --check` -> lint exits 0 with only the existing warnings in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`, and `git diff --check` prints nothing.

## Test plan

- Extend `src/lib/github-repositories.test.ts`
- Add cases for:
  - multi-page installations
  - multi-page repositories
  - preserved partial-failure behavior
  - branch lists longer than 100 entries
- Structural pattern: keep the same direct Vitest style established in Plan 011
  with local module imports

## Done criteria

All of these must hold:

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm lint` exits 0 with only the pre-existing warnings in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`
- [ ] `pnpm test` exits 0
- [ ] `pnpm exec vitest run src/lib/github-repositories.test.ts` exits 0 and includes page-2 coverage
- [ ] Repositories and branches from page 2+ are covered by automated tests
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Plan 011 never landed and you cannot add the needed tests without inventing a
  larger harness than this plan allows
- the GitHub API surface in this repo no longer resembles the excerpts above
- a correct fix appears to require UI or data-model changes outside the in-scope
  files
- the same repository can appear multiple times across installations and the UI
  now needs disambiguation logic rather than simple flattening

## Maintenance notes

- Plan 013 depends on this plan. The authorization check must evaluate the full
  accessible repo set, not page 1 only.
- Reviewers should check that per-installation failures are still isolated and
  that no new duplicate rows are introduced while flattening pages.
- Any future repo filtering or sorting should happen after pagination is
  complete, not per page.
