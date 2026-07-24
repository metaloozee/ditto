# Plan 030: Verify sandbox readiness while keeping D1 chat history visible

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer tells you they maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 6347ed1..HEAD -- \
>   apps/web/src/lib/sandbox-bootstrap.ts \
>   apps/web/src/lib/sandbox-bootstrap.test.ts \
>   apps/web/src/lib/project-sandbox.ts \
>   apps/web/src/lib/project-sandbox.test.ts \
>   apps/web/src/integrations/trpc/routers/workspace.ts \
>   apps/web/src/integrations/trpc/routers/workspace.test.ts \
>   'apps/web/src/routes/project.$projectId.tsx' \
>   'apps/web/src/routes/project.$projectId.test.tsx' \
>   apps/web/src/components/ai-chat.tsx \
>   apps/web/src/components/ai-chat.test.tsx \
>   apps/web/src/components/chat-navbar.tsx \
>   apps/web/src/components/chat-navbar.test.tsx \
>   apps/web/src/components/composer.tsx \
>   apps/web/src/components/composer.test.tsx \
>   apps/web/src/components/app-sidebar.tsx \
>   apps/web/src/components/app-sidebar.test.tsx \
>   docs/architecture/overview.md \
>   docs/architecture/frontend.md \
>   docs/architecture/server-and-data.md \
>   docs/architecture/agent-harness.md \
>   docs/architecture/repository-map.md \
>   plans/README.md
> ```
>
> Then run `git status --short` and `git diff --stat` so uncommitted drift is
> not hidden by `6347ed1..HEAD`. Ignore only this plan/index change when it is
> the dispatch input. If any implementation path changed, compare the
> "Current state" excerpts with live code before proceeding. A behavioral
> mismatch is a STOP condition.

## Status

- **Status**: TODO
- **Priority**: P1
- **Effort**: L
- **Risk**: MED - the change touches the project restore fence and the route
  state machine, but deliberately avoids a schema migration or a new runtime
  status store
- **Depends on**: Plan 014 (versioned backups), Plan 017 (agent lifecycle), and
  Plan 028 (session workspace readiness), all DONE
- **Category**: bug / direction
- **Planned at**: commit `6347ed1`, 2026-07-24

## Why this matters

D1 says whether a project was last provisioned successfully, but it cannot say
whether its Cloudflare container is still alive. A hibernated sandbox therefore
looks `ready` until a filesystem call discovers that its ephemeral workspace is
gone. Today the same long `workspace.ensureWorkspace` mutation also gates the
message query, so users see neither their durable D1 chat nor a clear workspace
status while restore runs. This plan makes runtime readiness explicit, keeps
history readable throughout wake/restore, disables sandbox-backed actions until
readiness is proven, and keeps the sidebar on its independent D1-only path.

## Locked design decisions

These decisions resolve the product ambiguities for the executor. Do not invent
another state store or broaden the feature.

1. **D1 remains authoritative for durable project/session/message state.** No
   schema change and no persisted `sandboxRuntimeStatus` column.
2. **Cloudflare runtime state is observed before any filesystem or command
   probe.** Use the installed Sandbox object's inherited `getState()` method.
   Do not call `start()` merely to check status.
3. **Runtime state interpretation**:
   - `healthy` and `running` are active candidates, not proof of workspace
     readiness. Verify both `/workspace/.git` and the baked runner as today.
   - `stopping`, `stopped`, and `stopped_with_code` are not usable. Enter the
     existing D1 `ready -> provisioning` compare-and-set restore path without
     first calling `exists` or `exec`.
   - An active candidate whose workspace is not hydrated also enters that same
     restore path.
4. **The current D1 `projects.status` compare-and-set remains the cross-request
   provisioning fence.** A caller that loses the compare-and-set observes
   `provisioning`; it must not mark the project failed.
5. **History is read-only during readiness work.** D1 messages remain visible,
   scrollable, pageable, and copyable. "Not interactable" means no action that
   needs or mutates the sandbox: no prompt/suggestion submission, model change,
   Git action, tools pane, or preview action.
6. **The status bar belongs to the workspace content, not `AppShell` or
   `AppSidebar`.** It is a normal flex row above the chat, not an absolute
   overlay over `ChatNavbar`.
7. **The sidebar remains D1-only.** It must not call `workspace.ensureWorkspace`,
   inspect a Sandbox stub, receive workspace-local pending props, or invalidate
   itself when a cold wake completes. A D1 `provisioning` project uses the
   normal folder icon in the sidebar; only the workspace status bar shows this
   transient loading treatment. The existing failed icon remains.
8. **No blanket `inert` or pointer-events overlay.** It would hide content from
   assistive technology and unnecessarily block D1 history pagination.
9. **No background `waitUntil` restore.** Provisioning remains an awaited tRPC
   mutation so a multi-minute restore is not detached from its request.
10. **No automatic stale-provisioning timeout in this plan.** The schema has no
    lease token or documented timeout. See Maintenance notes.

## Current state

All excerpts below were verified at `6347ed1`.

### Runtime readiness is inferred by calls that may wake the container

`apps/web/src/lib/project-sandbox.ts:229-247` calls file and command probes
before taking the D1 provisioning fence:

```ts
const [hydrated, runnerHealthy] = await Promise.all([
	isSandboxWorkspaceHydrated({ env: options.env, sandboxId }),
	isSandboxRunnerHealthy({ env: options.env, sandboxId }),
]);

