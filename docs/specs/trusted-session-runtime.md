# Trusted workspace-session runtime

Status: accepted target architecture; implementation and validation pending.

Decision date: 2026-09-06. The maintainer approved the primary testing boundary before this specification was written.

This is the canonical specification for Ditto's target agent architecture. It supersedes [Platform credential broker and workspace-session sandbox isolation](platform-credential-broker.md). That document remains historical implementation evidence, including its uncompleted validation gates.

The requirements below describe the target, not current behavior. Research explains the decisions but does not override this specification. Acceptance of the architecture does not authorize deployment, data deletion, staging, or commits.

## Problem statement

A user needs an agent run to remain inspectable and controllable after closing the browser. A lost connection, Worker restart, or container replacement must not silently duplicate commands or leave the conversation describing files that no longer exist.

Ditto currently runs Pi beside repository code in an untrusted sandbox. A Worker consumes the runner stream, persists output, settles messages, and coordinates recovery. Lease-expiry cleanup can fail interrupted work, but it cannot reconstruct the agent's execution.

Platform credentials already remain outside the sandbox. The remaining problems are request-dependent supervision, untrusted access to the agent process, and incomplete recovery of the conversation together with its workspace.

## Solution

Each workspace session has a trusted session runtime and a separate untrusted execution environment.

The product Worker authenticates requests, validates policy, stores durable commands, and returns receipts. It never drives an agent loop or waits for an agent run to finish.

A per-workspace-session Durable Object coordinates execution and stores its journal. Its managed Node.js container runs the full Pi coding-agent SDK. Repository tools execute remotely in the workspace session's existing Sandbox container.

Runs continue independently of browser connections. Interrupted execution resumes only when durable evidence establishes a safe continuation. An uncertain shell command is not automatically repeated. Filesystem recovery uses a checkpoint paired with the corresponding Pi state.

## User stories

1. As a user, I want an accepted prompt to have a durable receipt, so that a lost response does not lose my request.
2. As a user, I want retries to return the original receipt, so that a network failure does not create duplicate work.
3. As a user, I want to close the browser during a run, so that my browser connection does not control execution lifetime.
4. As a user, I want to reconnect to the current conversation and activity, so that I can inspect work performed while disconnected.
5. As a user, I want queued work and queue expiry to be visible, so that I know whether execution has started.
6. As a user, I want accepted follow-ups to survive process restarts, so that instructions do not disappear from an in-memory queue.
7. As a user, I want follow-ups applied in order, so that the agent does not act on later instructions before earlier ones.
8. As a user, I want Stop to take priority over ordinary queued work, so that cancellation does not wait for capacity or another tool.
9. As a user, I want stopping work to remain visibly stopping until its execution is accounted for, so that a success response does not hide a live command.
10. As a user, I want replacement work blocked while an old command can still write, so that two runs cannot corrupt the same workspace.
11. As a user, I want safe recovery after the Pi process dies, so that completed work does not need to run again.
12. As a user, I want uncertain tool outcomes identified, so that an email, push, or other external effect is not silently repeated.
13. As a user, I want recovery to show when local files were restored to an older checkpoint, so that conversation history does not misrepresent my workspace.
14. As a user, I want completed assistant messages preserved when backup fails, so that model success and recovery health remain distinct.
15. As a user, I want every settled run's assistant messages to become complete or failed, so that pending messages do not remain indefinitely after execution ends.
16. As a user, I want each workspace session isolated from other workspace sessions, so that repository commands cannot access another session's processes or files.
17. As a user, I want repository code unable to execute inside the trusted agent container, so that dependencies cannot replace the agent or read its private session state.
18. As a user, I want my project environment values available to authorized commands, so that builds and tests can use my configuration.
19. As a user, I want project environment values excluded from repository files and ordinary output, so that Ditto does not persist or display them accidentally.
20. As a user, I want the current fixed model and thinking levels preserved, so that the architecture change does not change my model selection behavior.
21. As a user, I want Git actions to retain ownership and secret checks, so that moving Pi cannot bypass export policy.
22. As a user, I want preview to remain available between agent turns, so that routine checkpointing does not interrupt every inspection.
23. As a user, I want a persistent warning while changes lack a recovery archive, so that I understand the potential loss if the sandbox stops.
24. As a user, I want archived work to keep a recoverable final state, so that continuing it creates a separate line of work without altering history.
25. As a user, I want project deletion to revoke runtime authority before cleanup, so that delayed requests cannot revive deleted work.
26. As a user, I want opening history to avoid starting containers, so that reading a conversation does not consume execution capacity.
27. As an operator, I want independent brain and execution capacity limits, so that a second container does not create unaccounted resource consumption.
28. As an operator, I want failed privileged requests denied without fallback, so that an outage cannot expose platform credentials.
29. As an operator, I want durable history encrypted and retained according to a defined policy, so that recovery does not create an unmanaged store of sensitive data.
30. As an operator, I want restart and fault-injection tests at the public command boundary, so that internal refactors preserve user-visible guarantees.
31. As an operator, I want retained work migrated without resetting product data, so that adopting the architecture does not erase projects or conversations.
32. As an operator, I want local results distinguished from Cloudflare integration results, so that an untested platform assumption cannot be called production-ready.

## Implementation decisions

The words must and must not define requirements. Initial numeric limits below are Ditto policy, not Cloudflare platform guarantees.

### 1. Runtime topology

The target uses two application Durable Object identities per workspace session:

- `SessionRuntime` extends the Cloudflare Container class. It coordinates the workspace session and manages one trusted Node.js container.
- `Sandbox` manages one untrusted execution container for that workspace session.

The coordinator runs in workerd. Pi runs in Node.js. They do not share an address space, filesystem, or automatic access to bindings. Platform-internal proxy objects and temporary project-seed builders are outside this two-object count.

