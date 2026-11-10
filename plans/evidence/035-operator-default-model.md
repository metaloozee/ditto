# 035 evidence: operator default model

Reviewed 2026-11-10. Base `1d8865c`. Executor branch `worktree-agent-ad955da5ba968da2e` (worktree `.claude/worktrees/agent-ad955da5ba968da2e`), commits `1c6f402`, `e9a3fe5`, `e2c5fa0`, `5bd59c0`, `b2f4d0f`. Fast-forwarded onto `feat/pi-durable` on 2026-11-10; worktree and branch removed.

## Verdict

APPROVE.

## Checks run by the reviewer in the executor worktree

| Check | Result |
|---|---|
| Drift check at `1d8865c` against `44c5739` | no in-scope changes |
| `pnpm check`, `pnpm db:drift`, `pnpm typecheck` | exit 0 (first segments of `pnpm verify`) |
| `pnpm --filter @ditto/web test` | 83 files, 977 tests pass |
| `pnpm runner:verify` | 16 files, 161 tests pass |
| `crash.test.mjs`, `contracts:verify`, `runtime:verify`, `pnpm test`, `pnpm build`, `runner:verify` (after `credentials:verify`) | exit 0 |
| `credentials:verify` → `product-commands.worker.test.ts` | fails, but see below |
| Done-criteria grep for `OPENCODE_API_KEY\|deepseek-v4-flash-free\|OPENCODE_REQUEST_MODEL\|OPENCODE_UPSTREAM_URL` | only `packages/sandbox-runner` env scrubbing (`delete process.env.OPENCODE_API_KEY`) and its tests, which the plan's test plan requires |
| `DEFAULT_MODEL_API_KEY` in `alchemy.run.ts` | one `alchemy.secret(...)` line |
| `baseUrl` in runner job parsers | absent; refused via `parseRunnerModelConfig` key allowlist |
| ADR and spec | `docs/adr/0001-operator-default-model.md` exists; spec contains "Ditto has one default model" |
| Real pi 0.85.1, built `dist/runner-model.js` | `resolveRunnerModel("ditto/default", item-13 config)` → provider `ditto`, baseUrl `https://opencode.ai/zen/v1`, `getAuth` returns the public placeholder key from the stored credential |
| Old pi session resume | `createAgentSession` uses an explicit `model` before the session file's model (`pi-coding-agent/dist/core/sdk.js:84-93`); run-agent always passes one |

## `product-commands` flake

Four runs, four different failing tests, all timing (`Actual close exceeded end deadline` or multi-second timeouts):

- full `pnpm verify` on the branch: "generation-2 admission denies a missing credential fence…"
- rerun on the branch: "applies a carried selection at its sequence turn…"
- second rerun on the branch: "deletion revokes authority in its first batch…"
- **base `1d8865c`, without 035**: "queued configuration uses the next selection across a sequence gap…"

No file under `apps/credential-tests/src` or `apps/runtime/src` imports any file 035 changed. The flake predates 035. It was reproducible on every local run this session, so it is worse than "passes on one rerun"; worth its own plan.

## Deviations (documented by the executor, accepted)

- Out-of-scope files, each required: `packages/sandbox-runner/src/cli.ts` (pass `job.modelConfig`), `git-metadata-cli.test.ts` (fixtures), `README.md` line 10 (named the old model).
- `agent-models.ts` uses the `"ditto/default"` literal with `satisfies typeof DEFAULT_MODEL_SPECIFIER` (type-only import) to avoid a cycle with `default-model.ts`.
- Git-metadata builders read `readDefaultModel(ctx.env)` themselves (`requireModelConfig`) instead of taking a parameter.
- `AgentRunContext` gained `modelApiKey`, used only for redaction.
- `loadAgentRunContextFromWork` returns `null` when the model is not configured, which surfaces as `work_context_missing`.

## Follow-ups for the maintainer

- Set `DEFAULT_MODEL` (JSON, see `apps/web/src/lib/default-model.ts` and the README example) and `DEFAULT_MODEL_API_KEY` (replaces `OPENCODE_API_KEY`) in `.env.local` and any deployment environment, then run one local prompt. No live request was made.
- Work queued before rollout carries `model: "opencode/deepseek-v4-flash-free"` and is rejected by the runner. Those runs were already failing.
