# Agent harness architecture

Status: target architecture. Implementation and validation pending. Requirements live in [trusted-session-runtime.md](../specs/trusted-session-runtime.md). Running code still uses the one-sandbox harness until cutover.

## Runtime ownership

Each workspace session owns a trusted session runtime, a trusted brain identity, an execution sandbox identity, and one `/workspace` Git checkout. Sessions do not share filesystems, process tables, localhost namespaces, or dependency directories. Checkout paths are code-owned and not persisted.

The product command interface is the only application entry for prompts, follow-ups, Stop, queue cancellation, and explicit recovery. Git, preview, archive, and destruction route through the same coordinator ownership. The product Worker returns a receipt and does not await the run.

## Agent sequence

1. The browser posts a command with an idempotency key and optional thinking level.
2. The product Worker authenticates, validates `off`, `high`, or `max`, and asks the runtime service whether `OPENCODE_API_KEY` is configured. Missing configuration fails before side effects.
3. Admission stores the command, complete user message, pending assistant, and delivery intent in D1, then returns a receipt.
4. A dispatcher delivers the same command IDs to `SessionRuntime`. A lost acknowledgment must not start another run.
5. The coordinator reserves capacity, opens `model` and `ditto_action` windows only when it admits execution, and starts or notifies Pi in the trusted Node container.
6. Pi loads image-owned extensions only. All filesystem and shell tools execute in the execution sandbox. Project environment values enter authorized execution commands only.
7. OpenCode requests use the public placeholder. The runtime Worker validates the contract and attaches the real key on a reconstructed request.
8. The coordinator assigns monotonic event sequence numbers. The product Worker redacts text, structured tool payloads, stderr, and persisted output before the browser sees them.
9. Every started assistant settles to `complete` or `failed`. Terminal D1 projection retries independently of the browser.
10. The coordinator publishes a paired checkpoint at a quiescent run or mutating Git boundary. Checkpoint failure does not rewrite a successful assistant.

Follow-up and Stop are durable commands. Browser disconnect detaches event delivery and does not cancel execution. Stop uses a priority path, advances the run epoch, and stays visibly stopping until old execution is accounted for.

## Model broker

Pi accepts only `opencode/deepseek-v4-flash-free`. It never reads a real model credential. The placeholder has no authority by itself.

For every intercepted OpenCode request, the runtime Worker validates current identity, lifecycle generation, run epoch, sole open model operation, placeholder, method, host, path, headers, bounded body schema, exact model, and contract version. It constructs a fresh upstream request with the real key and streams the response. Three contract denials close the operation and mark the workspace session for review.

Git metadata drafting uses a separate in-memory Pi session in the trusted runtime, empty resource discovery, one typed output tool, a bounded redacted diff snapshot, and one-request model authority.

## Git

Workspace bootstrap and sync use brokered Git smart HTTP from the execution sandbox. The network child has a closed, credential-free environment, disabled hooks and credential helpers, fixed CA trust, disabled redirects, and a public GitHub URL.

The runtime Worker validates the contract. The product Worker re-checks D1, mints a repository-scoped installation token, fetches GitHub, and streams the response back. The token never enters the runtime Worker.

Local Git reads and mutations run under coordinator serialization at `/workspace`. UI and agent paths share branch ownership and secret preflight. Product push remains disabled until a crafted non-fast-forward receive-pack test proves rejection. Pull-request creation remains in the product Worker through Octokit.

## Recovery and archive transport

A usable checkpoint pairs an immutable workspace archive with an immutable Pi continuation snapshot and execution position. The coordinator is authoritative for whether a pair is committed. D1 current and previous pointers are projections of that pair.

Restore tries current, then previous. Both failures preserve evidence and block execution. A mutated workspace never silently falls back to its project seed.

The image-owned archive CLI writes one fixed temporary file. The runtime Worker streams it to the R2 binding with byte-count and digest checks. No stock backup API, signed URL, object key, R2 credential, or bucket mount enters either container.

If Pi dies while the execution sandbox remains live, the coordinator reconstructs Pi without repeating completed tools. An unknown shell outcome halts automatic execution.

## Preview, archive, and deletion

Preview runs one code-owned Vite, Next, or Astro command on port `10000` in the execution sandbox. Preview processes receive no project values. The preview host hits the product Worker and service-binds to the runtime Worker. A live preview defers recovery for at most ten minutes.

At that deadline, stop preview and new mutating admission. Wait only if the in-flight tool is a read or a structured write with an expected-content check. An arbitrary shell or unknown effect aborts, records unknown, skips the checkpoint, and blocks the workspace session for review.

Archiving stops or isolates agent execution, requires a final committed paired checkpoint, revokes preview, retires both identities, and keeps recovery. Continuing archived work creates a new workspace session, branch, identities, and checkpoint lineage.

Project deletion changes the project to `deleting`, retires all identities including the trusted brain, cancels work, revokes previews, destroys both runtimes, marks archives for retryable deletion, and then removes product rows. Identity tombstones remain permanent.

## Builders

A project-seed builder is a `Sandbox` on the runtime Worker with no brain. Product seed orchestration calls the runtime service. A short-lived RPC opens `git_transport`, fetches the owned repository, streams the seed, and retires the identity. Builders share the execution capacity pool.
