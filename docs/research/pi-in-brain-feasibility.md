# Pi-in-Brain feasibility (`@earendil-works/pi-coding-agent` 0.80.10)

**Date:** 2026-08-09  
**Ticket:** `.scratch/brain-architecture/issues/01-research-pi-in-brain-compatibility.md`  
**Scope:** Can Pi 0.80.10 run its model loop and multiple session-scoped states **directly inside** a Cloudflare Durable Object under `nodejs_compat`, after replacing local filesystem/process tools and file-backed session persistence? Direct Pi-in-Brain is mandatory; a separate Pi runner is out of scope as a fallback.  
**Rules:** Primary sources only (installed package source/types under `packages/sandbox-runner/node_modules`, first-party Pi docs in that package, official Cloudflare Workers/DO docs). No source edits. No secrets reproduced.

---

## Executive summary

| Area | Finding |
| --- | --- |
| Package pin | `@earendil-works/pi-coding-agent` **0.80.10** (and nested `@earendil-works/pi-ai` / `pi-agent-core` **0.80.10**) is what Ditto’s sandbox-runner installs and imports today. |
| Model loop | **Likely portable** if wired like Ditto’s existing headless path: `createAgentSession` + `ModelRuntime` + in-memory credentials + empty `ResourceLoader` + `session.prompt` / `followUp` / `abort` + `subscribe`. Core loop lives in `pi-agent-core` and is async/`fetch`-driven, not process-driven. |
| Default local tools | **Not runnable as-is in a DO.** Built-in `bash`/`grep`/`find` (default path) call `child_process.spawn`; `child_process` and `worker_threads` are **non-functional stubs** under Workers `nodejs_compat`. |
| Tool adapter seams | **Supported** for remote backends: `Read/Write/Edit/Bash/Find/LsOperations`, `customTools` / `defineTool`, and first-party SSH example. `grep` is only **partially** pluggable (still always spawns `rg`). |
| Session persistence | `SessionManager` is **file JSONL or `inMemory` only** — no storage-adapter interface. DO must use `SessionManager.inMemory` (or ephemeral `/tmp` open within one invocation) and **externally** checkpoint `getEntries()` to DO SQLite/R2. |
| Settings / auth / resources | `SettingsManager.inMemory`, `InMemoryCredentialStore` / `ModelRuntime.create({ credentials, modelsPath: null })`, and a hand-rolled empty `ResourceLoader` are first-class and already used by Ditto. |
| Bundle size (local estimate) | Minimal SDK import graph esbuild-bundled ≈ **13.2 MiB** raw / **~2.4 MiB** gzip — under Workers Paid **10 MiB** compressed limit, but **startup-time (1s)** and **128 MiB isolate memory** remain live risks. |
| Lifetime | DO RPC/HTTP wall clock is unlimited while a caller stays connected; outbound connections keep a DO alive up to **15 minutes** each; idle eviction/hibernation **drops in-memory Pi state**. Alarms are **15 min wall**. CPU is **30s default / 5 min max** active CPU per invocation. |
| Verdict (research) | **Conditionally feasible — not drop-in.** No single source proves a deployed go. Hard product blockers are default process tools and file session durability; both have documented adapter paths. Remaining go/no-go is a **deployed** prototype (ticket 02), not more reading. |

**Bottom line:** Treat Pi-in-Brain as an **embed of the SDK model loop with Ditto-owned adapters**, not “run `ditto-runner` inside a DO.” If the deployed prototype fails bundle/startup, provider streaming, checkpoint/restore after eviction, multi-session memory, or long-run lifetime, the Brain route is a documented **no-go** (per map: no separate Pi runner fallback).

---

## Sources

### Installed Pi packages (repository data)

