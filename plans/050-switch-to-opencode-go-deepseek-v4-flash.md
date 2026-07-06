# Plan 050: Switch the Flue Project-Coder Agent to OpenCode Go DeepSeek V4 Flash

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat b4b7b0e..HEAD -- .flue/agents/project-coder.ts src/lib/agent-models.ts alchemy.run.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 049 (dev must be unblocked first to verify the change)
- **Category**: config
- **Planned at**: commit `b4b7b0e`, 2026-07-06

## Why this matters

The Flue project-coder agent currently defaults to `anthropic/claude-sonnet-4-6`
(see `.flue/agents/project-coder.ts:306`) and the private `flueWorker` in
`alchemy.run.ts` only binds `ANTHROPIC_API_KEY` (line 85). The maintainer wants
to stop using Anthropic models and use **OpenCode Go's DeepSeek V4 Flash**
instead — `opencode-go/deepseek-v4-flash`. The model is confirmed available in
the installed Pi SDK
(`node_modules/.pnpm/@earendil-works+pi-ai@0.79.10_*/dist/models.generated.js:8530`,
name `"DeepSeek V4 Flash"`, provider `"opencode-go"`, baseUrl
`https://opencode.ai/zen/go/v1`). OpenCode Go authenticates via the
`OPENCODE_API_KEY` environment variable (Pi providers doc, "API Keys" table),
which is already present in `.env.local:13` and already bound to the `website`
Worker (`alchemy.run.ts:110`) — but NOT to the `flueWorker` where the agent
actually runs.

Three coordinated changes make the switch real:

1. Add `opencode-go/deepseek-v4-flash` to the model registry and make it the
   default (so the UI picker, D1 default, and Zustand store all prefer it).
2. Change the Flue agent's hardcoded default model to
   `opencode-go/deepseek-v4-flash`.
3. Bind `OPENCODE_API_KEY` to the `flueWorker` (so Pi can auth inside the
   Worker via `nodejs_compat`) and remove the now-unused `ANTHROPIC_API_KEY`
   binding from the `flueWorker`.

## Current state

### File 1 — `src/lib/agent-models.ts` (the model registry)

```ts
export const PROJECT_CODER_MODELS = [
	{
		id: "opencode-go/qwen3.7-plus",
		name: "Qwen3.7 Plus",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
	{
		id: "opencode-go/deepseek-v4-pro",
		name: "DeepSeek V4 Pro",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
	{
		id: "opencode-go/kimi-k2.6",
		name: "Kimi K2.6",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
] as const;

export const DEFAULT_PROJECT_CODER_MODEL = PROJECT_CODER_MODELS[0].id;
```

`DEFAULT_PROJECT_CODER_MODEL` is `PROJECT_CODER_MODELS[0].id` — i.e. the first
entry in the array is the default. It's consumed by:

- `src/db/schema.ts:130` — `modelSpecifier` column `.default(DEFAULT_PROJECT_CODER_MODEL)`.
- `src/lib/user-preferences-store.ts:17` — Zustand initial `selectedModel`.
- `src/lib/user-preferences-store.ts:25` — fallback when stored value fails `isProjectCoderModelSpecifier`.

`src/components/composer.tsx:49-55` maps `PROJECT_CODER_MODELS` into the UI
model picker; `chefSlug: model.provider` drives the provider logo. Adding a
new entry with `provider: "opencode-go"` automatically renders it with the
OpenCode Go logo.

The Flash variant is currently **absent** from the registry — only Pro is
listed. `opencode-go/deepseek-v4-flash` is a valid Pi model
(`models.generated.js:8530`) but `isProjectCoderModelSpecifier` would reject
it today, so the tRPC `startRun` input validator
(`src/integrations/trpc/routers/workspace.ts:633`) would refuse it.

### File 2 — `.flue/agents/project-coder.ts` (the agent's hardcoded default)

Line 306 inside the `createAgent(...)` factory return:

```ts
return {
    model: "anthropic/claude-sonnet-4-6",
    instructions: hasMutatingPayload(payload)
        ? mutatingInstructions
        : readOnlyInstructions,
    metadata: { projectId },
    tools,
    sandbox: cloudflareSandbox(sandbox),
};
```

This `model` is the agent's default. In the live path, the browser sends a
`modelSpecifier` (validated against the registry) that flows through
`workspace.startRun` → `FlueRunBridge` → Flue dispatch →
`session.prompt({ model: payload.modelSpecifier })`, which **overrides** the
agent default. But for any direct Flue agent call that omits the model, the
hardcoded `anthropic/claude-sonnet-4-6` is what Pi would use — and it requires
`ANTHROPIC_API_KEY` in the Worker env. The maintainer wants the default to be
`opencode-go/deepseek-v4-flash`.

### File 3 — `alchemy.run.ts` (the flueWorker bindings)

Lines 76-87:

```ts
export const flueWorker = await Worker("flue-worker", {
    entrypoint: FLUE_WORKER_ENTRYPOINT,
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
        Sandbox: sandbox,
        ProjectCoordinator: projectCoordinator,
        FLUE_PROJECT_CODER_AGENT: flueProjectCoderAgent,
        FLUE_DITTO_PROJECT_RUN_WORKFLOW: flueDittoProjectRunWorkflow,
        FLUE_REGISTRY: flueRegistry,
        ANTHROPIC_API_KEY: alchemy.secret(process.env.ANTHROPIC_API_KEY),
    },
});
```

`ANTHROPIC_API_KEY` is bound here so Pi can auth Anthropic models inside the
Worker (via `nodejs_compat`, which populates `process.env` from bindings). No
model in the registry is an Anthropic model, and after this plan the agent
default won't be either — so `ANTHROPIC_API_KEY` becomes dead weight on the
flueWorker. `OPENCODE_API_KEY` is NOT bound to the flueWorker today (it is
bound to the `website` Worker at line 110), so OpenCode Go models cannot auth
inside the Flue Worker.

## Commands you will need

