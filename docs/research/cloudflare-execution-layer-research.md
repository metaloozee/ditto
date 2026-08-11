# Cloudflare execution-layer architecture research

## Decision

Use **Cloudflare Workflows as the durable owner of an agent run**, while keeping:

- the existing **Worker** as the authenticated API/control plane;
- the existing **Sandbox Durable Object + Container** as the repository and process execution plane;
- **D1** as the product/run source of truth; and
- **R2** as the workspace checkpoint/backup store.

Do **not** make a new Durable Object execute a foreground `execStream()` call for the whole agent run. A per-run Durable Object is a viable later coordinator for locking, control, and live connections, but it does not by itself turn a long-running external process into durable execution.

Use **Queues only as an optional admission buffer** when burst smoothing or backpressure becomes necessary. Do not use a Queue consumer as the primary owner of a run.

Do not adopt the Agents SDK for this migration. It is a good future replacement for Ditto's custom agent/session runtime, but it would add another Durable Object/state model on top of the current D1 + PI + Sandbox design.

The important distinction is:

> Workflows own the **run lifecycle**; Sandbox/Container owns the **live process**. Neither the Worker HTTP request nor a browser SSE connection owns the run.

## The correction to the current assumption

The commonly quoted Cloudflare numbers are real but describe **CPU time**, not ordinary HTTP wall-clock duration:

- Workers Free: **10 ms CPU time per HTTP request**.
- Workers Paid: **30 seconds CPU by default**, configurable to **5 minutes / 300,000 ms**.
- HTTP wall-clock duration: **no hard limit while the client remains connected**, including while streaming a response.
- After the response completes or the client disconnects, work associated with that request **may be cancelled**. `ctx.waitUntil()` extends that lifetime by **up to 30 seconds**, not indefinitely.

