# Plan 029: Deepen Session Git export orchestration (open-PR / push-then-PR)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer tells you they maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 30c06f2..HEAD -- \
>   apps/web/src/lib/agent-git-handler.ts \
>   apps/web/src/lib/agent-git-handler.test.ts \
>   apps/web/src/lib/session-git-ui-actions.ts \
>   apps/web/src/lib/session-git-ui-actions.test.ts \
>   apps/web/src/lib/session-git.ts \
>   apps/web/src/integrations/trpc/routers/session-git.ts \
>   apps/web/src/integrations/trpc/routers/session-git.test.ts \
>   apps/web/src/lib/session-git-export.ts \
>   apps/web/src/lib/session-git-export.test.ts \
>   plans/README.md
> ```
>
> Then run `git status --short` and `git diff --stat` so uncommitted drift is
> not hidden by `30c06f2..HEAD`. Ignore only this plan/index change when it is
> the dispatch input. If any implementation path changed, compare the "Current
> state" excerpts with live code before proceeding. A behavioral mismatch is a
> STOP condition.

## Status

- **Status**: DONE (merged to master `20ef927`)
- **Commits**: `5319a8b` (Phase 1), `4692f96` (Phase 2), `8f8249d` (ponytail slim)
- **Priority**: P1
- **Effort**: M (two phased commits; Phase 1 is S, Phase 2 is M)
- **Risk**: MED — three open-PR call paths (UI generated, router explicit, agent)
  must keep divergent auth/lock/backup/metadata behavior while sharing core steps
- **Depends on**: Plan 028 (DONE) — readiness already at callers; do not re-do
- **Category**: bug / tech-debt
- **Planned at**: commit `30c06f2`, 2026-07-23
- **Landing shape**: TWO logical commits on one branch. Prefer:
  1. Phase 1 bugfix only
  2. Phase 2 shared core + three thin adapters + tests  
  Do not mix Phase 2 extraction into the Phase 1 commit.

## Why this matters

Open-PR / push-then-open-PR is implemented three times with near-duplicate
workflow gates and slightly different messages. After plan 028, the UI and
router correctly distinguish `unavailable.reason === "worktree"` from GitHub
unavailability, but the agent open-PR path still always reports GitHub
unavailable. Extracting one pure blocker and one push-then-open core removes
message drift and keeps future export changes in one place — without unifying
locks, auth, PI metadata, or backup policy across callers.

## Locked design decisions

Do **not** invent alternatives. These are product-locked.

### Goal

Deepen Session Git **export orchestration** for open-PR / push-then-PR only.

### MUST NOT unify

| Concern | Keep separate |
|---------|----------------|
| Workspace lock | UI generated keeps outer `withSessionWorkspaceLock`; router explicit stays **without** outer lock; agent keeps `bypassWorkspaceLock: true` from outer run lock |
| Auth | JWT agent callback vs tRPC protected procedures |
| PI metadata | Only UI generated path calls `generatePullRequestMetadata` |
| Context loaders | Do **not** merge `resolveSessionGitContext` / auth ready helpers with `resolveAgentGitContext` |
| Backup | UI generated + router explicit backup if `didPush`; agent **never** mid-run backup |
| Standalone push/commit/sync | Do not rewrite those procedures beyond reusing shared blocker strings if natural |

### Out of scope (hard)

- Forcing UI explicit open-PR under the same outer lock as generated (deferred P2 harden — see Maintenance)
- C2 readiness work (plan 028 DONE) — callers already ready; core does not call readiness
- Rewriting `session-git.ts` primitives (`pushSessionBranch`, `openSessionPullRequest`, status)
- Mega context loader
- Agent PI metadata generation
- Changing commit / standalone push / sync procedure structure

### Exact user-facing strings (copy verbatim)

| Key | String (include trailing period where shown) |
|-----|-----------------------------------------------|
| Worktree unavailable | `Session worktree is not ready.` |
| GitHub unavailable | `GitHub status is currently unavailable.` |
| Dirty before open PR | `Commit local changes before opening a pull request.` |
| Merged | `This session pull request has already been merged.` |
| Closed | `This session pull request is closed.` |
| Sync | `` Sync the latest ${baseBranch} before opening a pull request. `` |
| No changes | `This session has no changes to open as a pull request.` |

---

## Current state

All excerpts verified at `30c06f2`.

### Bug — agent ignores worktree unavailable reason

`apps/web/src/lib/agent-git-handler.ts` open-PR gate (after optional push +
restatus) always uses the GitHub string for any `unavailable` workflow:

```ts
// agent-git-handler.ts:219-233
if (
  status.workflow.kind !== "open-pr" &&
  status.workflow.kind !== "open-pr-existing"
) {
  const message =
    status.workflow.kind === "merged-pr"
      ? "This session pull request has already been merged."
      : status.workflow.kind === "closed-pr"
        ? "This session pull request is closed."
        : status.workflow.kind === "unavailable"
          ? "GitHub status is currently unavailable." // BUG: ignores reason === "worktree"
          : status.workflow.kind === "sync"
            ? `Sync the latest ${status.workflow.baseBranch} before opening a pull request.`
            : "This session has no changes to open as a pull request.";
  throw new AgentGitHttpError(409, message);
}
```

UI already splits correctly:

```ts
// session-git-ui-actions.ts:66-84
function preconditionMessage(workflow: ...): string {
  // ...
  if (workflow.kind === "unavailable") {
    return workflow.reason === "worktree"
      ? "Session worktree is not ready."
      : "GitHub status is currently unavailable.";
  }
  // ...
}
```

Router explicit path already splits via `WORKTREE_UNAVAILABLE_MESSAGE`:

```ts
// session-git.ts router:49
const WORKTREE_UNAVAILABLE_MESSAGE = "Session worktree is not ready.";