if (hydrated) {
	return { project: options.project, state: "connected" };
}
```

Those helpers call `sandbox.exists` and `sandbox.exec` in
`apps/web/src/lib/sandbox-bootstrap.ts:440-460`. On a sleeping container those
operations can start a new empty runtime before Ditto records that D1's `ready`
value was stale.

The exact installed SDK supports a read-only lifecycle observation:

- `@cloudflare/sandbox@0.12.3` is pinned in `apps/web/package.json:21`.
- `Sandbox` extends `Container` in the installed declaration at
  `apps/web/node_modules/@cloudflare/sandbox/dist/sandbox-BhIQBik-.d.ts:2687-2690`.
- `Container.getState(): Promise<State>` is public in the installed transitive
  `@cloudflare/containers@0.3.7` declaration
  (`node_modules/.pnpm/@cloudflare+containers@0.3.7/node_modules/@cloudflare/containers/dist/lib/container.d.ts:78`).
- `Sandbox` extends `Container` at
  `apps/web/node_modules/@cloudflare/sandbox/dist/sandbox-BhIQBik-.d.ts:2688`.
- `State.status` is one of `running | stopping | stopped | healthy |
  stopped_with_code`.

Do not add `@cloudflare/containers` as an app dependency just to import `State`.
Infer or structurally narrow the return type through the Sandbox stub.

If `getState()` throws before the D1 provisioning fence is taken, propagate the
error. Do not treat it as a restore failure unless a later D1 reload shows
`status === "failed"`.

### The restore fence exists, but contention is reported as failure

`apps/web/src/lib/project-sandbox.ts:250-264` atomically changes a ready project
to provisioning:

```ts
const [lockedProject] = await options.db
	.update(projects)
	.set({ status: "provisioning", updatedAt: sql`(unixepoch())` })
	.where(
		and(
			eq(projects.id, options.project.id),
			eq(projects.userId, options.project.userId),
			eq(projects.status, "ready"),
		),
	)
	.returning();

if (!lockedProject) {
	throw new Error("Project sandbox is already being restored.");
}
```

`apps/web/src/integrations/trpc/routers/workspace.ts:75-93` catches every error
and returns `restoreFailed: true`, conflating normal lock contention, a runner
image problem, a transient SDK problem, and a restore that actually changed D1
to `failed`.

Also note that `markProjectRestoreFailed` and `storeReadyProjectBackup` currently
match only project/user (`project-sandbox.ts:128-169`). Their final writes must
be fenced to `status = provisioning` so stale work cannot overwrite a later
state.

### D1 messages wait for the long readiness mutation

`apps/web/src/routes/project.$projectId.tsx:74-88` already has an ownership-
checked D1 message query, but its `enabled` flag waits for the mutation payload:

```ts
enabled:
	Boolean(selectedSessionId) && canLoadWorkspace && Boolean(workspace),
