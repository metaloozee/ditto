# Feasibility decision record

Spec #16 asks whether a bot can use its owner's model plan and reach the websites where the owner works. This record holds the choice for each question, the evidence behind it and the limits that remain open. See ADR-0003 (owner-supplied model access) and ADR-0004 (destination controls on computers with private logins).

Run trials against the isolated feasibility stage: `pnpm feasibility` from the repo root serves `http://localhost:1340/probe`. It keeps its state under `feasibility/.alchemy`, needs no `.env` and shares nothing with the `dev` stage, the auth suite or `verify-auth`. It deploys nothing to Cloudflare.

Each trial adds dated evidence entries under the section it informs, in the format in [evidence.md](evidence.md). A choice is filled in only once its evidence supports it. Until then, it reads _Undecided_.

## Model route

**Choice:** _Undecided_

**Unresolved limits:** _None recorded_

### Evidence

#### Local baseline (#25)

The owner runs these on their own account from the home network, so later failures can be blamed on hosting rather than the provider. Each command runs the pinned Pi runtime three times, 15 minutes apart, and prints a redacted entry to paste into the matching slot below. The ChatGPT sign-in is kept in `~/.config/ditto-feasibility/openai-codex.json`, outside the repo, so day 2 refreshes a day-old token.

```sh
pnpm feasibility:model --route chatgpt
OPENCODE_API_KEY=<key> pnpm feasibility:model --route opencode
```

##### Day 1 · ChatGPT plan

_Not yet run._

##### Day 2 · ChatGPT plan

_Not yet run. Must be a different date from day 1._

##### OpenCode API key

_Not yet run. Recorded apart from the ChatGPT result (ADR-0003)._

#### Free-tier Worker probe (#30)

A bare Worker on the Workers free tier answers one question: does OpenAI accept a token refresh and a Responses request from Cloudflare's network addresses, not only from the home network? It uses plain `fetch` and no Pi runtime, so it stays inside the free-tier CPU limit. Each run refreshes the token at `https://auth.openai.com/oauth/token`, then sends one request to `https://chatgpt.com/backend-api/codex/responses` on the new token.

The probe has its own Alchemy stack and stage (`ditto-free-tier-probe`, stage `free-tier-probe`). It runs from `feasibility/free-tier`, so its state lives in `feasibility/free-tier/.alchemy`. It creates one Worker, `ditto-free-tier-probe`, and one KV namespace, and touches no other stage's resources.

The probe signs in separately from the baseline, in `~/.config/ditto-feasibility/free-tier-codex.json`, so a refresh on one side never retires the other side's refresh token. The deploy command passes the tokens and a generated run key to the Worker as secrets, through the deploy process's environment. They never appear in the repo or a URL. The Worker keeps each rotated refresh token in its KV namespace, so the day 2 run refreshes a day-old token. The run command sends the run key in a header, and the Worker refuses runs without it.

Sign in to Cloudflare with Alchemy first. Then run:

```sh
pnpm feasibility:free-tier deploy    # first time: device-code ChatGPT sign-in, then deploy
pnpm feasibility:free-tier run       # one run, prints a redacted entry for the slots below
pnpm feasibility:free-tier destroy   # tears the stage down, prints the teardown entry
```

##### Day 1 · ChatGPT plan from Cloudflare

_Not yet run._

##### Day 2 · ChatGPT plan from Cloudflare

_Not yet run. Must be a different date from day 1._

##### Comparison with the local baseline

_Not yet compared. For each step, compare the Cloudflare result with the home-network result from the same day. Explain each difference, or mark it unexplained._

##### Does this justify Workers Paid?

_Undecided. Answer yes or no, and give the reason from the evidence above. If the Cloudflare network is accepted, Workers Paid is needed only for the CPU the Pi runtime uses (#26). If it is refused, Workers Paid does not help, and the Worker route falls back to a supported container route._

##### Teardown

_Not yet torn down. Paste the entry that `pnpm feasibility:free-tier destroy` prints._

## Desktop provider

**Choice:** _Undecided_

**Unresolved limits:** _None recorded_

### Evidence

_No entries yet._

## Egress policy

**Choice:** _Undecided_

**Unresolved limits:** _None recorded_

### Evidence

_No entries yet._

## Initial resources

Candidate instance size, resource inventory and package versions. Screen capacity is deferred until it is measured.

**Choice:** _Undecided_

**Unresolved limits:** _None recorded_

### Evidence

_No entries yet._

## Remaining experiments

_None recorded._

## External dependencies

### Hosted provider approval

Approval to onboard hosted users onto their ChatGPT plan is tracked here, apart from technical readiness. A passing trial does not unlock hosted plan onboarding.

**Status:** _Not started_

**Owner:** _Unassigned_

**Consequence while pending:** _None recorded_
