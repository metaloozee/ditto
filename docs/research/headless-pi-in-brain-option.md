# Headless Pi in Brain: what it means, what is actually possible, and what Ditto should prove

**Research date:** 2026-08-12
**Question:** What should “headless Pi in Brain” mean, and which Pi API should Ditto use to host the project-scoped Pi Runtime inside a Cloudflare Brain Durable Object?
**Audience:** Ditto owner, maintainer, security reviewer, and Pi maintainer

> **Short version:** “Headless” means Pi’s model-and-tool loop without its terminal user interface, CLI startup, plugin discovery, local process tools, or file-backed session ownership. The strongest existing candidate is not currently a new `@earendil-works/pi-coding-agent/headless` package. It is direct composition of the already public, runtime-neutral `@earendil-works/pi-agent-core` APIs with `@earendil-works/pi-ai`, Ditto-owned tools, and Brain-owned durable session storage. A small compatibility spike should test that option first, then test the existing Coding Agent SDK through a real Wrangler production bundle. A new upstream Coding Agent headless export remains a good long-term API, but it should not be assumed to be the best first implementation.

## Executive summary and recommendation

### The architecture in ordinary language

Ditto has two different jobs:

1. **Brain remembers and coordinates.** A Brain Durable Object is the trusted, project-scoped coordinator. It owns several Pi Agent Sessions, controls which Workspace Session may change, keeps event cursors and Safe Checkpoints, and holds provider credentials in memory only.
2. **Project Sandbox changes project state.** The Project Sandbox is the untrusted execution environment. It contains the repository and Workspace Session worktrees, but it must not receive agent, provider, Git, or GitHub credentials. Pi must reach it only through narrow Brain-owned capabilities, not a shell or raw Sandbox handle.

This preserves the vocabulary in `CONTEXT.md:7-16` and `CONTEXT.md:47-49`: the **Pi Runtime** is the project-scoped harness; a **Pi Agent Session** belongs to one Workspace Session; neither is the same thing as an Agent Run or a conversation.

### Recommendation

**Recommended default: choose Option A, but only after a tiny compatibility spike.**

Option A uses:

- `@earendil-works/pi-agent-core@0.80.10` for `Agent` or `AgentHarness`;
- `@earendil-works/pi-ai@0.80.10` for models, credentials, and provider streams;
- a Brain implementation of `ExecutionEnv` and `SessionStorage`/`Session`;
- static resources and Ditto-owned code-defined tools; and
- D1, Brain SQLite, and R2 according to the Wayfinder authority split.

This is an existing public API surface, not a speculative rewrite. The exact 0.80.10 Agent Core root exports `Agent`, `AgentHarness`, `Session`, `SessionStorage`, `InMemorySessionStorage`, `InMemorySessionRepo`, compaction helpers, events, tools, and an abstract `ExecutionEnv` (`npm:@earendil-works/pi-agent-core@0.80.10/dist/index.d.ts:L1-L21`, `npm:@earendil-works/pi-agent-core@0.80.10/dist/harness/types.d.ts:L118-L225`, `npm:@earendil-works/pi-agent-core@0.80.10/dist/harness/session/session.d.ts:L1-L46`). Its Node implementation is explicitly separated under `./node`, whose `NodeExecutionEnv` imports `node:child_process`, `node:fs`, `node:readline`, and related Node APIs (`npm:@earendil-works/pi-agent-core@0.80.10/package.json:L8-L20`, `npm:@earendil-works/pi-agent-core@0.80.10/dist/node.js:L1-L2`, `npm:@earendil-works/pi-agent-core@0.80.10/dist/harness/env/nodejs.js:L1-L7`).

**Do not implement checkpoints, event persistence, or a production Brain runtime until the spike has passed.** The spike must compare Option A with:

- **Option B:** an upstream, proposed `@earendil-works/pi-coding-agent/headless` export;
- **Option C:** the existing Coding Agent root, but only through a real Wrangler production bundle and workerd execution; and
- **Option D:** a trusted compute/container redesign, which is not an allowed fallback under the current Wayfinder map and requires reopening its hard rule.

### What this research does and does not conclude

- Direct Pi in Brain remains the intended architecture under the current map. `.scratch/brain-architecture/issues/00-map.md:16-18` makes it a hard gate and explicitly rejects a separate Pi runner as a fallback.
- The earlier Plan 042 result **does not prove that production workerd cannot run Pi**. It proves that the selected `@cloudflare/vitest-pool-workers@0.21.2` source-module/dependency-optimizer path could not load the unmodified Coding Agent graph in its attempted configuration. That distinction matters.
- The old direct Wrangler probe is useful historical evidence, but it was local, had a TypeBox postinstall patch, had no retained machine-readable report, and never deployed. It is not production acceptance evidence.
- The current evidence is sufficient to justify a new compatibility spike, not to declare a production GO.

## Prominent correction to our current conclusion

### The old conclusion was too strong

The simplified earlier conclusion was effectively:

```text
Pi SDK -> jiti -> unsupported Node behavior -> Pi cannot run in workerd
```

That is not a safe conclusion from the evidence.

### What the evidence actually says

**1. The historical prototype used a real direct Wrangler/workerd path.**

Commit `7cbee00` configured the prototype with `nodejs_compat` and a Wrangler `define` for `import.meta.url` (`7cbee00:prototypes/pi-brain-probe/wrangler.jsonc:5-11`). Its package used Wrangler `^4.120.0`; the lockfile resolved Wrangler's workerd to `1.20260801.1` (`7cbee00:prototypes/pi-brain-probe/package.json:1-20`, `7cbee00:prototypes/pi-brain-probe/package-lock.json:4509-4525`). The repository history says its local workerd smoke covered streaming, a secretless `probe_echo` tool, checkpointing, reset, restore, follow-up, Stop, and Workflow ownership (`7cbee00:prototypes/pi-brain-probe/scripts/smoke.mjs:49-149`). The prototype README claimed a local smoke pass, but no machine-readable report was retained and Cloudflare never ran the deployment smoke (`19f0bc7:prototypes/pi-brain-probe/README.md:17-23`). It also ran `scripts/patch-pi-validation.mjs` after install (`7cbee00:prototypes/pi-brain-probe/package.json:4-9`), so this was not a clean proof of unmodified Pi plus unmodified TypeBox.

This demonstrates that **one direct production-shaped bundle path can get farther than the failed Vitest path**. It does not prove that the path is reliable, deployable, secure, or compatible with Ditto’s full Website Worker.

**2. Plan 042 failed in the test harness before its Pi tests collected.**

Attempt 1 used a forbidden `jiti` alias/stub, and revision 1 removed it and tried dependency inlining (`76aa578:apps/web/vitest.brain.config.ts:1-43`, `5e09159:apps/web/vitest.brain.config.ts:1-43`). The revision still failed eight suites because workerd could not load `node:process` from the CommonJS payload reached through `jiti/static`; no Pi boot, provider stream, checkpoint, eviction, or context result was produced (`plans/042-host-project-pi-runtime-in-brain.md:1197-1231`). The attempt’s plan explicitly records that this was **not** a direct-Pi NO-GO verdict at the end of attempt 1 (`plans/042-host-project-pi-runtime-in-brain.md:1158-1177`).

The relevant Cloudflare guidance says the Workers Vitest integration runs tests inside Workers, but also warns that test behavior can differ from deployment and that the test configuration must match production Node compatibility (`https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/`). The production Wrangler path instead bundles with esbuild and can be inspected with `wrangler deploy --dry-run --outdir` (`https://developers.cloudflare.com/workers/wrangler/bundling/`, `https://developers.cloudflare.com/workers/wrangler/commands/workers/`). Therefore:

```text
Vitest module runner / dependency optimizer failure
                 !=
proof that the Wrangler production artifact cannot execute in workerd
```

**Confidence:** high that the selected Plan 042 Vitest graph failed; medium that the Coding Agent root is a poor Brain dependency; low that production workerd is definitively impossible without a new upstream export.

**3. “Not executed” was confused with “not imported.”**

Passing a static `ResourceLoader` changes what `createAgentSession()` does at runtime. It does not change the modules that the package root and `sdk.js` statically import while the module graph is being loaded. In exact 0.80.10:

- the public root exports `DefaultResourceLoader`, `AgentSession`, all tools, CLI/main/modes/TUI, and `createAgentSession` (`npm:@earendil-works/pi-coding-agent@0.80.10/dist/index.js:L1-L46`);
- `sdk.js` statically imports `AgentSession`, `DefaultResourceLoader`, all Coding Agent tool factories, `node:path`, and the Agent Core layer (`npm:@earendil-works/pi-coding-agent@0.80.10/dist/core/sdk.js:L1-L17`); and
- `AgentSession` statically imports Node filesystem/path APIs, interactive themes, extensions, the local bash implementation, and all tool definitions (`npm:@earendil-works/pi-coding-agent@0.80.10/dist/core/agent-session.js:L14-L38`).

A caller-provided static resource loader prevents **resource discovery and extension execution**. It does not remove `jiti/static` or the other root graph edges from the bundle. This is why Option A is important: it starts below the Coding Agent orchestration layer rather than hoping a runtime option can prune static imports.

## What “headless Pi” should mean

### Definition

For Ditto, a **headless Pi Runtime** is:

> A trusted, non-interactive host of Pi’s model loop that receives prompts from Workflow/Brain orchestration, streams structured events, runs only code-owned tools, and reconstructs Pi Agent Session state from durable Ditto storage. It has no terminal UI, CLI argument parser, plugin filesystem, project shell, local coding-tool implementation, or authority over D1 conversation identity.

The word “headless” describes the **host mode**, not a promise that every Pi feature works. A headless Runtime may still provide:

- model/provider streaming;
- text, thinking, tool-call, tool-result, turn, and run events;
- prompt, follow-up, Stop/abort, and bounded queueing;
- compaction if its storage and model policy are supported;
- multiple Pi Agent Sessions in one Brain; and
- model context rebuilt from a durable Safe Checkpoint.

### Non-goals for the first Brain version

The first version must not attempt to host:

- the interactive TUI or `main()`;
- CLI argument parsing or RPC subprocess mode;
- dynamic extension loading, `jiti`, package installation, skills/prompts/themes discovered from disk, or `AGENTS.md` walking;
- Pi’s default `bash`, `grep`, `find`, `read`, `write`, `edit`, or image-processing implementations when they require local process/filesystem behavior;
- a general terminal or PTY;
- provider OAuth/login flows inside the project Brain;
- file-backed JSONL as the authority for Pi state;
- a browser connection as the owner of execution; or
- a separate trusted Pi container as an automatic fallback.

Those exclusions align with `.scratch/brain-architecture/issues/07-decide-run-state-and-recovery.md` and `.scratch/brain-architecture/issues/08-decide-tool-lanes-and-scheduling.md`: D1 owns conversations and Agent Runs, Brain SQLite owns coordination/checkpoints/events, R2 stores large immutable payloads, and memory is a cache.

## The five relevant architectures

### Current architecture: Sandbox runner

```text
Browser
  -> Website Worker
      -> Project Sandbox
          -> ditto-runner process
              -> Coding Agent SDK / Pi Agent Session
                  -> provider
          -> /workspace/.ditto/sessions/<session>.jsonl
          -> Unix control socket
```

The current architecture is documented in `docs/architecture/agent-harness.md:44-49` and `docs/architecture/agent-harness.md:77-107`. It is a full Node/container path: the runner opens file-backed JSONL, creates local tools, and receives credentials in the Sandbox process environment. It is not the proposed Brain architecture.

### Failed Coding Agent root through the selected Vitest path

```text
cloudflareTest() / Vitest
  -> Vite module runner and dependency optimizer
      -> @earendil-works/pi-coding-agent root
          -> sdk.js
              -> AgentSession
              -> DefaultResourceLoader
                  -> extensions/loader.js
                      -> jiti/static
                          -> CommonJS require("node:process")
                              -> test collection fails in workerd
```

This diagram describes the observed **test-harness failure**, not a proven production failure. The exact static Coding Agent edges are shown in the forensic section below.

### Prior direct Wrangler probe

```text
Wrangler 4.120.x dry bundle
  + nodejs_compat
  + import.meta.url = "file:///bundle/index.js"
  -> one Brain Durable Object
      -> Coding Agent createAgentSession()
          -> static ResourceLoader
          -> in-memory managers
          -> one fake code-owned tool
          -> provider stream
          -> local SQLite journal/checkpoint
          -> forced reset
          -> fresh /tmp restore
```

Commit `7cbee00` used this shape (`7cbee00:prototypes/pi-brain-probe/wrangler.jsonc:1-22`; `7cbee00:prototypes/pi-brain-probe/src/index.ts:188-228`, `7cbee00:prototypes/pi-brain-probe/src/index.ts:350-365`). It is useful, incomplete historical evidence. The TypeBox postinstall patch and lack of a retained report prevent treating it as the final compatibility answer.

### Existing Agent Core composition

```text
Website Worker
  -> Brain Durable Object
      -> pi-agent-core AgentHarness or Agent
          -> pi-ai Models.streamSimple()
          -> Brain ExecutionEnv
              -> Brain-jailed file capabilities / Sandbox RPC
          -> Brain SessionStorage
              -> durable checkpoint adapter
          -> code-owned Tool[]
```

This option avoids the Coding Agent root entirely. Exact Agent Core 0.80.10’s root exports are re-exports of the loop, harness, memory sessions, JSONL abstractions, tools, and types (`npm:@earendil-works/pi-agent-core@0.80.10/dist/index.js:L1-L26`). The root imports no `./node` implementation. `ExecutionEnv` is an abstract capability interface (`npm:@earendil-works/pi-agent-core@0.80.10/dist/harness/types.d.ts:L118-L225`), and `SessionStorage` is an abstract persistence interface (`npm:@earendil-works/pi-agent-core@0.80.10/dist/harness/types.d.ts:L378-L436`).

### Proposed upstream Coding Agent headless export

```text
Website Worker
  -> Brain Durable Object
      -> @earendil-works/pi-coding-agent/headless  // proposed; does not exist today
          -> Agent Core + pi-ai
          -> static resource values
          -> injected session backend
          -> injected tool registry / execution environment
```

A real upstream export must be a separate module graph, not a re-export of today’s `sdk.js`. The current public package does not export `./headless` in 0.80.10 or 0.84.1. Exact latest metadata observed locally shows Coding Agent 0.84.1 exports only `.`, `./rpc-entry`, and `./client` (`npm:@earendil-works/pi-coding-agent@0.84.1/package.json:L9-L25`; global install `/home/ayan/.nvm/versions/node/v24.14.1/lib/node_modules/@earendil-works/pi-coding-agent/package.json:L9-L25`). Its latest `dist/core/sdk.js` still imports `DefaultResourceLoader` and `AgentSession` (`npm:@earendil-works/pi-coding-agent@0.84.1/dist/core/sdk.js:L1-L16`).

## Forensic timeline: where the research gap occurred

1. **Existing product path.** Ditto’s live agent harness was designed around a full Node Sandbox container: file JSONL, local tools, a Unix control socket, and a container process (`docs/architecture/agent-harness.md:77-107`, `docs/architecture/agent-harness.md:149-158`).
2. **Initial feasibility research.** `docs/research/pi-in-brain-feasibility.md:14-20` correctly identified portable seams: in-memory settings and credentials, a static resource loader, custom tools, events, and external SQLite/R2 checkpoints. It also correctly identified local tools, file-backed sessions, and Unix sockets as unsuitable for a Durable Object (`docs/research/pi-in-brain-feasibility.md:107-148`, `docs/research/pi-in-brain-feasibility.md:227-244`).
3. **Prototype.** Commit `7cbee00` tested a direct Wrangler/workerd probe. It used one synthetic URL definition and claimed a local smoke path, but it also used a TypeBox postinstall patch and did not retain a machine-readable report. Commit `19f0bc7` recorded the waiver: Cloudflare did not run the deployed smoke and the result was risk acceptance, not a deployed pass (`19f0bc7:prototypes/pi-brain-probe/README.md:17-23`).
4. **Sequencing error.** The project treated “the Brain will not execute extensions or local tools” as if it meant “the Coding Agent package will not import the extension loader or local-tool modules.” Those are different questions. A static option changes runtime execution, not ESM module linking.
5. **Plan 042 attempt 1.** The executor produced substantial Brain storage/runtime code, but the selected Vitest suite had unresolved type and module failures. It introduced a forbidden `jiti` alias/stub and did not prove the required production two-session memory report (`plans/042-host-project-pi-runtime-in-brain.md:1138-1177`).
6. **Plan 042 revision 1.** The alias/stub was removed and `jiti@2.7.0` was inlined, but the Vitest source module runner still failed before collection on `require("node:process")` in the optimized `jiti/static` payload (`5e09159:apps/web/vitest.brain.config.ts:1-43`; `plans/042-host-project-pi-runtime-in-brain.md:1197-1231`).
7. **Correct interpretation.** The revision proves that **this mandatory test configuration cannot currently load the exact public Coding Agent graph without another compatibility treatment**. It does not distinguish whether a real Wrangler production artifact could bundle the dormant jiti edge safely, nor whether Option A avoids the edge entirely.
8. **Required recovery.** Run the compatibility spike before any checkpoint/event implementation. Test the exact production artifact and the test artifact separately, and include a direct Agent Core composition test.