```

The route also replaces the entire chat when ensure errors
(`project.$projectId.tsx:121-129`). This is why durable history disappears even
though `workspace.messages` itself does not touch the sandbox.

### Existing disablement is incomplete

`ProjectWorkspacePage` computes a `disabledReason` and passes it to `Chat`, but:

- `Composer` checks it before submit and disables model/thinking/submit controls,
  while the textarea at `composer.tsx:868-890` remains enabled.
- `ChatNavbar` passes `disabled={!hasSession}` to the tools trigger at
  `chat-navbar.tsx:103-107`; it ignores the workspace `disabled` prop.
- `Chat` sets `toolsEnabled = Boolean(projectId && sessionId)` at
  `ai-chat.tsx:622`, so an already-open preview pane remains mounted.
- Empty-chat suggestion buttons at `ai-chat.tsx:307-329` remain clickable.

### Sidebar ownership is already correct, presentation is not

`AppSidebarClient` uses only `trpc.projects.list` at
`apps/web/src/components/app-sidebar.tsx:438-444`. The server implementation at
`apps/web/src/integrations/trpc/routers/projects.ts:401-449` reads projects and
active sessions from D1 only. Preserve this boundary. The only required sidebar
change is removing the provisioning spinner in `ProjectStatusIcon`
(`app-sidebar.tsx:119-138`).

### Conventions to match

- Server state stays in React Query/tRPC; local display state stays in
  components (`docs/architecture/frontend.md:34-46`).
- Routes and UI orchestrate; shared lifecycle policy belongs in
  `apps/web/src/lib` (`docs/README.md:90`).
- Complex services use injected/mocked Sandbox and D1 doubles in colocated
  Vitest tests (`docs/architecture/server-and-data.md:254-261`).
- Product copy is calm and literal. Use `Preparing project sandbox...` in source
  if ASCII is required by the edited file, or match the file's existing
  typographic ellipsis. Do not use playful AI copy.
- Formatting uses tabs and double quotes (`biome.json`).
- Product styling uses existing semantic tokens (`bg-background`, `border`,
  `text-muted-foreground`, `text-destructive`) rather than new colors.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install, only if dependencies are absent | `pnpm install --frozen-lockfile` | exit 0; lockfile unchanged |
| Focused tests | `pnpm --filter @ditto/web exec vitest run src/lib/sandbox-bootstrap.test.ts src/lib/project-sandbox.test.ts src/integrations/trpc/routers/workspace.test.ts 'src/routes/project.$projectId.test.tsx' src/components/ai-chat.test.tsx src/components/chat-navbar.test.tsx src/components/composer.test.tsx src/components/app-sidebar.test.tsx` | all listed files pass |
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Check | `pnpm check` | exit 0; existing warning-only diagnostics are allowed, no new diagnostics in in-scope files |
| App tests | `pnpm test` | exit 0; full suite green (planning-time baseline was 596) |
| Full pre-PR gate | `pnpm verify` | exit 0: check, app typecheck/tests/build, and runner verify all pass |
| Diff hygiene | `git diff --check` | no output, exit 0 |

Planning-time verification at `6347ed1`: `pnpm typecheck` passed; `pnpm check`
exited 0 with 32 pre-existing warnings; the five directly relevant existing
test files passed 40 tests; the complete app suite passed 596 tests. The route
plugin emits known warnings for route-adjacent `*.test.ts` files; warnings alone
are not failures.

## Suggested executor toolkit

- Use `workers-best-practices` if available when changing the Sandbox/Worker
  lifecycle boundary.
- Use `vercel-react-best-practices`, `baseline-ui`, and `fixing-accessibility` if
  available for the route/status-bar and disabled-state work.
- Read current Cloudflare Sandbox docs, but treat the pinned 0.12.3 declarations
  above as the API authority for this implementation.

## Scope

**In scope (the only files you may modify):**

- `apps/web/src/lib/sandbox-bootstrap.ts`
- `apps/web/src/lib/sandbox-bootstrap.test.ts`
- `apps/web/src/lib/project-sandbox.ts`
- `apps/web/src/lib/project-sandbox.test.ts`
- `apps/web/src/integrations/trpc/routers/workspace.ts`
- `apps/web/src/integrations/trpc/routers/workspace.test.ts`
- `apps/web/src/routes/project.$projectId.tsx`
- `apps/web/src/routes/project.$projectId.test.tsx` (create)
- `apps/web/src/components/ai-chat.tsx`
- `apps/web/src/components/ai-chat.test.tsx`
- `apps/web/src/components/chat-navbar.tsx`
- `apps/web/src/components/chat-navbar.test.tsx`
- `apps/web/src/components/composer.tsx`
- `apps/web/src/components/composer.test.tsx`
- `apps/web/src/components/app-sidebar.tsx`
- `apps/web/src/components/app-sidebar.test.tsx`
- `docs/architecture/overview.md`
- `docs/architecture/frontend.md`
- `docs/architecture/server-and-data.md`
- `docs/architecture/agent-harness.md`
- `docs/architecture/repository-map.md`
- `plans/README.md` (status only after execution)

**Out of scope (do not touch, even if related):**

- `apps/web/src/db/schema.ts` and all migrations; this plan adds no persisted
  runtime status or lease.
- `apps/web/src/integrations/trpc/routers/projects.ts`; its sidebar list is
  already D1-only.
- `apps/web/src/components/app-shell.tsx`; the bar is workspace-local.
- `apps/web/src/components/session-preview*` and `session-git-actions*`; suppress
  or disable them through existing parent props instead of changing their
  internal policies.
- Agent stream/control, session worktree, Git, backup generation semantics, or
  sandbox sleep duration/keep-alive configuration.
- Dependency versions, lockfiles, generated route tree, styles.css, or a new UI
  primitive.
- Dashboard project-card status presentation. The requirement is sidebar-only.
- A stale-provisioning lease/timeout or automatic crash recovery migration.

## Git workflow

- Branch: `advisor/030-sandbox-readiness-loading`
- Prefer three logical commits:
  1. `fix(sandbox): observe runtime before restore`
  2. `fix(workspace): show chat during sandbox wake`
  3. `docs(workspace): document cold-wake readiness`
- Do not push or open a PR unless the operator explicitly requests it.

## Steps

### Step 1: Add a side-effect-free Sandbox lifecycle observation

In `apps/web/src/lib/sandbox-bootstrap.ts`, add one exported helper adjacent to
`getProjectSandbox`, named `getProjectSandboxState` (or an equally narrow name).
It must:

1. obtain the stub through existing `getProjectSandbox(env, sandboxId)` so RPC
   transport and `enableDefaultSession: false` remain unchanged;
2. call and return `await sandbox.getState()`;
3. perform no `exists`, `exec`, `start`, restore, backup, session creation, or
   D1 work; and
4. avoid a direct type import from transitive `@cloudflare/containers`.

Extend `apps/web/src/lib/sandbox-bootstrap.test.ts` using its existing hoisted
`getSandboxMock` and `makeSandbox` pattern. Add `getState` to the fake and prove:

- a `healthy` result is returned unchanged;
- a stopped result (include `stopped_with_code`) is returned unchanged; and
- calling the helper invokes only `getState`, not `exists`, `exec`, or `start`.

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/lib/sandbox-bootstrap.test.ts
```

