# Ditto domain context

Ditto uses the terms below in product discussion, specifications, architecture documents, and code. Implementation details belong in `docs/architecture/`.

## People and ownership

### User

A person signed in to Ditto. A user owns projects, workspace sessions, and messages.

## Project work

### Project

A GitHub repository registered with Ditto for one user. A project groups its workspace sessions, environment values, Git export permissions, and one immutable project seed. A project does not own a live runtime.

### Project seed

An immutable archive of a repository checkout prepared for workspace restore. A project seed records the source commit and compatibility inputs. It is not a live workspace and is never derived from mutable workspace-session recovery.

### Project-seed builder

A temporary sandbox used only to fetch an owned repository through the Worker, prepare the seed tree, and stream the seed archive. The builder is destroyed and permanently retired after seed creation. It receives no model access or project environment values.

### Project environment value

A named secret or configuration value supplied by the user for project commands. Ditto treats the value as write-only after storage and keeps it out of repository files.

### Project memory

Project-scoped context that remains available across workspace sessions. Project memory is separate from a conversation and from repository-owned instructions.

## Sandbox identity and privilege

### Sandbox identity

A durable Ditto record that binds a random sandbox ID, Cloudflare container ID, owners, lifecycle generation, and retirement state. Retired identities remain as permanent tombstones and never regain authority.

### Privileged operation

A time-bounded Worker-owned window that authorizes one contract family for a sandbox identity. The sandbox cannot invent or extend a privileged operation. Privileged families include model requests, Git transport, and Ditto actions.

## Conversations and execution

### Workspace session

A user's conversation and line of work within one project. A workspace session owns one chat thread, branch, sandbox runtime, and recovery lineage. Its sandbox has a `/workspace` checkout for the session branch. An archived workspace session remains part of history but cannot receive new work.

Use "workspace session" in full. "Session" alone is ambiguous because Ditto also has auth sessions and agent runtime sessions.

### Workspace session recovery

The recovery lineage owned by one workspace session: mutation generation, current and previous successful archives, pending checkpoint state, and recovery health.

### Message

A user or assistant entry in a workspace session. An assistant message is pending while its agent run is active, then becomes complete or failed.

### Agent run

One active execution of the coding agent for a workspace session. An agent run can contain an initial turn and queued follow-up turns. Stop ends the active run cooperatively.

### Runtime work

A durable, serializable unit of workspace-session work, such as an agent run, Git mutation, preview start, recovery retry, archive, or destruction. Callers submit an intent and receive a receipt. The first user message and pending assistant are stored before the work is queued or started.

### Running slot

An unexpired capacity lease held by a workspace-session runtime the Worker most recently observed as active. Sleeping and cold ready runtimes do not consume a running slot.

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
    └── Workspace session
        ├── Messages
        ├── Agent runs
        ├── Session branch
        ├── Session sandbox (`/workspace` checkout)
        ├── Session recovery lineage
        └── Session preview
```
