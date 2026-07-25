# Plan 031: Split sandbox check from provision (quiet warm path)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git rev-parse --short HEAD
> git status --short
> git diff --stat a9fc894..HEAD -- \
>   apps/web/src/lib/project-sandbox.ts \
>   apps/web/src/lib/project-sandbox.test.ts \
>   apps/web/src/integrations/trpc/routers/workspace.ts \
>   apps/web/src/integrations/trpc/routers/workspace.test.ts \
>   'apps/web/src/routes/project.$projectId.tsx' \
>   'apps/web/src/routes/project.$projectId.test.tsx' \
>   apps/web/src/integrations/trpc/routers/projects.ts \
>   apps/web/src/integrations/trpc/routers/projects.test.ts \
>   apps/web/src/integrations/trpc/routers/session-git.ts \
>   apps/web/src/integrations/trpc/routers/session-git.test.ts \
>   apps/web/src/integrations/trpc/routers/session-preview.test.ts \
>   apps/web/src/lib/agent-run-service.ts \
>   apps/web/src/lib/agent-run-service.test.ts \
>   apps/web/src/lib/agent-git-handler.ts \
>   apps/web/src/lib/agent-git-handler.test.ts \
>   apps/web/src/lib/session-preview.ts \
>   apps/web/src/lib/session-preview.test.ts \
>   apps/web/src/components/ui/toast.tsx \
>   apps/web/src/App.tsx \
>   apps/web/src/components/composer.tsx \
>   apps/web/src/components/composer.test.tsx \
>   apps/web/src/components/session-git-actions.tsx \
>   apps/web/src/components/session-git-actions.test.tsx \
>   docs/architecture/overview.md \
>   docs/architecture/frontend.md \
>   docs/architecture/server-and-data.md \
>   docs/architecture/agent-harness.md \
>   docs/architecture/repository-map.md \
>   plans/README.md
> ```
>
> Then run `git status --short` and `git diff --stat` so uncommitted drift is
> not hidden by `a9fc894..HEAD`.
>
> **Expected dirty tree at planning time (preserve; do not revert or
> "clean up"):**
>
> - Toast migration: Sonner removed; Base UI toast at
>   `apps/web/src/components/ui/toast.tsx`; `App.tsx` / composer /
>   session-git-actions import swaps; `apps/web/package.json` + `pnpm-lock.yaml`
>   sonner removal (and any floating TanStack patch bumps already present).
> - Route already toast-based but still always-toasts on `isPreparing`.
> - Also dirty/untracked and **not yours to revert**: `plans/030-*.md`,
>   `plans/README.md`, this plan file, `docs/superpowers/**`.
> - Dirty route/toast blobs at plan writing:
>   - `project.$projectId.tsx` → `git hash-object` `3ccbcc0e0fa41ab5445bec55bf22883165028bc7`
>   - `project.$projectId.test.tsx` → `48d0adb0e7590a7711fc102a59a45f3deb515635`
>   - `toast.tsx` → `2b2eafb53a11820e47a070fd6bca6233af0fb701`
>
> If those route/toast hashes differ, re-read the live files and adapt only
> the toast/wiring details; the server split and quiet-warm behavior remain
> mandatory. STOP only on behavioral mismatch in in-scope runtime files against
> locked decisions — **not** because extra dirty plans/lockfile/docs exist.
>
> Work on one branch through all steps before pushing. Intermediate steps may
> not typecheck until Step 3 finishes caller renames; that is expected.
>
> Spec source (approved): `docs/superpowers/specs/2026-07-25-sandbox-check-provision-split-design.md`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — touches the project restore fence and the route readiness
  state machine, but deliberately avoids schema migration or a new runtime
  status store
- **Depends on**: Plan 030 (sandbox readiness loading) DONE at `a9fc894`
- **Category**: bug / direction
- **Planned at**: commit `a9fc894`, 2026-07-25
- **Status**: DONE (worktree `/home/ayan/ditto-worktrees/031-sandbox-check-provision-split` @ `0cf32bf`; advisor review APPROVE)

## Why this matters

Plan 030 made cold wake correct and kept D1 chat history visible, but the
client still runs one combined `workspace.ensureWorkspace` mutation and toasts
on every readiness cycle. Warm visits therefore show “Preparing project
sandbox…” / “Project sandbox ready” even when the container is already healthy
and the call is only a health check.

Root cause: check and restore are one API, so the client cannot tell them
apart. Split observation (`checkSandbox` query) from restore
(`provisionSandbox` mutation). Quiet warm path; provision-only toast when this
tab starts real provision work.

## Locked design decisions

Do not invent another state store or broaden the feature.

1. **Approach:** Split into `checkProjectSandbox` (query path, no D1 writes /
   fence / restore) + `provisionProjectSandbox` (mutation path, idempotent).
2. **Auto-provision:** If check returns `needs_restore`, the client immediately
   starts provision once (no extra click).
3. **Toast:** Provision-only loading toast via `toast.add`/`update`/`close`
   (not `toast.promise`). Loading while this tab’s prepare work is in flight;
   success on terminal success; error on failure. If provision returns
   non-terminal `provisioning` (lost fence), do **not** show success; keep
   loading until check polling reaches a terminal state.
4. **Disablement:** Composer/git/preview stay disabled until check says
   `connected` or provision completes in a success state.
5. **Remove** the route-level “toast on every `isPreparing`” effect and the
   single combined `ensureWorkspace` call site on the project page.
6. **Error UI:** Keep inline status bars for check errors and restore failure;
   do not use toasts as the only error surface for those terminal states.
7. **No schema changes.** D1 remains durable source of truth. No
   `waitUntil` detach, no preparing status bar for the happy path, no sidebar
   involvement, no message-history coupling.
8. **Production callers** of the old combined ensure path (agent run, git,
   preview, env-var mutations) move to `provisionProjectSandbox`. Do **not**
   keep two production public entry points. No temporary public alias.
9. **Provision contention is a result, not a throw:** public
   `provisionProjectSandbox` **never throws** `ProjectSandboxProvisioningError`.
   CAS loss and D1-already-`provisioning` **always** return
   `{ state: "provisioning" }`. Restore failures still throw after the fenced
   `failed` write (today's behavior). Delete nested-ensure from the workspace
   router — one provision call is enough.
10. **GitHub gate (hard):** if D1 is `ready` + has `sandboxId` but is missing
    `githubRepo` or `githubInstallationId`, throw
    `Project sandbox cannot be restored without a GitHub repository.` **before**
    `getState()`, matching current `ensureProjectSandbox`. No
    connected-without-GitHub exception.
11. **Toast implementation:** use `toast.add` + `toast.update` + `toast.close`
    only. Do **not** use `toast.promise` (lost-fence needs a promise that stays
    pending across check polls; add/update is the specified path).
12. **Do not modify** `toast.tsx` / `App.tsx` unless a compile break forces a
    one-line fix. Route uses the existing manager API only.

## Current state

All excerpts verified against HEAD `a9fc894` plus the dirty toast/route tree
described above.

### Domain: one function both observes and restores

`apps/web/src/lib/project-sandbox.ts` exports:

```ts
export type EnsureProjectSandboxResult = {
	project: typeof projects.$inferSelect;
	state: "connected" | "restored_from_backup" | "recreated_from_github";
};

export class ProjectSandboxProvisioningError extends Error { /* ... */ }

