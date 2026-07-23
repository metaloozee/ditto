# Plan 027: Run session-worktree websites in a safe live-preview pane

> Start here. This plan is self-contained and dispatch-ready from the pinned
> commit. If a STOP condition occurs, stop and report instead of improvising.

## Plan metadata

- **Type**: feature / infrastructure / security
- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH — repository code becomes reachable on public wildcard URLs
- **Dependencies**: Plans 005, 011, 012, 017, and 024 (all DONE)
- **Pinned base commit**: `e1f4547`
- **Execution status**: DONE (automated gates + Docker build; live smokes NOT RUN) — branch `advisor/027-session-live-previews` @ `7e3bbbd`
- **Production preview zone**: apex `ayn.wtf`; previews use `*.ayn.wtf`
- **Local preview origin**: Wrangler/Alchemy localhost URL; no public DNS needed

## Execution review — approved 2026-07-22

Two revision rounds on Grok 4.5 High after the first attempt. Final commits on
`advisor/027-session-live-previews` in `/home/ayan/ditto-plan-027-worktree`:

- `5ef10c6` `feat(preview): add session preview backend`
- `7e3bbbd` `feat(preview): add session preview pane`

Accepted deviations:

- UI commit includes `apps/web/src/hooks/use-mobile.ts` (jsdom-safe reuse) in
  addition to the five component files + two frontend docs.
- Backend fixture scope includes nullable preview fields on
  `agent-run-service.test.ts` and `project-sandbox.test.ts`.
- No root Sandbox `waitForPort`; process-scoped readiness only. Generic terminal
  readiness maps to `start_failed` (typed `port_conflict` retained unused).
- Live local Alchemy and production `*.ayn.wtf` Start/load/Stop smokes NOT RUN.


## Why this matters

Each chat session already owns a Git worktree inside its project's Cloudflare
Sandbox, but users cannot see a website running from that worktree. Add one
preview per session: start a supported root dev server in the exact worktree,
expose its leased port through Cloudflare Sandbox `exposePort()`, and display the
returned URL in a right-side pane.

Backend correctness is the feature. The UI is a separate final commit that can
be cherry-picked independently. Terminal and Code remain disabled labels.

## Locked decisions

1. **Use `exposePort()`/`unexposePort()`, not Sandbox quick tunnels.** SDK 0.12.3
   quick-tunnel teardown can lose its record before `cloudflared` cleanup
   completes. Worker-fronted exposed ports provide explicit revocation and work
   with the confirmed `ayn.wtf` wildcard zone.
2. **The production base hostname is exactly `ayn.wtf`.** Generated previews are
   direct children such as
   `https://<port>-<sandbox>-<token>.ayn.wtf`. Configure a proxied wildcard DNS
   record and Worker Route for `*.ayn.wtf/*`. Do not use `*.preview.ayn.wtf`:
   Cloudflare Universal SSL does not automatically cover that second-level
   wildcard.
3. **Local development does not use `ayn.wtf`.** `exposePort()` returns a
   localhost URL. The Dockerfile must expose the fixed local preview pool.
4. **One process and one exposed port per active session.** The process cwd is
   the exact canonical session worktree. Project sandboxes remain shared.
5. **Ports come from the fixed range `10000..10031`.** Port 3000 is reserved by
   Sandbox. Thirty-two concurrent previews per project is the v1 capacity and
   every port is explicitly exposed in Docker for local development.
6. **D1 owns leases.** Add nullable `workspaceSessions.previewPort` plus a unique
   index on `(projectId, previewPort)`. Allocation uses atomic
   `UPDATE OR IGNORE` plus authoritative reload. Stop/archive clears the lease
   only after exposure and process cleanup are confirmed.
7. **Start, Stop, archive, and project deletion share an external D1 lifecycle
   lease.** The lease lives on the project row, not inside the Sandbox being
   destroyed. Every mutating path acquires it before sandbox access and reloads
   authoritative ownership/status under it.
8. **Only root Vite and Next.js are supported.** Accept exact root `dev` scripts
   `vite`, `vite dev`, `next`, or `next dev`, require the matching direct
   dependency and local `node_modules/.bin` executable, then invoke that fixed
   executable directly. Never execute package scripts, lifecycle hooks,
   wrappers, installers, or package-manager commands.
9. **Vite must be `>=6.1.0`.** Start it with
   `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.ayn.wtf`, which is safe because this
   product controls that zone. Localhost remains Vite-allowed. Reject older or
   unparseable Vite versions rather than using `allowedHosts: true` or changing
   repository config.
10. **Do not decrypt or inject configured project environment variables.** The
    public preview process receives only code-owned host/port/framework values.
