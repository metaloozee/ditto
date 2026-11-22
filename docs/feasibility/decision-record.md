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