export async function ensureProjectSandbox(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: typeof projects.$inferSelect;
}): Promise<EnsureProjectSandboxResult>
```

Behavior today (lines ~306–378):

1. Rejects when D1 status ≠ `ready` or missing `sandboxId` / GitHub fields.
2. `getProjectSandboxState` → inactive statuses or unhydrated active → CAS
   `ready → provisioning` → `restoreLockedProjectSandbox`.
3. Active + hydrated + runner healthy → `{ state: "connected" }` with no D1 write.
4. CAS loss → `ProjectSandboxProvisioningError`.
5. Terminal ready/failed writes already fenced to `status = "provisioning"`.

`needs_restore` does **not** exist at the API boundary yet.

### tRPC: one mutation is the readiness entry

`apps/web/src/integrations/trpc/routers/workspace.ts`:

- `ensureWorkspace` mutation → `loadWorkspaceView` → `ensureProjectWorkspace`
  → `ensureProjectSandbox`, with contention nested-ensure handling.
- `retryRestore` mutation flips `failed → ready` then `loadWorkspaceView`
  (which currently re-enters ensure/restore).
- `WorkspaceSandboxState` union:
  `"connected" | "restored_from_backup" | "recreated_from_github" | "provisioning" | "failed"`.

### Route: always toasts while preparing

Dirty `apps/web/src/routes/project.$projectId.tsx` still:

- fires `ensureWorkspace` whenever `d1Status === "ready"`;
- derives `isPreparing` from D1 ready/provisioning **or** pending ensure;
- `useEffect` adds a loading toast whenever `isPreparing` is true (warm path
  included);
- keeps restore-failed / check-error bars only (preparing bar already removed
  in the dirty toast work).

Toast surface already migrated:

- `apps/web/src/components/ui/toast.tsx` — Base UI manager with
  `add` / `update` / `close` / `promise`.
- Base UI `toast.add` upserts by stable `id`. Route must use `add`/`update`/
  `close` for provision toasts (lost-fence path). Do not call `toast.promise`.

### Other production callers of `ensureProjectSandbox`

| File | Role |
|---|---|
| `apps/web/src/lib/agent-run-service.ts` | injectable dep; wakes before run |
| `apps/web/src/lib/agent-git-handler.ts` | wakes before agent git |
| `apps/web/src/lib/session-preview.ts` | injectable dep; wakes before preview start |
| `apps/web/src/integrations/trpc/routers/session-git.ts` | wakes before UI git |
| `apps/web/src/integrations/trpc/routers/projects.ts` | wakes before env-var mutations |

These must keep waking a cold sandbox. After the split they call
`provisionProjectSandbox` (idempotent: check first, no-op when already
`connected`).

### Conventions to match

- Tabs + double quotes (`biome.json`).
- Routes orchestrate; lifecycle policy stays in `apps/web/src/lib`
  (`docs/README.md` architecture invariants).
- Colocated Vitest tests with hoisted mocks (see
  `workspace.test.ts`, `project-sandbox.test.ts`, route test).
- Product copy is calm/literal. Verbatim strings:
  - loading: `Preparing project sandbox...`
  - success: `Project sandbox ready`
  - disabled while preparing: `Project sandbox is being provisioned.`
  - disabled not ready: `Project sandbox is not ready yet.`
- Error handling: observation errors propagate and must **not** mark D1
  `failed`. Only restore paths under the fence may write `failed`.
- `ProjectSandboxProvisioningError` stays a real exported class so
  `instanceof` works across the module boundary (do not mock it away).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install (only if deps missing) | `pnpm install --frozen-lockfile` | exit 0; lockfile unchanged unless toast migration already dirtied it — do not expand lockfile churn |
| Focused domain + router | `pnpm --filter @ditto/web exec vitest run src/lib/project-sandbox.test.ts src/integrations/trpc/routers/workspace.test.ts` | all pass |
| Focused route | `pnpm --filter @ditto/web exec vitest run 'src/routes/project.$projectId.test.tsx'` | all pass |
| Focused callers | `pnpm --filter @ditto/web exec vitest run src/lib/agent-run-service.test.ts src/lib/agent-git-handler.test.ts src/lib/session-preview.test.ts src/integrations/trpc/routers/session-git.test.ts src/integrations/trpc/routers/projects.test.ts src/integrations/trpc/routers/session-preview.test.ts` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Check | `pnpm check` | exit 0. Planning-time baseline had dirty route format + exhaustive-deps errors that this plan’s route rewrite must clear. Pre-existing **warnings** outside in-scope files are OK; zero errors on in-scope paths. |
| App tests | `pnpm test` | exit 0 |
| Full gate | `pnpm verify` | exit 0 |
| Diff hygiene | `git diff --check` | no output, exit 0 |

Planning-time baseline: focused project-sandbox + workspace + route tests
45/45 pass; `pnpm typecheck` pass. `pnpm check` currently fails on dirty
toast/route formatting and a route exhaustive-deps warning on the always-on
toast cleanup effect — this plan’s route rewrite must leave check clean for
in-scope files.

## Suggested executor toolkit

- `workers-best-practices` / `sandbox-sdk` if available when touching Sandbox
  lifecycle observation.
- Design/spec:
  `docs/superpowers/specs/2026-07-25-sandbox-check-provision-split-design.md`
- Prior plan for fence semantics: `plans/030-sandbox-readiness-loading.md`
  (DONE; do not re-open its scope).

## Scope

**In scope (the only files you may modify):**

- `apps/web/src/lib/project-sandbox.ts`
- `apps/web/src/lib/project-sandbox.test.ts`
- `apps/web/src/integrations/trpc/routers/workspace.ts`
- `apps/web/src/integrations/trpc/routers/workspace.test.ts`
- `apps/web/src/routes/project.$projectId.tsx`
- `apps/web/src/routes/project.$projectId.test.tsx`
- Production caller renames (symbol only; no behavior expansion):
  - `apps/web/src/lib/agent-run-service.ts`
  - `apps/web/src/lib/agent-run-service.test.ts`
  - `apps/web/src/lib/agent-git-handler.ts`
  - `apps/web/src/lib/agent-git-handler.test.ts`
  - `apps/web/src/lib/session-preview.ts`
  - `apps/web/src/lib/session-preview.test.ts`
  - `apps/web/src/integrations/trpc/routers/session-git.ts`
  - `apps/web/src/integrations/trpc/routers/session-git.test.ts`
  - `apps/web/src/integrations/trpc/routers/session-preview.test.ts`
  - `apps/web/src/integrations/trpc/routers/projects.ts`
  - `apps/web/src/integrations/trpc/routers/projects.test.ts`
- Docs only where they still claim a single `ensureWorkspace` readiness entry:
  - `docs/architecture/overview.md`
  - `docs/architecture/frontend.md`
  - `docs/architecture/server-and-data.md`
  - `docs/architecture/agent-harness.md`
  - `docs/architecture/repository-map.md`
- `plans/README.md` (status row only after execution)

**Toast files already dirty (preserve migration; do not modify unless compile
break forces a one-line fix):**

- `apps/web/src/components/ui/toast.tsx`
- `apps/web/src/App.tsx`
- composer / session-git-actions toast import swaps already present — leave them.

Route uses existing `toast.add` / `update` / `close` only.

**Out of scope (do NOT touch):**

- `apps/web/src/db/schema.ts` and all migrations
- Sidebar, AppShell, session-preview pane internals, agent stream protocol
- Sandbox keep-alive / sleep tuning
- Stale-provisioning lease/timeout
- Dependency upgrades beyond what the existing dirty toast migration already did
- Generated route tree
- Bringing back the preparing status bar for the happy path
- Changing D1 message history loading independence (already correct)

## Git workflow

- Branch: `advisor/031-sandbox-check-provision-split`
- Prefer three logical commits:
  1. `fix(sandbox): split check from provision`
  2. `fix(workspace): quiet warm sandbox check`
  3. `docs(workspace): document check vs provision readiness`
- Message style matches recent history (`fix(sandbox): …`, `fix(workspace): …`).
- Do NOT push or open a PR unless the operator instructs it.
- Preserve unrelated dirty toast work; do not revert Sonner→Base UI.

## Steps

### Step 1: Extract `checkProjectSandbox` + `provisionProjectSandbox`

Edit `apps/web/src/lib/project-sandbox.ts`.

#### Types

```ts
export type CheckProjectSandboxState =
	| "connected"
	| "needs_restore"
	| "provisioning"
	| "failed";