// session-git.ts router:532-535 (inside explicit openPR)
status.workflow.kind === "unavailable"
  ? status.workflow.reason === "worktree"
    ? WORKTREE_UNAVAILABLE_MESSAGE
    : "GitHub status is currently unavailable."
```

### Three open-PR orchestrations today

#### 1) UI generated — lock + PI + backup

`apps/web/src/lib/session-git-ui-actions.ts:134-235`
`openSessionPullRequestWithGeneratedMetadata`:

1. Outer `withSessionWorkspaceLock`
2. `getSessionGitStatus`
3. Dirty → `SessionGitMetadataError("snapshot_failed", dirty message)`
4. `open-pr-existing` → **shortCircuit** return `{ url, number }` (no model, no open call)
5. If not `open-pr` and not `push` → `SessionGitMetadataError` + `preconditionMessage`
6. `generatePullRequestMetadata`
7. If `push` → `pushSessionBranch({ bypassWorkspaceLock: true })`, `didPush=true`, restatus; maybe shortCircuit existing (with generated title); else require `open-pr`
8. `openSessionPullRequest` with generated title/body
9. After lock: if `didPush` → `bestEffortPersistSessionGitBackup` even when open failed

#### 2) Router explicit — no outer lock, backup after push, call open for existing

`apps/web/src/integrations/trpc/routers/session-git.ts:442-559`
when `hasExplicitMetadata` (any of title/body/baseBranch set):

1. Readiness already done by `resolveSessionGitReadyForMutation` (028)
2. Status → dirty check → `pushIfAhead` only if `workflow.kind === "push"`
3. If `didPush` → backup **before** open (current order)
4. If not `open-pr` and not `open-pr-existing` → TRPC `PRECONDITION_FAILED` + inline messages
5. Always `openSessionPullRequest` for both `open-pr` and `open-pr-existing` (policy **open**, not shortCircuit)
6. No PI generate; no outer session lock on this branch

#### 3) Agent — bypass lock, HTTP map, no backup

`apps/web/src/lib/agent-git-handler.ts:156-251` `dispatchAgentGitAction` for
`openPullRequest`:

1. Context already used readiness with `lock: "assumeHeld"` (028)
2. Dirty → 409 dirty message
3. If `push` → `pushSessionBranch(gitCtx)` with `bypassWorkspaceLock: true`, restatus
4. If not `open-pr` / `open-pr-existing` → 409 + messages (worktree bug above)
5. `openSessionPullRequest` with body title/body/baseBranch
6. **No** backup

### Workflow type (for blocker)

```ts
// session-git.ts:311-323
export type SessionGitWorkflow =
  | { kind: "commit" }
  | { kind: "push"; reason: "unpushed-commits" | "remote-branch-missing" }
  | { kind: "sync"; baseBranch: string }
  | { kind: "open-pr" }
  | { kind: "open-pr-existing"; pullRequest: SessionGitPullRequestRef }
  | { kind: "closed-pr"; pullRequest: SessionGitPullRequestRef }
  | { kind: "merged-pr"; pullRequest: SessionGitPullRequestRef }
  | { kind: "idle"; reason: "no-changes" }
  | { kind: "unavailable"; reason: "github" | "worktree" };
```

### Test exemplars

- `apps/web/src/lib/session-git-ui-actions.test.ts` — DI deps bag, order assertions
  (`lock:enter` → … → `backup`), hoisted `vi.mock`
- `apps/web/src/lib/agent-git-handler.test.ts` — mock status/push/open; assert
  HTTP status + message

### Conventions

- Imports via `#/lib/...`
- Vitest + `vi.hoisted` / `vi.mock` as in ui-actions tests
- No comments unless essential
- Biome format (`pnpm check`)
- Commit style from recent history: `fix(session): ...` / `feat(session): ...`

