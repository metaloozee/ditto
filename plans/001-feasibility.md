# 001: Prove Pi 0.85.1 recovery and the two-container topology

Status: Local 001 accepted and landed on `brain` through merge `693a334`, alongside accepted 002. Pi `0.85.1` and its runner changes are committed; the pre-merge brain/runtime/runner verification passed. A-D and Docker boot were proved in the earlier local worktree; Docker boot was not repeated after merge. Paid F-Topology, P-Restart, and incarnation lifetime remain NOT RUN, not PASS. No real-user trusted runtime enablement is authorized. Original refinement base `20d3160`; original plan base `c963890`. Effort: L. Risk: high.

Reconciled at `a5c1185`. The current handoff is the landed Pi `0.85.1` local recipe: validate and clone entries, import with `SessionManager.inMemory(imageOwnedCwd, undefined, entries)`, select `branch(leafId)`, reconcile journaled tools, then continue from committed state. 002 is accepted and 003 is ready. Production integration and barrier revalidation belong to 006; paid topology, surviving-container restart and exact incarnation termination/isolation still need authorized evidence.

The candidate experiments, five execution reviews and original work instructions below are historical records. Their rejected verdicts, temporary paths, package-absence claims and restrictions on starting 002 describe earlier candidates, not the landed baseline. Preserve their findings without treating them as current blockers or repeating completed work. See [the index](README.md) and [002 acceptance](002-expanded-repair-review.md) for current status.

## Problem and scope

The accepted target requires full Pi in a trusted Node container, a workerd coordinator extending Container, and a separate Sandbox executor. A restarted brain must preserve completed work, finish only definitely undispatched tools, and block on uncertain effects. Pi's direct continuation API does not provide that recovery by itself, including at `0.85.1`.

Read all of `docs/specs/trusted-session-runtime.md` before execution. Keep Sandbox at `0.12.3`, the fixed product model and thinking levels unchanged. The only dependency upgrade in scope is both Pi packages to exact `0.85.1`, with their required transitive changes. Preserve unrelated dependency resolutions where possible and report additional lock churn.

Full coding-agent remains responsible for inference, normal turns, compaction and tool selection. No alternate agent-core loop, private-field patching, pooled brain, third application DO, SDK fork, source reset, Sandbox protocol migration or further SDK upgrade is authorized. A recovery adapter may reconcile one already committed tool batch under the journal rules below; it may not invent a new agent loop or repeat a model request to reconstruct the old answer.

No production inspection, live model calls, deployment, shared database mutation, cloud identity retirement, archive deletion, staging or commits. Paid integration needs separate environment and budget authorization. Preserve existing work, including uncommitted experiment files. Do not copy credentials, `.env.local`, `.alchemy` or `.wrangler` state into an executor checkout.

## Historical candidate experiments, before local acceptance

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

## Execution review at `6eefdd1`

Executor: `xai/grok-4.6`, High reasoning. Candidate remains uncommitted in `/tmp/ditto-feasibility-execute.2xREVW/worktree`, detached at `6eefdd1`. The advisor read every new source/test file and the tracked source/manifest/doc diff, checked lock-version changes, and reran the gates below. No candidate source or dependency change was applied to the main checkout. Only this plan and the index receive review evidence.

Verdict: **REJECTED**, not local feasibility PASS. The worktree's own plan files claim A-D passed; those claims are not accepted evidence. Its extra `packages/session-brain/.gitignore` is outside the explicit file whitelist and duplicates root ignores. Leave the candidate intact for diagnosis; do not copy it wholesale.

Environment: Node `v24.21.0`, npm `11.19.0`, pnpm `11.8.0`. Both independent packages resolve Pi AI, coding-agent and nested agent-core to `0.85.1`, with no lockfile links. TypeScript `5.9.3`, Vitest `3.2.7` and root Node types `22.20.1` were preserved. Brain and runner dependency version maps match. Other changed versions are Anthropic SDK `0.91.1` to `0.123.0`, OpenAI `6.26.0` to `6.40.0`, TypeBox `1.1.38` to `1.3.7`, undici `8.5.0` to `8.9.0`, protobufjs `7.6.4` to `7.6.5`, and brace-expansion `5.0.6` to `5.0.9`. This verifies resolution, not a dependency security audit.

