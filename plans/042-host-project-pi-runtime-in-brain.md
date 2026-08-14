# Plan 042: Host the project Pi Runtime in Brain

> **REJECTED — DO NOT EXECUTE.** This historical plan targeted the public
> `@earendil-works/pi-coding-agent` root. Its mandatory workerd path stopped at
> the root's static `jiti`/Node/resource graph, and neither implementation
> attempt is mergeable. The later exact Agent Core compatibility spike passed.
> [`Plan 054: Host the project Agent Core Runtime in Brain`](./054-host-project-agent-core-runtime-in-brain.md)
> is the replacement route. Keep this file only as execution evidence; do not
> retry it, cherry-pick its branches, or use it as a dependency.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 878a6a3..HEAD -- \
>   package.json pnpm-lock.yaml alchemy.run.ts \
>   apps/web/package.json apps/web/vite.config.ts apps/web/types/env.d.ts \
>   apps/web/src/server.ts apps/web/src/lib/secret-redaction.ts \
>   apps/web/src/db/schema.ts apps/web/src/lib/agent-run-persistence.ts \
>   packages/sandbox-runner/package.json \
>   packages/sandbox-runner/src/run-git-metadata.ts \
>   packages/sandbox-runner/src/runner-model.ts
> ```
>
> If an in-scope or load-bearing reference path changed, compare the current
> state excerpts below with live code. STOP if Alchemy is no longer the sole
> Worker owner, the Website no longer uses `src/server.ts`, D1 is no longer
> authoritative for Agent Runs, Pi pins changed, or the accepted Alchemy / D1 /
> Trusted Git foundations are absent. Preserve the maintainer's dirty plan
> records by working in a clean dedicated worktree; never stash, reset, clean,
> or copy `.env*`, `.alchemy`, or `.wrangler` state from the root checkout.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH — direct Pi execution in workerd, Worker bundle/startup limits,
  Durable Object recovery, checkpoint integrity, and credential boundaries
- **Depends on**:
  - `plans/039-migrate-ayan-stack-to-alchemy-v2.md` (`DONE-local` source graph)
  - `plans/041-model-durable-agent-runs-in-d1.md` (`DONE-local` domain and schema)
- **Parallel-safe with**: `plans/047-add-ephemeral-trusted-git-executor.md`
  (`DONE-local`; do not couple its Container to Brain)
- **Blocks**: nothing; replacement Plan 054 is the Brain-runtime prerequisite
- **Category**: direction
- **Planned at**: commit `878a6a3`, 2026-08-12
- **Branch**: `advisor/042-host-project-pi-runtime-in-brain`
- **Execution status**: REJECTED — superseded by Plan 054 after the exact
  public Agent Core/Pi AI composition passed the compatibility spike. The
  Coding Agent-root attempts remain unmerged historical evidence

## Why this matters

Ditto's current Pi harness still runs inside the untrusted Project Sandbox,
keeps conversation state in Sandbox JSONL files, and depends on a Unix control
socket and default local coding tools. The accepted target instead has one
trusted, project-scoped Brain Durable Object host the headless Pi Runtime while
D1 remains authoritative for conversations and Agent Runs, Brain SQLite stores
coordination/checkpoint/event data, and R2 stores oversized immutable Pi Safe
Checkpoints.

This plan creates that production-shaped but dormant Brain foundation. It does
not switch browser traffic, own Agent Run completion, or expose project files.
It proves locally that unmodified pinned Pi boots in workerd with one host-level
`import.meta.url` definition, in-memory managers, static resources, Ditto-owned
custom tools only, durable restore after eviction, bounded redacted events, and
the required SQLite/R2 checkpoint split. Later plans add Workflow ownership,
fencing, scheduling, jailed Project Sandbox tools, and the browser protocol.

## Non-negotiable decisions

1. **One Brain per Project.** Add one SQLite Durable Object class named `Brain`.
   Future callers obtain it with `Brain.getByName(projectId)`. The class stores
   the first bounded `projectId` it accepts and rejects every later mismatch;
   a Durable Object name or stub is routing, not browser authorization.
2. **D1 remains authority.** Existing `agent_runs`, `pi_agent_sessions`,
   `turns`, and `messages` remain the authoritative conversation/run model.
   Brain SQLite stores only Pi Safe Checkpoints, current checkpoint pointers,
   bounded redacted events, and minimal runtime/session metadata. It does not
   declare D1 Agent Run success, reopen terminal runs, or duplicate messages.
3. **Exact Pi pins.** Add exact `@earendil-works/pi-coding-agent@0.80.10` and
   `@earendil-works/pi-ai@0.80.10` to the Worker-owned web package. Keep the
   legacy sandbox-runner pins unchanged until the atomic cutover plan removes
   that runner. Freeze the resolved TypeBox version in `pnpm-lock.yaml`.
4. **One production compatibility shim.** The only production shim is a
   checked-in Brain-module/Worker-environment bundler definition replacing
   `import.meta.url` with `"file:///bundle/index.js"`. It may be mirrored in the
   workerd test bundler, but there is one production literal and no Pi fork,
   alias, postinstall mutation, `pnpm.patchedDependencies`, or checked-in
   generated bundle. A process-global Vite `define` is forbidden: Alchemy's
   injected marker applies to client and server builds, so the replacement must
   additionally target only the Worker/SSR environment and Pi module graph.
5. **No TypeBox patch.** Use unmodified Pi and TypeBox. A real workerd test must
   accept valid custom-tool arguments and reject missing/invalid required
   fields. If that requires the prototype's interpreted-validator patch, STOP.
6. **Headless SDK only.** Import SDK symbols, never Pi CLI, TUI, RPC entrypoint,
   default resource discovery, package manager, or control-socket paths. Use a
   static `ResourceLoader`, `SettingsManager.inMemory`,
   `InMemoryCredentialStore`, `ModelRuntime`, and `SessionManager.inMemory` or
   an ephemeral restore file.
7. **Ditto-owned tools only.** The runtime factory takes a trusted code-owned
   custom-tool set. Product mode begins with no project tools. Workerd tests may
   inject one secretless echo tool. Never enable Pi's local `bash`, `grep`,
   `find`, `read`, `write`, or `edit` implementations, and never pass a raw
   Sandbox handle, command, path, argv, env, or process capability.
8. **Credentials stay in Brain.** Plan 042 supports only the existing operator
   fallback credential already bound to the trusted Worker. It may enter only
   an in-memory credential store and the exact-secret redactor. It never enters
   Project Sandbox env/argv/files, Brain SQLite/R2, Pi entries, events, errors,
   logs, RPC results, or tests. Account provider-auth Pi flows remain excluded.
9. **Safe Checkpoints only.** A checkpoint may be created only while the Pi
   Agent Session has no active prompt, model action, or tool action. A crash
   during an action leaves the previous Safe Checkpoint current. Full Operation
   Fences and uncertain-action settlement belong to Plan 043.
10. **Payload before pointer.** Serialize and redact the Pi session header and
    entries, gzip them, hash the exact compressed bytes, and commit payload
    bytes before the immutable manifest and current pointer. Compressed payloads
    larger than 512 KiB go to immutable R2 objects; smaller payloads are split
    into bounded SQLite BLOB chunks. Restore verifies size/hash before Pi sees
    any state.
11. **Memory is a cache.** The Brain may keep many live Pi Agent Sessions in a
    bounded map, but every session must reconstruct from its current Safe
    Checkpoint after eviction. Ephemeral `/tmp` JSONL may bridge Pi's public
    restore API within one live runtime; it is never authority and must be
    removable without losing the checkpoint.
12. **Bounded redacted journal.** Brain events are an append-only SQLite journal
    with monotonic integer cursors and explicit Project / Pi Agent Session /
    Agent Run / Execution Epoch / Turn identity. Persist only a closed event
    projection, stream-redact text across deltas, cap every field and event, and
    return events strictly after a requested cursor.
13. **Dormant product execution.** Add the internal Brain RPC/runtime contracts,
    but do not call them from `/api/agent/*`, tRPC, browser code, Workflow, or
    current agent services. Real execution stays disabled unless a test-only
    binding explicitly enables it. This prevents a non-idempotent pre-fence
    runtime from becoming a production owner before Plan 043.
14. **No production claim from local evidence.** `DONE-local` proves the source
    and local workerd foundation only. It does not satisfy the mandatory paid
    deployed cold-start, provider-stream, memory, CPU, or long-run gates.

## Current state

### Domain language and authority

`CONTEXT.md` defines the boundaries this plan must use:

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

Do not rename Brain to runner/Worker, call a Workspace Session a Sandbox
session, or use Agent Run and Pi Agent Session interchangeably.

### Alchemy v2 Worker graph

`alchemy.run.ts` currently owns one Website Worker, D1, R2, the Project Sandbox,
and the Trusted Git Executor:

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
  compatibility: {
    flags: ["nodejs_compat_populate_process_env"],
  },
  env: {
    DB: Database,
    Sandbox: SandboxContainer,
    TrustedGitExecutor: TrustedGitExecutorContainer,
    BACKUP_BUCKET: SandboxBackups,
    // existing plain and redacted bindings
  },
});
```

Use `Cloudflare.DurableObject<Brain>("brain", { className: "Brain" })` as a
sibling binding hosted by this Website Worker. Keep the existing Website,
Sandbox, Trusted Git Executor, D1, R2, route, assets, and binding names intact.
Alchemy must emit one new SQLite Durable Object class migration; do not
hand-write Wrangler migration tags or add another Worker unless the installed
Alchemy API proves the Website cannot host the class. If that assumption is
false, STOP for architecture review rather than silently creating a second
script boundary.

`apps/web/src/server.ts` is the custom Worker entry and currently exports the two
existing classes without changing browser routing:

```ts
export { Sandbox } from "@cloudflare/sandbox";
export { TrustedGitExecutor } from "#/lib/trusted-git-executor";
export { ContainerProxy };
```

Add `Brain` to this export surface. Do not add a Brain HTTP route.

### D1 durable Agent Run foundation

`apps/web/src/lib/agent-run-persistence.ts` already fixes the lifecycle:

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

Migration `apps/web/migrations/0012_elite_union_jack.sql` and schema
`apps/web/src/db/schema.ts` provide `agent_runs`, `pi_agent_sessions`, and
`turns`. Leave them unchanged. Plan 042 does not wire the new Brain into the
current request-owned path and does not add Brain checkpoint fields to D1.

### Current Pi ownership and reusable SDK seams

Only the independent npm sandbox-runner currently pins Pi:

```json
// packages/sandbox-runner/package.json
"dependencies": {
  "@earendil-works/pi-ai": "0.80.10",
  "@earendil-works/pi-coding-agent": "0.80.10"
}
```

`packages/sandbox-runner/src/run-git-metadata.ts` already demonstrates the
static-resource and in-memory-session pattern:

```ts
function emptyResourceLoader(systemPrompt: string): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

const sessionManager = SessionManager.inMemory(cwd);
const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: true },
  followUpMode: "one-at-a-time",
});
```

`packages/sandbox-runner/src/runner-model.ts` demonstrates in-memory model
resolution:

```ts
const credentials = new InMemoryCredentialStore();
const modelRuntime = await ModelRuntime.create({
  credentials,
  modelsPath: null,
  allowModelNetwork: false,
});
```

Copy the design, not the runner files. The Brain module must not import from
`packages/sandbox-runner`, and the runner remains intact for the legacy path.

### Current verification and known baseline

Root verification is:

```json
"verify": "pnpm check && pnpm typecheck && pnpm test && pnpm build && pnpm runner:verify"
```

At planning commit `878a6a3`, the following cheap reconciliation passed:

- `pnpm check` (20 existing warnings, no errors);
- `pnpm typecheck`;
- Plan 041 focused tests: 15/15;
- Plan 047 focused tests: 71/71;
- sandbox-runner typecheck and 81/81 tests.

There is no workerd/Vitest Durable Object harness yet. This plan must add one
and include it in normal `pnpm verify`; Node mocks alone cannot prove Pi's
workerd import/validation path.

## Target architecture

### Worker and class layout

Use this ownership shape (minor file-name changes are acceptable; boundaries
are not):

```text
apps/web/src/lib/brain/
  contracts.ts          bounded RPC/event/checkpoint types and constants
  static-resources.ts   fixed ResourceLoader, no discovery or jiti
  pi-runtime.ts         in-memory model/settings/session creation and live map
  checkpoint-store.ts   gzip/hash, SQLite chunks, immutable R2, restore
  event-journal.ts      closed Pi event projection + streaming redaction
  brain.ts              SQLite Durable Object schema and internal RPC methods
```

`brain.ts` exports `class Brain extends DurableObject<BrainEnv>`. Cloudflare
injects the Website's full environment at runtime, but `BrainEnv` must be a
narrow `Pick` exposing only the R2 bucket, existing `OPENCODE_API_KEY` operator
fallback credential, and explicit test/runtime-enable flags. Brain source must
not import, access, or expose `Sandbox`, `TrustedGitExecutor`, GitHub
credentials, project environment values, Better Auth cookies/secrets, or raw
D1 access.

### Brain SQLite schema

Create schema synchronously in the constructor. Use exact bounded SQL bindings,
not string interpolation. The minimum tables are:

- `brain_identity`: exactly one immutable `project_id` and schema version;
- `pi_sessions`: one row per Workspace Session / Pi Agent Session, current Safe
  Checkpoint generation, next generation, and bounded timestamps;
- `checkpoint_manifests`: immutable `(session_id, generation)` identity plus
  run/epoch/turn/kind, parent generation, entry count, gzip byte length,
  SHA-256, storage kind (`sqlite|r2`), optional R2 key, and created time;
- `checkpoint_chunks`: immutable bounded `(session_id, generation, chunk_index)`
  BLOB rows for the SQLite storage kind;
- `brain_events`: `cursor INTEGER PRIMARY KEY AUTOINCREMENT` plus bounded
  session/run/epoch/turn identity, closed event kind, redacted JSON payload, and
  timestamp.

Do not add Workflow IDs, Operation Fences/results, leases, Sandbox process IDs,
Git operations, browser subscribers, D1 terminal outcomes, or credentials.

### Checkpoint wire format and order

Use versioned canonical Pi JSONL: one session header line followed by the
entries needed by `SessionManager.open` / `buildSessionContext`, plus only safe
runtime metadata encoded as validated session entries where Pi supports it.
Before serialization, recursively redact known credential leaves. Reject
cycles, unsupported values, invalid entry graphs, NUL IDs, and payloads over an
exported hard memory cap; do not truncate a checkpoint.

1. Encode canonical UTF-8 Pi JSONL, gzip with `CompressionStream`, and hash the
   exact compressed bytes with Web Crypto SHA-256.
2. If compressed size is at most `512 * 1024`, split it into 64 KiB-or-smaller
   SQLite BLOB chunks. In one `ctx.storage.transactionSync`, insert all chunks,
   insert the immutable manifest, then CAS the current pointer.
3. If compressed size is greater than 512 KiB, put an immutable R2 object under
   a dedicated `brain-checkpoints/` prefix using hashes of project/session IDs
   and a generation/hash suffix. Use an insert-only conditional write. After the
   complete object exists, use one SQLite transaction to insert the manifest and
   CAS the pointer.
4. A fault after payload write but before manifest/pointer leaves the prior
   pointer valid. It may leave an orphan for later GC; it must never expose a
   partial current checkpoint.
5. Restore reads the current manifest, assembles or streams the payload, verifies
   byte length and hash, decompresses, validates entries, and only then creates
   the live Pi session. A missing/corrupt payload fails closed and leaves the
   current pointer untouched.
6. Ephemeral restore writes one random `/tmp` JSONL file because Pi 0.80.10
   has no storage adapter. The Worker must explicitly retain `nodejs_compat` in
   addition to `nodejs_compat_populate_process_env`. A real workerd test must
   write, `SessionManager.open`, and unlink this file. The file is not a
   durability claim, contains no credential, and is never backed up.

### Internal runtime contract

Expose narrow RPC methods suitable for later trusted Workflow orchestration,
with names such as:

- `runTurn(input)` — one bounded prompt for a trusted
  `{projectId, workspaceSessionId, runId, executionEpoch, turnSequence}`;
- `requestStop(input)` — `clearQueue()` then cooperative `abort()` for the exact
  active identity;
- `checkpointSession(input)` — only while quiescent;
- `readEvents(input)` — strictly after a cursor, with bounded count/bytes;
- `inspectSession(input)` — safe booleans/counts/generations only;
- `forceEvictionForTest(input)` — rejects unless the test-only binding is true;
  disposes every live Pi session, removes tracked `/tmp` restore files, clears
  the live map, records a boot/cache generation, then calls `this.ctx.abort()`.
  The RPC is expected to terminate; a fresh call through the same stub must
  construct a new DO instance and restore only from SQLite/R2. If the selected
  workerd harness cannot prove that lifecycle, STOP rather than relabeling a
  map clear as eviction.

`runTurn` is deliberately not a production owner in this plan: no shipped route
or service calls it, and the production runtime-enable binding is false/absent.
Do not add automatic retries or pretend duplicate model/tool dispatch is safe.
Plan 043 adds Workflow ownership, Operation Fences, stored results, duplicate
delivery behavior, and D1 settlement.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Root install | `pnpm install --frozen-lockfile` | exit 0; lock unchanged after implementation |
| Runner install | `npm ci --prefix packages/sandbox-runner` | exit 0; legacy runner remains reproducible |
| App typecheck | `npm run typecheck --prefix apps/web` | exit 0 |
| Node Brain tests | `npm test --prefix apps/web -- --run src/lib/brain` | all Brain unit tests pass |
| Workerd Brain tests | `npm run brain:test --prefix apps/web` | isolated real workerd DO/Pi suite passes |
| No-definition probe | `npm run brain:test:nodef --prefix apps/web` | exits 0 and prints one fixed `shim_required` or `shim_removable` result |
| Bundle report | `npm run brain:bundle-report --prefix apps/web` | full Worker gzip/startup report exits 0 below hard limits; client scan clean |
| App build | `npm run build --prefix apps/web` | exit 0; Brain stays server-only |
| Full gate | `pnpm verify` | includes Brain workerd gate plus existing app/runner gates |
| Local Alchemy | `pnpm dev` | graph starts, exports/binds `Brain`, then is stopped cleanly |
| Alchemy dry run | `pnpm exec alchemy deploy --stage dev --dry-run` | local build/plan is bounded; no resource apply |
| Diff check | `git diff --check` | no whitespace errors |

At plan time, `@cloudflare/vitest-pool-workers@0.21.1` accepts Vitest 4.1 but
carries its own Wrangler 4.121 and Miniflare 5 alpha dependencies, while the web
package pins Wrangler 4.111 and Alchemy pins its own Miniflare 4 line. Re-query
all versions and read current Cloudflare test configuration before choosing the
harness. It is acceptable for pnpm to install pool-owned nested tool versions,
but the harness must be isolated and must not change the existing web Wrangler,
Alchemy, or Alchemy Miniflare resolution. If no exact pool release can coexist
without upgrading those platform locks, STOP and refresh the plan.

## Suggested executor toolkit and references

- Use the Cloudflare, Durable Objects, and Workers best-practices skills.
- Read current official Durable Object RPC, SQLite storage, lifecycle, limits,
  Workers limits, Wrangler bundling, and Vitest integration docs before Step 2.
- Inspect exact installed Alchemy beta.70 declarations for
  `Cloudflare.DurableObject`, `Website.Vite`, Worker `limits`, Vite source
  bundling, and generated `new_sqlite_classes` behavior.
- Inspect exact installed Pi 0.80.10 public declarations for
  `createAgentSession`, `SessionManager`, `SettingsManager`, `ResourceLoader`,
  `ModelRuntime`, `defineTool`, and `validateToolArguments`.
- Treat generated `.alchemy` / `.wrangler` files as potentially secret-bearing.
  Inspect only binding names, class names, compatibility settings, migrations,
  bundle sizes, and startup metadata; never paste binding values.

## Scope

### In scope — the only implementation/config paths to modify

- `package.json` — add a Brain workerd gate to normal verification.
- `pnpm-lock.yaml` — exact web Pi and test-harness dependency edges only.
- `alchemy.run.ts` — one Brain Durable Object binding/class, runtime-disabled
  plain flag, required compatibility/CPU metadata, and no other graph change.
- `apps/web/package.json` — exact Pi pins, exact compatible workerd test package,
  and Brain test script.
- `apps/web/vite.config.ts` — one Alchemy-Worker-scoped `import.meta.url`
  definition; preserve existing app/preview/plugin behavior.
- `apps/web/types/env.d.ts` — only if the existing `WebsiteEnv` alias needs a
  type-only adjustment; do not hand-maintain bindings.
- `apps/web/src/server.ts` and `apps/web/src/server.test.ts` — export `Brain`,
  preserve the default fetch path, and keep its Node routing test isolated from
  the `cloudflare:workers` class import.
- `apps/web/src/lib/brain/**` — new Brain implementation and Node tests.
- `apps/web/test/brain/**` — workerd entry, types, fixtures, and integration
  files named `*.workerd.ts` (not `*.test.ts`, so default Vitest excludes them).
- `apps/web/vitest.brain.config.ts`, optional
  `apps/web/vitest.brain-nodef.config.ts`, and/or
  `apps/web/wrangler.brain-test.jsonc` — isolated workerd test configuration
  whose explicit include is `test/brain/**/*.workerd.ts`.
- `apps/web/scripts/brain-bundle-report.mjs` and optional
  `apps/web/scripts/brain-test-nodef.mjs` — metadata-only full Worker
  dry-bundle, gzip/startup, server/client shim/native-module checks, and the
  fixed-result no-definition probe wrapper required by the command table.
- `docs/architecture/agent-harness.md` — document the dormant Brain foundation,
  store boundaries, and that the legacy request path remains live.

### Planning records maintained in the dirty root checkout, not implementation worktree

- `plans/042-host-project-pi-runtime-in-brain.md` — reviewer appends redacted evidence.
- `plans/README.md` — reviewer updates only Plan 042 status/latest note.

The implementation executor reads this plan from
`/home/ayan/ditto/plans/042-host-project-pi-runtime-in-brain.md` or receives it
inlined. It must not copy/edit plan records in the isolated worktree. This
preserves the existing dirty Plan 047 evidence and avoids integration conflicts.

### Generated/temporary artifacts allowed but never committed

- `node_modules/**`, `.alchemy/**`, `.wrangler/**`, `apps/web/dist/**`;
- test-only local Durable Object and R2 state;
- `/tmp/ditto-042-*` bundles, profiles, JSONL restore files, and redacted reports.

### Out of scope — do not touch

- `apps/web/src/db/schema.ts`, migration 0012, or
  `apps/web/src/lib/agent-run-persistence.ts`.
- Current `apps/web/src/lib/agent-run.ts`, `agent-run-service.ts`,
  `agent-control-service.ts`, `/api/agent/*`, tRPC, browser components, cache,
  SSE, or message persistence.
- `packages/sandbox-runner/**`, `Dockerfile`, current runner image, JSONL files,
  Unix control socket, provider-auth CLI, or account provider-auth behavior.
- Project Sandbox lifecycle, backups, current Git/worktree/Preview behavior,
  Trusted Git Executor source/callers, or any credential channel into Sandbox.
- Cloudflare Workflow resources, Workflow IDs/state, Operation Fences/results,
  reconciliation, final D1 settlement, or workspace-finalization ordering.
- Session Mutation Lease, Project Operation Gate, Sandbox Activity Lease,
  Browser Gateway, Files UI, jailed production tools, terminal, Git Publication,
  Git Import, Exclusive Preview Presentation, local architecture gate harness,
  Sandbox `@next`, release soak, or production cutover.
- A second Worker or Pi runner fallback, unless a STOP is reported and a later
  architecture decision explicitly changes the host boundary.
- Any cloud deploy/destroy/adopt, public diagnostic route, or real credential in
  a fixture, generated config, log, plan, test snapshot, or report.
- Plan 040 or Plans 043–053.

## Clean worktree Git workflow

Start from committed source `878a6a3`; leave the uncommitted planning records in
the root checkout. The executor receives this plan inlined or reads the absolute
root path above. The implementation worktree must contain no copied environment,
plan record, or Alchemy state.

```bash
set -euo pipefail
cd /home/ayan/ditto
test ! -e /home/ayan/ditto-worktrees/042-host-project-pi-runtime-in-brain
test -z "$(git branch --list advisor/042-host-project-pi-runtime-in-brain)"
git worktree add \
  -b advisor/042-host-project-pi-runtime-in-brain \
  /home/ayan/ditto-worktrees/042-host-project-pi-runtime-in-brain \
  878a6a3
cd /home/ayan/ditto-worktrees/042-host-project-pi-runtime-in-brain
test -z "$(git status --short)"
```

If the branch/path already exists, STOP and ask whether to reuse it; never
remove it yourself. `git status --short` in the worktree must be empty before
source work because planning records stay in the root checkout. Use Conventional
Commits. Suggested logical commits:

1. `feat(brain): add durable checkpoint and event stores`
2. `feat(brain): host pinned Pi runtime`
3. `test(brain): verify workerd recovery boundaries`
4. `docs(brain): record local runtime foundation`

Do not push, open a PR, merge, deploy, or modify the maintainer's root branch
unless separately instructed.

## Steps

### Step 1: Revalidate the baseline, exact package graph, and host mechanism

1. Run the drift check and clean-worktree assertion.
2. Install root and independent runner locks, then run current typecheck and the
   focused Plan 041 / 047 tests before changing dependencies.
3. Re-fetch current Cloudflare docs and inspect exact installed Alchemy beta.70,
   Workers types, Wrangler, Pi 0.80.10, and TypeBox source/declarations.
4. Prove a plain SQLite Durable Object exported by `apps/web/src/server.ts` can
   be hosted and bound by the current `Website.Vite` resource without creating
   another Worker.
5. Prove the production Vite/Alchemy definition can replace `import.meta.url`
   only in Pi modules in the Worker/SSR environment. The
   `ALCHEMY_CLOUDFLARE_VITE_INJECTED === "1"` marker is only a secondary guard;
   it is process-wide and cannot by itself scope the replacement. Use the exact
   current Vite environment/transform API and add a client-negative/server-
   positive bundle test. Do not mutate Alchemy or Pi.
6. Re-query `@cloudflare/vitest-pool-workers` and verify an exact release can
   coexist as an isolated nested harness without changing the existing web
   Wrangler 4.111, Alchemy, or Alchemy's Miniflare resolution.

**Verify**:

```bash
set -euo pipefail
pnpm install --frozen-lockfile
npm ci --prefix packages/sandbox-runner
pnpm typecheck
npm test --prefix apps/web -- --run \
  src/db/agent-run-migration.test.ts \
  src/lib/agent-run-persistence.test.ts \
  src/lib/trusted-git-executor.test.ts
node -e '
const runner=require("./packages/sandbox-runner/package.json");
for (const name of ["@earendil-works/pi-ai","@earendil-works/pi-coding-agent"]) {
  if (runner.dependencies[name] !== "0.80.10") throw new Error(`wrong ${name}`);
}'
test -z "$(git status --short)"
```

Expected: green baseline, exact existing pins, documented APIs available, and a
specific host/define/test path proven. If the definition can only be app-global
in a way that changes client semantics, or Alchemy cannot host the Brain class
on the Website Worker, STOP before package edits.

### Step 2: Add exact Worker Pi and workerd-test dependencies

Use pnpm commands so the lockfile is authoritative:

```bash
pnpm --filter @ditto/web add --save-exact \
  @earendil-works/pi-ai@0.80.10 \
  @earendil-works/pi-coding-agent@0.80.10
pnpm --filter @ditto/web add --save-dev --save-exact \
  @cloudflare/vitest-pool-workers@<validated-exact-version>
```

Add `brain:test` to the web package and `brain:verify` to the root. Include the
Brain workerd gate in root `verify` without removing or weakening existing
check, typecheck, web test/build, or runner verification.

Review the lockfile. It may add the Worker-side Pi graph and pool-owned nested
Wrangler/Miniflare dependencies, but must not change the exact existing web
Wrangler 4.111, Alchemy, Effect, Sandbox, Containers, Alchemy Miniflare override,
or legacy runner locks. Record the resolved TypeBox version and add a machine
check that fails on intentional Pi/workerd upgrades until the boot/validation
matrix is rerun. Do not force a resolution different from Pi's supported graph
merely to match historical evidence.

**Verify**:

```bash
set -euo pipefail
pnpm install --frozen-lockfile
node --input-type=module <<'NODE'
import fs from "node:fs";
const web = JSON.parse(fs.readFileSync("apps/web/package.json", "utf8"));
for (const name of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"]) {
  if (web.dependencies[name] !== "0.80.10") throw new Error(`wrong ${name}`);
}
if (!web.devDependencies["@cloudflare/vitest-pool-workers"]?.match(/^\d/)) {
  throw new Error("workerd test package must be exact");
}
NODE
node -e 'const p=require("./apps/web/package.json"); if(p.devDependencies.wrangler!=="4.111.0") process.exit(1)'
# Review pnpm-lock.yaml manually: pool-owned nested tools may be added, but the
# existing Alchemy/Effect/Sandbox/Containers/web-Wrangler resolutions may not move.
```

Expected: exact web pins, exact compatible test dependency, frozen install, and
no unrelated platform drift.

### Step 3: Implement bounded contracts, event journal, and Brain identity

Create `contracts.ts`, `event-journal.ts`, and their unit tests.

1. Define these initial hard caps: IDs/keys 128 UTF-8 bytes, prompt 32,000
   UTF-16 code units (matching D1 acceptance), event string 4 KiB UTF-8, one
   event 64 KiB serialized, one replay 1,000 events or 1 MiB, checkpoint 32 MiB
   uncompressed / 16 MiB compressed, and two-session local peak memory below
   96 MiB. Use UTF-8 byte counts where data crosses persistence/RPC boundaries.
   Reject rather than silently truncate prompts/checkpoint state; event
   truncation must be explicit metadata.
2. Define a closed event union for session/runtime lifecycle, assistant text,
   tool start/end, stop acknowledgement, checkpoint, restore, and safe errors.
   Never persist arbitrary Pi event objects.
3. Use `StreamingSecretRedactor` for assistant deltas so a concrete or shaped
   secret split across chunks cannot escape. Use `redactStructured` only on
   bounded closed fields. Flush held safe text before non-text boundaries.
4. Initialize `brain_identity`, `pi_sessions`, `checkpoint_manifests`,
   `checkpoint_chunks`, and `brain_events` synchronously in the DO constructor.
5. Enforce immutable project identity and monotonic SQLite event cursors.
   `readEvents(after, limits)` returns strictly greater cursors and stops before
   either count or byte cap.

Tests must cover invalid IDs/epochs/cursors, cross-project mismatch, split
secrets, invalid UTF-8 diagnostics, field/event caps, cursor order, replay
strictly after cursor, and session isolation.

**Verify**:

```bash
npm test --prefix apps/web -- --run \
  src/lib/brain/contracts.test.ts \
  src/lib/brain/event-journal.test.ts
```

Expected: all validation, redaction, cap, and cursor tests pass without a Pi or
Sandbox import.

### Step 4: Implement payload-first Safe Checkpoints

Create `checkpoint-store.ts` and tests against real SQLite semantics where
possible plus a deterministic R2 test double. The store may accept test-only
fault hooks (`afterPayload`, `afterManifest`, `beforePointerCas`); production
Brain construction must pass no hooks and no RPC may control them.

1. Validate and canonicalize header/entry state. Redact known credential leaves
   before serialization. Persist no raw exception or model credential.
2. Gzip and SHA-256 the compressed bytes with Web platform APIs.
3. Store at-or-below-512-KiB compressed payloads in bounded SQLite chunks in a
   `transactionSync` that inserts chunks, immutable manifest, then current
   pointer. A thrown hook or write rolls back the whole SQLite transaction; it
   never creates a durable partial chunk state.
4. Store above-512-KiB compressed payloads under the dedicated immutable R2 key
   prefix before a manifest/pointer transaction. Use the current R2 conditional
   equivalent of `If-None-Match: *` (types currently expose `onlyIf` /
   `etagDoesNotMatch`) and verify an existing hash-key object's metadata, size,
   and hash before treating it as the same immutable payload.
5. Use expected-current-generation CAS. Stale R2 writers may leave immutable
   unreferenced payloads but cannot move the current pointer backward.
6. Restore validates manifest, chunk order or R2 object, byte length, hash,
   decompression, version, and entry graph before returning state.
7. Add explicit future-GC enumeration but do not implement retention policy or
   delete objects in this plan.

Required tests:

- empty and normal small checkpoint round-trip;
- exact threshold stays SQLite; threshold+1 uses R2 (use deterministic
  incompressible data or a test-only threshold injected into the store);
- chunk ordering and missing/duplicate chunk rejection;
- R2 write failure leaves old pointer current;
- failure after payload but before manifest leaves old pointer current;
- stale generation cannot overwrite newer pointer;
- corrupt length/hash/gzip/version/entry graph fails closed;
- no credential canary in SQLite chunks, R2 bytes, manifests, or errors.

**Verify**:

```bash
npm test --prefix apps/web -- --run \
  src/lib/brain/checkpoint-store.test.ts
```

Expected: full storage/order/fault matrix passes and no snapshot uses one
unbounded SQLite row.

### Step 5: Embed unmodified headless Pi behind a static runtime factory

Create `static-resources.ts`, `pi-runtime.ts`, and tests.

1. Import only the public SDK/model symbols required for headless operation.
2. Build a static `ResourceLoader` with fixed Ditto system instructions and no
   extension, skill, prompt, theme, AGENTS-file, package, or filesystem
   discovery.
3. Build `SettingsManager.inMemory` with compaction enabled,
   `followUpMode: "one-at-a-time"`, image handling blocked, and bounded retry
   behavior. Use no file settings/auth store.
4. Build `InMemoryCredentialStore` and `ModelRuntime.create({ modelsPath: null,
   allowModelNetwork: false })`. Seed only the trusted operator fallback in
   product mode, and retain the secret only in the live credential/redaction
   closure.
5. Create sessions with an in-memory manager for new state. Restore persisted
   state through one ephemeral random JSONL path only because Pi 0.80.10 has no
   storage adapter. Never use a Project Sandbox path or back up that file.
6. Accept only a trusted code-owned custom-tool definition array. Product mode
   starts with no tools; tests inject one `brain_probe_echo` tool. Caller data
   cannot select tool names or definitions.
7. Track active model/tool state so checkpoint requests fail while unresolved.
   Subscribe to Pi events, project them through the journal, and checkpoint only
   after a safe turn boundary.
8. Keep a bounded live-session map. Eviction of one cached session disposes it
   without deleting durable state; restoration verifies the Safe Checkpoint.

Node tests may mock model streaming for state/race cases, but workerd tests in
Step 7 must import and execute the unmodified package graph.

**Verify**:

```bash
npm test --prefix apps/web -- --run \
  src/lib/brain/static-resources.test.ts \
  src/lib/brain/pi-runtime.test.ts
```

Expected: static/no-discovery runtime, trusted tools, active/checkpoint guards,
stop behavior, bounded cache, and credential-negative assertions pass.

### Step 6: Add the Brain Durable Object and bind it without cutting traffic over

1. Implement `Brain extends DurableObject<BrainEnv>` over the modules above.
   Public RPC methods validate complete trusted identity and return closed safe
   result unions. No method accepts credentials, raw tools, Sandbox handles,
   commands, paths, env, or callback URLs.
2. Gate `runTurn` and test reset behavior behind bindings absent/false in the
   production graph. Other inspection/checkpoint APIs remain internal RPC only;
   add no HTTP route.
3. Export `Brain` from `apps/web/src/server.ts`. Keep `fetch()` behavior
   byte-for-byte unchanged.
4. Add one `Cloudflare.DurableObject` declaration/binding to the Website env,
   preserve all existing resources, and configure the required Worker CPU limit
   for eventual paid admission. Keep runtime execution disabled.
5. Add the one Pi-module replacement in `apps/web/vite.config.ts`, scoped by
   the exact Vite Worker/SSR environment API and Alchemy marker. A top-level
   process-wide `define` is forbidden. Add server-positive and client-negative
   bundle assertions for the literal.
6. Preserve generated `WebsiteEnv` typing. Do not hand-write `Env.Brain`.
7. Start local Alchemy long enough to prove `Brain` appears as a distinct
   SQLite Durable Object binding/migration and that existing `Sandbox` and
   `TrustedGitExecutor` shapes remain. Stop the process. Inspect names/types
   only; do not print generated env values.

**Verify**:

```bash
set -euo pipefail
npm run typecheck --prefix apps/web
npm test --prefix apps/web -- --run src/server.test.ts src/lib/brain
rg -n 'Brain|Cloudflare\.DurableObject' alchemy.run.ts apps/web/src/server.ts
rg -n 'file:///bundle/index\.js' apps/web/vite.config.ts
! rg -n 'Brain' apps/web/src/routes apps/web/src/components --glob '!**/*.test.*'
```

Expected: one class/binding, no browser route/caller, existing routing tests
green, and one production shim literal.

### Step 7: Add real workerd tests and make them a normal gate

Add an isolated `@cloudflare/vitest-pool-workers` configuration whose main
imports the same Brain/Pi modules as production. Workerd files are named
`*.workerd.ts`; the Brain config explicitly includes them, while default
`vitest run` cannot discover them. Use test-only local R2/bindings and never a
real key. Mirror the production `import.meta.url` replacement in test bundling
without introducing a second production shim.

Required workerd cases:

1. **Pi boot**: import the exact SDK graph and create one headless Agent Session
   with static resources, in-memory settings/credentials, and no default tools.
2. **TypeBox valid/invalid**: import unmodified `validateToolArguments` from
   `@earendil-works/pi-ai` (it is exported by the root index's validation
   barrel), then prove it accepts a valid echo input and rejects missing/wrong
   required fields. Assert no patch script,
   alias, or modified package file exists.
3. **Two sessions**: one Brain holds two Pi Agent Sessions with isolated headers,
   entries, journals, and current pointers.
4. **Small/large checkpoint**: real DO SQLite plus test R2 exercise both storage
   classes and payload-before-pointer faults.
5. **Forced eviction**: checkpoint, call the gated test reset, prove the live map
   is gone/boot generation advanced, then restore on a fresh call and recover the
   prior context from SQLite/R2 rather than surviving `/tmp`.
6. **Follow-up context foundation**: append deterministic prior context through
   Pi's public SessionManager API, restore it, and prove
   `buildSessionContext()` contains the marker. Real provider continuity remains
   a deployed gate.
7. **Stop/checkpoint race**: a deterministic injected stream/test session proves
   cooperative stop leaves the previous Safe Checkpoint current and no active
   action is checkpointed.
8. **Event cursor/redaction**: text deltas split a credential-shaped canary,
   persisted events contain only redaction, and replay is strictly monotonic.
9. **No local substrate**: no successful `child_process`, worker thread,
   default grep/find/bash, file-backed authority, dynamic resource discovery, or
   Unix socket path is reachable.

`brain:test` runs only the defined build and must pass. `brain:test:nodef` runs a
wrapper around the no-definition test: it always exits 0 after printing exactly
one redacted fixed result, `shim_required` when the known boot failure occurs or
`shim_removable` when boot passes; any unrelated failure exits nonzero. If it
prints `shim_removable`, remove the production replacement and rerun the full
suite. Never keep a stale shim or classify an arbitrary test failure as expected.

**Verify**:

```bash
npm run brain:test --prefix apps/web
npm run brain:test:nodef --prefix apps/web
npm test --prefix apps/web
```

Expected: all defined-build workerd cases pass, the no-definition probe emits
one recognized result, default web Vitest does not ingest workerd files, and no
test uses network credentials or Node mocks for the Pi import / TypeBox path.

### Step 8: Run full local graph, bundle/startup, scope, and secret audits

1. Run focused tests, isolated workerd tests, default web tests (proving they do
   not ingest workerd files), standalone app build, runner verification, and
   full root verification.
2. Run bounded local Alchemy and its dry-run build/plan without applying cloud
   changes. Supply required values only through the operator's secure inherited
   environment; do not copy or source the root checkout's `.env*` into the
   worktree. Prove existing D1/R2/Website/Sandbox/Trusted Git resources are not
   renamed/replaced and only Brain plus the Website code/binding/migration/limit
   update appears. If the secure environment is unavailable, STOP at this local
   graph gate rather than printing values or weakening completion.
3. Run `brain:bundle-report`. It must perform a full Alchemy/Vite Website build,
   invoke Wrangler's dry-bundle/startup tooling against the generated
   `dist/server/wrangler.json` into `/tmp/ditto-042-bundle` without applying
   resources, and parse tool metadata rather than estimating from one chunk.
   Fail unless compressed upload is below 10 MiB, startup is below 1,000 ms, and
   the deterministic two-session local memory probe peaks below 96 MiB. Record
   metadata only; local values are regression evidence, not deployed proof.
4. Scan generated client assets to ensure Pi packages, provider SDKs, the
   synthetic module URL, credentials, and Brain RPC symbols did not enter the
   browser bundle. The server output must contain the synthetic URL only when
   the no-definition probe reports `shim_required`. Also reject bundled native
   `.node` Photon artifacts or accidental default coding-tool entrypoints; do
   not silently externalize Pi to make the report pass.
5. Audit source for forbidden local tools, resource discovery, patches,
   credentials, and new production callers.

```bash
set -euo pipefail
pnpm install --frozen-lockfile
npm ci --prefix packages/sandbox-runner
npm run brain:test --prefix apps/web
npm run brain:test:nodef --prefix apps/web
npm test --prefix apps/web
npm run brain:bundle-report --prefix apps/web
pnpm verify
git diff --check