Expected: the file passes, including the new no-wake lifecycle tests.

### Step 2: Make `ensureProjectSandbox` lifecycle-aware and contention-safe

Update `apps/web/src/lib/project-sandbox.ts` without changing its external
success states (`connected`, `restored_from_backup`,
`recreated_from_github`).

1. Export a narrow `ProjectSandboxProvisioningError extends Error` with a fixed
   message such as `Project sandbox is already being restored.` This error means
   another request owns or won the D1 provisioning fence; it is not a terminal
   restore failure. Keep it a real exported class (not a string tag) so router
   `instanceof` checks work across the module boundary.
2. Call `getProjectSandboxState` before `isSandboxWorkspaceHydrated` or
   `isSandboxRunnerHealthy`. If it throws, propagate; do not mark failed and do
   not call hydration/runner probes.
3. Apply this ordered decision tree after a successful state observation:

   | Condition | Action |
   |---|---|
   | status is `stopping`, `stopped`, or `stopped_with_code` | skip pre-lock probes; enter CAS restore path |
   | status is `healthy` or `running`, and runner is **not** healthy | throw the existing actionable invalid-runner error; **no D1 write** |
   | status is `healthy` or `running`, runner healthy, workspace **not** hydrated | enter CAS restore path |
   | status is `healthy` or `running`, runner healthy, workspace hydrated | return `{ state: "connected", project }` with no D1 write |
   | unknown status | STOP and report (do not invent a mapping) |

4. For the CAS restore path: use the existing `ready -> provisioning`
   compare-and-set, then the existing restore/bootstrap path. Do not add a
   standalone `sandbox.start()` call. Let restore/bootstrap wake the runtime.
5. If the compare-and-set returns no row, throw
   `ProjectSandboxProvisioningError`; do not mark failed.
6. Add `eq(projects.status, "provisioning")` to both
   `markProjectRestoreFailed` and `storeReadyProjectBackup` update predicates.
   - ready-store returns no row → throw (do not claim success).
   - failed-write returns no row → swallow as a no-op (another actor already
     moved the row); still rethrow the original restore error to the caller.
7. Preserve backup-first fallback behavior, GitHub authorization/token handling,
   dependency install, post-restore hydration/runner validation, backup
   serialization, and all public error copy not explicitly changed here.

Extend `apps/web/src/lib/project-sandbox.test.ts`:

1. Add a hoisted `getProjectSandboxStateMock` and include it in the existing
   `vi.mock("#/lib/sandbox-bootstrap", …)` factory (today the mock only lists
   hydration/runner/backup/bootstrap helpers at lines 10–16). Default it per
   test case. Assert it is called **before** hydration/runner probes when those
   probes run, and that stopped paths never call the pre-lock probes.
2. Update the fake D1 so final `failed` and ready+backup writes succeed only
   when `state.project.status === "provisioning"`; otherwise return `[]`. Keep
   the existing ready→provisioning CAS gate that rejects when status is not
   `ready`.

Required cases:

- `healthy` + hydrated + runner healthy → `connected`, no D1 update;
- `running` + hydrated + runner healthy → `connected`;
- `stopping`, `stopped`, and `stopped_with_code` → no pre-lock probe; CAS +
  restore/recreate succeeds;
- active + `!runnerHealthy` → throws invalid-runner; no D1 write even if
  unhydrated;
- active + runner healthy + unhydrated → CAS restore path;
- compare-and-set loss → `ProjectSandboxProvisioningError`; never writes
  `failed`;
- restore failure writes `failed` only while the row remains `provisioning`;
- a stale failure/ready completion cannot overwrite a row that left
  `provisioning`;
- existing backup fallback, invalid runner, versioned backup, and GitHub
  recreation tests remain green.

