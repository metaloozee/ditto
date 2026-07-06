# Plan 045: Render Run Diff Review with `@pierre/diffs`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat f09866f..HEAD -- src/components/ai-chat.tsx src/integrations/trpc/routers/workspace.ts src/lib/workspace-policy.ts src/db/schema.ts src/routes/project.\$projectId.tsx package.json pnpm-lock.yaml plans/README.md
> git diff --stat -- src/components/ai-chat.tsx src/integrations/trpc/routers/workspace.ts src/lib/workspace-policy.ts src/db/schema.ts src/routes/project.\$projectId.tsx package.json pnpm-lock.yaml plans/README.md
> ```
>
> If any in-scope file changed, compare the live code with the current-state
> notes before editing.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: 044
- **Category**: direction / UX
- **PRD phase**: Phase 5, step 1 (improve diff review)
- **Planned at**: commit `f09866f`, 2026-07-04

## Why this matters

The user explicitly asked to use `https://diffs.com/docs` for the UI diff
renderer. The current chat renders `diff_ready` as a text-only activity row:
`src/components/ai-chat.tsx:125` returns `"Diff is ready."` and there is no
way to inspect the patch. Once plan 044 stores real patch artifacts, the UI
needs an authorized read path and a review surface that renders split/unified
patches without copying raw diffs into D1.

## Current state

- `package.json` already depends on `@pierre/diffs` (`^1.2.7`), and the
  installed package is `@pierre/diffs@1.2.11`.
- Public Diffs docs describe `@pierre/diffs` as a JS/React diff rendering
  library with split and stacked layouts, Shiki theming, inline highlighting,
  custom headers, and virtualized rendering.
- Installed types confirm the React API:
  - `node_modules/@pierre/diffs/dist/react/PatchDiff.d.ts` exports
    `PatchDiff({ patch, options, disableWorkerPool, ... })`.
  - `node_modules/@pierre/diffs/dist/types.d.ts` shows options such as
    `diffStyle: "unified" | "split"`, `overflow: "scroll" | "wrap"`,
    `diffIndicators: "classic" | "bars" | "none"`, and `lineDiffType`.
- `src/components/ai-chat.tsx:304` renders each event through
  `ChatEventMessage`. Activity rows use `ActivityEventMessage` and do not
  fetch artifacts.
- `src/integrations/trpc/routers/workspace.ts` exposes `workspace.get`,
  `startRun`, `cancelRun`, `answerRunQuestion`, `retryRestore`, and
  `deleteSession`. There is no artifact fetch procedure.
- `src/db/schema.ts:209` defines `runArtifacts`. Plan 044 should populate it
  for `kind = "diff"`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exit 0 |
| Tests | `pnpm test` | all pass |
| Lint | `pnpm lint` | exit 0, only known warnings |
| Flue build | `pnpm flue:build` | exit 0, known warning only |
| Whitespace | `git diff --check` | exit 0 |

## Scope

**In scope**:
- `src/integrations/trpc/routers/workspace.ts` — add an authorized
  `getRunDiff` query.
- `src/components/diff-review.tsx` (create) — render an artifact with
  `PatchDiff` from `@pierre/diffs/react`.
- `src/components/ai-chat.tsx` — show a compact review affordance for
  `diff_ready` events.
- `src/routes/project.$projectId.tsx` — only if `Chat` needs additional props.
- `plans/README.md` — status row.

**Out of scope**:
- Generating or persisting diff artifacts; plan 044 owns that.
- GitHub commit/branch/PR export; plan 046 owns that.
- Accept/reject individual hunks. Phase 5 review is read-only first.
- Adding another diff package or replacing `@pierre/diffs`.
- Storing raw patch text in React query cache longer than the normal query
  lifetime. Do not persist it into D1.

## Git workflow

- Branch: `advisor/045-render-diff-review-with-pierre-diffs`
- Commit style: `feat(diff): render run diff review`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add an authorized diff fetch procedure

In `workspaceRouter`, add `getRunDiff`:

```ts
input: z.object({
  projectId: z.string().min(1),
  runId: z.string().min(1),
  artifactId: z.number().int().positive().optional()
})
```

Behavior:

1. Load the run by `runId`, `projectId`, and `ctx.user.id`.
2. Load the newest `runArtifacts` row for that run where `kind === "diff"`,
   or the requested `artifactId` if provided.
3. Read `artifact.r2Key` from `ctx.env.BACKUP_BUCKET`.
4. Return `{ runId, artifactId, patch, byteLength, contentType, createdAt }`.
5. Throw `NOT_FOUND` if the run, artifact, or R2 object is missing.

Do not return arbitrary `r2Key` to the client. Authorization must be based on
the run and project owner, not on a client-supplied R2 key.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exit 0.

### Step 2: Create a client diff review component

Create `src/components/diff-review.tsx` with a small component that:

- Uses `useQuery` with `trpc.workspace.getRunDiff.queryOptions(...)`.
- Imports `PatchDiff` from `@pierre/diffs/react`.
- Renders:

```tsx
<PatchDiff
  patch={data.patch}
  disableWorkerPool
  options={{
    diffStyle: "split",
    overflow: "wrap",
    diffIndicators: "bars",
    lineDiffType: "word-alt",
    stickyHeader: true,
  }}
/>
```

If SSR or hydration fails because the component touches browser-only APIs,
guard the renderer with a mounted flag (`useEffect(() => setMounted(true),
[])`) and show the same loading shell until mounted. Do not disable SSR for
the whole route.

Use existing UI primitives (`Button`, `Dialog` or a compact collapsible
section) and lucide icons. Keep the diff area constrained with stable height
and overflow so it cannot push the composer off screen.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exit 0.

### Step 3: Wire `diff_ready` events in chat

In `src/components/ai-chat.tsx`:

- Extend `EventPayload` with optional `artifactId`, `changedFiles`,
  `byteLength`, `hasArtifact`, and `truncated`.
- For `event.type === "diff_ready"` and `payload.hasArtifact === true`, render
  a "Review diff" button in the activity row that opens the diff review
  component.
- If `hasArtifact` is false, keep an honest activity row:
  - changed files = 0: "No diff produced."
  - truncated: "Diff too large to preview."
  - error: "Diff unavailable."

Do not render raw patch text in the chat bubble.

**Verify**: `pnpm lint` -> exit 0 with only known warnings.

### Step 4: Add minimal coverage where this repo supports it

If there is an existing React component test pattern, add a focused test that
renders a `diff_ready` event with `hasArtifact: true` and verifies the "Review
diff" affordance appears. If there is no stable UI test harness for this
component, do not invent one; rely on typecheck/lint and the backend tests from
plan 044.

**Verify**: `pnpm test` -> all tests pass.

### Step 5: Final verification

Run:

```sh
pnpm exec tsc --noEmit --pretty false
pnpm lint
pnpm test
pnpm flue:build
git diff --check
```

All must pass with only known warnings.

## Test plan

- Backend query:
  - unauthorized user cannot fetch another user's diff.
  - missing artifact returns `NOT_FOUND`.
  - existing artifact returns patch text from R2.
- UI:
  - `diff_ready` with an artifact shows "Review diff".
  - `diff_ready` without artifact does not try to render `PatchDiff`.
  - loading/error states are visible and do not block the composer.

## Done criteria

- [ ] `workspace.getRunDiff` authorizes by project/run ownership and never by
      client-supplied R2 key alone.
- [ ] `@pierre/diffs/react` `PatchDiff` renders stored patches.
- [ ] The chat exposes a review affordance for `diff_ready` events.
- [ ] Oversized, missing, or empty diffs have honest non-render states.
- [ ] Verification commands pass.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- Plan 044 has not landed or no `runArtifacts` diff row exists to fetch.
- `PatchDiff` cannot render in the TanStack Start client without hydration
  errors after a mounted guard.
- The implementation would expose raw R2 keys or unauthenticated artifact URLs.
- The diff renderer requires installing a second diff package.
- Verification fails twice after a reasonable fix attempt.

## Maintenance notes

The Diffs package is UI-only here. Keep the artifact format a standard git
patch so future export/review workflows can share it. Reviewers should inspect
responsive layout carefully; split diffs need horizontal and vertical overflow
handling on small screens.