## Exact package evidence and import graphs

### Coding Agent 0.80.10: public surface and root graph

The exact package manifest has only two public exports: `.` and `./rpc-entry` (`npm:@earendil-works/pi-coding-agent@0.80.10/package.json:L9-L25`). It has direct dependencies on `jiti`, `proper-lockfile`, `typebox`, `undici`, Photon, and the interactive TUI (`npm:@earendil-works/pi-coding-agent@0.80.10/package.json:L35-L51`). The root `dist/index.js` re-exports all of the following families (`npm:@earendil-works/pi-coding-agent@0.80.10/dist/index.js:L1-L46`):

```text
root .
├── cli/args
├── config and auth-storage
├── core/agent-session
├── core/compaction
├── core/extensions (including extension loader)
├── core/model-runtime and model-resolver
├── core/package-manager
├── core/resource-loader / DefaultResourceLoader
├── core/sdk / createAgentSession
├── core/session-manager
├── core/settings-manager
├── core/tools (bash, grep, find, read, write, edit, ls)
├── main
├── modes (interactive, print, RPC)
├── interactive components and themes
├── image/clipboard/shell utilities
└── trust manager
```

The relevant SDK path is:

```text
root index.js
└── core/sdk.js
    ├── node:path
    ├── @earendil-works/pi-agent-core
    ├── @earendil-works/pi-ai/compat
    ├── core/agent-session.js
    │   ├── node:fs
    │   ├── node:path
    │   ├── interactive theme/export modules
    │   ├── core/extensions/index.js
    │   ├── core/tools/bash.js -> child_process
    │   ├── core/tools/index.js -> read/write/edit/find/grep/ls
    │   └── session/compaction helpers
    ├── core/resource-loader.js
    │   ├── node:fs and node:path
    │   ├── package-manager.js -> fs/process/spawn
    │   └── core/extensions/loader.js
    │       ├── node:fs
    │       ├── node:module
    │       ├── node:path
    │       └── jiti/static
    ├── core/session-manager.js
    │   └── file-backed JSONL plus in-memory mode
    ├── core/settings-manager.js
    └── core/tools/*.js
        ├── read/write/edit/ls -> fs
        ├── grep -> readline + spawn(rg)
        ├── find -> readline + spawn(fd)
        └── bash -> fs + child_process.spawn
```

The `createAgentSession()` implementation confirms the key boundary: when no resource loader is passed it constructs and reloads `DefaultResourceLoader`; when a loader is passed it skips that runtime discovery, but all of the imports above remain static (`npm:@earendil-works/pi-coding-agent@0.80.10/dist/core/sdk.js:L1-L17`, `npm:@earendil-works/pi-coding-agent@0.80.10/dist/core/sdk.js:L60-L95`). The official SDK example demonstrates a static loader and in-memory managers (`npm:@earendil-works/pi-coding-agent@0.80.10/examples/sdk/12-full-control.ts:L1-L74`; current global example `/home/ayan/.nvm/versions/node/v24.14.1/lib/node_modules/@earendil-works/pi-coding-agent/examples/sdk/12-full-control.ts:L1-L74`). That is a valid **runtime configuration pattern**, not proof that the root graph is Workers-neutral.

The official SSH example demonstrates that Coding Agent tools can delegate operations to another machine (`npm:@earendil-works/pi-coding-agent@0.80.10/examples/extensions/ssh.ts:L1-L220`). This supports the idea of a remote capability adapter, but the example itself uses Node `spawn` to run SSH and is not a Brain implementation.

### Agent Core 0.80.10: public graph and adapters

The exact root exports `Agent`, `agentLoop`, `AgentHarness`, compaction, `Session`, JSONL and memory storage/repositories, skills, tools, proxy utilities, and types (`npm:@earendil-works/pi-agent-core@0.80.10/dist/index.js:L1-L26`). The root-level runtime imports in the Agent/Harness path are internal Agent Core and `pi-ai` modules; the Node-only implementation is not imported from the root. The package manifest makes this split explicit with `.` and `./node` exports (`npm:@earendil-works/pi-agent-core@0.80.10/package.json:L8-L20`).

```text
@earendil-works/pi-agent-core .
├── Agent
│   ├── Agent state and queueing
│   ├── agent-loop
│   ├── injected streamFn
│   └── injected tools
├── AgentHarness
│   ├── injected Session
│   ├── injected Models
│   ├── injected ExecutionEnv
│   ├── injected resources and tools
│   └── durable-session write barriers
├── Session / SessionStorage
│   ├── InMemorySessionStorage
│   ├── InMemorySessionRepo
│   └── JsonlSessionStorage/Repo through an injected FileSystem
├── compaction and context builders
├── tool and event types
├── proxy utilities
└── pi-ai types

@earendil-works/pi-agent-core ./node
└── NodeExecutionEnv
    ├── node:child_process
    ├── node:fs / node:fs/promises
    ├── node:os / node:path
    └── node:readline
```

`ExecutionEnv` is deliberately a capability interface: file operations and shell execution return typed `Result` values, and the host supplies the implementation (`npm:@earendil-works/pi-agent-core@0.80.10/dist/harness/types.d.ts:L118-L225`). For Ditto, the Brain implementation should expose jailed file operations and no general shell, or expose only a test echo tool initially. `SessionStorage` has async methods such as `appendEntry`, `getEntries`, `getPathToRoot`, and `setLeafId` (`npm:@earendil-works/pi-agent-core@0.80.10/dist/harness/types.d.ts:L378-L436`), which gives Ditto a real adapter seam rather than requiring a temporary JSONL file for every restore.

### Pi AI 0.80.10: model and validation surface

The exact `pi-ai` root exports TypeBox, lazy APIs, credential context/store/types, model APIs, provider fakes, event streams, and validation (`npm:@earendil-works/pi-ai@0.80.10/dist/index.js:L1-L19`). `createModels` and `Models.streamSimple` are public (`npm:@earendil-works/pi-ai@0.80.10/dist/models.d.ts:L1-L166`), and `InMemoryCredentialStore` is public (`npm:@earendil-works/pi-ai@0.80.10/dist/auth/credential-store.d.ts:L1-L20`). Provider implementations may lazy-load and stream through fetch, but each provider must be tested in workerd; “uses fetch somewhere” is not universal provider proof.

The exact validation implementation in 0.80.10 calls TypeBox `Compile` and then uses the compiled validator (`npm:@earendil-works/pi-ai@0.80.10/dist/utils/validation.js:L1-L18`, `L137-L185`). The map’s later shim decision records that TypeBox 1.1.38 can select interpreted validation in the relevant workerd path and that no production TypeBox patch is allowed (`.scratch/brain-architecture/issues/15-decide-pi-workerd-compatibility-shims.md:15-21`). The spike must still test good and bad arguments with the exact unmodified package; it must not copy the prototype postinstall patch.

### Latest observed packages

