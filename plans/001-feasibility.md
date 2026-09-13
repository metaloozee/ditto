# 001: Prove Pi 0.85.1 recovery and the two-container topology

Status: BLOCKED for handoff to 002. The next local subphase is the recovery-adapter experiment below, not another attempt at bare `continue()`. Revised against HEAD `20d3160`, branch `brain`; original plan base `c963890`. Effort: L. Risk: high.

This refinement selects Pi `0.85.1` for the next authorized executor checkout. It does not upgrade the current runner, apply the experimental code, authorize deployment, or declare feasibility passed. Only plan files change during this refinement.

## Problem and scope

The accepted target requires full Pi in a trusted Node container, a workerd coordinator extending Container, and a separate Sandbox executor. A restarted brain must preserve completed work, finish only definitely undispatched tools, and block on uncertain effects. Pi's direct continuation API does not provide that recovery by itself, including at `0.85.1`.

Read all of `docs/specs/trusted-session-runtime.md` before execution. Keep Sandbox at `0.12.3`, the fixed product model and thinking levels unchanged. The only dependency upgrade in scope is both Pi packages to exact `0.85.1`, with their required transitive changes. Preserve unrelated dependency resolutions where possible and report additional lock churn.

Full coding-agent remains responsible for inference, normal turns, compaction and tool selection. No alternate agent-core loop, private-field patching, pooled brain, third application DO, SDK fork, source reset, Sandbox protocol migration or further SDK upgrade is authorized. A recovery adapter may reconcile one already committed tool batch under the journal rules below; it may not invent a new agent loop or repeat a model request to reconstruct the old answer.

No production inspection, live model calls, deployment, shared database mutation, cloud identity retirement, archive deletion, staging or commits. Paid integration needs separate environment and budget authorization. Preserve existing work, including uncommitted experiment files. Do not copy credentials, `.env.local`, `.alchemy` or `.wrangler` state into an executor checkout.

## Reviewed evidence, not completion

Experiments used Node `v24.21.0`, npm `11.19.0`, real pinned coding-agent packages, synthetic state and offline providers. The advisor read their code and independently reran the reported tests and compile gates. Pi AI, coding-agent and transitive agent-core resolved to the stated version.

| Observation | 0.80.10 | 0.85.1 | Meaning |
|---|---|---|---|
| Assistant requested A and B; no result saved; call `session.agent.continue()` | FAIL | FAIL | Throws `Cannot continue from message role: assistant` before provider or tools. |
| A's result saved; B never dispatched; call `continue()` | FAIL | FAIL | Calls provider without executing B. No B result is produced. |
| Normal turn using the same offline provider and fake tools | Not part of the original control | PASS | A then B execute with matching call/result IDs. The negative recovery cases are not caused by an unregistered tool. |
| External entries imported with `SessionManager.inMemory`, followed by explicit non-last leaf selection | No entries parameter | PASS | Synthetic IDs, metadata, compaction, settings and custom state survive import and append. Not a persistence barrier or live provider replay test. |
| Existing runner tests | 79 PASS | 79 PASS | Existing Vitest seams pass, including mocked SDK seams. |
| Existing runner typecheck and build | PASS | FAIL | `ResourceLoader` requires two additional methods in the metadata loader. |
| Complete recovery adapter, persistence-failure latch, follow-up consumption and remaining barriers | NOT RUN | NOT RUN | Required before F-Pi can pass. |
| Two-service topology, bridge/restart and paid gates | NOT RUN | NOT RUN | No platform readiness claim. |

The candidate continuation suite has three tests: two passing negative characterizations and one positive control. The restoration suite has three tests. Its full package run also includes the two copied negative characterizations, five tests total, not five independent restoration proofs. Passing a test named `F-Pi BLOCKED` confirms a gap; it does not pass the feasibility gate.

Optional source artifacts, all uncommitted and outside the main checkout:

- `/tmp/ditto-plan-001.OTepcd/worktree`: original `0.80.10` experiment.
- `/tmp/ditto-pi-0851.TQcwtT/continuation`: `0.85.1` continuation cases and normal-turn control.
- `/tmp/ditto-pi-0851.TQcwtT/restoration`: `0.85.1` import tests and `restoration-child.ts`.
- `/tmp/ditto-pi-0851.TQcwtT/runner`: candidate runner manifests, failing compile evidence, unchanged runner source.

Inspect artifacts before selectively reusing source. Do not copy whole worktrees, dependency directories, generated output or their plan files. Candidate brain installs refreshed unrelated semver-resolved dependencies, including Node types and build tooling; their lockfiles are not an approved minimal migration. If these temporary artifacts have disappeared, reconstruct the cases specified here and rerun them. The plan does not depend on their continued existence.

## Current code and exact SDK seams

Current main-checkout manifests still pin runner Pi AI and coding-agent to `0.80.10`. `packages/session-brain` and `apps/runtime` are not yet tracked there. `packages/sandbox-runner/src/run-agent.ts:85-90` opens a local session file and uses in-memory settings with auto-compaction and one-at-a-time follow-ups. That is current behavior, not the new recovery design.

`packages/sandbox-runner/src/run-git-metadata.ts:36-52` supplies a custom empty loader. Its current prompt methods are:

```ts
getSystemPrompt: () => systemPrompt,
getAppendSystemPrompt: () => [],
```

The `0.85.1` interface in installed `dist/core/resource-loader.d.ts:49-56` also requires:

```ts
getSystemPromptSource(): { path: string } | undefined;
getAppendSystemPromptSources(): Array<{ path: string }>;
```

For this literal, image-owned prompt, the compatible implementations are `() => undefined` and `() => []`. The installed `examples/sdk/12-full-control.ts:44-46` uses those values. Do not discover repository prompt files to satisfy the interface. `DefaultResourceLoader` already implements the methods.

The candidate declaration in `dist/core/session-manager.d.ts:334` is:

```ts
static inMemory(cwd?: string, options?: NewSessionOptions, entries?: FileEntry[]): SessionManager;
```

Its constructor remains private and append methods remain synchronous. The new third argument supplies restored state; it does not persist anything. Do not invent an async SessionManager subclass.

Source inspected at `0.85.1`:

- `dist/core/session-manager.js:671-703` retains the supplied header-bearing array, migrates old/missing versions and selects the last file-order entry while rebuilding its index.
- `dist/core/session-manager.js:1049-1054` makes public `branch(missingId)` throw. The standalone `buildSessionContext(entries, missingId)` helper instead falls back to the last entry.
- `parseSessionEntries` skips malformed JSONL lines. It is unsuitable as the trusted checkpoint validator.
- `dist/core/agent-session.js:313-317` invokes ordinary subscribers without awaiting them. At `384-399`, extension events and ordinary observation precede the session-entry append. An observer seeing `message_end` must not assume the corresponding entry has already been appended or committed.
- Public tool hooks are installed at `agent-session.js:224-244`. Their existence is not proof of fatal-error propagation or complete checkpoint ordering. Recheck hook/result normalization and compaction paths before relying on them.

Installed paths above are relative to `node_modules/@earendil-works/pi-coding-agent` in the independent npm package. Resolve agent-core from that installed coding-agent package, including its nested dependencies. Do not substitute a global Pi installation.

Before SDK work, read the installed README, SDK/extensions documentation and relevant linked session, compaction, settings, provider and tool references completely. Prefer the installed `0.85.1` implementation/types over newer online docs. Useful pinned references:

- https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/CHANGELOG.md
- https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/session-manager.ts
- https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/agent.ts
- https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/agent-loop.ts

Follow the existing Vitest temporary-directory and injected-dependency style. The metadata regression test `uses in-memory session/settings, empty discovery, and only the kind tool` in `packages/sandbox-runner/src/run-git-metadata.test.ts:150` already inspects the loader passed to `createAgentSession`. Extend it rather than exporting a private loader just for tests. `src/locked-resource-loader.test.ts:149-154` asserts hostile repository resources remain unloaded:

```ts
expect(loader.getSkills().skills).toEqual([]);
expect(loader.getPrompts().prompts).toEqual([]);
expect(loader.getThemes().themes).toEqual([]);
expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
```

Use `unknown` plus runtime validation, not `any` or unchecked casts over restored data. Test behavior, not file existence.

## Files and deliverables

Permitted executor changes for the next local subphases:

- `packages/sandbox-runner/package.json`, `package-lock.json`; `src/run-git-metadata.ts` only for the two loader methods; corresponding assertions in `src/run-git-metadata.test.ts`; matching loader methods in `src/run-agent.test.ts`'s fake loader.
- Independent npm `packages/session-brain/package.json`, `package-lock.json`, `tsconfig.json`; `src/main.ts`, `pi-feasibility.test.ts`, `pi-restoration.test.ts`, `restoration-child.ts`; new `src/pi-recovery.ts` and `src/pi-recovery.test.ts` for the bounded adapter and its process-boundary tests. Extend the existing child command fixture rather than creating an unrelated test framework.
- Root `package.json` for `brain:verify`; later `runtime:verify` when that package actually exists.
- `plans/001-feasibility.md` for evidence and the exact tested recipe; `plans/README.md` for status and handoff. After all local 001 gates pass, version/restore-recipe-only corrections to `plans/002-contracts-and-identity.md` and `plans/006-trusted-pi-continuation.md` are permitted to make the handoff consistent. Do not change their requirements or implement those phases. No separate report directory.

Only after the Pi gates pass: `packages/session-brain/Dockerfile`; `apps/runtime/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/feasibility.test.ts`, `src/server.ts`, `types/env.d.ts`; required pnpm lock update and a verified local-only mode in `alchemy.run.ts`. Root `Dockerfile`, existing Alchemy graph, `.github/workflows/ci.yml`, web package/server/environment types and installed Container/Sandbox code are inputs. Do not change production bindings or add another deployment command.

Out of scope: product routes/UI, D1 migrations, actual runtime journal/crypto services, production network/credential policy, legacy execution removal, historical-session migration, and implementation of phases 002-012. Other runner API failures beyond the named loader change require reporting a new compatibility finding before expanding scope.

## Ordered work and gates

### A. Establish one reproducible candidate checkout

1. Record `git rev-parse --short HEAD`, `git status --short`, Node/npm/pnpm versions and current manifest/lock resolutions. At this refinement the main checkout was clean at `20d3160`; the old note about a dirty egress test is historical, not a current fact. Preserve any actual new changes.
2. Recover the baseline experiment source selectively. Use `main.ts` and `pi-feasibility.test.ts` from the continuation artifact to retain its normal-turn control; use only the restoration test and child from the restoration artifact. Keep the original `0.80.10` evidence separate.
3. Pin both Pi packages to exact `0.85.1` in runner and brain. Keep runner TypeScript/Vitest/Node-type constraints and existing resolutions where possible. Generate lockfiles with npm, never by manually inventing dependency records. Prefer seeding the new brain lock from the npm-updated runner lock and letting npm reconcile the different root package, rather than discarding all resolutions. Inspect and record every additional dependency-version change; do not silently accept unrelated refreshes from the prior experiments.
4. Add the two empty-loader methods and extend the existing metadata test to assert they return no paths. Update the fake loader in `run-agent.test.ts` to model the interface. Do not use casts to hide TS2739, enable resource discovery or weaken tests.
5. Define brain `test = vitest run`, `typecheck = tsc -p tsconfig.json --noEmit`, `build = tsc -p tsconfig.json`. Include the new test sources in its typecheck. The fixture invokes child `.ts` files directly on Node 22.19+; use erasable TypeScript syntax. If the child imports a local helper, use a `.ts` import with TypeScript 5.9's `rewriteRelativeImportExtensions` enabled so both source execution and emitted `.js` work. Define root `brain:verify = npm run typecheck --prefix packages/session-brain && npm test --prefix packages/session-brain && npm run build --prefix packages/session-brain`.

Run in the executor checkout:

```sh
pnpm install --frozen-lockfile
npm ci --prefix packages/sandbox-runner
npm ci --prefix packages/session-brain
npm ls --prefix packages/sandbox-runner @earendil-works/pi-ai @earendil-works/pi-coding-agent @earendil-works/pi-agent-core
npm ls --prefix packages/session-brain @earendil-works/pi-ai @earendil-works/pi-coding-agent @earendil-works/pi-agent-core
pnpm runner:verify
pnpm brain:verify
```

Expected: real independent installs, Pi AI/coding-agent/agent-core `0.85.1`, no links to another checkout, all existing runner tests retained, both packages typecheck/build. The combined baseline brain suite has six cases: three continuation/control and three restoration cases. Negative characterizations remain green while their required recovery guarantees remain FAIL. Do not add runtime scaffolding merely to make a missing package gate callable.

### B. Make restored state strict before using it

Implement the bounded restore boundary in `src/pi-recovery.ts`. It consumes a versioned synthetic checkpoint from the external test journal, not an arbitrary local Pi file. Keep this a prototype, not the contracts package planned in 002.

The checkpoint must record exact Pi/adapter/checkpoint versions; header and full entries; selected leaf; settings and image-owned extension state; accepted/consumed command IDs and positions; committed provider responses and actual tool results; effect states and current attempt/epoch/incarnation; and whether an assistant/run is already terminal. These are distinct facts, not inferred from the last chat message.

Validate before calling Pi:

- Enforce finite checkpoint bytes, entry count and nesting limits, with tests at and above each configured fixture limit. Record the chosen limits; they are test policy, not measured production limits.
- Parse JSON strictly. Reject malformed lines, duplicate/missing headers, absent/unsupported session versions, duplicate entry IDs, invalid entry shapes, dangling/cyclic parent links, invalid compaction references and an absent selected leaf. Preserve opaque provider fields within the supported JSON record format without normalizing or stripping them.
- Require session format `CURRENT_SESSION_VERSION === 3` for this experiment. Reject unsupported Pi/adapter/checkpoint versions rather than invoking Pi's automatic migration. Historical data migration belongs to 011.
- Validate the selected branch and compaction `firstKeptEntryId` against the same entry graph. Never use the standalone context helper's missing-leaf fallback. A new empty session is a separate explicit creation path, not a malformed active checkpoint accepted by default.
- Clone validated entries before import. Pi can mutate the caller's array and old-version records. Prove the authoritative checkpoint object remains unchanged after import, branch selection and appending.

For a validated nonempty checkpoint, the supported state-import step is:

```ts
const workingEntries = structuredClone(validated.fileEntries);
const manager = SessionManager.inMemory(imageOwnedCwd, undefined, workingEntries);
manager.branch(validated.leafId);
```

The names `validated` and `imageOwnedCwd` represent outputs of the new boundary and fixed image configuration, not existing APIs. Select the leaf before creating the agent session. Restore explicit settings and image-owned state as well. Do not pass imported cwd/configuration as executable paths or enable resource discovery.

Extend restoration tests with rejection-before-effects assertions for invalid input and immutable-checkpoint assertions. Keep the existing proof that a custom entry on the retained, post-compaction path stays out of model context. Gate: targeted restoration tests plus brain typecheck, all exit 0 with zero provider/tool calls on rejected input.

### C. Prove journal-led recovery of one committed tool batch

This is the selected experiment, not a claimed working SDK feature. The external test journal and fake remote executor survive the brain child. Normal Pi tools and recovery must use the same image-owned, argument-validating dispatch/persistence code. Fix the tool allowlist; serialize tools. A recovered batch may dispatch only calls contained in its already committed original assistant response.

Use logical identity `{runId, assistantEntryId, toolCallId}` and preserve the original response, arguments and result content. Do not match by text, rename completed operations under a new run/attempt, or reconstruct provider data from product chat.

