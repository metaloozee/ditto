# Let the operator include a model

Ditto runs in two modes: self-deployed, where the owner runs Ditto on their own Cloudflare account, and hosted, where one operator runs Ditto for other people. In both modes the operator may offer an included model through Workers AI, billed to the operator's account, beside the model connections owners supply (ADR-0003). Self-deployed, the operator is the owner, so the included model is still the owner's own access. Hosted, it lets people start without a key or plan, at the operator's cost.

No per-account spend limit applies while Ditto is early. Every included-model request goes through the account's Credentials object and carries the Ditto account in its AI Gateway metadata, so usage is attributed per account from the start and a later limit is checked at that single point without changing bots or turns.

## Consequences

- Until a limit exists, a hosted operator's Workers AI bill is bounded only by who they let sign in.
- The ChatGPT plan is not an included model. Hosted Ditto still needs OpenAI's approval before owners connect their plan.