| Independent gate | Result |
|---|---|
| `pnpm runner:verify` | PASS: typecheck, 79 tests, build. Named loader compatibility change is correct. |
| `pnpm brain:verify` | PASS as written: typecheck, 46 tests, build. Does not establish B-D requirements. |
| `pnpm check` | FAIL: 9 errors, 13 warnings. New brain source has formatting/import errors. |
| `git diff --check` | PASS for tracked candidate changes. |
| Advisor recovery/validation probes below | FAIL: the persisted probe exits 1 with 10 failed guarantees. A separate actual kill/restart at the entry-materialization boundary also changed the saved entry ID. |
| `pnpm verify`, runtime/topology/streaming/paid gates | NOT RUN. No runtime package exists. B-D failures prohibit starting E. |

All following paths refer to the candidate worktree, not the main checkout. Abbreviated `src/` paths mean `packages/session-brain/src/`. Line numbers refer to the reviewed, unmodified candidate.

| ID | Verified defect | Evidence and observation |
|---|---|---|
| ER01 | Explicit unknown outcomes are replayed. | `packages/session-brain/src/pi-recovery.ts:783-821` and `src/main.ts:635-659` only block `admitted` without a result. `outcome_unknown` falls through to admission/dispatch. With an existing synthetic effect receipt count of 1, recovery returned `continued`, raised the counter to 2, and called the provider once. |
| ER02 | Committed positions do not include their entries or terminal state. | `src/pi-recovery.ts:941-985` saves a generated `piEntryId` but never the entry or updated checkpoint. `src/main.ts:689-704,737-738` similarly saves follow-up IDs and a final-answer label without user/final entries or terminal flags. Two process replacements generated different result entry IDs and each inferred again. A killed child at `after-entry-before-continue` had saved an ID absent from its checkpoint; restart replaced that ID. Two identical-text commands became consumed while neither user entry appeared in the saved checkpoint. |
| ER03 | Recovery does not preserve the effective tool result. | `src/pi-recovery.ts:818-821,863-935` commits before `afterToolCall`, then manually calls a tool and hooks. `src/main.ts:654-681` discards that call's return and materializes the earlier saved result. An after-hook transformed content and `isError`, but the journal retained the original content and `false`. `loadJournal` at `src/pi-recovery.ts:644-675` also silently filters result content to text. No image-owned extension is installed by `src/main.ts:63-81`; extension transitions are not proved. |
| ER04 | Barrier labels are not persistence proofs; real write failure does not latch. | `src/pi-recovery.ts:757-770` appends a string to `barrierLog`. `src/main.ts:551,586-613,738` uses these strings for initial command, extension state, existing compaction, assistant response and final answer. `src/pi-recovery.test.ts:543-616` checks marker membership and pre-seeded effect counts, not durable content or per-boundary operation ordering. The live-tool failure case covers only the marker-file injection. A real `writeFileSync` EISDIR failure at `src/pi-recovery.ts:708-716` left `isLatched` false. Retry, metadata, actual compaction and extension-hook failure paths remain unproved. |
| ER05 | Restore accepts invalid state and loses supported settings. | `src/pi-recovery.ts:173-181,362-375,382,498,535-549` counts UTF-16 characters as bytes, only checks a content block's `type` string, permits a compaction reference after its own entry, and retains only compaction/retry enable flags. A checkpoint of 8,884 UTF-8 bytes passed an 8,192-byte limit. `{type: "toolCall"}` passed without IDs/name/arguments. A forward `firstKeptEntryId` passed. Requested compaction limits 1,234/5,678 restored as defaults 16,384/20,000. `createOfflineHarness` at `src/main.ts:191-210,594-599` also replaces restored settings with its own defaults. |
| ER06 | Logical identity and authority are narrower than the required contract. | `src/main.ts:582-585,615-616` creates tool names from journal input and matches effects by call ID only; `src/pi-recovery.ts:783-788,949-953` also uses call ID without run/originating assistant/selected branch. `assertAuthority` compares one three-field tuple, not executor incarnation plus execution position; live dispatch does not recheck it. These are source-confirmed gaps, not platform identity findings. |