The latest npm metadata observed locally is **0.84.1** for Coding Agent, Agent Core, and Pi AI (`https://registry.npmjs.org/@earendil-works/pi-coding-agent`, `https://registry.npmjs.org/@earendil-works/pi-agent-core`, `https://registry.npmjs.org/@earendil-works/pi-ai`). Latest Coding Agent still has no `./headless` export, and its root/sdk still statically include `DefaultResourceLoader`/`jiti` (`npm:@earendil-works/pi-coding-agent@0.84.1/package.json:L9-L25`, `npm:@earendil-works/pi-coding-agent@0.84.1/dist/index.js:L1-L46`, `npm:@earendil-works/pi-coding-agent@0.84.1/dist/core/sdk.js:L1-L16`). Latest Agent Core documents an even clearer storage separation: SQLite storage is in a separate `@earendil-works/pi-session-backend-sqlite-node` package so the core package does not pull Node builtins or native SQLite dependencies by default (`npm:@earendil-works/pi-agent-core@0.84.1/README.md:L11-L13`). This supports the direction of Option A, but does not authorize changing Ditto’s exact pin inside the existing Plan 042 scope.

## Options compared

| Option | What it is | Feature parity | Security/runtime fit | Maintenance and migration | Wayfinder effect |
|---|---|---:|---|---|---|
| **A. Existing Agent Core composition** | Use public `Agent`/`AgentHarness` + `pi-ai`, with Brain-owned `ExecutionEnv` and `SessionStorage`. | Medium initially; model loop, events, tools, follow-up, abort, and compaction are available. Coding Agent-specific UI/extension conveniences are intentionally omitted. | **Best candidate.** Root graph is runtime-neutral; no `jiti`, TUI, CLI, local process substrate, or default resource discovery. Credentials and capabilities are injected explicitly. | Smallest graph, but Ditto owns a thin adapter and must track Agent Core API changes. Durable session storage is a real seam. | Retains 00-map’s direct Pi hard gate. Amends Plan 042 to test Core first. No map reopening.
| **B. Proposed upstream `./headless`** | Pi maintainers publish a supported headless Coding Agent entry that depends on Agent Core and accepts static resources, storage, tools, credentials, and streaming. | Potentially highest Coding Agent parity with a supported API. | Can be excellent **if** the export has a separate graph and no forbidden imports. A re-export of today’s `sdk.js` is not enough. | Best long-term ownership if Pi accepts the boundary; depends on upstream timing and release discipline. | Retains map; requires a new upstream/API decision and a new exact pin before implementation.
| **C. Existing Coding Agent root + production bundle** | Keep `createAgentSession`, but test the exact Wrangler dry bundle and workerd artifact instead of relying on Vitest’s module runner. | Highest current parity. Static resources, in-memory managers, custom tools, and no default tools are supported. | **Uncertain.** Production may bundle dormant `jiti` safely, but the root is heavy and imports Node/TUI/extensions/default tools statically. It must not execute them. A successful bundle is not automatically a security approval. | Fastest experiment; carries high bundle/startup and upgrade risk. Every Wrangler/workerd/Pi change needs the artifact matrix. | Retains map if it passes. The Plan 042 Vitest test path must be amended, not treated as production evidence.
| **D. Trusted compute/container** | Brain coordinates a separate full Node Pi host. | Highest. | Runtime-compatible, but adds IPC, lifecycle, credentials, recovery, and another trust boundary. | Large architecture change; invalidates much of the Brain-only design. | **Not an allowed fallback.** Reopen 00-map’s hard rule explicitly before considering it. Never describe it as an automatic contingency.

### Option A versus B

Option B is conceptually attractive, but Option A exists today and already exposes the important boundaries. A new Coding Agent export should be requested upstream because it would preserve useful Coding Agent conveniences without importing CLI machinery. It is not automatically better for the first Ditto spike: if the new export simply re-exports `sdk.js`, it changes the name but not the graph. If it wraps Agent Core and provides explicit adapters, it becomes a supported form of Option A.

### Option A versus C

Option C is worth testing because the historical direct Wrangler probe got far enough to claim a local smoke. But C asks workerd to load a package whose root exports TUI, CLI, file tools, extension loading, package management, and image utilities. Even if those paths are never executed, they increase static compatibility, startup, memory, and security review surface. A production artifact pass would make C viable enough for a measured decision, not make it the default automatically.

### Option D

Option D is only an architecture option after an owner explicitly reopens the map. `.scratch/brain-architecture/issues/00-map.md:16-18` and `00-map.md`’s out-of-scope rule reject a separate Pi runner. This document therefore does not present it as an allowed fallback.

## Recommended compatibility spike before checkpoint/event implementation

This is a **research spike**, not runtime implementation. It must run before any Safe Checkpoint store, event journal, Workflow, or browser integration is built.

### Inputs and prohibitions

- Exact Ditto pins: `@earendil-works/pi-coding-agent@0.80.10`, `@earendil-works/pi-agent-core@0.80.10`, `@earendil-works/pi-ai@0.80.10`, and the lockfile’s TypeBox resolution.
- Record the actual Wrangler/workerd versions used. Current npm metadata observed locally is Wrangler `4.122.0` with workerd `1.20260811.1`; the old probe used workerd `1.20260801.1`.
- Test Option A and Option C separately. If an upstream headless package becomes available, test it as Option B with its exact pin.
- Use a minimal Worker plus one SQLite Brain Durable Object. The production path must use Wrangler’s actual bundle, not only Vite or Node execution.
- Use only synthetic credentials in fixtures. A provider stream may run only when the owner authorizes a real test credential; never write a credential value into a report.
- **Forbidden:** module alias, jiti stub, package patch, postinstall mutation, private/deep import, generated replacement package, altered TypeBox, extra production shim, or a second Pi host.

### Required two paths

**Path P — production-shaped:**

1. Bundle the minimal Worker using the exact production Wrangler/Alchemy-compatible configuration and `nodejs_compat`.
2. Inspect the dry-run artifact with `wrangler deploy --dry-run --outdir` and record compressed size, module metadata, startup metadata, and native/stub module references.
3. Execute that bundle in a real local workerd path, with the Brain Durable Object binding and SQLite storage.
4. If the one approved `import.meta.url` host definition is used, record it. Run a second no-definition probe. Do not add a jiti alias or other workaround.
5. Assert that the browser/client bundle does not contain Pi, provider SDKs, Brain internals, or the synthetic module URL.

**Path T — test-shaped:**

1. Run `@cloudflare/vitest-pool-workers` with the exact `cloudflareTest()` configuration and production compatibility flags.
2. Use the same source entry as Path P where the test integration permits it.
3. Report module-collection failures separately from workerd execution failures.
4. Do not call a Path T failure a production no-go unless Path P fails with the same graph and the failure is reproduced in the deployed artifact or its direct workerd execution.

### Required matrix

| Probe | Pass condition | Fail-closed meaning |
|---|---|---|
| Exact imports | Option A imports the public Agent Core root; Option C imports only the public Coding Agent root. | A private deep import or altered package is not a pass.
| Session construction | One Agent/AgentHarness or Coding Agent AgentSession constructs with no dynamic discovery and no default local tools. | Any required CLI/TUI/extension/package-manager path is a stop.
| TypeBox | Real TypeBox good args pass; missing and wrong required fields fail; package source is unmodified. | A patch, alias, or changed validator is a NO-GO under current rules.
| Code-owned tool | One fixed `brain_probe_echo` or equivalent tool executes with a schema defined in source. | Caller cannot choose arbitrary tool definitions, paths, commands, or Sandbox handles.
| Provider stream | When authorized, a real provider response streams through the Brain and emits ordered text/tool events. | Unauthorized provider testing is `not-run`, not a pass; the spike remains incomplete for production GO.
| Two sessions | Two Workspace Session identities can have independent Agent/Session state and no cross-talk. | Shared mutable transcript, tool registry, or checkpoint pointer is a failure.
| Context restore | Export entries from each session, discard the live object, reconstruct from a new storage object, and prove the next prompt sees a prior marker. | A surviving heap object or `/tmp` file is not durable evidence.
| Forced reset | Test-only reset or equivalent fresh DO instance loses live maps and then restores from the durable test store. | Map clearing without a new instance is not eviction proof.
| No forbidden substrate | No successful `child_process`, `worker_threads`, local default tools, CLI/TUI, dynamic resource loader, Unix socket, or provider auth path is reached. | Any reachable forbidden path requires redesign or a documented stop.
| Gzip/startup | Exact production artifact reports size and startup; missing metadata is a failure, not zero. | An estimate from one JS chunk is not evidence.
| Memory | A deterministic two-session probe measures the actual Pi state/cache peak, not the test runner process heap. | Missing or unrelated heap data is a failure.
| CPU/lifetime | One short turn fits configured CPU; long waiting is owned by a non-browser caller. | Browser/request ownership or alarm-only assumptions are not a pass.

