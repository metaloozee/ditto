# Security and trust boundaries

Status: target architecture. Implementation and validation pending. Requirements live in [trusted-session-runtime.md](../specs/trusted-session-runtime.md). Running code still uses the one-sandbox harness until cutover.

## Trust model

Neither container receives platform credentials. The execution sandbox is untrusted: repository, dependencies, build scripts, tools, process environment, and filesystem. The trusted brain is isolated from repository execution and still untrusted for secrets: Pi, image-owned extensions, continuation working files, and model input.

The product Worker authenticates, admits commands, and is the only issuer of GitHub installation tokens. The runtime Worker owns both Container classes, OpenCode attach, archive I/O, and runtime-state encryption. Browser input, model output, container errors, and preview URLs are not authority.

## Identity and egress

Permanent D1 identities distinguish builders, execution sandboxes, and trusted brains. Each record has a random ID, container ID, owners, lifecycle generation, and retirement state. Privileged operations open in one of three families: `model`, `git_transport`, or `ditto_action`. An identity can have at most one open operation per family. The coordinator opens those D1 windows when it admits execution. Queued HTTP admission is not a window. A container cannot invent or extend one.

Both Container classes disable default internet except through Worker-owned intercept. The handler receives platform container identity, not a request-supplied workspace ID. A synthetic hostname is not authentication.

The egress broker classifies each HTTP or HTTPS request. A failed privileged contract never falls through to public internet. General internet access, on the execution sandbox only, permits credential-free public HTTP and HTTPS and rejects private, loopback, link-local, metadata, literal-IP, embedded-credential, and ambiguous hosts. This policy does not prevent all exfiltration or DNS channels.

The trusted brain has a deny-by-default outbound policy limited to the internal coordinator transport and approved brokered operations. It has no model-controlled general network.

## Platform credentials

- `OPENCODE_API_KEY` binds only on the runtime Worker. The product Worker asks whether it is configured and never receives the key. The runtime Worker adds it only to a fresh OpenCode request after the fixed contract passes.
- `GITHUB_APP_PRIVATE_KEY` binds only on the product Worker. Installation tokens are minted there, attached there, and used for the upstream GitHub fetch there. They must not enter the runtime Worker or either container.
- Agent Git tools use a fixed synthetic origin with D1 authority, not a callback URL or JWT.
- R2 access uses the runtime Worker binding. Containers receive no R2 key, signed URL, object key, bearer capability, or mounted bucket.
- The runtime-state encryption key binds only on the runtime Worker. Canonical continuation content is encrypted before coordinator SQLite or R2.
- Authentication and GitHub OAuth secrets bind only on the product Worker.

There is no credential fallback into a container when a broker contract fails.

## Project environment values

Project environment values are AES-256-GCM encrypted at rest using a key derived from `BETTER_AUTH_SECRET`. The UI lists keys but never reads values back.

The product Worker decrypts values only for authorized repository execution commands. Builders, Git children, previews, archive commands, restore commands, control sessions, the trusted brain launch environment, and container entrypoints do not receive them. The agent can still read and exfiltrate these user-owned values through execution tools, so output redaction and Git secret preflight remain required.

## Pi resources

The trusted image contains pinned Pi and Ditto-owned extensions. It does not clone or mount the repository or load repository extensions, skills, prompt templates, themes, settings, or context files.

All model-callable read, write, edit, bash, grep, find, and list operations execute in the execution sandbox. A failed remote call never falls back to trusted-host execution. Git metadata uses an empty resource loader and one typed output tool.

Prompts and follow-ups travel as durable commands, never shell interpolation.

## Output and Git redaction

`secret-redaction.ts` removes known project values and recognized GitHub, provider-key, AWS-key, and PEM shapes from streamed text, tool payloads, stderr, errors, and persisted assistant content. Streaming redaction handles values split across chunks with bounded buffering.

Git export fails closed on secret-like paths, binary or unreadable additions, known project values, recognized secret shapes, malformed output, or unresolved ranges. The local commit remains available; only export is blocked.

## Recovery

Archive content is untrusted. The runtime Worker verifies format, compatibility, byte count, digest, generation, extracted size, Git state, and adapter health. Current/previous fallback never silently restores the immutable seed after session mutations. Restore always takes a paired checkpoint: filesystem plus Pi continuation.

Archive object keys and content never enter user-visible errors or logs. Failed R2 deletion persists retry metadata. Identity tombstones survive project deletion and fail closed while cleanup remains pending.

If an arbitrary shell is in flight when a preview checkpoint deadline fires, the outcome is unknown. The run fails, no checkpoint is taken, and the workspace session blocks for review.

## Preview capabilities

A preview URL is a public bearer capability. Ditto returns it only from the authenticated start mutation and does not persist, toast, copy, normalize, or log it. The preview host hits the product Worker, which revokes on stop, archive, or deletion and proxies through the runtime service. Preview processes run fixed commands at port `10000` without project environment values.

## Deletion order

Project deletion first changes the project to `deleting` and retires identity authority, including the trusted brain. It then closes operations, cancels work, revokes previews, destroys both runtimes, marks archives for cleanup, and deletes product rows. New runtime and privileged requests fail after the first authority step.

## Remaining production gate

Local tests cannot prove two-container isolation, outbound interception, or restart behavior. Paid-plan production tests have not run. Production use remains blocked until those gates pass. A failed gate stops cutover. It does not put Pi back in the execution sandbox or into workerd.