The first attempt's blockers were implementation defects, not an SDK impossibility. A second executor repaired them. That does not finish phase 001.

## Second execution review

Executor: `xai/grok-4.6`, High reasoning. Candidate uncommitted in `/tmp/ditto-feasibility-execute.bw57gx/worktree`, detached `6eefdd1`. The previous rejected worktree is gone. The advisor read the new brain/runner sources, reran gates, and reran the red probe below. No candidate source was applied to the main checkout. The executor's own plan text claiming "local B-D repaired" is not accepted for D.

Recipe in this candidate: clone entries, `SessionManager.inMemory(imageOwnedCwd, undefined, workingEntries)`, `branch(leafId)`, journaled dispatch of prepared tools through public `beforeToolCall`/`afterToolCall` plus `runRemoteEffect`, commit the hook-normalized result and Pi entry/leaf into the checkpoint, dispose that session, create a new `createAgentSession` from the committed manager, then `session.agent.continue()`. Grep found no `agent.state.messages =` assignment. No STOP/SDK gap was shown.

Fixture policy in `packages/session-brain/src/pi-recovery.ts` `FIXTURE_LIMITS`: `maxBytes=8192`, `maxEntries=32`, `maxNesting=16`. Test policy, not production limits. Pi AI, coding-agent, and nested agent-core are `0.85.1` in runner and brain.

| Independent gate | Result |
|---|---|
| `pnpm runner:verify` | PASS: typecheck, 79 tests, build. |
| `pnpm brain:verify` | PASS: typecheck, 27 tests, build. |
| Advisor red probe | PASS, exit 0, 10/10. |
| Scoped `biome check` on new brain/runner files | PASS. |
| `git diff --check` | PASS. |
| D 8 barriers × 3 crash positions | FAIL / incomplete. Named SIGKILL coverage exists for entry materialization, admission-before-dispatch, and follow-up persist. Missing initial-command, assistant-tools, final-answer, compaction, extension-state, and spending-attempt, each at before-persist / after-persist-before-ack / after-ack-before-next. No live Pi-swallowed persist-failure case during a tool batch. |
| E topology/streaming, `runtime:verify`, `pnpm verify`, paid | NOT RUN. Correctly not started. |

ER01-ER06 against this candidate:

- ER01: `unknownOrUnproved` blocks `outcome_unknown` and `admitted` without a result at recover entry. Probe and R05/R05b PASS.
- ER02: `snapshotSession` writes header, entries, and leaf after materialization. SIGKILL at `after-entry-before-continue` keeps the same `piEntryId` in the checkpoint. Second recovery is terminal with zero inference. Probe PASS.
- ER03: `afterToolCall` content/`isError` is what gets journaled. In-process hook test PASS.
- ER04: real `writeFileSync` EISDIR latches `admission.latched`. Probe PASS. This is not the full D matrix.
- ER05: UTF-8 `Buffer.byteLength`, full tool-call shape, forward compaction rejected, compaction settings 1234/5678 restored. Probe PASS.
- ER06: effects keyed by `{runId, assistantEntryId, toolCallId}`; `runRemoteEffect` rechecks authority and execution position.

Do not copy this worktree onto `brain`. Do not treat A-C as F-Pi or as permission to implement 002.

## Third execution review

Executor: `xai/grok-4.6`, High reasoning, D-only. Same worktree `/tmp/ditto-feasibility-execute.bw57gx/worktree`. The advisor read the new D tests and persist helpers, reran gates, and reran the red probe. No candidate source was applied to the main checkout. The executor's plan-file self-verdict is not authority.

