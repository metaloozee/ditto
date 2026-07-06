# Plan 044: Persist Real Diff Artifacts for Mutating Flue Runs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat f09866f..HEAD -- src/lib/flue-run-bridge.ts src/lib/flue-run-bridge.test.ts src/lib/r2-layout.ts src/lib/r2-layout.test.ts src/lib/workspace-policy.ts src/db/schema.ts plans/README.md
> git diff --stat -- src/lib/flue-run-bridge.ts src/lib/flue-run-bridge.test.ts src/lib/r2-layout.ts src/lib/r2-layout.test.ts src/lib/workspace-policy.ts src/db/schema.ts plans/README.md
> ```
>
> If an in-scope file changed, compare the "Current state" excerpts below
> against the live code. If they no longer match in behavior, stop and report.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: 039 (mutating Flue path), 040 (R2/checkpoint baseline)
- **Category**: direction / durability / review
- **PRD phase**: Phase 3 gap (`Add diff generation`) and Phase 5 prerequisite
- **Planned at**: commit `f09866f`, 2026-07-04

## Why this matters

The PRD requires real sandbox diffs: user stories 33 and 34 say engineers need
"real diffs from the sandbox" and changed files linked to the relevant run.
The Phase 3 checklist explicitly included "Add diff generation," but the live
Flue path only writes a bounded `final_change_summary` containing `git status`
and `git diff --stat`. Phase 5 diff review cannot be reliable until each
completed mutating run has a durable raw patch artifact in R2, indexed by
`run_artifacts`, with a `diff_ready` event that points to that artifact.

## Current state

- `src/db/schema.ts:209` defines `runArtifacts` with `kind: "diff" | "log" |
  "attachment" | "generated"`, `r2Key`, `contentType`, and `byteLength`.
  Nothing writes this table in the current Flue path.
- `src/lib/r2-layout.ts:73` exports `artifactKey(projectId, runId, kind,
  artifactId)`, producing keys like
  `projects/project-1/runs/run-1/artifacts/diff/diff-1`.
- `src/lib/workspace-policy.ts:17` already includes `file_changed`, and
  `src/lib/workspace-policy.ts:18` already includes `diff_ready`.
- `src/lib/flue-run-bridge.ts:590` consumes the assistant draft, then
  `src/lib/flue-run-bridge.ts:591` calls `buildFinalChangeSummaryEvents`.
  The terminal D1 batch at `src/lib/flue-run-bridge.ts:617` updates
  `agentRuns`, clears `projects.activeAgentRunId`, and inserts assistant,
  final-summary, and `done` events. It does not insert `runArtifacts`.
- `src/lib/flue-run-bridge.ts:712` builds the final change summary by running
  `git status --short` and `git diff --stat`. This is useful activity text,
  but it is not a reviewable patch.
- `src/lib/flue-run-bridge.ts:762` writes R2 snapshot manifests and D1
  `snapshots` rows for completed mutating runs. Reuse the same rule: write R2
  first, then insert D1 pointers.
- `src/lib/secret-redaction.ts` is the existing redaction helper. Do not store
  plaintext `.env` values, provider keys, private keys, or GitHub tokens in R2
  or D1.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exit 0 |
| Focused tests | `pnpm test -- src/lib/flue-run-bridge.test.ts src/lib/r2-layout.test.ts` | all pass |
| Full tests | `pnpm test` | 21 files / 199 tests pass or more if new tests are added |
| Lint | `pnpm lint` | exit 0, with only the two existing warnings in `grainient.tsx` and `sidebar.tsx` |
| Flue build | `pnpm flue:build` | exit 0, known generated-Wrangler DO migration warning only |
| Whitespace | `git diff --check` | exit 0 |

## Scope

**In scope**:
- `src/lib/run-diff-artifact.ts` (create) — pure helpers for diff artifact
  keys, payloads, changed-file summaries, and size metadata.
- `src/lib/run-diff-artifact.test.ts` (create) — pure tests.
- `src/lib/flue-run-bridge.ts` — collect a raw git patch for completed
  mutating runs, write it to R2, insert a `run_artifacts` row, and insert a
  `diff_ready` event before the terminal `done` event.
- `src/lib/flue-run-bridge.test.ts` — cover success, no-diff, redaction, and
  R2 failure behavior.
- `src/lib/workspace-policy.ts` — only if the existing `diff_ready` payload
  needs a documented helper; do not add a new event type unless unavoidable.
- `plans/README.md` — status row.

**Out of scope**:
- Rendering diffs in the UI; plan 045 owns that.
- GitHub branch, commit, push, or PR export; plan 046 owns that.
- Snapshot manifest or restore behavior; plans 040-043 own that.
- Replacing the legacy `WorkspaceSessionBroker` diff events.
- Storing full diffs in D1. D1 may store only metadata and R2 pointers.

## Git workflow

- Branch: `advisor/044-persist-run-diff-artifacts`
- Commit style: Conventional Commits, e.g.
  `feat(diff): persist mutating run diff artifacts`.
- Do not push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a pure diff artifact helper

Create `src/lib/run-diff-artifact.ts` with:

- `RUN_DIFF_ARTIFACT_CONTENT_TYPE = "text/x-diff; charset=utf-8"`.
- `MAX_RUN_DIFF_ARTIFACT_BYTES` set to a conservative value such as
  `2 * 1024 * 1024`.
- `buildRunDiffArtifactPlan({ projectId, runId, artifactId, patch })` returning
  `{ artifactId, r2Key, contentType, byteLength }`, where `r2Key` is produced
  by `artifactKey(projectId, runId, "diff", artifactId)`.
- `parseChangedFilesFromGitStatus(statusShort: string)` that returns relative
  paths from `git status --short`, handling rename lines (`R  old -> new`) by
  returning the new path.
- `buildDiffReadyPayload(...)` returning JSON-safe metadata:
  `artifactId`, `changedFiles`, `byteLength`, `contentType`, `truncated`,
  `hasArtifact`.

Keep the helper pure. Do not import Cloudflare bindings or Drizzle in it.

**Verify**: `pnpm test -- src/lib/run-diff-artifact.test.ts` -> all new tests
pass.

### Step 2: Collect a safe patch in `FlueRunBridge`

In `src/lib/flue-run-bridge.ts`, add a private method such as
`buildRunDiffArtifactEvents(state, runId)` that returns:

- D1 `runArtifacts` insert values when a non-empty patch was persisted.
- A `diff_ready` projected event payload.
- No throw to the caller; failures should become a redacted `diff_ready`
  payload with `{ hasArtifact: false, error: "..." }` or a redacted `error`
  event, but they must not fail an otherwise completed run.

Run these sandbox commands in `/workspace`:

```sh
git status --short
git diff --no-ext-diff --find-renames --binary -- . ':(exclude).env' ':(exclude).env.*' ':(exclude)**/.env' ':(exclude)**/.env.*' ':(exclude).npmrc' ':(exclude)**/.npmrc'
```

Then pass the patch through `redactSecrets` before writing to R2. If the
redacted patch is empty, insert a `diff_ready` event with
`hasArtifact: false` and `changedFiles` from status, but do not write R2 or
insert `run_artifacts`.

If the redacted patch exceeds `MAX_RUN_DIFF_ARTIFACT_BYTES`, do not store a
partial patch. Insert `diff_ready` with `truncated: true`,
`hasArtifact: false`, `byteLength`, and `changedFiles`. Full oversized diff
handling can be planned later.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exit 0.

### Step 3: Write R2 before D1

Use `this.env.BACKUP_BUCKET.put(plan.r2Key, redactedPatch)` before inserting
any `run_artifacts` row. After the R2 write succeeds, include a
`db.insert(runArtifacts).values(...)` operation in the same terminal batch that
already inserts terminal events.

The `diff_ready` event should be inserted before the terminal `done` event so
the chat/event timeline can show review availability before terminal status.

Do not expose `r2Key` directly to the browser in `diff_ready` unless the
fetching API in plan 045 also authorizes it. Prefer `artifactId`, `runId`,
`changedFiles`, `byteLength`, and `contentType`.

**Verify**: `pnpm test -- src/lib/flue-run-bridge.test.ts` -> focused tests
pass.

### Step 4: Preserve terminal reliability

A diff artifact failure must not prevent:

- `agentRuns.status` from becoming terminal.
- `projects.activeAgentRunId` from clearing.
- coordinator terminal notification.
- final snapshot checkpoint behavior from plans 040-043.

Match the snapshot checkpoint pattern at `src/lib/flue-run-bridge.ts:603`,
where checkpoint failure is caught before the terminal D1 batch.

**Verify**: Add a test where `BACKUP_BUCKET.put` rejects for the diff artifact
and the run still reaches `done`.

### Step 5: Final verification

Run:

```sh
pnpm exec tsc --noEmit --pretty false
pnpm test -- src/lib/run-diff-artifact.test.ts src/lib/flue-run-bridge.test.ts src/lib/r2-layout.test.ts
pnpm test
pnpm lint
pnpm flue:build
git diff --check
```

All must pass with only the known lint warnings and known Flue build warning.

## Test plan

- `src/lib/run-diff-artifact.test.ts`:
  - artifact key uses the project/run diff prefix.
  - changed-file parsing handles modified, added, deleted, and rename status.
  - payload omits raw patch text and includes `hasArtifact`, `changedFiles`,
    `byteLength`, and `contentType`.
- `src/lib/flue-run-bridge.test.ts`:
  - successful completed mutating run writes R2 diff artifact, inserts
    `run_artifacts`, and inserts `diff_ready`.
  - no workspace diff inserts `diff_ready` without an artifact.
  - secret-looking patch content is redacted before R2 write.
  - R2 write failure is non-fatal and does not prevent terminal `done`.
  - read-only and failed mutating runs do not write diff artifacts.

## Done criteria

- [ ] Completed mutating Flue runs produce a `diff_ready` event.
- [ ] Non-empty diffs are stored in R2 and indexed by one `run_artifacts`
      row with `kind = "diff"`.
- [ ] D1 stores only metadata and R2 pointers; raw patch text is not stored in
      `agent_run_events`.
- [ ] Secret redaction happens before the R2 write.
- [ ] Diff artifact failure is non-fatal for run completion.
- [ ] Verification commands in this plan pass.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- `BACKUP_BUCKET.put` cannot accept text bodies in this runtime.
- The git pathspec excludes fail in the sandbox and `.env`-style files would
  appear in the patch.
- Implementing the artifact requires changing D1 schema or migrations.
- The diff write would make terminal completion depend on R2 success.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

Reviewers should verify that the artifact key is project/run scoped, raw patch
text never lands in D1, and the terminal path remains reliable. Plan 045 will
add the authorized read API and Diffs UI; do not add UI shortcuts in this plan.
