# Plan 023: Restart the runner when the selected model changes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat bb00b96..HEAD -- src/components/composer.tsx src/integrations/trpc/routers/workspace.ts src/lib/workspace-session-broker.ts src/lib/runner-supervisor.ts src/lib/runner-supervisor.test.ts src/lib/runner-command.ts sandbox/runner/index.ts src/lib/agent-models.ts src/lib/user-preferences-store.ts
> git diff --stat -- src/components/composer.tsx src/integrations/trpc/routers/workspace.ts src/lib/workspace-session-broker.ts src/lib/runner-supervisor.ts src/lib/runner-supervisor.test.ts src/lib/runner-command.ts sandbox/runner/index.ts src/lib/agent-models.ts src/lib/user-preferences-store.ts
> ```
>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against live code. If the cited selected-model flow
> no longer exists, STOP and report.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: plans/022-gate-runner-events-and-commands-by-run-id.md
- **Category**: correctness / product
- **Planned at**: commit `bb00b96`, 2026-07-02

## Why this matters

The UI lets a user choose a model per run, and the tRPC API stores the selected
`modelSpecifier` on each `agent_runs` row. But the Durable Object reuses an
already-running sandbox runner process for the whole workspace session without
checking whether that process was started with the newly selected model. If the
user runs prompt A with Qwen and prompt B with DeepSeek in the same session,
prompt B can silently execute on the old Qwen runner.

This breaks the product promise from `docs/pi-sdk-session-broker-prd.md`: users
should be able to pick a model per run and have that selection persist across
sessions. This plan makes runner reuse conditional on the model specifier.

## Current state

Relevant files:

- `src/components/composer.tsx` — reads the persisted selected model and sends it to `workspace.startRun`.
- `src/integrations/trpc/routers/workspace.ts` — validates and forwards `modelSpecifier` to the broker.
- `src/lib/workspace-session-broker.ts` — starts or reuses the runner process.
- `src/lib/runner-supervisor.ts` — starts the sandbox process and checks liveness.
- `src/lib/runner-supervisor.test.ts` — existing pure tests for runner command/process helper behavior.
- `sandbox/runner/index.ts` — reads `MODEL_SPECIFIER` once at process startup.

Current model flow:

```ts
// src/components/composer.tsx:176-180
const result = await startRunMutation.mutateAsync({
	projectId,
	sessionId: sessionId ?? undefined,
	message: message.text,
	modelSpecifier: model,
	isMutating: true,
});
```

```ts
// src/integrations/trpc/routers/workspace.ts:221-226
modelSpecifier: z.string().refine(isProjectCoderModelSpecifier, {
	message: "Unknown project coder model.",
}),
isMutating: z.boolean().default(true),
```

```ts
// src/integrations/trpc/routers/workspace.ts:461-473
await postWorkspaceSessionBroker({
	env: ctx.env,
	sessionId,
	path: "/start",
	body: {
		sessionId,
		userId: ctx.user.id,
		projectId: input.projectId,
		sandboxId: project.sandboxId,
		runId,
		message: input.message,
		modelSpecifier: input.modelSpecifier,
		isMutating: input.isMutating,
	},
});
```

The broker reuses any live runner without checking model:

```ts
// src/lib/workspace-session-broker.ts:300-324
private async ensureRunnerProcess(input: StartRequest): Promise<void> {
	const state = await this.getState();
	if (state.runnerProcessId && state.fifoPath) {
		const alive = await this.runnerSupervisor.isAlive(
			state.runnerProcessId,
			state.sandboxId,
		);
		if (alive && state.sandboxId) {
			await this.runnerSupervisor.startLogStream(
				state.sandboxId,
				state.runnerProcessId,
			);
			return;
		}
		await this.cleanupStaleRunner(state);
	}

	this.resetReadyWaiter();
	const runnerProcess = await this.runnerSupervisor.start({
		sessionId: input.sessionId,
		sandboxId: input.sandboxId,
		modelSpecifier: input.modelSpecifier,
	});
```

The runner reads the model only once:

```ts
// sandbox/runner/index.ts:143-203
const MODEL_SPECIFIER = process.env.MODEL_SPECIFIER;
// ...
const parts = getModelParts(MODEL_SPECIFIER);
// ...
const model = modelRegistry.find(provider, modelId);
```

Existing supervisor liveness support:

```ts
// src/lib/runner-supervisor.ts:79-88
async isAlive(processId: string, sandboxId?: string): Promise<boolean> {
	if (!sandboxId) return false;
	try {
		const sandbox = this.options.getSandbox(this.options.env, sandboxId);
		const processes = await sandbox.listProcesses();
		return processes.some(
			(process) => process.id === processId && process.status === "running",
		);
	} catch {
		return false;
	}
}
```

Cloudflare Sandbox SDK types expose process killing (`killProcess`). Use that
instead of shelling out to `pkill`.

Repo conventions:

- Keep Cloudflare Sandbox API calls inside `RunnerSupervisor` rather than the broker.
- Broker state is stored in the Durable Object under `BROKER_STATE_KEY` and broadcast through `snapshot` frames.
- Pure helper behavior belongs in `src/lib/*` with sibling Vitest tests where practical.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused supervisor tests | `pnpm vitest run src/lib/runner-supervisor.test.ts` | exit 0; new model reuse decision tests pass |
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exit 0 |
| Runner typecheck | `pnpm runner:typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0; only pre-existing unrelated warnings |
| Full tests | `pnpm test` | exit 0 |
| Whitespace | `git diff --check` | exit 0 |

## Scope

**In scope**:

- `src/lib/workspace-session-broker.ts`
- `src/lib/runner-supervisor.ts`
- `src/lib/runner-supervisor.test.ts`
- `src/lib/runner-command.ts` only if process id helper signatures must change
- `plans/README.md`

**Out of scope**:

- Changing the model list in `src/lib/agent-models.ts`.
- Changing the user preferences store.
- Changing tRPC input shape; `modelSpecifier` is already present.
- Changing the runner's model resolution logic.
- Running multiple model-specific runners concurrently for one session.
- Browser UI redesign.

## Git workflow

- Branch: `advisor/023-runner-model-reuse`
- Commit message style: Conventional Commits, e.g. `fix(runner): restart when model changes`
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Add a pure reuse decision helper and tests

In `src/lib/runner-supervisor.ts`, export a small pure helper that decides
whether an existing runner can be reused:

```ts
export type RunnerReuseDecision = "start" | "reuse" | "restart";

export function getRunnerReuseDecision(input: {
	alive: boolean;
	currentModelSpecifier?: string;
	nextModelSpecifier: string;
}): RunnerReuseDecision {
	if (!input.alive) return "start";
	return input.currentModelSpecifier === input.nextModelSpecifier
		? "reuse"
		: "restart";
}
```

Add tests in `src/lib/runner-supervisor.test.ts`:

- dead runner => `start`
- live runner with same model => `reuse`
- live runner with missing current model => `restart`
- live runner with different model => `restart`

**Verify**:

```bash
pnpm vitest run src/lib/runner-supervisor.test.ts
```

Expected: exit 0.

### Step 2: Teach RunnerSupervisor to stop a runner process

Extend the local `SandboxWithRunnerSessions` type in `src/lib/runner-supervisor.ts`
with the Sandbox SDK process-kill method:

```ts
killProcess(processId: string): Promise<unknown>;
```

Add a method to `RunnerSupervisor`:

```ts
async stopProcess(sandboxId: string, processId: string): Promise<void> {
	const sandbox = this.options.getSandbox(this.options.env, sandboxId);
	await sandbox.killProcess(processId);
	this.forgetLogStream();
}
```

Do not implement process stopping with shell commands. Do not destroy the
sandbox or session.

**Verify**:

```bash
pnpm exec tsc --noEmit --pretty false
```

Expected: exit 0.

### Step 3: Store the runner's model in broker state

In `src/lib/workspace-session-broker.ts`, add an optional field to `BrokerState`:

```ts
runnerModelSpecifier?: string;
```

When a new runner is started successfully, store the requested model alongside
`runnerProcessId` and `fifoPath`:

```ts
runnerModelSpecifier: input.modelSpecifier,
```

When stale runner cleanup clears `runnerProcessId` and `fifoPath`, also clear
`runnerModelSpecifier`.

**Verify**:

```bash
pnpm exec tsc --noEmit --pretty false
```

Expected: exit 0.

### Step 4: Restart instead of reusing when the model differs

In `WorkspaceSessionBroker.ensureRunnerProcess`, replace the unconditional
"alive => reuse" branch with the decision helper from Step 1.

Target behavior:

- If there is no stored `runnerProcessId`/`fifoPath`, start a new runner.
- If a stored process is not alive, run existing stale-runner cleanup and start a new runner.
- If a stored process is alive and `runnerModelSpecifier === input.modelSpecifier`, reuse it and restart the log stream as today.
- If a stored process is alive but the model differs:
  1. call `this.runnerSupervisor.stopProcess(state.sandboxId, state.runnerProcessId)`;
  2. clear runner process fields in DO state;
  3. reset the ready waiter;
  4. start a new runner with `input.modelSpecifier`.

If `stopProcess` throws, surface a stable error such as:

```text
Runner is still shutting down. Retry the run in a moment.
```

Do not leave the new run marked active indefinitely; the existing `startRun`
error path should mark accepted runs failed and release the lock when broker
start fails.

**Verify**:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm test
```

Expected: both exit 0.

### Step 5: Run the full verification baseline

Run:

```bash
pnpm vitest run src/lib/runner-supervisor.test.ts
pnpm runner:typecheck
pnpm exec tsc --noEmit --pretty false
pnpm lint
pnpm test
git diff --check
```

Expected: all exit 0, with only the known unrelated lint warnings.

## Test plan

Add focused unit tests in `src/lib/runner-supervisor.test.ts` for
`getRunnerReuseDecision`. Do not add a sandbox integration test; stopping a
real process requires Cloudflare Sandbox runtime and credentials and remains a
manual smoke concern.

Manual smoke before deployment:

1. Open a ready project.
2. Run a prompt with the default model.
3. Change the model in the composer.
4. Run a second prompt in the same session.
5. Confirm broker logs show the previous runner process was stopped and a new
   runner was started with the new `MODEL_SPECIFIER`.

## Done criteria

- [ ] `BrokerState` stores `runnerModelSpecifier`.
- [ ] A live runner is reused only when its stored model matches the next run's model.
- [ ] A live runner with a different model is stopped through `RunnerSupervisor.stopProcess` before a new one starts.
- [ ] Stale runner cleanup clears `runnerModelSpecifier`.
- [ ] `src/lib/runner-supervisor.test.ts` covers reuse/start/restart decisions.
- [ ] `pnpm vitest run src/lib/runner-supervisor.test.ts` exits 0.
- [ ] `pnpm runner:typecheck` exits 0.
- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0.
- [ ] `pnpm lint` exits 0 with no new warnings.
- [ ] `pnpm test` exits 0.
- [ ] `git diff --check` exits 0.

## STOP conditions

Stop and report back if:

- `WorkspaceSessionBroker.ensureRunnerProcess` no longer owns runner reuse.
- The installed `@cloudflare/sandbox` type available to this repo does not expose `killProcess` on the sandbox object.
- Stopping a process appears to require destroying the whole project sandbox.
- Supporting model changes appears to require changing the public tRPC input shape.
- Verification fails because plan 021 or plan 022 has not landed.

## Maintenance notes

The runner reads `MODEL_SPECIFIER` only at process startup. Any future model
control that can change during a run must be implemented as an explicit runner
command and Pi SDK operation; until then, process restart is the correct boundary
for model changes.