D as reviewed: eight named barriers, each SIGKILL-tested at before-persist, after-persist-before-ack, and after-ack-before-next. Mid-crash assertions inspect journal/checkpoint content (consumed command IDs, user entries, committed assistant tool calls, hook-normalized results, terminal flag/content, compaction summary/`firstKeptEntryId`/leaf, extension `phase`, spending attempts). Restart then asserts durable recovery or, for tool-result before-persist, a blocked unknown outcome. Live persist failure through `tool_result` latches; `call-b` does not run; reopen stays blocked. Final answer waits on the public `continue()`/`compact()` promise, not `message_end`.

Enforcers: `consumeInitialCommand`; `consumeOneFollowUp`; public `tool_call` then `persistAssistantResponseBeforeDispatch`; public `tool_result` then `persistToolResultFromHook`; `persistFinalAnswerAfterRunPromise`; public `session_compact`; public `tool_call` then `persistExtensionStateTransition`; `admitSpendingAttempt` wrapping `streamFunction` (retry and metadata included).

| Independent gate | Result |
|---|---|
| `pnpm runner:verify` | PASS, 79 tests |
| `pnpm brain:verify` | PASS, 40 tests |
| Advisor red probe | PASS, exit 0, 10/10 |
| Scoped biome on `packages/session-brain/src` | PASS |
| D 8	imes3 SIGKILL matrix plus live swallowed persist | PASS as local synthetic evidence |
| E topology/streaming, `runtime:verify`, `pnpm verify`, paid | NOT RUN |

Residual, not a D reject: `runRemoteEffect` compares `leafId` to `journal.assistantEntryId` on both sides, so execution-position checks do not bind the selected session leaf. Keep that visible for 006.

## Fourth execution review

Executor: `xai/grok-4.6`, High reasoning, local E. Same worktree. The advisor read `alchemy.run.ts`, `apps/runtime/src/server.ts`, `src/feasibility.test.ts`, the brain Dockerfile, and reran gates. Production website graph and bindings are unchanged; extra runtime workers exist only when `app.local && DITTO_LOCAL_RUNTIME_TOPOLOGY=1`. No candidate source was applied to the main checkout.

| Row | Advisor verdict | Evidence class |
|---|---|---|
| E1 two services, both classes on runtime, distinct images, named bidirectional `WorkerEntrypoint`, default fetch 404, header spoof fails, unbound attacker has no `RUNTIME` | PASS local | Miniflare/workerd plus source. Not a Cloudflare account deploy. |
| E2 first create and update | PASS local sequence; live Alchemy first-create NOT RUN | Miniflare stub then named-entrypoint update. Alchemy local Miniflare drops `entrypoint`; `Worker.experimentalEntrypoint` is unsupported in local Alchemy. Needs a maintainer-approved non-prod account. |
| E3 Sandbox `0.12.3` `readFile({encoding:"none"})` / `writeFile(ReadableStream)` and archive CLI before/after stream | PASS local adapter; live container stream NOT RUN | SDK source plus Node mock sandbox. No whole-archive `arrayBuffer` in the adapter; no container R2. |
| E4 readiness ≠ work complete, `containerId`/`className` from Container source, distinct incarnation, executor brain-only denial, `schedule` after persisted wakeup, no `alarm` override | PASS local application/SDK; P-Restart NOT RUN | Helpers and source greps. `denyUnlessBrain(callerRole)` is still an application argument, not platform identity. Surviving-Node DO restart untested. |
| E5 exact old incarnation terminated or isolated replacement | BLOCKED / NOT RUN | Cancel ack, lease expiry, and untrusted executor receipt are explicitly insufficient. Unknown lifetime. |
| F paid measurements | NOT RUN | No budget authorization. |

