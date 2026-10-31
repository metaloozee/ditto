# Plan 039: The default model in the new runtime (conditional brief)

Status: BLOCKED on 035 being DONE. **Conditional brief:** refresh it from 035's evidence and the live code before execution. Planned at `44c5739`, 2026-10-31. Category: direction. Effort: L. Risk: MED. It replaces open decision 9's option (b), a local fake model, because a real default model gives the local smoke test and users without Codex a working model.

## Outcome

In the new runtime (candidate sessions), a user with no connected provider can create a session and get answers from the operator's default model (decision `plans/decisions/035-default-model-and-codex-subscriptions.md`). With Codex connected (038), the picker lists the default model plus the account's models. Default-model requests are counted against per-user limits, because the operator pays.

## Current state (at `44c5739`)

- A first candidate prompt is refused with `model_unconfigured` unless the user has a connected Codex account **and** a fake-account row in `codex_fixture_capabilities` (`apps/web/src/lib/session-command-candidate.ts:369-381`; `apps/web/src/lib/model-product-authority.ts:65-96`). So no candidate session can be created on the wired local stack today.
- All model requests route through the user's `CodexCredential` object (`codex-credential-do.ts:225`, `requestModel`). The default model has no credential object and no request contract in the new runtime.
- 035 adds `readDefaultModel(env)` in `apps/web/src/lib/default-model.ts` and the broker check for the legacy path. Reuse both; do not create a second config format.
- Model admission already has a capacity pool (`candidate_capacity_claims`, pool `model`; plan 015).

## Proposed steps (provisional)

1. Readiness: when there is no Codex connection, `preSessionReadiness` returns a default-model readiness, and selection `{ model: "ditto/default" }` is valid.
2. A default-model transport in the product Worker. It reuses 035's validated chat-completions contract and the operator key. It is admitted through the `model` capacity pool with a per-user limit the maintainer sets.
3. pi-durable provider registration for `ditto/default` in the runtime, mirroring 035's runner registration (`registerProvider` with `openai-completions`).
4. Product composition: enable the model helpers for default-model sessions.
5. Then 019's local smoke on the wired stack: sign in → import → prompt (default model) → baseline → Git → preview → archive → delete.

## Open inputs

- The maintainer sets the per-user default-model limit (requests per hour or tokens per day).
- If 038 lands first, the picker composition merges both sources. Otherwise it shows the default model only, with no menu, per the decision.