The agent runtime is deployed in a Worker service separate from the TanStack Start product Worker. Private service bindings connect the services. Alchemy owns both deployments and their container images. Separating deployment schedules does not remove restart requirements.

The runtime Worker must own both application Container classes, `SessionRuntime` and `Sandbox`. The product Worker must not bind either class. The product Worker must not talk to a container except through the runtime service.

Service bindings are bidirectional. The product Worker must use them to deliver commands, proxy preview, start seed jobs, and ask whether the model key is configured. The runtime Worker must use them to send reconstructed Git smart-HTTP requests to the product Worker for mint-and-fetch. The product Worker must not receive the OpenCode key over that binding. The runtime Worker must not receive a GitHub App private key or installation token over that binding.

The full Pi coding-agent SDK remains the agent implementation. Porting the loop to Pi agent-core, Cloudflare Agents, or Workflows is not an implementation choice under this specification. A third coordinator object, pooled multi-session brain process, or shared workspace sandbox also requires a new architecture decision. A failed two-container feasibility or paid-plan gate must stop cutover and require a new architecture decision. It must not put Pi back in the execution sandbox or into workerd.

### 2. Responsibility boundaries

| Layer | Owns | Must not own |
|---|---|---|
| Product UI | Chat, session list, command receipts, event display, recovery controls | Runtime authority or execution lifetime |
| Product control plane | Auth, ownership, command admission, D1 product records, global capacity policy, GitHub App key, installation-token mint, GitHub upstream fetch for approved git contracts, preview origin | Pi process, model loop, OpenCode key, container classes, runtime-state encryption key |
| SessionRuntime | Command consumption, run state, execution admission, D1 privileged-operation windows for admitted execution, Pi continuation journal, event sequence, recovery supervision | Repository execution inside workerd, GitHub App key |
| Trusted Node container | Pi model loop, compaction, image-owned extensions, remote-tool adapters | Repository processes, package installation from the repository, local model-callable filesystem or shell access |
| Execution sandbox | Repository files, Git binaries, dependencies, build and test processes, preview | Pi, model credentials, agent-control authority, storage credentials |

`WorkspaceRuntime`, `SandboxAuthority`, `SandboxEgressBroker`, `WorkspaceRecovery`, and `ProjectSeed` retain their policy responsibilities behind the command boundary. They must not remain competing owners of the active run.

All workspace mutations, UI Git operations, preview lifecycle operations, checkpointing, archive, and destruction participate in coordinator serialization. Observational reads must not wake containers unless the requested operation explicitly requires live execution.

### 3. Durable state ownership

| Store | Authoritative data |
|---|---|
| D1 | Auth and ownership, project and workspace-session product records, accepted commands and delivery intents, capacity reservations, identity tombstones, privileged-operation records, archive registry and cleanup records |
| SessionRuntime SQLite | Consumed commands, run epochs and states, logical tool operations, Pi continuation records or encrypted references, committed paired checkpoints, event sequence, pending product projections |
| R2 | Immutable workspace archives and encrypted large runtime records referenced by committed metadata |
| Container disks | Live workspace files or reconstructible Pi working files, never the only copy of accepted commands or Pi continuation state |

Both Workers bind the same D1 database. The product Worker writes authentication, ownership, command admission, capacity reservations, and identity registration or retirement. The runtime Worker writes privileged-operation windows at execution admission and retryable projections of messages, command status, and archive pointers. D1 message content and run status are product projections of the coordinator's execution decisions after handoff. D1 must not independently advance an accepted run based on a dispatcher lease timeout.

The coordinator commits terminal execution state and a pending D1 update in one local transaction. A retryable projector updates the matching message and command records idempotently. Projection versions prevent older updates from overwriting newer state. The UI can distinguish projection lag from ongoing execution.

No transaction spans D1, DO SQLite, R2, and an external effect. Each crossing needs durable intent, an idempotent acknowledgment, and reconciliation.

### 4. Identity and versioning

Permanent identity records distinguish project-seed builders, execution sandboxes, and trusted session brains. A trusted brain has a distinct identity role and may access only its own workspace session.

Execution sandboxes and builders retain random opaque sandbox IDs. Retired IDs are never reused. Routing names and container identity are not user-supplied authorization.

The following identifiers remain separate:

- `lifecycleGeneration` changes when an authorized runtime identity is restored or replaced.
- `runEpoch` increases when the coordinator supersedes an execution attempt, including Stop and recovery takeover.
- `mutationGeneration` orders workspace mutations and their recovery checkpoints.
- Brain and executor incarnation IDs distinguish actual processes or container launches under stable routing identities.

Every privileged admission validates current ownership, identity role, retirement, applicable lifecycle generation, operation window, and run epoch. A copied epoch or previously valid operation must not authorize future admission indefinitely.

Close affected operation windows when a run settles, Stop applies, an identity becomes stale, a workspace session is archived, or deletion starts. Rotate lifecycle generation before restore or replacement. Revocation in one store must not depend on a later product projection to block new admission.

Tool identity includes the agent run, originating assistant entry, and tool-call ID. Recovery preserves that logical identity across execution attempts. A new attempt must not turn a completed logical tool into new work.

### 5. Command admission and delivery

The authenticated workspace-session command interface is the product's primary entry point. It accepts prompts, follow-ups, Stop, queue cancellation, and explicit recovery decisions. Existing Git and lifecycle entry points route their work through the same coordinator ownership.

For a prompt or follow-up, admission atomically stores the command, complete user message, pending assistant message, and delivery intent in D1. A first prompt also creates the workspace session if needed. The command references message records rather than embedding an unbounded transcript in a queue payload.

An idempotency key is scoped to the authenticated owner and target. Its first accepted payload determines the command and message IDs. The same key with a different payload returns a conflict. A retry of first-session creation returns the original workspace session instead of creating another one.