Independent gates: `pnpm --filter @ditto/runtime exec vitest run src/feasibility.test.ts` 19 PASS; `pnpm runtime:verify` PASS; `pnpm brain:verify` 40 PASS; red probe 10/10 exit 0; `pnpm check` PASS with 11 existing warnings; `pnpm typecheck` PASS.

Do not copy this worktree onto `brain`. Do not implement 002 unless the maintainer explicitly starts that phase. F-Topology stays NOT RUN.

## Fifth execution review

Executor: `xai/grok-4.6`, High reasoning, Docker boot. Same worktree. Docker Desktop 29.6.2 was available. The advisor independently reran process start on the leftover images and read `apps/runtime/src/docker-feasibility.test.ts`. No candidate source was applied to the main checkout. Alchemy local/dev was not started (no secrets, production website graph still requires `alchemy.secret`).

| Observation | Result |
|---|---|
| `ditto-feasibility-brain:local` (`d00930bc331f`, 718MB, `node:22-bookworm-slim`) | PASS Docker. Advisor `docker run` printed `brain-process-started` and `barrier-enforcers object`. |
| `ditto-feasibility-sandbox:local` (`a9a08ad3699a`, 1.3GB, `cloudflare/sandbox:0.12.3`) | PASS Docker. Advisor `docker run -d` was `true running`. Logs: `Container server started` on :3000, `0.12.3`, API server only. Proof container removed. |
| Alchemy local two-service create | NOT RUN |
| Paid F-Topology / P-Restart / incarnation lifetime | NOT RUN / BLOCKED |

`apps/runtime/src/docker-feasibility.test.ts` is extra relative to the named `feasibility.test.ts` whitelist; it rebuilds both images when executed. Default `runtime:verify` still reported 19 tests in the executor log; do not assume CI will skip Docker. Images remain on disk. 0 leftover proof containers.

### Reproduce rejected guarantees

Regression probe for ER01-ER06. Run only in a disposable candidate. It writes synthetic files under ignored `.scratch/` and uses the offline fixture. Against `/tmp/ditto-feasibility-execute.bw57gx/worktree` it exits 0. Against the rejected first candidate it exited 1 with 10 failures. It does not prove D. Do not rewrite the assertions to match weaker behavior.

```sh
cd /tmp/ditto-feasibility-execute.bw57gx/worktree
python3 - <<'PY' | PI_OFFLINE=1 node --input-type=module
from pathlib import Path
text = Path('/home/ayan/ditto/plans/001-feasibility.md').read_text()
section = text.split('<!-- advisor-001-probe:start -->', 1)[1]
print(section.split('```js\n', 1)[1].split('```', 1)[0])
PY
```

