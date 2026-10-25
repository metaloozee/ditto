# 025: Compose execution, recovery and Git actions for candidate sessions

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. On a STOP condition, stop and report; do not improvise. Do not stage or commit. A reviewer maintains `plans/README.md`; do not edit it or this file. No deployment, no `alchemy deploy`, no `alchemy dev`, no Cloudflare API call, no live provider request and no data reset is authorized by this plan.
>
> **Drift check (run first)**: `git diff --stat 36ae7b4..HEAD -- apps/runtime/src apps/web/src/lib/session-command-candidate.ts packages/runtime-contracts/src packages/sandbox-runner/src Dockerfile alchemy.run.ts`. If any of these changed, compare the excerpts below against live code. A mismatch is a STOP condition.

## Status

- **Status**: DONE with limits (reviewed 2026-10-25; see `plans/README.md`). The executor's first run stopped correctly on `readFileStream` (SSE, not raw bytes) and on the hooks lacking a scope; both are corrected in Steps 1, 2 and 4 below
- **Priority**: P1 (019 is blocked on it; README open decision 5)
- **Effort**: L
- **Risk**: HIGH (first composition that gives a candidate session a real sandbox and a real artifact store)
- **Depends on**: 011 to 018, 021, 022 (all DONE). Not on 023, 024 or 026
- **Category**: composition / L6 prerequisite
- **Spec**: `docs/specs/pi-durable-session-runtime.md`: one runtime DO and one execution sandbox per workspace session, paired checkpoints, capacity; PD20 to PD25, PD28 to PD31
- **Planned at**: commit `36ae7b4`, 2026-10-25 (first draft `0f9c7c1`, 2026-10-24)

## Why this matters

`PiDurableProductSession` (`apps/runtime/src/pi-durable-product-session.ts`) is the product's candidate session Durable Object. Its three composition hooks return `undefined`:

```ts
// apps/runtime/src/pi-durable-product-session.ts:131-146
	/** Deployment composition supplies the session's sandbox; none means tools fail before admission. */
	protected remoteExecutor(): RemoteExecutor | undefined {
		return undefined;
	}
	/** Deployment composition supplies paired restore with the session's execution and store. */
	protected checkpointRestorer(
		_port: CheckpointHostPort,
	): CheckpointRestorer | undefined {
		return undefined;
	}
	/** Deployment composition supplies UI Git and preview; none answers every action unavailable. */
	protected workspaceController(
		_port: WorkspaceHostPort,
	): WorkspaceController | undefined {
		return undefined;
	}
```

`open()` (same file, lines 221-245) passes `checkpoints` only when `remoteExecutor()` is defined, and never passes `checkpoints.store`, so retention never runs either. As a result a candidate session fails every tool before admission, cannot publish or restore a pair, and answers every Git action `unavailable`. Every module from 009 to 017 is proved only in fixtures that compose `PiDurableHost` directly (`apps/runtime/src/pi-durable-checkpoint.fixture.ts`). 019 cannot retire the Node engine while that is true.

## Decisions (maintainer, 2026-10-25)

1. **Disposable gate stays.** `scope()` and `passiveScope()` keep refusing unless `CANDIDATE_DISPOSABLE === "008-synthetic"` (`pi-durable-product-session.ts:149`, `:202`). Do not touch those lines.
2. **One sandbox per workspace session**, obtained with `getSandbox(namespace, workspaceSessionId)` from `@cloudflare/sandbox`. Never the legacy per-project sandbox.
3. **Brokered fetch and push stay unavailable.** `sandboxArtifactExecution(...).fetchBranch` keeps throwing. Pass no `branch` to the restorer's publisher.
4. **Preview is not composed.** `previewStart` and `previewStop` in the new `WorkspaceExecution` adapter throw `ArtifactStepRejected("authority_denied", "Preview is not composed for this session", true)`. Preview waits for 024 and its build plan.
5. **No new claim port.** The product already takes the 015 `executor` claim before it delivers any command. The runtime refuses effects unless authority reports exactly one live executor. See "Capacity is already enforced" below. Do not add methods to `CandidatePrivateProduct`.
6. **No product seed handoff in this plan.** No product path hands a seed `ArchiveArtifactV1` to the session today (see "Seed gap" below). Tests establish the baseline by calling the publisher directly, the way existing tests do. The product handoff is a separate follow-up plan (029).

