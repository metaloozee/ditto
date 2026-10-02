# Pi Durable and a Cloudflare-native brain for Ditto

Status: historical research and architecture proposal. The authoritative target is now [Pi Durable workspace-session runtime](../specs/pi-durable-session-runtime.md). Authority and plan-status statements below describe the research date, not current planning instructions. This report is not implementation or validation evidence.

Researched on 2026-10-02 against Ditto checkout `13480bc7f4daf9489a0aa7cf7fea071a1115c8c3`, including the working-tree plan status. External documentation can change after this date. No deployment, live database access, dependency upgrade, or runtime experiment was performed for this report.

The [trusted workspace-session runtime specification](../specs/trusted-session-runtime.md) remains authoritative. It currently requires the full Pi coding-agent SDK in a trusted Node container and explicitly excludes a workerd-hosted loop. This report proposes reopening that decision. It does not silently supersede it, authorize data deletion, or invalidate accepted implementation evidence.

## 1. Recommendation

Investigate **Pi Durable inside one SQLite-backed Durable Object per workspace session, with repository execution in a separate Cloudflare Sandbox**. Make this the preferred candidate, subject to the integration gates below.

Keep the product Worker, D1 product records, R2 recovery archives, ownership checks, credential broker, and isolated execution sandbox. Replace the proposed Node-hosted `AgentSession` and its custom continuation machinery with Pi Durable's conversation and task engine. The trusted brain becomes code inside the workspace session's Durable Object rather than another container.

The reason is specific to Ditto. A browser coding workspace needs durable commands, tool execution records, reconnectable activity, compaction, and recoverable conversations. Those are closer to Pi Durable's purpose than to embedding a terminal-oriented coding session and teaching it to survive process loss.

There are two important qualifications.

1. Pi Durable is a separate experimental framework, not an extension that makes an existing `AgentSession` durable. Adopting it means replacing that integration and porting Ditto's tools and policy.
2. Durable conversation state does not make a shell command exactly-once, preserve a container filesystem, or establish authorization. Ditto still owns those guarantees.

The lower-risk alternative is **Pi v1's coding-agent SDK in the already-planned trusted Node container**. It preserves more existing integration work, but retains a second running container, the brain-to-coordinator transport, and the custom recovery adapter. Do not choose the larger rewrite merely because Pi Durable is new. Choose it if the feasibility work shows that it removes more machinery than its Cloudflare, storage, and safety adapters introduce.

My recommendation is to approve a bounded feasibility investigation before rewriting the remaining plans. There is enough upstream evidence to justify that investigation, not enough Ditto integration evidence to call this architecture proven.

The three hardest integration problems are already identifiable: encrypted storage, Cloudflare-backed scheduling, and stopping all automatic continuation after an uncertain effect. Pi Durable does not supply those Ditto-specific contracts out of the box.

For a first review, read this recommendation, the topology in section 5, the alternatives in section 9, and the feasibility gates in section 11. Sections 4, 7, and 8 explain the difficult parts.

## 2. What Ditto is building

Ditto is a remotely operated coding workspace with an agent, not a chat application with a shell attached.

A workspace session combines four things that must agree:

- A conversation containing what the user asked and what the agent observed.
- A branch and live repository files containing the work.
- An execution record describing which commands were admitted, completed, stopped, or left uncertain.
- A recovery point that can restore a defensible combination of conversation and files.

For example, an assistant can truthfully report that it edited `login.ts` while the latest backup still contains the old file. If the sandbox disappears, restoring the backup and resuming that assistant's latest context would be wrong. The conversation survived; the work it describes did not.

The architectural goal is therefore stronger than "keep the agent running after the browser closes":

> Accept work durably, execute it under explicit authority, preserve what actually completed, and stop rather than invent certainty when execution or recovery cannot establish the result.

The existing [product brief](../../PRODUCT.md) and [domain context](../../CONTEXT.md) already point in this direction. Pi Durable can supply part of the machinery. It does not change the product's obligations.

### Domain terms and Pi terms

| Ditto term | Proposed relationship to Pi Durable |
|---|---|
| Project | Owned repository, immutable project seed, project values, and workspace sessions. Not one shared Pi runtime. |
| Workspace session | One product conversation and line of work, with one owning Durable Object and one isolated execution sandbox. |
| Trusted session runtime | The Ditto module inside that Durable Object. Owns admission to execution, recovery policy, and product settlement. |
| Trusted brain | Pi Durable's model and task execution inside the trusted runtime. Proposed change from a separate Node process. |
| Agent run | Ditto's user-visible execution lifecycle. Must be mapped explicitly to Pi submissions and tasks, not inferred from a streaming flag. |
| Pi conversation | Agent context and transcript. Initially one active conversation per workspace session. Recovery may retain older conversation generations. |
| Pi task | A durable model request, tool invocation, compaction, or application-defined operation. Not necessarily a whole Ditto agent run. |
| Paired checkpoint | Workspace archive plus its matching committed conversation position and required state. Not a Pi task checkpoint alone. |

A Pi conversation fork does not create a Git branch, clone a sandbox, authorize another user, or restore files. Those remain separate product operations.

## 3. What Pi v1 changes, and what it does not

The [Pi 1.0 announcement][pi-v1] makes two different releases worth distinguishing.

| Package or concept | Role | Consequence for Ditto |
|---|---|---|
| `@earendil-works/pi-coding-agent` | The coding agent and embeddable `AgentSession` SDK for Node.js or Bun. | The direct successor to Ditto's current integration. Still needs explicit host configuration and recovery work. |
| `@earendil-works/pi-ai` | Shared model/provider functionality. | Useful to both designs. Provider compatibility must be tested against Ditto's exact fixed-model contract. |
| `@earendil-works/pi-durable` | Experimental conversation, task, storage, and extension framework. | An alternative agent implementation, not an `AgentSession` persistence plugin. |
| Cloudflare Durable Object | A platform execution and strongly consistent storage unit. | A plausible host for Pi Durable. Similar names do not mean the two integrate automatically. |

Pi v1 adds capabilities such as Codemode, MCP support, virtual models, deferred tools, and transcript-aware prompt changes. Ditto need not enable them. In particular, repository-selected MCP servers, executable extensions, or agent-generated code inside the trusted runtime would undermine the separation this design is trying to establish.

