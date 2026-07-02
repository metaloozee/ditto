# Four-Layer Flue Workflow Rewrite PRD

**Owner:** Ayan  
**Status:** Draft source of truth  
**Date:** 2026-07-02  
**Intended readers:** Product, engineering, infra, and future implementation agents  
**Supersedes for future planning:** earlier runner / broker / Flue harness PRDs and plans where they conflict with this document.

This PRD intentionally treats the existing runner, sandbox, and persistence implementation as non-binding. The durable product model remains: **one project has one sandbox; a project can have many sessions and runs over time; sandbox hibernation must not lose state; only one mutating agent may hold the edit lease at a time.**

## Research Basis

This PRD is based on the product direction in the prompt plus the following platform findings:

- Flue defines an agent as an LLM running inside a programmable harness with tools, skills, filesystem, context, subagents, and sandbox access.
- Flue agents are continuing stateful contexts. Direct prompts and `dispatch(...)` inputs are operations inside an agent instance, not workflow runs.
- On Cloudflare, generated Flue agents use Durable Objects and SQLite automatically for canonical conversation streams, attachment payloads, accepted submissions, and recovery state.
- Flue sessions are named conversation state inside a harness. A session runs one active prompt, skill, task, shell, or compaction operation at a time.
- Flue database persistence stores runtime conversation state, not application metadata or sandbox files.
- Flue's Cloudflare target can wrap Cloudflare Sandbox through `cloudflareSandbox(getSandbox(...))` so agent file and shell operations run in a container-backed Linux sandbox.
- Cloudflare Durable Objects are a strong fit for per-project coordination because they provide per-entity single-threaded coordination plus strongly consistent, transactional storage.
- Cloudflare Sandbox provides isolated container execution, filesystem APIs, command execution, background processes, preview URLs, and bucket mounting.
- Cloudflare Sandbox bucket mounts can use Worker R2 bindings, narrow prefixes, read-only mounts, local bucket mode for development, and credential-proxy mode when endpoint credentials are unavoidable.
- Alchemy can declare Cloudflare Workers / TanStack Start, D1, R2, Durable Object namespaces, bindings, and migrations as TypeScript infrastructure.

Primary references reviewed:

- `https://flueframework.com/`
- `https://flueframework.com/start.md`
- `https://flueframework.com/docs/getting-started/quickstart/`
- `https://flueframework.com/docs/concepts/agents/`
- `https://flueframework.com/docs/guide/building-agents/`
- `https://flueframework.com/docs/guide/durable-execution/`
- `https://flueframework.com/docs/guide/database/`
- `https://flueframework.com/docs/guide/sandboxes/`
- `https://flueframework.com/docs/guide/targets/cloudflare/`
- `https://flueframework.com/docs/api/agent-api/`
- `https://flueframework.com/docs/api/routing-api/`
- `https://flueframework.com/docs/ecosystem/sandboxes/cloudflare/`
- `https://alchemy.run/guides/cloudflare-tanstack-start/`
- `https://alchemy.run/providers/cloudflare/d1-database/`
- `https://alchemy.run/providers/cloudflare/durable-object-namespace/`
- `https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/`
- `https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/`
- `https://developers.cloudflare.com/sandbox/`
- `https://developers.cloudflare.com/sandbox/guides/mount-buckets/`

## Problem Statement

The product is trying to become a browser-based, repo-native coding agent: something in the spirit of Claude Code or Codex on the web, and adjacent to Lovable / v0, but focused on existing GitHub projects, inspectable work, and sandboxed execution rather than being a generic app generator.

The current workflow is too coupled and too ambiguous. Runner concerns, sandbox lifecycle, product metadata, live streaming, locks, and persistence are easy to blur together. That makes every future feature risky: a change to agent execution can accidentally become a change to product state, a change to sandbox persistence can accidentally become a chat-history change, and a lock bug can corrupt a project workspace.

From the user's perspective, the failure mode is simple: they cannot trust that an accepted prompt will run durably, stream clearly, serialize edits safely, preserve the sandbox state across hibernation, and show a coherent history when they return later.

From the team's perspective, there is no single document that explains which layer owns which responsibility. Without that ownership map, future implementation plans will continue to debate foundational architecture instead of shipping thin, verifiable slices.

## Solution

Build Ditto around four ownership layers. Each layer has a narrow job, explicit sources of truth, and clear boundaries with the other layers.

### Layer 1: Product Surface — TanStack Start

TanStack Start owns the user-facing product:

- GitHub login and Better Auth session handling.
- Dashboard and project navigation.
- Project import and repo selection UX.
- Chat UI, run status, streamed activity, changed files, and review surfaces.
- tRPC procedures or server functions for product actions:
  - create project;
  - create session;
  - send message;
  - fetch session history;
  - fetch project / sandbox / lock status;
  - cancel run;
  - answer clarification;
  - request snapshot / restore status;
  - explicitly export changes later.
- Server-side authorization before any project, session, coordinator, Flue, sandbox, D1, or R2 operation is reached.