## Current state

### Adapters that exist and are tested in isolation

| Port | Adapter | Location |
|---|---|---|
| `RemoteExecutor` | `sandboxExecutor(sandbox: SandboxProcess, { workspaceSessionId })` | `apps/runtime/src/pi-durable-tools.ts:403-418` |
| `ArtifactExecution` | `sandboxArtifactExecution(sandbox: ArtifactSandbox, now)` | `apps/runtime/src/pi-durable-artifacts.ts:895` |
| `ArtifactStore` | `r2ArtifactStore(bucket: R2Bucket)` | `apps/runtime/src/pi-durable-artifacts.ts:964` |
| Publisher / restorer | `createCheckpointPublisher({ storage, host, binding, execution, store, branch?, writers?, now })` | `apps/runtime/src/pi-durable-checkpoints.ts:548` |
| `WorkspaceController` | `createWorkspaceController({ storage, host, execution, publisher, branch, now })` | `apps/runtime/src/pi-durable-workspace.ts:75` |
| `WorkspaceExecution` | **none** (only `fakeWorkspace` in the checkpoint fixture) | interface at `apps/runtime/src/pi-durable-workspace.ts:32-51` |

The two sandbox shapes the adapters expect:

```ts
// apps/runtime/src/pi-durable-tools.ts:403-409
export type SandboxProcess = {
	writeFile(path: string, content: string): Promise<unknown>;
	exec(
		command: string,
		options?: { signal?: AbortSignal; env?: Record<string, string> },
	): Promise<{ exitCode: number; stdout: string }>;
};

// apps/runtime/src/pi-durable-artifacts.ts:838-845
export type ArtifactSandbox = {
	exec(
		command: string,
		options: { timeout: number },
	): Promise<{ exitCode: number; stdout: string }>;
	readStream(path: string): Promise<ReadableStream<Uint8Array>>;
	writeStream(path: string, body: ReadableStream<Uint8Array>): Promise<void>;
};
```

`@cloudflare/sandbox` 0.12.3 has no `readStream`/`writeStream`. Do **not** use `readFileStream`: it returns SSE events, not raw bytes (executor finding, 2026-10-25). Use the convention the product already relies on instead. Production sets `SANDBOX_TRANSPORT: "rpc"` (`alchemy.run.ts:172`), and the local fixture calls `getSandbox(ns, id, { transport: "rpc" })` (`apps/runtime/src/pi-durable-local.ts:230-233`). On the rpc transport, `readFile(path, { encoding: "none" })` returns a result whose `content` is a raw `ReadableStream<Uint8Array>` (`.d.ts:860-870`). The legacy archive path reads it that way (`apps/web/src/lib/sandbox-archive.ts:387-404`, `:687`) and writes with `writeFile(path, stream)` (`:765`). The bridge is a few lines and counts as wiring, not a contract change.

### The `WorkspaceExecution` port to implement

```ts
// apps/runtime/src/pi-durable-workspace.ts:32-51
export interface WorkspaceExecution {
	/** Whether the execution workspace holds a checkout at all. */
	present(permit: ArtifactPermit): Promise<boolean>;
	gitStatus(
		permit: ArtifactPermit,
		request: { branch: string },
	): Promise<{ branch: string; head: string; changed: number }>;
	/** Credential-free, hooks disabled, owned branch only, secret preflight. */
	gitCommit(
		permit: ArtifactPermit,
		request: { branch: string; message: string },
	): Promise<{ head: string; committed: boolean }>;
	previewStart(permit: ArtifactPermit, request: { port: number }): Promise<void>;
	/** `terminated` is evidence the process and its children are gone. */
	previewStop(permit: ArtifactPermit): Promise<{ terminated: boolean }>;
}
```

