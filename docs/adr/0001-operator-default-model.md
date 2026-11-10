# Operator-paid default model alongside Codex subscriptions

Ditto serves one default model from an operator-configured, OpenAI-compatible endpoint, paid by the operator, and lets users who connect a Codex subscription choose from that account's models instead. We chose this over Codex-only access because a user with no subscription would otherwise have no working agent. We chose it over a user-facing list of operator-paid models because one fixed model keeps the broker contract and operator cost bounded.

## Consequences

- The operator pays for every default-model request. Per-user limits use the model-request capacity pool.
- The Worker holds the endpoint URL and API key. The sandbox calls a fixed internal address that the outbound broker intercepts. It never sees the real URL or key.
- The broker accepts only the configured model ID and only request fields in its contract. An endpoint whose dialect needs other fields is not supported.
- A request a user made against their Codex model never falls back to the default model, or the reverse. A failure is reported, not rerouted.
- Claude access is undecided and out of scope.
