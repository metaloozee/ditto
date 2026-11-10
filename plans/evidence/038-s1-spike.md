# 038 spike S1: Codex model list and request shape

Run by the maintainer on 2026-11-10, on their own ChatGPT account (gates G1 and G2 resolved for local use), with a Codex CLI login, using a reviewer-written script that prints shapes only. No tokens, account IDs or response text were recorded.

## Run 1 (`client_version=0.99.0`)

**Model list.** `GET https://chatgpt.com/backend-api/codex/models?client_version=0.99.0` → 200, JSON `{ models: [...] }`. Headers sent: `authorization: Bearer <access>`, `chatgpt-account-id` (from the access token's `https://api.openai.com/auth.chatgpt_account_id` claim), `openai-beta: responses=experimental`, `originator: codex_cli_rs`. The response has an `etag`.

Model fields that matter to Ditto: `slug`, `display_name`, `description`, `context_window`, `max_context_window`, `default_reasoning_level`, `supported_reasoning_levels[]` (objects with `effort`), `input_modalities[]`, `supports_parallel_tool_calls`, `visibility`, `minimal_client_version`, `available_in_plans[]`, `supported_in_api`, `priority`, `base_instructions`. Many more fields are Codex-CLI-specific (`apply_patch_tool_type`, `shell_type`, `guardian`, `multi_agent_*`, `service_tiers`, ...).

Only one model came back: `codex-auto-review` (ctx 272000, reasoning low/medium/high/xhigh/max, input text/image). This is likely a `minimal_client_version` filter on the guessed `client_version`, not the account's real entitlement. **Open: rerun with the installed Codex CLI version.**

**Request.** `POST https://chatgpt.com/backend-api/codex/responses` with the same headers plus `content-type: application/json`, `accept: text/event-stream`, and body `{ model, instructions, input: [{ role: "user", content: [{ type: "input_text", text }] }], stream: true, store: false }` → 200. SSE events, in order: `response.created`, `response.in_progress`, `response.output_item.added`, `response.content_part.added`, `response.output_text.delta`, `response.metadata`, `response.output_text.done`, `response.content_part.done`, `response.output_item.done`, `response.completed`.

Response headers useful for capacity and readiness: `x-codex-plan-type`, `x-codex-active-limit`, `x-codex-primary-used-percent`, `x-codex-primary-window-minutes`, `x-codex-primary-reset-at`, `x-codex-primary-reset-after-seconds`, the same four for `secondary`, `x-codex-primary-over-secondary-limit-percent`, `x-codex-credits-balance`, `x-codex-credits-has-credits`, `x-codex-credits-unlimited`, `x-codex-turn-state`, `x-models-etag`.

## Run 2 (`client_version=0.167.0`, the installed Codex CLI)

Account plan type (`x-codex-plan-type`): **plus**. Same endpoints and headers as run 1, both 200.

Ten models came back. Eight have `visibility: list`; two have `visibility: hide` (`gpt-reserve`, `codex-auto-review`). All have `supported_in_api: true`, and every `available_in_plans` includes `plus`.

| slug | ctx | reasoning | input | visibility | min client |
|---|---|---|---|---|---|
| gpt-6.1-sol | 500000 | low/medium/high/xhigh/max/ultra | text/image | list | 0.153.0 |
| gpt-6-astra | 272000 | low/medium/high/xhigh/max/ultra | text/image | list | 0.153.0 |
| gpt-6.1-terra | 500000 | low/medium/high/xhigh/max/ultra | text/image | list | 0.153.0 |
| gpt-6-sol | 272000 | low/medium/high/xhigh/max/ultra | text/image | list | 0.155.0 |
| gpt-reserve | 272000 | low/medium/high/xhigh/max | text/image | hide | 0.144.0 |
| gpt-6-luna | 272000 | low/medium/high/xhigh/max | text/image | list | 0.155.0 |
| gpt-5.6-sol | 272000 | low/medium/high/xhigh/max/ultra | text/image | list | 0.144.0 |
| gpt-5.6-terra | 272000 | low/medium/high/xhigh/max/ultra | text/image | list | 0.144.0 |
| gpt-5.6-luna | 272000 | low/medium/high/xhigh/max | text/image | list | 0.144.0 |
| codex-auto-review | 272000 | low/medium/high/xhigh/max | text/image | hide | 0.98.0 |

The streamed request to `gpt-6.1-sol` returned the same ten SSE event types as run 1. Two extra response headers appeared: `x-codex-safety-buffering-enabled`, `x-codex-safety-buffering-faster-model`.

Run 1 is explained: the server filters models by `minimal_client_version` against the `client_version` query. A low version hides almost everything.

Note: pi-ai 0.85.1's bundled Codex catalog (`gpt-5.3-codex-spark gpt-5.4 gpt-5.4-mini gpt-5.5 gpt-5.6-luna gpt-5.6-sol gpt-5.6-terra gpt-6-astra`) overlaps this account's list only partly; it lacks the gpt-6.1 and gpt-6 sol/luna models and lists models the account does not return. This confirms the spec: the bundled catalog cannot be the entitlement source.

## Consequences for 038

- Discovery has a real per-account endpoint, so the bundled-catalog fallback (and its maintainer approval) is not needed.
- Ditto must send a `client_version` high enough to unlock current models (0.167.0 worked) and show only `visibility: "list"` models. The version should be one configured constant, raised when OpenAI raises minimums.
- `x-models-etag` on responses can tell Ditto when to refresh the cached model list.
