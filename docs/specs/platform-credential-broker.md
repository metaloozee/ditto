# Platform credential broker and session sandbox isolation

Status: needs revision; implementation gated

Last implementation audit: 2026-08-20 at `57a29d5`

Background research:

- `docs/research/brain-architecture-research.md`
- `docs/research/sandbox-security-architecture-research.md`

## Why this spec is gated

The original design predates account-level provider connections. It defines a broker only for the OpenCode fallback model, while Ditto now supports credentials from multiple providers.

Do not implement this spec until a revision defines how every supported provider credential crosses the container boundary. The OpenCode certificate spike also remains incomplete.

## Current implementation

The application has one project sandbox per project. Workspace sessions use separate Git worktrees inside that shared sandbox.

The Worker passes three credential classes into project-sandbox processes:

- `DITTO_PI_CREDENTIAL` for the selected model provider
- `DITTO_GIT_CALLBACK_TOKEN` for agent Git actions
- a GitHub installation token for a short-lived network Git launcher

The runner deletes provider values from its own environment before PI creates tools. The Git launcher uses a temporary bare repository, a closed environment, disabled hooks, and disabled credential helpers. These controls reduce exposure but do not protect credentials from a compromised container.

Normal chat sessions do not pass an explicit PI resource loader. PI therefore uses its default project discovery. The separate Git metadata runner already uses an empty resource loader and has no repository tools.

Project rows own sandbox identity, backup handles, and backup generations. Workspace sessions do not own a sandbox or a backup.

## Implementation audit

| Design area | Status | Evidence |
|---|---|---|
| Ditto-owned Sandbox subclass | Not implemented | `apps/web/src/server.ts` re-exports the stock `Sandbox` class. |
| Outbound credential dispatch | Not implemented | No outbound handler resolves a container identity or replaces placeholder credentials. |
| Model credential removal from the container | Not implemented | `apps/web/src/lib/agent-run.ts` passes `DITTO_PI_CREDENTIAL` into the agent shell. |
| Token-free agent Git capability | Not implemented | Agent tools call `/api/agent/git` with a scoped HS256 JWT. |
| GitHub installation-token removal | Not implemented | `apps/web/src/lib/privileged-git.ts` passes the token to a sandbox process. |
| Deny-by-default outbound policy | Not implemented | The stock project sandbox retains normal network access. |
| One sandbox per workspace session | Not implemented | `projects.sandboxId` owns the sandbox. |
| Safe chat resource loader | Not implemented | `packages/sandbox-runner/src/run-agent.ts` omits `resourceLoader`. |
| Session-owned backups | Not implemented | Backup fields and generation counters live on `projects`. |
| Capacity queue and idle sleep | Not implemented | Ditto has no persisted session-sandbox state machine. |

## Supporting controls already implemented

The following work should remain during a future redesign:

- Account provider credentials are encrypted with user and provider associated data.
- Safe model catalogs contain bounded model metadata without credential headers or endpoints.
- OAuth refresh uses a lease and compare-and-swap version.
- Runtime credential projection removes OAuth refresh data and checks access-token expiry.
- Session worktrees isolate normal file edits and Git branches.
- Session write locks serialize agent runs and mutating Git operations.
- Project backups use generation fencing so an older completion cannot replace a newer backup.
- Agent output and errors pass through bounded secret redaction.
- Git export checks outgoing paths and added content before it mints a token.
- Network Git uses a temporary bare repository and a closed child environment.
- Git metadata generation uses an in-memory PI session, an empty resource loader, and one typed output tool.

## Required outcome

A revised design must provide these guarantees:

1. No model provider credential enters a project or session sandbox.
2. No Git callback bearer token enters a project or session sandbox.
3. No GitHub installation token enters a project or session sandbox.
4. Every brokered request resolves to a current user, project, workspace session, and sandbox identity.
5. Unknown identities and unknown request contracts fail closed.
6. Each active workspace session has a separate filesystem, process table, and localhost namespace.
7. Normal chat disables repository-owned PI extensions, skills, prompts, and context-file discovery.
8. Outbound HTTP and HTTPS access follows explicit request contracts.
9. Backup and restore remain reliable after sandbox ownership moves to the workspace session.
10. Existing Git, preview, provider, and message behavior remains available unless a revision explicitly changes it.

The design may prevent credential extraction without preventing credential use. If a user can run arbitrary commands inside a brokered sandbox, the broker needs metering and budgets to limit authorized requests from that sandbox identity.

## Proposed direction

The original proposal uses a Ditto-owned Sandbox subclass with outbound request handlers:

- Model requests carry a fixed non-secret placeholder. The Worker replaces the placeholder only after it resolves the container identity and validates the request contract.
- Agent Git tools call a synthetic internal origin. The Worker resolves identity from the calling container and invokes the existing Git domain services.
- Network Git uses a placeholder credential. The Worker injects the real installation token only into the approved upstream request.
- All other outbound requests are refused unless an explicit contract allows them.

Each workspace session receives a stable sandbox identity and owns its backup state. The session sandbox replaces worktrees as the isolation boundary between concurrent sessions.

This direction is not yet an implementation decision. The open questions below can change it.

## Decisions required before implementation

### Provider coverage

Define the request contract for every provider that Account Settings can connect. If a provider cannot use outbound interception safely, decide whether to disable that provider in the hardened sandbox or choose another transport.

### HTTPS interception spike

Prove the real PI to `undici` request path against OpenCode Zen:

- HTTPS interception succeeds without disabling certificate verification.
- Streaming responses complete.
- The placeholder appears only in the container-side request.
- The real credential appears only in the upstream request.
- Unknown hosts, paths, methods, and container identities fail closed.

Passing the OpenCode spike does not prove support for other providers.

### Git transport

Prove that outbound handlers can cover the Git smart-HTTP requests used by fetch and push. Keep pull-request creation in the Worker through Octokit.

### Session lifecycle and capacity

Define persisted states for provisioning, readiness, sleep, restore, failure, and destruction. Define the maximum number of active sandboxes and the behavior when capacity is full.

### Backup ownership and migration

Move backup identity and generation fencing from projects to workspace sessions. Define how an existing project creates its first session sandbox and what happens to the old project backup.

### Preview routing

Preserve one preview process and one public capability URL per workspace session. Confirm that preview routing still resolves the correct session sandbox after ownership changes.

### Observability

Record denied outbound requests without recording headers, bodies, query strings, credentials, or response content. Include only the resolved identity, request contract, decision, and correlation ID.

## Test requirements

Tests must prove absence, not only successful forwarding:

- Agent shell environments contain project values but no platform credential or Git callback credential.
- Brokered requests replace placeholders only after identity and contract validation.
- Unknown or stale sandbox identities fail closed.
- Unknown origins, paths, methods, and authorization values fail closed.
- Two workspace sessions on one project resolve to different sandboxes.
- One workspace session resolves to the same sandbox after Worker restarts.
- Chat constructs a resource loader with repository discovery disabled.
- Session backup generation fencing rejects stale completions.
- Capacity and lifecycle transitions reject invalid state changes.
- Existing agent streaming, controls, Git export, provider connections, preview, and restore tests continue to pass.

## Out of scope

This revision does not move the agent loop out of the sandbox. It does not add a browser terminal, nested virtualization, or a second trusted harness container.

Those choices may become separate designs after the credential broker and session isolation boundaries are settled.
