# Plan 034: Own every project sandbox before bootstrap and reconcile failures

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Preserve
> the original bootstrap error, never log credentials or raw cleanup errors, and
> never destroy a sandbox until D1 reconciliation proves this request still owns
> that exact sandbox. If a STOP condition occurs, stop and report; do not add a
> new lifecycle status, queue, cron, or migration.
>
> **Drift check (run first)**:
> `git diff --stat b783dec..HEAD -- apps/web/src/integrations/trpc/routers/projects.ts apps/web/src/integrations/trpc/routers/projects.test.ts apps/web/src/lib/sandbox-bootstrap.ts apps/web/src/lib/sandbox-bootstrap.test.ts apps/web/src/integrations/trpc/routers/workspace.ts apps/web/src/lib/session-preview.ts docs/architecture/server-and-data.md docs/architecture/security.md plans/034-own-and-clean-project-sandboxes.md plans/README.md`
> Plans 032 and 033, the index, and the approved umbrella spec are expected
> planning artifacts. Plans 032/033 must land before this plan; rebase the two
> documentation edits around their landed text. Record `git status --short`.
> Compare every excerpt below against live code. Any semantic drift in project
> creation, retry, deletion, bootstrap cleanup, or sandbox backup ownership is a
> STOP condition. Preserve all initial out-of-scope entries byte-for-byte.

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plans 014, 031, 032, and 033 (014/031 are DONE; 032/033 must land first)
- **Category**: bug
- **Requirements**: SANDBOX-1 from the approved platform-hardening specification
- **Planned at**: commit `b783dec`, 2026-07-29

## Why this matters

A GitHub-import project currently allocates, populates, and backs up a sandbox
before D1 records the sandbox ID. If the final `ready` update fails, the router
can mark the project failed but has no durable ownership record from which to
clean or retry the live sandbox. The result is an untracked container and an
ambiguous project row.

After this plan, the initial `provisioning` row owns its generated sandbox ID
before any Sandbox SDK operation. Final readiness is compare-and-set fenced;
ambiguous D1 completion is read back before cleanup; and every failed bootstrap
is either destroyed or left as a failed row with the exact sandbox ID and backup
handle required by the existing retry/delete paths.

## Current state

The approved source is
`docs/superpowers/specs/2026-07-26-platform-hardening-design.md`, Workstream 3,
SANDBOX-1. Its invariant is: every successfully created sandbox is either
associated durably with its project or destroyed.

### Ownership is recorded too late

`apps/web/src/integrations/trpc/routers/projects.ts:77-104` inserts first, then
generates the ID:

```ts
const [project] = await db
  .insert(projects)
  .values({
    id: projectId,
    // ...
    status: githubImport ? "provisioning" : "ready",
  })
  .returning();

// ...
const sandboxId = crypto.randomUUID().toLowerCase();
```

`apps/web/src/integrations/trpc/routers/projects.ts:107-142` bootstraps and backs
up first, then stores ownership/readiness using only `project.id`; its catch only
writes `failed`:

```ts
const { backup } = await bootstrapSandbox({ /* projectId + sandboxId */ });

const [updatedProject] = await db
  .update(projects)
  .set({ sandboxId, sandboxBackup: serializeSandboxBackup(backup), status: "ready" })
  .where(eq(projects.id, projectId))
  .returning();

// catch: status = "failed"; no post-bootstrap destroy
```

The final update is not fenced by `userId`, `sandboxId`, `provisioning`, or
`deletingAt IS NULL`. It can therefore lose its response after a committed write
or race a project deletion without enough evidence to choose cleanup safely.

### Existing lifecycle behavior to preserve and reuse

- `apps/web/src/lib/sandbox-bootstrap.ts:510-553` owns failures *inside*
  `bootstrapSandbox` and calls `sandbox.destroy()` before rethrowing. Do not
  routinely double-destroy those failures.
- `apps/web/src/lib/sandbox-bootstrap.ts:543-549` returns the exact candidate
  backup handle before the router's final D1 write.
