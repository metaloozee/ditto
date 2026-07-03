# Plan 032: Replace the Spike Agent With a Read-Only Flue Project Coder

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in the "STOP conditions" section occurs, stop and report; do
> not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat df4631b..HEAD -- .flue/agents/project-coder.ts package.json pnpm-lock.yaml flue.config.ts alchemy.run.ts docs/decisions/2026-07-02-four-layer-flue-integration-spike.md docs/four-layer-flue-workflow-rewrite-prd.md plans/README.md
> git diff --stat -- .flue/agents/project-coder.ts package.json pnpm-lock.yaml flue.config.ts alchemy.run.ts docs/decisions/2026-07-02-four-layer-flue-integration-spike.md docs/four-layer-flue-workflow-rewrite-prd.md plans/README.md
> ```
>
> If any in-scope file changed since this plan was written, compare the excerpts
> below against the live code before proceeding. If an excerpt no longer matches
> and the difference is not merely formatting, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: migration
- **Planned at**: commit `df4631b`, 2026-07-03

## Why this matters

The current Flue agent proves build topology only; it has no useful project
tools. Phase 2 requires the primary Flue coding agent to connect to the stable
project sandbox and use read-only tools first while mutating tools remain
disabled. This plan upgrades `.flue/agents/project-coder.ts` into a real
repo-inspection agent without touching `startRun`, D1, sockets, or the legacy
mutating runner path.

## Current state

Relevant files:

- `.flue/agents/project-coder.ts` - current spike Flue agent.
- `flue.config.ts` - Flue Cloudflare build config.
- `alchemy.run.ts` - private Flue Worker receives the existing `Sandbox` Durable Object namespace.
- `package.json` / `pnpm-lock.yaml` - currently include `@flue/runtime` and `@flue/cli`, but not a direct `valibot` dependency.
- `docs/four-layer-flue-workflow-rewrite-prd.md` - requires read-only tools first and mutating tools disabled in Phase 2.

Current spike agent:

```ts
// .flue/agents/project-coder.ts:1-22
import { getSandbox } from "@cloudflare/sandbox";
import { createAgent } from "@flue/runtime";
import { cloudflareSandbox } from "@flue/runtime/cloudflare";

type FlueProjectCoderEnv = {
	Sandbox: DurableObjectNamespace;
};

const instructions = `You are Ditto's project-coder spike agent.

Do not mutate files during this architecture spike. Confirm that you can run inside the existing project sandbox boundary and answer from repository evidence only.`;

export default createAgent<unknown, FlueProjectCoderEnv>(({ id, env }) => {
	const [projectId, sandboxId = id] = id.split(":", 2);

	return {
		model: "anthropic/claude-sonnet-4-6",
		instructions,
		metadata: { projectId },
		sandbox: cloudflareSandbox(getSandbox(env.Sandbox, sandboxId)),
	};
});
```

The PRD's Phase 2 scope is read-only:

```md
// docs/four-layer-flue-workflow-rewrite-prd.md:688-695
#### Phase 2: Flue project agent foundation

- Add the primary Flue coding agent.
- Connect it to the project sandbox.
- Use read-only tools first.
- Stream assistant output and tool events into product projections.
- Keep mutating tools disabled.
```

The PRD lists read-only capabilities separately from mutating tools:

```md
// docs/four-layer-flue-workflow-rewrite-prd.md:459-468
Read-only capabilities include:

- file read;
- directory list;
- git status / diff read;
- bounded commands declared read-only;
- reading logs;
- reading preview status.

A read-only run must not receive mutating tools.
```

Installed Flue tool types use `defineTool` plus Valibot or raw JSON Schema:

```ts
// node_modules/@flue/runtime/dist/tool-types-6GUMYEa-.d.mts:21-35
interface ToolDefinition<TParams extends ToolParameters = ToolParameters> {
	name: string;
	description: string;
	parameters: TParams;
	execute: (args: ToolArgs<TParams>, signal?: AbortSignal) => Promise<string>;
}
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Add direct schema dependency | `pnpm add valibot` | exits 0; updates `package.json` and `pnpm-lock.yaml` |
| Flue build | `pnpm flue:build` | exits 0 with only the known generated-wrangler Durable Object migration warning |
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exits 0 |
| Lint | `pnpm lint` | exits 0 with only known warnings in `grainient.tsx:297` and `sidebar.tsx:85` |
| Tests | `pnpm test` | exits 0 |
| Whitespace | `git diff --check` | exits 0 with no output |

Do not run live prompts or spend model tokens in this plan.

## Scope

**In scope**:

- `.flue/agents/project-coder.ts`
- `package.json`
- `pnpm-lock.yaml`
- `plans/README.md` only to update this plan's status row if instructed

