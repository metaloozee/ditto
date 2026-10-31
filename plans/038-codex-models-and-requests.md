# Plan 038: Codex model discovery and real model requests (conditional brief)

Status: BLOCKED on 037 being DONE, on gates G1 and G2 from 037, and on spike S1 below. This is a **conditional brief** in the sense of `plans/README.md` ("Later files are conditional implementation briefs"). Before execution, refresh it from 037's evidence and the live code: stamp a new base commit, replace provisional names with real ones, and split it if S1 changes its size. Planned at `44c5739`, 2026-10-31. Category: direction. Effort: L. Risk: HIGH.

## Outcome

A user with a connected Codex subscription sees that account's models in the new runtime's picker, next to the default model (decision `plans/decisions/035-default-model-and-codex-subscriptions.md`). Selecting one sends real model requests from the credential object to ChatGPT's Codex backend. Tokens never leave that object.

## Current state (at `44c5739`)

- The new runtime's model path is fixture-only. `CodexCredential.requestModel` returns `{ version: 1, status: "unavailable" }` unless `requestAvailable()` is overridden (`apps/web/src/lib/codex-credential-do.ts:202-230`). The only request shape is the synthetic one: `apps/web/src/lib/codex-request-contract.ts` rebuilds a `SyntheticModelRequestV1` to `SYNTHETIC_MODEL_URL` (`packages/runtime-contracts/src/model.js`), which the spec calls "not a Codex protocol" (`docs/specs/pi-durable-session-runtime.md:627`).
- Readiness and discovery read a fake account snapshot from D1 `codex_fixture_capabilities` (`apps/web/src/lib/model-product-authority.ts:65-96`, `preSessionReadiness`). Production composition passes `false` to all three model helpers (`apps/web/src/lib/candidate-product.ts` around lines 306, 315 and 323).
- pi-ai 0.85.1 implements the real wire protocol in `dist/api/openai-codex-responses.js`. It posts to `${baseUrl}/codex/responses` with base `https://chatgpt.com/backend-api` (lines 19 and 458-462), and sets headers `chatgpt-account-id` (from the access token's `https://api.openai.com/auth` claim) and `originator` (line 1273-1274). Its bundled Codex catalog lists `gpt-5.3-codex-spark gpt-5.4 gpt-5.4-mini gpt-5.5 gpt-5.6-luna gpt-5.6-sol gpt-5.6-terra gpt-6-astra`. The spec says a bundled catalog does not prove entitlement (`:382`).
- Production `CodexCredential.modelCapacity()` returns `undefined` (`codex-credential-do.ts:452-454`). Before any production model work, compose `CandidateCapacity` there, as `CandidateFixtureCredential.modelCapacity` does (`apps/credential-tests/src/entry.ts:215-222`).

## Spike S1 (approval G2 needed; the maintainer runs it)

With the approved account, record:
1. whether the Codex backend exposes a model list for the account (try the endpoint the Codex CLI uses for its model picker), and its response shape;
2. one minimal `codex/responses` request and its streamed response, redacted (headers and event types only).

Without a real list, the fallback rule is: offer the bundled catalog filtered to models whose first request succeeds, and mark the rest unavailable after a denial. That rule needs the maintainer's approval, because the spec forbids claiming entitlement from the catalog.

## Proposed steps (provisional)

1. A real Codex request contract next to the synthetic one: exact URL, headers and body keys, bounded like `open-code-contract.ts`'s `BODY_KEYS`.
2. `CodexCredential`: a production `requestAvailable()` behind `CODEX_DEVICE_AUTH`, real dispatch with `chatgpt-account-id` from the stored identity, and `modelCapacity()` composed.
3. Discovery from S1's method, stored as the account snapshot that `preSessionReadiness` reads, replacing the fixture table for real connections.
4. `candidate-product.ts`: pass `true` to the model helpers only when the connection is a real Codex connection.
5. Never reroute: a failed Codex request fails the turn and never falls back to the default model.

## Stop conditions

Any need to send tokens to the runtime or sandbox. A request shape that cannot be bounded. Discovery that only works by trusting the bundled catalog without the maintainer's approval.
