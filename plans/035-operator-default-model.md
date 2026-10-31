# Plan 035: Serve the default model from an operator-configured OpenAI-compatible endpoint

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the 035 row in
> `plans/README.md`, unless a reviewer dispatched you and said they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat 44c5739..HEAD -- apps/web/src/lib/agent-models.ts apps/web/src/lib/open-code-contract.ts apps/web/src/lib/sandbox-egress-broker.ts apps/web/src/lib/agent-run-service.ts apps/web/src/lib/agent-run.ts apps/web/src/lib/session-git-metadata.ts apps/web/src/lib/runtime-policy-types.ts apps/web/src/components/composer.tsx packages/sandbox-runner/src alchemy.run.ts README.md docs CONTEXT.md`
> If any listed file changed, compare the "Current state" excerpts with the
> live code. A mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none. The maintainer accepted `plans/decisions/035-default-model-and-codex-subscriptions.md` on 2026-10-31.
- **Category**: bug + direction
- **Planned at**: commit `44c5739`, 2026-10-31

## Why this matters

Every agent run on the current engine fails with `Unknown model: opencode/deepseek-v4-flash-free`: pi-ai 0.85.1 no longer lists that model, and OpenCode retired it and now rejects free models over the API. The model is hardcoded in five places, so changing models means a code change. The maintainer decided that Ditto has one **default model**: an operator-configured OpenAI-compatible endpoint (base URL, model ID, API key) that users cannot change. After this plan, agent runs and Git metadata (commit and PR text) work again on the paid `deepseek-v4-flash`, and the operator can point the default model at any compatible endpoint by changing configuration only.

## Current state

The model reaches the upstream along this path. Every step hardcodes it today.

1. `apps/web/src/lib/agent-models.ts:1-2`: `export const DEFAULT_PROJECT_CODER_MODEL = "opencode/deepseek-v4-flash-free" as const;`. Lines 101-122 also hold `FIXED_MODEL_PROVIDER_ID`, `FIXED_MODEL_ID`, `parseModelSpecifier`, `isProjectCoderModelSpecifier` and `PROJECT_CODER_MODELS` (`name: "DeepSeek V4 Flash Free"`, `provider: "opencode"`). `parseModelSpecifier` and `isProjectCoderModelSpecifier` have no callers outside this file and its tests.
2. `apps/web/src/lib/agent-run-service.ts:346-354`: the run is refused if `env.OPENCODE_API_KEY` is empty, then `const model = DEFAULT_PROJECT_CODER_MODEL;`. Lines 596-597 and 720-721 put `env.OPENCODE_API_KEY` first in `secretValues` for redaction.
3. `apps/web/src/lib/agent-run.ts:240-252` writes the runner job: `JSON.stringify({ runId, conversationId, model: options.model, prompt, cwd, thinkingLevel })`. Lines 108-110 add `options.env.OPENCODE_API_KEY` to the redaction list.
4. `packages/sandbox-runner/src/agent-job.ts:3` has `const RUNNER_MODEL_SPECIFIER = "opencode/deepseek-v4-flash-free" as const;`, and `parseJob` (lines 48-53) rejects any other `model`.
5. `packages/sandbox-runner/src/runner-model.ts:4-5,24-25` pins provider `opencode` and model `deepseek-v4-flash-free`. `resolveRunnerModel` seeds an `InMemoryCredentialStore` with the public placeholder key, calls `ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false })`, then `modelRuntime.getModel("opencode", id)`. That built-in catalog entry carries `baseUrl: "https://opencode.ai/zen/v1"`.
6. The sandbox has `interceptHttps = true` and `enableInternet = false` (`apps/web/src/server.ts:19-22`). pi's request to `https://opencode.ai/zen/v1/chat/completions` reaches the Worker's outbound handler instead of the internet. `classifyOpenCodeRequest` (`open-code-contract.ts:120-144`) recognizes exactly that host and path.
7. `apps/web/src/lib/sandbox-egress-broker.ts:715-760` reads `options.env.OPENCODE_API_KEY`, calls `validateOpenCodeRequest(request, { contractVersion })`, then `buildAuthenticatedOpenCodeUpstreamRequest({ validated, apiKey, signal })` and fetches. `open-code-contract.ts:765-777` (`validatePinnedBody`) rejects any `body.model !== OPENCODE_REQUEST_MODEL` (`"deepseek-v4-flash-free"`, line 10), and line 980 sends to `OPENCODE_UPSTREAM_URL` (`"https://opencode.ai/zen/v1/chat/completions"`, lines 11-12). The body may contain only `BODY_KEYS` (lines 53-63): `model, messages, stream, stream_options, max_tokens, temperature, tools, tool_choice, reasoning_effort`. Message roles are limited to `system, user, assistant, tool` (line 65).
8. Git metadata, the same pin again: `apps/web/src/lib/session-git-metadata.ts:32` (`const MODEL = "opencode/deepseek-v4-flash-free"`, used by the zod job schemas at lines 92 and 107 and the builders at 517 and 673). Lines 770-783 check `options.env.OPENCODE_API_KEY` and redact it. `packages/sandbox-runner/src/git-metadata-job.ts:4` (`GIT_METADATA_MODEL`, checked at 272) and `run-git-metadata.ts:159,184`.
9. `alchemy.run.ts:215`: `OPENCODE_API_KEY: alchemy.secret(process.env.OPENCODE_API_KEY),`. The Worker `Env` type is inferred from these bindings (`apps/web/types/env.d.ts`), so renaming a binding here renames it in `Env`.
10. `apps/web/src/lib/runtime-policy-types.ts:3` lists `"OPENCODE_API_KEY"` in `ForbiddenProductBinding`.
11. `apps/web/src/components/composer.tsx:91` (`const FIXED_MODEL = PROJECT_CODER_MODELS[0];`), 909 (`modelLabel = FIXED_MODEL.name`) and 924-940 render a tooltip trigger with `<ModelSelectorLogo provider={FIXED_MODEL.provider} />`. `ModelSelectorLogo` (`components/ai-elements/model-selector.tsx:176`) loads `https://models.dev/logos/<provider>.svg`, so an unknown provider shows a broken image. `composer.tsx` lines ~1222-1235 are the **candidate** composer's model picker. Do not touch it.
12. pi supports registering a custom provider at runtime: `ModelRuntime.registerProvider(providerId, config: ProviderConfigInput)`. `ProviderConfigInput` (`@earendil-works/pi-coding-agent` 0.85.1, `dist/core/provider-composer.d.ts:16-41`) has `baseUrl`, `apiKey`, `api`, and `models: Array<{ id, name, api?, reasoning, thinkingLevelMap?, input, cost, contextWindow, maxTokens, compat? }>`.
13. pi-ai 0.85.1's catalog entry for the paid model, used for the initial configuration (`packages/sandbox-runner/node_modules/@earendil-works/pi-ai/dist/providers/data/opencode.json`, `openai-completions` group):
    `{"id":"deepseek-v4-flash","name":"DeepSeek V4 Flash","reasoning":true,"input":["text"],"contextWindow":1000000,"maxTokens":384000,"thinkingLevelMap":{"off":null,"minimal":null,"low":"low","medium":null,"high":"high","xhigh":null,"max":"max"},"compat":{"supportsStore":false,"supportsDeveloperRole":false,"maxTokensField":"max_tokens","supportsLongCacheRetention":false,"requiresReasoningContentOnAssistantMessages":true}}`