The controller's `step()` (`pi-durable-workspace.ts:177-213`) maps a thrown `ArtifactStepRejected` to `{ status: "rejected", reason }` and leaves state unchanged. That is why decision 4 throws it from the preview methods. `stopPreview` never calls the adapter when preview state is `stopped`, which is the initial state.

`gitCommit` must reproduce the legacy safety rules from `apps/web/src/lib/session-git.ts:565-645` (`commitSessionChangesUnlocked`). Read that function in full:
- `git status --porcelain=v1 -z -uall`. If no entries, `committed: false`.
- Fail closed if a secret-like path is already staged. A path is secret-like when its basename is `.env` or starts with `.env.` (`isSecretLikeGitPath`, `apps/web/src/lib/git-secret-policy.ts:32-36`).
- Stage only explicit safe paths, never `git add -A`. A rename or copy that involves a secret-like path stages neither side.
- Re-read `git diff --cached --name-only -z` and refuse if any staged path is secret-like.
- Commit with author `Ditto <ditto@users.noreply.github.com>` (`apps/web/src/lib/ditto-git-identity.ts:1-2`).

The runtime's existing read-only Git prefix, which disables hooks and config:

```ts
// apps/runtime/src/pi-durable-artifacts.ts:835-836
/** Read-only Git with no repository hooks, config includes or helpers. */
const CLOSED_GIT = `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/nonexistent GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 git -c core.hooksPath=/dev/null -c core.fsmonitor=false -C ${WORKSPACE_PATH}`;
```

### Capacity is already enforced (decision 5)

The product claims the session's executor slot before it delivers a command, and before it forwards `preview_start`:

```ts
// apps/web/src/lib/session-command-candidate.ts:957-975 (executorAdmitted)
		if (row.kind === "stop" || row.kind === "cancel") return true;
		const owner = executorOwnerKey(row.identityId, row.incarnationId);
		if (await this.capacity.live("executor", owner)) return true;
		...
		const claim = await this.capacity.acquire("executor", owner, row.userId);
```

The claim is released only by `candidate-lifecycle.ts:424-436` after `terminateExecutor` proves termination. The runtime host refuses effects unless `authority.liveExecutors === 1` (`pi-durable-host.ts:1277`, `:1879`, and others). This plan therefore adds no claim code. It must not create a sandbox outside `remoteExecutor()`, the restorer and the workspace controller, because those are the only paths reached after admission.

### Seed gap (decision 6)

`establishBaseline({ seed: ArchiveArtifactV1, branch })` (`pi-durable-checkpoints.ts:900`) is called only from tests (`pi-durable-checkpoints.test.ts:63`, `pi-durable-restore.test.ts:293`, `pi-durable-retention.test.ts:236`, `pi-durable-lifecycle.test.ts:22`). The product seed is written by the web worker to `BACKUP_BUCKET` as a legacy `archives` row (`apps/web/src/lib/project-seed.ts:394-410`). No runtime store holds it as an `ArchiveArtifactV1`. Do not try to bridge this.

### Reference composition

`apps/runtime/src/pi-durable-checkpoint.fixture.ts:395-465` composes the same pieces around fakes: one publisher for the restorer, one publisher plus controller for the workspace, `writers` taken from the controller and given to both publishers, and `store` exposed for retention. Read it in full before Step 4; the production composition must have the same shape.

## Scope

