# Decision 035: operator default model, Codex as the first connected provider

Status: ACCEPTED by the maintainer on 2026-10-31. Drafted at `44c5739`. Plan 035, Step 1, copies the ADR and spec text below into `docs/`. This file stays as the record.

## What the maintainer decided

1. **Default model.** Ditto gets one default model, served from an OpenAI-compatible chat-completions endpoint that the operator configures: base URL, model ID and API key. The operator pays for it. Users cannot choose or change it. Changing it is a deployment configuration change.
2. **No picker for the default model.** While a user has no connected provider, the composer shows the default model and no model menu.
3. **Bring your own subscription, Codex first.** A user who connects a Codex (ChatGPT) subscription gets a model picker. It lists the default model plus the models that account can use. Codex is the only connected provider for now.
4. **Claude is deferred.** Whether to support Claude, and whether through a subscription or an API key, is an open maintainer decision. Nothing may be built for it yet.
5. **Initial configuration.** The first default model is the paid `deepseek-v4-flash` on OpenCode Zen (`https://opencode.ai/zen/v1`). This replaces `opencode/deepseek-v4-flash-free`, which OpenCode retired.

## ADR text (to copy to `docs/adr/0001-operator-default-model.md`)

```markdown
# Operator-paid default model alongside Codex subscriptions

Ditto serves one default model from an operator-configured, OpenAI-compatible endpoint, paid by the operator, and lets users who connect a Codex subscription choose from that account's models instead. We chose this over Codex-only access because a user with no subscription would otherwise have no working agent. We chose it over a user-facing list of operator-paid models because one fixed model keeps the broker contract and operator cost bounded.

## Consequences

- The operator pays for every default-model request. Per-user limits use the model-request capacity pool.
- The Worker holds the endpoint URL and API key. The sandbox calls a fixed internal address that the outbound broker intercepts. It never sees the real URL or key.
- The broker accepts only the configured model ID and only request fields in its contract. An endpoint whose dialect needs other fields is not supported.
- A request a user made against their Codex model never falls back to the default model, or the reverse. A failure is reported, not rerouted.
- Claude access is undecided and out of scope.
```

## Spec amendment (replaces `docs/specs/pi-durable-session-runtime.md` lines 378–382)

Replace the three paragraphs that begin "Initially, support only Codex through the user's connected ChatGPT subscription.", "The model picker must contain models available through the connected subscription." and "A bundled provider catalogue does not prove account entitlement." with:

```markdown
Ditto has one default model, served from an operator-configured OpenAI-compatible endpoint and paid by the operator (ADR 0001). Users cannot select or change it. Without a connected provider, the composer shows the default model and no model picker. Pi Durable remains the agent engine. Do not add the Codex CLI as a second engine. This amendment replaces the fixed `opencode/deepseek-v4-flash-free` model.

Codex is the first and, for now, only connected provider. A user who connects a Codex subscription gets a picker that lists the default model plus models available through that subscription. Show only thinking options supported by the selected model. Discover account-backed models and capabilities through privileged access. Claude support is an open maintainer decision.

A bundled provider catalogue does not prove account entitlement. Establish a supported discovery or validation method before claiming that the picker reflects actual account access. Do not expose arbitrary provider destinations: the default endpoint is operator configuration, never user input. Never reroute a request between the default model and a connected provider.
```

## `CONTEXT.md` change

Replace the `## Models` section's single entry with:

```markdown
### Default model

The one model every user can use without connecting a provider. The operator configures and pays for it. Users cannot select or change it.

### Connected provider

A model provider a user links with their own subscription. Codex is the only connected provider. Its models appear next to the default model in the model picker.

### Thinking level

A request for how much reasoning the selected model should apply. Ditto offers only the levels the selected model supports.
```