**Decision to honor** (accepted by the maintainer, full text in `plans/decisions/035-default-model-and-codex-subscriptions.md`): one default model, configured and paid for by the operator, not selectable by users, and no model menu in the legacy composer. The sandbox never sees the real endpoint or key. The broker accepts only the configured model ID.

**Conventions.** Tabs, double quotes, `#/` path alias in `apps/web`. Validation helpers return `null` for invalid input; see `parseModelSpecifier` in `agent-models.ts`. In TypeScript, use `unknown` until a runtime check narrows it. Never `any`. Comment only where the code cannot say why. `packages/sandbox-runner` is an npm package, separate from the pnpm workspace, and must not import from `apps/web`.

## Target design

```
Worker config                               runner job                        sandbox (pi)
DEFAULT_MODEL (JSON, plain var)    ──►      model: "ditto/default"     ──►   registerProvider("ditto", {
DEFAULT_MODEL_API_KEY (secret)              modelConfig: {id,name,…}           baseUrl: "https://opencode.ai/zen/v1",  ← internal address,
                                                                               api: "openai-completions", …})            intercepted by the broker
broker: body.model must equal DEFAULT_MODEL.id; forwards to `${DEFAULT_MODEL.baseUrl}/chat/completions`
        with `Authorization: Bearer ${DEFAULT_MODEL_API_KEY}`
```