11. **URLs are ephemeral public bearer capabilities.** Return them only from the
    authenticated Start mutation. Never log, persist, toast, normalize, or put
    them in query/cache/local storage. Stop and archive revoke them.
12. **No preview backup and no long-lived workspace writer lock.** Repair a
    missing worktree under the existing writer lock, release it, then run the
    watcher concurrently with agent edits.
13. **The final UI commit changes exactly five UI files.** Backend, schema,
    infrastructure, tests, and docs land first.

## Production domain setup (one-time operator prerequisite)

The executor must verify this before the production smoke test. It is not needed
for local development.

### Cloudflare Dashboard

In **Websites → ayn.wtf → DNS → Records**, create or verify:

| Field | Value |
|---|---|
| Type | `A` |
| Name | `*` |
| IPv4 address | `192.0.2.0` |
| Proxy status | **Proxied** (orange cloud) |
| TTL | Auto |

`192.0.2.0` is Cloudflare's documented RFC 5737 placeholder for this proxied
wildcard setup; it is not an application origin. Specific DNS records remain
more specific than the wildcard.

The wildcard Worker Route is managed in `alchemy.run.ts` by this plan, not
manually. If a manual `*.ayn.wtf/*` route already exists, the Alchemy resource
uses `adopt: true`. The deploying API token needs **Zone Read** and Workers
Routes edit permissions for `ayn.wtf`.

The owner has already configured `ayn.wtf` as Ditto's production control origin;
verify that custom-domain mapping still targets this Worker. The wildcard Route
does not match the apex. If the apex mapping is missing or points elsewhere,
STOP rather than silently relying on workers.dev for the production acceptance
test.

After deployment, Dashboard **Workers & Pages → Ditto Worker → Settings →
Domains & Routes** must show `*.ayn.wtf/*`. SSL/TLS should be Full or Full
(strict). Allow certificate provisioning time before the smoke test.

## Current-state anchors

Before editing, verify all of these still hold at `e1f4547`:

- `alchemy.run.ts` creates one `TanStackStart("website", ...)` with `url: true`,
  RPC Sandbox binding, and no wildcard Route.
- `apps/web/src/server.ts` directly delegates to TanStack's `handler.fetch` and
  exports `Sandbox`; it does not call `proxyToSandbox()`.
- `Dockerfile` pins `docker.io/cloudflare/sandbox:0.12.1`; `apps/web/package.json`
  declares `@cloudflare/sandbox` with a caret and the lock currently resolves
  0.12.3.
- `apps/web/src/db/schema.ts` has no preview field/index.
- `apps/web/src/lib/project-sandbox.ts` owns sandbox restoration and
  `ensureProjectSandbox`.
- `apps/web/src/lib/session-worktree.ts` owns canonical worktree repair;
  `session-workspace-lock.ts` owns writer serialization.
- `workspace.deleteSession` archives a session without preview cleanup.
- `projects.deleteProject` destroys the sandbox before deleting D1 state and has
  no preview lifecycle fence.
- `Chat` owns Git-action placement; `ChatNavbar` renders `rightActions`; the
  project route owns desktop/mobile composition.
- no CSP exists in `apps/web/src/server.ts` or `apps/web/src/styles.css`.

If any anchor differs, run the drift protocol and update this plan before source
work.

## Target contracts

### D1

```ts
// projects (keep existing provisioning|ready|failed status union)
previewLockToken: text("previewLockToken") // nullable
previewLockExpiresAt: integer("previewLockExpiresAt") // nullable epoch seconds
deletingAt: integer("deletingAt") // nullable durable deletion tombstone

// workspaceSessions
previewPort: integer("previewPort") // nullable
uniqueIndex("workspace_sessions_project_preview_port_uidx").on(
  table.projectId,
  table.previewPort,
)
```

No URL, process ID, preview token, or preview status is persisted. SQLite allows
multiple NULL ports. Stop/archive set the owned row back to NULL only after
confirmed cleanup. The project lease uses a random owner token and bounded
expiry so a crashed Worker cannot lock previews forever.

### Process IDs and port pool

Add policy helpers/constants in `workspace-policy.ts`:

```ts
SESSION_PREVIEW_PORT_MIN = 10000;
SESSION_PREVIEW_PORT_MAX = 10031;
sessionPreviewProcessId(sessionId); // ditto-preview-<safe-id>
```

Reuse the module's existing private sanitization rules. Process IDs and lock
paths are bounded deterministic identifiers, never raw filesystem paths.

### Commands

For code-owned integer `port` and canonical `cwd`:

```text
./node_modules/.bin/vite --host 0.0.0.0 --port <port> --strictPort
./node_modules/.bin/next dev --hostname 0.0.0.0 --port <port>
```