### Decision output

The spike emits one redacted JSON report with:

```text
candidate: agent-core | coding-agent-root | upstream-headless
production_bundle: pass | fail | not-run
production_workerd: pass | fail | not-run
test_workerd: pass | fail | not-run
provider_stream: pass | fail | not-authorized
restore: pass | fail
forbidden_graph: absent | reached | unknown
startup: measured milliseconds or missing
compressed_bundle: measured bytes or missing
two_session_peak: measured bytes or missing
verdict: GO-candidate | NO-GO
```

`GO-candidate` means all required local probes passed and the next plan may specify checkpoints. It is not deployed production admission. `NO-GO` means the current direct Brain route fails a mandatory requirement without relaxing the map; no container fallback is substituted. Any missing required measurement is `NO-GO`/incomplete, never an optimistic pass.

## Existing API example: Agent Core composition

The following is illustrative TypeScript using existing public APIs. It is deliberately not production code: model selection, durable storage, jail policy, and provider credentials are left to Ditto’s later plan.

```ts
import {
  AgentHarness,
  InMemorySessionStorage,
  Session,
  type ExecutionEnv,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  InMemoryCredentialStore,
  type Model,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";

const credentials = new InMemoryCredentialStore();
// Brain inserts only an authorized in-memory credential here.
const models = createModels({ credentials });
const model = chooseAnAuthorizedModel(models) as Model<any>;

const env: ExecutionEnv = createBrainExecutionEnv({
  cwd: "/brain/session/s-1",
  // list/read/write/edit are Brain-jailed capabilities;
  // exec returns a typed not_supported result in the first cut.
});

const storage = new InMemorySessionStorage({
  metadata: { id: "pi-session-s-1", createdAt: new Date().toISOString() },
});
const session = new Session(storage);

const probeEcho: AgentTool = {
  name: "brain_probe_echo",
  label: "Brain probe echo",
  description: "Return a bounded marker supplied by the model.",
  parameters: Type.Object({ marker: Type.String({ maxLength: 128 }) }),
  execute: async (_id, params) => ({
    content: [{ type: "text", text: params.marker }],
    details: { codeOwned: true },
  }),
};

const harness = new AgentHarness({
  env,
  session,
  models,
  model,
  systemPrompt: "You are the Pi Runtime for one Ditto Workspace Session.",
  tools: [probeEcho],
  activeToolNames: ["brain_probe_echo"],
  resources: { skills: [], promptTemplates: [] },
  followUpMode: "one-at-a-time",
});

await harness.prompt("Remember MARKER-123 and call brain_probe_echo.");
const entries = await session.getEntries(); // checkpoint candidate; not authority yet
```

The exact 0.80.10 declaration names `AgentHarness` options as `env`, `session`, `models`, `model`, optional tools/resources/system prompt, and exposes `prompt`, `abort`, `waitForIdle`, subscription, and session controls (`npm:@earendil-works/pi-agent-core@0.80.10/dist/harness/agent-harness.d.ts:L1-L94`, `npm:@earendil-works/pi-agent-core@0.80.10/dist/harness/types.d.ts:L428-L474`). Its constructor is public in that version. Depending on the selected abstraction, Ditto may compose `new Agent(...)` directly instead; that is why the spike must compile and execute the installed artifact rather than relying on this illustrative snippet.

The important property is the boundary: the Brain supplies capabilities and storage. The model cannot supply an `ExecutionEnv`, a tool implementation, a path root, a command, a credential, or a remote destination.

## Proposed, currently nonexistent Coding Agent API

This is intentionally marked **proposed/nonexistent**. No current package export supports this import:

```ts
// DOES NOT EXIST in Coding Agent 0.80.10 or 0.84.1.
import {
  createHeadlessAgentSession,
  type HeadlessResourceSet,
  type SessionStore,
} from "@earendil-works/pi-coding-agent/headless";

const runtime = await createHeadlessAgentSession({
  model,
  stream: providerStream,
  credentials: brainCredentialStore,
  resources: {
    systemPrompt: DITTO_SYSTEM_PROMPT,
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
    agentsFiles: [],
  } satisfies HeadlessResourceSet,
  sessionStore: brainSessionStore satisfies SessionStore,
  tools: codeOwnedTools,
  settings: {
    compaction: { enabled: true },
    followUpMode: "one-at-a-time",
    blockImages: true,
  },
});
```

A real API should be narrower than `createAgentSession()` and make unsafe defaults impossible. It should require the caller to provide:

- a model/stream function or a provider collection;
- a static resource value, not a discovery object;
- a session storage adapter or explicit in-memory session;
- a code-owned tool registry or a capability factory;
- an in-memory credential store; and
- explicit limits and abort policy.

It should not expose or statically import CLI, TUI, `DefaultResourceLoader`, `jiti`, local process tools, package manager, or file-auth/settings machinery. It should not be implemented by re-exporting `sdk.js` under another name.

## Upstream refactor boundaries for a real Coding Agent headless export

If Pi maintainers choose Option B, the work should be split into boundaries that can be audited:

1. **Core loop boundary:** keep Agent Core and Pi AI as the model/tool/event engine. Do not make Brain depend on CLI modules.
2. **Session boundary:** move Coding Agent’s session-facing behavior behind an injected session repository/storage interface. Preserve tree entries, context rebuilding, compaction, and Safe Checkpoint-compatible entry export.
3. **Resource boundary:** define static `ResourceSet` values. Keep disk discovery, package installation, extensions, skills, prompts, themes, and `jiti` in a Node-only resource loader.
4. **Tool boundary:** define tool factories against an injected capability environment. Keep local filesystem/process implementations in a Node-only adapter. Make `grep`/`find` absence explicit rather than importing spawn-backed defaults.
5. **Model/auth boundary:** accept `pi-ai` `Models` or an injected stream function and in-memory credentials. Do not read `auth.json`, environment files, or proxy globals during module initialization.
6. **Settings boundary:** accept a serializable settings object or an in-memory settings interface. Do not import file locks or editor/terminal settings for headless mode.
7. **Control boundary:** expose async `prompt`, `followUp`, `abort`, `waitForIdle`, and event subscription. Do not expose Unix sockets or RPC subprocess mode.
8. **Bundling boundary:** keep the new export’s static graph free of `jiti/static`, TUI, `node:child_process`, `worker_threads`, and native image modules. Verify with a graph scan and a Wrangler artifact.
9. **Compatibility boundary:** either remove the `import.meta.url` initialization dependency or document one host-scoped definition. Delete the definition when the unmodified artifact passes.
10. **Test boundary:** add an upstream workerd smoke that covers boot, real TypeBox good/bad arguments, one code-owned tool, two sessions, context restore, and provider streaming where authorized.

## User stories and acceptance criteria

### End user

**Story:** As a Ditto user, I can open two Workspace Sessions in one Project, send work to either one, disconnect my browser, reconnect, and continue after Brain eviction without losing the conversation.

Acceptance criteria:

- Each request is accepted into the correct D1 Workspace Session and Agent Run.
- Events identify the correct `projectId`, Workspace Session, Pi Agent Session, Agent Run, epoch, and turn sequence.
- Browser disconnect changes only Delivery State; it does not stop execution.
- A restored follow-up sees the prior Safe Checkpoint context and does not replay an uncertain model/tool action.
- A tool can change/read only the authorized session jail and cannot expose credentials or a peer session.

### Ditto maintainer

**Story:** As a maintainer, I can upgrade Pi, Wrangler, workerd, or the test harness and know whether the Brain graph still works.

Acceptance criteria:

- Exact package versions and lockfile changes are visible.
- The production Wrangler bundle and the test workerd path are tested separately.
- A no-definition probe runs on every intentional runtime/package upgrade.
- The report contains real compressed size, startup time, and two-session peak memory; missing values fail.
- The Brain module has no imports from the legacy Sandbox runner, CLI/TUI, dynamic resource loader, local process substrate, or private Pi paths.
- Storage and event code can be developed after the compatibility spike, not used to hide a failed boot.

### Security reviewer

**Story:** As a security reviewer, I can inspect the Brain boundary and prove that prompts cannot smuggle a process, credential, raw Sandbox handle, or cross-session path into Pi.

Acceptance criteria:

- Tools are registered by trusted code, not by request data.
- Credentials enter only an in-memory Brain credential store and provider request path; they never enter Pi entries, D1, Brain SQLite, R2, Sandbox env/argv/files, logs, or browser events.
- `ExecutionEnv` path operations enforce canonical Workspace Session jail rules.
- There is no general shell, terminal, Unix socket, package installation, extension loading, or arbitrary network destination.
- Synthetic canaries are absent from all durable and untrusted boundaries.
- Forced eviction proves storage, not memory, is the recovery source.

### Pi maintainer

**Story:** As a Pi maintainer, I can support a Workers/headless host without requiring Ditto to import private files or carry the entire CLI graph.

Acceptance criteria:

- The supported headless API has an explicit runtime-neutral entrypoint.
- Node-specific implementations are separated behind `./node` or another clearly documented adapter boundary.
- Session storage, tool capability, resources, credentials, and provider stream are injected.
- The API has an upstream workerd compatibility test and a documented support policy.
- A caller can use the same Agent Core semantics for events, tool validation, abort, and context restoration without importing TUI/CLI modules.

## Worked end-to-end example

This example shows what the proposed architecture means, not a claim that it has been implemented.

### Starting state

Project `P` has one Brain and one Project Sandbox. It has two Workspace Sessions:

- **Workspace Session A / Pi Agent Session A:** branch `ditto/session-a`, D1 conversation `C-A`.
- **Workspace Session B / Pi Agent Session B:** branch `ditto/session-b`, D1 conversation `C-B`.

The Browser Gateway accepts two user requests with idempotency keys. D1 atomically creates or joins Agent Runs `R-A` and `R-B`, their ordered Turns, complete user messages, and pending assistant messages. The Browser Gateway returns `202`; it does not own completion. One Workflow owns each Agent Run.

The Brain starts two cached Agent Core sessions in a bounded map:

```text
Brain live cache
├── session-a -> AgentHarness A -> in-memory SessionStorage A
└── session-b -> AgentHarness B -> in-memory SessionStorage B
```

This map is a cache. It is not the conversation authority, completion authority, or checkpoint authority.

### One code-owned tool

Ditto registers `brain_read_workspace_file` in source code. The request can ask to read `src/app.ts`, but it cannot define the tool, replace its schema, choose another root, or pass a Sandbox handle.

The schema is conceptually:

```ts
Type.Object({
  relativePath: Type.String({ maxLength: 512 }),
  offset: Type.Integer({ minimum: 0, maximum: 1_048_576 }),
  length: Type.Integer({ minimum: 0, maximum: 65_536 }),
});
```

The tool implementation calls a Brain-owned jail capability. Brain derives Session A’s canonical root from the trusted Workspace Session identity, rejects `.git`, `.ditto`, `.env*`, absolute paths, NULs, dot segments, symlink escapes, and cross-session roots, then asks the Project Sandbox for bounded bytes. The tool returns a bounded result and a safe structured detail. It does not return a process, socket, container, credential, or raw path outside the jail.

### First run in Session A

1. Workflow asks Brain to run Turn 1 for `R-A` and epoch `E-A-1`.
2. Brain confirms D1 says `R-A` is accepted/running and creates an Operation Fence before dispatching the provider request.
3. The provider stream returns text followed by a tool call to `brain_read_workspace_file`.
4. Unmodified TypeBox validation accepts the good arguments. Missing or wrong `relativePath`/bounds would become a tool error and never reach the jail.
5. Brain emits bounded, redacted text and tool lifecycle events into Brain SQLite. D1 remains authoritative for the user message and pending assistant message.
6. The tool reads Session A’s file. Session B’s root is not available to the tool.
7. The tool result and final assistant response complete. The fence closes with a durable result.
8. Only after no model or tool action is unresolved does Brain create a **Safe Checkpoint** for Pi Agent Session A.

Suppose A’s compressed checkpoint is 300 KiB. Brain stores it as bounded SQLite chunks, then writes the immutable manifest and current pointer. If A’s checkpoint were larger than the threshold, Brain would write an immutable compressed payload to R2 first, then publish the SQLite manifest/pointer. Payload-before-pointer means a failed write cannot make a partial snapshot current.

### Concurrent run in Session B

Session B may stream at the same time because its Workspace Session state is distinct. It has its own D1 Turn, Operation Fence, event cursor, checkpoint generation, model context, and jail root. The Brain is single-threaded and may interleave asynchronous I/O, but it must not share transcript arrays or mutable tool context between A and B.

If B’s checkpoint is 900 KiB compressed, it goes to immutable R2. Brain SQLite stores only the manifest, pointer, generation, hash, and safe metadata. R2 is a large-payload store, not the authority for D1 conversations or Agent Run outcomes.

### Forced eviction

A test-only control forces the Brain instance to reset. The reset disposes both live AgentHarness objects, removes tracked temporary files, and causes a fresh Durable Object instance. The following are lost:

```text
lost: AgentHarness A/B object identity, in-memory maps, transient provider/tool state
retained: D1 conversation/run rows, Brain SQLite manifests/events, R2 payload B
```

A map clear alone is not enough: the spike must prove a fresh instance or equivalent workerd lifecycle. Cloudflare documents that hibernation removes the object from memory and reruns the constructor on the next request, and that Durable Objects may shut down for deployments or runtime decisions; applications should write progress incrementally (`https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/`).

### Restore and follow-up

A later request targets Session A. Brain:

1. reads A’s current manifest from Brain SQLite;
2. assembles SQLite chunks or reads the immutable R2 object;
3. verifies compressed length and SHA-256;
4. decompresses and validates the session entries and identity;
5. creates a new Agent Core `Session`/`SessionStorage` from those entries;
6. creates a new Agent/AgentHarness with the same static resources, model policy, code-owned tools, and Brain capabilities; and
7. appends the follow-up as a new ordered D1 Turn before Workflow delivery.

The follow-up asks, “What did the file say?” The restored context contains A’s prior user message, the completed tool call/result, and the prior assistant answer. It can answer using that history. It does not replay the prior read tool or provider request because the prior Safe Checkpoint already contains the completed result. If eviction happened while an Operation Fence was open, that action is uncertain: the current Agent Run becomes `interrupted`, and a successor restores the last Safe Checkpoint without incomplete tool protocol.

### Authority versus cache summary

| Data | Authority | Cache/transport role |
|---|---|---|
| conversation, Turns, messages, Agent Run lifecycle | D1 | none; UI and Brain read it
| execution fences, event cursors, checkpoint manifests/pointers | Brain SQLite | recoverable coordination state
| large immutable checkpoint bytes | R2 | payload store referenced by Brain SQLite
| live Agent/AgentHarness objects | none | disposable in-memory cache
| Project Sandbox files | versioned workspace backup plus current Sandbox state under Brain policy | execution substrate, never Pi-session authority
| browser SSE attachment | none | delivery connection only

This is the domain decision in `.scratch/brain-architecture/issues/07-decide-run-state-and-recovery.md`, not an implementation shortcut.

## Wayfinder change matrix (do not edit these files yet)

The statuses below are recommendations for the owner’s input. They distinguish historical decisions from evidence that needs correction.