# Brain source cannot use Pi's local substrate or later-plan owners.
! rg -n 'child_process|worker_threads|createLocalBashOperations|DefaultResourceLoader|proper-lockfile|rpc-entry|control-channel|createSession\(|execStream\(|gitCheckout\(|WorkflowEntrypoint' \
  apps/web/src/lib/brain apps/web/test/brain

# No production TypeBox/Pi patch or alias.
! rg -n 'patch-pi-validation|patchedDependencies|Value\.Check\(schema|pnpmfile' \
  package.json pnpm-workspace.yaml apps/web packages \
  --glob '!**/node_modules/**' --glob '!**/*.test.ts'

# Pi is server-only and current request path is untouched.
! rg -n '@earendil-works/pi-' apps/web/src/components apps/web/src/routes \
  --glob '!**/*.test.*'
git diff --exit-code 878a6a3 -- \
  apps/web/src/db/schema.ts \
  apps/web/src/lib/agent-run-persistence.ts \
  apps/web/src/lib/agent-run.ts \
  apps/web/src/lib/agent-run-service.ts \
  apps/web/src/lib/agent-control-service.ts \
  apps/web/src/routes \
  packages/sandbox-runner Dockerfile
```

Expected: every local gate passes; full Worker gzip is below the paid 10 MiB
limit and local startup below one second with useful headroom; browser assets
contain no Brain/Pi graph; current production path and all out-of-scope files
are unchanged. If the exact full Worker graph cannot be measured, or it exceeds
limits locally, STOP rather than claiming `DONE-local`.

### Step 9: Document the dormant foundation and record evidence

Update `docs/architecture/agent-harness.md` with a concise current-state section:

- Brain now hosts a dormant pinned Pi Runtime foundation;
- D1 / Brain SQLite / R2 authority split;
- only static resources and code-owned custom tools are possible;
- current `/api/agent/*` and Project Sandbox runner remain the live path until
  later atomic cutover;
- local evidence is not deployed production admission.

The reviewer (not the implementation executor) appends **Execution evidence**
to the root plan containing only:

- date, executor, branch/worktree, and implementation commit(s);
- exact Pi, TypeBox, test-pool, Wrangler, workerd, Alchemy, Sandbox, and
  Containers versions;
- changed-file list and scope result;
- Node/workerd test counts and named matrix results;
- defined and without-definition boot outcomes;
- local Alchemy class/binding/migration names only;
- full Worker compressed size, local startup time, and two-session peak memory;
- memory/CPU observations available locally, clearly labeled non-deployed;
- explicit statement that no cloud deployment/provider call occurred;
- first unrun deployed gate and accurate status.

Status rules:

- `DONE-local`: all Steps 1–9 local gates pass, full Website bundle/startup are
  measured within limits, and cloud work remains unavailable/unauthorized.
- `DONE`: not attainable in this owner-local plan; requires a new paid deployed
  admission plan and exact release evidence.
- `BLOCKED-local (<first failed gate>)`: any required source, API, workerd,
  checkpoint, restore, validation, scope, bundle, startup, or verification gate
  fails.
- `NO-GO candidate`: unmodified direct Pi cannot meet a mandatory runtime gate
  without a separate runner, TypeBox patch, weakened resources, or unsafe
  credential/tool boundary. Stop and request the explicit architecture verdict.

**Verify**:

```bash
set -euo pipefail
pnpm verify
git diff --check
git status --short
git diff --name-only 878a6a3..HEAD
```

Expected: full gate green and every changed path is in Scope.

## Test plan

### Pure/Node tests

- contracts: UTF-8 bounds, ID/epoch/cursor validation, safe result unions;
- event journal: closed projection, streaming split-secret redaction, monotonic
  replay, count/byte caps, no arbitrary event serialization;
- checkpoint store: SQLite/R2 threshold, chunks, hash, corruption, CAS, fault
  ordering, cross-session isolation, credential-negative storage;
- Pi runtime: static resources, code-owned tools, no default tools, active Safe
  Checkpoint guard, bounded cache, stop/dispose, no provider-auth path;
- Brain RPC: immutable project identity, exact run/epoch/session matching,
  runtime-disabled default, no credential/raw capability inputs.

### Real workerd tests

- exact Pi graph boot with production definition;
- boot probe without definition on the current Pi/workerd pins;
- unmodified TypeBox valid/invalid arguments;
- one secretless custom tool schema;
- two Pi Agent Sessions in one Brain;
- real DO SQLite and local R2 small/large checkpoints;
- forced DO reset and fresh durable restore;
- restored context marker through Pi's public session API;
- stop/action/checkpoint consistency;
- cursor replay and split-secret redaction;
- forbidden local substrate absent/unreachable.

### Regression tests

- existing Worker routing (`src/server.test.ts`);
- Plan 041 migration/persistence focused suite;
- Plan 047 Trusted Git focused suite;
- all app tests/build and independent sandbox-runner tests/build through
  `pnpm verify`.

## Done criteria

All local criteria must hold for `DONE-local`:

- [ ] Exact Worker-owned Pi packages are `0.80.10`; legacy runner pins remain.
- [ ] Resolved TypeBox version is frozen and no patch/alias/postinstall exists.
- [ ] One project-scoped `Brain` SQLite Durable Object is exported and bound by
      the existing Website Worker with a distinct migration.
- [ ] Production Brain execution is dormant; no route, browser, Workflow, or
      current agent service calls it.
- [ ] Static ResourceLoader, in-memory settings/credentials, and trusted custom
      tools only; no default process/filesystem/discovery substrate.
- [ ] Safe Checkpoints commit payload before manifest/current pointer, chunk
      small SQLite payloads, and use immutable R2 above 512 KiB.
- [ ] Restore verifies exact bytes/hash and survives forced DO reset without
      memory or `/tmp` authority.
- [ ] Bounded redacted event cursors are monotonic and replay strictly after the
      requested cursor.
- [ ] Unmodified TypeBox accepts valid and rejects invalid tool arguments in
      real workerd.
- [ ] Two session states remain isolated in one Brain.
- [ ] The production `import.meta.url` definition is the only shim, is scoped to
      the Alchemy Worker bundle, and is deleted if the no-definition probe passes.
- [ ] `brain:bundle-report` proves the full Website Worker gzip is below 10 MiB,
      local startup below 1,000 ms, two-session peak memory below 96 MiB, no
      native Photon/default-tool substrate is bundled, and client assets contain
      no Pi/Brain graph.
- [ ] `pnpm verify`, focused tests, workerd tests, typecheck, build, and
      `git diff --check` pass.
- [ ] No out-of-scope source path changed and no cloud/provider mutation ran.
- [ ] Plan status and redacted evidence are updated accurately.

## STOP conditions

Stop and report; do not improvise if:

1. Unmodified Pi 0.80.10 cannot boot in workerd with only the module-URL
   definition.
2. Valid/invalid TypeBox tool validation needs a production patch, alias, fork,
   postinstall, or `node_modules` mutation.
3. Static resources and in-memory managers are insufficient without default
   filesystem discovery, jiti, package installation, file auth/settings, or a
   surviving JSONL file.
4. The Brain Worker must execute Pi through another process, container, Queue
   consumer, or separate runner.
5. Provider credentials must enter Project Sandbox or any durable/event/RPC
   surface for the Brain model loop to work.
6. The accepted Website Worker cannot host/bind the Brain class, or the
   `import.meta.url` definition cannot be scoped without changing browser/client
   behavior. Do not silently add another Worker.
7. Full Website bundle size or startup exceeds platform limits, cannot be
   measured exactly, or materially regresses toward the limit without a bounded
   fix inside Scope.
8. Two small Pi Agent Sessions cannot remain below the local memory safety bound,
   or eviction cannot reconstruct exact context from SQLite/R2.
9. Checkpoint ordering can expose a manifest/current pointer before complete
   payload bytes, stale writers can move the pointer backward, or corruption is
   not detected before restore.
10. The Brain would need to own D1 terminal state, replay uncertain model/tool
    work, or add Operation Fences/Workflow behavior to make tests pass.
11. The implementation requires Workflow, scheduling/leases, browser/SSE,
    production jailed files, Git, Preview, Sandbox `@next`, or current agent
    route changes.
12. An exact compatible workerd test harness cannot be added without an
    unrelated platform/toolchain migration.
13. Any secret value appears in a diff, test fixture, generated report, log,
    checkpoint, event, or plan evidence.
14. A command proposes cloud deploy/destroy/adoption, a non-`dev` stage, resource
    replacement, or an unbounded graph change.

## Maintenance notes

- Plan 043 must add Workflow ownership, Execution Epoch/Operation Fence recovery,
  duplicate RPC handling, terminal D1 settlement, and durability-before-success
  around this runtime. It must not infer idempotent execution from Plan 042.
- Plan 046 supplies the real Brain-jailed Project Sandbox file capabilities.
  Until then, product Pi has no coding tools; do not temporarily enable local Pi
  tools.
- On every intentional Pi, TypeBox, Wrangler, workerd, Vite, or Alchemy upgrade,
  rerun the defined and no-definition workerd boot/validation matrix. Delete the
  module-URL definition immediately when the unmodified bundle passes.
- Any future paid deployment must use a separate current plan and produce
  redacted release-specific evidence for real provider stream, at least two
  concurrent sessions, forced eviction restore, bundle/startup, memory, CPU,
  and exact class migration. Unavailable paid infrastructure is never a pass.
- The current Project Sandbox runner remains temporary compatibility code until
  the atomic Brain/Sandbox cutover. Do not present dual paths as fallback
  architecture.

## Execution evidence — 2026-08-12 (attempt 1, BLOCKED-local)

- **Executor**: xAI Grok 4.6 with high reasoning. The executor service returned
  HTTP 403 for exhausted Grok credits after creating implementation commit
  `76aa578`; no revision round was available.
- **Implementation refs**: branches
  `advisor/042-host-project-pi-runtime-in-brain` and
  `pi-agent-15c113e0-f746-4fe` both point to `76aa578`. Reviewer worktree:
  `/home/ayan/ditto-worktrees/042-review` (detached at that commit).
- **Resolved versions observed**: Pi AI `0.80.10`, Pi Coding Agent `0.80.10`,
  TypeBox `1.1.38`, Cloudflare Vitest pool `0.21.2`, pool Wrangler `4.122.0`,
  pool Miniflare `5.20260811.0-alpha`, pool workerd `1.20260811.1`, web
  Wrangler `4.111.0`, web Miniflare `4.20260710.0`, web workerd
  `1.20260710.1`, Alchemy `2.0.0-beta.70`, Sandbox `0.12.3`, and Containers
  `0.3.7`.
- **Scope result**: 42 paths changed. `apps/web/src/server.test.ts` and
  `apps/web/scripts/brain-test-nodef.mjs` are outside the plan's exclusive
  implementation path list, while the required
  `docs/architecture/agent-harness.md` update is absent. The implementation is
  therefore not scope-clean.
- **Passing evidence**: frozen root and runner installs completed; exact Pi,
  test-pool, web Wrangler, and legacy runner pin checks passed; `git diff
  --check` passed; Brain Node tests passed 30/30 across six files.
- **First mandatory failures**:
  - `npm run typecheck --prefix apps/web` fails in the new workerd tests,
    including unresolved `cloudflare:test`, unsafe result narrowing, and an
    invalid TypeBox tool fixture.
  - `npm run brain:test --prefix apps/web` fails: eight suites cannot resolve
    Pi's `jiti/static` import, and the remaining source-integrity test reads a
    hard-coded, nonexistent executor `/tmp` path. The test config already adds
    a forbidden `jiti` alias, but that alias neither preserves the unmodified Pi
    graph nor resolves the failure.
  - `npm run brain:test:nodef --prefix apps/web` fails before the probe because
    its wrapper resolves `vitest.brain-nodef.config.ts` from `apps/` instead of
    `apps/web/`.
- **Additional review failure**: `brain-bundle-report.mjs` measures the report
  process heap rather than the required deterministic two-session Pi peak, and
  permits missing startup metadata instead of failing closed. Bundle/startup,
  default tests, build, full `pnpm verify`, and local Alchemy gates were not run
  after the prerequisite failures.
- **External boundary**: no cloud deploy/create/adopt/destroy/repair and no real
  provider call occurred.
- **Disposition at the end of attempt 1**: BLOCKED-local, not a direct-Pi
  NO-GO verdict. Revision 1 must first determine whether the exact unmodified Pi
  `jiti/static` graph can be bundled by the accepted workerd harness without any
  alias or extra production shim. If not, STOP condition 3 applies and the
  architecture requires an explicit no-go review; do not stub the import.

## Revision 1 authorization — 2026-08-12

- The owner authorized a new GPT-5.6 Luna executor with xhigh reasoning because
  the requested Grok service had no remaining credits.
- The isolated revision worktree may cherry-pick `76aa578`; it must not reuse,
  reset, or clean the maintainer checkout or the detached reviewer worktree.
  The clean-worktree branch/path creation block above is superseded only for
  this revision retry because the implementation refs already exist.
- Scope now explicitly includes the Node server-test mock and no-definition
  wrapper/config paths that the original command/test requirements made
  necessary. No other scope expansion is authorized.

## Execution evidence — 2026-08-12 (revision 1, NO-GO candidate)

- **Executor**: GPT-5.6 Luna with xhigh reasoning, owner-authorized after the
  Grok service exhausted its credits. Revision branch
  `pi-agent-b40a490d-2f52-4ce` contains imported attempt commit `0be5756` and
  revision commit `5e09159`. Independent reviewer worktree:
  `/home/ayan/ditto-worktrees/042-revision-review` (detached at `5e09159`).
- **Revision scope**: added exact test-only `jiti@2.7.0`, removed the forbidden
  `jiti` test alias/stub, and attempted documented dependency inlining. The
  revision worktree and `git diff --check` were clean. The blocked branch still
  contains the earlier attempt's unfinished typecheck/test/doc issues and is
  not suitable for integration.
- **Exact public-graph evidence**: Pi Coding Agent `0.80.10` exports only `.` and
  `./rpc-entry`. Its public root exports `DefaultResourceLoader`; that module
  statically imports `core/extensions/loader.js`, which statically imports
  `jiti/static`. Avoiding this edge would require a non-exported deep import,
  Pi package change, alias, or fork, all forbidden by this plan.
- **Mandatory workerd failure**: reviewer reran
  `npm run brain:test --prefix apps/web`. Eight suites fail before collecting
  tests because workerd cannot require `node:process` from `jiti`'s CommonJS
  payload; the ninth still exposes attempt 1's non-portable source-integrity
  test. No Pi boot, session, checkpoint, eviction, context, event, stop-race, or
  substrate result exists.
- **Documented-workaround check**: Cloudflare's current Vitest guidance for
  module-resolution / `require()` failures is
  `test.deps.optimizer.ssr.enabled/include`. The reviewer exercised that path in
  an ignored temporary config with `jiti/static`; Rolldown first rejects Jiti's
  Node built-ins, and retaining those built-ins as externals produces an
  optimized `jiti_static.js` that still fails in workerd on
  `require("node:process")`. Transforming/stubbing that payload would be a
  second compatibility shim rather than the one permitted module-URL
  definition.
- **Other unpassed gates**: app typecheck still fails in the unfinished workerd
  fixtures (`cloudflare:test` typing, result narrowing, and TypeBox fixture
  shape). Steps 3–6 and 8–9, the no-definition probe, bundle/startup/memory,
  default/full verification, docs, and local Alchemy gates were not completed
  after the mandatory boot STOP.
- **External boundary**: no cloud deploy/create/adopt/destroy/repair and no real
  provider call occurred.
- **Verdict**: STOP conditions 1 and 3 are confirmed. Plan 042 cannot continue
  under its pinned-Pi, public-SDK, no-fork/no-alias, one-shim decisions. This is
  a direct-Pi NO-GO candidate requiring an explicit architecture decision; do
  not merge either implementation attempt or dispatch another executor against
  the unchanged plan.
