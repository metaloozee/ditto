# Design: Split sandbox check from provision (quiet warm path)

**Date:** 2026-07-25  
**Status:** Approved for planning  
**Related:** Plan 030 (sandbox readiness loading), current uncommitted toast work on `project.$projectId.tsx`

## Problem

Entering or refreshing a project route always runs `workspace.ensureWorkspace` and surfaces a loading → success toast (“Preparing project sandbox…” / “Project sandbox ready”), even when the Cloudflare sandbox is already warm and the call is only a health check.

That toast is correct for real wake/restore work and irritating for routine visits.

Root cause: check and restore are one mutation, so the client cannot tell them apart.

## Goal

- Warm path: observe readiness with **no toast**.
- Cold path: auto-start restore and show a **promise toast only for that mutation**.
- Keep sandbox-backed actions disabled until check says ready or provision finishes successfully.
- No schema changes; D1 remains durable source of truth.

## Non-goals

- Persisted runtime status column
- Sidebar involvement
- Background `waitUntil` restore
- Bringing back the preparing status bar for the happy path
- Changing D1 message history loading (already independent of sandbox readiness)

## Locked decisions

1. **Approach:** Split API into `checkSandbox` (query) + `provisionSandbox` (mutation).
2. **Auto-provision:** If check returns `needs_restore`, the client immediately starts provision (no extra click).
3. **Toast:** Promise toast is for **provision only** — loading while this tab’s prepare work is in flight, resolve on terminal success, reject on error. If provision returns non-terminal `provisioning` (lost fence), do not resolve success; keep loading until check polling reaches a terminal state.
4. **Disablement:** Composer/git/preview stay disabled until check returns `connected` or provision completes in a success state.
5. **Remove** the route-level “toast on every `isPreparing`” effect and the single combined `ensureWorkspace` call site on this page.
6. **Error UI:** Keep the existing inline status bars for check errors and restore failure; do not use toasts as the only error surface for those terminal states.

## Server design

### Extract helpers (from `ensureProjectSandbox`)

Mirror the two phases already present in `apps/web/src/lib/project-sandbox.ts`:

#### `checkProjectSandbox`

- Input: db, env, project (must be owned; caller loads it).
- **Never** writes D1 status, never takes the provisioning fence, never restores.
- Behavior:
  - If `project.status !== "ready"` or missing `sandboxId`: return a non-ready result derived from D1 (`provisioning` | `failed` | not ready). Do not touch the container.
  - If D1 `ready`: `getState()` on the sandbox stub.
    - Inactive (`stopping` | `stopped` | `stopped_with_code`) → `{ state: "needs_restore" }`.
    - `healthy` | `running` → run existing hydration + runner probes:
      - both ok → `{ state: "connected" }`
      - runner unhealthy → throw the existing runner-image error
      - not hydrated → `{ state: "needs_restore" }`
    - Unknown runtime status → throw (same as today).
- Observation errors propagate; they must not mark the project `failed`.

#### `provisionProjectSandbox`

- Input: db, env, project.
- **Idempotent:** re-run the same observation as `checkProjectSandbox` first. If already `connected`, return `{ state: "connected" }` without taking the fence or restoring (stale client / double call safe).
- If observation says `needs_restore`, take the existing compare-and-set fence: `ready` → `provisioning` for this project/user.
- On fence loss: surface as `provisioning` (via existing `ProjectSandboxProvisioningError` handling), not as terminal failure.
- On fence win: run existing `restoreLockedProjectSandbox` path unchanged (`restored_from_backup` | `recreated_from_github`, backup write fenced to `provisioning`, failure → `failed`).
- Return states: `connected` (no-op) | `restored_from_backup` | `recreated_from_github` | `provisioning` | failed path.

Prefer deleting `ensureProjectSandbox` as a public entry once call sites move, or leave it as a thin internal test helper only if tests need it briefly — do not keep two production paths.

### tRPC (`workspace` router)

| Procedure | Kind | Role |
|-----------|------|------|
| `workspace.checkSandbox` | **query** | Load owned project (+ session view bits the page needs), run `checkProjectSandbox`, return workspace payload with `sandbox.state`. |
| `workspace.provisionSandbox` | **mutation** | Load owned project, run `provisionProjectSandbox`, return same style of workspace payload as today’s ensure success. |
| `workspace.retryRestore` | mutation | **Unchanged** (failed → ready). Client then runs check → maybe provision. |
| `workspace.ensureWorkspace` | mutation | **Remove**; update the single route call site and tests. |

#### `checkSandbox` result shape (conceptual)

Reuse the existing workspace view fields where possible:

- `project` (secrets stripped)
- `sandbox.state`: `connected` | `needs_restore` | `provisioning` | `failed` | …
- `selectedSession` / `sessions` as today if the page still needs them from this call
- `restoreFailed` when D1/status indicates failure

`needs_restore` is **new** at the API boundary. It must not be written to D1; it is a runtime observation only.

#### `provisionSandbox` result shape

Same workspace payload style as current ensure success:

- `sandbox.state`: `connected` (already warm no-op) | `restored_from_backup` | `recreated_from_github` | `provisioning` (lost race) | `failed`
- `restoreFailed` when applicable
- project + session fields as today

Client treats `connected` | `restored_from_backup` | `recreated_from_github` as terminal success for the promise toast.

### Unchanged server rules (from plan 030)

- D1 is authoritative for durable project status.
- Observe runtime with `getState()` before filesystem/command probes.
- Provisioning fence remains compare-and-set on `projects.status`.
- No automatic stale-provisioning timeout in this work.
- No `waitUntil` detach of restore.

## Client design

**File:** `apps/web/src/routes/project.$projectId.tsx` (`ProjectWorkspacePage`).

### Flow

```
projects.get → d1Status
  when d1Status === "ready":
    checkSandbox (query)
      connected      → successReady; enable UI; no toast
      needs_restore  → call provisionSandbox once via toast.promise; stay disabled
      provisioning   → stay disabled; poll/refetch check; no toast unless this tab starts provision
      failed         → restore-failed bar
  check error        → check-error bar; Retry re-runs check (then auto-provision if needed)
```

When `d1Status === "provisioning"` (another winner or in-flight restore visible via D1): do not toast; keep disabled; rely on existing `projects.get` refetch interval and/or check polling until ready/failed.

### Promise toast

- Only around **provision** (and only when this tab initiates it).
- Loading: `Preparing project sandbox...`
- Success: `Project sandbox ready`
- Error: mutation/error message
- Use a stable id per `projectId` (or a ref guard) so remounts do not stack duplicates.
- On project/session change or unmount: close in-flight toast (same cleanup intent as current code).

### Lock contention

If `provisionSandbox` **resolves** with `state: "provisioning"` (lost fence):

- Do **not** show success.
- Keep the loading toast and poll `checkSandbox` until `connected` / success-equivalent or `failed`, then settle the toast (success or error).
- User should see one continuous preparing story.

### Disablement

`workspaceUsable` / `disabledReason` stay gated on success readiness:

- Success: sandbox state in `connected` | `restored_from_backup` | `recreated_from_github`, D1 `ready`, no provision in flight.
- While check pending, `needs_restore`, provision pending, or D1/check `provisioning`: disabled with provisioning copy.
- Terminal failure: disabled with not-ready copy + status bar actions.

### Status bar

- Keep `restore-failed` and `check-error` bars with Retry actions.
- Do **not** restore the preparing status bar for the quiet check or provision happy path (toast covers provision).

### Retry actions

- **Retry** (check-error): re-run check; auto-provision still applies if `needs_restore`.
- **Retry restore**: existing `retryRestore`; on success, run check (and provision only if still needed) under the same toast rules.

### Removal

- Delete the `isPreparing`-driven toast `useEffect` that fires on every readiness cycle.
- Stop calling `ensureWorkspace`.
- Drop any dead toast helpers only used for that always-on path if nothing else needs them.

## Edge cases

| Case | Behavior |
|------|----------|
| Warm visit / refresh | check → `connected`; no toast; enable |
| Hibernated / empty workspace | check → `needs_restore` → provision + promise toast |
| Refresh mid-restore | D1 or check `provisioning`; silent wait; no new toast unless this tab calls provision |
| Two tabs restore | One wins fence; loser gets `provisioning` → loading/poll path |
| Project or session change mid-flight | Drop toast; new check for new ids |
| Runner image invalid | check errors → check-error bar |
| Network error on check | check-error bar; no provision toast |
| Provision throws after fence | toast rejects; D1 may be `failed` → restore-failed bar |

## Testing

### Server

1. `checkProjectSandbox` on healthy hydrated runtime returns `connected` and performs **no** D1 status update.
2. Inactive runtime or active-but-not-hydrated returns `needs_restore` without taking the fence.
3. `provisionProjectSandbox` still compare-and-sets `ready` → `provisioning` and restores; fence loss yields provisioning, not failed.

### Client / route

1. Warm path: check `connected` → no toast; workspace enabled.
2. Cold path: check `needs_restore` → exactly one provision call; promise toast used; enabled only after success state.
3. Already `provisioning`: no provision call; no toast; remains disabled until ready.
4. Provision returns `provisioning`: no success toast; remains in preparing handling until check terminal.
5. Regression: D1 messages still load while check/provision runs (history not blocked on sandbox).

## Files likely touched

- `apps/web/src/lib/project-sandbox.ts` (+ tests)
- `apps/web/src/integrations/trpc/routers/workspace.ts` (+ tests)
- `apps/web/src/routes/project.$projectId.tsx` (+ tests)
- Architecture docs only if they still describe a single `ensureWorkspace` readiness entry (keep docs minimal; update only if they would be wrong)

## Success criteria

- Re-entering a project with a warm sandbox does not show a preparing/ready toast.
- First visit or hibernated sandbox still auto-restores with a clear promise toast.
- Actions stay disabled until readiness is proven.
- No D1 schema migration; fence and restore behavior stay correct under contention.
