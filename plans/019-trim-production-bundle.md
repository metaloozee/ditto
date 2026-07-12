# Plan 019: Remove unused dependencies and lazy-load diagnostic chat code

> **Executor instructions**: Make dependency removals mechanically and prove
> them with import searches plus a production build. Keep development devtools
> available. Do not perform unrelated dependency upgrades.
>
> **Drift check (run first)**:
> `git diff --stat d3ec01b..HEAD -- package.json pnpm-lock.yaml src/routes/__root.tsx src/integrations/tanstack-query/devtools.tsx src/components/ai-chat.tsx src/components/edit-tool-diff.tsx src/components/ai-chat.test.tsx vite.config.ts`
> Working tree should be clean for those paths. If they differ from the
> Current state excerpts below, STOP and report rather than improvising.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/011-establish-verification-baseline.md` (DONE)
- **Category**: perf, migration
- **Planned at**: commit `5ad5e0c`, 2026-07-11
- **Reconciled at**: commit `d3ec01b`, 2026-07-12
- **Reconcile notes**: `package.json` gained verify/typecheck scripts only (plan 011);
  unused runtime deps unchanged. `ai-chat.tsx` grew session-cache memoization and
  failed-status UI but still eagerly imports `EditToolPart`. `edit-tool-diff.tsx`
  only moved types from `agent-stream-client` → `agent-message-parts` /
  `agent-tool-presentation`. `ai-chat.test.tsx` already mocks `#/components/edit-tool-diff`.
- **Execution**: DONE 2026-07-12 — branch `advisor/019-trim-production-bundle` @
  `055c800`. Advisor verdict: **APPROVE**. Merged to `master` @ `09a5dac`.
  Worktree removed.

## Why this matters

Production statically imports/mounts TanStack React, Router, and Query
devtools. Chat also eagerly imports the Pierre diff renderer and its syntax
assets even when no edit tool output exists. Sixteen direct runtime packages
have no source/config imports, increasing install, lockfile, advisory, and
upgrade surface without deployed value. This plan reduces those costs while
retaining local diagnostics and on-demand diff rendering.

## Current state

### Devtools always mounted (`src/routes/__root.tsx`)

```tsx
import { TanStackDevtools } from "@tanstack/react-devtools";
// ...
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
// ...
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
// ...
				<TanStackDevtools
					config={{
						position: "bottom-right",
					}}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
						TanStackQueryDevtools,
					]}
				/>
```

`src/integrations/tanstack-query/devtools.tsx` statically imports
`@tanstack/react-query-devtools` and exports a plugin object.

### Eager Pierre import path

`src/components/ai-chat.tsx:10`:

```tsx
import { EditToolPart } from "#/components/edit-tool-diff";
```

Used at `AssistantParts` when `group.type === "edit"` (~line 202–206).

`src/components/edit-tool-diff.tsx:1-3`:

```tsx
import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import { MultiFileDiff, PatchDiff } from "@pierre/diffs/react";
```

`EditToolPart` is exported from that file (~line 239). Cheap classification
lives in `#/lib/agent-tool-presentation` (`getEditToolDiffData`,
`groupAssistantParts`) — do not move Pierre imports into `ai-chat.tsx`.

### Unused direct runtime dependencies (package.json only)

Whole-repo exact import search (src, sandbox/runner, alchemy.run.ts,
vite.config.ts) found no runtime/config use for:

| Package | package.json key |
|---|---|
| `@faker-js/faker` | yes |
| `@tanstack/ai` | yes |
| `@tanstack/ai-anthropic` | yes |
| `@tanstack/ai-client` | yes |
| `@tanstack/ai-gemini` | yes |
| `@tanstack/ai-ollama` | yes |
| `@tanstack/ai-openai` | yes |
| `@tanstack/ai-react` | yes |
| `@tanstack/match-sorter-utils` | yes |
| `@tanstack/react-store` | yes |
| `@tanstack/react-table` | yes |
| `@tanstack/store` | yes |
| `postprocessing` | yes |
| `radix-ui` | yes |
| `three` | yes |
| `valibot` | yes |

Do **not** remove `@pierre/trees`: outside this finding; may support project
explorer direction.