### The coding-agent SDK remains a valid alternative

The [current SDK documentation][pi-sdk] establishes several relevant facts:

- `createAgentSession()` defaults to discovered resources, stored configuration, persistent sessions, and configured credentials. These defaults are inappropriate for an untrusted imported repository unless replaced deliberately.
- `SessionManager` owns finalized context. Assigning `session.agent.state.messages` does not replace the persisted context tree.
- `message_end` supplies a completed message. `agent_end` is not necessarily final settlement because retries or queued work can follow. Current SDK integrations should consider `agent_settled` for that observation.
- Steering, follow-ups, compaction, extension runtime, and session lifecycle are part of `AgentSession`. Pi Durable adoption must account for the behavior Ditto actually uses rather than assume feature parity.

The [session format][pi-session-format] and [message types][pi-message-types] also preserve system/tool changes, compaction positions, and provider-specific signatures. Product chat text is not a lossless continuation format in either design.

### Security did not become automatic in v1

Pi's [security documentation][pi-security] explicitly says that generated code and commands are untrusted, project trust is not a security isolation mechanism, and working directories do not confine filesystem access.

Two details matter for any retained `AgentSession` implementation:

- The project `sessionDir` lookup occurs before the project-trust decision.
- Context files such as `AGENTS.md` and `CLAUDE.md` can load despite declining project trust unless context loading is disabled.

Do not replace Ditto's explicit resource controls with a "decline project trust" setting. The [containerization guide][pi-containerization] also warns that remote built-in tools do not automatically isolate other extensions, and its Gondolin example passes the host environment to commands. That example is useful for understanding tool delegation, not a credential policy to copy.

## 4. What Pi Durable supplies

The [Pi Durable announcement][pi-durable-blog] and its linked implementation describe a framework built around persisted conversations and tasks.

Implementation findings below are pinned to upstream commit [`7fbbd5f4a1d982bb02d63472dde0774fa639f99b`][pi-revision], dated 2026-10-01. Its [package manifest][durable-package] identifies `pi-durable@1.0.0`, with `pi-ai` and `chord` dependencies on the `^1.0.0` line. The [README][durable-readme] still explicitly labels the package experimental. A `1.0.0` package number is not a stability promise for this framework.

The package does not depend on `pi-coding-agent` or `pi-agent-core`. Its [experimental coding demo][durable-demo] uses `Harness` directly, not `createAgentSession()`. No supported `AgentSession` persistence substitution or JSONL importer was found in the inspected public contract.

| Capability | Useful contribution | What Ditto still needs |
|---|---|---|
| Persisted submissions and `requestId` | Retain queued work and deduplicate submission retries. | Authenticated command admission, payload-conflict detection, ordering, ownership, and D1-to-runtime delivery. |
| Task checkpoints | Resume unfinished framework work after reopening storage. | A host that wakes up, validates authority, and reconciles the executor before execution resumes. |
| Tool intent and replay policy | Record intended calls; distinguish tools that claim replay safety. | Classification of external effects, executor fencing, and a durable block on uncertain operations. |
| Conversations and compaction | Retain transcript state and summarize long context. | Mapping to Ditto messages, run settlement, provider policy, and storage limits. |
| Typed documents | Commit application state alongside framework changes. | Carefully chosen ownership of product state, recovery state, and non-rewindable security state. |
| Views and watches | Supply current state and subsequent changes to observers. | Authenticated transport, redaction, bounded buffers, reconnect cursors, and D1 projections. |
| Execution environment interface | Route file and shell operations somewhere other than the brain host. | A Cloudflare Sandbox adapter with no local fallback. |

The blog says SQLite and JSONL storage code use no Node APIs and can run in a Durable Object with an adapter. This is stronger evidence than trying to force the complete coding-agent SDK into Workers through `nodejs_compat`. It is still an architectural portability claim, not proof that Ditto's selected imports, provider, encrypted storage, and scheduler work together in workerd.

The inspected release ships memory, SQLite, and JSONL backends, but no Cloudflare DO, D1, or R2 adapter. Its portability tests inspect local import graphs. They are not end-to-end workerd tests of the dependency graph and provider.

### Concrete compatibility gaps

| Inspected behavior | Implication for Ditto |
|---|---|
| `requestId` is scoped to a Pi conversation. Reusing it with the same submission type returns the old submission even when the content differs. A different type rejects. | Keep Ditto's payload-hash conflict checks and durable command-to-conversation mapping. This behavior is explicit in the [submission tests][durable-submissions]. |
| [`CodingTools`][durable-tools] contains `read`, `write`, `edit`, and `bash`, with no `grep`, `find`, or `ls`. The inspected read implementation does not support images. | Port the actual tools Ditto exposes. Image support, if needed, requires a separate implementation decision. |
| Tools run in parallel by default. `settings.toolExecution = "sequential"` can serialize rounds. | Select sequential execution explicitly and still serialize against UI Git, preview/checkpoint transitions, and other callers. |
| Stock coding tools do not declare safe replay, including `read`. | Replay policy needs deliberate Ditto declarations, not an assumption based on tool names. |
| Task ownership controls cancellation and idle traversal. Trusted extensions can access other conversations and documents in the owning storage. | Task ownership is not user authorization. Do not host unrelated workspace sessions in one storage owner. |
| `watchEvents()` produces familiar event shapes, but remains experimental. Watches can replace accumulated updates with a snapshot. | Translate to Ditto's observation contract. Do not treat a watch as an append-only audit log or promise a portable persisted resume token. |

Only committed progress survives a crash. Do not promise a universal 100 ms loss bound: the README's description is stronger than the adaptive tool-output throttle in the [implementation][durable-output].

### Important limits

Pi Durable's advertised recovery behavior is deliberately more permissive than Ditto's accepted policy in one respect. An interrupted non-replayable tool is reported to the model as interrupted, and the model can decide what to do next. Ditto's specification requires an unknown effect to stop automatic execution and block the workspace session for review.

Those policies are not equivalent. An LLM can issue a new tool call with different arguments or a new ID that repeats the same real-world action. Refusing to replay the original task does not prevent that.

The [tool implementation][durable-tool-task] stores final arguments and `safe` or `unsafe` replay policy before execution. Recovery repeats the call only when both the stored policy and the current tool declaration say safe. It uses the current implementation and execution environment. It does not rerun `beforeTool` after that durable intent. Unsafe recovery writes an interrupted result without passing through `afterTool`; its parent generation can continue.

