# 001: Prove the pinned SDK and two-container topology

Status: TODO. Base HEAD: `c963890`, branch `brain`. Effort: L, roughly 4-7 focused engineering days plus separately scheduled paid integration. Risk: high. This is a falsification phase, not permission to deploy.

## Problem and target

The accepted spec requires full Pi in a trusted Node container, a workerd coordinator extending Container, and a separate Sandbox executor. Neither the installed SDK nor platform docs establish that Ditto can durably pause and reconstruct every required Pi transition. Prove those seams before writing the durable runtime around them.

Prerequisites: read all of `docs/specs/trusted-session-runtime.md`. No implementation prerequisites. Keep Sandbox at `0.12.3` and Pi at `0.80.10`. No alternate agent loop, pooled process, third application DO, production operations, source reset, or dependency upgrade is in scope.

## Current code and conventions

Local source excerpts rechecked during the editorial pass:

`packages/sandbox-runner/src/run-agent.ts:85-90`:

```ts
const sessionManager = SessionManager.open(sessionFile);

const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: true },
  followUpMode: "one-at-a-time",
});
```

`packages/sandbox-runner/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:281-284`:

```js
_emit(event) {
    for (const l of this._eventListeners) {
        l(event);
```

That listener is not awaited. The same file at 212-252 installs awaited tool hooks, and 1678-1693 appends auto-compaction then emits an extension event. Error propagation and ordering into the next effect still need an executable proof.

`alchemy.run.ts:15-23` defines only a `Sandbox` Container and `apps/web/src/server.ts:12-16` currently exports its product-Worker class:

```ts
export class Sandbox extends BaseSandbox {
  enableInternet = false;
  interceptHttps = true;
  sleepAfter = "10m";
```

Before SDK changes, executors must read the Pi README, SDK/extensions docs and their relevant continuation, compaction, settings, provider and tool references, then prefer installed source/types. Earlier global documentation reads are reported history, not evidence reverified by this editorial pass. The installed `SessionManager.inMemory(cwd?, options?)` declaration has no entries argument. Its constructor is private, and append methods are synchronous. Do not invent an async SessionManager subclass.

Existing regression style is Vitest with temporary filesystem fixtures and injected dependencies. `packages/sandbox-runner/src/locked-resource-loader.test.ts:149-154` provides behavioral assertions:

```ts
expect(loader.getSkills().skills).toEqual([]);
expect(loader.getPrompts().prompts).toEqual([]);
expect(loader.getThemes().themes).toEqual([]);
expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
expect(loader.getSystemPrompt()).toBeUndefined();
expect(loader.getAppendSystemPrompt()).toEqual([]);
```

Use typed `unknown` validation and explicit assertions, not `any` or tests that only check a file exists.

## Files and deliverables

Existing inputs: root `package.json`, `pnpm-workspace.yaml`, `alchemy.run.ts`, `Dockerfile`, `.github/workflows/ci.yml`; `apps/web/package.json`, `apps/web/src/server.ts`, `apps/web/types/env.d.ts`; `packages/sandbox-runner/package.json`, `src/run-agent.ts`, `src/locked-resource-loader.ts`, corresponding tests. Read installed Pi `dist/core/sdk.d.ts`, `agent-session.js`, `session-manager.d.ts`, tool implementations, resolved agent-core/provider code, and lockfiles.

Proposed isolated development files:

- `apps/runtime/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/feasibility.test.ts`, `src/server.ts`, `types/env.d.ts`.
- `packages/session-brain/package.json`, `package-lock.json`, `tsconfig.json`, `src/pi-feasibility.test.ts`, `src/main.ts`, `Dockerfile`.
- `plans/001-feasibility.md`, append the evidence table and the exact supported adapter recipe here. No separate report directory.

Keep experimental code minimal and promote it into real implementation files in 004/006. Do not publish an unrelated spike Worker or leave a second deployment command. Add a local-only topology mode to the Alchemy graph only after verifying how the installed version represents both services; production remains unchanged.