---

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Drift | see executor block above | understand delta; STOP on behavioral mismatch |
| Typecheck | `pnpm typecheck` | exit 0 (if pre-existing unrelated errors appear on HEAD, report; do not "fix" out-of-scope files) |
| Focused export core | `pnpm --filter @ditto/web exec vitest run src/lib/session-git-export.test.ts` | all pass |
| Focused ui-actions | `pnpm --filter @ditto/web exec vitest run src/lib/session-git-ui-actions.test.ts` | all pass |
| Focused agent-git | `pnpm --filter @ditto/web exec vitest run src/lib/agent-git-handler.test.ts` | all pass |
| Focused router | `pnpm --filter @ditto/web exec vitest run src/integrations/trpc/routers/session-git.test.ts` | all pass |
| Broader lib slice | `pnpm --filter @ditto/web exec vitest run src/lib/session-git-export.test.ts src/lib/session-git-ui-actions.test.ts src/lib/agent-git-handler.test.ts src/integrations/trpc/routers/session-git.test.ts` | all pass |
| Lint/format | `pnpm check` | exit 0 |

`apps/web` script is `vitest run`; pass file filters after `vitest run`. From
repo root, `pnpm --filter @ditto/web exec vitest run <files>` is the reliable
form.

---

## Scope

**In scope** (only these may be modified / created):

- `apps/web/src/lib/agent-git-handler.ts`
- `apps/web/src/lib/agent-git-handler.test.ts`
- `apps/web/src/lib/session-git-export.ts` (**create**)
- `apps/web/src/lib/session-git-export.test.ts` (**create**)
- `apps/web/src/lib/session-git-ui-actions.ts`
- `apps/web/src/lib/session-git-ui-actions.test.ts`
- `apps/web/src/integrations/trpc/routers/session-git.ts`
- `apps/web/src/integrations/trpc/routers/session-git.test.ts` (only if needed for explicit openPR wiring)
- `plans/README.md` (status only, when done)

**Out of scope** (do NOT touch):

- `apps/web/src/lib/session-git.ts` primitives / status / workflow resolver
  (import types only from it)
- `apps/web/src/lib/session-git-metadata.ts` (PI generate stays in ui-actions)
- `apps/web/src/lib/session-worktree.ts` / readiness
- `apps/web/src/lib/session-git-backup.ts` (call from adapters only)
- `apps/web/src/lib/agent-run.ts` / agent-run-service
- Commit UI action, standalone push/sync procedures (beyond deleting duplicated
  open-PR message tables if they become dead after wiring)
- UI components
- Schema, JWT, docs (unless a one-line architecture note is strictly required —
  prefer **no** docs in this plan)

---

## Git workflow

- Branch: `advisor/029-session-git-export-orchestration`
- Prefer isolated worktree from `30c06f2` or current master if still at/after
  that SHA and excerpts still match
- Commits (recommended):
  1. `fix(session): report worktree unavailable on agent open PR`
  2. `feat(session): share push-then-open pull request orchestration`
- Do NOT push, open PR, merge, or deploy unless the operator asks

---

## Phase 1 — agent worktree unavailable message (S)

Goal: fix message drift only. No new module yet.

### Step 1.1: Drift check

Run the drift commands in the executor block. Confirm
`agent-git-handler.ts:219-233` still always uses the GitHub string for
`unavailable`, and ui-actions / router still split worktree correctly.

**Verify**: drift understood; no STOP mismatch → proceed.

### Step 1.2: Fix agent unavailable branch

In `apps/web/src/lib/agent-git-handler.ts`, change the `unavailable` arm to
match ui-actions / router:

```ts
: status.workflow.kind === "unavailable"
  ? status.workflow.reason === "worktree"
    ? "Session worktree is not ready."
    : "GitHub status is currently unavailable."
```

Do **not** extract shared helpers in this commit unless the file already imports
them (it will not until Phase 2). Keep the rest of `dispatchAgentGitAction`
unchanged.

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/lib/agent-git-handler.test.ts
```

→ existing tests pass; new test from 1.3 must be added before declaring done.

### Step 1.3: Agent test for worktree message

In `apps/web/src/lib/agent-git-handler.test.ts`, add a case under the
`dispatchAgentGitAction` describe (model after the secret-policy / push-first
tests):

| Case | Setup | Expect |
|------|-------|--------|
| openPR when workflow unavailable/worktree | `getSessionGitStatus` → `{ dirty: false, workflow: { kind: "unavailable", reason: "worktree" } }` | rejects `AgentGitHttpError` with `status: 409` and **exact** message `Session worktree is not ready.` |
| openPR when workflow unavailable/github (optional but preferred) | `reason: "github"` | message `GitHub status is currently unavailable.` |

Assert `pushSessionBranch` / `openSessionPullRequest` were **not** called.

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/lib/agent-git-handler.test.ts
```

