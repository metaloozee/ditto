# Plan 046: Add Explicit GitHub Branch, Commit, and PR Export

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and stop on any STOP condition. This plan creates an
> explicit external-effect product action; do not let the agent trigger it
> automatically.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 0b670e0..HEAD -- src/integrations/trpc/routers/workspace.ts src/integrations/trpc/routers/github.ts src/lib/github-app.ts src/lib/github-authorization.ts src/lib/sandbox-bootstrap.ts src/lib/workspace-policy.ts src/components/ai-chat.tsx src/components/diff-review.tsx src/routes/project.\$projectId.tsx plans/README.md
> git diff --stat -- src/integrations/trpc/routers/workspace.ts src/integrations/trpc/routers/github.ts src/lib/github-app.ts src/lib/github-authorization.ts src/lib/sandbox-bootstrap.ts src/lib/workspace-policy.ts src/components/ai-chat.tsx src/routes/project.\$projectId.tsx plans/README.md
> ```

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: 044, 045
- **Category**: direction / security
- **PRD phase**: Phase 5, step 2 (explicit commit/branch/PR flows)
- **Planned at**: commit `0b670e0`, 2026-07-05
- **Execution note**: backend completed on commit `4c9abb0` on 2026-07-05;
  frontend "Create PR" control intentionally deferred by maintainer request.

## Why this matters

The PRD separates sandbox-internal work from outside-world effects: the agent
must not push, deploy, open PRs, or mutate GitHub without explicit user action.
Today the Flue agent instructions correctly say not to push or open PRs, and
there is no product export action. Phase 5 needs a user-clicked, server-side,
authorized flow that turns reviewed sandbox changes into a GitHub branch,
commit, and pull request.

## Current state

- `.flue/agents/project-coder.ts:36` tells the mutating agent not to push,
  open PRs, deploy, or change external systems.
- `src/lib/github-authorization.ts` already verifies that the signed-in user
  can access the stored `githubRepo` + `githubInstallationId`.
- `src/lib/github-app.ts` exposes `getInstallationAccessToken(env,
  installationId)`.
- `src/lib/sandbox-bootstrap.ts:288` clones with an installation token, then
  `src/lib/sandbox-bootstrap.ts:293` scrubs the remote URL back to the public
  GitHub URL. That is the right baseline; do not persist tokenized remotes.
- `src/integrations/trpc/routers/workspace.ts` has no export mutation and no
  explicit external-effect event types. It now has `workspace.getRunDiff`,
  which authorizes by `agentRuns.id` + `userId` + `projectId`, then loads the
  newest `runArtifacts.kind === "diff"` row for a run.
- `src/lib/workspace-policy.ts` event types include `diff_ready`, but do not
  include export events.
- Plan 045 created the review affordance in `src/components/ai-chat.tsx`:
  `DiffReadyReview` renders a "Review diff" button for `diff_ready` events and
  opens `DiffReview`. Put the explicit "Create PR" action in or next to this
  review path; do not add it to the composer.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exit 0 |
| Focused tests | `pnpm test -- src/lib/github-authorization.test.ts src/lib/flue-run-bridge.test.ts` | relevant tests pass |
| Full tests | `pnpm test` | all pass |
| Lint | `pnpm lint` | exit 0, only known warnings |
| Flue build | `pnpm flue:build` | exit 0, known warning only |
| Whitespace | `git diff --check` | exit 0 |

## Scope

**In scope**:
- `src/lib/github-export.ts` (create) — pure helpers for branch names, commit
  messages, PR title/body defaults, and safe command output redaction.
- `src/lib/github-export.test.ts` (create).
- `src/integrations/trpc/routers/workspace.ts` — add an explicit
  `exportRunToGitHubPr` mutation.
- `src/lib/workspace-policy.ts` — add export event types only if the UI needs
  durable status (`export_started`, `export_completed`, `export_failed`).
- `src/components/ai-chat.tsx` and/or `src/components/diff-review.tsx` —
  deferred by maintainer request on 2026-07-05. This execution should finish
  the backend mutation and durable event vocabulary only; the visible
  user-clicked "Create PR" action will be added in a later UI pass.
- `plans/README.md` — status row.

**Out of scope**:
- Automatic export by the agent.
- Deploys, production pushes, destructive git operations, or force pushes.
- Generic approval UX for arbitrary tools.
- AI-generated PR summaries. Use a deterministic editable default now; bounded
  Flue summary workflow can be planned later.
- Multi-repo export or org policy.

## Git workflow

- Branch: `advisor/046-explicit-github-pr-export`
- Commit style: `feat(export): add explicit github pr export`.
- Do not push or open a PR from your development branch unless instructed.

## Steps

### Step 1: Add pure export helpers

Create `src/lib/github-export.ts` with helpers:

- `buildExportBranchName({ runId, now })` -> e.g.
  `ditto/run-<short-run-id>-<yyyymmddhhmmss>`. Allow only
  `[A-Za-z0-9._/-]`; collapse unsafe characters to `-`.
- `buildExportCommitMessage({ sessionTitle, runId })` -> a short conventional
  message such as `feat: apply ditto run changes`.
- `buildPullRequestTitle(...)` and `buildPullRequestBody(...)` using:
  - project/session/run IDs,
  - changed-file count from the diff artifact,
  - a short reminder that the PR was explicitly created by the user.
- `redactGitHubExportOutput(output)` that delegates to `redactSecrets`.

Keep helpers pure and tested.

**Verify**: `pnpm test -- src/lib/github-export.test.ts` -> all pass.

### Step 2: Add durable export event vocabulary

If the UI needs persistent status, add these event types to
`src/lib/workspace-policy.ts`:

- `export_started`
- `export_completed`
- `export_failed`

Payloads must never include tokens or tokenized remote URLs. `export_completed`
may include `{ branchName, pullRequestUrl, pullRequestNumber }`.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exit 0.

### Step 3: Implement the protected export mutation

Add `workspace.exportRunToGitHubPr` with input:

```ts
z.object({
  projectId: z.string().min(1),
  runId: z.string().min(1),
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().max(10_000).optional(),
})
```

Behavior:

1. Load project by `projectId` and `ctx.user.id`.
2. Require `project.githubRepo` and `project.githubInstallationId`.
3. Call `authorizeGitHubRepositoryAccess(...)` for the stored repo/install
   pair before any GitHub write.
4. Load the run by `runId`, `projectId`, and `ctx.user.id`; require
   `status === "completed"` and `isMutating === true`.
5. Require a `runArtifacts` row with `kind === "diff"` for the run so
   empty/no-op runs cannot create empty PRs by accident. The artifact primary
   key is an integer; `diff_ready` payloads may contain a separate string
   artifact id, so do not rely on the chat payload to authorize export.
6. Ensure the sandbox is hydrated via the existing `ensureProjectSandbox`
   path before git commands.
7. Insert `export_started`.
8. Create a branch, commit, push, and PR only after the user invoked this
   mutation.

For the first implementation, use sandbox git for the branch/commit/push:

```sh
git status --short
git switch -c <branch>
git add -A
git commit -m <message>
git push https://x-access-token:<installation-token>@github.com/<owner>/<repo>.git HEAD:refs/heads/<branch>
```

Critical safety rules:

- Never persist the tokenized push URL in D1, events, logs, or UI.
- Do not run `git remote set-url` with a token.
- Redact all command output before storing an event.
- Use `--porcelain`/bounded output where possible.
- If `git status --short` is empty, fail with `PRECONDITION_FAILED`.
- If push succeeds but PR creation fails, emit `export_failed` with the branch
  name and redacted reason so the user can recover manually.

Create the PR with Octokit after push:

```ts
const app = getGitHubApp(ctx.env);
const octokit = await app.getInstallationOctokit(project.githubInstallationId);
await octokit.rest.pulls.create({ owner, repo, head: branchName, base, title, body });
```

Use the repository default branch from GitHub metadata (for example
`octokit.rest.repos.get({ owner, repo })`). If GitHub metadata is unavailable,
use the sandbox current branch's upstream/base and STOP if that cannot be
determined without guessing.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exit 0.

### Step 4: Defer UI action after diff review

Maintainer scope change on 2026-07-05: do not implement frontend controls in
this execution. Keep `workspace.exportRunToGitHubPr` server-side and callable
only by an explicit client mutation; do not add any automatic agent path or
composer control.

The later UI pass should add a clear "Create PR" button in the diff review
surface from plan 045 (`DiffReadyReview` in `src/components/ai-chat.tsx` and/or
`DiffReview` in `src/components/diff-review.tsx`) only for completed mutating
runs with a diff artifact, call `workspace.exportRunToGitHubPr`, and show
pending, success, and error states.

Do not add export controls to the composer or let the agent trigger this path.

**Verify**: `pnpm lint` -> exit 0 with only known warnings.

### Step 5: Final verification

Run:

```sh
pnpm exec tsc --noEmit --pretty false
pnpm test -- src/lib/github-export.test.ts
pnpm test
pnpm lint
pnpm flue:build
git diff --check
```

Manual smoke with a disposable repository is required before enabling this in
production:

1. Import a disposable repo.
2. Run a mutating change.
3. Review the diff.
4. Click "Create PR".
5. Confirm a branch and PR appear in GitHub.
6. Confirm no tokenized URL appears in chat events, D1 payloads, or visible
   command output.

## Test plan

- Pure helper tests for safe branch names and PR body defaults.
- Router-level tests if an existing harness can mock:
  - unauthorized user rejected before GitHub writes.
  - non-completed or read-only run rejected.
  - missing diff artifact rejected.
  - export command output is redacted before event insertion.
- Manual smoke for live GitHub write behavior.

## Done criteria

- [ ] Backend export mutation is available for a later explicit user action
      from diff review; frontend control is deferred.
- [ ] Server validates project ownership and GitHub repository access.
- [ ] Completed mutating runs with diff artifacts can create branch, commit,
      push, and PR.
- [ ] Tokens and tokenized remotes are never persisted or shown.
- [ ] Export status is durably recorded through events.
- [ ] Verification commands pass.
- [ ] Manual disposable-repo smoke is documented in the PR notes.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- The project does not store enough base branch information to choose the PR
  base safely.
- Sandbox git commands would require persisting a tokenized remote.
- GitHub App permissions are insufficient to push branches or create PRs.
- The export path would run without a user click.
- The implementation requires broad schema changes beyond event vocabulary.
- Verification fails twice after a reasonable fix attempt.

## Maintenance notes

This is a high-risk external-effect path. Reviewers should focus on
authorization, token redaction, branch naming, and making sure no agent prompt
or tool can invoke the export mutation automatically.
