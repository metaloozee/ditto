# Brain architecture research

Research only. This document does not propose a migration plan, a sequence of
work, or a decision. It records what is true today, what the platform actually
guarantees, and where the proposal holds or fails.

Every claim is labelled:

| Label | Meaning |
|---|---|
| **VERIFIED** | Stated by a primary source (Cloudflare docs, GitHub docs, Linux man-pages, shipped package source) and cited |
| **INFERRED** | Reasoned from verified facts; the reasoning is shown |
| **UNVERIFIED** | Could not confirm from a primary source; treat as an open question |

---

## 1. Scope and method

### Question asked

Evaluate a proposed "Brain" architecture that moves the Pi model loop out of the
project sandbox and into Cloudflare Durable Objects plus a Workflow, on the
premise that running the harness inside an untrusted sandbox is a security flaw
because the harness needs user-level and application-level tokens.

Three constraints were added during the research and are treated as settled:

1. The Project Sandbox **will continue to receive the user's project environment
   variables**. These are the user's own application secrets, needed to run
   builds, tests, and dev servers. Their presence in the sandbox is in scope by
   decision, not a defect to be designed away.
2. The threat model must therefore be framed by **blast radius per credential
   class**, not by "does the sandbox hold secrets."
3. Cloudflare Sandbox SDK 1.0 preview (`@cloudflare/sandbox@next`) must be
   evaluated as a first-class alternative or complement to the Brain proposal.

### Sources

Primary sources only, fetched **2026-08-14**:

- `developers.cloudflare.com` — Workers, Durable Objects, Workflows, Sandbox SDK
  (stable and 1.0 preview), Containers, D1.
- `docs.github.com` — REST Git Data API, GitHub App installation tokens, rate
  limits.
- `man7.org` — `proc_pid_environ(5)`.
- `registry.npmjs.org` — published package versions and tarballs for
  `@cloudflare/sandbox`, `@cloudflare/containers`.
- **Shipped package source and first-party docs** for the Pi harness, read from
  `packages/sandbox-runner/node_modules/@earendil-works/*`. Pi ships its own
  `docs/` directory inside the npm package; these are the vendor's own docs, not
  third-party write-ups.
- Ditto's own source tree at `brain@57a29d5`.

No blog posts or secondary write-ups were used. Nothing in this document rests
on a non-primary source.

### What could not be verified

- **Pi's public web documentation.** Only the docs bundled in the npm tarball
  (`@earendil-works/pi-coding-agent@0.80.10/docs/*.md`) were read. A hosted
  `pi.dev` documentation site was not fetched. The bundled docs are first-party
  and version-locked to the installed package, which is arguably better, but the
  hosted docs may be newer.
- Whether Cloudflare's Sandbox outbound handlers can intercept a **provider SDK
  that pins its own TLS trust store**. See §7.4.
- Whether Cloudflare Sandbox egress interception covers **DNS-based
  exfiltration**. Docs say DNS is available even when `enableInternet = false`;
  they do not say DNS queries are inspected. See §8.5.
- Concrete per-account container concurrency ceilings beyond the published
  6 TiB / 1,500 vCPU / 30 TB account limits. There is no documented "max sandbox
  instances" number.
- Published architecture documents from other cloud coding-agent vendors, except
  what Cloudflare itself publishes about Devin Outposts (§8.7). No speculation
  is offered about vendors with no primary source.

---

## 2. Current architecture, as implemented

Grounded in code, not in the existing docs.

### Deployment shape

`alchemy.run.ts` defines one TanStack Start Worker with a D1 binding, an R2
backup bucket, and a single Container binding whose class is the **stock**
`Sandbox` class re-exported unchanged from `apps/web/src/server.ts:4`:

```ts
export { Sandbox } from "@cloudflare/sandbox";
```

Generated Wrangler config (`apps/web/.alchemy/local/wrangler.jsonc`):

- `compatibility_date: "2026-07-10"`, flags `nodejs_compat` and
  `nodejs_compat_populate_process_env`
- container `instance_type: "lite"`, **`max_instances: 1`**
- `SANDBOX_TRANSPORT: "rpc"` (`alchemy.run.ts:61`), consumed by
  `getProjectSandbox` (`apps/web/src/lib/sandbox-bootstrap.ts:22-31`) with
  `enableDefaultSession: false, transport: "rpc"`

