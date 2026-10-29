# Plan 033: The product routes candidate preview hosts and the preview pane uses candidate actions

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f554a6b..HEAD -- apps/web/src/server.ts apps/web/src/server.test.ts apps/web/types/env.d.ts apps/web/src/components/session-preview-pane.tsx apps/web/src/components/session-preview-pane.test.tsx apps/web/src/components/session-tools-pane.tsx apps/web/src/components/ai-chat.tsx apps/web/src/lib/candidate-session-client.ts`
> Plan 032 must already be merged. Confirm that `grep -n "url: string" packages/runtime-contracts/src/workspace-action.ts` matches the `preview_running` line. If it doesn't, STOP. For any other drift, compare the excerpts; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (it touches the public `fetch` entry ahead of the legacy preview proxy; the existing routing tests guard legacy behavior)
- **Depends on**: `plans/032-candidate-preview-runtime.md` (the `url` field on `preview_running`)
- **Category**: direction (build, from `plans/decisions/024-candidate-preview-delivery.md`)
- **Planned at**: commit `f554a6b`, 2026-10-29

## Why this matters

Candidate sessions (the new runtime) now return a preview URL shaped `10000-c-<sessionUuid>-<token>.ayn.wtf` in production, or `http://10000-c-<uuid>-<token>.localhost:<port>/` locally. Today nothing serves that URL, and the preview pane always calls the legacy tRPC preview, which does not work for candidate sessions. This plan:
- makes the product Worker forward candidate preview hosts to the runtime over a service binding named `CANDIDATE_PREVIEW`, which is optional and unbound until deployment wiring exists;
- keeps those hosts away from the legacy proxy;
- teaches the preview pane to start and stop candidate previews through the existing `runWorkspaceAction` client.

## Current state

- `apps/web/src/server.ts:143-162`: the Worker `fetch`. The legacy proxy runs first:

```ts
// apps/web/src/server.ts:143-157
export default {
	async fetch(
		request: Request,
		env: Env,
		_ctx?: ExecutionContext,
	): Promise<Response> {
		const proxied = await proxyToSandbox(request, env as unknown as SandboxEnv);
		if (proxied) {
			return injectPreviewScrollbar(proxied);
		}

		const hostname = new URL(request.url).hostname;
		if (isProductionPreviewHost(hostname)) {
			return new Response("Not Found", { status: 404 });
		}
```

  Legacy sandbox IDs are also lowercase UUIDs, so the legacy `proxyToSandbox` would parse a candidate host as `sandboxId = "c-<uuid>"` and answer it. A candidate host must therefore be matched **before** that call and must never reach it.
- `apps/web/types/env.d.ts`: optional extra bindings are declared by intersecting them with the inferred Alchemy env:

```ts
export type CloudflareEnv = typeof website.Env & {
	PI_DURABLE_PRODUCT_COMMANDS?: import("../src/lib/session-runtime-client").CandidateProductCommandService
}
```