Use `startProcess(command, { processId, cwd, env, autoCleanup: true })`. The command is
constructed only from fixed literals and a validated integer. Set:

- both: `HOST=0.0.0.0`, `PORT=<port>`;
- Vite production and local: `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.ayn.wtf`.

No package-script text or configured project value enters command/env.

### Preview host selection

Add `PREVIEW_BASE_HOST: "ayn.wtf"` to Alchemy bindings; the existing generated
`apps/web/types/env.d.ts` infers it from `website.Env`. The service receives the
request URL from tRPC context:

- request hostname `localhost` or `127.0.0.1` → pass validated `URL.host`
  (including its port, such as `localhost:5173`) to `exposePort()` and
  `getExposedPorts(host)` for local development;
- otherwise require configured `PREVIEW_BASE_HOST === "ayn.wtf"` and use it;
- reject `.workers.dev`, arbitrary Host values, wildcard strings, ports, paths,
  or empty production configuration.

### tRPC

```ts
sessionPreview.start.mutate({ projectId, sessionId })
// { status: "running", url, port, reused }

sessionPreview.stop.mutate({ projectId, sessionId })
// { status: "stopped" }
```

Both are protected mutations with bounded nonempty IDs. Start is the status and
reconciliation boundary; there is no query/subscription in v1.

Typed service reasons:

```ts
type SessionPreviewErrorCode =
  | "not_found"
  | "not_ready"
  | "busy"
  | "unsupported_project"
  | "capacity_exhausted"
  | "port_conflict"
  | "start_failed"
  | "expose_failed"
  | "cleanup_failed";
```

Messages are fixed code-owned strings. Never return process output or raw DB/SDK
errors.

### Worker routing

`server.ts` must attempt `proxyToSandbox(request, env)` before TanStack routing.
Return any SDK response unchanged—including its generic 500 behavior—so HTML,
assets, HMR WebSockets, APIs, and SDK failures preserve the supported contract.
After a null proxy result, any proper subdomain of `.ayn.wtf` (one or more
labels) returns a plain 404; it must not fall through to Ditto. Normal apex,
lookalike, and local app requests continue to TanStack.

### UI

`Chat` gains one controlled Preview toggle immediately to the right of Git
actions. Desktop renders a bounded right sibling pane; mobile uses the existing
Sheet primitive. `SessionPreviewPane` owns only ephemeral component state:
idle, starting, ready, stopping, failed. It provides Start, Restart, and Stop.
Closing the pane hides it without stopping the server.

Iframe policy:

```html
<iframe
  title="Session website preview"
  referrerpolicy="no-referrer"
  sandbox="allow-forms allow-same-origin allow-scripts"
/>
```

Do not grant downloads, modals, popups, top navigation, clipboard, camera,
microphone, or geolocation.

## Scope

### Backend/infrastructure commit

- root `package.json`, `pnpm-lock.yaml`, `Dockerfile`
- `alchemy.run.ts`
- `apps/web/src/server.ts` and a focused server routing test
- generated `apps/web/types/env.d.ts` only if Alchemy regeneration changes it
- `apps/web/src/db/schema.ts`, generated migration, migration test
- `apps/web/src/lib/workspace-policy.ts` and tests
- schema-fixture updates in `apps/web/src/lib/agent-run-service.test.ts` and
  `apps/web/src/lib/project-sandbox.test.ts`
- new `apps/web/src/lib/session-preview.ts` and tests
- new tRPC router and tests; router registration
- `workspace.ts` and its tests
- `projects.ts` and project deletion tests
- `docs/architecture/overview.md`, `server-and-data.md`, `agent-harness.md`, and
  `security.md`

### Final UI-surface commit (requires the backend commit)

- `apps/web/src/components/ai-chat.tsx`
- `apps/web/src/components/chat-navbar.tsx`
- `apps/web/src/components/chat-navbar.test.tsx`
- new `apps/web/src/components/session-preview-pane.tsx`
- new `apps/web/src/components/session-preview-pane.test.tsx`
- `docs/architecture/frontend.md`
- `docs/architecture/repository-map.md`

### Explicitly out of scope

- arbitrary commands, monorepo app selection, CRA, Turbo/Nx
- project env injection or per-key secret UI
- Terminal/Code implementation
- named/quick tunnels, Worker Access auth, stable/bookmarkable URLs
- multiple services per session
- source/config rewrites in imported repositories
- global `keepAlive`, backup-on-start, or agent pause
- generated `apps/web/src/routeTree.gen.ts` ordering-only changes

## Drift protocol