Receipts distinguish admitted, queued, coordinator-accepted, and terminal work. A response never claims execution started merely because a D1 transaction committed. Invalid ownership, archived state, invalid thinking level, and missing configured model credentials fail before prompt-side effects. The product Worker must not bind `OPENCODE_API_KEY`. Admission must ask the runtime service whether the model key is configured and must not receive the key.

D1 assigns monotonic command sequence numbers within a workspace session. The coordinator deduplicates deliveries and consumes ordinary commands in sequence. It fetches or requests retry of a missing predecessor rather than silently skipping it. Cancellation is a durable record that allows the sequence to advance.

The existing durable runtime-work mechanism becomes delivery infrastructure. Immediate delivery is an optimization. A bounded scheduled dispatcher retries undelivered commands using the same IDs. A lost acknowledgment must not start another run.

The coordinator stores acceptance and durable wakeup intent before acknowledging. It must open the matching D1 privileged-operation windows only when it admits execution, not when the product Worker accepts the HTTP command, and not because a container requested a window. Queued work must not hold a model, git-transport, or ditto-action window. Reconciliation repairs any gap between stored intent and scheduled execution. Neither an SSE handler nor `waitUntil` owns the run.

Command deduplication records remain for the workspace session's retained lifetime. Deletion tombstones prevent late delivery from recreating a deleted target.

### 6. Follow-up and Stop semantics

Accepted follow-ups are durable before Pi sees them. Each follow-up retains its own user and assistant message IDs. Pi consumes follow-ups one at a time at supported turn boundaries. Restart must not drop a queued instruction or apply an already-consumed instruction twice.

This intentionally replaces the current behavior where some queued follow-ups exist only in runner memory and receive message rows when execution starts. Canceled accepted follow-ups remain visible with a failed assistant and cancellation reason.

Stop targets an exact agent run. It is delivered through a priority control path that bypasses capacity queues and missing ordinary-command deliveries. The coordinator records a stop barrier that cancels outstanding commands associated with that run, including earlier commands delivered late. Stop does not cancel a distinct later run.

On Stop application, the coordinator advances the run epoch, denies new model and tool admissions, clears unapplied follow-ups for that run, and requests cooperative cancellation. Already-admitted requests and shell processes can still finish. Their outcomes must be reconciled.

A Stop receipt distinguishes recorded intent from applied cancellation. If the coordinator is unavailable, the UI must not report that execution has stopped.

A replacement mutating run cannot start until old execution is confirmed stopped or isolated. An uncooperative command leaves the workspace session blocked for review. Retirement and restore that discard uncheckpointed work require an explicit user acknowledgment of that loss. Deletion remains an explicit destructive request with its own policy.

### 7. Run and message lifecycle

An agent run uses queued, starting, running, recovering, stopping, complete, failed, and canceled states. Recovering and stopping are observable nonterminal states, not synonyms for success.

An unknown effect halts automatic execution. The run settles failed with an uncertainty reason and the workspace session remains blocked for review. Every accepted but uncompleted assistant associated with that settled run becomes failed. Previously completed assistants are not rewritten as failed.

Transient coordination failures use bounded backoff. Automatic recovery has a persisted 15-minute deadline from the first interruption. Retries do not reset that deadline. On expiry, revoke new admission, request cancellation, settle the run failed, and preserve state for explicit Retry or inspection. This deadline does not imply that an uncooperative remote process has stopped.

The ten-minute timeout currently applied to the whole runner must not become the lifetime limit of the new agent run. Individual tools and model requests have finite, persisted deadlines. No-effect model retries and all provider spending remain subject to operation authority even when the browser is absent.

Leases for dispatch, brain execution, workspace mutation, and capacity have separate meanings. Lease expiry alone does not prove process death and must not free capacity still occupied by observed live execution.

### 8. Trusted Pi and remote tools

The trusted image contains pinned Pi and Ditto-owned extensions and adapters. It does not clone or mount the repository, install repository dependencies, discover repository settings, or load repository extensions, skills, prompts, themes, or context files.

All model-callable read, write, edit, bash, grep, find, and list operations execute remotely. User shell shortcuts and custom tools, if supported by the integration, obey the same rule. A failed remote call never falls back to trusted-host execution.

The adapter must audit implicit local access through path resolution, image decoding, attachment handling, resource loading, and custom tools. Repository-supplied executable code never runs in the trusted container. Untrusted text remains model input, not authorization.

Pi uses an explicit image-owned resource loader. Git metadata generation moves into the trusted runtime and retains an empty discovery configuration, bounded redacted input, one typed output tool, and its one-request model allowance.

The trusted Node process accesses coordination through bounded HTTP to a synthetic internal destination. A Worker-owned outbound handler identifies the source container and routes to the coordinator through bindings. The Node process does not receive a DO stub, D1 binding, or R2 credential.

A synthetic hostname or request-supplied workspace ID is not identity. The handler validates the platform-provided identity mapping and rejects unknown roles, stale incarnations, oversized bodies, invalid encodings, unexpected methods, and unsupported protocol versions.

Coordinator methods must not hold a global concurrency block while waiting for Pi to call back. Startup acknowledges process readiness separately from prompt completion. Storage transitions are short and external I/O is explicitly represented as in-flight work.

### 9. Execution and effect journal

Before a tool dispatch, the coordinator durably stores its logical ID, originating response, validated arguments, expected executor incarnation, run epoch, deadline, and outcome policy.

The journal distinguishes prepared, admitted, result-recorded, and outcome-unknown operations. The distinction between prepared and admitted identifies work definitely not dispatched versus work that might have executed. A crash around dispatch still may leave an unknown outcome.