| Purpose   | Command                                       | Expected on success |
|-----------|-----------------------------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit --pretty false`       | exit 0, no errors   |
| Tests     | `pnpm test`                                   | all pass (currently 23 files, 262 tests) |
| Lint      | `pnpm lint`                                   | exit 0 (2 known warnings are acceptable) |
| Build Flue| `pnpm flue:build`                             | exit 0; known DO migration warning from generated `.flue-vite.wrangler.jsonc` is acceptable |
| Dev smoke | `pnpm run dev`                                | reaches alchemy running state (requires `OPENCODE_API_KEY` and other secrets in `.env.local`/`.env`); NO `ERR_RUNTIME_FAILURE`. Stop with Ctrl-C once running. |

## Scope

**In scope** (the only files you should modify):
- `src/lib/agent-models.ts` — add `opencode-go/deepseek-v4-flash` as the first entry; remove nothing.
- `.flue/agents/project-coder.ts` — change the `model` value on line 306.
- `alchemy.run.ts` — add `OPENCODE_API_KEY` binding to the `flueWorker`; remove `ANTHROPIC_API_KEY` from the `flueWorker` bindings.

**Out of scope** (do NOT touch):
- The `website` Worker's bindings in `alchemy.run.ts` — it already has `OPENCODE_API_KEY` and its own `ANTHROPIC_API_KEY`; leave it alone.
- `src/db/schema.ts` — the `modelSpecifier` column already defaults to `DEFAULT_PROJECT_CODER_MODEL`; changing the constant value in `agent-models.ts` automatically changes the D1 default for new rows. No migration needed.
- `src/lib/user-preferences-store.ts` — already uses `DEFAULT_PROJECT_CODER_MODEL` dynamically.
- `src/components/composer.tsx` — already renders from `PROJECT_CODER_MODELS` dynamically.
- `src/integrations/trpc/routers/workspace.ts` — the `isProjectCoderModelSpecifier` validator reads from `PROJECT_CODER_MODEL_IDS` dynamically.
- Test files that use `anthropic/claude-sonnet-4-6` as a fixture string (`flue-dispatch-adapter.test.ts`, `flue-run-bridge.test.ts`, `project-agent-run-contract.test.ts`, `project-mutating-tools.test.ts`) — these are unit-test inputs that don't pass through the tRPC validator; they still pass as-is. Updating them is optional cleanup, not required.
- Any UI, D1 schema, coordinator, or snapshot code.

## Git workflow

- Branch: `advisor/050-switch-to-opencode-go-deepseek-v4-flash`
- Single commit. Message (match the repo's conventional commits):
  - `feat(flue): switch project-coder default to opencode-go deepseek v4 flash`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `opencode-go/deepseek-v4-flash` to the model registry and make it the default

In `src/lib/agent-models.ts`, add a new entry as the **first** item in
`PROJECT_CODER_MODELS` (so `DEFAULT_PROJECT_CODER_MODEL`, which reads
`PROJECT_CODER_MODELS[0].id`, points to it). Keep all three existing entries
unchanged below it.

Change the array from:

```ts
export const PROJECT_CODER_MODELS = [
	{
		id: "opencode-go/qwen3.7-plus",
		name: "Qwen3.7 Plus",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
	{
		id: "opencode-go/deepseek-v4-pro",
		name: "DeepSeek V4 Pro",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
	{
		id: "opencode-go/kimi-k2.6",
		name: "Kimi K2.6",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
] as const;
```

to:

```ts
export const PROJECT_CODER_MODELS = [
	{
		id: "opencode-go/deepseek-v4-flash",
		name: "DeepSeek V4 Flash",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
	{
		id: "opencode-go/qwen3.7-plus",
		name: "Qwen3.7 Plus",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
	{
		id: "opencode-go/deepseek-v4-pro",
		name: "DeepSeek V4 Pro",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
	{
		id: "opencode-go/kimi-k2.6",
		name: "Kimi K2.6",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
] as const;
```

The `id` must be exactly `"opencode-go/deepseek-v4-flash"` — matching the Pi
SDK model key at `models.generated.js:8530` (`id: "deepseek-v4-flash"`,
`provider: "opencode-go"`). `name` is `"DeepSeek V4 Flash"` matching the SDK's
`name` field. `provider` and `providerName` match the existing entries' shape.

Nothing else in this file changes. `DEFAULT_PROJECT_CODER_MODEL`,
`PROJECT_CODER_MODEL_IDS`, `ProjectCoderModelSpecifier`, and
`isProjectCoderModelSpecifier` all derive from the array automatically.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0, no errors.

### Step 2: Change the Flue agent's default model

In `.flue/agents/project-coder.ts`, change **only** the `model` string on
line 306. Keep everything else in the return object byte-for-byte unchanged.

Change:

```ts
        model: "anthropic/claude-sonnet-4-6",
```

to:

```ts
        model: "opencode-go/deepseek-v4-flash",
```

That is the entire change to this file. Do not touch the instructions, tools,
sandbox, metadata, or any helper function.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0, no errors.

### Step 3: Bind `OPENCODE_API_KEY` to the flueWorker and remove `ANTHROPIC_API_KEY`

In `alchemy.run.ts`, edit the `flueWorker` `bindings` object (currently lines
79-86). Add `OPENCODE_API_KEY` and remove `ANTHROPIC_API_KEY`.

Change:

```ts
	bindings: {
		Sandbox: sandbox,
		ProjectCoordinator: projectCoordinator,
		FLUE_PROJECT_CODER_AGENT: flueProjectCoderAgent,
		FLUE_DITTO_PROJECT_RUN_WORKFLOW: flueDittoProjectRunWorkflow,
		FLUE_REGISTRY: flueRegistry,
		ANTHROPIC_API_KEY: alchemy.secret(process.env.ANTHROPIC_API_KEY),
	},
```

to:

```ts
	bindings: {
		Sandbox: sandbox,
		ProjectCoordinator: projectCoordinator,
		FLUE_PROJECT_CODER_AGENT: flueProjectCoderAgent,
		FLUE_DITTO_PROJECT_RUN_WORKFLOW: flueDittoProjectRunWorkflow,
		FLUE_REGISTRY: flueRegistry,
		OPENCODE_API_KEY: alchemy.secret(process.env.OPENCODE_API_KEY),
	},
```

`OPENCODE_API_KEY` is already present in `.env.local` (line 13) and already
bound to the `website` Worker (line 110) — this just adds it to the
`flueWorker` so Pi can auth OpenCode Go models inside the Worker via
`nodejs_compat` (which populates `process.env` from bindings). `ANTHROPIC_API_KEY`
is removed because no model in the registry or agent default uses Anthropic
after this plan; keeping an unused secret binding is poor hygiene. The
`website` Worker keeps its own `ANTHROPIC_API_KEY` binding (line 111) — do NOT
touch that.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0, no errors.

### Step 4: Rebuild Flue and run the full verification gate

**Verify** (run all):
- `pnpm flue:build` → exit 0 (known DO migration warning from generated `.flue-vite.wrangler.jsonc` is acceptable).
- `pnpm exec tsc --noEmit --pretty false` → exit 0
- `pnpm test` → exit 0, all tests pass (expect 23 files / 262 tests; no new failures)
- `pnpm lint` → exit 0 (the 2 known warnings are acceptable)
- `git diff --check` → exit 0 (no whitespace errors)

### Step 5: Dev smoke test

Run `pnpm run dev` (which is `pnpm flue:build && alchemy dev`). This requires
the env files (`.env.local`/`.env`) to be present with `OPENCODE_API_KEY` and
other secrets — they are in the main working tree but NOT in an isolated
worktree (gitignored), so this step should be run in the main checkout, not a
worktree.

**Expected**: `Alchemy (v0.93.12)` → `App: ditto` → resource creation →
running miniflare with NO `ERR_RUNTIME_FAILURE`. The `flueWorker` should
create without a `Secret cannot be undefined` error for `OPENCODE_API_KEY`
(verify the key is present in `.env.local`). If a DIFFERENT secret is
undefined (e.g. `BETTER_AUTH_SECRET`), that's a pre-existing env gap unrelated
to this plan — record it and stop.

Stop the dev server with Ctrl-C once it reaches the watching state. You do
not need to send a chat message or run a full agent loop — this plan is a
config change, and the end-to-end agent smoke is deferred (see maintenance
notes).

## Test plan

No new automated tests are required:

- The model registry is a static array consumed by derived constants and
  validators; `pnpm test` confirms nothing breaks. The existing tests that
  use `anthropic/claude-sonnet-4-6` as a fixture string still pass because
  those unit tests don't route through `isProjectCoderModelSpecifier`.
- The Flue agent's `model` field is a string literal; `tsc` confirms it
  compiles, and `pnpm flue:build` confirms the bundle builds.
- The binding change is infrastructure declaration, verified by the dev smoke
  (`flueWorker` creates without `Secret cannot be undefined`).

Optional (not required, only if a reviewer asks): update the 4 test fixtures
that reference `anthropic/claude-sonnet-4-6` to `opencode-go/deepseek-v4-flash`
for consistency. Do not add this unless asked.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0
- [ ] `pnpm test` exits 0 (23 files, 262 tests, no new failures)
- [ ] `pnpm lint` exits 0 (2 known warnings acceptable)
- [ ] `pnpm flue:build` exits 0
- [ ] `grep -n "opencode-go/deepseek-v4-flash" src/lib/agent-models.ts` returns at least one match
- [ ] `grep -n "opencode-go/deepseek-v4-flash" .flue/agents/project-coder.ts` returns exactly one match
- [ ] `grep -n "anthropic/claude-sonnet-4-6" .flue/agents/project-coder.ts` returns no matches
- [ ] `grep -n "OPENCODE_API_KEY" alchemy.run.ts` returns at least two matches (flueWorker + website)
- [ ] `grep -n "ANTHROPIC_API_KEY" alchemy.run.ts` returns exactly one match (website only, not flueWorker)
- [ ] No files outside the in-scope list are modified (`git status --short` lists only `src/lib/agent-models.ts`, `.flue/agents/project-coder.ts`, `alchemy.run.ts`)
- [ ] `plans/README.md` status row for 050 updated — SKIP if a reviewer dispatched you and maintains the index.
- [ ] Dev smoke (if run in main checkout): `pnpm run dev` reaches running state with NO `ERR_RUNTIME_FAILURE` and NO `Secret cannot be undefined` for `OPENCODE_API_KEY`.

## STOP conditions

Stop and report back (do not improvise) if:

- The code at any in-scope file doesn't match the "Current state" excerpts
  (the codebase has drifted). Run the drift check at the top first.
- `opencode-go/deepseek-v4-flash` is not present in the installed Pi SDK's
  `models.generated.js` (the installed `@earendil-works/pi-ai` version may
  differ). Verify with:
  `grep -n "deepseek-v4-flash" node_modules/.pnpm/@earendil-works+pi-ai@*/dist/models.generated.js`
  If absent, STOP — the model ID may have changed in a newer Pi release; do
  not guess the ID.
- `OPENCODE_API_KEY` is absent from `.env.local`/`.env` (verify with
  `grep -l OPENCODE_API_KEY .env.local .env`). If absent, the dev smoke will
  fail with `Secret cannot be undefined` — report this rather than
  fabricating a key.
- `tsc` reports an error after any step — investigate the exact error before
  proceeding; do not suppress it.

## Maintenance notes

- **The Flue agent's `model` field is a fallback default.** In the live path,
  the browser sends a `modelSpecifier` from the UI picker (validated against
  `PROJECT_CODER_MODELS`), which overrides this default via
  `session.prompt({ model: payload.modelSpecifier })`. The hardcoded default
  only matters for direct Flue agent calls that omit the model. Keep the
  default in sync with `DEFAULT_PROJECT_CODER_MODEL` to avoid confusion.
- **Per-Worker secret bindings matter.** The `flueWorker` runs the Flue
  runtime + Pi SDK. Pi reads API keys from `process.env` (populated from
  Worker bindings via `nodejs_compat`). If a model provider is added to the
  registry, its API key must be bound to the `flueWorker` — not just the
  `website` Worker. The `website` Worker's bindings are for the TanStack app,
  not for Pi inside Flue.
- **Removing `ANTHROPIC_API_KEY` from the flueWorker is intentional.** No
  model in the registry or agent default uses Anthropic after this plan. If
  an Anthropic model is added back to the registry later, re-add
  `ANTHROPIC_API_KEY: alchemy.secret(process.env.ANTHROPIC_API_KEY)` to the
  `flueWorker` bindings at that time.
- **D1 default changes automatically.** `schema.ts:130` reads
  `DEFAULT_PROJECT_CODER_MODEL` at module load. Existing `agent_runs` rows
  keep their stored `modelSpecifier`; only new rows get the new default. No
  migration is needed.
- **Reviewer focus**: confirm the `id` string is exactly
  `opencode-go/deepseek-v4-flash` (not `deepseek-v4-flash` alone, not
  `opencode-go/DeepSeek V4 Flash`), matching the Pi SDK's
  `provider`/`id` split.
- **Follow-up explicitly deferred**: a full end-to-end agent smoke (send a
  chat message → Flue dispatch → Pi call to OpenCode Go → stream → terminal)
  is out of scope. This plan only switches the config. The end-to-end loop
  should be exercised separately once dev is running.
