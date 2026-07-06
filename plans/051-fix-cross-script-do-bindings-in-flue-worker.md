# Plan 051: Fix Cross-Script Durable Object Bindings for `Sandbox` and `ProjectCoordinator` in the Flue Worker

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat cddb453..HEAD -- alchemy.run.ts`
> If the in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 049 (the workflow `run` export fix must already be merged — this error was masked by the earlier `ERR_RUNTIME_FAILURE`)
- **Category**: bug
- **Planned at**: commit `cddb453`, 2026-07-06

## Why this matters

After plan 049 fixed the Flue workflow `run` export error, `pnpm run dev`
progressed further but hit a NEW `ERR_RUNTIME_FAILURE`:

```
service core:user:ditto-flue-worker-ayan: Uncaught TypeError: Class extends value undefined is not a constructor or null
  at __mf_do_wrapper.js:39:6 in createDurableObjectWrapper
  at __mf_do_wrapper_entry.js:8:35
MiniflareCoreError [ERR_RUNTIME_FAILURE]: The Workers runtime failed to start.
```

This is miniflare trying to `class Wrapper extends UserClass` (line 39 of
`do-wrapper.worker.js`) where `UserClass` is `undefined`. Miniflare resolves
each `durable_object_namespace` binding's `className` from the Worker's
exports — and the flueWorker's bundle (`dist/ditto/index.js`, built by Flue)
does NOT export `Sandbox` or `ProjectCoordinator`. Those classes are only
exported from the **website** Worker's `src/server.ts`:

```ts
export { Sandbox } from "@cloudflare/sandbox";
export { ProjectCoordinator };
```

The flueWorker binds `Sandbox` and `ProjectCoordinator` as
`DurableObjectNamespace` resources that were declared without `scriptName`.
Alchemy's `normalizeExportBindings` (in
`node_modules/.pnpm/alchemy@0.93.12_*/node_modules/alchemy/lib/cloudflare/worker.js:402-419`)
runs during dev and, for any DO binding with `scriptName === undefined`,
creates a new `DurableObjectNamespace` with `scriptName` set to the **current
Worker's own name**. This is correct for same-Worker DOs but WRONG for
cross-script DOs: it makes miniflare think `Sandbox` and `ProjectCoordinator`
are defined in the flueWorker's own bundle, when they're actually in the
website Worker.

The fix: explicitly set `scriptName` on the `Sandbox` and `ProjectCoordinator`
`DurableObjectNamespace` declarations to the website Worker's name. Since
`normalizeExportBindings` only sets `scriptName` when it's `undefined`, an
explicit value is preserved. When the website Worker is created,
`binding.scriptName === workerName` is true (same-Worker — correct, the class
IS exported from `src/server.ts`). When the flueWorker is created,
`binding.scriptName !== workerName` (cross-script — correct, miniflare
resolves the class from the website Worker's exports via a direct socket).

This was a **pre-existing issue** masked by the workflow `run` error. Plan
049 unblocked the earlier failure, exposing this one — exactly the "different
error" STOP condition that plan 049 anticipated.

## Current state

### `alchemy.run.ts` (the only file to modify)

The `Sandbox` and `ProjectCoordinator` DOs are declared at lines 21-24 and
34-37 without `scriptName`:

```ts
const sandbox = DurableObjectNamespace("sandbox", {
	className: "Sandbox",
	sqlite: true,
});

// ...

const projectCoordinator = DurableObjectNamespace("project-coordinator", {
	className: "ProjectCoordinator",
	sqlite: true,
});
```

Both are bound to BOTH Workers:

```ts
export const flueWorker = await Worker("flue-worker", {
	// ...
	bindings: {
		Sandbox: sandbox,                    // line 80
		ProjectCoordinator: projectCoordinator,  // line 81
		// ... Flue DOs + OPENCODE_API_KEY
	},
});