→ all pass, including new worktree case.

### Step 1.4: Phase 1 commit

```text
fix(session): report worktree unavailable on agent open PR
```

**Verify**: `git log -1 --oneline` shows the commit; Phase 2 files not created
yet; working tree clean for Phase 1 paths.

---

## Phase 2 — shared blocker + `runPushThenOpenPullRequest` + thin adapters (M)

Goal: one pure blocker + one core orchestrator; three callers become thin.

### Step 2.1: Create `session-git-export.ts` with locked API

**Create** `apps/web/src/lib/session-git-export.ts`.

#### 2.1.1 Constants + pure blocker

```ts
import type {
  SessionGitSession,
  SessionGitWorkflow,
} from "#/lib/session-git";
import {
  getSessionGitStatus,
  openSessionPullRequest,
  pushSessionBranch,
} from "#/lib/session-git";
// Env is a global Cloudflare type (no import).

export const SESSION_WORKTREE_UNAVAILABLE_MESSAGE =
  "Session worktree is not ready.";

export const SESSION_GIT_OPEN_PR_DIRTY_MESSAGE =
  "Commit local changes before opening a pull request.";

/**
 * Returns a user-facing blocker message when the workflow cannot proceed to
 * push-then-open / open-PR. Returns null when the workflow is allowed:
 * open-pr | push | open-pr-existing.
 *
 * Messages MUST match session-git-ui-actions preconditionMessage (028 worktree split).
 */
export function sessionGitOpenPullRequestBlocker(
  workflow: SessionGitWorkflow,
): string | null {
  if (
    workflow.kind === "open-pr" ||
    workflow.kind === "push" ||
    workflow.kind === "open-pr-existing"
  ) {
    return null;
  }
  if (workflow.kind === "merged-pr") {
    return "This session pull request has already been merged.";
  }
  if (workflow.kind === "closed-pr") {
    return "This session pull request is closed.";
  }
  if (workflow.kind === "unavailable") {
    return workflow.reason === "worktree"
      ? SESSION_WORKTREE_UNAVAILABLE_MESSAGE
      : "GitHub status is currently unavailable.";
  }
  if (workflow.kind === "sync") {
    return `Sync the latest ${workflow.baseBranch} before opening a pull request.`;
  }
  // commit | idle | any future kind → same default as ui-actions
  return "This session has no changes to open as a pull request.";
}
```

#### 2.1.2 Neutral precondition error

```ts
export class SessionGitExportPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionGitExportPreconditionError";
  }
}
```

Adapters map this to `SessionGitMetadataError` / `TRPCError` / `AgentGitHttpError`.
Do **not** put TRPC or HTTP types in this file.

#### 2.1.3 Core `runPushThenOpenPullRequest`

Core steps **only** (no locks, no PI, no backup, no readiness, no TRPC/HTTP):

