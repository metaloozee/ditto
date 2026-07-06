# Plan 049: Fix Flue Workflow `run` Export (dev unblock)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat b4b7b0e..HEAD -- .flue/workflows/ditto-project-run.ts`
> If the in-scope file changed since this plan was written, compare the
> "Current state" excerpt against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (this unblocks all prior DONE plans in dev)
- **Category**: bug
- **Planned at**: commit `b4b7b0e`, 2026-07-06
- **Reconciled**: 2026-07-06 — the original plan also proposed adding
  `wrangler: { migrations: [...] }` to the `flueWorker` declaration in
  `alchemy.run.ts`. That step was **dropped** after investigation (see
  "Reconciliation note" below). This plan is now the single workflow-export
  fix only.

## Reconciliation note (why the migration step was dropped)

The original plan had a second step: add a `wrangler.migrations` entry for
the three Flue SQLite Durable Objects (`FlueProjectCoderAgent`,
`FlueDittoProjectRunWorkflow`, `FlueRegistry`) to the `flueWorker`
`Worker(...)` call in `alchemy.run.ts`. Investigation against the installed
`alchemy@0.93.12` type definitions and runtime proved this step was both
**technically infeasible** and **unnecessary**:

1. **Not a valid prop.** The alchemy `Worker(...)` function accepts
   `WorkerProps` = `InlineWorkerProps | EntrypointWorkerProps`, both extending
   `BaseWorkerProps` (see
   `node_modules/.pnpm/alchemy@0.93.12_*/node_modules/alchemy/lib/cloudflare/worker.d.ts`).
   `BaseWorkerProps` has **no `wrangler` field**. The `wrangler` field exists
   only on `WebsiteProps`/`TanStackStart` (see `.../cloudflare/website.d.ts:86`),
   which is what the `website` Worker uses. Adding `wrangler: { migrations: ... }`
   to a plain `Worker(...)` call is an excess-property error — `pnpm exec tsc
   --noEmit` would fail. There is no top-level `migrations` field on `Worker`
   either.