- `"ditto/default"` is the Ditto-side specifier stored in `messages.model` and in job `model` fields. It never changes when the operator changes the model.
- The sandbox-facing address stays `https://opencode.ai/zen/v1/chat/completions`, because the outbound interception is proven for it. It is an internal address now, so add one comment saying so where it is defined.

`DEFAULT_MODEL` JSON shape (validated by the new parser; any other key is rejected):

| Key | Rule |
|---|---|
| `baseUrl` | `https:` URL, no query, no hash, no trailing `/`; upstream is `${baseUrl}/chat/completions` |
| `id` | 1–128 chars, `^[A-Za-z0-9._:/-]+$` |
| `name` | 1–80 chars |
| `reasoning` | boolean |
| `contextWindow`, `maxTokens` | positive integers |
| `thinkingLevelMap` | optional; keys from `PI_THINKING_LEVELS`, values string or `null` |
| `compat` | optional; only the five keys in item 13. `supportsStore` and `supportsDeveloperRole` must be `false`, `maxTokensField` must be `"max_tokens"` (other values make pi send fields or roles that the broker rejects). The other two are booleans. |

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install (fresh worktree) | `pnpm install && npm ci --prefix packages/sandbox-runner` | exit 0 |
| Web test, one file | `pnpm --filter @ditto/web test -- <file>` | all pass |
| Web typecheck | `pnpm typecheck` | exit 0 |
| Runner test, one file | `npm test --prefix packages/sandbox-runner -- <file>` | all pass |
| Runner gate | `pnpm runner:verify` | exit 0 |
| Lint/format check | `pnpm check` | exit 0 |
| Full gate | `pnpm verify` | exit 0 (see STOP for the known `product-commands` flake) |

## Scope

**In scope:**
- `docs/adr/0001-operator-default-model.md` (create), `docs/specs/pi-durable-session-runtime.md` (lines 378-382 only), `CONTEXT.md` (`## Models` section only), `README.md` (env section only)
- `apps/web/src/lib/default-model.ts` (create) and `apps/web/src/lib/default-model.test.ts` (create)
- `apps/web/src/lib/agent-models.ts`, `open-code-contract.ts`, `sandbox-egress-broker.ts`, `agent-run-service.ts`, `agent-run.ts`, `session-git-metadata.ts`, `agent-control-service.ts`, `session-command.ts` (only the `DEFAULT_PROJECT_CODER_MODEL` line ~852 if the type change requires it), `runtime-policy-types.ts`
- `apps/web/src/components/composer.tsx` (legacy composer model slot only)
- `apps/web/src/lib/agent-models.test.ts`: delete only the cases for the removed `parseModelSpecifier` and `isProjectCoderModelSpecifier`, and keep the thinking-level cases
- Existing tests that reference `OPENCODE_API_KEY` or the old model literal: `open-code-contract.test.ts`, `sandbox-egress-broker.test.ts`, `agent-run-service.test.ts`, `agent-run-service.ownership.test.ts`, `agent-run.test.ts`, `agent-control-service.test.ts`, `session-git-metadata.test.ts`, `workspace-runtime.test.ts`, `routes/api.agent.stream.test.ts`, `integrations/trpc/routers/session-git.test.ts`, `components/composer.test.tsx`
- `packages/sandbox-runner/src/runner-model.ts`, `agent-job.ts`, `run-agent.ts`, `git-metadata-job.ts`, `run-git-metadata.ts` and their `*.test.ts`
- `alchemy.run.ts` (the one `OPENCODE_API_KEY` line)