- `apps/web/src/integrations/trpc/routers/workspace.ts:183-240` already retries a
  failed project by fencing `failed -> ready`, then observing the recorded
  sandbox ID. A destroyed sandbox with the same stable ID is recreated and may
  restore the retained backup.
- `apps/web/src/lib/session-preview.ts:1270-1378` already implements retryable
  deletion: tombstone D1, destroy the recorded sandbox, then delete the row; a
  destroy failure retains the tombstone.
- `projects.sandboxId`, backup fields, `status`, and `deletingAt` already exist in
  `apps/web/src/db/schema.ts:37-68`. No schema or migration is needed.
- `apps/web/src/integrations/trpc/routers/projects.test.ts` currently
  characterizes deletion only. Use its real router caller and hoisted import
  mocks; do not create a second router harness.
- `apps/web/src/lib/sandbox-bootstrap.test.ts:307-373` is the current bootstrap
  success/failure and destroy-spy pattern.
- `apps/web/src/lib/project-sandbox.test.ts:923-981` demonstrates stale
  completion/fence-loss tests; use the same explicit call-order style.

Cloudflare's current lifecycle documentation confirms that the same sandbox ID
resolves the same Sandbox Durable Object and that `sandbox.destroy()` removes
its files/processes/state permanently:
<https://developers.cloudflare.com/sandbox/concepts/sandboxes/>.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install app | `pnpm install --frozen-lockfile` | exit 0; lockfile unchanged |
| Install runner | `pnpm runner:install` | exit 0; runner lockfile unchanged |
| Focused tests | `pnpm --filter @ditto/web exec vitest run src/integrations/trpc/routers/projects.test.ts src/lib/sandbox-bootstrap.test.ts src/lib/project-sandbox.test.ts src/integrations/trpc/routers/workspace.test.ts src/lib/session-preview.test.ts` | all pass; planning-time narrow baseline was 57 tests for the first three files |
| Focused check | `pnpm exec biome check apps/web/src/integrations/trpc/routers/projects.ts apps/web/src/integrations/trpc/routers/projects.test.ts apps/web/src/lib/sandbox-bootstrap.ts apps/web/src/lib/sandbox-bootstrap.test.ts` | exit 0; no errors |
| Full gate | `pnpm verify` | exit 0, or only the exact pre-existing failure documented by landed Plan 033; no new failure |
| Diff hygiene | `git diff --check` | no output |
| Scope audit | `git status --short` | initial entries plus intended in-scope changes only |

Do not run `pnpm format`, `pnpm fix`, database generation, migration commands,
deploy, or destroy.

## Scope

**In scope** (the only implementation/docs files to modify):

- `apps/web/src/integrations/trpc/routers/projects.ts`
- `apps/web/src/integrations/trpc/routers/projects.test.ts`
- `apps/web/src/lib/sandbox-bootstrap.ts`
- `apps/web/src/lib/sandbox-bootstrap.test.ts`
- `docs/architecture/server-and-data.md`
- `docs/architecture/security.md`
- `plans/README.md` status only after execution

**Read/verify but do not modify**:

- `apps/web/src/integrations/trpc/routers/workspace.ts` and `.test.ts` — existing
  failed-project retry is the recovery path; this plan proves compatibility but
  does not redesign it.
- `apps/web/src/lib/session-preview.ts` and `.test.ts` — existing deletion owns
  cleanup once `deletingAt` is set.
- `apps/web/src/lib/project-sandbox.ts` and `.test.ts` — restore/recreate and
  provisioning fences stay unchanged.
- `apps/web/src/lib/sandbox-backup.ts` — serialization and R2 naming stay
  unchanged.
- `apps/web/src/db/schema.ts` and `apps/web/migrations/**` — current columns are
  sufficient.
- The approved umbrella spec.

**Out of scope**:

- A scheduled orphan scanner, Queue, Workflow, alarm, stale-provisioning timeout,
  or sandbox inventory API.
- Recovering historical orphans created before this change; their IDs were not
  recorded and cannot be inferred safely from current D1.