The actual bounded result or a durable encrypted reference is committed before Pi may consume the result and request a subsequent effect. Persisting only a digest is insufficient. Duplicate acknowledgments are idempotent and conflicting acknowledgments are rejected for investigation.

Model responses containing tool calls must be durable before those calls execute. Requests for normal turns, retries, compaction, and metadata all pass through journaled model admission. A retried model call can incur another provider charge and can produce a different answer. The system does not promise exactly-once inference billing.

A failed persistence barrier prevents further model or tool admission. The Pi adapter must not treat that failure as an ordinary tool error and continue without durable state.

The first implementation serializes tools within a workspace session. An arbitrary shell command is treated as potentially mutating. UI Git mutations and recovery operations cannot overlap agent mutations. Managed preview writes remain a documented exception outside recovery guarantees until preview is quiesced.

### 10. Pi continuation state

The coordinator persists enough versioned state to reconstruct the supported Pi behavior:

- Accepted and consumed commands, including pending follow-ups.
- Pi session entries, selected branch position, compaction summaries and boundaries, model and thinking settings, and required image-owned extension state.
- Completed provider responses and tool-call arguments with their original IDs.
- Recorded tool results, pending operations, attempts, and unresolved effects.
- The current execution position and its paired workspace recovery checkpoint.

Provider-specific continuation metadata must survive without lossy conversion to product chat text. Unsupported state or version combinations fail closed with a reason-coded recovery error.

Pi's ordinary subscription listener is an observation mechanism, not a durability barrier. Awaited hooks, provider wrappers, and remote-tool wrappers enforce ordering. Recovery tests must establish that final answers, tool results, compaction, and follow-up consumption all cross a durable boundary.

A local Pi session file is a reconstructible working copy. Imported repository archives must never overwrite trusted extensions, configuration, or executable paths.

### 11. Recovery decisions

If Pi dies while the execution sandbox remains live, the coordinator observes the current executor incarnation, reconciles admitted tools, and reconstructs Pi. It does not repeat completed tools or assume an unacknowledged tool never ran.

Read-only operations may be repeated under explicit policy with a new observation recorded. Structured writes may use expected-content checks. Arbitrary shell commands and external effects are not automatically replayed or compensated when their outcome is unknown.

Sandbox-local receipts are diagnostic evidence. They do not establish platform authority or prove exactly-once external effects because the execution environment is untrusted.

When the outcome cannot be established, automatic execution stops. The UI exposes the affected operation, known evidence, and a recovery reason without leaking secrets. A user can abandon the failed run, inspect the workspace, or submit an explicit new action acknowledging uncertainty. A generic Retry button must not silently repeat an unknown shell command.

If the execution sandbox is lost, restore a committed paired checkpoint as defined below. Later conversation history remains visible as interrupted history. It is not automatically replayed and does not become a false assertion that the restored files contain later edits. External effects after the restored checkpoint remain recorded and unresolved where necessary.

### 12. Paired checkpoints and publication

A usable recovery checkpoint pairs an immutable workspace archive with an immutable Pi continuation snapshot and execution position. It also records compatibility metadata, mutation generation, source identity and incarnation, and outstanding-effect state.

D1 remains the archive registry. The coordinator is authoritative for whether an archive and continuation pair is committed and usable. D1 current and previous recovery pointers are retryable projections of that committed pair after cutover. Restore never trusts a D1 pointer without verifying the matching committed coordinator record.

Checkpoint publication has the following order:

1. Acquire exclusive workspace mutation ownership and pause Pi at an acknowledged safe boundary.
2. Resolve in-flight tools and quiesce managed writers, including preview when required.
3. Capture the workspace archive and corresponding Pi continuation position without an intervening mutation.
4. Stream archive bytes through Worker bindings to R2, verify count and digest, and register prepared metadata in D1.
5. Persist the encrypted continuation snapshot and its metadata.
6. Commit the immutable paired-checkpoint manifest and pending D1 projection together in coordinator storage, guarded by the expected generation and execution position.
7. Project the new current and previous pointers to D1, then retire unreferenced older objects through retryable cleanup.

A prepared archive is not a committed checkpoint. Publication does not depend on an atomic transaction across R2, D1, and the DO. Recovery completes or cleans up interrupted preparation without selecting an uncommitted pair.

Keep the current and previous successful pairs. A previous fallback restores both previous filesystem and previous continuation state. Both failures preserve evidence and block execution. A mutated workspace never silently falls back to its project seed.

Establish an initial paired baseline after seed restore and branch synchronization, before the first agent mutation. Normal checkpoints occur at quiescent run or mutating Git boundaries. Per-tool archival and periodic full-VM snapshots are not required.

Quiescence coordinates normal processes. It does not make a malicious sandbox or its archive trustworthy. Integrity identifies captured bytes and generation, not the truth of arbitrary tool output.

### 13. Preserved archive, seed, and dependency policy

Projects own immutable seeds and no live workspace runtime. Temporary builders have distinct identities, can fetch only the owned repository, receive neither model authority nor project environment values, and are permanently retired after completion.

Builders are `Sandbox` identities on the runtime Worker. They must not have a `SessionRuntime`, trusted brain, model window, or project environment values. Product seed orchestration must call the runtime service. The coordinator-equivalent for a builder is a short-lived runtime RPC that opens `git_transport` for that builder identity, runs the fetch, and retires the identity. Seed creation must not run through the session coordinator.

A new workspace session restores a compatible seed, synchronizes the owned default branch, and freezes its base commit. An existing workspace session never moves that base automatically. Mutable workspace recovery is never used to rebuild a project seed.

Seed compatibility includes format, repository and source commit, dependency inputs, package manager, Node version, architecture, image revision, relevant Ditto protocol revision, and dependency policy version.