Define these future package gates before invoking them:

- `@ditto/runtime`: `test = vitest run`, `typecheck = tsc --noEmit`, `build = tsc --noEmit`. The last is a static gate, not the Worker bundle; Alchemy owns runtime bundling and that bundle gets a separate 012 verification gate. Use existing compatible TypeScript/Vitest tooling; pin a compatible Container dependency after inspecting the version used by Sandbox, without upgrading Sandbox.
- independent npm `ditto-session-brain`: `test = vitest run`, `typecheck = tsc -p tsconfig.json --noEmit`, `build = tsc -p tsconfig.json`. Pin both Pi packages to `0.80.10`; do not reuse the developer's global Pi.
- Phase-001 root `brain:verify = npm run typecheck --prefix packages/session-brain && npm test --prefix packages/session-brain && npm run build --prefix packages/session-brain`; brain has no contracts dependency yet. 002 must prepend `contracts:verify` and the verified consumer-freshness gate when it adds `file:../runtime-contracts`. Define `runtime:verify = pnpm --filter @ditto/runtime typecheck && pnpm --filter @ditto/runtime exec vitest run`.

No install/build/test command was run by this drafter. New package lockfiles and installation happen only in an authorized executor checkout. Do not hand-edit a lockfile to fabricate a working graph.

## Ordered work

1. Record `git rev-parse --short HEAD` and `git status --short`. Preserve the unrelated dirty `apps/web/src/lib/sandbox-egress-broker.test.ts`. Verify actual package resolution in the executor checkout. The drafter could read coding-agent sources but could not resolve agent-core from that package; diagnose the installation before assuming it is runnable. Read the relevant installed SDK implementations, not just interfaces.
2. Build an offline Pi experiment using the real pinned coding-agent SDK, a deterministic provider stream, a fake remote executor, and a durable test store that survives a child-process restart. The experiment must preserve raw provider IDs/metadata, selected leaf, tool results, compaction and command-consumption position. No live model key or repository checkout enters the brain fixture.
3. Prove barriers for initial/follow-up user consumption, complete assistant response before its tools, every tool result before a later model/effect, final answer, compaction before subsequent inference, and extension state. Include two identical-text follow-ups with distinct IDs. Inject failure before and after each persisted acknowledgment. A fatal persistence failure must latch admission closed even if Pi catches an extension/tool exception and tries to continue.
4. Prove restoration recipes for a tool-calling assistant with no dispatched tool, a partially completed multi-tool response, all results committed, final assistant committed, and compaction/follow-up boundaries. Prefer reconstructing a validated JSONL working file under an image-owned state directory and selecting the recorded leaf, because installed `inMemory` lacks import support. Validate whether Pi's supported continuation entry can proceed from that position; do not send the original prompt again to simulate continuation. Record exact public hooks/wrappers and failure behavior. If unsupported, STOP for a pinned adapter/SDK decision, not private-field monkeypatching or a silent SDK upgrade.
5. Inspect Alchemy's installed `WorkerRef` and Container implementations. `node_modules/alchemy/src/cloudflare/worker-ref.ts:40-52` creates named service references; that alone does not solve target-first deployment validation. Prove local first creation and update for two services, both classes on runtime, distinct images, private bidirectional service bindings and no runtime public route. Specify the staged, Alchemy-owned bootstrap if cyclic first creation needs one. No live bootstrap is authorized. Prove named `WorkerEntrypoint` bindings to the intended counterpart, with no public fetch forwarding to those entrypoints. A Worker without the binding has no capability to invoke them; do not infer caller authority from headers or undocumented caller metadata. Verify the exact pinned stable Sandbox `readFile`/`writeFile` streaming invocation and archive CLI completion/cancellation contract required by 007, with bounded backpressure in both directions. STOP if only whole-archive buffering or container-visible storage capabilities can satisfy transfer.
6. Prove the minimal bridge with readiness separate from work completion, platform `containerId`/class mapping, distinct process incarnation, denied executor calls, supported `schedule` and persistent intent. Restart the coordinator while its Node survives. Record the supported platform operations and observations that can prove termination of an exact incarnation, or isolation of a replacement with no shared workspace/process/mount. Cancellation acknowledgments are not that evidence. If the platform cannot establish these facts, affected replacement/release gates remain BLOCKED. Inspect current Container APIs before coding. Never override `alarm` or globally block DO concurrency across Node callbacks.
7. Record local evidence and all paid gates separately. Establish candidate latency, memory, archive-disk and cost measurements; request maintainer budget thresholds. A limit of 20+20 containers is not proof of entitlement or affordability.