Hooks alone cannot enforce Ditto's safety contract. The [hook contract][durable-spec] treats ordinary errors in several hooks, including `beforeRequest` and `afterTool`, as reportable rather than fatal. A throwing `beforeTool` blocks that call, not the whole run. Guards must live in mandatory model/execution adapters and host scheduling policy, not solely in conversation-selected hooks.

Likewise, a retried interrupted model request can incur another provider charge or return a different answer. Submission deduplication is not exactly-once inference or exactly-once external execution.

Pi Durable also stores extension and tool names, not frozen executable code. Reopening storage with different code can change subsequent behavior. Pin the framework, provider library, task definitions, tool contracts, and Ditto adapter version as a compatible set. Upgrading a package is a runtime-state migration decision.

## 5. Proposed Cloudflare topology

```text
Browser
  | commands, authenticated observation
  v
Product Worker
  | auth, ownership, D1 admission and delivery outbox
  | GitHub App private key and installation-token mint-and-fetch
  |
  | private service binding
  v
Runtime Worker
  |
  +-- Workspace-session Durable Object
  |     Ditto trusted session runtime
  |     Pi Durable Harness + explicit Ditto extension registry
  |     SQLite-backed durable state
  |     Model access through Ditto policy
  |     Alarm-backed wakeup and reconciliation
  |
  +-- Sandbox Durable Object
        |
        v
      Untrusted execution container
        /workspace, Git, dependencies, tests, preview

D1: product ownership, accepted commands, authority, capacity, projections
R2: immutable workspace archives and encrypted large runtime records
```

One workspace session still has two application Durable Object identities. It has only one repository execution container. There is no trusted brain container in this candidate. Pi does not import `NodeExecutionEnv` or the Node SQLite adapter into this Worker.

Durable Objects provide a single owning instance, not permission to ignore interleaving across `await`. Keep one open `Harness` per owning object instance, serialize state transitions, and fence remote executor attempts. Pi Durable itself supplies no cross-process lease or lock for two hosts opening the same storage.

Keep the runtime Worker separate from the TanStack Start product Worker. Product deployments should not unnecessarily redeploy the agent engine, and the GitHub App private key should remain outside the runtime deployment. Alchemy remains the sole deployment owner.

The runtime Worker owns the Sandbox class and the per-workspace-session runtime class. The product Worker uses private service bindings, not arbitrary public internal routes. Preview still reaches the product origin first, where revocation is checked before forwarding.

### Why one owning runtime per workspace session

Pi Durable can host many conversations in one process. That is not a reason to place unrelated users or projects in one owning Durable Object.

A per-workspace-session owner gives Ditto a local place to serialize workspace mutations, stop work, reconcile tools, publish recovery points, and serve history. It also limits memory and failure coupling. Start with one active agent conversation and no independently mutating subagents. Add read-only reviewers or isolated child workspaces only when the product needs them.

### The credential tradeoff must be explicit

In the accepted Node design, Pi and the Worker credential broker occupy different processes. In this proposal, the Pi Durable code and runtime-Worker code occupy the same trusted JavaScript environment.

The execution sandbox still receives no model key, GitHub token, R2 credential, signed archive URL, or internal bearer token. The model key can remain a runtime Worker binding accessed only by Ditto's model adapter. But a malicious dependency or trusted extension executing in that Worker cannot be treated as isolated from the Worker itself.

Therefore:

- Only deployment-owned, pinned extensions run in the trusted runtime.
- Repository code, generated JavaScript, package installers, and user-selected MCP servers never execute there.
- Model-callable network and repository operations use explicit adapters.
- The GitHub App private key remains in the separately deployed product Worker.

Cloudflare container outbound interception protects container traffic. It does not automatically restrict arbitrary `fetch` calls made by trusted Worker code. Do not claim that it does.

If isolation of the framework from the model credential itself becomes a requirement, revisit a separate credential-holding Worker or the existing Node-plus-broker design. That extra separation is a different tradeoff, not a feature Pi Durable supplies.

### Preserve Ditto's actual secret and model policy

Keep `opencode/deepseek-v4-flash-free` and the `off`, `high`, and `max` choices unless a separate product decision changes them. Test Pi v1's provider request shape against Ditto's validated contract, including retries, background compaction, cancellation, and the one-request Git-metadata allowance. Successful requests to a different provider do not prove this integration.

Project environment values remain product-owned and are materialized only for an already-authorized execution command. Their current decryption depends on the product's auth secret; the runtime Worker must not receive that secret. Values must not enter brain configuration, builders, Git transport children, previews, archive helpers, or repository `.env` files. Commands can still expose those values through output or allowed public traffic. This design does not prevent all exfiltration.

Keep repository resource discovery disabled. A future feature that reads repository instructions as bounded text must not load executable extensions or change authorization. Remote tools have no trusted-host fallback.

Raw Pi views and watches may contain source, tool arguments, output, and provider metadata. Do not proxy them straight to the browser. Retain encrypted canonical continuation internally and expose bounded, redacted product projections. Redaction must cover split streaming secrets, stderr, errors, and structured payloads before product storage and delivery.

## 6. State ownership and the deepest modules

The useful design change is not to replace every existing Ditto module. It is to give the workspace-session runtime one small interface and let Pi Durable replace the custom agent continuation implementation behind it.

### State ownership

| Store or location | Authoritative responsibility |
|---|---|
| D1 | Users, ownership, projects, workspace-session identity, admitted commands and delivery intents, identity retirement, privileged-operation windows, global capacity, product projections. |
| Runtime DO storage | Pi conversations and tasks; Ditto run epochs, effect decisions, checkpoint manifests, event positions, and pending product projections. |
| R2 | Immutable archive bytes and encrypted oversized runtime content referenced by committed metadata. |
| Execution container disk | Live repository and processes. Never the only durable record of accepted work or conversation state. |
| Browser | Presentation and a reconnect cursor. No execution authority. |

There is no transaction spanning D1, DO storage, R2, a shell command, and a model provider. Each crossing needs a durable intent, an idempotent acknowledgment where possible, and reconciliation.