Archive bytes travel between fixed sandbox paths and Worker R2 bindings over bounded streams. Execution sandboxes and builders receive no R2 key, object key, signed URL, bucket mount, nonce, or internal bearer capability. Stock backup transports that expose storage capabilities remain prohibited.

Initial deployment-configurable archive ceilings remain 1 GiB compressed and 3 GiB extracted. Peak disk use must stay within 70 percent of available capacity, including image, workspace, archive, and temporary files. An oversized operation fails before disk exhaustion. Container type must be measured for the two-image topology rather than inherited from the previous no-sizing-spike instruction.

Archives include ordinary workspace files, including user-created environment files. Ditto-supplied project environment values remain separate and are never materialized in those files. Documented disposable dependencies, package-manager caches, build output, sockets, devices, and temporary archives are excluded according to policy.

Restore verifies byte count, digest, format, compatibility, extracted size, and required Git state. Extraction must reject unsafe archive paths and writes outside the execution workspace. Validate the image-owned execution adapter separately from archive content. Archive files cannot replace the trusted brain or its image-owned code.

Dependency-inclusive recovery is permitted only with a matching fingerprint, valid size and disk checks, and ten local cold restores per benchmark path. Representative small, medium, and large repositories must show at least a 30 percent ready-to-run p95 improvement over source-only restore followed by install. Any extraction, permissions, native-module, or capacity failure selects source-only recovery.

### 14. Credential and network contracts

The product Worker remains the only issuer of GitHub installation tokens and the only process that binds `GITHUB_APP_PRIVATE_KEY`. The runtime Worker must bind `OPENCODE_API_KEY`, the runtime-state encryption key, D1, and R2. It must not bind the GitHub App private key, GitHub OAuth secrets, or authentication secrets. Neither container receives those values.

OpenCode attach happens on the SessionRuntime intercept in the runtime Worker. The handler must validate the contract, construct a fresh upstream request, and add `OPENCODE_API_KEY` there.

GitHub mint-and-fetch happens on the product Worker. The runtime Worker must validate the git contract, then send the reconstructed request to the product Worker. The product Worker must re-check current D1 authority without a cache, mint a repository-scoped installation token, attach it to a fresh GitHub request, fetch upstream, and stream the response back. The installation token must not enter the runtime Worker or either container.

Trusted brains may request model and Ditto-action contracts for their owned workspace session and current admitted work. Execution sandboxes lose normal-chat and Git-metadata model authority and cannot call brain-control endpoints. Builders retain only their seed-fetch authority. Execution-side Git transport remains available only during a coordinator-approved git operation whose upstream fetch is performed by the product Worker.

An identity has at most one open operation per contract family. Every request validates current D1 authority without a cache that can extend expiry or revocation. The coordinator also admits the corresponding current-epoch effect. Already-admitted work remains in-flight until reconciled even if authority is subsequently revoked.

OpenCode requests use the fixed model `opencode/deepseek-v4-flash-free` and supported thinking levels `off`, `high`, and `max`. Validation covers method, host, port, path, query, content type and encoding, streaming protocol, bounded complete body schema, authorization placeholder, operation type, expiry, and contract version.

Reject duplicate or malformed authority-bearing fields, unexpected authorization and proxy headers, unsupported schemas, and redirects. Construct a fresh upstream request from validated fields before adding credentials. Never forward the original request with a credential attached as a shortcut.

Git metadata retains one atomically reserved model request. A failed upstream attempt does not restore its allowance. Normal chat retains operation-window authorization without a new per-token spending product. Three contract denials close the operation, halt the affected run, and mark the workspace session for review without deleting its work.

Credential-free public HTTP and HTTPS remain available to execution for package installation and application use. The policy rejects internal and synthetic origins, private and metadata destinations, loopback and link-local addresses, literal and alternate numeric IP forms, embedded URL credentials, ambiguous hosts, and redirects that fail destination validation. Privileged placeholders and protocol headers outside their exact contracts are rejected.

A privileged denial never falls through to public internet access. Non-HTTP traffic stays disabled. DNS filtering and total exfiltration prevention are not promised. User-owned project values can still leave through allowed public traffic.

The trusted brain has a deny-by-default outbound policy limited to the internal transport and approved brokered operations. It has no general-purpose model-controlled network escape from the remote-tool boundary.

### 15. Git and project environment values

Git inspection and local mutations retain owned-repository and workspace-branch policy. Network Git uses fixed public repository URLs, closed credential-free child environments, disabled hooks and credential helpers, fixed CA trust, and no redirects. The broker scopes installation credentials to approved upstream transport.

Push remains disabled until a crafted non-fast-forward receive-pack test proves rejection. Permitted push must reject force updates, deletions, extra refs, malformed capabilities, and targets other than the workspace-session branch. Pull-request creation stays Worker-owned. Agents cannot merge or close pull requests.

Git secret preflight continues to reject outgoing secret-like paths and content, malformed ranges, and unreadable or unsafe additions. Moving Pi does not weaken export policy or enable a previously gated feature.

Project environment values enter only authorized repository execution commands that need them. They do not enter trusted brain launch configuration, builders, preview, control, Git transport children, backup, restore, or container entrypoints. Indirect exposure through tool output remains possible and is covered by redaction and internal-state protection.

### 16. Runtime history privacy and retention

Canonical runtime content is encrypted at rest before storage in coordinator SQLite or R2. Use versioned authenticated encryption with AES-256-GCM, unique nonces, and associated data binding records to their owner, workspace session, record identity, and format version.

A dedicated runtime-state encryption key belongs to Worker bindings and is separate from authentication secrets. Records identify their key version. Rotation must retain decryption capability for referenced records until re-encryption or authorized deletion. Missing or invalid keys block restoration rather than discard state or write plaintext.

Only the owning coordinator and trusted brain transport can obtain decrypted continuation content. Public history APIs expose redacted product projections, not raw provider messages, encryption metadata, or R2 references. Decryption happens in trusted Worker code, with plaintext delivered only to the matching authorized brain process when required.