export type CheckProjectSandboxResult = {
	project: typeof projects.$inferSelect;
	state: CheckProjectSandboxState;
};

export type ProvisionProjectSandboxState =
	| "connected"
	| "restored_from_backup"
	| "recreated_from_github"
	| "provisioning"
	| "failed";

export type ProvisionProjectSandboxResult = {
	project: typeof projects.$inferSelect;
	state: ProvisionProjectSandboxState;
};
```

Delete exported `EnsureProjectSandboxResult`. Rename internal helper return
types (`restoreLockedProjectSandbox`, `recreateSandboxFromGitHub`) to a private
success subset or to `ProvisionProjectSandboxResult` — do **not** leave
`EnsureProjectSandboxResult` exported.

`ProjectSandboxProvisioningError` may remain exported only if something still
imports it after the split; if greps are clean, delete the class. Public
`provisionProjectSandbox` must **not** throw it.

#### `checkProjectSandbox`

```ts
export async function checkProjectSandbox(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: typeof projects.$inferSelect;
}): Promise<CheckProjectSandboxResult>
```

Rules (exact — no alternatives):

1. **Never** write D1 status, never take the fence, never restore/backup/bootstrap.
2. If `project.status === "provisioning"` →
   `{ project, state: "provisioning" }` (no container touch).
3. If `project.status === "failed"` **or** status not `"ready"` **or** missing
   `sandboxId` → `{ project, state: "failed" }` (no container touch). Do not
   throw solely for durable non-ready D1 status.
4. If D1 `ready` + `sandboxId`:
   - **Hard GitHub gate (before getState):** if missing `githubRepo` or
     `githubInstallationId`, throw
     `Project sandbox cannot be restored without a GitHub repository.`
   - `runtime = await getProjectSandboxState(env, sandboxId)` — observation
     errors **propagate** (do not mark failed).
   - inactive (`stopping` | `stopped` | `stopped_with_code`) →
     `{ state: "needs_restore" }`
   - `healthy` | `running` → parallel hydrate + runner probes:
     - both ok → `{ state: "connected" }`
     - runner unhealthy → throw existing invalid-runner error (no D1 write)
     - not hydrated → `{ state: "needs_restore" }`
   - unknown status → throw `Unknown sandbox runtime status: …` (same as today)

#### `provisionProjectSandbox`

```ts
export async function provisionProjectSandbox(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: typeof projects.$inferSelect;
}): Promise<ProvisionProjectSandboxResult>
```

Rules (exact — no alternatives):

1. **Idempotent observation first:** call `checkProjectSandbox` internally
   (single decision tree; no duplicated status switch).
2. If check returns `connected` → `{ project, state: "connected" }` (no
   fence/restore).
3. If check returns `provisioning` → `{ project, state: "provisioning" }`.
   **Do not throw.**
4. If check returns `failed` → `{ project, state: "failed" }` (no restore;
   `retryRestore` is the failed→ready gate).
5. If check returns `needs_restore`:
   - CAS `ready → provisioning` (existing predicate).
   - CAS loss → reload project if convenient; return
     `{ project, state: "provisioning" }`. **Do not throw.
     Do not mark failed.**
   - CAS win → existing `restoreLockedProjectSandbox` unchanged. On restore
     success return `restored_from_backup` | `recreated_from_github`. On
     restore failure: keep today’s mark-failed-under-fence then **throw**
     `Project sandbox restore failed. Please try again.` so agent callers still
     see exceptions.

**Public export cleanup:** delete `ensureProjectSandbox`. Grep must show no
production imports of that name after Step 3.

#### Tests (`project-sandbox.test.ts`)

Reuse fakes (`makeFakeDb`, `makeVersionedDb`, `getProjectSandboxStateMock`).

Add/adjust cases:

| Case | Expected |
|---|---|
| check: healthy + hydrated + runner ok | `connected`; **zero** D1 updates |
| check: stopped / stopping / stopped_with_code | `needs_restore`; zero D1 updates; no restore mocks called |
| check: active + unhydrated + runner ok | `needs_restore`; zero D1 updates |
| check: active + runner unhealthy | throws invalid-runner; zero D1 updates |
| check: D1 provisioning | `provisioning`; no `getState` |
| check: D1 failed / missing sandboxId | `failed`; no `getState` |
| check: getState throws | propagates; zero D1 updates |
| provision: already connected | `connected`; zero D1 updates |
| provision: needs_restore + CAS win + backup | `restored_from_backup` (existing restore assertions) |
| provision: CAS loss | `provisioning` (not failed); no failed write |
| provision: restore failure while fenced | failed write under provisioning fence; error surfaces |
| Existing versioned-backup / stale fence tests | still pass via provision path |

Migrate every old `ensureProjectSandbox` test to `check`/`provision`. No
production alias left behind in the test file when done.

**Verify:**

```bash
pnpm --filter @ditto/web exec vitest run src/lib/project-sandbox.test.ts
```

Expected: all pass, including new check-no-write and provision-idempotent cases.

### Step 2: Replace workspace tRPC ensure with check + provision

Edit `apps/web/src/integrations/trpc/routers/workspace.ts`.

#### State union

```ts
type WorkspaceSandboxState =
	| "connected"
	| "needs_restore"
	| "restored_from_backup"
	| "recreated_from_github"
	| "provisioning"
	| "failed";
