# A trusted session runtime for Ditto

Status: research rationale, superseded for implementation by the [canonical trusted workspace-session runtime specification](../specs/trusted-session-runtime.md), accepted 2026-09-06.

The specification resolves the remaining design choices in this report. This research is not a competing implementation contract.

Written and reviewed 2026-09-05. This revision replaces the earlier sketch. The review confirmed the runtime separation but found missing recovery and authorization protocols.

## Recommendation

Keep full Pi in a trusted Node.js container. Run repository commands in a separate untrusted Cloudflare Sandbox. Use the trusted container's Durable Object as the workspace-session coordinator.

That gives each workspace session two application Durable Object identities and up to two running containers:

1. `SessionRuntime extends Container` coordinates the session and manages a trusted Node container running Pi.
2. The existing `Sandbox` Durable Object manages the untrusted execution container.

These are logical application identities, not a count of every platform-internal object. A Durable Object is not a Node process. The coordinator and Pi run in different runtimes, even when one class manages their lifecycle.

This is my preferred candidate if preserving `@earendil-works/pi-coding-agent` matters. It is not the only sound architecture. A Worker-compatible agent loop would avoid the trusted Node container, at the cost of adapting or replacing the coding-agent layer.

The extra container buys process isolation between Pi and repository code. It does not buy automatic recovery. Ditto must implement that separately.

## What the review corrected

### The current Worker supervises Pi, but does not run its model loop

`apps/web/src/routes/api.agent.stream.ts:84-138` awaits `executeAgentRun` inside the SSE stream's `start()` callback. `apps/web/src/lib/agent-run.ts:257-267` starts the sandbox runner through `execStream` and consumes its output. Pi makes the model and tool decisions inside the sandbox.

The application deliberately detaches output delivery on browser disconnect rather than requesting Stop. That is application intent, not a platform lifetime guarantee.