| Durable state at restart | Allowed action before another model call |
|---|---|
| Response committed, tool definitely not admitted | Prepare/admit through the journal, then execute once using the normal validated remote dispatcher. |
| Tool `prepared`, never admitted | Resolve any lost preparation acknowledgment by logical ID; dispatch only after new durable admission. |
| Tool `result_recorded` | Use its authentic committed result. Never run the effect again. |
| Tool `admitted`, result unknown | No automatic replay. Record uncertainty and block new effects/inference. This includes a crash after admission but before the test can prove dispatch. |
| All required results committed | Reconstruct the complete selected transcript with the committed tool results, create the full coding-agent session from it, then call public `session.agent.continue()`. |
| Final assistant/run already committed terminal | Return the stored terminal outcome. Do not call `continue()`, fabricate a tool result, or generate another answer. |

Requirements for the prototype:

1. Reconcile the exact executor incarnation and execution position before authorizing recovery. Fixture authority checks must reject stale attempts/epochs. This is a local model of authority, not Cloudflare identity proof.
2. Persist admission before any dispatch and the bounded actual result before returning it or admitting another effect. Duplicate acknowledgments for the same content are idempotent; conflicting results block. A missing journal record is evidence of no dispatch only if every live/recovery path is proved unable to dispatch without that record.
3. Preserve the same required image-owned validation, tool hooks, extension-state transitions and result normalization on live and recovery paths. Do not call a raw tool `.execute` method to bypass SDK validation/hooks. Identify and test the supported common path. If it cannot be provided with public APIs and the owned adapters, STOP for an SDK decision.
4. Build the reconstructed entries with public SessionManager APIs and genuine saved results. Keep every already committed entry ID/parent link. If a result is durable before its Pi entry exists, materialize the entry once, commit the generated entry/ID and selected position before further admission, and test crashes in that gap. Do not fabricate an original entry ID or change a committed one on retry.
5. Only after all results in the original batch are accounted for may the restored full Pi session infer again. For R01-R03 the reconstructed model context must end in the committed tool results before `session.agent.continue()` runs. This uses the existing public method, not an assumed new resume API. No original prompt submission, synthetic user prompt, fake provider generation, private state patch or raw agent-core loop may stand in for recovery. The adapter handles interrupted journaled work, not future model decisions.
6. Restore image-owned extension state without applying already committed extension effects again. If an extension transition cannot be safely correlated and persisted, report that unsupported transition rather than dropping it.

Create child-process tests in `pi-recovery.test.ts`, using the existing bounded CLI fixture. A fake remote effect writes a durable counter/receipt in the external fixture so replay is observable across actual process replacement. Use explicit IPC pause points and kill/restart the child at each boundary, not merely an exception caught in the same process. No repository checkout, model key or live external effect belongs in the fixture.

Minimum positive recovery cases and required observations:

- `R01`: committed assistant with A/B undispatched. A and B each execute once, original call IDs remain, results commit before the next provider call, original prompt is not submitted again.
- `R02`: A result committed, B undispatched. A executes zero additional times; B once. Restore all raw response metadata and results.
- `R03`: all tool results committed. Zero tool dispatches during recovery; next inference receives the complete original batch and saved results.
- `R04`: final assistant committed. Zero provider/tool calls; stored terminal content and consumed-command position returned.
- `R05`: admitted tool with lost/unknown outcome. Recovery visibly blocks; zero replay and zero next inference, even when the fake effect did run.
- `R06`: result persisted but acknowledgment lost, and result persisted before its Pi entry materializes. Idempotent reconciliation, no repeated effect or duplicate committed entry.
- `R07`: compaction and two identical-text follow-ups with distinct command IDs. Correct selected branch/summary, exactly one consumption per ID, original order, no use of Pi's text matching as the durable queue identity.

Gate: `npm test --prefix packages/session-brain -- src/pi-recovery.test.ts` and `pnpm brain:verify`. All positive recovery assertions must pass, zero skips. The old negative `continue()` tests remain as controls, not a reason to stop before trying this explicitly selected adapter experiment. If R01/R02 require a prohibited workaround, stop there, record the smallest unsupported guarantee, and leave topology unstarted.

