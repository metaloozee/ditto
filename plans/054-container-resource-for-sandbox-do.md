# Plan 054: Use `Container` Resource for `Sandbox` DO to Enable Container Engine in Flue Worker Dev

> **Drift check**: `git diff --stat 5e24415..HEAD -- alchemy.run.ts`

## Status

- **Priority**: P1, **Effort**: S, **Risk**: LOW
- **Depends on**: 053
- **Planned at**: commit `5e24415`, 2026-07-06

## Why this matters

After plans 049–053 got the dev server running and the agent dispatching, sending a chat message fails when the agent tries to read `AGENTS.md` from the sandbox:

```
[flue] Workflow run failed: Error: Containers have not been enabled for this Durable Object class.
  at async Object.exists (index.js:148509:15)
  at async readAgentsMd (index.js:121126:9)
  at async discoverSessionContext (index.js:121209:20)
```

Flue's `discoverSessionContext` calls `env.exists("AGENTS.md")` on the sandbox session env, which calls `sandbox.exists(path)` on the `Sandbox` DO. The `Sandbox` DO is a Cloudflare Container — it requires the container engine to be configured in miniflare. The website Worker has this via its `wrangler.transform` `containers` config, but the flueWorker (a plain `Worker`) has no `wrangler` field and no container config.

`buildWorkerOptions` (the miniflare dev path) checks each binding's type: if it's `type: "container"`, it sets `options.containerEngine = { localDocker: await getLocalDocker() }` and adds `container: { imageName }` to the DO config. The current `sandbox` binding is a `DurableObjectNamespace` (type `"durable_object_namespace"`), not a `Container` (type `"container"`), so `buildWorkerOptions` skips the container engine setup for the flueWorker.

The fix: replace the `DurableObjectNamespace("sandbox", ...)` with a `Container("sandbox", { className: "Sandbox", build: { context: ".", dockerfile: "Dockerfile" }, instanceType: "lite", maxInstances: 1 })`. This makes both Workers see `type: "container"` in `buildWorkerOptions`, enabling the container engine + image in miniflare dev for both. The website Worker's existing `wrangler.transform` `containers` config (for deploy) stays unchanged — it's a separate path.

## Current state

### `alchemy.run.ts`

Line 21-24:
```ts
const sandbox = DurableObjectNamespace("sandbox", {
	className: "Sandbox",
	sqlite: true,
});
```

This creates a `DurableObjectNamespace` (type `"durable_object_namespace"`). The website Worker adds container config via `wrangler.transform` (lines 117-128), but the flueWorker has no such config.

The `Container` resource is exported from `alchemy/cloudflare` (verified: `container.d.ts` + `index.d.ts:33`). It creates a binding with `type: "container"`, which `buildWorkerOptions` recognizes (line 116) and sets up the container engine.

The `Container` props match the website Worker's `wrangler.transform` containers config:
- `className: "Sandbox"` (same)
- `build: { context: ".", dockerfile: "Dockerfile" }` (the Dockerfile is at repo root)
- `instanceType: "lite"` (same as `wrangler.transform`)
- `maxInstances: 1` (same as `wrangler.transform`)

## Scope

**In scope**: `alchemy.run.ts` — (1) import `Container` from `alchemy/cloudflare`, (2) replace the `DurableObjectNamespace("sandbox", ...)` with `Container("sandbox", { className: "Sandbox", build: { context: ".", dockerfile: "Dockerfile" }, instanceType: "lite", maxInstances: 1 })`.

**Out of scope**: everything else (`.flue/cloudflare.ts`, `src/server.ts`, website Worker's `wrangler.transform`, any other file).

## Steps

### Step 1: Replace `DurableObjectNamespace` with `Container` for `sandbox`

**1a.** Add `Container` to the import from `alchemy/cloudflare` (line 3-9):

Change:
```ts
import {
	D1Database,
	DurableObjectNamespace,
	R2Bucket,
	TanStackStart,
	Worker,
} from "alchemy/cloudflare";
```

to:
```ts
import {
	Container,
	D1Database,
	DurableObjectNamespace,
	R2Bucket,
	TanStackStart,
	Worker,
} from "alchemy/cloudflare";
```

**1b.** Replace the `sandbox` declaration (lines 21-24):

Change:
```ts
const sandbox = DurableObjectNamespace("sandbox", {
	className: "Sandbox",
	sqlite: true,
});
```

to:
```ts
const sandbox = await Container("sandbox", {
	className: "Sandbox",
	build: {
		context: ".",
		dockerfile: "Dockerfile",
	},
	instanceType: "lite",
	maxInstances: 1,
});
```

Note: `Container` is async (returns a `Promise`), so it needs `await`. The `sqlite: true` field is not needed — `Container` always has `sqlite: true` (see `container.d.ts:210: sqlite?: true`). The `DurableObjectNamespace` import stays because the other DOs (`workspaceSessionBroker`, `projectCoordinator`, `flueRunBridge`, etc.) still use it.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0.

### Step 2: Rebuild Flue and run the full verification gate

- `pnpm flue:build` → exit 0
- `pnpm exec tsc --noEmit --pretty false` → exit 0
- `pnpm test` → exit 0 (23 files, 262 tests)
- `pnpm lint` → exit 0 (2 known warnings)
- `git diff --check` → exit 0

### Step 3: Dev smoke

SKIP — run in main checkout where `.env.local` exists.

## Done criteria

- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0
- [ ] `pnpm test` exits 0 (23 files, 262 tests)
- [ ] `pnpm lint` exits 0 (2 known warnings)
- [ ] `pnpm flue:build` exits 0
- [ ] `grep -n "Container" alchemy.run.ts` shows the import and usage
- [ ] `grep -n "DurableObjectNamespace.*sandbox" alchemy.run.ts` returns no matches
- [ ] Only `alchemy.run.ts` modified

## STOP conditions

- `Container` is not exported from `alchemy/cloudflare` (version mismatch).
- `tsc` error after the change.
- `pnpm flue:build` fails.
- Different error in dev smoke.

## Git workflow

- Branch: `advisor/054-container-resource-for-sandbox`
- Commit: `fix(infra): use Container resource for Sandbox DO to enable dev container engine`
- Do NOT push.
