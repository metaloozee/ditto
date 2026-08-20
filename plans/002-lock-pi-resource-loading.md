# Lock PI resource loading to image-owned code

Status: TODO

Written against commit `62c99b4`. Complete plan 001 first.

Before editing, compare the current commit and target spec with plan 001's
recorded values. Read drift in PI runner and resource-loader code. Stop if the
approved resource-discovery guarantee changed.

## Goal

Make normal chat load only the Ditto extension from an absolute image-owned
path. Disable repository extensions, skills, prompts, themes, settings, and
context-file discovery before the first model request.

## Current state

`packages/sandbox-runner/src/run-agent.ts` calls `createAgentSession()` without a
`resourceLoader`. PI therefore uses project discovery:

```ts
const { session: agentSession } = await createAgentSession({
	cwd: options.cwd,
	agentDir: options.agentDir,
	model,
	modelRuntime,
	tools: [/* ... */],
	customTools: [...dittoGitCustomTools],
});
```

`packages/sandbox-runner/src/run-git-metadata.ts` already demonstrates the
required test shape with an explicit empty `ResourceLoader` and one typed tool.

## Files in scope

- `packages/sandbox-runner/src/run-agent.ts`
- `packages/sandbox-runner/src/run-agent.test.ts`
- a new runner module that constructs the locked resource loader
- a new image-owned Ditto extension entrypoint under
  `packages/sandbox-runner/src`
- `packages/sandbox-runner/src/ditto-git-tools.ts` only as needed to register the
  existing tools through the extension
- `Dockerfile`
- `packages/sandbox-runner/package.json` only if a new CLI or export is required
- `docs/architecture/agent-harness.md`
- `docs/architecture/security.md`

Do not change model selection, credentials, Git callback transport, D1, routes,
or UI in this plan.

## Required implementation

1. Build the Ditto extension into the runner output. Give it one absolute
   container path under `/opt/ditto-runner/dist/`.
2. Construct one `ResourceLoader` for normal chat. Set PI's no-discovery options
   for extensions, skills, prompt templates, themes, and context files.
3. Load only the absolute Ditto extension path. Do not accept an extension path
   from the job, environment, repository, project settings, or user input.
4. Keep the current built-in tool allowlist and the two Ditto Git tools.
5. Keep `SettingsManager.inMemory()`. Do not read repository or home-directory
   settings.
6. Pass the locked loader explicitly to `createAgentSession()` before any prompt
   or control server starts.
7. Keep Git metadata's existing empty loader. Share a small loader constructor
   only if it reduces duplicated policy without widening either interface.

The loader module is deep when callers provide only the code-owned system
prompt and extension path. Callers must not assemble six discovery flags.

## Tests

Extend `run-agent.test.ts` and add focused loader tests. Create temporary
repository files for every discovery class:

- a PI extension that throws if loaded
- a skill
- a prompt template
- a theme
- project settings
- `AGENTS.md` and another supported context filename
- a repository file that shadows the Ditto extension name

Assert that the loader returns none of them. Assert that the image-owned Ditto
extension loads once and still exposes `ditto_push_branch` and
`ditto_open_pull_request`.

Also assert that resource loading completes before `session.prompt()` and that
an invalid image-owned extension path fails the run before a model call.

## Verification

```bash
npm test --prefix packages/sandbox-runner -- src/run-agent.test.ts
npm run typecheck --prefix packages/sandbox-runner
npm run build --prefix packages/sandbox-runner
pnpm runner:verify
pnpm verify
```

Expected result: all commands exit 0. The built output contains the extension
at the exact path checked by the Docker image build.

## Done criteria

- Normal chat always passes an explicit locked resource loader.
- Repository discovery tests fail if any repository resource becomes visible.
- The Ditto Git tools still work through the image-owned extension.
- Git metadata keeps its empty loader and limited tool set.
- Architecture and security docs describe the implemented behavior.

## Maintenance note

Every PI dependency upgrade must rerun the hostile repository-resource tests.
Review new resource categories before accepting the upgrade.

## Stop conditions

- If PI cannot combine `noExtensions` with one explicit extension path, stop and
  use a code-owned `ResourceLoader` implementation. Do not enable default
  discovery.
- If loading the absolute extension requires copying it into `/workspace`,
  stop. The repository must not be able to replace or shadow it.