- `apps/web/src/lib/candidate-session-client.ts:163-177`: `runWorkspaceAction({ kind, projectId, sessionId, message? })` posts to `/api/agent/workspace-action` and returns `WorkspaceActionResultV1`. It only checks that `status` is a string, and throws `new CandidateRequestError(502, "invalid_response")` otherwise.
- `candidate-session-client.ts:198-210`: `describeWorkspaceDenial(reason)` already maps every `WorkspaceActionDenial` to UI copy, and `session-git-actions.tsx:724` uses it. Reuse it for preview denials; don't write new denial strings.
- `apps/web/vite.config.ts:28-30`: the local dev plugin's preview-host regex, `/^\d{4,5}-[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?\.localhost(?::\d+)?$/i`, sends matching requests past Vite's middleware to the Worker. It rejects a host whose last label character is `_`, but SDK tokens can end in `_`, so about 1 in 19 local candidate previews would get Vite's own assets instead.
- Candidate sessions have no `recovery` row (`apps/web/src/lib/workspace-recovery.ts:256-265`), so the pane's legacy "Retry Backup" controls (`session-preview-pane.tsx:388-470`, `retryBackupMutation` at `:132-142`) never apply to them.
- `candidate` is set for existing sessions too: `routes/project.$projectId.tsx:395-397` derives candidate mode from `selectedSession.runtimeOwner`. `ai-chat.tsx:923` already passes `candidate={Boolean(candidate)}` to `ChatNavbar`; follow the same pattern.
- `apps/web/src/components/session-preview-pane.tsx`: the pane. Props are at `:32-41` (`projectId`, `sessionId`, `className`, `recovery`). `PaneState` is at `:21-27`. `startMutation`/`stopMutation` use `trpc.sessionPreview.start/stop` (`:115-160`). The `start`, `restart` and `stop(currentUrl)` handlers are at `:164-176`.
- `apps/web/src/components/session-tools-pane.tsx`: renders `<SessionPreviewPane projectId sessionId className recovery />` at about `:125-130`. Props type at `:12`.
- `apps/web/src/components/ai-chat.tsx`: `candidate?: CandidateContext` prop (`:134-135`, destructured at `:714`). It renders `<SessionToolsPane .../>` twice (`:1098-1104`, `:1121-1127`).
- `WorkspaceActionResultV1` (from `packages/runtime-contracts/src/workspace-action.ts`), the statuses the pane must handle:
  - `preview_running {generation, url}`
  - `preview_stopped {generation}`
  - `denied {reason: busy|restore_in_progress|archived|backup_overdue|blocked|unavailable|capacity}`
  - `rejected {reason}` (notably `preview_url_unavailable`)
  - `unknown`
  - `preview_unavailable`
- Tests:
  - `apps/web/src/server.test.ts:102-190` mocks `proxyToSandbox` (`proxyToSandboxMock`) and calls `server.fetch(new Request(...), env)`. Model the new routing tests on it.
  - `apps/web/src/components/session-preview-pane.test.tsx` mocks `useTRPC` and `useMutation`. The mocked `useMutation` only calls `mutationFn`; it never calls `onSuccess`/`onError`. So the candidate path must update pane state **inside its `mutationFn`** for the tests to observe it.
- The UUID pattern for session IDs: `crypto.randomUUID()`, lowercase, `8-4-4-4-12` hex.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install (fresh worktree) | `pnpm install` (never symlink `node_modules` from another checkout) | exit 0 |
| Focused web tests | `pnpm --filter @ditto/web test -- src/server.test.ts src/lib/candidate-preview-host.test.ts src/lib/candidate-session-client.test.ts src/components/session-preview-pane.test.tsx` | all pass |
| Web typecheck | `pnpm typecheck` | exit 0 |
| Web tests | `pnpm test` | all pass |
| Lint/format | `pnpm check` | exit 0 |

## Scope

**In scope:**
- `apps/web/src/lib/candidate-preview-host.ts` (create) and `candidate-preview-host.test.ts` (create)
- `apps/web/src/server.ts`, `apps/web/src/server.test.ts`
- `apps/web/types/env.d.ts`
- `apps/web/src/components/session-preview-pane.tsx`, `session-preview-pane.test.tsx`
- `apps/web/src/components/session-tools-pane.tsx`
- `apps/web/src/components/ai-chat.tsx`: only pass `candidate={Boolean(candidate)}` to both `SessionToolsPane` renders
- `apps/web/src/lib/candidate-session-client.ts`: only the `preview_running` URL check in `runWorkspaceAction`; and its existing test `candidate-session-client.test.ts`
- `apps/web/vite.config.ts`: only the `localPreviewHost` regex

**Out of scope:**
- `alchemy.run.ts` and any binding creation. `CANDIDATE_PREVIEW` stays unbound until the deployment-wiring track.
- `apps/web/src/lib/session-preview.ts` and the legacy tRPC router: legacy sessions keep their path unchanged.
- `apps/runtime/**` and `packages/**`.
- Pane visual redesign. Reuse the existing states and layout; only the data source changes for candidates.

## Git workflow

- Commit on your current branch; don't push.
- Message style: `feat(web): route candidate preview hosts`, `feat(web): candidate preview pane`.