TanStack Start does **not** own the agent harness, lock correctness, sandbox filesystem, canonical Flue conversation stream, or Cloudflare resource declaration.

### Layer 2: Infrastructure and Durable App Data — Alchemy, D1, R2

Alchemy owns deployable infrastructure declaration:

- Worker that serves TanStack Start and the application API.
- D1 database for app metadata.
- R2 bucket for large blobs, append-only artifacts, and snapshots.
- Application-owned Durable Object namespaces such as the project coordinator.
- Flue-generated Durable Object migrations and bindings where required by the final Flue integration.
- Cloudflare Sandbox container and Durable Object binding.
- Environment bindings and secrets.

D1 owns app metadata:

- users and Better Auth tables;
- projects;
- GitHub installation / repo references;
- sessions as product chat/task threads;
- user message metadata and product-visible message projections;
- Ditto run records;
- lock status projection for listing and dashboards;
- snapshot pointers;
- sandbox identity;
- model selections and user preferences;
- audit metadata.

R2 owns large or blob-like state:

- immutable sandbox snapshots;
- snapshot manifests;
- large command logs;
- large diffs;
- agent attachments that the app chooses to persist outside Flue;
- generated artifacts;
- optional backup archives.

D1 and R2 do **not** own live coordination. D1 lock fields are projections and indexes; the project coordinator Durable Object is the authority for live leases and queues.

### Layer 3: Coordination — Project Coordinator Durable Object

One project usually maps to one project coordinator Durable Object. The coordinator is the authority for project-level concurrency and live project events.

It owns:

- the mutation lease;
- FIFO queue of waiting mutating sessions / runs;
- read-only admission rules while a mutation is active;
- lease renewal and expiry;
- cancellation intent;
- `needs_input` pause state;
- live event fan-out to connected clients;
- status snapshots for reconnecting clients;
- handoff to Flue when a prompt is admitted;
- coordination with snapshot checkpoints.

The coordinator enforces the product rule:

> Only one agent may perform mutations in a project at a time. Other concurrent agents may read only, and only through read-only capabilities.

The coordinator does **not** store canonical chat history, large logs, full diffs, or workspace snapshots. It stores only coordination state and enough recent event metadata to reconnect clients safely.

### Layer 4: Agent Runtime — Flue Orchestration + Cloudflare Sandbox Execution

Flue owns the agent harness:

- agent definitions;
- model configuration;
- instructions;
- tools;
- skills;
- Flue sessions;
- canonical agent conversation streams;
- attachment references and runtime conversation persistence;
- accepted submissions and durable recovery facts;
- model/tool event streams that the product can observe and project.

Cloudflare Sandbox owns the execution boundary:

- project filesystem;
- command execution;
- dependency installation;
- dev server processes;
- test/build commands;
- preview URLs;
- isolated untrusted code execution;
- filesystem state that is checkpointed to R2.

The agent runtime layer works inside the project sandbox selected by the product and coordinator. It must not create a new sandbox per session. A project may have many Flue sessions / product sessions over time, but the filesystem and command boundary is the project sandbox.

## Domain Model

### Core entities

- **User:** an authenticated person using the product.
- **Project:** a user's workspace boundary, usually imported from GitHub. A project owns one sandbox identity and many sessions.
- **Sandbox:** the Cloudflare Sandbox filesystem and command boundary for a project. One project maps to one sandbox.
- **Session:** a chat thread or task thread inside a project. A session is the product's user-visible conversation unit.
- **Flue session:** named conversation state inside a Flue harness. The desired mapping is one product session to one named Flue session.
- **Run:** one accepted execution attempt by one agent for one user instruction. A run belongs to a product session and may be mutating or read-only.
- **Agent instance:** the Flue continuing agent context that operates on a project and its sandbox. The preferred mental model is one project-scoped agent instance with named sessions.
- **Mutation lease:** a short-lived coordinator-owned grant that allows one run/session to perform writes.
- **Snapshot:** an R2-backed checkpoint of workspace state plus metadata in D1.
- **Artifact:** a large diff, log, attachment, or generated file stored in R2 and referenced from D1 or event payloads.

### Source-of-truth matrix

| Concern | Source of truth | Notes |
|---|---|---|
| User identity and auth | D1 / Better Auth | Product-owned. |
| Project ownership and GitHub repo metadata | D1 | Product-owned. |
| Product session list and titles | D1 | Product-owned. |
| Product run records and statuses | D1 | Product-owned projection of accepted attempts. |
| Canonical agent conversation stream | Flue persistence in generated Cloudflare Durable Objects | Do not duplicate as a second transcript in D1. |
| Agent attachments accepted by Flue | Flue persistence unless the app explicitly stores additional artifact copies in R2 | Keep app artifacts separate from Flue canonical state. |
| Live lock / queue / lease | Project coordinator Durable Object SQLite | Strongly consistent per project. |
| Lock status shown on dashboard | D1 projection of coordinator state | Eventually consistent for listing; coordinator remains authoritative. |
| Workspace files | Cloudflare Sandbox filesystem | Rehydrated from R2 snapshot when needed. |
| Durable workspace backup | R2 snapshot plus D1 pointer | Exclude secrets; regenerate `.env` from encrypted app data. |
| Large logs / diffs | R2 artifact objects plus D1 pointers | Keep D1 compact. |
| Deployable Cloudflare resources | Alchemy declarations | No hand-maintained drift. |

