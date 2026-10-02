# Server and data architecture

Status: target architecture. Implementation and validation pending. Requirements live in [trusted-session-runtime.md](../specs/trusted-session-runtime.md). Running code still uses the one-sandbox harness until cutover.

## Two Worker services

Alchemy owns both deployments.

The product Worker authenticates browser requests, checks ownership, stores durable command admission, enforces global capacity policy, issues GitHub installation tokens, and is the public preview origin. It never drives an agent loop, waits for a run to finish, or talks to a container except through the runtime service. It binds D1, authentication secrets, GitHub App and OAuth secrets, and a service binding to the runtime Worker. It must not bind `OPENCODE_API_KEY`, the runtime-state encryption key, `SessionRuntime`, or `Sandbox`.

The runtime Worker owns `SessionRuntime` and `Sandbox`. It binds D1, R2, `OPENCODE_API_KEY`, and the runtime-state encryption key. It must not bind the GitHub App private key, GitHub OAuth secrets, or authentication secrets. Admission on the product Worker asks this service whether the model key is configured and does not receive the key.

Service bindings are bidirectional. Product delivers commands, proxies preview, starts seed jobs, and pings model-key configuration. Runtime sends reconstructed git requests for product mint-and-fetch. The installation token never enters the runtime Worker.

Browser entry points stay on the product Worker: better-auth, tRPC, command admission, event subscription, and agent control. Agent Git tools use `http://ditto.internal/v1/git-action`; there is no public callback route or callback JWT. Neither an SSE handler nor `waitUntil` owns a run.

## Domain modules

Policy remains in `apps/web/src/lib`. After cutover those modules sit behind the command boundary instead of competing for the active run.

- `sandbox-authority.ts` owns identity registration, generation rotation, operation windows, retirement, and fail-closed resolution. The coordinator opens windows at execution admission.
- `sandbox-egress-broker.ts` classifies outbound requests. OpenCode attach runs on the runtime Worker. Git mint-and-fetch runs on the product Worker after the runtime Worker validates the contract.
- `project-seed.ts` provisions temporary builders and immutable seeds through the runtime service. Builders have no `SessionRuntime`.
- Workspace runtime, recovery, archive, Git, and preview participate in coordinator serialization. Observational reads must not wake containers.

Routes orchestrate. They do not accept raw sandbox IDs, lifecycle generations, or archive object keys from browser input.

## Durable state

### D1, both Workers

| Table | Purpose | Writer |
|---|---|---|
| `user`, `session`, `account`, `verification` | better-auth identity, OAuth, and login state | Product |
| `projects` | Owned repository metadata, encrypted environment values, and project lifecycle | Product |
| `project_seeds` | One immutable seed record per project | Product |
| `workspace_sessions` | Conversation, branch/base commit, identities, lifecycle, preview intent, and status | Product admits; runtime projects execution fields |
| `messages` | User messages and assistant projections | Product admits; runtime projects terminal assistant state |
| `sandbox_identities` | Permanent builder, execution-sandbox, and trusted-brain tombstones | Product registers and retires |
| `privileged_operations` | Model, Git, and Ditto-action windows | Runtime coordinator at execution admission |
| `archives` | Opaque archive metadata and retryable cleanup | Runtime projects after coordinator commit |
| `workspace_session_recoveries` | Mutation generation and current/previous pair pointers | Runtime projects after coordinator commit |
| `workspace_runtime_work` | Durable command delivery | Product admits; dispatcher retries |
| `workspace_capacity_leases` | Unexpired brain and execution running slots | Product reserves; runtime observes liveness |

A project row has no sandbox or mutable backup columns. `/workspace` and port `10000` are code-owned runtime constants. D1 must not independently advance an accepted run because a dispatcher lease expired.

### SessionRuntime SQLite

Authoritative for consumed commands, run epochs and states, the effect journal, Pi continuation or encrypted references, committed paired checkpoints, the event sequence, and pending D1 projections. The coordinator commits terminal execution state and a pending D1 update in one local transaction. A retryable projector updates matching message and command rows idempotently.

### R2

Immutable workspace archives and encrypted large runtime records. Bytes travel between fixed sandbox paths and the runtime Worker binding. Containers receive no R2 capability.

### Container disks

Live workspace files or reconstructible Pi working files. Never the only copy of accepted commands or Pi continuation state.

No transaction spans D1, DO SQLite, R2, and an external effect.

## Lifecycle

Project status is `provisioning`, `ready`, `failed`, or `deleting`. The `deleting` status blocks new work while authority and storage cleanup run.

Workspace-session product status is `active` or `archived`. Brain and execution identity state are separate. Assistant messages move from `pending` to `complete` or `failed`. The initial user message, pending assistant, and delivery intent are durable before capacity or provisioning starts.

Agent runs use queued, starting, running, recovering, stopping, complete, failed, and canceled. Recovering and stopping are observable and not success.

## Historical cutover migration

Migration `0019_needy_squadron_sinister.sql` is a pre-launch local reset. It must not be repeated as production project deletion or as the trusted-runtime cutover. That cutover is non-destructive and is not authorized by documentation acceptance.

## Configuration

`alchemy.run.ts` must define both Worker services, both container images, shared D1, shared R2, and the bindings above. It must not put `OPENCODE_API_KEY` on the product Worker or the GitHub App private key on the runtime Worker. Neither container image receives a deployment secret or storage credential.