| File/plan | Action | Proposed change |
|---|---|---|
| **00-map.md** | **retain + amend** | Retain one Brain per Project, direct Pi as a hard gate, D1/Brain SQLite/R2 authority split, no separate Pi fallback. Amend the map’s research conclusion to say “direct workerd compatibility is unresolved until the production-artifact/Core spike,” and add a sequencing rule: prove imports before storage architecture.
| **01-research-pi-in-brain-compatibility.md** | **supersede conclusion, retain evidence** | Keep its adapter inventory and Cloudflare constraints. Supersede the sentence that treats the Coding Agent SDK as the only realistic Brain path. Add Agent Core composition as an existing public option and distinguish static imports from runtime execution.
| **02-prototype-deployed-pi-brain.md** | **retain + amend; invalidate deployed-pass reading** | Retain the local prototype as historical evidence. Amend “passed its complete smoke” to “repository history claims a local smoke passed; no machine-readable report was retained; no deployment occurred; TypeBox was patched in the prototype.” Invalidate any reading of it as deployed acceptance.
| **06-decide-brain-go-no-go.md** | **amend / reopen decision gate** | Retain “GO for planning, not production acceptance” only as a provisional planning posture. Reopen the direct-Pi API choice: Option A is now the preferred spike, Option B is an upstream request, and Option C needs a production-bundle proof. A mandatory direct-Pi failure still ends the Brain route with no separate runner.
| **13-decide-security-and-failure-gates.md** | **retain + amend** | Retain non-waivable direct-Pi, eviction, secret, egress, memory, CPU, Workflow, and isolation gates. Amend the Pi gate to require both a Wrangler production-artifact/workerd path and a separately labeled Vitest path; a Vitest module-runner failure is not a production verdict by itself.
| **14-define-improve-handoff.md** | **amend / supersede Plan 042 node** | Retain Alchemy and Sandbox route independence and the dependency graph. Replace “Host the project Pi Runtime in Brain” as the immediate implementation node with “Run Pi-in-Brain compatibility spike and choose Agent Core/Coding Agent/upstream headless.” Plan 043 must remain blocked until that choice has a GO-candidate report.
| **15-decide-pi-workerd-compatibility-shims.md** | **amend** | Retain exact pins, no TypeBox patch, one scoped URL definition only if proven necessary, and delete-on-upgrade rules. Amend the conclusion: the URL definition cannot make the Coding Agent root headless; Option A may not need it, and an upstream headless export must have its own graph test.
| **Plan 042: host-project-pi-runtime-in-brain** | **supersede; invalidate implementation-complete/production-NO-GO readings** | Supersede the current implementation premise and both executor attempts. Keep their evidence as an appendix to the new spike: attempt 1’s alias/scope/type failures and revision 1’s `jiti/static` Vitest collection failure. Invalidate any implementation-complete or production-NO-GO reading; the revision is a test-harness STOP, not a production verdict. A new plan should be a small throwaway compatibility prototype, with no checkpoint/event production implementation, and run before that code.

**What is not being recommended:** Do not invalidate the Wayfinder map, do not silently add a container fallback, do not keep both Brain and Sandbox Pi routes behind a feature flag, and do not edit the issues until the owner answers the questions below.

## Owner decision questions

Please answer with the simple syntax `Q1 A`, `Q2 B`, etc. Add a short note after any answer.

1. **First spike target:**
   - **A (recommended):** Agent Core composition first, then production-bundled Coding Agent.
   - B: Coding Agent production bundle first.
   - C: Require an upstream headless export before any Ditto spike.
2. **Headless feature scope:**
   - **A (recommended):** model loop, text/tool events, code-owned tools, follow-up/abort, compaction only when proven.
   - B: require full Coding Agent feature parity before Brain work.
3. **Resource policy:**
   - **A (recommended):** static system prompt/resources only; no project extensions, skills, prompts, themes, or `AGENTS.md` discovery in the first migration.
   - B: allow a separately designed signed/typed resource registry later.
4. **Tool policy:**
   - **A (recommended):** Brain-jailed file capabilities and narrow code-owned tools; no terminal or general shell.
   - B: require a proven stronger execution boundary before adding any process tool.
5. **Provider test authorization:**
   - **A:** no real provider credential during the local spike; mark provider stream not-authorized and defer provider GO.
   - **B (recommended for eventual GO):** authorize one synthetic/disposable provider credential in Brain-only memory for the deployed admission test.
6. **Upstream engagement:**
   - **A (recommended):** request a public `./headless` export, but do not block Option A on upstream timing.
   - B: wait for upstream before choosing a production path.
7. **Shim policy:**
   - **A (recommended):** permit only the already decided scoped `import.meta.url` definition, never a jiti alias/stub or TypeBox patch.
   - B: require zero production definitions, even if that delays the spike.
8. **Plan 042 disposition:**
   - **A (recommended):** mark superseded/no-merge and create a new compatibility-spike plan.
   - B: amend Plan 042 in place before continuing.
9. **Brain route gate:**
   - **A (recommended):** a missing required production-artifact, provider, eviction, two-session memory, or security result is NO-GO/incomplete; no separate runner fallback.
   - B: allow an owner-approved waiver for one non-security measurement.
10. **Wayfinder update timing:**
    - **A (recommended):** update issues 00, 01, 02, 06, 13, 14, 15 only after the owner selects the candidate and the spike reports.
    - B: update them now as provisional amendments.

Example response:

```text
Q1 A
Q2 A
Q3 A
Q4 A
Q5 B for deployed admission, A locally
Q6 A
Q7 A
Q8 A
Q9 A
Q10 A
```

## Confidence and unknowns

### High confidence

- Brain is a Cloudflare Durable Object and therefore must satisfy workerd runtime constraints. Cloudflare documents that Workers exposes supported APIs plus importable but non-functional Node stubs; `node:child_process`, `node:readline`, and `node:worker_threads` are in the stub table for the relevant compatibility date (`https://developers.cloudflare.com/workers/runtime-apis/nodejs/`).
- `/tmp` is a writable in-memory VFS that is not persistent or shared between concurrent/subsequent requests; its contents count toward memory (`https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/`).
- Durable Object memory is ephemeral across hibernation/eviction/restart; storage must be written incrementally (`https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/`).
- Cloudflare limits include 128 MB per isolate, 1 second startup, 10 MB compressed Worker size on Paid, six simultaneous outgoing connections waiting for headers, and a default 30-second CPU limit configurable to five minutes on the applicable plan (`https://developers.cloudflare.com/workers/platform/limits/`, `https://developers.cloudflare.com/durable-objects/platform/limits/`).
- Coding Agent 0.80.10’s public root eagerly exposes a broad Node-oriented graph, while Agent Core 0.80.10 has an explicit environment/session abstraction and a separate Node export.
- Latest observed Coding Agent 0.84.1 still has no `./headless` export.
- Plan 042’s revision failed in the selected Vitest module path before Pi tests collected.

### Medium confidence

- Agent Core 0.80.10 can provide enough feature parity for Ditto’s first Brain Runtime. The declarations make the seams real, but the exact provider/model setup and event/checkpoint behavior must be executed in workerd.
- A real Wrangler production bundle may load the dormant Coding Agent root successfully when the allowed URL definition is present and no forbidden runtime path executes. The old probe suggests this, but its evidence is incomplete.
- `pi-ai` provider streams will work from Brain for Ditto’s selected provider/model combinations. Provider implementations and transports differ, so this needs a real authorized stream test.

### Unknown until the spike

- Whether the current Alchemy/Vite Website build can produce the same Pi artifact as direct Wrangler without client leakage.
- Whether the selected production artifact can load `jiti/static` without a test-only or production compatibility treatment.
- Whether TypeBox 1.1.38’s interpreted fallback is selected in every exact production and test path.
- Two-session peak memory after provider/model modules, transcript entries, tool results, and checkpoint serialization are included.
- Cold-start p95, startup CPU, and CPU per turn in the actual Website Worker graph.
- Whether all desired model providers avoid Node-only transports in workerd.
- How much Coding Agent-specific compaction/session behavior Ditto would need to reimplement if it chooses Agent Core.
- Whether an upstream headless Coding Agent export will be accepted, what its API will be, and when it will release.

## Complete primary source list

### Ditto domain, architecture, and Wayfinder records