## User Stories

1. As a signed-in user, I want to import an existing GitHub project, so that I can work on real code without setting up a local environment.
2. As a signed-in user, I want each project to reopen into the same workspace state, so that I can continue work after closing the browser.
3. As a signed-in user, I want one project to have many chat sessions, so that I can separate tasks without creating new sandboxes.
4. As a signed-in user, I want an empty draft chat to avoid creating durable records, so that my sidebar is not polluted by abandoned drafts.
5. As a signed-in user, I want a session to become durable when my first message is accepted, so that every visible thread has real history.
6. As a signed-in user, I want to send a coding instruction from the browser, so that the agent can inspect and modify my repo.
7. As a signed-in user, I want the UI to stream agent progress, so that I know work is happening.
8. As a signed-in user, I want to refresh the page during a run, so that I can reconnect without losing the accepted work.
9. As a signed-in user, I want the chat history to load even after the sandbox hibernates, so that hibernation does not feel like data loss.
10. As a signed-in user, I want clear run states, so that I can distinguish queued, running, waiting for input, completed, failed, and canceled work.
11. As a signed-in user, I want the agent to ask a clarification question when needed, so that it does not guess incorrectly.
12. As a signed-in user, I want to answer a clarification in the same session, so that the original run can continue.
13. As a signed-in user, I want to stop an active run, so that I can prevent unwanted additional work.
14. As a signed-in user, I want canceled runs to stay canceled, so that late events cannot resurrect work I stopped.
15. As a signed-in user, I want the app to show stable error messages, so that I can recover without reading internal logs.
16. As a signed-in user, I want to choose or inherit a model, so that I can balance quality, speed, and cost.
17. As a signed-in user, I want model choice recorded on each run, so that later history explains how work was produced.
18. As a project owner, I want only authorized users to access a project, so that private repos remain private.
19. As a project owner, I want GitHub authorization checked server-side, so that client-side repo state cannot grant access.
20. As a project owner, I want repository state to be hydrated into the sandbox before an agent edits, so that edits happen against the expected codebase.
21. As a project owner, I want the sandbox `.env` to be regenerated from encrypted app data after restore, so that secrets are not embedded in snapshots.
22. As a project owner, I want snapshots to exclude provider keys, GitHub tokens, private keys, and plaintext environment values, so that backups are safe.
23. As a project owner, I want successful mutating work checkpointed to R2, so that sandbox sleep or replacement does not lose my changes.
24. As a project owner, I want snapshot metadata visible in project status, so that I know whether the workspace has a durable checkpoint.
25. As a project owner, I want to know when a sandbox is restoring, so that I do not start work against a half-restored filesystem.
26. As an engineer, I want the agent to read repository files, so that answers are grounded in the actual code.
27. As an engineer, I want the agent to write or patch files only after it has a mutation lease, so that concurrent edits cannot corrupt the project.
28. As an engineer, I want read-only agents to continue while another agent is mutating, so that teammates can still ask questions.
29. As an engineer, I want read-only agents to have read-only tools, so that they cannot mutate through a loophole.
30. As an engineer, I want the agent to run bounded commands, so that it can verify changes without hanging indefinitely.
31. As an engineer, I want command output summarized and capped, so that the UI stays usable.
32. As an engineer, I want full large logs stored as artifacts when needed, so that evidence is available without bloating D1.
33. As an engineer, I want the agent to generate real diffs from the sandbox, so that review is based on actual file changes.
34. As an engineer, I want changed files to be linked to the relevant run, so that I can review what each instruction did.
35. As an engineer, I want package-manager-aware verification, so that the agent runs the right tests or builds for the repo.
36. As an engineer, I want preview URLs surfaced when the sandbox exposes an app, so that I can inspect the result in the browser.
37. As an engineer, I want outside-world effects separated from sandbox-internal work, so that the agent cannot push, deploy, or open PRs without explicit user action.
38. As an engineer, I want the app to show the active mutation holder, so that I understand why my mutating request is queued or rejected.
39. As an engineer, I want queued mutating requests to be ordered fairly, so that work proceeds predictably.
40. As an engineer, I want stale leases to expire or be recovered, so that a crashed run does not block the project forever.
41. As an engineer, I want the coordinator to broadcast lock changes, so that all open tabs show the same project status.
42. As a low-code builder, I want the chat to explain what happened in plain language, so that I can trust the workflow without reading every log.
43. As a low-code builder, I want disabled or future features to look honest, so that I am not misled by non-functional controls.
44. As a designer, I want to request small UI changes in an existing repo, so that I can make product progress without a full local setup.
45. As a designer, I want to inspect the running preview, so that I can validate visual changes.
46. As a maintainer, I want TanStack Start to own only product UI and API concerns, so that the agent runtime can evolve independently.
47. As a maintainer, I want Alchemy to declare infrastructure, so that deploys, previews, and teardown are reproducible.
48. As a maintainer, I want D1 to store app metadata, so that product queries are fast and explicit.
49. As a maintainer, I want Flue to own canonical agent history, so that Ditto does not reinvent conversation persistence.
50. As a maintainer, I want the project coordinator Durable Object to own locks, so that concurrency is strongly consistent.
51. As a maintainer, I want R2 to store snapshots and large artifacts, so that D1 stays small and queryable.
52. As a maintainer, I want a clear event projection from Flue to the product UI, so that users see agent progress without duplicating canonical transcripts.
53. As a maintainer, I want run records to point to Flue submission or stream offsets, so that debugging can bridge product metadata and Flue history.
54. As a maintainer, I want each layer to have a small contract, so that future plans can be implemented incrementally.
55. As a maintainer, I want the first implementation slice to prove admission, lock, Flue dispatch, stream, and terminal state before adding broad tools, so that the rewrite is safe.
56. As a maintainer, I want observable metrics for lock contention and run failures, so that architecture decisions can be based on product data.
57. As a security reviewer, I want path traversal blocked in agent tools, so that a prompt cannot access files outside the workspace.
58. As a security reviewer, I want secrets redacted from all product events and logs, so that credentials are not leaked through chat.
59. As a security reviewer, I want R2 mount prefixes scoped narrowly, so that a sandbox can only see the project data it needs.
60. As an operator, I want resource declarations and migrations to be explicit, so that deploy failures are caught before users hit them.
61. As an operator, I want sandbox status separated from agent status, so that infrastructure issues and model issues can be diagnosed independently.
62. As an operator, I want durable events and snapshots to survive Worker restarts, so that accepted work is not lost during deploys.
63. As an operator, I want manual recovery controls for stuck projects, so that support can unblock users without data loss.
64. As a future implementation agent, I want this PRD to define scope boundaries, so that I can write small plans without re-litigating the architecture.