Do not keep the existing custom Pi continuation journal and a Pi Durable transcript as independent authorities for the same agent position. Preserve Ditto's execution policy, but consolidate its state with the framework's durable transactions where the contracts allow it. A safety effect ledger is still necessary. A second shadow transcript is not.

### Module interfaces

These are conceptual interfaces, not a new package layout or proposed upstream API.

| Module | Interface callers should learn | Implementation it hides |
|---|---|---|
| Workspace-session commands | Submit owned intent; receive a durable receipt; observe state and events. | Authentication, idempotency, first-session creation, message admission, outbox delivery, priority controls. |
| Trusted session runtime | Accept delivered commands and controls; provide committed observation. | Pi submissions/tasks, command ordering, run settlement, wakeups, recovery decisions, event translation, retryable D1 projections. |
| Workspace execution | Execute or reconcile a typed logical operation against an admitted workspace incarnation. | Sandbox wake/restore, remote filesystem and process calls, output bounds, cancellation, mutation serialization, project-value injection. |
| Workspace recovery | Capture or restore a committed pair under exclusive mutation ownership. | Quiescence, archive streaming, encryption, integrity, manifests, current/previous fallback, cleanup. |
| Privileged access | Admit an exact model, Git, or Ditto operation under current authority. | Fresh authority checks, request validation, secret attachment, fixed-model policy, token minting, revocation. |

These modules have depth because callers do not reproduce task scheduling, archive publication, credential policy, or recovery rules. Deleting the runtime module would push that complexity back into routes, streams, and tools.

Keep real seams where behavior varies: Pi storage on Cloudflare versus its conformance-test backend, and remote execution versus a fault-injecting test adapter. Do not add a universal `AgentEngine` interface merely to advertise future support for unrelated frameworks. Ditto needs one selected agent implementation.

### The public interface includes more than method names

Its behavioral contract should say:

- Acceptance is durable receipt creation, not proof of execution.
- Duplicate keys with the same payload return the original IDs; different payloads conflict.
- Ordinary commands are ordered within a workspace session.
- Stop bypasses ordinary delivery gaps and capacity queues.
- History reads do not wake the execution container.
- An unknown effect blocks automatic continuation.
- Every settled run eventually projects all its pending assistants to complete or failed.
- A projection outage and a backup outage are visible separately from model success.

These are the same facts product callers and tests should depend on, regardless of the selected Pi implementation.

## 7. Execution and recovery protocols

### Accepting and running a prompt

1. The product Worker authenticates ownership and validates the requested thinking level, target state, and model configuration.
2. One D1 transaction stores the command, user message, pending assistant, sequence number, and delivery intent.
3. Immediate delivery is attempted. A dispatcher retries with the same command ID if the handoff is interrupted.
4. The owning runtime records command consumption and wakeup intent before acknowledging. It resolves sequence gaps and capacity before starting execution.
5. The runtime maps the command ID to a stable Pi submission identifier. Pi receives an instruction only after Ditto has durably accepted it.
6. Model requests and remote tools pass through Ditto's current-run admission checks. Compaction, retries, and metadata calls are included, not hidden exceptions.
7. Terminal runtime state and a pending product projection become durable. A retrying projector settles D1 messages independently of browser connections.

Pi submission deduplication complements the D1 outbox. It does not eliminate the outbox or the cross-store handoff.

### Tool execution and uncertainty

For each logical operation, retain its originating run and assistant, Pi tool/task identity, validated arguments, executor incarnation, run epoch, deadline, and outcome policy.

```text
prepared intent
  -> admitted for dispatch
  -> result durably recorded

admitted, but no trustworthy result
  -> reconcile
  -> known result, or outcome unknown
  -> unknown blocks further automatic execution
```

A completed framework tool result must not race ahead of Ditto's required effect evidence. A failure to commit that evidence must prevent further model and tool admission, even if the framework treats a hook exception or tool failure as recoverable.

Suggested initial policies:

| Operation | Recovery policy |
|---|---|
| Bounded read/list/search | May repeat as a new observation under explicit policy. The filesystem may have changed. |
| Structured write/edit | Repeat only with a supported expected-content or equivalent idempotency check. Do not assume a stock write is harmless. |
| Arbitrary shell | Potentially mutating and externally effectful. Never automatically repeat an uncertain dispatch. |
| Git fetch/sync/export | Use the existing typed Git contracts, branch policy, and reconciliation. A Git command is not a blanket safe-replay category. |
| Metadata/model request | Retry may spend again. Record attempts, enforce authority, and preserve completed provider records. |

Initially serialize authorized workspace tools and UI mutations. A per-runtime scheduling rule does not terminate an already-running shell or a background child process.

Sandbox-local receipts are diagnostic evidence, not a new source of platform authority or proof of exactly-once external effects. Likewise, an archive digest identifies the bytes Ditto captured; it does not make a malicious sandbox's files or tool output trustworthy.

### Stop

Stop durably advances the run epoch and denies new model/tool admission before requesting cooperative cancellation. It targets an exact run, so late deliveries cannot revive that run or cancel a distinct later one.

The UI must distinguish stop recorded, stopping, and execution accounted for. Pi task cancellation alone is not proof that remote processes are dead. A replacement mutating run waits for trusted termination evidence or isolation of the old executor. An explicit recovery acknowledgment may authorize discarding uncheckpointed work, but cannot make concurrent writers safe. An isolated but still-running old container still consumes capacity.

Background compaction and any future child tasks must obey the same stop policy. Do not assume ordinary conversation cancellation reaches all background work.

### A lost browser or product Worker

Nothing about the active agent depends on the SSE request. The client can reconnect and obtain a committed snapshot plus later events. Slow subscribers can be detached without blocking execution. The runtime retains a durable wakeup even with no connected client.

### A lost runtime isolate

Reopen the framework's durable storage, inspect unresolved operations and workspace incarnation, apply stop/deletion fences, and only then permit new effects. A host recovery path must not allow automatic task startup to race ahead of reconciliation.

Partial model output can remain visibly interrupted. A new model attempt is allowed only under current authority and spending policy. Completed remote mutations are not repeated simply because the JavaScript process was lost.

### A lost execution sandbox

Restore the latest usable paired checkpoint, not simply the latest Pi transcript. Preserve later conversation history as interrupted history. Preserve unresolved external-effect records even if local files move back to an older state.

Prefer checkpoints at acknowledged quiescent run or Git-mutation boundaries. A pair identifies:

- An immutable workspace archive, its digest, size, format, and compatibility inputs.
- The matching committed conversation position and required context/document state.
- Mutation generation, source executor incarnation, and relevant version pins.
- The disposition of outstanding operations.

Use a manifest publication protocol. Write archive and encrypted runtime content first; commit the pair only after both are verified; project archive pointers into D1 afterward. A prepared archive is not a restorable checkpoint.

A supported restore recipe remains a feasibility requirement. Pi's transcript fork and document-history features are promising, but must not be assumed to snapshot live task execution or an external filesystem. One candidate is a new active conversation generation rooted at a quiescent checkpoint, while retaining interrupted history. That requires proof that old tasks cannot restart and required document state is restored correctly.

Never rewind authorization, deletion tombstones, command deduplication, run epochs, or external-effect uncertainty to match an older transcript. A whole-database rollback of the live coordinator would risk resurrecting revoked work.

### Preview and archives

Retain the existing bounded preview-deferral policy and visible backup-pending state. Preview can write files while no agent tool is active. Capturing an archive on every `tool_end` therefore does not establish a consistent pair.

Quiesce managed writers before capture. If arbitrary execution cannot be accounted for, fail the checkpoint rather than label it consistent. Preserve a successfully completed assistant when backup fails; mark recovery degraded separately. Current/previous fallback must restore matching pairs, never an unrelated transcript or a silent project-seed fallback.

## 8. Cloudflare hosting questions that can reject this proposal

### A portable storage interface is not a finished DO adapter

The adapter must satisfy Pi Durable's storage transaction, ordering, rollback, paging, and single-owner contracts using actual Durable Object SQLite semantics. A wrapper around `sql.exec` is not sufficient evidence.

The [SQLite facade][durable-sqlite-facade] requires Promise-returning `exec`, `run`, `get`, and `all`, plus an asynchronous transaction callback. Unrelated operations must queue behind the transaction; its handle expires afterward; rejection must mean rollback has completed. Rollback failure must be distinguishable from a normal callback error. The [facade tests][durable-sqlite-tests] and exported storage conformance suite are the first test seam.

Cloudflare's [SQLite storage reference][cf-sqlite] supports `storage.transaction()` with SQL queries participating in the asynchronous callback. This makes the mapping plausible. Use that facility rather than issuing `BEGIN` or `SAVEPOINT` through `sql.exec`, which Cloudflare disallows. `transactionSync()` is a different interface and cannot await Pi's transaction callback. `blockConcurrencyWhile()` prevents event delivery but does not provide rollback; it must not enclose a whole model or tool run.

Validate SQL features, bound-value conversion, cursor consumption, and integer precision as well as transactions. Pi's facade permits `bigint` and `Uint8Array`; Cloudflare's number and buffer representation cannot be treated as identical without checks.

Application-managed encryption is a separate requirement. The accepted Ditto spec requires authenticated encryption of canonical runtime content before it reaches SQLite or R2. The inspected [`SqliteStorage`][durable-sqlite-storage] writes plaintext JSON and has no payload-codec or encryption option. Cloudflare's disk encryption does not satisfy that application requirement.

A small SQL facade may establish a disposable compatibility demo. It is not the complete production storage adapter. Preserving encryption probably requires a custom `Storage` implementation or a reviewed upstream extension, with queryable structural metadata and encrypted private records. A generic encrypt/decrypt wrapper has not been shown to preserve document deltas, historical copies, scans, and atomic mixed writes.

The adapter design must explain which metadata remains queryable, how private payloads are encrypted, how key rotation works, and how asynchronous encryption interacts with transaction atomicity. Never await network or encryption work inside a synchronous transaction callback and assume it remains atomic. Test authenticated owner/session binding and deletion of retained content, not only successful decryption.

Large prompts, images, tool output, and provider state also need bounds or encrypted offload. Test every stored representation, including task checkpoints and request state, not only final transcript entries. An R2 reference must resolve to the original semantic data on restoration.

### Durable state needs durable wakeups

Pi Durable can resume unfinished work when its host opens the storage and resumes it. It does not by itself create Cloudflare alarms or keep an isolate alive forever.

The host needs one alarm-backed scheduling policy covering runnable work, retry deadlines, pending projections, checkpoint publication, and reconciliation. Store wakeup intent before acknowledging work. On activation, reconcile it even if a previous alarm handler or scheduling attempt failed.

The inspected [Harness implementation][durable-harness] provides a useful passive startup:

| Operation | Scheduling consequence |
|---|---|
| `Harness.open(...)` | Reconciles stored running tasks to pending without dispatching their handlers. |
| `inspect()`, ordinary reads, watches, plain commits | Do not enable scheduling. |
| `resume()` | Enables the scheduler globally. |
| Submission, compaction, conversation abort, task/submission/idle waits | Can also enable scheduling, including unrelated recovered work. |
| `close(context)` | Seals admission, signals and joins live invocations, then closes storage. Does not write terminal task outcomes or durable abort marks. |

This supports passive open, inspect, reconcile, then resume. For a workspace with an uncertain effect, persist the review block and withhold every scheduling-enabling call. Even a convenience `wait()` or conversation-level `abort()` is not safe to call casually during passive recovery. Model and executor adapters must also deny new admissions if uncertainty arises while the scheduler is already active.

The public contract has no `pause`, bounded `step` or `pump`, next-deadline interface, or external scheduler wakeup callback. Task sleep uses a process timer; durable retry deadlines in task checkpoints do not create Cloudflare alarms. `close()` can wait indefinitely for non-cooperative code. Opening another Harness before close completes would violate single ownership.

Cloudflare [alarms][cf-alarms] are at-least-once, have one scheduled slot per object, and retry thrown failures up to six times. Its [limits documentation][cf-do-limits] gives alarm handlers a 15-minute wall-time limit. Therefore "call resume in alarm and await the entire run" is not an adequate unbounded-host design. Decide how live progress, wakeup reconciliation, and host interruption compose, then fault-test it.

Do not use a browser connection, an unawaited promise, `setTimeout`, or `waitUntil` as the sole lifetime guarantee. Keep handlers bounded and account for eviction, deployment, alarm retries, and duplicate wakeups.