Do **not** remove packages that ARE used for devtools
(`@tanstack/react-devtools`, `@tanstack/react-router-devtools`,
`@tanstack/react-query-devtools`) — only gate their load behind DEV.

### Existing tests

`src/components/ai-chat.test.tsx` mocks `#/components/edit-tool-diff` with
`EditToolPart: () => null`. Preserve that mock so existing tests stay green.
Add focused coverage for lazy loading if practical without pulling Pierre into
jsdom (prefer testing that the lazy boundary exists / fallback renders).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Import audit | `rg -n '<package-name>' src sandbox/runner alchemy.run.ts vite.config.ts` | no use for each removed package |
| Production build | `pnpm build` | exit 0 |
| Bundle inspection | `find dist/client/assets -type f -printf '%s %p\n' \| sort -nr \| head -20` | devtools absent from entry; diff code split |
| Grep built assets | `rg -l 'react-devtools\|react-query-devtools\|react-router-devtools' dist/client 2>/dev/null \|\| true` | prefer empty / only non-entry chunks that are never imported from production graph; ideal is no matches |
| Full gate | `pnpm verify` | exit 0 |

Fresh worktrees have no `node_modules`. Run `pnpm install` first (and
`pnpm runner:install` if `pnpm verify` needs the runner).

## Scope

**In scope**:

- `package.json`, `pnpm-lock.yaml`
- `src/routes/__root.tsx`
- `src/integrations/tanstack-query/devtools.tsx`
- one new development-only devtools wrapper if useful (e.g.
  `src/integrations/tanstack-query/devtools-loader.tsx` or
  `src/components/dev-tools.tsx`)
- `src/components/ai-chat.tsx`, `src/components/edit-tool-diff.tsx`
- focused component tests if required (`src/components/ai-chat.test.tsx` or a
  new small test next to the lazy boundary)
- Do **not** update `plans/README.md` (reviewer maintains the index)

**Out of scope**:

- Pinning/reconciling the remaining TanStack `latest` versions.
- Replacing Pierre diff rendering or changing its visual behavior.
- Removing dependencies with any live import or documented runtime use.
- Adding a general bundle-analyzer service or CI size budget.
- Changing session-cache / failed-status UI recently added in `ai-chat.tsx`.

## Git workflow

- Branch: `advisor/019-trim-production-bundle`
- Suggested commits:
  1. `perf(ui): lazy-load devtools and diffs`
  2. `chore(deps): remove unused runtime packages`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Record a reproducible bundle baseline

From a clean dependency install (`pnpm install`), run `pnpm build`. Record in
commit notes (not a new generated source file) the client entry size, total
asset count, and whether devtools/Pierre chunks are reachable from the entry.
Do not trust a pre-existing `dist/` because it may be stale.

**Verify**: build exits 0 and the inspection commands produce a baseline.

### Step 2: Make devtools development-only

Move devtools imports into a separate module loaded through a dynamic import
guarded by `import.meta.env.DEV`. Production must not statically import or mount
the devtools. Development behavior and bottom-right position remain unchanged.
Provide a null/fallback while the development-only module loads.

Recommended shape (adapt to repo style; tabs + double quotes per Biome):

```tsx
// e.g. in __root.tsx
function DevTools() {
	const [tools, setTools] = useState<React.ReactNode>(null);
	useEffect(() => {
		if (!import.meta.env.DEV) return;
		void import("#/integrations/tanstack-query/devtools-bundle").then(
			(mod) => setTools(mod.default()),
		);
	}, []);
	return tools;
}
```

Any approach is fine if:

1. Production static analysis cannot see the devtools packages as entry imports.
2. DEV still mounts TanStackDevtools bottom-right with Router + Query plugins.
3. No flash/error if the dynamic module is slow (null is fine).

Keep `@tanstack/react-devtools`, `@tanstack/react-router-devtools`, and
`@tanstack/react-query-devtools` in package.json (they remain needed for DEV).

**Verify**: production build output contains no reachable TanStack devtools in
the main client graph; prefer `rg` over `dist/client` showing no
`react-devtools` / `react-query-devtools` / `react-router-devtools` strings in
assets loaded by the production entry. Development still mounts the wrapper.

