# Plan 032: Candidate preview start and stop return a revocable URL from the runtime

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f554a6b..HEAD -- packages/runtime-contracts/src/workspace-action.ts apps/runtime/src/pi-durable-workspace.ts apps/runtime/src/pi-durable-execution.ts apps/runtime/src/pi-durable-execution-session.ts apps/runtime/src/pi-durable-product-session.ts apps/runtime/src/pi-durable-host.ts apps/runtime/src/pi-durable-checkpoint.fixture.ts apps/runtime/src/pi-durable-execution.test.ts apps/runtime/src/pi-durable-workspace-actions.test.ts apps/runtime/src/pi-durable-lifecycle.test.ts`
> `pi-durable-host.ts` is about 7,500 lines and may have unrelated changes. Check only that `previewAuthority`/`previewTraffic` still match the excerpt below. For every other file, any change since `f554a6b` means you must compare the excerpts; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED (touches the workspace controller's preview state machine; the existing workspace-action tests guard it)
- **Depends on**: `plans/031-candidate-preview-cli.md` for the CLI subcommand names. You can execute this plan before 031 lands, because every test here uses a scripted sandbox.
- **Category**: direction (build, from `plans/decisions/024-candidate-preview-delivery.md`)
- **Planned at**: commit `f554a6b`, 2026-10-29

## Why this matters

Candidate sessions (the "Pi Durable" runtime: one Durable Object per workspace session, plus a dedicated execution sandbox) can already run UI Git actions. Preview, however, is a stub that always throws "Preview is not composed for this session". The preview pane needs a URL, so the runtime must:
- start the dev server on port 10000;
- expose the port through the Cloudflare Sandbox SDK;
- return the URL;
- make every old URL stop working on stop, restart, backup-deadline stop, archive and project deletion.

The maintainer approved the design in `plans/decisions/024-candidate-preview-delivery.md`. This plan builds the runtime half. Plan 033 builds the product (web) half. Deployment wiring is deliberately not planned yet.

## The design, in brief (decided; do not re-litigate)

1. **Minting.** The runtime calls the SDK's `exposePort(10000, { hostname, token })` on the session's own sandbox, which returns `http(s)://10000-<sandboxName>-<token>.<hostname>/`.
   - The runtime makes a **fresh random 16-character `[a-z0-9]` token on every start** (about 82.7 bits, the same strength as the SDK default).
   - It passes the token explicitly, so rotation does not depend on `unexposePort` succeeding: the SDK would otherwise reuse a surviving token for the same port.
   - This refines decision 024, which kept the SDK default. A token per start gives the same entropy and stronger rotation. The token never carries the generation.
2. **Sandbox name.** It is `c-<workspaceSessionId>` (today it is the bare `workspaceSessionId`). The `c-` prefix lets the product tell candidate preview hosts from legacy ones on the shared `ayn.wtf` zone.
3. **Grant.** The runtime stores only `SHA-256(token)` (lowercase hex), together with the preview generation, in a new runtime-DO SQLite table `workspace_preview_grant`. Never store the raw token or URL anywhere: no SQLite, no KV, no logs, no error messages.
4. **Admission.** A preview request is admitted only if the host is live in memory, the preview is `running`, the grant's generation equals the running generation, and the digest matches. A cold DO never opens a host for a preview request.
5. **Revocation order.** Stop calls `unexposePort` first, then kills the process. Start also calls `unexposePort` first, so a stale exposure never forwards while the new process starts. Project deletion calls `unexposePort` after the host has closed (so no alarm can re-expose) and before deleting storage.
6. **Contract.** `preview_running` gains `url: string`. A repeated `preview_start` while running returns the same URL by reading `getExposedPorts`, without rotating the token.

## Current state

Files and roles:
- `packages/runtime-contracts/src/workspace-action.ts`: the shared action/result types. Line 75: `| { status: "preview_running"; generation: number }`. `WORKSPACE_PREVIEW_PORT = 10_000` at `:28`.
- `apps/runtime/src/pi-durable-workspace.ts`: `WorkspaceExecution` interface (`:31-51`) and `createWorkspaceController` (preview state machine).
- `apps/runtime/src/pi-durable-execution.ts`: `ExecutionSandbox` type (`:25-43`), `sandboxWorkspaceExecution` (`:100-167`, preview stubs at `:159-164`), `composeCandidateExecution` (`:169-236`).
- `apps/runtime/src/pi-durable-execution-session.ts`: `PiDurableExecutionSession`, which composes execution when `CandidateSandbox` and `CANDIDATE_RECOVERY` are bound (`prepareExecution` at `:103-136`, `getSandbox(CandidateSandbox, scope.workspaceSessionId, { transport: "rpc" })` at `:116-118`).
- `apps/runtime/src/pi-durable-product-session.ts`: base DO class `PiDurableProductSession`. `protected host` field (`:148`), hook methods with no-op defaults (`:154-185`), `purgeDeleted` (`:478-486`).
- `apps/runtime/src/pi-durable-host.ts:7165-7175`: host preview methods.
- `apps/runtime/src/pi-durable-checkpoint.fixture.ts:232-296`: `fakeWorkspace`, the test double for `WorkspaceExecution`.

Excerpts:

```ts
// pi-durable-workspace.ts:44-50
	/** The executor discovers the fixed preview command; the caller supplies none. */
	previewStart(
		permit: ArtifactPermit,
		request: { port: number },
	): Promise<void>;
	/** `terminated` is evidence the process and its children are gone. */
	previewStop(permit: ArtifactPermit): Promise<{ terminated: boolean }>;
```

```ts
// pi-durable-workspace.ts:89-96 (table setup inside createWorkspaceController)
	for (const statement of [
		"CREATE TABLE IF NOT EXISTS workspace_backup (...)",
		"INSERT OR IGNORE INTO workspace_backup VALUES (1, NULL, NULL)",
		"CREATE TABLE IF NOT EXISTS workspace_preview (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL CHECK (state IN ('stopped','running','unknown')), generation INTEGER NOT NULL, demand INTEGER NOT NULL CHECK (demand IN (0,1)), last_traffic INTEGER, stopped_for_backup INTEGER NOT NULL CHECK (stopped_for_backup IN (0,1)))",
		"INSERT OR IGNORE INTO workspace_preview VALUES (1, 'stopped', 0, 0, NULL, 0)",
	])
		sql.exec(statement);
```

```ts
// pi-durable-workspace.ts, startPreview — first idempotent return (:283-285)
		const current = preview();
		if (current.state === "running")
			return { status: "preview_running", generation: current.generation };
// second idempotent return, under the held scope (:337-339)
			const again = preview();
			if (again.state === "running")
				return { status: "preview_running", generation: again.generation };
// the start step and success flip (:340-353)
			const result = await step(scope, "preview_start", (permit) =>
				deps.execution.previewStart(permit, { port: WORKSPACE_PREVIEW_PORT }),
			);
			if (result.status === "unknown") {
				sql.exec("UPDATE workspace_preview SET state = 'unknown' WHERE id = 1");
				return result;
			}
			if (result.status === "rejected")
				return { status: "rejected", reason: result.reason };
			sql.exec(
				"UPDATE workspace_preview SET state = 'running', generation = generation + 1, demand = 0, stopped_for_backup = 0 WHERE id = 1",
			);
			return { status: "preview_running", generation: preview().generation };
```

```ts
// pi-durable-workspace.ts, stopPreview (:379-393)
			const result = await step(scope, "preview_stop", (permit) =>
				deps.execution.previewStop(permit),
			);
			await deps.fault?.("after-preview-stop");
			if (result.status === "ok" && result.value.terminated) {
				sql.exec(
					"UPDATE workspace_preview SET state = 'stopped', generation = generation + 1, stopped_for_backup = ?, demand = 0 WHERE id = 1",
					reason === "backup" ? 1 : 0,
				);
				return { status: "preview_stopped", generation: preview().generation };
			}
			if (result.status === "rejected")
				return { status: "rejected", reason: result.reason };
			sql.exec("UPDATE workspace_preview SET state = 'unknown' WHERE id = 1");
			return { status: "unknown" };
```

```ts
// pi-durable-workspace.ts, controller return object (:443-452)
		/** A stopped preview must not keep a URL; a running one checks its generation. */
		previewAuthority(value: number) {
			const row = preview();
			return row.state === "running" && row.generation === value;
		},
		traffic() {
			sql.exec("UPDATE workspace_preview SET last_traffic = ? WHERE id = 1", deps.now());
		},
```

```ts
// pi-durable-host.ts:7165-7175
	/** Product preview proxy: the URL's generation must still be running on a live, unfenced host. */
	previewAuthority(generation: number): boolean {
		if (this.sealed || this.denied || this.storageBarrier) return false;
		const workspace = this.workspace();
		if (!workspace || this.workspacePort().admission() !== "open") return false;
		return workspace.previewAuthority(generation);
	}

	previewTraffic() {
		this.workspace()?.traffic();
	}
```

```ts
// pi-durable-execution.ts:159-164 (inside sandboxWorkspaceExecution)
		async previewStart() {
			throw previewDenied();
		},
		async previewStop() {
			throw previewDenied();
		},
// :228 (inside composeCandidateExecution().workspace)
				execution: sandboxWorkspaceExecution(deps.sandbox, deps.now),
```

```ts
// pi-durable-product-session.ts:478-486
	async purgeDeleted(value: unknown) {
		const scope = await this.passiveScope(value);
		if (!(await this.env.CandidateProduct.readDeletionAuthority(scope)))
			throw new Error("Candidate deletion not fenced");
		await this.host?.yield().catch(() => undefined);
		await this.host?.awaitClosure().catch(() => undefined);
		this.host = undefined;
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.deleteAll();
	}
```

SDK facts (`@cloudflare/sandbox` 0.12.3, as used through `getSandbox(..., { transport: "rpc" })`):
- `exposePort(port, { hostname })` → `{ url, port, name }`. It reuses an existing token for the same port. `hostname` `localhost` or `localhost:<port>` yields `http://10000-<id>-<token>.localhost:<port>/`. Any other hostname yields `https://10000-<id>-<token>.<hostname>/`. It rejects `*.workers.dev`.
- `unexposePort(port)`: deletes the token in DO storage, idempotent, does not wake the container.
- `getExposedPorts(hostname)` → `{ url, port, status }[]` for currently forwardable ports.
- `startProcess(command, { processId, cwd, env, autoCleanup })`, `getProcess(id)` → `{ status, ... } | null`, `killProcess(id)` (may throw when the id is unknown). Process status is one of `starting | running | completed | failed | killed | error`. Use only the `status` field of returned process objects; do not call methods on them across RPC.
- Tokens match `[a-z0-9_]{1,16}`. The sandbox ID is everything between the first and last `-` of the first host label.