Retain canonical conversation and continuation records for the workspace session's lifetime, including archive. Active runs and current or previous checkpoint references pin every object needed for recovery. Detailed denial logs retain the previous 30-day policy. Unreferenced transient output is eligible for deletion after 24 hours. Garbage collection must not remove content required by a retained session entry or checkpoint.

Deletion removes runtime content from DO storage and R2 through retryable cleanup while preserving minimal non-secret identity tombstones. Cleanup records remain until success or visible operator intervention. Encryption does not replace access control, redaction, or cleanup.

### 17. Event delivery and product settlement

The coordinator assigns monotonic sequence numbers to durable semantic events. Reconnection returns a committed snapshot and subsequent events without a gap between snapshot capture and subscription. Duplicate events are safe to apply. A cursor older than retained replay data receives a replacement snapshot.

Token deltas may be transient. Each transient stream is associated with its run, attempt, and current committed position. A replacement snapshot discards stale partial content. Final assistant content and tool results become durable before the product reports completion.

Bounded streaming redaction covers split secrets, structured tool payloads, stderr, errors, and stored product messages. Node-to-coordinator and coordinator-to-browser buffering have finite limits. Slow subscribers are detached and can reconnect. They must not block model or tool progress.

The command response and event connection are independent. Opening history or attaching to events must not fall through to a default container proxy that starts a process. The coordinator can serve persisted state while both containers are stopped.

Terminal D1 projection retries continue independently of run execution and browser presence. A failed archive does not change a completed assistant to failed. A stopped, canceled, rejected-after-admission, or unrecoverable run settles its remaining pending assistants failed with a reason.

### 18. Capacity and lifecycle supervision

Initial deployment-configurable capacity limits are:

| Pool | Global limit | Per-user limit |
|---|---|---|
| Workspace execution containers | 20 | 2 |
| Trusted brain containers | 20 | 2 |

Temporary builders also require bounded admission. They share the execution pool rather than create an unaccounted third pool. Preview-only work consumes execution capacity but not brain capacity. These limits can permit up to 40 awake containers across the two pools and are not an assertion about affordability or platform entitlement.

Admission reserves the missing capacity required by an operation atomically in D1. A command must not hold an unused brain reservation indefinitely while waiting for execution capacity. Existing live reservations are reused, not double-counted.

The capacity queue remains durable first-in-first-out for ordinary work, with a persisted 15-minute wait limit and user cancellation. Stop, authority revocation, and cleanup do not wait behind capacity acquisition. Queue expiry preserves the user message and workspace session and settles its pending assistant failed. This capacity deadline is not a time limit on follow-ups already admitted to a live run.

Queue expiry and first execution admission must resolve through the same coordinator decision. A dispatcher with a lost handoff acknowledgment must query or redeliver the command, not independently mark its assistant failed. The coordinator rejects expired queued work but returns the existing outcome for a command that already started. If ownership cannot yet be resolved, show expiry awaiting confirmation rather than report a false terminal state.

Both containers have a ten-minute idle timeout, independently controlled. A live run must renew its brain activity and any required execution activity. A preview with uncheckpointed changes retains execution capacity until its bounded deferral checkpoint settles.

Container lifecycle scheduling uses the Container class's supported scheduler. The application must not replace its alarm handler. A durable wakeup and bounded reconciliation pass handle missed startup, interrupted execution, stale leases, pending publication, and D1 projections.

The constructor initializes state and observes incarnation. DO activation alone does not start a new Pi process. A DO restart may leave its Node container running, so takeover must verify the existing process and fence old attempts before replacement.

### 19. Preview, archive, and deletion

Preserve one fixed preview command, port 10000, and one exposure capability per active workspace session. Preview URLs remain bearer capabilities returned only through authenticated access and revoked on stop, archive, or deletion as applicable. They are not ordinary log or history fields.

The preview host must hit the product Worker. After revocation checks, the product Worker must service-bind to the runtime Worker, which proxies to that session's execution sandbox. The runtime Worker must not be a public preview origin.

Preview can defer initiation of a normal recovery checkpoint for at most ten minutes from the first unbacked mutation. Later mutations coalesce without resetting the deadline. Show persistent backup-pending state. At the deadline, stop preview and new mutating-tool admission, then reconcile current execution.

If the in-flight tool is a read or a structured write with an expected-content check still running, wait for that tool to return or hit its own deadline, then capture the paired checkpoint. If the in-flight tool is an arbitrary shell command or otherwise unknown, abort it, record the outcome as unknown, settle the run failed, skip the checkpoint, and block the workspace session for review. The deadline must not snapshot a filesystem that merely looks idle. Do not capture a falsely consistent checkpoint or continue extending the timer. Once a valid archive has been captured, publication retries do not require repeating tool effects.

After checkpoint, restart preview only when recent traffic or an explicit user request warrants it. Preview Stop leaves the process stopped if backup fails and exposes separate retry-backup and restart-preview actions. Preview-created files, caches, and application-side database writes remain disposable.

A cold preview wake restores a committed workspace pair before restarting the fixed command. It does not start Pi. The preview restore response remains visible until the application is ready.

Archiving requires stopped or isolated agent execution, a final committed paired checkpoint, and revoked preview authority. It preserves final recovery until deletion. Continuing archived work creates a new workspace session, branch, identities, and paired-checkpoint lineage. It does not resume pending operations from the archived run.

Project deletion first persists a deleting state that blocks admission and retires all related identity authority, including the trusted brain. It then closes operations, cancels work, revokes previews, terminates runtimes, and schedules content cleanup. Late commands, callbacks, and projections cannot recreate deleted product rows. Identity tombstones outlive cleanup.

### 20. Observability and failure posture