**Out of scope**:

- `src/integrations/trpc/routers/workspace.ts`; startRun wiring is plan 034.
- `src/lib/flue-run-bridge.ts`; bridge Durable Object is plan 033.
- D1 schema/migrations.
- UI model selector or current `PROJECT_CODER_MODELS`.
- Mutating tools: file write/patch/delete, dependency install, shell commands that can modify files, snapshot writes, process control, Git push/commit/branch/PR/deploy.
- Replacing or deleting the legacy Pi runner or `WorkspaceSessionBroker`.

## Git workflow

- Branch: `advisor/032-readonly-flue-agent` if you create a branch.
- Commit message style: Conventional Commits, e.g. `feat(flue): add read-only project coder tools`.
- Do not push, deploy, or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Add `valibot` as a direct dependency

Run:

```bash
pnpm add valibot
```

Why: Flue tool parameters accept Valibot schemas, and the agent source should not
rely on a transitive dependency.

**Verify**:

```bash
pnpm exec tsc --noEmit --pretty false
```

Expected result: typecheck exits 0. `package.json` and `pnpm-lock.yaml` are the
only files changed by this step.

### Step 2: Preserve the stable project sandbox mapping

Edit `.flue/agents/project-coder.ts`. Keep the `id` parsing convention from the
spike:

```ts
const [projectId, sandboxId = id] = id.split(":", 2);
```

Do not use product `sessionId` or `runId` as the Sandbox ID. The agent instance
ID must remain project-scoped, with the stable project sandbox ID as the second
segment. For example, a later caller may use `projectId:sandboxId`.

Keep:

```ts
sandbox: cloudflareSandbox(getSandbox(env.Sandbox, sandboxId))
```

Optionally also keep a direct `const sandbox = getSandbox(env.Sandbox, sandboxId)`
for custom read-only tools that need Sandbox SDK methods not exposed through the
Flue sandbox wrapper.

**Verify**: `pnpm flue:build` -> exits 0 with only the known migration warning.

### Step 3: Add safe path helpers inside the agent file

Inside `.flue/agents/project-coder.ts`, add local helpers. Do not import from
`src/lib/workspace-policy.ts`; Flue build should not depend on app path aliases
unless already proven in this file.

Required behavior:

- Workspace root is the constant `"/workspace"`.
- Tool inputs accept relative paths only.
- Empty path, `.` and `./` resolve to `/workspace`.
- Reject absolute paths, path segments equal to `..`, NUL bytes, and paths that resolve outside `/workspace`.
- Normalize duplicate slashes.

Target shape:

```ts
const WORKSPACE_PATH = "/workspace";

function resolveWorkspacePath(inputPath: string): string {
	// implement with string/path-segment checks; do not use Node-only path APIs
}
```

Add a shell-quote helper for the few read-only commands that interpolate paths:

```ts
function quoteShellArg(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}
```

**Verify**: `pnpm flue:build` and `pnpm exec tsc --noEmit --pretty false` -> both
exit 0.

### Step 4: Implement five read-only tools

Import `defineTool` and Valibot:

```ts
import { createAgent, defineTool } from "@flue/runtime";
import * as v from "valibot";
```

Create exactly these tools for Phase 2:

1. `read_file`
   - Parameters: `{ path: v.string(), offset: v.optional(v.number()), limit: v.optional(v.number()) }`.
   - Resolve path with `resolveWorkspacePath`.
   - Reject directories. If the Sandbox SDK does not expose a reliable stat API, call `sandbox.exists(path)` first and use command fallback only for directory detection.
   - Return text capped to at most 50 KB and include a truncation note.

2. `list_directory`
   - Parameters: `{ path: v.optional(v.string()), maxEntries: v.optional(v.number()) }`.
   - Resolve path under `/workspace`.
   - Use a bounded read-only command such as `find <path> -maxdepth 1 -mindepth 1 -printf '%y %p\n' | sort | head -n <N>` only if the Sandbox SDK lacks a list API.
   - Cap entries to a safe default such as 100 and a hard max such as 200.

3. `git_status`
   - No user-controlled command string.
   - Run `git status --short --branch` with `cwd: WORKSPACE_PATH` and a short timeout.
   - Return stdout/stderr capped.

4. `git_diff`
   - Parameters: `{ path: v.optional(v.string()), statOnly: v.optional(v.boolean()) }`.
   - If `path` is present, resolve it under `/workspace` and pass it after `--` with shell quoting.
   - Use `git diff --stat` when `statOnly` is true, otherwise `git diff -- <path?>`.
   - Cap output to 50 KB.

