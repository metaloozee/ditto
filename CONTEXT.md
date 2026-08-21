# Ditto domain context

Ditto uses the terms below in product discussion, specifications, architecture documents, and code. Implementation details belong in `docs/architecture/`.

## People and ownership

### User

A person signed in to Ditto. A user owns projects, workspace sessions, and messages.

## Project work

### Project

A GitHub repository registered with Ditto for one user. A project groups its workspace sessions, environment values, Git export permissions, and an immutable project seed. New GitHub imports own a project seed and no persistent sandbox. Legacy projects may still own a shared project sandbox until that path is removed.

### Project seed

An immutable archive of a repository checkout prepared for later workspace restore. A project seed records the source commit and compatibility inputs. It is not a live workspace and is never derived from a mutable workspace-session backup.

### Project-seed builder

A temporary sandbox used only to fetch an owned repository through the Worker, prepare the seed tree, and stream the seed archive. The builder is destroyed and permanently retired after seed creation. It receives no model access and no project environment values.

### Project workspace

The live project files available to Ditto. On the legacy path, the workspace contains the primary repository checkout and the worktrees owned by workspace sessions.

### Project sandbox

The legacy runtime that hosts one shared project workspace. All workspace sessions in a project currently share the project sandbox while using separate Git worktrees. New imports do not create a project sandbox.

### Project backup

A recoverable snapshot of a project workspace. A backup restores work after the live workspace stops. It is not a live workspace and does not replace durable product records. Legacy projects may still own project backups.

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

A user's conversation and line of work within one project. A workspace session owns one chat thread, one branch, and one runtime. On the new path that runtime is a dedicated sandbox whose `/workspace` checkout holds the session branch. Legacy sessions may still share a project sandbox and use Git worktrees until that path is removed. An archived workspace session remains part of history but cannot receive new work.

Use "workspace session" in full. "Session" alone is ambiguous because Ditto also has auth sessions and agent runtime sessions.

### Message

A user or assistant entry in a workspace session. An assistant message is pending while its agent run is active, then becomes complete or failed.

### Agent run

One active execution of the coding agent for a workspace session. An agent run can contain an initial turn and queued follow-up turns. Stop ends the active run cooperatively.

### Agent event

A structured update produced during an agent run. Agent events describe text, tool activity, turn boundaries, control readiness, errors, and completion.

### Session preview

A temporary public view of the application running from one workspace session. The preview belongs to that session's checkout and does not publish the project.

## Models and credentials

### Provider credential

Leftover D1 records in `ai_provider_credentials`. Account-provider connections are not a current product feature. These rows are pending removal.

### Provider model catalog

Leftover catalog JSON stored beside those credential rows. Not a current product feature; pending removal.

### Thinking level

A request for how much reasoning the fixed model should apply. Ditto supports `off`, `high`, and `max`.

## Git work

### Session branch

The Git branch owned by a workspace session. Ditto creates the branch from the project's base branch and uses it for commits and GitHub export.

### Git export

The flow that turns session work into a commit, pushed branch, and optional pull request. UI actions and agent tools use the same ownership and secret policies.

## Relationships

```text
User
└── Project
    ├── Project seed (new imports; immutable)
    ├── Project sandbox (legacy shared runtime)
    │   └── Project workspace
    │       ├── Primary repository checkout
    │       └── Workspace session worktrees
    ├── Project backup (legacy)
    └── Workspace session
        ├── Messages
        ├── Agent runs
        ├── Session branch
        ├── Session sandbox (`/workspace` checkout) or legacy worktree
        └── Session preview
```