Record trusted correlation IDs, operation and protocol versions, latency, status category, byte counts, lifecycle generation, run epoch, and reason codes. IDs received from a container are correlation data only until validated against authority.

Do not log request or response bodies, credentials, placeholders, arbitrary headers or queries, raw provider state, repository pack data, archive bytes, or decrypted continuation records. User-visible errors contain a generic category and trusted correlation ID. Detailed validation failures stay in access-controlled records.

Fail closed on identity, generation, epoch, operation, contract, archive-integrity, or continuation-version failures. Do not substitute another model, pass credentials into a container, restore a seed over mutated work, or continue with incomplete journal state.

A broker outage blocks the affected operation. A model outage does not prevent model-free history, archive inspection, or recovery policy. Infrastructure failure may require intervention. The specification does not promise uninterrupted process lifetime or exactly-once arbitrary effects.

### 21. Non-destructive cutover

The previous pre-launch reset is historical and must not be repeated under this specification. Existing projects, messages, identities, and archives must not be dropped to simplify migration.

Migration adds versioned brain identity, delivery, journal, checkpoint-pairing, and projection records before transferring ownership. Deployment compatibility must keep old readers from misinterpreting new records.

Cutover fences new admission to the old runner, drains or explicitly stops active runs, and inventories retained workspace state. Imported sandbox Pi history is untrusted data. It must be validated, stripped of executable configuration, and paired with a verified archive at an idle boundary before use.

Legacy histories with incomplete tool outcomes or no defensible filesystem pairing remain readable but not automatically resumable. Preserve their archives and expose a reason-coded recovery action. Do not fabricate a completed tool result to make an import succeed.

Only one execution owner may be enabled for a workspace session. After migration, remove old sandbox model privileges, runner control sockets as product authority, request-owned execution, and obsolete running-work expiry behavior. Migration compatibility must not become a permanent alternative execution path.

Do not combine this change with a Sandbox SDK protocol migration unless separately approved. Runtime and journal versions must be pinned together. An incompatible Pi upgrade requires a validated migration or an explicit recovery block, not silent conversion.

No live cutover is authorized here. Before a separately approved production cutover, create operator-controlled disaster-recovery backups and verify restore. Rollback must preserve the new ownership fences and must not restore credential injection or duplicate execution.

## Testing decisions

### Approved primary boundary

Test through the authenticated workspace-session command and observation interface. Submit commands, retry them, detach clients, reconnect, and inspect receipts, events, messages, recovery state, and resulting files.

Prefer existing service and runtime test infrastructure. The coordinator is an implementation behind this boundary, not a collection of public testing-only methods. Inject faults at persistence, transport, and process boundaries while assertions remain about externally observable behavior.

Retain focused regression suites for SandboxAuthority, SandboxEgressBroker, WorkspaceRuntime capacity, WorkspaceRecovery, Git contracts, redaction, and Pi resource loading. Existing tests already exercise ownership rejection, durable message acceptance, queue leasing, recovery fallback, and secret-free environments. Extend those behaviors rather than test class names or file existence.

### Required behavior matrix

| ID | Fault or action | Required observation |
|---|---|---|
| T01 | Foreign, archived, or deleting target | Rejection before command, model, or sandbox effects |
| T02 | Missing model configuration or invalid thinking level | No prompt-side effects and no credential fallback |
| T03 | Repeat identical command key, including first-session creation | Same receipt, session, and message IDs; one logical command |
| T04 | Reuse key with different payload | Conflict without a second command |
| T05 | Crash after D1 commit but before delivery | Dispatcher eventually delivers the retained command |
| T06 | Lose coordinator acceptance acknowledgment | Redelivery does not start another run |
| T07 | Deliver commands out of order | Ordinary instructions wait for predecessors or durable cancellation |
| T08 | Stop while predecessors are missing or capacity is exhausted | Stop applies through priority control; late targeted work cannot start |
| T09 | Disconnect browser and restart product Worker | Run continues or recovers without browser-owned execution |
| T10 | Restart coordinator while Pi survives | Existing incarnation is reconciled; no duplicate Pi execution |
| T11 | Kill Pi after committed response or tool result | Supported continuation restores without repeating completed effects |
| T12 | Kill Pi around compaction or follow-up consumption | Correct branch, summary, and queue position survive |
| T13 | Lose acknowledgment after arbitrary shell mutation | Outcome becomes unknown; no automatic replay |
| T14 | Fail journal persistence inside an awaited adapter boundary | Further model and tool admission stops |
| T15 | Old shell ignores cancellation | Replacement mutation is blocked; UI does not claim execution is stopped |
| T16 | Old process sends late result or model request | Stale admission fails; in-flight outcome is reconciled without overwriting newer state |
| T17 | Crash at each checkpoint publication stage | Uncommitted pairs are never restored; cleanup or projection can retry |
| T18 | Lose sandbox after journaled edit but before archive | Restore uses matching older continuation; later history remains explicitly interrupted |
| T19 | Corrupt current checkpoint, then previous | Matching fallback works or recovery blocks; never silent seed fallback |
| T20 | Backup fails after successful assistant | Assistant stays complete; recovery is degraded and archive is blocked |
| T21 | Preview defers multiple mutations while a command remains active | First deadline does not reset; new mutation admission stops; unsafe quiescence blocks checkpoint rather than inventing consistency |
| T22 | Concurrent capacity demand for both pools | Limits hold, no duplicate reservation, no unused partial-reservation deadlock |
| T23 | Queue expiry, lost handoff acknowledgment, or canceled follow-up | User instruction remains visible; coordinator resolves expiry against execution admission; no healthy run is failed by a dispatcher |
| T24 | Slow client, old replay cursor, duplicate event, split secret | Execution does not block; snapshot repairs display; secrets remain redacted |
| T25 | D1 unavailable during terminal projection | Final coordinator state persists and later projection settles the correct assistant |
| T26 | Read history with stopped containers | Neither container starts |
| T27 | Execution sandbox calls brain-only endpoints | Denial before model access, control mutation, or key injection |
| T28 | Malformed privileged request or wrong identity role | Fail closed without public-network fallback |
| T29 | Repository shadows extensions, paths, or tool implementation | No trusted-host repository execution or local-tool fallback |
| T30 | Inspect container environments and outbound requests | Project values appear only where authorized; platform credentials stay outside both containers |
| T31 | Tampered ciphertext, wrong owner, missing key, rotated key | Authentication fails closed or authorized old state decrypts correctly |
| T32 | Garbage collection during active recovery | Referenced history and paired checkpoints remain available |
| T33 | Delete during command, archive publication, or projection | Authority revokes first; late work cannot revive records; cleanup remains retryable |
| T34 | Migrate retained sessions with incompatible or uncertain history | Data remains readable; unsafe resumption is blocked without reset |
| T35 | Model attempt retried after interruption | Attempt is recorded; duplicate billing is not hidden behind an exactly-once claim |
| T36 | Reach automatic recovery deadline | Run settles failed while unresolved processes and capacity remain tracked |

