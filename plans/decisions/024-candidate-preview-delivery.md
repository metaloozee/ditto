# Decision: how candidate sessions deliver a preview URL

Status: decided 2026-10-29. Spike for plan 024, prepared against `f554a6b` (includes plan 030, `6da40da`..`a86837c`). The maintainer answered the open questions; where they deferred to the reviewer, the reviewer's recommendation is recorded below as the decision. No source, test, config or migration changed.
SDK evidence: `@cloudflare/sandbox` 0.12.3 (`/home/ayan/ditto/apps/web/node_modules/@cloudflare/sandbox/dist/`, `index.js` and `sandbox-DI6suZAc.js`) and `@cloudflare/containers` 0.3.7 (`dist/lib/container.js`). Nothing was run against hosted infrastructure. Claims that need a running container or Cloudflare are marked "hosted-only" or "unverified".

## Recommendation in one paragraph

The runtime session DO owns preview state and mints the URL, by calling the SDK's `exposePort` on its own dedicated execution sandbox as the last step of `previewStart`. The sandbox is named `c-<workspaceSessionId>` so its preview hosts are distinguishable from legacy hosts on the same `ayn.wtf` zone. The runtime keeps the SDK's default random token and stores only its SHA-256 digest, bound to the preview generation. `previewStop` revokes first with `unexposePort`, then terminates. The product Worker matches candidate preview hosts before the legacy proxy and forwards them over a private service binding to a narrow runtime entrypoint. That entrypoint asks the session DO whether the token's digest matches the running generation, then calls the SDK's `proxyToSandbox` with `{ Sandbox: env.CandidateSandbox }`. The URL travels in the `preview_running` action result and is never stored, logged or observed. Local `*.localhost` hosts come first; hosted delivery waits for deployment work.

## Maintainer decisions (2026-10-29)

1. **Zone.** Production uses the existing `ayn.wtf` zone; no other domain exists. Priority is local first (`*.localhost`); hosted deployment is not planned yet. Because legacy and candidate previews share the zone and port 10000 (`apps/web/src/lib/workspace-policy.ts:6`), and legacy sandbox IDs are also lowercase UUIDs (`apps/web/src/lib/workspace-runtime.ts:409`, `project-seed.ts:256`), the discriminator is a sandbox-name prefix: the candidate sandbox is named `c-<workspaceSessionId>`. Hosts look like `10000-c-<uuid>-<token>.ayn.wtf`: one label, so the existing `*.ayn.wtf` route (`alchemy.run.ts:214`) and a one-level wildcard certificate cover it. Label length is 5+1+2+36+1+16 = 61, inside the 63-character limit, so the prefix cannot grow past two characters.
2. **Session ID format (verified).** New candidate session IDs come only from `crypto.randomUUID()`: `session-command-candidate.ts:254` (default `createId`) used at `:426` when no `sessionId` is supplied, and `candidate-lifecycle.ts:56` used at `:134`. A supplied `sessionId` must already be an owned session (`session-command-candidate.ts:361-362`), so a client cannot introduce a new format. `crypto.randomUUID()` returns 36 lowercase hex-and-hyphen characters. So `c-<id>` is lowercase, at most 38 characters, and survives `proxyToSandbox`'s `normalizeId: true` (`index.js:19`) unchanged. Gap: the runtime today names the sandbox `scope.workspaceSessionId` (`pi-durable-execution-session.ts:116`), while the product records `sandbox_identities.sandboxId = identityId`, a different UUID (`session-command-candidate.ts:470-471`). The build plan renames the runtime's `getSandbox` name to `c-<workspaceSessionId>` and must STOP if anything depends on either current name.
3. **Project deletion (reviewer recommendation, adopted).** No per-request D1 read. `purgeDeleted` (`apps/runtime/src/pi-durable-product-session.ts:478-486`) becomes the revocation point: after the deletion check it calls `unexposePort(10000)` on the candidate sandbox (storage-only, does not wake the container) before `deleteAll()`. `deleteAll()` also removes the preview grant and the retained scope, so `previewAdmit` denies afterwards. The deletion flow must reach `purgeDeleted` before it reports done, which matches spec line 725 (previews revoked first).
4. **Cold session DO (reviewer recommendation, adopted).** A preview request never activates a session. `previewAdmit` answers only from a live in-memory host; when the DO has no open host (evicted, purged, never opened) it returns false without opening one, without starting Pi and without calling the product. The preview pane then shows the preview as stopped and the owner's authenticated `preview_start` reopens the session through the normal path. This keeps unauthenticated traffic from waking runtime state. Cost: after the DO is evicted between visits, the preview needs a restart (the container's own sleep has the same effect today, `validatePreviewURLForRuntime` returns `stale`).
5. **Service-binding hop (reviewer recommendation, adopted).** Accepted. Spec line 152 forbids an arbitrary public proxy to privileged runtime methods and a public runtime preview origin. `previewFetch` is neither: it is the only method on its entrypoint, takes only the incoming `Request`, accepts only the candidate host shape on port 10000, needs a valid bearer, never reaches `exec`, files, commands or scope, and the runtime Worker still has no public route. The public origin stays the product Worker on `ayn.wtf`.
6. **Preview command** (amended below). In the image CLI, as recommended: `ditto-workspace preview start|stop`, matching "executor discovers the fixed command" (`pi-durable-workspace.ts:44`).
7. **Token entropy (reviewer recommendation, adopted; amended below).** Keep the SDK's default token and store its digest, instead of a custom generation-bearing token. The SDK default is 12 random bytes, base64 with `+` and `/` folded to `_`, padding removed, lowercased (`sandbox-DI6suZAc.js:9379-9382`): about 82.5 bits (letters 2/64 each, digits 1/64, `_` 2/64, about 5.16 bits per character × 16). The earlier custom encoding left about 57 bits, below the common 64-bit floor for session identifiers. The earlier draft's figure of about 96 bits for the default ignored the case folding.

