# Plan 010: Sync the primary repository before creating a session worktree

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 5ad5e0c..HEAD -- src/lib/sandbox-bootstrap.ts src/lib/sandbox-bootstrap.test.ts src/lib/session-worktree.ts src/lib/session-worktree.test.ts src/routes/api.agent.stream.ts src/lib/agent-git-handler.ts src/integrations/trpc/routers/session-git.ts docs/architecture/agent-harness.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. If the
> lifecycle or credential assumptions no longer match, treat it as a STOP
> condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/005-session-worktrees-and-branches.md
- **Category**: bug
- **Planned at**: commit `5ad5e0c`, 2026-07-11
- **Execution**: DONE (2026-07-11) — branch `advisor/010-sync-session-base` @ `92c728f`, worktree `/home/ayan/.grok/worktrees/ayan-ditto/subagent-019f5218-a1d8-76d3-a2ce-1209a1b7f292`. Advisor review APPROVE.

## Why this matters

Ditto clones a GitHub repository only when provisioning or recreating a project
sandbox. A hydrated sandbox is considered connected solely because
`/workspace/.git` exists. A new chat then creates its branch from the existing
primary `/workspace` `HEAD`, even when the repository's corresponding GitHub
branch has advanced since the clone. The new agent therefore starts from stale
code and records the stale SHA as `workspace_sessions.baseCommitSha`.

After this plan, the first worktree creation for a session fetches the current
primary branch from GitHub and fast-forwards the primary clone before resolving
the session base SHA. Existing session branches/worktrees never move
automatically. Local changes that exist only on a user's computer remain
invisible until they are pushed to the linked GitHub repository; this feature
syncs GitHub state, not arbitrary developer machines.

## Current state

### Provisioning clones once

`src/lib/sandbox-bootstrap.ts:238-275` mints a repository-scoped GitHub App
installation token, calls `sandbox.gitCheckout()` into `/workspace`, scrubs
`origin` back to a public URL, installs dependencies, and creates a backup:

```ts
const token = await getInstallationAccessToken(
  options.env,
  options.installationId,
  repoName ? { repositories: [repoName] } : undefined,
);
const repoUrl = `https://x-access-token:${token}@github.com/${options.githubRepo}.git`;

await sandbox.gitCheckout(repoUrl, {
  targetDir: WORKSPACE_PATH,
  cloneTimeoutMs: CLONE_TIMEOUT_MS,
});

await scrubGithubRemote(sandbox, WORKSPACE_PATH, publicRepoUrl);
await installDependencies(sandbox);
```

`src/lib/project-sandbox.ts:159-166` does not inspect remote state when the
workspace already exists:

```ts
const hydrated = await isSandboxWorkspaceHydrated({ env: options.env, sandboxId });
if (hydrated) {
  return { project: options.project, state: "connected" };
}
```

Do not add unconditional fetch/pull behavior to `ensureProjectSandbox`. That
function is used for wake/hydrate and status-oriented requests, while this
requirement is specifically the base-selection boundary for a new session.

### Session branches use the current local HEAD

`src/lib/session-worktree.ts:38-69` returns an existing worktree immediately,
but a new worktree resolves the primary clone's current local SHA and creates a
branch from it without contacting GitHub:

```ts
if (existing?.branchName && existing.workspacePath) {
  const pathCheck = await sandbox.exists(existing.workspacePath);
  if (pathCheck.exists) {
    return { /* persisted session metadata */ };
  }
}

const headResult = await execOrThrow(sandbox, "git rev-parse HEAD", {
  cwd: WORKSPACE_PATH,
  timeout: GIT_COMMAND_TIMEOUT_MS,
  errorPrefix: "Failed to resolve primary HEAD",
});