A key spike is whether the framework can be hosted with safe bounded execution and restart without accidentally converting an infrastructure yield into user cancellation. `abort` is not a generic "save and resume later" operation. If the public lifecycle contracts cannot support this, the direct-DO candidate fails until an upstream change or a reviewed host design solves it.

### Resource and cost limits still apply

The framework must fit the Workers bundle, CPU, memory, SQLite row, and per-object storage limits. Large context assembly and encryption can be expensive even when model waiting consumes little CPU. An active conversation window is bounded by model context, not necessarily by the memory available to one isolate.

Architecture-relevant limits on the documentation retrieved for this report:

| Constraint | Design consequence |
|---|---|
| SQLite-backed DO storage is 10 GB per object on Workers Paid; strings, BLOBs, and rows are limited to 2 MB. | Bound every persisted representation and plan encrypted offload, not only log truncation. |
| DO active CPU defaults to 30 seconds per invocation, configurable to five minutes. | Measure context reconstruction, compaction preparation, and encryption CPU. |
| Workers memory is 128 MB per isolate. Multiple DOs may share an isolate. | Do not budget 128 MB as an independently guaranteed heap for every workspace session. |
| Alarm invocations have a 15-minute wall-time limit. | Long conversations must outlive individual invocations through persisted state. |

Sources: [DO limits][cf-do-limits] and [Workers limits][cf-worker-limits]. These are platform limits, not proposed Ditto product quotas. Network waiting and active CPU are different, but DO active-duration billing still matters while the brain waits.

Removing the trusted Node container removes that image's startup, idle billing, transport, and capacity pool. It does not make the brain free. Measure DO active duration, SQLite writes during streaming, R2 requests, model retries after eviction, and end-to-end tool latency.

Keep the execution capacity pool, including builders and previews. Replace the brain-container capacity ledger only after defining sensible admission limits for concurrent model work and active DOs. Do not keep fictitious container slots for a container that no longer exists.

Do not combine this decision with a Sandbox SDK migration. Ditto currently pins stable `@cloudflare/sandbox@0.12.3`, with `@cloudflare/containers@0.3.7` in `apps/runtime`. Current Cloudflare Sandbox documentation has changed beyond that line, and the old preview lifecycle URL redirects to newer documentation. Pin the intended package and image together; do not copy a current or historical `@next` example into the stable adapter and assume compatible lifecycle behavior.

### Why not put the whole log in D1 or R2?

D1's [prepared-statement batch interface][cf-d1] does not by itself implement Pi's interactive asynchronous transaction callback. It remains a good home for product records and an outbox, not a drop-in replacement for per-owner storage.

R2's [strong consistency][cf-r2] makes it suitable for immutable archives and encrypted large records. It does not supply a multi-record transactional append log. Do not make an R2 filesystem mount the authoritative SQLite database without a separately proved durability contract.

DO point-in-time recovery is operational disaster recovery. Rewinding that database alone cannot rewind GitHub, a shell's external effects, or another store's deletion decisions.

## 9. Alternatives

| Candidate | Benefits | Costs and risks | Position |
|---|---|---|---|
| Pi Durable in the workspace-session DO; remote Sandbox tools | One local durable owner for conversation and execution policy; no brain container or HTTP bridge. | Experimental framework; DO storage, encryption, scheduling, tool, and recovery integration must be proved. Trusted framework code shares the runtime Worker. | Preferred feasibility candidate. |
| Pi v1 coding-agent SDK in trusted Node container | Preserves coding-agent semantics and more existing work; full Node environment. | Two containers; custom durable continuation; bridge, incarnation reconciliation, and two capacity pools. | Lower-risk alternative, current accepted direction. |
| Pi Durable in trusted Node container | Avoids workerd compatibility problems while using durable tasks. | Still needs durable storage outside ephemeral disk and a single-owner protocol; retains brain container and transport. Not automatically simpler. | Consider if the only direct-DO blocker is host compatibility. |
| Pi agent-core or a custom model loop in a DO | Maximum control and Worker-friendly integration. | Ditto owns more compaction, task persistence, continuation, and event behavior that Pi Durable now offers. | Weak first choice unless Pi Durable fails its essential contracts. |
| Cloudflare Agents or Workflows as the primary engine | Platform-managed execution patterns and ecosystem. | Replaces more Pi behavior, or adds overlapping scheduling and persistence if layered beneath it. | Valid alternative, not an automatic extra layer. |
| Pi remains beside repository processes | Least immediate change. | Repository code shares the brain's process environment and can tamper with its state. Does not meet the accepted separation goal. | Reject as the target. |

Cloudflare's [fiber documentation][cf-fibers] is useful evidence about host lifetime. It explicitly requires application recovery after eviction; the original closure does not resume automatically. Adding a fiber around an entire Pi run does not by itself make each external effect safe. Likewise, wrapping a full run in a retried Workflow step can repeat effects.

Choose one owner for conversation/task continuation. Use another durable engine only for a distinct need that has a clear handoff, not to make the diagram look more durable.

## 10. What happens to the existing work

The checked-out repository has three distinct layers: the operational legacy chat path, locally implemented trusted-runtime foundations, and an accepted target that is not fully connected. The [plan index](../../plans/README.md) records locally accepted phases 001 through 004 and incomplete phase 005. Both `packages/sandbox-runner` and `packages/session-brain` pin Pi `0.85.1`. Agent-core is transitive, not Ditto's direct integration.

### Source evidence for today's behavior

Line ranges refer to the Ditto revision identified at the top of this report, not a deployed environment.