### D. Prove all awaited barriers and fail-closed admission

Extend the same real-SDK experiment. Persist command consumption with the corresponding user entry/position before inference. Deliver at most one follow-up at a supported boundary, preserving external command IDs even when text is identical. Accepted and consumed are separate positions.

Cover each barrier with a named test and failure immediately before persistence, after persistence but before acknowledgment, and after acknowledgment before the next operation:

| Barrier | Required order |
|---|---|
| Initial command consumption | Durable user entry/command position before first inference. |
| Follow-up consumption | Durable matching command ID/user entry before its inference; no loss or duplicate consumption on restart. |
| Assistant response containing tools | Full original response durable before any tool dispatch. |
| Each tool result | Actual result and required state durable before later tool/model admission. |
| Final answer | Final content and terminal position durable before semantic completion. |
| Compaction | Summary, `firstKeptEntryId`, selected leaf/settings durable before subsequent inference. |
| Required extension state | Transition and associated execution position durable before a dependent operation. |
| Model retries, compaction and metadata requests | Each spending attempt admitted and recorded; no retry hidden outside the wrapper. |

Ordinary subscriptions remain observation only. Use existing provider registration, image-owned tool/extension callbacks that Pi awaits, and the shared dispatch wrappers as candidate seams. Do not assume an SDK before-persist callback exists. Name and test the exact public hook or owned wrapper that enforces each boundary. Account for callbacks emitted before the session append and for hooks that may transform results. If recording a final entry requires waiting for the public run promise, do not publish semantic completion from an earlier observation event.

Persistence failure must latch all model/tool admissions closed even if Pi catches an exception and tries to continue. Inject failures through normal tools and extension hooks, not just a standalone mock latch. Reopening a process does not clear uncertainty or revive stale authority. Test that no next provider call or remote mutation occurs until a new authorized, reconciled recovery decision permits it.

Gate: all brain tests/typecheck/build pass, each barrier has a positive ordering test and fault cases, zero skips. Only after C and D pass may topology work start.

### E. Retain the topology, streaming and process-lifetime proofs

Inspect installed Alchemy `WorkerRef` and Container implementations before wiring. Named service references alone do not establish target-first creation. Prove local first creation and update of two services, both application classes on runtime, distinct images, private bidirectional named `WorkerEntrypoint` bindings and no runtime public route. Default public fetch must not forward arbitrary calls into named private entrypoints. Binding possession, not a header or synthetic hostname, grants the service capability.

If cyclic first creation needs staged bootstrap, specify and locally test the Alchemy-owned sequence. No live bootstrap is authorized. Preserve the production graph. `alchemy.run.ts:15-23` and `apps/web/src/server.ts:12-16` still describe the current single product-Worker Sandbox arrangement; do not mistake that for the target.

Verify the exact Sandbox `0.12.3` `readFile`/`writeFile` streaming invocation and archive CLI completion/cancellation contract required by 007. Demonstrate bounded backpressure in both directions and correct completion/error/cancel handling. Stop if transfer requires whole-archive buffering or container-visible R2 capabilities.

Prove readiness separately from work completion; platform `containerId`/class mapping and a distinct process incarnation; executor denial of brain-only calls; supported `schedule` with persistent wakeup intent; and coordinator restart while Node survives without duplicate Pi. Never override `alarm` or globally block DO concurrency while waiting for Node callbacks.

Record supported operations and observations that prove termination of an exact old incarnation, or isolation of a replacement without shared workspace/process/mount. A cancel acknowledgment, lease expiry or untrusted executor receipt proves neither. Unknown lifetime keeps affected replacement/release gates BLOCKED. Isolating replacement does not free the old capacity claim or resolve external effects.

Define runtime `test = vitest run`, `typecheck = tsc --noEmit`, `build = tsc --noEmit`; use compatible existing TS/Vitest tooling and a Container version compatible with pinned Sandbox. This `build` is static validation, not the Worker bundle. Alchemy bundle verification remains in 012. Define root `runtime:verify = pnpm --filter @ditto/runtime typecheck && pnpm --filter @ditto/runtime exec vitest run` only when the package exists.

