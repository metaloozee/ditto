# Plan 005: Remove dead project-route UI code and restore verification

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in STOP conditions occurs, stop and report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 14c1189..HEAD -- src/routes/project.$projectId.tsx`
> If the file changed since this plan was written, compare the excerpts below against live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug / dx
- **Planned at**: commit `14c1189`, 2026-06-25

## Why this matters

`src/routes/project.$projectId.tsx` contains commented-out UI and an unused `ProjectStatusCapsule` component. This breaks TypeScript and Biome, and `git diff --check` also reports trailing whitespace. The user specifically requested that all commented/dead code in this route be removed.

## Current state

Relevant file:
- `src/routes/project.$projectId.tsx` — project detail route now renders the chat surface.

Current excerpts:

`src/routes/project.$projectId.tsx:3-12`
```ts
import {
	ActivityIcon,
	GitBranchIcon,
	SquareTerminalIcon,
} from "lucide-react";
import { useMemo } from "react";
import { Chat } from "#/components/ai-chat";
import { Button } from "#/components/ui/button";
import { useTRPC } from "#/integrations/trpc/react";
import { cn } from "#/lib/utils";
```

`src/routes/project.$projectId.tsx:44-56`
```tsx
const project = projectQuery.data;
const sandboxActive = Boolean(project.sandboxId);

return (
	<main className="relative h-dvh overflow-hidden bg-background">
		{/* <ProjectStatusCapsule
			projectName={project.name}
			projectStatus={project.status}
			sandboxActive={sandboxActive}
		/> */}
		
		<Chat conversationId={conversationId} />
	</main>
);
```

`src/routes/project.$projectId.tsx:60-98` currently defines `function ProjectStatusCapsule(...)` but nothing calls it.

Repo conventions:
- React files use function components and Tailwind classes.
- Do not leave commented-out JSX as future work; existing repo has been cleaned with commits like `fix: dead code`.
- Use `pnpm exec tsc --noEmit --pretty false`, `pnpm lint`, `pnpm test`, and `git diff --check` as verification.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Whitespace | `git diff --check` | exit 0 |
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | no errors from this route |
| Lint | `pnpm lint` | no warnings from this route |
| Tests | `pnpm test` | exit 0 |

## Scope

**In scope**:
- `src/routes/project.$projectId.tsx`

**Out of scope**:
- `src/components/ai-chat*` behavior.
- Sidebar navigation.
- Project status feature implementation.
- Styling redesign beyond deleting dead/commented code.

## Steps

### Step 1: Delete unused imports

Remove imports that only support the dead `ProjectStatusCapsule` component: `ActivityIcon`, `GitBranchIcon`, `SquareTerminalIcon`, `Button`, and `cn`.

Keep `useMemo`, `Chat`, `useQuery`, `createFileRoute`, and `useTRPC`.

**Verify**: `pnpm lint` no longer reports `noUnusedImports` for `src/routes/project.$projectId.tsx`.

### Step 2: Delete commented-out JSX and unused variables

In `ProjectDetailRoute`, remove:
- `const project = projectQuery.data;`
- `const sandboxActive = Boolean(project.sandboxId);`
- the commented `<ProjectStatusCapsule ... />` JSX block.

Leave the route rendering:
```tsx
return (
	<main className="relative h-dvh overflow-hidden bg-background">
		<Chat conversationId={conversationId} />
	</main>
);
```

**Verify**: `pnpm exec tsc --noEmit --pretty false` no longer reports unused variables from this route.

### Step 3: Delete the dead component

Remove the entire `ProjectStatusCapsule` function from `src/routes/project.$projectId.tsx`.

**Verify**: `rg "ProjectStatusCapsule|sandboxActive|ActivityIcon|SquareTerminalIcon|GitBranchIcon|cn" 'src/routes/project.$projectId.tsx'` returns no matches.

### Step 4: Remove trailing whitespace

Ensure no blank lines in the file contain tabs/spaces.

**Verify**: `git diff --check` exits 0.

## Test plan

No new tests are required. This is dead-code deletion and compile/lint cleanup. Existing verification commands are sufficient.

## Done criteria

- [ ] `src/routes/project.$projectId.tsx` contains no commented-out `ProjectStatusCapsule` JSX.
- [ ] `src/routes/project.$projectId.tsx` contains no `ProjectStatusCapsule` function.
- [ ] `rg "ProjectStatusCapsule|sandboxActive|ActivityIcon|SquareTerminalIcon|GitBranchIcon|cn" 'src/routes/project.$projectId.tsx'` returns no matches.
- [ ] `git diff --check` exits 0.
- [ ] `pnpm exec tsc --noEmit --pretty false` has no errors from this route.
- [ ] `pnpm lint` has no warnings from this route.

## STOP conditions

Stop and report if:
- The route has been changed to actually render project status UI; then this is no longer dead code.
- Removing the dead code reveals a required product requirement that the route must display status immediately.

## Maintenance notes

If project status controls are needed later, reintroduce them as a planned feature with live usage and tests, not as commented code in the route.
