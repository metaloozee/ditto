# Pi Durable workspace-session runtime

Status: authoritative target specification for new runtime plans and agent implementation. Architecture selected; implementation is feasibility-gated and not validated.

Prepared against Ditto checkout `cff52d1` from the maintainer discussion and [Pi Durable research](../research/pi-durable-cloudflare-architecture.md).

The maintainer prefers a new architecture and plan track, accepts losing existing development data and progress, and requires local-first development without paid Cloudflare deployment checks blocking implementation. That preference does not authorize any particular reset, deployment, live database operation, staging, or commit.

This document supersedes the [Node-based trusted workspace-session runtime specification](https://github.com/metaloozee/ditto/blob/52c9cef3ca2c471c69dfe4a0bdb3f507a8f45e13/docs/specs/trusted-session-runtime.md) for new runtime planning and implementation. Its requirements, module contracts, feasibility gates, and unresolved-decision restrictions are authoritative. Historical plans, architecture summaries, and research must not override it. Current code and tests still determine what runs today; selecting this target does not claim it already works.

Plans must cite the relevant numbered decisions, local phases, PD test IDs, and open-decision IDs. They may choose private implementation details but must not change state ownership, module interfaces, trust assumptions, or failure semantics without an explicit specification amendment. An unresolved decision is a gate on the named work, not permission for an agent to choose silently. Existing implementation evidence remains valid for its reviewed version, not proof of this engine.

Open decisions are listed under Further notes. They are deferred for maintainer resolution rather than answered through a new interview. The primary testing seam carries forward the previously approved authenticated command and observation interface; confirmation is recorded there as well.

## Problem Statement

A user needs accepted coding work to remain inspectable and controllable after closing the browser. A restart must not lose queued instructions, duplicate a shell command, or leave the conversation claiming that edits exist when recovery restored older files.

The running implementation places Pi beside repository code in an untrusted sandbox. The previous target separated them, but required a trusted Node container, a coordinator-to-brain transport, a second container-capacity pool, and custom reconstruction of the coding-agent SDK's continuation state.

That integration is not complete. Continuing it without reconsideration would commit Ditto to maintaining machinery that Pi Durable may already supply through persisted conversations and tasks.

The maintainer needs to determine this locally, without buying a Cloudflare plan merely to begin implementation. Local success must remain distinguishable from hosted validation. Existing development data must not force a complicated legacy importer into the new design.

## Solution

Give each workspace session one trusted runtime hosted in a SQLite-backed Durable Object. Pi Durable owns its agent conversation and task continuation. A separate untrusted execution sandbox owns the repository, Git processes, dependencies, tests, and preview.

Users continue to submit durable commands, observe progress, queue follow-ups, stop work, inspect history, and recover a workspace. The browser does not own execution lifetime. Files and agent context recover together. Unknown command outcomes stop automatic execution instead of inviting the model to guess whether repeating them is safe.

Keep the product Worker, ownership checks, D1 product records, R2 recovery archives, credential policy, and existing product behavior. Remove the trusted brain container and custom coding-agent continuation integration only after the local feasibility gates establish a supported replacement.

Start a new implementation track rather than patching the old Node-specific plans. Reuse useful policies, code, and regression scenarios without preserving an obsolete topology. Legacy continuation import is not a delivery requirement for this track. Any actual data reset remains a separate, explicitly scoped operation.

## User Stories

1. As a user, I want an accepted prompt to return a durable receipt, so that a lost response does not lose my request.
2. As a user, I want identical retries to return the original receipt, so that network failures do not create duplicate work.
3. As a user, I want conflicting uses of an idempotency key rejected, so that different instructions cannot silently share one receipt.
4. As a user, I want retries of my first prompt to reuse the original workspace session, so that I do not create duplicate conversations and branches.
5. As a user, I want unauthorized or invalid commands rejected before side effects, so that another user cannot affect my work.
6. As a user, I want queued work and expiry to remain visible, so that I can distinguish acceptance from execution.
7. As a user, I want to close the browser during a run, so that execution does not depend on my connection.
8. As a user, I want reconnecting to show committed history and current activity, so that I can understand what happened while disconnected.
9. As a user, I want slow observation connections to recover without blocking the agent, so that connection quality does not control progress.
10. As a user, I want follow-ups stored before acknowledgment, so that accepted instructions survive restarts.
11. As a user, I want follow-ups consumed in order, so that later instructions do not bypass earlier instructions.
12. As a user, I want canceled follow-ups to remain visible, so that cancellation does not erase what I asked.
13. As a user, I want Stop to bypass ordinary command gaps and capacity queues, so that cancellation is not delayed by unrelated admission work.
14. As a user, I want Stop to target the exact run, so that a delayed control does not cancel newer work.
15. As a user, I want execution to remain visibly stopping until accounted for, so that a receipt does not falsely imply that shell processes have stopped.
16. As a user, I want replacement mutations blocked while an old process can still write, so that two runs cannot corrupt my workspace.
17. As a user, I want completed tool results retained across restarts, so that already-completed mutations do not run again.
18. As a user, I want uncertain command outcomes to require review, so that external effects are not silently repeated.
19. As a user, I want compaction and provider context preserved, so that recovered conversations retain the information needed to continue correctly.
20. As a user, I want failed automatic recovery to stop within a defined deadline, so that my workspace does not retry indefinitely without explanation.
21. As a user, I want every settled run's pending assistants completed or failed, so that stale pending messages do not imply ongoing execution.
22. As a user, I want model success and backup health shown separately, so that a failed backup does not erase a completed answer.
23. As a user, I want restored files paired with their matching conversation position, so that the agent does not reason from edits that were lost.
24. As a user, I want later history retained as interrupted when recovery rolls back files, so that I can inspect what was lost without resuming it automatically.
25. As a user, I want current and previous matching recovery points, so that a corrupt latest archive does not force silent restoration from the original seed.
26. As a user, I want an initial recovery baseline before the first mutation, so that even early work has a defined recovery origin.
27. As a user, I want one isolated execution sandbox per workspace session, so that another session cannot access my repository processes or files.
28. As a user, I want repository code excluded from the trusted brain, so that dependencies cannot replace the agent or read its private state.
29. As a user, I want project environment values available only to authorized commands, so that builds can use configuration without exposing it to unrelated processes.
30. As a user, I want secrets removed from ordinary output and product history, so that an accidental command print does not become a lasting disclosure.
31. As a user, I want sensitive canonical runtime history encrypted, so that recovery does not create an unmanaged plaintext store.
32. As a user, I want the fixed model and existing thinking levels preserved, so that changing the architecture does not change model selection behavior.
33. As a user, I want existing Git ownership and secret checks preserved, so that moving the agent does not weaken export policy.
34. As a user, I want preview available between turns with visible backup status, so that I can inspect changes without assuming they are already recoverable.
35. As a user, I want preview stopped when safe checkpointing requires it, so that recovery does not capture a falsely consistent workspace.
36. As a user, I want history reads to avoid starting the execution sandbox, so that inspecting old work does not consume execution capacity.
37. As a user, I want archived work to retain its final recovery state, so that continuing it creates a separate line of work without changing history.
38. As a user, I want deletion to revoke authority before cleanup, so that late work cannot recreate a deleted project.
39. As an operator, I want one execution owner per workspace session, so that old and new runtimes cannot both mutate it.
40. As an operator, I want bounded execution, storage, observation buffers, and retries, so that one workspace session cannot consume unbounded resources.
41. As an operator, I want executor, builder, preview, and model-work admission accounted for, so that removing the brain container does not remove resource control.
42. As an operator, I want task and adapter versions checked on reopen, so that a deployment cannot silently reinterpret retained work.
43. As an operator, I want durable wakeups independent of clients, so that interrupted execution and product projections can resume without a browser.
44. As an operator, I want local tests against the actual Worker runtime and SQLite behavior, so that mocks do not hide incompatible platform assumptions.
45. As an operator, I want hosted checks reported separately from local checks, so that unrun deployment evidence is not reported as a failure or a pass.
46. As a maintainer, I want feasibility work to test the likely blockers first, so that I do not rebuild the product around an unsupported host integration.
47. As a maintainer, I want a fresh specification and implementation track, so that old Node-specific requirements do not constrain the replacement accidentally.
48. As a maintainer, I want useful existing policies and tests retained, so that restarting the design does not mean discarding hard-won behavioral knowledge.
49. As a maintainer, I want legacy data import excluded from the initial delivery requirement, so that disposable development history does not dominate the implementation.
50. As a maintainer, I want every destructive reset scoped and approved separately, so that architectural acceptance does not erase unrelated work or resources.

## Implementation Decisions

The words must and must not define target requirements. Open decisions constrain the affected implementation phase, not unrelated local investigation. Selection of this target authorizes neither destructive operations nor bypassing a failed feasibility gate.

### 1. Architecture and responsibility

The product Worker authenticates ownership, admits durable commands, owns product records and global admission policy, and remains the only issuer of GitHub installation tokens. It does not run the model loop.

A separately deployed runtime Worker owns a workspace-session Durable Object and the Sandbox class. Each workspace session has one owning runtime DO and one isolated execution sandbox. The runtime DO is a regular SQLite-backed Durable Object, not a container-backed trusted brain. Only the execution sandbox requires a repository execution container.

Private service bindings connect the Workers. The product Worker must not expose an arbitrary public proxy to privileged runtime methods. The runtime Worker must not become a public preview origin. Alchemy remains the sole deployment owner.

Pi Durable is the selected feasibility candidate. It replaces the coding-agent SDK integration; it is not an added persistence layer around an existing AgentSession. Do not retain two authoritative agent transcripts or two task-continuation engines.

No additional durable orchestration engine is introduced for the same conversation/task lifecycle. A failed feasibility gate reopens the architecture decision rather than permitting Pi beside repository code or a silent alternative engine.

### 2. Domain relationships

A workspace session continues to own a conversation, branch, trusted session runtime, trusted brain, execution sandbox, and recovery lineage.

The trusted brain becomes deployment-owned agent code executing inside the trusted runtime. It is no longer a separate Node process or container identity. A Pi conversation and a Pi task are implementation concepts, not substitutes for a workspace session or agent run.

Initially, one Pi conversation generation is active per workspace session. Recovery may retain inactive generations as history. A conversation fork does not create a Git branch, restore files, retire old tasks, or authorize work.

A Pi submission must map durably to a Ditto command and its message IDs. A Ditto agent run can encompass the initial prompt and accepted follow-ups. It is not inferred from one task's status, a streaming flag, or a watch event.

Execution sandboxes and project-seed builders retain distinct registered identities. The runtime's authority must be rooted in trusted routing and current product ownership, not a fabricated brain-container role or a caller-supplied workspace identifier.

### 3. Deep modules and their interfaces

The external seam is the existing authenticated command and observation interface. Callers learn Ditto intents, receipts, snapshots, and events, not Pi tasks, Sandbox stubs, storage transactions, or recovery steps. Routes and UI orchestrate through this seam. They do not reproduce scheduling or recovery policy.

A module's interface includes ordering, authority, idempotency, failure modes, and resource behavior, not just method names. The modules below own those contracts. Module names specify responsibility, not mandatory packages, classes, or one-file implementations.

#### 3.1 Caller-visible contracts

| Module | Interface callers may use | Guarantees and hidden implementation |
|---|---|---|
| Workspace-session commands | Submit an authenticated intent with an idempotency key; observe owned receipts/history; attach to committed observations with a cursor | Owns validation, first-session creation, atomic admission, sequence allocation, and delivery. Returns durable acceptance, never claims execution started from HTTP success. Hides D1/outbox and runtime transport. |
| Trusted session runtime | Accept a delivered command reference; apply a priority control; read a committed snapshot and subsequent events | Resolves command content and ownership from trusted records. Owns run transitions, Pi submission mapping, effect admission, mutation ordering, wakeups, recovery decisions, and product settlement. Delivery acknowledgment follows durable inbox acceptance and wakeup intent, not ordered consumption or execution. |
| Workspace execution | Execute an admitted typed operation; query/reconcile its outcome; request cancellation or isolation of its executor | Validates the exact runtime-owned operation and executor generation. Hides Sandbox lifecycle and tool/process protocols. Reports known completion, known pre-dispatch rejection, pending reconciliation, or unknown effect distinctly. It never grants new authority or invents replay policy. |
| Workspace recovery | Prepare capture or restore under runtime-granted exclusive mutation ownership; return verified artifacts or a classified failure; clean unreferenced artifacts | Hides archive streaming, integrity, extraction, encrypted snapshot content, and current/previous artifact verification. It cannot publish a usable pair or activate a conversation generation independently of the runtime. |
| Privileged access | Check model configuration without returning a key; perform an exact authorized model, Git, or product operation; obtain current authority/resource decisions | Hides credential attachment, fresh ownership/expiry checks, token minting, global capacity, and execution-only project-value materialization. It never returns platform credentials or treats caller-supplied IDs as authority. |

Read-only history may use product projections without activating the runtime. Live observation uses the runtime when required, but never enables scheduling or wakes the executor merely to answer a read.

Workspace-session commands is the product-facing module. The other interfaces are private implementation seams. Preview and UI Git submit typed intents through the same runtime owner; they do not gain a second mutation path. Project-scoped deletion and seed creation use existing owned project operations rather than inventing a workspace session solely to route them.

#### 3.2 Dependency direction and composition

Product routes depend on workspace-session commands and stable product contracts. The command module depends on product persistence and a narrow private runtime transport. Neither imports Pi, Sandbox implementation types, or runtime storage.

The trusted session runtime composes Pi Durable, the conforming storage backend, workspace execution, workspace recovery, privileged-access adapters, and its private projection mapper. It is the sole owner of per-workspace-session execution decisions. Workspace recovery may depend on the narrow admitted archive/restore operations of workspace execution so its callers do not orchestrate archive steps. Execution never depends on recovery. Both return evidence; the runtime decides publication, active-generation changes, and run transitions.

Recovery operations use the runtime's exclusive mutation scope. Each execution suboperation still passes the injected guarded admission interface, records its own outcome, and checks the current epoch and executor generation. The scope is not blanket authority for arbitrary shell execution. Private admission checks may invoke short local state transitions; they must not recursively invoke a public runtime command or wait on an orchestration lock held by their caller.

Keep deployment composition at the Worker/DO entry points. Inject narrow storage, execution, provider, authority, clock, and wakeup dependencies there. Domain modules do not discover global environment bindings, import a product-wide environment type, or construct infrastructure clients on demand.

Share versioned data contracts and policy where both Workers need them. Shared contracts depend on neither Worker framework, frontend, authentication implementation, database driver, nor Pi. Runtime-side policy reuse must not pull product UI/authentication code or secrets into the runtime import graph.

A service-binding request may traverse both Workers; that is transport, not permission for circular domain dependencies. Product callbacks answer bounded authority, capacity, projection, or mint-and-fetch operations. They must not synchronously re-enter a runtime operation that is waiting for their response.

#### 3.3 Runtime internals with one owner

Keep these responsibilities cohesive behind the runtime interface. They are not new public modules or independent execution owners:

- The state-transition implementation owns runs, epochs, admitted effects, workspace mutation ownership, checkpoint publication, and pending projections. Other adapters do not write its tables or edit its state directly.
- The Pi integration owns extension registration, submission/task mapping, provider/tool adapters, and translation of committed framework state. Pi owns task continuation; this integration does not implement a second scheduler or transcript reconstruction engine.
- The host-lifecycle adapter owns passive activation, alarm scheduling, bounded interruption, and reactivation. It invokes the same guarded runtime transitions rather than maintaining an alternative in-memory run lifecycle.
- The projection mapper converts canonical runtime state into bounded redacted product records and events. Public callers never deserialize arbitrary Pi records. Projection delivery retries do not rerun execution.
- The persistence adapter owns schema initialization, version compatibility, encryption, record references and transactional mechanics. It exposes only the specific storage contract its caller needs, not raw SQL to product callers or tools.

Use short local state transitions around external work: validate and commit intent, perform admitted I/O outside the transition, then conditionally commit evidence against the recorded run/epoch/generation. Recheck mutable local guards after asynchronous preparation. Stop and deletion can interleave during I/O; late evidence is reconciled against its originating operation rather than applied to whichever run is now active.

Avoid a single general-purpose coordinator method that accepts arbitrary callbacks or SQL. Also avoid splitting each state-machine action into a pass-through class. Private helpers may divide implementation for locality without expanding the interface callers must learn.

#### 3.4 State changes and commit ownership

| Change | Sole decision owner | Durable fact required before the next effect |
|---|---|---|
| Accept user intent | Workspace-session commands | Atomic product command/message/delivery record |
| Accept runtime delivery | Trusted session runtime | Durable inbox record and wakeup intent before acknowledgment, even if predecessors are missing |
| Consume ordered work | Trusted session runtime | Sequenced consumption and stable Pi-submission mapping before scheduling that instruction |
| Fence admission for checkpoint rollback | Workspace-session commands | Restore intent, ordinary-admission barrier, and command cutoff committed together before restore execution |
| Admit provider/tool execution | Trusted session runtime, with a fresh privileged-access check | Exact logical operation, authority scope, epoch, executor generation where relevant, and deadline |
| Complete a tool | Trusted session runtime | Validated result or encrypted reference before Pi can advance |
| Complete a run | Trusted session runtime | Terminal run decision and pending message projections in one local transaction |
| Publish a paired checkpoint | Trusted session runtime | Verified immutable artifacts, matching conversation position and generation, committed manifest plus pending projection |
| Restore files and active conversation | Trusted session runtime | Exclusive mutation ownership, chosen committed pair, retired/fenced prior tasks and preserved security/effect records |
| Project result to D1 | Product projection adapter | Idempotent update-only application for the exact target and ordering version |
| Revoke a project | Product authority operation, enforced by runtime/privileged adapters | Durable deleting/retirement fences before content cleanup |

Where a Pi commit and a Ditto safety transition can share one supported storage transaction, use it. Where they cannot, specify the intent/evidence protocol and prove both crash orderings before accepting the integration. Do not assert atomicity merely because both records use the same SQLite database.

The effect ledger and Pi task state have different jobs. The ledger establishes whether further external work is authorized and what is known about dispatched effects. Pi retains continuation. They correlate through stable logical IDs and evidence references; neither becomes a competing authority for the other's decisions.

#### 3.5 Failure and observation contracts

Expected failures use bounded, versioned domain outcomes with stable reason codes. Distinguish invalid/unauthorized, conflict, queued, unavailable-before-dispatch, recovering, stopping, outcome-unknown, incompatible-state, and storage-integrity failures. Transport adapters map these to HTTP or private RPC responses; product callers do not parse arbitrary exception messages.

A transport timeout is not a terminal execution result. Retrying delivery reuses the same command. Retrying an effect follows its recorded policy and evidence, not the generic transport error category. A logical effect does not become new work because a retry allocated a new request ID.

Run lifecycle, workspace execution readiness, recovery health, and product projection lag are separate observable facts. A complete run may have degraded backup health or pending projections. An unknown effect can leave a failed run with a review-blocked workspace. Cancellation can settle conversation work without proving executor death. Model these combinations explicitly rather than overloading one Boolean or status string.

Agent runs use queued, starting, running, recovering, stopping, complete, failed, and canceled states. Normal execution advances from queued through starting to running. Recovering preserves the run identity and may return to starting or running only after reconciliation. Stop enters stopping until execution is accounted for, or settles failed with a persistent uncertainty block. Canceled work has no remaining admitted authority. Complete requires all admitted instructions settled and no unresolved run effect. Complete, failed, and canceled are terminal; an explicit new action creates a new run rather than reviving one. Assistants use pending, complete, or failed, not the run-state enumeration.

Snapshots name a committed cursor and the active run/conversation generation. Public observations include only product-safe state and recovery actions. Opaque archive references, crypto metadata, raw framework records, and executor authority remain internal.

#### 3.6 Real seams, depth, and acceptance

Introduce an adapter where this change needs variation: real DO storage versus conformance/fault fixtures; Sandbox execution versus controlled failure execution; provider requests versus deterministic fixtures; platform wakeups/time versus a controlled clock. Share behavioral contracts between real and test adapters so a permissive mock cannot define different semantics.

The current product has one selected agent engine. A hypothetical AgentEngine abstraction, universal repository layer, plugin framework, or generic workflow engine is not required. Typed operation variants represent existing use cases rather than arbitrary names and payload bags. Parse unknown external data once at its owning interface and return typed domain results.

Review each module with the deletion test: removing it should force meaningful policy or sequencing into multiple callers. If removing a wrapper eliminates no complexity, inline it. Preserve interfaces that hide real work even when their implementation has several private helpers.

Future plans must identify which module owns each changed invariant, which existing seam exercises it, and which old implementation is replaced. Module acceptance requires behavior tests through that interface, fault tests for every new persistent handoff, and dependency checks against the forbidden imports above. Increasing file or interface count is not evidence of a better design.

### 4. Authoritative state and schema

| Location | Authoritative responsibility |
|---|---|
| D1 | Users, ownership, projects, workspace-session identity, accepted commands and delivery intents, identity retirement, privileged-operation windows, global resource admission, product projections and archive registry |
| Runtime DO SQLite | Pi conversations, submissions and tasks; Ditto run epochs, effect decisions, active conversation generation, committed checkpoint manifests, event positions, wakeup intent and pending projections |
| R2 | Immutable workspace archives and encrypted oversized runtime records referenced by committed metadata |
| Execution disk | Live repository and process state, never the sole durable copy of accepted work or agent continuation |
| Browser | Presentation and reconnect cursor, never execution authority |

Reuse existing product command and delivery records where their contracts remain valid. Replace topology-specific brain fields and custom continuation records rather than carrying them forward as a second authority.

Persist command-to-submission mappings, run-to-message membership, task/effect correlation, compatible engine/adapter versions, and active conversation generation. Record wakeup deadlines and retryable projection intent durably.

No transaction spans D1, DO SQLite, R2, the model provider, and a shell command. Each handoff requires durable intent, idempotent acknowledgment where possible, and reconciliation. A framework commit does not by itself prove that a remote effect was committed or that a filesystem archive exists.

Security and effect records that must survive recovery must not live exclusively in rewindable conversation documents.

### 5. Commands, delivery, and settlement

Prompt admission atomically stores the command, user message, pending assistant, sequence number, and delivery intent. The first prompt also creates the workspace session when needed.

Idempotency is scoped to the authenticated owner and target. Identical requests return the original IDs. Different payloads conflict. Pi's submission deduplication complements this contract; it does not replace payload-conflict validation or the D1 outbox.

The runtime persists inbox acceptance and wakeup intent before acknowledging delivery, including out-of-order commands. Acceptance is distinct from ordered consumption. Ordinary commands wait for predecessors or durable cancellation before Pi submission. Consumption and stable command-to-submission mapping must survive interruption without dropping or duplicating the instruction. Lost acknowledgments and reordered deliveries must not duplicate execution.

Missing model configuration, invalid thinking levels, ownership failure, archived state, and deleting state reject prompts before prompt-side effects. Model-free history and lifecycle actions remain available under their own policy.

Follow-ups retain their own user and assistant IDs and are consumed one at a time at supported turn boundaries. Canceled accepted work remains visible. Stop and authority revocation use a priority path independent of ordinary command gaps and capacity queues.

Terminal execution state and pending product projections commit together in local runtime storage. Projection retries are independent of browser presence and model success. Versioned, update-only projections prevent late results from overwriting newer state or recreating deleted rows.

Every settled run eventually projects its remaining pending assistants to complete or failed. Already-completed assistants remain completed when a later backup or follow-up fails.

### 6. Pi integration and tool behavior

Pin Pi Durable, its provider dependencies, task definitions, tool contracts, and Ditto adapters as a compatible set. Reopen rejects unsupported state versions with a visible recovery reason. A dependency upgrade that changes persisted task meaning requires a tested migration or an explicit recovery block.

Only deployment-owned extensions and tools run in the trusted runtime. Repository settings, executable extensions, MCP servers, skills, prompts, themes, and context discovery remain disabled. Generated JavaScript and repository commands must not execute in the Worker. Introducing Codemode inside the product agent is not part of this architecture change.

Preserve the coding tools actually used by Ditto, including remote read, write, edit, bash, grep, find, and list behavior. Do not assume stock Pi Durable tools provide feature parity. Attachment and image behavior must be inventoried and tested before claiming parity.

All repository access goes through the execution adapter. Remote failures must never fall back to Worker-local or host-local operations. Tool execution is explicitly sequential initially and serialized against UI Git, restore, checkpoint, archive, and destruction operations.

Preserve the fixed model `opencode/deepseek-v4-flash-free` and thinking levels `off`, `high`, and `max`. Validate actual request construction for normal turns, retries, follow-ups, compaction, cancellation, and Git metadata. A successful turn with another provider is not evidence for this contract.

### 7. Durable host lifecycle

Keep one open Pi Harness per owning DO instance. Serialize state transitions without holding a global concurrency block across model calls, sandbox calls, or an entire run.

On activation, open storage passively, inspect unfinished tasks and admitted effects, check current ownership and fences, reconcile the executor, and only then allow scheduling. Treat submissions, compaction, abort operations, and waits that enable scheduling as privileged runtime transitions.

A single alarm policy must cover runnable work, retry deadlines, unresolved effects, pending projections, and checkpoint publication. Persist wakeup intent before acknowledgment and reconcile missed scheduling. Duplicate alarm delivery must be harmless.

Execution must fit bounded host invocations while preserving durable continuation. Infrastructure interruption is not user cancellation. Browser connections, process timers, unawaited promises, and waitUntil must not be the sole lifetime guarantee.

The inspected framework has no proven bounded host-pump integration for this use. Closing can wait on non-cooperative invocations. The first feasibility phase must establish supported interruption and reopen behavior without overlapping owners or private scheduler manipulation.

If that cannot be achieved through supported interfaces, stop dependent implementation and report the required upstream change or alternative host decision. Do not hide the limitation with an endless alarm handler or a second continuation engine.

### 8. Execution evidence and uncertainty

Before dispatch, persist the originating run and assistant, Pi task/tool identity, validated arguments, expected executor incarnation, lifecycle generation, run epoch, deadline, and replay policy.

Distinguish prepared, admitted, result-recorded, and outcome-unknown operations. Prepared means dispatch has not been admitted; admitted means execution may have occurred. Missing acknowledgment does not prove absence of effects.

Persist the bounded result or an encrypted durable reference before allowing Pi to consume it and request another effect. Duplicate results are idempotent; conflicting results block review. A persistence failure denies further model and tool admission even if the framework treats it as an ordinary recoverable error.

Mandatory provider and executor adapters enforce authority, Stop, persistence barriers, and unknown-effect blocks. Hooks alone are insufficient. Pi's unsafe-tool recovery can report interruption and continue the parent generation; Ditto must prevent that continuation from issuing any further model request or tool operation while the effect is unresolved.

Read-only operations may repeat under an explicit new-observation policy. Structured writes require expected-content or equivalent idempotency support before replay can be considered. Arbitrary shell and external effects must not be automatically repeated or compensated after an uncertain dispatch.

An unknown effect settles the affected run failed and leaves the workspace session blocked for review. Further automatic execution remains blocked after restart. An explicit new user action can acknowledge uncertainty, but does not make an old writer safe or erase the effect record.

Sandbox-local receipts are diagnostic evidence, not platform authority or exactly-once proof. Model retries are recorded as separate attempts because they may spend again and produce different answers.

### 9. Stop, deadlines, and stale work

Stop durably advances the run epoch and denies new admissions before requesting cooperative cancellation. Late controls cannot revive the targeted run or cancel a distinct later run.

Expose recorded Stop, applied Stop, stopping execution, and accounted-for execution accurately. Cancellation of a Pi task is not proof that a remote shell or background process has terminated.

A replacement mutating run waits for trusted termination evidence or isolation of the previous executor. An isolated but still-running old executor continues to consume capacity. Discarding uncheckpointed work requires an explicit recovery acknowledgment.

Preserve the existing policy of a persisted 15-minute automatic recovery deadline measured from first interruption. Retries do not reset it. Expiry fails the run and revokes admission while unresolved processes remain tracked.

Individual tools and model attempts have finite persisted deadlines. The old whole-run timeout is not the new agent-run lifetime limit. Compaction and background work obey the same authority and Stop rules.

### 10. Encrypted storage adapter

Canonical runtime content must be encrypted before persistence to SQLite or R2. Cloudflare-managed disk encryption does not replace application encryption.

Use versioned authenticated encryption with AES-256-GCM, unique nonces, and associated data binding owner, workspace session, record identity, and format version. The runtime-state key is separate from authentication secrets. Wrong-owner records, tampering, missing keys, and unsupported versions fail closed.

Implement a conforming Pi Storage backend or a reviewed supported extension. A SQL facade around the stock plaintext backend is acceptable only for disposable synthetic feasibility data, not retained user content.

Define which routing and ordering metadata remains queryable and which payloads are encrypted. Cover transcript entries, submissions, task checkpoints, model request state, tool arguments/results, document bases/deltas, historical copies, and mixed atomic writes. Do not encrypt only final messages.

The adapter must preserve transaction ordering, rollback, expired-handle rejection, scans, document materialization, and atomic mixed operations. Use actual DO transaction semantics; do not substitute concurrency blocking for rollback or await asynchronous work inside a synchronous transaction callback.

Bound every persisted representation. Offload or chunk oversized private data under an explicit encrypted format. Commit references only after required content is available and verified. Restore must recover original semantic content, not truncated substitutes.

Key rotation retains decryption for referenced records until re-encryption or authorized deletion. Storage performance and context reconstruction must be measured under real local workerd, not inferred from Node tests.

### 11. Paired checkpoint publication and restore

A committed paired checkpoint identifies an immutable workspace archive, its matching conversation position and required document state, compatibility versions, mutation generation, executor incarnation, and outstanding-effect disposition.

Establish an initial pair after seed restore and branch synchronization, before the first agent mutation. Capture later pairs at acknowledged quiescent run or Git-mutation boundaries. Per-tool filesystem archival is not required.

Acquire exclusive mutation ownership, account for in-flight operations, and quiesce managed writers before capture. Write and verify archive bytes and encrypted runtime content first. Commit the immutable manifest and pending D1 projection together only after both are usable. Prepared objects are not restorable pairs.

Keep current and previous successful pairs. Restore both files and context from the same pair. If neither is usable, preserve evidence and block execution; never silently replace mutated work with the project seed.

Prefer a new active conversation generation rooted at a quiescent checkpoint while retaining later history as interrupted. The concrete restoration recipe must prove that old tasks, queued submissions, retries, and background work cannot restart when scheduling resumes. A fork alone does not establish that property.

Restoring an older pair must also settle the fate of accepted instructions. Before restore begins, the product command module atomically records an ordinary-admission barrier and a command-sequence cutoff with the durable restore intent. The cutoff covers ordinary work admitted before the barrier; the restore control is tracked separately and is not canceled by its own dispositions. History, Stop, revocation, and cleanup remain available. The runtime records a disposition for every affected command through that cutoff, including accepted commands whose delivery has not arrived:

- Commands already incorporated into the selected pair remain incorporated and are not submitted again.
- Completed work after that pair remains visible as later interrupted history, with completed assistants preserved. Known or unknown external effects remain recorded independently of the restored files.
- Interrupted commands and accepted-but-unstarted commands associated with the discarded execution history are closed with a recovery reason. Their pending assistants become failed. None is automatically submitted against the older workspace, even if it never reached Pi.

Persist those dispositions and corresponding projection intents before activating new execution. They advance sequence processing without rewinding or deleting deduplication. A late delivery receives its recorded disposition, not a new submission. Ordinary admission reopens only after the matching files and active conversation generation are established and the runtime acknowledges a durable restore-completion record. Reconciliation repairs a lost acknowledgment; it must not release the barrier based on timeout alone.

The user must submit a new explicit action with a new idempotency key to reapply affected instructions. A duplicate of an old command continues to return its old receipt. Test crashes before and after the cutoff, each disposition batch, active-generation change, and admission reopening so neither accepted work nor authority is silently lost.

Do not rewind ownership, deletion tombstones, command deduplication, run epochs, or unresolved external effects to match old files. Whole-coordinator rollback is not a workspace recovery mechanism.

A completed assistant remains complete if backup fails. Show recovery degradation separately and retry publication without rerunning completed effects where prepared content remains valid.

### 12. Credential and network contracts

The product Worker alone holds the GitHub App private key and mints installation tokens. The runtime Worker holds the runtime-state encryption key and, under the proposed trust choice, the model key. Neither enters the execution sandbox.

The runtime Worker must not receive authentication secrets, GitHub OAuth secrets, or installation tokens. Project environment values are decrypted by the product side and materialized only for a currently admitted execution command.

The direct-DO design removes process isolation between Pi and runtime credential-handling code. Only pinned deployment-owned code is permitted there. If the maintainer requires the model key outside the framework's Worker, resolve that decision before credential wiring; local synthetic feasibility can proceed without it.

Every privileged operation validates fresh ownership, identity role where applicable, retirement, lifecycle generation, run epoch, operation window, and expiry. Queued work does not obtain execution authority. Revocation must not wait for a later product projection.

D1 authority checks must not use a cache that extends revocation or expiry. Each authority subject has at most one open operation per contract family. Three contract denials close that operation, halt the affected run, and mark the workspace session for review without deleting work. Already-admitted requests remain in flight until reconciled; later revocation cannot retroactively undo an external effect.

Model access uses a narrow adapter with fixed provider/model policy, bounded request validation, controlled retries, and recorded admission. Validation covers method, exact destination and path, port, query, content type and encoding, streaming protocol, complete bounded body schema, operation type, and contract version. Reject duplicate or malformed authority fields, unexpected authorization/proxy headers, unsupported schemas, and redirects. No credential-bearing request forwards an unvalidated original body or headers. Git metadata retains a single atomically reserved model attempt; failure does not refund that allowance.

Runtime-side Git validation is followed by a fresh product-side authority check, repository-scoped token minting, and upstream fetch. Credentials are attached only to a reconstructed validated request. Privileged denial never falls through to public network access.

Retain the existing credential-free execution network policy, rejection of private/internal/metadata destinations and malformed authorities, redirect validation, and disabled non-HTTP traffic. Container egress interception does not restrict arbitrary fetch calls by trusted Worker code; do not claim otherwise.

### 13. Git, seeds, archives, and project values

Retain owned-repository and workspace-branch policy, closed credential-free Git child environments, disabled hooks and credential helpers, fixed trust configuration, no redirects, and secret preflight. UI Git and agent Git use the same policy and mutation serialization.

Push and pull-request creation remain gated until the required forbidden-ref and non-fast-forward rejection evidence exists. Architecture acceptance does not enable them. Agents cannot merge or close pull requests.

Projects retain immutable seeds and no live project-wide runtime. Temporary builders have execution-only identities, no trusted brain or model authority, and no project environment values. They fetch only the owned repository and retire permanently after completion.

Archive bytes travel between fixed execution paths and Worker R2 bindings over bounded streams. Execution sandboxes and builders receive no storage credentials, object keys, signed URLs, bucket mounts, or internal bearer capabilities.

Preserve archive integrity, safe extraction, Git validation, current/previous fallback, and compatibility checks. Initial policy remains 1 GiB compressed, 3 GiB extracted, with peak disk usage within 70 percent of available capacity. These are configurable ceilings, not evidence that any particular runtime or free-tier storage budget can support them.

Source-only recovery is the initial dependency policy. Dependency-inclusive archives require the existing representative cold-restore benchmark and safety gates before enablement; ten restores per path and at least 30 percent p95 improvement do not waive integrity or disk limits.

Project environment values enter only authorized repository commands. They must not enter repository environment files, brain configuration, builders, preview, Git transport children, archive helpers, or container entrypoints. Repository commands can still leak values through output or allowed public traffic; encryption and redaction do not promise total exfiltration prevention.

### 14. Observation, redaction, and retention

Expose bounded, redacted product snapshots and events. Do not proxy raw Pi views or watches to the browser or treat them as a stable append-only audit interface.

Durable semantic events use monotonic positions. Reconnection obtains a committed snapshot followed by later events without a gap. Duplicate delivery is harmless; stale cursors receive replacement snapshots. Transient deltas identify their run, attempt, and committed position so a snapshot can discard stale partial content.

Redaction covers split streaming secrets, stderr, errors, structured tool payloads, and stored product messages. Slow subscribers are detached without blocking execution. History and observation may activate the runtime DO to read storage but must not enable Pi scheduling or wake the execution sandbox.

Retain canonical conversation history for the workspace session's lifetime, including archive. Active work and current/previous checkpoints pin their required content. Preserve the existing 30-day detailed-denial retention and 24-hour eligibility for unreferenced transient output. Deletion uses retryable cleanup rather than assuming one successful cross-store transaction.

Observability records trusted correlation IDs, versions, timings, statuses, byte counts, epochs, and reason codes. Never log raw provider records, decrypted continuation, credentials, archive content, Git pack data, or capability URLs.

### 15. Capacity, preview, archive, and deletion

Remove brain-container capacity reservations from the direct-DO target. Keep execution capacity, including builders and preview-only work, and add explicit admission limits for concurrent model work and active runtime execution. Preserve the execution-pool defaults of 20 global and two per user as configurable policy, not platform entitlement or an affordability claim.

Ordinary capacity waiting remains durable FIFO with a persisted 15-minute expiry and user cancellation. Stop, revocation, and cleanup bypass capacity acquisition. Resolve queue expiry against the runtime's actual execution decision; a lost acknowledgment must not allow a dispatcher to fail healthy work independently.

Before multi-workspace integration is enabled, execution and model work must use bounded provisional admission, durable queue expiry, and live-executor accounting. OD3 defers final measured limits, not the existence of admission control. Earlier single-workspace experiments may instead enforce a hard one-runtime/one-executor ceiling in isolated disposable fixtures; they are not evidence of multi-workspace capacity behavior.

Lease expiry is not proof of process death. Track live isolated executors until termination is established. Model-work limits and cost thresholds require maintainer approval after measurement.

Preserve the fixed preview command, port 10000, product-origin routing, and authenticated delivery of revocable bearer preview URLs. Cold preview restores a committed pair without starting Pi.

Preview may defer checkpoint initiation for at most ten minutes from the first unbacked mutation. Later mutations do not extend that deadline. At expiry, stop preview and new mutation admission. A read or expected-content structured write can finish within its own deadline. An arbitrary shell or unknown operation is canceled, marked unknown, and blocks review rather than producing a falsely consistent checkpoint.

Restart preview after checkpoint only for recent traffic or explicit demand. Backup retry and preview restart remain distinct actions. Preview-created application data remains disposable.

Archiving requires stopped or isolated execution, a final committed pair, and revoked preview authority. Continuing archived work creates a new workspace session, branch, identities, and recovery lineage without resuming old pending tasks.

Project deletion first blocks admission and revokes authority, then cancels work, revokes previews, terminates execution, and schedules content cleanup. Minimal non-secret retirement and deletion fences outlive content removal. Late commands and projections must not recreate deleted records.

### 16. Clean-start policy and supersession

This track does not require a legacy AgentSession importer, automatic continuation of existing conversations, or prolonged dual-engine compatibility. Existing development data may be excluded from the new runtime's input contract.

That scope decision is not a reset command. Keep existing data, source, worktrees, plans, and review evidence intact until a separately named operation is authorized. The eventual clean-start procedure must identify the exact environment and resources, revoke old authority, account for live work, and prevent late deliveries before enabling the new owner.

Prefer isolated disposable local state for development rather than deleting the existing environment merely to test the candidate. Never allow two active mutation owners for one workspace session.

Reuse command admission, delivery, ownership, Git policy, redaction, archive policy, crypto utilities, and useful regression scenarios after checking their new assumptions. Replace Node-specific continuation and transport rather than forcing compatibility. Historical passing tests do not transfer automatically.

This specification is the authority for the selected replacement. The old specification, topology-specific plans, reviews, and acceptance records are preserved in Git at `52c9cef3ca2c471c69dfe4a0bdb3f507a8f45e13`, linked from the [documentation index](../README.md). The maintainer authorized clearing those obsolete files from the working tree after that snapshot. This is documentation cleanup, not a data reset or implementation transition. Update implementation-facing documentation as each phase lands without describing unimplemented behavior as current.

A failed feasibility gate blocks dependent implementation. It does not restore the old architecture as a silent fallback, permit an agent to waive a requirement, or authorize deleting either implementation. Reopen the affected decision explicitly.

### 17. Feasibility-first implementation sequence

Do not expand all downstream work into detailed execution tickets before the likely blockers are tested. L0 through L6 are ordered gates: each phase requires the preceding phase's local exit evidence. An explicitly deferred external check does not block unrelated local work, but must remain listed as outstanding. Each phase records exact versions, environment, commands, evidence, and passed, failed, or not-run status.

| Phase | Work | Exit evidence and dependency |
|---|---|---|
| L0: runtime compatibility | Pin the candidate imports and toolchain; bundle and run a synthetic model turn and remote tool in local workerd with one execution sandbox | No hidden Node filesystem/process dependency or trusted-host fallback; local prerequisites documented |
| L1: host lifetime and safety | Prove passive startup, bounded interruption/reopen, durable wakeups, Stop, and unknown-effect blocking using disposable synthetic storage | No duplicate owner, no unintended user cancellation, and no model/tool admission after an uncertain effect, including another restart; failure stops dependent architecture work |
| L2: durable private state | Implement conforming encrypted storage, version checks, size handling, document history and transactional failure behavior | Upstream storage conformance plus real local DO SQLite rollback/reopen, tamper, wrong-owner, key rotation, history and large-record tests; no real user content in the earlier plaintext fixture |
| L3: one product vertical slice | Connect authenticated prompt admission, D1 delivery, Pi submissions, remote tools, provisional resource admission, follow-ups, Stop, observations, and terminal projections | Disposable-fixture command tests survive delivery duplication, sequence gaps, browser loss, runtime restart and projection outage; provider request construction is contract-tested, with actual-provider evidence separately tracked under PD38 |
| L4: recoverable workspace | Implement initial and later paired checkpoints, safe generation retirement, restore/fallback, seeds, Git serialization and preview quiescence | Every publication crash point is safe; restoring older files selects matching context while preserving effect/security fences and preventing old-task execution |
| L5: product completion | Complete measured resource policy across agent, builder and preview demand, Git and project-value contracts, archive/continue, deletion/retention, redacted reconnect behavior and local clean-start rehearsal | Full locally runnable behavioral matrix, measured resource usage, supported existing UI flows, and no competing execution owner; deferred external checks remain named |
| L6: local acceptance and implementation transition | Resolve affected open decisions, review evidence, synchronize implementation-facing documentation, and retire Node-specific implementation once replacement behavior is covered | Explicit local acceptance against this authoritative target; old evidence preserved; hosted readiness separately not run; any actual reset or deployment remains separately authorized |

Until L4 proves the initial paired baseline, mutating demos and fault tests are restricted to explicitly disposable synthetic workspaces. L3 must not enable a retained user workspace without the baseline required by section 11. Alternatively, implement that prerequisite early and prove it before the first retained mutation; later restore/publication coverage still belongs to L4.

Credential-policy work needed by a slice must be implemented before real secrets or external effects enter that slice. Provisional resource admission must precede multi-workspace execution. The ordering above is not permission to postpone access control or resource limits until L5.

If L1 requires fragile private APIs, a second task engine, or a maintained fork, stop and resolve the framework-support decision before deeper integration. If encrypted storage or paired restore fails, do not weaken those guarantees to keep the schedule.

### 18. Local completion versus hosted readiness

Local development and local acceptance require no paid Cloudflare deployment. Use actual local workerd, SQLite-backed Durable Objects, and Docker-backed execution under the existing Alchemy development path. Do not add a competing deployment owner or combine this change with a Sandbox SDK protocol migration.

Local tests must inject interruptions and duplicate wakeups, but must not label simulated eviction or mocked platform identity as hosted evidence. Use deterministic provider fixtures for faults and request-shape tests. Real-provider compatibility, when authorized credentials are available, is a separate gate; fixture success alone cannot establish it.

Hosted eviction, deployment/update behavior, service-binding authority, execution termination, egress interception, provider networking, quotas and billing remain separate validation. On an account without the required entitlement, record them as not run with the reason, not as an architectural failure.

The remaining hosted execution sandbox still requires the appropriate Cloudflare plan. Removing the brain container does not make the full product deployable on the free tier.

Local acceptance means the locally tested architecture and behavior are complete within stated limits. It does not authorize deployment or establish hosted production readiness. A later platform failure reopens the affected design instead of permitting a silent security downgrade.

## Testing Decisions

### Primary seam

Use the authenticated workspace-session command and observation interface already approved for the trusted-runtime work. Submit prompts, retries, follow-ups, Stop, recovery decisions, and lifecycle actions through product handlers. Assert receipts, messages, snapshots/events, resulting files, recovery state, and rejection of unauthorized effects.

The same interface should drive the main fault matrix. Do not expose coordinator internals or task-control methods solely to make end-to-end tests easier. Existing injected-auth tests remain useful and must be labeled as such; add a bounded real-auth HTTP smoke rather than claiming injected identity proves cookie authentication.

This carries forward the existing seam instead of inventing a new one. Maintainer confirmation is deferred under OD5, as requested.

### What makes a good test

A good test demonstrates an observable guarantee that can regress. Losing an acknowledgment must not create two runs. A crash after shell admission must block new effects. Restoring an old archive must not retain newer active context. Tests that merely assert file existence, class names, or successful mounting are insufficient.

Use deterministic clocks, crash points, provider fixtures, and fault-injecting execution adapters behind existing interfaces. Pair those tests with real local workerd and DO SQLite tests for semantics that Node-only doubles cannot establish.

Focused conformance tests are justified below the primary seam for the storage backend and cryptography. They must cover the upstream contract, not invent a second application interface.

### Prior art and modules

Reuse behavioral patterns from existing command admission/delivery, runtime journal/control, projection, runtime crypto, SandboxAuthority, SandboxEgressBroker, workspace capacity/recovery, Git policy, and redaction tests.

Existing Pi restoration tests remain evidence for the old SDK only. Carry forward their scenarios, such as completed-result recovery, compaction boundaries, and follow-up consumption, with new fixtures and crash points for Pi Durable.

Test workspace-session commands, trusted session runtime, workspace execution, workspace recovery, and privileged access primarily through the shared product seam. Use focused storage/provider/crypto contracts where faults cannot be established honestly through that seam alone.

### Required local behavior matrix

| ID | Fault or action | Required observation |
|---|---|---|
| PD01 | Foreign, archived, deleting, invalid-model, or invalid-thinking target | Rejection before command, provider, or sandbox effects |
| PD02 | Identical retry, including first prompt | Original receipt, workspace session, and message IDs; one logical command |
| PD03 | Same key with changed payload | Conflict without another submission or message pair |
| PD04 | D1 commit before interrupted delivery; lost runtime acknowledgment | Eventual delivery with no duplicate execution |
| PD05 | Reordered ordinary commands and cancellation | Ordered consumption or explicit durable cancellation, never silent skipping |
| PD06 | Stop with missing predecessors or exhausted capacity | Priority control applies; delayed targeted work cannot start |
| PD07 | Browser detaches and product Worker restarts | Execution continues or recovers without browser-owned lifetime |
| PD08 | Runtime interrupted and reopened repeatedly | Passive reconciliation precedes effects; exactly one owner is active |
| PD09 | Bounded host yield during model/tool work | Durable progress remains recoverable; infrastructure yield is not user cancellation |
| PD10 | Missed alarm scheduling, duplicate wakeups, handler failure | Retained wakeup intent is reconciled without duplicate effects |
| PD11 | Crash after completed model/tool result; compaction or follow-up consumption | Original IDs, provider metadata, context and queue position survive without completed mutation replay |
| PD12 | Shell admitted, result commit missing, then two restarts | Persistent uncertainty blocks all further model/tool admissions |
| PD13 | Persistence barrier fails inside an adapter | No subsequent provider or executor effect occurs, even if Pi reports a recoverable error |
| PD14 | Shell ignores cancellation; stale result arrives | No replacement writer until stopped or isolated; stale state cannot overwrite current work; live capacity stays tracked |
| PD15 | Model retry after interruption | New attempt and possible additional spending are visible; no exactly-once billing claim |
| PD16 | Recovery deadline expires | Pending assistants fail while unresolved execution remains accounted for |
| PD17 | Storage rollback, unrelated concurrent operation, expired transaction handle | Backend ordering and rollback conform to the upstream contract |
| PD18 | Ciphertext tamper, wrong owner, missing/rotated key | Authentication fails closed or authorized historical records decrypt correctly; no plaintext fallback |
| PD19 | Document deltas/history, atomic mixed writes, oversized task/request state | Exact semantic restoration with bounded storage and verified references |
| PD20 | Crash at every paired publication stage | Only fully committed matching pairs are restorable |
| PD21 | Edit completes after last archive, then executor is lost | Matching older files/context restore; later history is interrupted; security/effect records remain current |
| PD22 | Resume after restoring a child conversation generation | Old tasks, submissions and background work cannot execute |
| PD23 | Current pair corrupt, then previous pair corrupt | Matching fallback or explicit block; never silent seed restore |
| PD24 | Successful assistant followed by backup or D1 projection outage | Assistant success remains durable; recovery degradation and projection lag are distinct and retryable |
| PD25 | Preview repeatedly mutates during backup deferral | First deadline remains fixed; unsafe quiescence blocks rather than publishing a false checkpoint |
| PD26 | Slow observer, duplicate events, stale cursor, split secret | Agent progress continues; snapshot repairs state; output remains bounded and redacted |
| PD27 | History or event subscription with stopped execution | No sandbox wake or Pi scheduler activation |
| PD28 | Executor or builder requests model/control/storage privilege | Denial before credential attachment or privileged side effect |
| PD29 | Repository shadows tools, configuration, extensions, or paths | No trusted-runtime execution or local-tool fallback |
| PD30 | Project values, Git children, archives and preview inspected | Values appear only where authorized; platform credentials never enter execution |
| PD31 | Wrong branch, forbidden Git request, malformed authority, expired/revoked operation | Fail closed without public-network fallback; push remains gated |
| PD32 | Concurrent executor, builder, preview and model demand | Configured limits hold; no duplicate claim or unaccounted live resource |
| PD33 | Queue expiry races with lost handoff acknowledgment | Runtime resolves actual start versus expiry; accepted instructions remain visible |
| PD34 | Archive/continue and deletion race with tasks, publication or projection | New lineage never resumes old work; revocation precedes cleanup; no resurrection |
| PD35 | Garbage collection with current/previous pairs and active recovery | Referenced content survives; unreferenced content is cleaned under retention policy |
| PD36 | Incompatible engine/task/adapter version on reopen | Visible recovery block instead of silent reinterpretation |
| PD37 | Clean-start rehearsal with late old commands and live execution | Old authority is fenced before new ownership; no accidental import or competing writer |
| PD38 | Actual selected provider request, response, compaction and cancellation | Fixed-model contract works; deterministic mock success is not substituted for provider evidence |
| PD39 | Real-auth HTTP smoke with missing, expired, foreign and valid sessions | Correct public authentication and ownership behavior, separate from injected-auth tests |
| PD40 | Restore cutoff races with accepted follow-ups, undelivered commands, disposition commits and admission reopening | Every affected command has a durable fate; pending assistants settle; old keys remain deduplicated; no instruction is silently stranded or replayed against older files |

PD38 can remain not run during credential-free local development. Record it as an outstanding provider-validation gate rather than describing the agent integration as fully verified against the selected provider.

### Verification and evidence

Use the nearest existing test commands while implementing. Narrow web tests use `pnpm --filter @ditto/web exec vitest run <paths>`. Runtime tests use the existing runtime test command and add real workerd coverage for the new backend and host. Keep `pnpm verify` and `pnpm runtime:verify` as inherited checks while updating repository verification to include the new runtime's required tests. Verify retained brain code while it remains in scope; do not keep an obsolete package solely to preserve a historical test count.

Only documentation structure, link, and diff checks were run to produce this specification. No runtime tests, import bundle, encrypted adapter, provider turn, eviction experiment, benchmark, or deployment has passed merely because it appears in this plan.

Record exact package versions, toolchain, compatibility date, image digest where relevant, test environment, commands, result, and evidence limits. Never put secrets, raw provider content, archive bytes, or capability URLs in evidence.

## Out of Scope

- Implementing a second agent engine or keeping old and new runtimes as permanent competing owners.
- A trusted Node brain container in the selected direct-DO target.
- Repository execution, repository-selected extensions or MCP servers, or model-generated code inside the trusted Worker.
- Legacy continuation import, automatic migration of old agent sessions, or preservation of all development data as a delivery prerequisite.
- Any actual reset, database drop, live cleanup, deployment, paid-platform experiment, staging, or commit authorized by this document alone.
- Rewriting the whole application, changing authentication, redesigning the UI, or enabling the terminal/code-browser tabs.
- Changing the fixed model, adding provider selection, bring-your-own credentials, or a new per-token billing product.
- A concurrent Sandbox SDK protocol migration or an alternative deployment path.
- Exactly-once arbitrary shell effects, automatic compensation, or blind replay after uncertainty.
- Full-VM snapshots, live process migration, multi-session shared execution, or independently mutating subagents.
- Preserving preview-generated application data or promising complete prevention of project-value exfiltration.
- Enabling Git push or pull-request creation before their existing gates pass.
- Treating local acceptance as proof of hosted production readiness.

## Further Notes

### Open maintainer decisions

These are choices, not hidden permissions. Recommended defaults make local investigation possible, but affected production-facing implementation must wait for resolution where indicated.

| ID | Decision to resolve | Recommended default | When it matters |
|---|---|---|---|
| OD1 | May pinned Pi framework code share the runtime Worker with the model credential adapter, or must the credential live in a separate Worker? | Accept the shared trusted runtime for deployment-owned code; retain the GitHub private key in the separate product Worker. Do not claim framework-to-key process isolation. | Before real credential wiring; synthetic L0-L2 work can proceed |
| OD2 | If bounded host lifecycle needs an upstream change, is a maintained Pi Durable fork acceptable? | Prefer supported upstream interfaces or a small upstreamed host API. Do not silently maintain a private scheduler fork. Stop and review if one is necessary. | Immediately if L1 cannot pass through supported interfaces |
| OD3 | What local latency, memory, storage-write and tool-round-trip budgets, and concurrent model-work limits, constitute acceptance? | Measure representative small, medium and large workspaces first, then approve explicit ceilings. Keep execution limits configurable; make no unmeasured cost-saving claim. | Before L5/L6 resource-policy acceptance; hosted spending remains unmeasured until separately tested |
| OD4 | Which existing data and environments may the eventual clean start discard, and what export or backup is wanted first? | Use new isolated local state now. Name any later database, DO namespace, bucket content, identities and affected users before approving a reset. Keep source and historical review evidence. | Before an actual reset or cutover, not before local development |
| OD5 | Does the previously approved command/observation testing seam remain the primary seam for this engine? | Yes. Keep focused storage/crypto conformance below it and a bounded real-auth HTTP smoke. | Before finalizing detailed implementation tickets; this draft uses that seam provisionally |

Strict unknown-effect blocking, encrypted canonical state, paired recovery, one execution owner, and local-first development are carried-forward requirements, not unresolved choices.

### Engineering questions to answer with evidence

These are feasibility results to establish, not questions the maintainer must answer from intuition:

- The exact compatible Pi/provider/toolchain pins and complete workerd import graph.
- Supported bounded interruption, close/reopen behavior, durable wakeups, and the absence of overlapping owners.
- Conforming encryption of every private representation without breaking document history, scans, transactions, or size bounds.
- A safe recipe to retire or fence every old task and submission when activating a checkpoint-derived conversation.
- Exact selected-provider behavior, tool and attachment parity, and measured local resource usage.
- The portions of platform identity, process termination, egress, eviction and billing that cannot be validated locally.

Do not turn an unanswered engineering question into an assumed guarantee. Failed local safety gates stop dependent implementation; unavailable paid-platform checks remain separately not run.

### Disposition of existing work

Existing command admission and delivery, identity and ownership policies, effect safety, crypto utilities, projection ordering, Git rules, redaction and recovery scenarios are candidates for reuse. They are not automatically accepted unchanged under a new engine.

The trusted Node image, Node-to-DO bridge, coding-agent continuation recipe and brain-container capacity ledger are replaced in the selected target. Remove them only after replacement behavior is demonstrated and the implementation transition is reviewed.

Topology-specific old plans should not continue as instructions for this candidate. Their original content and reviews remain in the Git snapshot linked above, not the active planning directory. A new plan track should derive detailed tickets from this spec after the affected decisions and feasibility gates are resolved.

### Publication and references

The issue tracker has not been configured or identified in this conversation. This specification is stored locally; no issue has been published and no label has been applied. Run `/setup-matt-pocock-skills` to configure the tracker. The requested triage label for eventual publication is `ready-for-agent`; technical gates and open decisions must remain explicit in the issue.

Relevant sources:

- [Pi Durable architecture research](../research/pi-durable-cloudflare-architecture.md), including pinned upstream storage, scheduler and tool evidence.
- [Historical Node-based specification](https://github.com/metaloozee/ditto/blob/52c9cef3ca2c471c69dfe4a0bdb3f507a8f45e13/docs/specs/trusted-session-runtime.md), for prior decisions and implementation evidence. The requirements to carry forward are stated in this document.
- [Ditto domain context](../../CONTEXT.md) and [product brief](../../PRODUCT.md).
- [Historical plan and evidence index](https://github.com/metaloozee/ditto/blob/52c9cef3ca2c471c69dfe4a0bdb3f507a8f45e13/plans/README.md), for historical implementation status rather than new-engine acceptance.
- [Cloudflare local container development](https://developers.cloudflare.com/containers/guides/local-dev/), including differences between local and hosted execution.
- [Cloudflare Sandbox SDK](https://developers.cloudflare.com/sandbox/sdk/), including the hosted plan requirement.

This is a specification and implementation sequence, not executable deployment instructions or runtime validation evidence.
