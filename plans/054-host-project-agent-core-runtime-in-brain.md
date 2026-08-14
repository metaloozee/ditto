# Plan 054: Host the project Agent Core Runtime in Brain

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. This
> plan implements a dormant production-shaped Brain foundation; it does not
> make Brain the current Agent Run owner. If any **STOP condition** occurs,
> stop and report it. Do not add a compatibility alias, package patch, Coding
> Agent dependency, second Pi runner, temporary JSONL authority, production
> route, Workflow, jail, or Sandbox migration to make a gate pass. When done,
> report redacted evidence to the reviewer who maintains the plan index.
>
> **Local completion boundary (owner decision, 2026-08-13)**: the owner is on
> Cloudflare's Free plan. This plan may reach `DONE-local` after the exact
> production-source Agent Core implementation passes local workerd, process
> restart/restore, full Website artifact, TypeBox, storage, event, memory,
> startup, bundle, security, scope, and full-repository gates. No cloud deploy,
> destroy, adoption, migration apply, push, merge, or production cutover is
> authorized. Real-provider streaming and deployed release/soak evidence remain
> mandatory production-admission gates when paid infrastructure becomes
> available; their current `not-authorized` / `not-run` state is not a local
> no-go and must not be reported as a pass.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 878a6a3..HEAD -- \
>   package.json pnpm-lock.yaml alchemy.run.ts \
>   apps/web/package.json apps/web/vite.config.ts apps/web/types/env.d.ts \
>   apps/web/src/server.ts apps/web/src/server.test.ts \
>   apps/web/src/lib/secret-redaction.ts \
>   apps/web/src/db/schema.ts \
>   apps/web/src/lib/agent-run-persistence.ts \
>   packages/sandbox-runner/package.json \
>   packages/sandbox-runner/src/run-agent.ts \
>   packages/sandbox-runner/src/runner-model.ts
> ```
>
> Compare any changed load-bearing path with **Current state** before work.
> STOP if Alchemy is no longer the sole Website owner, the Website no longer
> uses `apps/web/src/server.ts`, D1 is no longer authoritative for Agent Runs,
> the exact accepted Alchemy/Agent Run foundations are absent, or the existing
> Sandbox/Trusted Git resource graph has changed incompatibly.
>
> The maintainer root was already dirty at planning time with modified
> `plans/047-add-ephemeral-trusted-git-executor.md` and `plans/README.md`, plus
> untracked `docs/research/headless-pi-in-brain-option.md`, historical Plan 042,
> and `prototypes/`. Plan 054 itself is an additional planning record. Preserve
> all of it by executing in a clean isolated worktree from commit `878a6a3`.
> Never stash, reset, clean, or copy `.env*`, `.alchemy`, `.wrangler`, prototype
> artifacts, or uncommitted plan files from the root checkout.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH — trusted model runtime, Durable Object recovery, immutable
  checkpoint publication, credential boundaries, and Worker resource limits
- **Depends on**:
  - `plans/039-migrate-ayan-stack-to-alchemy-v2.md` (`DONE-local`; accepted
    Alchemy v2 source graph)
  - `plans/041-model-durable-agent-runs-in-d1.md` (`DONE-local`; accepted D1
    Agent Run/Pi Agent Session/Turn foundation)
- **Historical evidence, not a dependency**:
  `plans/042-host-project-pi-runtime-in-brain.md` — its Coding Agent-root
  premise and implementation attempts are rejected and not executable
- **Parallel-safe and independent**:
  `plans/047-add-ephemeral-trusted-git-executor.md` (`DONE-local`); do not bind
  Brain to its Container or Git protocol
- **Blocks**: the reserved Brain Workflow/scheduling/gateway/jail handoff
  (Plans 043–046) and therefore its downstream reserved Plans 048–053
- **Category**: direction
- **Planned at**: commit `878a6a3963a139381db65b5ef9f8773c970ed46c`
  (`878a6a3`), 2026-08-13
- **Branch**: `advisor/054-host-project-agent-core-runtime-in-brain`
- **Execution status**: BLOCKED-local — the 2026-08-13 Grok 4.5 High retry
  is unapproved. Its ordinary verification commands pass, but independent
  review found a failed Step 3 storage boundary and schema-valid reports that
  assert unmeasured Step 8/9 checks instead of proving them.

## Blocked retry record — 2026-08-13 (Grok 4.5 High)

- **Executor model**: xAI Grok 4.5, High reasoning, clean isolated worktree from
  `878a6a3`.
- **Preserved implementation branch**: `pi-agent-17141575-3247-47c` at
  `f948514`. It is **not approved and must not be merged, pushed, cherry-picked,
  or treated as a Plan 054 foundation**.
- **Reviewer-confirmed passes**: frozen root/runner installs; app typecheck; 37
  pure Brain tests; 6 limited workerd tests; full `pnpm verify` (819 web tests,
  81 runner tests, builds, and the scripted Brain gate); changed-file scope;
  guarded-path diffs; forbidden source seams; and `git diff --check`.
- **First failed mandatory gate**: Step 3's production `SessionStorage` accepts
  a parent cycle and an empty metadata ID. The reviewer reproduced both against
  `f948514`; `validateTree()` checks only missing references, and the metadata
  predicate rejects an invalid ID only when it is also oversized. A cyclic
  parent chain can therefore make `getPathToRoot()` loop indefinitely.
- **Step 8 evidence failure**: the two-process probe does restart workerd and
  advance the boot counter, but writes fixed pass values for R2, maximum
  checkpoint, atomic cursor, concurrent Stop, Stop identity, interleaving, and
  redaction. When process RSS is unavailable it substitutes artifact bytes, and
  it derives maximum-checkpoint and temporary-buffer metrics from the same
  unrelated observation. The workerd TypeBox test asserts only that invalid
  tool-argument turns settle; it does not prove validator rejection or zero tool
  execution.
- **Step 9 evidence failure**: the production report starts
  `wrangler.brain-test.jsonc`, not the generated Website artifact. Its
  full-graph driver explicitly delegates to the Brain test entry instead of
  importing/delegating to the production Website entry; equivalence is reduced
  to `fullGraphBytes > 0`. Maximum-cache, full-graph memory, temporary-buffer,
  and cache-byte checks reuse disabled idle process RSS or fixed values. The
  Alchemy report may infer a Brain SQLite migration from source declaration when
  generated metadata did not prove one.
- **Additional implementation blockers**: Brain retains a closure over the full
  Website environment to read the fallback credential; checkpoint redaction is
  constructed permanently with an empty concrete-secret set; event streaming
  has one global redactor state that is dropped on interleaved identity changes;
  tool/text events persist invented `turnId = "active"` / sequence `1`; failed
  checkpoint publication is returned as a successful settled turn; the cache
  capacity lock is held across restore/model I/O; post-turn cache growth is not
  enforced; and canonical checkpoint encoding retains the canonical string,
  full UTF-8 bytes, and compressed bytes simultaneously.
- **Reviewer verdict**: `BLOCK`. This is the second attempt to fail the exact
  artifact/resource-evidence boundary, and the retry also fails core adapter,
  identity, credential, redaction, checkpoint, and cache requirements. Passing
  `pnpm verify` is not completion when its Brain producers manufacture the
  required booleans/metrics. Preserve the branch only as rejected evidence; any
  future attempt must start clean from `878a6a3` and implement the plan rather
  than revise or cherry-pick this branch.
- **Deferred production admission remains unchanged**: provider stream
  `not-authorized`; cloud deploy `not-run`.

## Blocked execution record — 2026-08-13 (Grok 4.6 High)

- **Executor model**: xAI Grok 4.6, High reasoning, isolated worktree.
- **Preserved implementation branch**: `pi-agent-96af83ad-8d2d-4d1` at
  `f87fe2f` (includes the interrupted predecessor commit). It is **not approved
  and must not be merged, pushed, or treated as a Plan 054 foundation**.
- **Reviewer-confirmed passes**: frozen install; app typecheck; 46 pure Brain
  tests; 5 limited workerd tests; `git diff --check`.
- **First failed mandatory gate**: Step 8's two-process workerd
  restart/restore probe was not implemented or run. Its report producer only
  dry-bundles and fills restart, restore, checkpoint, Stop, redaction, and heap
  fields with fixed pass values.
- **Additional blockers**: the production report does not start the exact
  Website/full-graph artifacts or measure startup/memory; the Alchemy probe was
  not run without operator-approved inherited secrets and contains unproven
  fixed resource assertions; `apps/web/tsconfig.json` is an out-of-scope
  change; `pnpm verify` was not run.
- **Reviewer verdict**: `BLOCK`. Schema-valid reports are not execution
  evidence. Any retry must start in a clean isolated worktree from `878a6a3`,
  implement real probes before emitting pass fields, keep every changed path in
  Scope, and receive an operator-approved secure inherited environment for the
  local Alchemy gate. Do not copy `.env*` into the worktree.
- **Deferred production admission remains unchanged**: provider stream
  `not-authorized`; cloud deploy `not-run`.

## Retry clarifications — authoritative for the next clean implementation

These resolve ambiguities exposed by the two rejected attempts. They override
conflicting wording later in this file; all other locked contracts remain exact.

1. **Fallback credential access**: `DurableObject` necessarily retains the
   Website environment through its base class. Brain may lazily read only the
   exact fallback credential from `this.env` in one private guarded method,
   after test-mode and project-identity authorization, and pass it immediately
   into the disposable live model/redaction closure. Do not capture `env` in a
   callback, store a credential reader/value in config, or pass `this.env` to a
   Brain-owned module.
2. **Constructor writes versus disabled calls**: synchronous idempotent schema
   initialization and the bounded `brain_meta` boot counter are constructor
   observations and are allowed when a disabled-safe call instantiates the DO.
   “No write” for disabled/read-only calls means no `brain_identity`,
   `pi_sessions`, checkpoint, event, R2, model, or credential side effect.
3. **Test controls without production RPC expansion**: the production `Brain`
   export keeps only the locked public RPC surface. A fixed outer workerd test
   driver may export a test-only subclass of the exact production class and add
   closed `BRAIN_TEST_MODE`-gated observation/control methods for boot counts,
   faux streams, fault stages, thresholds, barriers, counters, eviction, and
   raw safe storage projections. Production code may provide protected test
   seams to that subclass, but `apps/web/src/server.ts` exports the base class,
   production flags are false, no caller input selects arbitrary method names,
   and the production artifact contains no test driver/protocol.
4. **Expected generation semantics**: `expectedGeneration: null` means the
   caller expects no current checkpoint. If a current generation exists, return
   `stale`; never substitute the observed generation. A positive value must
   match the current pointer exactly.
5. **Redactor budget accounting**: because `StreamingSecretRedactor` does not
   expose internal holdback length, the Brain-owned wrapper must maintain a
   conservative accepted-versus-definitely-emitted input budget. It may
   fail-close early with the one marked truncation event, but it must never
   undercount, retain more than 8 KiB, or let discarded continuation text
   escape. Do not alter the shared redactor or create a second secret registry.
6. **Fresh Website metadata ordering**: `brain-verify.mjs` may run the bounded
   local Alchemy graph probe before the production report so the latter consumes
   invocation-fresh generated Website config/artifact metadata. The required
   order is `brain:test`, `brain:workerd`, `brain:alchemy`, then
   `brain:production-report`, followed by one validation of all reports. Stale
   generated config and the Brain test config are forbidden substitutes.
7. **Memory evidence**: use the exact workerd child inspector, not Wrangler
   parent RSS. Sum only documented inspector heap/embedder/backing-store fields
   actually returned for the tested isolate and report each raw numeric
   component internally before projecting the closed total metric. If the
   installed workerd cannot expose sufficient isolate memory for the 96 MiB and
   128 MiB gates, STOP; never use bundle bytes, host/wrapper RSS, caps, zero, or
   `Math.min(...)` as a proxy.
8. **Fresh-start rule**: do not revise, cherry-pick, copy, or use generated
   artifacts from either rejected Grok branch. Start from `878a6a3`; their code
   is evidence of traps only.

## Why this matters

Ditto's live Pi harness still runs the broad Coding Agent SDK inside the
untrusted Project Sandbox, stores Pi history in Sandbox JSONL, exposes local
coding tools, and uses a Unix control socket. The historical Brain plan tried
to move that Coding Agent root into workerd, but its static `jiti`/CLI/resource
and local-tool graph made that approach unsuitable.

The compatibility spike subsequently passed with exact, unmodified public
`@earendil-works/pi-agent-core@0.80.10` and
`@earendil-works/pi-ai@0.80.10`, without an `import.meta.url` definition. This
plan turns that compatibility result into the dormant production foundation:
one project-scoped Brain Durable Object, Brain-owned Agent Core adapters,
immutable Safe Checkpoints, bounded redacted events, and disposable live
session caches. D1 remains authoritative for conversations and Agent Runs; no
current product traffic or Project Sandbox behavior changes.

## Non-negotiable decisions

1. **One Brain per Project.** Add one SQLite Durable Object export and Website
   binding named `Brain`. Future trusted callers route with
   `env.Brain.getByName(projectId)`. The first valid `projectId` is persisted in
   `brain_identity`; every later mismatch fails closed. Stub names are routing,
   never browser authorization.
2. **Preserve Ditto's domain language.** The domain object remains the
   project-scoped **Pi Runtime** coordinating multiple **Pi Agent Sessions**.
   Agent Core is its implementation boundary. Do not rename Brain to runner or
   conflate Pi Agent Session, Workspace Session, Agent Run, and Turn.
3. **Exact public packages only.** The Website directly pins exact
   `@earendil-works/pi-agent-core@0.80.10` and
   `@earendil-works/pi-ai@0.80.10`. Compose `AgentHarness` (or `Agent` only if
   exact public declarations require it) directly. Imports may use only package
   exports declared by those packages; `@earendil-works/pi-agent-core/node`,
   undeclared file paths, source files, or private internals are forbidden.
4. **Coding Agent is absent from the Brain graph.** Never add or import
   `@earendil-works/pi-coding-agent` in the Website/Brain dependency graph. The
   independent `packages/sandbox-runner` keeps its exact existing Coding Agent
   and Pi AI pins because the current request path remains live. The Brain must
   not import runner code.
5. **No production compatibility shim.** The Agent Core spike passed without an
   `import.meta.url` definition. Do not add a URL definition, alias, jiti stub,
   Vite replacement, package patch, postinstall mutation, pnpm hook,
   `patchedDependencies`, generated substitute package, or externalized runtime.
   Any such need is a STOP.
6. **Unmodified TypeBox remains a hard regression gate.** Freeze the resolved
   TypeBox `1.1.38` edge in the lock. Real workerd tests must execute the actual
   Agent Core/Pi AI tool-validation path and independently accept a valid echo
   input while rejecting missing and wrong-typed required fields. Do not copy a
   validator or call a Node mock a pass.
7. **Brain-owned adapters and static resources only.** Implement a Brain-owned
   `ExecutionEnv` and a Brain-owned `SessionStorage`. Production code must not
   use `InMemorySessionStorage`, `JsonlSessionStorage`, Coding Agent
   `SessionManager`, `/tmp` JSONL, local files, or `./node`. Resources are
   fixed code-owned values with empty skill/prompt collections; no dynamic
   extension, skill, prompt, theme, AGENTS-file, package, or filesystem
   discovery/loading exists. The custom `SessionStorage` is the sole Pi
   session-state seam and restores directly from validated Safe Checkpoint
   state.
8. **No local substrate.** The initial `ExecutionEnv` returns typed
   `not_supported`/`shell_unavailable` failures for every file and process
   operation. It never calls `child_process`, worker threads, a shell, a socket,
   the Project Sandbox, or another Worker. Plan 046 later replaces only the
   file capability side with a jail; no temporary process path is allowed.
9. **Code-owned tools only.** Product mode has no tools. Workerd tests may
   inject exactly one source-defined, secretless `brain_test_echo` tool behind
   a test-only binding. RPC/request input cannot select tool names, definitions,
   schemas, paths, commands, credentials, URLs, or raw capabilities.
10. **In-memory credentials with ambient auth disabled.** Production model
    setup uses Pi AI's `InMemoryCredentialStore`, an explicit `AuthContext`
    whose environment and file lookups return absent. The constructor checks
    Brain flags without reading the fallback credential and never copies it into
    retained config. Only an authorized test execution lazily reads the existing
    trusted operator fallback binding immediately before model construction,
    places it in the live credential/redaction closure, and drops that closure
    on disposal. Reject a configured fallback credential shorter than eight
    Unicode code points before model construction because the shared exact-secret redactor
    deliberately ignores shorter values. Use the public exported OpenCode
    provider surface only if it is present in the exact package export map;
    never use Coding Agent `ModelRuntime`. Credentials stay only in the live
    Brain model/redaction closure and never enter SessionStorage, checkpoints,
    events, SQLite, R2, errors, logs, RPC results, tests, Project Sandbox, or
    browser assets.
11. **D1 remains authoritative.** Existing D1 `workspace_sessions`,
    `pi_agent_sessions`, `agent_runs`, `turns`, and `messages` remain the source
    of conversation, input, control intent, lifecycle, and terminal outcome
    truth. Because Brain is co-located in the Website Worker, Cloudflare injects
    the Website environment into the Durable Object at runtime; a narrow
    TypeScript type is not capability isolation. Brain code must never read,
    destructure, retain, or pass `DB`, `Sandbox`, `TrustedGitExecutor`, or any
    unrelated binding. Only allowlisted values may cross from the constructor
    into Brain-owned modules, and source/artifact guards must enforce that
    boundary. This plan does not wire the dormant D1 persistence module to
    Brain or update D1.
12. **Brain SQLite has a narrow role.** It owns project identity, Safe
    Checkpoint manifests/chunks/current pointers, minimal Pi session metadata,
    bounded redacted monotonic events, and cache/boot observations used by
    tests. It does not own D1 messages/outcomes, Workflow state, operation
    fences, leases, Sandbox process IDs, Git operations, or browser subscribers.
13. **Safe Checkpoints only.** A checkpoint is eligible only after
    `AgentHarness.prompt()`/`waitForIdle()` has settled and Brain's tracked
    provider-stream/tool counters are zero. Wrap the selected provider's public
    stream so the provider counter closes only when the response event stream
    reaches terminal completion, error, or abort; `after_provider_response`
    means headers arrived and does not close it. Agent Core's `save_point` event
    alone is not sufficient because it can occur between an assistant tool
    request and its completed tool result. A stop or crash during an unresolved
    action leaves the previous current Safe Checkpoint unchanged.
14. **Payload before pointer.** Checkpoint exact bytes are written before an
    immutable manifest and current pointer become visible. Small compressed
    payloads use bounded SQLite chunks. Payloads above the selected 512 KiB
    compressed threshold use immutable R2 under a dedicated prefix. Each
    manifest records `checkpoint_kind = "safe_turn"` and the exact terminal
    `event_cursor`. After payload completion, one SQLite transaction inserts
    the `checkpoint_published` event, captures its cursor, inserts the manifest
    with that cursor, and CASes the current pointer; all roll back together.
    Restore validates storage kind, chunk order, lengths, SHA-256, gzip,
    version, identity, tree shape, bounds, leaf reachability, kind, and cursor
    before constructing `Session`/`AgentHarness`.
15. **Immutable generations.** Each session has increasing positive checkpoint
    generations and an expected-current CAS. Manifests and payloads are
    insert-only. A stale writer cannot move the pointer backward. A failed R2
    publication may leave one immutable orphan but cannot expose it as current;
    deletion/retention belongs to later Workflow/GC work.
16. **Memory is a cache.** Keep at most four idle/live Pi Agent Sessions in an
    LRU map and at most 16 MiB of canonical uncompressed checkpoint state across
    the cache. Never evict an active session. If all slots are active or either
    cap would be exceeded, return a typed `busy` result. These conservative caps
    may move downward if the full-Website maximum-cache memory gate needs more
    headroom; increasing either is a STOP and plan refresh. Eviction drops
    object identity and calls best-effort adapter cleanup; reconstruction always
    begins from the current validated SQLite/R2 checkpoint. No heap object is
    recovery evidence. Durable Object RPCs can interleave after `await`, so one
    per-session operation queue/mutex must serialize create/restore/run/
    checkpoint/evict for the same Pi Agent Session and prevent duplicate live
    objects. Stop is explicitly excluded: it atomically validates/marks the
    active handle and invokes `abort()` without waiting for this queue; only its
    later settlement mutations re-enter it. Different sessions may interleave,
    but cache-capacity decisions also use one short in-memory critical section;
    never hold it across provider, R2, or other external I/O.
17. **Bounded redacted event journal.** Persist a closed event projection only,
    with monotonic SQLite integer cursors and exact Project/Workspace Session/
    Pi Agent Session/Agent Run/Execution Epoch/Turn identity. Stream assistant
    text through `StreamingSecretRedactor`, wrapped by a Brain-owned 8 KiB
    pending-input budget. Track accepted versus emitted code units; if holdback
    exceeds the budget (including an unterminated private-key region), discard
    the held region, emit one marked `[REDACTED]`/truncated event, and latch that
    text identity into discard mode until the next non-text boundary or
    settlement. This prevents continuation bytes from escaping after their
    BEGIN marker was discarded. Emit exactly one marked event, then reset the
    redactor/latch only at that boundary. Flush held text before non-text
    boundaries, cap strings/events/replay, and never serialize raw Pi events,
    provider payloads/headers, tool inputs/results, exceptions, or credentials.
18. **Dormant product execution.** Add narrow internal RPC methods and test-only
    execution, but hard-code `BRAIN_RUNTIME_ENABLED` false in the Alchemy graph.
    Add no HTTP route, tRPC caller, `/api/agent/*` caller, browser code, Workflow,
    alarm-driven execution, or current service call. The default Website fetch
    behavior stays unchanged.
19. **No Sandbox or Git work.** Do not change the stable Sandbox package/image,
    current Project Sandbox runner, worktrees, backups, Preview, Trusted Git
    Executor, or any `@cloudflare/sandbox@next` migration. Sandbox migration
    skills are boundary guards here, not implementation APIs.
20. **Local evidence is not production admission.** Local workerd and full
    Website artifact evidence can establish `DONE-local`. A future paid plan
    must still prove a real provider stream, deployed cold starts, at least two
    concurrent sessions, eviction/restart restore, memory/CPU, exact binding
    migration, and release/soak behavior for the exact release candidate. No
    deployment is authorized here.

## Compatibility evidence versus implementation tests

The compatibility spike is **evidence for choosing the API**, not evidence that
this production implementation works. Its redacted report recorded:

- exact Agent Core `0.80.10`, Pi AI `0.80.10`, TypeBox `1.1.38`, Wrangler
  `4.122.0`, workerd `1.20260811.1`, and Vitest pool `0.21.2`;
- exact dry-run artifact in local workerd: pass without an
  `import.meta.url` definition;
- separate `cloudflareTest()` path: pass;
- two sessions, unmodified TypeBox, code-owned echo tool, full process restart,
  SQLite export/reconstruction, denied shell, and forbidden graph: pass;
- compressed minimal candidate artifact: 745,587 bytes;
- local startup profile: 25.6 ms active in a 93.1 ms window;
- two-session workerd heap peak: 16,939,860 bytes;
- real provider: `not-authorized`; deployed admission: deferred;
- verdict: `GO-candidate` and recommendation to replan around Agent Core.

The historical Coding Agent comparator needed the previously considered module
URL definition for workerd, failed its selected Vitest path at `jiti`, retained
forbidden local-substrate edges, and is rejected as the Brain dependency.
Historical Plan 042 is retained only for that evidence; neither attempt may be
cherry-picked, merged, or treated as a source base.

Plan 054 must independently test the **new production modules and storage
implementation**. Its functional workerd artifact must import the exact
production `Brain` class/module graph with no runtime mocks; only the outer
fixed test driver and test bindings may differ. Separately, the exact full
Website dry artifact must start in local workerd with production execution
hard-disabled and pass an ordinary Website request. Do not copy the
compatibility report into a completion report, reuse its counts as Plan 054
results, or let a minimal prototype result replace a failed current
implementation/full-Website test.

## Current state

### Domain and authority

`CONTEXT.md` defines the terms to preserve:

```markdown
**Brain**:
The trusted, project-scoped coordinator that owns session agent state and has exclusive authority to mutate the Project Sandbox.

**Pi Runtime**:
The project-scoped Pi harness hosted by the Brain. It coordinates multiple Pi Agent Sessions but owns no conversation identity.

**Pi Agent Session**:
The durable Pi conversation state belonging to exactly one Workspace Session. A Brain coordinates many Pi Agent Sessions.

**Safe Checkpoint**:
A durable Pi Agent Session state captured while no model or tool action is unresolved. Recovery may continue only from a Safe Checkpoint.
```

### Alchemy v2 Website graph

`alchemy.run.ts` currently declares the accepted Alchemy v2 graph and binds D1,
R2, the stable Project Sandbox, and the independent Trusted Git Executor to one
Website Worker:

```ts
const Database = Cloudflare.D1.Database("database", {
  name: "ditto-ayan-db",
  migrationsDir: path.join(repoRoot, "apps/web/migrations"),
  migrationsTable: "drizzle_migrations",
});

const SandboxBackups = Cloudflare.R2.Bucket("sandbox-backups", {
  name: "ditto-ayan-sandbox-backups",
});

export const Website = Cloudflare.Website.Vite("website", {
  name: "ditto-website-ayan",
  rootDir: path.join(repoRoot, "apps/web"),
  main: "src/server.ts",
  assets: { runWorkerFirst: true },
  compatibility: { flags: ["nodejs_compat_populate_process_env"] },
  env: {
    DB: Database,
    Sandbox: SandboxContainer,
    TrustedGitExecutor: TrustedGitExecutorContainer,
    BACKUP_BUCKET: SandboxBackups,
    // existing plain/redacted bindings
  },
});
```

Add a sibling low-level declaration equivalent to:

```ts
const BrainDurableObject = Cloudflare.DurableObject<BrainDurableObjectShape>(
  "brain",
  { className: "Brain" },
);
```

and bind it as `Brain: BrainDurableObject` in the existing Website `env`.
Alchemy beta.70 defaults new locally hosted Durable Object classes to
`new_sqlite_classes`; do not hand-write a Wrangler migration or create a second
Worker. Add `limits: { cpu_ms: 30_000 }`, `BRAIN_RUNTIME_ENABLED: "false"`, and
`BRAIN_TEST_MODE: "false"` without renaming any existing resource/binding.

`apps/web/types/env.d.ts` already infers `Env` from `WebsiteEnv`; it must remain
the only binding type source. Do not hand-maintain `Env.Brain`.

### Website entry

`apps/web/src/server.ts` is the custom Worker entry:

```ts
export { Sandbox } from "@cloudflare/sandbox";
export { TrustedGitExecutor } from "#/lib/trusted-git-executor";
export { ContainerProxy };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const proxied = await proxyToSandbox(request, env as unknown as SandboxEnv);
    // preview handling, then unchanged TanStack handler
  },
};
```

Export `Brain` beside the existing classes. Preserve default `fetch()` behavior;
do not add a Brain route or test branch to this production entry.

### D1 Agent Run foundation

`apps/web/src/db/schema.ts` and
`apps/web/src/lib/agent-run-persistence.ts` already define the exact eight-state
model:

```ts
export const AGENT_RUN_STATUSES = [
  "accepted", "running", "stopping", "finalizing",
  "completed", "failed", "cancelled", "interrupted",
] as const;

export const LEGAL_AGENT_RUN_TRANSITIONS = {
  accepted: ["running", "stopping", "finalizing"],
  running: ["stopping", "finalizing"],
  stopping: ["finalizing"],
  finalizing: ["completed", "failed", "cancelled", "interrupted"],
  completed: [], failed: [], cancelled: [], interrupted: [],
};
```

Migration `apps/web/migrations/0012_elite_union_jack.sql` and the persistence
service are dormant but locally accepted. Leave schema, migration, lifecycle,
message, and current request behavior unchanged. Brain must not receive `DB` in
its narrow environment.

### Existing redaction boundary

`apps/web/src/lib/secret-redaction.ts` already exports:

```ts
redactSecrets(text, concreteSecrets)
redactStructured(value, concreteSecrets)
new StreamingSecretRedactor(concreteSecrets)
```

The streaming redactor holds suffixes across chunks and fail-closes incomplete
private-key-shaped regions. Reuse it; do not create a competing secret-pattern
registry. Add Brain-specific closed-value validation and byte caps around it.
A checkpoint containing an unsupported/cyclic value is rejected rather than
persisted as a partially redacted structure.

### Current Pi runner is intentionally separate

`packages/sandbox-runner/package.json` currently pins:

```json
"@earendil-works/pi-ai": "0.80.10",
"@earendil-works/pi-coding-agent": "0.80.10"
```

`packages/sandbox-runner/src/run-agent.ts` opens
`/workspace/.ditto/sessions/<conversation>.jsonl`, calls Coding Agent
`createAgentSession`, enables built-in local coding tools, and uses a Unix
control socket for follow-up/Stop. `runner-model.ts` uses Coding Agent
`ModelRuntime` plus an in-memory credential store. These files describe the
live path to preserve, not code to reuse. Plan 054 changes none of them.

### Public Agent Core seams proven by the spike

Exact Agent Core `0.80.10` publicly exports `AgentHarness`, `Session`,
`SessionStorage`, `ExecutionEnv`, Agent tool/event types, and errors from its
root. Its Node implementation is separately exported under `./node` and is
forbidden here. The public contracts include:

```ts
interface SessionStorage {
  getMetadata(): Promise<SessionMetadata>;
  getLeafId(): Promise<string | null>;
  setLeafId(leafId: string | null): Promise<void>;
  createEntryId(): Promise<string>;
  appendEntry(entry: SessionTreeEntry): Promise<void>;
  getEntry(id: string): Promise<SessionTreeEntry | undefined>;
  findEntries(type): Promise<SessionTreeEntry[]>;
  getLabel(id: string): Promise<string | undefined>;
  getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]>;
  getEntries(): Promise<SessionTreeEntry[]>;
}

const harness = new AgentHarness({
  env,
  session: new Session(brainSessionStorage),
  models,
  model,
  systemPrompt,
  tools: codeOwnedTools,
  activeToolNames: codeOwnedTools.map((tool) => tool.name),
  resources: { skills: [], promptTemplates: [] },
  followUpMode: "one-at-a-time",
});
```

Pi AI's root publicly exports `createModels`, `InMemoryCredentialStore`, `Type`,
validation, and the faux provider. Its package export map also exposes selected
provider modules such as `@earendil-works/pi-ai/providers/opencode`; use only a
verified declared export. Construct models with an explicit ambient-denying
`AuthContext`.

### Verification baseline

Root verification is authoritative:

```json
"verify": "pnpm check && pnpm typecheck && pnpm test && pnpm build && pnpm runner:verify"
```

CI runs Node 24, frozen pnpm install, independent runner `npm ci`, then
`pnpm verify`. Add the Brain gate without removing or weakening any current
check, typecheck, web test/build, or runner verification.

## Target architecture

### Locked initial contracts

These names and shapes are exact for Plan 054; the executor may not invent a
broader RPC surface. D1's `pi_agent_sessions` table uses
`workspaceSessionId` as its primary key, so in this first architecture
`piAgentSessionId === workspaceSessionId`. RPC inputs carry only
`workspaceSessionId`; Brain derives the Pi Agent Session ID and rejects any
persisted payload where they differ.

```ts
type BrainTurnIdentity = {
  projectId: string;
  workspaceSessionId: string;
  runId: string;
  executionEpoch: number;
  turnId: string;
  turnSequence: number;
};

type BrainErrorCode =
  | "disabled" | "test_mode_required" | "invalid" | "not_found"
  | "busy" | "stale" | "not_active" | "not_quiescent"
  | "corrupt" | "storage" | "aborted" | "internal";
type BrainResult<T> = { ok: true; value: T } |
  { ok: false; error: { code: BrainErrorCode } };

type TestTurnInput = BrainTurnIdentity & { prompt: string };
type StopInput = Omit<BrainTurnIdentity, "turnId" | "turnSequence">;
type CheckpointInput = BrainTurnIdentity & {
  expectedGeneration: number | null;
};
type ReadEventsInput = {
  projectId: string; workspaceSessionId: string;
  afterCursor: number; limit: number;
};
type InspectInput = { projectId: string; workspaceSessionId: string };

type BrainEvent = {
  cursor: number;
  identity: BrainTurnIdentity;
  kind: "session_restored" | "turn_started" | "assistant_text_delta"
    | "tool_started" | "tool_finished" | "stop_acknowledged"
    | "turn_settled" | "checkpoint_published" | "safe_error";
  payload: Record<string, string | number | boolean | null>;
  createdAt: number;
};
type TestTurnValue = {
  settled: true; checkpointGeneration: number; eventCursor: number;
};
type StopValue = { state: "requested" | "already_requested" };
type CheckpointValue = {
  generation: number; eventCursor: number; storage: "sqlite" | "r2";
};
type ReadEventsValue = {
  events: BrainEvent[]; nextCursor: number; limited: boolean;
};
type InspectValue = {
  initialized: boolean; cached: boolean; active: boolean;
  stopRequested: boolean; currentGeneration: number | null;
  entryCount: number; lastEventCursor: number;
};
```

The only execution RPCs in this plan are
`initializeForTest({ projectId }): BrainResult<{ initialized: true }>`,
`runEchoTurnForTest(TestTurnInput): BrainResult<TestTurnValue>`,
`requestStopForTest(StopInput): BrainResult<StopValue>`, and
`checkpointSessionForTest(CheckpointInput): BrainResult<CheckpointValue>`; all
require `BRAIN_TEST_MODE === "true"`. `readEvents(ReadEventsInput)` returns
`BrainResult<ReadEventsValue>` and `inspectSession(InspectInput)` returns
`BrainResult<InspectValue>`; both are read-only, return `initialized: false` or
`not_found` for an uninitialized production Brain, and never initialize
identity. There is deliberately no production `runTurn` in Plan 054. Reserved
Plan 043 introduces a differently named fenced execution command bound to an
authoritative D1 Turn, epoch, sequence, and prompt digest.

Flag/identity precedence is exact:

| Method | `BRAIN_TEST_MODE=false` | test mode, identity absent | test mode, identity matches | test mode, identity differs |
|---|---|---|---|---|
| `initializeForTest` | `test_mode_required` | persist identity; success | idempotent success | `stale` |
| `runEchoTurnForTest` | `test_mode_required` | `not_found` | execute | `stale` |
| `requestStopForTest` | `test_mode_required` | `not_found` | locked Stop rules | `stale` |
| `checkpointSessionForTest` | `test_mode_required` | `not_found` | checkpoint/typed state error | `stale` |
| `readEvents` | `disabled` when `BRAIN_RUNTIME_ENABLED=false` | `not_found` | read only | `stale` |
| `inspectSession` | success with `{ initialized:false, cached:false, active:false, stopRequested:false, currentGeneration:null, entryCount:0, lastEventCursor:0 }` | same | read only | `stale` |

Production has both flags false. `BRAIN_TEST_MODE` is checked before identity or
any storage/model side effect for test methods. `readEvents` checks runtime
before identity. `inspectSession` is the sole disabled-safe status call and is
storage-write-free. No method writes identity except `initializeForTest`.

The closed event kinds are exactly `session_restored`, `turn_started`,
`assistant_text_delta`, `tool_started`, `tool_finished`, `stop_acknowledged`,
`turn_settled`, `checkpoint_published`, and `safe_error`. `tool_*` stores only
bounded tool name/call ID and error boolean. `safe_error` stores only one
`BrainErrorCode`. Event names may not be broadened or polished during execution.

Locked caps are: ID/key 128 UTF-8 bytes; prompt 32,000 UTF-16 code units;
entry string 64 KiB UTF-8; entry nesting 32; entry count 20,000; event string
4 KiB UTF-8; event 64 KiB; replay 1,000 events/1 MiB; redactor pending input
8 KiB; checkpoint 4 MiB uncompressed/2 MiB compressed; SQLite threshold
512 KiB compressed; SQLite chunk 64 KiB; at most four cached sessions and at
most 16 MiB total canonical uncompressed checkpoint bytes represented by the
live cache. Either cache limit returns `busy`; neither is a durability claim.

Every persisted identity column has `CHECK(length(value) BETWEEN 1 AND 128 AND
instr(value, char(0)) = 0)`. Generations, epochs, turn sequences, and event
cursors are positive safe integers. `pi_sessions.workspace_session_id` is the
primary key and also the Pi Agent Session ID. Manifests have
`PRIMARY KEY(workspace_session_id, generation)`,
`UNIQUE(workspace_session_id, event_cursor)`, `checkpoint_kind` constrained to
`safe_turn`, and a manifest check requiring no R2 key for `sqlite` or a nonempty
R2 key for `r2`. Publication/restore code (not a cross-table `CHECK`) requires
one or more contiguous chunks only for `sqlite` and zero chunks for `r2`. Chunks have
`PRIMARY KEY(workspace_session_id, generation, chunk_index)` and checked
`chunk_index >= 0`, `length(bytes) BETWEEN 1 AND 65536`.

### File layout

Use this production boundary (file names are exact; ownership is not negotiable):

```text
apps/web/src/lib/brain/
  contracts.ts             closed RPC/result/event/checkpoint types and limits
  execution-env.ts         Brain-owned denied ExecutionEnv for the first cut
  session-storage.ts       Brain-owned Agent Core SessionStorage implementation
  checkpoint-store.ts      canonical encode, gzip/hash, SQLite/R2 publication
  event-journal.ts         closed projection, streaming redaction, cursor replay
  model-runtime.ts         Pi AI Models + in-memory credential setup
  runtime.ts               AgentHarness composition and bounded live-session LRU
  brain.ts                 SQLite schema and narrow Durable Object RPC methods
```

Tests remain colocated for pure modules. Real workerd files live under
`apps/web/test/brain/` and are not matched by default web Vitest.

### Brain SQLite schema

Initialize schema synchronously in the `Brain` constructor using parameterized
SQL for values. Minimum tables:

- `brain_identity`: singleton row with immutable `project_id`, schema version,
  and creation time;
- `pi_sessions`: one row per Workspace Session/Pi Agent Session with metadata,
  `current_checkpoint_generation`, `next_checkpoint_generation`, and bounded
  timestamps;
- `checkpoint_manifests`: immutable `(session_id, generation)` plus run, epoch,
  turn, checkpoint kind (`safe_turn`), terminal event cursor, checkpoint format
  version, parent generation, entry count, leaf ID, compressed/uncompressed
  lengths, SHA-256, storage kind (`sqlite|r2`), optional R2 key, and creation
  time;
- `checkpoint_chunks`: immutable bounded `(session_id, generation, chunk_index)`
  BLOB rows with exact chunk length;
- `brain_events`: `cursor INTEGER PRIMARY KEY AUTOINCREMENT`, session/run/epoch/
  turn identity, one closed kind, redacted bounded JSON payload, and timestamp;
- one small `brain_meta` counter for schema/boot observations used by restart
  tests; it must not contain request state.

Do not add D1 message/outcome copies, Workflow/fence/lease tables, Sandbox IDs,
process handles, Git records, browser subscribers, credentials, or generic JSON
state.

### Brain SessionStorage semantics

`BrainSessionStorage` implements Agent Core's public interface without importing
Agent Core's memory or JSONL implementations:

- initialize from validated `{metadata, leafId, entries}` or a new empty state;
- keep a private ordered array plus ID/label indexes and current leaf;
- generate bounded collision-checked IDs with Web Crypto;
- reject duplicate IDs, missing parents/targets, invalid timestamps, invalid
  tree shapes, unsupported values, cross-session metadata, and unreachable
  current leaves;
- mirror Agent Core leaf behavior (`leaf` entries select `targetId`, ordinary
  entries become the new leaf);
- expose a deep-cloned canonical snapshot only to the trusted checkpoint store;
- accept mutations only while its owning runtime is active and not disposed;
- retain staged, not-yet-checkpointed state in memory only. After crash, only
  the prior published Safe Checkpoint restores. This is deliberate and must be
  tested.

The custom adapter is the durable integration seam because all recovery and
publication flow through it; it is not permission to expose partial action
state as current.

### Checkpoint format and publication

Use one canonical JSON payload, not Coding Agent JSONL:

```text
{
  version: 1,
  projectId,
  workspaceSessionId,
  piAgentSessionId,
  metadata: { id, createdAt },
  leafId,
  entries,
  safePoint: { runId, executionEpoch, turnSequence }
}
```

Before encoding, validate JSON compatibility, finite numbers, object prototypes,
entry discriminants, IDs, parents, leaf reachability, and all bounds. Recursively
redact known credential leaves and secret-shaped text, then validate again. Use
deterministic key ordering and UTF-8. Maximums are the locked constants above:
4 MiB uncompressed, 2 MiB compressed, 512 KiB SQLite/R2 threshold, 64 KiB
chunks, 20,000 entries, 64 KiB per entry string, and depth 32. Reject, never
truncate, a checkpoint. Encode incrementally into bounded UTF-8 chunks and pipe
them through `CompressionStream`; do not simultaneously retain a canonical
string plus full UTF-8 and compressed copies. A validated immutable session
snapshot remains in memory during encoding, but temporary encoding/compression
buffers together may not exceed 8 MiB.

Publication order:

1. Snapshot only after Brain proves quiescence.
2. Encode canonical UTF-8, gzip with `CompressionStream`, and hash the exact
   compressed bytes with Web Crypto SHA-256. Record both exact lengths.
3. At or below 512 KiB, in one `ctx.storage.transactionSync`: insert every
   bounded chunk, insert `checkpoint_published`, capture its cursor, insert the
   immutable `safe_turn` manifest with that cursor, then CAS the session's
   current pointer/next generation. A throw rolls back all stages.
4. Above 512 KiB, write an immutable R2 object first under
   `brain-checkpoints/v1/<project-hash>/<session-hash>/<generation>-<hash>.json.gz`.
   Raw IDs never enter the key. Use the installed type's exact equivalent of
   `If-None-Match: *` (currently `onlyIf: { etagDoesNotMatch: "*" }`) plus a
   SHA-256 checksum and bounded custom hash/length metadata. If the conditional
   put returns `null`, `head` the existing key and require exact size/hash
   metadata; mismatch fails closed.
5. Only after R2 completion, run one synchronous SQLite transaction that inserts
   `checkpoint_published`, captures its cursor, inserts the immutable `safe_turn`
   manifest with that cursor, and CASes the pointer. A stale CAS rolls back the
   event/manifest, leaves the prior pointer current, and may leave only the R2
   object orphaned.
6. Restore reads only the current manifest, obtains all chunks in order or the
   exact R2 object, verifies compressed length/hash before decompression,
   bounded-streams decompression to the exact uncompressed length, parses and
   validates the format/tree/identity, then constructs `BrainSessionStorage`,
   `Session`, and `AgentHarness`.

### Event projection

Use exactly the event kinds in **Locked initial contracts**; names may not be
polished. They represent session restore, turn start/settlement, assistant text,
code-owned tool start/finish, Stop acknowledgement, checkpoint publication, and
one bounded safe error code. No kind can carry raw Pi objects.

Runtime boot counters remain in `brain_meta`; do not invent a run/epoch/turn to
place a process boot observation in the event journal.

Caps are the locked 4 KiB string, 64 KiB event, 1,000-event/1-MiB replay, and
8 KiB pending-redactor budget. Text truncation must carry explicit metadata.
Reject invalid identities and unsafe payload fields. Streaming redaction state
is scoped to one active session/run/epoch/turn and flushed before tool,
checkpoint, settlement, error, or identity change. A multi-megabyte
unterminated private-key-shaped stream must remain within the pending budget,
produce one marked redaction/truncation, discard every continuation chunk until
a non-text boundary, then resume normal text after the boundary without memory
growth.

### Runtime and RPC boundary

`Brain` exposes only the exact methods in **Locked initial contracts**. Plan
054 execution is test-only; no method is advertised as the future Workflow
command. All mutations except Stop enter the per-session queue. The queue holds
only short state transitions while calling into storage, but `runEchoTurnForTest`
registers an identity-fenced active operation/abort handle before releasing the
short critical section and awaiting `AgentHarness.prompt()`.

`requestStopForTest` is the sole non-queued signal path: it validates the exact
active `{projectId, workspaceSessionId, runId, executionEpoch}` against the
registered handle, marks Stop requested once, and calls public `abort()` without
waiting behind the turn. Turn completion, Stop acknowledgement, counter
settlement, event flush, and checkpoint eligibility then re-enter the
per-session queue. A stale/wrong identity cannot abort; duplicate exact Stop is
idempotent; completion racing before Stop returns `not_active`; Stop during a
provider/tool action cannot publish that action as current. Every other
create/restore/checkpoint/evict operation remains serialized.

`readEvents` is cursor/count/byte bounded and strictly after; `inspectSession`
returns safe booleans/counts/current generation/cache state only. Test-only
threshold/fault hooks and eviction require `BRAIN_TEST_MODE === "true"` and no
production request can select them. Alchemy hard-codes both Brain flags false.
Disabled production calls do not initialize `brain_identity` or write any row.
Only `initializeForTest` may establish identity in Plan 054; Plan 043 owns the
future trusted/fenced bootstrap. No method accepts a credential,
model/provider destination, tool definition, `ExecutionEnv`, Sandbox/Git
handle, command, path, URL, or callback.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Root install | `pnpm install --frozen-lockfile` | exit 0; lockfile unchanged after implementation |
| Runner install | `npm ci --prefix packages/sandbox-runner` | exit 0; legacy runner remains reproducible |
| App typecheck | `npm run typecheck --prefix apps/web` | exit 0 |
| Pure Brain tests | `npm test --prefix apps/web -- --run src/lib/brain` | all Brain Node/pure tests pass |
| Workerd suite | `npm run brain:test --prefix apps/web` | exact production Brain modules pass in `cloudflareTest()` |
| Restart/restore probe | `npm run brain:workerd --prefix apps/web` | exact dry artifact passes two-process restart/restore and emits redacted metrics |
| Production report | `npm run brain:production-report --prefix apps/web` | exact full Website artifact starts in local workerd; startup, memory, graph, and client scans pass hard gates |
| App build | `npm run build --prefix apps/web` | exit 0; generated Website artifact includes server-only Brain export |
| Local Alchemy | `npm run brain:alchemy --prefix apps/web` | bounded graph probe observes one Brain SQLite class/binding and exits cleanly |
| Focused regressions | `npm test --prefix apps/web -- --run src/server.test.ts src/lib/secret-redaction.test.ts src/db/agent-run-migration.test.ts src/lib/agent-run-persistence.test.ts src/lib/trusted-git-executor.test.ts` | all selected tests pass |
| Full gate | `pnpm verify` | check, app typecheck/tests/build, Brain gates, and runner verification all pass |
| Diff check | `git diff --check` | no whitespace errors |

Use these exact added script values:

```json
// root package.json
"brain:verify": "pnpm --filter @ditto/web brain:verify",
"verify": "pnpm check && pnpm typecheck && pnpm test && pnpm build && pnpm brain:verify && pnpm runner:verify"

// apps/web/package.json
"brain:test": "vitest run --config vitest.brain.config.ts",
"brain:workerd": "node scripts/brain-workerd-probe.mjs",
"brain:production-report": "node scripts/brain-production-report.mjs",
"brain:alchemy": "node scripts/brain-alchemy-probe.mjs",
"brain:verify": "node scripts/brain-verify.mjs"
```

`brain-verify.mjs` is the sole orchestrator. It creates a cryptographically
random URL-safe `invocation_id`, records `invocation_started_at`, removes only
old `/tmp/ditto-054-reports/*.tmp` and report files, then sequentially runs
`brain:test`, `brain:workerd`, `brain:production-report`, and `brain:alchemy`
with `DITTO_054_INVOCATION_ID` and `DITTO_054_INVOCATION_STARTED_AT` in child
env. It finally invokes the exported validator from
`brain-verify-reports.mjs`. Any child failure kills its process group and exits
nonzero. Producers refuse to run without both values.

All producers write atomically under `/tmp/ditto-054-reports/`:
`workerd.json`, `production.json`, and `alchemy.json`. Exact common top-level
keys are:

```text
schema_version, report_type, status, planned_at, source_sha, lock_sha256,
invocation_id, invocation_started_at, started_at, ended_at, versions,
artifact_sha256, checks, metrics
```

Common fixed values: schema `1`, status `pass`, planned-at `878a6a3`, current
source SHA, current lock hash, exact invocation fields, and `report_type` equal
to the filename stem. `versions` has exactly `agent_core`, `pi_ai`, `typebox`,
`vitest_pool`, `web_wrangler`, `pool_wrangler`, `workerd`, `alchemy`, `sandbox`,
and `containers` string keys. `artifact_sha256` is exactly
`{ primary: string, full_graph_test: string | null }`: primary is the tested
artifact/config; only `production.json` has the second hash for its full-graph
test artifact.

Required closed checks:

```text
workerd: boot, typebox_valid, typebox_missing_rejected,
typebox_wrong_rejected, two_sessions, restart_fresh_constructor,
restore_both, sqlite_checkpoint, r2_checkpoint, max_checkpoint,
checkpoint_atomic_cursor, stop_concurrent, stop_identity_matrix,
interleaving_safe, redaction_bounded, no_forbidden_substrate

production: website_started, ordinary_request, brain_present,
runtime_disabled, no_credential_read, no_identity_write,
full_graph_test_started, full_graph_equivalent, server_graph_clean,
client_graph_clean, versions_exact, compressed_limit, startup_limit,
ordinary_memory_limit, maximum_cache_memory_limit, temp_buffer_limit,
cache_byte_limit

alchemy: ready, brain_binding, brain_sqlite_migration, sandbox_unchanged,
trusted_git_unchanged, r2_unchanged, flags_false, cpu_limit,
process_group_stopped, no_cloud_apply
```

Required closed metrics:

```text
workerd: artifact_bytes, boot_count_before, boot_count_after,
ordinary_heap_peak_bytes, max_checkpoint_heap_peak_bytes,
temp_buffer_peak_bytes, duration_ms

production: compressed_bytes, startup_active_ms, website_idle_heap_bytes,
full_graph_artifact_bytes, full_graph_idle_heap_bytes,
ordinary_heap_peak_bytes, maximum_cache_heap_peak_bytes,
temp_buffer_peak_bytes, cache_canonical_bytes, duration_ms

alchemy: succeeded_resource_count, brain_binding_count,
brain_sqlite_migration_count, child_exit_code, duration_ms
```

`brain-verify-reports.mjs` rejects missing/extra top-level, version, check, or
metric keys; any non-pass/false check; non-finite/absent/negative metrics;
mismatched invocation/planned-at/SHA/hash/pins; `started_at` before the shared
invocation start; `ended_at` before start or more than 15 minutes after it;
strings over 512 bytes; or keys matching
`secret|token|credential|authorization|cookie|prompt|message|content|binding_value`.
Reports contain no raw logs or values. Every producer writes a temporary file,
validates it, then renames it; failure removes the temporary file and exits
nonzero.

The exact compatible test dependency is
`@cloudflare/vitest-pool-workers@0.21.2`, because that is the separately passed
Agent Core path with Vitest 4.1. Revalidate it against the current web Vitest and
existing Wrangler 4.111 pin before adding it. It may retain its nested Wrangler
4.122/workerd line; do not upgrade the web Wrangler, Alchemy, Miniflare,
Sandbox, Containers, Vite, or Vitest as collateral work. If exact 0.21.2 no
longer installs from the frozen lock without unrelated platform movement, STOP
and refresh the harness choice.

## Suggested executor toolkit and references

- Use the `cloudflare`, `durable-objects`, and `workers-best-practices` skills.
- Consult `sandbox-migrate-to-next` and `sandbox-next` only to enforce that this
  plan does **not** migrate or use either Sandbox API line.
- Follow the Improve plan and STOP discipline. Ponytail is not installed
  locally; do not invent or require it.
- Re-fetch current official docs before implementation:
  - Durable Object RPC, lifecycle, SQLite storage, `transactionSync`, testing,
    and limits;
  - R2 Worker API conditional `put`, checksums, `head`, and strong consistency;
  - Workers bundle/startup/memory/CPU limits and current Vitest integration.
- Inspect exact installed declarations/source rather than guessing:
  - Agent Core root `AgentHarness`, `ExecutionEnv`, `SessionStorage`, `Session`,
    events, and tool types;
  - Pi AI root credentials/models/TypeBox/faux exports and the package export map
    for the one selected fallback provider;
  - Alchemy beta.70 `Cloudflare.DurableObject`, `Website.Vite`, `WorkerLimits`,
    and generated `newSqliteClasses` behavior;
  - latest installed/pool Workers types for DO SQL, R2, RPC, and test bindings.
- Generated Alchemy/Wrangler config may contain secret-bearing values. Inspect
  only class/binding names, compatibility metadata, resource limits, artifact
  paths/sizes, and migration kind. Never print or record values.

Relevant current Cloudflare facts retrieved while planning:

- new/existing Workers with compatibility date >= 2024-04-03 should use public
  Durable Object RPC methods; RPC values must be serializable;
- `transactionSync()` is SQLite-only, synchronous, and rolls back when its
  callback throws;
- hibernation/eviction/restart discards in-memory object state and reruns the
  constructor;
- R2 conditional `put` returns `null` when the condition fails, and successful
  writes are strongly consistent;
- Workers have 128 MiB isolate memory, 1 second startup, and Paid compressed
  bundle maximum 10 MiB; this architecture additionally targets 7.5 MiB
  compressed headroom and a 96 MiB local two-session peak;
- `waitUntil()` is not execution ownership and has a bounded post-response
  lifetime. This plan uses neither request ownership nor `waitUntil()` for
  product execution.

## Scope

### In scope — the only implementation/config paths to modify

- `package.json` — add the Brain gate to normal root verification; do not alter
  existing script semantics.
- `pnpm-lock.yaml` — exact web Agent Core/Pi AI/test-pool edges only.
- `alchemy.run.ts` — one `Brain` Durable Object declaration/binding, hard-false
  runtime/test flags, and 30-second Worker CPU metadata; preserve the graph.
- `apps/web/package.json` — exact Agent Core/Pi AI dependencies, exact test-pool
  dev dependency, and Brain scripts only.
- `apps/web/vite.config.ts` — preferably unchanged. It may receive only a
  production-server inclusion setting proven necessary to bundle the exact
  public packages; aliases, defines, Pi externalization, client exposure, and
  compatibility shims are forbidden.
- `apps/web/src/server.ts` — export `Brain`; default fetch behavior unchanged.
- `apps/web/src/server.test.ts` — mock/export coverage only; routing behavior
  unchanged.
- `apps/web/src/lib/brain/**` — new production Brain implementation and pure
  tests.
- `apps/web/test/brain/**` — isolated workerd entry/tests/fixtures named
  `*.workerd.ts` where appropriate.
- `apps/web/vitest.brain.config.ts` and
  `apps/web/wrangler.brain-test.jsonc` — isolated workerd configuration matching
  production compatibility flags and real SQLite/R2 bindings.
- `apps/web/scripts/brain-workerd-probe.mjs` — exact dry-artifact, persisted
  two-process restart/restore, and inspector memory probe.
- `apps/web/scripts/brain-production-report.mjs` — exact version/graph guards,
  full Website dry bundle/startup report, Brain artifact scan, browser-negative
  scan, and redacted machine-readable output under `/tmp`.
- `apps/web/scripts/brain-alchemy-probe.mjs` — bounded local graph start,
  readiness/config projection, timeout, and cleanup.
- `apps/web/scripts/brain-verify.mjs` — shared invocation coordinator and
  fail-fast process-group cleanup for every Brain gate.
- `apps/web/scripts/brain-verify-reports.mjs` — exact schema/invocation/pin/
  check/metric validation for the three redacted reports.
- `docs/architecture/agent-harness.md` — document the dormant Agent Core Brain
  foundation and unchanged live runner path.

### Planning records maintained only by the reviewer in the dirty root

- `plans/054-host-project-agent-core-runtime-in-brain.md`
- `plans/README.md`

The implementation executor reads this plan from the absolute root path or
receives it inlined. Do not copy planning/prototype files into the executor
worktree.

### Generated/temporary artifacts allowed but never committed

- `node_modules/**`, `.alchemy/**`, `.wrangler/**`, `apps/web/dist/**`;
- local workerd Durable Object/R2 state under a Plan-054-specific temporary
  directory;
- `/tmp/ditto-054-*` artifacts, profiles, inspector data, and redacted JSON
  reports;
- synthetic test credentials/canaries held only in test process memory.

### Out of scope — do not touch

- `apps/web/types/env.d.ts`; Alchemy inference should add the binding. STOP if a
  hand-written binding interface appears necessary.
- `apps/web/src/db/schema.ts`, migration 0012, D1 migration metadata,
  `apps/web/src/lib/agent-run-persistence.ts`, or D1 lifecycle vocabulary.
- Current `agent-run.ts`, `agent-run-service.ts`, `agent-control-service.ts`,
  `/api/agent/*`, tRPC, routes, browser components, SSE, cache, messages, or
  authentication/authorization.
- `apps/web/src/lib/secret-redaction.ts`; reuse it unchanged. A genuinely
  necessary general redaction fix requires a separate plan.
- `packages/sandbox-runner/**`, root `Dockerfile`, current Coding Agent JSONL,
  built-in local tools, control socket, callback path, metadata runner, provider
  auth/login/catalog flows, or current model behavior.
- Project Sandbox lifecycle/worktrees/backups/Preview, existing R2 backup code,
  Trusted Git Executor source/callers/image, Git import/publication, and all
  existing Container properties.
- Workflow, Queues, Operation Fences/results, Agent Run D1 settlement,
  reconciliation, scheduling, Session Mutation Lease, Project Operation Gate,
  Sandbox Activity Lease, Browser Gateway, Files UI, production jailed tools,
  terminal, or Exclusive Preview Presentation.
- Sandbox stable-to-`@next` migration, package/image/transport/session changes,
  or any no-GO fallback.
- Any new Worker, R2 bucket, D1 database/table, public route/hostname, service
  binding, Queue, KV namespace, Container, shell, process host, or separate Pi
  runner.
- Historical Plan 042 implementation branches/worktrees and reserved Plans
  043–053.
- Any cloud deploy/destroy/adoption/migration apply, generated secret-bearing
  config, real provider call, push, PR, or merge.

## Clean worktree Git workflow

Create a fresh worktree from the exact planned source. Do not reuse either
historical Plan 042 reviewer worktree.

```bash
set -euo pipefail
cd /home/ayan/ditto
test ! -e /home/ayan/ditto-worktrees/054-host-project-agent-core-runtime-in-brain
test -z "$(git branch --list advisor/054-host-project-agent-core-runtime-in-brain)"
git worktree add \
  -b advisor/054-host-project-agent-core-runtime-in-brain \
  /home/ayan/ditto-worktrees/054-host-project-agent-core-runtime-in-brain \
  878a6a3
cd /home/ayan/ditto-worktrees/054-host-project-agent-core-runtime-in-brain
test -z "$(git status --short)"
```

If the path or branch already exists, STOP and ask whether to reuse it. Never
remove or reset it yourself. Do not copy root `.env*`, Alchemy/Wrangler state,
prototypes, historical Plan 042 attempts, or plan files into the worktree.
Operator credentials may enter only through an explicitly authorized secure
inherited environment; none are needed for required local tests.

Use Conventional Commits, matching current history. Suggested logical commits:

1. `feat(brain): add durable session and checkpoint stores`
2. `feat(brain): host the Agent Core runtime`
3. `test(brain): verify workerd restart and boundaries`
4. `docs(brain): record dormant runtime foundation`

Do not push, open a PR, deploy, merge, or modify the maintainer root branch.

## Steps

### Step 1: Revalidate the clean baseline and exact public API boundary

1. Run the drift check and clean-worktree assertions.
2. Install the frozen root and independent runner dependencies.
3. Run app typecheck, current server/redaction/Agent Run regressions, runner
   typecheck/tests, and `git diff --check` before dependency edits.
4. Re-fetch current Cloudflare docs listed above. Inspect exact installed
   Alchemy beta.70 declarations for a low-level Durable Object hosted by the
   same Website and 30-second limits.
5. Pack exact Agent Core/Pi AI 0.80.10 tarballs into a Plan-specific `/tmp`
   directory with `npm pack`, extract them there, and inspect their package
   export maps/declarations without changing the worktree. Confirm root
   `AgentHarness`, `Session`, `SessionStorage`, `ExecutionEnv`, Pi AI
   models/credentials/TypeBox/faux, and the selected public OpenCode provider
   export exist; confirm Agent Core `./node` is separate and not required.
6. Treat the compatibility report facts in this plan as API-selection evidence
   only. Do not copy the prototype or historical implementation.

**Verify**:

```bash
set -euo pipefail
pnpm install --frozen-lockfile
npm ci --prefix packages/sandbox-runner
npm run typecheck --prefix apps/web
npm test --prefix apps/web -- --run \
  src/server.test.ts \
  src/lib/secret-redaction.test.ts \
  src/db/agent-run-migration.test.ts \
  src/lib/agent-run-persistence.test.ts \
  src/lib/trusted-git-executor.test.ts
npm run typecheck --prefix packages/sandbox-runner
npm test --prefix packages/sandbox-runner
git diff --check
test -z "$(git status --short)"
```

Expected: baseline green and clean; exact current source boundaries match. STOP
before package changes if a required public API/export is absent, if Alchemy
cannot host a new SQLite class on the Website, or if the baseline is red.

### Step 2: Add only the exact Agent Core, Pi AI, and workerd-test edges

Use pnpm so manifests and lock stay coherent:

```bash
pnpm --filter @ditto/web add --save-exact \
  @earendil-works/pi-agent-core@0.80.10 \
  @earendil-works/pi-ai@0.80.10
pnpm --filter @ditto/web add --save-dev --save-exact \
  @cloudflare/vitest-pool-workers@0.21.2
```

Add the exact root/web script values from **Commands you will need**, including
`brain:alchemy` and report validation. Root `brain:verify` runs after
`pnpm build` and before `runner:verify`, so the production report consumes the
fresh full Website artifact. Do not remove, reorder away, or weaken the existing
check/typecheck/default test/build/runner gates.

Add a version guard to `brain-production-report.mjs` that resolves actual package
locations and fails unless Agent Core/Pi AI/TypeBox/test-pool/Wrangler/workerd
match the accepted matrix. It must also fail if the web package directly or
transitively imports Coding Agent through its production entry.

Review `pnpm-lock.yaml`. The pool may add its exact nested toolchain, but current
web Wrangler 4.111, Alchemy beta.70, Effect beta.103, Alchemy Miniflare override,
Sandbox 0.12.3, Containers 0.3.7, Vite, Vitest, and unrelated TanStack resolutions
must not move.

**Verify**:

```bash
set -euo pipefail
pnpm install --frozen-lockfile
node --input-type=module <<'NODE'
import fs from "node:fs";
const web = JSON.parse(fs.readFileSync("apps/web/package.json", "utf8"));
if (web.dependencies["@earendil-works/pi-agent-core"] !== "0.80.10") throw new Error("Agent Core pin");
if (web.dependencies["@earendil-works/pi-ai"] !== "0.80.10") throw new Error("Pi AI pin");
if (web.dependencies["@earendil-works/pi-coding-agent"] !== undefined) throw new Error("Coding Agent forbidden");
if (web.devDependencies["@cloudflare/vitest-pool-workers"] !== "0.21.2") throw new Error("pool pin");
if (web.devDependencies.wrangler !== "4.111.0") throw new Error("web Wrangler drift");
NODE
npm run typecheck --prefix apps/web
```

Expected: exact three new edges/scripts, no Coding Agent web edge, frozen
install/typecheck pass, and no unrelated resolution drift. STOP instead of
adding an override, alias, patch, or broad platform upgrade.

### Step 3: Implement closed contracts, the denied ExecutionEnv, and Brain SessionStorage

Create `contracts.ts`, `execution-env.ts`, `session-storage.ts`, and pure tests.

1. Export all identity/data caps and typed safe result unions. Validate UTF-8
   byte lengths at every persistence/RPC boundary; validate positive safe
   integer epochs/turns/generations/cursors.
2. Implement the complete public `ExecutionEnv` interface with one session-
   scoped cwd-like identifier but no actual path authority. Every method returns
   typed failure and never throws; `cleanup()` is best-effort/no-op.
3. Implement the complete public `SessionStorage` contract with private indexes,
   deep-cloned reads, collision-checked IDs, strict tree/leaf validation, and a
   canonical checkpoint export. Do not subclass/copy Pi's in-memory class.
4. Reject unsupported prototypes, cycles, non-finite numbers, duplicate IDs,
   missing parents/targets, invalid entry discriminants, cross-session metadata,
   and oversized/deep values.
5. Test exact Agent Core leaf/path/label semantics against a small independent
   fixture. No test may import Agent Core `./node` or Coding Agent.

**Verify**:

```bash
npm test --prefix apps/web -- --run \
  src/lib/brain/contracts.test.ts \
  src/lib/brain/execution-env.test.ts \
  src/lib/brain/session-storage.test.ts
npm run typecheck --prefix apps/web
```

Expected: complete adapters compile against exact public interfaces; all bounds,
clone/isolation, tree, leaf, disposal, and denied-substrate tests pass.

### Step 4: Implement immutable payload-first Safe Checkpoints

Create `checkpoint-store.ts` and tests. Keep storage logic independent of the
AgentHarness so fault ordering is deterministic.

1. Initialize the checkpoint tables from the Brain constructor, but put schema
   SQL/constants next to the store.
2. Validate, redact, canonicalize, gzip, and hash the exact session payload.
   Bound decompression and reject any mismatch before JSON parse/session restore.
3. Implement SQLite publication in one `transactionSync` with test-only fault
   injection after chunks, after manifest, and before pointer CAS. Production
   construction passes no hooks.
4. Implement immutable R2 publication before SQLite manifest/pointer CAS. Use
   exact conditional semantics from current installed types. Validate a
   pre-existing same key by metadata/checksum/length; never overwrite.
5. Implement expected-current generation CAS and fail stale writers without
   pointer movement.
6. Implement restore for both storage kinds, including chunk count/order/length,
   R2 missing/body checks, SHA-256, gzip/uncompressed cap, format version,
   identity, tree, and leaf.
7. Expose orphan enumeration metadata for future GC tests, but do not delete
   payloads or add retention policy.

Required pure/real-storage cases:

- empty and ordinary checkpoint round trip;
- exact threshold stays SQLite; threshold + 1 uses R2 (inject a lower threshold
  or deterministic incompressible fixture in tests only);
- every chunk at most 64 KiB and no single unbounded BLOB;
- missing/duplicate/reordered/wrong-length chunks fail;
- SQLite fault stages roll back payload/manifest/pointer;
- R2 put failure and post-put/pre-manifest failure keep old pointer;
- stale generation cannot replace current;
- duplicate key with mismatched metadata fails;
- bad compressed length/hash/gzip/uncompressed length/version/identity/tree/leaf
  fails before Agent Core sees state;
- concrete and pattern-shaped synthetic canaries are absent from chunks, R2
  bytes, manifests, errors, and returned metadata;
- maximum accepted 4 MiB uncompressed/2 MiB compressed payloads are encoded and
  restored under the 8 MiB temporary-buffer budget, with workerd peak memory
  measured rather than inferred.

**Verify**:

```bash
npm test --prefix apps/web -- --run \
  src/lib/brain/checkpoint-store.test.ts
```

Expected: complete threshold, corruption, fault-ordering, CAS, and canary matrix
passes. STOP if an R2 payload must be referenced before a successful put or if a
large checkpoint must be buffered beyond the declared memory caps.

### Step 5: Implement the bounded redacted monotonic event journal

Create `event-journal.ts` and tests.

1. Define the closed projection and reject unknown fields/kinds.
2. Reuse `StreamingSecretRedactor` for assistant deltas with one redactor per
   active identity. Flush before every non-text boundary and at settlement.
3. Apply `redactStructured` only after closed payload construction and before
   byte-cap validation. Do not pass raw Pi objects into it.
4. Insert with parameterized SQL and use SQLite's monotonic integer primary key.
5. Implement `readEvents(afterCursor, countLimit, byteLimit)` with strictly
   greater cursors, stable ascending order, and stop-before-overflow behavior.
6. Return explicit truncation metadata for bounded text; reject identities or
   event envelopes that cannot fit safely.

Tests cover split concrete/provider/private-key-shaped canaries, UTF-8 byte
edges, invalid cursor/identity/kind, tool payload exclusion, count/byte caps,
strictly-after replay, cross-session/run/epoch isolation, and monotonic order.
Add a multi-megabyte unterminated private-key-shaped stream and assert the
pending-input budget never exceeds 8 KiB, output is one marked redaction/
truncation event, continuation bytes are discarded through the next non-text
boundary, and safe text after that boundary is emitted normally.

**Verify**:

```bash
npm test --prefix apps/web -- --run \
  src/lib/brain/event-journal.test.ts \
  src/lib/secret-redaction.test.ts
```

Expected: no canary crosses SQLite/returned events, order is monotonic, and raw
provider/tool data cannot be represented by the projection.

### Step 6: Compose the exact AgentHarness runtime, credentials, tools, and cache

Create `model-runtime.ts`, `runtime.ts`, and tests.

1. Build Pi AI models with `InMemoryCredentialStore` and an explicit
   ambient-denying `AuthContext`. Register only the exact public OpenCode
   provider needed for `opencode/deepseek-v4-flash-free`. The Brain constructor
   retains no credential or credential-bearing config. After test/runtime flag
   and identity authorization, lazily read the existing operator binding,
   rejecting nonempty credentials shorter than eight code points, and seed only
   the new live runtime's closure. Product startup with runtime disabled must
   not read, resolve, retain, or log it.
2. Provide test dependency injection for the public faux provider. Tests use a
   synthetic in-memory credential or no credential and never inspect ambient
   provider variables.
3. Construct `Session` over `BrainSessionStorage`, then direct `AgentHarness`
   with static system prompt, `{ skills: [], promptTemplates: [] }`, one-at-a-
   time follow-up policy, bounded stream/retry settings, product tools `[]`, and
   exact test echo only in test mode.
4. Subscribe to events and project only the Step 5 closed kinds. Wrap the
   selected provider's event stream so its active counter remains positive from
   dispatch until terminal stream completion/error/abort; headers are not
   completion. Track tool execution start/end separately. Never equate Agent
   Core `save_point` alone with a Safe Checkpoint.
5. Automatically checkpoint only after the prompt settles, harness is idle,
   counters are zero, and event redaction has flushed. Explicit checkpoint uses
   the same guard. On prompt/stop failure or unresolved action, keep the prior
   current generation.
6. Implement the non-blocking exact-identity test Stop path from **Runtime and
   RPC boundary** with public `abort()` and its typed cleared-queue result. It
   must reach an active prompt without waiting behind the per-session mutation
   queue. Do not call Coding Agent `clearQueue`, settle D1, or create an
   interruption fence.
7. Implement the four-session LRU: touch on use, evict only idle entries,
   reconstruct from current checkpoint, reject capacity when all entries are
   active, and never use surviving maps in restore assertions. Serialize every
   same-session create/restore/run/checkpoint/evict operation through one
   queue/mutex; Stop never enters that queue and only its settlement does.
   Serialize only the short cache admission/eviction decision
   across sessions. Add deterministic barriers proving two interleaved first
   calls cannot construct duplicate live sessions, checkpoint during a turn, or
   evict an entry between lookup and use.
8. Return only safe typed results. Redact then cap errors to machine codes; do
   not return raw provider/tool prose.

Node tests use faux streams for successful text/tool turns, malformed tool args,
stop races, checkpoint eligibility, cache eviction, and credential-negative
assertions. Include a stream that delivers headers then stalls; checkpoint must
remain `not_quiescent` until terminal stream completion/error/abort. Test
credential lengths 0, 1, 7, 8, and a long value without recording any value.
The next step repeats mandatory runtime behavior in real workerd.

**Verify**:

```bash
npm test --prefix apps/web -- --run \
  src/lib/brain/model-runtime.test.ts \
  src/lib/brain/runtime.test.ts
npm run typecheck --prefix apps/web
```

Expected: direct AgentHarness only, production zero-tool mode, exact test tool,
quiescence guard, stop behavior, LRU reconstruction, and no durable credential
surface pass.

### Step 7: Add the Brain class and bind it without cutting over traffic

1. Implement `Brain extends DurableObject<WebsiteEnv>` in `brain.ts`, accepting
   the physical fact that co-located Durable Objects receive the Website
   environment. Immediately derive one private allowlisted non-secret config
   from only `BACKUP_BUCKET` and the two Brain flags; pass only that config into
   Brain-owned modules. Do not read or retain the fallback credential in the
   constructor. An exact guarded method may lazily read it only after authorized
   test execution and must pass it directly into the disposable live runtime
   closure. No Brain module API may
   accept the full env. Do not read/destructure DB, Sandbox, TrustedGitExecutor,
   GitHub, Better Auth, project env, R2 S3 credentials, or encryption keys.
   Add static source/artifact guards proving those binding names are absent from
   `apps/web/src/lib/brain/**` except one explicit denylist test fixture.
2. Initialize schema synchronously in the constructor. Do not persist project
   identity from a disabled/read-only/execution call. Only gated
   `initializeForTest` may establish it in this plan; Plan 043 adds the trusted
   fenced production bootstrap.
3. Add only the exact RPC methods from **Locked initial contracts** and
   **Runtime and RPC boundary**. Runtime-disabled calls return one safe disabled
   result and perform no model/storage/identity write. Test controls reject
   unless test mode is true.
4. Export `Brain` from `apps/web/src/server.ts`. Update only server mocks/export
   coverage; preserve default fetch byte-for-byte except the export line.
5. Add one Alchemy low-level Durable Object and Website env binding, hard-false
   flags, and 30-second CPU metadata. Preserve D1/R2/Sandbox/Trusted Git/routes/
   assets/compatibility and every existing binding/class/name.
6. Keep `apps/web/types/env.d.ts` unchanged and prove inferred types include the
   new binding.
7. Do not add `Brain` to any route/component/service. No production caller exists.

**Verify**:

```bash
set -euo pipefail
npm run typecheck --prefix apps/web
npm test --prefix apps/web -- --run src/server.test.ts src/lib/brain
rg -n 'Brain|Cloudflare\.DurableObject|BRAIN_RUNTIME_ENABLED|BRAIN_TEST_MODE|cpu_ms' \
  alchemy.run.ts apps/web/src/server.ts apps/web/src/lib/brain
! rg -n 'Brain' apps/web/src/routes apps/web/src/components \
  apps/web/src/lib/agent-run.ts apps/web/src/lib/agent-run-service.ts \
  apps/web/src/lib/agent-control-service.ts --glob '!**/*.test.*'