Gate:

```sh
pnpm --filter @ditto/runtime exec vitest run src/feasibility.test.ts
pnpm runtime:verify
pnpm check
pnpm typecheck
```

All required local rows must pass. Label SDK/source/mock evidence separately from platform observations. Local mocks alone cannot earn a platform PASS. If a required local proof cannot run on available tooling, record BLOCKED/NOT RUN rather than waive it for 002. Paid evidence may remain NOT RUN only with production cutover blocked.

### F. Measurements, final evidence and handoff

Record local measurements and separately authorized paid gates. Establish candidate cold-start latency, memory, tool round-trip, archive/disk and cost measurements, then request maintainer thresholds. A configured 20+20 container limit proves neither entitlement nor affordability. Do not invent production budgets from fixture limits.

For each barrier, restore position, topology/streaming operation and incarnation guarantee, append PASS/FAIL/NOT RUN with exact test name/command, versions, environment, fixture limits and observed result. Keep negative characterizations distinguishable from successful recovery. Record the supported import/reconciliation recipe and any unresolved SDK decision here, not in an external report directory.

Before proposing phase 001 complete, run:

```sh
pnpm runner:verify
pnpm brain:verify
pnpm runtime:verify
pnpm verify
```

The root `verify` currently excludes new packages, hence the explicit brain/runtime gates. All applicable tests must execute, with zero required skipped cases. Repository gates do not replace the separate feasibility evidence table or paid acceptance matrix.

Handoff to 002 requires: all local recovery/barrier/topology requirements PASS; exact Pi/adapter/session/checkpoint versions; validated import and effect-reconciliation recipe; bridge fields and measured byte/time bounds; supported Container scheduler/identity/lifetime observations; tested named-entrypoint Alchemy procedure; stable streaming archive recipe for 007; and explicit outstanding paid gates.

Brain has no contracts dependency in 001. Inspect npm file-dependency installation behavior, but do not claim consumer freshness before a consumer exists. When 002 adds `file:../runtime-contracts`, it must prepend contracts build and the actual installed-consumer freshness check to `brain:verify`; copied file dependencies are not assumed linked or refreshed by building workspace output.

Before handing off, reconcile the version/import assumptions in `plans/002-contracts-and-identity.md:9` and `plans/006-trusted-pi-continuation.md:7,33,64` against the successful recipe. Those plans currently say `0.80.10` and reconstruct JSONL because in-memory import was unavailable. They remain blocked, not authority to downgrade or discard validated recovery semantics. This refinement changes only 001 and its index; later plan revision must carry the actual proven recipe, not a speculative broad replacement.

## Authoritative platform references

These references describe mechanisms, not passing integration evidence. Confirm current docs before Cloudflare implementation:

- https://developers.cloudflare.com/containers/reference/container-class/
- https://developers.cloudflare.com/containers/guides/outbound-traffic/
- https://developers.cloudflare.com/containers/configuration/workers-connections/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- https://developers.cloudflare.com/workers/platform/limits/

They establish separate processes, supported scheduling, outbound identity context, awaited service calls and finite request lifetimes. They do not prove Ditto's cyclic deployment, incarnation retirement or disconnected-run behavior. Do not copy generic credential-injection examples into container launch configuration.

## Stop and maintenance

Stop on unsupported public recovery composition, unresolved awaited ordering, metadata loss, persistence failure permitting new effects, identity spoofing, duplicate Pi after coordinator restart, unproved process-lifetime gates, or topology requiring a third application object or changed Sandbox protocol. Preserve the reproducer and report the smallest missing guarantee. No silent SDK fork/upgrade, prompt replay, fabricated result, local-tool fallback or weaker checkpoint is an escape hatch.

Rerun this phase for changes to Pi/provider/adapter versions, image/resource loading, journal/session format, Container, Alchemy or transport. A passing import test is not permission to migrate retained histories. The next executor's product is a tested recipe or a precise blocked decision, not a green status obtained by weakening the tests.