## Implementation Decisions

### 1. Four-layer ownership is binding

Future plans should preserve the four ownership layers unless this PRD is amended.

| Layer | Owns | Must not own |
|---|---|---|
| TanStack Start | Product UI, auth, server functions, tRPC, user-visible state | Agent harness internals, direct filesystem mutation, live lock authority |
| Alchemy + D1 + R2 | Infrastructure declaration, app metadata, snapshot/artifact storage | Canonical agent transcript, live lock serialization |
| Project coordinator Durable Object | Project lease, queue, live event hub, coordination state | Large blobs, full transcript, workspace files |
| Flue + Cloudflare Sandbox | Agent orchestration, canonical conversation, tools, skills, sandbox commands/files | Product authorization, app metadata, explicit external export actions |

### 2. D1 is app metadata, not the canonical Flue transcript

D1 should store product records and product projections:

- users;
- auth;
- projects;
- sessions;
- messages as product metadata or renderable projections;
- run records;
- run status;
- lock status projection;
- repo references;
- model selection;
- snapshot and artifact pointers;
- audit fields.

Flue should own canonical model-visible conversation streams, assistant output, tool calls, tool results, compaction records, runtime attachments, accepted submissions, and recovery facts.

D1 may store a materialized message projection for fast product UI, but that projection must not become a second authoritative transcript. If a discrepancy exists, Flue's canonical stream is authoritative for agent conversation, while D1 remains authoritative for product metadata.

### 3. R2 is the durable workspace and artifact store

R2 should store append-only or immutable objects:

- workspace snapshots;
- snapshot manifests;
- full diffs beyond D1 payload limits;
- long command logs;
- generated artifacts;
- optional uploaded attachments that belong to the product rather than Flue alone.

Recommended object organization:

- project-scoped prefixes;
- snapshot IDs that are immutable;
- manifest objects that include digests, created time, run ID, base commit, and excluded paths;
- separate prefixes for logs, diffs, attachments, and snapshots;
- no plaintext secrets.

R2 object keys and manifests should be referenced from D1. The browser should receive signed or proxied access only when needed and authorized.

### 4. Alchemy declares all Cloudflare resources

Alchemy should declare and bind:

- TanStack Start Worker;
- D1 database and migrations;
- R2 bucket;
- project coordinator Durable Object namespace with SQLite;
- Cloudflare Sandbox Durable Object namespace, container image, and container limits;
- Flue-generated Durable Object classes and migrations as required by the final Flue build path;
- secrets and environment bindings;
- local development shims.

Manual Cloudflare dashboard edits should not be required for normal deploys. If Flue generation requires build-time migration names, the first implementation plan must establish how those generated names are fed into the Alchemy deployment without drift.