```

#### Shared view loader

Delete `ensureProjectWorkspace` and its nested-ensure catch ladder entirely.

Introduce a thin builder used by both procedures:

```ts
async function loadSessionsAndBuildView(options: {
  db: ReturnType<typeof createDb>;
  projectId: string;
  userId: string;
  sessionId?: string | null;
  sandboxProject: typeof projects.$inferSelect;
  sandboxState: WorkspaceSandboxState;
  restoreFailed: boolean;
}) { /* sessions query + stripProjectSecrets + selectedSession */ }
```

#### `workspace.checkSandbox` — **query**

```ts
checkSandbox: protectedProcedure
  .input(z.object({
    projectId: z.string().min(1),
    sessionId: z.string().min(1).optional(),
  }))
  .query(async ({ ctx, input }) => { /* ... */ })
```

- `loadProjectOrThrow` → `checkProjectSandbox` → `loadSessionsAndBuildView`.
- Payload:

```ts
{
  project: stripProjectSecrets(result.project),
  sandbox: { state: result.state }, // may be needs_restore
  sessions,
  selectedSession,
  restoreFailed: result.state === "failed" || result.project.status === "failed",
}
```

- Observation throws → propagate (route shows check-error bar). Do **not**
  convert generic errors into `restoreFailed: true` unless D1 is actually
  `failed`.

#### `workspace.provisionSandbox` — **mutation**

```ts
provisionSandbox: protectedProcedure
  .input(z.object({
    projectId: z.string().min(1),
    sessionId: z.string().min(1).optional(),
  }))
  .mutation(async ({ ctx, input }) => { /* ... */ })