| Path | Role |
| --- | --- |
| `packages/sandbox-runner/package.json` | Pins `pi-coding-agent` / `pi-ai` **0.80.10** |
| `packages/sandbox-runner/node_modules/@earendil-works/pi-coding-agent/package.json` | Version, exports, deps (`jiti`, `undici`, `proper-lockfile`, `photon-node`, …), `engines.node: >=22.19.0` |
| `.../pi-coding-agent/docs/sdk.md` | Official SDK: `createAgentSession`, tools, sessions, auth, events |
| `.../pi-coding-agent/dist/index.d.ts` / `dist/core/sdk.d.ts` | Public SDK surface |
| `.../pi-coding-agent/dist/core/sdk.js` | `createAgentSession` implementation |
| `.../pi-coding-agent/dist/core/agent-session.js` / `.d.ts` | Tool registry, `baseToolsOverride`, events, prompt/followUp/abort |
| `.../pi-coding-agent/dist/core/session-manager.js` / `.d.ts` | JSONL tree session; `inMemory` / `open` / `create` |
| `.../pi-coding-agent/dist/core/settings-manager.js` / `.d.ts` | `inMemory` settings |
| `.../pi-coding-agent/dist/core/model-runtime.d.ts` / `.js` | Credential/model runtime |
| `.../pi-coding-agent/dist/core/resource-loader.d.ts` | `ResourceLoader` interface + `DefaultResourceLoader` |
| `.../pi-coding-agent/dist/core/tools/*.d.ts` / `*.js` | Pluggable Operations; default spawn/`fs` backends |
| `.../pi-coding-agent/examples/extensions/ssh.ts` | First-party remote Operations pattern |
| `.../pi-coding-agent/examples/sdk/12-full-control.ts` | Empty `ResourceLoader` + in-memory managers |
| `.../pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js` | Core agent loop |
| `.../pi-ai/dist/api/*.js` | Provider streaming (lazy modules; many use `fetch`) |
| `packages/sandbox-runner/src/run-agent.ts` | Ditto chat runner usage |
| `packages/sandbox-runner/src/run-git-metadata.ts` | Empty `ResourceLoader` + `SessionManager.inMemory` pattern |
| `packages/sandbox-runner/src/runner-model.ts` | In-memory credentials + `ModelRuntime.create` |
| `docs/architecture/agent-harness.md` | Current production path (Sandbox container + runner) |

### Official Cloudflare docs

| Topic | URL |
| --- | --- |
| Node.js compatibility matrix | https://developers.cloudflare.com/workers/runtime-apis/nodejs/ |
| `node:fs` VFS | https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/ |
| Workers limits (CPU, memory, size, duration) | https://developers.cloudflare.com/workers/platform/limits/ |
| Durable Objects limits | https://developers.cloudflare.com/durable-objects/platform/limits/ |
| Durable Object lifecycle / hibernation / eviction | https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/ |
| Outbound connections keep DOs alive (15 min) | https://developers.cloudflare.com/changelog/post/2026-06-19-outbound-connections-keep-dos-alive/ |
| DO SQLite storage | https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/ |
| DO in-memory state | https://developers.cloudflare.com/durable-objects/reference/in-memory-state/ |
| DO metrics / 128 MB | https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/ |
| Wrangler bundling / Wasm | https://developers.cloudflare.com/workers/wrangler/bundling/ |

---

## Verified facts

### 1. What Ditto runs today

Verified from `packages/sandbox-runner/src/run-agent.ts` and `docs/architecture/agent-harness.md`:

1. Worker/Sandbox starts **`ditto-runner` inside the project container** (not inside a Brain DO; no Brain DO exists yet — see `docs/research/alchemy-v2-migration.md`).
2. Runner resolves model via `ModelRuntime.create({ credentials: InMemoryCredentialStore, modelsPath: null, allowModelNetwork: false })` (`runner-model.ts`).
3. Chat sessions use **`SessionManager.open(sessionFile)`** on `/workspace/.ditto/sessions/<conversationId>.jsonl`.
4. Settings use **`SettingsManager.inMemory({ compaction.enabled, followUpMode: "one-at-a-time" })`**.
5. Session is created with `createAgentSession({ cwd, agentDir, model, modelRuntime, thinkingLevel, sessionManager, settingsManager, tools: [...builtins + ditto git tools], customTools })`.
6. Events: `session.subscribe` → NDJSON; control via **Unix domain socket** (`control-channel.ts` `net.createServer` / `listen(socketPath)`).
7. Git-metadata path already proves the **empty `ResourceLoader` + `SessionManager.inMemory` + no discovery** pattern (`run-git-metadata.ts`).