### 5. One project maps to one sandbox

The project sandbox identity is stable and project-scoped. Sessions and runs do not create new sandboxes.

Rules:

- The sandbox ID is derived from or stored on the project.
- All Flue sessions for a project use that sandbox.
- A run may start only after sandbox readiness is verified.
- Readiness means more than `sandboxId exists`; it must include workspace hydration or restoration status.
- The sandbox workspace path is stable and known to agent instructions.
- The sandbox may hibernate, but hibernation must not be treated as data loss.

### 6. Sandbox durability is independent from Flue conversation durability

Flue conversation persistence does not make sandbox files durable. A durable sandbox workspace does not preserve agent conversation by itself.

Therefore:

- Flue handles canonical conversation and recovery facts.
- R2 snapshots handle workspace state.
- D1 connects product run/session metadata to both.
- The coordinator ensures the correct workspace state is available before a mutating run starts or resumes.

### 7. Snapshot and restore are first-class product capabilities

A successful mutating run should trigger or schedule a checkpoint. Long-running mutating runs may checkpoint periodically.

Snapshot policy:

- checkpoint before risky restore/recreate operations;
- checkpoint after successful mutating runs;
- checkpoint at explicit user request;
- optionally checkpoint before external export actions;
- store snapshot manifest and pointer in D1;
- exclude `.env`, provider credentials, GitHub tokens, private keys, and other secrets;
- regenerate environment files from encrypted app data after restore;
- validate restored workspace with a repo sentinel such as Git metadata and a manifest digest where possible.

Restore policy:

- if sandbox filesystem is missing, stale, or untrusted, restore from the latest valid snapshot;
- if no snapshot exists, rehydrate from GitHub baseline;
- while restore is active, mutating run admission is paused;
- readers receive status indicating the workspace is restoring;
- failed restore produces a stable project status and recovery path.

### 8. The project coordinator Durable Object is the live authority

The coordinator should be addressed deterministically by project ID.

It owns this state:

```ts
// Decision-rich shape, not implementation code.
type ProjectCoordinatorState = {
  projectId: string;
  mutationLease: null | {
    leaseId: string;
    runId: string;
    sessionId: string;
    userId: string;
    grantedAt: string;
    expiresAt: string;
    fencingToken: number;
  };
  mutatingQueue: Array<{
    runId: string;
    sessionId: string;
    userId: string;
    requestedAt: string;
  }>;
  activeReadOnlyRuns: Array<{
    runId: string;
    sessionId: string;
    userId: string;
    admittedAt: string;
  }>;
  pausedRun: null | {
    runId: string;
    reason: "needs_input" | "restore" | "operator_hold";
  };
  snapshot: {
    latestSnapshotId: string | null;
    restoring: boolean;
  };
};
```

Coordinator responsibilities:

- grant one mutation lease at a time;
- grant read-only admission during mutation only with read-only capabilities;
- reject or queue mutating requests when a mutation lease is active;
- persist lease state before broadcasting it;
- use fencing tokens so stale holders cannot mutate after lease loss;
- renew active leases while work is progressing;
- expire or recover stale leases;
- broadcast state changes to connected clients;
- update D1 projections after state changes;
- call into Flue only after admission is accepted.

### 9. Mutating tools must be lease-fenced

Agent capabilities that can mutate the workspace must require a valid lease and current fencing token.

Mutating capabilities include:

- file write;
- file patch;
- file delete;
- dependency install;
- commands likely to modify files;
- environment sync;
- snapshot write;
- process control that changes workspace state.

Read-only capabilities include:

- file read;
- directory list;
- git status / diff read;
- bounded commands declared read-only;
- reading logs;
- reading preview status.

A read-only run must not receive mutating tools. A mutating run whose lease expires must fail or pause before any further mutation.

### 10. Flue is the agent orchestration layer

The primary coding assistant should be implemented as a Flue agent, not a hand-rolled runner.

Flue should own:

- the agent's continuing identity;
- model specifier and provider configuration;
- instructions;
- tools;
- skills;
- named sessions;
- canonical conversation stream;
- durable admission and recovery behavior;
- compaction;
- observation of agent activity.

Flue workflows should be reserved for bounded jobs that run once and return a result, such as PR summary generation, repo health scans, snapshot validation, or eval tasks. The normal chat loop should use a continuing Flue agent.

### 11. Product session to Flue session mapping is preferred

Preferred mapping:

- project = project workspace and sandbox boundary;
- project coordinator DO = one per project;
- Flue agent instance = project-scoped continuing agent;
- product session = named Flue session inside that project harness;
- product run = one accepted prompt / task / operation in that named Flue session;
- sandbox = project-scoped filesystem and command boundary.

Implementation caveat:

Flue's public HTTP agent route exposes agent name, agent instance ID, and message. If named Flue session selection is not available through that route, the first implementation plan must choose one of these safe alternatives:

1. use an application-owned Flue entrypoint that opens the named session before prompting;
2. encode product session identity into the Flue agent instance ID while still using the project sandbox ID;
3. use Flue `dispatch(...)` or another documented API that can preserve the desired mapping.

The product invariant is more important than the exact API shape: many product sessions may share one project sandbox, and the project coordinator remains project-scoped.

### 12. Run records are product attempts, not necessarily Flue Workflow Runs

A Ditto run is one product-visible execution attempt. For normal chat, it corresponds to a Flue agent submission / prompt operation, not a Flue workflow run.

D1 run records should store:

- run ID;
- project ID;
- product session ID;
- user ID;
- mutating/read-only mode;
- model specifier;
- user message metadata;
- status;
- start/finish timestamps;
- Flue agent name;
- Flue agent instance ID;
- Flue submission ID or stream coordinates when available;
- snapshot IDs / artifact pointers when relevant;
- error code or cancellation reason.

### 13. Message handling flow

Target flow:

1. Browser sends a chat message to TanStack Start through tRPC or a server function.
2. TanStack Start authenticates the user.
3. TanStack Start validates project access and GitHub authorization.
4. TanStack Start creates or loads the product session.
5. TanStack Start creates a product run record in D1.
6. TanStack Start writes user message metadata / projection to D1.
7. TanStack Start asks the project coordinator for admission.
8. Coordinator grants read-only admission or mutation lease, queues, or rejects.
9. On admission, coordinator starts or resumes the Flue agent operation.
10. Flue records canonical conversation and tool activity in its own persistence.
11. Agent tools operate against the project sandbox.
12. Product event projection streams back to the browser.
13. Mutating runs write checkpoint snapshots to R2 at policy-defined times.
14. D1 run status, lock projection, snapshot pointer, and artifact pointers are updated.
15. Terminal states release mutation leases only when owned by that run.

### 14. Event projection must be explicit

The product UI needs a stable event vocabulary, but Flue remains canonical for agent conversation.

Recommended product event projection:

| Source activity | Product projection | Notes |
|---|---|---|
| User message accepted | `message.user` | Metadata and render projection in D1. |
| Assistant text delta | `message.assistant.delta` | Stream to UI; compact or finalize projection in D1. |
| Assistant message finalized | `message.assistant.final` | Store renderable projection and Flue offset. |
| Tool started | `tool.started` | Include tool name, run ID, capability class. |
| Tool progress | `tool.progress` | Cap/redact payload; large logs to R2. |
| Tool finished | `tool.finished` | Include success/failure and artifact refs. |
| File changed | `file.changed` | Mutating lease required. |
| Diff ready | `diff.ready` | Full diff may live in R2. |
| Preview available | `preview.ready` | URL must be scoped and authorized. |
| Clarification needed | `needs_input` | Product run pauses. |
| Lease queued/granted/released | `lock.updated` | From coordinator. |
| Snapshot started/completed/failed | `snapshot.*` | R2 and D1 pointer updates. |
| Run completed/failed/canceled | `run.terminal` | Releases lock if owner. |

### 15. UI streaming should reconnect from durable sources

The browser should not own run progress. On reconnect, the UI should reconstruct state from durable sources:

- D1 product metadata and projections for sessions/runs/status;
- Flue canonical stream or materialized Flue observation for agent messages;
- coordinator state snapshot for lock/queue/restore status;
- R2 artifact pointers for large logs/diffs.

Live streaming may use WebSockets, Durable Streams observation, long polling, or an equivalent documented mechanism, but the reconnect path must not depend on in-memory browser state.

### 16. Product APIs should stay small and intentional

Initial product procedures / server functions should cover:

- create project;
- list projects;
- get project status;
- create session or start draft-to-session transition;
- send message;
- list sessions;
- get session history;
- observe session / run events;
- cancel run;
- answer clarification;
- get sandbox status;
- get snapshot status.

External export actions such as commit, branch, PR, or deploy are separate explicit product APIs and remain out of the core agent loop.

### 17. Security boundaries are product requirements

Security rules:

- Authenticate every product API call.
- Authorize project access server-side.
- Verify GitHub installation/repo access server-side before repo operations.
- Never expose provider keys, GitHub tokens, private keys, or `.env` values to the browser.
- Never store plaintext secrets in D1 event payloads, R2 snapshots, or logs.
- Redact command output before projecting it to the UI.
- Block path traversal outside the workspace.
- Scope R2 mounts to the narrowest prefix.
- Prefer Worker-managed R2 binding mounts for sandbox persistence; if endpoint credentials are used, use credential proxy and Worker secrets.
- Do not let the agent push to GitHub, open PRs, deploy, destroy sandboxes, or mutate external systems without explicit user action.

### 18. Default agent behavior

The primary Flue agent should be a repo-native coding agent.

It should:

- work in the project workspace;
- inspect before editing;
- cite evidence from files and command output;
- prefer small, reversible changes;
- run relevant verification;
- summarize changes clearly;
- ask for clarification when requirements are ambiguous;
- respect read-only vs mutating mode;
- avoid outside-world effects;
- avoid destructive commands unless a future explicit approval system exists.