**Out of scope:**
- The candidate (new runtime) path: `apps/runtime/**`, `apps/web/src/lib/candidate-*.ts`, `model-product-*.ts`, `codex-*.ts`, and the candidate composer's model picker. Plans 037 and 038 cover these.
- Any model picker or user model choice in the legacy composer. The maintainer ruled it out.
- Renaming `open-code-contract.ts`, the `OPENCODE_*` contract constants that stay, or `OPENCODE_CONTRACT_VERSION`. Do not bump the contract version: stored operations carry it.
- Migrations or `schema.ts`. `messages.model` is already free text.
- Changing `BODY_KEYS`, the message-role allowlist or response-header handling in the broker.

## Git workflow

- Work on the branch you were given (reviewer-dispatched worktree) or `advisor/035-operator-default-model`.
- Conventional commits, matching `git log`: for example `feat(web): parse operator default model config`, `feat(runner): register default model from job`, `docs: record operator default model decision`. One commit per step.
- Do not push.

## Steps

### Step 1: Record the decision in docs

Copy, verbatim, from `plans/decisions/035-default-model-and-codex-subscriptions.md`:
- the "ADR text" block to `docs/adr/0001-operator-default-model.md`,
- the "Spec amendment" block over the three paragraphs at `docs/specs/pi-durable-session-runtime.md:378-382` (they begin "Initially, support only Codex…", "The model picker must contain…" and "A bundled provider catalogue…"),
- the "`CONTEXT.md` change" block over the body of `CONTEXT.md`'s `## Models` section.

In `README.md`, replace the `OPENCODE_API_KEY=` env line with `DEFAULT_MODEL=` and `DEFAULT_MODEL_API_KEY=`. Replace the sentence about `OPENCODE_API_KEY` with two sentences: that `DEFAULT_MODEL` is the JSON described in `apps/web/src/lib/default-model.ts`, and that `DEFAULT_MODEL_API_KEY` stays in the Worker and authorizes only that model through the outbound broker. Add the item-13 configuration as the example value, with `"baseUrl":"https://opencode.ai/zen/v1"` added.