git diff --exit-code 878a6a3 -- apps/web/types/env.d.ts
```

Expected: one class/binding/migration declaration, runtime hard-disabled, no
product caller/route, inferred env type, and existing routing tests green.

### Step 8: Add real workerd implementation tests and a full process restart probe

Add an isolated workerd entry that imports the exact production `Brain` class
and modules. The test entry may route fixed test HTTP paths to a Brain stub; the
production Website entry may not. Use real SQLite and local R2 bindings,
`BRAIN_RUNTIME_ENABLED=true`, and `BRAIN_TEST_MODE=true` only in test config.
Use compatibility flags matching the generated Website artifact.

`brain:test` through `cloudflareTest()` must cover:

1. exact public package/runtime boot without any module URL definition;
2. product provider registry construction with ambient auth disabled and no
   network request;
3. actual valid echo tool call plus missing/wrong TypeBox arguments, proving
   unmodified validation and zero execution on invalid calls;
4. two concurrent isolated Pi Agent Sessions in one Brain, including distinct
   context, storage, events, pointers, and no peer marker;
5. small SQLite, large R2, and maximum accepted 4-MiB-uncompressed/
   2-MiB-compressed Safe Checkpoints with real DO SQL/local R2 and measured peak;
6. payload-before-pointer event/manifest/pointer atomicity, fault stages, exact
   manifest event cursor, and stale generation CAS;
7. corruption/missing R2 fail-closed restore;
8. event cursor monotonicity, replay caps, split-canary redaction, and bounded
   multi-megabyte unterminated private-key-shaped input;
9. Stop concurrently reaches a deterministic unresolved stream/tool without
   waiting behind the mutation queue and keeps the previous Safe Checkpoint
   current; stale/wrong/duplicate/completion-race Stop follows the locked result
   rules;
10. runtime-disabled calls under a second false-binding fixture leave identity
    and every table unchanged;
11. project/session/run/epoch/turn mismatch rejection and
    `piAgentSessionId === workspaceSessionId` restore validation;
12. deterministic same-session interleaving cannot duplicate restore/runtime,
    checkpoint mid-turn, or evict between lookup/use;
13. no successful ExecutionEnv file/process operation and no caller-defined
    tool/model/capability.

`brain:workerd` must build an exact production-`Brain` implementation artifact
with Wrangler. It imports the real production class/modules and uses no runtime
mock; only its fixed outer test driver and test-only bindings differ from the
Website. Run that artifact with `no_bundle` in local workerd using Plan-specific
persisted state:

1. start workerd process A; create two sessions, run/checkpoint both, capture
   boot counter and inspector baseline/peak;
2. terminate the entire Wrangler/workerd process, not just clear a map;
3. start process B with the same local persisted DO/R2 state; assert constructor
   boot counter advanced and live cache begins empty;
4. restore both from SQLite/R2 and run follow-ups that observe only their prior
   marker; assert no test-only `/tmp`/heap authority;
5. report exact package versions, artifact hash/size, process IDs only as local
   observations, boot counts, test IDs, heap baseline/peak/delta, and durations;
   never report synthetic credential/canary values.

The script must clean up its child processes and temporary state on success,
error, and signal. Missing inspector/startup/restore data is failure, never zero
or `not-run`.

**Verify**:

```bash
set -euo pipefail
npm run brain:test --prefix apps/web
npm run brain:workerd --prefix apps/web
npm test --prefix apps/web
```

Expected: workerd suite passes; the second process proves fresh construction and
durable restoration; default web Vitest does not discover workerd files; no
network/provider credential is used.

### Step 9: Measure the full Website artifact and enforce graph/security/resource gates

Implement `brain-production-report.mjs` to consume a fresh
`npm run build --prefix apps/web` result and fail closed.

1. Locate the generated exact production Website Wrangler config/artifact. Run
   Wrangler dry-bundle/startup tooling into `/tmp/ditto-054-*`; do not apply
   resources. Parse Wrangler metadata rather than summing guessed chunks. Start
   that exact artifact in local workerd with its hard-false Brain flags, request
   an ordinary unauthenticated Website path, require existing app/redirect
   behavior, and prove startup/read-only inspection never reads the fallback
   credential or writes Brain identity. Do not add a Brain route.
2. Require the production artifact below 10 MiB compressed and at or below the
   7.5 MiB architecture target, with measured local startup below 1,000 ms.
   Record the 750 ms deployed-p95 target as deferred, not locally proven.
3. The hard-disabled production artifact cannot exercise sessions. Generate a
   separate **full-graph test artifact** from the generated production Wrangler
   config by changing only `main` to `test/brain/full-website-driver.workerd.ts`,
   Brain flags to true, and persistence paths. The fixed driver imports the
   original production default entry and exact production `Brain` export,
   delegates all ordinary requests to the original entry, and exposes only
   fixed local test routes. No alias, define, external, compatibility flag,
   binding except test persistence/flags, or source module may differ. Emit
   bundler metafiles for both artifacts and fail unless every production input
   path plus content hash appears identically in the test artifact; additional
   inputs may only be the fixed driver/test protocol. Scan both graphs.
4. Use inspector measurements from that full-graph test artifact, not the
   smaller Brain probe. Measure its idle baseline, ordinary two-session use,
   and every maximum admissible cache combination, including four maximum-size
   sessions and the 16 MiB canonical-byte limit while serializing/restoring the
   largest accepted uncompressed/compressed payload. Full isolate peak must stay
   at or below 96 MiB and below 128 MiB; temporary checkpoint buffers stay
   within 8 MiB. If it fails, lower count/byte caps and rerun; never increase
   them. Report production and full-graph artifact hashes separately.
5. Scan the exact Brain implementation artifact for forbidden graph strings/
   modules: Coding Agent, Agent Core `/node`, `jiti`, default resource loaders,
   CLI/TUI, `child_process`, worker threads, Coding Agent tools, JSONL session
   managers, local process/socket paths, aliases/patches, and a module URL
   definition.
6. Scan the full Website server artifact to prove Agent Core/Pi AI are server-
   only, no Coding Agent/jiti/module-URL shim entered through Brain, and Brain
   class/binding remains present.
7. Scan every generated client asset and fail on Agent Core/Pi AI/provider
   package names, Brain RPC symbols, checkpoint prefixes, fallback credential
   binding names, or synthetic test markers.
8. Run version/export/lock guards. Fail if web transitive production paths reach
   Coding Agent or TypeBox is not 1.1.38.
9. Inspect generated Alchemy/Worker metadata through a safe projection only:
   one `Brain` durable-object namespace/class, one new SQLite class migration,
   existing Sandbox/TrustedGitExecutor classes unchanged, existing R2 bucket,
   expected compatibility flags, 30-second CPU metadata, and hard-false runtime
   flags. Never print binding values.

Implement and run `brain-alchemy-probe.mjs`; never invoke bare interactive
`pnpm dev` as a completion gate. The script spawns `pnpm dev` from repo root in
a new process group, with a 120-second hard timeout and at most 2 MiB captured
stdout/stderr. Readiness is the first bounded line matching Alchemy's current
`Done: <positive integer> succeeded` output plus existence of the generated
Website config. Project only resource/class/binding/migration names,
compatibility flags, limits, and Brain flags from that config; assert one Brain
SQLite class, existing Sandbox/TrustedGitExecutor classes, existing R2 binding,
and hard-false flags. Then send SIGINT to the process group, require exit within
10 seconds, fall back to SIGTERM for 5 seconds, then SIGKILL and fail. Install
the same cleanup on error and SIGINT/SIGTERM; reject orphan child PIDs and any
output matching secret-bearing key/value patterns. Write only the validated safe
report. Do not run `alchemy deploy`, including without `--dry-run`; no cloud
command is needed for `DONE-local`. If local Alchemy needs unavailable secrets,
provide them only through an operator-approved secure inherited environment or
STOP at this local graph gate. Never copy root env files or weaken the gate.

**Verify**:

```bash
set -euo pipefail
npm run build --prefix apps/web
npm run brain:production-report --prefix apps/web
npm run brain:alchemy --prefix apps/web

