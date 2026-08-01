# Design: Platform hardening and maintainability program

**Date:** 2026-07-26  
**Status:** Approved umbrella specification for future planning  
**Source:** Deep repository audit at `272b950`  
**Planning model:** Generate one or more implementation plans per workstream; do not
execute this document as a single plan.

## Purpose

This specification records the security, correctness, lifecycle, and
maintainability work that should precede broader product expansion. It preserves
the reasoning, boundaries, requirements, and ordering needed to generate focused
implementation plans later without repeating the audit.

The immediate program has seven workstreams:

1. Git credential boundary
2. Detached agent execution and bounded delivery
3. Sandbox lifecycle and runner trust
4. Credential lifecycle
5. Preview isolation
6. Project environment integrity
7. Cleanup, architecture, tests, and documentation

Capacity and account-scale optimization remain visible in
[Deferred scaling work](#deferred-scaling-work), but they are not part of the
near-term program and must not block the seven workstreams above.

## Current verification baseline

At the source revision used for this specification:

- `pnpm check` passes with 32 Biome warnings, mostly non-null assertions.
- `pnpm typecheck` passes.
- The web test suite passes: 61 files and 649 tests.
- The sandbox runner typecheck passes.
- The sandbox runner test suite passes: 11 files and 81 tests.
- Runner tests require a host environment that permits Unix socket creation.
- The working tree is clean.
- A precise dependency-advisory baseline is unavailable because both package
  registry audit endpoints returned malformed compressed JSON.
- Production build, deployment, Docker runtime smoke, live GitHub/provider
  flows, and live preview isolation have not been verified by this audit.

Every future implementation plan must rerun the checks relevant to its changes
and add a focused integration or live smoke when static tests cannot prove the
boundary being changed.

## Program goals

- Keep GitHub installation credentials outside repository-controlled behavior.
- Preserve agent execution after browser disconnect without retaining an
  unbounded dead response stream.
- Make sandbox ownership, cleanup, runner integrity, and recovery explicit.
- Make credential refresh, encryption, rotation, and validation race-safe.
- Treat preview applications as hostile web origins.
- Preserve project environment values exactly and make concurrent mutations
  deterministic.
- Add tests around the boundaries that carry the most security and lifecycle
  risk.
- Reduce drift in runtime contracts, direct dependencies, component ownership,
  and architecture documentation.

## Non-goals

- Product-direction work such as start-from-scratch projects, a code inspector,
  project memory, or new workspace identity UI.
- General account-scale or performance optimization in the near-term program.
- A terminal or unrestricted task console.
- Passing project secrets into preview processes.
- Merging the independent `packages/sandbox-runner` toolchain into the pnpm
  workspace.
- Blanket major dependency upgrades.
- Changing the deliberate rule that browser navigation does not cancel an
  active agent run.
- Treating R2 backups as the live source of workspace state.
- Replacing the existing one-sandbox-per-project model.

## Program-wide invariants

These constraints apply to every later plan.

### Trust and credential invariants

- The Worker remains the only GitHub installation-token issuer.
- Repository content, Git hooks, repository-local configuration, dependency
  lifecycle scripts, agent shell commands, and preview documents are untrusted.
- A credential minted after an egress preflight must not become visible to
  untrusted code that was outside that preflight.
- Credential material must not be stored in Git remote configuration, command
  history, durable runner files, logs, previews, or workspace backups.
- Cryptographic purposes use separate keys with explicit versioning and rotation
  behavior.
- A credential refresh lease protects both the credential version that is read
  and the credential version that is written.

### Lifecycle invariants

- D1 remains authoritative for durable project, session, message, credential,
  and lease state.
- The sandbox filesystem remains authoritative for live repository and Git
  state.
- Every successfully created sandbox is either durably associated with its
  project or destroyed.
- A settled agent run leaves every known assistant message terminal:
  `complete` or `failed`.
- Browser delivery can detach independently from execution, terminal
  persistence, and post-run backup.
- Replaceable progress may be coalesced; ordered lifecycle events and terminal
  results may not be reordered or silently discarded.

### Compatibility invariants

- Existing project backups and sessions remain restorable across a rollout.
- Existing OAuth accounts receive an explicit migration or reauthentication
  path.
- Existing encrypted project environment payloads remain decryptable until they
  have been re-encrypted under a versioned replacement key.
- Preview-domain and cookie changes include a deliberate cutover strategy.
- Runner/Worker protocol changes are versioned or deployed in an order that
  prevents mixed-version failure.

## Workstream 1: Git credential boundary

### Problem

Privileged Git operations currently run inside the repository worktree. The
push path completes the secret-content preflight, mints an installation token,
and then invokes `git push` with a tokenized URL while repository-controlled
hooks and configuration are still active.

The primary-workspace synchronization path also interpolates the current branch
name unquoted into a token-bearing shell command. Git reference validation alone
does not make a reference shell-safe.

Evidence:

- [`session-git.ts`](../../../apps/web/src/lib/session-git.ts) performs the
  outgoing preflight before minting a token and pushing from the worktree.
- [`sandbox-bootstrap.ts`](../../../apps/web/src/lib/sandbox-bootstrap.ts)
  interpolates the symbolic current branch into a fetch refspec.
- [`git-secret-policy.ts`](../../../apps/web/src/lib/git-secret-policy.ts)
  inspects outgoing tracked content, not untracked hooks or local Git
  configuration.

### Requirements

#### GIT-1: Isolate privileged Git configuration

- Privileged fetch and push operations must run with a deliberately constructed
  Git configuration and environment.
- Repository-local config, conditional includes, global config, system config,
  `core.hooksPath`, credential helpers, proxy commands, alternate transports,
  and URL rewrite rules must not influence a privileged operation unless the
  application explicitly allowlists them.
- Git hooks must be disabled for privileged operations.
- Legitimate certificate and proxy requirements must be supplied through
  trusted application configuration rather than inherited repository state.

#### GIT-2: Remove credentials from remote URLs

- Installation credentials must not appear in a Git remote URL or be exposed to
  hook arguments.
- The selected authentication mechanism must keep the token ephemeral, redact it
  from command failures, and avoid persistence in repository config.
- Remote cleanup remains defense in depth, not the primary credential-removal
  mechanism.

#### GIT-3: Validate and quote refs as data

- Branch names and refspecs must be passed as data, never interpolated as
  unquoted shell syntax.
- The application must validate that a requested branch is a branch ref, while
  still handling unusual valid branch names safely.
- The same ref construction helper must serve primary synchronization, session
  synchronization, push, and pull-request base selection where applicable.

#### GIT-4: Preserve egress policy

- Commit/diff secret inspection still runs before any remote mutation.
- Git isolation must not create a second push path that bypasses
  `assertOutgoingGitRangeSafe`.
- UI Git and agent Git continue to use the same privileged domain service.

### Acceptance criteria

- A repository-provided pre-push hook does not execute during privileged push.
- A repository-local or included URL rewrite cannot redirect a privileged
  GitHub operation.
- Credential helpers and repository config cannot observe the installation
  token.
- Valid branch names containing shell-significant characters remain inert data.
- Push, sync, and pull-request tests prove credential redaction and unchanged
  egress-policy behavior.
- A live GitHub smoke confirms fetch, push, and pull-request creation with the
  selected isolated authentication mechanism.

### Planning boundary

Generate one focused plan for this workstream. It may include both the push
isolation and ref quoting because they share the same privileged Git command
boundary. Complete it before changing runner credentials or preview isolation.

## Workstream 2: Detached agent execution and bounded delivery

### Problem

Agent runs intentionally continue after browser navigation. The current SSE
route does not implement response cancellation as a delivery-only state:
`ReadableStream` cancellation can close the controller, after which later
`enqueue()` or `close()` calls throw back into the agent execution callback.

The same pipeline has no bounded backpressure:

- the runner writes every event to stdout without honoring `write()` backpressure;
- tool progress crosses the runner/Worker boundary verbatim;
- SSE delivery has no explicit detach or congestion behavior; and
- storage truncation occurs only after live transport and UI processing.

Evidence:

- [`api.agent.stream.ts`](../../../apps/web/src/routes/api.agent.stream.ts)
- [`agent-run.ts`](../../../apps/web/src/lib/agent-run.ts)
- [`agent-run-service.ts`](../../../apps/web/src/lib/agent-run-service.ts)
- [`cli.ts`](../../../packages/sandbox-runner/src/cli.ts)
- [`protocol.ts`](../../../packages/sandbox-runner/src/protocol.ts)

### Requirements

#### STREAM-1: Separate execution from browser delivery

- The response stream must have an explicit attached/detached delivery state.
- Cancelling or closing browser delivery must not throw into the agent-run
  service, stop the sandbox process, skip message finalization, or skip backup.
- After detach, the server must stop encoding and queuing browser events.
- Terminal persistence and post-run cleanup continue without an SSE consumer.

#### STREAM-2: Make stream closure idempotent

- Enqueue, close, error, and cancellation paths must tolerate races.
- Exactly one terminal response action is attempted for an attached consumer.
- Delivery failures are observable without being treated as execution failures.

#### STREAM-3: Bound both transport hops

- Runner stdout must honor Node write backpressure or use a bounded intermediary
  that cannot grow with the full run.
- Worker-side delivery must have a documented maximum pending payload or event
  count.
- Replaceable deltas and tool progress may be batched or coalesced when a
  consumer is slow.
- Start, end, error, follow-up, stop, and turn-boundary events remain ordered and
  lossless while attached.

#### STREAM-4: Project public tool events

- Define a bounded public projection for tool events before they cross the
  runner protocol boundary.
- Growing accumulated output must not be repeatedly transmitted in full.
- The final projection must retain the bounded information required by current
  tool-call and edit presentation.
- Redaction happens before any public event leaves the Worker.

### Acceptance criteria

- Cancelling an SSE reader during a run does not reject or shorten the run.
- The assistant row reaches a terminal state and backup still executes after
  disconnect.
- Tests cover disconnect during text, tool progress, queued follow-up, and
  terminal settlement.
- Slow-consumer and no-consumer tests assert fixed queue bounds.
- Tool event ordering and final edit presentation remain unchanged.
- No unhandled stream-controller exception appears in server logs.

### Planning boundary and order

Create two plans:

1. **Detached delivery correctness:** `STREAM-1` and `STREAM-2`.
2. **Bounded delivery:** `STREAM-3` and `STREAM-4`, after the detached-state
   contract is stable.

The second plan is reliability work, not deferred scale work: unbounded queues
can exhaust a run even with one user.

## Workstream 3: Sandbox lifecycle and runner trust

### Problem

A new project bootstrap creates and backs up a sandbox before D1 records the
sandbox ID. If the final project update fails, the error path marks the project
failed but cannot recover or destroy the successfully created sandbox.

Inside the sandbox image, trusted runner files and untrusted repository
workloads do not have an explicit Unix-user boundary. Repository dependency
installation runs lifecycle scripts, and the coding agent receives a
general-purpose shell. Runner health only checks selected file existence and
package JSON parsing.

The Worker also invokes `control-cli.js`, but the Docker build and runner health
contract do not verify that artifact.

Evidence:

- [`projects.ts`](../../../apps/web/src/integrations/trpc/routers/projects.ts)
- [`sandbox-bootstrap.ts`](../../../apps/web/src/lib/sandbox-bootstrap.ts)
- [`Dockerfile`](../../../Dockerfile)
- [`run-agent.ts`](../../../packages/sandbox-runner/src/run-agent.ts)
- [`agent-control-service.ts`](../../../apps/web/src/lib/agent-control-service.ts)

### Requirements

#### SANDBOX-1: Make bootstrap ownership recoverable

- Persist enough ownership state before or during bootstrap to identify and
  clean up the allocated sandbox after any later failure.
- A successful bootstrap followed by a failed D1 readiness update must destroy
  the sandbox or leave a durable, retryable reconciliation record.
- Cleanup failures must be logged with project and sandbox correlation IDs but
  without credentials.
- Retry behavior must distinguish a recoverable incomplete bootstrap from an
  unrelated sandbox.

#### SANDBOX-2: Establish a non-root workload identity

- Repository installs, preview processes, test commands, and agent shell tools
  must run as a dedicated unprivileged user.
- `/opt/ditto-runner` and its manifests must remain owned by a trusted identity
  and non-writable by the workload user.
- Only `/workspace` and narrowly required temporary/runtime directories are
  writable by the workload.
- The final deployed image must prove its runtime UID, ownership, and write
  permissions in an automated smoke.

#### SANDBOX-3: Verify runner integrity before secret-bearing runs

- The Worker must verify the complete expected runner artifact set before
  invoking agent, control, provider-auth, catalog, or Git-metadata entrypoints.
- Verification must include ownership/write protection and an image- or
  build-pinned integrity value, not file existence alone.
- An integrity mismatch fences the sandbox from credentials, destroys or
  quarantines it, and forces recovery from a trusted image.
- The check must not depend on mutable repository content.

#### SANDBOX-4: Centralize the runner contract

- One manifest or shared contract defines every Worker-invoked runner
  entrypoint.
- Docker build validation, runtime health, package exports, and Worker command
  constants derive from or test against that contract.
- `control-cli.js` receives the same build and runtime verification as the
  existing provider and main entrypoints.
- Provision success states are defined once and reused by all callers.

### Acceptance criteria

- An injected failure after bootstrap backup but before the final D1 update
  leaves no untracked live sandbox.
- Repository install scripts and agent shell commands cannot modify the runner.
- Automated image tests verify runtime UID, directory permissions, and all
  entrypoints.
- A modified runner artifact prevents credential injection and triggers the
  defined recovery path.
- Every production entrypoint is present in the package, Docker, health, and
  Worker contract tests.

### Planning boundary and order

Create three plans in this order:

1. Bootstrap ownership and orphan cleanup (`SANDBOX-1`).
2. Runtime user boundary and runner integrity (`SANDBOX-2` and `SANDBOX-3`).
3. Artifact and provision-state contract cleanup (`SANDBOX-4`).

## Workstream 4: Credential lifecycle

### Problem

OAuth refresh callers pass a stored credential and expected version before
waiting for a refresh lease. If another refresh completes during that wait, the
winner can acquire a new lease but still use the stale pre-wait credential and
version.

GitHub OAuth access, refresh, and ID tokens use Better Auth's plaintext default.
Project environment encryption and agent Git callback signing reuse
`BETTER_AUTH_SECRET`, and runtime validation does not establish strong,
purpose-specific key requirements.

Worker and runner provider-auth contracts also duplicate security-sensitive
maps, projections, and fallback behavior without a parity gate.

Evidence:

- [`agent-run-service.ts`](../../../apps/web/src/lib/agent-run-service.ts)
- [`provider-auth-service.ts`](../../../apps/web/src/lib/provider-auth-service.ts)
- [`account-provider-credentials.ts`](../../../apps/web/src/lib/account-provider-credentials.ts)
- [`auth.ts`](../../../apps/web/src/lib/auth.ts)
- [`db/schema.ts`](../../../apps/web/src/db/schema.ts)
- [`agent-git-jwt.ts`](../../../apps/web/src/lib/agent-git-jwt.ts)
- [`provider-auth.ts`](../../../packages/sandbox-runner/src/provider-auth.ts)

### Requirements

#### CRED-1: Refresh from the leased version

- Lease acquisition must return or be followed by a fresh authoritative
  credential read.
- The refresh process receives the credential version protected by its lease,
  not caller-supplied pre-wait state.
- Compare-and-set persistence uses that same version.
- A stale caller either consumes the already-refreshed credential or retries
  from fresh state; it must not replay an obsolete rotating refresh token.
- Process-death confirmation and lease-retention behavior remain unchanged.

#### CRED-2: Encrypt Better Auth OAuth tokens

- Enable Better Auth OAuth-token encryption using a documented, validated key.
- Define the behavior for existing plaintext rows: compatible read migration,
  controlled reauthentication, or an explicit one-time conversion supported by
  the selected Better Auth version.
- Do not silently interpret arbitrary plaintext as ciphertext.
- Record operational steps for token revocation if plaintext storage exposure is
  suspected.

#### CRED-3: Separate cryptographic purposes

- Authentication/session signing, project-environment encryption, provider
  credential encryption, and agent callback signing use distinct configuration
  keys.
- Each key has a minimum entropy requirement and fails deployment or Worker
  startup when absent or weak.
- Encrypted payloads and signed capabilities carry a version or key identifier
  sufficient for rotation.
- Rotation supports a bounded compatibility window and removes old-key use after
  successful migration.

#### CRED-4: Establish provider-auth contract parity

- Shared provider IDs, credential shapes, runtime projections, model capability
  projections, and fallback rules have a single machine-checkable contract or
  parity test.
- Worker policy remains authoritative; the runner accepts only the minimal
  runtime projection it needs.
- Provider prompt/hostname matching must not contain unconditional branches.
- Unknown providers, models, thinking levels, credential fields, and catalog
  payloads fail closed.

#### CRED-5: Strengthen credential-boundary tests

- Replace the vacuous provider-refresh timeout assertion with an observable
  abort and termination assertion.
- Add queued-refresh tests where a rotating refresh token changes while another
  caller waits.
- Apply the complete migration chain to a fresh SQLite database in tests.
- Exercise authenticated and unauthenticated Better Auth/tRPC/custom-route
  boundaries without mocking the authorization helper everywhere.

### Acceptance criteria

- Two concurrent refresh callers invoke the provider at most as allowed by the
  lease contract and never replay the superseded refresh token.
- Existing users have a tested transition from plaintext GitHub OAuth tokens.
- Weak, missing, or reused production keys fail validation.
- Old encrypted project-env payloads remain readable during their documented
  migration window.
- Worker/runner provider contract fixtures pass from both packages.
- Full-schema migration and HTTP authentication-boundary suites run in CI.

### Planning boundary and order

Create three plans:

1. Refresh lease correctness and regression tests (`CRED-1`).
2. Cryptographic separation, OAuth encryption, migration, and rotation
   (`CRED-2` and `CRED-3`).
3. Provider contract and verification hardening (`CRED-4` and `CRED-5`).

The encryption plan must begin with a Better Auth version-specific migration
spike and produce a rollback-safe data transition before changing production
configuration.

## Workstream 5: Preview isolation

### Problem

Untrusted preview applications run as direct child subdomains of the same
registrable domain as the authenticated application. Better Auth uses default
cookie naming, and custom cookie-authenticated routes do not consistently
enforce the application Origin or Fetch Metadata.

The preview bearer capability is embedded in the preview hostname. The parent
iframe's `referrerPolicy` controls the iframe navigation but does not enforce the
preview document's policy for its own external subresources and navigations.
Application and preview responses also lack centralized browser-security
headers.

Evidence:

- [`session-preview.ts`](../../../apps/web/src/lib/session-preview.ts)
- [`session-preview-pane.tsx`](../../../apps/web/src/components/session-preview-pane.tsx)
- [`api.provider-auth.stream.ts`](../../../apps/web/src/routes/api.provider-auth.stream.ts)
- [`auth.ts`](../../../apps/web/src/lib/auth.ts)
- [`server.ts`](../../../apps/web/src/server.ts)

### Requirements

#### PREVIEW-1: Use a separate registrable preview domain

- Production previews must not be siblings of the authenticated application.
- The preview zone has separate DNS, TLS, routing, and hostname validation.
- Existing preview capabilities receive an explicit expiry/cutover behavior;
  they are not silently accepted on both domains indefinitely.
- Local development may retain localhost-specific behavior.

#### PREVIEW-2: Harden application cookies

- The primary session cookie uses a `__Host-` compatible name and attributes:
  Secure, Path `/`, and no Domain attribute.
- Cookie migration behavior is explicit; forced reauthentication is acceptable
  if safer than ambiguous dual-cookie parsing.
- Authentication tests cover duplicate/shadow cookie attempts.

#### PREVIEW-3: Enforce browser request boundaries

- Every custom cookie-authenticated mutation or stream endpoint enforces the
  exact application Origin and appropriate Fetch Metadata.
- Requests from preview origins fail before side effects.
- Better Auth and tRPC adapters receive equivalent boundary tests even where
  their libraries provide built-in CSRF behavior.
- Non-browser clients use a separate explicit authentication contract rather
  than bypassing browser-origin checks implicitly.

#### PREVIEW-4: Enforce response headers centrally

- Preview responses receive `Referrer-Policy: no-referrer` at the Worker
  boundary regardless of application-provided headers.
- Application responses receive an environment-aware CSP, framing policy,
  MIME-sniffing protection, minimal permissions policy, and an appropriate
  referrer policy.
- Preview responses do not inherit an application CSP that prevents arbitrary
  project development; preview isolation relies on origin separation and
  narrowly chosen preview headers.

### Acceptance criteria

- Preview documents cannot set cookies for or issue same-origin/same-site
  credentialed mutations to the application.
- Hostile preview requests to every custom cookie-authenticated route are
  rejected before side effects.
- External preview subresources and navigations receive no preview referrer.
- Application framing and CSP behavior are verified against the deployed Worker,
  not only component tests.
- Production and local preview URL validation both pass their respective suites.

### Planning boundary and order

Create two plans:

1. Preview-domain and cookie isolation (`PREVIEW-1` and `PREVIEW-2`).
2. Origin enforcement and centralized headers (`PREVIEW-3` and `PREVIEW-4`).

Do not inject project environment variables into preview processes as part of
either plan.

## Workstream 6: Project environment integrity

### Problem

Environment-variable sanitization trims values, which corrupts
whitespace-significant secrets and configuration. Set and delete mutations use
an unfenced read/decrypt/modify/write sequence, so concurrent requests can lose
or resurrect values. Request and decrypted payload schemas do not establish
practical count or byte limits.

The project router's create, rename, environment CRUD, and provisioning paths
have little direct characterization coverage.

Evidence:

- [`project-env-vars.ts`](../../../apps/web/src/lib/project-env-vars.ts)
- [`projects.ts`](../../../apps/web/src/integrations/trpc/routers/projects.ts)
- [`projects.test.ts`](../../../apps/web/src/integrations/trpc/routers/projects.test.ts)

### Requirements

#### ENV-1: Characterize current project mutations

- Before changing behavior, add direct router/service tests for project creation,
  GitHub import bootstrap success/failure, rename, environment set/delete, and
  ownership failures.
- Tests must cover provisioning success-state handling and sandbox recovery
  delegation without reproducing domain policy in mocks.

#### ENV-2: Preserve values exactly

- Keys continue to use the canonical key normalization and validation policy.
- Values are stored and process-injected byte-for-byte as submitted.
- Empty strings remain a deliberate supported value unless the UI rejects them
  before submission.
- Existing stored values are not re-sanitized merely because another key changes.

#### ENV-3: Make mutation concurrency deterministic

- Concurrent set/delete operations must use optimistic versioning,
  compare-and-set retry, a transaction/serialized domain service, or another D1
  mechanism that prevents lost updates.
- The conflict contract is explicit: safe retry or a client-visible conflict,
  never silent last-writer corruption based on stale state.
- Sandbox wake/provision checks must not widen the unprotected mutation window.

#### ENV-4: Bound credential-shaped input

- Define byte-based limits for project names/descriptions, environment key count,
  individual values, total encrypted payload, initial prompts, and Git callback
  title/body/base fields.
- Reject oversized input before encryption, D1 writes, sandbox creation, provider
  calls, or GitHub calls.
- Decryption validates the same limits and returns a controlled error for
  oversized legacy/corrupt payloads.
- Limits are shared by browser, Worker, and runner schemas where fields cross
  those boundaries.

### Acceptance criteria

- Leading/trailing whitespace and embedded newlines survive create, update,
  encryption, decryption, and process injection.
- Concurrent set/set, set/delete, and delete/delete tests cannot lose or
  resurrect unrelated keys.
- Oversized requests fail before any adjacent side effect.
- Existing normal encrypted payloads remain readable.
- Project router behavior is directly characterized rather than only asserted
  through mocked UI calls.

### Planning boundary and order

Create two plans:

1. Project mutation characterization (`ENV-1`).
2. Exact-value, concurrency, and bounds changes (`ENV-2` through `ENV-4`).

The second plan depends on the first and should reuse the cryptographic
versioning decisions from Workstream 4 when the schedules overlap.

## Workstream 7: Cleanup, architecture, tests, and documentation

### Problem

Several lower-risk issues increase drift and change cost:

- unused direct dependencies and an unused resizable-panel wrapper;
- a 998-line Composer component spanning view, streaming, queue, and model state;
- duplicated provider/provision policy;
- incomplete boundary testing;
- route-scanner warnings from colocated route tests; and
- architecture documentation that no longer exhaustively describes newer
  provider-auth and preview surfaces.

This work must follow the security and correctness contracts instead of
refactoring unstable boundaries first.

### Requirements

#### CLEAN-1: Remove proven-dead dependencies

- Reconfirm reachability before removal.
- Remove `ai`, `@tanstack/router-plugin`, `tokenlens`, and
  `react-resizable-panels` if they remain unreachable when the plan begins.
- Remove the unused resizable wrapper with its package.
- Preserve intentionally reserved `@pierre/trees` and the runner's independent
  dependency stack.
- Regenerate lock metadata and run a production build.

#### CLEAN-2: Split Composer by responsibility

- Add characterization coverage before extraction.
- Keep transport/run state, queued follow-up state, model selection, and presentational
  composition in separately understandable units.
- Preserve current optimistic-message, Stop, queued follow-up, accessibility,
  focus, and error behavior.
- Do not introduce a new global state library solely for this extraction.

#### CLEAN-3: Complete verification hygiene

- Typecheck runner test files.
- Remove TanStack route-scanner warnings by moving tests or configuring a
  supported ignore convention.
- Retain the full-migration-chain and credential timeout coverage introduced by
  Workstream 4; do not create a second harness for the same behavior.
- Keep CI coverage for the supported Node 22 runtime in addition to any Node 24
  lane.
- Use the installed `react-doctor` version rather than
  `npx react-doctor@latest`.

#### CLEAN-4: Repair documentation ownership

- Update `docs/README.md` only when navigation changes.
- Make the repository map exhaustive again or narrow its stated guarantee.
- Document settings and provider-auth HTTP surfaces in the relevant architecture
  documents.
- Replace copied credential appendices with one authoritative security section
  and links.
- Update architecture documents in the same plan that changes a cross-cutting
  runtime or security boundary.

### Acceptance criteria

- A clean frozen install and production build succeed after dependency removal.
- Composer characterization tests pass before and after extraction.
- Web and runner typechecks include their tests as intended.
- Test runs emit no route-scanner warnings.
- A fresh database reaches the current schema by applying the complete ordered
  migration chain.
- Architecture documentation accurately describes every custom auth, provider,
  preview, Git, and runner entrypoint changed by this program.

### Planning boundary and order

Generate focused cleanup plans only after their underlying contracts settle:

1. Dependency and verification hygiene (`CLEAN-1` and `CLEAN-3`) may proceed
   after Workstreams 3 and 4 stop changing runner/provider contracts.
2. Composer extraction (`CLEAN-2`) follows detached-stream correctness.
3. Documentation repair (`CLEAN-4`) is the final reconciliation pass, while
   narrow documentation updates still ship with each preceding workstream.

## Deferred scaling work

The following work is intentionally excluded from the near-term sequence.
Its presence here is a record, not authorization to optimize preemptively.

### SCALE-1: Admission control and quotas

Potential work:

- per-user and global concurrent agent-run leases;
- provider-auth attempt admission;
- operator-fallback budgets;
- request-rate and daily usage limits; and
- abandoned-attempt cleanup.

Re-enter planning when at least one of these is true:

- container contention or operator-provider exhaustion appears in telemetry;
- more than one independent user depends on the production instance;
- abuse exposure expands beyond a small trusted user set; or
- product policy defines account tiers or budgets.

Security exception: if untrusted public signup is enabled, basic admission
control becomes security hardening and must be moved out of deferred scope
immediately.

### SCALE-2: Message cursor index

The current paginated message query sorts by creation time and row ID while only
single-column session/project indexes exist. A local migrated-schema
`EXPLAIN QUERY PLAN` required a temporary B-tree; a temporary session/created-at
index removed that sort.

Re-enter planning when:

- representative D1 `EXPLAIN` confirms the same plan;
- message-query latency grows materially with long sessions; or
- D1 read/CPU metrics identify this query as meaningful.

Any future index must preserve the row-ID tie-break behavior and measure write
and storage cost.

### SCALE-3: Sidebar pagination

The sidebar currently loads every project and active session for an account.

Re-enter planning when:

- real accounts accumulate enough projects/sessions to affect response size or
  interaction latency;
- D1 query cost becomes visible; or
- product requirements introduce archival browsing beyond the current list.

A future design should return sidebar-specific fields, bound recent sessions,
and add cursor/load-more behavior without hiding active navigation targets.

### SCALE-4: Deferred syntax highlighting

Streamed fenced code is synchronously highlighted as the complete block grows,
and all supported grammars are statically loaded.

Re-enter planning when:

- browser profiling shows highlighting contributes meaningful long tasks or
  input delay;
- users commonly stream large fenced code blocks; or
- bundle analysis identifies Highlight.js as a priority chunk.

The likely design is plain escaped code while streaming, one highlight after
settlement, and optional language-level lazy loading. Measurement must precede
the change.

## Cross-workstream execution order

Future plans should use this dependency order:

1. Git credential boundary.
2. Detached delivery correctness.
3. Sandbox orphan cleanup.
4. Runner user/integrity boundary.
5. Refresh lease correctness.
6. Cryptographic separation and OAuth migration.
7. Preview domain and cookie isolation.
8. Preview origin/header enforcement.
9. Project-router characterization.
10. Environment value/concurrency/bounds changes.
11. Bounded agent delivery.
12. Runner/provider contract cleanup and verification hygiene.
13. Composer and dependency cleanup.
14. Final architecture-document reconciliation.

Parallel execution is safe only where plans do not edit the same boundary:

- Git isolation can run alongside detached SSE correctness.
- Bootstrap cleanup can run alongside refresh lease correctness.
- Project-router characterization can run alongside preview-domain design.
- Dependency cleanup must wait for runner/provider contract changes to settle.
- Documentation reconciliation must remain last.

## Future plan-generation map

This specification should produce approximately fourteen focused plans, matching
the execution order above. A plan generator may combine adjacent items only when
all of the following hold:

- they share the same production boundary and test harness;
- the combined change has one rollback unit;
- migration and rollout can be verified together; and
- the plan stays understandable without relying on another unimplemented plan.

Every generated plan must include:

- the requirement IDs it implements;
- current source evidence and the expected files affected;
- characterization tests before behavior changes;
- negative/adversarial tests for security boundaries;
- migration, rollout, mixed-version, and rollback behavior where applicable;
- exact local verification commands;
- required Docker, deployed Worker, GitHub, provider, or browser smokes; and
- documentation sections that become inaccurate after implementation.

Generated plans must not silently pull a deferred `SCALE-*` item into scope.

## Program completion criteria

The near-term hardening program is complete when:

- every non-deferred requirement has an implemented and verified plan;
- GitHub credentials cannot be observed or redirected by repository behavior;
- browser disconnect cannot interrupt or accumulate delivery for an agent run;
- every sandbox is owned or cleaned up and trusted runner artifacts are
  non-writable by workloads;
- credential refresh and storage have tested concurrency, encryption, migration,
  and rotation behavior;
- previews are isolated from application cookies, origins, and referrers;
- project environment values are exact, bounded, and concurrency-safe;
- critical auth, migration, project, runner, and lifecycle boundaries have
  direct tests;
- cleanup preserves behavior and the production build passes; and
- architecture documentation matches the resulting system.

Deferred scaling work is not required for program completion.