```bash
test "$(git rev-parse HEAD)" = "e1f4547dbb83ac587f78ed2b61fd4193f73ac06b"
git status --short
rg -n 'proxyToSandbox|exposePort|unexposePort|previewPort|sessionPreview' \
  alchemy.run.ts Dockerfile apps/web/src apps/web/migrations
rg -n 'deleteSession|deleteProject|rightActions|SessionGitActions' apps/web/src
pnpm why @cloudflare/sandbox
```

Expected before implementation: clean source tree, only this plan under
`plans/`, no preview implementation, app SDK 0.12.3, Docker 0.12.1. If not,
reconcile current code and regenerate affected excerpts/scope.

## Implementation steps

### Step 1 — Pin Sandbox and add wildcard infrastructure/routing

1. Pin `apps/web/package.json` `@cloudflare/sandbox` to exact `0.12.3`; refresh
   only necessary root lock entries. Pin Docker base to `0.12.3`.
2. Add explicit Docker `EXPOSE` entries for every integer `10000..10031`. Do not
   use port 3000 or an unbounded range.
3. Add `PREVIEW_BASE_HOST: "ayn.wtf"` to Alchemy Worker bindings. Regenerate
   Alchemy types if required; do not invent a second manual Env declaration.
4. Import Alchemy `Route` and create, after `website`, a managed route:

```ts
await Route("session-previews", {
  pattern: "*.ayn.wtf/*",
  script: website,
  adopt: true,
  dev: true,
});
```

   `dev: true` makes the resource a no-op in local Alchemy scope while still
   creating/adopting it on deployment. Keep `url: true` unchanged for existing
   workers.dev access; preview Start rejects workers.dev as a base host.
5. In `server.ts`, call `proxyToSandbox()` first and add the unmatched production
   preview-host 404 boundary described above. Preserve WebSocket responses.
6. Add focused routing tests: proxied response (including SDK 500) wins;
   apex/local miss falls through; unknown shallow/deep `*.ayn.wtf` hosts are
   404; lookalike hosts fall through. Do not mock a thrown proxy exception—the
   0.12.3 helper catches internally.

Verify:

```bash
pnpm install --lockfile-only
pnpm typecheck
pnpm --filter @ditto/web exec vitest run src/server.test.ts
rg -n '0\.12\.3|EXPOSE|PREVIEW_BASE_HOST|session-previews|proxyToSandbox' \
  apps/web/package.json pnpm-lock.yaml Dockerfile alchemy.run.ts \
  apps/web/src/server.ts apps/web/types/env.d.ts
```

### Step 2 — Add lease schema, migration, and policy helpers

1. Add nullable project lifecycle token/expiry/deletion tombstone, session
   `previewPort`, and the project-scoped unique index exactly as in Target
   contracts. Keep the existing project status union unchanged.
2. Generate migration 0011 with the existing Drizzle command. Inspect it: only
   four nullable columns and one unique index; no table rebuild or unrelated
   diff.
3. Add `session-preview-migration.test.ts` using built-in `node:sqlite`: create
   minimal pre-0011 project/session tables, apply generated SQL, verify nullable
   lock/tombstone fields, multiple NULL ports, duplicate non-null project+port rejection,
   and same port in another project.
4. Add port constants/process helper and policy tests for traversal, whitespace,
   bounds, determinism, and differing IDs.

Verify:

```bash
pnpm --filter @ditto/web db:generate
pnpm --filter @ditto/web exec vitest run \
  src/db/session-preview-migration.test.ts src/lib/workspace-policy.test.ts
rg -n 'previewPort|workspace_sessions_project_preview_port_uidx' \
  apps/web/src/db/schema.ts apps/web/migrations
```

### Step 3 — Implement the lifecycle domain service

Create `session-preview.ts` with production defaults and bounded injected fakes
for tests. Do not create a general plugin system.

#### External project lifecycle lease

1. Before any Sandbox access, acquire a D1 lease on the exact owned project row
   with a random UUID owner token and `unixepoch()+900` expiry. Use one atomic
   conditional UPDATE that succeeds only when token is NULL or expired, then
   reload and compare the token. Bound contention retries to five seconds and
   return `busy`; never steal an unexpired lease.
2. Preview Start/Stop/archive acquisition requires `deletingAt IS NULL`.
   Project deletion may acquire an expired lease on a row with `deletingAt` set
   so a failed deletion can be retried safely.
3. All preview readiness/SDK calls are explicitly bounded; `waitForPort` is 30
   seconds and total normal work stays far below the 15-minute lease.
4. Release with an exact `id+userId+token` UPDATE that NULLs token/expiry in
   `finally`. Project deletion instead deletes the row after destruction, which
   consumes the lease without a release RPC. The lease helper performs no
   Sandbox operation.