| Evidence | What it establishes |
|---|---|
| [`run-agent.ts`](../../packages/sandbox-runner/src/run-agent.ts), lines 81-117 | `SessionManager.open()` uses sandbox-local JSONL and `createAgentSession()` enables local filesystem/shell tools. Real chat still runs beside repository code. |
| [`api.agent.stream.ts`](../../apps/web/src/routes/api.agent.stream.ts), lines 187-252; [`agent-run.ts`](../../apps/web/src/lib/agent-run.ts), lines 235-329 | The Worker consumes the runner stream. Client detachment is not durable execution recovery. The runner command retains a whole-run timeout. |
| [`locked-resource-loader.ts`](../../packages/sandbox-runner/src/locked-resource-loader.ts); [`sandbox-egress-broker.ts`](../../apps/web/src/lib/sandbox-egress-broker.ts) | Explicit resource discovery restrictions and Worker-owned credential attachment already exist. Preserve them. |
| [`session-command.ts`](../../apps/web/src/lib/session-command.ts); [`session-command-delivery.ts`](../../apps/web/src/lib/session-command-delivery.ts) | Durable idempotent admission, command sequencing, and retrying delivery are implemented foundations. |
| [`journal.ts`](../../apps/runtime/src/journal.ts); [`session-runtime.ts`](../../apps/runtime/src/session-runtime.ts); [`runtime-crypto.ts`](../../apps/runtime/src/runtime-crypto.ts) | The coordinator already contains encrypted journaling, epochs, effect records, continuation guards, and retryable projections. |
| [`session-runtime-client.ts`](../../apps/web/src/lib/session-runtime-client.ts), lines 181-205; [`server.ts`](../../apps/runtime/src/server.ts), lines 349-355 | Trusted eligibility defaults false, transport defaults unavailable, and runtime model configuration reports false. This is not a working trusted Pi path for ordinary users. |
| [`packages/session-brain/Dockerfile`](../../packages/session-brain/Dockerfile); [`pi-recovery.ts`](../../packages/session-brain/src/pi-recovery.ts) | The brain package contains a local recovery feasibility recipe, not a serving production agent daemon. |
| [`alchemy.run.ts`](../../alchemy.run.ts), lines 18-142 | The separate topology is a local opt-in fixture. Normal configuration still binds Sandbox and both provider/GitHub credentials to the product Worker. |
| [`workspace-recovery.ts`](../../apps/web/src/lib/workspace-recovery.ts); [`sandbox-archive.ts`](../../apps/web/src/lib/sandbox-archive.ts) | Current recovery is filesystem archival with current/previous fallback, not committed archive/continuation pairing. |

The ongoing 005 executor worktree was not inspected. Its uncommitted review notes are status evidence, not proof that candidate source has landed here. Historical passing tests were not rerun for this research.

Do not describe all of this as either finished trusted-runtime integration or disposable legacy code. Retain accepted behavior and tests even where the implementation changes.

| Existing work | Proposed disposition if this candidate is accepted |
|---|---|
| Ownership, idempotent command admission, sequence allocation, outbox delivery | Retain. Pi submission IDs are an additional execution-side safeguard, not a replacement. |
| Runtime ownership fencing and nondestructive migration | Retain. Only one implementation may own mutations for a workspace session. |
| Encrypted journal, epochs, effect states, projection ordering | Retain policies and regression cases. Rework storage ownership around Pi Durable; remove duplicate continuation authority. |
| Trusted Node brain image and Node-to-DO protocol | Remove from this target after migration, not before feasibility passes. Preserve historical evidence. |
| Custom `AgentSession` import/barrier/continuation recipe | Replace with tested Pi Durable restoration. Prior SDK tests remain evidence for the old design, not proof of the new one. |
| Remote execution, Git contracts, project-value rules, credential-free archive transport | Retain and adapt. These protect the executor regardless of the framework. |
| Brain-only container identity and model egress interception | Revisit. A DO-hosted brain is not a container identity. Preserve execution/builder denial and fresh authority checks. |
| Paired checkpoints, preview quiescence, archive/deletion/retention | Retain. Pi task persistence does not solve workspace recovery. |
| Separate brain-container capacity pool | Remove only for the direct-DO topology; measure and bound the replacement cost model. |
| UI observation and assistant settlement requirements | Retain. Translate Pi records into Ditto's stable product contract. |
| Plans 005 through 012 | Rebaseline after a reviewed architecture decision. Do not execute topology-specific steps mechanically. |

No prior test result transfers automatically to a different engine. The acceptance scenarios often transfer; their fixtures, failure points, and expected implementation evidence will change.

Legacy history must remain readable. Resume only where an idle workspace archive can be paired with validated agent state. Otherwise preserve the history and require an explicit new action or recovery acknowledgment. A development-stage app does not need to destroy its records to change architecture.

## 11. Feasibility gates before revising the specification

All gates below are proposed and **not run** for this report. A package import or happy-path demo is not enough.

| Gate | Evidence required | Failure consequence |
|---|---|---|
| Workerd compatibility | Bundle exact pinned imports; run one real-provider turn, remote tool, follow-up, and compaction in the intended runtime. No Node filesystem/process dependency or hidden local fallback. | Revisit host or engine; do not weaken isolation. |
| Durable storage | Upstream storage conformance plus real DO transaction/rollback/reopen tests. Include encryption, wrong-owner ciphertext, key versions, payload bounds, and large-record handling. | Do not use the adapter for retained state. |
| Host lifecycle | Close browser, restart product Worker, evict/redeploy the owning DO, lose an alarm acknowledgment, and resume with no client present. Prove bounded scheduling without unintended cancellation. | Direct-DO hosting remains unproved. |
| No unsafe continuation | Kill the host after shell admission and before result commit. The model and all tools remain blocked while the effect is unknown, including after another restart. | Reject default replay policy; require a supported durable gate. |
| Stable completed effects | Kill after a completed tool result and during compaction or queued-message consumption. No completed mutation repeats; context and queues remain consistent. | Reject the continuation integration. |
| Stop and stale work | Stop with a non-cooperative shell and delayed callbacks. No replacement writer or fresh model request is admitted; capacity remains accurate. | Reject cancellation semantics. |
| Paired restore | Lose the sandbox after an edit but before archive publication. Restore a matching older pair, retain interrupted history, and preserve security/effect fences. | Do not claim workspace recovery. |
| Product continuity | Retry identical/conflicting command keys; reorder deliveries; fail D1 terminal projection; reconnect a slow client; observe with the executor stopped. | Fix the product mapping before cutover. |
| Credential and Git contracts | Executor cannot obtain model authority; no platform secret enters commands or archives; fixed-model requests validate; existing forbidden Git cases still reject. | No real-user enablement. Push stays separately gated. |
| Version and cost viability | Incompatible task/adapter versions fail closed. Measure cold start, active memory, context assembly CPU, storage write rate, tool latency, retry spending, and representative concurrency. | Revisit versions, resource policy, or topology. |

Use local adapters and workerd tests first. Paid Cloudflare integration requires separate authorization and a named disposable environment. Local mocks cannot establish platform identity, process termination, actual eviction behavior, or billing.