### 2. Pi SDK seams that matter for Brain

From `docs/sdk.md` and `dist/core/sdk.d.ts` / `sdk.js`:

| Concern | Supported seam | Default if omitted |
| --- | --- | --- |
| Session factory | `createAgentSession(options)` | Discovers resources; file session under agent dir |
| Model/auth | `modelRuntime`, `model`, `thinkingLevel` | `ModelRuntime.create` from `agentDir` `auth.json` / `models.json` |
| Tools allowlist | `tools`, `excludeTools`, `noTools: "all" \| "builtin"` | Default builtins: `read`, `bash`, `edit`, `write` |
| Custom tools | `customTools: ToolDefinition[]` via `defineTool` | None |
| Resources | `resourceLoader: ResourceLoader` | `DefaultResourceLoader` (disk discovery, packages, jiti extensions) |
| Session store | `sessionManager: SessionManager` | `SessionManager.create(cwd)` (file) |
| Settings | `settingsManager: SettingsManager` | `SettingsManager.create(cwd, agentDir)` (file + lockfile) |
| Events | `session.subscribe` | — |
| Prompt / control | `prompt`, `steer`, `followUp`, `abort`, `clearQueue`, `dispose` | — |

**Not exposed on `createAgentSession`:** `baseToolsOverride` exists on `AgentSessionConfig` (`agent-session.d.ts`) and is honored in `_buildRuntime`, but `createAgentSession` never passes it (`sdk.js`). Practical override paths for Brain:

1. **`customTools` with the same names** as builtins — registry write overwrites by name (`agent-session.js` `_refreshToolRegistry`).
2. Construct tools via `createReadTool` / `createBashTool` / … with `operations`, then register as `customTools` (SSH example pattern).
3. Construct `AgentSession` directly with `baseToolsOverride` (lower-level; not what Ditto uses today).

### 3. SessionManager: no pluggable persistence backend

From `session-manager.d.ts` / `.js`:

- Persistence model: append-only **JSONL tree** (`id` / `parentId`, leaf pointer).
- Factories: `create`, `open(path)`, `continueRecent`, **`inMemory(cwd?)`**, `forkFrom`, `list`.
- `inMemory` sets `persist = false`; `_persist` is a no-op — entries stay in the process heap only.
- File mode uses Node `fs` (`appendFileSync` / `writeFileSync` / `existsSync` / …).
- There is **no** `SessionStore` interface, callback, or async flush hook.
- Public read API for external checkpointing: `getEntries()`, `getHeader()`, `buildSessionContext()`, `getSessionId()`, `isPersisted()`.
- Rehydrate paths that exist in-tree:
  - `SessionManager.open(path)` after writing JSONL to a path.
  - `AgentSessionRuntime.importFromJsonl(inputPath)` (file-based; copies into session dir).
  - Exported `parseSessionEntries` / `buildSessionContext` for offline reconstruction logic.

**Implication for DO:** Workers `node:fs` `/tmp` is **not durable and not shared across requests** (Cloudflare fs docs). File-backed `SessionManager` cannot be the durability layer. Brain must checkpoint entries to **DO SQLite and/or R2**, and rebuild an in-memory or per-invocation `/tmp` session on wake.

SQLite-backed DO limit relevant here: **max string/BLOB/row size 2 MB** (DO limits). Large session JSONL must be chunked across rows or offloaded to R2 (map already says R2 holds large Pi snapshots).

### 4. Tool Operations: what is fully vs partially replaceable