5. `run_readonly_command`
   - Parameters: `{ command: v.picklist([...]) }`.
   - Use a strict picklist of exact commands. Recommended initial picklist:
     `"pwd"`, `"git log --oneline -10"`, `"git status --short"`, `"git diff --stat"`, `"ls -la"`.
   - Do not accept arbitrary command text, shell operators, package-manager installs, tests/builds, deploy commands, or process-control commands.
   - Run with `cwd: WORKSPACE_PATH`, timeout <= 30 seconds, output capped.

For all tools:

- Return strings only.
- Catch expected validation/path errors by throwing an `Error` with a stable short message.
- Do not write files.
- Do not call `sandbox.writeFile`, `sandbox.createBackup`, `sandbox.restoreBackup`, `sandbox.destroy`, `git checkout`, `git reset`, package-manager install, or any external export action.

**Verify**:

```bash
pnpm flue:build
pnpm exec tsc --noEmit --pretty false
pnpm lint
```

Expected result: Flue build exits 0 with only the known migration warning,
typecheck exits 0, and lint exits 0 with only the known warnings.

### Step 5: Replace spike instructions with production read-only instructions

Replace the current spike instructions with a concise project-coder instruction
block that says:

- You inspect the repository before answering.
- You are running in `/workspace` for the existing project sandbox.
- You only have read-only tools in this phase.
- You must not claim to have edited files, installed dependencies, run mutating commands, pushed to GitHub, opened PRs, deployed, or changed external systems.
- Cite concrete file paths, git status/diff evidence, or command output when answering.
- Ask for clarification when the request requires edits or mutation; explain that mutating Flue tools are not enabled yet.

Keep the configured model as `"anthropic/claude-sonnet-4-6"` unless the installed
Flue docs or operator explicitly require another provider. Do not change the UI
model selector in this plan; the current product model list still supports the
legacy mutating path until plan 034/Phase 3 evolves it.

**Verify**: `pnpm flue:build` -> exits 0 with only the known migration warning.

### Step 6: Run the full baseline

Run:

```bash
pnpm flue:build
pnpm exec tsc --noEmit --pretty false
pnpm lint
pnpm test
git diff --check
```

Expected result: Flue build exits 0 with only the known generated-wrangler DO
migration warning; typecheck exits 0; lint exits 0 with only the two known
warnings; tests pass; whitespace check emits no output.

## Test plan

- No new unit test is required because the code lives inside `.flue/` and the primary gate is `pnpm flue:build` plus TypeScript/Biome.
- If path helper logic becomes complex, create `src/lib/flue-readonly-tool-policy.test.ts` only if you first extract the helper into `src/lib/`; otherwise keep this plan minimal and rely on Flue build/typecheck.
- Manual live prompt is optional and must be explicitly approved because it can spend model/provider tokens.

## Done criteria

All must hold:

- [ ] `.flue/agents/project-coder.ts` keeps `projectId:sandboxId` parsing and never uses session/run id as sandbox id.
- [ ] Agent tools are exactly read-only: `read_file`, `list_directory`, `git_status`, `git_diff`, and `run_readonly_command`.
- [ ] `run_readonly_command` accepts only a strict picklist of exact commands.
- [ ] Mutating operations are absent: no write/patch/delete/install/snapshot/destroy/export tool exists.
- [ ] Tool path inputs reject traversal outside `/workspace`.
- [ ] `pnpm flue:build` exits 0 with only the known generated-wrangler migration warning.
- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0.
- [ ] `pnpm lint` exits 0 with only known warnings in `grainient.tsx:297` and `sidebar.tsx:85`.
- [ ] `pnpm test` exits 0.
- [ ] `git diff --check` exits 0.
- [ ] Only in-scope files changed.

## STOP conditions

Stop and report back if:

- Flue build fails because `defineTool`, Valibot schemas, or Cloudflare Sandbox access differ from the installed API.
- Implementing read-only tools requires adding app source imports into `.flue/` that Flue build cannot resolve.
- You cannot implement path traversal blocking without a larger shared policy extraction.
- A requested tool would mutate files, install dependencies, start/stop processes, create backups, push to GitHub, open PRs, deploy, or alter external systems.
- You need to modify `workspace.startRun`, D1 schema, UI components, or bridge code.
- A verification command fails twice after a reasonable fix attempt.
- You need to touch a file listed out of scope.

## Maintenance notes

- Phase 3 will add lease-fenced mutating tools. Do not weaken the read-only guard here in anticipation of that future work.
- The actual Flue model remains fixed in `.flue/agents/project-coder.ts` for this plan. Product-level model selection remains recorded in D1 but is not fully wired to Flue in Phase 2.
- Reviewers should scrutinize path handling and command allowlisting more than prose quality; those are the security boundary for read-only mode.
