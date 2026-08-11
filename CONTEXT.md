# Ditto

Ditto is a project workspace where trusted AI coordination operates on code through an isolated, user-reachable execution environment.

## Agent architecture

**Brain**:
The trusted, project-scoped coordinator that owns session agent state and has exclusive authority to mutate the Project Sandbox.
_Avoid_: Runner, Worker

**Project Sandbox**:
The single untrusted execution environment belonging to a Project. It contains that Project’s repository, session worktrees, and disposable previews, but no agent, provider, or Git credentials.
_Avoid_: Brain, Runner

**Pi Runtime**:
The project-scoped Pi harness hosted by the Brain. It coordinates multiple Pi Agent Sessions but owns no conversation identity.
_Avoid_: Pi session

**Workspace Session**:
A project conversation paired with its own branch, worktree, Pi Agent Session, and run history.
_Avoid_: Sandbox session, shell session

**Session Branch**:
The Git branch owned by exactly one Workspace Session. Ditto may advance its remote ref without force but never uses it to mutate the repository's default branch.
_Avoid_: default branch, shared branch

**Repository Binding**:
The immutable association between a Project and one GitHub repository identity; installation and owner/name locators may change without changing the binding.
_Avoid_: Git remote, repository URL

**Upstream Base**:
A Workspace Session’s frozen source branch name and last integrated commit within its Repository Binding.
_Avoid_: default branch, primary branch

**Git Publication**:
One durable Brain-authorized attempt to commit a Workspace Session's safe changes, advance its Session Branch, and create or return its pull request.
_Avoid_: Git push, pull request, Agent Run

**Git Import**:
One durable Brain-authorized attempt to provision repository history, freeze a new Upstream Base, or merge an updated Upstream Base into a Workspace Session without exposing GitHub credentials to the Project Sandbox.
_Avoid_: Git clone, Git fetch, Git pull

**Trusted Git Executor**:
The ephemeral trusted component that validates credential-free Git artifacts and performs narrowly authorized authenticated remote mechanics without running project code.
_Avoid_: Project Sandbox, Pi runner, Brain

**Pi Agent Session**:
The durable Pi conversation state belonging to exactly one Workspace Session. A Brain coordinates many Pi Agent Sessions.
_Avoid_: Pi Runtime, Agent Run

**Agent Run**:
One durably recorded attempt by a Pi Agent Session to perform work. A Workspace Session may have many Agent Runs; each has an immutable terminal outcome independent of a browser connection.
_Avoid_: Request, stream, Pi Agent Session

**Finalizing**:
The nonterminal Agent Run phase after Pi stops executing and before its checkpoint, workspace backup, messages, and outcome are durably published. New input starts a successor Agent Run.
_Avoid_: running, terminal, settling

**Turn**:
One ordered user-message and assistant-response exchange within an Agent Run. Follow-ups accepted while a run is active become later Turns in that run.
_Avoid_: Agent Run, message

**Safe Checkpoint**:
A durable Pi Agent Session state captured while no model or tool action is unresolved. Recovery may continue only from a Safe Checkpoint.
_Avoid_: snapshot, partial output

**Operation Fence**:
The durable record that an Agent Run began a model or tool action. A fence without a matching result marks uncertain work that must not be replayed.
_Avoid_: lock, checkpoint

**Execution Epoch**:
The monotonic generation fencing one Agent Run attempt from stale Workflow calls, Brain results, events, checkpoints, and tool completions.
_Avoid_: Agent Run, retry count

**Execution Lane**:
A permission-scoped way to execute work in the Project Sandbox, such as agent execution, an interactive terminal, or an app preview.
_Avoid_: Sandbox session

**Session Mutation Lease**:
The exclusive authority to mutate one Workspace Session. An active Agent Run keeps this authority through Finalizing so another writer cannot change its workspace mid-run.
_Avoid_: Project Operation Gate, Operation Fence

**Project Operation Gate**:
The Brain-owned coordination boundary that allows isolated work in different Workspace Sessions to overlap while exclusively fencing operations that affect the whole Project Sandbox.
_Avoid_: Session Mutation Lease, Operation Fence

**Exclusive Preview Presentation**:
A disposable Project Sandbox state containing only one Workspace Session’s previewable files. It excludes other project and session state, blocks all other project work while active, and is discarded before the durable workspace is restored.
_Avoid_: Workspace Session, Project Sandbox backup

**Sandbox Activity Lease**:
A durable claim that keeps the Project Sandbox available while an authorized operation still depends on its current container. Browser connections never own these leases.
_Avoid_: Session Mutation Lease, Project Operation Gate

**Browser Gateway**:
The trusted user-facing boundary that authenticates and authorizes browser access to Ditto resources without owning their execution or exposing internal Brain or Project Sandbox capabilities.
_Avoid_: Brain, execution owner

**Run Attachment**:
A disposable browser delivery connection that replays and tails one Agent Run from a Delivery Cursor. Disconnecting it never stops or changes the Agent Run.
_Avoid_: Agent Run, Workflow

**Delivery Cursor**:
An opaque position in one Agent Run’s durable event history used to resume delivery. It is neither authorization nor Agent Run state.
_Avoid_: message cursor, Execution Epoch

**Delivery State**:
The browser’s current ability to receive Agent Run events, independent of the Agent Run lifecycle.
_Avoid_: Agent Run state

**Preview Capability**:
A short-lived, generation-scoped grant allowing browser access to one Exclusive Preview Presentation. It delegates authenticated access but is not a Project Sandbox credential or activity lease.
_Avoid_: Preview URL, Sandbox Activity Lease

**Architecture Acceptance Gate**:
A machine-checkable condition whose passing evidence is required before a release may admit production work across the Brain, Project Sandbox, Git, or Preview boundaries.
_Avoid_: smoke test, risk acceptance

**Acceptance Evidence**:
The redacted, release-specific record proving which Architecture Acceptance Gates passed for an exact build and deployment configuration.
_Avoid_: test log, dashboard screenshot