**In scope (create or modify only these):**
- `apps/runtime/src/pi-durable-execution.ts` (new): `composeCandidateExecution(...)` plus `sandboxWorkspaceExecution(...)` and the stream bridge.
- `apps/runtime/src/pi-durable-execution-session.ts` (new): `PiDurableExecutionSession extends PiDurableProductSession`.
- `apps/runtime/src/pi-durable-product-session.ts`: only (a) a new no-op hook `protected prepareExecution(_scope: CandidateRuntimeScope, _keyring: <keyring type>): void {}`, called in `open()` right after `const keyring = await this.keyring();`, and (b) a new `protected recoveryStore(): ArtifactStore | undefined { return undefined; }` hook passed as `checkpoints.store` in `open()`. Nothing else. `keyring()` stays private.
- `apps/runtime/src/pi-durable-execution.test.ts` (new).
- `packages/sandbox-runner/src/workspace-git.ts`, `packages/sandbox-runner/src/workspace-cli.ts`, `packages/sandbox-runner/src/workspace-git.test.ts` (new).
- `packages/sandbox-runner/package.json`: one `bin` entry `"ditto-workspace": "./dist/workspace-cli.js"`.
- `Dockerfile`: `test -s dist/workspace-cli.js`, add it to `chmod +x`, and `ln -sf /opt/ditto-runner/dist/workspace-cli.js /usr/local/bin/ditto-workspace`.
- `plans/evidence/025-execution-composition.md` and `plans/evidence/artifacts/025/docker-workspace.sh` (new).

**Out of scope (do not touch):** `alchemy.run.ts`; the disposable gate lines; `packages/runtime-contracts`; `apps/web` (read only, for parity); `CandidatePrivateProduct`; `pi-durable-checkpoint.fixture.ts`; brokered fetch, push, preview; the seed handoff; `plans/README.md` and this file. A local Alchemy binding was in the first draft; it was removed because nothing in this plan's gates would exercise it.

## Steps

### 1. Confirm the seams

Read `pi-durable-product-session.ts` in full, `PiDurableHost.open` and its `checkpoints` dependency type in `pi-durable-host.ts`, the fixture composition above, `createCheckpointPublisher`, `createWorkspaceController`, `sandboxExecutor`, `sandboxArtifactExecution`, `r2ArtifactStore`, and the `Sandbox` class in the `@cloudflare/sandbox` 0.12.3 `.d.ts`. Confirm:
- the SDK's `exec(command, options)` accepts `{ timeout }`, `{ env }` and `{ signal }`, and returns `exitCode` and `stdout` (confirmed by the first executor run);
- `getSandbox(ns, id, { transport: "rpc" })` is accepted by the 0.12.3 types, and `readFile(path, { encoding: "none" })` is typed to return an object with `content: ReadableStream<Uint8Array>` (`.d.ts:860-870`, `:1152-1155`).

Record each answer in the evidence file. **STOP** if either is false.

Verify: `pnpm --filter @ditto/runtime typecheck` exits 0 before any change (baseline).

### 2. Add the two base-class hooks

The existing hooks take no scope, and `open(scope)` is private. Add, next to the other hooks and in the same style:

```ts
	/** Deployment composition binds the session's execution to its validated scope before the hooks run. */
	protected prepareExecution(
		_scope: CandidateRuntimeScope,
		_keyring: <the type `this.keyring()` resolves to>,
	): void {}
	/** Deployment composition supplies the recovery store; none disables retention. */
	protected recoveryStore(): ArtifactStore | undefined {
		return undefined;
	}
```

In `open()`, call `this.prepareExecution(scope, keyring);` on the line right after `const keyring = await this.keyring();`, before `const executes = ...`. Also add `store: this.recoveryStore(),` inside the `checkpoints` object. If the `checkpoints` type rejects `store: undefined` under `exactOptionalPropertyTypes`, spread it conditionally instead. Change nothing else in this file.

Verify: `pnpm --filter @ditto/runtime typecheck` exits 0. `pnpm credentials:verify` exits 0 (the credential fixture subclasses this class). The known WSL storage flake in combined `credentials:verify` is acceptable only if each part passes alone; record it.

### 3. Runner: `ditto-workspace` CLI