Do not add sleeps or real timers to domain tests; use deferred promises and
stateful fakes as the file already does.

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/lib/project-sandbox.test.ts
```

Expected: all lifecycle, contention, restore, and versioned-backup tests pass.

### Step 3: Report provisioning separately from terminal restore failure

Refine `ensureProjectWorkspace` in
`apps/web/src/integrations/trpc/routers/workspace.ts`.

1. Give `sandboxState` this concrete union (not bare `string`):

   ```ts
   type WorkspaceSandboxState =
     | "connected"
     | "restored_from_backup"
     | "recreated_from_github"
     | "provisioning"
     | "failed";
   ```

2. Preserve the fast D1 result for projects already marked `provisioning` or
   `failed`.
3. Catch `ProjectSandboxProvisioningError` separately. Reload the owned project
   row from D1 and apply exactly this bound:

   ```ts
   // Pseudocode inside the catch:
   const current = await reloadOwnedProject(...);
   if (current.status === "provisioning") {
     return { project: current, sandboxState: "provisioning", restoreFailed: false };
   }
   if (current.status === "failed") {
     return { project: current, sandboxState: "failed", restoreFailed: true };
   }
   // winner finished; one nested ensure only
   try {
     const ensured = await ensureProjectSandbox({ db, env, project: current });
     return { project: ensured.project, sandboxState: ensured.state, restoreFailed: false };
   } catch (nested) {
     if (nested instanceof ProjectSandboxProvisioningError) {
       return { project: current, sandboxState: "provisioning", restoreFailed: false };
     }
     // fall through to step 4 handling
     throw nested;
   }
   ```

   Never recurse beyond that single nested call.
4. For any other error, reload D1. Return `restoreFailed: true` only when D1 is
   actually `failed`. Otherwise rethrow so the route can show a retryable check
   error without lying that restore failed.
5. Keep project-secret stripping, ownership constraints, active-session reads,
   cursor paging, and session archival unchanged.
6. `retryRestore` already calls `loadWorkspaceView`; retain that single restore
   cycle. The browser will consume its returned workspace directly rather than
   starting a redundant second ensure.

**Critical test-mock fix.** Today
`apps/web/src/integrations/trpc/routers/workspace.test.ts:18-20` is:

```ts
vi.mock("#/lib/project-sandbox", () => ({
	ensureProjectSandbox: ensureProjectSandboxMock,
}));
```

After Step 2 exports `ProjectSandboxProvisioningError`, this partial mock makes
the class `undefined` and breaks `instanceof`. Replace it with either:

```ts
vi.mock("#/lib/project-sandbox", async (importOriginal) => {
	const actual = await importOriginal<typeof import("#/lib/project-sandbox")>();
	return {
		...actual,
		ensureProjectSandbox: ensureProjectSandboxMock,
	};
});
```

or re-export a real `class ProjectSandboxProvisioningError extends Error {}`
from the mock factory. Contention tests must
`throw new ProjectSandboxProvisioningError("…")`, not a plain `Error`.

Extend `workspace.test.ts` with stateful project fakes. Cover:

- a contention error plus current D1 `provisioning` returns
  `sandbox.state === "provisioning"` and `restoreFailed === false`;
- a real restore failure whose D1 row is `failed` returns `restoreFailed`;
- a generic check error while D1 remains `ready` rejects instead of pretending
  restore failed;
- a contention loser that reloads a now-ready row performs at most one nested
  `ensureProjectSandbox` call; a second contention returns `provisioning`;
- project secret fields remain omitted and no messages are added to the ensure
  payload.

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/integrations/trpc/routers/workspace.test.ts
```

Expected: all workspace ownership, pagination, archival, readiness, and retry
tests pass.

### Step 4: Decouple D1 history from sandbox readiness in the project route

Refactor `ProjectWorkspacePage` in
`apps/web/src/routes/project.$projectId.tsx`; do not move this orchestration into
`AppShell`.

#### Locked copy (use verbatim)

| Situation | `disabledReason` / bar copy |
|---|---|
| Checking or provisioning | `Project sandbox is being provisioned.` |
| Status bar while checking/provisioning | `Preparing project sandbox...` |
| Terminal D1 restore failure (bar + disable) | Keep existing restore-failed chrome; disable with `Project sandbox is not ready yet.` |
| Non-terminal ensure/check error while D1 ready | Disable with `Project sandbox is not ready yet.`; bar shows error message + `Retry` |
| Archived session after readiness succeeds | `This conversation is archived.` (unchanged) |
| Ready + usable | no bar; no `disabledReason` |

#### Decision table (derive UI from this only)

Let:

- `d1Status` = `projects.get` data status (`provisioning` \| `ready` \| `failed`)
- `matchingWorkspace` = latest matching mutation payload (see match rule below)
- `ensurePending` / `retryPending` = mutation pending flags
- `ensureError` = ensure mutation error when no newer matching success exists

Match rule for mutation data: `payload.project.id === projectId`, and when the
route has an explicit `sessionId`, either `payload.selectedSession?.id ===
sessionId` or (`payload.selectedSession === null` and the session is simply
missing/not active — still accept the payload for sandbox state, but do not
treat the session as selected). Prefer `retryRestoreMutation.data` when it
matches and is newer than ensure data; otherwise use matching ensure data.

| Condition | Status bar | `workspaceUsable` | `disabledReason` | Call `ensureWorkspace`? |
|---|---|---|---|---|
| `d1Status === "provisioning"` and no matching success | preparing bar | false | being provisioned | **no** (another restore owns the fence; poll `projects.get`) |
| `d1Status === "ready"` and ensure not yet settled (`!matchingWorkspace` or pending) | preparing bar | false | being provisioned | **yes** once per projectId/sessionId key |
| matching workspace `sandbox.state` is success and `d1Status === "ready"` and not pending | none | true* | none* | no |
| matching `restoreFailed` or `d1Status === "failed"` | restore-failed bar + Retry restore | false | not ready yet | no (until retry) |
| ensure error, D1 still ready, not pending | check-error bar + Retry | false | not ready yet | only on Retry click |
| matching workspace `sandbox.state === "provisioning"` | preparing bar | false | being provisioned | schedule one delayed re-ensure (below) |