### 19. Tool policy should be narrow at first

Initial tools should be grouped by capability:

- read workspace;
- inspect git state;
- run bounded read-only command;
- write/patch file with lease;
- run bounded mutating command with lease;
- generate diff artifact;
- manage preview process;
- checkpoint snapshot.

Dangerous commands should be denied or require future explicit approval. Examples include commands that destroy directories, rewrite Git history, push to remotes, modify global credentials, deploy production, or alter Cloudflare resources.

### 20. Observability is required from the beginning

Track at least:

- prompt accepted to first visible event;
- prompt accepted to terminal state;
- queue wait time;
- mutation lease duration;
- lock rejection rate;
- stale lease recoveries;
- run completion/failure/cancellation rates;
- `needs_input` rate and resolution rate;
- sandbox restore count and duration;
- snapshot success/failure rate;
- tool failure rate by capability;
- command timeout rate;
- percentage of mutating runs with non-empty diff;
- percentage of successful mutating runs followed by explicit export action.

### 21. Release sequencing

This rewrite should be completed through multiple small plans. Recommended phases:

#### Phase 0: Architecture spike and integration proof

- Prove how TanStack Start, Flue Cloudflare target, Alchemy, and Cloudflare Sandbox coexist in one deployable Worker or a deliberately split Worker arrangement.
- Prove the product-session to Flue-session mapping.
- Prove authenticated server-owned admission to a Flue agent.
- Prove the project coordinator can admit a run and observe terminal state.

#### Phase 1: Infrastructure and data foundation

- Declare required resources in Alchemy.
- Establish D1 metadata shape for sessions/runs/snapshot pointers.
- Establish R2 bucket layout.
- Add project coordinator Durable Object with minimal status APIs.
- Add local development path.

#### Phase 2: Flue project agent foundation

- Add the primary Flue coding agent.
- Connect it to the project sandbox.
- Use read-only tools first.
- Stream assistant output and tool events into product projections.
- Keep mutating tools disabled.

#### Phase 3: Lock, lease, and mutating tools

- Add mutation lease acquisition.
- Add lease-fenced file patch/write tools.
- Add bounded command execution.
- Add diff generation.
- Add cancellation and late-event gating.

#### Phase 4: Snapshot and restore durability

- Add final-run checkpoints.
- Add periodic checkpoints for long mutating runs.
- Add restore on sandbox wake/recreate.
- Add snapshot status and failure recovery UX.

#### Phase 5: Review and explicit export

- Improve diff review.
- Add commit/branch/PR flows as explicit product actions.
- Consider bounded Flue workflows for PR summaries or release notes.

#### Phase 6: Concurrency and quality improvements

- Allow more read-only concurrency if metrics support it.
- Consider worktrees or branch snapshots before any multi-mutator design.
- Add evals, regression suites, and richer observability.

## Testing Decisions

### What makes a good test

A good test verifies externally visible behavior at a stable seam. It should avoid coupling to internal implementation details such as exact helper names, private fields, or transient SDK event shapes.

The highest-value automated seam is the **Project Agent Run Contract**:

> Given an authenticated user, project, session, message, run mode, fake Flue runtime, fake sandbox adapter, and fake snapshot store, the system admits or rejects the run correctly, updates durable metadata, enforces locks, projects events, and reaches the correct terminal state.

This seam is high enough to protect the architecture and low enough to run without real LLM credentials or live sandbox containers.

### Primary automated test coverage

1. **Run admission contract**
   - new session created on first accepted message;
   - existing session reused;
   - unauthorized project access rejected;
   - sandbox-not-ready status blocks mutating work;
   - read-only run admitted while mutation active;
   - mutating run queued or rejected while mutation active;
   - accepted run records Flue submission/stream pointer when available.

2. **Coordinator lease and queue behavior**
   - one active mutation lease per project;
   - FIFO mutating queue;
   - lease renewal;
   - lease expiry;
   - fencing token prevents stale mutation;
   - cancellation releases owned lease;
   - terminal event releases owned lease only;
   - late terminal event cannot change canceled run.

3. **Flue event projection contract**
   - assistant deltas project to UI stream;
   - finalized assistant messages store a durable projection;
   - tool starts/progress/finish project with redaction;
   - large payloads become artifact references;
   - `needs_input` pauses the product run;
   - terminal outcomes map to product statuses.

4. **Sandbox tool policy**
   - read-only mode lacks mutating tools;
   - mutating tools require current lease;
   - path traversal rejected;
   - blocked commands rejected;
   - command output caps and redaction apply;
   - file changes produce diff metadata.

5. **Snapshot manifest contract**
   - snapshot excludes secrets;
   - manifest stores digest, run ID, project ID, base commit, and created time;
   - D1 pointer updates only after R2 write succeeds;
   - restore refuses invalid manifest;
   - restore status blocks mutating admission.

