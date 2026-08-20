# Move runtime ownership to workspace sessions

Status: TODO

Written against commit `62c99b4`. Complete plan 005 first.

Before editing, compare the current commit and target spec with plan 001's
recorded values. Read drift across every caller listed in scope. Stop if a
project is again intended to own a persistent runtime.

## Goal

Give each workspace session its own sandbox identity, filesystem, process table,
localhost namespace, branch checkout, and lifecycle generation. Replace the
shared project sandbox and Git worktree interface for new workspace sessions.

## Current state

`workspace_sessions` stores a branch, base commit, worktree path, and preview
port. `projects` stores the sandbox ID and backup fields. Callers repeatedly
pass both a project sandbox ID and a session worktree path into agent, Git,
control, and preview modules.

`session-worktree.ts` exposes this shallow option set:

```ts
type EnsureSessionWorkspaceReadyOptions = {
	env: Env;
	sandboxId: string;
	sessionId: string;
	githubRepo: string;
	installationId: number;
	projectId: string;
	userId: string;
	/* ... */
};
```

## Files in scope

- `apps/web/src/db/schema.ts`, migration, and Drizzle metadata
- new `apps/web/src/lib/workspace-runtime.ts` and tests
- `apps/web/src/lib/workspace-session.ts` and tests
- `apps/web/src/lib/session-worktree.ts` and tests
- `apps/web/src/lib/session-workspace-lock.ts` and tests
- `apps/web/src/lib/sandbox-bootstrap.ts` and tests
- agent run and control modules and tests
- session Git, metadata, and UI-action modules and tests
- preview module and tests only to resolve the session sandbox rather than the
  project sandbox; checkpoint deferral comes later
- workspace, project, session-Git, and preview tRPC routers and tests
- workspace status and client types that currently report project sandbox state
- `CONTEXT.md` and affected architecture docs

Do not switch model credentials, agent Git callbacks, network Git push, recovery
checkpointing, capacity queueing, or idle shutdown in this plan.

## WorkspaceRuntime interface

Callers identify an owned workspace session and a purpose. They do not pass raw
sandbox IDs, D1 rows, generation numbers, or filesystem paths.

The module returns a trusted runtime lease that contains the narrow Sandbox
adapter required by the caller. The lease records identity and lifecycle
generation internally and closes in `finally`.

At minimum, support these purposes:

- agent run
- agent control
- local Git read
- mutating Git
- Git metadata
- preview
- backup or restore

Do not expose a generic `getSandbox()` from the new module. Keep low-level SDK
construction private so callers cannot bypass identity, lifecycle, or ownership
checks.

## Durable lifecycle

Persist `unprovisioned`, `queued`, `provisioning`, `restoring`, `ready`,
`failed`, `destroying`, and `destroyed`. Each transition uses an expiring lease
and compare-and-set guard. Store a reason code for failure.

This plan may provision synchronously without the global capacity queue. It
must still model `queued` so plan 011 can attach durable work without a schema
rewrite.

Before restore or runtime replacement:

1. Close every open authority operation.
2. Increment the lifecycle generation in D1.
3. Update the trusted outbound handler parameters.
4. Restore the compatible project seed.
5. Fetch the current remote default branch through the broker.
6. Freeze that commit as `baseCommitSha`.
7. Create the session branch in the session sandbox's `/workspace` checkout.
8. Mark the runtime `ready` only after Git state and the baked runner pass.

Extend plan 005's Git-fetch adapter to `workspace_session` identities. Bind the
operation to the owned repository and exact default branch. Do not reuse a
builder operation or identity.

Existing workspace sessions never update `baseCommitSha` automatically.

## Caller migration

1. Create or resolve the workspace session before runtime preparation.
2. Route every agent, control, Git, metadata, and preview call through
   `WorkspaceRuntime`.
3. Run commands from `/workspace`; remove per-session worktree creation and
   shared `node_modules` symlinks for the new path.
4. Keep the workspace-session write lock. Its lock path may become fixed inside
   one sandbox because each sandbox contains only one writable session.
5. Resolve project environment values only for the agent command. Keep them out
   of control, preview, Git, backup, restore, and container environments.
6. Keep stable preview capability URLs mapped to the session sandbox ID.
7. Preserve assistant terminal settlement, SSE streaming, follow-up, Stop, Git
   status, commit, sync, push orchestration, and pull-request creation.

## Tests

Prove through the `WorkspaceRuntime` interface:

- two sessions for one project receive different sandbox IDs, filesystems,
  process tables, and localhost namespaces
- one session resolves the same durable identity after a Worker restart
- lifecycle generation increments before restore or replacement
- an old generation cannot open an authority operation
- seed restore and latest-default-branch fetch produce one frozen base commit
- existing sessions preserve their base commit
- only agent commands receive project environment values
- agent control targets the session sandbox and exact run socket
- session Git no longer reads or mutates another session's checkout
- preview resolves the session sandbox and keeps its stable capability URL

Delete worktree tests only after equivalent behavior tests exist at the runtime
interface.

## Verification

```bash
pnpm db:generate
pnpm --filter @ditto/web test -- src/lib/workspace-runtime.test.ts src/lib/workspace-session.test.ts src/lib/session-worktree.test.ts src/lib/agent-run-service.test.ts src/lib/agent-control-service.test.ts src/lib/session-git.test.ts src/lib/session-preview.test.ts
pnpm typecheck
pnpm build
pnpm verify
```

Run the local isolation test with two sessions in one project. Expected result:
each session can create the same filename and bind the same localhost port
without observing or blocking the other.

## Done criteria

- New workspace sessions own the runtime identity and sandbox.
- All new runtime callers cross `WorkspaceRuntime`.
- Project rows no longer receive sandbox IDs for new imports.
- Shared project worktrees are absent from the new path.
- Identity and lifecycle checks precede every sandbox operation.

## Maintenance note

New runtime uses belong inside `WorkspaceRuntime`. Reviewers should reject a new
raw `getSandbox()` call in routes, UI modules, or workflow modules.

## Stop conditions

- If any caller still requires a raw project sandbox ID, stop and move that
  behavior into `WorkspaceRuntime` rather than exposing the ID.
- If a session cannot restore without the stock backup path, stop and fix plan
  004. Do not reintroduce signed URLs.
- If brokered fetch is not reliable for the latest default branch, stop. Do not
  inject a GitHub token into the session sandbox.