## Steps

### Step 1: Host and URL matchers

Create `apps/web/src/lib/candidate-preview-host.ts`:

```ts
const LABEL = /^10000-c-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[a-z0-9_]{1,16}$/;

/** A candidate preview host: one `10000-c-<session>-<token>` label under `ayn.wtf` or `localhost`. */
export function isCandidatePreviewHost(hostname: string): boolean;

/** A URL the runtime may hand the preview pane: https under ayn.wtf with no port, or http under localhost. */
export function isCandidatePreviewUrl(value: string): boolean;
```

- `isCandidatePreviewHost`: lowercase the hostname. It must be exactly `<label>.ayn.wtf` or `<label>.localhost`, where `<label>` matches `LABEL`.
- `isCandidatePreviewUrl`: `new URL(value)` inside a try. Require `protocol === "https:"`, `port === ""` and an `.ayn.wtf` host, or `protocol === "http:"` and a `.localhost` host (any port). The host must pass `isCandidatePreviewHost`. There must be no username or password.

**Verify**: `pnpm --filter @ditto/web test -- src/lib/candidate-preview-host.test.ts` → pass (Test plan section A).

### Step 2: Binding type and routing

1. `env.d.ts`: add `CANDIDATE_PREVIEW?: Fetcher` to `CloudflareEnv`, with a comment line above it: `// Runtime service binding for candidate preview hosts; unbound until deployment wiring.`
2. In `server.ts` `fetch`, before the `proxyToSandbox` call:
   ```ts
   const hostname = new URL(request.url).hostname;
   if (isCandidatePreviewHost(hostname)) {
   	if (!env.CANDIDATE_PREVIEW) return new Response("Not Found", { status: 404 });
   	return injectPreviewScrollbar(await env.CANDIDATE_PREVIEW.fetch(request));
   }
   ```
   Remove the later duplicate `const hostname = ...` and reuse this one. The remaining flow stays as is.

3. In `apps/web/vite.config.ts`, widen `localPreviewHost` to `/^\d{4,5}-[a-z0-9](?:[a-z0-9_-]*[a-z0-9_])?\.localhost(?::\d+)?$/i`, so a trailing `_` is allowed. Change nothing else in that file.

**Verify**: `pnpm --filter @ditto/web test -- src/server.test.ts` → all existing tests still pass, plus the new ones (Test plan section B). (The `--` may make vitest run the whole web suite. That is acceptable; it must still pass.)

### Step 3a: Validate the URL in the client

In `runWorkspaceAction`, after the existing `status` check: if `body.status === "preview_running"` and `body.url` is not a string or fails `isCandidatePreviewUrl`, throw `new CandidateRequestError(502, "invalid_response")`. This puts the check in the client parser, as decision 024 requires, so no consumer ever receives an unvalidated bearer URL.

### Step 3: Candidate mode in the preview pane

1. `SessionPreviewPaneProps` gains `/** Candidate sessions start and stop preview through runtime workspace actions. */ candidate?: boolean;`.
2. Add two `useMutation` calls (always called; React hooks must be unconditional) whose `mutationFn` does all state updates itself:
   - **Candidate start**:
     - Call `setState({ kind: "starting" })`, then `await runWorkspaceAction({ kind: "preview_start", projectId, sessionId })`.
     - **Self-heal:** if the result is `{ status: "rejected", reason: "preview_url_unavailable" }`, which happens when the runtime thinks the preview is running but its URL is gone (for example after a container restart), run `preview_stop` once.
       - If that returns `preview_stopped`, run `preview_start` once more and use that result below.
       - Never loop more than this one stop/start pair. The `failed` state has no Stop button, so the user could not recover any other way.
     - On `preview_running`: `setState({ kind: "ready", url: result.url })`. The client already validated the URL in step 3a.
     - On any other result: `setState({ kind: "failed", message: candidateMessage(result) })`.
     - On a thrown error: `setState({ kind: "failed", message: "Failed to start preview." })`.
   - **Candidate stop**: `await runWorkspaceAction({ kind: "preview_stop", ... })`.
     - On `preview_stopped`: `setState({ kind: "idle" })`.
     - Otherwise, keep the current URL as in the legacy `onError` (`:150-160`): if `prev.kind === "stopping"`, `setState({ kind: "ready", url: prev.url, error: candidateMessage(result) })`.
     - On a thrown error, do the same with `"Failed to stop preview."`.