- `CONTEXT.md:7-16`, `CONTEXT.md:47-49`, `CONTEXT.md:71-84`, `CONTEXT.md:115-116` — domain vocabulary and authority boundaries.
- `.scratch/brain-architecture/issues/00-map.md:16-21`, `00-map.md:39-41` — direct Pi hard gate, no separate runner fallback, D1/Brain SQLite/R2 split, Workflow ownership.
- `.scratch/brain-architecture/issues/01-research-pi-in-brain-compatibility.md:10-21` — prior feasibility question and conditional conclusion.
- `.scratch/brain-architecture/issues/02-prototype-deployed-pi-brain.md:11-23` — prototype scope, local evidence, waiver, and non-deployment.
- `.scratch/brain-architecture/issues/06-decide-brain-go-no-go.md:11-21` — provisional GO for planning and production gates.
- `.scratch/brain-architecture/issues/07-decide-run-state-and-recovery.md` — D1 authority, Agent Run/Turn model, Safe Checkpoints, fences, interruption, recovery.
- `.scratch/brain-architecture/issues/08-decide-tool-lanes-and-scheduling.md` — Brain-jailed tools, no terminal, execution lanes, leases, and durability ordering.
- `.scratch/brain-architecture/issues/09-decide-git-and-pr-protocol.md` — semantic Git capabilities, credential-free publication, no raw Git/process access.
- `.scratch/brain-architecture/issues/10-decide-browser-and-preview-protocol.md` — Browser Gateway, SSE attachments, follow-up/Stop, Preview boundary.
- `.scratch/brain-architecture/issues/11-decide-alchemy-v2-graph.md` — Website Worker, Alchemy resource ownership, future Brain binding boundary.
- `.scratch/brain-architecture/issues/12-decide-sandbox-next-cutover.md` — mutually exclusive Brain GO/no-GO Sandbox routes and no dual protocol.
- `.scratch/brain-architecture/issues/13-decide-security-and-failure-gates.md` — local/deployed/soak gates and direct-Pi acceptance.
- `.scratch/brain-architecture/issues/14-define-improve-handoff.md` — dependency graph and Plan 042 position.
- `.scratch/brain-architecture/issues/15-decide-pi-workerd-compatibility-shims.md:11-21` — one URL definition, no TypeBox patch, exact pins, deletion gate.
- `.scratch/brain-architecture/issues/16-decide-trusted-git-executor-resource.md` and `17-decide-git-provision-and-sync-protocol.md` — trusted Git and import boundaries used by the worked example’s security assumptions.
- `docs/architecture/agent-harness.md:44-49`, `docs/architecture/agent-harness.md:77-107`, `docs/architecture/agent-harness.md:149-158` — current Sandbox runner, file-backed Pi state, and Unix control path.
- `docs/research/pi-in-brain-feasibility.md:14-20`, `:77-148`, `:159-244`, `:252-279`, `:295-343`, `:367-380` — prior package/runtime/adaptor research.
- `plans/042-host-project-pi-runtime-in-brain.md:59-109`, `:322-341`, `:836-886`, `:1138-1177`, `:1197-1231` — Plan 042 scope, rules, test path, attempt 1 evidence, and revision evidence.

### Ditto repository commits

- `7cbee00:prototypes/pi-brain-probe/README.md:1-23` — prototype claims and required prototype shims.
- `7cbee00:prototypes/pi-brain-probe/package.json:1-20` — exact prototype dependencies/scripts.
- `7cbee00:prototypes/pi-brain-probe/wrangler.jsonc:1-22` — direct Wrangler/workerd configuration and URL definition.
- `7cbee00:prototypes/pi-brain-probe/src/index.ts:188-228`, `:350-365`, `:405-430` — session/tool/eviction/Workflow shape.
- `7cbee00:prototypes/pi-brain-probe/scripts/smoke.mjs:49-149` — historical local smoke sequence.
- `19f0bc7:prototypes/pi-brain-probe/README.md:1-23` — recorded waiver and non-deployment.
- `76aa578:apps/web/vitest.brain.config.ts:1-43`, `:apps/web/test/brain/pi-boot.workerd.ts:1-47`, `:apps/web/test/brain/jiti-stub.ts:1-4` — first Plan 042 test graph and forbidden stub.
- `5e09159:apps/web/vitest.brain.config.ts:1-43`, `:apps/web/package.json:75-95` — revision with alias removed and `jiti` inlining.

### Exact installed/npm package artifacts

These are primary package manifests, declarations, examples, and built source inspected from exact npm tarballs; line references use the extracted package files.

- `https://www.npmjs.com/package/@earendil-works/pi-coding-agent/v/0.80.10`
- `https://unpkg.com/@earendil-works/pi-coding-agent@0.80.10/package.json`
- `https://unpkg.com/@earendil-works/pi-coding-agent@0.80.10/dist/index.js`
- `https://unpkg.com/@earendil-works/pi-coding-agent@0.80.10/dist/core/sdk.js`
- `https://unpkg.com/@earendil-works/pi-coding-agent@0.80.10/dist/core/agent-session.js`
- `https://unpkg.com/@earendil-works/pi-coding-agent@0.80.10/dist/core/resource-loader.js`
- `https://unpkg.com/@earendil-works/pi-coding-agent@0.80.10/dist/utils/validation.js`
- `https://unpkg.com/@earendil-works/pi-coding-agent@0.80.10/docs/sdk.md`
- `https://unpkg.com/@earendil-works/pi-coding-agent@0.80.10/docs/session-format.md`
- `https://unpkg.com/@earendil-works/pi-coding-agent@0.80.10/examples/sdk/12-full-control.ts`
- `https://unpkg.com/@earendil-works/pi-coding-agent@0.80.10/examples/extensions/ssh.ts`
- `https://www.npmjs.com/package/@earendil-works/pi-agent-core/v/0.80.10`
- `https://unpkg.com/@earendil-works/pi-agent-core@0.80.10/package.json`
- `https://unpkg.com/@earendil-works/pi-agent-core@0.80.10/dist/index.js`
- `https://unpkg.com/@earendil-works/pi-agent-core@0.80.10/dist/agent.d.ts`
- `https://unpkg.com/@earendil-works/pi-agent-core@0.80.10/dist/harness/agent-harness.d.ts`
- `https://unpkg.com/@earendil-works/pi-agent-core@0.80.10/dist/harness/types.d.ts`
- `https://unpkg.com/@earendil-works/pi-agent-core@0.80.10/dist/harness/session/session.d.ts`
- `https://unpkg.com/@earendil-works/pi-agent-core@0.80.10/dist/harness/env/nodejs.js`
- `https://unpkg.com/@earendil-works/pi-agent-core@0.80.10/README.md`
- `https://www.npmjs.com/package/@earendil-works/pi-ai/v/0.80.10`
- `https://unpkg.com/@earendil-works/pi-ai@0.80.10/package.json`
- `https://unpkg.com/@earendil-works/pi-ai@0.80.10/dist/index.js`
- `https://unpkg.com/@earendil-works/pi-ai@0.80.10/dist/models.d.ts`
- `https://unpkg.com/@earendil-works/pi-ai@0.80.10/dist/auth/credential-store.d.ts`
- `https://unpkg.com/@earendil-works/pi-ai@0.80.10/dist/utils/validation.js`
- Latest observed manifests and exports: `https://registry.npmjs.org/@earendil-works/pi-coding-agent`, `https://registry.npmjs.org/@earendil-works/pi-agent-core`, `https://registry.npmjs.org/@earendil-works/pi-ai`; latest local package source `@earendil-works/pi-coding-agent@0.84.1`, `@earendil-works/pi-agent-core@0.84.1`, and `@earendil-works/pi-ai@0.84.1`.
- Current globally installed Pi docs/examples: `/home/ayan/.nvm/versions/node/v24.14.1/lib/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`, `docs/session-format.md`, `docs/sessions.md`, `examples/sdk/README.md`, `examples/sdk/12-full-control.ts`, and `examples/extensions/ssh.ts`.

### Official Cloudflare sources

- Node compatibility and non-functional stubs: `https://developers.cloudflare.com/workers/runtime-apis/nodejs/`
- Workers virtual filesystem and ephemeral `/tmp`: `https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/`
- Wrangler production bundling and dry-run artifact inspection: `https://developers.cloudflare.com/workers/wrangler/bundling/`
- Wrangler commands, `--dry-run`, `--outdir`, `--define`, and startup reporting: `https://developers.cloudflare.com/workers/wrangler/commands/workers/`
- Wrangler configuration, `define`, limits, Worker/DO bindings, and SQLite class declarations: `https://developers.cloudflare.com/workers/wrangler/configuration/`
- Vitest integration: `https://developers.cloudflare.com/workers/testing/vitest-integration/`
- Vitest configuration and `cloudflareTest()` module resolution: `https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/`
- Vitest isolation/concurrency warning about test versus production runtime: `https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/`
- Workers limits: `https://developers.cloudflare.com/workers/platform/limits/`
- Durable Object lifecycle/hibernation/eviction/restart: `https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/`
- Durable Object limits, SQLite row/BLOB size, CPU, memory, outgoing connections, and wall time: `https://developers.cloudflare.com/durable-objects/platform/limits/`
- Durable Object SQLite storage and `transactionSync`: `https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/`

---

**Owner input requested:** answer the numbered questions in the response syntax above. No Wayfinder issue, plan, runtime code, or Cloudflare resource was changed by this research document.
