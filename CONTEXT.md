# Ditto domain context

Ditto uses the terms below in product discussion, specifications, architecture documents, and code. Implementation details belong in `docs/architecture/`.

These terms describe the architecture the trusted workspace-session runtime ships. Until cutover, running code still uses one untrusted sandbox for both the agent and the repository.

## People and ownership

### User

A person signed in to Ditto. A user owns projects, workspace sessions, and messages.

## Project work

### Project

A GitHub repository registered with Ditto for one user. A project groups its workspace sessions, environment values, Git export permissions, and one immutable project seed. A project does not own a live runtime.

### Project seed

An immutable archive of a repository checkout prepared for workspace restore. A project seed records the source commit and compatibility inputs. It is not a live workspace and is never derived from mutable workspace-session recovery.

### Project-seed builder

A temporary execution sandbox used only to fetch an owned repository, prepare the seed tree, and stream the seed archive. It has no trusted brain, no model access, and no project environment values. It is destroyed and permanently retired after seed creation.

### Project environment value

A named secret or configuration value supplied by the user for project commands. Ditto treats the value as write-only after storage and keeps it out of repository files.

### Project memory

Project-scoped context that remains available across workspace sessions. Project memory is separate from a conversation and from repository-owned instructions.

## Identities and privilege

### Sandbox identity

A durable Ditto record that binds a random sandbox ID, container identity, owners, lifecycle generation, and retirement state. Distinct identity roles exist for project-seed builders, execution sandboxes, and trusted brains. Retired identities remain as permanent tombstones and never regain authority.

### Privileged operation

A time-bounded Ditto-owned window that authorizes one contract family for an identity. Families include model requests, Git transport, and Ditto actions. The identity cannot invent or extend a window. Ditto opens a window only when it admits execution, not when it merely accepts a command.

## Conversations and execution

### Workspace session

A user's conversation and line of work within one project. A workspace session owns one chat thread, branch, trusted session runtime, trusted brain, execution sandbox, and recovery lineage. The execution sandbox has a `/workspace` checkout for the session branch. An archived workspace session remains part of history but cannot receive new work.

Use "workspace session" in full. "Session" alone is ambiguous because Ditto also has auth sessions and agent runtime sessions.

### Trusted session runtime

The coordinator for one workspace session. It consumes commands, supervises the agent run, journals effects, and decides recovery. It is not the repository checkout and does not run repository processes.

### Trusted brain

The coding-agent process for one workspace session. It owns the model loop, compaction, and continuation of that session. It does not execute repository code, install repository dependencies, or load repository-owned agent configuration.

### Execution sandbox

The untrusted environment that holds a workspace session's `/workspace` checkout, Git binaries, dependencies, builds, tests, and preview. Repository commands run here. The trusted brain does not.

### Workspace session recovery

The recovery lineage owned by one workspace session: mutation generation, current and previous successful paired checkpoints, pending checkpoint state, and recovery health.

### Paired checkpoint

An immutable workspace archive together with the matching agent continuation and execution position. Restore always takes both. Ditto keeps the current and previous successful pairs. Restore never silently falls back to the project seed.

### Run epoch

A counter that increases when the trusted session runtime supersedes an execution attempt, including Stop and recovery takeover. Work from an older epoch is not admitted.

### Message

A user or assistant entry in a workspace session. An assistant message is pending while its agent run is active, then becomes complete or failed.

### Command

An accepted prompt, follow-up, Stop, queue cancellation, or explicit recovery decision with a durable receipt. Admission is not execution.

### Agent run

One active execution of the coding agent for a workspace session. An agent run can contain an initial turn and queued follow-up turns. Stop ends the active run cooperatively.

### Runtime work

A durable, serializable unit of workspace-session work, such as an agent run, Git mutation, preview start, recovery retry, archive, or destruction. Callers submit an intent and receive a receipt. The first user message and pending assistant are stored before the work is queued or started.

### Running slot

An unexpired capacity lease for a trusted brain container or an execution container that Ditto most recently observed as active. Sleeping and cold ready runtimes do not consume a running slot. The two pools are independent.

### Agent event

A structured update produced during an agent run. Agent events describe text, tool activity, turn boundaries, control readiness, errors, and completion.

### Session preview

A temporary public view of the application running from one workspace session. The preview belongs to that session's checkout and does not publish the project.

## Models

### Thinking level

A request for how much reasoning the fixed model should apply. Ditto supports `off`, `high`, and `max`.

## Git work

### Session branch

The Git branch owned by a workspace session. Ditto creates the branch from the project's base branch and uses it for commits and GitHub export.

### Git export

The flow that turns session work into a commit, pushed branch, and optional pull request. UI actions and agent tools use the same ownership and secret policies. Product push remains disabled until non-fast-forward rejection is proved.

## Relationships

```text
User
└── Project
    ├── Project seed (immutable)
    ├── Project-seed builder (temporary execution sandbox, no brain)
    └── Workspace session
        ├── Messages
        ├── Commands
        ├── Agent runs
        ├── Session branch
        ├── Trusted session runtime
        ├── Trusted brain
        ├── Execution sandbox (`/workspace` checkout)
        ├── Session recovery lineage
        │   └── Paired checkpoints (current and previous)
        └── Session preview
```