`instance_type: "lite"` is **1/16 vCPU, 256 MiB memory, 2 GB disk**
([Containers limits](https://developers.cloudflare.com/containers/platform-details/limits/),
fetched 2026-08-14). **`max_instances: 1` means one running container at a time
for the whole deployment** — VERIFIED from the config; the operational
consequence is INFERRED but direct.

### Pinned versions

| Package | Version in repo | Latest published (2026-08-14) |
|---|---|---|
| `@cloudflare/sandbox` | `0.12.3` (`apps/web/package.json:21`) | `latest` = `0.12.7`; `next` = `0.13.0-next.738.2` |
| `@cloudflare/containers` (transitive) | `0.3.7` resolved | `0.3.7` |
| container image | `docker.io/cloudflare/sandbox:0.12.3` (`Dockerfile:1`) | — |
| `@earendil-works/pi-ai` | `0.80.10` | — |
| `@earendil-works/pi-coding-agent` | `0.80.10` | — |
| `@earendil-works/pi-agent-core` | `0.80.10` (transitive) | — |

VERIFIED from `package.json`, `Dockerfile`, and the npm registry metadata.

### Agent run path

`apps/web/src/lib/agent-run.ts:99-110` — the Worker creates a shell session and
injects, into that session's process environment:

```ts
env: {
  ...projectEnv,                                   // decrypted user secrets
  DITTO_PI_CREDENTIAL: options.runtimeCredentialJson,
  DITTO_GIT_CALLBACK_URL: agentGitCallbackUrl(options.env),
  DITTO_GIT_CALLBACK_TOKEN: gitCallbackToken,
  ...dittoGitAuthorEnv(),
}
```

It then writes a job file and runs `node /opt/ditto-runner/dist/cli.js --job …`
through `shell.execStream`, parsing NDJSON and relaying it as SSE
(`agent-run.ts:263-334`).

Inside the container, `packages/sandbox-runner/src/runner-model.ts:46-63` reads
`DITTO_PI_CREDENTIAL` (falling back to `OPENCODE_API_KEY`), seeds an
`InMemoryCredentialStore`, and then deletes both variables from `process.env`
"before session/tools so bash children cannot inherit secrets". §7.2 shows why
that scrub is incomplete.

`run-agent.ts:88-108` calls `createAgentSession` with `cwd` = session worktree,
`agentDir` = `/workspace/.ditto/pi-agent`, a durable JSONL `SessionManager`, an
in-memory `SettingsManager`, tools `["read","bash","edit","write","grep","find",
"ls","ditto_push_branch","ditto_open_pull_request"]`, and no `resourceLoader`.
The omitted `resourceLoader` matters — see §7.3.

### Credential provenance

`apps/web/src/lib/agent-run-service.ts:302-303, 342-343` resolve the runtime
credential. Two distinct cases:

- Account model in the user's catalog → the **user's own** encrypted provider
  credential, projected to a minimal runtime shape.
- Exact fallback `opencode/deepseek-v4-flash-free` → `operatorFallbackCredential(env.OPENCODE_API_KEY)`.
  `OPENCODE_API_KEY` is a single Worker secret bound in `alchemy.run.ts:57`,
  shared by every user of the deployment.

VERIFIED. The blast-radius consequence is developed in §8.2.

### Git callback token

`apps/web/src/lib/agent-git-jwt.ts` — HS256 over `BETTER_AUTH_SECRET`, claims
`{sub:"agent-git", projectId, sessionId, userId, sandboxId, exp}`,
`AGENT_GIT_JWT_TTL_SECONDS = 600`. The handler
(`apps/web/src/lib/agent-git-handler.ts:21-26`) accepts
`action ∈ {push, openPullRequest, status}` with optional attacker-supplied
`title`, `body`, `baseBranch`.

### Sandbox SDK surface actually used

83 direct `sandbox.*` / `shell.*` call sites outside tests, including:

| API | Sites | Notable files |
|---|---|---|
| `createSession` / `deleteSession` | 7 pairs | `agent-run.ts`, `agent-control-service.ts`, `session-git-metadata.ts`, `provider-auth-service.ts` (×4) |
| `execStream` | 1 | `agent-run.ts:278` |
| `exec` (buffered, `.stdout` read) | ~51 in `lib/` | `sandbox-bootstrap.ts` (`execOrThrow`, 37 uses), `session-git.ts`, `agent-control-service.ts:228` |
| `startProcess` / `killProcess` | 3 / 1 | `session-preview.ts`, `provider-auth-service.ts` |
| `gitCheckout` | 1 | `sandbox-bootstrap.ts:520` |
| `transport: "rpc"` | 1 | `sandbox-bootstrap.ts:28` |
| `createBackup` / `restoreBackup` | — | `sandbox-backup.ts`, `project-sandbox.ts` |
| `exposePort` / `unexposePort` | — | `session-preview.ts` |

---

## 3. Verified platform facts

All numbers below are from `developers.cloudflare.com`, fetched **2026-08-14**.
Where a limit differs between Free and Paid, both are given.

### 3.1 Durable Objects

| Fact | Value | Source |
|---|---|---|
| CPU per request | 30 s default, configurable to 5 min (`limits.cpu_ms = 300000`) | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| CPU budget reset | "Each incoming HTTP request or WebSocket message resets the remaining available CPU time to 30 seconds." | ibid., footnote 4 |
| Eviction risk | "If you consume more than 30 seconds of compute between incoming network requests, there is a heightened chance that the individual Durable Object is evicted and reset." | ibid. |
| Wall time (RPC/HTTP) | Unlimited. "Durable Objects remain active while a request, RPC call, response stream, WebSocket, or pending I/O is in flight." | ibid., wall-time table |
| Wall time (alarm handler) | 15 minutes | ibid. |
| Memory | 128 MB per isolate (Workers limit; DOs are Workers) | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Subrequests per invocation | Free 50 / Paid 10,000 default, configurable to 10,000,000 via `limits.subrequests` | ibid. |
| Subrequests to internal services | Free 1,000 / Paid "matches configured limit (default 10,000)" | ibid. |
| Simultaneous outgoing connections | 6 per request | DO limits + Workers limits |
| Storage per SQLite DO | 10 GB Paid / 1 GB Free (5 GB account total Free) | DO limits |
| Max SQL statement length | 100 KB; max row/BLOB 2 MB; max bound params 100 | ibid. |
| Throughput per object | Soft limit ~1,000 req/s; "approximately 500-1,000 requests per second for simple operations" | DO limits + [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) |
| DO classes per account | 500 Paid / 100 Free | DO limits |

**Discrepancy vs. pre-training.** The Workers paid subrequest limit is now
**10,000 per invocation (configurable to 10M)**, not 1,000. The Workers limits
page (last updated 2026-07-28) is authoritative. Note that the **Sandbox SDK
limits page still says "Workers Paid: 1,000 subrequests per request"** (last
updated 2026-08-06) — that page is stale. Trust the Workers page.

**Concurrency model** (VERIFIED,
[Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)):

- Single-threaded actor. **Input gates** block new events while synchronous JS
  runs, and remain closed across `await`s on *storage* operations.
- "Input gates only protect during storage operations. Non-storage I/O like
  `fetch()` or writing to R2 allows other requests to interleave, which can cause
  race conditions." — this is the reentrancy hazard that matters for an LLM loop,
  because every model call and every sandbox RPC is non-storage I/O.
- **Output gates** hold outgoing messages until pending storage writes complete.
- `blockConcurrencyWhile()` guarantees no other events are processed, "even if
  the callback performs asynchronous I/O" — but the docs say to use it
  *sparingly*, primarily for constructor-time initialisation.
- "Durable Objects may shut down at any time due to deployments, inactivity, or
  runtime decisions… shutdown hooks or lifecycle callbacks that run before
  shutdown are not provided."

**WebSocket Hibernation** (VERIFIED,
[Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)):
`ctx.acceptWebSocket(ws)` lets the DO be evicted from memory while clients stay
connected; billable duration (GB-s) does not accrue during hibernation;
in-memory state is reset and the **constructor re-runs** on the next event;
`serializeAttachment`/`deserializeAttachment` persist per-connection state. Max
received message size 32 MiB.

**Binding directions** (VERIFIED):

- Worker → DO: yes, via namespace binding and stub RPC.
- DO → DO: yes; a DO is a Worker with bindings, and DO namespaces are ordinary
  bindings.
- DO → Workflow: yes. Workflow bindings are ordinary Worker bindings
  (`[[workflows]]`), reachable as `this.env.MY_WORKFLOW.create(...)` from inside
  a DO ([Workers API](https://developers.cloudflare.com/workflows/build/workers-api/#call-workflows-from-workers)).
  Cloudflare's own [Durable AI Agent guide](https://developers.cloudflare.com/workflows/get-started/durable-agents/)
  demonstrates a DO (`Agent`) starting and querying a Workflow.
- Workflow → DO: yes, same reason — Workflows are Worker scripts with bindings.
  The same guide has the Workflow calling Agent (DO) methods via RPC.

**Container/Sandbox DO relationship** (VERIFIED,
[Sandbox lifecycle](https://developers.cloudflare.com/sandbox/1-0-preview/lifecycle/)):
the Sandbox *is* a Durable Object class — "**Durable Object**: The coordinator
behind that ID. The same ID maps to the same Durable Object identity." A
user-defined DO calls it like any other DO. Ditto's own `ProjectBrain` would be
a **separate** DO class, not the Sandbox class.

### 3.2 Workflows

Status: **generally available**, "Available on Free and Paid plans". No beta
banner on [the overview](https://developers.cloudflare.com/workflows/). Billing
for steps and storage begins **2026-08-10**
([Pricing](https://developers.cloudflare.com/workflows/reference/pricing/)).

| Fact | Free | Paid | Source |
|---|---|---|---|
| CPU per step | 10 ms | 30 s default, configurable to 5 min | [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/) |
| Wall clock per step | Unlimited | Unlimited | ibid. |
| Max steps per workflow | 1,024 | 10,000 default, configurable to 25,000 | ibid. |
| Non-stream step result | 1 MiB | 1 MiB | ibid. |
| State per instance | 100 MB | 1 GB | ibid. |
| `step.sleep` max | 365 days | 365 days | ibid. |
| Subrequests per instance | 50 | 10,000 default → 10M | ibid. |
| Concurrent running instances | 100 | 50,000 | ibid. |
| Instance creation rate | 100/s | 300/s account, 100/s per workflow | ibid. |
| Completed-instance retention | 3 days | 30 days | ibid. |
| Steps billing | 3,000/day | 500,000/mo included, then $0.80 / 100k | Pricing |

Extra facts:

- **`step.sleep` does not count toward the max-steps limit.**
- Waiting instances (`step.sleep`, retry backoff, `step.waitForEvent`) do **not**
  consume a concurrency slot.
- `ReadableStream<Uint8Array>` is a supported step return type for output larger
  than the 1 MiB non-stream cap; it still counts toward per-instance storage.
- `step.do` supports `rollbackOptions` — a compensating handler that runs in
  reverse step-start order if the workflow later fails.

**Exactly-once vs at-least-once.** Cloudflare never claims exactly-once for step
*bodies*. The published contract is that a **successfully completed** step's
result is cached and not recomputed, and that a step body **may run more than
once**:

> "Because a step might be retried multiple times, your steps should (ideally)
> be idempotent."
> "this operation can fail and retry but still commit in the payment processor -
> which means that, on retry, it would mischarge the customer again if the above
> checks were not in place."
> — [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)

The documented mitigation is exactly the one the proposal states: **observe
external state before retrying a non-idempotent effect.** That is Cloudflare's
own worked example, not an invention of this proposal. VERIFIED.

Other hard rules from the same page, all directly relevant:

- Step names are the cache key: "Step names act as the 'cache key' in your
  Workflow." Non-deterministic names defeat caching.
- "Workflows may hibernate and lose all in-memory state." Top-level state must
  be composed only of `step.do` return values.
- "It is not recommended to write code with any side effects outside of
  steps… If the engine restarts, the step logic will be preserved, but logic
  outside of the steps may be duplicated."
- The incoming `event` is immutable across steps.
- `Promise.race`/`Promise.any` over steps has caveats: the step returned on the
  first pass may not be the cached one.

**Cancellation and addressing.** `Workflow.get(id)` returns a
`WorkflowInstance`; instances expose `id`, `status()`, `pause()`, `resume()`,
`restart()`, `terminate()`, `sendEvent()`
([Workers API](https://developers.cloudflare.com/workflows/build/workers-api/)).
`create()` **throws** if the ID is already used by an instance still within its
retention window; `createBatch()` is idempotent and skips existing IDs. That is
a usable exactly-once *instance-creation* primitive.

**Streaming to a browser: no.** There is no Workflow→client streaming API. The
first-party pattern is a DO in front: in
[Build a Durable AI Agent](https://developers.cloudflare.com/workflows/get-started/durable-agents/),
the Workflow runs the loop with `step.do` per LLM turn and per tool call, and
calls `this.reportProgress(...)` / `broadcastToClients(...)` into an Agent
(Durable Object) that owns the browser WebSockets. `reportProgress` is
explicitly described as **non-durable**. VERIFIED.

This matters: Cloudflare's own reference agent puts the **loop in the Workflow**
and uses the **DO only for streaming and state**, which is a different split
from the proposal's "SessionBrain runs the model loop."

### 3.3 Sandbox SDK

**Isolation, stated verbatim**
([Security model](https://developers.cloudflare.com/sandbox/concepts/security/),
updated 2026-08-06):

> "Each sandbox runs in a separate VM, providing complete isolation:
> **Filesystem isolation** — Sandboxes cannot access other sandboxes' files.
> **Process isolation** — Processes in one sandbox cannot see or affect others.
> **Network isolation** — Sandboxes have separate network stacks.
> **Resource limits** — CPU, memory, and disk quotas are enforced per sandbox."

And, verbatim, what is *not* isolated inside one sandbox:

> "All code within a single sandbox shares resources:
> **Filesystem** — All processes see the same files.
> **Processes** — All sessions can see all processes.
> **Network** — Processes can communicate via localhost.
> For complete isolation, use separate sandboxes per user."

The 1.0 preview overview repeats it as a directive: **"Isolate end users with
separate sandboxes, not sessions inside one sandbox."**
([1.0 preview](https://developers.cloudflare.com/sandbox/1-0-preview/))

This is a direct, first-party contradiction of "one sandbox per project is fine
if worktrees organise concurrency." See §8.6.

**Lifecycle** (VERIFIED,
[Sandbox lifecycle](https://developers.cloudflare.com/sandbox/1-0-preview/lifecycle/),
[Sandbox options](https://developers.cloudflare.com/sandbox/configuration/sandbox-options/)):

| Fact | Value |
|---|---|
| `sleepAfter` default | `"10m"` |
| `keepAlive` default | `false`; when true, pings every 30 s, survives DO hibernation |
| Container start | Lazy — `getSandbox()` does not start one; `exec()`/`createTerminal()`/file writes do |
| Cold start | "The first start after deploy or idle can take longer than a warm call"; may throw `ContainerUnavailableError` |
| Survives stop/replace | Sandbox ID and DO identity only |
| Lost on stop/replace | Processes, terminals, their IDs, live log buffers, **and local files** unless restored |

**Egress control — this is the most consequential finding in the document.**

[Handle outbound traffic](https://developers.cloudflare.com/sandbox/guides/outbound-traffic/)
(updated 2026-04-21) documents, on the **stable** docs path:

| Mechanism | Semantics |
|---|---|
| `enableInternet = false` | Deny public internet by default. "Only ports `80`, `443`, and DNS are available, and DNS queries use Cloudflare's DNS servers." |
| `allowedHosts = [...]` | "a deny-by-default allowlist. Any host or IP not in the list is denied." Supports `*` globs. |
| `deniedHosts = [...]` | Denylist, checked first. Supports globs and CIDR (`"141.101.64.0/18"`). |
| `static outbound` | Catch-all programmable egress proxy running **in the Workers runtime**, with access to all Workers bindings. |
| `static outboundByHost` | Per-hostname handlers; take precedence over the catch-all. |
| `setOutboundByHost()` / `removeOutboundByHost()` / `setAllowedHosts()` / `setDeniedHosts()` | Runtime mutation from the Worker, per sandbox instance. |
| `interceptHttps` | Default `true`; an ephemeral CA is installed at `/etc/cloudflare/certs/cloudflare-containers-ca.crt` and the runtime "makes a best effort to trust this CA automatically regardless of distro… so runtimes like Node.js, `curl`, Python `requests`, and Git trust the certificate automatically." |

Precedence, verbatim: `deniedHosts` → `allowedHosts` → instance
`setOutboundByHost` → class `outboundByHost` → instance `setOutboundHandler` →
class `outbound`; "If no handler matches, the request can still egress to the
public internet when it matched `allowedHosts` or `enableInternet = true`.
Otherwise, it is denied."

**Limitation, verbatim:** "Outbound handlers only intercept HTTP and HTTPS
traffic. Traffic on ports other than 80 and 443 is never routed through
`outbound` or `outboundByHost`."

Cloudflare states the security intent explicitly:

> "Because outbound handlers run in the Workers runtime — outside the sandbox —
> they can hold secrets that the sandbox itself never sees… **This is especially
> useful for agentic workloads where you cannot fully trust the code running
> inside the sandbox.** With this pattern: No token is exposed to the sandbox…"

And on the Security model page:

> "Passing external API credentials directly to a sandbox — via environment
> variables or files — means the sandbox process holds a live credential that any
> code running inside it can read. Outbound handlers remove that exposure by
> keeping credentials in the Worker and injecting them into outbound requests…
> This pattern is useful when accessing GitHub for private repository
> operations, AI services, or object storage where you want to keep credentials
> out of the container entirely."

**Availability by version** (VERIFIED by unpacking published tarballs, 2026-08-14):

| API | `@cloudflare/containers@0.3.7` (installed) | `@cloudflare/sandbox@0.12.3` (installed) | `0.12.7` | `0.13.0-next.738.2` |
|---|---|---|---|---|
| `enableInternet` | ✅ | ✅ | ✅ | ✅ |
| `allowedHosts` / `deniedHosts` | ✅ (`dist/lib/container.d.ts:42,68`) | inherited | inherited | inherited |
| `static outbound` / `outboundByHost` / `outboundHandlers` | ✅ | ✅ | ✅ | ✅ |
| `setOutboundByHost` / `removeOutboundByHost` / `setAllowedHosts` / `setDeniedHosts` | ✅ | ❌ (absent in 0.12.3's own dist) | ✅ | ✅ |
| `interceptHttps` | ✅ | ✅ | ✅ | ✅ |
| `ContainerProxy` export | ✅ | ✅ | ✅ | ✅ |

The full surface lives on the `Container` base class in `@cloudflare/containers`,
which Ditto already has resolved at `0.3.7`. **Outbound handlers do not require
`@next`.** They require Ditto to stop re-exporting the stock `Sandbox` class and
declare a subclass instead, plus `export { ContainerProxy }` from the Worker
entrypoint.

**Backups vs mounts** (VERIFIED,
[Backups API](https://developers.cloudflare.com/sandbox/api/backups/),
[Storage API](https://developers.cloudflare.com/sandbox/api/storage/)):

| Fact | Value |
|---|---|
| `createBackup({dir, name?, ttl?, useGitignore?, localBucket?})` | squashfs archive → R2 via presigned URL |
| Default TTL | **259,200 s (3 days)**. Ditto sets 365 days (`sandbox-backup.ts:4`) |
| `restoreBackup(handle)` | Copy-on-write: backup mounted read-only, writes go to an upper layer |
| Restore mount lifetime | "**In production, the FUSE mount is lost when the sandbox sleeps or restarts. Re-restore from the backup handle to recover.**" |
| Partial writes | "Partially-written files may not be captured consistently." |
| `mountBucket(bucket, path, opts)` | R2/S3/GCS mounted as a live filesystem path; supports `prefix` and `readOnly` |

So the proposal's claim 7 — "restore mounts are ephemeral so the handle must be
retained and reapplied after restart" — is **VERIFIED verbatim**. A live R2 mount
(`mountBucket`) also exists and is a real alternative Ditto is not using.

**Containers platform** (VERIFIED,
[Containers limits](https://developers.cloudflare.com/containers/platform-details/limits/),
[Containers pricing](https://developers.cloudflare.com/containers/pricing/)):

| Instance type | vCPU | Memory | Disk |
|---|---|---|---|
| `lite` (Ditto today) | 1/16 | 256 MiB | 2 GB |
| `basic` | 1/4 | 1 GiB | 4 GB |
| `standard-1` | 1/2 | 4 GiB | 8 GB |
| `standard-2` | 1 | 6 GiB | 12 GB |
| `standard-3` | 2 | 8 GiB | 16 GB |
| `standard-4` | 4 | 12 GiB | 20 GB |

Account limits: 6 TiB concurrent memory, 1,500 concurrent vCPU, 30 TB concurrent
disk, 50 GB total image storage. **There is no published cap on the number of
sandbox IDs.**

Billing: "billed for every 10 ms that they are actively running… **Memory and
disk usage are based on the provisioned resources for the instance type you
select, while CPU usage is based on active usage only**… Charges stop after the
container instance goes to sleep." Included monthly on Workers Paid: 25 GiB-hours
memory, 375 vCPU-minutes, 200 GB-hours disk. Egress $0.025/GB (NA/EU) with 1 TB
included.

INFERRED cost consequence: N concurrently *awake* sandboxes bill N × provisioned
memory and disk for the wall-clock they are awake, regardless of idleness. With
`sleepAfter: "10m"` and `lite`, one extra awake sandbox costs
256 MiB × 10 min ≈ 0.042 GiB-hours; the 25 GiB-hour monthly allowance covers
roughly 600 such idle tails. The real cost of per-session sandboxes is not the
container — it is the **repeated clone + dependency install** on every cold
session, which is CPU, egress, and latency.

### 3.4 D1

[D1 limits](https://developers.cloudflare.com/d1/platform/limits/), fetched
2026-08-14:

| Fact | Value |
|---|---|
| Max database size | 10 GB Paid / 500 MB Free — "cannot be further increased" |
| Queries per Worker invocation | 1,000 Paid / 50 Free (counts against subrequests) |
| Max row / string / BLOB | 2,000,000 bytes |
| Max SQL statement | 100,000 bytes |
| Max bound parameters | 100 |
| Max query duration | 30 s (also caps a whole `batch()` call) |
| Concurrency | "Each individual D1 database is inherently single-threaded, and processes queries one at a time." |
| Throughput guidance | ~1,000 q/s at 1 ms/query; ~10 q/s at 100 ms/query |
| Overload behaviour | Queues, then returns an "overloaded" error |
| Simultaneous connections | 6 per Worker invocation |

`batch()` semantics, verbatim
([D1 Worker API](https://developers.cloudflare.com/d1/worker-api/d1-database/)):

> "D1 operates in auto-commit. Our implementation guarantees that each statement
> in the list will execute and commit, sequentially, non-concurrently."
> "Batched statements are SQL transactions. If a statement in the sequence fails,
> then an error is returned for that specific statement, and it aborts or rolls
> back the entire sequence."

INFERRED suitability for a semantic agent event log: **fine.** At the
proposal's granularity (message accepted, tool started, tool completed,
assistant completed, run settled) a busy run produces order-100 rows. Even 100
concurrent runs at 5 events/s is ~500 writes/s against a single-threaded DB with
multi-millisecond writes — that is at the edge. **Streaming tokens to D1 would
not work**; the proposal is right to exclude them. The 10 GB hard ceiling is the
longer-term constraint, since it cannot be raised.

### 3.5 Workers runtime / Node compatibility

[Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/),
updated 2026-08-12. **This has changed materially from what pre-training would
suggest.**

| Module | Status |
|---|---|
| `node:fs` | 🟢 supported — but as a **virtual, in-memory FS** |
| `node:net` | 🟢 supported |
| `node:crypto`, `node:stream`, `node:events`, `node:path`, `node:buffer`, `node:zlib`, `node:http`, `node:https` | 🟢 supported |
| `node:os` | 🟡 partial |
| `node:tls` | 🟡 partial |
| `node:child_process` | **non-functional stub** (importable since 2026-03-17; calls do not work) |
| `node:worker_threads` | **non-functional stub** |
| `node:readline` | **non-functional stub** |
| `node:tty`, `node:v8`, `node:repl` | **non-functional stubs** |

`node:fs` specifics ([fs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/)):

- `/bundle` is read-only bundle files; `/tmp` is writable; `/dev` has
  `null`/`random`/`full`/`zero`.
- "the contents of `/tmp` are **not persistent and are unique to each request**.
  Files created in `/tmp` within the context of one request will not be available
  in other concurrent or subsequent requests."
- All operations are synchronous internally; files count against the 128 MB
  isolate memory limit; max file 128 MB; max path 4096 chars; max 48 path
  segments.
- No `fs.watch`, no glob APIs, no file permissions/ownership, timestamps always
  epoch.

Ditto's Worker runs `compatibility_date 2026-07-10` with `nodejs_compat` — so
`node:fs` is available today, and `node:child_process` resolves to a stub.

---

## 4. Sandbox SDK 1.0 preview (`@next`)

### 4.1 Status

- Published as `@cloudflare/sandbox@next` = `0.13.0-next.738.2` (2026-08-13).
  Stable `latest` = `0.12.7` (2026-08-14).
- Cloudflare's language: "Sandbox SDK 1.0 is the next major release of the SDK.
  It is available now as a **preview** on the npm `@next` tag… **We recommend
  that new projects start on `@cloudflare/sandbox@next`**… Existing apps should
  migrate when you can, so you are ready when 1.0 becomes the stable release."
- **There is no "not for production" language in the docs.** The only cautionary
  statements are: the self-deployed **bridge is not on the preview line**, and
  cutover must use `--containers-rollout=immediate` because "Stable and `@next`
  control protocols are incompatible both ways; gradual rollout leaves a broken
  mixed window. In-flight container work can stop."
- The local `sandbox-migrate-to-next` skill adds an operational rule that is not
  in the docs: "Do **not** force production cutover without the user agreeing."

Verdict on production readiness: **preview, actively recommended for new
projects, with a hard one-shot cutover.** Not "unsafe", but not reversible
gradually. UNVERIFIED: whether Cloudflare offers any SLA distinction for the
preview line.

### 4.2 API delta as it hits Ditto

| Stable API | `@next` replacement | Ditto files affected | Blast radius |
|---|---|---|---|
| `createSession({id, cwd, env, commandTimeoutMs})` + `deleteSession` | **Removed.** `cwd`/`env` per launch, or one shell script | `agent-run.ts:99`, `agent-control-service.ts:219`, `session-git-metadata.ts:739`, `provider-auth-service.ts` ×4 | **Largest.** 7 create/delete pairs; the per-run env-injection idiom disappears entirely |
| `await sandbox.exec("cmd")` → buffered `{stdout, exitCode}` | `await sandbox.exec(argv)` → handle; then `await proc.output({encoding:"utf8"})` | ~51 call sites in `lib/`, incl. all 37 `execOrThrow` uses in `sandbox-bootstrap.ts`, `session-git.ts`, and `agent-control-service.ts:228` | Large but mechanical — one helper can absorb most of it |
| No implicit shell | `["/bin/bash","-lc", script]` | every site that uses `&&`, pipes, or the `quoteShellArg` helper | Mechanical; arguably *safer* — argv removes a whole injection class |
| `execStream` | Same handle: `logs()`, `waitForExit()`, `waitForPort()`, `waitForLog()`, `kill(numericSignal)` | `agent-run.ts:278` (the NDJSON bridge) | Single site, high semantic risk — the SSE relay is the core of the product |
| `startProcess` / `killProcess` (string signals) | Handle methods; numeric signals only | `session-preview.ts:1032,674`, `provider-auth-service.ts:779,1080` | Small |
| `gitCheckout(repoUrl, …)` | Removed. `exec(["git","clone",…])` | `sandbox-bootstrap.ts:520` | Single site — **and it removes a documented security exception**, see below |
| `transport` / `SANDBOX_TRANSPORT` / `setTransport` | Removed — RPC always | `sandbox-bootstrap.ts:28`, `alchemy.run.ts:61` | Pure deletion. No-op simplification, confirmed |
| `sandbox.terminal(request)` / xterm `sessionId` | `createTerminal` + `terminal.connect(request)`, `terminalId` | Ditto uses neither today | None — but see §4.5 |
| Files, mounts, backups, ports, tunnels, `proxyToSandbox` | "Mostly unchanged" | `sandbox-backup.ts`, `session-preview.ts`, `server.ts` | Low |

Two semantics changes deserve individual flags:

**(a) `await exec()` resolves at process START.** `agent-control-service.ts:228`
does `const result = await shell.exec(...)` and then immediately reads
`result.stdout` and parses it as the control-CLI's one-line protocol response.
Under `@next` that read would happen before the CLI has written anything. This
site must become `await proc.output(...)`. Same for every `execOrThrow` in
`sandbox-bootstrap.ts` and `session-git.ts` that inspects `stdout`/`exitCode`.
VERIFIED from the migrate doc; the specific Ditto sites are VERIFIED from source.

**(b) Process/terminal IDs are per-container.** "Process and terminal IDs belong
to the **current container**, not forever to a sandbox ID." Ditto's control path
does not store process IDs — it addresses the running runner through a
`runId`-derived Unix socket under `/tmp` inside the container
(`packages/sandbox-runner/src/control-channel.ts`). That is container-local by
construction, so it **survives the migration unchanged**, as long as the control
`exec` lands in the same container as the runner. It does not survive a container
replace, but it does not today either. INFERRED, from the socket path being
in-container and the SDK never being asked to remember a process handle.

### 4.3 `gitCheckout` removal eliminates Ditto's tokenized-URL exception

`docs/architecture/security.md` documents one deliberate exception: "Initial SDK
clone (`sandbox.gitCheckout`) remains the explicit tokenized-URL exception." It
exists because `gitCheckout` takes a URL and the only way to authenticate is to
embed the token in it.

With argv `git` via `exec`, the token can move to a **command-scoped `env`** on
that single launch — the same technique `session-git.ts` already uses for
fetch/push from the temporary bare repo. Better still, an outbound handler for
`github.com` removes the token from the container entirely (§4.4). Either way
the exception can be closed. VERIFIED that `gitCheckout` is removed and `exec`
accepts per-launch `env`; INFERRED that this closes the exception, since it is
the same pattern Ditto already implements elsewhere.

### 4.4 Outbound handlers as a credential boundary

This is the finding that changes the shape of the decision.

An outbound handler is a static method on the Sandbox subclass that runs **in the
Workers runtime, outside the container**, receives the sandbox's outbound
`Request`, has access to all Worker bindings, and returns a `Response`. It can
add headers, rewrite the request, deny it, or route it to a binding.

Applied to Ditto's two platform credentials:

**Model provider credential.** Instead of `DITTO_PI_CREDENTIAL` in the shell
env, the runner is configured with a placeholder key and the provider base URL,
and `outboundByHost["api.anthropic.com"]` (etc.) sets the real
`x-api-key`/`Authorization` from `env` before forwarding. The sandbox never holds
the credential. Cloudflare documents exactly this shape, including a
`ctx.containerId`-keyed per-instance lookup from KV.

Feasibility for Pi specifically (INFERRED, needs a spike):

- Pi's HTTP goes through `undici` with a global dispatcher installed by
  `configureHttpDispatcher()` (`dist/core/http-dispatcher.js`). It sets
  `EnvHttpProxyAgent` with `allowH2: false` and calls `undici.install()`. It
  honours `HTTP_PROXY`/`HTTPS_PROXY` via `applyHttpProxySettings`. It does **not**
  pin a CA or disable system trust — so the Cloudflare interception CA, which the
  runtime installs into the system bundle and common env vars, should be
  accepted. `allowH2: false` also helps: HTTP/2 is off, so this is plain
  HTTPS/1.1 on port 443.
- Pi resolves auth in this order: runtime overrides (`setRuntimeApiKey`), stored
  `auth.json`, env vars, fallback resolver. See the "API Keys and OAuth" section
  in `@earendil-works/pi-coding-agent@0.80.10/docs/sdk.md`.
  A dummy value satisfies it; the handler replaces the header.
- **Residual risk:** OAuth-based providers (Ditto supports OAuth credentials with
  an access/refresh pair). An outbound handler can inject a bearer token just as
  easily, but the refresh flow and any provider that signs requests rather than
  bearer-authenticating them would need per-provider work.

**Git callback JWT.** `DITTO_GIT_CALLBACK_TOKEN` could be replaced by an
`outboundByHost` entry for a synthetic host (Cloudflare's own example uses
`"my.worker"`), where the handler is the authority: it knows `ctx.containerId`,
so it can resolve project/session/user from a Worker-side map and invoke the same
`session-git` services directly — **no bearer token in the container at all**.
INFERRED, but this is precisely the documented `outboundByHost` + `ctx.containerId`
pattern.

Critically: **none of this requires the Brain.** It requires a Sandbox subclass
and an egress policy. See §9(c).

### 4.5 Terminals as a streaming transport

`createTerminal({command, cwd})` + `terminal.connect(request, {cursor, cols, rows})`
gives a PTY with a **cursor-resumable** output stream that the browser can attach
to directly. Compared to the current `execStream` → NDJSON → SSE bridge:

- Pro: reconnection with a cursor is built in; today a browser reconnect cannot
  replay missed deltas and Ditto compensates with an optimistic browser cache.
- Con: a PTY is a byte stream with terminal control codes, not a structured NDJSON
  channel. Ditto's protocol depends on line-delimited typed events and on the
  Worker performing streaming redaction **before** anything reaches the browser
  (`agent-run.ts:137`, `StreamingSecretRedactor`). `terminal.connect(request)`
  hands the socket to the browser, which would **bypass the redaction boundary**.

Verdict: **not a better transport for the agent stream** as long as
Worker-side redaction is a security control. It would be a good fit for an
explicit user-facing shell feature. INFERRED, from the redaction requirement in
`security.md` and the connect-hands-off-the-socket shape of the API.

### 4.6 Do the Brain rewrite and the `@next` migration overlap?

They overlap in exactly one place and diverge everywhere else.

- **Overlap:** both delete `createSession`. The Brain moves per-run env injection
  out of the sandbox; `@next` deletes the API that performs it. If the credential
  boundary moves to outbound handlers, the `createSession` sites collapse into
  per-launch `env` for non-secret config, which is the `@next` shape anyway.
- **Divergence:** `@next` touches ~83 sandbox call sites across seven files and
  changes nothing about D1, SSE, message lifecycle, or run durability. The Brain
  touches the Worker/tRPC layer, the D1 event model, streaming, and run
  orchestration, and barely touches the sandbox call sites at all.

INFERRED: they are **largely independent**. The only argument for doing them
together is avoiding two passes over `agent-run.ts` and `agent-control-service.ts`.
That is a small saving against a large increase in simultaneous risk, given that
`@next` cutover is one-shot and non-gradual.

---

## 5. Pi compatibility spike

### 5.1 Verdict

**Pi's `@earendil-works/pi-coding-agent` cannot run in a Durable Object.**
`@earendil-works/pi-agent-core` — the layer that actually contains the agent loop
— **probably can**, and it exposes exactly the two abstractions the Brain needs.

### 5.2 Blockers for `pi-coding-agent`

The package `exports` field permits only `"."` and `"./rpc-entry"` — deep imports
are blocked, so you cannot cherry-pick `core/sdk.js`. Importing `"."` loads
`dist/index.js`, which re-exports `./main.js`, which imports (VERIFIED from
`dist/main.js:7,22,32,33`):

| Import | Status in workerd | Consequence |
|---|---|---|
| `node:readline` | non-functional stub | import-time OK, runtime break |
| `core/http-dispatcher.js` → `undici` (`Client`, `Pool`, `EnvHttpProxyAgent`, `setGlobalDispatcher`, `install`) | needs real sockets | hard break |
| `modes/index.js` → `InteractiveMode` (full TUI), `output-guard` (stdout takeover) | `node:tty`, terminal control | hard break |
| `package-manager-cli.js` → `core/package-manager.js` → `node:child_process` | non-functional stub | hard break |
| `utils/image-resize.js` → `node:worker_threads` + `@silvia-odwyer/photon-node` WASM | stub + large WASM | hard break |

`dist/config.js` — imported by `core/sdk.js`, so unavoidable even in a
hypothetical deep-import world — does `fileURLToPath(import.meta.url)`,
`realpathSync`, `homedir()`, and `spawnProcessSync` from `node:child_process`.
`getAgentDir()` returns `join(homedir(), ".pi", "agent")`.

Even setting aside the imports, the *semantics* break: `SessionManager.open(file)`
writes JSONL to disk. In workerd `node:fs` `/tmp` is per-request and
non-persistent, so a durable session file is impossible. `SessionManager.inMemory()`
exists, but then Pi's session tree must be persisted by the host — which is what
the Brain proposes anyway.

**VERIFIED.** This is not a compatibility-flag problem. It is a shape problem.

### 5.3 What `pi-agent-core` actually offers — the crux answer

The question was: *does the SDK support running the agent loop out of process
from the filesystem it operates on — can tools be dispatched to a remote
executor?*

**Yes, in three distinct ways, all first-party.** VERIFIED from shipped source
and shipped docs.

**(1) `ExecutionEnv` — a backend-independent filesystem + shell interface.**
`@earendil-works/pi-agent-core@0.80.10/dist/harness/types.d.ts:228`:

```ts
export interface ExecutionEnv extends FileSystem, Shell {}
```

`FileSystem` is ~18 fully async methods (`readTextFile`, `writeFile`,
`listDir`, `canonicalPath`, `createTempDir`, `remove`, …), each returning
`Promise<Result<T, FileError>>` and each accepting an `AbortSignal`. `Shell` is a
single async `exec(command, {cwd, env, timeout, abortSignal, onStdout, onStderr})`
returning `Promise<Result<{stdout, stderr, exitCode}, ExecutionError>>`.
`AgentHarness` holds `readonly env: ExecutionEnv`
(`dist/harness/agent-harness.d.ts:5`).

`NodeExecutionEnv` is *one* implementation, and it is deliberately quarantined:
the package's root `index.js` imports **no node builtins at all**; the only file
under `dist/` that imports `node:*` is `harness/env/nodejs.js`, reachable only
through the separate `"./node"` export. A `SandboxExecutionEnv` backed by
Cloudflare Sandbox RPC is exactly what this interface was designed to accept.

**(2) `streamProxy` — credential-free model calls.** `dist/proxy.d.ts`, verbatim
header comment:

> "Proxy stream function for apps that route LLM calls through a server. The
> server manages auth and proxies requests to LLM providers."

Signature: `streamProxy(model, context, {proxyUrl, authToken, signal, …})`, with
a defined wire event type (`ProxyAssistantMessageEvent`) covering text, thinking,
tool-call deltas, done, and error. Pi already anticipated the exact split the
Brain wants.

**(3) Tool-level delegation — the Gondolin pattern.** `pi-coding-agent` exports
`createReadTool`, `createWriteTool`, `createEditTool`, `createBashTool`,
`createGrepTool`, `createFindTool`, `createLsTool`, each accepting an
`operations` object (`ReadOperations`, `BashOperations`, …). The shipped example
`examples/extensions/gondolin/index.ts` overrides all seven built-ins so they
execute inside a micro-VM while `pi` runs on the host, and routes user `!`
commands through `pi.on("user_bash", …)`. The shipped
`@earendil-works/pi-coding-agent@0.80.10/docs/containerization.md`
names this as one of two supported patterns: "run `pi` on the host and route tool
execution into an isolated environment."

That same doc names a fourth, adjacent option: NVIDIA OpenShell, where
"code inside the sandbox can call `https://inference.local`, and the gateway
injects the configured provider credentials upstream" — conceptually identical to
Cloudflare's outbound handler.

**Caveat:** `createAgentSession()` in `pi-coding-agent` does **not** expose an
`env` option (`dist/core/sdk.d.ts:10-54` — the full option list is
`cwd, agentDir, modelRuntime, model, thinkingLevel, scopedModels, noTools, tools,
excludeTools, customTools, resourceLoader, sessionManager, settingsManager,
sessionStartEvent`). So route (1) means building on `AgentHarness` directly and
giving up `pi-coding-agent`'s resource loading, extensions, compaction wiring,
and the `AgentSession` API Ditto's runner uses today. Route (3) keeps
`pi-coding-agent` but only relocates *tools*, not the harness's own file access.

### 5.4 Programmatic session API — the user's claims, checked

All confirmed against `docs/sdk.md` in the installed package:

| Claim | Verdict |
|---|---|
| Programmatic sessions | ✅ `createAgentSession()`, `AgentSession`, `createAgentSessionRuntime()` |
| Streaming | ✅ `session.subscribe(event)` with `message_update`/`text_delta`, `thinking_delta`, `tool_execution_start|update|end`, `turn_start|end`, `agent_start|end`, `queue_update`, `compaction_*`, `auto_retry_*` |
| Tool selection/filtering | ✅ `tools` allowlist, `excludeTools` denylist, `noTools: "all" \| "builtin"` |
| Abort | ✅ `session.abort(): Promise<void>`, plus `abortCompaction()` |
| Follow-up queue | ✅ `followUp()`, `steer()`, `prompt(text, {streamingBehavior})`; `clearQueue()` is used by Ditto's control channel |
| Custom tools with arbitrary async handlers | ✅ `defineTool({name, parameters: Type.Object(...), execute: async (id, params, signal, onUpdate, ctx) => …})`, passed via `customTools` |

The user's characterisation of the SDK is accurate.

### 5.5 Resource discovery and extensions — the user's claim, checked and sharpened

The claim: *"Pi's default resource loading discovers project-local extensions,
and Pi documents that extensions run with full system permissions and may execute
arbitrary code."*

**Correct, and worse than stated in Ditto's current configuration.**

`docs/extensions.md:111`, verbatim:

> "**Security:** Extensions run with your full system permissions and can execute
> arbitrary code. Only install from sources you trust."

`docs/extensions.md:113`:

> "Extensions are auto-discovered from trusted locations. Project-local
> `.pi/extensions` entries load only after the project is trusted."

`docs/security.md`:

> "Pi does not include a built-in sandbox. Built-in tools can read files, write
> files, edit files, and run shell commands with the permissions of the pi
> process. Extensions are TypeScript modules that run with the same permissions."
> "Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) do not show a
> trust prompt. Without an applicable saved trust decision,
> `defaultProjectTrust: "ask"` and `"never"` ignore such resources, while
> `"always"` trusts them."

That last sentence describes the **CLI**. The **SDK** path behaves differently,
and this is the finding:

- `SettingsManager` defaults `projectTrusted` to **`true`**
  (`dist/core/settings-manager.js:136` default parameter `projectTrusted = true`;
  `:153` `const projectTrusted = options.projectTrusted ?? true`).
  `SettingsManager.inMemory()` — which Ditto uses (`run-agent.ts:84`) — goes
  through `fromStorage(storage, options)` with no `projectTrusted`, so it is
  `true`.
- Trust is only *lowered* inside `DefaultResourceLoader.reload(options)` when
  `options.resolveProjectTrust` is supplied
  (`dist/core/resource-loader.js:221-226`; `loadProjectTrustExtensions()` at
  `:209` is what calls `setProjectTrusted(false)`).
- `createAgentSession()` with no `resourceLoader` constructs
  `new DefaultResourceLoader({cwd, agentDir, settingsManager})` and calls
  **`await resourceLoader.reload()` with no options**
  (`dist/core/sdk.js:71-73`).

**Therefore, in Ditto today** (`run-agent.ts:88-108` passes no `resourceLoader`
and `cwd` = the session worktree, which is repository content): a repository
containing `.pi/extensions/*.ts` gets those extensions **loaded and executed**
at session creation, with no trust prompt and no model involvement. Also
`.pi/settings.json`, `.pi/skills`, `.pi/prompts`, `.pi/SYSTEM.md`, and
`.pi/APPEND_SYSTEM.md` (`resource-loader.js:571-574, 750-765`).

This is a **zero-click arbitrary-code path from repository contents into the
sandbox process** — before the first token is generated. It is contained by the
sandbox VM boundary, so it is not a container escape. But it means every
credential in that process env is reachable by a malicious repo without any
prompt-injection step. VERIFIED from source.

**Can discovery be disabled? Yes, cited.** `DefaultResourceLoaderOptions`
(`dist/core/resource-loader.d.ts`) exposes `noExtensions`, `noSkills`,
`noPromptTemplates`, `noThemes`, `noContextFiles`, plus `*Override` hooks. Ditto
already does this correctly in the git-metadata runner (`docs/security.md`: "no
disk resource discovery"). The chat runner does not.

---

## 6. Threat model assessment

### 6.1 Framing

The sandbox is, by decision, a **credential-holding environment**. It receives
the user's project environment variables so builds, tests, and dev servers work.
It has network egress by default. Under every architecture considered here, a
compromised build step can read those variables and POST them anywhere.

So "untrusted layer" cannot mean "holds no secrets." It can only mean:

> The sandbox holds **only credentials whose blast radius is confined to the one
> user's own resources**, and holds **no credential that grants authority over
> Ditto, over other tenants, or over the control plane**.

The honest size of the security win from any of these designs is therefore
bounded: it is the removal of *platform-level* credentials, not the creation of a
secret-free sandbox. That is a real and worthwhile win — the two platform
credentials are the highest-blast-radius items in the system — but it should not
be sold as making the sandbox trustworthy.

### 6.2 What is exposed today, ranked by blast radius

| # | Exposure | Where | Scope | Attack | Blast radius |
|---|---|---|---|---|---|
| 1 | `OPENCODE_API_KEY` (operator fallback) | Shell env → `DITTO_PI_CREDENTIAL` (`agent-run-service.ts:303,343`) | **Operator-wide.** One Worker secret (`alchemy.run.ts:57`) shared by every user | Malicious repo `.pi/extensions` (§5.5, zero-click), malicious dependency in `pnpm install`, prompt injection reaching `bash`, or the user's own agent going off-script | **Cross-tenant / platform.** Attacker gets the shared provider key: unbounded spend on Ditto's account, and it is the *default* model, so it is projected on most runs |
| 2 | `DITTO_PI_CREDENTIAL` (account credential) | Same | **Per-user.** The user's own encrypted provider credential, projected with OAuth refresh stripped (`ditto:no-refresh`) and access expiry required to outlive the run | Same | **Per-user, off-platform.** Attacker burns *that* user's model spend and can read/act as that account against the provider. Refresh-stripping bounds the window to the token's remaining life, not 10 minutes |
| 3 | `DITTO_GIT_CALLBACK_TOKEN` | Same | **Per-session, 600 s** (`agent-git-jwt.ts:5`), bound to `{projectId, sessionId, userId, sandboxId}` | Same | **One repo, one branch, 10 min.** Holder can `push` the session branch as it currently stands, and `openPullRequest` with attacker-chosen `title`, `body`, **and `baseBranch`** (`agent-git-handler.ts:21-26`). Cannot force-push, cannot touch other projects or repos, cannot mint an installation token. A PR still needs a human to merge |
| 4 | Project env vars | Same | **Per-project, user's own** | Same | **User's own infrastructure.** In scope by decision |
| 5 | Cross-session filesystem access | One sandbox per project; sessions are git worktrees | All of a user's sessions for that project | Any code execution in the sandbox | Read/write any sibling worktree, any `.ditto/sessions/*.jsonl` (full chat history for every session), the primary clone, and `/tmp` locks. **Same-user only** — sandboxes are per-project and VM-isolated from each other |

A note on #1 vs #2: the exact-fallback path is reached whenever the user has no
connected provider *or* explicitly selects `opencode/deepseek-v4-flash-free`
(`agent-run-service.ts:298-303, 342-345`). For a new or unconnected account, the
operator key is the **only** credential path. That makes #1 the common case, not
the edge case.

### 6.3 The scrub is defeated

`runner-model.ts:52-62` deletes `DITTO_PI_CREDENTIAL` and `OPENCODE_API_KEY` from
`process.env` "before session/tools so bash children cannot inherit secrets." The
child-inheritance claim is true. The confidentiality claim is not.

`proc_pid_environ(5)` ([man7.org](https://man7.org/linux/man-pages/man5/proc_pid_environ.5.html),
fetched 2026-08-14), verbatim:

> "the initial environment that was set when the currently executing program was
> started via execve(2)"
> "If, after an execve(2), the process modifies its environment (e.g., by calling
> functions such as putenv(3) or modifying the environ(7) variable directly),
> this file will not reflect those changes."

**VERIFIED** for the man page. **INFERRED, high confidence**, for the
consequence: Pi's `bash` tool runs as a child of the runner process, so
`cat /proc/$PPID/environ` (or `/proc/*/environ`, since the container's processes
run as the same uid — `Dockerfile:3` uses `--chown=0:0` on the stock Cloudflare
image) recovers both variables verbatim after the scrub. The job file under
`/workspace/.ditto/jobs/` is also readable, though it contains no credentials.

This should be treated as a live finding independent of any architecture
decision. **UNVERIFIED:** the exact uid the runner executes as inside the
Cloudflare sandbox image; this changes the exploit's ergonomics, not its
existence, since `$PPID` is the agent's own parent either way.

### 6.4 Does the Brain fix each exposure?

| # | Exposure | Brain (b) | Outbound handlers (c) | Notes |
|---|---|---|---|---|
| 1 | `OPENCODE_API_KEY` | **Removed.** Model calls happen in SessionBrain | **Removed.** Handler injects the header outside the container | Both fix it. (c) is a config change; (b) is a rewrite |
| 2 | `DITTO_PI_CREDENTIAL` | **Removed** | **Removed** (bearer/API-key providers); OAuth providers need per-provider work | Same |
| 3 | `DITTO_GIT_CALLBACK_TOKEN` | **Removed** — git tools become Brain-side tool dispatch | **Removed** — `outboundByHost` + `ctx.containerId` makes the handler the authority, no bearer in the container | Both fix it |
| 4 | Project env vars | **Not removed.** Still required for builds/tests — and correctly so | **Not removed** | Neither design changes this, by decision |
| 5 | Cross-session filesystem | **Not removed** by the Brain as described. ProjectBrain owns worktree creation but the sandbox is still one container | **Removed** only if paired with per-session sandbox IDs | Neither the Brain nor outbound handlers address this; only sandbox-per-session does |
| — | Repo-supplied `.pi/extensions` RCE (§5.5) | Only if the loop leaves the sandbox entirely *and* Pi is no longer run in-container | **Not addressed** — needs `noExtensions`/`noSkills`/`noContextFiles` on the resource loader | Independent, cheap, should be fixed regardless |

The honest summary: **(b) and (c) close the same three platform-credential
exposures.** They differ in cost, not in coverage, on that axis. What (b) buys
beyond (c) is durability and recovery of the run itself, not confidentiality.

### 6.5 "Disable the bash tool" as a worktree guardrail

**It is not a security boundary.** Evidence:

- Pi's own security doc: "Built-in tools can read files, write files, edit files,
  and run shell commands with the permissions of the pi process." Removing `bash`
  leaves `read`, `write`, `edit`, `grep`, `find`, `ls` — all of which take
  arbitrary paths. Ditto's session worktrees are at
  `/workspace/.ditto/worktrees/<sessionId>`, sibling directories under a shared
  root. `read`-ing `../<otherSessionId>/…` or
  `/workspace/.ditto/sessions/<other>.jsonl` needs no shell.
- The `write` tool alone is arbitrary code execution on the next build: writing
  a `package.json` `postinstall`, a `vite.config.ts`, or a test file is enough,
  and Ditto explicitly runs installs and dev servers.
- Extensions bypass tools entirely (§5.5).
- Cloudflare's own guidance is unambiguous:
  "For complete isolation, use separate sandboxes per user" and
  "Isolate end users with separate sandboxes, not sessions inside one sandbox."

What actually enforces a worktree boundary: **a separate sandbox per isolation
unit.** Second-best, unverified as available in this SDK: OS-level isolation
inside the container (per-session uid + `chmod`, mount namespaces, bind mounts).
**UNVERIFIED** whether the Cloudflare sandbox image permits per-process uid
separation or namespace manipulation; the SDK exposes no API for it.

The user's hypothesis — "one sandbox per project is acceptable **iff** worktrees
give concurrency organisation, plus a guardrail stopping the agent from touching
another worktree, maybe by disabling the bash tool" — is **half right**. Worktrees
do give concurrency organisation; that part is sound and Ditto's docs already
describe the residual limits accurately ("all sessions still share one sandbox
container process space"). The guardrail half is wrong: tool removal is a
capability reduction, not an isolation mechanism.

Mitigating context: the blast radius of #5 is **same-user only**. A user reading
their own other sessions' chat history is a real integrity problem for parallel
agent work and a real confidentiality problem if sessions are ever shared, but it
is not cross-tenant. Ranked against #1, it is second-order.

### 6.6 Comparable products

Only one primary source exists, and Cloudflare publishes it:
[Run Devin Outposts on Cloudflare](https://developers.cloudflare.com/sandbox/tutorials/devin-outposts/)
(updated 2026-07-21), verbatim:

> "Each Devin session runs in its own isolated sandbox backed by Cloudflare
> Containers."
> "**Start:** Each pending or running session receives its own container."
> "**Suspend:** When a session suspends, the container archives `/root`,
> `/workspace`, and `/opt/devin-persistent` to R2. The container restores the
> checkpoint when the session resumes."
> "**Terminate:** When a session terminates, the worker removes its container and
> R2 checkpoint."

So a shipping commercial coding agent, deployed on this exact platform, uses
**one container per session** plus **R2 checkpoints per session** — matching the
proposal's component 7 and contradicting its component 6's shared-sandbox model.

No architecture documents from other coding-agent vendors were found as primary
sources. Nothing further is claimed.

---

## 7. Trusted Git Executor

### 7.1 Where it can live

| Location | Verdict | Why |
|---|---|---|
| Inside a DO or the Worker, running `git` | **Not viable** | `git` is a binary. `node:child_process` is a non-functional stub in workerd. `node:fs` is an in-memory VFS whose `/tmp` is per-request. No path to running git |
| Inside the Worker/DO, using GitHub's REST Git Data API | **Viable with caveats** | No binary needed. See §7.2 |
| A separate minimal trusted container (git + token, no user code) | **Viable** | Costs a second container class, image, lifecycle, and object-transfer path between it and the project sandbox |
| **The project sandbox, with the token injected by an outbound handler** | **Viable and cheapest** | Real `git push` over HTTPS on port 443 through `outboundByHost["github.com"]`. Cloudflare's outbound docs show exactly this, naming a handler `authenticatedGithub` that calls a helper to authenticate a git HTTPS request |

The fourth row is worth emphasising because it inverts the proposal's framing.
The proposal treats "sandbox must not hold the GitHub token" as requiring the
executor to move out. Outbound handlers let the **token** move out while the
**git binary** stays in. Ditto is already 90% of the way there: it already runs
credential-bearing fetch/push from a fresh temporary bare repo with code-owned
config and command-scoped env auth (`session-git.ts`); replacing the
env-supplied credential with an outbound handler removes the token from the
container while keeping every other control.

Caveat (INFERRED): the doc's `authenticateGitHttpsRequest` helper does not appear
in the published `@cloudflare/sandbox` or `@cloudflare/containers` dist for
`0.12.3`, `0.12.7`, or `0.13.0-next.738.2` — greps for the identifier return
nothing. It is likely example code the guide expects you to write. Writing a
handler that adds an `Authorization: Basic x-access-token:<token>` header to
`github.com` git-smart-HTTP requests is straightforward, but **UNVERIFIED** as a
shipped utility.

### 7.2 What the REST Git Data API can do without a git binary

All endpoints verified against
[GitHub REST docs](https://docs.github.com/en/rest/git/refs?apiVersion=2022-11-28),
fetched 2026-08-14:

| Operation | Endpoint |
|---|---|
| Create blob | `POST /repos/{owner}/{repo}/git/blobs` |
| Create tree | `POST /repos/{owner}/{repo}/git/trees` |
| Create commit | `POST /repos/{owner}/{repo}/git/commits` |
| Create ref | `POST /repos/{owner}/{repo}/git/refs` |
| Update ref | `PATCH /repos/{owner}/{repo}/git/refs/{ref}` |
| Create PR | `POST /repos/{owner}/{repo}/pulls` |

**Fast-forward enforcement**, which is the security-relevant part: `PATCH .../git/refs/{ref}`
takes `sha` (required) and `force` (boolean, optional). Per the docs, `force`
"Indicates whether to force the update or to make sure the update is a
fast-forward update"; when omitted or false the API "ensures you're not
overwriting work" and performs a fast-forward-only update. **Omitting `force` is
the non-force write primitive the proposal asks for.** VERIFIED.

### 7.3 Installation tokens

VERIFIED from
[Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app):

- **TTL: 1 hour.** "The installation access token will expire after 1 hour."
- Scope down with `repositories` / `repository_ids` (up to 500) — otherwise the
  token covers everything the installation was granted.
- Scope down with `permissions` — otherwise it carries all granted permissions.
  For Ditto's needs: `contents: write` (push/refs/blobs/trees/commits) and
  `pull_requests: write` (open PR).

Rate limits ([REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28)):

- Primary: 5,000 requests/hour minimum per installation; +50/hr per repo above
  20 repos and +50/hr per user above 20 users, capped at **12,500/hr**; 15,000/hr
  for Enterprise Cloud organisations.
- Secondary: **no more than 100 concurrent requests**; **900 points/minute** for
  REST; **80 content-generating requests/minute** and **500/hour**.

### 7.4 Is the Git Data API a realistic replacement for `git push`?

**No, for Ditto's workload.** INFERRED, from verified numbers:

- Every changed file is one blob create — a *content-generating* request. The
  secondary limit is **80/minute and 500/hour**. A single agent run that touches
  200 files exhausts 40% of the hourly content-creation budget for the whole
  installation.
- Trees must be constructed by the caller. Preserving unchanged subtrees requires
  reading the base tree recursively; a large monorepo tree is itself a large
  payload against the 100 KB / 2 MB / request-size envelope.
- Blob GET supports up to 100 MB; blob POST has no documented maximum, but
  base64 inflates payload by 4/3 and everything is buffered in a 128 MB isolate.
- A real `git push` transfers one packfile with delta compression, in one
  connection, and costs zero REST calls.

Verdict: the Git Data API is a good fit for **small, bounded, structured writes**
— a single-file commit, a ref update with fast-forward enforcement, a PR create.
It is a poor fit for **pushing an agent's working diff**. If push must not use a
git binary, the Git Data API is a downgrade; if the goal is only to keep the
token out of the container, the outbound handler achieves that while keeping the
packfile path.

**Architectural cost of a separate trusted container:** a second container class
and image, a second lifecycle to provision/sleep/restore, an object-transfer path
between the project sandbox and the git container (the objects must physically
move — today `session-git.ts` moves them between the worktree and a temp bare
repo *within one container*, which would become a cross-container transfer), and
a second cold-start on the critical path of every push. Against an outbound
handler, which is a static method on a class Ditto already deploys, this is a
large cost for the same confidentiality property.

---

## 8. Architecture evaluation

Three designs are evaluated:

- **(a) status quo on stable** — Pi in the sandbox, credentials in shell env.
- **(b) the full Brain proposal** — model loop in SessionBrain DO, ProjectBrain
  DO, AgentRun Workflow, credential-free sandbox.
- **(c) stay-in-sandbox + outbound handlers + per-session sandbox IDs** — solve
  the credential exposure with platform features.

### 8.1 Component-by-component verdict on the Brain proposal

| # | Component | Verdict | Reasoning |
|---|---|---|---|
| 1 | **Worker / tRPC** — auth, authz, validation, start/stop, returns fast | **Viable** | This is what Ditto already does. Cloudflare's own guidance: "use Workers as the stateless entry point that routes requests to Durable Objects when coordination is needed" |
| 2 | **D1** — canonical product/agent state, semantic events only | **Viable with caveats** | Single-threaded, ~1,000 q/s at 1 ms, writes are several ms. Fine at semantic-event granularity; would collapse at token granularity. Hard 10 GB ceiling that "cannot be further increased" — plan a retention policy. `batch()` is a real transaction with rollback |
| 3 | **SessionBrain DO** — runs the model loop, live control, dispatches tools, streams | **Viable-with-caveats, and probably the wrong home for the loop** | Mechanically fine: CPU resets to 30 s per incoming message (5 min configurable), wall time unbounded while I/O is in flight, 10,000 subrequests. Three real hazards: (i) the loop is almost entirely non-storage I/O, and "input gates only protect during storage operations" — every `await` on a model call or sandbox RPC lets another request interleave, so control messages (stop/follow-up) can land mid-turn and must be handled with explicit state, not assumed serialisation; (ii) 128 MB isolate memory shared with the conversation, tool outputs, and any buffered stream; (iii) "If you consume more than 30 seconds of compute **between incoming network requests**, there is a heightened chance that the individual Durable Object is evicted and reset" — a loop that is quiet between LLM calls is fine, but there is no shutdown hook, so all progress must be written incrementally. **The stronger objection is §5.2**: Pi cannot run here, so "SessionBrain runs the model loop" means abandoning `pi-coding-agent` for a hand-built `AgentHarness` on `pi-agent-core`. And Cloudflare's own reference agent puts the loop in the **Workflow**, using the DO only for streaming and state |
| 4 | **ProjectBrain DO** — sandbox lifecycle, worktrees, project locks, port allocation, checkpoint barriers | **Viable, and the strongest part of the proposal** | This is textbook DO usage: "Model your Durable Objects around your 'atom' of coordination." It replaces three ad-hoc mechanisms Ditto uses today — the D1 `previewLockToken` lease, the `/tmp` directory lock, and the generation-counter backup fence — with one serialised owner. `~1,000 req/s` per object is far above any per-project rate. A DO can call the Sandbox DO |
| 5 | **AgentRun Workflow** — one per run, survives disconnects, retries, cancellation, recovery, finalisation | **Viable with caveats** | Steps: 10,000 (25,000 configurable); CPU 30 s→5 min per step; wall clock per step unlimited; `terminate()`/`pause()`/`resume()`/`restart()`/`sendEvent()` exist; `create()` throws on duplicate ID, giving exactly-once instance creation. Caveats: **step results cap at 1 MiB** non-stream (an assistant turn with large tool output must be stored in R2/D1 and referenced); step bodies are **at-least-once**, so every shell mutation and every push needs the documented observe-then-act guard; step names are the cache key and must be deterministic; **a Workflow cannot stream to a browser** — that must go through a DO. Retention 30 days paid |
| 6 | **Project Sandbox** — disposable, untrusted, no model/GitHub/Cloudflare/D1/R2/control-plane credentials | **Viable, and consistent with the settled constraint** | The stated exclusion list does not mention project env vars, so keeping them is the user's own spec, not a contradiction. Achievable **without** the Brain via outbound handlers (§4.4). Note that "disposable" is already true whether Ditto likes it or not: "Local files from the old container are gone unless your app restored them" |
| 7 | **R2 checkpoints**, restore mounts ephemeral, handle retained and reapplied | **Viable — and already exactly what Ditto does** | "In production, the FUSE mount is lost when the sandbox sleeps or restarts. Re-restore from the backup handle to recover." VERIFIED verbatim. Ditto's `persistProjectSandbox Backup` generation fence already implements the handle-retention half. Two gaps: default TTL is 3 days (Ditto sets 365 d — **UNVERIFIED** whether values above the default are accepted), and "partially-written files may not be captured consistently," which argues for taking checkpoints at a quiesced barrier — precisely the "checkpoint barriers" ProjectBrain is proposed to own. `mountBucket()` is an unexplored alternative |
| 8 | **Trusted Git Executor** | **Viable, but the design as posed is the expensive answer** | Cannot run `git` in a DO or Worker (§7.1). REST Git Data API works for small structured writes and gives real fast-forward-only ref updates, but is a poor fit for pushing an agent diff against an 80/min, 500/hr content-creation secondary limit. A separate trusted container works at the cost of a second image, lifecycle, and cross-container object transfer. **An outbound handler achieves the same "token never enters the sandbox" property with a static method** |

### 8.2 Comparing (a), (b), (c)

| Threat / property | (a) status quo | (b) Brain | (c) outbound handlers + per-session sandbox |
|---|---|---|---|
| Operator `OPENCODE_API_KEY` in untrusted container | ❌ exposed | ✅ removed | ✅ removed |
| Account provider credential in container | ❌ exposed | ✅ removed | ✅ removed (API-key providers; OAuth needs work) |
| Git callback JWT in container | ❌ exposed | ✅ removed | ✅ removed |
| `/proc/<pid>/environ` scrub bypass | ❌ live | ✅ moot | ✅ moot for platform creds |
| Project env vars in container | in scope | in scope | in scope |
| Egress allowlist / deny-by-default | ❌ none | ❌ none (sandbox still open unless also configured) | ✅ `enableInternet=false` + `allowedHosts` |
| Cross-session filesystem/process access | ❌ shared | ❌ still shared | ✅ removed by per-session sandbox IDs |
| Repo-supplied `.pi/extensions` RCE | ❌ live | ✅ moot if Pi leaves the container | ❌ still live — needs `noExtensions` |
| Run survives browser disconnect | ✅ already | ✅ | ✅ already |
| Run survives Worker eviction / container replace | ❌ | ✅ | ❌ |
| Deterministic retry / replay of a failed run | ❌ | ✅ | ❌ |
| Token streaming to browser | ✅ SSE | needs DO + WebSocket | ✅ SSE |
| Worker-side secret redaction preserved | ✅ | ✅ | ✅ |
| Keeps `pi-coding-agent` | ✅ | ❌ (see §5.2) | ✅ |
| Sandbox SDK call sites touched | 0 | few | few, plus per-session ID plumbing |
| Worker/orchestration code rewritten | 0 | most of `agent-run-service`, `agent-run`, `agent-control-service`, SSE, D1 event model | small |

### 8.3 The consequential read

On the **security** axis the two designs are equivalent for the three
platform-credential exposures, and (c) is *strictly better* on two exposures (b)
does not address: egress control and cross-session filesystem isolation. (c)
achieves this with a Sandbox subclass, an egress policy, and per-session sandbox
IDs — no change to the model loop, no change to Pi, no change to D1, no change to
streaming.

What (b) buys that (c) does not is **durability**: a run that survives Worker
eviction and container replacement, deterministic retry of a failed step, and a
queryable, resumable run record. Those are real product properties — today a
`pnpm install` that outlives the Worker invocation, or a container replaced
mid-run, produces a `failed` assistant row and lost work. But they are
**reliability** properties, not security properties.

The proposal's stated premise — "running the Pi harness inside the untrusted
Sandbox is a security flaw, because the harness needs user-level and
application-level tokens" — is **correct in its diagnosis and wrong in its
implied remedy**. The diagnosis is confirmed by Cloudflare's own security page,
which describes Ditto's exact current pattern as an exposure and names the fix.
The fix Cloudflare names is not "move the loop"; it is "move the credential."

If durable execution is *also* wanted, that is a separate and legitimate
motivation for (b) — and it should be argued on those terms, because the
credential argument does not carry it.

---

## 9. Open questions and risks

Explicitly unresolved. Each needs a spike or a decision.

1. **Does Pi's undici stack accept the Cloudflare interception CA?**
   `configureHttpDispatcher()` installs `EnvHttpProxyAgent` with `allowH2: false`
   and calls `undici.install()`. Cloudflare installs an ephemeral CA and "makes a
   best effort to trust this CA automatically regardless of distro." Spike: run
   one Pi call through an `outboundByHost` handler and confirm the TLS handshake
   and the injected header. This single experiment decides whether (c) is real.

2. **OAuth-based providers under outbound handlers.** Injecting a bearer is easy;
   Ditto's OAuth refresh lease and the `ditto:no-refresh` sentinel assume the
   credential lives in the runner. Where does refresh happen if the runner never
   sees a token?

3. **Is `createBackup({ttl: 365 days})` actually honoured?** Documented default is
   3 days; `sandbox-backup.ts:4` sets 365 days. No documented maximum. If a cap is
   silently applied, restores fail with `BackupExpiredError` after the real TTL.

4. **Per-session sandbox economics for Ditto specifically.** Container billing is
   provisioned-memory-and-disk while awake, and `sleepAfter` defaults to 10 m. The
   dominant cost is not the container but the **repeated clone + dependency
   install** per cold session — today amortised by the shared `/workspace` tree and
   the `node_modules` symlink. Per-session sandboxes destroy that sharing. Measure
   before committing.

5. **`max_instances: 1` and `instance_type: "lite"`.** Per-session sandboxes are
   currently *impossible* — one running container per deployment. And `lite` is
   256 MiB / 2 GB disk, which is tight for Node + a coding agent + `pnpm install`
   + a Vite dev server. **UNVERIFIED** what Ditto's actual container memory
   headroom is today; this should be measured before any isolation decision.

6. **Does the sandbox image allow per-process uid separation or mount
   namespaces?** If yes, worktree isolation inside one container becomes a real
   (if weaker) option. The SDK exposes no API for it. UNVERIFIED.

7. **DNS exfiltration under `enableInternet = false`.** Docs say "Only ports 80,
   443, and DNS are available, and DNS queries use Cloudflare's DNS servers." They
   do not say DNS is filtered or logged. A determined exfiltrator with the user's
   own env vars can encode them in DNS labels. Under the settled constraint this
   is unpreventable in every design considered — it is a **shared limitation, not
   a differentiator**. Worth stating explicitly in whatever design is chosen.

8. **Non-HTTP egress.** "Traffic on ports other than 80 and 443 is never routed
   through `outbound` or `outboundByHost`." With `enableInternet = false` those
   ports are unavailable, so the combination is coherent. With
   `enableInternet = true` plus handlers, non-HTTP egress is unfiltered. Any
   allowlist design must set `enableInternet = false`.

9. **Where does the loop belong: SessionBrain DO or AgentRun Workflow?** The
   proposal says DO. Cloudflare's own durable-agent reference says Workflow, with
   the DO owning streaming and state. The Workflow gives per-turn and per-tool
   checkpointing for free; the DO gives streaming and live control for free. A
   hybrid means every turn crosses a Workflow→DO boundary. Unresolved, and it is
   the central design question inside (b).

10. **`pi-coding-agent` vs `pi-agent-core`.** If the loop moves to a DO, Ditto
    gives up resource loading, extension hosting, compaction wiring, the
    `AgentSession` API, and the built-in tool implementations, in exchange for
    `AgentHarness` + a custom `ExecutionEnv`. That is a substantial reimplementation
    of things Ditto currently gets for free, and it couples Ditto to Pi's internal
    layering across future versions. Size this before committing.

11. **Streaming redaction under any new transport.** `StreamingSecretRedactor`
    holds back partial secrets across chunk boundaries in the Worker. Any design
    where output reaches the browser without passing through the Worker — a
    `terminal.connect(request)` handoff, or a DO that broadcasts raw model
    deltas — loses that control. Whatever is chosen, the redaction boundary must
    stay on the server side of the last hop.

12. **Ordering of independent fixes.** Three items in this document are cheap,
    independent of any architecture, and currently live: the `/proc` scrub bypass
    (§6.3), the repo-supplied `.pi/extensions` execution path (§5.5), and the
    absence of any egress policy. None of them require a decision between (a),
    (b), and (c).

---

## 10. Sources

All fetched **2026-08-14**.

**Cloudflare — Durable Objects**
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- https://developers.cloudflare.com/durable-objects/llms.txt

**Cloudflare — Workers**
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/

**Cloudflare — Workflows**
- https://developers.cloudflare.com/workflows/
- https://developers.cloudflare.com/workflows/reference/limits/
- https://developers.cloudflare.com/workflows/reference/pricing/
- https://developers.cloudflare.com/workflows/build/rules-of-workflows/
- https://developers.cloudflare.com/workflows/build/workers-api/
- https://developers.cloudflare.com/workflows/get-started/durable-agents/

**Cloudflare — Sandbox SDK**
- https://developers.cloudflare.com/sandbox/1-0-preview/
- https://developers.cloudflare.com/sandbox/1-0-preview/lifecycle/
- https://developers.cloudflare.com/sandbox/concepts/security/
- https://developers.cloudflare.com/sandbox/guides/outbound-traffic/
- https://developers.cloudflare.com/sandbox/api/backups/
- https://developers.cloudflare.com/sandbox/api/storage/
- https://developers.cloudflare.com/sandbox/configuration/sandbox-options/
- https://developers.cloudflare.com/sandbox/platform/limits/
- https://developers.cloudflare.com/sandbox/tutorials/devin-outposts/
- https://developers.cloudflare.com/sandbox/llms.txt

**Cloudflare — Containers**
- https://developers.cloudflare.com/containers/platform-details/limits/
- https://developers.cloudflare.com/containers/pricing/

**Cloudflare — D1**
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/worker-api/d1-database/

**GitHub**
- https://docs.github.com/en/rest/git/refs?apiVersion=2022-11-28
- https://docs.github.com/en/rest/git/blobs?apiVersion=2022-11-28
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28

**Linux**
- https://man7.org/linux/man-pages/man5/proc_pid_environ.5.html

**npm registry**
- https://registry.npmjs.org/@cloudflare/sandbox — dist-tags and version history
- https://registry.npmjs.org/@cloudflare/containers — `0.3.7`
- tarballs unpacked and grepped for `0.12.7` and `0.13.0-next.738.2`

**Pi harness — first-party docs shipped inside the installed npm package**
(`packages/sandbox-runner/node_modules/@earendil-works/pi-coding-agent@0.80.10/`)
- `docs/sdk.md`
- `docs/security.md`
- `docs/extensions.md`
- `docs/containerization.md`
- `docs/rpc.md`
- `examples/extensions/gondolin/index.ts`

**Pi harness — shipped source read directly**
- `@earendil-works/pi-coding-agent@0.80.10` — `dist/index.js`, `dist/main.js`,
  `dist/config.js`, `dist/core/sdk.js`, `dist/core/sdk.d.ts`,
  `dist/core/resource-loader.js`, `dist/core/resource-loader.d.ts`,
  `dist/core/settings-manager.js`, `dist/core/http-dispatcher.js`,
  `dist/rpc-entry.js`
- `@earendil-works/pi-agent-core@0.80.10` — `dist/index.js`,
  `dist/harness/types.d.ts`, `dist/harness/agent-harness.d.ts`,
  `dist/proxy.d.ts`, `dist/node.d.ts`, `dist/harness/env/nodejs.js`
- `@earendil-works/pi-ai@0.80.10` — `package.json`, dist import survey

**Ditto source at `brain@57a29d5`**
- `apps/web/package.json`, `packages/sandbox-runner/package.json`, `Dockerfile`,
  `alchemy.run.ts`, `apps/web/.alchemy/local/wrangler.jsonc`
- `apps/web/src/server.ts`
- `apps/web/src/lib/agent-run.ts`, `agent-run-service.ts`,
  `agent-control-service.ts`, `agent-git-jwt.ts`, `agent-git-handler.ts`,
  `sandbox-bootstrap.ts`, `sandbox-backup.ts`,
  `account-provider-credentials.ts`
- `packages/sandbox-runner/src/cli.ts`, `run-agent.ts`, `runner-model.ts`,
  `ditto-git-tools.ts`
- `.agents/skills/sandbox-next/SKILL.md`,
  `.agents/skills/sandbox-migrate-to-next/SKILL.md`