## Amendments from plan review (2026-10-29)

Three cold reviews of build plans 031–033 found details that change this decision. The plans implement the amended version, and it supersedes the text above wherever they differ.

- **A1. CLI shape.** The commands are `ditto-workspace preview command` and `preview ready`, not `start|stop`. A command run through `sandbox.exec` must exit before it returns, so it cannot keep a dev server running. The runtime therefore starts, kills and inspects the process through the SDK (`startProcess` with `autoCleanup: true`, `killProcess`, `getProcess`). The CLI only discovers the command and waits for TCP readiness on port 10000.
- **A2. Token per start.** The runtime passes its own fresh 16-character `[a-z0-9]` token to `exposePort` on every start: about 82.7 bits, the same as the SDK default, and not generation-bearing. Without this, the SDK reuses a surviving token for the same port (`sandbox-DI6suZAc.js:9080`), so rotation would depend on `unexposePort` succeeding at start. Only the digest is stored, as before.
- **A3. Digest inside the step.** The digest is computed inside the `preview_start` step's `run`. The `running` flip and the grant write share one `transactionSync`, because `step()` settles the ledger before it returns.
- **A4. Stop evidence is polled.** `killProcess` only sends a signal, so stop polls `getProcess` for up to 10 s before reporting `terminated`.
- **A5. Deletion order.** `purgeDeleted` revokes after the host has closed and before `deleteAll`. Revoking earlier would let a live host's backup alarm re-expose the port.
- **A6. Web.** The client parser `runWorkspaceAction` validates the URL. The pane stops and starts once on `preview_url_unavailable`. Denials reuse `describeWorkspaceDenial`. The local Vite preview-host regex is widened to allow a trailing `_`.

## Current state (evidence)