await execOrThrow(
  sandbox,
  `git show-ref --verify --quiet refs/heads/${quotedBranch} || git branch ${quotedBranch} HEAD`,
  /* ... */
);
```

The three production callers are:

- `src/routes/api.agent.stream.ts:225-234` - first agent message and normal chat path.
- `src/lib/agent-git-handler.ts:104-113` - agent callback git path.
- `src/integrations/trpc/routers/session-git.ts:109-118` - UI session-git path.

All three already load a linked project with `githubRepo`,
`githubInstallationId`, and `sandboxId`; thread those values into the worktree
ensure call instead of looking them up again.

### Credentials and command errors

Match the existing GitHub export security pattern:

- `src/lib/github-app.ts:17-43` scopes installation tokens to the repository
  short name through `repositoryNameFromSlug`.
- `src/lib/session-git.ts:347-399` uses a tokenized URL for one network git
  operation, passes the exact token to error redaction, and scrubs both remotes
  in `finally`.
- `src/lib/secret-redaction.ts:18-31` supports exact-value redaction through
  `redactSecrets(text, secrets)`.
- `src/lib/github-export.ts:510-518` is the established shell-quoting and exact
  redaction exemplar for GitHub git commands.

`src/lib/sandbox-bootstrap.ts:84-105` currently calls `redactSecrets` without
an exact secret list. Extend its `execOrThrow` options with an optional
`secrets?: readonly string[]` and pass that list to `redactSecrets`; existing
callers must remain source-compatible.

### Shared dependency installation

`src/lib/session-worktree.ts:85-98` symlinks each worktree's `node_modules` to
`/workspace/node_modules`. `bootstrapSandbox` and `restoreSandboxWorkspace`
already call `installDependencies`. A remote fast-forward can change manifests
or lockfiles, so a successful fast-forward must refresh the primary dependency
installation before the session worktree is created. If installation fails,
session creation must fail rather than run the agent with mismatched packages.

### Product and architecture constraints

`PRODUCT.md` says users should understand which repo, environment, and branch
they are working with, and that AI actions should remain inspectable.
`docs/architecture/agent-harness.md` establishes these constraints:

- One primary `/workspace` clone per project.
- Per-session branches/worktrees under `/workspace/.ditto/worktrees/<sessionId>`.
- Existing sessions remain isolated on their established branches.
- GitHub App installation tokens are minted per operation and are never stored
  in D1, job files, SSE, environment variables, or persisted remote URLs.

## Normative behavior

Implement these rules exactly:

1. Synchronization runs inside `ensureSessionWorktree` only when the session
   does not yet have an established `branchName`. Returning an existing
   worktree remains network-free. Recreating a missing worktree for a session
   that already has a branch also remains pinned to that branch; do not rebase,
   merge, reset, or otherwise move it.
2. The synchronized branch is the primary clone's currently checked-out branch
   (`git symbolic-ref --quiet --short HEAD`). Do not call the GitHub API to
   discover or switch to a newly configured default branch in this plan.
3. Ignore untracked files when deciding whether the primary clone is clean.
   `.ditto/project-memory.md` and `.ditto/worktrees` are application state.
   Reject staged or unstaged changes to tracked files before fetching or
   merging. Use `git status --porcelain --untracked-files=no`; any non-empty
   output is a blocking tracked change.
4. Mint a short-lived installation token scoped to the linked repository. Use
   it only in a one-shot fetch URL; never set a tokenized URL as `origin`, put
   it in process environment, persist it, or expose it in errors.
5. Fetch only the current primary branch into its exact tracking ref. Equivalent
   command shape (quote the URL and refspec with the existing helper):

   ```bash
   git fetch --no-tags <tokenized-url> \
     +refs/heads/<branch>:refs/remotes/origin/<branch>
   ```

   Do not use `git pull`; fetch and fast-forward are separate so unsafe states
   can be classified before the primary working tree changes.
6. Compare `HEAD` with `refs/remotes/origin/<branch>`:

   - Equal: no merge and normally no dependency install; continue. If the
     dependency retry signal from rule 7 exists, retry installation before
     continuing and clear the signal only on success.
   - Local `HEAD` is an ancestor of remote: run
     `git merge --ff-only refs/remotes/origin/<branch>`, refresh dependencies,
     verify `HEAD` now equals the fetched SHA, then continue.
   - Remote is an ancestor of local: reject with an actionable message that the
     sandbox base has unpublished local commits. Do not reset or force-update.
   - Neither is an ancestor: reject as diverged. Do not merge, rebase, or reset.

7. If a fast-forward succeeds but dependency installation fails, surface the
   failure and leave a retry signal under `/workspace/.ditto` so the next fresh
   session retries installation even though `HEAD` already equals the remote
   SHA. Remove the signal only after installation succeeds. The signal must not
   contain credentials. This avoids silently treating a partially completed
   sync as healthy.
8. Always scrub `origin` back to
   `https://github.com/<owner>/<repo>.git` in `finally`, even though the normal
   fetch command does not mutate the remote. Redact the exact token from all
   thrown command output.