2. **Deploy auto-derives migrations.** `prepareWorkerMetadata` in
   `.../cloudflare/worker-metadata.js` automatically pushes every
   `durable_object_namespace` binding with `sqlite: true` into
   `meta.migrations.new_sqlite_classes` (lines 460-466) when no prior binding
   exists. The three Flue DOs are all declared `sqlite: true` in
   `alchemy.run.ts`, so the deploy API metadata already includes them.
   "Breaking deployability" (the original plan's claim) is incorrect.
3. **Dev (miniflare) doesn't use migrations.** `MiniflareController` +
   `buildWorkerOptions` build the local emulation config programmatically from
   the `Worker(...)` props; migrations are a wrangler.jsonc / Cloudflare-API
   deploy concept, not a miniflare runtime concept. No alchemy wrangler.jsonc
   is generated for a plain `Worker` (only `Website`/`TanStackStart` creates a
   `WranglerJson` resource).
4. **The visible warning is from the generated, gitignored
   `.flue-vite.wrangler.jsonc`.** That file (produced by `pnpm flue:build`,
   listed in `.gitignore:12`) contains the three Flue DO `durable_objects`
   bindings with no `migrations` array. It is regenerated on every Flue build,
   so hand-editing it is pointless, and it is explicitly out of scope per the
   original plan's own maintenance notes. It does not block dev or deploy.

Net: the only actionable, in-scope fix is the workflow `run` export. Step 2
was dropped; `alchemy.run.ts` is now explicitly out of scope.

## Why this matters

`pnpm run dev` (which runs `pnpm flue:build && alchemy dev`) fails before the
app starts. The built Flue Worker throws at module init:

```
[flue] Workflow "ditto-project-run" must export a callable run value.
  at .../index.js:150883:46 in normalizeBuiltModules
MiniflareCoreError [ERR_RUNTIME_FAILURE]: The Workers runtime failed to start.
```

This blocks all local development and verification of the five implemented
PRD phases (0–4 plus Phase 5 plans 044–048, all marked DONE). `tsc --noEmit`
passes because the failure is a Flue **runtime contract**, not a TypeScript
type — Flue's `normalizeBuiltModules` checks `typeof mod.run !== 'function'`
at Worker `__init`, and the workflow file only has a `default` export. The
fix is a one-line rename of the export shape. Once it lands, `pnpm run dev`
reaches a running miniflare (a cosmetic Durable Object migration warning from
the generated `.flue-vite.wrangler.jsonc` may still appear — it is gitignored,
out of scope, and non-fatal; see the reconciliation note).

## Current state

### `.flue/workflows/ditto-project-run.ts` (the FATAL blocker)

Role: the mutating-run workflow. `src/lib/flue-dispatch-adapter.ts`
(`dispatchMutatingProjectRun`) POSTs to
`https://flue.internal/ditto/project-runs/start`, and `.flue/app.ts` forwards
that to `POST /workflows/ditto-project-run`. So this workflow is the live
mutating execution path — it is not vestigial.

The current file (lines 16, 49-69):

```ts
export const route: WorkflowRouteHandler = async (_c, next) => next();   // line 16 — CORRECT

// ...

export default async function dittoProjectRun(                            // line 49 — WRONG
	ctx: FlueContext<unknown, DittoProjectRunEnv>,
) {
	const payload = parsePayload(ctx.payload);
	const harness = await ctx.init(projectCoderAgent, {
		name: "mutating",
	});
	const session = await harness.session(payload.runId);
	const result = await session.prompt(payload.message, {
		model: payload.modelSpecifier,
		tools: createMutatingProjectTools(ctx.env, payload),
	});

	ctx.log.info("Ditto mutating project run completed.", {
		projectId: payload.projectId,
		sessionId: payload.sessionId,
		runId: payload.runId,
	});

	return result;
}
```

**Why it's wrong**: Flue's runtime validator requires a **named `run` export**.
The validator is generated into every build at
`node_modules/.pnpm/@flue+cli@1.0.0-beta.1_*/node_modules/@flue/cli/dist/flue.js:208`
(verified):

```js
for (const [name, mod] of Object.entries(workflowModules)) {
  if (typeof mod.run !== 'function') throw new Error('[flue] Workflow "' + name + '" must export a callable run value.');
  ...
  localWorkflowHandlers[name] = mod.run;
  if (transports.http) workflowHandlers[name] = mod.run;
}
```

A `default` export is ignored by the workflow normalizer — only `mod.run` is
read. The Flue docs state this explicitly
(`node_modules/@flue+runtime@1.0.0-beta.1_*/node_modules/@flue/runtime/docs/guide/workflows.md:11`):

> "In a Flue project, a workflow is a file in `src/workflows/` that exports a
> `run(...)` function."

Every official example uses the named-export shape, e.g.
`.../docs/ecosystem/deploy/cloudflare.md`:

```ts
export const route: WorkflowRouteHandler = async (_c, next) => next();
export async function run({ init, payload }: FlueContext<{ text: string; language: string }>) { ... }
```

The sibling agent file `.flue/agents/project-coder.ts` is correctly shaped
(`export default createAgent(...)` plus `export const route` at line 18) —
agents require `default`, workflows require `run`. Do not touch the agent
file; its contract is different and already correct.

## Commands you will need

| Purpose   | Command                                       | Expected on success |
|-----------|-----------------------------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit --pretty false`       | exit 0, no errors   |
| Tests     | `pnpm test`                                   | all pass (currently 23 files, 262 tests) |
| Lint      | `pnpm lint`                                   | exit 0 (2 known warnings are acceptable) |
| Build Flue| `pnpm flue:build`                             | exit 0; prints `done built dist` / `done ready dist`; a Durable Object migration warning from the generated `.flue-vite.wrangler.jsonc` may still appear — that file is generated, gitignored, and out of scope; it is non-fatal |
| Dev smoke | `pnpm run dev`                                | reaches `Alchemy (v0.93.12)` then `[created]`/`[skipped]` resources and a running miniflare — NO `ERR_RUNTIME_FAILURE`, NO `[flue] Workflow ... must export a callable run value` line. Stop it with Ctrl-C once it's running. |

(Exact commands from this repo — verified during recon. `pnpm test` runs
`vitest run --passWithNoTests`. `pnpm dev` is `pnpm flue:build && alchemy dev`.)

## Scope

**In scope** (the only file you should modify):
- `.flue/workflows/ditto-project-run.ts` — rename the default export to a named `run` export.

**Out of scope** (do NOT touch, even though they look related):
- `alchemy.run.ts` — the original plan proposed adding `wrangler.migrations`
  to the `flueWorker` here; that step was dropped (see "Reconciliation note").
  The `flueWorker`'s Durable Object migrations are auto-derived by alchemy at
  deploy time, and the dev (miniflare) path does not use migrations. Do not
  modify this file.
- `.flue/agents/project-coder.ts` — agents use `export default createAgent(...)`;
  that contract is already correct. The workflow contract is different.
- `.flue/lib/project-mutating-tools.ts` — no export-shape issue.
- `.flue/app.ts` — the `/ditto/project-runs/start` →
  `/workflows/ditto-project-run` forwarding is correct.
- `.flue-vite.wrangler.jsonc` — this is a *generated, gitignored* file (see
  `.gitignore` line 12). Do not hand-edit it; `pnpm flue:build` regenerates it.
  Its Durable Object migration warning is expected, non-fatal, and out of scope.
- `src/lib/flue-dispatch-adapter.ts` and its test — they reference the workflow
  by name string (`"ditto-project-run"`), which is unaffected by the export
  rename.
- Any UI, D1 schema, coordinator, or snapshot code.

## Git workflow

- Branch: `advisor/049-flue-workflow-run-export`
- Single commit. Message style — match the repo's conventional commits seen
  in `git log`:
  - `fix(flue): export named run from ditto-project-run workflow`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Rename the workflow's default export to a named `run` export

In `.flue/workflows/ditto-project-run.ts`, change **only** the export shape of
the workflow function. Keep `export const route` exactly as-is (line 16). Keep
the function body, the `parsePayload` helper, the `requireString` helper, the
imports, and the types byte-for-byte unchanged.

Change line 49 from:

```ts
export default async function dittoProjectRun(
	ctx: FlueContext<unknown, DittoProjectRunEnv>,
) {
```

to:

```ts
export async function run(
	ctx: FlueContext<unknown, DittoProjectRunEnv>,
) {
```

That is the entire change to this file: remove the `default` keyword and
rename the local function name `dittoProjectRun` → `run` (the function name is
not load-bearing — Flue reads `mod.run`, not the function's `.name` — but
naming it `run` matches every Flue docs example and avoids confusion). Nothing
else in the file changes. Do not add or remove any import. Do not touch the
`route` export. Do not touch `parsePayload`/`requireString`.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0, no errors.

### Step 2: Rebuild Flue and confirm the workflow validator no longer throws

**Verify**: `pnpm flue:build` → exit 0. The build output should print
`done built dist` and `done ready dist`. A Durable Object migration warning
from the generated `.flue-vite.wrangler.jsonc` may still appear (that file is
generated, gitignored, and out of scope) — what matters is that the build
itself succeeds and the *final bundled output* no longer throws at init.

### Step 3: Run the full verification gate

**Verify** (run all four):
- `pnpm exec tsc --noEmit --pretty false` → exit 0
- `pnpm test` → exit 0, all tests pass (expect 23 files / 262 tests; no new failures)
- `pnpm lint` → exit 0 (the 2 known warnings are acceptable — same as before)
- `git diff --check` → exit 0 (no whitespace errors)

### Step 4: Dev smoke test (the actual unblock)

Run `pnpm run dev`. This runs `pnpm flue:build && alchemy dev`.

**Expected**: the output reaches `Alchemy (v0.93.12)`, prints `App: ditto` /
`Phase: up` / `Stage: ayan`, then `[skipped]`/`[creating]` resource lines for
`database`, `sandbox-backups`, `flue-worker`, `website`, and finally a running
miniflare (it will watch for file changes). The `flue-worker` resource should
create without the `Uncaught Error: [flue] Workflow "ditto-project-run" must
export a callable run value` line, and there should be NO
`MiniflareCoreError [ERR_RUNTIME_FAILURE]`.

Stop the dev server with Ctrl-C once it has reached the running/watching state
(you do not need to open a browser). If `alchemy dev` reaches the watching
state without `ERR_RUNTIME_FAILURE`, the plan is done.

**If `alchemy dev` fails with a DIFFERENT error** (not the workflow `run`
error), do not attempt to fix it within this plan — record the exact error and
report it as a STOP condition. This plan's scope is the single issue above; a
new error implies a separate finding that deserves its own plan.

## Test plan

No new automated tests are required for this plan, and here is the reasoning
to apply rather than a rote instruction:

- The FATAL bug is a Flue runtime contract that is enforced at Worker init in
  generated, bundled code (`normalizeBuiltModules`). It is not reachable from
  a unit test without standing up miniflare. The correct automated gate is the
  `pnpm flue:build` + `pnpm run dev` smoke in Step 4 — which is the
  reproduction case the user reported.
- The existing `src/lib/flue-dispatch-adapter.test.ts` references the workflow
  only by the name string `"ditto-project-run"` (lines 159-165), which is
  unaffected by renaming the export. It must continue to pass — that is
  verified by `pnpm test` in Step 3.

If a reviewer prefers a regression guard, an acceptable (optional, not
required) addition is a Vitest test that dynamically imports
`../../.flue/workflows/ditto-project-run` and asserts `typeof mod.run ===
'function'` and `mod.route` is a function — modeled after the import-style
assertions in `src/lib/flue-agent-route-contract.test.ts`. Do not add this
unless the reviewer asks; it imports source outside `src/` and may interact
with the Flue build.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0
- [ ] `pnpm test` exits 0 (23 files, 262 tests, no new failures)
- [ ] `pnpm lint` exits 0 (2 known warnings acceptable)
- [ ] `pnpm flue:build` exits 0
- [ ] `pnpm run dev` reaches the alchemy watching/running state with NO `ERR_RUNTIME_FAILURE` and NO `[flue] Workflow "ditto-project-run" must export a callable run value` line
- [ ] `grep -n "export default" .flue/workflows/ditto-project-run.ts` returns no matches
- [ ] `grep -n "export async function run" .flue/workflows/ditto-project-run.ts` returns exactly one match
- [ ] No files outside the in-scope list are modified (`git status --short` lists only `.flue/workflows/ditto-project-run.ts`)
- [ ] `plans/README.md` status row for 049 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `.flue/workflows/ditto-project-run.ts:49` doesn't match the
  "Current state" excerpt (the codebase has drifted since this plan was
  written). Run the drift check at the top first.
- After Step 1, `tsc` reports an error on the workflow file — the `FlueContext`
  / `WorkflowRouteHandler` imports must still resolve (they're type-only
  imports from `@flue/runtime`); if they don't, the installed Flue version has
  changed and this plan's assumption is false.
- `pnpm run dev` in Step 4 fails with an error OTHER than the one this plan
  targets. Record the exact error text and stop — a different failure is a
  separate finding that needs its own plan, not an excuse to expand scope.
- You discover the workflow is actually unused/vestigial and could simply be
  deleted instead of fixed. (Recon says it IS used: `flue-dispatch-adapter.ts`
  `dispatchMutatingProjectRun` → `/ditto/project-runs/start` →
  `.flue/app.ts` → `/workflows/ditto-project-run`. If that call chain is gone,
  STOP and report rather than deleting.)

## Maintenance notes

For the human/agent who owns this code after the change lands:

- **Workflow export contract is now a known footgun.** Flue agents require
  `export default createAgent(...)`; Flue workflows require `export const run`
  or `export async function run(...)`. They look similar but are NOT
  interchangeable, and `tsc` will not catch a mismatch — only the Flue runtime
  validator at Worker init catches it. When adding any new
  `.flue/workflows/*.ts` file, follow the `export async function run(...)` +
  optional `export const route: WorkflowRouteHandler` shape. A repo-level
  lint or a `flue-agent-route-contract.test.ts`-style import test could guard
  this; consider adding one if more workflows appear.
- **The `.flue-vite.wrangler.jsonc` Durable Object migration warning is
  expected to persist.** That file is generated by `pnpm flue:build` and is
  gitignored (`.gitignore:12`). It is the Flue Vite-plugin dev config, not the
  alchemy deploy config. Do not hand-edit it. The alchemy `flueWorker` (a plain
  `Worker`) does not generate its own wrangler.jsonc and auto-derives
  `new_sqlite_classes` for `sqlite: true` DO bindings at deploy time
  (`worker-metadata.js`), so no manual migration entry is needed in
  `alchemy.run.ts`. If a future Flue version stops emitting the warning or
  requires a different fix, handle that in its own plan.
- **Reviewer focus**: confirm the workflow function body is byte-for-byte
  unchanged (only the `export` keyword and function name changed), and that
  `export const route` is untouched.
- **Follow-up explicitly deferred**: a broader "does the full mutating chat
  loop actually complete end-to-end in dev" smoke (auth → project → sandbox →
  mutating run → stream → terminal → snapshot) is out of scope for this plan.
  This plan only unblocks `pnpm run dev` to reach a running state. The
  end-to-end loop is the substance of the five DONE phases and should be
  exercised separately once dev starts.
