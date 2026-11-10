# Plan 038: A connected Codex subscription lists its models and runs real agent turns in the new runtime

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the 038 row in
> `plans/README.md`, unless a reviewer dispatched you and said they maintain
> the index. Step 9 (live check) is the maintainer's, not yours.
>
> **Drift check (run first)**: `git diff --stat 4008583..HEAD -- packages/runtime-contracts/src/model.ts packages/runtime-contracts/src/configuration.ts apps/web/src/lib/codex-credential-do.ts apps/web/src/lib/codex-request-contract.ts apps/web/src/lib/model-product-authority.ts apps/web/src/lib/session-command-candidate.ts apps/web/src/lib/candidate-product.ts apps/runtime/src/pi-durable-models.ts apps/runtime/src/pi-durable-host.ts apps/runtime/src/pi-durable-product-session.ts apps/credential-tests/src`
> If any listed file changed, compare the "Current state" excerpts with the
> live code. A mismatch is a STOP condition.

## Status

- **Priority**: P1 (the maintainer's focus: Codex first, decision 10)
- **Effort**: L (the largest plan in this track; nine steps, one commit each)
- **Risk**: HIGH (first credential-bearing request to a real provider; widens the model-selection contract)
- **Depends on**: 037 (DONE), 041 (DONE). Spike S1 done (`plans/evidence/038-s1-spike.md`). Gates G1 and G2 resolved for local use.
- **Category**: direction
- **Planned at**: commit `4008583`, 2026-11-10. Replaces the conditional brief written at `44c5739`.

## Why this matters

A user can now sign in to Codex (037, 040), but nothing uses the connection. The new runtime's model path still only reaches a test fixture: product denies every production request, the account's model list is a fake row only tests write, and the runtime only knows models `faux-1` and `faux-2`. This plan makes the connection real: product discovers the account's models from ChatGPT's Codex backend, the picker lists them, and each agent turn is sent to `codex/responses` and comes back as text, reasoning and tool calls. Tokens stay inside the `CodexCredential` Durable Object (DO) throughout.

Decisions to honor (from `plans/README.md`):
- **Decision 10**: one operator default model plus Codex; a picker appears only for users who connect Codex. Never reroute a failed Codex request to the default model.
- **Decision 16 (approach A)**: the runtime sends pi's normalized transcript (`ModelRequestV2`); product parses it strictly and **builds** every upstream request itself. Nothing the runtime sends is forwarded as-is.
- **Spec** (`docs/specs/pi-durable-session-runtime.md:382`): "A bundled provider catalogue does not prove account entitlement." Discovery must come from the account, never from pi's bundled catalog.
- **Ship disabled**: everything turns on only when `CODEX_DEVICE_AUTH === "1"` (037's flag; unset in deployed composition).

## Current state

### What S1 proved (`plans/evidence/038-s1-spike.md`, maintainer's Plus account, 2026-11-10)

- **Discovery**: `GET https://chatgpt.com/backend-api/codex/models?client_version=0.167.0` → 200, JSON `{ models: [...] }`. Headers sent: `authorization: Bearer <access>`, `chatgpt-account-id`, `openai-beta: responses=experimental`, `originator: codex_cli_rs`. The server hides models whose `minimal_client_version` exceeds `client_version` (0.99.0 returned one model; 0.167.0 returned ten). Fields Ditto uses: `slug`, `visibility` (`"list"` or `"hide"`), `supported_reasoning_levels[]` (objects with `effort`: `low`, `medium`, `high`, `xhigh`, `max`, and on some models `ultra`), `default_reasoning_level`. Eight of ten models had `visibility: "list"`.
- **Request**: `POST https://chatgpt.com/backend-api/codex/responses`, same headers plus `content-type: application/json` and `accept: text/event-stream`, body `{ model, instructions, input: [{ role: "user", content: [{ type: "input_text", text }] }], stream: true, store: false }` → 200. Server-sent events (SSE), in order: `response.created`, `response.in_progress`, `response.output_item.added`, `response.content_part.added`, `response.output_text.delta`, `response.metadata`, `response.output_text.done`, `response.content_part.done`, `response.output_item.done`, `response.completed`.
- `chatgpt-account-id` comes from the access token (a JWT): payload claim `"https://api.openai.com/auth"` → field `chatgpt_account_id`.

### The 041 contract (`packages/runtime-contracts/src/model.ts`)

- `ModelRequestV2 = { version: 2; purpose; provider: string /* ^[a-z0-9-]+$ */; model: string /* ^[A-Za-z0-9._:/-]+$, ≤128 bytes */; thinking: ModelThinkingV2; maxTokens; transcript: { messages: TranscriptMessageV2[] } }` (`:274-282`). The model regex is inline at `:698`.
- `ModelThinkingV2 = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"` (`:219-226`). There is no `ultra`; pi has none either.
- `TranscriptMessageV2` (`:238-272`): `system` (`content`, `sections?`, `toolsAdded?`, `toolsRemoved?`), `user` (string or text blocks), `assistant` (`text` with `textSignature?`, `thinking` with `thinkingSignature?`/`redacted?`, `toolCall` with `id`, `name`, `arguments`), `toolResult` (`toolCallId`, `toolName`, text `content`, `isError`).
- `ModelFrameV2` (`:283-309`): `text {text, signature?}`, `thinking {thinking, signature?, redacted?}`, `toolCall {id, name, arguments}`, `done {stopReason: "stop"|"length"|"toolUse"|"error", usage {input, output, cacheRead, reasoning?}}`. Frame signatures are capped at `V2_SIGNATURE_BYTES = 65_536` (`:344`). `validateModelFramesV2(frames)` (`:830`) enforces count, order, one final `done`, `toolCalls ≤ 64`, `outputBytes ≤ 524_288`.
- `MODEL_LIMITS_V2` (`:208-217`), `MODEL_FIXTURE_URL_V2` (`:206`), `SYNTHETIC_MODEL_LIMITS = { deadlineMs: 30000 }` (`:69`).
- The account snapshot contract is fixture-only: `SyntheticModelId = "faux-1" | "faux-2"`, `SyntheticThinking = "off" | "low" | "high" | "max"`, `SyntheticAccountV1 = { version: 1; status; generation; revision; models: { id: SyntheticModelId; thinking: SyntheticThinking[] }[] }`, `parseSyntheticAccountV1` (`:70-133`, at most 2 models, 4096-byte input).

### Configuration contract (`packages/runtime-contracts/src/configuration.ts`)

`ConfigurationSelectionV1 = { model: SyntheticModelId; thinking: SyntheticThinking }` (`:16-19`). `parseConfigurationSelectionV1` (`:56-67`) uses `literalField(r, "model", ["faux-1", "faux-2"])` and `literalField(r, "thinking", ["off", "low", "high", "max"])`. `CandidateModelsV1` and `parseCandidateModelsV1` (`:41-46`, `:223-272`) have the same literals, at most 2 models, 4096-byte input. Other contracts (`lifecycle.ts`, `product-command.ts`) call `parseConfigurationSelectionV1`, so they widen automatically.

### Product (apps/web)

- `apps/web/src/lib/codex-credential-do.ts` (825 lines), class `CodexCredential`:
  - `protected requestAvailable(): boolean { return false; }` (`:454-456`).
  - `protected modelProductAuthority()` returns `new ModelProductAuthority(this.env.DB)` (`:460-462`), with **no candidate policy**. The new runtime's sessions have `runtimeOwner='pi_durable_v1'`, which only a `ModelProductAuthority` built with `CANDIDATE_MODEL_POLICY` matches. Today only the test subclass `CandidateFixtureCredential` (`apps/credential-tests/src/entry.ts:573-587`) supplies it.
  - `protected modelCapacity(): CandidateCapacity | undefined { return undefined; }` (`:712-715`).
  - `protected fixtureAvailable(): boolean { return false; }` (`:372-374`); `FixtureCredential` returns `true`.
  - `requestModel(input, capability)` (`:477-711`): `overall = AbortSignal.timeout(SYNTHETIC_MODEL_LIMITS.deadlineMs)` (`:483`); reconstruct and digest the request; `duration = Math.min(SYNTHETIC_MODEL_LIMITS.deadlineMs, descriptor.attempt.deadlineAt - Date.now())` (`:522-525`); capacity; `policy.current`, `ensureFresh`, `policy.reserve`, `openCredentials` → `tokens`, `policy.permit` ×3, `capability.claim`, final fences; then:
    ```ts
    dispatched = true;
    const upstream = buildFixtureUpstream(request);
    fetching = fetch(upstream.url, { method: "POST", redirect: "manual", signal,
    	headers: { ...upstream.headers, authorization: `Bearer ${tokens.access}` }, body: upstream.body });
    ...
    if ([400, 401, 403, 429, 503].includes(response.status) && !response.headers.has("location")) { ... return failed_known }
    const frames = await wait(readModelFrames(response, signal, [tokens.access, tokens.refresh, tokens.identity ?? ""]));
    await wait(policy.record(descriptor, "complete"));
    return { version: 2, status: "complete", frames };
    ```
  - `#send(request: CodexRequest)` (`:187-202`) is the existing fetch helper for auth calls (15 s timeout, JSON body). `CodexTokens = { access; refresh; expiresAt; identity? }` (`codex-credential-crypto.ts:1-5`); `identity` is the `id_token`.
- `apps/web/src/lib/codex-request-contract.ts`: `reconstructModelRequest`, `modelRequestDigest`, `buildFixtureUpstream`, `awaitSynthetic`, `readModelFrames` (the NDJSON fixture reader; the exemplar for the SSE reader below).
- `apps/web/src/lib/codex-device-login.ts`: the style exemplar for pure Codex protocol code (constants, `CodexRequest` builders, `record()`/`text()` narrowing helpers, parsers that return typed outcomes and never throw on bad input).
- `apps/web/src/lib/model-product-authority.ts` (499 lines) reads the account snapshot from D1 table `codex_fixture_capabilities` (`userId` PK, `generation`, `revision`, `snapshot` TEXT with a 4096-character CHECK, `apps/web/src/db/schema.ts:58-71`) and parses it with `parseSyntheticAccountV1` in `preSessionReadiness` (`:70-106`, default selection parameter `{ model: "faux-1", thinking: "off" }`), `ownedConfiguration` (`:108-168`) and `facts` (`:170-...`, checks `body.model` and `body.thinking` against the snapshot).
- `apps/web/src/lib/session-command-candidate.ts`: `subject()` (`:301-332`) and `models()` (`:1456-1491`) parse the snapshot with `parseSyntheticAccountV1`; `admit()` falls back to `{ model: "faux-1", thinking: "off" }` twice (`:378`, `:392`). `CandidateCredentialStatus` (`:100-102`) is the credential-stub interface.
- `apps/web/src/lib/candidate-product.ts:286-325`: `readCandidateConfigurationAuthority`, `requestModel` and `readModelPermit` pass `false` as the "available" flag to `readOwnedConfigurationAuthority`, `performPrivateModelRequest` and `readPrivateModelPermit`.
- The browser picker (`apps/web/src/components/composer.tsx:1306-1321`) already renders `model.id` and thinking labels from `CandidateModelsV1`; `defaultSelection()` in `candidate-session-client.ts:445-451` picks the first model and its first thinking level. No UI change is needed.

### Runtime (apps/runtime)

- `apps/runtime/src/pi-durable-models.ts` `createPrivateModelAdapter` (`:159-369`) registers one provider, `faux`, whose `getModels` returns `faux-1` and `faux-2` (`:327-342`). The request it builds sets `provider: model.provider`, `model: model.id`, `thinking: options.reasoning ?? "off"`.
- pi-durable resolves every model through `runtime.models.getModel(provider, modelId)` (`node_modules/.../pi-durable/dist/harness/generation.js:36,103,137,170`, `compaction.js:63,103`). pi-ai's `Models.getModel(provider, id)` is `this.getModels(provider).find(...)` (`pi-ai/dist/models.js:116-118`). pi's supported thinking levels come from `getSupportedThinkingLevels(model)` (`models.js:681-692`): `["off"]` unless `model.reasoning`; a level is excluded when `thinkingLevelMap[level] === null`; `xhigh` and `max` need an explicit mapping.
- `apps/runtime/src/pi-durable-host.ts` hard-codes provider `"faux"` at `:1908` (`if (agent.model.provider !== "faux") throw ...`), `:1968` and `:2082` (`model: { provider: "faux", modelId: <selection>.model }`), `:5418` (`if (agent?.model?.provider === "faux")`), `:5637` (`model: { provider: "faux", modelId: seed.selection.model }`), and `:6527` (`{ model: { provider: "faux", modelId: "faux-1" } }`, a fallback when an agent has no model; leave it alone). Model operation deadlines default to 60 s: `const duration = this.dependencies.operationMs?.[kind] ?? 60_000;` (`:2902`, max 15 min).
- `apps/runtime/src/pi-durable-product-session.ts:298-314`: `configuration(commandId)` returns `defaultSelection: { model: "faux-1", thinking: "off" }`. The host composition (`:279`) passes no `operationMs`. `CandidatePrivateProduct` (`:56-...`) is the runtime's view of product RPC; it is implemented by `apps/web/src/lib/candidate-product.ts` and the test product `apps/credential-tests/src/model-entry.ts`.

### pi's Codex wire behavior (reference only; do not import)

`node_modules/.pnpm/@earendil-works+pi-ai@1.0.1*/node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js:373-431` (request body) and `openai-responses-shared.js:63-305` (message conversion) and `:306-703` (stream processing). This plan's builder and reader are hand-written equivalents. **Never import `@earendil-works/pi-ai` into `apps/web`**: `apps/credential-tests/crash.test.mjs:13` fails if `pi-ai|pi-durable|sandbox|runtime/src|auth\.ts` appears in the credential bundle. That last pattern also means no new file name may end in `auth.ts`.

### Conventions

Tabs, double quotes. `unknown` until narrowed, never `any`. Comment only where code cannot say why. Contract parsers use `packages/runtime-contracts/src/json.ts` helpers (`decodeContractInput`, `strictRecord`, `stringField`, `integerField`, `literalField`, `ContractParseError`); follow `parseSyntheticAccountV1`. Product protocol code follows `codex-device-login.ts`. Protected hook methods gate production behavior (`fixtureAvailable`, `requestAvailable`, `deviceAuthAvailable`); test subclasses in `apps/credential-tests/src/entry.ts` override them. Credential worker tests use `fetchMock` with `disableNetConnect()` (`codex-request-contract.worker.test.ts:126-205` is the exemplar).

## Target design

```text
browser picker ── /api/agent/models ──► session-command-candidate.models()
                                          └─► CodexCredential.refreshModels(owner)   (≤ once per 15 min)
                                                GET chatgpt.com/backend-api/codex/models?client_version=0.167.0
                                                └─► D1 codex_fixture_capabilities  (AccountSnapshot version 2)

runtime (pi)  ── ModelRequestV2 {provider:"openai-codex", model:"gpt-6.1-sol", thinking:"high", transcript} ──►
CodexCredential.requestModel: parse → digest → authority (unchanged) → buildCodexUpstream → POST codex/responses
                              ◄── readCodexFrames(SSE) → ModelFrameV2[] ──► runtime builds pi AssistantMessage
```

New names (use them exactly):
- `packages/runtime-contracts/src/model.ts`: `CODEX_PROVIDER = "openai-codex"`, `FIXTURE_PROVIDER = "faux"`, `MODEL_ID_PATTERN_V2 = /^[A-Za-z0-9._:/-]+$/`, `modelProviderFor(model: string): typeof CODEX_PROVIDER | typeof FIXTURE_PROVIDER`, `MODEL_OPERATION_MS = 600_000`, `AccountSnapshot`, `parseAccountSnapshot`.
- `apps/web/src/lib/codex-responses.ts` (create): `CODEX_BACKEND_URL`, `CODEX_CLIENT_VERSION`, `CODEX_STREAM_LIMITS`, `codexAccountId`, `selectUpstream`, `buildCodexUpstream`, `readCodexFrames`.
- `apps/web/src/lib/codex-models.ts` (create): `CODEX_MODELS_TTL_MS`, `buildCodexModelsRequest`, `parseCodexModels`, `buildAccountSnapshot`, `writeAccountSnapshot`, `defaultSelectionFrom`.

**Provider rule (decided here):** a selection carries only `{ model, thinking }`. `modelProviderFor(id)` returns `"faux"` for `faux-1`/`faux-2` and `"openai-codex"` for every other id. This avoids adding `provider` to every stored selection. Plan 039 (operator default model) must revisit it: if default-model ids can collide with Codex slugs, 039 adds an explicit provider to the selection.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install (fresh worktree) | `pnpm install --frozen-lockfile` | exit 0 |
| Contracts | `pnpm contracts:verify` | exit 0 |
| One web file | `pnpm --filter @ditto/web exec vitest run src/lib/<file>.test.ts` | all pass |
| One runtime file | `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-models.test.ts` | all pass |
| One credential file | `pnpm --filter @ditto/credential-tests exec vitest run src/<file>.worker.test.ts` | all pass |
| Credentials gate | `pnpm credentials:verify` | exit 0 (see STOP for the known `product-commands` flake) |
| Runtime gate | `pnpm runtime:verify` | exit 0 (one rerun allowed for a load-sensitive `pi-durable-host.test.ts` timing failure) |
| Typecheck, lint | `pnpm typecheck`, `pnpm check` | exit 0 |
| Full gate | `pnpm verify` | exit 0 |

## Scope

**In scope:**
- `packages/runtime-contracts/src/model.ts`, `model.test.ts`, `configuration.ts`, `configuration.test.ts`
- `apps/web/src/lib/codex-responses.ts`, `codex-responses.test.ts`, `codex-models.ts`, `codex-models.test.ts` (all create)
- `apps/web/src/lib/codex-credential-do.ts`: `requestAvailable`, `modelProductAuthority`, `modelCapacity`, `requestModel` (deadline, upstream selection, Codex dispatch and reader only), a new `discoveryAvailable` hook, a new `refreshModels` method and its DO-local `discovery` table
- `apps/web/src/lib/model-product-authority.ts`: snapshot parser swap, `preSessionReadiness` selection parameter, new `defaultSelection` method
- `apps/web/src/lib/session-command-candidate.ts`: snapshot parser swap, the two `faux-1` fallbacks, `CandidateCredentialStatus`, the refresh call in `models()`
- `apps/web/src/lib/candidate-product.ts`: the three `false` flags, a `CODEX_DEVICE_AUTH?: string` binding field if missing, new `readCandidateDefaultSelection`
- `apps/web/src/components/composer.tsx`, `apps/web/src/lib/candidate-session-client.ts`: **type-only** fixes forced by the widened selection type, if `pnpm typecheck` demands them
- `apps/runtime/src/pi-durable-models.ts`, `pi-durable-models.test.ts`
- `apps/runtime/src/pi-durable-host.ts`: only the five provider sites `:1908`, `:1968`, `:2082`, `:5418`, `:5637`
- `apps/runtime/src/pi-durable-product-session.ts`: `defaultSelection`, `operationMs`, the `CandidatePrivateProduct` interface
- `apps/credential-tests/src/entry.ts` (`FixtureCredential` overrides), `model-entry.ts` (new interface method), `codex-request-contract.worker.test.ts`, `codex-models.worker.test.ts` (create)
- `package.json`: add `src/codex-models.worker.test.ts` to the `credentials:verify` file list only
- `docs/specs/pi-durable-session-runtime.md`: one new paragraph (Step 8)
- `plans/evidence/038-codex-live.md` (create in Step 9 as a template; the maintainer fills it)

**Out of scope (do not touch):**
- Any D1 schema change or migration. Keep the table name `codex_fixture_capabilities`; renaming it needs a Drizzle-generated migration and is not worth it here. Never hand-write a migration.
- Authority, fencing, Stop, claim or ordering in `requestModel` and `pi-durable-host.ts`, other than the lines this plan names.
- The operator default model (plan 039), `session-runtime.ts`, the legacy runner, `apps/web/src/lib/agent-models.ts`.
- The `pi-durable-host.ts:6527` `faux-1` fallback, `pi-durable-local.ts`, and every `*.fixture.ts` file.
- Reconnect-on-401, usage-limit display from `x-codex-*` headers, refresh on `x-models-etag`, WebSocket transport, request compression. See "Maintenance notes".
- `alchemy.run.ts`: `CODEX_DEVICE_AUTH` is already wired (`:202`).

## Git workflow

Branch `advisor/038-codex-models-and-requests` or the one given. Conventional commits matching `git log`, one per step, for example `feat(contracts): widen model selection for codex`, `feat(web): build codex responses requests`, `feat(web): discover codex models`, `feat(web): dispatch codex model requests`, `feat(runtime): resolve codex models`. Do not push.

## Steps

### Step 1: Widen the selection, picker and account-snapshot contracts

In `packages/runtime-contracts/src/model.ts`:
1. Export `CODEX_PROVIDER = "openai-codex" as const`, `FIXTURE_PROVIDER = "faux" as const`, `MODEL_ID_PATTERN_V2 = /^[A-Za-z0-9._:/-]+$/`, and use `MODEL_ID_PATTERN_V2` in place of the inline regex in `parseModelRequestV2` (`:698`).
2. Export `modelProviderFor(model: string)`: returns `FIXTURE_PROVIDER` when `model === "faux-1" || model === "faux-2"`, else `CODEX_PROVIDER`.
3. Export `MODEL_OPERATION_MS = 600_000`. Keep `SYNTHETIC_MODEL_LIMITS` unchanged.
4. Export:
   ```ts
   export type AccountModel = { id: string; thinking: ModelThinkingV2[] };
   export type AccountSnapshot = {
   	version: 1 | 2;
   	status: "available" | "unavailable" | "revoked";
   	generation: number;
   	revision: number;
   	models: AccountModel[];
   };
   export function parseAccountSnapshot(input: unknown): AccountSnapshot
   ```
   - Decode with `decodeContractInput(input, 4096)`. If `version` is `1`, return `parseSyntheticAccountV1(input)` unchanged (its type is assignable).
   - If `version` is `2`: the same keys as V1; `status` with the same rule (non-`available` means zero models); `models` an array of at most 16 entries; each `{ id, thinking }` exactly; `id` 1–128 bytes matching `MODEL_ID_PATTERN_V2`, unique, and `modelProviderFor(id) === CODEX_PROVIDER`; `thinking` 1–7 unique values from `ModelThinkingV2`. Throw `ContractParseError("invalid_models", ...)` otherwise, with no input text in the message.

In `packages/runtime-contracts/src/configuration.ts`:
- `ConfigurationSelectionV1 = { model: string; thinking: ModelThinkingV2 }`. In `parseConfigurationSelectionV1`, `model` is `stringField(r, "model", { maxBytes: 128 })` and must match `MODEL_ID_PATTERN_V2` (else `ContractParseError("invalid_selection", ...)`); `thinking` is `literalField` over the seven `ModelThinkingV2` values.
- `CandidateModelsV1.models: AccountModel[]`. In `parseCandidateModelsV1`: raise `decodeContractInput` to 8192 bytes, allow at most 16 models, ids by the same pattern rule, thinking 1–7 unique `ModelThinkingV2` values.
- Leave the `SyntheticModelId`/`SyntheticThinking` exports in `model.ts`; `SyntheticAccountV1` still uses them.

Tests:
- `model.test.ts`: `modelProviderFor("faux-2") === "faux"`, `modelProviderFor("gpt-6.1-sol") === "openai-codex"`. `parseAccountSnapshot` accepts a V1 fixture snapshot and a V2 snapshot with three Codex models. It rejects each of these V2 cases: 17 models; a duplicate id; id `faux-1`; id with a space; thinking `ultra`; empty thinking; `status: "revoked"` with models.
- `configuration.test.ts`: a selection `{ model: "gpt-6.1-sol", thinking: "xhigh" }` parses; `{ model: "a b", thinking: "low" }` and `{ model: "gpt-6", thinking: "ultra" }` are rejected; the old `faux-1`/`off` selection still parses. `parseCandidateModelsV1` accepts 16 Codex models and rejects 17.

**Verify**: `pnpm contracts:verify` → exit 0. `pnpm typecheck` → exit 0. If typecheck fails only in `composer.tsx` or `candidate-session-client.ts` because a thinking value is now `ModelThinkingV2`, make the smallest type-only fix there. Any other typecheck failure is a STOP.

### Step 2: Codex request builder and SSE reader (pure, product side)

Create `apps/web/src/lib/codex-responses.ts`. It imports only from `packages/runtime-contracts/src/model.js` and `./codex-request-contract` (for `awaitSynthetic`).

```ts
export const CODEX_BACKEND_URL = "https://chatgpt.com/backend-api";
// Raise when OpenAI raises models' minimal_client_version (S1: 0.167.0 unlocked every listed model).
export const CODEX_CLIENT_VERSION = "0.167.0";
export const CODEX_STREAM_LIMITS = { responseBytes: 8 * 1_048_576, eventBytes: 2 * 1_048_576, events: 20_000 } as const;
```

1. **`codexAccountId(access: string): string | null`**: split on `.`; require exactly 3 parts; base64url-decode the middle part (replace `-`→`+`, `_`→`/`, pad with `=`, `atob`, then `TextDecoder`); `JSON.parse` inside `try`; read `payload["https://api.openai.com/auth"].chatgpt_account_id`; return it only if it is a string matching `/^[A-Za-z0-9_-]{1,256}$/`; otherwise `null`. Never throw.
2. **`selectUpstream(request: ModelRequestV2, fixtureAvailable: boolean): "codex" | "fixture" | null`**: `null` unless `modelProviderFor(request.model) === request.provider`; then `"codex"` for `CODEX_PROVIDER`, `"fixture"` for `FIXTURE_PROVIDER` only when `fixtureAvailable`, else `null`.
3. **`buildCodexUpstream(request: ModelRequestV2, context: { accountId: string; promptCacheKey: string }): { url: string; headers: Record<string, string>; body: string }`**. Throw `Error("codex_request_contract")` if `request.provider !== CODEX_PROVIDER`.
   - `url`: `${CODEX_BACKEND_URL}/codex/responses`.
   - `headers`, exactly these five keys (the DO adds `authorization`): `content-type: application/json`, `accept: text/event-stream`, `openai-beta: responses=experimental`, `originator: codex_cli_rs`, `chatgpt-account-id: <accountId>`.
   - **System messages collapse** (Codex takes no mid-conversation system messages). Walk all `system` messages in order. Append each message's content text (a string, or its text blocks joined with `"\n"`) to a list when non-empty. Apply `sections` by name into a `Map` (`null` deletes). Apply tools: first delete each `toolsRemoved` name, then set each `toolsAdded` entry by name. `instructions` is `[...contents, ...sectionValues].filter(nonEmpty).join("\n\n")`, or `"You are a helpful assistant."` when that is empty. `tools` is the final tool map's values.
   - **`input`**, one pass over the non-system messages in order:
     - `user`: `{ role: "user", content: [{ type: "input_text", text }] }`, one `input_text` per text block (a string content is one block). Skip a user message with no blocks.
     - `assistant`, per block in order:
       - `thinking` with a `thinkingSignature`: `JSON.parse` it inside `try`. If it is a plain object with `type === "reasoning"`, push a rebuilt object holding only the keys `type`, `id`, `summary`, `content`, `encrypted_content` that are present. Skip the block if the signature is missing, unparsable or not a reasoning item. These are opaque items that `readCodexFrames` produced earlier.
       - `text`: `{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }`. Add `id` only when `textSignature` parses as `{ v: 1, id }` with `id` matching `/^msg_[A-Za-z0-9_-]{1,60}$/`.
       - `toolCall`: `{ type: "function_call", call_id: id.split("|")[0], name, arguments: JSON.stringify(arguments) }`. Do **not** send an item `id`; pi omits it too, to avoid reasoning-pairing validation when the model changed.
     - `toolResult`: `{ type: "function_call_output", call_id: toolCallId.split("|")[0], output: <text blocks joined with "\n">, or "(no tool output)" when empty }`.
   - `body`: `JSON.stringify` of `{ model, instructions, input, ...(tools.length ? { tools: tools.map(t => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false })) } : {}), tool_choice: "auto", parallel_tool_calls: true, ...(thinking !== "off" ? { reasoning: { effort: thinking, summary: "auto" } } : {}), store: false, stream: true, include: ["reasoning.encrypted_content"], prompt_cache_key: context.promptCacheKey }`. Do not send `maxTokens`; the Codex backend sets its own limit.
4. **`readCodexFrames(response: Response, signal: AbortSignal, privateValues: readonly string[]): Promise<{ status: "complete"; frames: ModelFrameV2[] } | { status: "failed" }>`**. Copy `readModelFrames`'s reader lifecycle exactly: the abort listener, `awaitSynthetic(reader.read(), signal)`, the `finally` that cancels and releases.
   - Throw `Error("codex_upstream_contract")` unless: status is 200, there is no `location` header, `content-type` starts with `text/event-stream`, and there is a body. Do **not** reject `content-encoding`: Workers decode compressed bodies transparently and may keep the header.
   - Decode UTF-8 with `fatal: true`. Track total bytes; above `CODEX_STREAM_LIMITS.responseBytes`, throw. Normalize `\r\n` to `\n` and split events on a blank line (`\n\n`). Within an event, join the `data:` lines (strip `data:` and one optional space) with `\n`, and ignore `event:`, `id:`, `retry:` and `:` comment lines. Skip events without data and the literal `[DONE]`. A pending (unterminated) event above `eventBytes`, or more than `events` events, throws.
   - `JSON.parse` each data payload; it must be an object with a string `type`, else throw. Handle:
     - `response.output_item.done` → `item` must be an object:
       - `reasoning`: `thinking` is the `text` of `summary` entries with `type: "summary_text"`, joined with `"\n\n"`; if that is empty, the `text` of `content` entries with `type: "reasoning_text"`, joined with `"\n\n"`. `signature` is `JSON.stringify(item)` only when its UTF-8 size is ≤ 65_536 bytes (above that, omit it; the turn still works, Codex just cannot reuse that reasoning). Push `{ version: 2, type: "thinking", thinking, ...signature }`.
       - `message`: `text` is the `content` entries mapped as `output_text` → `text` and `refusal` → `refusal`, joined with `""`. `signature` is `JSON.stringify({ v: 1, id: item.id, ...(typeof item.phase === "string" ? { phase: item.phase } : {}) })` when `item.id` is a string. Push a `text` frame.
       - `function_call`: `call_id`, `id` and `name` must be non-empty strings; `JSON.parse(item.arguments)` must be a plain object (else throw). Push `{ version: 2, type: "toolCall", id: \`${call_id}|${id}\`, name, arguments }`.
       - any other item type: throw `Error("codex_unsupported_item")`.
     - `response.completed` or `response.incomplete`: a second terminal event throws. From `response.usage` (missing or non-integer numbers count as 0): `cached = input_tokens_details.cached_tokens`; `input = max(0, input_tokens - cached)`; `output = output_tokens`; `cacheRead = cached`; `reasoning = output_tokens_details.reasoning_tokens` when it is a number. `stopReason`: for `completed`, `"toolUse"` if any `toolCall` frame was pushed, else `"stop"`; for `incomplete`, `"length"` when `response.incomplete_details.reason === "max_output_tokens"`, else `"error"`. Record the `done` frame.
     - `response.failed` or `error`: stop reading and return `{ status: "failed" }`.
     - every other type (deltas, `response.created`, `response.metadata`, …): ignore.
   - At end of stream: if there is no terminal `done`, throw `Error("codex_truncated_stream")`. Then `frames = validateModelFramesV2([...items, done])`. If `JSON.stringify(frames)` contains any non-empty `privateValues` entry, throw. Return `{ status: "complete", frames }`.

Create `apps/web/src/lib/codex-responses.test.ts` (pattern: `codex-request-contract.test.ts`; build SSE `Response`s from strings with `new Response(body, { headers: { "content-type": "text/event-stream" } })`). Cases:
1. `codexAccountId` returns the claim from a hand-built unsigned JWT; returns `null` for 2 parts, bad base64, missing claim, and an id containing `/`.
2. `selectUpstream`: codex → `"codex"`; faux with `fixtureAvailable` false → `null`; `{ provider: "openai-codex", model: "faux-1" }` → `null`.
3. `buildCodexUpstream` on a realistic transcript: a leading system message with two `toolsAdded`, a later system message removing one tool and adding a section, a user message, an assistant message with a reasoning signature, text and a `toolCall` with id `call_1|fc_1`, and a `toolResult`. Assert: the exact five header keys and no `authorization`; `instructions` contains the section; `tools` holds the current set only; no `role: "system"` item in `input`; the reasoning item is rebuilt and an extra key planted in its signature is gone; `function_call.call_id === "call_1"` with no `id`; the `function_call_output`; `reasoning.effort === "high"`; no `max_output_tokens` key. Building with provider `faux` throws.
4. `readCodexFrames` on a recorded-shape stream (the S1 event order plus a reasoning item and a `function_call` item) returns `thinking`, `text`, `toolCall`, `done(toolUse)` in order, with correct usage arithmetic.
5. Each of these throws: status 200 with `content-type: application/json`; no terminal event; two terminal events; a `web_search_call` item; `arguments` that is not a JSON object; a stream over `responseBytes`; output that echoes a private value. (Non-200 statuses never reach the reader; the DO handles them first.)
6. A `response.failed` event returns `{ status: "failed" }`.
7. A reasoning item whose JSON is over 65_536 bytes yields a `thinking` frame without `signature`.

**Verify**: `pnpm --filter @ditto/web exec vitest run src/lib/codex-responses.test.ts` → all pass. `pnpm typecheck` → exit 0.

### Step 3: Model discovery and the account snapshot (pure, product side)

Create `apps/web/src/lib/codex-models.ts` (imports from `packages/runtime-contracts/src/model.js`, `configuration.js` for the selection type, and `./codex-responses`):

1. `export const CODEX_MODELS_TTL_MS = 15 * 60 * 1000;`
2. `buildCodexModelsRequest(accountId: string): { url: string; init: { method: "GET"; redirect: "manual"; headers: Record<string, string> } }`, with url `${CODEX_BACKEND_URL}/codex/models?client_version=${CODEX_CLIENT_VERSION}` and headers `accept: application/json`, `openai-beta: responses=experimental`, `originator: codex_cli_rs`, `chatgpt-account-id`. The DO adds `authorization`.
3. `parseCodexModels(body: unknown): AccountModel[] | null`: `null` unless `body` is an object whose `models` is an array of ≤ 256 entries. For each entry, in server order, skip it unless all of these hold:
   - it is an object;
   - `visibility === "list"`;
   - `slug` is a string of 1–128 bytes matching `MODEL_ID_PATTERN_V2`;
   - `modelProviderFor(slug) === CODEX_PROVIDER`;
   - the slug was not already taken.

   `thinking` is the `effort` strings of `supported_reasoning_levels`, kept only if in `["minimal", "low", "medium", "high", "xhigh", "max"]` (this drops `ultra` and unknown levels), deduplicated, in that canonical order. Then move `default_reasoning_level` to the front when it is in the list. Skip a model whose `thinking` is empty. Stop after 16 models.
4. `buildAccountSnapshot(generation: number, revision: number, models: AccountModel[]): string`: `JSON.stringify({ version: 2, status: models.length ? "available" : "unavailable", generation, revision, models })`. While its length exceeds 4096, drop the last model (if that empties the list, the status becomes `"unavailable"`). The result must pass `parseAccountSnapshot`.
5. `writeAccountSnapshot(db: D1Database, owner: string, generation: number, models: AccountModel[]): Promise<"written" | "unchanged" | "stale">`:
   - Read `SELECT generation,revision,snapshot FROM codex_fixture_capabilities WHERE userId=?`.
   - If the row's generation equals `generation`, it parses as version 2, and its `models` JSON equals the new `models` JSON after the same truncation, return `"unchanged"`.
   - `revision = prior && prior.generation === generation ? prior.revision + 1 : 1`.
   - Write with one statement guarded by the live connection and the prior row (optimistic concurrency):
     ```sql
     INSERT INTO codex_fixture_capabilities(userId,generation,revision,snapshot)
     SELECT ?,?,?,? FROM codex_connections k
     WHERE k.user_id=? AND k.generation=? AND k.revoked=0 AND k.status='connected'
     ON CONFLICT(userId) DO UPDATE SET generation=excluded.generation,revision=excluded.revision,snapshot=excluded.snapshot
     WHERE codex_fixture_capabilities.generation=? AND codex_fixture_capabilities.revision=?
     ```
     Bind the prior generation and revision; with no prior row, bind `0, 0` (the conflict branch is then unreachable). Return `"written"` when `meta.changes === 1`, else `"stale"`.
6. `defaultSelectionFrom(snapshot: AccountSnapshot): ConfigurationSelectionV1 | null`: the first model and its first thinking level when `status === "available"`, else `null`. This matches the browser's `defaultSelection()`.

Create `apps/web/src/lib/codex-models.test.ts`. Build an S1-run-2-shaped fixture of ten models: two `hide`, `ultra` levels on several, `default_reasoning_level: "medium"`. Cases:
- 8 models come back, in server order, without `ultra`, each with `medium` first.
- Discovery drops a `faux-1` slug, a duplicate slug and a model with only `ultra`.
- `parseCodexModels({})` returns `null`.
- `buildAccountSnapshot` with 16 long-slug models stays within 4096 characters and parses.
- `defaultSelectionFrom` returns `null` for an unavailable snapshot.

`writeAccountSnapshot` is tested in Step 4's worker test, which has D1.

**Verify**: `pnpm --filter @ditto/web exec vitest run src/lib/codex-models.test.ts` → all pass. `pnpm typecheck` → exit 0.

### Step 4: `CodexCredential.refreshModels` and the snapshot parser swap

In `codex-credential-do.ts`:
1. In the constructor, add `CREATE TABLE IF NOT EXISTS discovery (id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL, fetched_at INTEGER NOT NULL)`.
2. `protected discoveryAvailable(): boolean { return this.deviceAuthAvailable(); }`
3. `async refreshModels(owner: string): Promise<"refreshed" | "current" | "unavailable">`:
   1. Return `"unavailable"` unless `this.discoveryAvailable()` and `this.#owned(owner)`.
   2. `const view = await this.ensureFresh(owner)`; require `view.status === "connected"`.
   3. Read state with `#read()`; require `status === "connected"`, `sealed`, and `generation === view.generation`.
   4. If the `discovery` row has the same generation and `Date.now() - fetched_at < CODEX_MODELS_TTL_MS`, return `"current"`.
   5. `openCredentials(...)` exactly as `requestModel` does. `codexAccountId(tokens.access)`; `null` → `"unavailable"`.
   6. `fetch(request.url, { ...request.init, headers: { ...request.init.headers, authorization: \`Bearer ${tokens.access}\` }, signal: AbortSignal.timeout(15000) })`. A non-200 status or a `location` header → `"unavailable"` with nothing written.
   7. Read `await response.text()`. If it exceeds 1_048_576 characters → `"unavailable"`. `JSON.parse` inside `try`, then `parseCodexModels`; `null` → `"unavailable"`.
   8. If `!this.#same(state)` → `"unavailable"`. Then `writeAccountSnapshot(this.env.DB, owner, state.generation, models)`. On `"written"` or `"unchanged"`, upsert the `discovery` row with `(generation, Date.now())`. Return `"refreshed"`.
   9. Wrap steps 5–8 in `try`/`catch` → `"unavailable"`. Never log or return token, account id or response text.
4. In `apps/credential-tests/src/entry.ts`, `FixtureCredential` gets `protected discoveryAvailable() { return false; }`, so existing tests never reach chatgpt.com.

Swap the parser: replace every `parseSyntheticAccountV1` call in `model-product-authority.ts` and `session-command-candidate.ts` with `parseAccountSnapshot`. The return shape is the same; only the types widen. Confirm with `grep -rn "parseSyntheticAccountV1" apps/web/src` → no matches outside tests.

Create `apps/credential-tests/src/codex-models.worker.test.ts` and add it to `credentials:verify` in `package.json`. Set it up like `codex-request-contract.worker.test.ts`: `fetchMock.activate()`, `disableNetConnect()`, the same D1 setup. Install connected tokens through the fixture binding first: insert the `codex_connections` row as the other credential tests do, then `await env.CodexCredential.getByName("owner").install("owner", 1, tokens)`. The binding's class is `FixtureCredential`, whose `install` is the existing fixture path. The access token must be an unsigned JWT carrying the account claim, with `expiresAt` well in the future. Then run the production class over the same storage, as the existing test at `codex-request-contract.worker.test.ts:2000` does: `runInDurableObject(env.CodexCredential.getByName("owner"), async (_i, state) => new CodexCredential(state, env).refreshModels("owner"))`. The pool binding already has `CODEX_DEVICE_AUTH: "1"`. Intercept `GET https://chatgpt.com/backend-api/codex/models?client_version=0.167.0` with `fetchMock`. Cases:
1. A refresh writes a version-2 snapshot (revision 1) that `parseAccountSnapshot` accepts. The intercepted request carried `authorization`, `chatgpt-account-id` and `originator: codex_cli_rs`.
2. A second call within 15 minutes returns `"current"` and makes no request.
3. After the TTL, an identical list returns `"refreshed"` and leaves the revision at 1. A changed list bumps it to 2.
4. A 401 response, a body without `models`, and an access token without the claim each return `"unavailable"` and write nothing.
5. With `CODEX_DEVICE_AUTH: ""` (construct with `{ ...env, CODEX_DEVICE_AUTH: "" }`), the call returns `"unavailable"` and makes no request.
6. `writeAccountSnapshot` returns `"stale"` when `codex_connections` has moved to a newer generation.

**Verify**: `pnpm --filter @ditto/credential-tests exec vitest run src/codex-models.worker.test.ts` → all pass. `pnpm credentials:verify` → exit 0.

### Step 5: Dispatch real Codex requests from `requestModel`

In `codex-credential-do.ts`:
1. `protected requestAvailable(): boolean { return this.deviceAuthAvailable(); }`
2. `protected modelProductAuthority()` returns `new ModelProductAuthority(this.env.DB, Date.now, CANDIDATE_MODEL_POLICY)`. The new runtime is the only Codex consumer.
3. `protected modelCapacity()` returns `new CandidateCapacity(this.env.DB, CANDIDATE_CAPACITY_POLICY)`, imported from `./candidate-capacity`.
4. In `apps/credential-tests/src/entry.ts`, `FixtureCredential` keeps its old behavior: `protected modelProductAuthority() { return new ModelProductAuthority(this.env.DB); }` and `protected modelCapacity(): CandidateCapacity | undefined { return undefined; }`. `CandidateFixtureCredential` already overrides both. Check that this compiles: the `CandidateFixtureCredential` overrides must still win.
5. In `requestModel`:
   - Replace `SYNTHETIC_MODEL_LIMITS.deadlineMs` at `:483` and `:523` with `MODEL_OPERATION_MS`. The attempt's own `deadlineAt` still bounds `duration`.
   - Right after the digest check succeeds (after the `catch` block that ends near `:516`), add `const kind = selectUpstream(request, this.fixtureAvailable()); if (!kind) return { version: 2, status: "unavailable" };`. It runs before capacity or reservation, so a wrong provider consumes nothing.
   - Right after `tokens` is opened and checked (`:575-577`), add `const accountId = kind === "codex" ? codexAccountId(tokens.access) : null; if (kind === "codex" && !accountId) throw new Error("connection_changed");`.
   - Replace `const upstream = buildFixtureUpstream(request);` with `const upstream = kind === "codex" ? buildCodexUpstream(request, { accountId: accountId!, promptCacheKey: descriptor.subject.workspaceSessionId }) : buildFixtureUpstream(request);`. The `fetch` call stays as it is.
   - Replace the frame read: for `"fixture"`, keep `readModelFrames(...)` exactly. For `"codex"`, call `readCodexFrames(response, signal, [tokens.access, tokens.refresh, tokens.identity ?? "", accountId!])`. On `{ status: "failed" }`, run `await wait(policy.record(descriptor, "failed_known"))` and return `{ version: 2, status: "failed_known" }`. On complete, use its `frames`.
   - Leave every other line of the method unchanged.
6. `candidate-product.ts`: replace the three `false` arguments (`:308`, `:317`, `:325`) with `this.env.CODEX_DEVICE_AUTH === "1"`. Add `CODEX_DEVICE_AUTH?: string` to its bindings type if it is missing.

Tests in `apps/credential-tests/src/codex-request-contract.worker.test.ts`:
- The test "production credentials remain unavailable even with connected fixture records" (`:2000`) now constructs `new CodexCredential(state, { ...env, CODEX_DEVICE_AUTH: "" })`. Keep its assertion.
- Add one Codex case using the existing `FixtureCredential` harness. Set the fixture snapshot row to a version-2 snapshot listing `gpt-6.1-sol` with `["high"]`. Install tokens whose access token is an unsigned JWT with the account claim. Intercept `POST https://chatgpt.com/backend-api/codex/responses` with an SSE body (`text` item then `response.completed`). Send a `ModelRequestV2` with `provider: "openai-codex"`, `model: "gpt-6.1-sol"`, `thinking: "high"` through the same descriptor/claim path the existing direct-request tests use. Assert:
  - outcome `complete` with a `text` frame and `done(stop)`;
  - exactly one upstream call;
  - its headers include `authorization`, `chatgpt-account-id` and `originator`, and not `x-api-key`;
  - its body has `store: false`;
  - the admission ended `complete`.
- Add: the same request with the intercepted stream ending in `response.failed` → `failed_known`, admission `failed_known`, one call.
- Add: a request with `thinking: "low"` (not in the snapshot) → `denied` and zero upstream calls.

**Verify**: `pnpm --filter @ditto/credential-tests exec vitest run src/codex-request-contract.worker.test.ts` → all pass. `pnpm credentials:verify` → exit 0.

### Step 6: Product supplies a default selection and refreshes models for the picker

1. `model-product-authority.ts`:
   - `preSessionReadiness(userId, projectId, selection?: ConfigurationSelectionV1)`: with no selection, the snapshot check becomes `account.models.length > 0` instead of the `faux-1`/`off` default.
   - Add `async defaultSelection(subject: ModelSubjectV1): Promise<ConfigurationSelectionV1 | null>`: read `SELECT snapshot FROM codex_fixture_capabilities WHERE userId=? AND generation=? AND revision=?` with the subject's `userId`, `connectionGeneration` and `capabilityRevision`; parse with `parseAccountSnapshot` inside `try`; return `defaultSelectionFrom(...)` or `null`.
2. `session-command-candidate.ts` `admit()`: replace `selection ?? { model: "faux-1", thinking: "off" }` at `:378` and `:392` with `selection ?? undefined`. `ownedConfiguration` already treats an absent selection as an ownership-only check.
3. `session-command-candidate.ts` `models()`: add an optional `refreshModels?(owner: string): Promise<unknown>` to `CandidateCredentialStatus`. Right after the `credential.status !== "connected"` early return, call `await this.credential(userId).refreshModels?.(userId)?.catch(() => undefined);`. A refresh failure must never fail the listing.
4. `candidate-product.ts`: add `async readCandidateDefaultSelection(commandId: string): Promise<ConfigurationSelectionV1 | null>`: `readCandidateSubject(commandId, 1)`; `null` → `null`; else `new ModelProductAuthority(this.env.DB, Date.now, CANDIDATE_MODEL_POLICY).defaultSelection(subject)`.
5. `apps/credential-tests/src/model-entry.ts`: implement `readCandidateDefaultSelection` returning `{ model: "faux-1", thinking: "off" }`. That is the value the runtime hard-coded before, so existing runtime-through-credential tests keep their behavior.

Tests: in `codex-models.worker.test.ts`, add `ModelProductAuthority.defaultSelection` cases:
- a version-2 snapshot returns the first model and its first level;
- a revision mismatch returns `null`;
- an unavailable snapshot returns `null`.

**Verify**: `pnpm credentials:verify` → exit 0. If a `product-commands.worker.test.ts` case fails because a snapshot that lists models but not `faux-1`/`off` now passes readiness, STOP and report the case. Do not edit its assertion.

### Step 7: Runtime resolves Codex models and takes its default from product

1. `apps/runtime/src/pi-durable-models.ts`, inside `createPrivateModelAdapter` after the `faux` `setProvider` call:
   - Build a template from the existing `faux-1` model: `const template = faux.provider.getModels().find((m) => m.id === "faux-1")`.
   - `codexModel(id)` returns `{ ...template, id, name: id, provider: CODEX_PROVIDER, reasoning: true, thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" } }`. pi then supports `minimal`, `low`, `medium`, `high`, `xhigh` and `max`, and never clamps a discovered level.
   - Register `models.setProvider({ id: CODEX_PROVIDER, name: "Codex through private product transport", auth: faux.provider.auth, getModels: () => [], stream, streamSimple: stream })`.
   - Wrap lookup: `const lookup = models.getModel.bind(models); models.getModel = (provider, id) => provider === CODEX_PROVIDER && id.length <= 128 && MODEL_ID_PATTERN_V2.test(id) && modelProviderFor(id) === CODEX_PROVIDER ? codexModel(id) : lookup(provider, id);`. Registering any well-formed id is safe: product checks every request against the account snapshot.
   - The `stream` function needs no change; it already sends `model.provider` and `model.id`.
2. `apps/runtime/src/pi-durable-host.ts`, only these five sites:
   - `:1908`: `if (agent.model.provider !== modelProviderFor(agent.model.modelId)) throw new Error("Unsupported configuration provider");`
   - `:1968`, `:2082`, `:5637`: `provider: "faux"` → `provider: modelProviderFor(<the same model id expression>)`.
   - `:5418`: `agent?.model?.provider === "faux"` → `agent?.model !== undefined && agent.model.provider === modelProviderFor(agent.model.modelId)`.
3. `apps/runtime/src/pi-durable-product-session.ts`:
   - Add `readCandidateDefaultSelection(commandId: string): Promise<ConfigurationSelectionV1 | null>` to `CandidatePrivateProduct`.
   - In `configuration(commandId)`, replace the literal default with `const defaultSelection = await product.readCandidateDefaultSelection(commandId); if (!defaultSelection) throw new Error("Candidate configuration unavailable");` and return it.
   - In the host composition (next to `now: Date.now` at `:279`), add `operationMs: { model: MODEL_OPERATION_MS, tool: 60_000 }`. The tool value is the current default, unchanged.

Tests in `apps/runtime/src/pi-durable-models.test.ts`, following the existing private-adapter tests:
1. `adapter.models.getModel("openai-codex", "gpt-6.1-sol")` returns a model with `reasoning: true`. `getModel("openai-codex", "a b")` and `getModel("openai-codex", "faux-1")` return `undefined`.
2. Streaming through that model with `reasoning: "xhigh"` delivers a product request with `provider: "openai-codex"`, `model: "gpt-6.1-sol"`, `thinking: "xhigh"`.
3. The `faux-1` path still sends `provider: "faux"` (a regression guard).

**Verify**: `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-models.test.ts` → all pass. `pnpm runtime:verify` → exit 0. `grep -n 'provider: "faux"\|provider !== "faux"\|provider === "faux"' apps/runtime/src/pi-durable-host.ts` → exactly one match (`:6527`'s fallback).

### Step 8: Spec paragraph and full gate

In `docs/specs/pi-durable-session-runtime.md`, after the paragraph ending "Live discovery/transport and PD38 remain `not run`." (`:637`), add one paragraph headed `Codex transport (plan 038).` It states:
- with `CODEX_DEVICE_AUTH=1`, product discovers the account's models from `GET /backend-api/codex/models` with a configured `client_version`, keeps `visibility: "list"` models, and stores them as the account snapshot;
- product builds each `codex/responses` request from `ModelRequestV2` and reads the SSE reply into `ModelFrameV2`;
- the credential DO alone holds tokens and the account id;
- a failed Codex request fails the turn and never falls back to the default model;
- PD38 still needs the maintainer's live evidence.

Keep it under 120 words. Do not edit the fixture paragraphs.

**Verify**: `pnpm verify` → exit 0 (see STOP for the known flake).

### Step 9: Live check (maintainer only, not the executor)

Create `plans/evidence/038-codex-live.md` with only a heading, the date placeholder and an empty checklist of the points below. The maintainer runs `DITTO_CANDIDATE_RUNTIME=1 CODEX_DEVICE_AUTH=1 pnpm dev` with their usual `CANDIDATE_RUNTIME_KEYS` and their own account, then confirms:
1. after connecting Codex, the composer picker lists the account's models;
2. a prompt on one model streams a reply;
3. a prompt that makes the agent call a tool completes the tool round trip;
4. Stop during a reply ends the turn.

Record only passed or failed per item, the date, the account class and the model slug used. No tokens, account ids, emails or response text.

## Test plan

Covered in Steps 1–7. Every new test must fail if its check is removed. The ones that matter most:
- the provider rule (`faux-1` never reaches Codex; a well-formed slug never reaches the fixture in production);
- the five exact upstream headers and no `authorization` from the builder;
- the system-message collapse and current-tool resolution;
- the rebuilt reasoning item;
- SSE reader rejections and `failed` mapping;
- discovery's `visibility` and `ultra` filtering;
- the snapshot revision rules and the stale write;
- zero upstream calls on denial and with the flag unset.

## Done criteria

- [ ] `pnpm verify` exits 0. The only allowed failure is `apps/credential-tests/src/product-commands.worker.test.ts`, and only if it is the only failing file and also fails at `4008583`.
- [ ] `grep -rn "pi-ai\|pi-durable" apps/web/src/lib/codex-responses.ts apps/web/src/lib/codex-models.ts` → no matches
- [ ] `pnpm --filter @ditto/credential-tests exec node --test crash.test.mjs` passes
- [ ] `grep -rn "parseSyntheticAccountV1" apps/web/src --include=*.ts | grep -v "\.test\."` → no matches
- [ ] `grep -n "requestAvailable(): boolean" -A2 apps/web/src/lib/codex-credential-do.ts` shows `deviceAuthAvailable()`
- [ ] The Step 7 grep returns exactly one match
- [ ] `git diff --stat 4008583..HEAD -- apps/web/drizzle apps/web/src/db/schema.ts` → empty
- [ ] Only in-scope files changed; the 038 row in `plans/README.md` is updated

## STOP conditions

- A "Current state" excerpt does not match the live code.
- Making a step pass needs a D1 migration, a schema change, or edits to authority, fencing, claim or Stop ordering beyond the lines named here.
- pi-durable or the host resolves models by any path other than `models.getModel(provider, id)` (for example `getModels()` or `getAvailable()`), so the Step 7 wrapper does not take effect.
- TypeScript forbids assigning `models.getModel`.
- An existing test depends on the 30 s overall model deadline, rather than on the attempt's `deadlineAt`.
- `FixtureCredential`'s restored authority or capacity overrides change the outcome of any existing credential test.
- The case in Step 6's verify.
- Any need to send a token, account id or Codex response text to the runtime, the sandbox, D1 or a log.
- `pnpm verify` fails outside `product-commands.worker.test.ts` after one rerun of a load-sensitive runtime timing test.

## Maintenance notes

- **`CODEX_CLIENT_VERSION`** is the one knob OpenAI turns. When the picker loses models, raise it to the current Codex CLI version (`codex --version`).
- **Revision churn**: a refresh that changes the model list bumps the snapshot revision. In-flight turns whose subject holds the old revision are then denied at their next model call. Lists rarely change; if they do often, compare entitlements per model instead of bumping on any change.
- **Not built, by design**:
  - reconnect on a 401 (it currently returns `failed_known`; `ensureFresh` renews before dispatch);
  - showing `x-codex-*` usage-limit headers;
  - refreshing on `x-models-etag`;
  - WebSocket transport;
  - zstd request compression (pi has it).

  Each is a separate small plan when wanted.
- **Plan 039** adds the operator default model as a third upstream in `selectUpstream`. It must revisit `modelProviderFor` (see "Provider rule").
- The table is still named `codex_fixture_capabilities` although it now holds real snapshots. A rename needs a generated migration.
- Reviewers: check that no runtime-supplied URL, header or raw item reaches `fetch` (reasoning items are rebuilt key by key); that `requestModel` changed only at the named lines; that `refreshModels` never writes when the connection generation moved; and that new tests assert rejection, not only success.