3. `start`, `restart` and `stop` call the candidate mutations when `candidate` is true, and the existing tRPC ones otherwise. Include the candidate mutations' `isPending` in `isPending`.
4. `candidateMessage(result: WorkspaceActionResultV1): string`, a module-level function with exact copy:
   - `denied` → `describeWorkspaceDenial(result.reason)` (the existing shared copy).
   - `rejected` with `preview_url_unavailable` (only reachable after the one self-heal attempt failed) → `"The preview address expired. Try again shortly."`. Any other `rejected` → `"Preview failed to start."`
   - `unknown` → `"Preview state is unknown and needs review."`
   - `preview_unavailable` → `"No saved workspace can restore this preview."`
   - anything else → `"Preview is unavailable right now."`
   - Never include the URL or a raw reason code in a message.
5. When `candidate` is true, do not render the "Retry Backup" controls (`:388-470` blocks that call `retryBackupMutation`). Candidate sessions have no recovery row, and that button calls the legacy tRPC router. Leave `useMutation` for it in place; only skip the rendering.
6. `session-tools-pane.tsx`: add `candidate?: boolean` to its props and pass it to `SessionPreviewPane`. `ai-chat.tsx`: pass `candidate={Boolean(candidate)}` to both `SessionToolsPane` renders.

**Verify**: `pnpm typecheck` → exit 0. `pnpm --filter @ditto/web test -- src/components/session-preview-pane.test.tsx` → existing and new tests pass (Test plan section C).

### Step 4: Full gate

**Verify**: `pnpm typecheck`, `pnpm test` and `pnpm check` → all exit 0.

## Test plan

**A0. Client validation**: extend the existing `apps/web/src/lib/candidate-session-client.test.ts`, following how it already stubs `fetch`. Stub `fetch` so `/api/agent/workspace-action` returns `preview_running` with `url: "https://evil.example/"`. `runWorkspaceAction` must reject with `CandidateRequestError` code `invalid_response`. With a valid candidate URL it resolves.

**A. `apps/web/src/lib/candidate-preview-host.test.ts`**:
- Hosts accepted: `10000-c-<uuid>-tok.ayn.wtf`, the same uppercase, and `10000-c-<uuid>-a_b.localhost`.
- Hosts rejected:
  - the legacy `10000-<uuid>-tok.ayn.wtf`
  - `3000-c-<uuid>-tok.ayn.wtf`
  - `10000-c-notauuid-tok.ayn.wtf`
  - a deeper `x.10000-c-<uuid>-tok.ayn.wtf`
  - `10000-c-<uuid>-tok.ayn.wtf.evil.com`
  - a 17-character token
  - the apex `ayn.wtf`
- URLs:
  - accepted: `https://<host>.ayn.wtf/` and `http://<host>.localhost:5173/`
  - rejected: `http://<host>.ayn.wtf/`, `https://<host>.ayn.wtf:8443/`, `https://user:pw@<host>.ayn.wtf/`, `javascript:alert(1)`, and a non-URL string.

**B. `apps/web/src/server.test.ts`** (new `describe("candidate preview routing")`; use a real-looking UUID):
1. A candidate host with `CANDIDATE_PREVIEW` bound: `CANDIDATE_PREVIEW.fetch` is called once with the same request, `proxyToSandboxMock` is **not** called, and TanStack is not called.
2. An HTML response from the binding gets the scrollbar style injected (same assertion as the existing injection test).
3. A candidate host with the binding unbound → 404, and neither `proxyToSandboxMock` nor TanStack is called.
4. A legacy `10000-<uuid>-tok.ayn.wtf` host with the binding bound: `proxyToSandboxMock` is called and the binding is not.
5. A non-HTML binding response (for example `new Response(null, { status: 101 })` is not constructible in every runtime, so use a `204` or a `text/javascript` 200) is returned by identity (`toBe`), not rebuilt.