```

- `loadProjectOrThrow` → `provisionProjectSandbox` → build view.
- Provision payload states are only
  `connected | restored_from_backup | recreated_from_github | provisioning | failed`.
  **Never** return `needs_restore` from provision (check already collapsed it).
- On restore **throw** after fence: reload project; if D1 is `failed`, return
  `{ sandbox.state: "failed", restoreFailed: true }`; otherwise rethrow.
- Contention is already a returned `provisioning` state — **no** nested
  provision call, **no** `ProjectSandboxProvisioningError` catch ladder.

#### `workspace.retryRestore` — keep mutation, change follow-up

Design said “unchanged” for the failed→ready flip; the **follow-up** changes:

After successful `failed → ready` CAS:

- Return a workspace view via **check** (not provision, not old ensure).
- Client auto-provisions only if that check says `needs_restore`, under toast
  rules.

Tombstone fence (`deletingAt`) stays exactly as today.

#### Delete `workspace.ensureWorkspace`

Remove the procedure entirely. Update every test reference.

#### Tests (`workspace.test.ts`)

```ts
vi.mock("#/lib/project-sandbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#/lib/project-sandbox")>();
  return {
    ...actual,
    checkProjectSandbox: checkProjectSandboxMock,
    provisionProjectSandbox: provisionProjectSandboxMock,
  };
});
```

**Delete** the nested-ensure double-call cases entirely. Contention is one
`provisionProjectSandbox` mock resolving `{ state: "provisioning" }`; assert
single call and `restoreFailed: false`.

| Case | Expected |
|---|---|
| check connected | state `connected`; provision mock not called |
| check needs_restore | state `needs_restore`; restoreFailed false; secrets stripped |
| check D1 provisioning | state `provisioning` |
| check observation error while D1 ready | rejects (not restoreFailed) |
| provision connected no-op | state `connected` |
| provision restore success | `restored_from_backup` / `recreated_from_github` |
| provision returns provisioning | state `provisioning`, restoreFailed false, **one** mock call |
| provision throw + D1 failed | restoreFailed true |
| retryRestore tombstone | rejects; check/provision not called |
| retryRestore success | returns **check** payload; provision not called |
| no messages field on either payload | still true |

**Verify:**

```bash
pnpm --filter @ditto/web exec vitest run src/integrations/trpc/routers/workspace.test.ts
```

Expected: all pass; no remaining `ensureWorkspace` symbol in this file.

### Step 3: Point production wake callers at `provisionProjectSandbox`

Not rename-only. Today most callers treat any non-throw as success. After the
split, `{ state: "provisioning" | "failed" }` can resolve with `sandboxId`
still set — callers **must** gate on success states before continuing.

Shared success set (inline or one local const per file — do not create a new
shared package module):

```ts
const PROVISION_SUCCESS = new Set([
  "connected",
  "restored_from_backup",
  "recreated_from_github",
] as const);
```

#### Per-file required shape

**`agent-run-service.ts`**
- Rename dep `ensureProjectSandbox` → `provisionProjectSandbox` in
  `AgentRunDeps`, `defaultDeps`, `prepareAgentRun`.
- After await:

```ts
const ensured = await deps.provisionProjectSandbox({ db, env, project });
if (!PROVISION_SUCCESS.has(ensured.state)) {
  return {
    kind: "error",
    status: 409,
    body: { error: "Project sandbox is not ready." },
  };
}
ensuredProject = ensured.project;
sandboxState = ensured.state;
```

- Keep existing `catch` for thrown restore failures.
- Update `agent-run-service.test.ts` mock name + injects; add one case where
  provision resolves `{ state: "provisioning" }` → 409.

**`agent-git-handler.ts`**

```ts
const ensured = await provisionProjectSandbox({ db, env, project });
if (!PROVISION_SUCCESS.has(ensured.state)) {
  throw new AgentGitHttpError(409, "Project sandbox is not ready.");
}
// continue with ensured.project / project.sandboxId
```

- Update test mock; must not reach worktree/git on non-success.

**`session-git.ts`** (resolve helper that currently `await ensureProjectSandbox`)

```ts
const ensured = await provisionProjectSandbox({ db, env: ctx.env, project });
if (!PROVISION_SUCCESS.has(ensured.state)) {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Project sandbox is not ready.",
  });
}
```

- Update `session-git.test.ts` mock to resolve a success result object, not
  `undefined`.

**`session-preview.ts`**
- Rename dep field + `defaultDeps`.

```ts
const ensured = await deps.provisionProjectSandbox({ db, env, project });
if (!PROVISION_SUCCESS.has(ensured.state) || !ensured.project.sandboxId) {
  throw sessionPreviewError("not_ready");
}
```

- Update `session-preview.test.ts` + `session-preview` router test mocks
  (default inject must resolve `{ project, state: "connected" }`).

**`projects.ts` env-var add/delete** (both `if (project.sandboxId)` blocks)

```ts
const ensured = await provisionProjectSandbox({ db, env: ctx.env, project });
if (!PROVISION_SUCCESS.has(ensured.state) || !ensured.project.sandboxId) {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Project sandbox is not ready yet.",
  });
}
```

- Update `projects.test.ts` mock.

**Grep gate after this step (production sources only):**

```bash
rg -n "ensureProjectSandbox|ensureWorkspace" apps/web/src docs/architecture \
  -g '!*test.*' -g '!*tests*'