Follow `packages/sandbox-runner/src/archive-cli.ts` as the exemplar: a fixed workspace path, a testable `main(argv)` that does not auto-run on import, JSON on stdout, and `execFileSync` with argument arrays (never a shell string).

`workspace-git.ts` exports pure helpers plus `status` and `commit`, run against `/workspace` with Git invoked as `git` plus `-c core.hooksPath=/dev/null -c core.fsmonitor=false -C /workspace` and the environment `{ PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" }`, matching `CLOSED_GIT`. Take the workspace path as a parameter so tests can use a temp repo.
- `status --branch <b>`: refuse unless `git symbolic-ref --short HEAD` equals `<b>`. Print `{"ok":true,"branch","head","changed"}`, where `changed` counts `git status --porcelain=v1 -z -uall` entries.
- `commit --branch <b> --message-file <path>`: refuse on branch mismatch. Read the message from the file (the runtime writes it with `writeFile`, so the message never reaches a shell). Apply the legacy rules listed under Current state exactly. Commit with `-c user.name=Ditto -c user.email=ditto@users.noreply.github.com`. Print `{"ok":true,"committed":boolean,"head"}`. On refusal print `{"ok":false,"error":"<code>"}` with codes `branch_mismatch`, `secret_path`, `git_failed`, `invalid_args`.
- Validate `<b>` with `git check-ref-format --branch`.

`workspace-git.test.ts` (vitest, temp Git repos; follow `archive.test.ts` for temp-dir setup) must assert: clean status; changed count; branch mismatch refused for both subcommands; commit of a normal file returns `committed: true` and a new head; nothing to commit returns `committed: false`; an untracked `.env` is not committed while a sibling file is; a pre-staged `.env.local` refuses with `secret_path` and leaves HEAD unchanged; a `pre-commit` hook in `.git/hooks` that writes a marker file does not run; a message containing `'; touch /tmp/x #` is committed verbatim and creates no file.

Verify: `npm test --prefix packages/sandbox-runner -- workspace-git.test.ts` passes. Then `pnpm runner:verify` exits 0.

### 4. Runtime: adapters and composition

In `apps/runtime/src/pi-durable-execution.ts`:

- `sandboxStreams(sandbox)` turns an rpc-transport SDK sandbox into `ArtifactSandbox`. `readStream` calls `sandbox.readFile(p, { encoding: "none" })` and returns its `content` stream. If `content` is not a `ReadableStream`, it throws `ArtifactStepRejected("execution_failed", "Sandbox readFile did not return a binary stream")`. `writeStream` is `async (p, body) => { await sandbox.writeFile(p, body); }`. `exec` passes through.
- `sandboxWorkspaceExecution(sandbox, now): WorkspaceExecution`:
  - `present`: `CLOSED_GIT rev-parse --is-inside-work-tree` exit 0. Export `CLOSED_GIT` from `pi-durable-artifacts.ts` if needed. That is the only change allowed in that file; list it in NOTES.
  - `gitStatus`: `ditto-workspace status --branch <quoted>` and parse strictly.
  - `gitCommit`: `writeFile` the message to a fixed path under `/tmp`, then `ditto-workspace commit --branch <quoted> --message-file <path>`, then remove the file. Map `ok:false` to `ArtifactStepRejected("execution_failed", code)`. Use whatever existing `ArtifactStepRejected` reason fits `secret_path`; if none does, use `execution_failed`.
  - Every call passes `{ timeout: Math.max(1, permit.deadlineAt - now()) }`, as `sandboxArtifactExecution` does.
  - `previewStart` and `previewStop` throw as decision 4 says.
- `composeCandidateExecution({ storage, binding, sandbox, bucket, branch, now })` returns `{ executor, restorer(port), workspace(port), store }`, with the fixture's shape: one `createCheckpointPublisher` for the restorer (no `branch` option), a second publisher plus `createWorkspaceController` for the workspace, the controller's `writers` given to both publishers, and `store = r2ArtifactStore(bucket)`. `executor` is `sandboxExecutor(sandbox, { workspaceSessionId: binding.workspaceSessionId })`. Build everything lazily once per call, the same way the fixture closes over `controller`.