### Durable Object tests

Use Cloudflare Worker / Durable Object test tooling for coordinator behavior where possible. Durable Object tests should verify externally callable methods and state transitions, not private implementation.

### Flue integration tests

Use a fake Flue adapter for most automated tests. Add a small optional integration smoke test that runs only with explicit credentials and a live-compatible environment.

The smoke path should verify:

- authenticated message accepted;
- Flue agent receives prompt;
- stream emits assistant output;
- run reaches terminal state;
- D1 projection is readable after reconnect.

### Sandbox integration tests

Most sandbox behavior should be tested through a fake sandbox adapter and policy tests. Live sandbox tests should be manual or opt-in because they require Docker / Cloudflare runtime / credentials.

Manual smoke checks should cover:

- project opens after sandbox sleep;
- restore from R2 snapshot;
- mutating run creates real diff;
- cancellation stops further writes;
- preview URL appears when a dev server is running;
- no secrets appear in projected logs.

### Prior art to reuse

Existing project patterns worth preserving:

- pure protocol tests for runner/event mapping;
- policy tests for workspace/run behavior;
- env-var validation tests;
- sandbox backup serialization tests;
- GitHub authorization tests.

Future plans should prefer adding focused tests at these seams rather than introducing a broad, brittle browser automation harness too early.

## Out of Scope

The following are out of scope for this PRD's core rewrite:

- Completing the entire rewrite in one plan.
- Cloning Lovable, v0, Claude Code, or Codex feature-for-feature.
- Building a full browser IDE.
- Per-session sandboxes.
- Multiple concurrent mutating agents in one project.
- Multi-agent swarms as a core v1 capability.
- Generic per-tool approval UX for every sandbox-internal operation.
- Automatic GitHub pushes, branch creation, PR creation, production deploys, or sandbox destruction by the agent.
- Making D1 the canonical Flue transcript store.
- Storing full logs, full diffs, or workspace archives in D1.
- Retention/deletion product workflows for Flue's internal canonical stream.
- Solving every unusual repository bootstrap pattern before the basic loop works.
- Enterprise org policy, SSO, audit exports, or billing.
- Cross-user real-time collaborative editing.

## Further Notes

### Acceptance criteria for the architecture

The architecture is considered valid when:

- TanStack Start can accept an authenticated project message.
- D1 stores product metadata for project/session/run/message projection.
- Project coordinator grants or denies admission according to lock policy.
- Flue receives admitted work and owns canonical agent conversation history.
- The Flue agent operates against the existing project sandbox, not a new session sandbox.
- Read-only work can be separated from mutating work by capability.
- Mutating work requires a lease and fencing token.
- Agent progress streams to the browser and can be reconstructed after reconnect.
- Successful mutating work produces a real diff and R2 checkpoint.
- Sandbox hibernation does not lose accepted workspace state.
- Terminal states release owned locks and cannot overwrite cancellation.
- Secrets do not appear in D1 events, R2 snapshots, streamed frames, or logs.
- Alchemy can deploy and destroy the required Cloudflare resources reproducibly.

### Key open questions for the first implementation plan

1. Does the chosen Flue public/API surface support named Flue sessions directly, or should product session identity be encoded in the Flue agent instance ID?
2. Will Flue and TanStack Start run in one Worker, or should Flue be built as a sibling Worker behind an application-owned authenticated bridge?
3. How will Alchemy consume or declare Flue-generated Durable Object classes and migrations without manual drift?
4. What is the first production model/provider: Anthropic, OpenAI, OpenRouter, Cloudflare Workers AI, or project-selectable?
5. Should mutating requests queue automatically or return a conflict with a user-facing retry option in the first release?
6. What exact file format should R2 snapshots use: archive object, mounted bucket prefix, content-addressed file tree, or Sandbox SDK native backup if available?
7. How much Flue canonical history should be materialized into D1 for fast UI rendering?
8. What command allow/deny policy is strict enough for v1 without making the agent useless?
9. What manual operator recovery controls are required for stuck leases, failed restores, or corrupted snapshots?

### Kill metrics

Revisit the architecture if any of these persist after the mutating loop ships:

- More than 5% of accepted mutating runs lose their terminal state or require manual cleanup.
- More than 2% of successful mutating runs fail to checkpoint.
- More than 1% of runs leak secret-like strings into product-visible output.
- Median prompt-to-first-event exceeds the product's acceptable latency target by more than 2x.
- Lock contention blocks a meaningful share of active users and read-only concurrency does not reduce it.
- Flue/TanStack/Alchemy integration requires manual resource drift management on every deploy.

### Future product direction

After the rewrite is stable, Ditto can grow toward:

- explicit GitHub commit / branch / PR actions;
- PR description and review workflows;
- project memory under the workspace;
- repo health scans;
- background maintenance agents;
- evals for agent quality;
- team collaboration;
- worktree-backed safe concurrency;
- richer visual preview and design review.

Those features should be planned only after the four-layer foundation is working and measured.