5. Test owner mismatch, unexpired contention, expired takeover, finally release,
   and project-row deletion. D1—not `/tmp` inside the Sandbox—is the concurrency
   boundary across Workers and sandbox destruction.

#### Authorization/worktree (inside the D1 lease)

1. Reload exact `projectId+userId`; require ready status, lowercase sandbox ID,
   imported repo, and installation ID.
2. Load exact owned active session with `loadOwnedActiveSession`.
3. Call `ensureProjectSandbox` only after the under-lease ready check.
4. Reuse an existing canonical worktree path. If missing/noncanonical, acquire
   `withSessionWorkspaceLock`, call `ensureSessionWorktree`, persist repair with
   exact owner/active predicates, then release before process startup. Busy maps
   to `busy`.
5. Never call `decryptEnvVars` or backup helpers.

#### Atomic allocation

1. Reuse a valid stored lease; otherwise SHA-256 the session ID with Web Crypto
   to choose a stable offset in the 32-port pool.
2. Probe at most 32 candidates using bound SQL:

```sql
UPDATE OR IGNORE workspace_sessions
SET previewPort = ?
WHERE id = ? AND projectId = ? AND userId = ?
  AND status = 'active' AND previewPort IS NULL
```

3. Reload authoritative row after each attempt: candidate means success; another
   valid value means a concurrent same-session Start won; NULL means collision;
   missing/inactive means `not_found`; thrown DB errors propagate.
4. Unique D1 index is the correctness boundary across Workers. Never allocate by
   reading all sessions into memory.

#### Command discovery

1. Read root package.json through Sandbox; reject over 64 KiB, malformed JSON,
   non-plain bounded script/dependency maps.
2. Accept only exact dev script/direct dependency combinations in Locked
   decisions. Reject `predev`/`postdev`, `start`, wrappers, shell operators, and
   multiple frameworks.
3. Parse the direct dependency's installed package version. Require Vite
   `>=6.1.0` using existing package tooling if already present or a tiny local
   numeric parser; no semver dependency addition. Require local binary existence.
4. Build a fixed command; never execute script text. Complete discovery before
   allocating a D1 port so unsupported projects cannot consume capacity.

#### Serialized Start

1. Acquire the external D1 lifecycle lease before the authorization/worktree
   flow above. Under that lease, reload project/session and require ready+active
   immediately before runtime mutation.
2. Resolve deterministic process ID and inspect/refresh exact process status.
3. Validate stored port and inspect `getExposedPorts(host)` for that port.
4. If exact process is healthy and exact exposure exists, validate URL and return
   `reused: true`.
5. If process is healthy but exposure is absent, call `waitForPort(port, {
   timeout: 30_000 })`, then expose it.
6. If no healthy process but leased port already listens, return `port_conflict`
   and do not expose it.
7. Otherwise start the fixed process with `processId`. On any `startProcess`
   rejection, refetch that exact process once: reconcile only if it is healthy;
   otherwise return the fixed start failure. Do not match a nonexistent
   `PROCESS_ALREADY_EXISTS` code. Await explicit 30-second TCP readiness and
   running state, then call `exposePort(port, { hostname: host })`.
8. Validate the SDK result:
   - production: HTTPS, direct child of `.ayn.wtf`, no credentials/search/hash;
   - local: HTTP(S), localhost/127.0.0.1 only, no credentials;
   - returned port/mapping equals lease.
9. Return URL verbatim without persistence/logging.
10. On failure, independently attempt `unexposePort` and exact-process kill.
    Successful `unexposePort` resolution is the revocation acknowledgement; do
    not infer durable revocation from `getExposedPorts`, which omits inactive
    authorizations. Confirm only process absence by reread. If unexpose rejects
    or process cleanup is unconfirmed, return `cleanup_failed` and retain lease.
11. Release the D1 lifecycle lease in `finally`.

#### Serialized Stop cleanup primitive

Under the same external D1 lease:

1. Reload exact owned active session; no port lease is successful no-op.
2. Attempt `unexposePort(port)` and exact process-tree kill independently with
   `Promise.allSettled`.
3. Require `unexposePort` to resolve and confirm exact process is absent/terminal.
   `getExposedPorts(host)` may aid reconciliation but an empty result is not
   revocation proof. Never use `killAllProcesses`.
4. Only after both conditions, set `previewPort=NULL` with exact owner+active
   predicates. Return stopped.
5. If unexpose rejects or process remains, return `cleanup_failed`, keep the
   lease, and never claim stopped. Regression-test empty active exposure list +
   rejected unexpose → no lease clear/archive.

#### Service tests