9. The returned `baseCommitSha` and the new `ditto/session-*` branch must use
   the synchronized primary `HEAD`.
10. A fetch/auth/network failure blocks creation of a fresh session worktree.
    Do not silently fall back to stale local `HEAD`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `pnpm test -- src/lib/sandbox-bootstrap.test.ts src/lib/session-worktree.test.ts` | all tests pass |
| Related tests | `pnpm test -- src/lib/project-sandbox.test.ts src/lib/session-git.test.ts src/lib/agent-git-handler.test.ts` | all tests pass |
| Static checks | `pnpm check` | exit 0, no Biome errors |
| Typecheck | `pnpm exec tsc --noEmit` | exit 0, no TypeScript errors |
| Full tests | `pnpm test` | all tests pass |

Do not run `pnpm format` or `pnpm fix`; they write broadly. Use the focused
Biome command on in-scope files if formatting is needed.

## Scope

**In scope** (the only source/docs files to modify):

- `src/lib/sandbox-bootstrap.ts`
- `src/lib/sandbox-bootstrap.test.ts`
- `src/lib/session-worktree.ts`
- `src/lib/session-worktree.test.ts`
- `src/routes/api.agent.stream.ts`
- `src/lib/agent-git-handler.ts`
- `src/integrations/trpc/routers/session-git.ts`
- `docs/architecture/agent-harness.md`
- `plans/README.md` (status only after execution)

**Out of scope**:

- Fetching on every `ensureProjectSandbox` call or page load.
- Pulling changes into existing `ditto/session-*` branches.
- Rebasing, merging, or resetting existing session worktrees.
- Automatically switching the primary clone when GitHub's default branch name
  changes after import.
- Importing unpushed changes from a user's local computer.
- UI controls, sync-status indicators, toasts, or conflict-resolution flows.
- Schema/migration changes or storing remote SHAs/timestamps in D1.
- Changing backup cadence; the normal post-agent-run backup will persist the
  synchronized primary clone and new worktree.
- A new project-wide concurrency/mutex system. Existing first-worktree creation
  already lacks an application mutex; preserve that boundary and document the
  residual race in maintenance notes.

## Git workflow

- Branch: `advisor/010-sync-session-base`
- Use conventional commits matching the repository, for example
  `fix(workspace): sync base before session worktree`.
- Keep implementation/tests together unless the operator asks for smaller
  commits.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add failing tests for primary repository synchronization

Extend `src/lib/sandbox-bootstrap.test.ts` using its existing `makeSandbox`
command-aware mock and mocked `getInstallationAccessToken`.

Add tests that prove:

1. An unchanged clean branch fetches with a repository-scoped installation
   token, leaves `HEAD` unchanged, skips dependency installation, returns the
   fetched SHA, and scrubs `origin` in `finally`.
2. A behind branch fast-forwards to the fetched remote SHA before returning and
   refreshes dependencies exactly once.
3. Tracked staged or unstaged changes reject before token mint/fetch; untracked
   `.ditto` state does not reject.
4. A locally ahead branch rejects without merge/reset.
5. A diverged branch rejects without merge/rebase/reset.
6. Fetch failure includes no raw installation token in the thrown message and
   still runs remote scrubbing.
7. Dependency-install failure after fast-forward leaves the retry signal; a
   second call at equal `HEAD` retries installation and clears the signal on
   success.
8. A detached primary `HEAD` rejects with an actionable error before fetch.

Name the new helper `syncPrimaryWorkspaceFromGitHub` unless the live code has a
newer established name for this exact operation. Its result should expose at
least `{ branchName, headSha, updated }` so worktree tests can assert the base
without parsing implementation details.

**Verify**:
`pnpm test -- src/lib/sandbox-bootstrap.test.ts` -> new tests fail because the
helper/behavior does not exist; existing tests remain green.

### Step 2: Implement the non-destructive fetch/fast-forward helper

In `src/lib/sandbox-bootstrap.ts`:

1. Extend `execOrThrow` with optional exact-secret redaction while preserving
   all existing callers.
2. Add `syncPrimaryWorkspaceFromGitHub` with inputs `env`, `sandboxId`,
   `githubRepo`, and `installationId`.
3. Implement the exact state machine in "Normative behavior". Use
   `getInstallationAccessToken`, `repositoryNameFromSlug`, `WORKSPACE_PATH`,
   `installDependencies`, `scrubGithubRemote`, and the existing shell quoting
   convention; do not create a second GitHub auth abstraction.