### Step 3: Lazy-load edit diff rendering

Keep the cheap tool classification in normal chat code
(`groupAssistantParts` already yields `group.type === "edit"`), but dynamically
import `edit-tool-diff.tsx` only when an edit tool part is actually renderable.

Use `React.lazy` + `Suspense` (or equivalent) with a small stable-height
skeleton/fallback that preserves message layout. Keep the existing `ClientOnly`
protection inside `edit-tool-diff.tsx` and all diff behavior.

Example shape:

```tsx
const EditToolPart = lazy(() =>
	import("#/components/edit-tool-diff").then((m) => ({
		default: m.EditToolPart,
	})),
);

// in AssistantParts edit branch:
<Suspense fallback={<EditToolSkeleton />}>
	<EditToolPart tool={group.tool} />
</Suspense>
```

`EditToolSkeleton` should be a lightweight local component (bordered bar with
muted text or spinner) — do not import Pierre for the fallback.

Preserve the existing mock in `ai-chat.test.tsx`. If lazy breaks the mock,
adjust the mock to still satisfy the default export shape the lazy import uses
(named `EditToolPart` re-exported or module factory).

**Verify**: a conversation without edit tools does not load the Pierre chunk
(structural: entry/chat chunk should not include `@pierre/diffs` if tree-shaken
correctly — confirm via build asset names/content). An edit-tool path still
renders after the lazy module resolves (manual or test).

### Step 4: Remove the unused dependency cohort

Repeat exact-package import searches before editing. Remove only the 16
packages listed in Current state from `package.json` `dependencies`. Run
`pnpm install` (or `pnpm install --lockfile-only` then full install) to
regenerate `pnpm-lock.yaml`. Inspect the lockfile diff for unrelated upgrades
of major framework families (react, vite, tanstack-router core, alchemy, etc.).

If any listed package gained a live import, retain it and record the reason in
NOTES rather than deleting it.

**Verify**:

```bash
for pkg in @faker-js/faker @tanstack/ai @tanstack/ai-anthropic @tanstack/ai-client \
  @tanstack/ai-gemini @tanstack/ai-ollama @tanstack/ai-openai @tanstack/ai-react \
  @tanstack/match-sorter-utils @tanstack/react-store @tanstack/react-table \
  @tanstack/store postprocessing radix-ui three valibot; do
  echo "== $pkg =="
  rg -n -F "$pkg" package.json src sandbox/runner alchemy.run.ts vite.config.ts || true
done
```

No matches except possibly none at all. `pnpm verify` and production build pass.

### Step 5: Compare and run the full gate

Compare entry size/asset reachability against Step 1. The done criterion is
structural splitting/removal, not an invented percentage target.

**Verify**: `pnpm verify && pnpm build` → exit 0.

## Test plan

- Root document production path has no static devtools import; development
  still can mount them.
- Ordinary chat does not statically import Pierre via `edit-tool-diff`.
- Edit tool lazily renders existing diff UI with accessible fallback.
- Exact import audit for every removed package.
- Existing `ai-chat.test.tsx` still passes.
- Full build, tests, typecheck, and Biome checks via `pnpm verify`.

## Done criteria

- [x] Production entry has no reachable devtools code.
- [x] Pierre renderer is a lazy chunk loaded only for edit parts.
- [x] All 16 unused direct dependencies are removed or individually justified.
- [x] Lockfile contains no unrelated broad upgrade.
- [x] `pnpm verify` and a clean production build pass.

## STOP conditions

- A supposedly unused package has a live dynamic/generated/config import.
- Vite cannot eliminate the devtools branch from production output.
- Lazy-loading edit diffs cannot be done without breaking existing chat tests
  or the recent session-cache / failed-status behavior — stop rather than
  rewriting that logic.
- Lockfile regeneration upgrades unrelated framework families; restore scope
  and report rather than accepting the churn.

## Maintenance notes

New diagnostic UI belongs behind the same development boundary. Keep optional
syntax-heavy renderers behind feature-level dynamic imports and review direct
dependencies against live imports during future upgrades.
