# Plan 020: Harden the runner↔broker path (redaction, ready timeout, stale-runner cleanup)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md` unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Prerequisite**: Plans 018 and 019 must be DONE before this plan starts.
> Confirm: `src/lib/runner-protocol.ts` + `sandbox/runner/index.ts` exist
> (018); `src/lib/workspace-session-broker.ts` imports `#/lib/runner-protocol`
> and launches the runner (019); `src/lib/pi-rpc.ts` is gone (019). Run
> `pnpm exec tsc --noEmit --pretty false` and `pnpm test` — both must pass. If
> any prerequisite is unmet, STOP.
>
> **Drift check (run after the prerequisite check)**:
> `git diff --stat 55b6151..HEAD -- src/lib/runner-protocol.ts src/lib/runner-protocol.test.ts sandbox/runner/index.ts src/lib/workspace-session-broker.ts`
> These files MUST have changed since `55b6151` (018 and 019 landed). Compare
> the "Current state" excerpts against the live code; on a mismatch that
> contradicts a cited excerpt, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/018-runner-contract-and-pi-sdk-runner.md (DONE) and plans/019-broker-launches-pi-sdk-runner.md (DONE)
- **Category**: security
- **Planned at**: commit `55b6151`, 2026-07-02

## Why this matters

Plans 018 and 019 landed the Pi SDK runner and rewired the Durable Object to
launch it. The path works end-to-end, but it has four production gaps the PRD
explicitly defers to phase 3 (PRD line 207: "redaction, timeouts, runner reuse,
stale-lock cleanup"):

1. **Secret leakage**: the runner emits `tool_progress` excerpts of tool output
   verbatim — a tool that reads `.env` or echoes a provider key would stream
   that secret to the browser and D1. The PRD requires the runner to redact
   tool output before emitting (PRD line 163).
2. **No `ready` timeout**: the DO's `start` awaits the runner's `ready` event
   with no bound; a runner that crashes before emitting `ready` hangs `start`
   until the `onExit` callback fires (which may never happen if the process
   lingers).
3. **No stale-runner recovery**: if the DO hibernates and the runner process
   dies while the DO is asleep, the next `start` reuses a dead
   `runnerProcessId` and the log stream silently fails.
4. **Restart continuity is undecided**: the PRD leaves open whether a restarted
   runner replays D1 history into the `AgentSession` or starts fresh (PRD line
   204). The indecision itself is a risk — the behavior is whatever the
   implementation accidentally does.

This plan closes all four. The redaction helper is the one new testable seam
(a pure function in the contract module + Vitest tests); the rest are DO/runner
behaviors verified by manual smoke, consistent with the PRD's testing stance.

## Current state

Relevant files (all modified by 018/019 — excerpts reflect the post-019 state
specified in those plans; confirm against live code in the drift check):

- `src/lib/runner-protocol.ts` — the pure contract module from plan 018. It
  exports `RunnerCommand`, `RunnerEvent`, `RunnerEventBuffer`, `parseRunnerEvent`,
  `serializeRunnerCommand`, `serializeRunnerEvent`, `mapSdkEventToDitto`,
  `planRunnerCommand`. It has **no** imports from the Pi SDK or Cloudflare
  runtime (that purity is what makes it the testable seam). This plan adds a
  `redactSecrets` pure function here.
- `src/lib/runner-protocol.test.ts` — the Vitest suite from plan 018, following
  `src/lib/pi-rpc.test.ts`'s style (now deleted). This plan adds redaction
  cases.
- `sandbox/runner/index.ts` — the Node.js runner from plan 018. It reads
  `OPENCODE_API_KEY` + `MODEL_SPECIFIER` from `process.env`, subscribes to SDK
  events, calls `mapSdkEventToDitto`, and writes `RunnerEvent`s to stdout. This
  plan wraps its `tool_progress` and `error` emissions in `redactSecrets`.
- `src/lib/workspace-session-broker.ts` — the DO rewired by plan 019. It
  launches the runner, awaits `ready` via a `readyPromise`/`readyResolver` set
  in `handleRunnerEvent`'s `ready` case, and reuses a stored
  `runnerProcessId` in `ensureRunnerProcess`. Plan 019's maintenance notes
  flag the missing `ready` timeout and stale-runner detection — this plan
  implements them.

PRD constraints this plan honors:

```text
// docs/pi-sdk-session-broker-prd.md:161-163 (Secrets and redaction)
No provider keys, GitHub tokens, private keys, or `.env` values are stored in
D1 or emitted in frames. The runner redacts tool output before emitting
`tool_progress` excerpts; event payloads stay compact and `schemaVersion: 1`.
```

```text
// docs/pi-sdk-session-broker-prd.md:204 (restart continuity — open question)
... the new runner could either replay D1 history into a fresh `AgentSession`
to restore model context (richer, costs tokens) or start a new conversation
and rely on D1 as the visible history (simpler, loses in-memory model state).
This should be settled during implementation, not in the PRD.
```

```text
// docs/pi-sdk-session-broker-prd.md:136 (DO live state — includes canceled run ids)
... active run id, runner process id, pending input request id, canceled run ids.
```

Repo conventions (unchanged): strict TS, tabs + double quotes, `#/` imports,
pure helpers in `src/lib/` with sibling `.test.ts`, Conventional Commits.

Verification baseline (after 018+019 land; must still pass after this plan):

- `pnpm exec tsc --noEmit --pretty false` exits 0.
- `pnpm test` exits 0 (including `runner-protocol.test.ts`).
- `pnpm lint` exits 0 with only the two pre-existing warnings in
  `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`.
- `git diff --check` exits 0.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exit 0 |
| Tests (incl. new redaction cases) | `pnpm test` | exit 0, all pass |
| Lint | `pnpm lint` | exit 0, only the two pre-existing warnings |
| Whitespace | `git diff --check` | exit 0, no output |
| (Optional) runner typecheck | `cd sandbox/runner && pnpm install && pnpm exec tsc --noEmit` | exit 0 |

Do not run `pnpm format`, `pnpm fix`, `pnpm deploy`, or `pnpm destroy` unless
the operator explicitly asks. Do not commit credentials, `.env`, generated
`.alchemy/` state, or secret-bearing command output.

## Scope

**In scope** (the only files you should modify):

- `src/lib/runner-protocol.ts` (extend) — add `redactSecrets`.
- `src/lib/runner-protocol.test.ts` (extend) — add redaction tests.
- `sandbox/runner/index.ts` (extend) — call `redactSecrets` before emitting
  `tool_progress` and `error`; add a comment documenting the restart-continuity
  decision.
- `src/lib/workspace-session-broker.ts` (extend) — add a `ready`-wait timeout;
  add stale-runner liveness check + stale-lock cleanup in `ensureRunnerProcess`.
- `plans/README.md` (modify) — status row.

**Out of scope** (do NOT touch):

- `src/integrations/trpc/routers/workspace.ts`, the socket route, the browser
  components, `src/db/schema.ts`, `migrations/`, `alchemy.run.ts`,
  `src/server.ts`, `Dockerfile` — no shape or infra change.
- Replaying D1 history into the runner on restart (the PRD's "richer" option) —
  this plan settles the decision as "start fresh" (see Step 5); the replay path
  is explicitly deferred as a future extensibility item (PRD line 205).
- Per-tool approval UX, raw terminal mirroring, R2 artifact storage,
  pre-compiling the runner to JS — all still out of scope per the PRD.

## Git workflow

- Branch: `advisor/020-harden-runner-broker-path`.
- Commit style: Conventional Commits, e.g.
  `feat(runner): redact secrets and bound runner readiness`.
- Do not push, deploy, or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Add the pure `redactSecrets` helper to the contract module

Edit `src/lib/runner-protocol.ts`. Add a pure, dependency-free function:

```ts
/**
 * Redact known secret values and common secret patterns from text before it
 * is emitted as a tool_progress excerpt or error message. `secrets` is the
 * set of concrete secret strings to scrub (e.g. live env values); the regex
 * patterns catch unknown secrets that match known credential shapes.
 */
export function redactSecrets(text: string, secrets: string[]): string {
	const REDACTION = "[REDACTED]";
	let out = text;
	for (const secret of secrets) {
		if (secret.length >= 8) {
			out = out.split(secret).join(REDACTION);
		}
	}
	for (const pattern of SECRET_PATTERNS) {
		out = out.replace(pattern, REDACTION);
	}
	return out;
}

const SECRET_PATTERNS: RegExp[] = [
	// GitHub tokens: ghp_, gho_, ghs_, ghu_, ghr_
	/gh[pousr]_[A-Za-z0-9]{36,}/g,
	// PEM private key blocks (incl. BEGIN/END lines)
	/-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]* )?PRIVATE KEY-----/g,
	// AWS access key IDs
	/AKIA[0-9A-Z]{16}/g,
	// Generic provider API keys: sk-... (OpenAI-style), sk-ant-... (Anthropic-style)
	/sk-(?:ant-)?[A-Za-z0-9_-]{20,}/g,
];
```

Design notes:
- The `secrets.length >= 8` guard avoids redacting short strings that would
  over-match (e.g. a 3-char env value).
- `split(secret).join(REDACTION)` is used instead of `replaceAll` with a string
  pattern so that secret values containing regex metacharacters are matched
  literally.
- The function is pure (no `process.env` access) so it is unit-testable without
  the runner or a sandbox. The runner builds the `secrets` list from its env
  (Step 2).
- Do NOT import `process` or any Node/Cloudflare API into this module — it must
  stay pure to remain the testable seam.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0.

### Step 2: Add redaction tests

Edit `src/lib/runner-protocol.test.ts`. Add a `describe("redactSecrets", ...)`
block following the existing style. Cover:

- A concrete secret string in `secrets` is replaced with `[REDACTED]` wherever
  it appears (including as a substring of a larger token).
- A secret shorter than 8 chars in `secrets` is NOT redacted (guard).
- A GitHub token `ghp_<40 chars>` is redacted even when not in `secrets`.
- A PEM private-key block (multi-line, `-----BEGIN ... PRIVATE KEY-----` …
  `-----END ... PRIVATE KEY-----`) is redacted as a unit.
- An AWS key `AKIA<16 chars>` is redacted.
- An `sk-<20+ chars>` provider key is redacted.
- Non-secret text (e.g. a file path, a normal log line) is returned unchanged.
- Multiple secrets in one string are all redacted.
- An empty `secrets` array still applies the regex patterns.

Use realistic but synthetic values (never real credentials — hard-code fake
strings like `"ghp_" + "a".repeat(40)` and `"sk-test-" + "b".repeat(24)`).

**Verify**: `pnpm test` → exit 0, with the new redaction cases passing.

### Step 3: Use `redactSecrets` in the runner before emitting tool_progress and error

Edit `sandbox/runner/index.ts` (plan 018's file). Two call sites:

1. **tool_progress**: wherever the runner writes a `tool_progress` event to
   stdout (after `mapSdkEventToDitto` returns one for a `tool_execution_update`
   event), wrap the `text` field:
   `text: redactSecrets(event.text, runnerSecrets())`.
2. **error**: wherever the runner writes an `error` event (the
   `extension_error`/exception path), wrap the `message` field:
   `message: redactSecrets(message, runnerSecrets())`.

Add a local helper that builds the concrete-secrets list from the runner's env:

```ts
function runnerSecrets(): string[] {
	const secrets: string[] = [];
	for (const [key, value] of Object.entries(process.env)) {
		if (
			typeof value === "string" &&
			value.length >= 8 &&
			/(API_KEY|TOKEN|SECRET|PRIVATE_KEY)$/i.test(key)
		) {
			secrets.push(value);
		}
	}
	return secrets;
}
```

This captures `OPENCODE_API_KEY` (and any future `*_API_KEY`/`*_TOKEN`/
`*_SECRET`/`*_PRIVATE_KEY` env values the DO passes to the runner) without
redacting benign env like `PATH` or `MODEL_SPECIFIER`. Import `redactSecrets`
from the protocol module via the same relative import the runner already uses
(`../../src/lib/runner-protocol`).

Do NOT redact `assistant_delta` text (assistant prose is not tool output and is
not expected to contain secrets; redacting it would corrupt the model's
reasoning display). Do NOT redact `ready`/`tool_started`/`tool_finished`/
`file_changed`/`diff_ready`/`done` (they carry no tool output).

**Verify**: `cd sandbox/runner && pnpm install && pnpm exec tsc --noEmit` →
exit 0 (optional in-repo gate). `pnpm exec tsc --noEmit --pretty false` →
exit 0 (the Worker config excludes `sandbox/runner`, but the contract module
change is checked).

### Step 4: Bound the runner `ready` wait in the DO

Edit `src/lib/workspace-session-broker.ts`. Plan 019 added a `readyPromise`/
`readyResolver` (set in `handleRunnerEvent`'s `ready` case) and a
`waitForRunnerReady()` call in `start`. This plan bounds it.

Replace the unbounded `await this.readyPromise` in `waitForRunnerReady()` with
a timeout race:

```ts
private async waitForRunnerReady(): Promise<void> {
	if (this.runnerReady) return;            // already saw `ready` (reused runner)
	const timeout = new Promise<"timeout">((resolve) =>
		setTimeout(() => resolve("timeout"), RUNNER_READY_TIMEOUT_MS),
	);
	const result = await Promise.race([this.readyPromise, timeout]);
	if (result === "timeout") {
		throw new Error("Runner did not become ready in time.");
	}
}
```

Add the constant near the existing `COMMAND_TIMEOUT_MS`:

```ts
const RUNNER_READY_TIMEOUT_MS = 30_000;
```

The thrown error propagates up through `start` → the DO's `fetch` `/start`
handler returns a 400, and `workspace.startRun`'s `markAcceptedRunFailed`
(tRPC router) already marks the run failed + releases the lock on a broker
`/start` rejection. So a `ready` timeout lands as a clean failed run, not a
hang. Confirm this path by re-reading
`src/integrations/trpc/routers/workspace.ts:478-521` (`markAcceptedRunFailed`).

Clear the timer if `ready` wins (use `clearTimeout` on the winning path, or
accept the dangling timer — Workers' event loop will resolve it harmlessly).
Prefer explicit cleanup: store the timer id and clear it in the `ready` case.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0.

### Step 5: Add stale-runner liveness check and stale-lock cleanup in `ensureRunnerProcess`

Edit `src/lib/workspace-session-broker.ts`. In `ensureRunnerProcess` (plan 019's
rewrite of the old `ensurePiProcess`), BEFORE reusing a stored
`runnerProcessId`, verify the process is still alive. If it is dead, clear the
stale runner state and, if a run is still marked active, fail it and release
the lock.

Target logic (insert at the top of the `if (state.runnerProcessId && state.fifoPath)`
reuse branch):

```ts
private async ensureRunnerProcess(input: StartRequest): Promise<void> {
	const state = await this.getState();
	if (state.runnerProcessId && state.fifoPath) {
		const alive = await this.isRunnerAlive(state.runnerProcessId, state.sandboxId);
		if (alive) {
			await this.startLogStream(state.runnerProcessId);
			return;
		}
		// Runner died while the DO was asleep — clean up before relaunching.
		await this.cleanupStaleRunner(state);
	}
	// ... existing launch path (createOrGetSandboxSession, makeRunnerCommand, startProcess) ...
}

private async isRunnerAlive(processId: string, sandboxId?: string): Promise<boolean> {
	if (!sandboxId) return false;
	try {
		const sandbox = getProjectSandbox(this.env, sandboxId);
		const processes = await sandbox.listProcesses();
		return processes.some((p) => p.id === processId && p.status === "running");
	} catch {
		return false;
	}
}

private async cleanupStaleRunner(state: BrokerState): Promise<void> {
	if (state.activeRunId && state.projectId) {
		await this.failRun("Runner process exited unexpectedly.");   // inserts error + done{failed}, releases lock
	}
	await this.setState({
		...state,
		runnerProcessId: undefined,
		fifoPath: undefined,
		runnerReady: false,
		readyPromise: ... // reset the ready resolver for the next launch
	});
}
```

Notes:
- `sandbox.listProcesses()` is part of the installed `@cloudflare/sandbox@0.12.x`
  API surface (confirmed in plan 018's recon: `listProcesses` is exported). If
  `listProcesses()`'s return shape differs from `{ id, status }[]`, consult the
  SDK types and adjust — but do not skip the liveness check. If the SDK offers a
  cheaper `getProcess(processId)`, prefer it.
- `failRun` (from plan 017, preserved through 019) already guards against
  canceled runs and releases the lock only when owned, so calling it here is
  safe. If `state.activeRunId` is unset (no run was active when the DO slept),
  `cleanupStaleRunner` just clears the runner state without touching D1.
- Resetting the `readyPromise`/`readyResolver` is required so the next launch's
  `waitForRunnerReady` waits for the NEW runner's `ready`, not a resolved
  promise from the dead one. Re-create the resolver pair in `cleanupStaleRunner`.
- Do NOT call `listProcesses` on every `start` when there is no stored
  `runnerProcessId` (the cold-launch path) — only check liveness when reusing.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0.

### Step 6: Settle the runner-restart-continuity decision

The PRD (line 204) leaves this open. Settle it as: **on runner restart, start a
fresh `AgentSession`; do not replay D1 history into the runner.** D1 remains the
visible canonical history; the in-memory `AgentSession` is a runtime
convenience that does not survive a runner restart (PRD line 26).

This is already the de-facto behavior (plan 018's runner uses
`SessionManager.inMemory()` and a fresh process per restart; plan 019's
`cleanupStaleRunner` relaunches fresh). This step makes the decision explicit:

1. Add a short comment at the top of `sandbox/runner/index.ts`'s `main()`
   documenting the decision:
   ```ts
   // Restart continuity: on process restart the runner starts a fresh
   // AgentSession (SessionManager.inMemory). D1 is the canonical history; the
   // in-memory model context is not replayed. A restarted run continues as a
   // new conversation from the user's perspective. (PRD line 204, settled
   // 2026-07-02 in plan 020.)
   ```
2. Add a matching one-line note to `docs/pi-sdk-session-broker-prd.md`'s
   "Further Notes" restart-continuity bullet, marking it RESOLVED with the
   chosen path and a pointer to plan 020. (This is a doc file under `docs/`,
   which is in scope for this step only — do not edit any other doc.)

No behavioral code change is needed — the decision is documented, not
implemented, because the implementation already matches.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0 (the comment and
doc note do not affect typing).

### Step 7: Final verification and manual smoke

Run the full baseline:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm test
pnpm lint
git diff --check
```

Expected: typecheck 0; tests 0 (with new redaction cases); lint 0 (only the two
pre-existing warnings); whitespace 0.

Then inspect scope:

```bash
git status --short
```

Expected: only in-scope files changed.

Manual smoke (requires `pnpm dev` + a ready sandbox + `OPENCODE_API_KEY`):
1. Submit a prompt that causes a tool to print a value matching a secret
   pattern (e.g. a fake `ghp_...` or `sk-...` string in a file). Confirm the
   browser `tool_progress` frame and the D1 `command_output`/`tool_progress`
   payload show `[REDACTED]`, not the secret.
2. Stop the runner process mid-run (e.g. kill it inside the sandbox), then
   submit a new prompt. Confirm the DO detects the dead runner, fails the stale
   run, releases the lock, relaunches a fresh runner, and the new run
   completes — no hang, no stranded lock.
3. Restart the sandbox container during an active run (or simulate by killing
   the runner). Confirm the DO marks the run failed (not hung), the lock
   releases, and a new run can start after the sandbox is ready again.
4. Confirm the `ready` timeout fires (not a hang) if the runner image is broken
   and never emits `ready` — e.g. temporarily launch a bad runner command and
   confirm `start` fails within ~30s with a clean failed run, not an
   indefinite hang.

## Test plan

The one new automated seam is the `redactSecrets` pure function + its Vitest
tests (Steps 1–2), extending the contract module's existing test surface. The
DO/runner hardening (timeouts, stale-runner cleanup) is verified by manual
smoke (Step 7), consistent with the PRD's stance that the runner↔DO contract is
the only automated seam (PRD line 169).

- New tests: `src/lib/runner-protocol.test.ts`, cases listed in Step 2.
- Structural pattern: the existing `redactSecrets`-adjacent cases in the same
  file (pure functions, `vitest` `describe`/`it`/`expect`).
- Verification: `pnpm test` → all pass, including the new redaction cases.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `redactSecrets(text, secrets)` exists in `src/lib/runner-protocol.ts`,
      is pure (no `process`/Cloudflare imports), and redacts concrete secrets
      + GitHub/PEM/AWS/`sk-` patterns.
- [ ] `src/lib/runner-protocol.test.ts` has passing cases for every redaction
      path listed in Step 2.
- [ ] `sandbox/runner/index.ts` wraps `tool_progress` text and `error` message
      emissions in `redactSecrets(..., runnerSecrets())`.
- [ ] `src/lib/workspace-session-broker.ts`'s `waitForRunnerReady` races the
      `readyPromise` against a `RUNNER_READY_TIMEOUT_MS` (30s) timeout and
      throws on timeout.
- [ ] `ensureRunnerProcess` checks runner liveness via `sandbox.listProcesses`
      before reusing a stored `runnerProcessId`, and `cleanupStaleRunner` fails
      a stranded active run + releases the lock + clears runner state.
- [ ] `sandbox/runner/index.ts` and `docs/pi-sdk-session-broker-prd.md` document
      the restart-continuity decision (start fresh, no D1 replay).
- [ ] No file outside the in-scope list is modified (`git status --short`).
- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0.
- [ ] `pnpm test` exits 0, including new redaction cases.
- [ ] `pnpm lint` exits 0 with no new warnings.
- [ ] `git diff --check` exits 0.
- [ ] `plans/README.md` status row for Plan 020 is updated.

## STOP conditions

Stop and report back (do not improvise) if:

- Plans 018 or 019 are not DONE (the runner, contract module, or rewired DO is
  missing or broken).
- The live code at the cited locations doesn't match the "Current state"
  description (018/019 landed differently from their specs).
- `sandbox.listProcesses()` (or an equivalent liveness API) is not available on
  the installed `@cloudflare/sandbox@0.12.x` surface, so stale-runner detection
  cannot be implemented as specified — report so the approach can be revisited
  (do not ship the runner-reuse path without liveness checks).
- The `ready`-timeout race cannot be made to reach `markAcceptedRunFailed`
  cleanly (e.g. `start`'s error path does not propagate to a failed run) —
  report rather than leaving a half-broken timeout.
- A verification command fails twice after a reasonable fix attempt.
- The work appears to require touching an out-of-scope file (tRPC router,
  browser, D1 schema, `alchemy.run.ts`, `src/server.ts`, `Dockerfile`).

## Maintenance notes

- **D1 replay on restart is intentionally NOT implemented.** If the product
  later wants the runner to restore model context across restarts, that means
  replaying canonical D1 `message` events into a fresh `AgentSession` at runner
  startup — a non-trivial, token-costing feature that belongs in the PRD's
  "extensibility" follow-up (PRD line 205), not in hardening. Revisit this
  decision if users report the agent "forgetting" mid-conversation after a
  container restart.
- **Redaction is runner-side, not DO-side.** The DO receives already-redacted
  `tool_progress`/`error` text. If a future change moves `tool_progress`
  production into the DO (e.g. the git-inspect relocation noted in plan 019's
  maintenance notes), apply `redactSecrets` there too — the helper is in the
  shared contract module for exactly this reason.
- **The `ready` timeout is 30s.** If the sandbox image build is slow or the Pi
  SDK cold-start exceeds 30s in production, raise `RUNNER_READY_TIMEOUT_MS`.
  Watch for spurious `ready`-timeout failures in logs after deploying.
- Reviewers should scrutinize: that `redactSecrets` is pure and the test cases
  cover every regex pattern; that the runner redacts BOTH `tool_progress` and
  `error` (not just one); that `cleanupStaleRunner` resets the `readyPromise`
  (a stale resolved promise would skip the wait for the new runner); and that
  `failRun`'s canceled-run guard still holds when called from the stale-runner
  path.