The image CLI (plan 031) provides `ditto-workspace preview command`, which prints `{"ok":true,"command":"...","cwd":"/workspace","env":{...}}` or `{"ok":false,"error":"unsupported_project"}`. It also provides `ditto-workspace preview ready --timeout-ms <n>` (n ≤ 120000), which prints `{"ok":true,"ready":true}` or `{"ok":false,"error":"not_ready"}`. The existing `parseWorkspaceCli` (`pi-durable-execution.ts:67-97`) parses both and throws `ArtifactStepRejected("execution_failed", ...)` on `ok:false`.

Conventions:
- Tabs and double quotes; Biome formats.
- JSDoc one-liners on exported functions and on interface members that carry a rule. Match `pi-durable-workspace.ts`.
- Errors that the controller should treat as "known failure, nothing changed" are `new ArtifactStepRejected(reason, message)`. Any other thrown error inside a mutation step makes the outcome `unknown` and blocks the workspace. Use that deliberately.
- Vocabulary (`CONTEXT.md`): "workspace session", "candidate session", "execution sandbox", "preview".

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install (fresh worktree) | `pnpm install` (never symlink `node_modules` from another checkout) | exit 0 |
| Runtime focused tests | `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-execution.test.ts src/pi-durable-workspace-actions.test.ts src/pi-durable-lifecycle.test.ts src/pi-durable-preview.test.ts src/pi-durable-preview-fetch.test.ts` | all pass |
| Runtime typecheck | `pnpm --filter @ditto/runtime typecheck` | exit 0 |
| Runtime full | `pnpm runtime:verify` | exit 0 |
| Contracts | `pnpm contracts:verify` | exit 0 |
| Credential tests typecheck | `pnpm --filter @ditto/credential-tests typecheck` | exit 0 |
| Web typecheck | `pnpm typecheck` | exit 0 |
| Lint/format | `pnpm check` | exit 0 |

Do not use `pnpm credentials:verify` as a gate. Its `product-commands` file has a known pre-existing timeout flake. Typecheck credential-tests instead.

## Scope

**In scope:**
- `packages/runtime-contracts/src/workspace-action.ts` (+ `workspace-action.test.ts` if it asserts result shapes)
- `apps/runtime/src/pi-durable-preview.ts` (create)
- `apps/runtime/src/pi-durable-preview.test.ts` (create)
- `apps/runtime/src/pi-durable-workspace.ts`
- `apps/runtime/src/pi-durable-execution.ts`
- `apps/runtime/src/pi-durable-execution-session.ts`
- `apps/runtime/src/pi-durable-product-session.ts`
- `apps/runtime/src/pi-durable-host.ts`: only add `previewAdmits` next to `previewAuthority`
- `apps/runtime/src/pi-durable-checkpoint.fixture.ts`
- `apps/runtime/src/pi-durable-execution.test.ts`, `pi-durable-workspace-actions.test.ts`, `pi-durable-lifecycle.test.ts`
- `apps/credential-tests/src/product-commands.worker.test.ts`: only add `url` to the fake `preview_running` result at about `:3378`, so it type-checks
- `apps/credential-tests/src/candidate-preview.worker.test.ts` (create)
- `apps/runtime/src/pi-durable-preview-fetch.ts` and `pi-durable-preview-fetch.test.ts` (create)

**Out of scope:**
- `alchemy.run.ts`, any Worker entry file, `apps/runtime/src/server.ts` (an older topology, not used by candidate sessions), `apps/runtime/src/pi-durable-local*.ts`. Mounting `candidatePreviewFetch` (from `pi-durable-preview-fetch.ts`) in a deployed or local Worker is the unplanned deployment-wiring track.
- Anything under `apps/web`. That is plan 033.
- `packages/sandbox-runner`. That is plan 031.
- D1 schema and migrations. Nothing here touches D1.
- `previewAuthority(generation)`: keep it unchanged. Existing tests use it.

## Git workflow

- Commit on your current branch, one commit per step group. Don't push.
- Message style: `feat(runtime): return candidate preview URL`, `feat(contracts): carry preview url`.

## Steps

### Step 1: Contract

In `workspace-action.ts`, change the union member to `| { status: "preview_running"; generation: number; url: string }`. Add a one-line JSDoc: `/** \`url\` is a bearer capability: return it to the owner only; never log, persist or observe it. */`.