# Production Brain source cannot import/use forbidden package/runtime seams.
# Artifact/test scripts contain the rejection needles by design and are checked
# by brain:production-report instead of this source grep.
! rg -n "from [\"']@earendil-works/pi-coding-agent|from [\"']@earendil-works/pi-agent-core/node|jiti|DefaultResourceLoader|createAgentSession|SessionManager|JsonlSession|child_process|worker_threads|control-channel|rpc-entry|file:///bundle/index\\.js" \
  apps/web/src/lib/brain
! rg -n '\b(DB|Sandbox|TrustedGitExecutor|GITHUB_|BETTER_AUTH_|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|AI_CREDENTIALS_ENCRYPTION_KEY)\b' \
  apps/web/src/lib/brain --glob '!**/env-denylist.test.ts'

# No package/config patch, alias, postinstall mutation, or module-URL shim is authorized.
# Test/report code contains rejection needles and validates them separately.
! rg -n 'patchedDependencies|pnpmfile|patch-pi|jiti-stub|import\.meta\.url.*file:///bundle|resolve\.alias' \
  package.json pnpm-workspace.yaml apps/web/package.json apps/web/vite.config.ts

# Pi stays server-only and no product caller exists.
! rg -n '@earendil-works/pi-' apps/web/src/components apps/web/src/routes \
  --glob '!**/*.test.*'

