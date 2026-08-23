# Agent harness architecture

## Runtime ownership

Each workspace session owns one Cloudflare Sandbox identity and one `/workspace` Git checkout. Sessions do not share filesystems, process tables, localhost namespaces, or dependency directories. The session row stores its branch, frozen base commit, sandbox identity, lifecycle lease, and recovery state relationship. Checkout paths are code-owned and not persisted.

`WorkspaceRuntime` is the only application interface for runtime access. Callers provide owned user, project, session, and purpose identifiers. The module validates ownership and lifecycle, acquires capacity, restores when needed, attaches the outbound broker, and returns a narrow lease. Agent commands receive project environment values; control, Git, preview, backup, and restore leases do not.

## Agent sequence

1. The browser posts a prompt and optional thinking level to `/api/agent/stream`.
2. The Worker authenticates the cookie, validates `off`, `high`, or `max`, and checks that `OPENCODE_API_KEY` exists before project, session, message, or runtime side effects.
3. The user message, pending assistant, and durable runtime work row are inserted before provisioning or queueing.
4. `WorkspaceRuntime` creates or restores the session sandbox from the project seed or current/previous session recovery archive.
5. The Worker opens `model/agent_run` and `ditto_action/agent_git` operation windows.
6. `agent-run.ts` creates a sandbox shell at `/workspace`, injects only project environment values and Git author identity, writes a bounded job file, and starts the baked runner.
7. The runner validates the fixed model and job, creates an in-memory public OpenCode placeholder, and loads only `/opt/ditto-runner/dist/ditto-extension.js`. Repository extensions, skills, prompts, themes, settings, and context discovery stay disabled.
8. PI events cross versioned NDJSON, then SSE. The Worker redacts text, structured tool payloads, stderr, and persistence output.
9. Every started assistant settles to `complete` or `failed`.
10. The session records a mutation generation and checkpoints through `WorkspaceRecovery` under an exclusive lease. Checkpoint failure does not rewrite a successful assistant.

Follow-up and Stop use a separate authenticated control route and the run-scoped Unix socket. Browser disconnect detaches stream delivery but does not cancel execution. Only authenticated Stop clears queued PI turns and requests cooperative abort.

## Model broker

The runner accepts only `opencode/deepseek-v4-flash-free`. It never reads a real model credential. PI's placeholder has no authority by itself.

For every intercepted OpenCode request, the Worker validates current identity, lifecycle generation, sole open model operation, placeholder, method, host, path, headers, bounded body schema, exact model, and contract version. It constructs a fresh upstream request with the real key and streams the response. Three contract denials close the operation and mark the workspace session for review.

## Git

Workspace bootstrap and sync use brokered Git smart HTTP. The network child has a closed, credential-free environment, disabled hooks and credential helpers, fixed CA trust, disabled redirects, and a public GitHub URL. The Worker adds installation auth only after the exact Git contract passes.

Local Git reads and mutations run under the session lock at `/workspace`. UI and agent paths share branch ownership and secret preflight. Product push remains disabled until a crafted non-fast-forward receive-pack test proves rejection. Pull-request creation remains in the Worker through Octokit.

Git metadata drafting uses a separate in-memory PI session, empty resource discovery, one typed output tool, a bounded redacted diff snapshot, and one-request model authority. It receives no project environment values or platform credentials.

## Recovery and archive transport

`WorkspaceRecovery` owns monotonically increasing mutation generations and current/previous archives. Checkpoint promotion uses compare-and-set fencing. Restore tries current and then previous; failure preserves both for diagnosis.

The image-owned archive CLI writes one fixed temporary file. The Worker streams it over Sandbox RPC to the R2 binding with byte-count and digest checks. Restore reverses that stream and validates metadata, extracted size, Git state, and the baked runner. No stock Sandbox backup API, signed URL, object key, R2 credential, or bucket mount enters the container.

## Preview, archive, and deletion

Preview runs one code-owned Vite, Next, or Astro command on port `10000`. Preview processes receive no project values. A live preview defers recovery for at most ten minutes; Stop saves pending mutations before completion.

Archiving stops preview, performs the final pending checkpoint, requires durable recovery, retires and destroys the session runtime, and keeps the recovery lineage. Continuing archived work creates a new session identity, branch, and recovery lineage.

Project deletion changes the project to `deleting`, retires all identities before cleanup, cancels runtime work, revokes previews, destroys runtimes, marks archives for retryable deletion, and then removes product rows. Identity tombstones remain permanent.
