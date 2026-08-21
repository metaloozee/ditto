# Platform credential broker and workspace-session sandbox isolation

Status: approved design; local implementation ready; production validation deferred

Last implementation audit: 2026-08-20 at `57a29d5`

Background research:

- `docs/research/brain-architecture-research.md`
- `docs/research/sandbox-security-architecture-research.md`

## Scope

This spec removes Ditto-controlled credentials from untrusted Cloudflare
sandboxes. It also replaces the shared project sandbox with one sandbox per
workspace session.

This revision supports one model:
`opencode/deepseek-v4-flash-free`. Ditto supplies the OpenCode API key. Account
provider connections, bring-your-own-provider support, and model selection are
removed.

Everything inside a sandbox is untrusted. This boundary includes the PI
harness, the Ditto runner, the Ditto PI extension, repository files,
dependencies, build scripts, agent commands, and every sandbox process. The
Ditto Worker, D1, R2, and Cloudflare's sandbox boundary remain trusted.

User-owned project environment values remain available to the agent command.
Sandbox code can read and exfiltrate those values. The credential broker does
not make the sandbox secret-free and does not prevent all data exfiltration.

## Local implementation may proceed

Ditto does not have access to the Cloudflare paid plan needed for production
container tests. Local implementation and local integration tests are the
current acceptance gate.

