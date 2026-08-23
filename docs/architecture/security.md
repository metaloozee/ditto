# Security and trust boundaries

## Trust model

Everything inside a sandbox is untrusted. This includes the repository, dependencies, PI, the Ditto runner and extension, build scripts, tools, process environment, and filesystem. The Worker, D1, R2 binding, and Cloudflare isolation boundary remain trusted.

The Worker enforces authentication, ownership, credential minting, outbound contracts, archive metadata, and terminal message state. Browser input, model output, sandbox errors, and preview URLs are not authority.

## Sandbox authority and egress

Each builder or workspace runtime has a permanent D1 identity with a random sandbox ID, trusted container ID, owners, lifecycle generation, and retirement state. Privileged operations open in one of three families: `model`, `git_transport`, or `ditto_action`. An identity can have at most one open operation per family.

The Sandbox class disables default internet access. Each runtime attaches the Worker-owned `dittoCatchAll` handler parameters. The sandbox cannot choose its identity, generation, or operation ID.

`SandboxEgressBroker` classifies each HTTP or HTTPS request. A failed privileged contract never falls through to public internet. General internet access permits only credential-free public HTTP and HTTPS destinations and rejects private, loopback, link-local, metadata, literal-IP, embedded-credential, and ambiguous hosts. This policy does not prevent all exfiltration or DNS channels.

## Platform credentials

- `OPENCODE_API_KEY` stays in the Worker and is added only to a fresh request after the fixed OpenCode contract passes.
- GitHub installation tokens stay in the Worker and are added only to approved Git smart-HTTP requests.
- Agent Git actions use a fixed synthetic origin with D1 authority, not a callback URL or JWT.
- R2 access uses the Worker binding. Sandboxes receive no R2 key, signed URL, object key, bearer capability, or mounted bucket.
- Provider credentials, catalogs, login attempts, routes, runner commands, and encryption binding are absent.

There is no credential fallback into a sandbox when a broker contract fails.

## Project environment values

Project environment values are AES-256-GCM encrypted at rest using a key derived from `BETTER_AUTH_SECRET`. The UI lists keys but never reads values back.

The Worker decrypts values only for the agent shell. Builders, Git children, previews, archive commands, restore commands, control sessions, and the container entrypoint do not receive them. The agent can still read and exfiltrate these user-owned values, so output redaction and Git secret preflight remain required.

## PI resources

Normal chat constructs an explicit locked resource loader. It disables repository-owned extensions, skills, prompt templates, themes, settings, and context-file discovery, then loads only the image-owned Ditto extension. Git metadata uses an empty resource loader and one typed output tool.

Prompts and follow-ups travel in bounded JSON job files, never shell interpolation. Run-scoped sockets, jobs, and shell sessions are removed after use. Session mutations use an atomic lock under `/tmp`, outside recovery archives.

## Output and Git redaction

`secret-redaction.ts` removes known project values and recognized GitHub, provider-key, AWS-key, and PEM shapes from streamed text, tool payloads, stderr, errors, and persisted assistant content. Streaming redaction handles values split across chunks with bounded buffering.

Git export fails closed on secret-like paths, binary or unreadable additions, known project values, recognized secret shapes, malformed output, or unresolved ranges. The local commit remains available; only export is blocked.

## Recovery

Archive content is untrusted. The Worker verifies format, compatibility, byte count, digest, generation, extracted size, Git state, and runner health. Current/previous fallback never silently restores the immutable seed after session mutations.

Archive object keys and content never enter user-visible errors or logs. Failed R2 deletion persists retry metadata. Identity tombstones survive project deletion and fail closed while cleanup remains pending.

## Preview capabilities

A preview URL is a public bearer capability. Ditto returns it only from the authenticated start mutation and does not persist, toast, copy, normalize, or log it. Stop, archive, and project deletion revoke forwarding. Preview processes run fixed commands at port `10000` without project environment values.

## Deletion order

Project deletion first changes the project to `deleting` and retires identity authority. It then closes operations, cancels work, revokes previews, destroys sandboxes, marks archives for cleanup, and deletes product rows. New runtime and privileged requests fail after the first authority step.

## Remaining production gate

Local tests cover identity and contract rejection, token-free archives, session isolation, queue state, preview recovery, and deletion order. Paid-plan production tests have not run. Production use remains blocked until HTTPS interception, Git transport, RPC archive streaming, sleep/restore, capacity, and preview routing pass in Cloudflare production.