- Deleting superseded/unreferenced R2 backup objects or changing R2 lifecycle.
- Runner UID/integrity, entrypoint contracts, Git isolation, environment-variable
  concurrency, preview lifecycle, schema/status additions, or UI redesign.
- Changing the one-sandbox-per-project ID model.

## Git workflow

- Branch: `advisor/034-project-sandbox-ownership`
- Start after Plans 032 and 033 are landed.
- Commit: `fix(sandbox): own bootstrap before allocation`
- Keep implementation/tests together; documentation may be a second commit.
- Do not push, open a PR, merge, deploy, or use live credentials unless the
  operator separately authorizes the optional smoke.

## Target design

Keep orchestration in `projectsRouter.create`; do not add a service class or a
new lifecycle table.

1. Generate the import sandbox UUID before the initial insert. Store it on the
   initial `status: "provisioning"` row. Non-import projects keep `sandboxId:
   null` and `status: "ready"`.
2. Do not call any Sandbox API before that insert returns successfully.
3. Keep the returned backup handle in scope. Finalize with one compare-and-set
   update constrained by project ID, user ID, the exact sandbox ID,
   `status = provisioning`, and `deletingAt IS NULL`.
4. Treat an empty `.returning()` and a thrown update as ambiguous/fence loss.
   Reload the authoritative row before deciding whether to destroy:
   - `ready`, same sandbox ID, and the exact serialized backup already stored:
     the write committed; return that row and do not destroy;
   - missing or `deletingAt != null`: deletion owns cleanup; do not overwrite or
     double-destroy;
   - `provisioning`, same sandbox ID: attempt cleanup, then fence a `failed`
     write that retains the same ID plus the candidate serialized backup and
     `sandboxBackupCreatedAt` timestamp for retry;
   - any different sandbox ID or impossible state: STOP/fail closed; never
     destroy a sandbox based on a mismatched row.
5. Keep failed rows' sandbox IDs even after successful destroy. The stable ID is
   the durable ownership/reconciliation key used by existing retry and delete.
6. If `bootstrapSandbox` itself fails before returning, let its existing cleanup
   own the sandbox, then mark the pre-associated row failed without a second
   routine destroy.
7. Cleanup failure uses the repository's existing logging convention directly:
   `console.error("Failed to destroy project sandbox after bootstrap.", {
   projectId, sandboxId, phase })`. The object has exactly those three fields and
   the phase is a code-owned enum/string. Never pass the caught error object or
   message, repository data, token, environment value, or backup credential.
8. Change `bootstrapSandbox` cleanup so a failed `destroy()` does not replace the
   original bootstrap exception. Preserve that original error for the router's
   existing redacted client mapping.

Do not assume arbitrary repeated `destroy()` calls are idempotent. Reconciliation
must decide ownership first.

## Steps

### Step 0: Record the landed baseline

1. Confirm Plans 032 and 033 are no longer TODO and their implementation commits
   are ancestors of `HEAD`.
2. Run the drift/status commands and save their output in execution notes.
3. Install with frozen lockfiles in the isolated executor worktree.
4. Run the focused suite once. Record test counts and any accepted pre-existing
   full-suite failure from Plan 033.

**Verify**: focused tests pass before edits; no implementation path differs from
Current state.

### Step 1: Add failing router ownership/reconciliation tests

Extend `projects.test.ts` using the existing real caller and mocked imports. Add
only enough DB fake behavior to model insert, update/returning, and authoritative
readback. Do not reproduce Drizzle generally.

Add named tests for:

1. GitHub import stores the generated lower-case sandbox ID in the initial
   `provisioning` insert before `bootstrapSandbox` is called.
2. Non-import creation stores no sandbox ID and invokes no bootstrap/destroy.
3. Success finalizes only under the full ownership/status/tombstone fence and
   returns no backup/env payload.
4. Injected final-write failure after bootstrap backup destroys the exact
   sandbox, then retains `failed + sandboxId + serialized backup` for retry.