4. Keep command timeouts at the existing 120-second git timeout. Dependency
   installation continues to use `INSTALL_TIMEOUT_MS` through
   `installDependencies`.
5. Ensure the retry signal handles the partial state where fast-forward
   succeeded but dependency installation did not. The signal should be an
   implementation detail, not part of the public result.

Do not use `git reset --hard`, `git checkout`, `git pull`, or a regular merge.

**Verify**:
`pnpm test -- src/lib/sandbox-bootstrap.test.ts` -> all bootstrap and sync tests
pass, and the token-redaction assertion passes.

### Step 3: Make fresh worktree creation synchronize first

In `src/lib/session-worktree.ts`:

1. Extend `ensureSessionWorktree` inputs with required `githubRepo: string` and
   `installationId: number`.
2. Preserve the early return for an existing worktree before any token mint or
   network command.
3. Determine whether this is a genuinely fresh session from the absence of
   `existing?.branchName`. Only for that case, call
   `syncPrimaryWorkspaceFromGitHub` before `git rev-parse HEAD` and before the
   `git branch ... HEAD` command.
4. If metadata has an established branch but its worktree directory is missing,
   follow the existing recovery path without synchronization. Do not move the
   established branch.
5. Continue resolving `baseCommitSha` from primary `HEAD` for a fresh session
   after synchronization.

Extend `src/lib/session-worktree.test.ts` to prove:

- Fresh creation calls sync before resolving `HEAD` and branch creation, and
  returns the synchronized SHA.
- Existing worktree reuse performs no sync/network operation.
- Missing worktree recovery for an established session performs no sync and
  reuses the established branch behavior.
- Sync failure creates neither a session branch nor a worktree.

Mock `syncPrimaryWorkspaceFromGitHub` through the existing
`#/lib/sandbox-bootstrap` module mock. Do not make unit tests perform network
calls.

**Verify**:
`pnpm test -- src/lib/session-worktree.test.ts` -> all worktree tests pass.

### Step 4: Thread repository identity through every caller

Update all three production call sites:

- `src/routes/api.agent.stream.ts`: pass `ensuredProject.githubRepo` and
  `ensuredProject.githubInstallationId`. Add an explicit narrowing guard if
  TypeScript does not preserve the earlier project validation; do not use a
  broad non-null assertion to hide a missing linked repository.
- `src/lib/agent-git-handler.ts`: pass the already validated
  `project.githubRepo` and `project.githubInstallationId`.
- `src/integrations/trpc/routers/session-git.ts`: pass the already validated
  project values after `authorizeGitHubRepositoryAccess`.

Do not duplicate synchronization in the callers. `ensureSessionWorktree` owns
the invariant so a future caller cannot accidentally create a stale-base
worktree.

**Verify**:

```bash
pnpm exec tsc --noEmit
pnpm test -- src/lib/agent-git-handler.test.ts src/lib/session-git.test.ts
```

Expected: exit 0 and all related tests pass. Update mocks only where the new
required options are asserted; do not weaken existing assertions.

### Step 5: Document the session-base synchronization contract

Update `docs/architecture/agent-harness.md` in "Runtime path", "Concurrency",
"Git export", and/or "Security notes" with concise statements that:

- Before the first worktree for a session, Ditto fetches and fast-forwards the
  primary clone's current branch from GitHub.
- Existing session branches remain pinned and are never updated automatically.
- Only pushed GitHub changes are visible; local unpushed developer changes are
  outside the sandbox's knowledge.
- A short-lived repository-scoped installation token is used for the one-shot
  fetch and is not persisted in a remote, D1, job files, SSE, or env vars.
- Dirty/ahead/diverged primary state blocks fresh session creation instead of
  being overwritten.

Do not add UI documentation or promise automatic conflict resolution.

**Verify**:
`rg -n "fetch|fast-forward|existing session|unpushed" docs/architecture/agent-harness.md`
-> the new contract is discoverable in the architecture document.

### Step 6: Run the complete verification gate

Run:

```bash
pnpm test
pnpm check
pnpm exec tsc --noEmit
git diff --check
git status --short
```

Expected:

- All Vitest tests pass.
- Biome and TypeScript exit 0.
- `git diff --check` prints nothing.
- `git status --short` lists only the in-scope implementation files plus the
  pre-existing user change in `src/components/ai-chat.tsx`; do not alter or
  revert that file.