| Tool | Operations interface | Default backend | Fully remote-replaceable? |
| --- | --- | --- | --- |
| `read` | `readFile`, `access`, optional `detectImageMimeType` | `fs/promises` + image pipeline (`processImage` → photon / `worker_threads`) | **Yes**, if images avoided or image pipeline disabled |
| `write` | `writeFile`, `mkdir` | local fs | **Yes** |
| `edit` | `readFile`, `writeFile`, `access` | local fs | **Yes** |
| `bash` | `exec(command, cwd, { onData, signal, timeout, env })` | `createLocalBashOperations` → `child_process.spawn` shell | **Yes** via custom `exec` (SSH example) |
| `ls` | `exists`, `stat`, `readdir` | local fs | **Yes** |
| `find` | `exists`, optional `glob` | If `glob` provided → no spawn; else `ensureTool("fd")` + `spawn` | **Yes only with custom `glob`** |
| `grep` | `isDirectory`, `readFile` only | **Always** `ensureTool("rg")` + `spawn(rgPath, …)` | **No** — must **replace whole tool** via `customTools` name `grep` or omit |

First-party confirmation: `examples/extensions/ssh.ts` documents “delegating tool operations to a remote machine” for read/write/edit/bash.

`ensureTool` (`utils/tools-manager.js`) may **download** `rg`/`fd` via `fetch` + extract with `spawnSync` — unusable and undesirable inside a DO.

### 5. ResourceLoader / extensions / dynamic loading

- `DefaultResourceLoader` discovers extensions/skills/prompts/themes/context files from disk and can install packages (`package-manager.js` uses `fs`, `spawn`, `/proc/self/environ`).
- Extensions load through **`jiti`** (`extensions/loader.js`) — dynamic TypeScript evaluation, `createRequire`, filesystem reads.
- `ResourceLoader` is a plain interface; Ditto already implements a **no-op loader** in `run-git-metadata.ts` and Pi’s `examples/sdk/12-full-control.ts`.

**Brain must pass an explicit empty/static `ResourceLoader`.** Do not load project extensions via jiti inside the DO for the first cut.

### 6. Model / provider stack

- `Agent` (`pi-agent-core`) runs an async loop: stream assistant → execute tools → repeat (`agent-loop.js`).
- `createAgentSession` injects `streamFn` → `modelRuntime.streamSimple(...)` with timeout/retry/header hooks (`sdk.js`).
- `ModelRuntime.create` accepts `credentials?: CredentialStore`, `modelsPath?: string | null`, `allowModelNetwork?: boolean` (`model-runtime.d.ts`) — matches Ditto runner.
- Provider implementations are largely **lazy-loaded**; streaming commonly uses **`fetch`** (e.g. `pi-ai` `api/pi-messages.js`).
- CLI/interactive paths call `configureHttpDispatcher()` (**undici** `EnvHttpProxyAgent` / `setGlobalDispatcher`) from `main.js` / `cli.js` / `rpc-entry.js`. **SDK `createAgentSession` does not call it.** Brain should not import CLI entrypoints.
- Package `engines` declare **Node `>=22.19.0`**. That is a package constraint on Node; Workers is **workerd**, not that Node version. Compatibility is API-surface based via `nodejs_compat`, not engine matching.

### 7. Node / Workers API reality for Pi’s imports

From Cloudflare Node.js compatibility docs (supported vs stub table):

| Node surface Pi uses | Workers `nodejs_compat` status (docs) | Brain impact |
| --- | --- | --- |
| `path`, `buffer`, `stream`, `crypto`, `events`, `url`, `util` | Supported | OK |
| `process` | Supported (serverless semantics) | OK if not assuming real PID/uid/shell |
| `fs` / `node:fs` | Supported **virtual** FS: `/bundle` RO, **`/tmp` ephemeral per request**, not durable | Cannot host durable sessions; accidental writes vanish across requests |
| `net` | Supported | Ditto’s Unix control socket is the wrong control plane in DO; use DO RPC/HTTP |
| `child_process` | **Non-functional stub** (enable date `2026-03-17`) | Default bash/grep/find/package-manager/tools-manager break if executed |
| `worker_threads` | **Non-functional stub** | Image resize worker path unusable; in-process fallback may still touch photon |
| `os` | Partial | `homedir()` etc. may be wrong; avoid default agentDir discovery |
| `readline` | Stub (same cohort as child_process) | Default grep/find streaming helpers import it — another reason to avoid those defaults |