export const website = await TanStackStart("website", {
	// ...
	bindings: {
		// ...
		Sandbox: sandbox,                    // line 93
		ProjectCoordinator: projectCoordinator,  // line 95
		// ... other DOs + service bindings + secrets
	},
	wrangler: {
		main: "src/server.ts",
		transform: (spec) => ({
			// ...
			durable_objects: {
				...spec.durable_objects,
				bindings: [
					{ class_name: "Sandbox", name: "Sandbox" },
					// ...
					{ class_name: "ProjectCoordinator", name: "ProjectCoordinator" },
					// ...
				],
			},
			migrations: [
				{ new_sqlite_classes: ["Sandbox"], tag: "v1" },
				// ...
				{ new_sqlite_classes: ["ProjectCoordinator"], tag: "v3" },
				// ...
			],
		}),
	},
});
```

The `website` Worker does NOT set `name` explicitly — it defaults to
`this.scope.createPhysicalName("website").toLowerCase()`, which produces
`ditto-website-ayan` (pattern: `[appName, id, stage].join("-")`). The `app`
object (`const app = await alchemy("ditto")`) already exposes `app.name`
(`"ditto"`) and `app.stage` (`"ayan"`), used at lines 66 and 71 for the D1
database and R2 bucket names.

The `Sandbox` and `ProjectCoordinator` classes are only exported from
`src/server.ts` (the website Worker's entrypoint), NOT from the Flue-built
`dist/ditto/index.js` (the flueWorker's entrypoint). The Flue bundle only
exports `FlueProjectCoderAgent`, `FlueDittoProjectRunWorkflow`, `FlueRegistry`,
`default`, and `t` — verified by `grep "^export {" dist/ditto/index.js`.

### How alchemy resolves DO `scriptName` (the root cause)

`normalizeExportBindings` at `worker.js:402-419`:

```js
const normalizeExportBindings = (scriptName, bindings = {}) => {
    return Object.fromEntries(Object.entries(bindings).map(([bindingName, binding]) => [
        bindingName,
        isDurableObjectNamespace(binding) && binding.scriptName === undefined
            ? DurableObjectNamespace(binding.id, {
                ...binding,
                scriptName,  // set to the current Worker's own name
            })
            : // ...
    ]));
};
```

It only sets `scriptName` when it's `undefined`. If `scriptName` is already
set, the binding is used as-is. This means an explicit `scriptName` is
preserved through both Workers' `normalizeExportBindings` calls.

`buildWorkerOptions` at `build-worker-options.js:153-166` reads `scriptName`
for miniflare:

```js
case "durable_object_namespace": {
    (options.durableObjects ??= {})[key] = {
        className: binding.className,
        scriptName: binding.scriptName,   // used by miniflare to resolve the class
        useSQLite: binding.sqlite,
    };
    options.unsafeDirectSockets.push({
        entrypoint: binding.className,
        serviceName: binding.scriptName,  // used for cross-script DO resolution
        proxy: true,
    });
    break;
}
```

When `scriptName` is the flueWorker's own name (set by
`normalizeExportBindings`), miniflare looks for `Sandbox` in the flueWorker's
exports → `undefined` → `class Wrapper extends undefined` → TypeError. When
`scriptName` is the website Worker's name, miniflare resolves `Sandbox` from
the website Worker's exports via a direct socket → finds it → works.

## Commands you will need

| Purpose   | Command                                       | Expected on success |
|-----------|-----------------------------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit --pretty false`       | exit 0, no errors   |
| Tests     | `pnpm test`                                   | all pass (currently 23 files, 262 tests) |
| Lint      | `pnpm lint`                                   | exit 0 (2 known warnings are acceptable) |
| Build Flue| `pnpm flue:build`                             | exit 0; known DO migration warning from generated `.flue-vite.wrangler.jsonc` is acceptable |
| Dev smoke | `pnpm run dev`                                | reaches alchemy watching state with NO `ERR_RUNTIME_FAILURE`. Requires `.env.local`/`.env` — run in main checkout, NOT in an isolated worktree. |

## Scope

**In scope** (the only file you should modify):
- `alchemy.run.ts` — (1) add a `WEBSITE_WORKER_NAME` constant, (2) set `name: WEBSITE_WORKER_NAME` on the `TanStackStart("website", ...)` call, (3) add `scriptName: WEBSITE_WORKER_NAME` to the `sandbox` and `projectCoordinator` `DurableObjectNamespace` declarations.

**Out of scope** (do NOT touch):
- `.flue/agents/project-coder.ts` — the agent code uses `env.Sandbox` and `env.ProjectCoordinator` at runtime; the binding names are unchanged.
- `.flue/lib/project-mutating-tools.ts` — uses `env.ProjectCoordinator` and `env.Sandbox`; unchanged.
- `src/server.ts` — already exports `Sandbox` and `ProjectCoordinator`; no change needed.
- The `website` Worker's `wrangler.transform` — it explicitly lists `durable_objects.bindings` without `script_name` (same-Worker); setting `scriptName` on the `DurableObjectNamespace` does not affect the `wrangler.transform` output because the transform replaces `durable_objects.bindings` with its own list.
- The Flue DO declarations (`flueProjectCoderAgent`, `flueDittoProjectRunWorkflow`, `flueRegistry`) — these are same-Worker DOs in the flueWorker (classes ARE in the Flue bundle); they should NOT have `scriptName` set.
- `WorkspaceSessionBroker` and `FlueRunBridge` — only bound to the website Worker; no cross-script issue.
- Any UI, D1 schema, coordinator, or snapshot code.

## Git workflow

