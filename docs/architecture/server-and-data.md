# Server and data architecture

## Worker authority

The Cloudflare Worker is Ditto's control plane. It authenticates browser requests, checks ownership, stores durable product state, coordinates session runtimes, and is the only issuer of GitHub installation tokens. Alchemy owns deployment.

`apps/web/src/server.ts` exports Ditto's Sandbox subclass with HTTPS interception, `enableInternet = false`, and ten-minute sleep. Every builder and workspace runtime attaches `dittoCatchAll` with Worker-owned identity parameters. The handler classifies privileged contracts before applying the credential-free public internet policy. `scheduled()` drains durable runtime work and archive cleanup.

Browser entry points are better-auth, tRPC, agent SSE, and agent control. Agent Git tools use `http://ditto.internal/v1/git-action`; there is no public callback route or callback JWT.

## Domain modules

- `sandbox-authority.ts` owns identity registration, generation rotation, operation windows, retirement, and fail-closed resolution.
- `sandbox-egress-broker.ts` classifies outbound requests and dispatches OpenCode, Git, Ditto-action, or public-internet contracts.
- `project-seed.ts` provisions temporary builders and immutable seeds.
- `workspace-runtime.ts` owns session runtime readiness, restore, leases, capacity work, and retirement.
- `workspace-recovery.ts` owns mutation generations, checkpoint promotion, fallback restore, and recovery health.
- `sandbox-archive.ts` owns R2 object keys and streamed archive create, restore, and cleanup.
- `agent-run-service.ts` owns message persistence, model operation windows, terminal settlement, and recovery checkpointing.
- `session-git.ts` owns Git state and export policy. Workspace sync opens a brokered Git-fetch operation.
- `session-preview.ts` owns fixed-port preview process lifecycle, archive, and project deletion cleanup.

Routes orchestrate these modules. They do not accept raw sandbox IDs, lifecycle generations, or archive object keys from browser input.

## Current schema

### Product and auth

| Table | Purpose |
|---|---|
| `user`, `session`, `account`, `verification` | better-auth identity, OAuth, and login state |
| `projects` | Owned repository metadata, encrypted environment values, and project lifecycle |
| `project_seeds` | One immutable seed record per project |
| `workspace_sessions` | Conversation, branch/base commit, runtime identity, lifecycle lease, preview intent, and status |
| `messages` | User and terminally settled assistant history |

A project row has no sandbox, mutable backup, generation, preview-lock, or deletion timestamp columns. A workspace-session row has no checkout path, memory path, worktree path, or preview-port column. `/workspace` and port `10000` are code-owned runtime constants.

### Runtime authority and recovery

| Table | Purpose |
|---|---|
| `sandbox_identities` | Permanent builder and workspace-session identity tombstones |
| `privileged_operations` | Current and historical model, Git, and Ditto-action windows |
| `archives` | Opaque archive metadata and retryable cleanup state |
| `workspace_session_recoveries` | Session mutation and current/previous archive lineage |
| `workspace_runtime_work` | Durable serializable FIFO work |
| `workspace_capacity_leases` | Unexpired global/per-user running slots |

Archive owners are only `project_seed` and `workspace_recovery`. Provider credential and provider-login tables are gone.

## Lifecycle

Project status is `provisioning`, `ready`, `failed`, or `deleting`. The `deleting` status blocks new work while authority and storage cleanup run.

Workspace-session product status is `active` or `archived`. Runtime identity state is separate: `unprovisioned`, `queued`, `provisioning`, `restoring`, `ready`, `failed`, `destroying`, or `destroyed`. Each transition uses D1 leases and generation checks.

Assistant messages move from `pending` to `complete` or `failed`. The initial user message, pending assistant, and runtime work record are durable before capacity or provisioning starts.

## Cutover migration

Migration `0019_needy_squadron_sinister.sql` is an explicit pre-launch local reset. It:

1. closes open operations and permanently retires active identities;
2. marks retained archive rows for cleanup;
3. deletes provider rows, queued work, messages, recovery rows, workspace sessions, project seeds, and projects in dependency order;
4. drops provider tables and obsolete project/workspace columns.

It preserves auth tables and rows, identity tombstones, operation definitions, archive cleanup rows, and every final seed, runtime, recovery, queue, and authority table definition. Never use this reset as the production project-deletion path.

## Configuration

`alchemy.run.ts` binds D1, one R2 bucket, the Sandbox container, auth/GitHub configuration, `OPENCODE_API_KEY`, RPC transport, and the preview host. It does not bind provider-credential encryption or R2 access keys. The sandbox receives no deployment secret or storage credential.