### Platform and release gates

Local unit and integration tests are necessary but cannot prove Cloudflare process isolation, outbound interception, or restart behavior. Production readiness requires paid-plan integration evidence for:

- Trusted Node HTTP bridging to coordinator bindings and denial of the same contracts to execution sandboxes.
- HTTPS interception, provider streaming, cancellation, and absence of platform keys inside both containers.
- DO restart with a surviving container, container replacement, idle behavior, and durable scheduled reconciliation.
- Bounded large archive transfer, paired publication, current/previous restore, capacity accounting, and preview routing.
- Crafted non-fast-forward and forbidden-ref Git rejection before push is enabled.
- Separate-image cold-start latency, tool round-trip latency, memory use, idle cost, and representative concurrency under the configured limits.

Report each gate as passed, failed, or not run with environment and versions. Existing historical local results do not establish these new properties. The prior uncompleted end-to-end and production gates remain uncompleted until executed.

Before implementation is called complete, run the repository verification gate and the real two-container acceptance matrix. Documentation-only acceptance of this specification is not a test result. Failed feasibility tests reopen the affected implementation decision rather than permit a weaker silent fallback. They must not restore Pi to the execution sandbox, move the loop into workerd, or otherwise take a path listed under Out of scope.

## Out of scope

- Moving the loop to workerd, Pi agent-core, Cloudflare Agents, or Workflows.
- A third application coordinator DO, pooled multi-tenant Pi process, or shared execution filesystem.
- Full-VM memory snapshots, live process migration, or exactly-once arbitrary shell effects.
- Automatic compensation or blind replay of commands with unknown outcomes.
- Provider selection, bring-your-own-provider credentials, or a new per-token billing product.
- Browser terminal or code-browser features, new visual layouts, and unrelated chat redesign.
- Treating project environment values as secret from repository execution or preventing all prompt injection and exfiltration.
- Preserving preview-generated application data.
- Enabling Git push or pull-request creation before their existing gates pass.
- A destructive product-data reset, production deployment, or simultaneous Sandbox SDK protocol migration.

## Further notes

### Reconciliation with the previous specification

The following table records the audit disposition. The old document is historical, not an additional source of target requirements.

| Previous policy | Disposition in this specification |
|---|---|
| Pi remains inside the sandbox; trusted second container excluded | Replaced by full Pi in a trusted Node container and remote execution |
| D1 runtime work plus Worker-supervised execution | Split into durable admission and delivery, coordinator execution, and retryable product projections |
| Execution sandbox model and agent-action authority | Removed; trusted brain receives the scoped contracts |
| Sandbox identities and privileged-operation windows | Preserved and extended with a separate trusted-brain role and run admission |
| Fixed model, thinking levels, and disabled repository discovery | Preserved |
| Credential-free internet, exact Git contracts, and export gate | Preserved |
| Token-free archives, size ceilings, dependency benchmark policy | Preserved with paired continuation checkpoints |
| Current/previous recovery and preview deferral | Preserved, with paired fallback and safe-boundary publication |
| Fixed basic instance and no sizing spike | Replaced by measured two-image sizing under retained archive ceilings |
| One capacity pool | Extended to separate bounded execution and trusted-brain pools |
| Cooperative Stop | Extended with durable priority cancellation and prevention of concurrent replacement writers |
| Pre-launch reset and credential-removal cutover | Historical only; replaced by non-destructive ownership migration |
| Local validation results | Retained as historical evidence, not evidence for the new runtime |
| Unrun integration and production gates | Carried forward and extended |

### Evidence

- [Reviewed runtime research](../research/trusted-session-runtime.md) contains the rationale and corrections to the earlier sketch.
- [Historical broker specification](platform-credential-broker.md) records the implemented credential and isolation cutover.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) distinguishes connected request lifetime from detached background execution.
- [Container interface](https://developers.cloudflare.com/containers/reference/container-class/) describes the DO coordinator, separate container process, persistent storage, and lifecycle scheduling.
- [Container outbound traffic](https://developers.cloudflare.com/containers/guides/outbound-traffic/) describes the trusted HTTP bridge and credential injection outside containers.
- [Devin Outposts](https://docs.devin.ai/cloud/outposts/overview) establishes the reference separation between planning and remote execution, not Ditto's recovery guarantees.

The specification is stored in the repository. No issue-tracker publication or runtime change is part of this documentation change. `docs/architecture/` and `CONTEXT.md` describe this target and carry a pending-implementation status until cutover. `PRODUCT.md` current-product remains what ships today. Research remains historical.