5. Cleanup rejection preserves the failed ownership record, logs only static
   correlation fields, and does not expose the synthetic cleanup message.
6. A readiness update that committed but threw is confirmed by readback and
   does not call destroy.
7. A tombstoned/deleted row is not overwritten or double-destroyed.
8. A row containing another sandbox ID never causes that other sandbox to be
   destroyed.
9. Bootstrap failure marks the pre-associated row failed but does not add an
   outer duplicate destroy.

Use synthetic IDs and errors only. Assert call order explicitly.

**Verify**:
`pnpm --filter @ditto/web exec vitest run src/integrations/trpc/routers/projects.test.ts`
→ the new tests fail only for missing ownership/fence/reconciliation behavior.

### Step 2: Persist ownership first and reconcile finalization

Update `projectsRouter.create` to implement Target design exactly. Keep input
validation, GitHub authorization, environment encryption, response redaction,
and non-import behavior unchanged.

Use one small private helper in `projects.ts` only if it makes the finalization
readback/cleanup branch directly testable. Do not add a generic state-machine or
repository abstraction.

Important ordering:

```text
validate/auth/encrypt
-> generate sandbox ID
-> insert provisioning row with ID
-> bootstrap + backup
-> fenced ready update
-> if ambiguous: authoritative readback
-> if still owned: cleanup attempt settles
-> fenced failed record retaining ID/backup
-> redacted TRPC error
```

If cleanup fails, still attempt/persist the retryable failed record with
`status`, unchanged `sandboxId`, candidate `sandboxBackup`, and
`sandboxBackupCreatedAt` when bootstrap returned a backup. If the failed-record
write also fails, preserve the original provisioning row and ID; do not invent
success or destroy a mismatched sandbox.