```

Expected: no matches. Test files may still mention the old names only inside
negative assertions (e.g. sidebar pins absence of ensure). In-scope tests must
import/mock the new symbols. Architecture docs fixed in Step 5.

**Verify:**

```bash
pnpm --filter @ditto/web exec vitest run \
  src/lib/agent-run-service.test.ts \
  src/lib/agent-git-handler.test.ts \
  src/lib/session-preview.test.ts \
  src/integrations/trpc/routers/session-git.test.ts \
  src/integrations/trpc/routers/projects.test.ts \
  src/integrations/trpc/routers/session-preview.test.ts
pnpm typecheck
```

Expected: all listed tests pass; typecheck exit 0.

### Step 4: Quiet warm path on the project route

Rewrite readiness orchestration in
`apps/web/src/routes/project.$projectId.tsx`. Keep `ProjectWorkspacePage`
export and the restore-failed / check-error `WorkspaceStatusBar`.
Commit this route rewrite with commit 2 (`fix(workspace): quiet warm sandbox check`).

#### Data hooks

1. Keep `projects.get` with
   `refetchInterval: (q) => q.state.data?.status === "provisioning" ? 1_000 : false`.
2. Replace ensure mutation with:

```ts
const checkQuery = useQuery(
  trpc.workspace.checkSandbox.queryOptions(
    { projectId, sessionId },
    {
      enabled: d1Status === "ready",
      retry: false,
      refetchInterval: (q) => {
        const state = q.state.data?.sandbox?.state;
        if (
          d1Status === "provisioning" ||
          state === "provisioning" ||
          awaitingFenceRef.current
        ) {
          return 1_000;
        }
        return false;
      },
    },
  ),
);