Branch name: `CandidateRuntimeScope` (`userId`, `projectId`, `workspaceSessionId`, `ownerVersion`) carries no branch. New synthetic sessions insert `workspace_sessions` without `branchName` (`apps/web/src/lib/session-command-candidate.ts:461`). The legacy rule `sessionBranchName` lives in `apps/web/src/lib/workspace-policy.ts:18` and must not be copied or imported into the runtime. The branch arrives with the seed in 029. So `composeCandidateExecution` takes `branch: string | undefined`. When it is `undefined`, `workspace(port)` returns `undefined`, so Git actions stay `unavailable`, and the executor, restorer and store are still composed. Tests pass an explicit branch, as `pi-durable-workspace-actions.test.ts` does (`branch: "b"`).

In `apps/runtime/src/pi-durable-execution-session.ts`: `PiDurableExecutionSession extends PiDurableProductSession` with bindings `CandidateSessionBindings & { CandidateSandbox?: DurableObjectNamespace<Sandbox>; CANDIDATE_RECOVERY?: R2Bucket }` (optional, so the credential fixture keeps compiling). Add `protected sessionBranch(): string | undefined { return undefined; }` in the subclass (029 replaces it). The subclass overrides `prepareExecution(scope, keyring)`. When both bindings exist, the override stores, in a private field, one fresh `composeCandidateExecution` result built with `getSandbox(this.env.CandidateSandbox, scope.workspaceSessionId, { transport: "rpc" })`, `binding: { ownerId: scope.userId, workspaceSessionId: scope.workspaceSessionId, keyring }`, `branch: this.sessionBranch()` and `bucket: this.env.CANDIDATE_RECOVERY`. When either binding is missing, it stores `undefined`. The four hooks read from that field and return `undefined` when it is unset. Do not override `activate` or any public method.

Verify: `pnpm --filter @ditto/runtime typecheck` exits 0.

### 5. Tests

`apps/runtime/src/pi-durable-execution.test.ts` composes `PiDurableHost` through `composeCandidateExecution` the way `pi-durable-checkpoint.fixture.ts` does: the `PI_HOST_STORAGE` DO, the real miniflare `RECOVERY_ARTIFACTS` R2 binding as `bucket`, and a scripted sandbox stub. The stub keeps one in-memory workspace blob. Its `node ... archive-cli.js create` returns the real sha256 of the blob. `readFile(path, { encoding: "none" })` serves the blob as `{ content }`, `writeFile(stream)` stores it, and `restore` succeeds only when `--expected-sha256` matches. `ditto-exec` and `ditto-workspace` return scripted JSON. Assert:
1. No tool reaches the stub before a baseline exists.
2. After `publisher.establishBaseline({ seed, branch })`, with a seed written to `RECOVERY_ARTIFACTS` via the fixture's `seed(store)` helper or an equivalent, a tool dispatch reaches the stub's `ditto-exec`.
3. A publish writes objects to `RECOVERY_ARTIFACTS` (list the bucket), and a restore reads them back through the same store and runs `restore` with the published digest.
4. `git_status` and `git_commit` actions return `git_status` and `committed` results from the stub's output, and the commit message reaches the stub only through `writeFile`, never in an `exec` command string.
5. `preview_start` returns `{ status: "rejected" }` and the stub sees no preview command.
6. Retention deletes an orphaned object from `RECOVERY_ARTIFACTS` after its period. Copy the time-advance pattern from `pi-durable-retention.test.ts`.

Do not raise deadlines, add retries or skip anything. Verify: `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-execution.test.ts` passes.

### 6. Docker script