```ts
export type SessionGitExportGitContext = {
  env: Env;
  sandboxId: string;
  installationId: number;
  githubRepo: string;
  session: SessionGitSession;
  knownSecrets?: readonly string[];
  /** Caller supplies; agent/UI-under-lock pass true. Router explicit omits/false. */
  bypassWorkspaceLock?: boolean;
};

export type SessionGitExportDeps = {
  getSessionGitStatus: typeof getSessionGitStatus; // from #/lib/session-git
  pushSessionBranch: typeof pushSessionBranch;
  openSessionPullRequest: typeof openSessionPullRequest;
};

export type ExistingPullRequestPolicy = "shortCircuit" | "open";

export type RunPushThenOpenPullRequestOptions = {
  ctx: SessionGitExportGitContext;
  deps: SessionGitExportDeps;
  title?: string;
  body?: string;
  baseBranch?: string;
  existingPullRequestPolicy: ExistingPullRequestPolicy;
  /**
   * Invoked once immediately after a successful pushSessionBranch, before restatus.
   * Adapters use this to set didPush for backup-after-failure paths.
   */
  onDidPush?: () => void;
};

export type RunPushThenOpenPullRequestResult = {
  didPush: boolean;
  result: { url: string; number: number };
};

Implement **exactly** this control flow (no alternate sketches):

```ts
export async function runPushThenOpenPullRequest(
  options: RunPushThenOpenPullRequestOptions,
): Promise<RunPushThenOpenPullRequestResult> {
  const statusCtx = {
    env: options.ctx.env,
    sandboxId: options.ctx.sandboxId,
    installationId: options.ctx.installationId,
    githubRepo: options.ctx.githubRepo,
    session: options.ctx.session,
  };
  const mutateCtx = {
    ...statusCtx,
    knownSecrets: options.ctx.knownSecrets,
    bypassWorkspaceLock: options.ctx.bypassWorkspaceLock,
  };

  let didPush = false;
  let status = await options.deps.getSessionGitStatus(statusCtx);

  if (status.dirty) {
    throw new SessionGitExportPreconditionError(SESSION_GIT_OPEN_PR_DIRTY_MESSAGE);
  }

  if (
    status.workflow.kind === "open-pr-existing" &&
    options.existingPullRequestPolicy === "shortCircuit"
  ) {
    return {
      didPush: false,
      result: {
        url: status.workflow.pullRequest.url,
        number: status.workflow.pullRequest.number,
      },
    };
  }

  if (status.workflow.kind === "push") {
    await options.deps.pushSessionBranch(mutateCtx);
    didPush = true;
    options.onDidPush?.();
    status = await options.deps.getSessionGitStatus(statusCtx);

    if (
      status.workflow.kind === "open-pr-existing" &&
      options.existingPullRequestPolicy === "shortCircuit"
    ) {
      return {
        didPush,
        result: {
          url: status.workflow.pullRequest.url,
          number: status.workflow.pullRequest.number,
        },
      };
    }
  }

  const canOpen =
    status.workflow.kind === "open-pr" ||
    (status.workflow.kind === "open-pr-existing" &&
      options.existingPullRequestPolicy === "open");

  if (!canOpen) {
    const message =
      sessionGitOpenPullRequestBlocker(status.workflow) ??
      "This session has no changes to open as a pull request.";
    throw new SessionGitExportPreconditionError(message);
  }

  const opened = await options.deps.openSessionPullRequest({
    ...statusCtx,
    title: options.title,
    body: options.body,
    baseBranch: options.baseBranch,
  });

  return {
    didPush,
    result: { url: opened.url, number: opened.number },
  };
}
```

Rules:
- Do **not** call `generatePullRequestMetadata`, acquire locks, readiness, or backup here.
- Push/open errors propagate unchanged (adapters map secrets / permissions / HTTP).
- If initial workflow is `sync` / `merged-pr` / etc., `canOpen` is false → throw blocker **before** open (and without push unless kind was `push`).

**Verify** (types only until tests land):

```bash
pnpm typecheck
```

→ no errors in the new file (or report pre-existing unrelated failures).

### Step 2.2: Unit tests for blocker + core

**Create** `apps/web/src/lib/session-git-export.test.ts`.

Model after `session-git-ui-actions.test.ts`: plain vitest, mock deps as
functions (no need to mock modules if you inject `deps`).

#### Blocker table

| workflow | expected |
|----------|----------|
| `{ kind: "open-pr" }` | `null` |
| `{ kind: "push", reason: "unpushed-commits" }` | `null` |
| `{ kind: "open-pr-existing", pullRequest: {...} }` | `null` |
| `{ kind: "unavailable", reason: "worktree" }` | `Session worktree is not ready.` |
| `{ kind: "unavailable", reason: "github" }` | `GitHub status is currently unavailable.` |
| `{ kind: "merged-pr", ... }` | merged string |
| `{ kind: "closed-pr", ... }` | closed string |
| `{ kind: "sync", baseBranch: "main" }` | `Sync the latest main before opening a pull request.` |
| `{ kind: "idle", reason: "no-changes" }` | no-changes string |
| `{ kind: "commit" }` | no-changes string |

#### Core cases (inject mock deps)

| Case | Expect |
|------|--------|
| dirty | throws `SessionGitExportPreconditionError` with dirty message; no push/open |
| shortCircuit existing before push | returns url/number; `didPush: false`; no open call |
| policy open + existing | calls `openSessionPullRequest`; no push |
| open-pr only | open once with title/body/base; no push; `didPush: false` |
| push then open-pr | push once → restatus → open; `didPush: true`; `onDidPush` called once |
| push then shortCircuit existing | push; return existing; open **not** called; `didPush: true` |
| push then blocker (e.g. sync after push) | push; throws precondition with sync message; open not called |
| initial sync | throws sync message; no push |
| initial unavailable/worktree | exact worktree string |
| push failure | propagates raw error; `onDidPush` not called |

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/lib/session-git-export.test.ts
```

→ all pass.

### Step 2.3: Wire UI generated adapter (single locked pattern)

File: `apps/web/src/lib/session-git-ui-actions.ts`

Keep outer lock, PI generate, and post-lock backup. Replace the body of
`openSessionPullRequestWithGeneratedMetadata` with **only** this pattern:

```ts
export async function openSessionPullRequestWithGeneratedMetadata(
  ctx: SessionGitUiActionContext,
  deps: SessionGitUiActionDeps = defaultDeps,
): Promise<{ url: string; number: number; title?: string }> {
  let didPush = false;
  let result: { url: string; number: number; title?: string } | undefined;
  let actionError: unknown;

  try {
    await deps.withSessionWorkspaceLock({
      env: ctx.env,
      sandboxId: ctx.sandboxId,
      sessionId: ctx.session.id,
      run: async () => {
        const preview = await deps.getSessionGitStatus(gitCtx(ctx));
        if (preview.dirty) {
          throw new SessionGitMetadataError(
            "snapshot_failed",
            SESSION_GIT_OPEN_PR_DIRTY_MESSAGE,
          );
        }
        if (preview.workflow.kind === "open-pr-existing") {
          result = {
            url: preview.workflow.pullRequest.url,
            number: preview.workflow.pullRequest.number,
          };
          return;
        }
        const blocker = sessionGitOpenPullRequestBlocker(preview.workflow);
        if (blocker) {
          throw new SessionGitMetadataError("snapshot_failed", blocker);
        }

        const generated = await deps.generatePullRequestMetadata(gitCtx(ctx));

        try {
          const outcome = await runPushThenOpenPullRequest({
            ctx: { ...gitCtx(ctx), bypassWorkspaceLock: true },
            deps: {
              getSessionGitStatus: deps.getSessionGitStatus,
              pushSessionBranch: deps.pushSessionBranch,
              openSessionPullRequest: deps.openSessionPullRequest,
            },
            title: generated.title,
            body: generated.body,
            existingPullRequestPolicy: "shortCircuit",
            onDidPush: () => {
              didPush = true;
            },
          });
          didPush = didPush || outcome.didPush;
          result = {
            url: outcome.result.url,
            number: outcome.result.number,
            title: generated.title,
          };
        } catch (error) {
          if (error instanceof SessionGitExportPreconditionError) {
            throw new SessionGitMetadataError("snapshot_failed", error.message);
          }
          throw error;
        }
      },
    });
  } catch (error) {
    actionError = error;
  }

  if (didPush) {
    await deps.bestEffortPersistSessionGitBackup({
      db: ctx.db,
      env: ctx.env,
      project: ctx.project,
    });
  }
  if (actionError) throw actionError;
  if (!result) {
    throw new SessionGitMetadataError(
      "agent_failed",
      "Pull request action completed without a result.",
    );
  }
  return result;
}
```

Notes:
- Core re-fetches status (extra status calls) — update order tests accordingly.
- No generate on existing/dirty/blocked (peek first).
- Remove local `preconditionMessage`.
- Backup still after lock release when `didPush`, including open failure.

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/lib/session-git-ui-actions.test.ts
```

### Step 2.4: Wire router explicit openPR (single locked pattern)

File: `apps/web/src/integrations/trpc/routers/session-git.ts`

When `hasExplicitMetadata`, replace the inline pushIfAhead/message/open block
with **exactly**:

```ts
let didPush = false;
try {
  const outcome = await runPushThenOpenPullRequest({
    ctx: {
      env: ctx.env,
      sandboxId: resolved.sandboxId,
      installationId: resolved.installationId,
      githubRepo: resolved.githubRepo,
      session: resolved.session,
      knownSecrets: resolved.knownSecrets,
      // omit bypassWorkspaceLock (false/undefined)
    },
    deps: {
      getSessionGitStatus,
      pushSessionBranch,
      openSessionPullRequest,
    },
    title: input.title,
    body: input.body,
    baseBranch: input.baseBranch,
    existingPullRequestPolicy: "open",
    onDidPush: () => {
      didPush = true;
    },
  });
  didPush = didPush || outcome.didPush;
  return outcome.result;
} catch (error) {
  if (error instanceof SessionGitExportPreconditionError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
    });
  }
  if (error instanceof GitSecretPolicyError) {
    mapSessionGitExportError(error);
  }
  // Push-permission failures throw Error(GITHUB_APP_PUSH_PERMISSION_MESSAGE)
  // from pushSessionBranch; PR-permission from openSessionPullRequest.
  // Map BOTH so push-perm does not become BAD_GATEWAY.
  const message = error instanceof Error ? error.message : "";
  if (message === GITHUB_APP_PUSH_PERMISSION_MESSAGE) {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
  rethrowOrMapSessionGitMutationError(error, {
    fallbackMessage: "Failed to open pull request.",
    forbiddenWhenMessage: GITHUB_APP_PR_PERMISSION_MESSAGE,
  });
} finally {
  // Intentional timing change vs live "backup immediately after push, before open":
  // backup once after the whole op when a push succeeded, including open failure.
  // Do NOT also backup in try/catch bodies (would double-backup).
  if (didPush) {
    await bestEffortPersistSessionGitBackup({
      db: resolved.db,
      env: ctx.env,
      project: resolved.project,
    });
  }
}
```

**Do NOT** wrap explicit path in `withSessionWorkspaceLock`.  
**Do NOT** change the generated branch (`openSessionPullRequestWithGeneratedMetadata`).

Optional: import `SESSION_WORKTREE_UNAVAILABLE_MESSAGE` for gitStatus soft summary.

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/integrations/trpc/routers/session-git.test.ts
```