**Verify**: `grep -c "deepseek-v4-flash-free" docs/specs/pi-durable-session-runtime.md` → `1` (the amendment's "replaces" sentence). `grep -n "OPENCODE_API_KEY" README.md` → no matches. `ls docs/adr/0001-operator-default-model.md` → exists.

### Step 2: Add the config parser

Create `apps/web/src/lib/default-model.ts` exporting:
- `type DefaultModelConfig` (the table above),
- `DEFAULT_MODEL_SPECIFIER = "ditto/default" as const`,
- `parseDefaultModelConfig(raw: unknown): DefaultModelConfig | null`: returns `null` for anything that breaks a rule (unknown keys included). Never throws.
- `readDefaultModel(env: { DEFAULT_MODEL?: string; DEFAULT_MODEL_API_KEY?: string }): { config: DefaultModelConfig; apiKey: string } | null`: `JSON.parse` inside try/catch, then the parser. `null` when the key is empty after trim.
- `defaultModelUpstreamUrl(config): URL` → `new URL(`${config.baseUrl}/chat/completions`)`.

Write `default-model.test.ts` first (see Test plan).

**Verify**: `pnpm --filter @ditto/web test -- src/lib/default-model.test.ts` → all pass.

### Step 3: Broker uses the configured model and endpoint

In `open-code-contract.ts`:
- Delete `OPENCODE_REQUEST_MODEL` and `OPENCODE_UPSTREAM_URL`.
- `validateOpenCodeRequest(request, bound: { contractVersion: number; model: string; upstreamUrl: URL })`. Pass `bound.model` into `validatePinnedBody`, compare `body.model` with it, and put it in the validated body. Return `upstreamUrl: bound.upstreamUrl`.
- Keep `OPENCODE_REQUEST_HOST` and `OPENCODE_REQUEST_PATH`, with one comment: an internal address the sandbox calls and the outbound handler intercepts. Ditto never contacts it directly unless `DEFAULT_MODEL.baseUrl` points there.

In `sandbox-egress-broker.ts`, in the model handler, replace the `OPENCODE_API_KEY` read with `readDefaultModel(options.env)`. If it is `null`, record the denial and `deny(403, "missing_default_model", …)` exactly as `missing_opencode_key` is handled now. Pass `model: config.id` and `upstreamUrl: defaultModelUpstreamUrl(config)` to the validator, and `apiKey` to `buildAuthenticatedOpenCodeUpstreamRequest`.

Update `open-code-contract.test.ts` and `sandbox-egress-broker.test.ts` to the new signatures and env names, and add the broker cases from the Test plan.

**Verify**: `pnpm --filter @ditto/web test -- src/lib/open-code-contract.test.ts src/lib/sandbox-egress-broker.test.ts` → all pass. `grep -rn "OPENCODE_REQUEST_MODEL\|OPENCODE_UPSTREAM_URL" apps/web/src` → no matches.

### Step 4: Worker callers send the specifier and model config

- `agent-models.ts`: `DEFAULT_PROJECT_CODER_MODEL = DEFAULT_MODEL_SPECIFIER` (import from `default-model.ts`). Delete `FIXED_MODEL_PROVIDER_ID`, `FIXED_MODEL_ID`, `parseModelSpecifier`, `isProjectCoderModelSpecifier` and `ParsedModelSpecifier` (no callers). In `PROJECT_CODER_MODELS[0]` set `name: "Default model"`, `provider: "ditto"`, `providerName: "Ditto"`. Keep `thinkingLevels: FALLBACK_MODEL_THINKING_LEVELS`.
- Add the runner job field type in `default-model.ts`: `type RunnerModelConfig = Omit<DefaultModelConfig, "baseUrl">` and `toRunnerModelConfig(config)`. The runner must never receive `baseUrl`.
- `agent-run-service.ts`: replace the `OPENCODE_API_KEY` guard (346-352) with `const defaultModel = readDefaultModel(env); if (!defaultModel) return { kind: "error", status: 500, body: { error: "Server model is not configured." } };`. Use `defaultModel.apiKey` in both `secretValues` lists. Pass `modelConfig: toRunnerModelConfig(defaultModel.config)` down to `agent-run.ts`.
- `agent-run.ts`: accept `modelConfig: RunnerModelConfig` and write it into the job JSON next to `model`. Redact the API key the caller passes instead of `options.env.OPENCODE_API_KEY`.
- `session-git-metadata.ts`: `MODEL` becomes `DEFAULT_MODEL_SPECIFIER`. Add `modelConfig` to both zod job schemas as a strict object matching `RunnerModelConfig`, and to both builders. The builders take it as a parameter from callers that have `env`. Replace the `OPENCODE_API_KEY` guard and redaction at 770-783 with `readDefaultModel(options.env)`.
- `runtime-policy-types.ts`: `"OPENCODE_API_KEY"` → `"DEFAULT_MODEL_API_KEY"`.
- `alchemy.run.ts:215`: replace with `DEFAULT_MODEL: process.env.DEFAULT_MODEL ?? "",` and `DEFAULT_MODEL_API_KEY: alchemy.secret(process.env.DEFAULT_MODEL_API_KEY),`.
- Fix the remaining tests listed in scope: rename env keys, set a valid `DEFAULT_MODEL` fixture (reuse one constant per file), and expect `"ditto/default"` where they expected the old literal.

**Verify**: `pnpm typecheck` → exit 0. `grep -rn "OPENCODE_API_KEY\|deepseek-v4-flash-free" apps/web/src alchemy.run.ts` → no matches. `pnpm --filter @ditto/web test` → all pass.

### Step 5: Runner registers the model from the job

- `runner-model.ts`: export `RUNNER_MODEL_SPECIFIER = "ditto/default"`, `SANDBOX_MODEL_BASE_URL = "https://opencode.ai/zen/v1"` (with the interception comment) and `parseRunnerModelConfig(raw: unknown): RunnerModelConfig | null`. Apply the same rules as the Worker parser except `baseUrl`, which is rejected if present. Change `resolveRunnerModel(specifier, modelConfig)`: reject a specifier other than `RUNNER_MODEL_SPECIFIER` as now; seed the credential store for provider `"ditto"` with the placeholder key (same pattern as today); create the runtime as today; then `modelRuntime.registerProvider("ditto", { baseUrl: SANDBOX_MODEL_BASE_URL, api: "openai-completions", models: [{ id, name, reasoning, thinkingLevelMap, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow, maxTokens, compat }] })`; return `modelRuntime.getModel("ditto", modelConfig.id)` or `{ error: "Unknown model: ditto/default" }`. Keep `scrubCredentialEnv()` on every path.
- `agent-job.ts`: the specifier literal becomes `"ditto/default"`. `parseJob` requires `modelConfig` and validates it with `parseRunnerModelConfig` (error `"modelConfig is invalid"`). Add `modelConfig` to `Job`.
- `run-agent.ts`: pass `job.modelConfig` to `resolveRunnerModel`.
- `git-metadata-job.ts`, `run-git-metadata.ts`: `GIT_METADATA_MODEL = "ditto/default"`. Add `"modelConfig"` to `JOB_KEYS`, validate it, and pass it to `resolveRunnerModel`.

**Verify**: `npm test --prefix packages/sandbox-runner -- src/runner-model.test.ts src/agent-job.test.ts src/git-metadata-job.test.ts src/run-git-metadata.test.ts src/run-agent.test.ts` → all pass. `grep -rn "deepseek" packages/sandbox-runner/src` → no matches. `pnpm runner:verify` → exit 0.

### Step 6: Legacy composer shows the default model without a provider logo

In `composer.tsx`'s legacy composer only (around line 924-940), replace `<ModelSelectorLogo className="size-5" provider={FIXED_MODEL.provider} />` with the lucide-react `Sparkles` icon at the same size, `aria-hidden`. Keep the tooltip, whose text is now "Default model". Do not add a menu. Leave the candidate composer (~line 1222) untouched. Update `composer.test.tsx` only if it asserts the old name.

**Verify**: `pnpm --filter @ditto/web test -- src/components/composer.test.tsx` → all pass. `pnpm check` → exit 0.

### Step 7: Full gate

**Verify**: `pnpm verify` → exit 0.

## Test plan

- `apps/web/src/lib/default-model.test.ts` (new, plain vitest; model after `apps/web/src/lib/agent-models.test.ts`):
  - the item-13 config plus `baseUrl` parses;
  - each of these returns `null`: `http:` base URL, base URL with query, base URL with trailing `/`, unknown top-level key, unknown `compat` key, `supportsDeveloperRole: true`, `maxTokensField: "max_completion_tokens"`, `id` with a space, `contextWindow: 0`, non-object input;
  - `readDefaultModel` returns `null` for invalid JSON, for missing `DEFAULT_MODEL`, and for a whitespace-only key;
  - `defaultModelUpstreamUrl` appends `/chat/completions`.
- `sandbox-egress-broker.test.ts` (extend existing):
  - a valid request is forwarded to `${baseUrl}/chat/completions` with `Authorization: Bearer <DEFAULT_MODEL_API_KEY test value>`;
  - `body.model` different from `config.id` → 403 `invalid_model`, with nothing forwarded;
  - `DEFAULT_MODEL` missing or invalid → 403 `missing_default_model`, with nothing forwarded.
- `packages/sandbox-runner/src/runner-model.test.ts` (extend): `resolveRunnerModel("ditto/default", config)` returns a model with `id === config.id`, `provider === "ditto"`, `baseUrl === "https://opencode.ai/zen/v1"`, `api === "openai-completions"`; a wrong specifier and a config with `baseUrl` are refused; `process.env.OPENCODE_API_KEY` is deleted after both success and refusal.
- `agent-job.test.ts`, `git-metadata-job.test.ts` (extend): missing or invalid `modelConfig` is refused, and a valid one round-trips.
- Assert behavior, not existence: each new test must fail if the corresponding check is removed.

## Done criteria

- [ ] `pnpm verify` exits 0, or every failing segment is the `product-commands` flake and passes on one rerun of that file
- [ ] `grep -rn "OPENCODE_API_KEY\|deepseek-v4-flash-free\|OPENCODE_REQUEST_MODEL\|OPENCODE_UPSTREAM_URL" apps packages/sandbox-runner/src alchemy.run.ts README.md` → no matches outside `apps/runtime` and `apps/credential-tests`
- [ ] `grep -n "DEFAULT_MODEL_API_KEY" alchemy.run.ts` → one `alchemy.secret(...)` line
- [ ] `grep -rn "baseUrl" packages/sandbox-runner/src/agent-job.ts packages/sandbox-runner/src/git-metadata-job.ts` → only in a refusal check
- [ ] `docs/adr/0001-operator-default-model.md` exists; the spec contains "Ditto has one default model"
- [ ] `git status --porcelain` lists only in-scope files
- [ ] `plans/README.md` 035 row updated

## STOP conditions

- A "Current state" excerpt does not match the live code.
- `modelRuntime.registerProvider` is missing, throws, or `getModel("ditto", id)` returns `undefined` after registering. Report the pi version and the error. Do not fall back to the built-in `opencode` catalog.
- A runner test shows pi sending a body key outside `BODY_KEYS`, or a `developer` role, with the item-13 compat. Do not widen the broker contract.
- Resuming a pi session file written by the old model (`opencode/deepseek-v4-flash-free`) fails in a runner test. Report it; old-session handling needs a decision.
- Any change seems to need `apps/runtime`, a candidate file, a migration or `schema.ts`.
- `pnpm verify` fails outside the known `product-commands` flake after one rerun.

## Maintenance notes

- **Operator action at rollout.** The deployer must set `DEFAULT_MODEL` and `DEFAULT_MODEL_API_KEY` (renamed from `OPENCODE_API_KEY`) in `.env.local` and the deployment environment. Without them, runs fail with "Server model is not configured." The executor cannot do this. The reviewer must tell the maintainer.
- **Live check is not part of this plan.** Unit tests do not prove the paid key works. The maintainer should run one local prompt on `pnpm dev` after setting the env, which spends a small amount of the operator's OpenCode balance.
- **Thinking levels are still fixed** at `off`, `high` and `max` in the legacy UI and job validator. A future default model whose `thinkingLevelMap` lacks `high` or `max` will be clamped by pi. Derive the UI levels from the config only when that happens.
- **Endpoint dialects.** The compat restrictions keep pi's requests inside the broker contract. Supporting an endpoint that needs `max_completion_tokens` or a `developer` role means changing the contract and its tests, not loosening the parser.
- **Cost.** Every default-model request is billed to the operator. Per-user limits for the default model belong in the new runtime's model capacity pool (plan 038). The legacy path keeps its existing per-operation `maxRequests` bound only.
- Reviewers: check that `baseUrl` and the API key never reach the runner job or sandbox env, that the broker still denies before forwarding, and that the candidate composer is unchanged.