Run the feasibility work in an order that can reject the design cheaply:

1. Verify workerd imports and storage transactions with synthetic, non-sensitive data. No product migration.
2. Prove encrypted storage, passive recovery, alarm-hosted execution, and unknown-effect blocking. Stop here if they require a second custom agent engine or fragile private-API patching.
3. Exercise one isolated workspace through the authenticated command interface, paired recovery, Stop, and D1 projection faults.
4. With separate authorization, validate platform behavior and compare measured costs with the Node alternative.

If feasibility succeeds, the next artifact should be a revised specification that explicitly replaces the Node-only decisions, followed by rebaselined implementation plans. The affected specification sections include topology and responsibility, identity/privileged transport, Pi continuation, capacity, and migration. Encryption, strict uncertainty handling, paired recovery, and non-destructive cutover remain requirements unless separately changed.

If feasibility fails, retain the current accepted architecture and record which contract failed. A failure limited to workerd may justify evaluating Node-hosted Pi Durable. Encryption and unknown-effect policy are engine-integration issues that moving to Node does not automatically solve. Do not maintain two indefinitely active execution owners as a hedge.

## 12. Decisions for review

The first decision is whether to investigate the direct-DO Pi Durable candidate, not whether to deploy it.

Questions to settle before implementation planning:

1. Is replacing the coding-agent SDK acceptable if Ditto preserves its user-facing coding behavior through Pi Durable tools and extensions? This report recommends yes, subject to proof of the needed behavior.
2. Is deployment-owned framework code in the runtime Worker an acceptable trust assumption, or must the model credential remain outside the brain's process? The latter changes the topology.
3. Does Ditto retain the existing strict unknown-effect policy? This report recommends yes. The model should not arbitrate whether an uncertain shell command is safe to repeat.
4. Which measured latency, memory, storage-write, and cost thresholds make the direct-DO candidate preferable to the existing Node design? No numbers have been established by this research.

What should not change is already clear: repository execution remains untrusted, accepted commands remain durable, conversation and files recover together, platform credentials stay out of the sandbox, and uncertainty remains visible.

## Sources and evidence limits

The supplied blog posts were read in full, along with the current SDK/security pages and relevant session/message/containerization documentation. The upstream Durable README and normative specification were inspected with the implementation and relevant tests at the pinned revision. Installed Pi v1 SDK documentation was treated separately from Ditto's pinned `0.85.1` dependencies. The canonical Ditto target specification was read in full.

The primary-source links in sections 4 and 8 are the evidence for framework and platform claims. Section 10 links the current source for the implementation map. Proposed protocols and module choices are Ditto recommendations, not guarantees claimed by Pi or Cloudflare.

Upstream tests were inspected, not executed. No compatibility bundle, storage adapter, provider request, eviction test, benchmark, or paid-platform test ran. No security audit of the entire upstream dependency tree was attempted.

This is documentation research, not a test run. No claim of production readiness follows from it.

[pi-v1]: https://earendil.com/posts/pi-1-0/
[pi-durable-blog]: https://earendil.com/posts/pi-durable/
[pi-sdk]: https://pi.dev/docs/latest/sdk
[pi-security]: https://pi.dev/docs/latest/security
[pi-containerization]: https://pi.dev/docs/latest/containerization
[pi-session-format]: https://pi.dev/docs/latest/session-format
[pi-message-types]: https://pi.dev/docs/latest/message-types
[cf-fibers]: https://developers.cloudflare.com/agents/runtime/execution/durable-execution/
[pi-revision]: https://github.com/earendil-works/pi/commit/7fbbd5f4a1d982bb02d63472dde0774fa639f99b
[durable-package]: https://github.com/earendil-works/pi/blob/7fbbd5f4a1d982bb02d63472dde0774fa639f99b/packages/durable/package.json
[durable-readme]: https://github.com/earendil-works/pi/blob/7fbbd5f4a1d982bb02d63472dde0774fa639f99b/packages/durable/README.md
[durable-spec]: https://github.com/earendil-works/pi/blob/7fbbd5f4a1d982bb02d63472dde0774fa639f99b/packages/durable/docs/spec.md
[durable-demo]: https://github.com/earendil-works/pi/blob/7fbbd5f4a1d982bb02d63472dde0774fa639f99b/packages/coding-agent/src/experimental/durable/runtime.ts
[durable-submissions]: https://github.com/earendil-works/pi/blob/7fbbd5f4a1d982bb02d63472dde0774fa639f99b/packages/durable/test/harness-submissions.test.ts
[durable-tools]: https://github.com/earendil-works/pi/blob/7fbbd5f4a1d982bb02d63472dde0774fa639f99b/packages/durable/src/tools/index.ts
[durable-output]: https://github.com/earendil-works/pi/blob/7fbbd5f4a1d982bb02d63472dde0774fa639f99b/packages/durable/src/harness/output.ts
[durable-tool-task]: https://github.com/earendil-works/pi/blob/7fbbd5f4a1d982bb02d63472dde0774fa639f99b/packages/durable/src/harness/tool.ts
[durable-harness]: https://github.com/earendil-works/pi/blob/7fbbd5f4a1d982bb02d63472dde0774fa639f99b/packages/durable/src/harness/harness.ts
[durable-sqlite-facade]: https://github.com/earendil-works/pi/blob/7fbbd5f4a1d982bb02d63472dde0774fa639f99b/packages/durable/src/storage/sqlite/database.ts
[durable-sqlite-tests]: https://github.com/earendil-works/pi/blob/7fbbd5f4a1d982bb02d63472dde0774fa639f99b/packages/durable/test/sqlite-facade.test.ts
[durable-sqlite-storage]: https://github.com/earendil-works/pi/blob/7fbbd5f4a1d982bb02d63472dde0774fa639f99b/packages/durable/src/storage/sqlite/storage.ts
[cf-sqlite]: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/index.md
[cf-alarms]: https://developers.cloudflare.com/durable-objects/api/alarms/
[cf-do-limits]: https://developers.cloudflare.com/durable-objects/platform/limits/
[cf-worker-limits]: https://developers.cloudflare.com/workers/platform/limits/
[cf-d1]: https://developers.cloudflare.com/d1/worker-api/d1-database/
[cf-r2]: https://developers.cloudflare.com/r2/reference/consistency/