\* After usable, still apply archived-session disable if selected session is
archived.

Success sandbox states are **only**:
`connected | restored_from_backup | recreated_from_github`.

#### Implementation rules

1. For an explicit session route, enable `workspace.messages` from the URL
   `sessionId` as soon as it is non-empty. Remove the current
   `canLoadWorkspace` gate and `Boolean(workspace)` from the message query
   `enabled` flag entirely. Do not replace them with another readiness gate.
   The server procedure already checks project/session/user ownership and only
   reads D1.
2. For the new-session route (no URL session ID), keep messages disabled. Do not
   invent a default session.
3. Fire `ensureWorkspace({ projectId, sessionId })` from a `useEffect` keyed on
   `projectId` + `sessionId` when `d1Status === "ready"` (including after a
   successful retry flips D1 back to ready). Do **not** fire it when D1 is
   already `provisioning` or `failed`.
4. Mutation `onSuccess` handlers: invalidate **`projects.get` only** for this
   project id. **Never** invalidate `projects.list`. Remove the current
   `projects.list` invalidations from ensure/retry success paths. Remove the
   immediate second `ensureWorkspace` call after retry success; consume
   `retryRestoreMutation.data` via the match/precedence rule above.
5. Configure `projects.get` with TanStack Query v5's callback form of
   `refetchInterval`: return `1_000` only while `query.state.data?.status ===
   "provisioning"`, otherwise `false`.
6. When a **matching** ensure/retry response has
   `sandbox.state === "provisioning"`, schedule **exactly one** follow-up
   `ensureWorkspace({ projectId, sessionId })` with a fixed `1_000` ms delay.
   Store the timer in a ref. Clear it on `projectId`/`sessionId` change,
   unmount, or when a later matching success/failure arrives. Do not schedule
   while a readiness mutation is already pending. Cap at one outstanding timer
   (no loops beyond: timer fires → mutation → if still provisioning, the next
   matching provisioning response may schedule again; that is intentional
   polling through the server, not a tight client loop).
7. Remove the full-page `ensureWorkspaceMutation.error` return. Once project
   metadata is loaded, always render the status bar (when needed) + `Chat`.
8. Keep the existing full-page project metadata pending/not-found states.

#### Status bar

Add a local `WorkspaceStatusBar` helper in the same route file. Do not create a
new primitive. Layout:

```tsx
<main className="flex h-dvh flex-col overflow-hidden bg-background">
  {bar ? <WorkspaceStatusBar ... /> : null}
  <div className="min-h-0 flex-1">
    <Chat ... />
  </div>
</main>
```

Bar behaviors:

- checking/provisioning: `role="status"`, `aria-live="polite"`, existing
  `Spinner`, copy `Preparing project sandbox...`;
- actual D1 restore failure: existing Retry restore button wired to
  `retryRestore`;
- non-terminal ensure/check error while D1 remains ready: `role="alert"` plus a
  `Retry` button that calls `ensureWorkspace`;
- ready/usable: render no bar.

Use existing border/background/text tokens. Do not position the bar absolutely.

#### Route test

Create `apps/web/src/routes/project.$projectId.test.tsx` with
`/** @vitest-environment jsdom */`. Pattern after
`apps/web/src/components/composer.test.tsx` and
`apps/web/src/components/ai-chat.test.tsx` (hoisted mocks, stub child). Minimal
scaffold:

```tsx
/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
// hoisted: useQuery/useMutation/useInfiniteQuery/useQueryClient captures
// mock Chat to render data-testid with disabledReason + messages length
// mock Button/Spinner lightly if needed
const { ProjectWorkspacePage } = await import("./project.$projectId");
```

Capture message infinite-query options and ensure mutation callbacks. Defer
ensure resolution with a deferred promise. Cover at minimum:

- the URL session message query is enabled before ensure resolves;
- D1 messages render while ensure remains pending;
- the top provisioning status is announced and the chat receives
  `Project sandbox is being provisioned.`;
- resolving ensure with a success sandbox state removes the bar and clears
  disabled reason;
