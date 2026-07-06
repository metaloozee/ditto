# Plan 052: Export Shared DO Classes from the Flue Bundle via `.flue/cloudflare.ts`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 212b92d..HEAD -- alchemy.run.ts .flue/cloudflare.ts`
> If either in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 051 (must be merged — this plan reverts 051's `scriptName`/`name` changes and replaces them with a different approach)
- **Category**: bug
- **Planned at**: commit `212b92d`, 2026-07-06

## Why this matters

After plan 051 set `scriptName: WEBSITE_WORKER_NAME` on the `Sandbox` and
`ProjectCoordinator` DO declarations to fix the `Class extends value
undefined` error, `pnpm run dev` hit a NEW error:

```
Socket "direct:0:Sandbox" refers to a service "core:user:ditto-website-ayan", but no such service is defined.
MiniflareCoreError [ERR_RUNTIME_FAILURE]: The Workers runtime failed to start.
```

This is an **ordering issue**: the `flueWorker` is created before the
`website` Worker (line 76 vs line 93 in `alchemy.run.ts`). When the flueWorker
is registered with miniflare, its cross-script DO direct sockets point to
`ditto-website-ayan`, but that service doesn't exist yet because the website
Worker hasn't been registered. The dependency is circular: `flueWorker` needs
the website Worker's DO classes, and `website` needs `FLUE_WORKER: flueWorker`
as a service binding.

**The fix**: instead of cross-script DO bindings (which require the target
Worker to be registered first), make the Flue bundle export the `Sandbox` and
`ProjectCoordinator` classes itself. Then the DOs resolve as same-Worker DOs
in the flueWorker — miniflare finds the classes in the flueWorker's own
exports. No cross-script resolution, no ordering issue.

Flue's build process supports a `.flue/cloudflare.ts` file: when it exists,
the build does `export * from ".flue/cloudflare.ts"` in the generated Worker
entrypoint (verified in
`node_modules/.pnpm/@flue+cli@1.0.0-beta.1_*/dist/flue.js:378-379`). Any named
export from `.flue/cloudflare.ts` becomes a Worker export in the final bundle.
The reserved-names check only blocks `FlueProjectCoderAgent`,
`FlueDittoProjectRunWorkflow`, and `FlueRegistry` — `Sandbox` and
`ProjectCoordinator` are NOT reserved.

This approach:
- **Dev**: same-Worker DO resolution works (classes are in the Flue bundle).
  No cross-script sockets, no ordering issue. Dev server starts.
- **Prod**: the flueWorker's `Sandbox` and `ProjectCoordinator` DOs are
  separate namespaces from the website Worker's. This is a known limitation
  — the flueWorker's agent code accesses `Sandbox` by `sandboxId`, and in
  production the DOs need to be shared (cross-script). That shared-DO issue
  is a separate, harder problem (may require an alchemy framework fix for
  dev-mode ordering). This plan's goal is to unblock `pnpm run dev` so the
  5 implemented PRD phases can be verified. The end-to-end agent smoke
  (which requires shared DO state) is explicitly deferred.

## Current state

### `alchemy.run.ts` (after plan 051 — to be reverted)

Plan 051 added three things that this plan reverts:

1. `const WEBSITE_WORKER_NAME = \`${app.name}-website-${app.stage}\`;` (line 16)
2. `scriptName: WEBSITE_WORKER_NAME,` on `sandbox` (line 24) and `projectCoordinator` (line 38)
3. `name: WEBSITE_WORKER_NAME,` on `TanStackStart` (line 92)

After revert, the `sandbox` and `projectCoordinator` declarations go back to
no `scriptName` (same-Worker DOs in both Workers), and the `TanStackStart`
call goes back to no explicit `name` (uses alchemy's default).

### `.flue/cloudflare.ts` (does not exist — to be created)

The file does not exist. The Flue build's `discoverOptionalEntry(sourceRoot,
"cloudflare")` function (at `flue.js:1744`) looks for `.flue/cloudflare.ts`
(or `.mts`/`.js`/`.mjs`). When absent, `userCloudflare = {}` and no
`export *` is added. When present, the build adds both an `import * as
userCloudflareModule from ".flue/cloudflare.ts"` and an
`export * from ".flue/cloudflare.ts"` to the generated Worker entrypoint.

The `.flue/` directory already imports from `../../src/` — e.g.,
`.flue/agents/project-coder.ts:5` does
`import { redactSecrets } from "../../src/lib/secret-redaction"` and
`.flue/lib/project-mutating-tools.ts:7` imports from
`../../src/lib/project-coordinator`. So cross-directory imports into `src/`
work in the Flue build context.

The `Sandbox` class is exported from `@cloudflare/sandbox` (already a
dependency; `.flue/agents/project-coder.ts:1` already imports from it).

The `ProjectCoordinator` class is defined in `src/lib/project-coordinator.ts:492`
(`export class ProjectCoordinator extends DurableObject<Env>`) and imports
`DurableObject` from `cloudflare:workers` (line 1). The Flue build context
already supports `cloudflare:workers` (the generated code imports `env` from
it).

### How Flue's `cloudflare.ts` re-export works (verified)

The Flue build template (`flue.js:425-426`):

```js
${userCloudflareImport}     // import * as userCloudflareModule from ".flue/cloudflare.ts";
${userCloudflareReExport}   // export * from ".flue/cloudflare.ts";
```

And (`flue.js:466`):

```js
const userCloudflare = ${userCloudflareValue};  // userCloudflareModule or {}
```

The `export *` re-exports all named exports from `.flue/cloudflare.ts` as
Worker exports in the final bundle. The `userCloudflareModule` is used for
the `cloudflareHandlers` (the `default` export's non-HTTP handlers), which is
separate from the named-export re-exports.

The reserved-names check (`flue.js:468-471`):

```js
for (const name of Object.keys(userCloudflare)) {
    if (name === "default") continue;
    if (reservedCloudflareExportNames.has(name)) throw new Error(...);
}
```

Reserved names: `FlueProjectCoderAgent`, `FlueDittoProjectRunWorkflow`,
`FlueRegistry`. `Sandbox` and `ProjectCoordinator` are NOT reserved — the
re-export will not conflict.

## Commands you will need

| Purpose   | Command                                       | Expected on success |
|-----------|-----------------------------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit --pretty false`       | exit 0, no errors   |
| Tests     | `pnpm test`                                   | all pass (currently 23 files, 262 tests) |
| Lint      | `pnpm lint`                                   | exit 0 (2 known warnings are acceptable) |
| Build Flue| `pnpm flue:build`                             | exit 0; the build should show `.flue/cloudflare.ts` being processed; known DO migration warning from generated `.flue-vite.wrangler.jsonc` is acceptable |
| Dev smoke | `pnpm run dev`                                | reaches alchemy watching state with NO `ERR_RUNTIME_FAILURE`. Requires `.env.local`/`.env` — run in main checkout, NOT in an isolated worktree. |

## Scope

**In scope** (the only files you should modify or create):
- `alchemy.run.ts` — revert plan 051's changes: remove `WEBSITE_WORKER_NAME` constant, remove `scriptName: WEBSITE_WORKER_NAME` from `sandbox` and `projectCoordinator`, remove `name: WEBSITE_WORKER_NAME` from `TanStackStart`.
- `.flue/cloudflare.ts` — NEW file: re-export `Sandbox` and `ProjectCoordinator` so the Flue bundle includes them as Worker exports.

**Out of scope** (do NOT touch):
- `.flue/agents/project-coder.ts` — the agent code uses `env.Sandbox` and `env.ProjectCoordinator` at runtime; the binding names are unchanged.
- `.flue/lib/project-mutating-tools.ts` — uses `env.ProjectCoordinator` and `env.Sandbox`; unchanged.
- `src/server.ts` — already exports `Sandbox` and `ProjectCoordinator` for the website Worker; no change needed.
- `src/lib/project-coordinator.ts` — the class definition; no change needed.
- The Flue DO declarations (`flueProjectCoderAgent`, `flueDittoProjectRunWorkflow`, `flueRegistry`) — these are already in the Flue bundle; no change.
- Any UI, D1 schema, coordinator, or snapshot code.

## Git workflow

- Branch: `advisor/052-flue-cloudflare-ts-do-exports`
- Single commit. Message (match the repo's conventional commits):
  - `fix(flue): export shared DO classes from flue bundle via cloudflare.ts`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `.flue/cloudflare.ts` with the DO class re-exports

Create a new file `.flue/cloudflare.ts` with the following content:

```ts
export { Sandbox } from "@cloudflare/sandbox";
export { ProjectCoordinator } from "../src/lib/project-coordinator";
```

That is the entire file. Two re-exports:
- `Sandbox` from `@cloudflare/sandbox` — the Container DO class that the
  website Worker exports from `src/server.ts`.
- `ProjectCoordinator` from `../src/lib/project-coordinator` — the
  `DurableObject` class defined at `src/lib/project-coordinator.ts:492`.

Do NOT add a `default` export — the Flue build's `cloudflareHandlers` logic
expects the `default` export to be an object of non-HTTP Worker handlers, and
an incorrect default would throw at init. No default means
`cloudflareHandlers = {}`, which is the current behavior.

Do NOT export anything else — only `Sandbox` and `ProjectCoordinator`. Other
exports would bloat the Flue bundle unnecessarily.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0, no errors.
(The file is new; `tsc` should accept the imports since `@cloudflare/sandbox`
and `src/lib/project-coordinator` are already in the project.)

### Step 2: Revert plan 051's changes to `alchemy.run.ts`

Remove the three additions plan 051 made:

**2a. Remove the `WEBSITE_WORKER_NAME` constant.**

Change (line 16):

```ts
const app = await alchemy("ditto");

const WEBSITE_WORKER_NAME = `${app.name}-website-${app.stage}`;
```

to:

```ts
const app = await alchemy("ditto");
```

**2b. Remove `scriptName: WEBSITE_WORKER_NAME` from the `sandbox` declaration.**

Change:

```ts
const sandbox = DurableObjectNamespace("sandbox", {
	className: "Sandbox",
	scriptName: WEBSITE_WORKER_NAME,
	sqlite: true,
});
```

to:

```ts
const sandbox = DurableObjectNamespace("sandbox", {
	className: "Sandbox",
	sqlite: true,
});
```

**2c. Remove `scriptName: WEBSITE_WORKER_NAME` from the `projectCoordinator` declaration.**

Change:

```ts
const projectCoordinator = DurableObjectNamespace("project-coordinator", {
	className: "ProjectCoordinator",
	scriptName: WEBSITE_WORKER_NAME,
	sqlite: true,
});
```

to:

```ts
const projectCoordinator = DurableObjectNamespace("project-coordinator", {
	className: "ProjectCoordinator",
	sqlite: true,
});
```

**2d. Remove `name: WEBSITE_WORKER_NAME` from the `TanStackStart` call.**

Change:

```ts
export const website = await TanStackStart("website", {
	name: WEBSITE_WORKER_NAME,
	url: true,
```

to:

```ts
export const website = await TanStackStart("website", {
	url: true,
```

After all four sub-steps, `alchemy.run.ts` should be back to its pre-051 state
(equivalent to the state after plan 050). Verify with:
`grep -n "WEBSITE_WORKER_NAME\|scriptName" alchemy.run.ts` → no matches.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0, no errors.

### Step 3: Rebuild Flue and verify the DO classes appear in the bundle

Run `pnpm flue:build`. The build output should show the `cloudflare` entry
being processed (it may appear in the build output alongside `agents` and
`workflows`).

**Verify**:
- `pnpm flue:build` → exit 0 (known DO migration warning from generated
  `.flue-vite.wrangler.jsonc` is acceptable).
- `grep -n "export.*Sandbox\b" dist/ditto/index.js` → at least one match
  (the `Sandbox` class re-export from the Flue bundle).
- `grep -n "export.*ProjectCoordinator\b" dist/ditto/index.js` → at least one
  match (the `ProjectCoordinator` class re-export from the Flue bundle).

If the classes do NOT appear in the bundle, the `.flue/cloudflare.ts` file was
not picked up by the Flue build. Verify the file is at `.flue/cloudflare.ts`
(not in a subdirectory). If the build still doesn't pick it up, STOP — the
installed Flue version may not support `cloudflare.ts`.

### Step 4: Run the full verification gate

**Verify** (run all):
- `pnpm exec tsc --noEmit --pretty false` → exit 0
- `pnpm test` → exit 0, all tests pass (expect 23 files / 262 tests; no new failures)
- `pnpm lint` → exit 0 (the 2 known warnings are acceptable)
- `git diff --check` → exit 0 (no whitespace errors)

### Step 5: Dev smoke test (the actual unblock)

This step requires `.env.local`/`.env` to be present — run it in the main
checkout, NOT in an isolated worktree (env files are gitignored).

Run `pnpm run dev`. This runs `pnpm flue:build && alchemy dev`.

**Expected**: `Alchemy (v0.93.12)` → `App: ditto` → resource creation →
`[created]` or `[skipped]` for `database`, `sandbox-backups`, `flue-worker`,
`website` → running miniflare with NO `ERR_RUNTIME_FAILURE` and NO
`Class extends value undefined` and NO `no such service is defined`.

Stop the dev server with Ctrl-C once it reaches the watching state. You do
not need to send a chat message — this plan verifies the Worker starts, not
the end-to-end agent loop.

**If `alchemy dev` fails with a DIFFERENT error** (not the two this plan and
plan 051 targeted), record the exact error and report it as a STOP condition.

## Test plan

No new automated tests are required:

- The `.flue/cloudflare.ts` file is two re-export lines — `tsc` confirms the
  imports resolve, and `pnpm flue:build` confirms the Flue build picks them
  up and includes them in the bundle.
- The `alchemy.run.ts` revert is a removal of plan 051's additions — `tsc`
  confirms no type errors, and `pnpm test` confirms no test regressions.
- The dev smoke (Step 5) is the real verification — it confirms miniflare
  resolves `Sandbox` and `ProjectCoordinator` from the flueWorker's own
  bundle (same-Worker DO resolution).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0
- [ ] `pnpm test` exits 0 (23 files, 262 tests, no new failures)
- [ ] `pnpm lint` exits 0 (2 known warnings acceptable)
- [ ] `pnpm flue:build` exits 0
- [ ] `.flue/cloudflare.ts` exists and contains `export { Sandbox }` and `export { ProjectCoordinator }`
- [ ] `grep -n "export.*Sandbox\b" dist/ditto/index.js` returns at least one match (after `pnpm flue:build`)
- [ ] `grep -n "export.*ProjectCoordinator\b" dist/ditto/index.js` returns at least one match (after `pnpm flue:build`)
- [ ] `grep -n "WEBSITE_WORKER_NAME\|scriptName" alchemy.run.ts` returns no matches
- [ ] No files outside the in-scope list are modified (`git status --short` lists only `alchemy.run.ts` and `.flue/cloudflare.ts`)
- [ ] `plans/README.md` status row for 052 updated — SKIP if a reviewer dispatched you and maintains the index.
- [ ] Dev smoke (if run in main checkout): `pnpm run dev` reaches watching state with NO `ERR_RUNTIME_FAILURE`, NO `Class extends value undefined`, and NO `no such service is defined`.

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `alchemy.run.ts` doesn't match the "Current state" excerpts
  (plan 051's changes are not present — the codebase has drifted). Run the
  drift check at the top first.
- After Step 3, `Sandbox` or `ProjectCoordinator` does NOT appear in
  `dist/ditto/index.js` — the Flue build did not pick up `.flue/cloudflare.ts`.
  Verify the file is at `.flue/cloudflare.ts` (not a subdirectory, not a
  different extension). If the file is correctly placed and the build still
  doesn't include it, STOP — the installed Flue version may not support
  `cloudflare.ts`.
- `pnpm flue:build` fails with an error related to the `cloudflare.ts`
  imports (e.g. `Cannot resolve "@cloudflare/sandbox"` or
  `Cannot resolve "../src/lib/project-coordinator"`). This could mean the
  Flue build's esbuild config doesn't resolve these paths the same way the
  agent files do. Record the exact error and STOP.
- `pnpm run dev` in Step 5 fails with an error OTHER than the two this plan
  targets. Record the exact error text and stop — a different failure is a
  separate finding that needs its own plan.
- The `ProjectCoordinator` class import from `../src/lib/project-coordinator`
  pulls in a dependency chain that conflicts with the Flue build (e.g.
  circular imports, missing `cloudflare:workers` polyfill). If `tsc` or
  `flue:build` reports such an error, STOP and report.

## Maintenance notes

- **`.flue/cloudflare.ts` is the Flue-native way to add custom Worker
  exports.** Any class exported from this file appears in the Flue-generated
  bundle as a Worker export. This is how same-Worker DO classes that aren't
  Flue-generated (like `Sandbox` and `ProjectCoordinator`) can be included in
  the flueWorker's bundle.
- **The DOs are separate namespaces in production.** Without `scriptName`,
  alchemy's `normalizeExportBindings` makes `Sandbox` and
  `ProjectCoordinator` same-Worker DOs in both the flueWorker and the website
  Worker. Each Worker has its own DO namespace — the DO instances are NOT
  shared. In dev (miniflare), this is fine for starting the server. In
  production, the flueWorker's agent code needs to access the SAME `Sandbox`
  DO instances as the website Worker (the project's sandbox container). This
  shared-DO issue is a known limitation of this approach and should be fixed
  separately (possibly by an alchemy upgrade that handles the dev-mode
  ordering for cross-script DOs, or by restructuring the Workers to break the
  circular dependency).
- **Why not keep `scriptName` AND add `.flue/cloudflare.ts`?** When
  `scriptName` is set, `buildWorkerOptions` creates a direct socket pointing
  to the target service, regardless of whether the class is in the bundle.
  Miniflare would still try the cross-script resolution and fail on the
  ordering issue. The `scriptName` must be removed for same-Worker DO
  resolution to take effect.
- **The `WEBSITE_WORKER_NAME` constant is removed.** It was only used by
  plan 051's `scriptName` and `name` additions. If a future plan needs the
  website Worker's name as a constant, it can be re-added.
- **Reviewer focus**: confirm that `.flue/cloudflare.ts` has exactly two
  exports (`Sandbox` and `ProjectCoordinator`), no `default` export, and
  that `alchemy.run.ts` has no `scriptName` or `WEBSITE_WORKER_NAME`
  references remaining.
- **Follow-up explicitly deferred**: the cross-Worker DO sharing issue
  (flueWorker accessing the same `Sandbox` DO instances as the website
  Worker) is out of scope. This plan only unblocks `pnpm run dev` to reach a
  running state. The end-to-end agent smoke should be exercised separately
  once dev is running, and the shared-DO issue should be tracked as a
  separate finding if it blocks the end-to-end flow.