## Authoritative platform evidence

Cloudflare references carried forward from the draft, not refetched during the editorial pass. Confirm current documentation before implementation; these references describe mechanisms, not passing integration evidence:

- https://developers.cloudflare.com/containers/reference/container-class/ describes Container as DurableObject, default fetch as auto-starting, and `schedule` instead of overriding `alarm`.
- https://developers.cloudflare.com/containers/guides/outbound-traffic/ describes HTTPS interception, runtime CA and `ctx.containerId`.
- https://developers.cloudflare.com/containers/configuration/workers-connections/ demonstrates bounded HTTP bridging to Worker bindings. It does not make a synthetic hostname identity.
- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/ says callees must be awaited and first deployment normally needs the target first. A binding is not detached execution.
- https://developers.cloudflare.com/workers/platform/limits/ explains request cancellation after disconnect and finite `waitUntil` extension.

Paid-plan integration for those claims remains NOT RUN. Do not copy docs' generic credential-injection examples into container launch configuration.

## Verification and machine-checkable exit

After each experiment iteration:

```sh
npm test --prefix packages/session-brain -- src/pi-feasibility.test.ts
pnpm --filter @ditto/runtime exec vitest run src/feasibility.test.ts
npm test --prefix packages/sandbox-runner -- src/locked-resource-loader.test.ts
npm run typecheck --prefix packages/session-brain
pnpm --filter @ditto/runtime typecheck
pnpm check
pnpm typecheck
```

Expect exit 0, named files selected, and no skipped feasibility case. Parent-reported baseline is in `plans/README.md`; it is not a result for these new tests. For web regressions use `exec vitest run`, since the documented `test -- <path>` wrapper selected the entire suite at baseline.

Done means an evidence row exists for each barrier and restore position, with PASS/FAIL/NOT RUN, exact versions and test name. Every local row required by steps 2-6 must PASS before 002. The report must name the concrete Pi adapter recipe and the tested Alchemy cyclic-binding procedure. Paid rows may remain NOT RUN only with production cutover blocked. A local mock topology alone cannot earn a platform PASS.

Handoff to 002: validated Pi continuation format/version requirements; required bridge fields and byte/time bounds; actual Container scheduler/identity/termination observations; named-entrypoint Alchemy binding recipe; stable streaming archive invocation/completion recipe for 007; explicit remaining paid gates. Inspect the pinned npm file-dependency installation behavior here, then prove the actual contracts-consumer freshness recipe once 002 creates that package; do not assume file dependencies are always linked. Later phases must not have to rediscover these.

## Stop and maintenance

STOP on unresolved awaited ordering, loss of provider metadata, swallowed persistence failure permitting new effects, unsupported continuation, identity spoofing, duplicate Pi after DO restart, or a topology requiring a third object or changed Sandbox protocol. Report the smallest unsupported guarantee. Maintainers decide whether to change the architecture or pinned SDK; the executor cannot weaken the spec.

Rerun this phase's tests for every Pi, provider, Container, image, Alchemy, transport or journal-version change. Archive the tested recipe in this plan before implementation expands it.
