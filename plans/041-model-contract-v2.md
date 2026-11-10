# Plan 041: Carry real agent turns (messages, tools, tool calls) through the new runtime's private model transport

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the 041 row in
> `plans/README.md`, unless a reviewer dispatched you and said they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat ef6c850..HEAD -- packages/runtime-contracts/src/model.ts apps/runtime/src/pi-durable-models.ts apps/runtime/src/pi-durable-host.ts apps/runtime/src/pi-durable-summary.ts apps/runtime/src/pi-durable-product-session.ts apps/web/src/lib/codex-request-contract.ts apps/web/src/lib/codex-credential-do.ts apps/web/src/lib/model-product-transport.ts apps/web/src/lib/model-product-authority.ts apps/web/src/lib/session-runtime-product.ts apps/web/src/lib/candidate-product.ts apps/credential-tests/src`
> If any listed file changed, compare the "Current state" excerpts with the
> live code. A mismatch is a STOP condition.

## Status

- **Priority**: P1 (foundation for 038 and 039)
- **Effort**: L
- **Risk**: HIGH (changes the admission-bound request every model attempt carries)
- **Depends on**: none. Decision 16 in `plans/README.md` (approach A, accepted 2026-11-10).
- **Category**: direction
- **Planned at**: commit `ef6c850`, 2026-11-10

## Why this matters

The new runtime (Pi Durable in the workspace-session DO) sends every model turn through a private product transport, so that provider credentials never enter the runtime. Today that transport is a text-only stand-in. The runtime squashes the conversation into one `transcript` string, and the reply can only carry text deltas and a `done` frame. A coding agent needs tool definitions in the request and tool calls in the reply; without them, no model can drive Ditto's tools in the new runtime.

Plans 038 (Codex subscriptions) and 039 (operator default model) both need the same thing: a versioned, strictly parsed request carrying pi's real transcript, and a reply carrying text, reasoning and tool calls. This plan builds that contract (V2) and switches the runtime adapter, the credential DO and the product transport to it, still against the existing **test-only fixture upstream**. Production stays unavailable exactly as today. 038 and 039 then each add one real upstream (Codex Responses, OpenAI-compatible chat) behind this contract.

**Decision to honor (approach A, maintainer, 2026-11-10):** the runtime sends pi's normalized transcript, never a provider-shaped HTTP request. Product parses it strictly and **builds** the upstream request itself. Nothing the runtime sends is forwarded as-is. Spec (`docs/specs/pi-durable-session-runtime.md`, section "Credential and authority"): "Never forward an unvalidated original body or headers in a credential-bearing request."

## Current state

**Contract (V1)**, `packages/runtime-contracts/src/model.ts` (380 lines):
- `SYNTHETIC_MODEL_URL = "https://codex-model-fixture.invalid/v1/stream"` and `SYNTHETIC_MODEL_LIMITS = { requestBytes: 131072, transcriptBytes: 98304, frameBytes: 16384, responseBytes: 131072, outputBytes: 65536, frames: 128, deadlineMs: 30000 }`.
- `SyntheticModelBodyV1 = { version: 1; protocol: "ditto-synthetic-ndjson-1"; purpose: "generation" | "custom_summary" | "git_metadata"; model: "faux-1" | "faux-2"; thinking: "off" | "low" | "high" | "max"; transcript: string; options: { maxTokens } }`.
- `SyntheticModelRequestV1 = { version: 1; method: "POST"; url: typeof SYNTHETIC_MODEL_URL; headers: [string, string][]; body: string }`, with exactly two headers.
- `SyntheticFrameV1 = { type: "delta"; text } | { type: "done"; stopReason: "stop" | "error"; inputTokens; outputTokens }`.
- `SyntheticModelOutcomeV1 = { version: 1; status: "complete"; frames } | { version: 1; status: "unavailable" | "denied" | "failed_known" | "outcome_unknown" }`.
- `syntheticModelRequestDigest(input)`: SHA-256 of `JSON.stringify` of the parsed request.
- **Keep unchanged**: `ModelAttemptV1`, `ModelSubjectV1`, `ModelTransportDescriptorV1` and their parsers, `SyntheticAccountV1` and `parseSyntheticAccountV1` (the fixture capability snapshot), `SyntheticModelId` and `SyntheticThinking` (the configuration contract `packages/runtime-contracts/src/configuration.ts` uses them).

**Runtime adapter**, `apps/runtime/src/pi-durable-models.ts:154-299` (`createPrivateModelAdapter`):
- It wraps pi-ai's `fauxProvider`. Its `stream(model, transcript, options)` builds a V1 body with `transcript: JSON.stringify(semanticTranscript(transcript))`, wraps it in a V1 request with `url: SYNTHETIC_MODEL_URL`, creates `ExactModelClaim.forRequest(dispatch, subject, request, product)` and awaits `product.requestModel(request, claim)`.
- On `complete` it joins the `delta` texts into **one** `fauxAssistantMessage(text, …)`. Tool calls cannot be expressed.
- `ExactModelClaim.forRequest` (`:53-80`) parses the request with `parseSyntheticModelRequestV1` and digests it with `syntheticModelRequestDigest`. `PrivateModelTransport` (`:139-148`) types `requestModel` as returning `SyntheticModelOutcomeV1`.
- The `transcript` argument is pi-ai's `TranscriptContext` (`@earendil-works/pi-ai` 1.0.1, `dist/types.d.ts:532-546`). `normalizeContext()` folds `systemPrompt` and `tools` into leading `system` messages. `semanticTranscript` (`apps/runtime/src/pi-durable-host.ts:335-345`) only removes each message's `timestamp`.

**pi-ai message shapes** (`apps/runtime/node_modules/@earendil-works/pi-ai/dist/types.d.ts`; read lines 261-430 and 517-546 in full before Step 1):
- `SystemMessage { role: "system"; content: string | TextContent[]; sections?: Record<string, string | null>; toolsAdded?: Tool[]; toolsRemoved?: { name }[] }`
- `UserMessage { role: "user"; content: string | (TextContent | ImageContent)[] }`
- `AssistantMessage { role: "assistant"; content: (TextContent | ThinkingContent | ToolCall)[]; api; provider; model; usage; stopReason; …optional metadata }`
- `ToolResultMessage { role: "toolResult"; toolCallId; toolName; content: (TextContent | ImageContent)[]; details?; usage?; nestedCalls?; isError }`
- `TextContent { type: "text"; text; textSignature? }`, `ThinkingContent { type: "thinking"; thinking; thinkingSignature?; redacted? }`, `ToolCall { type: "toolCall"; id; name; arguments: JsonObject; thoughtSignature?; namespace? }`, `Tool { name; description; parameters }`.

**Product side**:
- `apps/web/src/lib/codex-request-contract.ts` (137 lines): `reconstructSyntheticRequest`, `syntheticRequestDigest`, `awaitSynthetic`, `readSyntheticStream(response, signal, privateValues)` (NDJSON reader with byte, frame and output bounds plus credential-echo rejection).
- `apps/web/src/lib/codex-credential-do.ts:476-700` (`requestModel`): it reconstructs and digests the request and compares the digest with `descriptor.requestDigest`, then does capacity, policy (`current`, `reserve`, `permit`), credential open, host claim and final permit. It then `fetch`es `request.url` with headers `content-type`, `accept` and `authorization` and the request body, and reads frames with `readSyntheticStream`. **Keep every authority, ordering and fencing step exactly as it is**; only the request type, the upstream construction and the stream reader change.
- `apps/web/src/lib/model-product-authority.ts`: `facts(d, body?)` (`:170-215`) checks `body.model` and `body.thinking` against the fixture snapshot. `reserve` and `permit` use `body.purpose`. They need only `purpose`, `model` and `thinking` from the body.
- `apps/web/src/lib/model-product-transport.ts`, `session-runtime-product.ts:38-50` and `candidate-product.ts:306-325` pass the request and outcome through, typed V1.
- Production composition passes `false` to the model helpers (`candidate-product.ts`); `CodexCredential.requestAvailable()` returns `false`. Only `apps/credential-tests` subclasses enable dispatch.

**Host bounds**: `apps/runtime/src/pi-durable-host.ts:325` (`requestDigest` throws "Oversized synthetic request" above `128_000` bytes), `:1514`, `:2907` and `:6733`, and `apps/runtime/src/pi-durable-summary.ts:49`, each bound a serialized model request or result at `128_000` bytes. Real agent transcripts with tool output pass that quickly.

**Tests that exercise V1** (they must move to V2): `apps/credential-tests/src/codex-request-contract.worker.test.ts` (the fixture upstream `installTrap()` at `:125-155`; the end-to-end exemplar at `:1656`, "the mandatory adapter constructs an exact credential-owned request and bounded stream through private RPC"; request-transform denials at `:1690-1742`), `apps/credential-tests/src/entry.ts`, `apps/credential-tests/src/model-entry.ts`, `apps/credential-tests/src/product-commands.worker.test.ts`, `apps/web/src/lib/codex-request-contract.test.ts`, `apps/runtime/src/pi-durable-models.test.ts`.

**Conventions**: contract parsers use the helpers in `packages/runtime-contracts/src/json.ts` (`decodeContractInput`, `strictRecord`, `stringField`, `integerField`, `literalField`, `ContractParseError`); follow `parseSyntheticModelBodyV1` as the pattern. Tabs, double quotes. `unknown` until narrowed, never `any`. Comment only where the code cannot say why. `packages/runtime-contracts` must not import pi, Workers or web code. Model files must not import `@earendil-works/pi-ai` into anything bundled by `apps/credential-tests/src/entry.ts`: `apps/credential-tests/crash.test.mjs:13` fails the build if `pi-ai|pi-durable|sandbox|runtime/src|auth\.ts` appears in that bundle.

## Target design

```text
runtime (pi-durable-models.ts)                product (credential DO)                     upstream
pi TranscriptContext ──► ModelRequestV2 ──►  parse strictly → digest check → authority
                         (no URL/headers)     → buildUpstream(request) ─────────────────► fixture (041)
                                                                                         Codex  (038)
                                                                                         default (039)