Cover authorization/no-sandbox paths, canonical repair lock release, DB collision
and same-session convergence, capacity, host selection/rejection (including
`http://localhost:5173` retaining `localhost:5173`), package validation, Vite
version gate, fixed commands/env, unrelated listener,
readiness/running checks, exact exposure reuse, runtime replacement, URL
validation, no project env/log/raw error projection, independent cleanup,
lease-clear ordering, lock release, and no backup/decryption calls.

Use barrier-controlled tests for concurrent Start/Start and Start/cleanup.

Verify:

```bash
pnpm --filter @ditto/web exec vitest run \
  src/lib/session-preview.test.ts src/lib/workspace-policy.test.ts
pnpm typecheck
```

### Step 4 — Add tRPC, atomic archive cleanup, and deletion fence

1. Add protected `sessionPreview.start`/`stop`; pass exact IDs and request URL
   into the domain service. Map typed reasons to NOT_FOUND,
   PRECONDITION_FAILED, BAD_GATEWAY, or INTERNAL_SERVER_ERROR without raw errors.
2. Register the router and add focused ownership/error/result tests.
3. Replace `workspace.deleteSession`'s separate archive with one domain operation
   that acquires the external D1 lifecycle lease, reloads active ownership, runs
   cleanup, requires successful unexpose acknowledgement and process death, then
   archives before releasing the lease. Cleanup failure leaves the session
   active. No port means archive directly under the lease.
4. Fence `projects.deleteProject` with the same external D1 lease, acquired
   before Sandbox access. Under it, reload ownership and atomically set the
   durable tombstone `status=failed, deletingAt=unixepoch()` with the lease owner
   predicate. Tighten `retryRestore` to require `status=failed AND deletingAt IS
   NULL`, so it cannot revive a deleting row. Call whole-sandbox
   `destroySandbox` as the **final Sandbox RPC**, then delete the exact
   `id+userId+deletingAt IS NOT NULL+leaseToken` row in D1. Do not release an
   in-sandbox lock after destroy. If destroy fails, release only the D1 lease and
   retain the tombstone for safe delete retry; never set ready.
5. Add deterministic barrier races:
   - Start paused on the D1 lease vs archive → archive wins, Start later sees
     inactive and performs no Sandbox call;
   - Start paused vs project delete → delete holds lease, tombstones, destroys,
     and Start later sees missing/deleting without recreating a sandbox;
   - retryRestore on non-null `deletingAt` → rejected with no Sandbox call;
   - Stop/archive cleanup failure, including empty active list + rejected
     unexpose → no lease clear/archive;
   - project destroy is final Sandbox call and foreign/already archived paths
     touch no runtime.

Verify:

```bash
pnpm --filter @ditto/web exec vitest run \
  src/integrations/trpc/routers/session-preview.test.ts \
  src/integrations/trpc/routers/workspace.test.ts \
  src/integrations/trpc/routers/projects.test.ts
pnpm typecheck
```

### Step 5 — Update architecture and security docs

In the backend commit, update:

- `overview.md`: preview lifecycle and exposed-port request flow.
- `server-and-data.md`: lease schema, tRPC, proxy-first routing, cleanup.
- `agent-harness.md`: exact worktree process, D1 lifecycle lease, no backup/env.
- `security.md`: public capability URLs, `*.ayn.wtf`, no project env/log
  projection, exact kill/unexpose, and archive/delete races.

Include the one-time wildcard DNS record and Alchemy-managed route. Do not claim
preview URLs are authenticated.

### Step 6 — Add the cherry-pickable Preview UI surface

This commit requires the backend commit but contains no backend/schema/package/
infrastructure change. Touch the five UI files plus `frontend.md` and
`repository-map.md` listed in Scope.

1. Add controlled Preview toggle immediately right of Git actions in `Chat`.
   Render it even if Git actions are unavailable and disable it only when no
   active session exists.
2. Toggle is a real button with tooltip and `aria-pressed`; icon+text at desktop,
   accessible icon at narrow width. Terminal/Code render as disabled non-actions.
3. Desktop pane is a bounded sibling (about 42%, sensible min/max) and chat keeps
   `min-w-0`. Mobile uses existing Sheet; no fixed overlay.
4. Pane states:
   - idle: Start plus `Preview links are public to anyone with the URL until you stop them.`
   - starting/stopping: disabled action and `role="status"`;
   - failed: inline `role="alert"`, Retry;
   - ready: iframe, Restart, Stop.
5. Restart discards the current component URL, calls idempotent Start, and
   replaces it. Stop discards URL only after success.
6. On session ID change, stale state renders idle without a prop-sync Effect.
   Closing only hides the pane.
7. Apply exact iframe policy from Target contracts. No URL text, copy action,
   toast, query cache, storage, or analytics.