- `WorkspaceExecution.previewStart` returns `void`, `previewStop` returns `{ terminated }` (`apps/runtime/src/pi-durable-workspace.ts:45-50`). Only the test fixture implements them (`apps/runtime/src/pi-durable-checkpoint.fixture.ts:285-290`).
- `sandboxWorkspaceExecution` throws `ArtifactStepRejected("authority_denied", "Preview is not composed for this session", true)` for both (`apps/runtime/src/pi-durable-execution.ts:106-111,159-164`). The `ExecutionSandbox` type has only `exec`, `readFile`, `writeFile`, `setOutboundHandler` (`:25-43`).
- Plan 030 is done. `PiDurableExecutionSession.sessionBranch()` returns `this.source?.branch` (`apps/runtime/src/pi-durable-execution-session.ts:70-72`), loaded by `loadExecutionSource` from `readCandidateBaselineSource` when `CandidateSandbox` and `CANDIDATE_RECOVERY` are bound (`:73-89`). `open()` calls it before `prepareExecution` (`apps/runtime/src/pi-durable-product-session.ts:265-266`), so `composeCandidateExecution(...).workspace(port)` now returns a controller (`execution.ts:221-234`) once a source is read.
- `startPreview` sets `state = 'running'` and `generation + 1` only after the `preview_start` step succeeds (`pi-durable-workspace.ts:349-352`). `stopPreview` sets `state = 'stopped'`, `generation + 1` only on termination evidence, else `unknown` (`:379-392`). `previewAuthority(value)` checks running and same generation (`:444-447`) and is surfaced on the host, false when the host is sealed, denied, barriered or not `open` (`apps/runtime/src/pi-durable-host.ts:7165-7171`). `previewTraffic()` records last traffic (`:7173-7175`). Nothing in the product calls either yet.
- `workspace_preview` is runtime DO SQLite created with `CREATE TABLE IF NOT EXISTS` (`pi-durable-workspace.ts:92-93`), not D1.
- The `ditto-workspace` CLI in the image has only `status` and `commit` (`packages/sandbox-runner/src/workspace-cli.ts:32,37`). The image does `EXPOSE 10000` (`Dockerfile:37`) and links the CLI at `Dockerfile:32`. The legacy command is hard-coded in the web app (`apps/web/src/lib/session-preview.ts:424`).
- `alchemy.run.ts` binds only `PiDurableLocalSandbox` for the L0 fixture (`:57-74`). No `CandidateSandbox`, `CANDIDATE_RECOVERY` or `PiDurableExecutionSession` binding exists outside `apps/runtime/src`.
- Legacy preview: `sandbox.exposePort(port, { hostname })` on the shared project sandbox (`session-preview.ts:815-893`). The product Worker calls `proxyToSandbox(request, env)` before app routing (`apps/web/src/server.ts:149-153`), then 404s unmatched production preview hosts (`:155-157`, `isProductionPreviewHost` at `:84`, zone suffix `.ayn.wtf` at `:72`).

## The six answers

### 1. Who mints the URL

The runtime session DO, through the execution sandbox's own `exposePort`.

- `exposePort` is a method on the sandbox DO stub, and the session DO already holds that stub (`getSandbox(CandidateSandbox, ...)`, `execution-session.ts:116-118`; renamed to `c-<workspaceSessionId>` by decision 2). The product Worker has no such binding and does not get one.
- The SDK generates the token, stores it in the sandbox DO's storage, and returns `https://<port>-<sandboxId>-<token>.<hostname>` (`sandbox-DI6suZAc.js:9058-9105`, `generatePortToken` at `:9379`, `constructPreviewUrl` at `:9384`). `hostname` is only a string; the runtime needs `ayn.wtf` (or `localhost:<port>` locally) as configuration but never serves it, keeping spec line 152.
- `exposePort` rejects `*.workers.dev` hostnames (`:9065`) and, without `normalizeId`, uppercase sandbox IDs (`:9388`). Decision 2 shows candidate names are lowercase.

### 2. Routing to the dedicated execution sandbox

`proxyToSandbox` reads only `env.Sandbox` (`index.js:13-19`). In the product Worker that is the legacy namespace (`alchemy.run.ts:121-147`). It can target the candidate namespace by passing `{ Sandbox: env.CandidateSandbox }`; the type is `SandboxEnv<T extends Sandbox>` (`index.d.ts:237-240`). It parses `<port>-<sandboxId>-<token>` (`index.js:32-60`); the preview-proxy header constants are not exported, so calling `proxyToSandbox` itself is the supported path.

Route:

1. Product Worker `fetch` gets a candidate branch **before** the legacy `proxyToSandbox` (`server.ts:149`). Order matters: the legacy proxy would resolve any parsable host against `env.Sandbox` and return a response, so it must never see candidate hosts. The branch matches `^10000-c-<uuid>-<token>\.ayn\.wtf$` in production and `^10000-c-<uuid>-<token>\.localhost$` locally (token `[a-z0-9_]{1,16}`). Anything else falls through unchanged.
2. The branch forwards the request over a private service binding to the runtime Worker's `previewFetch(request)`.
3. `previewFetch` re-validates the host, derives `workspaceSessionId` by stripping `c-`, resolves the DO by `CandidateSessions.idFromName(workspaceSessionId)` (`pi-durable-product-session.ts:190-199,243-248`), computes `SHA-256(token)` and calls `previewAdmit(digest)`. The raw token never enters the session DO.
4. If admitted, `previewFetch` returns `proxyToSandbox(request, { Sandbox: env.CandidateSandbox })`. The sandbox DO checks the token itself (`validatePreviewURLForRuntime`, `sandbox-DI6suZAc.js:9284`, `proxyPreviewRequest` at `:8248-8270`) and forwards to `container.getTcpPort(port)` (`:8191-8205`). Otherwise it returns 404 with no detail.

Hosted-only: streaming bodies and the WebSocket upgrade used by HMR across the service-binding hop. The SDK supports WebSocket upgrade (`sandbox-DI6suZAc.js:8253-8265`); the extra hop is unproven.

### 3. Bearer and revocation

The bearer is the SDK token in the hostname, stored in the sandbox DO (`PORT_TOKENS_STORAGE_KEY`, `:9080-9091`) and checked there on every request. The runtime session DO stores a grant: a new runtime-DO SQLite table `workspace_preview_grant (id INTEGER PRIMARY KEY CHECK (id = 1), generation INTEGER NOT NULL, digest TEXT NOT NULL)`, created with `CREATE TABLE IF NOT EXISTS` next to `workspace_preview` (a new table, so existing local DOs need no `ALTER`). A SHA-256 digest of an 82-bit random token is not usable as a bearer, so this does not store the capability (spec §14).

Two gates, both must pass:

- Runtime gate, `previewAdmit(digest)`: the host is live in memory (decision 4) and `previewAuthority(grant.generation)` is true (running, same generation, host unsealed, undenied, unbarriered, `open`; `host.ts:7166-7171`, `workspace.ts:444-447`) and `digest` equals `grant.digest` (constant-time compare). On success it records `previewTraffic()`.
- Sandbox gate: the SDK token. `unexposePort(port)` deletes token and activation in one storage transaction without waking the container (`sandbox-DI6suZAc.js:9122-9150`). It is idempotent.

Generation tie-in. `exposePort` reuses an existing token for the same port (`:9080`, `existingEntry?.token`), so:

- `previewStart`: `unexposePort(10000)`, start the process, then `exposePort(10000, { hostname })` last; return `{ url }`. The controller extracts the token (last `-`-separated segment of the first host label), and in the same `sql.exec` batch that flips `workspace_preview` to `running` at `generation + 1` (`workspace.ts:349-352`) it writes the grant `(new generation, SHA-256(token))`.
- `previewStop`: `unexposePort(10000)` first, then terminate. If revocation fails, throw retryable before touching the process. The `stopped` flip (`:383-386`) deletes the grant in the same batch. An `unknown` result also deletes the grant.
- Generation enforcement does not depend on `unexposePort`. Each start writes a new digest, and the gate compares the stored generation with the running one. An older token that survives in sandbox storage has a digest that no longer matches, so it is denied.
- Crash between `exposePort` and the SQL flip: no grant row, so the gate denies; the unresolved step blocks the workspace on recovery, and the next start unexposes first.

Stop paths, all funnelled through `stopPreview` or the gate:

- User stop and restore: `stopPreview("user" | "restore")` (`workspace.ts:359-395`, restore at `:460-463`).
- Backup-deadline stop: `stopPreview("backup")`, `stopped_for_backup = 1` (`:385`).
- Archive: requires stopped preview with termination evidence (`:466-490`); the host gate also fails when admission is `archived` (`host.ts:7168`).
- Project deletion: decision 3 (`purgeDeleted` unexposes, then deletes all storage including the grant).

### 4. Contract change

`{ status: "preview_running"; generation: number; url: string }` in `WorkspaceActionResultV1` (`packages/runtime-contracts/src/workspace-action.ts:75`). Nothing else changes.