- ensure/check error leaves history visible and exposes `Retry`;
- restore failure leaves history visible and exposes `Retry restore`;
- retry success is consumed directly and does not start a second ensure;
- ensure/retry success does not call `projects.list` invalidation;
- rapid project/session rerender ignores a stale mutation result.

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run 'src/routes/project.$projectId.test.tsx' src/integrations/trpc/routers/workspace.test.ts
```

Expected: route coordination and backend workspace tests pass; history-before-
readiness is explicitly covered.

### Step 5: Make the chat read-only for sandbox-backed actions

Use the existing `disabledReason` path; do not create a second global readiness
context.

In `apps/web/src/components/composer.tsx`:

- add `disabled={Boolean(disabledReason)}` to the message `Textarea`;
- retain its controlled value so a draft present before a readiness transition
  survives disable/re-enable;
- preserve current submit guard, model/thinking disablement, active-run control
  behavior, and stream protocol.

In `apps/web/src/components/chat-navbar.tsx`:

- pass `disabled || !hasSession` to `SessionToolsTrigger`;
- when `disabled` is true, do not mount `SessionGitActions`, because mounting it
  starts a sandbox-backed status query; still render the left branch/sidebar
  chrome;
- leave the sidebar trigger usable.

In `apps/web/src/components/ai-chat.tsx`:

- make `toolsEnabled` require no `disabledReason`;
- when `disabledReason` becomes truthy, close `toolsOpen` so the pane does not
  silently reopen after readiness returns;
- ensure desktop and mobile tools panes are unmounted while unavailable;
- `ChatEmptyState` has no text input (only suggestion buttons). While
  `disabledReason` is set, disable those suggestion buttons and do not call
  `onSelectSuggestion`;
- keep the message scroller, load-earlier control, message copy affordances, and
  timeline rendering available.

Extend existing tests:

- `composer.test.tsx`: textarea/model/thinking/submit are disabled; Enter and
  click cannot start a stream; a controlled draft survives disable/re-enable.
- `chat-navbar.test.tsx`: workspace `disabled` disables tools and prevents the
  mocked Git action component from mounting, while the sidebar trigger remains.
- `ai-chat.test.tsx`: stored messages remain visible with `disabledReason`;
  suggestions and tools are unavailable; an open tools pane closes/unmounts;
  load-earlier still works.

If the test reveals a live agent can coexist with a newly unavailable workspace,
STOP. Do not disable its Stop control without a product decision. Under the
current architecture an active run keeps the sandbox active, so this should not
be reachable during the open-project cold-wake flow.

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/components/composer.test.tsx src/components/chat-navbar.test.tsx src/components/ai-chat.test.tsx
```

Expected: all files pass and tests prove history remains readable while every
sandbox-backed entry point is unavailable.

### Step 6: Remove workspace provisioning UI from the D1-only sidebar

In `apps/web/src/components/app-sidebar.tsx`, simplify `ProjectStatusIcon`:

- remove the `LoaderIcon` import and the `status === "provisioning"` spinner
  branch;
- keep the failed alert icon;
- render the ordinary open/closed folder icon for both `ready` and
  `provisioning` D1 rows;
- do not change `AppSidebarClient`'s query, add props, or couple it to route
  mutation state.

Extend `app-sidebar.test.tsx` using the existing component/mock style. It is
acceptable to export the smallest existing sidebar item/helper needed for a
behavioral test, as `SessionSidebarItem` is already exported for tests. Prove:

- a provisioning D1 project renders a folder, not a spinning loader;
- failed still renders its error indicator;
- the sidebar's only project data request is `projects.list`; no workspace
  ensure option is requested.

Do not change dashboard cards or project creation dialog loading behavior.

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/components/app-sidebar.test.tsx
```

Expected: sidebar archival tests and new independent-status tests pass.

### Step 7: Update architecture documentation

Update only the listed documents, using current product vocabulary:

- `docs/architecture/overview.md`, **Open a workspace**: D1 project/session/chat
  reads begin independently; the Worker observes `getState`, restores if needed,
  and only then enables runtime actions.
- `docs/architecture/frontend.md`, **Browser data flow**, **Sidebar and project
  management**, and **Accessibility and loading behavior**: history renders
  during readiness, the standalone bar announces provisioning, sandbox-backed
  controls are disabled, and sidebar status is not driven by workspace pending
  state.
- `docs/architecture/server-and-data.md`, section **Lifecycle state machines**
  subsection **Project** (heading is `### Project`, not "Project lifecycle")
  and **Workspace durability**: D1 `ready` is durable last-known state,
  `getState` observes the live container first, and the existing provisioning
  compare-and-set fences cold restore.
- `docs/architecture/agent-harness.md`, **Persistence**: document lifecycle
  observation before wake-causing file/runner probes.
- `docs/architecture/repository-map.md`: add the new route test and adjust the
  route/sidebar/sandbox descriptions only where responsibilities changed.

Do not turn historical plans into specifications and do not document a stale-
provisioning lease that was not implemented.

**Verify**:

```bash
pnpm check && git diff --check
```

Expected: exit 0; no new diagnostics in changed files and no whitespace errors.

### Step 8: Run the complete repository gate and audit scope

Run the focused command first, then the repository gate:

```bash
pnpm --filter @ditto/web exec vitest run src/lib/sandbox-bootstrap.test.ts src/lib/project-sandbox.test.ts src/integrations/trpc/routers/workspace.test.ts 'src/routes/project.$projectId.test.tsx' src/components/ai-chat.test.tsx src/components/chat-navbar.test.tsx src/components/composer.test.tsx src/components/app-sidebar.test.tsx
pnpm verify
git diff --check
git status --short
```

Expected:

- all focused tests pass;
- `pnpm verify` exits 0 across app and independent runner checks/builds;
- `git diff --check` prints nothing;
- only files in Scope plus the plan status row are modified;
- no schema, migration, lockfile, generated route tree, agent, Git, preview, or
  runner files changed.

## Test plan

The implementation must add regression coverage for these observable cases:

| Layer | Case | Expected result |
|---|---|---|
| Sandbox helper | Observe `healthy` or stopped state | only `getState` is called; no wake-causing operation |
| Project lifecycle | Active + hydrated + valid runner | returns `connected`, no D1 status write |
| Project lifecycle | Stopped + stored backup | D1 CAS to provisioning, restore, verify, ready |
| Project lifecycle | Stopped + no usable backup | recreate through existing GitHub path |
| Project lifecycle | Concurrent CAS loser | typed provisioning signal, never failed |
| Project lifecycle | Delayed completion after state changed | final ready/failed write is rejected by status fence |
| Workspace router | Current D1 provisioning | provisioning response, not restore failure |
| Workspace router | Actual failed restore | `restoreFailed: true` |
| Project route | Existing session + deferred ensure | D1 messages and status bar both visible |
| Project route | Ensure/check error | D1 messages stay visible; retry available |
| Project route | Retry restore success | returned workspace is used; no duplicate ensure |
| Chat controls | Readiness unavailable | prompt/model/Git/tools/suggestions disabled; history remains readable/pageable |
| Sidebar | D1 provisioning project | normal folder; no workspace spinner or ensure query |

Use the existing colocated tests as structural exemplars. Do not add snapshots;
assert roles, text, disabled state, calls, and D1 state transitions directly.

## Done criteria

All must hold:

- [ ] `getProjectSandboxState` observes the installed SDK's `getState()` before
      any `exists` or `exec` readiness probe.
- [ ] Stopped/stopping states take the existing D1 provisioning fence before a
      wake/restore operation.
- [ ] A compare-and-set loser is reported as provisioning and cannot mark D1
      failed.
- [ ] Restore terminal writes require the row still be `provisioning`.
- [ ] An explicit session's D1 messages can render before
      `workspace.ensureWorkspace` settles.
- [ ] Provisioning/check/restore errors never replace already loaded chat
      history with a full-page error.
- [ ] A standalone, accessible top status bar is present only while checking or
      provisioning; it does not overlap `ChatNavbar`.
- [ ] Composer, suggestions, Git, tools, and preview entry points cannot be used
      until the workspace is ready; D1 history remains scrollable/pageable.
- [ ] The sidebar calls only its existing D1 list query and shows no provisioning
      spinner.
- [ ] No `projects.list` invalidation is introduced by workspace readiness.
- [ ] No schema, migration, dependency, lockfile, generated route tree, or
      sandbox keep-alive change exists.
- [ ] The focused test command passes.
- [ ] `pnpm verify` exits 0.
- [ ] `git diff --check` exits 0 with no output.
- [ ] `git status --short` lists only in-scope files and the plan index status.
- [ ] `plans/README.md` marks Plan 030 DONE (or BLOCKED with a one-line reason).

## STOP conditions

Stop and report instead of improvising if:

- the pinned Sandbox object no longer exposes inherited `getState()` with the
  five documented status values;
- `getState()` itself starts a stopped container in local or upstream SDK tests;
- implementing lifecycle observation requires adding `@cloudflare/containers`
  as a direct dependency or upgrading `@cloudflare/sandbox`;
- a stopped sandbox cannot be restored/bootstrap-started through the existing
  operations without a new deployment/resource-graph change;
- correct contention handling requires a D1 migration, lease token, or chosen
  stale timeout;
- the route cannot load `workspace.messages` independently without weakening
  its existing ownership check;
- disabling readiness controls would remove Stop/follow-up control from an
  already-running agent;
- the status bar requires changing `AppShell`, global CSS, or sidebar context;
- any step requires touching an out-of-scope file;
- a verification command fails twice after a reasonable in-scope correction;
- current code no longer matches the excerpts or locked architecture.

## Maintenance notes

- `projects.status` still serves two meanings: durable import/restore lifecycle
  and a cross-request restore fence. The sidebar intentionally does not visualize
  `provisioning`; future work that needs to distinguish initial import from cold
  wake should add an explicit model rather than reusing local route state.
- A Worker crash after `ready -> provisioning` can still leave the row stuck.
  Fixing that safely requires a lease token, owner, expiry, and documented
  maximum restore duration; it is intentionally deferred because no timeout is
  currently defined.
- Reviewers should scrutinize ordering: `getState` must precede wake-causing
  probes, the D1 CAS must precede restore for inactive runtimes, and final writes
  must be status-fenced.
- Reviewers should also verify that no sidebar invalidation or hidden
  sandbox-backed query remains during provisioning, especially Git status and an
  already-open preview pane.
- If Cloudflare changes lifecycle state names in a future SDK upgrade, update the
  narrow helper and project-sandbox tests together; do not scatter status-string
  checks through React components.