**C. `apps/web/src/components/session-preview-pane.test.tsx`**: mock the client **partially**, so `describeWorkspaceDenial` stays real: `vi.mock("#/lib/candidate-session-client", async (importOriginal) => ({ ...(await importOriginal<typeof import("#/lib/candidate-session-client")>()), runWorkspaceAction: runWorkspaceActionMock }))`, with a hoisted `runWorkspaceActionMock`.
1. `candidate` start → `runWorkspaceActionMock` is called with `{ kind: "preview_start", projectId, sessionId }`, `startMutate` (tRPC) is not called, and an iframe with the returned URL renders.
2. `candidate` start where the mock throws `new Error("x")` → no iframe, and "Failed to start preview." is shown.
3. `candidate` start returning `{ status: "denied", reason: "capacity" }` → the text "No workspace slot is free right now." (from `describeWorkspaceDenial`).
3a. Self-heal: the mock returns `rejected/preview_url_unavailable`, then `preview_stopped`, then `preview_running` with a URL. The calls are start, stop, start in that order, and the iframe renders. If the second start returns `preview_url_unavailable` again, exactly three calls are made and the "expired" message is shown.
3b. With `candidate` and `recovery={{ state: "failed", reasonCode: null, pending: false }}`, no "Retry Backup" button renders.
4. `candidate` stop success → the iframe is gone. Stop returning `{ status: "rejected", reason: "x" }` → the iframe stays and the message is shown.
5. Without `candidate`: the existing tests still pass unchanged, and `runWorkspaceActionMock` is never called.

## Done criteria

- [ ] `pnpm typecheck`, `pnpm test` and `pnpm check` exit 0
- [ ] In `server.ts`, `isCandidatePreviewHost` appears before `proxyToSandbox(` in `fetch`. `awk '/isCandidatePreviewHost\(hostname\)/{a=NR} /proxyToSandbox\(request/{b=NR} END{exit !(a && b && a<b)}' apps/web/src/server.ts` exits 0
- [ ] `grep -n "CANDIDATE_PREVIEW" alchemy.run.ts` returns nothing (no binding added)
- [ ] The new tests in sections A–C exist and pass
- [ ] `git status` shows only in-scope files

## STOP conditions

- Plan 032's `url` field is not present on `preview_running`.
- Any existing `server.test.ts` routing test needs its expectation changed. Legacy behavior must not change.
- Typing `env.CANDIDATE_PREVIEW` requires editing `alchemy.run.ts`.
- The pane change needs new visual states or layout changes beyond the message copy above (UI decisions go back to the maintainer).

## Maintenance notes

- `CANDIDATE_PREVIEW` is bound by the deployment-wiring track. It points at a runtime Worker entrypoint whose `fetch` calls `candidatePreviewFetch` (plan 032). Until then, candidate preview hosts return 404 and the pane shows the URL in an iframe that 404s. That is expected locally until wiring lands.
- The host pattern here must stay identical to `parseCandidatePreviewHost` in `apps/runtime/src/pi-durable-preview.ts`. A change to one needs the same change in the other.
- When the legacy preview is retired (plan 019), delete the tRPC branch of the pane, not the candidate one.
- **Nothing works end to end after this plan alone.** `CANDIDATE_PREVIEW` is unbound, so every candidate preview is an iframe that shows 404. Local requests do reach the Worker: the widened Vite regex forwards `10000-c-…localhost:5173` hosts. The wiring plan turns it on.
- **Runtime-initiated stops are not pushed to the pane.** After a backup-deadline stop or an archive, the pane stays `ready` and its iframe shows 404 until the user clicks Reload or Stop. Reload takes the start path: the idempotent result, or the self-heal, gives a fresh URL. This is accepted for now; a status poll is a later choice.
- The public-link warning and the iframe `sandbox` attributes stay as they are. The candidate URL is still a bearer link on a separate origin, the same as the legacy one.