### 8. Durable Object lifetime, CPU, memory, storage

Verified from Cloudflare limits / lifecycle / changelog:

| Constraint | Value | Relevance |
| --- | --- | --- |
| CPU per DO invocation | 30s default, configurable to **5 min** active CPU | Compaction, large JSON parse, multi-tool turns can burn CPU; waiting on `fetch`/RPC does **not** count |
| Wall clock (DO RPC/HTTP) | **Unlimited while caller connected** / I/O in flight | Workflow/Worker stub can own a long `prompt()` |
| Alarm handler wall | **15 minutes** | Cannot park an entire long agent run solely in one alarm without chunking |
| Outbound connection keep-alive | Active outbound `connect()` / outbound WebSocket prevents eviction for up to **15 minutes per connection** | Pure fetch streaming may differ; do not assume infinite keep-alive without a caller |
| Hibernation | After ~10s idle **if** no timers, no in-flight `fetch`, no standard WebSocket API, no active outbound TCP/WS, no in-progress request | In-memory `AgentSession` **gone** after hibernate/evict |
| Eviction (non-hibernateable idle) | ~**70–140s** inactivity | Same: heap Pi state lost |
| Isolate memory | **128 MB** (Workers + DO metrics docs) | Multiple live sessions + large contexts + bundled provider SDKs compete for one heap |
| SQLite per DO | **10 GB** paid; **2 MB** / row-BLOB | Session snapshots must chunk or use R2 |
| Simultaneous outgoing connections waiting for headers | **6** | Parallel tool fan-out + model stream + sandbox RPC must stay within budget |
| Worker bundle size (paid) | **10 MB gzip** | Local minimal bundle ~2.4 MB gzip — headroom, not proof of deploy |
| Worker startup | **1 second** global scope | Large Pi graph is a startup risk; lazy/import splitting may be required |

### 9. Local bundle measurement (not a deploy proof)

From the sandbox-runner install tree, esbuild bundling a minimal entry that only imports `createAgentSession`, `SessionManager`, `SettingsManager`, `ModelRuntime`, `defineTool`, `InMemoryCredentialStore`:

- Output ≈ **13.2 MiB** uncompressed, ≈ **2.43 MiB** gzip.
- Graph still included heavy transitive code observed in the bundle text: provider SDKs (`@anthropic-ai`, `@google/genai`, …), **jiti + babel**, **photon-node** JS glue, `child_process` / `worker_threads` requires.

This is a **verified local packaging signal**, not a Cloudflare deployment result. Tree-shaking under Wrangler may differ; startup time and native/wasm edge cases are unproven until deploy.

### 10. Multiple session-scoped states

- One `createAgentSession` → one `AgentSession` → one `SessionManager` / one `Agent` state.
- Nothing in Pi prevents a Brain DO from holding `Map<conversationId, AgentSession>` in memory.
- DO execution is **single-threaded**; concurrent sessions are cooperative concurrency on awaits, not parallel isolates.
- Hibernation/eviction clears the map unless checkpointed.
- Memory: N sessions × (messages + tool payloads + provider SDK state) must fit in **128 MB** with the bundle.

---

## Hypotheses (not yet verified in a deployed DO)

These are reasoned from the facts above; they require ticket 02 to confirm or kill.