[Workers limits](https://developers.cloudflare.com/workers/platform/limits/) distinguish CPU time from wall time. HTTP Workers can stream while a client stays connected. Request-associated work may be canceled after disconnect, and `waitUntil` extends execution only briefly. Removing an abort signal does not make the relay durable.

The earlier report also understated existing cleanup. `reclaimExpiredWorkLeases` in `apps/web/src/lib/workspace-runtime-capacity.ts:603-651` marks expired running work failed and settles its pending assistant. `drainOnce` calls that cleanup. Ditto has a failure-settlement path, not resumable agent execution.

### A tool ID and digest cannot restore Pi

The previous `Barrier` sketch omitted the actual messages, tool arguments, tool results, compaction state, and queued commands needed to reconstruct a session. It also omitted the relationship between the transcript and the recovered filesystem.

That sketch is withdrawn. The durable-state requirements below replace it. No claim of automatic Pi restoration is made until a restart test proves the adapter.

### Node cannot use a Durable Object stub directly

The previous `sandboxBashOps(sandboxStub)` sketch hid a network boundary. A normal Node process in a container does not inherit Workers bindings or `ctx.storage`.

The proposed adapter sends bounded HTTP requests through a trusted outbound handler. The handler identifies the originating container, routes to its coordinator, and uses Workers bindings. Cloudflare documents this in [Handle outbound traffic](https://developers.cloudflare.com/containers/guides/outbound-traffic/).

A Pi hook waits for an HTTP acknowledgment. The coordinator commits SQLite. Those are separate operations, not a local SQLite write inside Pi.

### Workflows are a viable alternative, not inherently unsafe

[Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/) requires retry-safe steps. The duplicate-effect problem also exists with a Node process and a Durable Object. Rejecting Workflows on that basis was inconsistent.

A Workflow can drive bounded model and tool transitions if tool dispatch is retry-safe or explicitly stops on uncertainty. Wrapping an entire `session.prompt()` call in a retried step is not sufficient.

[Agents fibers](https://developers.cloudflare.com/agents/runtime/execution/durable-execution/) also need application recovery logic. The original closure does not resume automatically, and fibers do not automatically retry every thrown error.

### Stop does not undo an already-running command

A newer run epoch can reject future requests from an older Pi process. It cannot stop a shell process that already passed admission or undo its external effects.

Before a replacement run mutates the same workspace, the coordinator must confirm that the old execution has stopped, isolate it by retiring the sandbox, or block for intervention. Rejecting stale acknowledgments alone does not protect the filesystem.

### Snapshot recovery can contradict a saved transcript

A durable tool result can say an edit succeeded while the latest R2 archive predates that edit. Restoring that archive and continuing with the unchanged transcript would give Pi a false view of the workspace.

The transcript and filesystem need a shared recovery checkpoint. More frequent archives reduce potential loss but do not remove this consistency requirement.

## What SPACE and Devin actually contribute

Perplexity's [Making SPACE](https://research.perplexity.ai/articles/making-space-secure-and-efficient-runtimes-for-long-running-agents) describes sandbox infrastructure. The previous research obtained an extracted copy after the origin rejected fetching. The review fetch returned a cookie page, so this revision does not present new exact quotations from that article.

The reported architecture separates a stateless control plane, host-local machine services, and an untrusted guest. Its credential handling and snapshot lifecycle are useful design references. The article is not proof of where Perplexity Computer runs its model loop.

SPACE's node-local services manage host machinery. Cloudflare owns that machinery for Ditto. A Ditto Node.js service is application compute, not an equivalent to SPACE's privileged host manager.

Cognition's [enterprise deployment documentation](https://docs.devin.ai/enterprise/deployment/overview) separates Brain from Devbox. Its [Outposts documentation](https://docs.devin.ai/cloud/outposts/overview) explicitly keeps inference and planning in Cognition Cloud while commands and repository access run on customer-operated machines.

[Cloudflare's Outpost tutorial](https://developers.cloudflare.com/sandbox/tutorials/devin-outposts/) hosts that execution environment. It does not move Cognition's Brain to Cloudflare. Ditto would build its own equivalent using Pi.

Neither vendor's public design establishes Ditto's replay, cancellation, or consistency guarantees.

## Proposed runtime boundaries

```text
Browser
  │ commands                         ▲ snapshots and events
  ▼                                  │
Product Worker: TanStack Start, auth, ownership, admission
  │                                  │
  ├── D1: product records and durable command delivery
  │
  ▼
SessionRuntime DO #1 ── SQLite: commands, run state, Pi history
  │
  ├── manages trusted Node container
  │       Pi: model loop, context, compaction, remote tools
  │       No repository execution or repository extensions
  │
  ◀── bounded HTTP through identity-aware outbound handler
  │
  ├── model broker ── provider
  │
  └── tool dispatch ── Sandbox DO #2
                            │
                            ▼
                      Untrusted execution container
                      /workspace, dependencies, builds, preview

R2 stores immutable workspace recovery archives through Worker bindings.
```

The product Worker admits commands and provides read access. It does not await a run's completion. The coordinator stores and supervises execution. Pi chooses the next model or tool action. The sandbox runs repository code.

The coordinator may live in a separate Worker deployment from TanStack Start, connected through service bindings. This would separate application rollout schedules. It does not make the coordinator immune to restarts. Alchemy remains the deployment owner.

### The trusted Node container

The trusted image contains pinned Pi and Ditto-owned adapters. It does not clone or mount the repository, install repository dependencies, load repository extensions, or offer a local shell tool to the model.

Pi's shipped `docs/containerization.md` and `examples/extensions/gondolin/index.ts` demonstrate remote tool operations. Ditto still needs a Cloudflare transport adapter. The Gondolin implementation is a reference, not a drop-in Sandbox client.

All model-callable filesystem and shell tools route through that adapter. Image decoding, path handling, context loading, and custom tools need an audit for accidental trusted-host access. There is no fallback to local execution if the remote executor fails.

Repository content and tool output remain untrusted input to Pi. Moving the process does not prevent prompt injection. Authorization stays outside model decisions.

### The privileged request boundary

The trusted Node container uses an internal HTTP destination intercepted by a Worker-owned handler. A hostname is not authentication. The handler maps platform-provided container identity to the expected workspace session and validates request shape, run epoch, and authority.

The untrusted execution container cannot use the trusted brain's model or coordinator endpoints. Its existing model-operation privilege must be removed during the cutover. Otherwise repository code would retain independent model access after Pi moves out.

OpenCode and GitHub keys remain Worker-owned. Git and Ditto actions retain their narrow contracts. Project environment values remain available to authorized execution commands, not to the trusted container's launch environment. Tool output may still contain those values.

Redaction remains before browser delivery and ordinary product persistence. Internal Pi recovery records need a defined encryption, retention, and access policy. They may contain sensitive source and provider-specific message metadata that cannot be treated as plain chat text.

## Durable command delivery

The original sketch had an unhandled gap between D1 acceptance and the DO call.

The proposed flow is:

```text
POST command with client idempotency key
  authenticate and check ownership
  atomically store messages, command, and delivery intent in D1
  attempt immediate delivery to SessionRuntime
  return a durable receipt

bounded dispatcher
  retry undelivered commands using the same command ID

SessionRuntime
  deduplicate command ID
  persist command and recovery wakeup state
  acknowledge acceptance
  start or notify Pi independently of the browser request
```

The existing runtime-work queue is the candidate delivery mechanism. It needs an explicit handoff state. A dispatcher must deliver work, not execute the full run.

A crash after D1 commit leaves deliverable work. A lost DO acknowledgment produces a duplicate delivery that returns the original receipt. A receipt distinguishes admission from actual execution.

Follow-up and Stop are also durable commands with IDs. Ordering must be defined per workspace session, including missing deliveries. Stop needs a priority path that revokes new execution without waiting behind ordinary work.

## One authority for each kind of state

D1 keeps ownership, project lifecycle, messages, capacity reservations, sandbox identity tombstones, and workspace archive metadata. The coordinator owns the active execution journal and canonical Pi continuation state. D1 displays a projection of run progress, not an independently advancing copy of that journal.

This changes the current architecture. The D1 running-work expiry path cannot continue to mark a healthy coordinator-owned run failed merely because a dispatcher lease expired. Dispatcher ownership and execution ownership need different leases.

Three version values have different jobs:

- `lifecycleGeneration` belongs to existing sandbox identity authority in D1.
- `runEpoch` belongs to the coordinator and rejects superseded execution attempts.
- `mutationGeneration` identifies workspace changes and recovery archives.

Stop or recovery can advance `runEpoch` without pretending the sandbox's lifecycle generation changed. Privileged admission must validate the applicable values rather than trusting a copied epoch forever.

Terminal settlement is another cross-store operation. The coordinator commits its final result and a pending D1 projection together in its own storage. A retryable projector settles the matching assistant idempotently. The browser stream is never responsible for that write.

## Enough state to resume

The coordinator needs more than status labels:

- Accepted prompts, follow-ups, Stop requests, command IDs, and command-consumption positions.
- Versioned Pi session entries, active branch position, compaction records, model settings, and required extension state.
- Completed model responses with tool-call IDs and arguments, committed before dispatching those calls.
- Tool intents, attempts, executor incarnation, actual results or durable references, and unresolved outcomes.
- The workspace recovery checkpoint that corresponds to the committed execution position.
- Monotonic event sequence numbers and outstanding D1 projections.

Large immutable records can live in R2 with references committed after successful writes. Pi's local session file is a reconstructed working copy, not the only authoritative copy.

In the installed Pi 0.80.10, `AgentSession._emit` calls subscription listeners without awaiting them. An async `subscribe` listener is not a durability barrier. Awaited tool hooks and remote-tool wrappers are useful seams, but the adapter must also capture final responses, compaction, and queue state.

Failure to persist must prevent further model or tool dispatch. Tool-hook exceptions must not quietly become an ordinary tool error followed by more unjournaled execution.

## Recovery is a decision, not a replay button

```text
Tool intent committed
  → dispatch
  → sandbox performs effect
  → result committed

Crash before the result commit
  → outcome is unknown
  → inspect existing execution or external state
  → resume only if the outcome can be established
  → otherwise block for intervention
```

A read-only operation is often safe to repeat, though its contents may have changed. A structured write can sometimes use expected-content checks. An arbitrary shell command can send email, push a branch, or start a background process. Ditto cannot infer a safe retry or compensation for every command.

Executor-local receipts can help diagnose accidental failures. Because the sandbox is untrusted, its receipts do not become platform authorization or proof that an external effect occurred exactly once.

If only Pi dies and the execution container remains intact, recovery may reuse its live filesystem after reconciling in-flight operations.

If the execution container dies, the coordinator restores a committed archive and uses the execution checkpoint associated with that archive. Later history remains visible as interrupted work. It does not silently describe the restored tree as current. External effects after the checkpoint remain unresolved even if local files roll back.

Checkpoints require exclusive access to the workspace. Parallel mutating tools, preview processes, and background children can invalidate an archive taken on an individual `tool_finished` event. A quiescent tool group or run boundary is a safer initial checkpoint boundary.

## Lifecycle, Stop, and stream delivery

The [Container interface](https://developers.cloudflare.com/containers/reference/container-class/) exposes persistent DO storage and manages an ephemeral container. It also owns the alarm handler. Reconciliation should use its supported scheduling mechanism rather than replace `alarm()`.

A durable wakeup plus a bounded reconciler detects interrupted startup, expired brain leases, unfinished projections, and stalled runs. The constructor initializes state. It must not start a new agent run on every activation.

A DO restart does not necessarily mean the Node container restarted. Recovery first observes the current brain incarnation. It does not blindly launch another Pi process.

Stop revokes future dispatch and requests cancellation. A run can remain `stopping` while an existing command is still active. A new mutating run waits until the old execution is stopped or isolated. Sandbox retirement can enforce separation, at the cost of losing work not yet checkpointed. It cannot undo external side effects.

The event connection is read-only. Reconnection obtains a committed snapshot and events after a cursor. Partial token deltas can be transient, provided the client can replace them with a canonical snapshot. Slow subscribers must not block Pi.

The event handler must not fall through to the default `Container.fetch` proxy, which can start a container. Reading session history should not wake Pi or the execution sandbox.

## Alternative and costs

A Worker-compatible loop hosted in a DO or Workflow remains a valid alternative. It removes the trusted Node container and can make state transitions more explicit. It still needs effect reconciliation and filesystem recovery.

Keeping full Pi avoids replacing its coding-session behavior. It adds a second image, startup time, memory cost, transport latency, and a recovery adapter. Two containers do not necessarily double total cost, but there is no measurement supporting a cheaper claim either.

Existing workspace capacity limits do not automatically account for trusted brain containers. Brain capacity, execution capacity, preview-only sessions, and idle shutdown need an explicit budget.

A third application DO is not justified yet. Separating coordinator and container controller could help independent lifecycle or deployment needs. There is no measured hibernation or billing result that establishes a benefit for Ditto.

## Evidence and remaining gates

Primary platform sources checked during this review:

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), request lifetime and disconnect behavior.
- [Container lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/), VM execution and ephemeral disk. Native snapshots remain described as coming soon on the fetched page.
- [Container interface](https://developers.cloudflare.com/containers/reference/container-class/), DO inheritance, storage, startup, scheduling, and idle behavior.
- [Outbound traffic](https://developers.cloudflare.com/containers/guides/outbound-traffic/), identity-aware handlers and access to Workers bindings.
- [Workflows rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/), retries and idempotency.
- [Agents fibers](https://developers.cloudflare.com/agents/runtime/execution/durable-execution/), explicit application recovery rather than closure replay.
- [Devin Outposts](https://docs.devin.ai/cloud/outposts/overview), separation of planning from remote execution.

The earlier `brain-architecture-research.md` records a historical source revision. Its credential-injection and shared-sandbox findings do not describe the current implementation. Its unconditional recovery checkmarks should not be read as demonstrated guarantees.

The architecture needs failure-injection tests before implementation commitments:

1. Duplicate command delivery and crashes on either side of the D1-to-DO handoff.
2. Full Pi restoration after process death, including compaction, follow-ups, and completed tool results.
3. No replay of an arbitrary command whose outcome is unknown.
4. Stop while an old shell ignores cancellation, with no concurrent replacement writer.
5. Sandbox loss after a journaled mutation but before an archive checkpoint.
6. DO eviction while Pi remains alive, without launching duplicate execution.
7. Terminal D1 projection retries, redacted stream replay, and bounded slow-client buffering.
8. Denial of brain-only endpoints to the untrusted sandbox, plus latency and capacity measurements.

These are proposed tests, not completed results. Existing paid-plan validation gates still apply. No production change or deployment is authorized by this document.