### Step 2.5: Wire agent openPR (early return — no double push)

File: `apps/web/src/lib/agent-git-handler.ts`

Restructure `dispatchAgentGitAction` control flow as:

```ts
export async function dispatchAgentGitAction(options: { ... }): Promise<unknown> {
  const gitCtx = { ..., bypassWorkspaceLock: true, knownSecrets: ... };
  const statusCtx = { ... }; // without knownSecrets/bypass

  if (options.body.action === "status") {
    return await getSessionGitStatus(statusCtx);
  }

  // ---- openPullRequest: exclusive early return (core owns dirty/push/open) ----
  if (options.body.action === "openPullRequest") {
    try {
      const outcome = await runPushThenOpenPullRequest({
        ctx: {
          env: options.env,
          sandboxId: options.resolved.sandboxId,
          installationId: options.resolved.installationId,
          githubRepo: options.resolved.githubRepo,
          session: options.resolved.session,
          knownSecrets: options.resolved.knownSecrets,
          bypassWorkspaceLock: true,
        },
        deps: {
          getSessionGitStatus,
          pushSessionBranch,
          openSessionPullRequest,
        },
        title: options.body.title,
        body: options.body.body,
        baseBranch: options.body.baseBranch,
        existingPullRequestPolicy: "open",
      });
      return outcome.result;
    } catch (error) {
      if (error instanceof SessionGitExportPreconditionError) {
        throw new AgentGitHttpError(409, error.message);
      }
  if (error instanceof GitSecretPolicyError) {
    throw new AgentGitHttpError(409, error.message);
  }
  // Non-secret push/open failures: prefer mapPushError-equivalent for push
  // (rethrow Error so route may 500) OR 502 for open — match live agent openPR
  // catch (502 generic). Do not invent a new status code matrix.
  if (error instanceof AgentGitHttpError) throw error;
  throw new AgentGitHttpError(
    502,
    error instanceof Error ? error.message : "Failed to open pull request.",
  );
}
  }

  // ---- standalone push only (unchanged behavior) ----
  // action === "push"
  let status = await getSessionGitStatus(statusCtx);
  if (status.dirty) {
    throw new AgentGitHttpError(409, "Commit local changes before pushing.");
  }
  if (status.workflow.kind !== "push") {
    throw new AgentGitHttpError(
      409,
      status.workflow.kind === "sync"
        ? `Sync the latest ${status.workflow.baseBranch} before pushing.`
        : "Nothing to push for this branch.",
    );
  }
  try {
    return await pushSessionBranch(gitCtx);
  } catch (error) {
    mapPushError(error);
  }
}
```

**Critical:** Do **not** leave the old shared outer status → dirty → `if (kind===push) push` path that then falls into openPR (that double-pushes with core). OpenPR must return inside its own branch.

**NO backup** in agent path.

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/lib/agent-git-handler.test.ts
```

### Step 2.6: Full focused suite + format

```bash
pnpm check
pnpm typecheck
pnpm --filter @ditto/web exec vitest run \
  src/lib/session-git-export.test.ts \
  src/lib/session-git-ui-actions.test.ts \
  src/lib/agent-git-handler.test.ts \
  src/integrations/trpc/routers/session-git.test.ts
```

→ all pass; check exit 0.

### Step 2.7: Phase 2 commit + index

```text
feat(session): share push-then-open pull request orchestration
```

Update `plans/README.md` plan 029 row to DONE with branch tip SHA when executor
finishes (unless reviewer owns the index).

**Verify**: `git status` clean for in-scope files; two logical commits on the
branch (Phase 1 + Phase 2).

---

## Test plan

Model after `apps/web/src/lib/session-git-ui-actions.test.ts`.

### Phase 1

| File | Case |
|------|------|
| `agent-git-handler.test.ts` | openPR + `unavailable/worktree` → 409 + `Session worktree is not ready.` |
| `agent-git-handler.test.ts` | openPR + `unavailable/github` → GitHub string (optional, preferred) |

### Phase 2

| File | Case |
|------|------|
| `session-git-export.test.ts` | blocker table (all kinds above) |
| `session-git-export.test.ts` | core dirty / shortCircuit / push-then-open / push-then-existing / push-then-block / open-only / policy open existing / error propagation |
| `session-git-ui-actions.test.ts` | update status call orders; preserve no-generate on existing/dirty; backup after failed open if pushed |
| `agent-git-handler.test.ts` | push-first still works; worktree message still exact; no backup mocks introduced |
| `session-git.test.ts` router tests | explicit openPR still maps preconditions; generated path untouched |

Parity preference: same fixture workflows across ui-actions and export core tests
where practical (dirty, push→open-pr, existing shortCircuit).

**Verification command**: Step 2.6 command → all pass.

---

## Done criteria

Machine-checkable. ALL must hold:

- [ ] Phase 1 commit exists: agent openPR worktree unavailable uses exact
  `Session worktree is not ready.`
- [ ] Phase 2 commit exists: `session-git-export.ts` exports
  `sessionGitOpenPullRequestBlocker` and `runPushThenOpenPullRequest`
- [ ] No duplicated open-PR unavailable message tables remain in the three
  callers (grep):

```bash
rg -n "GitHub status is currently unavailable" \
  apps/web/src/lib/agent-git-handler.ts \
  apps/web/src/lib/session-git-ui-actions.ts \
  apps/web/src/integrations/trpc/routers/session-git.ts