Write `plans/evidence/artifacts/025/docker-workspace.sh`, modelled on `plans/evidence/artifacts/009/docker-tool-exec.sh`. It takes an image built from the repository `Dockerfile`, runs with `--network none`, initializes `/workspace` on a branch, and runs `ditto-workspace status` and `commit`, including the `.env` and hook cases. Run it only if `docker version` succeeds. Otherwise record Docker as `not run`.

## Checks

```sh
pnpm --filter @ditto/runtime exec vitest run src/pi-durable-execution.test.ts
pnpm --filter @ditto/runtime exec vitest run src/pi-durable-checkpoints.test.ts src/pi-durable-restore.test.ts src/pi-durable-workspace-actions.test.ts src/pi-durable-retention.test.ts src/pi-durable-tools.test.ts
pnpm runtime:verify
pnpm credentials:verify
pnpm typecheck
pnpm check
pnpm runner:verify
git diff 36ae7b4 -- apps/runtime/src/pi-durable-product-session.ts | grep -c 008-synthetic   # expect 0
```

Expected: exit 0 for each. The known `runtime:verify` conformance timeout ("streams long document tails", owned by 026) may appear once; record it and do not count it as new. Docker is `not run` when unavailable. Record that as a limit; it does not block the rest.

Write results to `plans/evidence/025-execution-composition.md` in the format given in `plans/README.md` under "Evidence format": base commit, versions, commands, exit results, test names, `passed`/`failed`/`not run` per check, and limits.

## Stop conditions

- Any change needed in `packages/runtime-contracts`, `CandidatePrivateProduct`, `alchemy.run.ts` or `apps/web`.
- The SDK sandbox cannot satisfy `SandboxProcess` or `ArtifactSandbox` with the two-line bridge (Step 1).
- The `prepareExecution` hook is not enough to give the hooks the scope and keyring, and a larger change to `open()` would be needed (Step 4).
- Any change would lift the disposable gate, enable push, brokered fetch or preview.
- A test needs a raised deadline, a skip or a retry to pass.

## Done

- `PiDurableExecutionSession` supplies executor, restorer, workspace controller and recovery store when its two bindings are present, and behaves exactly as the base class when they are absent.
- The six test assertions in Step 5 pass against the real miniflare R2 binding.
- `ditto-workspace` passes its runner tests, is linked in the `Dockerfile`, and (if Docker is available) passes the Docker script.
- The disposable gate, `alchemy.run.ts` and the contracts are unchanged.

## Not done by this plan (follow-ups)

- **029 seed and branch handoff**: deliver the project seed to the session as a verified `ArchiveArtifactV1` in the runtime store, together with the session's owned branch, and call `establishBaseline` from a product path. Until then no product session reaches its baseline, so tools still do not run in the product, and `sessionBranch()` returns `undefined`, so product Git actions stay `unavailable`. Review finding: `establishBaseline` also needs a branch authority, because `syncBranch` refuses without one (`pi-durable-artifacts.ts:772-773`). 029 must either compose brokered fetch or define a seed-only baseline for a freshly seeded branch.
- **Bindings**: binding `PiDurableExecutionSession`, a candidate Sandbox namespace and a recovery bucket in `alchemy.run.ts`, together with a local gate that exercises them.
- **Preview**: after 024.
- **terminateExecutor**: no production runtime implements `CandidateLifecycleRuntime.terminateExecutor` yet. It must destroy `getSandbox(ns, workspaceSessionId)`, mapping the identity row's `workspaceSessionId` (the D1 `sandboxId` column holds the identity id, not the session id).

## Maintenance

`pi-durable-checkpoint.fixture.ts` and `composeCandidateExecution` now duplicate the wiring shape. A later change should make the fixture call `composeCandidateExecution` with fakes. `liveExecutors` counts every ready candidate identity globally (`session-command-candidate.ts:196`), so only one candidate executor can run at a time. That is the 015 multi-workspace limit, unchanged here. Keep `fetchBranch` unavailable until a brokered Git plan exists.