- `WorkspaceExecution.previewStart` returns `{ url: string }`. `startPreview` copies it into the result (`workspace.ts:352`). The step ledger records only a settled status (`workspace.ts:178-222`); the URL is not written anywhere.
- The idempotent paths return `preview_running` without a step (`:283-285,337-339`). Add a read-only `WorkspaceExecution.previewUrl(): Promise<string | undefined>` using `sandbox.getExposedPorts(hostname)` (`sandbox-DI6suZAc.js:9158-9166`), so a reload or second tab gets the same URL without rotating the token. If its token's digest does not match the grant, return no URL and treat the preview as stopped.
- Parsers: the runtime and the two web clients (`apps/web/src/lib/candidate-session-client.ts`, `apps/web/src/lib/session-runtime-client.ts`) accept `url` only as `https://10000-c-…ayn.wtf/` or `http://10000-c-….localhost[:port]/`.
- The result goes over RPC to the browser (`session-command-candidate.ts:1428-1450`) and is not part of observation, the command outbox or D1 history (spec lines 697, 941). No URL in `ArtifactStepRejected` or error messages.
- Rejected: a separate `preview_url` action kind (more union members, parsers and round trips for the same data).

### 5. Execution composition dependency

Yes, buildable and testable locally before any deployment binding exists.

- The harness composes `composeCandidateExecution` with a scripted `ExecutionSandbox` (`pi-durable-execution.test.ts:164-215`, scripted sandbox from `:60`, `branch: "b"` at `:212`). 030 makes the same composition reachable in the real session (`execution-session.ts:70-89`, `:133`; `execution.ts:222-223`).
- Code changes: add `exposePort`, `unexposePort`, `getExposedPorts` to `ExecutionSandbox` (`execution.ts:25-43`); implement `previewStart`/`previewStop`/`previewUrl` (`:159-164`); add `ditto-workspace preview start|stop` (`workspace-cli.ts:32-37`); rename the sandbox to `c-<workspaceSessionId>`; rewrite `rejects preview without running a preview command` (`pi-durable-execution.test.ts:523-539`).
- `exposePort` with `enableInternet = false` and `interceptHttps = true` (`execution-session.ts:31-34`): no source-level interaction. `exposePort` touches DO storage and calls `ensureDefaultSession()` inbound (`sandbox-DI6suZAc.js:9058-9105`, `:8317`); the two flags are read only by `ContainerProxy` for outbound traffic (`@cloudflare/containers/dist/lib/container.js:197-274`, defaults `:325-329`); preview is inbound via `getTcpPort` (`sandbox-DI6suZAc.js:8191-8205`). Unverified until a container run confirms it. `exposePort` may start a cold container.
- Deployment wiring (not planned yet, per decision 1): a `CandidateSandbox` DO namespace for `PiDurableCandidateSandbox` with its SQLite migration and the updated image; `CANDIDATE_RECOVERY` R2 and the `ContainerProxy` export; runtime config for the preview base host; a product-to-runtime service binding for `previewFetch`; the `PiDurableExecutionSession` export as `CandidateSessions`. DNS and route already exist (`alchemy.run.ts:214`).

### 6. Local versus hosted

Local first, per decision 1.

Provable without the stack (runtime workerd tests, web unit tests): call order for start and stop; grant written and removed in the same batch as the state flip; gate denies a stale digest, an older generation, a cold or purged DO, and after user stop, backup-deadline stop, archive, restore fence and sealed host (extend `pi-durable-workspace-actions.test.ts:183-229,493`, `pi-durable-lifecycle.test.ts:86-98`); storage dumps hold no token or URL; contract parsers; host matcher for `ayn.wtf` and `*.localhost`, ordering before the legacy proxy, fall-through for legacy hosts (the SDK builds `http://<port>-<id>-<token>.localhost:<port>/`, `sandbox-DI6suZAc.js:9390-9396`, as noted at `session-preview.ts:477`).

Needs a running container (local Docker or hosted): `exposePort` and a forwarded request on `PiDurableCandidateSandbox` with both egress flags; `proxyToSandbox` against a real `CandidateSandbox` namespace; WebSocket and HMR across the service binding; container sleep and wake making activation `stale`; the ten-minute backup-deadline stop in real time.