- Branch: `advisor/051-fix-cross-script-do-bindings`
- Single commit. Message (match the repo's conventional commits):
  - `fix(infra): mark sandbox and coordinator DOs as cross-script in flue worker`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `WEBSITE_WORKER_NAME` constant and set `scriptName` on the shared DO declarations

In `alchemy.run.ts`, add a constant after the `app` declaration (after line
14) that computes the website Worker's name from the app properties already
used elsewhere in the file:

```ts
const app = await alchemy("ditto");

const WEBSITE_WORKER_NAME = `${app.name}-website-${app.stage}`;
```

Then add `scriptName: WEBSITE_WORKER_NAME` to the `sandbox` and
`projectCoordinator` `DurableObjectNamespace` declarations.

Change the `sandbox` declaration (lines 21-24) from:

```ts
const sandbox = DurableObjectNamespace("sandbox", {
	className: "Sandbox",
	sqlite: true,
});
```

to:

```ts
const sandbox = DurableObjectNamespace("sandbox", {
	className: "Sandbox",
	scriptName: WEBSITE_WORKER_NAME,
	sqlite: true,
});
```

Change the `projectCoordinator` declaration (lines 34-37) from:

```ts
const projectCoordinator = DurableObjectNamespace("project-coordinator", {
	className: "ProjectCoordinator",
	sqlite: true,
});
```

to:

```ts
const projectCoordinator = DurableObjectNamespace("project-coordinator", {
	className: "ProjectCoordinator",
	scriptName: WEBSITE_WORKER_NAME,
	sqlite: true,
});
```

Do NOT add `scriptName` to any other `DurableObjectNamespace` declaration.
The Flue DOs (`flueProjectCoderAgent`, `flueDittoProjectRunWorkflow`,
`flueRegistry`) are same-Worker DOs in the flueWorker — their classes ARE in
the Flue bundle. `WorkspaceSessionBroker` and `FlueRunBridge` are only bound
to the website Worker — no cross-script issue.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0, no errors.

### Step 2: Set `name: WEBSITE_WORKER_NAME` on the `TanStackStart` call

In `alchemy.run.ts`, add `name: WEBSITE_WORKER_NAME` to the
`TanStackStart("website", ...)` call (currently line 89). This ensures the
website Worker's Cloudflare name is deterministic and matches the
`scriptName` value, regardless of any future change to alchemy's
`createPhysicalName` pattern.

Change:

```ts
export const website = await TanStackStart("website", {
	url: true,
	bindings: {
```

to:

```ts
export const website = await TanStackStart("website", {
	name: WEBSITE_WORKER_NAME,
	url: true,
	bindings: {
```

Do NOT change any other property of the `TanStackStart` call. The `url`,
`bindings`, and `wrangler` sections stay exactly as-is.

**Why this is needed**: Without setting `name` explicitly, the website
Worker's name defaults to `this.scope.createPhysicalName("website").toLowerCase()`.
If this pattern ever changes in a future alchemy version, the `scriptName`
on the DO declarations would no longer match the website Worker's actual
name, silently breaking the cross-script DO resolution. Setting `name`
explicitly makes the contract self-enforcing.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0, no errors.

### Step 3: Run the full verification gate

**Verify** (run all):
- `pnpm flue:build` → exit 0 (known DO migration warning from generated `.flue-vite.wrangler.jsonc` is acceptable).
- `pnpm exec tsc --noEmit --pretty false` → exit 0
- `pnpm test` → exit 0, all tests pass (expect 23 files / 262 tests; no new failures)
- `pnpm lint` → exit 0 (the 2 known warnings are acceptable)
- `git diff --check` → exit 0 (no whitespace errors)

### Step 4: Dev smoke test (the actual unblock)

This step requires `.env.local`/`.env` to be present — run it in the main
checkout, NOT in an isolated worktree (env files are gitignored).

Run `pnpm run dev`. This runs `pnpm flue:build && alchemy dev`.

**Expected**: `Alchemy (v0.93.12)` → `App: ditto` → resource creation →
`[created]` or `[skipped]` for `database`, `sandbox-backups`, `flue-worker`,
`website` → running miniflare with NO `ERR_RUNTIME_FAILURE` and NO
`Class extends value undefined is not a constructor or null`.

Stop the dev server with Ctrl-C once it reaches the watching state. You do
not need to send a chat message — this plan verifies the Worker starts, not
the end-to-end agent loop.

**If `alchemy dev` fails with a DIFFERENT error** (not the `Class extends
value undefined` error), record the exact error and report it as a STOP
condition. This plan's scope is the cross-script DO binding issue; a new
error implies a separate finding.

## Test plan

No new automated tests are required:

- The fix is an infrastructure declaration change in `alchemy.run.ts`. The
  `DurableObjectNamespace` `scriptName` field is a standard alchemy prop
  (documented in `durable-object-namespace.d.ts:7`).
- `pnpm test` confirms no existing tests break (the test suite doesn't
  exercise alchemy's `normalizeExportBindings` or miniflare DO resolution).
- `pnpm exec tsc --noEmit --pretty false` confirms the `name` prop is
  accepted by `TanStackStart` (it inherits from `BaseWorkerProps` which has
  `name?: string`).
- The dev smoke (Step 4) is the real verification — it confirms miniflare
  resolves `Sandbox` and `ProjectCoordinator` from the website Worker.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0
- [ ] `pnpm test` exits 0 (23 files, 262 tests, no new failures)
- [ ] `pnpm lint` exits 0 (2 known warnings acceptable)
- [ ] `pnpm flue:build` exits 0
- [ ] `grep -n "WEBSITE_WORKER_NAME" alchemy.run.ts` returns at least 3 matches (constant + 2 scriptName usages + 1 name usage = 4, but at least 3)
- [ ] `grep -n "scriptName: WEBSITE_WORKER_NAME" alchemy.run.ts` returns exactly 2 matches (sandbox + projectCoordinator)
- [ ] `grep -n "name: WEBSITE_WORKER_NAME" alchemy.run.ts` returns exactly 1 match (the TanStackStart call)
- [ ] No files outside the in-scope list are modified (`git status --short` lists only `alchemy.run.ts`)
- [ ] `plans/README.md` status row for 051 updated — SKIP if a reviewer dispatched you and maintains the index.
- [ ] Dev smoke (if run in main checkout): `pnpm run dev` reaches watching state with NO `ERR_RUNTIME_FAILURE` and NO `Class extends value undefined`.

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `alchemy.run.ts` doesn't match the "Current state" excerpts
  (the codebase has drifted). Run the drift check at the top first.
- `TanStackStart` does not accept a `name` prop — verify by reading
  `node_modules/.pnpm/alchemy@0.93.12_*/node_modules/alchemy/lib/cloudflare/website.d.ts`.
  `WebsiteProps` extends `Omit<WorkerProps, "assets" | "dev">`, and
  `BaseWorkerProps` has `name?: string`. If this has changed in the installed
  version, STOP.
- `DurableObjectNamespace` does not accept `scriptName` — verify by reading
  `node_modules/.pnpm/alchemy@0.93.12_*/node_modules/alchemy/lib/cloudflare/durable-object-namespace.d.ts`.
  The `DurableObjectNamespaceProps` interface should have `scriptName?: string`.
  If it doesn't, STOP — the installed alchemy version may not support
  cross-script DO bindings this way.
- `pnpm run dev` in Step 4 fails with an error OTHER than the `Class extends
  value undefined` error. Record the exact error text and stop — a different
  failure is a separate finding that needs its own plan.
- The `app` object doesn't have `name` or `stage` properties — verify by
  checking `alchemy.run.ts` lines 66 and 71 where they're already used. If
  those lines don't exist or use different property names, STOP.

## Maintenance notes

- **Cross-script DO bindings are the correct pattern for shared DOs.** When
  a DO class is exported from one Worker (the "owner") and bound to another
  Worker (the "consumer"), the consumer's `DurableObjectNamespace` must set
  `scriptName` to the owner's Worker name. Without it, alchemy's
  `normalizeExportBindings` assumes the DO is same-Worker, and miniflare
  fails to find the class in the consumer's exports.
- **The `WEBSITE_WORKER_NAME` constant is the single source of truth.** Both
  the `scriptName` on the DO declarations and the `name` on the
  `TanStackStart` call reference it. If the website Worker's name ever needs
  to change, update the constant — everything else follows.
- **Which DOs need `scriptName`?** Only `Sandbox` and `ProjectCoordinator`
  — they're the only DOs bound to BOTH Workers where the class lives in the
  website Worker. The three Flue DOs
  (`FlueProjectCoderAgent`/`FlueDittoProjectRunWorkflow`/`FlueRegistry`) are
  same-Worker DOs in the flueWorker (classes in the Flue bundle).
  `WorkspaceSessionBroker` and `FlueRunBridge` are only bound to the website
  Worker. If a future DO is shared across Workers, check which Worker exports
  its class and set `scriptName` accordingly.
- **The `.flue-vite.wrangler.jsonc` migration warning persists.** That file
  is generated by `pnpm flue:build` and is gitignored (`.gitignore:12`). It
  is the Flue Vite-plugin dev config, not the alchemy deploy config. It does
  not block dev or deploy. See plan 049's reconciliation note for details.
- **Reviewer focus**: confirm that `scriptName` is set on ONLY `sandbox` and
  `projectCoordinator` (not on any Flue DO), and that `name:
  WEBSITE_WORKER_NAME` is set on the `TanStackStart` call.
- **Follow-up explicitly deferred**: a full end-to-end agent smoke (send a
  chat message → Flue dispatch → Pi call → stream → terminal) is out of
  scope. This plan only fixes the Worker startup failure. The end-to-end
  loop should be exercised separately once dev is running.