A Worker crash after bootstrap returns but before either finalization or catch
runs can still leave `provisioning + sandboxId`. This plan deliberately adds no
stale-row reconciler. The ID makes the sandbox identifiable; the current human
recovery is project deletion, whose existing tombstone path destroys the
recorded ID. Record this residual in the architecture docs and execution notes.

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/integrations/trpc/routers/projects.test.ts src/integrations/trpc/routers/workspace.test.ts src/lib/session-preview.test.ts
```

Expected: all pass; existing retry/delete behavior remains green.

### Step 3: Preserve bootstrap errors when cleanup also fails

In `sandbox-bootstrap.ts`, keep internal bootstrap cleanup, but prevent a
cleanup exception from replacing the clone/install/backup failure. Log only the
fixed phase and project/sandbox IDs; rethrow the original exception.

Extend `sandbox-bootstrap.test.ts` with:

- original clone/install/backup error survives a synthetic destroy rejection;
- cleanup failure log contains IDs/phase but not the synthetic raw error;
- successful internal cleanup still occurs exactly once;
- successful bootstrap still does not destroy.

Do not change clone credentials, dependency commands, backup options, or normal
return shape.

**Verify**:
`pnpm --filter @ditto/web exec vitest run src/lib/sandbox-bootstrap.test.ts src/integrations/trpc/routers/projects.test.ts`
→ all pass.

### Step 4: Update lifecycle/security documentation

Update the narrow relevant paragraphs:

- `server-and-data.md`: initial provisioning row owns the stable sandbox ID;
  readiness is fenced; failed rows retain ID/backup for current retry/delete;
  ambiguous completion is read back before cleanup; a hard Worker/D1 outage may
  leave a provisioning row whose recorded ID requires manual project deletion
  because no stale-row reconciler exists yet.
- `security.md`: every allocation is durably correlated before first sandbox
  operation; post-bootstrap cleanup logs only static IDs/phase; deletion remains
  authoritative once tombstoned.

Do not document SANDBOX-2/3/4 behavior that has not landed.

**Verify**:
`rg -n "sandbox ID|provisioning|fence|cleanup|retry" docs/architecture/server-and-data.md docs/architecture/security.md`
→ both documents state the new ownership contract without claiming a background
reconciler.

### Step 5: Run all gates and optional live failure injection

Run the focused tests, focused Biome check, then `pnpm verify`, diff hygiene, and
scope audit.

If an operator provides an authorized disposable environment and a safe D1
failure-injection mechanism, run one smoke that fails after backup but before
ready persistence. Confirm:

- the project row already contains the expected sandbox ID;
- runtime state is destroyed/stopped;
- the row is failed and retains the candidate backup;
- Retry restore recreates the same ID and reaches ready; and
- no raw cleanup error/credential appears in logs.

Do not add a production failure flag solely for this smoke. If no existing safe
injection seam exists, record the live smoke NOT RUN; deterministic tests are the
required gate for this plan.

## Test plan

| Case | Test file | Required assertion |
|---|---|---|
| Ownership before allocation | `projects.test.ts` | provisioning insert with ID occurs before bootstrap |
| Non-import create | same | ready, no ID, no sandbox calls |
| Fenced ready | same | ID/user/status/tombstone predicate; backup stored |
| Final write failure | same | exact sandbox destroyed; failed row retains ID/backup |
| Ambiguous committed write | same | readback returns ready; no destroy |
| Delete race | same | tombstone/missing row not overwritten/double-destroyed |
| Mismatched ownership | same | unrelated sandbox is never destroyed |
| Cleanup failure | same | retry record retained; static correlation-only log |
| Internal bootstrap failure | `sandbox-bootstrap.test.ts` | cleanup once; original error preserved |
| Existing retry (run-only regression; do not edit) | `workspace.test.ts` | failed + ID reaches current `needs_restore` path |
| Existing delete retry (run-only regression; do not edit) | `session-preview.test.ts` | destroy failure keeps retryable tombstone |

## Done criteria

ALL must hold:

- [ ] The sandbox ID is stored in the initial import `provisioning` row before
      any Sandbox SDK call.
- [ ] Final `ready` persistence is fenced by project, user, exact sandbox,
      provisioning status, and no deletion tombstone.
- [ ] A thrown/empty final write is read back before any cleanup decision.
- [ ] An already-committed matching ready row is returned without destroy.
- [ ] A post-bootstrap failure destroys only the exact owned sandbox or leaves a
      failed row retaining its exact ID, serialized candidate backup, and backup
      timestamp for retry/delete.
- [ ] Tombstoned/missing/mismatched rows are never overwritten and unrelated
      sandbox IDs are never destroyed.
- [ ] Internal bootstrap cleanup failure does not mask the original failure.
- [ ] Cleanup logs contain only static context plus project/sandbox IDs; no raw
      error or credential material.
- [ ] No schema, migration, UI, runner, or dependency change exists.
- [ ] Focused tests, Biome, `pnpm verify` (subject only to the recorded baseline),
      and `git diff --check` pass.
- [ ] No file outside Scope changed; initial user-owned files are preserved.
- [ ] Plan 034 status in `plans/README.md` is updated after review.

## STOP conditions

Stop and report without improvising if:

- Existing production orphans must be discovered; old failed rows do not contain
  their sandbox IDs.
- Correct recovery requires a new status/column, scheduled reconciler, queue,
  alarm, Workflow, or stale-provisioning lease.
- D1 cannot distinguish an already-committed ready update from a failed update by
  authoritative readback.
- A deletion path can remove the D1 row without first owning/destroying its
  recorded sandbox.
- Cleanup needs arbitrary repeated-destroy semantics or a timeout/cancellation
  contract not supplied by the SDK.
- Backup objects must be deleted explicitly; current code has no backup deletion
  contract and this plan does not invent one.
- The fix requires runner, Docker, credential, Git, preview-process, environment,
  schema, migration, or public response changes.
- A verification command fails twice after a reasonable in-scope correction.

## Maintenance notes

The stable sandbox ID is both the runtime locator and the cleanup/retry key.
Future project-creation paths must persist it before first sandbox contact and
must use the same fenced finalization/readback rule. Reviewers should scrutinize
ambiguous D1 commit handling and deletion races first. Historical orphans and R2
object lifecycle remain separate operator/planning work.