This phase proceeds on the working assumption that behavior which passes
locally also works in Cloudflare production. That assumption remains unverified.
Before Ditto handles production user data, run the checks in
[Future production validation](#future-production-validation).

A failed local or future production check must not restore the current
credential-injection path.

The installed Sandbox SDK backup API is not acceptable for production use in
this design. It passes one-hour presigned R2 URLs to commands inside the
sandbox. The long-lived R2 credentials stay in the Worker, but each URL is a
bearer capability. This spec replaces that path with Worker-controlled RPC
streaming.

## Local platform contract results

Measured locally on 2026-08-20 against `@cloudflare/sandbox@0.12.3`. No stop
condition fired. Local implementation remains ready. Production validation is
still deferred.

### Environment

- SDK: `@cloudflare/sandbox@0.12.3`
- Base image: `docker.io/cloudflare/sandbox:0.12.3@sha256:23f67e16131b780865a5fa5aa3c8607408a730105c248836409f4e02bb6bf042`
- Local image tag: `docker.io/cloudflare-dev/sandbox:2409cf19`
- Node inside the image: `v22.23.1`
- Interception sidecar: `cloudflare/proxy-everything@sha256:0ef6716c52430096900b150d84a3302057d6cd2319dae7987128c85d0733e3c8`
- Dev command: `CI= ALCHEMY_CI_STATE_STORE_CHECK=false pnpm dev`
- Probe command, twice, each with a new sandbox ID:

```bash
curl -fsS -X POST http://127.0.0.1:5173/__ditto-platform-probe \
  -H "content-type: application/json" \
  -d "{\"run\":N,\"sandboxId\":\"pcb-runN-<uuid>\"}"
```

The diagnostic route was localhost-only and was removed after the spike.

### Runs

| Run | Sandbox ID | Durable Object / `ctx.containerId` | Wall time |
|---|---|---|---|
| 1 | `pcb-run1-5a328763-02bd-482f-a046-549709cf3e3e` | `453a9e391da7afe570e542a003b2a059a6ed76f8805596ee8579950c28fc30a4` | 6.68 s |
| 2 | `pcb-run2-ce03ee81-e21c-42b3-8f2d-47fb80c423d2` | `947439b2fd8a5177b77a9879335743b8865a1649259768de23516770a1a546c8` | 6.78 s |

Run 2 used a new sandbox ID and did not reuse run 1 filesystem, R2, or Durable
Object state. Both runs passed every item.

### Items

1. **Subclass catch-all — pass.** A Ditto-owned `Sandbox` subclass set
   `enableInternet = false` and registered a named catch-all through
   `Sandbox.outboundHandlers = { probeCatchAll }` plus
   `setOutboundHandler("probeCatchAll", params)`. A request to an unlisted host
   returned the catch-all deny body. A class-field `static outboundHandlers = …`
   does not populate the SDK registry and `setOutboundHandler` then fails. The
   setter assignment is required.
2. **HTTP and HTTPS interception — pass.** Exporting `ContainerProxy` from the
   Worker entrypoint made both intercept. Node `http.get("http://example.com/")`
   and `https.get("https://example.com/")` received handler bodies
   `http-intercept` and `https-intercept`. They did not reach the public origin.
3. **`ctx.containerId` stability — pass.** For one Durable Object,
   `ctx.containerId` equalled `env.Sandbox.idFromName(sandboxId).toString()` and
   stayed unchanged across two requests. The Worker-created sandbox ID is
   therefore related to the handler identity.
4. **Handler parameters — pass.** `setOutboundHandler()` params reached
   `ctx.params`. Query strings and request headers from the sandbox did not
   change those params. The sandbox cannot supply or replace them.
5. **Privileged reject does not bypass the catch-all — pass.** A public
   `example.com` request that failed the privileged classifier returned
   `privileged-rejected` from the catch-all. The same host without the
   privileged marker returned `http-intercept`. The rejected request did not
   fall through to the public origin.
6. **Node.js trusts the interception CA — pass.** After intercept setup, the CA
   file `/etc/cloudflare/certs/cloudflare-containers-ca.crt` was present.
   `NODE_EXTRA_CA_CERTS` was set. `NODE_TLS_REJECT_UNAUTHORIZED` was unset.
   Node `https.get` succeeded without disabling TLS verification and without a
   certificate error.
7. **RPC file streaming over 32 MiB — pass.** `writeFile(path, stream)` and
   `readFile(path, { encoding: "none" })` moved 41,943,040 bytes (40 MiB).
   Write used 640 chunks, max 65,536 bytes. Read used 10,240 chunks, max 4,096
   bytes. No full-file chunk appeared in Worker memory. Sandbox `wc -c` and
   `bytesWritten` both reported 41,943,040. Digest prefix `f500b87f2235`.
8. **Worker R2 streaming without sandbox R2 authority — pass.** The Worker put
   the read stream to the local `BACKUP_BUCKET` binding through
   `FixedLengthStream(size)` and wrote the object body back with `writeFile`.
   Round-trip digest and byte count matched. The sandbox process had no R2
   environment values and no copy of the object key. Local R2 required a known
   stream length; that is a length header, not full-file buffering.

## Current implementation

The application has one project sandbox per project. Workspace sessions use
separate Git worktrees inside the shared sandbox.

The Worker passes three credential classes into project-sandbox processes:

- `DITTO_PI_CREDENTIAL` for the selected model provider
- `DITTO_GIT_CALLBACK_TOKEN` for agent Git actions
- a GitHub installation token for a short-lived network Git launcher

The runner deletes provider values from its environment before PI creates
tools. The Git launcher uses a temporary bare repository, a closed environment,
disabled hooks, and disabled credential helpers. These controls reduce exposure
but do not protect credentials from a compromised sandbox.

Normal chat does not pass an explicit PI resource loader. PI uses default
project discovery and can load repository-owned code before the first model
request.

Project rows own sandbox identity, backup handles, and backup generations on
the legacy path. New workspace sessions own a dedicated sandbox identity and
runtime. Session recovery backups remain a later plan.

## Implementation audit

| Design area | Status | Evidence |
|---|---|---|
| Ditto-owned Sandbox subclass | Not implemented | `apps/web/src/server.ts` re-exports the stock `Sandbox` class. |
| Outbound credential dispatch | Not implemented | No outbound handler resolves a sandbox identity or replaces a placeholder credential. |
| OpenCode credential removal | Not implemented | `apps/web/src/lib/agent-run.ts` passes `DITTO_PI_CREDENTIAL` into the agent shell. |
| Token-free agent Git capability | Not implemented | Agent tools call `/api/agent/git` with a scoped HS256 JWT. |
| GitHub installation-token removal | Not implemented | `apps/web/src/lib/privileged-git.ts` passes the token to a sandbox process. |
| Token-free R2 recovery | Not implemented | Production backup and restore use the stock Sandbox SDK path. |
| Contract-based outbound policy | Not implemented | The stock project sandbox retains normal network access. |
| One sandbox per workspace session | Implemented for new sessions | `WorkspaceRuntime` provisions a `workspace_session` identity and sandbox. Legacy sessions may still share a project sandbox until plan 012. |
| Safe chat resource loader | Not implemented | `packages/sandbox-runner/src/run-agent.ts` omits `resourceLoader`. |
| Workspace-session backups | Not implemented | Backup fields and generation counters live on `projects`. |
| Capacity queue and lifecycle | Not implemented | Ditto has no persisted workspace-session sandbox state machine. |

## Controls to preserve

Keep these implemented controls during the redesign:

- bounded model metadata for the fixed fallback model
- workspace-session write locks for agent runs and mutating Git operations
- backup generation fencing
- bounded secret redaction for agent output and errors
- Git export checks for outgoing paths and added content
- a temporary bare repository and closed child environment for network Git
- an in-memory PI session, an empty resource loader, and one typed output tool
  for Git metadata

Account provider credential encryption, OAuth refresh coordination, provider
catalogs, and provider login runners are removed with account provider support.

## Required guarantees

The implementation must provide these guarantees:

1. The OpenCode API key never enters a project builder or workspace-session
   sandbox.
2. No Git callback bearer token enters a sandbox.
3. No GitHub installation token enters a sandbox.
4. No R2 key, signed URL, bearer token, nonce, object key, or mounted-bucket
   capability enters a sandbox.
5. Every privileged request resolves through a current, Worker-owned identity
   and operation record.
6. Unknown, retired, stale, or mismatched identities fail closed.
7. Unknown request contracts fail closed.
8. Each active workspace session has a separate filesystem, process table, and
   localhost namespace.
9. Normal chat disables repository-owned PI extensions, skills, prompts,
   themes, settings, and context-file discovery.
10. Outbound HTTP and HTTPS traffic follows either a privileged request contract
    or the credential-free internet policy.
11. Backup and restore remain reliable after sandbox ownership moves to the
    workspace session.
12. Existing Git, preview, message, and thinking-level behavior remains
    available unless this spec changes it.

The broker prevents credential extraction but cannot prevent every authorized
use. This phase has no request, token, or spending budget. Each request still
requires an open operation and exact contract validation.

## Product changes

### Fixed model

Ditto supports only `opencode/deepseek-v4-flash-free`. Remove the provider and
model picker. Keep the thinking-level control with the fixed values `off`,
`high`, and `max`.

The Worker and the runner validate the model and thinking level. No other model
specifier or credential source is valid.

### Account providers

Remove these features and their data:

- account provider settings
- API-key and OAuth connection flows
- encrypted account provider credentials
- provider model catalogs
- provider authentication routes and controls
- provider authentication runner commands
- provider-specific refresh and projection code
- provider-related deployment secrets that no remaining path uses

The pre-launch migration hard-deletes existing credential and catalog rows,
then removes their tables. Deployment ordering must prevent old code from
running against the removed schema.

### PI resources

Build the Ditto PI extension into the container image. Load it from an absolute,
code-owned path. The repository cannot configure, shadow, replace, or extend it.

Normal chat disables all repository resource discovery. The Git metadata runner
keeps its current empty resource loader and limited tool set.

## Sandbox identities

Ditto uses two identity kinds.

### Workspace-session identity

A `workspace_session` identity resolves these records:

- user
- project
- workspace session
- random sandbox ID
- Cloudflare container ID
- lifecycle generation
- current sandbox lifecycle state
- the open operation in each contract family, if one exists

Each workspace session receives a random lowercase UUID as its sandbox ID. The
ID does not encode a user, project, or workspace-session ID.

### Project-seed identity

A `project_seed` identity resolves a user, project, temporary builder sandbox,
lifecycle generation, and one provisioning operation. A builder can use only
the Git fetch contract for the repository that the project owns.

The builder receives no model access or project environment values. Ditto
destroys the builder after it stores the project seed.

### Retirement

Never reuse a sandbox ID. D1 retains a permanent tombstone after destruction.
Tombstoned identities fail closed even while asynchronous R2 cleanup remains
pending.

## Broker authority

D1 is the durable authority for sandbox identities and privileged operation
windows. An operation record contains:

- the identity kind and identity ID
- the lifecycle generation
- the operation type
- the request-contract version
- the repository and allowed refs when Git needs them
- the opening time
- the expiry time
- the closure status
- a Worker-generated correlation ID

The outbound handler checks current durable authority. The first implementation
does not cache open-operation authority. A cache may reduce repeated reads, but
a cache must not extend an operation past its D1 expiry or closure.

Increment the lifecycle generation before restore or replacement. Close all
open operations when the runtime becomes stale, the operation settles, the
workspace session is archived, or deletion starts.

The sandbox uses fixed, public placeholders. A placeholder carries no authority
without the trusted sandbox identity and an open operation record. Do not use a
per-run secret or nonce.

## Module design

Five modules own the brokered sandbox lifecycle. Routes and UI orchestrate
them.

### SandboxAuthority

`SandboxAuthority` owns identity registration, lifecycle generation, permanent
retirement, operation opening and closure, and request resolution. Callers never
receive raw authority rows.

Contract families are `model`, `git_transport`, and `ditto_action`.

An identity can have at most one open operation in each family. Different
families may overlap. This permits an agent run to request a Git action without
making operation selection ambiguous.

The handler chooses the sole open operation for the request's classified family.
The sandbox never supplies an operation ID.

`git_metadata` and other bounded operations reserve one request atomically in
D1 before forwarding. A failed upstream request does not restore the count.

The first implementation does not cache open-operation authority. A cache may
reduce repeated reads, but a cache must not extend an operation past its D1
expiry or closure.

### SandboxEgressBroker

`SandboxEgressBroker` exposes one handler interface for sandbox outbound
traffic. It dispatches to internal request-contract adapters and the public
internet policy.

### ProjectSeed

`ProjectSeed` builds and restores immutable project seeds. It depends on the
authority, Git-fetch contract, and archive transport inside its
implementation.

### WorkspaceRuntime

`WorkspaceRuntime` owns sandbox readiness, lifecycle leases, capacity work,
restore, retirement, and the trusted sandbox adapter returned to callers.

### WorkspaceRecovery

`WorkspaceRecovery` accepts only a runtime-issued exclusive workspace lease.
It owns checkpoint generations, R2 metadata, restore fallback, and cleanup.

## OpenCode request contract

The broker authorizes OpenCode requests only during a Worker-owned model
operation. This spec defines two operation types:

- `agent_run` for normal chat
- `git_metadata` for commit and pull-request metadata

The `git_metadata` operation permits one model request, uses the fixed model,
has no repository discovery or repository tools, and has a short deadline.

For every request, the broker validates:

- the current sandbox identity and lifecycle generation
- the current operation type and expiry
- the fixed authorization placeholder
- the HTTP method
- the host and port
- the path and query
- the content type and content encoding
- the streaming protocol
- a bounded request-body size
- the complete expected body schema
- the exact model `opencode/deepseek-v4-flash-free`
- the absence of user-supplied authorization and proxy headers
- the request-contract version

Reject duplicate fields, unknown fields that affect authority, malformed
encoding, and redirects. Construct a fresh upstream request from validated
fields. Do not mutate and forward the sandbox request.

The Worker adds `OPENCODE_API_KEY` only to the fresh upstream request. The key
remains in the Worker runtime. Stream the upstream response with bounded
headers. Do not buffer unbounded content.

Model requests remain unlimited while the model operation is open. Repeated
contract denials close the operation, fail the agent run, and mark the workspace
session for review.

If `OPENCODE_API_KEY` is missing or invalid, model operations fail before
sandbox side effects. Project import, recovery, preview, local Git inspection,
and model-free export operations remain available.

## Git contracts

### Ditto extension actions

The image-baked Ditto extension calls a synthetic internal origin. The outbound
handler resolves the trusted sandbox identity and invokes Worker-owned Git
services. No callback token enters the sandbox.

Keep the current exact tool schemas and authorization rules. Agent tools may
push the workspace-session branch and open a pull request. They cannot merge or
close a pull request.

### Network Git

The Worker opens a short Git operation for initial fetch, agent push, or export.
Bind the operation to:

- the sandbox identity and lifecycle generation
- the owned repository
- the Git operation
- the exact allowed refs
- a request-contract version
- an expiry

The broker inserts the GitHub installation token only into approved upstream
GitHub requests. Reject redirects.

Fetch may read only the owned repository. Push permits one serialized
receive-pack exchange. Parse and bound the smart-HTTP protocol. Reject ref
deletion, force updates, extra refs, malformed capabilities, and every target
except the exact workspace-session branch.

If the broker cannot validate receive-pack safely, disable push. Do not pass the
installation token to a sandbox process.

Pull-request creation stays in the Worker through Octokit. Preserve Git secret
preflight before push.

## Credential-free internet policy

General HTTP and HTTPS access remains available for package installation,
documentation, and user applications. This path never adds Ditto authority.

Permit public HTTP and HTTPS destinations on ports 80 and 443. Reject:

- the OpenCode placeholder outside the OpenCode contract
- Ditto protocol headers outside their contracts
- synthetic internal origins outside an authorized operation
- private, loopback, link-local, and metadata destinations
- literal IP destinations
- embedded URL credentials
- ambiguous host syntax and alternate numeric IP notation
- redirects that do not pass the same destination checks

A failed privileged contract must not fall through to general internet access.
Non-HTTP traffic stays disabled.

Cloudflare outbound handlers do not intercept DNS. This policy does not promise
total exfiltration prevention. User-owned project values may pass through the
general path.

## Process environments

The container entrypoint and sandbox-level environment contain no platform
credentials.

Inject user-owned project environment values only into the agent command that
needs them. Do not inject those values into:

- project-seed builders
- previews
- backup and restore commands
- Git launchers
- the container entrypoint

No process receives the OpenCode key, a GitHub installation token, an R2
capability, or an internal Ditto bearer token.

## Project seeds

A project owns an immutable seed backup but no persistent sandbox. Project
import uses a temporary builder sandbox to:

1. Fetch the owned repository through the Git broker.
2. Prepare the source tree.
3. Install dependencies when the dependency policy permits them.
4. Stream the seed archive to the Worker.
5. Destroy and retire the builder sandbox.

A project becomes ready when its seed metadata is durable.

Rebuild the seed in a new temporary builder when its compatibility key changes.
The key includes:

- the seed format version
- the repository identity and source commit
- dependency inputs
- the package-manager name and version
- the Node version and architecture
- the sandbox image revision
- the Ditto runner revision
- the dependency policy version

Never derive a project seed from a mutable workspace-session backup.

A new workspace session restores a compatible seed, fetches the latest remote
default branch, and freezes that commit as its base commit. Existing workspace
sessions never move their base commit automatically.

## Token-free backup transport

Do not use the stock production `createBackup()` or `restoreBackup()` path.
Do not use `localBucket: true` in production.

### Create a backup

The Worker controls backup creation:

1. Quiesce processes that can write the workspace.
2. Create a compressed archive at a fixed sandbox path.
3. Start an RPC file stream from the archive to the Worker.
4. Write the stream through the Worker R2 binding to a generation-specific
   object key.
5. Compute and record the byte count and digest.
6. Store the archive format, compatibility key, and generation in D1.
7. Promote the generation only with compare-and-set generation fencing.
8. Delete the temporary sandbox archive.

The sandbox never receives the R2 object key or any R2 authority.

### Restore a backup

The Worker controls restore:

1. Read the selected object through the Worker R2 binding.
2. Stream the object through RPC to a fixed temporary sandbox path.
3. Verify the byte count and digest.
4. Extract the complete archive into the workspace.
5. Verify workspace size, required Git state, and the baked runner.
6. Delete the temporary archive.

The first implementation extracts the archive. It does not reproduce the
Sandbox SDK's private SquashFS and FUSE overlay behavior.

Treat archive content as untrusted. Integrity checks prove which generation the
Worker stored. They do not make sandbox-created files trustworthy.

### Backup contents and limits

Use a `basic` container. Do not run an instance-sizing spike.

Enforce these initial deployment-configurable limits:

- 1 GiB maximum compressed archive
- 3 GiB maximum extracted workspace
- 70 percent maximum peak disk use when dependencies are included

These values are independent ceilings. Before archive creation or extraction,
reject the operation when the archive, workspace, container image, and temporary
files would exhaust the available disk.

Back up ordinary workspace files, including user-created `.env` files. Project
environment values remain separate and never enter workspace files.

Exclude only documented disposable content:

- dependency directories when the dependency policy excludes them
- package-manager caches
- build caches and derived output
- sockets and device files
- temporary backup archives

Reject an oversized import before the container exhausts its disk. Report the
measured size without exposing file content.

### Dependency policy

Include dependencies in project seeds and workspace-session backups only when
all of these conditions hold:

- the dependency compatibility fingerprint matches
- the compressed and extracted data fits the workspace limits
- each benchmark path completes at least ten local cold restores
- the benchmark set includes representative small, medium, and large
  repositories
- dependency-inclusive restore improves ready-to-run p95 by at least 30 percent
  over source-only restore followed by install
- no archive, extraction, permission, native-module, or peak-disk check fails

Use source-only recovery when any condition fails.

## Workspace-session recovery

Each workspace session owns its sandbox identity, mutable recovery backup,
backup generations, and recovery health.

Reserve a monotonically increasing mutation generation after each completed
agent run and each successful mutating Git operation. Create a recovery backup
after each mutation unless a live preview defers it. Also create a final backup
before archive.

Keep the current and previous successful recovery generations. Delete older
objects asynchronously after the new generation is promoted.

If the newest generation fails restore, try the previous generation. If both
fail, mark recovery failed and preserve both objects for diagnosis. Never
restore the project seed silently because that would discard workspace-session
work.

If an agent run succeeds but its backup fails, keep the assistant message
complete. Mark recovery degraded, retry the backup, and show the failure
separately. Later mutations may coalesce into the pending generation. Block
archive and sandbox destruction until the backup succeeds or the user deletes
the workspace session.

An archived workspace session keeps its final backup until the user deletes the
workspace session or project. To continue archived work, create a new workspace
session, sandbox ID, branch, and backup lineage from the final backup. The
original remains archived.

## Preview behavior

Keep one preview process and one stable capability URL per active workspace
session. Route the URL to the workspace session's sandbox ID. Revoke the URL on
archive or deletion.

A live preview defers backup creation. Do not stop a preview after every agent
turn.

While a preview defers a backup, the newest completed mutations exist only on
the live sandbox disk. Show a persistent backup-pending warning. If Cloudflare
replaces the runtime before the backup completes, restore the latest stored
generation and mark recovery failed. Do not report the unbacked generation as
durable.

When a mutation settles while a preview is live:

1. Reserve the mutation generation.
2. Mark the generation pending.
3. Start the maximum-deferral timer when the first unbacked generation appears.
4. Coalesce later mutations into the newest pending generation. Do not reset the
   timer.

After ten minutes, stop the preview, create the backup, and restart the preview
only if it received recent traffic. Show a workspace-saving state during the
interruption.

When the user stops a preview, stop the process first. If the latest mutation
generation already has a stored backup, finish the stop. Otherwise create the
backup. If the backup fails, keep the preview stopped, retain the pending
generation, and expose separate Retry Backup and Restart Preview actions.

Preview-created filesystem changes are disposable. Ditto does not promise
durability for preview caches, generated files, databases, or application-side
writes.

After a cold wake, the first preview request restores the workspace, restarts
the fixed preview command, and exposes the same capability URL. Show a restore
response until the preview becomes ready.

## Lifecycle and capacity

Workspace-session status remains `active` or `archived`. Sandbox lifecycle is a
separate persisted state:

```text
unprovisioned -> queued -> provisioning -> ready
                                  |          |
                                  v          v
                                failed <- restoring
                                  |          |
                                  v          v
                                queued     ready

ready -> destroying -> destroyed
```

D1 records desired and transitional state. Cloudflare runtime status is an
observation that can disagree with D1. A `ready` workspace session with a cold
runtime requires restore. Sleeping and stopped are not durable product states.

Every transition uses an expiring lease and compare-and-set guard. Retry a
transient provisioning or restore failure twice with bounded exponential
backoff. Do not retry identity, digest, or contract failures automatically.
After retries fail, persist a reason-coded failure and expose Retry.

Provision the sandbox on the first message. Atomically create:

- the workspace session
- the complete user message
- the pending assistant message
- the queue record when capacity is unavailable

Cancellation or terminal provisioning failure changes the assistant message to
`failed`. Worker restarts must not lose or duplicate queued work.

Set these initial deployment-configurable capacity limits:

- 20 running workspace-session sandboxes globally
- 2 running workspace-session sandboxes per user
- 15 minutes maximum queue time

Use a persisted first-in-first-out queue. Show queue position and allow
cancellation. A running capacity slot is an unexpired D1 lease held by a runtime
that the Worker most recently observed as active. A cold `ready` runtime owns no
slot until work requests a wake. Sleeping sandboxes do not consume a running
slot. On queue expiry, mark the assistant message failed with a retryable
capacity reason. Keep the workspace session and the user message.

Use a ten-minute idle timeout. A live preview with an unbacked generation keeps
the sandbox active until the maximum-deferral checkpoint settles. Cloudflare may
still replace a runtime, so mutation checkpoints do not rely on idle shutdown.

## Deletion

Deletion revokes authority before asynchronous storage cleanup:

1. Tombstone the D1 identity and product record.
2. Close broker operations.
3. Cancel queued and active work.
4. Revoke preview URLs.
5. Destroy and permanently retire sandbox IDs.
6. Delete R2 objects asynchronously with retry records.

A tombstoned identity always fails closed.

## Observability

Assign each privileged operation a Worker-generated correlation ID. Do not
accept a correlation ID from the sandbox as authority.

Record aggregate data for allowed requests:

- operation type
- contract version
- latency
- response status class
- request and response byte counts
- correlation ID

Record detailed data for denied requests:

- sandbox identity
- resolved ownership IDs when available
- lifecycle generation
- operation type
- contract version
- reason code
- correlation ID

Never record request or response bodies, headers, query strings, credentials,
placeholders, repository pack data, archive data, or response content.

Retain detailed denials for 30 days. Aggregate success metrics may have a longer
retention period.

Return generic user-visible error categories and the correlation ID. Keep the
exact failed identity, header, path, ref, or contract check in internal records.

Repeated denials from one sandbox close the operation, fail the agent run, and
mark the workspace session for review. Do not delete its backup or work.

## Failure posture

Fail closed when identity, lifecycle, operation, placeholder, request contract,
archive integrity, or Git ref validation fails.

Do not let a privileged request fall through to general internet access. Do not
substitute another provider. Do not inject a credential into the sandbox as a
fallback.

A broker outage disables the affected model or Git operation. It does not make
project recovery data unreadable to the Worker.

## Cutover

Implement the change in this order:

1. Disable repository resource discovery and load only the image-baked Ditto
   extension.
2. Remove account providers, stored credentials, model selection, and provider
   authentication runners.
3. Add sandbox identity records and exact OpenCode and Git contracts.
4. Pass the local broker integration tests.
5. Add token-free archive streaming and recovery generations.
6. Add project seeds, workspace-session sandboxes, lifecycle, capacity, and
   preview recovery.
7. Reset pre-launch project and workspace data.
8. Delete every old credential-injection and shared-project-sandbox path.
9. Pass the local release gate and mark the local implementation complete.

The shipped application has one path. Do not retain the old path behind a
runtime feature flag.

Before a future production cutover, create an operator-only D1 and R2
disaster-recovery backup. The application is fix-forward after cutover. Do not
reconnect old credential-injection code during rollback.

## Future production validation

This validation does not block local implementation. It blocks a claim that the
system is ready for production.

When the Cloudflare paid plan is available, verify these production-runtime
assumptions:

- OpenCode HTTPS interception trusts the Cloudflare certificate, preserves
  streaming and cancellation, keeps the real key outside the sandbox, and fails
  closed for invalid contracts.
- Git smart HTTP completes fetch and permitted push, keeps the installation
  token outside the sandbox, and rejects forbidden refs and stale operations.
- RPC streams transfer large archives without Worker buffering or exposing an
  R2 capability. Corrupt data, stale generations, and concurrent restores remain
  isolated.
- Workspace-session sandbox identity, sleep, restore, capacity, and preview
  routing match local behavior.

Record the production results in this section when the tests run. A failure
blocks production use, not continued local development.

## Test requirements

Tests must prove absence and rejection, not only successful forwarding.

The local release gate includes:

- agent environments contain user project values but no platform credential or
  internal bearer capability
- project builders, previews, backup commands, Git launchers, and container
  entrypoints contain no project values or platform credentials
- every privileged request validates identity, lifecycle generation, operation,
  placeholder, and contract
- stale and retired sandbox identities fail closed
- malformed OpenCode requests fail closed
- forbidden Git refs fail closed
- two workspace sessions for one project use different sandboxes, filesystems,
  process tables, and localhost namespaces
- one workspace session resolves to the same sandbox identity after Worker
  restarts
- normal chat disables repository resource discovery
- token-free backup generation races, corruption, restore fallback, and cleanup
  behave as specified
- queue leases and lifecycle transitions survive Worker restarts
- preview checkpoint deferral, forced checkpoint, cold restore, and URL
  revocation behave as specified
- provider data and old credential paths are absent after migration
- existing agent streaming, controls, Git export, preview, message, and thinking
  behavior remains available

## Out of scope

This revision does not:

- move the agent loop out of the sandbox
- make user-owned project values secret from sandbox code
- prevent all network or DNS exfiltration
- add request, token, or spending budgets
- add a browser terminal
- add nested virtualization or a second trusted harness container
- support account providers or bring-your-own-provider credentials
- preserve preview-generated filesystem changes

These features require separate designs.