```

→ zero matches in those three files (message lives in `session-git-export.ts`
and optionally UI components — components are out of scope and may still contain
the string).

```bash
rg -n "Session worktree is not ready" \
  apps/web/src/lib/agent-git-handler.ts \
  apps/web/src/lib/session-git-ui-actions.ts \
  apps/web/src/lib/session-git-export.ts \
  apps/web/src/integrations/trpc/routers/session-git.ts
```

→ definition in export module (constant); callers use import or blocker, not a
third independent copy of the open-PR gate table. Router may still use the
constant for gitStatus soft summary — that is OK if it imports the shared
constant.

- [ ] UI generated path still: outer lock + PI generate + backup if didPush
- [ ] Router explicit path still: **no** outer lock; backup if didPush; policy
  `open` for existing PR
- [ ] Agent path: `bypassWorkspaceLock: true`; **no** backup; policy `open`
- [ ] Core file has no imports of TRPC, agent JWT, metadata generate, or backup
- [ ] `pnpm check` exit 0
- [ ] `pnpm typecheck` exit 0 (or only pre-existing out-of-scope errors reported)
- [ ] Focused tests in Step 2.6 all pass
- [ ] No files outside Scope modified (`git status`)
- [ ] `plans/README.md` status updated when executor completes

---

## STOP conditions

Stop and report (do not improvise) if:

1. Drift check shows behavioral change in in-scope files vs Current state
   excerpts.
2. Wiring core appears to require putting PI `generatePullRequestMetadata` inside
   `session-git-export.ts`.
3. Wiring appears to require merging agent JWT auth with tRPC auth or merging
   context loaders.
4. Preserving backup-on-push-failure appears to require rewriting
   `session-git-backup.ts` primitives.
5. Explicit router path seems to “need” an outer lock to share core — do **not**
   add it; keep explicit unlocked (deferred harden).
6. `openSessionPullRequest` semantics for existing PRs under policy `open`
   differ from today’s router/agent behavior in a way tests cannot reconcile —
   report rather than inventing a fourth policy.
7. A verification command fails twice after a reasonable fix.
8. Out-of-scope files appear necessary (readiness, session-git primitives rewrite,
   UI components).
9. HEAD is not `30c06f2` or a descendant that still matches excerpts — re-read
   live code; if the agent worktree bug is already fixed differently, STOP and
   reconcile rather than dual-fixing.

---

## Maintenance notes

- **Future export changes** (e.g. draft PR support, fingerprint checks) should
  land in `session-git-export.ts` first, then thin adapters.
- **Reviewers** should scrutinize:
  - worktree vs github strings exact
  - existing-PR policy differences (`shortCircuit` UI vs `open` router/agent)
  - UI still locks + generates + backups; agent never backups
  - router explicit still unlocked
  - `bypassWorkspaceLock` only where caller already holds / assumes lock
  - no readiness calls inside core
- **Deferred (P2 harden)**: optionally run router explicit open-PR under the same
  outer session lock as generated metadata path for TOCTOU consistency — not in
  this plan.
- **Interaction**: Plan 028 readiness remains at callers only; export core
  assumes worktree already bound.
- **Interaction**: Plan 026 PI metadata remains UI-generated-only; core accepts
  final title/body strings.

---

## Executor checklist (quick)

1. Drift at `30c06f2`
2. Phase 1: agent worktree message + test + commit
3. Phase 2: `session-git-export.ts` blocker + core + tests
4. Wire ui-actions (lock/generate/backup), router explicit (no lock; backup if
   didPush in finally), agent (bypass/no backup; openPR early-return)
5. Focused tests + `pnpm check` + `pnpm typecheck`
6. Phase 2 commit; mark plan DONE in `plans/README.md`