<!-- advisor-001-probe:start -->
```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assistantToolUse, buildRestorationFixture, checkpointFromFixture,
} from './packages/session-brain/src/main.ts';
import {
  FIXTURE_LIMITS, isLatched, loadJournal, parseAndValidateCheckpoint,
  restoreValidatedCheckpoint, saveJournal, saveReceipts, validateCheckpoint,
} from './packages/session-brain/src/pi-recovery.ts';
fs.mkdirSync('.scratch', { recursive: true });
const root = fs.mkdtempSync(path.join(process.cwd(), '.scratch/advisor-001-'));
let failures = 0;
function check(name, assertion) {
  try { assertion(); console.log(`PASS ${name}`); }
  catch { failures++; console.log(`FAIL ${name}`); }
}
const checkpoint = () => checkpointFromFixture(buildRestorationFixture(root));
function seed(name, state = 'prepared', followUps = []) {
  const dir = path.join(root, name);
  const cp = checkpoint();
  cp.fileEntries = cp.fileEntries.slice(0, 5);
  cp.leafId = 'ent-a1';
  const message = assistantToolUse({
    provider: 'offline', model: 'offline-1', api: 'faux', timestamp: 5,
    calls: [
      { id: 'call-a', name: 'tool_a', arguments: { n: 1 } },
      { id: 'call-b', name: 'tool_b', arguments: { n: 2 } },
    ],
  });
  cp.fileEntries.at(-1).message = message;
  cp.committedProviderResponses = [message];
  cp.attempt = 1; cp.epoch = 1; cp.incarnation = 'brain-1';
  saveJournal(dir, {
    authority: { incarnation: 'brain-1', epoch: 1, attempt: 1 },
    runId: 'run-1', assistantEntryId: 'ent-a1', checkpoint: cp,
    effects: message.content.map((call, index) => ({
      runId: 'run-1', assistantEntryId: 'ent-a1', toolCallId: call.id,
      toolName: call.name, arguments: call.arguments,
      state: index === 0 ? state : 'prepared',
    })),
    acceptedCommandIds: followUps.map(item => item.commandId),
    consumedCommandIds: [], followUps,
  });
  return dir;
}
function recover(dir) {
  const requestPath = path.join(dir, 'request.json');
  const agentDir = path.join(dir, 'agent');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(requestPath, JSON.stringify({
    action: 'recover', journalDir: dir, imageOwnedCwd: root, agentDir,
    expectedAuthority: { incarnation: 'brain-1', epoch: 1, attempt: 1 },
  }));
  const child = spawnSync(process.execPath, [
    'packages/session-brain/src/restoration-child.ts', requestPath,
  ], { encoding: 'utf8', timeout: 15000, env: { ...process.env, PI_OFFLINE: '1' } });
  assert.equal(child.status, 0, 'synthetic child must run');
  return JSON.parse(child.stdout);
}
const unknownDir = seed('unknown', 'outcome_unknown');
saveReceipts(unknownDir, { 'call-a': { count: 1, output: 'tool_a:1' } });
const unknown = recover(unknownDir);
check('unknown outcome blocks without replay or inference', () => {
  assert.equal(unknown.status, 'blocked');
  assert.equal(unknown.receipts['call-a'].count, 1);
  assert.equal(unknown.providerCalls, 0);
});
const repeatDir = seed('repeat');
recover(repeatDir);
const before = loadJournal(repeatDir);
const repeated = recover(repeatDir);
const after = loadJournal(repeatDir);
check('result entry IDs survive process replacement', () => {
  assert.deepEqual(after.effects.map(e => e.piEntryId), before.effects.map(e => e.piEntryId));
});
check('result entries are saved with their IDs', () => {
  assert.ok(after.effects.every(e => after.checkpoint.fileEntries.some(entry => entry.id === e.piEntryId)));
});
check('completed continuation is terminal without another inference', () => {
  assert.equal(repeated.status, 'terminal');
  assert.equal(repeated.providerCalls, 0);
});
const followDir = seed('follow-ups', 'prepared', [
  { commandId: 'cmd-1', text: 'same text' },
  { commandId: 'cmd-2', text: 'same text' },
]);
recover(followDir); recover(followDir);
const follow = loadJournal(followDir);
check('consumed follow-ups have durable matching user entries', () => {
  assert.equal(follow.checkpoint.fileEntries.filter(e =>
    e.type === 'message' && e.message.role === 'user' && e.message.content === 'same text',
  ).length, follow.consumedCommandIds.length);
});
const unicode = checkpoint();
unicode.extensionState = { pad: '' };
unicode.extensionState.pad = '界'.repeat(FIXTURE_LIMITS.maxBytes - JSON.stringify(unicode).length);
const text = JSON.stringify(unicode);
assert.ok(Buffer.byteLength(text) > FIXTURE_LIMITS.maxBytes);
check('UTF-8 byte limit rejects oversized checkpoints', () => {
  assert.throws(() => parseAndValidateCheckpoint(text));
});
const malformed = checkpoint();
malformed.fileEntries.find(e => e.id === 'ent-a1').message.content = [{ type: 'toolCall' }];
check('malformed tool calls rejected before import', () => assert.throws(() => validateCheckpoint(malformed)));
const forward = checkpoint();
forward.fileEntries.find(e => e.id === 'ent-comp').firstKeptEntryId = 'ent-a3';
check('forward compaction references rejected', () => assert.throws(() => validateCheckpoint(forward)));
const settings = checkpoint();
settings.settings.compaction = { enabled: true, reserveTokens: 1234, keepRecentTokens: 5678 };
check('supported compaction settings restored exactly', () => {
  const restored = restoreValidatedCheckpoint(validateCheckpoint(settings), root);
  assert.deepEqual(restored.settingsManager.getCompactionSettings(), settings.settings.compaction);
});
const ioDir = path.join(root, 'write-failure');
fs.mkdirSync(path.join(ioDir, 'journal.json'), { recursive: true });
assert.throws(() => saveJournal(ioDir, after));
check('real persistence error latches admission closed', () => assert.equal(isLatched(ioDir), true));
console.log(`${failures} rejected guarantees; synthetic fixtures: ${root}`);
process.exitCode = failures ? 1 : 0;
```
<!-- advisor-001-probe:end -->