1. **`createAgentSession` will load and run under `nodejs_compat`** if Brain never executes default spawn tools and never uses `DefaultResourceLoader` / CLI entrypoints.
2. **Provider streaming via `fetch` works** from a DO for the providers Ditto actually uses (today: credential-injected catalog models via `ModelRuntime`), without undici global dispatcher.
3. **External checkpoint of `sessionManager.getEntries()` every message_end/tool_end** is sufficient to restore after forced eviction when combined with re-`createAgentSession` + context rebuild (exact restore recipe may need `/tmp` JSONL rewrite + `SessionManager.open` within the restoring invocation).
4. **Sandbox-backed tool Operations** (RPC/HTTP to Project Sandbox) can implement `BashOperations.exec` and file ops with acceptable latency and within the 6-connection header budget.
5. **Gzip bundle stays under 10 MB and startup under 1s** in the real Worker that also contains Sandbox bindings, Workflows, and app code — or Pi must be split into a dedicated Worker script binding.
6. **Two concurrent session prompts in one Brain** remain stable without exceeding memory or interleaving control bugs.
7. **Long runs (>15 min)** remain correct if a Workflow (or other non-browser owner) keeps an RPC/request alive across model/tool I/O; alarm-only ownership is insufficient without step chunking.

---

## Runtime dependency matrix (model loop path)