const provisionMutation = useMutation(
  trpc.workspace.provisionSandbox.mutationOptions({
    onSuccess: async () => {
      await queryClient.invalidateQueries(
        trpc.projects.get.queryFilter({ id: projectId }),
      );
      await queryClient.invalidateQueries(
        trpc.workspace.checkSandbox.queryFilter({ projectId, sessionId }),
      );
    },
  }),
);
```

   Prefer `provisionMutation.mutateAsync` inside the provision starter so the
   toast path can await the result.

3. Keep `retryRestore` mutation. On success: invalidate `projects.get` +
   check query only; **do not** call provision inside onSuccess — let check →
   auto-provision handle `needs_restore`.
4. Messages infinite query stays enabled from URL `sessionId` only (unchanged).

#### Refs

```ts
const provisionStartedRef = useRef(false);
const awaitingFenceRef = useRef(false);
const provisionToastRef = useRef<{ id: string } | null>(null);
```

On `projectId` / `sessionId` change (effect cleanup + setup):

- `toast.close` any loading toast id still held
- clear all three refs to initial false/null
- `provisionStartedRef` / `awaitingFenceRef` reset

#### Auto-provision (needs_restore only)

```ts
useEffect(() => {
  if (checkState !== "needs_restore") {
    // Re-arm so a later needs_restore (after failed attempt) can fire again.
    if (!provisionPending) provisionStartedRef.current = false;
    return;
  }
  if (provisionPending || provisionStartedRef.current) return;
  provisionStartedRef.current = true;
  void startProvisionWithToast();
}, [checkState, provisionPending, projectId, sessionId]);
```

Do **not** auto-provision when D1 or check says `provisioning`.

Also reset `provisionStartedRef.current = false` when provision settles a
terminal failure/throw (so Retry → check → needs_restore can start again).

#### Toast (provision only) — add/update/close, not promise

| Event | Toast |
|---|---|
| check → `connected` | **none** |
| this tab starts provision | `toast.add({ id: \`sandbox-provision-${projectId}\`, type: "loading", description: "Preparing project sandbox..." })` |
| provision → success states | `toast.update(id, { type: "success", description: "Project sandbox ready" })`; clear toast+awaiting refs |
| provision → `failed` | `toast.update` error `Workspace restore failed`; clear started ref |
| provision throws | `toast.update` error with `error.message` fallback `Project sandbox is not ready yet.`; clear started ref |
| provision → `provisioning` | **keep loading**; set `awaitingFenceRef.current = true` |
| D1 already provisioning on entry | **no** toast; stay disabled; poll |
| project/session change or unmount | `toast.close` if still holding a loading toast |

Lost-fence settle effect (mandatory):

```ts
useEffect(() => {
  if (!awaitingFenceRef.current) return;
  const toastId = provisionToastRef.current?.id;
  if (checkState === "connected") {
    if (toastId) {
      toast.update(toastId, {
        type: "success",
        description: "Project sandbox ready",
      });
    }
    awaitingFenceRef.current = false;
    provisionToastRef.current = null;
    provisionStartedRef.current = false;
    return;
  }
  if (checkState === "failed" || restoreFailed) {
    if (toastId) {
      toast.update(toastId, {
        type: "error",
        description: "Workspace restore failed",
      });
    }
    awaitingFenceRef.current = false;
    provisionToastRef.current = null;
    provisionStartedRef.current = false;
  }
}, [checkState, restoreFailed]);
```

**Delete** the current `isPreparing`-driven toast `useEffect` entirely.
Do **not** use `toast.promise`.

#### Disablement / bars

Definitions:

- `checkState = checkQuery.data?.sandbox?.state` when the query key matches
  current `projectId`/`sessionId` (React Query already scopes by input).
- `matchingProvision = provisionMutation.data` only when
  `workspaceMatches(data, projectId, sessionId)`; ignore stale ids.
- `provisionState = matchingProvision?.sandbox?.state`
- `awaitingFence = awaitingFenceRef.current` (read during render after the
  settle effect has run; triggering re-render via check query updates is
  enough — do not store awaiting fence only in a ref without a state tick if
  tests cannot observe disablement; if needed, mirror with
  `useState(false)` named `awaitingFence` updated alongside the ref).

```ts
const SUCCESS = new Set([
  "connected",
  "restored_from_backup",
  "recreated_from_github",
]);

const successReady =
  d1Status === "ready" &&
  !provisionPending &&
  !awaitingFence &&
  (checkState === "connected" ||
    (provisionState != null && SUCCESS.has(provisionState) && checkState !== "needs_restore"));
```

Steady state after success should be `checkState === "connected"` via
invalidation; do not require mutation data forever.

- While check pending/fetching with no success yet, `needs_restore`, provision
  pending, awaiting fence, or D1/check `provisioning`: disabled with
  `Project sandbox is being provisioned.`
- Terminal failure / check error: disabled with
  `Project sandbox is not ready yet.` + bar.
- **No** preparing status bar.
- Check-error Retry → `void checkQuery.refetch()` (auto-provision still applies
  if result is `needs_restore`).
- Restore-failed → `retryRestore` as today.

Invalidate **only** `projects.get` and the check query from readiness paths.
Never `projects.list`.

#### Route tests — concrete mock wiring

Replace ensure mocks. Live file’s `useQuery` currently always returns
`projectQueryState` and ignores keys — that must change.

```ts
const checkQueryState = vi.hoisted(() => ({
  current: {
    data: undefined as undefined | {
      project: { id: string; status?: string };
      selectedSession?: { id: string; status?: string; branchName?: string | null } | null;
      sandbox?: { state?: string };
      restoreFailed?: boolean;
    },
    error: null as Error | null,
    isPending: false,
    isFetching: false,
    refetch: vi.fn(),
  },
}));

// useQuery:
useQuery: (options: { queryKey?: unknown[] }) => {
  mutationCallIndex.current = 0;
  const key = JSON.stringify(options.queryKey ?? []);
  if (key.includes("checkSandbox")) return checkQueryState.current;
  return projectQueryState.current;
},

// useMutation order: 0 = provision, 1 = retryRestore
// provision return must include mutateAsync for the toast path:
mutate: provisionMutateMock,
mutateAsync: provisionMutateAsyncMock,
```

TRPC mock surface:

```ts
workspace: {
  checkSandbox: {
    queryOptions: (input: unknown, opts?: object) => ({
      queryKey: ["workspace", "checkSandbox", input],
      ...opts,
    }),
    queryFilter: (input: unknown) => ({
      queryKey: ["workspace", "checkSandbox", input],
    }),
  },
  provisionSandbox: {
    mutationOptions: (opts?: object) => opts ?? {},
  },
  retryRestore: {
    mutationOptions: (opts?: object) => opts ?? {},
  },
  messages: { /* unchanged */ },
},
```

Remove all `ensureWorkspace` mock keys.

Sample warm arrange:

```ts
checkQueryState.current = {
  data: {
    project: { id: "proj-1", status: "ready" },
    selectedSession: { id: "sess-1", status: "active", branchName: "main" },
    sandbox: { state: "connected" },
    restoreFailed: false,
  },
  error: null,
  isPending: false,
  isFetching: false,
  refetch: vi.fn(),
};
// expect toastAddMock not called; no disabled-reason; history visible
```

Sample cold arrange: check `needs_restore` → `provisionMutateAsyncMock` resolves
success → assert one call + loading then success toast updates.

Required cases:

1. **Warm path:** check `connected` → **no** toast add; enabled; messages visible.
2. **Cold path:** check `needs_restore` → exactly one provision; loading toast;
   enabled only after success; success toast.
3. **D1 provisioning:** no provision call; no toast; disabled; messages visible.
4. **Provision returns `provisioning`:** no success toast; after check flips to
   `connected`, success toast; if check flips to `failed`, error toast.
5. **Check error:** check-error bar + Retry; no provision toast; history visible.
6. **Restore failed:** restore-failed bar; history visible.
7. **Retry restore success:** onSuccess does not call provision; check re-runs;
   auto-provision only if needs_restore.
8. **No `projects.list` invalidation** on check/provision success.
9. **Stale provision payload** after projectId change ignored; toast closed on
   id change.
10. Messages query enabled before check/provision settles.

**Verify:**

```bash
pnpm --filter @ditto/web exec vitest run 'src/routes/project.$projectId.test.tsx'
pnpm check
```

Expected: route tests pass; no new Biome errors in the route/toast files
(fix the dirty exhaustive-deps / format issues as part of the rewrite).

### Step 5: Architecture docs (minimal)

Update only sentences that still describe a single `ensureWorkspace` /
combined ensure readiness entry:

- `docs/architecture/overview.md` — **Open a workspace**: check query first;
  provision mutation only on `needs_restore`; warm path silent.
- `docs/architecture/frontend.md` — browser data flow + accessibility: promise
  toast on provision only; no always-on preparing toast; sidebar still D1-only.
- `docs/architecture/server-and-data.md` — workspace router table + project
  lifecycle: `checkProjectSandbox` / `provisionProjectSandbox`; `needs_restore`
  is runtime-only (never written to D1).
- `docs/architecture/agent-harness.md` — Persistence: cold hydrate runs inside
  **provision**, not check; check is observation-only.
- `docs/architecture/repository-map.md` — route + `project-sandbox` + workspace
  router one-liners; replace `sonner.tsx` entry with `toast.tsx` if still stale.

Do not paste the full design doc into architecture docs.

**Verify:**

```bash
pnpm check && git diff --check
rg -n "ensureWorkspace|ensureProjectSandbox" docs/architecture apps/web/src \
  -g '!*test.*' -g '!*tests*'
```

Expected: `pnpm check` exit 0 (warnings-only outside in-scope OK); grep prints
nothing. Test-only negative mentions (e.g. sidebar asserting no ensure API) are
outside this grep.

### Step 6: Full gate + scope audit

```bash
pnpm --filter @ditto/web exec vitest run \
  src/lib/project-sandbox.test.ts \
  src/integrations/trpc/routers/workspace.test.ts \
  'src/routes/project.$projectId.test.tsx' \
  src/lib/agent-run-service.test.ts \
  src/lib/agent-git-handler.test.ts \
  src/lib/session-preview.test.ts \
  src/integrations/trpc/routers/session-git.test.ts \
  src/integrations/trpc/routers/projects.test.ts \
  src/integrations/trpc/routers/session-preview.test.ts
pnpm verify
git diff --check
git status --short
```

Expected:

- focused tests pass;
- `pnpm verify` exit 0;
- only in-scope files (+ pre-existing dirty toast migration files) modified;
- no schema/migration/agent-protocol/sidebar changes;
- `plans/README.md` marks 031 DONE or BLOCKED.

## Test plan

| Layer | Case | Expected |
|---|---|---|
| Domain check | healthy hydrated | `connected`, no D1 write |
| Domain check | inactive / unhydrated | `needs_restore`, no fence |
| Domain check | observation error | throws, no failed write |
| Domain provision | already connected | no-op connected |
| Domain provision | CAS loss | `provisioning`, not failed |
| Domain provision | restore success/fail | existing fence semantics |
| Router | check / provision payloads | secrets stripped; needs_restore present on check only as runtime state |
| Router | retryRestore | check-only follow-up; tombstone fence held |
| Route | warm visit | no toast; enabled |
| Route | cold visit | one provision + promise toast |
| Route | peer provisioning | silent wait |
| Route | lost fence | loading until check terminal |
| Route | history independence | messages render during check/provision |
| Callers | agent/git/preview/env | compile + tests green on provision rename |

Model structural tests after the existing files named in each step. No
snapshots; assert roles, text, disabled state, call counts, and D1 writes.

## Done criteria

All must hold:

- [ ] `checkProjectSandbox` never writes D1 status, never takes the fence, never restores
- [ ] `provisionProjectSandbox` is idempotent on `connected` and surfaces `provisioning` on contention without marking failed
- [ ] `workspace.checkSandbox` is a query; `workspace.provisionSandbox` is a mutation; `workspace.ensureWorkspace` is gone
- [ ] `needs_restore` appears only as a runtime API state (grep schema/migrations: no new column)
- [ ] Warm path route test proves **no** preparing/ready toast
- [ ] Cold path route test proves exactly one provision + toast lifecycle
- [ ] Peer `provisioning` path: no provision call, no toast
- [ ] Lost-fence path: no success toast until check terminal
- [ ] Actions stay disabled until connected/success provision state
- [ ] D1 messages still load while check/provision runs
- [ ] `rg -n "ensureProjectSandbox|ensureWorkspace" apps/web/src docs/architecture -g '!*test.*' -g '!*tests*'` prints nothing
- [ ] Focused tests + `pnpm typecheck` + `pnpm check` + `pnpm verify` pass
- [ ] `git diff --check` clean
- [ ] `plans/README.md` status updated

## STOP conditions

Stop and report (do not improvise) if:

- Live code no longer matches the excerpts / dirty hashes and the quiet-warm
  behavior cannot be expressed without a different architecture.
- Correct contention handling appears to require a D1 migration, lease token,
  or stale timeout.
- `getState()` / runner / hydrate helpers needed by check would force a
  dependency upgrade or `@cloudflare/containers` direct import.
- Disabling controls would remove Stop/follow-up from an already-running agent.
- A step requires out-of-scope files (sidebar, schema, agent stream, preview
  pane internals).
- A verification command fails twice after a reasonable in-scope fix.
- Lost-fence loading cannot be expressed with `toast.add`/`update` for any
  reason other than a Base UI API break — if `add({ id, type: "loading" })`
  fails to upsert, STOP (do not silently drop the edge case or switch to an
  untested promise wrapper).

## Maintenance notes

- `projects.status` still dual-purposes durable lifecycle and restore fence;
  `needs_restore` must remain ephemeral.
- Reviewers should scrutinize: check has zero D1 writes; only provision toasts;
  auto-provision ref does not loop; production callers handle
  `provisioning`/`failed` results.
- If Cloudflare adds richer runtime health later, extend check only — keep
  provision behind the same fence.
- Follow-ups explicitly deferred: stale-provisioning lease, keep-alive tuning,
  persisted runtime status column, sidebar provisioning presentation.