## Original code baseline and exact SDK seams

At the original refinement baseline, runner Pi AI and coding-agent were pinned to `0.80.10`, and `packages/session-brain` and `apps/runtime` were not yet tracked. The brain and runtime packages are now tracked; runner and brain pin `0.85.1`. The original `packages/sandbox-runner/src/run-agent.ts:85-90` reference described opening a local session file and using in-memory settings with auto-compaction and one-at-a-time follow-ups. That was evidence of legacy execution, not the new recovery design.

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

## Original files and deliverables

The following whitelist records the completed local implementation scope, not a request to recreate these packages. Historical source anchors in this section and the original steps below have not been refreshed for later-phase changes.

Permitted executor changes at that time:

- `packages/sandbox-runner/package.json`, `package-lock.json`; `src/run-git-metadata.ts` only for the two loader methods; corresponding assertions in `src/run-git-metadata.test.ts`; matching loader methods in `src/run-agent.test.ts`'s fake loader.
- Independent npm `packages/session-brain/package.json`, `package-lock.json`, `tsconfig.json`; `src/main.ts`, `pi-feasibility.test.ts`, `pi-restoration.test.ts`, `restoration-child.ts`; new `src/pi-recovery.ts` and `src/pi-recovery.test.ts` for the bounded adapter and its process-boundary tests. Extend the existing child command fixture rather than creating an unrelated test framework.
- Root `package.json` for `brain:verify`; later `runtime:verify` when that package actually exists.
- `plans/001-feasibility.md` for evidence and the exact tested recipe; `plans/README.md` for status and handoff. After all local 001 gates pass, version/restore-recipe-only corrections to `plans/002-contracts-and-identity.md` and `plans/006-trusted-pi-continuation.md` are permitted to make the handoff consistent. Do not change their requirements or implement those phases. No separate report directory.

Only after the Pi gates pass: `packages/session-brain/Dockerfile`; `apps/runtime/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/feasibility.test.ts`, `src/server.ts`, `types/env.d.ts`; required pnpm lock update and a verified local-only mode in `alchemy.run.ts`. Root `Dockerfile`, existing Alchemy graph, `.github/workflows/ci.yml`, web package/server/environment types and installed Container/Sandbox code are inputs. Do not change production bindings or add another deployment command.

Out of scope: product routes/UI, D1 migrations, actual runtime journal/crypto services, production network/credential policy, legacy execution removal, historical-session migration, and implementation of phases 002-012. Other runner API failures beyond the named loader change require reporting a new compatibility finding before expanding scope.

## Original ordered work and gates

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

The version/import handoff is complete. Plans 002 and 006 carry the proved Pi `0.85.1` import/recovery recipe; 002 is accepted and 006 remains blocked on 005, not on selecting a recipe. The reconciliation at `a5c1185` also corrects the stale 0.80.10 instructions in 011/012. Preserve historical 0.80.10 experiment results as history, never as an instruction to downgrade.

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