8. Follow baseline UI/accessibility rules: visible focus, 44px touch targets,
   no `transition-all`, no gratuitous animation.
9. Update `frontend.md` for component-local state/responsive composition and
   `repository-map.md` for the final UI/test files. Do not modify backend docs.

Tests cover toggle placement/independence, disabled labels, start exact IDs,
public warning, iframe attributes, retry/restart, Stop, stale-session suppression,
close-without-stop, desktop/mobile behavior, and keyboard labels.

Verify:

```bash
pnpm --filter @ditto/web exec vitest run \
  src/components/ai-chat.test.tsx \
  src/components/chat-navbar.test.tsx \
  src/components/session-preview-pane.test.tsx
pnpm doctor
pnpm check
pnpm typecheck
```

React Doctor must report no new diagnostics in touched UI files.

### Step 7 — Full verification and live matrix

Automated gates:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm verify
pnpm --filter @ditto/web exec vitest run \
  src/server.test.ts \
  src/db/session-preview-migration.test.ts \
  src/lib/session-preview.test.ts \
  src/integrations/trpc/routers/session-preview.test.ts \
  src/integrations/trpc/routers/workspace.test.ts \
  src/integrations/trpc/routers/projects.test.ts \
  src/components/chat-navbar.test.tsx \
  src/components/session-preview-pane.test.tsx