| Dependency | Where | Required for model loop? | DO strategy |
| --- | --- | --- | --- |
| `fetch` streaming | `pi-ai` providers, agent loop | **Yes** | Use runtime `fetch`; avoid undici dispatcher CLI path |
| `SessionManager` memory | session-manager | **Yes** (state) | `inMemory` + external checkpoint |
| `SettingsManager` | settings-manager | **Yes** | `inMemory` only (skip file + `proper-lockfile`) |
| `ModelRuntime` + `InMemoryCredentialStore` | model-runtime / pi-ai | **Yes** | Same as runner-model; never write `auth.json` |
| Empty `ResourceLoader` | resource-loader interface | **Yes** (to avoid disk/jiti) | Copy git-metadata / 12-full-control pattern |
| Built-in `read/write/edit/bash` local ops | tools/* | No | Replace with Sandbox Operations or custom tools |
| `grep` default | tools/grep.js | No | Omit or full custom tool (spawn hard dependency) |
| `find` default fd | tools/find.js | No | Custom `glob` ops or omit |
| `child_process` | bash, grep, find, package-manager, tools-manager, pi-tui | No if unused | Must not execute; stubs throw/no-op |
| `worker_threads` | image-resize | No if images off | `blockImages: true` / no image tools |
| `photon-node` | image pipeline | No if images off | Keep out of hot path; may still bundle |
| `jiti` | extension loader | No | Empty ResourceLoader; no disk extensions |
| `proper-lockfile` | settings/auth/trust file writers | No | in-memory managers only |
| `net` Unix socket | Ditto control-channel only | No | Replace with DO RPC methods |
| `fs` durable paths | SessionManager.open/create | No for durability | Optional ephemeral `/tmp` rebuild only |
| Interactive/TUI/CLI | modes/*, main, rpc-entry | No | Do not import |

---

## Hard blockers vs supported adapters

### Hard blockers (if unaddressed)

1. **Default process tools** (`bash` local, `grep`, default `find`) on stub `child_process`.
2. **File-backed `SessionManager` as durability** against DO hibernation/eviction and non-durable `/tmp`.
3. **`DefaultResourceLoader` / jiti extensions / package install** inside the DO.
4. **Ditto Unix control socket** as the control plane (wrong abstraction; also path/socket assumptions).
5. **Assuming in-memory `AgentSession` survives** idle eviction or deploy restart without checkpoints.
6. **Alarm-only ownership of multi-hour runs** without chunking (15 min alarm wall).
7. **Treating “nodejs_compat” as full Node** — stubs and VFS semantics differ in exactly the APIs Pi’s coding tools use.

### Supported adapters (first-party)

1. `SessionManager.inMemory` + external store of entries/snapshots.
2. `SettingsManager.inMemory`.
3. `ModelRuntime` + `InMemoryCredentialStore` / `setRuntimeApiKey`.
4. Custom `ResourceLoader`.
5. Tool `operations` for read/write/edit/bash/ls/find(glob).
6. `customTools` / `defineTool` (including name override of builtins).
7. Event subscription + `followUp` / `abort` matching Ditto’s runner control semantics.
8. SSH example as the canonical “remote exec plane” pattern (Sandbox replaces SSH).

### Soft risks (prototype must measure)

- Bundle size + **startup 1s** with real app graph.
- **128 MB** with multiple sessions and long contexts.
- Provider SDK Node assumptions (`@google/genai` node build appeared in local bundle).
- Image/photon path if ever enabled.
- Compaction CPU on large histories.
- 2 MB SQLite row limit vs session snapshot size.
- 6 concurrent outbound connections when model stream + sandbox tool calls overlap.
- Single-threaded head-of-line blocking between sessions.

---

## Smallest deployed go/no-go prototype

Aligns with ticket `02-prototype-deployed-pi-brain.md`. Direct Pi-in-Brain only.

### Prototype shape (minimum)

One throwaway Worker + **one SQLite-backed Durable Object class** (`BrainProbe`) + `nodejs_compat` (compat date ≥ fs + needed Node flags) + `limits.cpu_ms` raised (e.g. 300000). No production Brain architecture required.

**In-DO wiring (mirror runner, strip container-only pieces):**

```text
InMemoryCredentialStore
  -> ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false })
SettingsManager.inMemory({ compaction: { enabled: true }, followUpMode: "one-at-a-time", blockImages: true })
empty ResourceLoader (system prompt fixed string)
SessionManager.inMemory(cwd)
customTools: [ one fake tool OR one Sandbox-backed bash/read Operations tool ]
tools: [ that tool name only ]  // no default grep/bash/find
createAgentSession({ ... })
session.subscribe -> append events to DO SQLite
on message_end/tool_end/agent_end: checkpoint sessionManager.getEntries() (+ optional R2 if > row limit)
```

**Control plane:** DO RPC/HTTP methods `start`, `followUp`, `stop`, `getEvents(cursor)`, `checkpoint`, `forceEvict` (test harness), not Unix sockets.

**Run owner:** a short-lived **Workflow step or Worker POST that stays connected** for the prompt (map forbids browser ownership; prototype may use curl/Workflow). Separately prove **restore after eviction** without that connection.

### Explicit pass criteria (all required for go)

| ID | Criterion | How to observe |
| --- | --- | --- |
| P1 | Worker+DO **deploys** with Pi SDK import graph under paid size limit and startup limit | `wrangler deploy` success; startup_time_ms / no error 10021 |
| P2 | `createAgentSession` succeeds in DO with in-memory managers + empty ResourceLoader | RPC returns sessionId; no throw |
| P3 | `session.prompt` completes one model turn with streamed `message_update` text_deltas persisted to DO SQLite **while caller may disconnect after start** *or* with Workflow owner — at least one path must complete without browser | Event log + terminal assistant text |
| P4 | Exactly one tool call executes via **non-local** tool (fake in-DO tool **or** secretless Sandbox-backed Operations); **zero** `child_process` success paths | tool_execution_end success; no spawn |
| P5 | Checkpoint: after agent_end, SQLite (and R2 if used) contains full entry list sufficient to rebuild context | Row counts / snapshot hash |
| P6 | **Forced eviction/hibernation** (idle past eviction window or DO restart): next request restores session from storage and `followUp` produces a second assistant turn that sees prior context | followUp text references prior user content |
| P7 | `stop`/`abort` ends an in-flight prompt and leaves a consistent checkpoint | stop RPC; isStreaming false; no corrupt entries |
| P8 | Two session IDs in one DO: independent prompt/checkpoint without cross-talk | two conversationIds, isolated entries |
| P9 | No durable reliance on `/tmp` or container FS for Pi state | Kill DO memory; only SQLite/R2 restore |

### Explicit fail criteria (any one ⇒ no-go for direct Pi-in-Brain)

| ID | Failure |
| --- | --- |
| F1 | Deploy/bundle/startup failure that cannot be fixed without removing Pi from the DO |
| F2 | `createAgentSession` or first `prompt` throws due to missing Node APIs / stub modules on the required import path |
| F3 | Provider stream cannot complete reliably from DO (auth, fetch, CPU, connection limits) |
| F4 | Cannot restore conversation context after eviction without a living in-memory session |
| F5 | Only works while a browser/Worker request remains connected **and** no Workflow/alarm chunking pattern can own completion |
| F6 | Multi-session map infeasible under 128 MB for even two small sessions |
| F7 | Tool lane requires `child_process` or other stubbed APIs with no Operations/customTools alternative |

### What the prototype must not do

- Ship a second Pi runner container/process as the Brain compute path.
- Call success based on `wrangler dev` local Node only.
- Use `SessionManager.create/open` on durable paths that are actually VFS `/tmp`.
- Enable `DefaultResourceLoader` disk discovery.
- Treat a single successful prompt without eviction restore as a go.

---

## Recommended Brain embed recipe (research-only)

This is the shortest path consistent with verified seams (not an implementation):

1. **Import only SDK symbols** (`createAgentSession`, managers, `defineTool`, tool factories) — never `main` / `cli` / `rpc-entry` / interactive mode.
2. **Auth/model:** copy `runner-model.ts` pattern (in-memory credentials, scrub secrets from env before tools).
3. **Settings:** `SettingsManager.inMemory` with compaction + follow-up mode; **`blockImages: true`**.
4. **Resources:** empty `ResourceLoader` with fixed system prompt.
5. **Session:** `SessionManager.inMemory`; checkpoint `getEntries()` to SQLite (chunk) + R2 for large snapshots; restore by rewriting JSONL to `/tmp` **within the restoring invocation** and `SessionManager.open`, or equivalent rebuild — prove in prototype.
6. **Tools:** allowlist only Sandbox-backed Operations tools / Ditto custom tools; **omit default `grep`** or replace entirely; never call `createLocalBashOperations` in DO.
7. **Control:** DO RPC `followUp` → `session.followUp`; `stop` → `clearQueue` + `abort` (as `run-agent.ts` does).
8. **Lifetime:** Workflow owns run; Brain DO holds session actors; Project Sandbox remains secretless exec plane.
9. **Concurrency:** one DO per project; serialize or carefully interleave session prompts; bound live sessions in memory.

---

## Mapping to wayfinder decisions

| Map claim | Research result |
| --- | --- |
| Direct Pi-in-Brain is a hard gate | Still the gate; research does **not** close it — prototype does |
| D1 authoritative for conversations/runs; Brain SQLite coordinates; R2 large snapshots | Compatible with SessionManager’s lack of storage adapter |
| Project Sandbox secretless; credentials never enter sandbox | Fits ModelRuntime-in-Brain + Operations tools into sandbox |
| Multiple Workspace Session Pi states in one Brain | Feasible as multiple `AgentSession`s; memory/eviction are the risks |
| No separate Pi runner fallback | If prototype fails F1–F7, Brain route is **no-go**, not “run Pi elsewhere” |

---

## Conclusion

**Research verdict: conditionally feasible with mandatory adapters; deployment proof still required.**

Pi 0.80.10’s **headless SDK model loop** is designed with the seams Ditto already uses (in-memory settings/credentials, custom tools, optional ResourceLoader, event subscription). Those seams are the only realistic Brain path.

Pi 0.80.10’s **default coding-agent substrate** (local fs tools, spawn/grep/fd, JSONL files, jiti extensions, CLI undici dispatcher, Unix-style control) is **not** a Durable Object runtime. Cloudflare `nodejs_compat` does not make it one: `child_process`/`worker_threads` are stubs, and `fs` is an ephemeral VFS.

There is **no verified deployed success or failure** in this research pass. Ticket 02’s prototype, with the pass/fail table above, is the correct next step and the actual go/no-go instrument.