AssistantMessage ◄── ModelOutcomeV2 ◄─────── reader turns the upstream reply into ModelFrameV2[]
(text, thinking, toolCall blocks)
```

`ModelRequestV2` (new, in `model.ts`):

```ts
export type ModelRequestV2 = {
	version: 2;
	purpose: "generation" | "custom_summary" | "git_metadata";
	provider: string;          // 1–64 chars, ^[a-z0-9-]+$
	model: string;             // 1–128 chars, ^[A-Za-z0-9._:/-]+$
	thinking: ModelThinkingV2; // "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
	maxTokens: number;         // 1–131072
	transcript: TranscriptV2;
};
export type TranscriptV2 = { messages: TranscriptMessageV2[] }; // 1–4096 messages
```

`TranscriptMessageV2` is the strict subset of pi's messages that Ditto forwards:
- `system`: `content` (string or `text` blocks), optional `sections` (string or null values), optional `toolsAdded` (`{ name, description, parameters }`, where `parameters` is a JSON object), optional `toolsRemoved` (`{ name }`).
- `user`: `content` (string or `text` blocks). **Image blocks are rejected** (`invalid_content`): pi tool results cannot carry images in this runtime (decision 2 in `plans/README.md`).
- `assistant`: `content` of `text` (`text`, optional `textSignature`), `thinking` (`thinking`, optional `thinkingSignature`, optional `redacted`) and `toolCall` (`id`, `name`, `arguments` JSON object, optional `thoughtSignature`). Pi's other assistant metadata keys (`api`, `provider`, `model`, `usage`, `stopReason`, `responseModel`, `responseId`, `providerThinkingLevel`, `thinkingLevel`, `diagnostics`, `errorMessage`) are **accepted and dropped**. The executor takes the full key list from `types.d.ts:372-416`; any other key is rejected.
- `toolResult`: `toolCallId`, `toolName`, `content` (`text` blocks), `isError`. `details`, `usage` and `nestedCalls` are accepted and dropped. Any other key is rejected.
- Unknown roles, block types, duplicate keys and non-JSON values are rejected.

`ModelFrameV2` (the normalized reply; a reader produces it from any upstream):

```ts
| { version: 2; type: "text"; text: string; signature?: string }
| { version: 2; type: "thinking"; thinking: string; signature?: string; redacted?: boolean }
| { version: 2; type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
| { version: 2; type: "done"; stopReason: "stop" | "length" | "toolUse" | "error";
    usage: { input: number; output: number; cacheRead: number; reasoning?: number } }
```

Frames appear in content order; exactly one `done` comes last. `ModelOutcomeV2` has the same statuses as `SyntheticModelOutcomeV1`, with `version: 2` and `frames: ModelFrameV2[]`.

`MODEL_LIMITS_V2`: `requestBytes: 1_048_576`, `transcriptMessages: 4096`, `toolDefinitions: 128`, `responseBytes: 1_048_576`, `frameBytes: 262_144`, `frames: 2048`, `outputBytes: 524_288`, `toolCalls: 64`. **Deadlines are unchanged**: keep using `SYNTHETIC_MODEL_LIMITS.deadlineMs` everywhere it is used today. Real-model deadlines are 038's and 039's concern.

`modelRequestDigestV2(request)`: SHA-256 hex of the canonical JSON of the **parsed** request (object keys sorted recursively), so the runtime and product digests agree byte for byte. Put the canonicalizer in `model.ts`.

Fixture upstream (test-only, the only upstream in this plan): `MODEL_FIXTURE_URL_V2 = "https://codex-model-fixture.invalid/v2/stream"`. Product sends `POST` with exactly `content-type: application/json`, `accept: application/x-ndjson` and `authorization: Bearer <access>`, and the body `JSON.stringify(parsedRequest)`. The fixture replies with NDJSON `ModelFrameV2` lines.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install (fresh worktree) | `pnpm install --frozen-lockfile` | exit 0 |
| Contracts tests | `pnpm contracts:verify` | exit 0 |
| Runtime tests | `pnpm runtime:verify` | exit 0 (one rerun allowed for a load-sensitive timing failure in `pi-durable-host.test.ts`) |
| One runtime file | `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-models.test.ts` | all pass |
| Credential tests | `pnpm --filter @ditto/credential-tests exec vitest run src/codex-request-contract.worker.test.ts` | all pass |
| Web tests | `pnpm --filter @ditto/web exec vitest run src/lib/codex-request-contract.test.ts` | all pass |
| Typecheck, lint | `pnpm typecheck`, `pnpm check` | exit 0 |
| Gate | `pnpm verify` | exit 0; see STOP for the known `product-commands` flake |

Check `package.json` for the exact `contracts:verify` and `runtime:verify` scripts before Step 1, and use whatever narrower per-package command they wrap.

## Scope

**In scope:**
- `packages/runtime-contracts/src/model.ts` and its test (`model.test.ts`; create it if none exists)
- `apps/runtime/src/pi-durable-models.ts`, `apps/runtime/src/pi-durable-models.test.ts`
- `apps/runtime/src/pi-durable-host.ts` and `apps/runtime/src/pi-durable-summary.ts`: **only** the five `128_000` bound sites listed in "Current state", and only in Step 5
- `apps/runtime/src/pi-durable-product-session.ts`: only type imports, if the outcome type change requires it
- `apps/web/src/lib/codex-request-contract.ts`, `codex-request-contract.test.ts`, `codex-credential-do.ts` (`requestModel` and its imports only), `model-product-transport.ts`, `model-product-authority.ts` (the body type and `facts`/`reserve`/`permit` signatures only), `session-runtime-product.ts`, `candidate-product.ts` (types only)
- `apps/credential-tests/src/codex-request-contract.worker.test.ts`, `entry.ts`, `model-entry.ts`, `product-commands.worker.test.ts` (V1 → V2 updates only)

**Out of scope:**
- Any real upstream (Codex Responses, OpenAI chat completions), discovery, readiness or the picker. Those are plans 038 and 039.
- Turning on production model requests. `requestAvailable()` stays `false`, and `candidate-product.ts` keeps passing `false`.
- The configuration contract (`configuration.ts`), `SyntheticAccountV1`, `codex_fixture_capabilities` and `session-command-candidate.ts`. Model selection stays `faux-1`/`faux-2` until 038.
- Any authority, capacity, fencing, Stop or claim ordering in `codex-credential-do.ts` or `pi-durable-host.ts`. Only the request type, the upstream construction, the stream reader and the five size bounds change.
- Deadlines and `SYNTHETIC_MODEL_LIMITS.deadlineMs`.
- Migrations and `schema.ts`.

## Git workflow

Branch `advisor/041-model-contract-v2` or the one given. Conventional commits matching `git log` (`feat(contracts): add model request v2`, `feat(runtime): send model contract v2`, `feat(web): dispatch model contract v2`). One commit per step. Do not push.

## Steps

### Step 1: Add the V2 contract beside V1

In `model.ts`, add `ModelThinkingV2`, `TranscriptV2`, `TranscriptMessageV2`, `ModelRequestV2`, `ModelFrameV2`, `ModelOutcomeV2`, `MODEL_LIMITS_V2`, `MODEL_FIXTURE_URL_V2`, `parseModelRequestV2(input: unknown)`, `parseModelFrameV2(input: unknown)`, `canonicalJson(value: unknown): string` and `modelRequestDigestV2(input: unknown): Promise<string>`. Follow the "Target design" rules exactly. Parsers throw `ContractParseError` with a fixed code (`invalid_request`, `invalid_content`, `invalid_frame`, `oversized`) and never include input text in the message. Do not remove anything yet.

Tests (contracts test file): a request built from a realistic transcript parses and round-trips. It has a system message with `toolsAdded`, a user message, an assistant message carrying `text`, `thinking` and `toolCall` blocks plus pi's metadata keys, and a `toolResult`. The parsed form drops the metadata keys. Each of these is rejected:
- an image block;
- an unknown role;
- an unknown block type;
- an unknown assistant key;
- a duplicate key in the raw JSON;
- a `model` with a space;
- `thinking: "ultra"`;
- more than `toolCalls` tool calls in frames;
- a request over `requestBytes`.

The digest is identical for two inputs that differ only in object key order. Each frame type parses; a `done` with `stopReason: "aborted"` is rejected.

**Verify**: `pnpm contracts:verify` → exit 0. `pnpm typecheck` → exit 0.

### Step 2: Product dispatches V2 to the fixture upstream

- `codex-request-contract.ts`:
  - Replace `reconstructSyntheticRequest` and `syntheticRequestDigest` with `parseModelRequestV2`-based `reconstructModelRequest(input)`, returning `{ request }`, and `modelRequestDigest(input)`.
  - Add `buildFixtureUpstream(request): { url: string; headers: Record<string, string>; body: string }`, with the fixed URL and the three headers from "Target design" minus `authorization`. The DO adds that header.
  - Rename `readSyntheticStream` to `readModelFrames` and make it parse `ModelFrameV2` with `MODEL_LIMITS_V2`. Keep every existing check: status 200, no `location`, the exact content type, no `content-encoding`, the byte, frame and output bounds, credential echo (now checked across `text`, `thinking` and tool-call `arguments` JSON), and the truncated-stream and single-final-`done` rules.
  - Keep `awaitSynthetic` as it is.
- `codex-credential-do.ts` `requestModel`: use `reconstructModelRequest` and `modelRequestDigest`, then build the upstream with `buildFixtureUpstream`. `fetch(upstream.url, { method: "POST", redirect: "manual", signal, headers: { ...upstream.headers, authorization: \`Bearer ${tokens.access}\` }, body: upstream.body })`, then `readModelFrames`. Return `ModelOutcomeV2` (`version: 2`). Leave every other line of the method unchanged.
- `model-product-authority.ts`: type the body as `Pick<ModelRequestV2, "purpose" | "model" | "thinking">`. `facts` still checks `model` and `thinking` against the `SyntheticAccountV1` snapshot. A V2 thinking value that the snapshot does not list simply fails the check.
- `model-product-transport.ts`, `session-runtime-product.ts`, `candidate-product.ts`: switch types to V2.
- Credential tests:
  - `installTrap()` intercepts `/v2/stream` and parses the body with `parseModelRequestV2`.
  - The default fixture reply is NDJSON `ModelFrameV2` lines (`text` then `done`).
  - Rewrite the request-transform denial cases (`:1690-1742`) as V2 cases:
    - a duplicate key;
    - changed `thinking`;
    - an unknown top-level key;
    - an image block;
    - a transcript over the bound.
    Each must still dispatch zero calls.
  - Update `entry.ts`, `model-entry.ts` and `product-commands.worker.test.ts` mechanically.

At this point the runtime still sends V1, so the end-to-end credential test that goes through the real runtime adapter (`:1656`) is expected to fail until Step 3. Run only the files listed below.

**Verify**:
- `pnpm --filter @ditto/web exec vitest run src/lib/codex-request-contract.test.ts` → all pass.
- `pnpm typecheck` → exit 0. If the runtime package fails typecheck only because `createPrivateModelAdapter` still uses V1 types, that is expected; note it and continue.

### Step 3: Runtime adapter sends V2 and builds full assistant messages

In `pi-durable-models.ts`:
- **Request.** Build the request with `parseModelRequestV2({ version: 2, purpose, provider: model.provider, model: model.id, thinking, maxTokens: options?.maxTokens ?? 4096, transcript: semanticTranscript(transcript) })`.
  - `thinking` comes from `options.reasoning`, else `"off"`.
  - Pass the transcript as an **object**, not a string.
  - `ExactModelClaim.forRequest` parses with `parseModelRequestV2` and digests with `modelRequestDigestV2`.
- **Reply.** On `complete`, build the `AssistantMessage` from the frames in order:
  - `text` → `{ type: "text", text, textSignature }`;
  - `thinking` → `{ type: "thinking", thinking, thinkingSignature, redacted }`;
  - `toolCall` → `{ type: "toolCall", id, name, arguments }`;
  - the `done` frame sets `stopReason` and `usage`. `totalTokens` is `input + output`, and `cost` comes from the faux message's zero-cost usage.
  - Keep `api`, `provider` and `model` set as today. Keep the `failed_known` and error paths, and the faux-2 identity retention, exactly as they are.
- The faux provider registration stays; its models are still `faux-1` and `faux-2`.

Tests in `pi-durable-models.test.ts`, following the existing private-adapter tests:
1. The product receives a `version: 2` request whose transcript is an object containing the tool definitions from the system message.
2. Frames `thinking`, `text`, `toolCall`, `done(toolUse)` produce an `AssistantMessage` with those three blocks in order and `stopReason: "toolUse"`.
3. A `toolResult` message in the next request's transcript survives `parseModelRequestV2`.
4. An outcome with a `toolCall` frame but no `done` is an error, not a partial message.

Then the credential end-to-end exemplar (`codex-request-contract.worker.test.ts:1656`): update its assertions to V2 (`version: 2`, `provider`, `model: "faux-1"`, `thinking: "off"`, `maxTokens: 4096`, transcript object, header names). Add one end-to-end case where the fixture replies with a `toolCall` frame plus `done(toolUse)`; the snapshot must still show one admission in `complete`.

**Verify**:
- `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-models.test.ts` → all pass.
- `pnpm --filter @ditto/credential-tests exec vitest run src/codex-request-contract.worker.test.ts` → all pass.
- `pnpm typecheck` → exit 0.

### Step 4: Remove V1 request, frame and outcome code

Delete the following from `model.ts`:
- `SYNTHETIC_MODEL_URL`, `SyntheticModelBodyV1`, `parseSyntheticModelBodyV1`;
- `SyntheticModelRequestV1`, `parseSyntheticModelRequestV1`;
- `SyntheticFrameV1`, `parseSyntheticFrameV1`;
- `SyntheticModelOutcomeV1`, `syntheticModelRequestDigest`.

Keep `SYNTHETIC_MODEL_LIMITS`: its `deadlineMs` is used across `pi-durable-host.ts`. Delete its other fields only if nothing uses them. Keep `SyntheticAccountV1`, `SyntheticModelId` and `SyntheticThinking`. Fix any remaining imports in scope.

**Verify**:
- `grep -rnE "SyntheticModelBodyV1|SyntheticModelRequestV1|SyntheticFrameV1|SyntheticModelOutcomeV1|parseSyntheticModelRequestV1|parseSyntheticFrameV1|syntheticModelRequestDigest|readSyntheticStream|reconstructSyntheticRequest|SYNTHETIC_MODEL_URL\b" apps packages --include=*.ts --include=*.mjs | grep -v node_modules | grep -v /dist/` → no matches.
- `pnpm typecheck` → exit 0.

### Step 5: Raise the host's request and result bounds

Replace the literal `128_000` at the five sites listed in "Current state" with `MODEL_LIMITS_V2.requestBytes`. Change only the number; leave the surrounding logic and error messages alone. Then run the runtime suite.

**Verify**: `pnpm runtime:verify` → exit 0. If a test fails because it asserts the old bound (for example it builds a request just over 128 000 bytes and expects rejection), update that test to the new bound and say so in your report. Any other failure is a STOP.

### Step 6: Full gate

**Verify**: `pnpm verify` → exit 0 (see STOP for the known flake).

## Test plan

Covered in Steps 1–3. Every new test must fail if the check it covers is removed. In particular:
- the image-block rejection;
- the dropped assistant metadata;
- the key-order-independent digest;
- the tool-call reconstruction order;
- the zero-dispatch denials.

## Done criteria

- [ ] `pnpm verify` exits 0. The only exception: `apps/credential-tests/src/product-commands.worker.test.ts`, if it is the only failing file and it also fails at `ef6c850` without these changes.
- [ ] The Step 4 grep returns no matches
- [ ] `grep -n "128_000" apps/runtime/src/pi-durable-host.ts apps/runtime/src/pi-durable-summary.ts` → no matches
- [ ] `grep -rn "pi-ai\|pi-durable" packages/runtime-contracts/src/model.ts` → no matches
- [ ] `pnpm --filter @ditto/credential-tests exec node --test crash.test.mjs` passes
- [ ] `grep -n "requestAvailable(): boolean" -A2 apps/web/src/lib/codex-credential-do.ts` still returns `false`
- [ ] Only in-scope files changed; `plans/README.md` 041 row updated

## STOP conditions

- A "Current state" excerpt does not match the live code.
- The digest computed in the runtime and in product disagree for the same request, and canonical JSON does not fix it.
- pi's transcript contains a message or block shape the strict parser must reject in a normal turn, other than image blocks. Report the shape and do not widen the contract on your own.
- Making a step pass requires changing authority, capacity, claim or Stop ordering in `codex-credential-do.ts` or `pi-durable-host.ts`, or touching anything listed out of scope.
- Raising a bound in Step 5 breaks storage, encryption or checkpoint tests in a way that is not just an assertion about the old number.
- `pnpm verify` fails outside `product-commands.worker.test.ts`, after one rerun of a load-sensitive runtime timing test.

## Maintenance notes

- 038 adds `buildCodexUpstream` (Responses body from `TranscriptV2`) and a Codex SSE reader that produces `ModelFrameV2`. 039 adds the OpenAI-chat equivalents. Both choose the upstream from `request.provider`; neither changes the V2 contract unless a real provider needs a field it lacks.
- `signature` fields carry opaque provider state, such as Codex's encrypted reasoning, which Codex needs replayed when `store: false`. Keep them bounded and never log them.
- Deadlines still use the 30 s synthetic value. Real models need longer, which touches the host's operation windows. That belongs to 038 and 039, not here.
- Reviewers: check that no runtime-supplied URL, header or raw body reaches `fetch`; that authority ordering in `requestModel` is byte-for-byte unchanged apart from the request and upstream lines; and that the new tests assert rejection, not only success.