**Verify**: `pnpm --filter @ditto/runtime-contracts typecheck` → exit 0. (Runtime typecheck will now fail until step 4; that's expected.)

### Step 2: Preview helpers modules

Create two files, so that the workspace controller never imports the Sandbox SDK:
- `apps/runtime/src/pi-durable-preview.ts`: pure helpers (`candidateSandboxName`, `previewToken`, `newPreviewToken`, `previewTokenDigest`, `parseCandidatePreviewHost`). It has no imports.
- `apps/runtime/src/pi-durable-preview-fetch.ts`: `candidatePreviewFetch` and `candidatePreviewProxy`. It imports `@cloudflare/sandbox` and `./pi-durable-preview.ts`.

Signatures:

```ts
/** The candidate execution sandbox's name; the prefix keeps its preview hosts apart from legacy ones. */
export function candidateSandboxName(workspaceSessionId: string): string; // `c-${id}`

/** The SDK bearer in a preview URL: the text after the last `-` of the first host label. */
export function previewToken(url: string): string | undefined; // parse with new URL(); undefined unless the token matches /^[a-z0-9_]{1,16}$/

/** A fresh 16-character [a-z0-9] bearer from crypto.getRandomValues, without modulo bias. */
export function newPreviewToken(): string;
// Draw random bytes and discard any byte >= 252 (252 = 7 * 36). Map the rest with `alphabet[byte % 36]`.

/** Lowercase hex SHA-256 of a preview token; the only form the runtime stores. */
export async function previewTokenDigest(token: string): Promise<string>;

/** A candidate preview host: `10000-c-<uuid>-<token>.ayn.wtf` or `.localhost`; anything else is undefined. */
export function parseCandidatePreviewHost(hostname: string):
	| { workspaceSessionId: string; token: string }
	| undefined;

/** Admits one preview request against its session, then forwards it to the candidate sandbox. */
export async function candidatePreviewFetch(
	request: Request,
	deps: {
		session(workspaceSessionId: string): { previewAdmit(digest: string): Promise<boolean> };
		proxy(request: Request): Promise<Response | null>;
	},
): Promise<Response>;

/** The SDK proxy bound to the candidate sandbox namespace instead of `env.Sandbox`. */
export function candidatePreviewProxy(env: { CandidateSandbox: DurableObjectNamespace<import("@cloudflare/sandbox").Sandbox> }): (request: Request) => Promise<Response | null>;
// body: (request) => proxyToSandbox(request, { Sandbox: env.CandidateSandbox })
```

- `parseCandidatePreviewHost`: lowercase the hostname, then match `^10000-c-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([a-z0-9_]{1,16})\.(?:ayn\.wtf|localhost)$`.
- `candidatePreviewFetch`: parse `new URL(request.url).hostname`. If the host does not parse, or `previewAdmit` returns false or throws, return `new Response("Not Found", { status: 404 })` with no other detail. Otherwise return `(await deps.proxy(request)) ?? 404`. Call `previewAdmit` with the digest, never with the raw token.
- If `candidatePreviewProxy`'s type does not check against `proxyToSandbox`'s `SandboxEnv` type, cast through `unknown` once, with a comment naming the reason (for example: the SDK type wants the subclass). STOP if it needs more than one cast.

**Verify**: `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-preview.test.ts` → pass (write the tests from the Test plan, section A, in this step).

### Step 3: Workspace controller

In `pi-durable-workspace.ts`:

1. `WorkspaceExecution`:
   - `previewStart(...)` now returns `Promise<{ url: string }>`.
   - Add `/** The current preview URL, read without rotating its token; undefined when none is forwardable. */ previewUrl(): Promise<string | undefined>;`
2. Add to the table setup list: `"CREATE TABLE IF NOT EXISTS workspace_preview_grant (id INTEGER PRIMARY KEY CHECK (id = 1), generation INTEGER NOT NULL, digest TEXT NOT NULL)"`. Use a separate table, so DOs created before this change need no `ALTER`.
3. Add a `grant()` reader that returns `{ generation, digest } | undefined` (`.toArray()[0]`).
4. The start step. Compute the digest **inside** the `run` lambda, which the controller writes. `step()` settles the ledger as `completed` before it returns (`:203-205`), so no `await` may come between that settlement and the state flip:
   ```ts
   const result = await step(scope, "preview_start", async (permit) => {
   	const { url } = await deps.execution.previewStart(permit, { port: WORKSPACE_PREVIEW_PORT });
   	const token = previewToken(url);
   	// A plain Error (not ArtifactStepRejected) makes the outcome unknown: a URL may be live.
   	if (!token) throw new Error("Preview start returned a malformed address");
   	return { url, digest: await previewTokenDigest(token) };
   });
   ```
   On `ok`, apply both writes in one `storage.transactionSync(() => { ... })` (the `SqlStorage` type exposes it, `pi-durable-checkpoints.ts:194`; there are precedents at `:210` and `:537`): the existing `running` update, then `"INSERT OR REPLACE INTO workspace_preview_grant VALUES (1, (SELECT generation FROM workspace_preview WHERE id = 1), ?)"` with `digest`. Return `{ status: "preview_running", generation: preview().generation, url: result.value.url }`.
5. Both idempotent `running` returns call a new helper:
   ```ts
   async function runningResult(generation: number): Promise<WorkspaceActionResultV1> {
   	const url = await deps.execution.previewUrl().catch(() => undefined);
   	const token = url === undefined ? undefined : previewToken(url);
   	if (!url || !token || !admits(await previewTokenDigest(token)))
   		return { status: "rejected", reason: "preview_url_unavailable" };
   	return { status: "preview_running", generation, url };
   }
   ```
6. Every write that leaves `running` must delete the grant **in the same `transactionSync`**: the `stopped` update and the `unknown` update in `stopPreview`, and the `unknown` update on the start path. The statement is `"DELETE FROM workspace_preview_grant WHERE id = 1"`.
7. Add the controller method:
   ```ts
   /** A preview request's token digest must match the grant of the running generation. */
   previewAdmits(digest: string): boolean
   ```
   It returns true only when `preview().state === "running"`, `grant()` exists, `grant.generation === preview().generation`, and the digests are equal. Compare with a constant-time loop over equal-length strings (return false when the lengths differ). Use the same check as `admits` in item 5 (define `admits` once and use it in both places).
8. Leave `previewAuthority` and `restart()` unchanged. `restart()` ignores the URL in the result.

**Verify**: `pnpm --filter @ditto/runtime typecheck` → only errors from `pi-durable-execution.ts`, `pi-durable-checkpoint.fixture.ts` and the tests (fixed in steps 4–6). Look for any error in `pi-durable-workspace.ts` itself; there must be none.

### Step 4: Sandbox execution

In `pi-durable-execution.ts`:

1. Extend `ExecutionSandbox` with exactly:
   ```ts
   startProcess(command: string, options: { processId: string; cwd: string; env: Record<string, string>; autoCleanup: boolean }): Promise<unknown>;
   getProcess(id: string): Promise<{ status: string } | null>;
   killProcess(id: string): Promise<unknown>;
   exposePort(port: number, options: { hostname: string; token: string }): Promise<{ url: string }>;
   unexposePort(port: number): Promise<unknown>;
   getExposedPorts(hostname: string): Promise<{ url: string; port: number }[]>;
   ```
2. `sandboxWorkspaceExecution(sandbox, now, preview: { hostname?: string; sleep?(ms: number): Promise<void> } = {})`. Below, `previewHostname` means `preview.hostname`. Update the doc comment to `/** UI Git and preview through the image-owned \`ditto-workspace\`; preview needs a configured hostname. */`. Constants: `PREVIEW_PROCESS_ID = "ditto-preview"`, `READY_MAX_MS = 30_000`, healthy statuses `starting`/`running`, terminal statuses `completed`/`failed`/`killed`/`error`.
3. `previewStart(permit, { port })`:
   1. If there is no `previewHostname`, `throw previewDenied()` (unchanged message).
   2. `await sandbox.unexposePort(port)`; then `await sandbox.killProcess(PREVIEW_PROCESS_ID).catch(() => undefined)`.
   3. Run `ditto-workspace preview command` with `{ timeout: timeout(permit) }` and parse it with `parseWorkspaceCli`. Require `command` (a non-empty string), `cwd` (a string) and `env` (a plain object whose values are all strings). Otherwise `throw new ArtifactStepRejected("execution_failed", "Preview command returned an invalid result")`.
   4. `await sandbox.startProcess(command, { processId: PREVIEW_PROCESS_ID, cwd, env, autoCleanup: true })`. With `autoCleanup: true`, an exited process's record is removed, so `getProcess` returning `null` counts as terminated and the fixed id can be reused.
   5. In a `try`:
      - Run `ditto-workspace preview ready --timeout-ms ${Math.max(1, Math.min(READY_MAX_MS, permit.deadlineAt - now()))}` with `{ timeout: timeout(permit) }`, and parse it.
      - Then `getProcess`. If it is null or not healthy, `throw new ArtifactStepRejected("execution_failed", "Preview process is not running")`.
      - Then `const token = newPreviewToken()` and `const { url } = await sandbox.exposePort(port, { hostname: previewHostname, token })`. If `previewToken(url) !== token`, `throw new ArtifactStepRejected("execution_failed", "Preview URL is malformed")`. Return `{ url }`.
   6. In the `catch`: `await sandbox.unexposePort(port)`, `await sandbox.killProcess(PREVIEW_PROCESS_ID).catch(() => undefined)`, then rethrow the original error. If `unexposePort` throws here, let that error propagate. It is not an `ArtifactStepRejected`, so the controller records `unknown`, which is correct: a live URL may remain.
   7. No error message may contain the URL, the token, the command or its env.
4. `previewStop()`:
   - `try { await sandbox.unexposePort(WORKSPACE_PREVIEW_PORT) } catch { throw new ArtifactStepRejected("execution_failed", "Preview revocation failed") }`. Revocation comes before any process change.
   - Then `await sandbox.killProcess(PREVIEW_PROCESS_ID).catch(() => undefined)`. `killProcess` only sends a signal; the process may still show `running` immediately after.
   - Then **poll** `getProcess` every 250 ms for at most `Math.min(STOP_EVIDENCE_MS, permit.deadlineAt - now())`, with `STOP_EVIDENCE_MS = 10_000`.
     - The process is `null` or has a terminal status → `{ terminated: true }`.
     - The bound passes while it is still healthy → `{ terminated: false }` (the controller marks `unknown`).
     - `getProcess` throws → `{ terminated: false }` immediately.
   - Sleep with `preview.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))`, so tests don't wait.
5. `previewUrl()`: if there is no `previewHostname`, return `undefined`; otherwise return `(await sandbox.getExposedPorts(previewHostname)).find((p) => p.port === WORKSPACE_PREVIEW_PORT)?.url`.
6. `composeCandidateExecution` deps gain `/** Host the SDK builds preview URLs under; absent keeps preview unavailable. */ previewHostname?: string;` and `/** Test seam for the stop-evidence poll. */ sleep?(ms: number): Promise<void>;`. At `:228`, pass `{ hostname: deps.previewHostname, sleep: deps.sleep }`.

**Verify**: `pnpm --filter @ditto/runtime typecheck` → remaining errors only in the fixture, the tests and `pi-durable-execution-session.ts`/`product-session.ts` (if any).

### Step 5: Session and host

1. `pi-durable-host.ts`, next to `previewAuthority`:
   ```ts
   /** Product preview proxy: a request's token digest must match the running grant on a live, unfenced host. */
   previewAdmits(digest: string): boolean {
   	if (this.sealed || this.denied || this.storageBarrier) return false;
   	const workspace = this.workspace();
   	if (!workspace || this.workspacePort().admission() !== "open") return false;
   	if (!workspace.previewAdmits(digest)) return false;
   	workspace.traffic();
   	return true;
   }
   ```
2. `pi-durable-product-session.ts`:
   - Add a hook next to the others: `/** Deployment composition revokes the session's preview URL; none has nothing to revoke. */ protected async revokePreview(_scope: CandidateRuntimeScope): Promise<void> {}`.
   - In `purgeDeleted`, call `await this.revokePreview(scope);` **after** `awaitClosure()` and `this.host = undefined`, and **before** `deleteAlarm()`/`deleteAll()`. Revoking earlier would let a live host's backup alarm (`tick` → `restart` → `exposePort`) re-expose after the revocation. If it throws, the purge throws. Do not catch it: deletion must not finish with a live URL.
   - Add the public RPC method:
     ```ts
     /** Product preview proxy: answers only from a live host and never opens one. */
     async previewAdmit(digest: unknown): Promise<boolean> {
     	if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) return false;
     	return this.host?.previewAdmits(digest) ?? false;
     }
     ```
     It must not call `activate`, `open`, `scope`, `awaitClosure` or any `CandidateProduct` method.
3. `pi-durable-execution-session.ts`:
   - `ExecutionSessionBindings` gains `/** Host for candidate preview URLs, such as \`ayn.wtf\` or \`localhost:5173\`; absent keeps preview unavailable. */ CANDIDATE_PREVIEW_HOST?: string;`.
   - In `prepareExecution`, change the sandbox name to `candidateSandboxName(scope.workspaceSessionId)` and pass `previewHostname: this.env.CANDIDATE_PREVIEW_HOST`.
   - Override `revokePreview(scope)`: if `CandidateSandbox` is unbound, return. Otherwise run `await (getSandbox(CandidateSandbox, candidateSandboxName(scope.workspaceSessionId), { transport: "rpc" }) as ExecutionSandbox).unexposePort(WORKSPACE_PREVIEW_PORT)`.

Imports to add:
- `pi-durable-workspace.ts`: `previewToken` and `previewTokenDigest` from `./pi-durable-preview.ts`.
- `pi-durable-execution.ts`: `previewToken` and `newPreviewToken` from `./pi-durable-preview.ts`, plus `WORKSPACE_PREVIEW_PORT` from the contract.
- `pi-durable-execution-session.ts`: `candidateSandboxName` and `WORKSPACE_PREVIEW_PORT`.

**Verify**: `pnpm --filter @ditto/runtime typecheck` → remaining errors only in the fixture and the tests.

### Step 6: Fixture and existing tests

1. `pi-durable-checkpoint.fixture.ts` `fakeWorkspace`:
   - Add `url: undefined as string | undefined` to `state`.
   - `previewStart` sets `state.url = \`http://10000-c-workspace-${random16()}.localhost/\`` and returns `{ url: state.url }`. Here `random16` makes 16 characters from `abcdefghijklmnopqrstuvwxyz0123456789` using `crypto.getRandomValues`.
   - `previewStop` clears `state.url` when it terminates.
   - Add `async previewUrl() { return state.preview === "running" ? state.url : undefined; }`. It takes no permit, does **not** push to `state.calls` and has no fault hook, so existing exact `calls` assertions stay unchanged. If TypeScript then complains that `faults` is keyed by `keyof WorkspaceExecution`, narrow the key type to `Exclude<keyof WorkspaceExecution, "previewUrl">`.
2. Update existing exact assertions of `{ status: "preview_running", generation: N }` to include `url: expect.any(String)`. They are in `pi-durable-workspace-actions.test.ts:182,640` and `pi-durable-lifecycle.test.ts:85`. Do not loosen any other assertion.
3. `apps/credential-tests/src/product-commands.worker.test.ts` (about `:3378`): return `{ status: "preview_running", generation: 1, url: "http://10000-c-x-t.localhost/" }`.

**Verify**: `pnpm --filter @ditto/runtime typecheck` → exit 0. `pnpm --filter @ditto/credential-tests typecheck` → exit 0. `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-workspace-actions.test.ts src/pi-durable-lifecycle.test.ts` → all pass.

### Step 7: New tests

Write the tests in sections B and C of the Test plan.

**Verify**: the focused runtime test command from the table → all pass.

### Step 8: Full gate

**Verify**, in order: `pnpm contracts:verify`, `pnpm runtime:verify`, `pnpm typecheck`, `pnpm --filter @ditto/credential-tests typecheck` and `pnpm check` must all exit 0.

## Test plan

**A. `apps/runtime/src/pi-durable-preview.test.ts`** (plain functions; it runs in the runtime vitest pool):
1. `candidateSandboxName("abc")` is `"c-abc"`.
2. `previewToken("http://10000-c-workspace-ab12_x.localhost:5173/")` is `"ab12_x"`. A missing token, a 17-character token, a token containing `.`, and a non-URL are all `undefined`. (Do not test uppercase: `new URL()` lowercases hosts.)
2a. `newPreviewToken()` matches `/^[a-z0-9]{16}$/`, and 1,000 calls give 1,000 distinct values.
3. `previewTokenDigest("abc")` is `"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"`.
4. `parseCandidatePreviewHost`:
   - It accepts `10000-c-<uuid>-tok.ayn.wtf` and `.localhost` (case-insensitive host).
   - It rejects a legacy `10000-<uuid>-tok.ayn.wtf`, port `3000`, `c-` with a non-UUID, a deeper `x.10000-c-...ayn.wtf`, `ayn.wtf.evil.com`, and a `.workers.dev` host.
5. `candidatePreviewFetch` (in `pi-durable-preview-fetch.test.ts`, a separate file next to its module):
   - An unparsable host → 404, and neither `session` nor `proxy` is called.
   - `previewAdmit` false → 404, and `proxy` is not called.
   - `previewAdmit` throws → 404.
   - Admitted → returns the proxy's response, and `previewAdmit` received the digest (64 hex characters, not equal to the token).
   - `proxy` returns null → 404.

**B. `apps/runtime/src/pi-durable-execution.test.ts`** (use the existing `harness` and `scriptedSandbox`, `:60-160`):
- Extend `scriptedSandbox` state with `exposed: Map<number, string>` (port → token), `process: { status: string } | null`, `calls: string[]` (the SDK method names in order), `readyFails`, `unexposeFails` and `getProcessThrows`. Implement the six new methods:
  - `exposePort(port, { token })` mirrors the SDK. Given a token, it stores and uses that token. Without one, it would reuse the map's token; the code under test always passes one. It returns `http://10000-c-workspace-<token>.localhost/`.
  - `unexposePort` deletes the token.
  - `getExposedPorts` lists the map.
  - `startProcess` sets `process = { status: "running" }`; `killProcess` sets it to `killed`.
  - `exec` answers `ditto-workspace preview command` with a vite command and `ditto-workspace preview ready ...` with `{ ok: true, ready: true }` (or `not_ready` when `readyFails`).
- Give `harness` a third parameter, `options: { previewHostname?: string | null } = {}`, and pass `previewHostname: options.previewHostname === null ? undefined : (options.previewHostname ?? "localhost")` to `composeCandidateExecution`. Also pass a no-op `sleep` (`async () => {}`).
- `killProcess` sets `process` to `{ status: "running" }` for its first N `getProcess` reads when `state.slowKill = N`, then to `null`. This exercises the stop poll.
- Compute expected digests with `previewTokenDigest` from `./pi-durable-preview.ts`.
- Replace `rejects preview without running a preview command` (`:523-539`) with:
  1. **No hostname** (`{ previewHostname: null }`) → `preview_start` is `rejected`, no `preview` CLI command ran, and `exposePort` was never called.
  2. **Start** → `preview_running` with a URL, and the SDK call order is `unexposePort, killProcess, startProcess, getProcess, exposePort` (exec calls are tracked separately). `host.previewAdmits(await previewTokenDigest(token))` is true; a digest of another token is false.
  3. **Repeated start** → the same URL, `exposePort` was not called again, and the token is unchanged.
  4. **Stop then start** → a different URL, and the first token's digest is denied. Then make the stub's `unexposePort` a no-op for **both** the stop and the next start. The old token now survives in `exposed`, yet the restart still returns a new token, because the runtime passes a fresh one. The old digest is denied.
  4a. **Slow kill**: with `slowKill = 3`, stop returns `preview_stopped` (the poll saw `null`). With `slowKill = 1000`, stop ends `unknown`, because the bound passed while the process was healthy.
  4b. **Start `unexposePort` throws** → the outcome is `unknown` (a plain error), and there is no grant.
  5. **Stop order**: `unexposePort` comes before `killProcess`. With `unexposeFails`, stop returns `rejected`, `killProcess` was not called, the preview row stays `running` and the grant is kept.
  6. **Ready fails** → `rejected`, `unexposePort` and `killProcess` both ran after `startProcess`, the state is `stopped`, and there is no grant.
  7. **Leak check** after a start: scan every user SQLite table and every KV entry (`storage.list()`). List the tables with `"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"`; this filter matches `pi-durable-tools.test.ts:631`. workerd refuses reads of `_cf_*` tables. Then run `SELECT * FROM <table>` on each. The token string and the URL must not appear in their `JSON.stringify` output, while the digest appears in `workspace_preview_grant`.

**C. `apps/runtime/src/pi-durable-workspace-actions.test.ts`** (existing `fixture` harness, `fakeWorkspace`):
1. After a backup-deadline stop and restart (extend the existing deferral test, or copy its setup), the first URL's digest is denied and the restarted one is admitted.
2. A `preview_start` step that ends `unknown` (fault that throws a plain `Error` on `previewStart`) leaves no grant, and `previewAdmits` is false.
3. A sealed host (`await host.yield()`) → `previewAdmits` is false for the running digest.
4. An idempotent start when `previewUrl` returns undefined (set `workspace.state.url = undefined` while running) → `{ status: "rejected", reason: "preview_url_unavailable" }`.
5. After `finalizeForArchive` succeeds, `previewAdmits` is false for the formerly running digest, and `workspace_preview_grant` is empty.
6. After `quiesceForRestore()` succeeds, the same holds.

**D. `apps/credential-tests/src/candidate-preview.worker.test.ts`** (new file; it runs under the credential-tests pool, whose `CandidateSessions` binding is `CandidateFixtureSession`, `vitest.config.ts:32`, a subclass of `PiDurableProductSession`):
1. A fresh DO, `env.CandidateSessions.getByName(crypto.randomUUID())`: `previewAdmit("a".repeat(64))` is false, and `previewAdmit("not-hex")` is false.
2. After those calls, `runInDurableObject` shows that the DO's storage has no `candidate-scope-v2` key and no `host_meta` table, so nothing was opened.
Run it alone with `pnpm --filter @ditto/credential-tests exec vitest run src/candidate-preview.worker.test.ts`. Do not run or modify `product-commands.worker.test.ts` beyond the type fix in step 6.

## Done criteria

- [ ] `pnpm contracts:verify`, `pnpm runtime:verify`, `pnpm typecheck`, `pnpm --filter @ditto/credential-tests typecheck`, `pnpm check` all exit 0
- [ ] `grep -n "Preview is not composed" apps/runtime/src/pi-durable-execution.ts` still matches (used only for the no-hostname case)
- [ ] `grep -n "previewAdmit" apps/runtime/src/pi-durable-product-session.ts` matches, and that method body contains no `activate`/`open`/`scope(`/`CandidateProduct`
- [ ] `grep -rn "workspaceSessionId, {" apps/runtime/src/pi-durable-execution-session.ts` returns nothing (the sandbox name now goes through `candidateSandboxName`)
- [ ] In `purgeDeleted`, `revokePreview` comes after `awaitClosure` and before `deleteAll`: `awk '/async purgeDeleted/{f=1} f&&/awaitClosure/{a=NR} f&&/revokePreview/{b=NR} f&&/deleteAll/{c=NR; exit} END{exit !(a<b && b<c)}' apps/runtime/src/pi-durable-product-session.ts` exits 0
- [ ] `grep -n "@cloudflare/sandbox" apps/runtime/src/pi-durable-workspace.ts apps/runtime/src/pi-durable-preview.ts` returns nothing
- [ ] `pnpm --filter @ditto/credential-tests exec vitest run src/candidate-preview.worker.test.ts` passes
- [ ] The new tests in sections A–C exist and pass
- [ ] `git status` shows only in-scope files

## STOP conditions

- An excerpt above does not match the live code.
- `ExecutionSandbox` gains methods that the rpc `getSandbox(...)` stub cannot satisfy without more than the existing single `as ExecutionSandbox` cast.
- Anything requires storing the raw token or URL, or putting them in an error message.
- A test outside the listed files fails because of the sandbox rename, or something reads the sandbox name `workspaceSessionId` (search `getSandbox(` across `apps/`).
- Making `previewAdmit` work seems to require opening the host, reading the product, or adding a Worker entry/binding.
- `exposePort` rejects the custom token (it must match `[a-z0-9_]{1,16}`, `sandbox-DI6suZAc.js:9374-9377`).
- An RPC error after `startProcess`, once cleanup has succeeded, is still recorded as `unknown` and blocks the workspace. That is intended, because a live process is not disproven. If a real container run (deployment track) shows this happens on routine starts, report it rather than relaxing it here.
- The existing deferral/backup tests in `pi-durable-workspace-actions.test.ts` need behavioral changes, not just the `url` addition.

## Maintenance notes

- `candidatePreviewFetch` and `candidatePreviewProxy` are not mounted anywhere yet. The deployment-wiring track mounts them in the runtime Worker as a service-binding entrypoint: `candidatePreviewFetch(request, { session: (id) => env.CandidateSessions.getByName(id), proxy: candidatePreviewProxy(env) })`. It also sets `CANDIDATE_PREVIEW_HOST`.
- Reviewers should check that the digest is computed inside the step's `run`, that the flip and the grant write share one `transactionSync`, and that every path to `stopped` or `unknown` deletes the grant.
- The preview pane (plan 033) handles `preview_url_unavailable` by stopping and starting once.
- The sandbox rename orphans any existing local candidate sandbox named by bare session id. Its checkout is lost, and the next `present` check triggers a restore from the committed pair. No deployed candidate sessions exist yet.
- The fixture and credential-test URLs use non-UUID ids (`c-workspace`, `c-x`). Only runtime tests read them; `parseCandidatePreviewHost` correctly rejects them.
