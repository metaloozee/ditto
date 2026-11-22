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

#### Local Worker compatibility (#26)

The same trial runs inside the local Workers runtime (`workerd`) under `alchemy dev`, so requests still leave from the home network and any difference from the baseline points at the runtime. Start the stage, then run each route in a second terminal. The command reuses the baseline's sign-in file, keeps the token the Worker's refresh rotates, and adds workerd's CPU time per step to the entry. Each command makes three runs, 15 minutes apart, as the baseline does.

```sh
pnpm feasibility
pnpm feasibility:model --route chatgpt --runtime workerd
OPENCODE_API_KEY=<key> pnpm feasibility:model --route opencode --runtime workerd
```

**Pinned runtime:** Pi `@earendil-works/pi-ai` 1.6.0, workerd 1.20261026.1, Alchemy 2.0.0-beta.87. The `model-trial` Worker (`feasibility/model-worker.ts`) uses compatibility date `2026-10-26`, which turns on `nodejs_compat`, plus Alchemy's default `new_module_registry`. `feasibility/compatibility.ts` holds these settings, and the Worker reports them at `GET http://localhost:1341/model-trial`.

**CPU time** is the on-CPU time of the workerd process, read from Linux `/proc` as each step finishes. A Worker cannot time itself: its clock stands still while code runs. The figure includes runtime overhead, so it is an upper bound. The limits are per request, and one trial is one request. The free plan allows 10ms of CPU per request. The paid plan allows 30s by default, configurable to 5 minutes. Against the simulated provider, whose own workerd process is counted too, the first turn after the Worker starts took about 45 to 90ms, because Pi loads its Responses code on first use. Later turns took about 4 to 8ms, and a warm trial request about 12 to 16ms. Both already exceed the free plan's limit. Real replies are longer, so the owner's run decides.

**Compatibility gaps found against the simulated provider in workerd:**

- **OAuth flows do not load from a bundle.** Pi imports its OAuth flow modules through a variable specifier, so the bundled Worker fails with `Module not found: file:///bundle/openai-codex.js`. The ChatGPT route then fails on its first turn as well as on refresh, because Pi needs the flow to turn the stored sign-in into request headers. Consequence: every Worker that uses a ChatGPT sign-in must call `registerLazyOAuthFlows()` from `@earendil-works/pi-ai/lazy-oauth` at startup, as `model-worker.ts` does. Pi documents that module as Node-only, but refresh passes with it in workerd.
- **Sign-in cannot run in a Worker.** Pi's ChatGPT login flows start a `node:http` callback server or poll a device code from a terminal. The command signs in from Node and sends the stored sign-in to the Worker. Consequence: a hosted bot needs its own sign-in step outside the Worker, which later work has to design.
- **The WebSocket transport is not used.** The trial forces SSE over `fetch` on the ChatGPT route, as the baseline does. Pi's WebSocket transport passes request headers in a constructor option that workerd's `WebSocket` does not take, so it would connect without the sign-in. This is read from Pi's code and was not exercised, because it would reach the real endpoint. Consequence: Worker turns use SSE only and lose Pi's WebSocket cached-context mode.
- **No gap with streaming, timers or compression.** SSE replies parse in workerd, `setTimeout` works, and `node:zlib` has `zstdCompressSync`, so Pi sends the same zstd-compressed request body as under Node.
- **The trial swaps the global `fetch`.** Pi calls the global `fetch` for refresh, so the harness wraps it for the length of a trial. Concurrent trials in one isolate would see each other's wrapper. Consequence: run one trial at a time. This is a harness limit, not a Pi limit.

**Before #31 deploys this Worker,** gate `POST /model-trial` (for example with Cloudflare Access). It accepts a credential in the request body and spends it on the owner's account, so an open deployed endpoint would relay requests for anyone who can reach it. Nothing in this stage deploys to Cloudflare.

##### ChatGPT plan in local Worker

_Not yet run. Compare with the day 1 and day 2 baseline entries._

##### OpenCode API key in local Worker

_Not yet run. Compare with the OpenCode baseline entry._

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