git diff --exit-code 878a6a3 -- \
  apps/web/src/db/schema.ts apps/web/migrations \
  apps/web/src/lib/agent-run-persistence.ts \
  apps/web/src/lib/agent-run.ts \
  apps/web/src/lib/agent-run-service.ts \
  apps/web/src/lib/agent-control-service.ts \
  apps/web/src/routes packages/sandbox-runner Dockerfile \
  apps/web/src/lib/trusted-git-executor.ts \
  apps/web/src/lib/sandbox-backup.ts
```

Expected: the exact full Website artifact starts in local workerd and its
ordinary request smoke passes; all local measurements pass; no browser leakage,
forbidden graph, shim, product caller, or out-of-scope diff exists. STOP if the
full artifact cannot start or be measured, if local Alchemy cannot host the
class, or if limits are exceeded.

### Step 10: Document the dormant foundation, run the full repository gate, and report evidence

Update `docs/architecture/agent-harness.md` with a concise current-state section:

- the live `/api/agent/*` → Project Sandbox Coding Agent runner remains current;
- the Website now also hosts a dormant Agent Core Brain foundation;
- D1 / Brain SQLite / R2 / memory authority split;
- Brain-owned SessionStorage and denied ExecutionEnv, static resources, product
  zero-tool mode, in-memory ambient-denied credentials;
- checkpoint threshold/order/integrity and bounded event cursors;
- no Workflow, Browser Gateway, jail, Git, Preview, cutover, or Sandbox `@next`;
- local `DONE-local` evidence versus deferred real-provider/deployed admission.

Run focused tests, all Brain gates, default app tests/build, independent runner,
full root verification, diff/scope/security guards, and a final clean local
Alchemy start/stop if earlier graph metadata changed.

The executor reports to the reviewer only redacted metadata:

- date, branch/worktree, implementation commits, and exact changed-file list;
- exact Agent Core/Pi AI/TypeBox/pool/Workers tool/Alchemy/Sandbox/Containers
  versions;
- pure/workerd/default/full test counts and named matrix results;
- two-process restart boot counts and restore booleans;
- SQLite/R2 threshold/fault/corruption result booleans;
- full Website compressed bytes, startup profile values, Brain artifact bytes,
  and two-session heap baseline/peak/delta;
- safe class/binding/migration/limit/flag names only;
- forbidden graph, browser-negative, secret-negative, and scope results;
- explicit `provider_stream: not-authorized`, `cloud_deploy: not-run`, and first
  unrun production-admission gate;
- no prompts, messages, tool content, credentials, environment/binding values,
  raw generated config, logs, or canary values.

Status rules:

- `DONE-local`: every Step 1–10 local gate passes, exact current production
  modules and full Website artifact are measured within local bounds, and only
  real-provider/deployed admission remains unavailable/unauthorized.
- `DONE`: not attainable in this local-only plan. It requires a fresh paid-plan
  admission plan and release-specific deployed/soak evidence.
- `BLOCKED-local (<first failed gate>)`: any local API, package graph, adapter,
  TypeBox, checkpoint/event, restart/restore, Alchemy, artifact, memory, startup,
  bundle, security, scope, or full-repository gate fails.
- A future present-but-failing real-provider/deployed gate is production
  `BLOCKED`/no-go evidence; it must not be relabeled as local success or trigger
  a runner fallback.

**Verify**:

```bash
set -euo pipefail
pnpm install --frozen-lockfile
npm ci --prefix packages/sandbox-runner
npm run brain:test --prefix apps/web
npm run brain:workerd --prefix apps/web
npm run build --prefix apps/web
npm run brain:production-report --prefix apps/web
npm run brain:alchemy --prefix apps/web
pnpm verify
git diff --check
git status --short
git diff --name-only 878a6a3..HEAD
```

Expected: every required local gate passes, the implementation worktree is clean
after commits, and every changed path is in Scope. The reviewer, not the
executor, updates Plan 054's root status/evidence and `plans/README.md`.

## Test plan

### Pure/Node tests

- contracts: UTF-8 IDs, epochs/turns/generations/cursors, prompt and serialized
  bounds, safe unions, unsupported JSON values/depth;
- ExecutionEnv: every file/process operation returns typed denied result and
  cleanup never throws;
- SessionStorage: metadata, ID collision, append, leaf movement, labels, path to
  root, clone isolation, invalid/cyclic/orphan/duplicate trees, disposal;
- checkpoint store: canonical redaction, gzip/hash, threshold/chunks, immutable
  R2, CAS, every fault point, corrupt/missing payload, identity/tree/leaf, no
  canary;
- event journal: closed projection, split-secret redaction, boundary flush,
  monotonic strictly-after replay, count/byte caps, cross-identity denial;
- model/runtime: ambient auth absent, in-memory credential only, product zero
  tools, test echo only, AgentHarness quiescence, stop race, safe error, LRU
  capacity/eviction/restore, same-session RPC interleaving and duplicate-load
  prevention.

### Real workerd tests

- exact production Brain module boot with no definition/alias/patch;
- product provider construction without network/ambient auth;
- real unmodified TypeBox valid/missing/wrong tool calls;
- two concurrent isolated sessions;
- real DO SQLite + local R2 small/large publication;
- payload-before-pointer, stale CAS, corruption, and missing object;
- event cursor/redaction;
- unresolved stop leaves old Safe Checkpoint;
- runtime-disabled and test-gate behavior;
- complete identity mismatch matrix;
- no local substrate or caller-defined capability.

### Process restart and resource tests

- exact dry artifact starts in local workerd;
- process A checkpoints two sessions; entire process stops;
- process B reruns constructor with empty cache and restores both from persisted
  SQLite/R2;
- follow-up context is session-isolated and does not re-execute prior tool;
- inspector reports actual isolate heap baseline/peak/delta;
- full Website compressed size/startup and server/client graph scans are
  machine-parsed, never estimated.

### Regression tests

- Worker routing/export test;
- secret redaction suite;
- Plan 041 migration/persistence suite;
- Plan 047 Trusted Git suite;
- default app tests/build;
- independent current sandbox-runner typecheck/tests/build;
- complete `pnpm verify` with Brain gate included.

## Done criteria

All local criteria must hold for `DONE-local`:

- [ ] Website directly pins only Agent Core `0.80.10` and Pi AI `0.80.10` for
      Brain; TypeBox resolves to `1.1.38`; test pool is exact `0.21.2`.
- [ ] No Coding Agent package/import, Agent Core `./node`, private import,
      alias, patch, postinstall mutation, externalized host, or module URL
      definition exists in the Brain graph.
- [ ] One `Brain` SQLite Durable Object is exported/bound by the existing
      Website with one generated new-SQLite-class migration, 30-second CPU
      metadata, and hard-false production execution flags.
- [ ] Existing Website fetch, D1/R2/Sandbox/Trusted Git/routes/assets/bindings,
      and inferred Env ownership remain unchanged except the exact Brain edge.
- [ ] Brain has a complete denied ExecutionEnv and custom SessionStorage; no
      production in-memory/JSONL/file SessionStorage authority exists.
- [ ] Product tools are empty; test mode exposes exactly one code-owned echo;
      caller data cannot define a tool/model/capability; Plan 054 exports no
      production execution or identity-initialization RPC.
- [ ] Credentials use one in-memory store with ambient env/file auth disabled,
      values shorter than eight code points fail closed, and credentials are
      absent from every durable, untrusted, artifact, error, and report surface.
- [ ] Safe Checkpoint publication is quiescent through terminal provider-stream
      and tool completion, payload-before-pointer, immutable, generation-CAS
      protected, chunked in SQLite at/below 512 KiB, and immutable R2 above it;
      one transaction binds `checkpoint_published` cursor, safe-turn manifest,
      and current pointer.
- [ ] Restore validates compressed/uncompressed lengths, hash, gzip, version,
      identity, tree, and leaf before Agent Core construction.
- [ ] Closed redacted events have monotonic strictly-after cursors and exact
      string/event/replay caps; pending redactor input never exceeds 8 KiB;
      raw Pi/provider/tool data cannot persist.
- [ ] At most four live sessions/16 MiB canonical bytes are cached; active
      sessions are not evicted; same-session operations cannot duplicate/race;
      non-blocking exact Stop reaches an active turn; restart/eviction
      reconstructs from current checkpoint, never heap/tmp.
- [ ] Real workerd accepts valid and rejects missing/wrong TypeBox echo inputs
      with unmodified packages.
- [ ] Two sessions remain isolated through concurrent execution, full process
      restart, restore, events, checkpoints, and follow-up context.
- [ ] Exact production-Brain implementation artifact passes functional local
      workerd/restart tests; exact production Website artifact starts disabled,
      performs no credential read/identity write, and passes an ordinary request;
      the full-graph test artifact is a verified production-input superset and
      passes fixed session/resource routes.
- [ ] Exact Brain artifact forbidden-graph scan passes; full Website server has
      the dormant class and no shim/Coding Agent edge; client assets contain no
      Pi/Brain/provider graph or credential binding.
- [ ] Production Website is at most 7.5 MiB compressed (and below the 10 MiB
      platform hard limit) and starts below 1,000 ms; the verified full-graph
      test artifact's ordinary and every maximum-admissible-cache workerd peak
      is at most 96 MiB (below 128 MiB), with temporary buffers at most 8 MiB.
- [ ] The bounded `brain:alchemy` probe proves the existing Website hosts one
      new Brain class/binding/migration, terminates its process group, and makes
      no cloud apply or unrelated graph change.
- [ ] Current D1 Agent Run/schema/request path, Project Sandbox runner, Sandbox
      package/image, Trusted Git Executor, Preview, Git, and browser are unchanged.
- [ ] `pnpm verify`, focused/pure/workerd/restart/report/Alchemy tests,
      versioned report-schema validation, typecheck, both builds, runner
      verification, and `git diff --check` pass.
- [ ] Exact changed-file scope passes; no secret value or generated config is
      committed/reported; no cloud/provider/push/merge action ran.
- [ ] Documentation distinguishes dormant local foundation from live path and
      deferred mandatory production admission.
- [ ] Reviewer records accurate `DONE-local` or first failed gate; no historical
      compatibility metric is reused as Plan 054 execution evidence.

## STOP conditions

Stop and report; do not improvise if:

1. Exact public unmodified Agent Core/Pi AI 0.80.10 cannot boot in real workerd
   through the production modules without a definition, alias, patch, private
   import, externalized host, or Node adapter.
2. The implementation needs `@earendil-works/pi-coding-agent`, Agent Core
   `./node`, Coding Agent root/CLI/TUI/resources/tools, jiti, a general process,
   a socket, or a second runner/Worker/Container.
3. Unmodified TypeBox cannot accept valid and reject missing/wrong required
   echo inputs through the actual Agent Core/Pi AI tool path.
4. The selected public Pi AI provider graph cannot construct with ambient auth
   disabled, a configured credential shorter than eight code points must be
   accepted, or a credential must enter process env, Project Sandbox, RPC input,
   SessionStorage, SQLite, R2, events, errors, logs, browser assets, or reports.
5. A production `SessionStorage` requires JSONL, local files, `/tmp`,
   `InMemorySessionStorage`, or surviving heap state for correctness.
6. The provider stream cannot be wrapped through its terminal completion/error/
   abort, Agent Core's event/save semantics cannot identify a quiescent boundary
   without exposing an unresolved model/tool action as current, or Stop cannot
   reach an active operation without waiting behind its mutation queue.
7. Checkpoint bytes cannot be completed and validated before manifest/pointer,
   stale writers can move the pointer backward, R2 cannot provide insert-only
   behavior, or corruption can reach Agent Core before rejection.
8. Event text cannot be redacted across chunk boundaries under the 8 KiB
   pending-input budget, raw Pi/provider/tool values must be serialized, cursors
   are not monotonic/strictly-after, checkpoint kind/cursor cannot be bound
   atomically with its pointer, or caps require silent unmarked truncation.
9. Two sessions share mutable state, events, tools, storage, credentials, or
   checkpoint pointers; same-session interleaving can create duplicate live
   objects or race run/checkpoint/eviction; Stop must wait behind the mutation
   queue; active-session cache pressure requires unsafe eviction.
10. Full process restart cannot prove a new constructor/empty cache and restore
    from persisted SQLite/R2, or a test proposes map clearing as equivalent.
11. The existing Website cannot host/bind the new SQLite class through exact
    Alchemy beta.70, the bounded local Alchemy probe cannot reach readiness and
    terminate without orphan processes, Env inference requires manual drift, or
    another Worker/R2/D1/Container/resource is required.
12. The implementation requires changing D1 authority/lifecycle, current
    `/api/agent/*`, browser/SSE, Workflow/fences/leases, production jail/tools,
    Git/Preview, current Project Sandbox runner, or Sandbox `@next`.
13. The exact production Website artifact/bundle/startup, full-graph artifact
    equivalence, full-graph actual isolate memory, or client/server graph cannot
    be measured; compressed size exceeds 7.5 MiB, startup reaches 1,000 ms, or
    ordinary/maximum-cache peak exceeds 96 MiB after permitted cap reductions.
14. The exact test pool cannot coexist without unrelated Alchemy/Effect/
    Wrangler/Miniflare/Vite/Vitest/Sandbox/Containers/dependency migration.
15. Local Alchemy proposes a renamed/replaced existing resource, cannot emit one
    new SQLite class, requires cloud apply, or requires copying/printing secret
    environment state.
16. Any real provider call, cloud deploy/destroy/adoption/migration, public
    diagnostic route, push, PR, merge, or non-`dev` stage operation would be
    needed for `DONE-local`.
17. Any secret value appears in source, diff, fixture, checkpoint, R2 object,
    SQLite/event row, error, log, snapshot, artifact, report, or plan evidence.
18. A required verification fails twice after one reasonable correction inside
    Scope, the baseline drifts materially, or a fix needs an out-of-scope file.

## Maintenance notes

- Plan 054 replaces the executable Brain-runtime position formerly assigned to
  historical Plan 042. Reviewers should reject any attempt to revive Plan 042's
  Coding Agent `ResourceLoader`, `SettingsManager`, JSONL, local-tool, or module
  URL assumptions.
- Reserved Plan 043 adds Workflow ownership, Operation Fences/results,
  duplicate delivery, D1 state advancement/finalization, and uncertain-action
  interruption. Plan 054 must not imply idempotent model/tool dispatch.
- Reserved Plan 044 adds scheduling/gates/activity leases. Plan 046 adds the
  real Brain-jailed file capability adapter. Product mode remains zero-tool
  until those boundaries land.
- The existing Project Sandbox runner remains the sole live path until a later
  atomic Brain/Sandbox cutover. Do not ship dual runners as fallback choices.
- On every intentional Agent Core, Pi AI, TypeBox, provider, Wrangler, workerd,
  Vite, Alchemy, or test-pool upgrade, rerun exact public-graph, workerd TypeBox,
  two-session restart/restore, bundle/startup/memory, server/client, and
  forbidden-substrate gates. No compatibility shim is grandfathered.
- A fresh paid-plan production-admission plan must first converge the Alchemy v2
  graph and Plan 041 D1 migration, then prove the exact release's real-provider
  streaming, deployed cold starts, two-session concurrency, eviction/restart,
  memory/CPU, class migration, recovery, and six-hour soak. Local results are
  necessary but not sufficient.
- Review checkpoint generation/CAS and R2 immutability, event redaction/ordering,
  credential closure lifetime, runtime-disabled production graph, and actual
  artifact measurements more closely than file naming or formatting.