Hosted-only (plan 020): `ayn.wtf` delivery of candidate hosts through the existing route and certificate.

## Recommended design versus one alternative

Recommended: runtime mints with the SDK default token, runtime stores a generation-bound digest grant, product routes `c-` hosts first, narrow runtime `previewFetch` behind a service binding. Costs: one new private entrypoint and DO method, one DO-SQLite table, a sandbox rename, a SHA-256 per preview request, one extra hop per request, and a `previewUrl()` read.

Alternative: bind `CandidateSandbox` into the product Worker and call `proxyToSandbox` directly in `server.ts`. Shorter, no hop, but the public Worker would hold a binding able to `exec` in untrusted sandboxes (breaks spec line 152), and revocation on backup stop, archive and deletion would rest on `unexposePort` alone.

## Draft scope of the follow-up build plan

Files:

- `packages/runtime-contracts/src/workspace-action.ts` and tests: `url` on `preview_running`.
- `apps/runtime/src/pi-durable-workspace.ts`: `workspace_preview_grant` table; `previewStart` returns `{ url }`; grant written and cleared with the state flips; `previewUrl()`; both `preview_running` return sites carry the URL; a digest-checking authority method.
- `apps/runtime/src/pi-durable-execution.ts`: extend `ExecutionSandbox`; implement preview methods; remove the "not composed" denial.
- `apps/runtime/src/pi-durable-execution-session.ts`: sandbox name `c-<workspaceSessionId>`.
- `apps/runtime/src/pi-durable-product-session.ts`: `previewAdmit(digest)` (live host only); `purgeDeleted` unexposes before `deleteAll()`.
- `apps/runtime/src/server.ts`: `previewFetch` entrypoint.
- `apps/runtime/src/pi-durable-checkpoint.fixture.ts`: fixture `previewStart` returns a fixed fake URL.
- `packages/sandbox-runner/src/workspace-cli.ts` (+ test): `ditto-workspace preview start|stop`, readiness on port 10000, termination evidence. `npm test --prefix packages/sandbox-runner`.
- `apps/web/src/server.ts` plus a route helper in `apps/web/src/lib`: candidate host matcher ahead of the legacy proxy, forward; both web client parsers.
- Tests: `pi-durable-execution.test.ts` (rewrite `:523-539`), `pi-durable-workspace-actions.test.ts`, a product-session test for `previewAdmit` and `purgeDeleted`, a new web route test.

Contract: as in answer 4. No D1 schema or migration change. No observation change.

Tests (behavior that can break):

1. Second start returns a different URL; the first URL's digest is denied. With the stub keeping the old token alive (lost `unexposePort`), the old digest is still denied.
2. Stop revokes before terminating; revocation failure leaves the process untouched and the result not `preview_stopped`; the grant is gone after `stopped` and `unknown`.
3. `terminated: false` leaves `unknown` and blocks capture, as today.
4. Idempotent `preview_start` returns the same URL without a new token.
5. Gate is false after user stop, backup-deadline stop, archive, restore fence, sealed host, on a DO with no live host, and after `purgeDeleted`; `previewAdmit` never opens a host.
6. Crash between `exposePort` and the SQL flip: no grant, gate denies; next start unexposes first.
7. No raw token or URL in DO SQLite or key-value storage, journal rows, or error messages; only the digest.
8. Web: `10000-c-…` hosts route to the binding before the legacy proxy; legacy `10000-<uuid>-…` hosts and app routes unchanged; parsers reject other hosts.

STOP points for the build plan:

- Any need to give the product Worker a `CandidateSandbox` or other execution-capable binding.
- Any need to persist the raw URL or token anywhere.
- The SDK behaves differently from the source read here (for example `exposePort` fails with the egress flags, or `unexposePort` wakes the container).
- Anything depends on the runtime sandbox name being `workspaceSessionId`, or on `sandbox_identities.sandboxId` for candidate sessions.
- A deployment change is needed (alchemy, DNS, bindings): stop; deployment is not planned yet.
- Any edit to a generated migration.

## Open questions

None blocking the build plan. Deployment of candidate sessions (bindings, image, plan 020) is deliberately unplanned until local preview works.