pnpm doctor
docker build -t ditto-sandbox-preview .
git diff --check
git status --short
```

Mandatory local smoke (Docker running):

1. Run normal Alchemy local development; verify no Cloudflare DNS/Route mutation.
2. Use a disposable root Vite >=6.1 fixture with exact `dev: vite` and local
   dependencies in an imported project/session worktree.
3. Start Preview; URL must be localhost, iframe loads, asset and HMR WebSocket
   requests pass through `proxyToSandbox`.
4. Restart is idempotent. Stop makes URL unavailable and clears lease. Start
   again succeeds. A second session gets a different concurrent port.
5. Archive while live; URL becomes unavailable before session disappears.

Mandatory production smoke (disposable repository/account data only):

1. Dashboard verifies proxied wildcard A `*.ayn.wtf → 192.0.2.0` and Worker Route
   `*.ayn.wtf/*` to deployed Ditto Worker.
2. Start Vite preview from `https://ayn.wtf`; returned URL is HTTPS direct child
   of `.ayn.wtf`, loads iframe/assets/HMR, and unknown wildcard host returns 404.
3. Stop; old URL no longer serves. Restart returns a valid current URL.
4. Start two sessions; Stop/archive one and prove the other remains live.
5. Delete a project with a normal live preview; old URL becomes unavailable and
   no sandbox is recreated. The precise deletion race is covered by the
   injected-barrier automated test, not staged manually in production.

The Vite local and production Start/load/Stop smokes are mandatory. If
credentials, Docker, wildcard DNS/certificate, or a disposable repo are
unavailable, mark Plan 027 BLOCKED rather than DONE. A Next smoke is recommended
but may be NOT RUN with reason.

## Git workflow

```bash
git status --short
git add \
  apps/web/package.json pnpm-lock.yaml Dockerfile alchemy.run.ts \
  apps/web/src/server.ts apps/web/src/server.test.ts \
  apps/web/types/env.d.ts \
  apps/web/src/db/schema.ts apps/web/src/db/session-preview-migration.test.ts \
  apps/web/migrations \
  apps/web/src/lib/workspace-policy.ts apps/web/src/lib/workspace-policy.test.ts \
  apps/web/src/lib/agent-run-service.test.ts \
  apps/web/src/lib/project-sandbox.test.ts \
  apps/web/src/lib/session-preview.ts apps/web/src/lib/session-preview.test.ts \
  apps/web/src/integrations/trpc/router.ts \
  apps/web/src/integrations/trpc/routers/session-preview.ts \
  apps/web/src/integrations/trpc/routers/session-preview.test.ts \
  apps/web/src/integrations/trpc/routers/workspace.ts \
  apps/web/src/integrations/trpc/routers/workspace.test.ts \
  apps/web/src/integrations/trpc/routers/projects.ts \
  apps/web/src/integrations/trpc/routers/projects.test.ts \
  docs/architecture/overview.md \
  docs/architecture/server-and-data.md \
  docs/architecture/agent-harness.md \
  docs/architecture/security.md
git diff --cached --name-only
git commit -m "feat(preview): add session preview backend"

git add \
  apps/web/src/components/ai-chat.tsx \
  apps/web/src/components/chat-navbar.tsx \
  apps/web/src/components/chat-navbar.test.tsx \
  apps/web/src/components/session-preview-pane.tsx \
  apps/web/src/components/session-preview-pane.test.tsx \
  docs/architecture/frontend.md \
  docs/architecture/repository-map.md
git diff --cached --name-only
git commit -m "feat(preview): add session preview pane"
```

The backend commit is standalone. The seven-file UI-surface commit requires the
backend and contains no backend/schema/package/infrastructure change. Plans are
operator artifacts and are not folded into either implementation commit. Final
source working tree must be clean.

## Done criteria

- [ ] App/container both pin Sandbox 0.12.3; Docker exposes 10000..10031.
- [ ] Proxied wildcard DNS exists; Alchemy manages/adopts `*.ayn.wtf/*`.
- [ ] `proxyToSandbox()` runs before app routing; unknown wildcard hosts are 404.
- [ ] Real SQLite migration proves project lease fields and nullable
      project+port uniqueness.
- [ ] Start acquires the external D1 lease, rechecks ready/active ownership, and
      uses the exact session worktree/process ID.
- [ ] Only fixed supported binaries run; Vite <6.1.0 and arbitrary scripts fail
      closed.
- [ ] No configured project env, process logs, raw SDK errors, or capability URLs
      are persisted/logged/projected.
- [ ] D1 allocation converges under concurrency and capacity is explicit.
- [ ] Readiness precedes exposure; URL validation differs safely for local/prod.
- [ ] Stop/archive confirm unexpose+process death before lease clear/archive.
- [ ] Project deletion fences Start before whole-sandbox destruction.
- [ ] Barrier races prove no Start can recreate after archive/delete.
- [ ] Accessible responsive Preview pane ships; Terminal/Code remain disabled.
- [ ] Backend is standalone; the seven-file UI-surface commit cherry-picks
      cleanly on top and contains no backend change.
- [ ] Automated gates, Docker build, mandatory local smoke, and mandatory
      production `*.ayn.wtf` smoke pass.
- [ ] Docs and `plans/README.md` describe shipped behavior/status.

## STOP conditions

Stop and report if:

1. Current-state anchors drift or preview behavior already exists on HEAD.
2. Sandbox app/container 0.12.3 compatibility or Docker build fails.
3. `ayn.wtf` is not an active Cloudflare zone, wildcard DNS cannot be proxied,
   Worker Route cannot be created/adopted, or Universal SSL does not cover the
   generated direct subdomains.
4. The product requires authenticated preview asset requests. Exposed-port URLs
   are public; Cloudflare Access/Worker-auth proxying is a separate design.
5. The product requires stable/bookmarkable URLs or project secrets in public
   dev servers.
6. Root projects need unsupported frameworks/wrappers/monorepo selection or
   source/config rewriting.
7. Vite cannot meet the >=6.1 exact owned-domain host contract.
8. D1 cannot enforce the unique lease index or migration has unrelated drift.
9. `proxyToSandbox` breaks normal app/TanStack/WebSocket routing.
10. Cleanup cannot prove port unexposed and exact process absent.
11. Start/archive/project-delete race tests cannot be made deterministic.
12. Correctness appears to require global keepAlive, lifetime writer locks,
    backup, agent pause, or project env decryption.
13. Any capability URL, process log, raw SDK error, or configured project value
    appears in logs, D1, browser persistence, toast, snapshot, or client error.
14. A verification fails twice after one reasonable correction, implementation
    needs an out-of-scope file, or the final UI commit contains non-UI changes.

## Maintenance notes

- Wildcard `*.ayn.wtf` is dedicated to preview routing. Add explicit DNS/Worker
  routes for future named subdomains; Cloudflare uses the most specific match.
- Thirty-two ports means thirty-two concurrent previews per project, not thirty-
  two lifetime sessions: confirmed Stop/archive clears leases.
- Containers sleep on the default lifecycle; Start reconciles process/exposure
  after wake. Do not add global keepAlive without measured need/cost.
- Add a framework only with a fixed binary adapter, forced-port/version/host
  behavior, readiness test, and disposable live fixture.
- If CSP is added, allow only direct `https://*.ayn.wtf` frames and keep the
  iframe sandbox restrictive.
- Terminal and Code need separate authenticated process/file protocols and
  security plans.

## Sources

- Cloudflare Sandbox expose services:
  https://developers.cloudflare.com/sandbox/guides/expose-services/
- Cloudflare Sandbox production deployment:
  https://developers.cloudflare.com/sandbox/guides/production-deployment/
- Cloudflare Workers routes:
  https://developers.cloudflare.com/workers/configuration/routing/routes/
- Cloudflare wildcard DNS:
  https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/
- Vite server host options:
  https://vite.dev/config/server-options#server-allowedhosts
