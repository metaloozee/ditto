# Plan 040: Write Run-End R2 Snapshot Checkpoints from FlueRunBridge

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
> git diff --stat 1d398af..HEAD -- src/lib/flue-run-bridge.ts src/lib/r2-layout.ts src/lib/sandbox-backup.ts src/lib/sandbox-bootstrap.ts src/lib/project-sandbox.ts src/lib/workspace-policy.ts src/db/schema.ts src/lib/flue-run-bridge.test.ts src/lib/r2-layout.test.ts plans/README.md
> git diff --stat -- src/lib/flue-run-bridge.ts src/lib/r2-layout.ts src/lib/sandbox-backup.ts src/lib/sandbox-bootstrap.ts src/lib/project-sandbox.ts src/lib/workspace-policy.ts src/db/schema.ts src/lib/flue-run-bridge.test.ts src/lib/r2-layout.test.ts plans/README.md
> ```
>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. If an
> excerpt no longer matches and the difference is not merely formatting,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: 039 (DONE — mutating Flue path must exist to checkpoint it)
- **Category**: architecture / durability
- **PRD phase**: Phase 4, step 1 (final-run checkpoints)
- **Planned at**: commit `1d398af`, 2026-07-04

## Why this matters

The PRD acceptance criteria require "Successful mutating work produces a real
diff and R2 checkpoint" and "Sandbox hibernation does not lose accepted
workspace state." Today a successful mutating Flue run finishes by writing a
text-only `final_change_summary` (`git status --short` + `git diff --stat`)
into `agent_run_events` — it never writes an R2 object, never inserts a
`snapshots` row, and never updates a manifest. The tested `r2-layout.ts`
helpers (`snapshotArchiveKey`, `buildSnapshotManifest`, `resolveSnapshotPointer`)
and the `snapshots` / `run_artifacts` D1 tables are dead code in every live
path. Workspace durability still depends entirely on the legacy
`projects.sandboxBackup` column refreshed by `ensureProjectSandbox`, which has
no digest, no manifest, and no per-run checkpoint record. This plan makes a
successful mutating run produce the PRD's R2 snapshot + manifest + D1 pointer,
establishing the checkpoint that plans 041–043 build on.

## Current state

- `src/lib/flue-run-bridge.ts` — the per-session Durable Object that owns the
  mutating run lifecycle in the `website` Worker. It already has access to
  `DB`, `BACKUP_BUCKET`, `Sandbox`, and `ProjectCoordinator` (all bound to the
  `website` Worker in `alchemy.run.ts`).
  - `FlueRunBridgeState` (lines 23–39) has `isMutating?: boolean` and
    `fencingToken?: number` but **no snapshot fields**:
    ```ts
    export type FlueRunBridgeState = {
      sessionId?: string; userId?: string; projectId?: string; sandboxId?: string;
      activeRunId?: string; flueAgentName?: string; flueAgentInstanceId?: string;
      flueStreamPath?: string; streamOffset?: string; streamCursor?: string | null;
      streamClosed?: boolean; canceledRunIds?: string[]; isMutating?: boolean; fencingToken?: number;
    };
    ```
  - `finishRun(runId, status)` runs the terminal batch (update `agentRuns` to
    terminal, clear `projects.activeAgentRunId`, insert terminal events) then
    calls `notifyProjectCoordinator(...)`. It does **not** write to R2 or
    insert a `snapshots` row. The only mutating-specific terminal work is
    `buildFinalChangeSummaryEvents` (lines ~575–615), which is gated on
    `state.isMutating !== true || !state.sandboxId` returning `[]`, and which
    emits one `tool_finished` event whose payload is redacted
    `git status --short` + `git diff --stat` text.
  - Imports today: `createDb`, `agentRunEvents, agentRuns, projects`,
    `AssistantStreamDraft`, the Flue adapter, `mapFlueEventToDittoEvents`,
    `getProjectSandbox` from `sandbox-bootstrap`, `redactSecrets`,
    `createAgentRunEventPayload`, and the broker frame type. **No `r2-layout`
    import, no `snapshots` / `run_artifacts` import, no `backupSandboxWorkspace`
    import.**
- `src/lib/r2-layout.ts` — pure, tested helpers (13 tests in
  `r2-layout.test.ts`). Exports this plan consumes:
  - `snapshotManifestKey(projectId, snapshotId)` →
    `projects/{projectId}/snapshots/{snapshotId}/manifest.json`
  - `buildSnapshotManifest({ snapshotId, projectId, runId, r2Key, baseCommitSha, digest, createdAt })`
    → `SnapshotManifest` (includes `excludedPaths: [...SNAPSHOT_SECRET_EXCLUDES]`,
    `schemaVersion: 1`)
  - `resolveSnapshotPointer({ ok: boolean }, manifest)` →
    `{ updateD1: true, pointer: { r2Key, digest } }` or `{ updateD1: false }`
    (this encodes the PRD policy: D1 pointer updates only after the R2 write
    succeeds and the manifest validates)
  - `validateSnapshotManifest(value)` — type guard
  - `SNAPSHOT_SECRET_EXCLUDES` — `.env`, `.env.*`, `.npmrc`, `.aws`, `.ssh`, …
- `src/lib/sandbox-bootstrap.ts` — `backupSandboxWorkspace({ env, sandboxId, projectId })`
  (line 174) returns a `DirectoryBackup` by calling
  `sandbox.createBackup(getSandboxBackupOptions(...))`. The backup options
  already exclude secrets via `SANDBOX_BACKUP_EXCLUDES` (`node_modules`,
  `.env`, `.env.*`, …) and write to the `BACKUP_BUCKET` R2 bucket (name
  `project-{projectId}`). `getProjectSandbox(env, sandboxId)` (line 12) is the
  sandbox handle factory.
- `src/lib/sandbox-backup.ts` — `serializeSandboxBackup(backup)` /
  `parseSandboxBackup(value)` round-trip a `DirectoryBackup`
  (`{ id, dir, localBucket? }`) to the `projects.sandboxBackup` JSON column.
  This is the existing restore handle.
- `src/db/schema.ts` — `snapshots` table (id, projectId, runId, r2Key,
  baseCommitSha, digest, status `pending|completed|failed`, createdAt,
  completedAt) and `run_artifacts` table (id, runId, projectId, kind
  `diff|log|attachment|generated`, r2Key, contentType, byteLength, createdAt).
  Both already exist from migration `0005`; nothing writes them yet.
- `src/lib/workspace-policy.ts` — `AGENT_RUN_EVENT_TYPES` is
  `message, tool_started, tool_finished, command_output, file_changed,
  diff_ready, needs_input, lock_rejected, done, error`. There is **no
  `snapshot_*` event type** today.
- `alchemy.run.ts` — `BACKUP_BUCKET` (R2Bucket `ditto-{stage}-sandbox-backups`)
  and `DB` are bound to the `website` Worker (the Worker that hosts
  `FlueRunBridge`). The private `flueWorker` does **not** receive `BACKUP_BUCKET`
  or `DB`. The checkpoint therefore belongs in `FlueRunBridge` (website), not
  in the Flue Worker.
- Repo conventions: D1 writes inside the bridge use `createDb(this.env)` and
  `db.batch([...])` (see `finishRun`). Redaction uses `redactSecrets` from
  `#/lib/secret-redaction` before any text is persisted or broadcast. Bounded
  sandbox commands use `sandbox.exec(cmd, { cwd: "/workspace", timeout })`.
  Error handling throws `Error` with a short message; the bridge's
  `failRunAfterDispatchError` is the exemplar for failing a run durably.