Sources: [Workers limits — CPU time](https://developers.cloudflare.com/workers/platform/limits/#cpu-time), [Workers limits — duration](https://developers.cloudflare.com/workers/platform/limits/#duration).

Therefore, the current Worker-owned path can run a long agent while the browser remains attached and the Worker mostly waits on Sandbox I/O. It is not a reliable background execution owner after browser disconnect, Worker replacement, runtime failure, or response completion. This is exactly the residual risk documented by Plan 033.

## Repository state reviewed

The current implementation is:

```text
Browser
  -> Worker POST /api/agent/stream
  -> prepareAgentRun / D1 message lifecycle
  -> executeAgentRun (awaited inside the SSE stream)
  -> Sandbox createSession + execStream
  -> PI runner in the Container
  -> Worker redaction, D1 terminal persistence, R2 backup
```

Relevant evidence:

- `apps/web/src/routes/api.agent.stream.ts` still awaits `executeAgentRun` inside the response stream.
- `apps/web/src/lib/agent-run.ts` uses a Sandbox shell session and foreground `execStream()` with a 600-second command timeout.
- `apps/web/src/lib/agent-run-service.ts` owns terminal assistant persistence and post-run backup, but the service only completes while its Worker invocation survives.
- `apps/web/src/server.ts` exports the Sandbox class and routes preview traffic through `proxyToSandbox`.
- `alchemy.run.ts` owns one Sandbox Container resource (`instanceType: "lite"`, `maxInstances: 1`) and the existing D1/R2/Worker graph.
- `getProjectSandbox()` uses a stable project sandbox ID and RPC transport.
- The current live schema has `projects`, `workspace_sessions`, and `messages`, but no durable `agent_runs` or event-journal table. Historical migrations contain older run tables that were later dropped; they are not current schema authority.
- `plans/033-detach-agent-sse-delivery.md` explicitly says the local detach fix is not a durable-execution redesign. Its deployed post-disconnect smoke was not run.
- Plans 034–036 address sandbox allocation ownership, workload isolation, runner integrity, and runner-contract parity. They do not solve request-owned agent execution.

## Cloudflare primitives

### 1. Worker + direct Sandbox execution

**What it provides:** low-latency auth, validation, D1 access, credential minting, SSE, and direct Sandbox SDK calls.

**Why it is insufficient as the sole owner:** a streamed HTTP invocation can remain alive while its client is connected, but Cloudflare may cancel associated work after disconnect. `waitUntil()` gives only a 30-second extension. A browser cancellation therefore cannot be treated as a durable execution boundary.

**Verdict:** retain for API and delivery; remove it as the only run owner.

### 2. Workflows

Cloudflare Workflows is the best fit for the run lifecycle:

- a Workflow instance can run indefinitely as long as it stays within step and CPU limits;
- completed `step.do()` results are persisted and skipped on replay;
- steps have retries and configurable timeouts;
- `step.sleep()` can pause for up to 365 days;
- `step.waitForEvent()` can wait for up to 365 days;
- Workflows hibernate, so important state must be returned from steps rather than held in local variables;
- a Workflow instance can be inspected, paused, resumed, restarted, or terminated through its binding API.

Current standalone Workflow limits include:

| Limit | Free | Paid |
|---|---:|---:|
| Active CPU per step | 10 ms | 30 s default, configurable to 5 min |
| Wall-clock per step | Unlimited | Unlimited |
| Maximum steps | 1,024 | 10,000 default, configurable to 25,000 |
| Persisted instance state | 100 MB | 1 GB |
| Non-stream step result/event payload | 1 MiB | 1 MiB |
| `step.sleep` | 365 days | 365 days |
| Concurrent running instances | 100 | 50,000 |

Sources: [Workflow limits](https://developers.cloudflare.com/workflows/reference/limits/), [Workflow API](https://developers.cloudflare.com/workflows/build/workers-api/), [sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/).

There are three different timeout concepts that must not be conflated:

1. platform wall-clock duration per step is documented as unlimited;
2. the retry guide documents a default per-attempt step timeout of 10 minutes and shows configurable timeouts; and
3. active JavaScript CPU remains subject to the Worker CPU limit.

The Agents SDK `AgentWorkflow` page currently summarizes a 30-minute step limit and 10 MB state limit. That page is not the standalone Workflow limits reference and should not be treated as a universal limit for a plain `WorkflowEntrypoint`. Verify the exact deployed compatibility/version when implementing.

Sources: [Workflow retry/timeout guide](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/), [Agents SDK Workflow API](https://developers.cloudflare.com/agents/runtime/execution/run-workflows/).

**Critical limitation:** putting the entire current `execStream()` call inside one Workflow step would still be a poor design. The step may retry after an ambiguous failure, while the external process may already have started. Workflows documentation explicitly warns against one giant step and requires idempotent side effects.

Source: [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/).

**Verdict:** primary run owner, provided Sandbox execution is converted to an idempotent background-process/checkpoint protocol rather than a single foreground stream.

### 3. Durable Objects

Durable Objects are excellent for per-entity coordination:

- one globally addressable, single-threaded instance;
- strongly consistent private storage;
- RPC methods and WebSockets;
- alarms for future work; and
- horizontal scaling by creating one object per logical run/project/session.

The limits matter:

- DO CPU is 30 seconds by default and configurable to 5 minutes;
- an alarm handler has a 15-minute wall-clock limit;
- each object has one alarm slot;
- alarms are at-least-once and automatically retry up to six times with exponential backoff;
- RPC/HTTP wall-clock time is unlimited only while the caller remains connected and the request is in flight.

Sources: [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [Alarms API](https://developers.cloudflare.com/durable-objects/api/alarms/), [DO lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/).

A new `AgentRun` DO could start a Sandbox background process, persist its process ID and event cursor, poll with alarms, accept Stop, and fan out live updates. That is a valid architecture. However, it would duplicate much of the durable run ledger/retry logic that Workflows already supplies, while still requiring custom recovery for the external process.

Also, Sandbox already uses a Durable Object internally. A new DO would coordinate the existing Sandbox DO; it would not replace the Sandbox's container-owning DO.

**Verdict:** useful coordination/control layer; not the first primary execution owner.

### 4. Queues

Queues provide durable asynchronous delivery, but a Queue consumer is still a bounded Worker invocation:

- consumer wall-clock duration: 15 minutes;
- consumer CPU: same Worker CPU model, configurable to 5 minutes;
- message size: 128 KB;
- maximum consumer batch: 100 messages;
- retention: configurable up to 14 days;
- delivery: at least once, so duplicates are possible.

Sources: [Queue limits](https://developers.cloudflare.com/queues/platform/limits/), [Queue JavaScript APIs](https://developers.cloudflare.com/queues/configuration/javascript-apis/), [Queue delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/).

A Queue is useful for:

```text
Worker -> Queue { runId } -> consumer -> idempotently create Workflow instance
```

The message should contain an opaque run reference, not the prompt, credentials, or repository state. The consumer should acknowledge only after Workflow acceptance, and duplicate delivery must be harmless.

**Verdict:** optional ingress/backpressure mechanism; not the run owner.

### 5. Sandbox and Containers

The current Sandbox composition is already the correct execution substrate:

```text
Worker -> Sandbox Durable Object -> isolated Container VM -> PI runner/process
```

Cloudflare documents `startProcess()` specifically for long-running background work. It returns immediately and exposes process status, logs, wait-for-exit, and kill operations. `exec()`/`execStream()` are foreground command APIs.

Sources: [Sandbox architecture](https://developers.cloudflare.com/sandbox/concepts/architecture/), [background processes](https://developers.cloudflare.com/sandbox/guides/background-processes/), [commands API](https://developers.cloudflare.com/sandbox/api/commands/).

Sandbox lifecycle is not itself a durable job ledger:

- default inactivity sleep is 10 minutes;
- when a sandbox stops, files, processes, shell state, and interpreter contexts are lost;
- `keepAlive: true` sends heartbeats every 30 seconds and prevents automatic idle sleep;
- `destroy()` terminates processes and permanently deletes sandbox state;
- `keepAlive` prevents idle shutdown but cannot prevent deployment, host restart, OOM, or other runtime replacement.

Sources: [Sandbox lifecycle concept](https://developers.cloudflare.com/sandbox/concepts/sandboxes/), [Sandbox options](https://developers.cloudflare.com/sandbox/configuration/sandbox-options/), [Sandbox lifecycle API](https://developers.cloudflare.com/sandbox/api/lifecycle/), [Container architecture](https://developers.cloudflare.com/containers/platform-details/architecture/), [Container FAQ](https://developers.cloudflare.com/containers/faq/).

Raw Containers have no fixed maximum runtime, but Cloudflare does not guarantee that an instance will remain on one host for any fixed period. Container disk is ephemeral; shutdown sends `SIGTERM`, followed by `SIGKILL` after 15 minutes. Sandbox's existing R2 backup/restore boundary is therefore still required.

The current `lite` instance is only 1/16 vCPU, 256 MiB memory, and 2 GB disk. That may become an agent/build performance bottleneck, but changing instance size would not solve execution ownership.

Source: [Container limits and instance types](https://developers.cloudflare.com/containers/platform-details/limits/).

**Verdict:** keep Sandbox/Container for live repository execution; use `startProcess()` and durable orchestration above it.

### 6. Agents SDK

Cloudflare's current long-running-agent guidance distinguishes:

- Agents as durable identities backed by Durable Objects;
- `keepAlive`/fibers for active work measured in minutes;
- schedules and callbacks for work that can hibernate between events; and
- Workflows for heavyweight multi-step jobs lasting minutes to hours.

The official durable-agent example combines an `Agent` for real-time communication with an `AgentWorkflow` for checkpointed LLM/tool steps. It does not provide a first-party Sandbox + Workflow runner pattern.

Sources: [Long-running Agents](https://developers.cloudflare.com/agents/concepts/agentic-patterns/long-running-agents/), [run Workflows from Agents](https://developers.cloudflare.com/agents/runtime/execution/run-workflows/), [durable AI agent example](https://developers.cloudflare.com/workflows/get-started/durable-agents/).

Agents SDK would be appropriate if Ditto chooses to replace its custom D1/SSE/PI session model with an Agent-per-project or Agent-per-session model. It is not needed to solve the current request-lifetime problem.

**Verdict:** future product/runtime option; not the minimal migration.

## Recommended architecture

```text
Browser
  | authenticated start/status/events/control
  v
Worker API/control plane
  | 1. validate/authenticate
  | 2. create D1 run + message records
  | 3. Workflow.create({ id: runId, params: { runId } })
  | 4. return 202 + runId
  v
Workflow instance: durable owner of the run
  | short, retryable, idempotent steps
  v
Existing project Sandbox DO
  | startProcess(processId = runId)
  v
Existing Sandbox Container
  | PI runner in the session worktree
  v
D1 run state + bounded redacted event journal + R2 workspace backup
  ^
  | reconnectable status/event reads
Worker API -> authenticated Stop -> Workflow termination/compensation -> kill exact process
```

### Run lifecycle

1. **Accept:** the Worker authenticates, validates the model, establishes the session/worktree prerequisites, creates a durable run record, and returns immediately after `Workflow.create()` succeeds. Do not wait for the agent process in the HTTP handler.
2. **Claim:** the Workflow claims the D1 run with a compare-and-set transition. Its payload should contain only opaque identifiers; load the prompt from the authorized D1 message/run record. Never put provider credentials in Workflow parameters or returned step state.
3. **Prepare:** the Workflow calls the existing sandbox provisioning/readiness path. Every retry must observe the existing project/sandbox state before doing work. Preserve Plans 034–036's ownership and runner-integrity gates.
4. **Start:** start the runner with Sandbox `startProcess()` using a deterministic process ID derived from `runId`. Before starting, check the D1 run record and Sandbox process state so a retried start cannot create a second agent process. Do not persist the SDK `Process` object; persist only serializable identifiers and state.
5. **Monitor:** use short Workflow steps plus `step.sleep()` to poll process status and consume bounded output/checkpoints. A long-lived `streamProcessLogs()` connection should not be the only record of progress. The runner needs a durable, bounded event/checkpoint protocol that preserves the existing redaction boundary; raw stdout must not be copied into backups, D1, or client events without redaction.
6. **Recover:** if the Workflow restarts, reconstruct the Sandbox handle from the stable sandbox ID and reconstruct the process handle from `runId`. If the process is gone, use the last checkpoint/PI JSONL/R2 backup to decide whether to resume, fail, or start a new fenced attempt. Never blindly restart after an ambiguous `startProcess()` failure.
7. **Settle:** atomically settle all started assistant rows, persist the versioned R2 workspace backup, record the terminal run state, then release the run's sandbox activity lease and clean up the process/session. Cleanup must not destroy the shared project sandbox while previews or other project work still own it.
8. **Deliver:** SSE becomes an attachable delivery channel. A disconnect only removes the subscriber. Reconnection reads terminal state and events from a cursor-backed D1/R2 source. A WebSocket/Agent DO can be added later if live fan-out needs it; it is not required for durable execution.
9. **Stop:** authenticated Stop marks the run cancelled and invokes a Workflow termination/compensation path that kills only the exact run process. It must settle the assistant row and release the sandbox activity lease. Browser cancellation remains delivery-only.

## Important design constraints

### The external process must be idempotently addressable

Workflows retry steps. Starting a process is an external side effect. Use a stable `runId`/process ID and a D1 claim plus Sandbox process lookup before starting. The invariant is:

```text
one run ID -> at most one live runner process
```

### `keepAlive` must be run-scoped, not global

The project Sandbox is shared with session worktrees and live previews. Setting `keepAlive: true` globally would retain every project container indefinitely; setting it false at run completion could disrupt a preview or another active operation. Use a run-scoped activity lease/refcount or poll often enough to keep the Sandbox active, and release only when no project operation still owns it.

### Sandbox persistence is not Workflow persistence

Workflow state can survive Workflow replay while the container filesystem can disappear on Sandbox stop/restart. Keep D1/Workflow state authoritative and retain R2 restore. The PI JSONL/session files are useful checkpoints, not proof that a live process survived.

### Streaming output needs a new durable source

The current Worker redacts runner output before SSE and D1 terminal persistence. Moving execution into a Workflow must preserve that boundary. Do not solve reconnection by storing raw process logs in the Sandbox backup or Workflow state. A practical design is a bounded sequence-numbered event journal with redaction before persistence, plus periodic runner checkpoints and a final assistant result in D1.

### Workflows are not a magic Sandbox adapter

There is no first-party Cloudflare document that guarantees a Sandbox process will be resumed by a retried Workflow step. The composition is supported by the general binding model, but the process-ID, checkpoint, keep-alive, restart, and cleanup behavior must be proven in a deployed disposable environment.

## Decision matrix

| Option | Survives browser disconnect | Runs PI in Sandbox | Built-in durable replay | Main weakness | Decision |
|---|---:|---:|---:|---|---|
| Worker + SSE + `execStream` | No guarantee | Yes | No | Request owns terminal persistence | API/delivery only |
| Workflow + Sandbox `startProcess` | Yes, for Workflow state | Yes | Yes, per step | Requires process/checkpoint protocol | **Primary** |
| Per-run DO + Sandbox `startProcess` + alarms | Yes, if state/checkpoints are correct | Yes | Custom storage/alarm recovery | New durable engine; alarm/CPU limits | Secondary option |
| Queue consumer + Sandbox | Queue message survives | Yes | Queue retry only | 15-minute consumer; no step state | Optional ingress |
| Raw Container + custom runner service | Container can run while alive | Yes | Container hooks only | Ephemeral disk; loses Sandbox abstractions | Reject for now |
| Agents SDK + AgentWorkflow + Sandbox | Yes | Yes | Strong agent-oriented model | Duplicates current runtime/state model | Future rewrite |

## Implementation recommendation for the plans

Create a new architecture/implementation plan rather than expanding Plan 033 or hiding the gap with `waitUntil()`.

Suggested order:

1. Keep Plans 034–036 focused on Sandbox allocation ownership, workload trust, and runner integrity. They are prerequisites for safely launching a detached runner, but they are not the execution owner.
2. Add a small deployed feasibility spike for `Workflow -> Sandbox.startProcess()` with a deterministic process ID, no credentials, and a disposable long-running command.
3. Add the durable run ledger/event cursor and Workflow binding through the existing Alchemy deployment graph. Alchemy 0.93.x in this checkout already contains a `Workflow()` Cloudflare resource and maps it to a Wrangler workflow binding; the current `alchemy.run.ts` does not instantiate one yet.
4. Move one agent path from foreground `execStream()` to Workflow-owned `startProcess()`/polling. Keep the current runner protocol and redaction behavior until the durable event contract is proven.
5. Replace the current SSE route with start/attach/status semantics. Preserve the existing authenticated control and Stop policy.
6. Run production-like failure tests before removing the old foreground path.

## Required feasibility tests

Do not mark the architecture complete until a disposable deployed environment proves:

- a run continues and reaches terminal D1 assistant state after the browser disconnects;
- the Workflow can be restarted or a step can retry without creating a duplicate runner process;
- a lost/expired Sandbox process is detected and the run fails or resumes according to a checkpoint, rather than hanging forever;
- Sandbox sleep/restart and R2 restore do not silently lose an accepted run;
- Stop kills the exact process and cannot kill another session's process;
- event reconnect resumes from a sequence cursor without duplicating assistant deltas;
- no prompt, provider credential, Git token, raw secret-bearing output, or callback token enters Workflow parameters, persisted step state, R2 backups, or client events;
- terminal assistant persistence, backup generation, and cleanup are idempotent under retries and ambiguous responses.

## Sources

Only first-party Cloudflare documentation and repository/package source were used:

- [Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)
- [Workflows API](https://developers.cloudflare.com/workflows/build/workers-api/)
- [Workflow sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)
- [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
- [Workflow events and parameters](https://developers.cloudflare.com/workflows/build/events-and-parameters/)
- [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Durable Object best practices](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Sandbox architecture](https://developers.cloudflare.com/sandbox/concepts/architecture/)
- [Sandbox lifecycle](https://developers.cloudflare.com/sandbox/concepts/sandboxes/)
- [Sandbox background processes](https://developers.cloudflare.com/sandbox/guides/background-processes/)
- [Sandbox commands API](https://developers.cloudflare.com/sandbox/api/commands/)
- [Sandbox options](https://developers.cloudflare.com/sandbox/configuration/sandbox-options/)
- [Sandbox sessions](https://developers.cloudflare.com/sandbox/api/sessions/)
- [Container architecture](https://developers.cloudflare.com/containers/platform-details/architecture/)
- [Container limits and instance types](https://developers.cloudflare.com/containers/platform-details/limits/)
- [Container class API](https://developers.cloudflare.com/containers/container-class/)
- [Container FAQ](https://developers.cloudflare.com/containers/faq/)
- [Queue limits](https://developers.cloudflare.com/queues/platform/limits/)
- [Queue JavaScript APIs](https://developers.cloudflare.com/queues/configuration/javascript-apis/)
- [Queue delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Agents long-running patterns](https://developers.cloudflare.com/agents/concepts/agentic-patterns/long-running-agents/)
- [Agents + Workflows](https://developers.cloudflare.com/agents/runtime/execution/run-workflows/)
- [Cloudflare durable AI agent example](https://developers.cloudflare.com/workflows/get-started/durable-agents/)

Repository evidence: `apps/web/src/lib/agent-run.ts`, `apps/web/src/lib/agent-run-service.ts`, `apps/web/src/routes/api.agent.stream.ts`, `apps/web/src/lib/sandbox-bootstrap.ts`, `apps/web/src/lib/project-sandbox.ts`, `apps/web/src/db/schema.ts`, `alchemy.run.ts`, `plans/033-detach-agent-sse-delivery.md`, and `plans/README.md`.