## Test plan

| Case | Test file | Required assertion |
|---|---|---|
| Remote unchanged | `src/lib/sandbox-bootstrap.test.ts` | fetch occurs; no merge/install |
| Remote one or more commits ahead | same | `--ff-only`, install, final SHA |
| Tracked primary changes | same | rejects before network; no destructive command |
| Local primary ahead | same | rejects; no reset/merge |
| Primary and remote diverged | same | rejects; no reset/rebase/merge |
| Detached primary branch | same | rejects before fetch |
| Fetch/auth error | same | exact token absent from error; scrub runs |
| Install fails after fast-forward | same | retry signal causes install on next call |
| Fresh session worktree | `src/lib/session-worktree.test.ts` | sync precedes base SHA/branch creation |
| Existing session worktree | same | no sync/network call |
| Missing established worktree | same | recovery does not move/fetch session branch |
| Sync failure | same | no branch/worktree created |

No live GitHub, Docker, Cloudflare Sandbox, or D1 integration test is required.
The command sequencing and state classification must be deterministic in the
unit mocks.

## Done criteria

- [ ] A fresh session fetches the primary clone's current branch before its
      `ditto/session-*` branch is created.
- [ ] `workspace_sessions.baseCommitSha` receives the synchronized SHA through
      the existing persistence path.
- [ ] Existing session branches and worktrees perform no automatic fetch,
      merge, rebase, or reset.
- [ ] Dirty tracked, ahead, and diverged primary states fail without data loss.
- [ ] A fast-forward refreshes shared dependencies, including retry after a
      partial install failure.
- [ ] Installation tokens are repository-scoped, exactly redacted from errors,
      and absent from persisted remotes/env/D1/job/SSE state.
- [ ] Fetch/auth/network failures do not silently fall back to stale `HEAD`.
- [ ] All three `ensureSessionWorktree` production callers pass repository
      identity explicitly.
- [ ] Architecture docs explain pushed versus unpushed changes and fresh versus
      existing session behavior.
- [ ] `pnpm test`, `pnpm check`, `pnpm exec tsc --noEmit`, and
      `git diff --check` all exit 0.
- [ ] No out-of-scope files are modified; the pre-existing
      `src/components/ai-chat.tsx` change is preserved untouched.
- [ ] Plan 010 is marked DONE in `plans/README.md` after implementation review.

## STOP conditions

Stop and report back if:

- The primary clone is intentionally expected to contain tracked user edits or
  local commits; this plan assumes session agents edit worktrees, not
  `/workspace` itself.
- Product intent is to base a new session on an unmerged remote
  `ditto/session-*` branch rather than the primary clone's current branch.
- The GitHub App installation lacks repository Contents read access; do not
  substitute a user's OAuth token or expose credentials to the agent runner.
- Fast-forwarding the primary clone breaks existing linked worktrees in a real
  sandbox test; do not delete/recreate existing session branches as a workaround.
- Correct implementation requires `git reset --hard`, force checkout, or
  automatic rebase/merge of local commits.
- The sandbox cannot reliably create/read/remove the dependency retry signal
  under `/workspace/.ditto`; do not silently omit partial-sync recovery.
- Concurrent fresh-session creation demonstrably corrupts the primary git
  operation rather than merely returning a retryable lock error. That requires
  a separate project-level serialization design, not an improvised lock in this
  plan.
- Any in-scope code has drifted such that the excerpts or caller list are no
  longer accurate.

## Maintenance notes

- New sessions follow updates pushed to the primary clone's current remote
  branch. They do not automatically include unmerged Ditto PR branches.
- If Ditto later lets users choose a base branch, that selection must replace
  the current-primary-branch rule in both fetch and session metadata.
- If GitHub's default branch can be renamed after import, add an explicit
  product flow for switching the primary clone; do not infer it during session
  creation.
- Reviewers should scrutinize command quoting, exact token redaction, the
  `finally` scrub, and the ordering `fetch -> classify -> ff-only -> install ->
  resolve base -> create branch`.
- Concurrent first messages for different sessions still share the primary git
  repository and dependency directory. Existing architecture defers a
  project-level mutex; monitor lock failures and plan serialization if they
  occur in production.
- Post-agent-run backup already snapshots `/workspace`, including updated
  remote refs and worktrees. A separate pre-run backup is intentionally not
  added here.