## Commands you will need

| Purpose    | Command                                      | Expected on success |
|------------|----------------------------------------------|---------------------|
| Typecheck  | `pnpm exec tsc --noEmit --pretty false`      | exit 0, no errors   |
| Unit tests | `pnpm test -- src/lib/flue-run-bridge.test.ts src/lib/r2-layout.test.ts` | all pass |
| Full tests | `pnpm test`                                  | exit 0              |
| Lint       | `pnpm lint`                                  | exit 0 (only the 2 pre-existing warnings in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`) |
| Flue build | `pnpm flue:build`                            | exit 0 (known DO migration warning only) |
| Whitespace | `git diff --check`                           | exit 0              |

## Design spike first (resolve before broad edits)

Prove the snapshot archive + manifest relationship in the smallest possible
change before touching `finishRun`. The question: how does the PRD's
Ditto-owned manifest (`snapshotManifestKey`, `buildSnapshotManifest`) relate
to the sandbox-SDK-owned restorable archive (`DirectoryBackup` from
`sandbox.createBackup`)?

This plan adopts **option A** unless the spike disproves it:

- Reuse `backupSandboxWorkspace({ env, sandboxId, projectId })` to produce the
  restorable R2 archive (`DirectoryBackup`). It is the only tested, restorable
  primitive and already excludes secrets via `SANDBOX_BACKUP_EXCLUDES`.
- Write a Ditto-owned manifest object to `BACKUP_BUCKET` at
  `snapshotManifestKey(projectId, snapshotId)` using `buildSnapshotManifest`.
  Store the `DirectoryBackup.id` (the sandbox-SDK R2 object id needed to
  restore) as a new field on the manifest so a future restore (plan 042) can
  recover the archive handle from the manifest. This requires adding an
  optional `archiveRef` field to `SnapshotManifest` / `buildSnapshotManifest` /
  `validateSnapshotManifest` in `r2-layout.ts` and extending
  `r2-layout.test.ts`.
- Insert a `snapshots` D1 row with `r2Key` = the manifest key, `digest`,
  `baseCommitSha`, `runId`, `status: "completed"`, `completedAt: now` — only
  after both the backup and the manifest `put` succeed, gated by
  `resolveSnapshotPointer({ ok }, manifest)`.
- Also update `projects.sandboxBackup` / `projects.sandboxBackupCreatedAt` to
  the fresh `serializeSandboxBackup(directoryBackup)` so the existing
  `ensureProjectSandbox` restore path (plan 042 hardens it) keeps using the
  latest checkpoint.

STOP if `sandbox.createBackup` does not return a `DirectoryBackup` whose `id`
can be stored and later passed back to `sandbox.restoreBackup(backup)` (verify
by reading `node_modules/@cloudflare/sandbox` type declarations). If the backup
`id` is not round-trippable, write a short decision note under
`docs/decisions/` and mark this plan BLOCKED rather than faking a manifest.

## Scope

**In scope** (the only files you should modify):
- `src/lib/r2-layout.ts` — add optional `archiveRef` to the manifest shape + validation + builder
- `src/lib/r2-layout.test.ts` — cover the new field
- `src/lib/flue-run-bridge.ts` — add a `checkpointMutatingRun(...)` step called from `finishRun` on successful mutating runs
- `src/lib/flue-run-bridge.test.ts` — cover checkpoint success, R2-failure-skips-D1, non-mutating-skips, canceled-skips
- `src/lib/workspace-policy.ts` — add `snapshot_started`, `snapshot_completed`, `snapshot_failed` to `AGENT_RUN_EVENT_TYPES`
- `plans/README.md` — status row

**Out of scope** (do NOT touch, even though they look related):
- `src/lib/project-sandbox.ts` / `src/lib/sandbox-bootstrap.ts` restore logic — plan 042 hardens restore. This plan only *writes* checkpoints; it must not change the restore path.
- `src/lib/project-coordinator.ts` — no `snapshot.restoring` state here; that is plan 041.
- Any UI / `workspace.get` status surface changes — plan 041.
- Periodic mid-run checkpoints — plan 043. This plan is final-run checkpoints only.
- The private `flueWorker` bindings in `alchemy.run.ts` — the checkpoint runs in the `website` Worker, which already has `BACKUP_BUCKET` and `DB`.
- Historical (non-latest) snapshot restore — out of v1 scope; the `snapshots` table is the checkpoint log/index, `projects.sandboxBackup` remains the fast restore handle for the latest checkpoint.

## Git workflow

- Branch: `advisor/040-run-end-r2-snapshot-checkpoint`
- Commit per logical unit (r2-layout field; event types; bridge checkpoint; tests). Conventional Commits style matching `git log --oneline` (e.g. `feat(durability): write run-end r2 snapshot checkpoint`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extend the snapshot manifest with an optional archive ref

Add an optional `archiveRef: string | null` to `SnapshotManifest` and
`SnapshotManifestInput` in `src/lib/r2-layout.ts`. Carry it through
`buildSnapshotManifest`. In `validateSnapshotManifest`, accept `null` or a
non-empty string; reject arrays/objects. Keep `excludedPaths` validation
(including `.env` and `.env.*`) intact.

**Verify**: `pnpm test -- src/lib/r2-layout.test.ts` → all pass, including
new cases: manifest with `archiveRef: "abc"` validates; `archiveRef: ""`
rejects; `archiveRef: null` validates.

### Step 2: Add snapshot event types

Add `"snapshot_started"`, `"snapshot_completed"`, `"snapshot_failed"` to the
`AGENT_RUN_EVENT_TYPES` array in `src/lib/workspace-policy.ts`. Do not reorder
existing entries. The `AgentRunEventType` union updates automatically.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0.

### Step 3: Add a pure checkpoint helper module (testable without R2)

Create `src/lib/run-snapshot-checkpoint.ts` exporting a pure
`buildSnapshotCheckpointPlan(...)` (or similarly named) function that, given
`{ projectId, runId, sandboxId, baseCommitSha, digest, createdAt }`, returns
the manifest key, the `SnapshotManifest` (via `buildSnapshotManifest`), and the
`snapshots` row values to insert — without performing I/O. Also export a
`computeWorkspaceDigest(...)` pure helper that hashes a deterministic workspace
state string (`baseCommitSha` + redacted `git status --short` + `git diff
--stat`) with `crypto.subtle` / `node:crypto` SHA-256 and returns hex. Keep it
injectable so tests can pass a fake. This mirrors the existing pure-helper
pattern (`r2-layout.ts`, `project-run-projection.ts`, `flue-event-projection.ts`).

**Verify**: `pnpm test -- src/lib/run-snapshot-checkpoint.test.ts` → new tests
pass (digest is deterministic; manifest key matches
`snapshotManifestKey(projectId, snapshotId)`; `resolveSnapshotPointer` returns
`updateD1: false` when `ok: false`).

### Step 4: Wire the checkpoint into `FlueRunBridge.finishRun`

In `src/lib/flue-run-bridge.ts`:

- Import `backupSandboxWorkspace` from `#/lib/sandbox-bootstrap`,
  `serializeSandboxBackup` from `#/lib/sandbox-backup`, the
  `r2-layout` helpers, the new `run-snapshot-checkpoint` helpers, `snapshots`
  and `run_artifacts` from `#/db/schema`, and `crypto.randomUUID` (or the
  Web Crypto `crypto.randomUUID()` available in Workers).
- Add a private `async checkpointMutatingRun(state, runId): Promise<void>`
  that runs **only when `state.isMutating === true` and the terminal `status`
  is `"completed"`** (not failed, not canceled — canceled runs already clear
  state in `clearCanceledRun`). It must:
  1. Emit a `snapshot_started` event (insert into `agent_run_events`, broadcast
     a `{ type: "snapshot_started", runId }` frame — reuse the existing
     `WorkspaceSessionBrokerFrame` vocabulary if a `snapshot_*` frame fits,
     otherwise broadcast via the existing `tool_progress`-style text frame; do
     not invent a new frame union without checking
     `workspace-session-broker.ts`).
  2. Call `backupSandboxWorkspace({ env: this.env, sandboxId: state.sandboxId,
     projectId: state.projectId })` → `DirectoryBackup`.
  3. Read `baseCommitSha` via a bounded `getProjectSandbox(this.env,
     state.sandboxId).exec("git rev-parse HEAD", { cwd: "/workspace",
     timeout: 10_000 })` and redact the output.
  4. Compute `digest` via `computeWorkspaceDigest(...)` from a bounded
     `git status --short` + `git diff --stat` (reuse the commands already run
     by `buildFinalChangeSummaryEvents`).
  5. Generate `snapshotId = crypto.randomUUID()`. Build the manifest with
     `archiveRef: directoryBackup.id`.
  6. `await this.env.BACKUP_BUCKET.put(snapshotManifestKey(projectId, snapshotId), JSON.stringify(manifest))`
     — capture success/failure (a `put` that resolves is success).
  7. `const pointer = resolveSnapshotPointer({ ok }, manifest)`. If
     `pointer.updateD1`, run a `db.batch([...])` that: inserts the `snapshots`
     row (`r2Key: pointer.pointer.r2Key, digest: pointer.pointer.digest,
     baseCommitSha, runId, status: "completed", completedAt: sql\`(unixepoch())\``),
     updates `projects` (`sandboxBackup: serializeSandboxBackup(directoryBackup)`,
     `sandboxBackupCreatedAt: sql\`(unixepoch())\``, `updatedAt`), and inserts a
     `snapshot_completed` event. Broadcast a `snapshot_completed` frame.
  8. On any throw, insert a `snapshot_failed` event (with a redacted reason),
     do **not** update `projects.sandboxBackup`, and do not throw further — a
     checkpoint failure must not flip a completed run to failed (the PRD's kill
     metric is "More than 2% of successful mutating runs fail to checkpoint";
     the run stays completed, the checkpoint is recorded as failed for
     observability).
- Call `await this.checkpointMutatingRun(state, runId)` inside `finishRun`
  **before** the existing terminal `db.batch` is awaited (so the snapshot is
  taken while the workspace still reflects the run's changes and before
  `activeAgentRunId` is cleared), but guard it so a throw inside checkpoint
  cannot prevent the terminal batch + coordinator notification from running.
  Re-read `state` inside the helper to avoid stale closures.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0.

### Step 5: Tests for the bridge checkpoint

Extend `src/lib/flue-run-bridge.test.ts` with cases (use the existing fake
fetch / fake sandbox / in-memory DO storage pattern already in that file):

- Successful mutating run (`isMutating: true`, terminal `completed`) →
  `BACKUP_BUCKET.put` called with a key matching
  `projects/{projectId}/snapshots/{snapshotId}/manifest.json`; a `snapshots`
  row is inserted with `status: "completed"` and `runId`; `projects.sandboxBackup`
  is updated; a `snapshot_completed` event is inserted.
- R2 `put` rejects → no `snapshots` row, no `projects.sandboxBackup` update, a
  `snapshot_failed` event is inserted, the run still reaches `completed`.
- Read-only run (`isMutating: false`, `completed`) → no `BACKUP_BUCKET.put`,
  no `snapshots` row.
- Mutating run terminal `failed` → no checkpoint (final-run checkpoints are
  for successful mutating work only).
- Canceled mutating run → no checkpoint (canceled runs go through
  `clearCanceledRun`, not `finishRun` success).

**Verify**: `pnpm test -- src/lib/flue-run-bridge.test.ts src/lib/r2-layout.test.ts src/lib/run-snapshot-checkpoint.test.ts` → all pass. Then `pnpm test` → exit 0.

### Step 6: Final verification

Run the full gate:

```sh
pnpm exec tsc --noEmit --pretty false
pnpm lint
pnpm test
pnpm flue:build
git diff --check
```

All must pass with the known warnings only. Update `plans/README.md` status row
to DONE.

## Test plan

- New: `src/lib/run-snapshot-checkpoint.test.ts` — pure digest + manifest-plan
  determinism, `resolveSnapshotPointer` D1-gating.
- Extended: `src/lib/r2-layout.test.ts` — `archiveRef` validation.
- Extended: `src/lib/flue-run-bridge.test.ts` — the 5 cases in Step 5.
- Pattern to model after: `src/lib/flue-run-bridge.test.ts` (fake service
  binding + fake sandbox + `applyFlueStreamCursor` driving the consumer loop)
  and `src/lib/r2-layout.test.ts` (pure helper assertions).

## Done criteria

- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0
- [ ] `pnpm test` exits 0; new tests for run-end checkpoint exist and pass
- [ ] A successful mutating run through `FlueRunBridge` writes an R2 manifest
      object, inserts a `snapshots` D1 row with `status: "completed"` only
      after the R2 write succeeds, updates `projects.sandboxBackup`, and emits
      `snapshot_started` + `snapshot_completed` events (covered by tests)
- [ ] R2 failure does not insert a `snapshots` row, does not update
      `projects.sandboxBackup`, does not flip the run to `failed`, and emits
      `snapshot_failed` (covered by tests)
- [ ] Read-only and failed/canceled runs produce no checkpoint (covered by tests)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `pnpm lint`, `pnpm flue:build`, `git diff --check` pass
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:
- The code at the locations in "Current state" doesn't match the excerpts
  (drift since `1d398af`).
- `sandbox.createBackup` does not return a `DirectoryBackup` whose `id` can be
  round-tripped to `sandbox.restoreBackup` (verify against
  `node_modules/@cloudflare/sandbox` types) — write a decision note and stop.
- `BACKUP_BUCKET` is not bound to the `website` Worker in `alchemy.run.ts`
  (the checkpoint must run in `website`, not `flueWorker`).
- The `WorkspaceSessionBrokerFrame` union does not allow a `snapshot_*` frame
  and adding one would cascade into UI changes — instead broadcast via the
  existing text frame vocabulary and note the tradeoff in the plan.
- A checkpoint failure would change the run's terminal status — it must not.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The checkpoint writes to `projects.sandboxBackup` (the legacy restore handle)
  **and** the `snapshots` table (the PRD manifest index). Plan 042 makes
  `ensureProjectSandbox` consult the `snapshots` table / manifest to validate
  before restoring; until 042 lands, restore still works via the refreshed
  `projects.sandboxBackup`.
- `archiveRef` on the manifest is the bridge from the Ditto-owned manifest to
  the sandbox-SDK-owned restorable archive. Future multi-snapshot restore
  (plan 042+) will read `archiveRef` to call `sandbox.restoreBackup`.
- Reviewer should scrutinize: (1) checkpoint runs before `activeAgentRunId` is
  cleared so the workspace reflects the run; (2) checkpoint failure is
  observability-only and never downgrades a completed run; (3) no secret
  reaches the manifest or events (manifest carries only `excludedPaths` names
  + digest + base commit, never file contents).
- Deferred to 043: periodic mid-run checkpoints. Deferred to 041: surfacing
  `latestSnapshotId` / restoring status in the coordinator and UI.
