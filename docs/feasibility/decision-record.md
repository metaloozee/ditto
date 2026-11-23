# Feasibility decision record

Spec #16 asks whether a bot can use its owner's model plan and reach the websites where the owner works. This record holds the choice for each question, the evidence behind it and the limits that remain open. See ADR-0003 (owner-supplied model access) and ADR-0004 (destination controls on computers with private logins).

Run trials against the isolated feasibility stage: `pnpm feasibility` from the repo root serves `http://localhost:1340/probe`. It keeps its state under `feasibility/.alchemy`, needs no `.env` and shares nothing with the `dev` stage, the auth suite or `verify-auth`. It deploys nothing to Cloudflare.

Each trial adds dated evidence entries under the section it informs, in the format in [evidence.md](evidence.md). A choice is filled in only once its evidence supports it. Until then, it reads _Undecided_.

**Status (2026-11-22): provisional.** The owner completed the ChatGPT baseline on two local dates and the OpenCode baseline from the home network (#25). All three runs passed on each route. Both ChatGPT and OpenCode passed all three runs per route in local workerd (#26). The deployed free-tier probe (#30) failed all six runs from SIN across two local dates. The hosted choices remain provisional. The account is on the Workers free plan, and #31 and #32 require Workers Paid. See [Remaining experiments](#remaining-experiments).

## Model route

**Choice: Provisional.** The pinned Pi runtime (`@earendil-works/pi-ai` 1.6.0) in a Bot Durable Object on Workers Paid, using SSE over `fetch`, on a connection the owner supplies (ADR-0003). Ditto will be open source and offered in two modes, and the connections each mode may use differ:

| Connection                                                                | Self-deployed (owner's Cloudflare account)                                                     | Hosted by Ditto                                                            |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| OpenCode API key (`OPENCODE_API_KEY`)                                     | yes                                                                                            | yes, the owner's key                                                       |
| Workers AI (`AI` binding), the included model                             | yes, billed to the owner's account; candidate `@cf/deepseek-ai/deepseek-v4.1-flash-1017` (#35) | yes, billed to the operator's account, no per-account limit yet (ADR-0011) |
| ChatGPT plan through Sign in with ChatGPT (`api.openai.com/v1/responses`) | candidate, following OpenAI's self-hosted guide; trial #34                                     | only after OpenAI approves the hosted app through its interest form        |

The OpenCode API key is the first connection to build on. It is recorded apart from every ChatGPT result and does not stand in for it.

The Codex backend that Pi's `openai-codex` provider calls (`https://chatgpt.com/backend-api/codex/responses`) is not a supported plan-usage endpoint: OpenAI's [plan usage docs](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) say not to point plan usage at ChatGPT's backend-api endpoints, and it refuses Cloudflare's network (#30). Its #25 and #26 results stay as evidence for local use only.

**Evidence today:** The [Day 1 ChatGPT baseline](#day-1--chatgpt-plan) passed inference and token refresh in Node on the home network. The [OpenCode baseline](#opencode-api-key) passed both inference turns in all three runs. The [OpenCode trial in local workerd](#opencode-api-key-in-local-worker) matched the Node baseline on all three runs. The [ChatGPT trial in local workerd](#chatgpt-plan-in-local-worker) also matched the Node baseline: inference and token refresh succeeded on all three runs. The [free-tier probe](#day-1--chatgpt-plan-from-cloudflare) refreshed its token but received HTTP 403 on every inference request. On Workers Paid (#31), the [OpenCode route passed](#opencode-api-key-in-deployed-worker) all three runs with Pi, at worst 118ms of CPU per request. The [ChatGPT route](#chatgpt-plan-in-deployed-worker) got the same 403 as the free-tier probe, from OpenAI's edge block page.

**Security guarantees it supports:**

- Every request spends the owner's own access. Ditto holds no shared upstream key (ADR-0003).
- A trial Worker that accepts a credential refuses every request without the stage's run key (`feasibility/run-key.ts`), so a deployed endpoint does not relay for anyone who can reach it. Production needs a real owner sign-in in its place.
- The paid trial Worker stores no credential. The free-tier probe keeps its rotated ChatGPT tokens in its own KV namespace between runs, a trial-only exception noted under [Free-tier Worker probe (#30)](#free-tier-worker-probe-30). Each sign-in file lives outside the repo, one per stage, so no stage retires another's refresh token.

**Unresolved limits:**

- The second local-date baseline passed about nine hours after the last Day 1 run. Refresh after a full day remains unverified. The free-tier probe (#30) repeated its Day 1 result on the second local date.
- **Pi OAuth flows do not load from a bundle in workerd.** Fallback selected: call `registerLazyOAuthFlows()` from `@earendil-works/pi-ai/lazy-oauth` at Worker startup, as `model-worker.ts` does. Pi documents that module as Node-only. Refresh passed with Pi 1.6.0 against both the simulator and the live endpoint in local workerd. Re-run `feasibility/model-worker.test.ts` on every Pi bump.
- **A warm Pi trial request used about 12 to 16ms of CPU, above the free plan's 10ms** (first turn after start 45 to 90ms; simulated provider, upper bound). Consequence: the Pi Worker route needs Workers Paid. On the free plan the only Worker-side check is the plain-`fetch` probe (#30), which proves the network, not the runtime. Deployed on Workers Paid (#31), a whole trial request with a live OpenCode reply used 62 to 118ms. Real replies are longer than "pong", so longer turns are still unmeasured.
- Sign-in cannot run in a Worker (Pi's flows need `node:http` or a terminal). Consequence: a hosted bot needs a sign-in step outside the Worker, which later work designs.
- Pi's WebSocket transport is unused in workerd (headers go in a constructor option workerd does not take). Consequence: SSE only, without Pi's WebSocket cached-context mode. Read from Pi's code, not exercised.
- The harness swaps the global `fetch` per trial. Consequence: one trial at a time per isolate. Production code must pass `fetch` explicitly or isolate turns.
- **Every Cloudflare trial so far ran in a plain Worker, not a Durable Object.** A Durable Object shares the Worker's runtime and network, so #26 and #30 still apply, but its CPU budget differs (Cloudflare documents 30s per request or message for an Agent). #34 and #35 record CPU from a Durable Object.
- **The supported ChatGPT plan flow restricts requests.** It requires `store: false` and `stream: true` and rejects `temperature`, `max_output_tokens`, `previous_response_id` over HTTP and system-role items. Whether Pi sends any of them is untested (#34). Access tokens last 1 hour and refresh tokens 30 days, renewed on each refresh, per OpenAI's [token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference).

**Fallbacks:**

- #30 showed the Codex backend refuses Cloudflare's network. That endpoint is not the supported plan-usage route, so the result does not decide ChatGPT plan access on Cloudflare: #34 does, against `api.openai.com/v1/responses`. If #34 is refused from the Durable Object, the ChatGPT plan stays local-only for self-deployed Ditto and needs OpenAI's approval for hosted Ditto. The OpenCode API key and the included model (Workers AI, ADR-0011) carry the hosted model route.
- If #31 fails only with Pi in the path: the same container route, with the failing step recorded against Pi.
- If the owner stays on the free plan: no deployed Pi route exists. Ditto stays local-only, and model turns run under Node from the owner's machine, the #25 baseline shape.
- If ChatGPT plan access is unavailable to the owner: the OpenCode API key route carries the harness and the first delegated task. Hosted ChatGPT onboarding keeps its own gates.
- If the included Workers AI model is retired (HTTP 410, as Kimi K2.6 was): move to the second choice, `@cf/zai-org/glm-5.3` (#35). If no Workers AI model calls tools reliably: Ditto offers no included model and relies on the OpenCode API key.

**Owner evidence that confirms or overturns it:** #25 day 1 and day 2 (refresh of a day-old token) and the OpenCode baseline; #26 in local workerd on both routes, with real CPU figures; #30 day 1 and day 2 from Cloudflare; #31 on Workers Paid. A refusal from Cloudflare's network in #30, or a deployed CPU figure above what Workers Paid allows per request, overturns the Worker route.

### Evidence

#### Local baseline (#25)

The owner runs these on their own account from the home network, so later failures can be blamed on hosting rather than the provider. Each command runs the pinned Pi runtime three times, 15 minutes apart, and prints a redacted entry to paste into the matching slot below. The ChatGPT sign-in is kept in `~/.config/ditto-feasibility/openai-codex.json`, outside the repo, so day 2 refreshes a day-old token.

```sh
pnpm feasibility:model --route chatgpt
OPENCODE_API_KEY=<key> pnpm feasibility:model --route opencode
```

##### Day 1 · ChatGPT plan

###### 2026-11-22 · OpenAI Responses on ChatGPT plan from home network · pass

- **Route:** Pi `openai-codex` provider, model `gpt-5.6-luna`: one turn at https://chatgpt.com/backend-api/codex/responses, expire the stored access token and refresh it at `<account claim>/oauth/token`, then one more turn
- **Runtime:** Pi `@earendil-works/pi-ai` 1.6.0, each step lists every HTTP attempt it made
- **Date:** 2026-11-22, 09:04 UTC
- **Network origin:** home network
- **Expected:** both turns return 200 and reply "pong". The refresh returns 200 with a new access token, and the second turn succeeds on it.
- **Observed:** turn passed (chatgpt.com/backend-api/codex/responses 200): replied "pong", 5 output tokens in 1.8s. refresh passed (auth.openai.com/oauth/token 200): new access token valid for 240h, a new refresh token. turn after refresh passed (chatgpt.com/backend-api/codex/responses 200): replied "pong", 5 output tokens in 2.4s. 3 of 3 runs passed.
- **Retries:** 09:20 UTC pass, 09:35 UTC pass
- **Fallback:** none needed

##### Day 2 · ChatGPT plan

###### 2026-11-23 local date · OpenAI Responses on ChatGPT plan from home network · pass

- **Route:** Pi `openai-codex`, model `gpt-5.6-luna`, using the same inference, forced refresh and second inference sequence as Day 1.
- **Runtime:** Pi `@earendil-works/pi-ai` 1.6.0 under Node.
- **Date:** 2026-11-22, 18:39 UTC (2026-11-23, 00:09 in Asia/Kolkata).
- **Network origin:** home network.
- **Expected:** both turns return 200 and reply "pong". Refresh returns 200 with a new access token.
- **Observed:** both requests to `chatgpt.com/backend-api/codex/responses` returned 200 and replied "pong" with 5 output tokens each, in 1.7s and 1.0s. Refresh at `auth.openai.com/oauth/token` returned 200 with a new refresh token and an access token valid for 240h. All three runs passed.
- **Retries:** 18:55 UTC pass, 19:11 UTC pass.
- **Fallback:** none needed.

The first run started 9h 04m after the last recorded Day 1 run at 09:35 UTC. This covers two calendar dates in Asia/Kolkata. Refresh after 24h remains untested.

##### OpenCode API key

###### 2026-11-22 · OpenAI Responses on OpenCode API key from home network · pass

- **Route:** Pi `opencode` provider, model `gpt-5.4-mini`: one turn at https://opencode.ai/inference/openai/v1/responses, skip refresh (an API key has none), then one more turn
- **Runtime:** Pi `@earendil-works/pi-ai` 1.6.0, each step lists every HTTP attempt it made
- **Date:** 2026-11-22, 12:29 UTC
- **Network origin:** home network
- **Expected:** both turns return 200 and reply "pong".
- **Observed:** turn passed (opencode.ai/inference/openai/v1/responses 200): replied "pong", 5 output tokens in 1.0s. refresh not applicable: an API key has no refresh exchange. turn after refresh passed (opencode.ai/inference/openai/v1/responses 200): replied "pong", 5 output tokens in 0.8s. 3 of 3 runs passed.
- **Retries:** 12:44 UTC pass, 13:00 UTC pass
- **Fallback:** none needed

#### Local Worker compatibility (#26)

The same trial runs inside the local Workers runtime (`workerd`) under `alchemy dev`, so requests still leave from the home network and any difference from the baseline points at the runtime. Start the stage, then run each route in a second terminal. The command reuses the baseline's sign-in file, keeps the token the Worker's refresh rotates, and adds workerd's CPU time per step to the entry. Each command makes three runs, 15 minutes apart, as the baseline does.

```sh
pnpm feasibility
pnpm feasibility:model --route chatgpt --runtime workerd
OPENCODE_API_KEY=<key> pnpm feasibility:model --route opencode --runtime workerd
```

**Pinned runtime:** Pi `@earendil-works/pi-ai` 1.6.0, workerd 1.20261026.1, Alchemy 2.0.0-beta.87. The `model-trial` Worker (`feasibility/model-worker.ts`) uses compatibility date `2026-10-26`, which turns on `nodejs_compat`, plus Alchemy's default `new_module_registry`. `feasibility/compatibility.ts` holds these settings, and the Worker reports them at `GET http://localhost:1341/model-trial`.

**CPU time** is the on-CPU time of the workerd process, read from Linux `/proc` as each step finishes. A Worker cannot time itself: its clock stands still while code runs. The figure includes runtime overhead, so it is an upper bound. The limits are per request, and one trial is one request. The free plan allows 10ms of CPU per request. The paid plan allows 30s by default, configurable to 5 minutes. Against the simulated provider, whose own workerd process is counted too, the first turn after the Worker starts took about 45 to 90ms, because Pi loads its Responses code on first use. Later turns took about 4 to 8ms, and a warm trial request about 12 to 16ms. The live OpenCode trial recorded a peak of 71ms for a whole request on the local machine. Deployed CPU usage remains unmeasured.

**Compatibility gaps found against the simulated provider in workerd:**

- **OAuth flows do not load from a bundle.** Pi imports its OAuth flow modules through a variable specifier, so the bundled Worker fails with `Module not found: file:///bundle/openai-codex.js`. The ChatGPT route then fails on its first turn as well as on refresh, because Pi needs the flow to turn the stored sign-in into request headers. Consequence: every Worker that uses a ChatGPT sign-in must call `registerLazyOAuthFlows()` from `@earendil-works/pi-ai/lazy-oauth` at startup, as `model-worker.ts` does. Pi documents that module as Node-only, but refresh passes with it in workerd.
- **Sign-in cannot run in a Worker.** Pi's ChatGPT login flows start a `node:http` callback server or poll a device code from a terminal. The command signs in from Node and sends the stored sign-in to the Worker. Consequence: a hosted bot needs its own sign-in step outside the Worker, which later work has to design.
- **The WebSocket transport is not used.** The trial forces SSE over `fetch` on the ChatGPT route, as the baseline does. Pi's WebSocket transport passes request headers in a constructor option that workerd's `WebSocket` does not take, so it would connect without the sign-in. This is read from Pi's code and was not exercised, because it would reach the real endpoint. Consequence: Worker turns use SSE only and lose Pi's WebSocket cached-context mode.
- **No gap with streaming, timers or compression.** SSE replies parse in workerd, `setTimeout` works, and `node:zlib` has `zstdCompressSync`, so Pi sends the same zstd-compressed request body as under Node.
- **The trial swaps the global `fetch`.** Pi calls the global `fetch` for refresh, so the harness wraps it for the length of a trial. Concurrent trials in one isolate would see each other's wrapper. Consequence: run one trial at a time. This is a harness limit, not a Pi limit.

**Before #31 deploys this Worker,** gate `POST /model-trial` (for example with Cloudflare Access). It accepts a credential in the request body and spends it on the owner's account, so an open deployed endpoint would relay requests for anyone who can reach it. Nothing in this stage deploys to Cloudflare. #31 deploys it behind a run key: see Deployed Pi trial below.

##### 2026-11-22 · Pi in local workerd against the simulated provider · pass

- **Route:** `feasibility/model-worker.test.ts` runs the `model-trial` Worker under `alchemy dev`: turn, refresh, turn on the ChatGPT route and both turns on the OpenCode route, against the simulated provider (`feasibility/simulated-provider-worker.ts`), not a real endpoint
- **Runtime:** Pi `@earendil-works/pi-ai` 1.6.0, workerd 1.20261026.1, compatibility date `2026-10-26`
- **Date:** 2026-11-22
- **Network origin:** local Worker (alchemy dev)
- **Expected:** both turns stream a reply and the refresh rotates the token, as under Node
- **Observed:** without `registerLazyOAuthFlows()` the first turn failed with `Module not found: file:///bundle/openai-codex.js`. With it, both turns and the refresh passed. SSE parsed, `setTimeout` worked, and the request body was zstd-compressed as under Node.
- **Retries:** the automated suite, repeated during #26
- **Fallback:** call `registerLazyOAuthFlows()` at Worker startup
- **CPU time:** workerd process CPU from `/proc`, simulated provider included, so an upper bound. First turn after start about 45 to 90ms, later turns about 4 to 8ms, a warm trial request about 12 to 16ms. Over the free plan's 10ms per request, inside Workers Paid's 30s default.

##### ChatGPT plan in local Worker

###### 2026-11-22 · OpenAI Responses on ChatGPT plan from local Worker (alchemy dev) · pass

- **Route:** Pi `openai-codex`, model `gpt-5.6-luna`. Send a turn to `chatgpt.com/backend-api/codex/responses`, expire the stored access token, refresh at `auth.openai.com/oauth/token`, then send another turn.
- **Runtime:** Pi `@earendil-works/pi-ai` 1.6.0 in workerd, compatibility date `2026-10-26`, with `nodejs_compat` on by date and `new_module_registry` on by Alchemy default.
- **Date:** 2026-11-22, 20:05 UTC.
- **Network origin:** local Worker under `alchemy dev`, home network.
- **Expected:** both turns return 200 and reply "pong". Refresh returns 200 and the second turn succeeds with the new token.
- **Observed:** all three runs passed, matching both dates of the Node baseline. In the first run, each turn returned 200 and replied "pong" with 5 output tokens, in 2.2s before refresh and 2.4s after. Refresh returned 200 with a new refresh token and an access token valid for 240h.
- **Retries:** 20:21 UTC pass, 20:37 UTC pass.
- **Fallback:** none needed.
- **CPU time:** the highest single turn measured 35ms and the highest whole trial request measured 53ms. The latter exceeds the free plan's 10ms per request and fits within the paid default of 30s (configurable to 5 minutes). These local workerd process measurements are upper bounds.

| Run | First turn | Refresh | Second turn |
| --- | ---------- | ------- | ----------- |
| 1   | 35ms       | 11ms    | 6.8ms       |
| 2   | 6.8ms      | 3.1ms   | 13ms        |
| 3   | 7.0ms      | 3.8ms   | 4.7ms       |

##### OpenCode API key in local Worker

###### 2026-11-22 · OpenAI Responses on OpenCode API key from local Worker (alchemy dev) · pass

- **Route:** Pi `opencode` provider, model `gpt-5.4-mini`: two turns at https://opencode.ai/inference/openai/v1/responses. An API key has no refresh exchange.
- **Runtime:** Pi `@earendil-works/pi-ai` 1.6.0 in workerd, compatibility date `2026-10-26`, with `nodejs_compat` on by date and `new_module_registry` on by Alchemy default. The Worker reported `simulatedProvider: false`.
- **Date:** 2026-11-22, 13:02 UTC
- **Network origin:** local Worker (alchemy dev), home network
- **Expected:** both turns return 200 and reply "pong".
- **Observed:** both turns returned HTTP 200 and replied "pong" with 5 output tokens each. The first run took 0.9s for the first turn and 0.7s for the second. All 3 runs passed, matching the [OpenCode baseline in Node](#opencode-api-key).
- **Retries:** 13:17 UTC pass, 13:33 UTC pass
- **Fallback:** none needed
- **CPU time:** first and second turns used 61ms and 9.3ms in run 1, 14ms and 9.1ms in run 2, and 10.0ms and 3.8ms in run 3. The worst whole trial request measured 71ms, above the free plan's 10ms per request and below the paid plan's 30s default (configurable to 5 minutes). Local workerd process CPU is an upper bound.

#### Free-tier Worker probe (#30)

A bare Worker on the Workers free tier answers one question: does OpenAI accept a token refresh and a Responses request from Cloudflare's network addresses, not only from the home network? It uses plain `fetch` and no Pi runtime, so it stays inside the free-tier CPU limit. Each run follows the baseline's sequence: one request to `https://chatgpt.com/backend-api/codex/responses` on the token the Worker holds, a refresh at `https://auth.openai.com/oauth/token`, then one more request on the new token. `run` repeats this 3 times, 15 minutes apart, like the baseline, and lists the later runs under **Retries**.

The probe has its own Alchemy stack and stage (`ditto-free-tier-probe`, stage `free-tier-probe`). It runs from `feasibility/free-tier`, so its state lives in `feasibility/free-tier/.alchemy`. It creates one Worker, `ditto-free-tier-probe`, and one KV namespace, and touches no other stage's resources.

The probe signs in separately from the baseline, in `~/.config/ditto-feasibility/free-tier-codex.json`, so a refresh on one side never retires the other side's refresh token. The deploy command passes the tokens and a generated run key to the Worker as secrets, through the deploy process's environment. They never appear in the repo or a URL. The Worker keeps each rotated refresh token in its KV namespace, so the day 2 run refreshes a day-old token. Unlike the paid trial, this Worker therefore holds the owner's ChatGPT credential at rest between runs. ADR-0003 requires owner-supplied access but says nothing about where it is kept; storing it at rest in KV is a trial-only choice, and production storage needs its own decision. Destroying the stage deletes the namespace with the tokens. The run command sends the run key in the `x-trial-key` header, and the Worker refuses runs without it.

Sign in to Cloudflare with Alchemy first. Then run:

```sh
pnpm feasibility:free-tier deploy    # first time: device-code ChatGPT sign-in, then deploy
pnpm feasibility:free-tier run       # 3 runs 15 minutes apart (--runs, --interval-minutes), one redacted entry
pnpm feasibility:free-tier destroy   # tears the stage down, prints the teardown entry
```

##### Day 1 · ChatGPT plan from Cloudflare

###### 2026-11-22 · ChatGPT plan from the deployed free-tier Worker · fail

- **Route:** plain `fetch` to `chatgpt.com/backend-api/codex/responses` with model `gpt-5.6-luna`, refresh at `auth.openai.com/oauth/token`, then repeat inference.
- **Runtime:** deployed Worker on the free plan, without Pi.
- **Date:** 2026-11-22, 14:00 UTC
- **Network origin:** Cloudflare Worker, data centre SIN.
- **Expected:** both inference calls return 200 and reply "pong". Refresh returns 200 and issues a new access token.
- **Observed:** 0 of 3 runs passed. The first refresh returned 200, rotated the refresh token and issued an access token valid for 240 hours. Inference returned 403 with an HTML body both before and after refresh.
- **Worker timing (first run):** Cloudflare logged `POST /run` at 14:00:12.241 UTC in SIN. The Worker returned HTTP 200 to the CLI with the failed trial result. The invocation used 4ms of CPU over 1,106ms of wall time.
- **Retries:** 14:15 and 14:31 UTC. Both runs again received 403 on both inference calls.
- **Fallback:** evaluate a supported container route under spec #16 if the Worker route remains unsuitable.

A separate Cloudflare event at 14:01:20 UTC recorded a browser requesting `GET /` in SIN. The Worker returned its expected 404. The event's 0ms CPU time applies only to that request. The CLI invoked `POST /run` for the trials above.

##### Day 2 · ChatGPT plan from Cloudflare

###### 2026-11-23 local date · ChatGPT plan from the deployed free-tier Worker · fail

- **Route:** plain `fetch` to `chatgpt.com/backend-api/codex/responses` with `gpt-5.6-luna`, refresh at `auth.openai.com/oauth/token`, then a second inference request.
- **Runtime:** deployed free-tier Worker without Pi.
- **Date:** 2026-11-22, 19:13 UTC (2026-11-23, 00:43 in Asia/Kolkata), 4h 42m after the last Day 1 run.
- **Network origin:** Cloudflare Worker, data centre SIN.
- **Expected:** both inference requests return 200 and reply "pong". Refresh returns 200 with a new access token.
- **Observed:** 0 of 3 runs passed. On the first run, refresh returned 200, rotated the refresh token and issued an access token valid for 240h. Inference returned 403 with an HTML body both before and after refresh.
- **Retries:** 19:29 and 19:45 UTC. Both runs returned 403 on both inference requests.
- **Fallback:** evaluate a supported container route under spec #16.

##### Comparison with the local baseline

Across two local dates, all six home-network runs passed with Pi. All six deployed Worker runs failed with plain fetch: every inference request returned 403 (12 total), including the requests after refresh. The first run on each date recorded a successful refresh. The HTML excerpts give no reason for the refusal. Both the client and the network differed between the trials.

**Follow-up:** Keep both dates as evidence for this Codex backend probe. For local Ditto, test a separate sign-in that requests ChatGPT plan usage permission, then call `https://api.openai.com/v1/responses` with the token issued for that integration. For remotely hosted Ditto, submit the hosted-app interest form and confirm access before testing that integration on a Worker. [OpenAI plan usage and hosted-app interest form](https://developers.openai.com/siwc/token-sharing-open-source) · [Sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) · [Inference endpoint](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)

##### Does this justify Workers Paid?

No upgrade is justified by #30. The Worker completed the requests and reported upstream HTTP 403 responses. The measured Day 1 invocation used 4ms of CPU. These runs provide no evidence that more CPU would resolve the refusal.

##### Teardown

###### 2026-11-22 · Free-tier probe stage torn down · pass

- **Date:** 2026-11-22, 20:04 UTC.
- **Command:** `pnpm feasibility:free-tier destroy` ran `alchemy destroy --stage free-tier-probe` and exited 0.
- **Removed:** Alchemy deleted the `ditto-free-tier-probe` Worker and its KV namespace, and removed the probe bindings, including its secrets. The teardown script removed the local probe sign-in and run key.

#### Deployed Pi trial (#31)

The #26 model-trial Worker, deployed to the owner's Cloudflare account on Workers Paid, runs the same turn, refresh and turn as the baseline. Requests now leave from Cloudflare's network with the Pi runtime in the path, so the result separates the runtime (#26) from the network (#30). Ran on 2026-11-23 on Workers Paid.

The trial has its own Alchemy stack and stage (`ditto-paid-pi-trial`, stage `paid-pi-trial`). It runs from `feasibility/paid`, so its state lives in `feasibility/paid/.alchemy`. It creates two Workers, `ditto-paid-pi-trial-model-trial` and `ditto-paid-pi-trial-cpu-tail`, and one KV namespace, and touches no other stage's resources. `feasibility/paid/worker.ts` wraps `feasibility/model-worker.ts` unchanged, with the same compatibility settings.

**Gate.** The Worker spends whatever credential arrives in the request body, so every route, including `GET /model-trial`, refuses a request without the stage's run key in the `x-trial-key` header (a digest comparison, `requireRunKey` in `feasibility/run-key.ts`). A deploy without a run key refuses every request. The deploy command generates the key into `~/.config/ditto-feasibility/paid-run-key` and passes it to the Worker as a secret. The Worker stores no credential: each run sends the owner's sign-in from `~/.config/ditto-feasibility/paid-codex.json` and saves the token the refresh rotates. This sign-in is separate from the baseline's and the probe's, so no stage retires another's refresh token.

**CPU time.** A deployed Worker cannot be measured from `/proc`. Cloudflare reports each invocation's CPU and wall time to the tail Worker, which stores them by the run id the command sent. The figure covers the whole trial request, not each step, and is the number the Workers limit applies to. Under `alchemy dev` the local runtime reports 0ms, so only the owner's run measures it.

Sign in to Cloudflare with Alchemy and upgrade to Workers Paid first. Then run each route on a day different from the baseline's day 1 and day 2:

```sh
pnpm feasibility:paid deploy                                  # generates the run key, deploys the stage
pnpm feasibility:paid run --route chatgpt                     # first time: device-code ChatGPT sign-in; 3 runs, 15 min apart
OPENCODE_API_KEY=<key> pnpm feasibility:paid run --route opencode
pnpm feasibility:paid destroy                                 # tears the stage down, prints the teardown entry
```

##### ChatGPT plan in deployed Worker

###### 2026-11-23 · OpenAI Responses on ChatGPT plan from deployed Worker (Cloudflare network, Workers Paid, data centre SIN) · fail

- **Route:** Pi `openai-codex` provider, model `gpt-5.6-luna`: one turn at https://chatgpt.com/backend-api/codex/responses, expire the stored access token and refresh it at `<account claim>/oauth/token`, then one more turn
- **Runtime:** Pi `@earendil-works/pi-ai` 1.6.0 in workerd (compatibility date `2026-10-26`, flags `nodejs_compat` (on by date) and `new_module_registry` (Alchemy default)) on Workers Paid, each step lists every HTTP attempt it made
- **Date:** 2026-11-23, 09:46 UTC. A different UTC date from both baseline days (2026-11-22, 09:04 and 18:39 UTC); the same Asia/Kolkata date as baseline Day 2.
- **Network origin:** deployed Worker (Cloudflare network, Workers Paid, data centre SIN)
- **Expected:** both turns return 200 and reply "pong". The refresh returns 200 with a new access token, and the second turn succeeds on it.
- **Observed:** 0 of 3 runs passed. Both turns returned 403 with OpenAI's edge block page ("Unable to load site … If you are using a VPN, try turning it off"), naming the Worker's outbound address `2a06:98c0:3600::103` and Ray IDs `a5ef3fa3289f305f` (before refresh) and `a5ef3fa81ee7305f` (after). The refresh between them returned 200 with a new refresh token and an access token valid for 240h. The harness printed the full HTML page; it is cut to the lines above.
- **Retries:** 10:03 UTC fail, 10:20 UTC fail, the same 403 page from the same address on both turns (Ray IDs `a5ef58174ddd66f4`, `a5ef581bcbc666f4`, `a5ef708accb888d8`, `a5ef708f6fa488d8`).
- **Fallback:** #34, the supported plan-usage endpoint. See [If the route fails](#if-the-route-fails).
- **CPU time:** run 1: whole trial request 39ms CPU, 922ms wall; run 2: 35ms CPU, 857ms wall; run 3: 31ms CPU, 870ms wall, from the Worker's tail event. Worst 39ms: over the Workers free plan (10ms per request), within the paid plan default (30s per request, configurable to 5 min).

##### OpenCode API key in deployed Worker

###### 2026-11-23 · OpenAI Responses on OpenCode API key from deployed Worker (Cloudflare network, Workers Paid, data centre SIN) · pass

- **Route:** Pi `opencode` provider, model `gpt-5.4-mini`: one turn at https://opencode.ai/inference/openai/v1/responses, skip refresh (an API key has none), then one more turn
- **Runtime:** Pi `@earendil-works/pi-ai` 1.6.0 in workerd (compatibility date `2026-10-26`, flags `nodejs_compat` (on by date) and `new_module_registry` (Alchemy default)) on Workers Paid, each step lists every HTTP attempt it made
- **Date:** 2026-11-23, 09:45 UTC. The OpenCode baseline ran on 2026-11-22.
- **Network origin:** deployed Worker (Cloudflare network, Workers Paid, data centre SIN)
- **Expected:** both turns return 200 and reply "pong".
- **Observed:** turn passed (opencode.ai/inference/openai/v1/responses 200): replied "pong", 5 output tokens in 1.1s. refresh not applicable: an API key has no refresh exchange. turn after refresh passed (opencode.ai/inference/openai/v1/responses 200): replied "pong", 5 output tokens in 0.8s. 3 of 3 runs passed.
- **Retries:** 10:02 UTC pass, 10:19 UTC pass
- **Fallback:** none needed
- **CPU time:** run 1: whole trial request 74ms CPU, 2281ms wall; run 2: 62ms CPU, 2166ms wall; run 3: 118ms CPU, 2565ms wall, from the Worker's tail event. Worst 118ms: over the Workers free plan (10ms per request), within the paid plan default (30s per request, configurable to 5 min).

The two routes ran against the same Worker about a minute apart, and each trial request finished within 2.6s, so no two trials overlapped in one isolate (see the harness's one-trial-at-a-time limit under #26).

##### Comparison with the local Worker trial and the free-tier probe

| Step                        | #26 local workerd (Pi, home network)              | #30 free-tier probe (no Pi, Cloudflare) | #31 deployed (Pi, Cloudflare)                        |
| --------------------------- | ------------------------------------------------- | --------------------------------------- | ---------------------------------------------------- |
| ChatGPT turn before refresh | 200, 3 of 3                                       | 403, 6 of 6                             | 403, 3 of 3                                          |
| ChatGPT refresh             | 200                                               | 200                                     | 200                                                  |
| ChatGPT turn after refresh  | 200, 3 of 3                                       | 403, 6 of 6                             | 403, 3 of 3                                          |
| OpenCode turns              | 200, 3 of 3                                       | not run                                 | 200, 3 of 3                                          |
| Worst whole-request CPU     | 53ms ChatGPT, 71ms OpenCode (process upper bound) | 4ms (plain `fetch`)                     | 39ms ChatGPT, 118ms OpenCode (Cloudflare tail event) |

- **No step fails only here.** The ChatGPT 403 matches #30 with and without Pi, so the runtime is not the cause. The block page now names the cause #30 could not: OpenAI's edge refuses `chatgpt.com` requests from Cloudflare's Worker addresses, as it would a VPN. `auth.openai.com` accepts the same addresses.
- **Pi works on Cloudflare's network.** The OpenCode route matches #26 and the Node baseline on every run, with the same reply and similar latency.
- **CPU is higher than the local upper bound, unexplained but plausible.** Locally only run 1 paid Pi's first-load cost (61ms of the 71ms request); later runs used about 14–24ms. Deployed, every run used 62–118ms. A likely reason: 15 minutes between runs lets Cloudflare evict the isolate, so each run starts cold and loads Pi's Responses code again. This is not confirmed. The worst figure, 118ms, is 0.4% of the paid plan's 30s default. ChatGPT's lower figure (31–39ms) reflects turns that end at the first 403 without streaming a reply.

##### If the route fails

The ChatGPT plan on the Codex backend fails from a deployed Worker. Pi on Workers Paid passes with the OpenCode API key.

- **Consequence:** a hosted bot cannot use the Codex backend, from a Worker or a Durable Object. That endpoint stays local-only (#25, #26), which matches OpenAI's docs that say not to use it for plan usage. The OpenCode API key carries the deployed model route now, and the included model (#35) is its candidate partner.
- **Fallback ticket:** #34 tests ChatGPT plan usage through Sign in with ChatGPT against `api.openai.com/v1/responses`, locally and then from a Durable Object. This is the supported route, on a different host from the one OpenAI's edge blocked. No container-route ticket is opened for the Codex backend: a Container would only find another way to reach an endpoint OpenAI says not to use. Whether a Cloudflare Container's egress addresses are treated the same is untested.

##### Teardown

###### 2026-11-23 · paid Pi trial stage torn down · pass

- **Date:** 2026-11-23, 10:24 UTC
- **Command:** `pnpm feasibility:paid destroy`, `alchemy destroy --stage paid-pi-trial` exited 0
- **Removed:** Workers `ditto-paid-pi-trial-model-trial` and `ditto-paid-pi-trial-cpu-tail`, their KV namespace and run-key secret, and the local paid-stage sign-in and run key

#### Sign in with ChatGPT (#34)

The supported plan-usage route: Sign in with ChatGPT tokens sent to `POST https://api.openai.com/v1/responses`, per OpenAI's [plan usage docs](https://developers.openai.com/siwc/token-sharing-open-source). It is not the Codex backend the `chatgpt` route above calls. The trial is the `siwc` route: the pinned Pi runtime's `openai` provider, whose built-in Sign in with ChatGPT flow (`@earendil-works/pi-ai` 1.6.0) does the sign-in and the refresh. Pi's code sends this token to `api.openai.com` as a bearer token, so the trial runs through Pi. If the live run shows Pi sending something the flow refuses, the entry records the gap against Pi and the OpenAI SDK becomes the fallback.

**Sign-in.** Authorization code with PKCE on the `127.0.0.1:1455/auth/callback` loopback, `client_id=dynamic_agent_client` on first registration, `agent_name_hint=Ditto`, a `urn:uuid` `ext_agent_host_id` created once per machine in `~/.config/ditto-feasibility/siwc-host-id`, and the scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct` with resource `https://api.openai.com/v1`. Pi refuses a grant without `chatgpt.tokens.use.direct`. Pi drops the ID token, so the command reads it off the token response and checks it against OpenAI's published keys (from `https://auth.openai.com/.well-known/openid-configuration`): signature, `iss`, `aud` (the issued client ID), `exp` and the attempt's `nonce` (`feasibility/id-token.ts`). The sign-in is saved only if every check passes. The local sign-in lives in `~/.config/ditto-feasibility/siwc.json`.

**Request fields, from Pi's code.** For a Sign in with ChatGPT token on `api.openai.com`, Pi's Responses request sends `store: false` and `stream: true` and leaves out `temperature`, `max_output_tokens`, `prompt_cache_retention` and `prompt_cache_options`. Pi sends `previous_response_id` only on the Codex WebSocket transport, never to this endpoint. A system prompt becomes a `developer` item for a reasoning model and a `system` item otherwise, so a bot with a system prompt on a non-reasoning model would send the system-role item the flow rejects. The trial sends no system prompt. Each entry lists the fields Pi actually sent, against the rejected list (`temperature`, `max_output_tokens`, `previous_response_id`, `prompt`, system-role items), and any `subscription_sharing_*` or `chatpass_v2_*` error code. The system-role case stays a code reading until a trial sends a system prompt.

**Deployed, self-deployed shape.** OpenAI's [self-hosted guide](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms) in Cloudflare terms. The owner signs in on their own machine, because the loopback callback can only reach the browser's machine. `transfer-siwc` sends the credential once to the paid stage's `Bot` Durable Object, behind the run key, then deletes the local copy. From then on the Bot owns the sign-in: it keeps the credential in its storage, saves the rotated tokens after every step, refreshes it, and keeps its own `urn:uuid` host ID, created on the first transfer and never taken from the owner's machine. OpenAI sees a host ID only at authorize time and Pi's refresh sends none, so the transferred grant stays under the owner's machine's host ID, as the guide describes. The Bot's own ID is for its next authorization, which cannot run inside a Durable Object. OpenAI's guide notes that host-specific usage attribution and revocation for transferred sessions are not yet available. The Bot refuses a credential without the `chatgpt.tokens.use.direct` scope. Unlike the #31 Worker, the Bot holds the owner's credential at rest. That is a trial-only choice. Destroying the stage deletes the namespace and the credential with it. CPU time is the Bot's own invocation, which Cloudflare reports to the tail Worker as a separate event.

```sh
pnpm feasibility:model --route siwc                # local: browser sign-in, then 3 runs 15 min apart
pnpm feasibility:paid deploy                       # adds the Bot Durable Object to the paid stage
pnpm feasibility:paid transfer-siwc                # its own browser sign-in, handed to the Bot; prints an entry
pnpm feasibility:paid run --route siwc             # on a later date: 3 runs in the Bot
pnpm feasibility:paid destroy
```

##### Local

###### 2026-11-23 · OpenAI Responses on ChatGPT plan through Sign in with ChatGPT from home network · pass

- **Route:** Pi `openai` provider, model `gpt-5.6-luna`: one turn at https://api.openai.com/v1/responses, expire the stored access token and refresh it at https://auth.openai.com/api/accounts/oauth/token, then one more turn
- **Runtime:** Pi `@earendil-works/pi-ai` 1.6.0, each step lists every HTTP attempt it made
- **Date:** 2026-11-23, 11:18 UTC
- **Network origin:** home network
- **Expected:** both turns return 200 and reply "pong". The refresh returns 200 with a new access token, and the second turn succeeds on it.
- **Observed:** turn passed (api.openai.com/v1/responses 200): replied "pong", 5 output tokens in 4.0s. refresh passed (auth.openai.com/api/accounts/oauth/token 200): expires_in 3600s (1h), granted scope `<account claim>`, a new refresh token. turn after refresh passed (api.openai.com/v1/responses 200): replied "pong", 5 output tokens in 2.6s. 3 of 3 runs passed.
- **Retries:** 11:35 UTC pass, 11:52 UTC pass
- **Sign-in:** authorization code with PKCE on the 127.0.0.1:1455 loopback, a `urn:uuid` host ID, issued client `<clientId>`. Granted scope `<account claim>`, access token expires_in 3600s, refresh token lifetime not in the token response, ID token valid 3600s. ID token signature, iss, aud, exp and nonce checked: pass. Token response fields: `scope`, `access_token`, `token_type`, `expires_in`, `id_token`, `earliest_refresh_at`, `refresh_token`.
- **Request fields:** Pi sent `model`, `input`, `stream`, `store`, `reasoning`; input roles `user`. None of the fields the flow rejects (`temperature`, `max_output_tokens`, `previous_response_id`, `prompt`, system-role items). The trial sends no system prompt, so system-role items are not exercised.
- **Plan-usage error codes:** none
- **Fallback:** none needed

The two `<account claim>` placeholders are the granted scope, over-redacted: the access token carries the same string in its `scope` claim, and the redactor treated every string claim as an account value. The [transfer entry](#transfer-to-the-bot-durable-object), from a second sign-in on the same date, shows the grant: `chatgpt.tokens.use.direct email offline_access openid profile resource.invoke`. The redactor now keeps the `iss`, `aud` and `scope` claims.

**Findings from this entry:**

- Pi's `openai` provider accepted the token as is, with no OpenAI SDK fallback. It sent `reasoning` besides the required fields, and the endpoint accepted it.
- `gpt-5.6-luna` answered on the plan, the model the Codex-backend trials used.
- The token response carries `earliest_refresh_at`, which OpenAI's docs list but do not define. The trial's forced refresh, minutes after sign-in, returned 200 on every run, so the refresh was not refused before that time. Its value was not recorded.
- The refresh token's lifetime is not in the token response. OpenAI's docs state 30 days, renewed on each refresh.

##### Transfer to the Bot Durable Object

###### 2026-11-23 · Sign in with ChatGPT transferred to the Bot Durable Object · pass

- **Route:** sign in with ChatGPT on the owner's machine, send the credential once over HTTPS behind the run key to `POST /siwc/import` on the Bot Durable Object, then delete the local copy
- **Date:** 2026-11-23, 11:28 UTC
- **Network origin:** home network for the sign-in; the Bot holds the credential from then on
- **Expected:** the ID token passes every check and the Bot accepts the credential
- **Sign-in:** authorization code with PKCE on the 127.0.0.1:1455 loopback, a `urn:uuid` host ID, issued client `<clientId>`. Granted scope `chatgpt.tokens.use.direct email offline_access openid profile resource.invoke`, access token expires_in 3600s, refresh token lifetime not in the token response, ID token valid 3600s. ID token signature, iss, aud, exp and nonce checked: pass. Token response fields: `scope`, `access_token`, `token_type`, `expires_in`, `id_token`, `earliest_refresh_at`, `refresh_token`.
- **Observed:** the Bot accepted the credential. OpenAI granted it under the owner's machine's host ID; the Bot keeps a `urn:uuid` host ID of its own, different from that one, for its next authorization. The local copy was deleted.
- **Retries:** none
- **Fallback:** none needed

##### Deployed in the Bot Durable Object

_Not yet run. Must be a different date from the local entry. Paste the entry `pnpm feasibility:paid run --route siwc` prints._

##### `subscription_sharing_*` errors and their consequence

_Not yet observed. For each code an entry records, state its consequence for self-deployed and for hosted Ditto._

##### Can self-deployed Ditto use the ChatGPT plan without hosted-app approval?

_Undecided until the deployed entry exists._

#### Workers AI (#35)

The included model (ADR-0011): Workers AI through the `AI` binding of the paid stage's `Bot` Durable Object. The binding bills the Cloudflare account that deployed the stage, so the trial needs no credential and the Bot stores none. Each request goes through an AI Gateway the stage creates (`Cloudflare.AI.Gateway("gateway")`, logs on) and carries the Ditto account in `cf-aig-metadata` as `{"dittoAccount": "<account>"}`. After each turn the Bot reads every request's gateway log through the binding (`env.AI.gateway(id).getLog(logId)`, the log ID from the `cf-aig-log-id` response header) and records its cost and metadata. That log is the attribution a later per-account spend limit would read.

**Pi can target the binding, so the trial runs through Pi.** The pinned `@earendil-works/pi-ai` 1.6.0 ships a `cloudflare-workers-ai` provider whose catalogue includes `@cf/deepseek-ai/deepseek-v4.1-flash-1017`, and `@earendil-works/pi-ai/api/cloudflare-ai-binding`, whose `createAiBindingFetch(env.AI)` sends a request through the binding's `fetch` to AI Gateway's provider passthrough at `https://workers-binding.ai/ai-gateway/gateways/{gateway}/{provider}/…`. The trial points the catalogued model's base URL at `…/{gateway}/workers-ai/v1` and sends Pi's sentinel in `cf-aig-authorization` with `Authorization` suppressed, as Pi's docs describe. No AI SDK and no new dependency. The 2026-11-23 runs confirmed both things read from Pi's code: the binding serves the `workers-ai/v1/chat/completions` passthrough, and each Workers AI request's gateway log carries a cost. Cloudflare documents the same route as `createAI({ binding: env.AI, id })` from the `agents` package ([Pi on Cloudflare](https://developers.cloudflare.com/agents/harnesses/pi/)), which the trial does not use; production code should follow that documented helper.

**Sequence.** The baseline without the refresh step, since the binding has no token: a plain turn that must reply "pong", then a turn that offers one tool, `get_secret_word`, and must call it, receive a word the Bot made up for that run, and reply with it. Latency is per turn, as the Bot timed it. CPU time is the Bot's own invocation, from the tail Worker. Cost is per turn as AI Gateway logged it, with Pi's catalogue estimate beside it.

Run on a date after the paid stage is deployed. The `--account` value is any stable Ditto account ID; the entry shows it unredacted unless it has the shape of an account ID:

```sh
pnpm feasibility:paid deploy                                                          # adds the AI Gateway and the Bot's AI binding
pnpm feasibility:paid workers-ai --model @cf/deepseek-ai/deepseek-v4.1-flash-1017 --account trial-account-1   # 3 runs, 15 min apart
pnpm feasibility:paid workers-ai --model @cf/zai-org/glm-5.3 --account trial-account-1
OPENCODE_API_KEY=<key> pnpm feasibility:paid run --route opencode                    # the #31 comparison, same stage and date
pnpm feasibility:paid destroy
```

Open the stage's gateway in the Cloudflare dashboard (AI > AI Gateway, the gateway Alchemy created for `paid-pi-trial`) and check each request's metadata there too.

##### `@cf/deepseek-ai/deepseek-v4.1-flash-1017` in the Bot Durable Object

###### 2026-11-23 · Workers AI `@cf/deepseek-ai/deepseek-v4.1-flash-1017` from Bot Durable Object in the deployed Worker (Cloudflare network, Workers Paid, Worker in data centre SIN) · pass

- **Route:** Pi `cloudflare-workers-ai` provider, model `@cf/deepseek-ai/deepseek-v4.1-flash-1017`, through AI Gateway on the `AI` binding (`env.AI.fetch()` through Pi's `createAiBindingFetch`), Ditto account `trial-account-1` in `cf-aig-metadata`. A plain turn, then a turn that must call `get_secret_word` and reply with its result. No refresh: the binding has no token.
- **Runtime:** Pi `@earendil-works/pi-ai` 1.6.0 in the Bot Durable Object on Workers Paid
- **Date:** 2026-11-23, 15:06 UTC
- **Network origin:** Bot Durable Object in the deployed Worker (Cloudflare network, Workers Paid, Worker in data centre SIN)
- **Expected:** the plain turn replies "pong". The tool-calling turn calls `get_secret_word`, then replies with the word it returned.
- **Observed:** plain turn passed in 1756ms (1 request): replied "pong", 15 output tokens. tool-calling turn passed in 3566ms (2 requests): called `get_secret_word`, then replied with its result. 3 of 3 runs passed.
- **Retries:** 15:21 UTC pass, 15:36 UTC pass
- **Cost:** as AI Gateway logged it, run 1: plain turn $0.000029, tool-calling turn $0.000104; run 2: plain turn $0.000028, tool-calling turn $0.000105; run 3: plain turn $0.000028, tool-calling turn $0.000110. Pi's catalogue estimate: run 1: plain turn $0.000029, tool-calling turn $0.000104; run 2: plain turn $0.000028, tool-calling turn $0.000105; run 3: plain turn $0.000028, tool-calling turn $0.000110.
- **Attribution:** 9 of 9 requests logged by AI Gateway with metadata `dittoAccount: trial-account-1`.
- **CPU time:** run 1: 66ms CPU, 9060ms wall; run 2: 61ms CPU, 9894ms wall; run 3: 74ms CPU, 8661ms wall, from the Bot's tail event.
- **Fallback:** none needed

##### `@cf/zai-org/glm-5.3` in the Bot Durable Object

###### 2026-11-23 · Workers AI `@cf/zai-org/glm-5.3` from Bot Durable Object in the deployed Worker (Cloudflare network, Workers Paid, Worker in data centre SIN) · pass

- **Route:** Pi `cloudflare-workers-ai` provider, model `@cf/zai-org/glm-5.3`, through AI Gateway on the `AI` binding (`env.AI.fetch()` through Pi's `createAiBindingFetch`), Ditto account `trial-account-1` in `cf-aig-metadata`. A plain turn, then a turn that must call `get_secret_word` and reply with its result. No refresh: the binding has no token.
- **Runtime:** Pi `@earendil-works/pi-ai` 1.6.0 in the Bot Durable Object on Workers Paid
- **Date:** 2026-11-23, 15:06 UTC
- **Network origin:** Bot Durable Object in the deployed Worker (Cloudflare network, Workers Paid, Worker in data centre SIN)
- **Expected:** the plain turn replies "pong". The tool-calling turn calls `get_secret_word`, then replies with the word it returned.
- **Observed:** plain turn passed in 946ms (1 request): replied "pong", 84 output tokens. tool-calling turn passed in 5480ms (2 requests): called `get_secret_word`, then replied with its result. 3 of 3 runs passed.
- **Retries:** 15:21 UTC pass, 15:36 UTC pass
- **Cost:** as AI Gateway logged it, run 1: plain turn $0.000396, tool-calling turn $0.000533; run 2: plain turn $0.000291, tool-calling turn $0.000475; run 3: plain turn $0.000453, tool-calling turn $0.000539. Pi's catalogue estimate: run 1: plain turn $0.000396, tool-calling turn $0.000533; run 2: plain turn $0.000291, tool-calling turn $0.000475; run 3: plain turn $0.000453, tool-calling turn $0.000539.
- **Attribution:** 9 of 9 requests logged by AI Gateway with metadata `dittoAccount: trial-account-1`.
- **CPU time:** run 1: 16ms CPU, 9200ms wall; run 2: 15ms CPU, 5837ms wall; run 3: 20ms CPU, 7338ms wall, from the Bot's tail event.
- **Fallback:** none needed

Kimi K2.6 (`@cf/moonshotai/kimi-k2.6`), the model first planned for this slot, was refused on 2026-11-23: HTTP 410, AiError 5028, "deprecated on 2026-11-20". Pi 1.6.0's catalogue still lists it, so a catalogued model is not proof that Workers AI still serves it.

##### Attribution in the AI Gateway log

Every trial request was attributed: 9 of 9 for each model, read back through the binding (`env.AI.gateway(id).getLog(logId)`) with `dittoAccount: trial-account-1` in its metadata. The deprecated Kimi K2.6 requests were logged with the same metadata although they returned 410, so a refused request is attributed too. The owner checked the gateway's log in the Cloudflare dashboard on 2026-11-23 and it showed the same metadata. The gateway's logged cost matched Pi's catalogue estimate on every turn.

##### Comparison with the OpenCode API key run (#31)

###### 2026-11-23 · OpenAI Responses on OpenCode API key from deployed Worker (Cloudflare network, Workers Paid, data centre SIN) · pass

- **Route:** Pi `opencode` provider, model `gpt-5.4-mini`: one turn at https://opencode.ai/inference/openai/v1/responses, skip refresh (an API key has none), then one more turn
- **Runtime:** Pi `@earendil-works/pi-ai` 1.6.0 in workerd (compatibility date `2026-10-26`, flags `nodejs_compat` (on by date) and `new_module_registry` (Alchemy default)) on Workers Paid, each step lists every HTTP attempt it made
- **Date:** 2026-11-23, 15:07 UTC
- **Network origin:** deployed Worker (Cloudflare network, Workers Paid, data centre SIN)
- **Expected:** both turns return 200 and reply "pong".
- **Observed:** turn passed (opencode.ai/inference/openai/v1/responses 200): replied "pong", 5 output tokens in 1.5s. refresh not applicable: an API key has no refresh exchange. turn after refresh passed (opencode.ai/inference/openai/v1/responses 200): replied "pong", 5 output tokens in 1.0s. 3 of 3 runs passed.
- **Retries:** 15:22 UTC pass, 15:37 UTC pass
- **Fallback:** none needed
- **CPU time:** run 1: whole trial request 163ms CPU, 2812ms wall; run 2: whole trial request 61ms CPU, 2594ms wall; run 3: whole trial request 255ms CPU, 2563ms wall, from the Worker's tail event. Worst 255ms: over the Workers free plan (10ms per request), within the paid plan default (30s per request, configurable to 5 min).

| Same stage, 2026-11-23   | DeepSeek V4.1 Flash (Workers AI) | GLM-5.3 (Workers AI)     | OpenCode `gpt-5.4-mini`                 |
| ------------------------ | -------------------------------- | ------------------------ | --------------------------------------- |
| Plain turn               | "pong", 3 of 3, 1.8s             | "pong", 3 of 3, 0.9s     | "pong", 3 of 3, 1.5s then 1.0s          |
| Tool-calling turn        | 3 of 3, 3.6s                     | 3 of 3, 5.5s             | not tested                              |
| CPU per request          | 61–74ms (Bot invocation)         | 15–20ms (Bot invocation) | 61–255ms (whole Worker request)         |
| Cost per run, both turns | about $0.00013                   | about $0.0009            | billed to the owner's key, not recorded |

- Every route passed every run. Workers AI needs no owner credential; OpenCode spends the owner's key.
- CPU is not measured the same way: the Workers AI figure is the Bot's own invocation, the OpenCode figure the whole Worker request. Both are far inside Workers Paid's 30s default.
- GLM-5.3 cost about 7 times DeepSeek per run, mostly from longer replies (84 output tokens for "pong" against 15).

##### Candidate included model

**Candidate: `@cf/deepseek-ai/deepseek-v4.1-flash-1017`**, with `@cf/zai-org/glm-5.3` as the second choice. Both called the tool and used its result on every run. DeepSeek cost about a seventh of GLM-5.3 per run; GLM-5.3 used less CPU and answered the plain turn faster.

**Unresolved limits:**

- The tool test is one tool with no arguments over two requests. Multi-step tasks, tools with arguments and long replies are unmeasured.
- Workers AI retires models on its own schedule: Kimi K2.6 was deprecated three days before this trial and Pi's catalogue still lists it. Ditto must pin the included model and handle a 410 (AiError 5028) by moving to the second choice.
- The spend limit is not built. The gateway attributes every request, including refused ones, so the data a per-account limit needs exists.

##### Teardown

###### 2026-11-23 · paid Pi trial stage torn down · pass

- **Date:** 2026-11-23, 16:23 UTC
- **Command:** `pnpm feasibility:paid destroy`, `alchemy destroy --stage paid-pi-trial` exited 0
- **Removed:** Workers `ditto-paid-pi-trial-model-trial` and `ditto-paid-pi-trial-cpu-tail`, the `Bot` Durable Object namespace with the sign-in it held, the AI Gateway with its logs, their KV namespace and run-key secret, and the local paid-stage sign-ins and run key

The teardown also deleted the Sign in with ChatGPT credential transferred to the Bot for #34. #34's deployed run needs a fresh `pnpm feasibility:paid deploy` and `transfer-siwc` before `run --route siwc`.

## Desktop provider

**Decision (2026-11-23): the browser stays on the shared computer, the Cloudflare Container below.** ADR-0012 proposed moving it to Cloudflare Browser Run and is rejected. In #36, Google refused the sign-in in Browser Run's browser where the Container passed it, Chrome under guardrails negotiated only HTTP/1.1, and Browser Run adds a second provider for no capability the Container lacks. ADR-0012's reason remains open: a Container's disk is discarded whenever the instance stops, and Cloudflare stops idle instances after 3 to 5 minutes, so the browser loses every login on restart. #37 keeps the logins with an encrypted cookie save and restore owned by the Workspace Durable Object, and settles the instance size, idle stops, Chrome's sandbox and DevTools access during take-over. See [Browser Run trial (#36)](#browser-run-trial-36).

**Choice before that direction: Provisional.** Cloudflare Containers, one instance per workspace, each owned by a `Workspace` Durable Object, running one image that holds the egress filter and a headed Chromium on Xvfb with x11vnc and noVNC for take-over (`feasibility/containers/`). The runtime passes `WORKSPACE_ID` at start, and that is the only place the image learns its workspace.

**Evidence today:** the local Docker trials [Chrome has no route around the filter](#2026-11-22--chrome-has-no-route-around-the-filter--pass), [Take-over view is reachable on loopback only](#2026-11-22--take-over-view-is-reachable-on-loopback-only--pass), [Login pages load through the filter without signing in](#2026-11-22--login-pages-load-through-the-filter-without-signing-in--pass), and the `alchemy dev` runs below: [the combined image under alchemy dev](#2026-11-22--combined-image-on-the-containers-runtime-under-alchemy-dev--pass) and [the fence without NET_ADMIN](#2026-11-22--fence-inside-one-instance-without-net_admin--fail). On Cloudflare (2026-11-23), all seven `checks` entries under [Cloudflare Containers trial (#32)](#cloudflare-containers-trial-32) passed after the IPv6 neighbour-discovery fix. The logins on Cloudflare are still to run.

**Security guarantees it supports**, against the list in [If filtered traffic is unsuitable](#if-filtered-traffic-is-unsuitable):

| Guarantee                                                      | Local Docker (#27–#29)    | Containers under `alchemy dev` (#32)    | Cloudflare (#32)          |
| -------------------------------------------------------------- | ------------------------- | --------------------------------------- | ------------------------- |
| The computer has no route except the filter                    | yes (internal network)    | only with `NET_ADMIN`; fails without it | yes (`NET_ADMIN` granted) |
| The destination list is enforced per workspace, outside Chrome | yes                       | yes                                     | yes                       |
| The workspace identity reaches the filter from the runtime     | yes (Compose env)         | yes (`WORKSPACE_ID` at start)           | yes                       |
| TLS-intercepted decisions per request, not only per tunnel     | yes                       | yes                                     | yes                       |
| WebSocket and HTTP/2 through the filter                        | yes (#28)                 | yes (5 s hold)                          | yes                       |
| The take-over view reachable by the owner only                 | loopback only, no sign-in | run-key gate plus loopback doorways     | not yet (#32 logins)      |

**Unresolved limits:**

- **`NET_ADMIN` on Cloudflare Containers: granted (2026-11-23).** The fence applied (`filter-user-only`) although Cloudflare's FAQ says Containers do not support iptables manipulation, so a platform change could withdraw it; the `checks` fence entry catches that. The instance's resolvers are IPv6 only, so the fence must pass IPv6 neighbour discovery (see the failure entry under the #32 trial). Without `NET_ADMIN`, Chrome shares the filter's network namespace and has a direct route out, so the instance is unsuitable for private logins (ADR-0004). Fallback selected: `enableInternet: false`, with outbound HTTP and HTTPS intercepts to a Worker handler that replaces mitmproxy as the filter. That handler must enforce the per-workspace list and log the workspace, and the allow, deny, WebSocket and HTTP/2 checks must be repeated against it. If it cannot make per-request decisions inside TLS or carry WebSocket, evaluate another provider that enforces the workspace destination list in a follow-up ticket.
- **Cloudflare stops an idle instance after 3 to 5 minutes, ignoring the 60-minute `setInactivityTimeout`.** An open take-over view does not count as activity. Consequence: the trial's `takeover` command polls the instance every 30 s; production must keep a take-over's instance alive from the Workspace Durable Object for as long as the owner holds the screen, and an instance between workflows still stops, discarding its signed-in profile.
- **Chrome runs with `--no-sandbox`.** Consequence: a renderer compromise lands with the browser user's rights inside the instance, with the fence and the filter as the remaining barriers. Running Chrome sandboxed (user namespaces or the SUID sandbox) inside a Container instance is untested and is a remaining experiment.
- **DevTools is reachable on the host's loopback during take-over** (`127.0.0.1:9222`, and the #32 loopback doorway). The harness refuses its own bot actions during take-over, but any local process can drive the browser, which ADR-0007 forbids in production. Consequence: the trial view is not the take-over UI. Production must end DevTools access for every bot process before signalling take-over ready, and put the view behind the owner's sign-in.
- The view and DevTools are gated by a run key in the trial, not by the owner's sign-in.
- No login has been graded on any provider. The three workflows (#29) and their Cloudflare repeats (#32) are owner runs.

**Fallbacks:**

- If the owner stays on the free plan: Cloudflare Containers need Workers Paid, so #32 is blocked. Consequence: the desktop stays the local Docker Compose stack of #29 on the owner's machine, which has the internal-network fence. No hosted desktop exists.
- If `NET_ADMIN` is refused: `enableInternet: false` with outbound Worker intercepts, as above.
- If a login is unsupported only because of the filter, or the intercept fallback fails: evaluate another provider that enforces the workspace destination list. Link the ticket under [If filtered traffic is unsuitable](#if-filtered-traffic-is-unsuitable).

**Owner evidence that confirms or overturns it:** the #29 logins graded locally (Google, LinkedIn, the Cloudflare dashboard), then #32 on Workers Paid: the fence check reporting `filter-user-only` confirms the shape, `none` overturns it in favour of the intercept fallback.

### Evidence

#### 2026-11-22 · Combined image on the Containers runtime under alchemy dev · pass

- **Route:** `feasibility/containers-stage.test.ts`: the `ditto-containers-trial` stack under `alchemy dev`, workerd running the Worker and the `Workspace` Durable Object, the container in local Docker. `checks --ws-hold-ms 5000` through the run-key gate. `feasibility/containers-gate.test.ts` covers the gate with the container API faked.
- **Date:** 2026-11-22
- **Network origin:** container
- **Expected:** the gate refuses requests without the run key and starts nothing. The filter logs the `WORKSPACE_ID` the runtime passed. Approved destinations load, unapproved ones are refused, a WebSocket and HTTP/2 pass through the filter.
- **Observed:** seven entries printed. Identity, allow, deny, WebSocket and HTTP/2 passed. The gate refused no key, a wrong key and the key with a suffix, and forwarded requests carried no key or `Origin`. The fence check failed (next entry).
- **Retries:** _none recorded_
- **Fallback:** none needed for these checks

#### 2026-11-22 · Fence inside one instance without NET_ADMIN · fail

- **Route:** `feasibility/containers-image.test.ts` runs the combined image under plain Docker as Cloudflare would start it, then again with `--cap-add NET_ADMIN`
- **Date:** 2026-11-22
- **Network origin:** container
- **Expected:** the browser user cannot resolve DNS or connect anywhere except through the filter
- **Observed:** without `NET_ADMIN` the entrypoint logged `"isolation": "none"`, and the browser user resolved DNS and connected to `1.1.1.1:443` directly. With `NET_ADMIN` it logged `filter-user-only`, both probes failed, and `example.com` still loaded through the filter. `alchemy dev` grants `SYS_ADMIN`, not `NET_ADMIN`, so the stage run failed the same way.
- **Retries:** _none recorded_
- **Fallback:** `enableInternet: false` with outbound HTTP and HTTPS intercepts to a Worker handler, if Cloudflare does not grant `NET_ADMIN`. Untested.

### Cloudflare Containers trial (#32)

The #27 filter and the #29 headed desktop, running on Cloudflare Containers in their own paid stage. The owner upgraded to Workers Paid on 2026-11-23. The `checks` entries below ran that day; the login slots are still empty.

**Shape.** A Container instance runs one image, so `feasibility/containers/Dockerfile` combines the two local images: the pinned `mitmproxy/mitmproxy:12.3.1` image, plus the #29 desktop packages (`chromium`, `xvfb`, `x11vnc`, `novnc`, `python3-websockify`, `socat`) and `iptables`. It copies `egress/filter/egress_filter.py` unchanged and bakes in the `ws-cloud-trial` and `ws-takeover` destination lists. The image is 1.69 GB locally. `feasibility/containers/worker.ts` holds one `Workspace` Durable Object per workspace, and each object owns one instance. The object starts its instance with `WORKSPACE_ID=<workspace>` and `enableInternet: true`. That variable is the only place the image learns its workspace. The entrypoint hands it to the filter, and the filter logs it on every decision, to stdout (kept by Cloudflare's container logs) and to a file the owner's commands read.

**Gate.** Every route refuses a request without the stage's run key in `x-trial-key` (`requireRunKey` in `feasibility/run-key.ts`), and a deploy without a key refuses everything. Only `POST /w/<workspace>/start` starts a billed instance. View, DevTools and control requests to a stopped instance get 409 and start nothing. Only the two workspaces with a list in the image are accepted. The Worker strips the key before forwarding to the instance. A browser cannot send a header, so the owner's commands open loopback doorways, `127.0.0.1:9222` for DevTools and `127.0.0.1:6080` for the noVNC view, that add the key themselves. The key never appears in a URL or a page.

**Spending.** The stack allows at most 2 instances. Starting a stopped instance sets a Durable Object alarm that destroys it 60 minutes later, and an inactivity timeout of the same length. Starting a running instance again keeps the first deadline, so the instance survives an idle take-over but not a forgotten one. `checks` stops its instance when it finishes.

**The fence.** Locally, Docker's internal network gave Chrome no route except the filter (#27). Inside one Container instance, Chrome and the filter share a network namespace. The entrypoint therefore tries an owner-match firewall: loopback, established connections and the filter's user may leave, everything else is rejected, for IPv4 and IPv6. This needs `NET_ADMIN`. Without it the entrypoint logs `"isolation": "none"` and carries on, so the trial still measures everything else, and the "no route around the filter" check fails. Local Docker grants no `NET_ADMIN` by default. Neither does `alchemy dev`, which grants `SYS_ADMIN`. Whether Cloudflare grants it is the open question the check answers. If it does not, Cloudflare's own fence is `enableInternet: false` with outbound HTTP and HTTPS intercepts to a Worker handler. That handler would replace mitmproxy as the filter, and the WebSocket and HTTP/2 checks would have to be repeated against it.

**Verified locally** (2026-11-22, Docker Engine 29.6.2 and `alchemy dev`, no Cloudflare account):

- `feasibility/containers-image.test.ts`: the image under plain Docker logs `ws-cloud-trial` on every allow and deny, loads `example.com`, and refuses `example.org` with `ERR_TUNNEL_CONNECTION_FAILED`. Without `NET_ADMIN` it reports `isolation: none`, and the browser user resolves DNS and connects to `1.1.1.1:443` directly. With `--cap-add NET_ADMIN` it reports `filter-user-only`, both probes fail, and `example.com` still loads through the filter.
- `feasibility/containers-gate.test.ts`: the Worker and Durable Object, with Cloudflare's container API faked. Every route refuses no key, a wrong key and the key with a suffix, and starts nothing. The start passes `WORKSPACE_ID`. Forwarded requests carry no key or `Origin`.
- `feasibility/containers-stage.test.ts`: the stack under `alchemy dev`, with workerd running the Worker and the Durable Object, and the container in local Docker. `checks --ws-hold-ms 5000` printed seven entries. Identity, allow, deny, WebSocket and HTTP/2 passed. The fence failed as expected. The instance was ready in 2.3 s and used 344 MiB after the checks.
- A take-over dry run of `takeover linkedin` against the same stage, handing back without signing in. The view answered on `127.0.0.1:6080` and its WebSocket upgraded through the Worker. The harness refused `ok`, accepted `hand back`, and printed an `unsupported` entry. Before the inactivity timeout was added, the idle Durable Object stopped the container within 15 seconds of the take-over.

**Owner steps.** Sign in to Cloudflare with Alchemy and upgrade to Workers Paid first. Then, in this order:

1. **Set a spending cap before deploying.** Containers bill memory, CPU and disk above the amount Workers Paid includes, and Chrome uses a lot of memory. In the Cloudflare dashboard, add a billing notification for Workers Paid usage at the most you will spend on this trial. Cloudflare has no hard cap on usage billing, so the notification, the 2-instance limit and the 60-minute alarm are the controls. `deploy` refuses to run without `--spending-cap-set`.
2. Deploy, run the checks, run each login, then tear down:

```sh
pnpm feasibility:containers deploy --spending-cap-set         # generates the run key; standard-1 by default
pnpm feasibility:containers checks                            # identity, allow, deny, fence, 65 s WebSocket, HTTP/2, size
pnpm feasibility:containers takeover google                   # then linkedin, protected; view at 127.0.0.1:6080
pnpm feasibility:containers stop ws-takeover                  # after the last login: discards the signed-in instance
pnpm feasibility:containers destroy                           # tears the stage down, prints the teardown entry
```

`--instance` takes `lite`, `basic` or `standard-1` to `standard-4`. Chrome will not fit in `lite`. Start with `standard-1` (4 GiB). If memory or startup time suggests another size, redeploy with that size and rerun `checks`. Each command prints redacted entries to paste below. The `ws-cloud-trial` instance runs the checks, and the `ws-takeover` instance holds the signed-in profile until `stop` or the alarm destroys it.

#### 2026-11-23 · HTTPS through the filter fails on Cloudflare · fail, fixed

- **Route:** `checks` against the first deployed image.
- **Date:** 2026-11-23, 06:39 to 07:40 UTC
- **Network origin:** Cloudflare container
- **Expected:** the approved `https://example.com/` loads.
- **Observed:** the filter logged `allow` for each CONNECT, then Chrome failed with `net::ERR_TUNNEL_CONNECTION_FAILED` after about 11 s, on every approved HTTPS host. mitmproxy's log: `error establishing server connection: [Errno -3] Temporary failure in name resolution`. The instance's `/etc/resolv.conf` lists only IPv6 resolvers (`2606:4700:4700::1111`, `2620:fe::fe`), and as the filter's user every lookup failed after 12.3 s. The kernel sends IPv6 neighbour discovery with no owning user, so the fence's `ip6tables` REJECT dropped it and the instance never reached its IPv6 gateway. Root-owned lookups before the fence filled the neighbour cache and hid the failure; local Docker resolves on loopback and never showed it. The first `start` after the first deploy also returned 500 once (Worker exception 1101); every later start returned 200.
- **Retries:** 2 runs failed before the fix; 3 runs passed after it.
- **Fallback:** none needed. The fence now accepts outbound ICMPv6 router solicitation, neighbour solicitation and neighbour advertisement only (`feasibility/containers/image/entrypoint.sh`).

#### Workspace identity in the filter log

##### 2026-11-23 · filter logs the workspace identity the runtime passed on Cloudflare · pass

- **Route:** the Worker's Durable Object for `ws-cloud-trial` starts the instance with `WORKSPACE_ID=ws-cloud-trial`; the entrypoint hands it to the filter, which reads `/destinations/<WORKSPACE_ID>.txt`
- **Date:** 2026-11-23, 07:48 UTC
- **Network origin:** Cloudflare container
- **Expected:** every decision the filter logs carries that workspace, and no other
- **Observed:** 27 decisions logged, 0 with another workspace. First: `{"workspace":"ws-cloud-trial", "host":"clients2.google.com", "decision":"deny", "method":"GET", "http_version":"HTTP/1.1", "upstream_alpn":null}`.
- **Compared with the local trial:** #27 local: Compose passed `WORKSPACE_ID`; every decision carried `ws-trial`
- **Retries:** _none_
- **Fallback:** none needed

#### Allow and deny, compared with the local trial (#27)

##### 2026-11-23 · Chrome loads an approved destination on Cloudflare · pass

- **Route:** headed Chromium in the instance, `--proxy-server=http://127.0.0.1:8080`, loads `https://example.com/` with `example.com` on the `ws-cloud-trial` list
- **Date:** 2026-11-23, 07:48 UTC
- **Network origin:** Cloudflare container
- **Expected:** the page loads against the filter's CA and the filter logs an allow with workspace `ws-cloud-trial`
- **Observed:** document title `Example Domain`. Filter logged `{"workspace":"ws-cloud-trial", "host":"example.com", "decision":"allow", "method":"CONNECT"}`.
- **Compared with the local trial:** #27 local: pass, title `Example Domain`, allow logged with `ws-trial`
- **Retries:** _none_
- **Fallback:** none needed

##### 2026-11-23 · Chrome is refused an unapproved destination on Cloudflare · pass

- **Route:** the same Chromium loads `https://example.org/`, which is not on the list
- **Date:** 2026-11-23, 07:48 UTC
- **Network origin:** Cloudflare container
- **Expected:** the filter refuses the tunnel and logs the deny with the workspace
- **Observed:** navigation: `net::ERR_TUNNEL_CONNECTION_FAILED`. Filter logged `{"workspace":"ws-cloud-trial", "host":"example.org", "decision":"deny", "method":"CONNECT"}`.
- **Compared with the local trial:** #27 local: pass, `net::ERR_TUNNEL_CONNECTION_FAILED`, deny logged
- **Retries:** _none_
- **Fallback:** none needed

#### No route around the filter, compared with the local trial (#27)

##### 2026-11-23 · Chrome has no route around the filter on Cloudflare · pass

- **Route:** as the browser user, resolve `example.com` and open TCP to `1.1.1.1:443` without the proxy. One instance shares one network namespace, so only the entrypoint's owner-match fence (needs `NET_ADMIN`) can stop this
- **Date:** 2026-11-23, 07:48 UTC
- **Network origin:** Cloudflare container
- **Expected:** both fail: only the filter's user may open outbound connections
- **Observed:** fence `{"workspace":"ws-cloud-trial", "isolation":"filter-user-only"}`. Probe `{"dns":"failed", "dnsError":"gaierror", "direct":"failed", "directError":"ConnectionRefusedError"}`.
- **Compared with the local trial:** #27 local: pass, `ERR_NAME_NOT_RESOLVED`; Docker's internal network gave Chrome no route at all
- **Retries:** _none_
- **Fallback:** none needed

#### WebSocket, compared with the local trial (#28)

##### 2026-11-23 · WebSocket held open through the filter on Cloudflare · pass

- **Route:** the same Chromium opens `https://echo.websocket.org/`, then `wss://echo.websocket.org/`, pinging every 2 seconds for 65000 ms
- **Date:** 2026-11-23, 07:48 UTC
- **Network origin:** Cloudflare container
- **Expected:** the socket opens, every ping is echoed, it is still open at the end, and the filter logs the WebSocket allow with the workspace
- **Observed:** opened: true, greeting `Request served by <instance id>`, 33 of 33 pings echoed, open for 65001 ms, open at end: true, close code: none. Filter logged `{"workspace":"ws-cloud-trial", "host":"echo.websocket.org", "decision":"allow", "method":"WEBSOCKET"}`.
- **Compared with the local trial:** #28 local: pass, 7 of 7 echoed, open after 65,189 ms, no RFC 8441
- **Retries:** _none_
- **Fallback:** none needed

#### HTTP/2, compared with the local trial (#28)

##### 2026-11-23 · HTTP/2 negotiated end to end through the filter on Cloudflare · pass

- **Route:** the same Chromium loads `https://example.com/` through the filter
- **Date:** 2026-11-23, 07:48 UTC
- **Network origin:** Cloudflare container
- **Expected:** Chrome negotiates `h2` with the filter and the filter negotiates `h2` with the origin. A fallback to HTTP/1.1 is a downgrade
- **Observed:** `nextHopProtocol` was `h2`. Filter logged `{"workspace":"ws-cloud-trial", "host":"example.com", "decision":"allow", "method":"GET", "http_version":"HTTP/2.0", "upstream_alpn":"h2"}`.
- **Compared with the local trial:** #28 local: pass, `h2` on both legs
- **Retries:** _none_
- **Fallback:** none needed

#### Instance size, observed memory and startup time

##### 2026-11-23 · instance size, memory and startup time on Cloudflare · pass

- **Route:** `standard-1` instance running headed Chromium, Xvfb, x11vnc, noVNC and the filter
- **Date:** 2026-11-23, 07:48 UTC
- **Network origin:** Cloudflare container
- **Expected:** Chrome becomes ready and the instance reports its memory after the checks
- **Observed:** **Instance size:** `standard-1`. **Startup time:** 5798 ms from `start()` to Chrome's DevTools answering. **Observed memory:** 597.3 MiB in use after the checks, peak unknown, cgroup limit unknown, the instance reports 4228.7 MiB total.
- **Compared with the local trial:** local Docker: no size limit and no startup reading recorded
- **Retries:** _none_
- **Fallback:** none needed

#### Google on Cloudflare

##### 2026-11-23 · Google login with take-over on Cloudflare · works with take-over

- **Route:** headed Chromium on Cloudflare Containers behind the `ws-takeover` egress filter in the same instance; the owner signs in through the noVNC view, forwarded to loopback by the run-key gated Worker, hands back, then the bot will open Google Account home and confirm it is signed in
- **Date:** 2026-11-23, 08:14 UTC
- **Network origin:** Cloudflare container
- **Expected:** the owner completes only the login and any challenge; after the explicit hand-back the bot inspects the screen and reaches the signed-in page alone. The page check proves the session carried over, not a multi-step task
- **Observed:** took over: yes. Challenges: none. Site's response: I did not see any captcha. After hand-back the bot found null/. Bot reached the signed-in page after hand-back: yes, at https://myaccount.google.com/. Owner operated the site beyond the login: no. Filter denied: `accountcapabilities-pa.googleapis.com`, `content-autofill.googleapis.com`, `gds.google.com`, `lh3.google.com`, `ogads-pa.clients6.google.com`, `ogs.google.com`, `optimizationguide-pa.googleapis.com`, `passwordsleakcheck-pa.googleapis.com`, `play.google.com`, `update.googleapis.com`, `www.googletagmanager.com`.
- **Retries:** 1. The first attempt, earlier the same day, lost the instance right after the password: the view fell back to noVNC's Connect screen and the Worker answered `409 Not running`. Chromium ran as the container's main process, so its exit would stop the instance, and no exit code was kept. The retry ran Chromium under a wrapper that records its exit and keeps the instance up (a diagnostic build). Chromium did not exit; instance memory peaked at 992 MiB of 4,229 MiB. The first failure was an idle stop: on 2026-11-23 an untouched `ws-cloud-trial` instance still answered after 180 s idle and was gone after 300 s, although the Durable Object sets `setInactivityTimeout` to 60 minutes. The view's WebSocket does not count as activity, and during the retry a diagnostic poller happened to keep the instance active. `takeover` now sends a keep-alive request every 30 s while it waits for the owner.
- **Fallback:** none needed

#### LinkedIn on Cloudflare

##### 2026-11-23 · LinkedIn login with take-over on Cloudflare · works with take-over

- **Route:** headed Chromium on Cloudflare Containers behind the `ws-takeover` egress filter in the same instance; the owner signs in through the noVNC view, forwarded to loopback by the run-key gated Worker, hands back, then the bot will open the LinkedIn feed and confirm it is signed in
- **Date:** 2026-11-23, 09:14 UTC
- **Network origin:** Cloudflare container
- **Expected:** the owner completes only the login and any challenge; after the explicit hand-back the bot inspects the screen and reaches the signed-in page alone. The page check proves the session carried over, not a multi-step task
- **Observed:** took over: yes. Challenges: CAPTCHA, OTP to email. Site's response: I had to manually solve the captcha and get the OTP from my gmail. After hand-back the bot found https://www.linkedin.com/feed. Bot reached the signed-in page after hand-back: yes, at https://www.linkedin.com/feed. Owner operated the site beyond the login: no. Filter denied: `ads.stickyadstv.com`, `content-autofill.googleapis.com`, `cs.ns1p.net`, `dms.licdn.com`, `dpm.demdex.net`, `eb2.3lift.com`, `lex.33across.com`, `li.protechts.net`, `lnkd.demdex.net`, `merchantpool1.linkedin.com`, `optimizationguide-pa.googleapis.com`, `play.google.com`, `px.ads.linkedin.com`, `sync.teads.tv`, `token.rubiconproject.com`, `trkn.us`, `update.googleapis.com`.
- **Retries:** 2 on `standard-1`. The first lost the instance to the idle stop before the keep-alive existed. In the second, the display dropped while the owner typed credentials; the instance was gone when checked minutes later, and no exit record was kept. This run used `standard-3` (2 vCPU, 8 GiB) with a diagnostic build that records processes every 3 s: no process exited, and the processes' summed resident memory peaked at 2,796 MiB during the CAPTCHA (an overcount, since Chrome's processes share pages). On `standard-1` (1 vCPU, 4 GiB) memory or CPU starvation is a plausible cause of the dropped display, not a confirmed one.
- **Fallback:** none needed. The candidate instance size moves to `standard-3`.

#### Protected site on Cloudflare: Cloudflare dashboard

2026-11-23 · Not run. The owner has no Cloudflare test account and chose to skip the protected-site workflow on both the local stack and Cloudflare. Consequence: Ditto has no evidence for sites behind a bot challenge such as Turnstile, and whether Cloudflare's container egress is treated differently from the home network is unknown. The first owner who needs such a site runs `pnpm feasibility:containers takeover protected` with a test account before relying on it.

#### If filtered traffic is unsuitable

_Not applicable yet. If the fence does not apply on Cloudflare, or a login is unsupported only because of the filter, open the follow-up ticket to evaluate another provider that enforces the workspace destination list. Link it here and compare, for each option, which guarantees it supports: the computer has no route except the filter; the destination list is enforced per workspace, outside Chrome's control; the workspace identity reaches the filter from the runtime; TLS-intercepted decisions per request, not only per tunnel; WebSocket and HTTP/2 through the filter; the take-over view reachable by the owner only. Include Cloudflare's `enableInternet: false` with outbound intercepts as one option._

#### Teardown

##### 2026-11-23 · Containers trial stage torn down · pass

- **Date:** 2026-11-23, 09:20 UTC.
- **Command:** `pnpm feasibility:containers destroy`, `alchemy destroy --stage containers-trial` exited 0 (Alchemy log `2026-11-23T09-20-33`).
- **Removed:** Worker `ditto-containers-trial-workspaces`, its `Workspace` Durable Object namespace, the container application and its image, the run-key secret, and the local run key.
- **Note:** the stage was torn down two minutes after the clean image without diagnostics was deployed on `standard-3`, so no `checks` run exists for that build. The `checks` entries above ran on `standard-1` with the same fence fix; the `standard-3` evidence is the LinkedIn take-over.

### Browser Run trial (#36)

ADR-0012 proposed running the workspace browser on Cloudflare Browser Run, in place of a browser on the shared computer. The trial ran in its own paid stage. One `Workspace` Durable Object per workspace owned a Browser Run session, launched with the workspace's destination list as `guardrails.allowedDomains` and a 20-minute `keepAlive`, reconnected while live, and driven over CDP through a run-key gated loopback doorway. The owner took over through a Live View link in tab mode. After hand-back the Durable Object exported the browser's cookies (`Storage.getCookies`), stored them with AES-GCM encryption, and restored them (`Storage.setCookies`) into the next session. The harness was removed after the decision. It is in git history at commit `d5545cd` (`feasibility/browser-run/`), and #37 adapts its cookie save and restore for the shared computer.

The trial stopped after the take-overs, once Google's result and the HTTP/2 result decided against Browser Run. The restore, deletion and session-history runs were not made.

#### Checks

##### 2026-11-23 · session reused across Durable Object requests on Browser Run · pass

- **Route:** two `POST /w/ws-cloud-trial/session` requests to the `Workspace` Durable Object: the first launches with `keepAlive` at 20 minutes, the second finds the stored session ID live and reconnects with `connectSession`. Compared with the Containers trial: a Container instance is reused while running, and stops after 3 to 5 idle minutes
- **Date:** 2026-11-23, 13:20 UTC
- **Network origin:** Cloudflare Browser Run
- **Expected:** one browser launched; the second request reuses its session
- **Observed:** first request: launched session 8. Second: reused session 8.
- **Retries:** _none_
- **Fallback:** none needed

##### 2026-11-23 · Guardrails load an approved destination on Browser Run · pass

- **Route:** the session's page loads `https://example.com/` with `example.com` in `guardrails.allowedDomains`. Compared with the Containers trial: #32: pass, the filter logged the allow with `ws-cloud-trial`
- **Date:** 2026-11-23, 13:20 UTC
- **Network origin:** Cloudflare Browser Run
- **Expected:** the page loads with status 200
- **Observed:** document title `Example Domain`, status 200.
- **Retries:** _none_
- **Fallback:** none needed

##### 2026-11-23 · Guardrails refuse an unapproved destination on Browser Run · pass

- **Route:** the same page loads `https://example.org/`, which is not in the list. Compared with the Containers trial: #32: pass, `net::ERR_TUNNEL_CONNECTION_FAILED` and a deny logged
- **Date:** 2026-11-23, 13:20 UTC
- **Network origin:** Cloudflare Browser Run
- **Expected:** Browser Run answers 403 with `cf-mitigated: guardrails`
- **Observed:** navigation loaded; status 403, `cf-mitigated: guardrails` present.
- **Retries:** _none_
- **Fallback:** none needed

##### 2026-11-23 · WebSocket held open under guardrails on Browser Run · pass

- **Route:** the page opens `https://echo.websocket.org/`, then `wss://echo.websocket.org/`, pinging every 2 seconds for 65000 ms. Compared with the Containers trial: #32: pass through the filter
- **Date:** 2026-11-23, 13:20 UTC
- **Network origin:** Cloudflare Browser Run
- **Expected:** the socket opens, every ping is echoed and it is still open at the end
- **Observed:** opened: true, 33 of 33 pings echoed, open for 65001 ms, open at end: true, close code: none.
- **Retries:** _none_
- **Fallback:** none needed

##### 2026-11-23 · HTTP/2 negotiated under guardrails on Browser Run · fail

- **Route:** the page loads `https://example.com/`. Compared with the Containers trial: #32: pass, `h2` on both legs of the filter
- **Date:** 2026-11-23, 13:20 UTC
- **Network origin:** Cloudflare Browser Run
- **Expected:** Chrome negotiates `h2` with the origin
- **Observed:** `nextHopProtocol` was `http/1.1`.
- **Retries:** _none_
- **Fallback:** _owner to name_

The first runs of `checks` stalled after the reuse check. Browser Run replaces a fresh session's first page 2 to 3 seconds after launch, so the page `json/list` named was gone when the request log connected. DevTools closed with `1008 Target not found`, and the harness waited on it for ever. `Tab.open` now confirms that the page answers and lists again if it does not, and a closed socket fails the waiting command. The entries above come from the run after that fix. In one earlier run, `getSession` answered `404 Session not found` for a session launched a second before. The Worker now treats only an ended record as closed and lets reconnecting decide.

**HTTP/2:** Chrome negotiated `http/1.1` with `example.com` under guardrails, where the #32 filter carried `h2`. A likely reason, not confirmed, is that Browser Run enforces guardrails through a proxy that speaks HTTP/1.1 to the browser. Sites still load, at one connection per request.

#### Google on Browser Run

##### 2026-11-23 · Google login with take-over on Browser Run · unsupported

- **Route:** Chromium on Cloudflare Browser Run with the `ws-takeover` list as the session's guardrails, opened by the `Workspace` Durable Object; the owner signs in through a Live View link in tab mode. Until hand-back the harness refuses every page action; the only DevTools traffic is the Durable Object's browser-level keep-alive and the request log's network listener, hands back, then the bot will open Google Account home and confirm it is signed in
- **Date:** 2026-11-23, 13:29 UTC
- **Network origin:** Cloudflare Browser Run
- **Expected:** the owner completes only the login and any challenge; after the explicit hand-back the bot inspects the screen and reaches the signed-in page alone. The page check proves the session carried over, not a multi-step task
- **Observed:** took over: yes. Challenges: the sign-in was completely blocked for the browser.. Site's response: nothing happened. After hand-back the bot found https://accounts.google.com/<path>. Bot reached the signed-in page after hand-back: no, at https://www.google.com/account/about. Owner operated the site beyond the login: no. Guardrails refused: `www.googletagmanager.com`. Hosts the page requested: 8, against the 50-host guardrail limit.
- **Live View typing:** no
- **Live View link:** its still usable
- **Bot actions during take-over:** it just displayed the /account page
- **Retries:** _none_
- **Fallback:** _owner to name: another provider that enforces the workspace destination list, or drop the workflow_

**Correction, 2026-11-23, from the owner after the run:** the Live View opened on the Google sign-in form, and typing worked. The owner typed the email, and Google then refused the sign-in for this browser. So "Live View typing: no" above is wrong: input reached the page, and the refusal came from Google. The exact wording of Google's message was not recorded. The grade stands.

**Compared with [Google on Cloudflare](#google-on-cloudflare):** the same login through a Cloudflare Container passed with take-over and no challenge. That browser was headed Chromium on Xvfb behind the #32 filter, and Google showed no CAPTCHA. Browser Run's Chrome is refused at the email step. The cause is not identified: it could be Browser Run's network, its browser fingerprint, or how DevTools attaches to the page.

An earlier attempt the same day showed "Disconnected from browser". The Live View had been minted for the session's first page, before Browser Run replaced it. The take-over was changed to mint the Live View only when it showed the link. After that change, on a fresh session, the Live View's page matched the session's page.

#### LinkedIn on Browser Run

##### 2026-11-23 · LinkedIn login with take-over on Browser Run · works with take-over

- **Route:** Chromium on Cloudflare Browser Run with the `ws-takeover` list as the session's guardrails, opened by the `Workspace` Durable Object; the owner signs in through a Live View link in tab mode. Until hand-back the harness refuses every page action; the only DevTools traffic is the Durable Object's browser-level keep-alive and the request log's network listener, hands back, then the bot will open the LinkedIn feed and confirm it is signed in
- **Date:** 2026-11-23, 13:32 UTC
- **Network origin:** Cloudflare Browser Run
- **Expected:** the owner completes only the login and any challenge; after the explicit hand-back the bot inspects the screen and reaches the signed-in page alone. The page check proves the session carried over, not a multi-step task
- **Observed:** took over: yes. Challenges: "Click yes on phone". Site's response: It told me to press "yes" on my mobile to verify the login. After hand-back the bot found https://www.linkedin.com/feed. Bot reached the signed-in page after hand-back: yes, at https://www.linkedin.com/feed. Owner operated the site beyond the login: no. Guardrails refused: `ads.stickyadstv.com`, `cs.ns1p.net`, `eb2.3lift.com`, `lex.33across.com`, `li.protechts.net`, `merchantpool1.linkedin.com`, `px.ads.linkedin.com`, `sync.teads.tv`, `token.rubiconproject.com`, `trkn.us`. Hosts the page requested: 19, against the 50-host guardrail limit.
- **Live View typing:** no
- **Live View link:** it is still usable
- **Bot actions during take-over:** no
- **Retries:** _none_
- **Fallback:** none needed

**Correction, 2026-11-23, from the owner after the run:** typing in Live View worked. The owner typed the email and password, and "no" meant nothing had failed. The question could be read either way. It now asks for yes or no first.

**Compared with [LinkedIn on Cloudflare](#linkedin-on-cloudflare):** both work with take-over. The challenge differed. The Container sign-in got a CAPTCHA and a code sent by email; Browser Run's got an approve-on-phone prompt. The guardrails refused the same ad and tracking hosts the #32 filter denied, and the sign-in did not need them. Browser Run's session stayed up throughout, where a `standard-1` Container lost its display during sign-in.

#### Restored logins on a later date

Not run. The trial stopped once ADR-0012 was rejected. Restoring cookies into a fresh browser is now a #37 criterion, on the shared computer.

#### Deleting the stored cookies

Not run. #37 carries the check on the shared computer (ADR-0010).

#### Sessions and browser-hours

Not recorded as an entry. Before teardown, `history()` listed 8 `ws-cloud-trial` sessions, from the stalled and fixed `checks` runs, each closed with `NormalClosure` after 7 s to 3 min 24 s. `limits()` returned no `usedBrowserTimeSeconds`, although the Workers types declare it. Session reuse across two Durable Object requests is in the `checks` entry above.

#### Hosts against the guardrail limit

Google requested 8 hosts and LinkedIn 19 during their take-overs, against the 50-host `allowedDomains` limit. The `ws-takeover` list had 18 entries. Guardrails refused only ad and tracking hosts, and neither sign-in needed them.

#### Decision on ADR-0012

**Rejected (2026-11-23).** The browser stays on the shared computer, a Cloudflare Container.

- **Google:** Browser Run is unsupported: Google refused the sign-in after the email step. The Container passed with take-over and no challenge (#32).
- **HTTP/2:** Browser Run negotiated `http/1.1` only. The Container's filter carried `h2`.
- **LinkedIn:** works with take-over on both.
- **Guardrails:** the allow, refuse and 65-second WebSocket checks passed. They would serve as an egress policy, but the Container's filter already passes the same checks.
- **Dependency:** Browser Run adds a second browser provider, its 50-host limit, and Live View links that act as credentials, for no capability the shared computer lacks.

The open problem moves to #37: the Container discards its disk when an idle instance stops, so logins need the cookie save and restore this trial built, owned by the Workspace Durable Object.

#### Teardown

##### 2026-11-23 · Browser Run trial stage torn down · pass

- **Date:** 2026-11-23, 13:42 UTC
- **Command:** `pnpm feasibility:browser-run destroy`, `alchemy destroy --stage browser-run-trial` exited 0
- **Removed:** Worker `ditto-browser-run-trial-workspaces`, its `Workspace` Durable Object namespace with the stored cookies, and the run-key and cookie-key secrets, and the local keys. Both sessions were closed first.

### Browser health on the shared computer (#37)

The #32 stage (`feasibility/containers/`), extended so the browser keeps its logins across instance stops, fits its instance, and stays out of bots' reach during take-over. The harness is built and verified locally. The slots below are empty until the owner runs it on the paid stage.

**Logins across instance stops.** The `Workspace` Durable Object exports Chrome's cookies over CDP (`Storage.getCookies` on the browser target, through the instance's DevTools gate) and stores them AES-GCM encrypted under a key derived from the `COOKIE_KEY` secret (`feasibility/containers/cookies.ts`, adapted from the #36 harness). It saves after hand-back, when the last hold is released, on `stop`, before an idle stop, and before the 60-minute deadline destroys the instance. On the next start it decrypts first, so a key that cannot read the cookies fails before a billed instance starts, then restores them with `Storage.setCookies` before the start answers. The bot's DevTools route answers `409` until then. `discard` destroys without saving, so `restore` and `forget` never overwrite the take-over's cookies. `DELETE /w/<workspace>/cookies` is the ADR-0010 path. Local storage, IndexedDB and device state are not saved: the restore entries show whether a site needs them.

**Up only while used or held.** Measured on the owner's stage on 2026-11-23, the earlier lifecycle lost the instance: `checks` failed with `DevTools closed: 1006` 26 to 57 s into a DevTools session, with or without `setInactivityTimeout`, with or without a task hold and its 30 s alarm touch, and `status` then showed `running: false`. An untouched instance with no DevTools session survived 90 s, and polling the object's `/status` every 5 s kept the same session alive for 150 s. Cloudflare counts as a Durable Object's activity only Worker requests, alarms, streamed responses and WebSockets the object `accept()`s. The Worker passed the DevTools and noVNC WebSockets straight through with `getTcpPort().fetch`, so a session through them was not activity, and the object went idle beneath it. `Workspace` now extends `Container` from `@cloudflare/containers` (0.3.7). Its `containerFetch` proxies DevTools and the view: for a WebSocket it accepts both ends in the object, relays each message and renews the activity timeout on every message either way, and counts the socket as an in-flight request until it closes, so an open session never expires. HTTP requests through it renew the timeout too. While the instance runs, the library keeps an alarm in progress that wakes at the earlier of 3 minutes and the timeout, so the object never sits idle beneath the instance. After `sleepAfter` (5 minutes) without a request, a message or an open socket, the library calls `onActivityExpired()`: a take-over or task hold keeps the instance, and otherwise the object saves the cookies and destroys it. Releasing a hold starts the 5 minutes again. The 60-minute deadline is a library schedule. The 30 s keep-alive touch, its count and `setInactivityTimeout` are gone. `GET /w/<workspace>/status` reports `running`, the holds and the last use without touching the instance, and polling it no longer keeps the instance. The Worker also exports the library's `ContainerProxy`, which the library looks up when an object restarts beside a running instance.

**DevTools during take-over (ADR-0007).** Chrome's DevTools listens on `127.0.0.1:9222`. A gate (`image/devtools_gate.py`), running as its own `devtools` user, relays port 9223, which the Worker reaches, to it. The entrypoint's fence lets only that user reach 9222 and no local process reach the gate's lock port (8082). `POST /w/<workspace>/takeover` locks the gate, which closes every DevTools session and refuses new ones, and only then answers that take-over is ready. If the lock fails, take-over is not ready and nothing is held. Until hand-back, the Worker's DevTools route answers `423`. `POST /w/<workspace>/handback` unlocks the gate, releases the hold and saves the cookies. The fence needs `NET_ADMIN`, which Cloudflare granted in #32; without it the image reports `"devtools": "any-local-process"`.

**The owner's sign-in.** The take-over view (`/w/<workspace>/view/...`) no longer accepts the run key. It needs a session for the owner's GitHub account, and opens only during take-over. The trial's smallest honest shape is GitHub OAuth from the Worker itself (`feasibility/containers/owner-sign-in.ts`): GitHub is one of Ditto's sign-in providers, it is a real third-party identity check, and it needs no deployed app. The Worker accepts only the numeric GitHub ID named at deploy (`OWNER_GITHUB_ID`), keeps a one-time state in a cookie, and sets an HMAC-signed `HttpOnly`, `Secure`, `SameSite=Lax` session cookie for an hour that holds no token. The view never sees that cookie, and a WebSocket upgrade from another origin is refused. Production would check Ditto's own sign-in session instead. The bot's DevTools and the owner's commands keep the run key.

**Chrome's sandbox.** The image installs `chromium-sandbox` and starts Chrome without `--no-sandbox`. Chrome tries user namespaces, then the SUID helper. If that Chrome exits, the image restarts it with `--no-sandbox` and records why in `/sandbox`. Locally, Docker's defaults refuse both sandboxes (`Failed to move to new namespace`); with `SYS_ADMIN`, which `alchemy dev` grants, Chrome runs sandboxed and `chrome://sandbox` reports it adequately sandboxed. Whether Cloudflare allows either is what the `checks` entry answers.

**Memory and size.** The control port samples, every 3 s, the instance's cgroup memory, Chrome's summed proportional set size (PSS, which counts shared pages once, unlike #32's summed resident memory), memory and CPU pressure stall averages, the cgroup's OOM kills, and whether Xvfb, x11vnc, websockify and Chromium are alive. `takeover` polls the samples every 15 s and keeps its own copy, so a lost instance does not lose them. `screens` opens one more screen at a time (its own Xvfb display and Chrome profile) and reports how many stay alive under 90% of the instance's memory.

**Long sessions.** `socket` opens two WebSockets to `echo.websocket.org` through the filter for 30 minutes: one pings every 10 s, the other stays silent after it opens, to show any idle timeout. The filter runs mitmproxy's default `tcp_timeout` of 600 s.

**Verified locally** (2026-11-23, Docker Engine 29.6.2, no Cloudflare account):

- `feasibility/containers-health.test.ts` runs the Worker and Durable Object with Cloudflare's container API and the instance faked at the platform boundary. Cookies saved after hand-back are restored into the next instance before its start answers, with session cookies sent back without an expiry. Stored cookies are unreadable at rest. A different cookie key fails before a start. Deleted cookies leave the next instance signed out. `stop` and the deadline save first; `discard` keeps the earlier save. The fake applies Cloudflare's idle stop (30 s with no request, alarm or accepted WebSocket in the object) and runs the real library. A bot's DevTools session of 10 minutes keeps the instance and its socket, where the earlier pass-through lost both. An unheld instance stops 5 minutes after its last use, cookies saved first. A take-over or task hold keeps an unused instance for 20 minutes, also after eviction, and it stops 5 minutes after release. The deadline destroys a held instance at 60 minutes, cookies saved first. Polling status neither touches nor keeps the instance. Take-over locks DevTools before it answers ready, refuses the DevTools route until hand-back, is never ready if the lock fails, and hand-back unlocks before it saves.
- `feasibility/containers-owner-view.test.ts`: the view sends the run key's holder to sign in, opens for the configured GitHub account only during take-over, never forwards the session cookie, relays the screen's WebSocket both ways, refuses a cross-origin WebSocket, a forged or expired session, a mismatched state, a code GitHub refuses, another account, a return path off the view, and every sign-in when no owner is configured.
- `feasibility/containers-image.test.ts`: under Docker's defaults the image records `none` with the reason and Chrome still runs, samples memory, PSS and the desktop's processes, opens an extra screen, and reports that any local process reaches 9222. With `NET_ADMIN` and `SYS_ADMIN` Chrome runs sandboxed (`chrome://sandbox`: adequately sandboxed), the browser user cannot reach 9222 or the lock, the lock closes an open DevTools session and refuses new ones, and unlock restores them.
- `feasibility/containers-health-evidence.test.ts`: each entry's grade follows what was observed.

**Unknowns the live run settles:** whether Cloudflare allows Chrome's sandbox; whether the library's proxied DevTools and view sockets keep a session past the 26 to 57 s where the pass-through lost it (`checks` and `takeover` answer it); whether the instance stops about 5 minutes after the `idle` command's release; whether noVNC's WebSocket upgrades through the Worker on `https` with the session cookie; and whether Cloudflare's proxy closes a silent WebSocket (the commands poll every 15 s to keep theirs busy).

**Owner steps.** The stage needs Workers Paid and the billing notification from #32. Create a GitHub OAuth app first (GitHub: Settings > Developer settings > OAuth Apps), with any callback URL for now. Then:

```sh
export GITHUB_CLIENT_ID=<client id> GITHUB_CLIENT_SECRET=<client secret> OWNER_GITHUB_ID=$(gh api user --jq .id)
pnpm feasibility:containers deploy --spending-cap-set --instance standard-1
# set the OAuth app's callback URL to the <worker url>/auth/callback that deploy prints
pnpm feasibility:containers checks                  # adds the sandbox entry
pnpm feasibility:containers takeover linkedin       # sign in with GitHub at the printed view link
pnpm feasibility:containers takeover google
pnpm feasibility:containers screens                 # screens per instance on this size
pnpm feasibility:containers idle                    # held 8 min, then released until it stops
pnpm feasibility:containers socket                  # 30-minute WebSocket and the idle timeout
# on a later date:
pnpm feasibility:containers restore google          # then linkedin; a new instance, no owner
pnpm feasibility:containers forget                  # deletes the cookies; both must be signed out
pnpm feasibility:containers destroy
```

If the LinkedIn take-over drops the display on `standard-1`, run `forget`, redeploy with `--instance standard-2` (then `standard-3`), and repeat `takeover linkedin` and `screens` on each size until one completes. Each command prints redacted entries for the slots below. The keys are kept in `~/.config/ditto-feasibility/`, outside the repo; losing the cookie key loses the stored logins.

#### Restored logins on a later date

_Not yet run: `pnpm feasibility:containers restore google` and `… restore linkedin`, on a date after the take-over. A run on the same day is labelled as such and does not count. Where a site is not signed in, the entry states what else it needed._

#### Deleting the stored cookies

_Not yet run: `pnpm feasibility:containers forget`, after both restores._

#### Cause of the standard-1 display drop

_Not yet run: `pnpm feasibility:containers takeover linkedin` on `standard-1`, with its memory entry, then on each larger size until one completes. Names the minimum instance size and its memory peak._

#### Screens per instance

_Not yet run: `pnpm feasibility:containers screens` on the minimum size above._

#### Idle stops

_Not yet run: `pnpm feasibility:containers idle`, and the `takeover` runs above for how long the instance stayed up during each take-over._

#### Chrome's sandbox

_Not yet run: the `Chrome runs sandboxed` entry from `pnpm feasibility:containers checks`. If it fails, the entry's reason is why, and the record states what replaces the sandbox._

#### DevTools between take-over ready and hand-back

_Not yet run: the DevTools entry from each `pnpm feasibility:containers takeover`._

#### Take-over view behind the owner's sign-in

_Not yet run: during `pnpm feasibility:containers takeover`, record that the view link first asked for the GitHub sign-in, and that a private window without it was sent to sign in._

#### Long sessions

_Not yet run: `pnpm feasibility:containers socket`._

#### Teardown

_Not yet run: `pnpm feasibility:containers destroy`._

## Egress policy

**Choice: Provisional.** Default deny. Each workspace has an exact-hostname destination list (`destinations/<WORKSPACE_ID>.txt`), enforced by a TLS-intercepting mitmproxy 12.3.1 filter (`egress_filter.py`) that is Chrome's only route out. The runtime passes the workspace identity. The filter reads the list on every decision, refuses an unapproved CONNECT before any upstream connection, decides again for each request inside a tunnel and for each WebSocket upgrade, and logs `{workspace, host, decision, method, port}` for each CONNECT, plus `path`, `http_version` and `upstream_alpn` for each request inside a tunnel and `path` for each WebSocket. The path is logged without its query or fragment, which can carry login and OAuth callback codes, so neither reaches the container logs. The CA is generated per stage, its key never leaves the filter, and it is discarded on teardown. The local trial (#27) supports this shape, and #28 shows WebSocket and HTTP/2 survive it. The deployed runtime check is still to run.

**Evidence today:** [Chrome loads an approved HTTPS destination through the filter](#2026-11-22--chrome-loads-an-approved-https-destination-through-the-filter--pass), [Chrome is refused an unapproved destination](#2026-11-22--chrome-is-refused-an-unapproved-destination--pass), [Chrome has no route around the filter](#2026-11-22--chrome-has-no-route-around-the-filter--pass), [Changing the destination list changes what loads, without a rebuild](#2026-11-22--changing-the-destination-list-changes-what-loads-without-a-rebuild--pass), [WebSocket held open for a minute through the filter](#2026-11-22--websocket-held-open-for-a-minute-through-the-filter--pass), [HTTP/2 negotiated end to end through the filter](#2026-11-22--http2-negotiated-end-to-end-through-the-filter--pass), all local Docker. The Containers-runtime entries are under [Desktop provider](#desktop-provider).

**Security guarantees it supports:** a computer with private logins contacts only destinations approved for its workspace (ADR-0004), as long as the fence holds. Every allow and deny is attributable to a workspace. A list change takes effect on the next request with no rebuild.

**Owner evidence that confirms or overturns it:** the three #29 logins succeeding with only their listed hosts (each host added during a run is recorded in its entry), and #32's identity, allow, deny, fence, 65-second WebSocket and HTTP/2 checks on Cloudflare. A login that needs unrestricted access is unsupported on this provider (ADR-0004), and the Desktop provider fallbacks apply.

**Unresolved limits:**

- Local Docker only. Under `alchemy dev` the Containers runtime passes the workspace identity to the filter (#32), but on Cloudflare it is untested. Inside one Container instance, denying Chrome every other route needs `NET_ADMIN` for the entrypoint's firewall, and whether Cloudflare grants it is untested. See Desktop provider > Cloudflare Containers trial (#32).
- Chrome runs with `--no-sandbox`. Running it sandboxed inside the container is untested. Consequence: see Desktop provider.
- The filter matches exact hostnames only. A login that spans several hosts needs each one listed, and wildcard rules are not supported yet.
- A WebSocket never rides HTTP/2 through the filter. mitmproxy does not offer RFC 8441 extended CONNECT, so Chrome opens a separate HTTP/1.1 tunnel for each WebSocket. Sites work, at the cost of one extra TCP and TLS connection per socket. Consequence accepted: no fallback needed unless a site requires WebSocket over HTTP/2, which none tested does. If the #32 intercept fallback replaces mitmproxy, recheck this.
- The Debian packages (Chromium, NSS, Xvfb, x11vnc, noVNC, iptables) are not pinned, only the base images by digest. Consequence: a rebuild picks up security updates but can change the browser under a passing trial. Record the observed versions with every trial entry, and pin by snapshot (`snapshot.debian.org`) before a hosted release.
- A WebSocket was held for 65 seconds. Sessions of minutes or hours, and idle timeouts in the filter, are untested.
- Chromium still makes background requests (component updates, time sync, `accounts.google.com`) despite `--disable-background-networking`. The filter denies and logs them.

### Local trial: Chrome behind the workspace egress filter

Run `pnpm exec vp test run --project feasibility feasibility/egress.test.ts` from the repo root with Docker running. It builds both images, runs the stack under the `ditto-feasibility-egress` Compose project, and removes containers, networks and CA volumes afterwards. To drive it by hand, run from `feasibility/egress/`:

```sh
export WORKSPACE_ID=ws-trial            # the list is destinations/$WORKSPACE_ID.txt
docker compose up -d --build --wait filter
docker compose run --rm chrome https://example.com/   # prints the DOM
docker compose logs --no-log-prefix filter             # one JSON line per decision
docker compose down -v                                 # discards the CA
```

**Topology.** Chrome is attached only to the `workspace` network, which is `internal: true`, so it has no route or DNS to the internet. The filter is attached to `workspace` and `egress` and is Chrome's `--proxy-server`. The runtime passes the workspace identity to the filter as `WORKSPACE_ID`. The filter reads `/destinations/<WORKSPACE_ID>.txt` on every decision and logs `{workspace, host, decision, method, port, ...}` for every CONNECT and for every request inside a tunnel, with the request path but never its query or fragment. An unapproved CONNECT gets a 403 before any upstream connection. `DESTINATIONS_DIR` points the bind mount at another directory. Editing the file changes what loads with no rebuild or restart.

**Image contents.**

- Chrome (`feasibility/egress/chrome`, 312 MB): `debian:trixie-20261104-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2` plus `chromium`, `libnss3-tools` (for `certutil`) and `fonts-dejavu-core`, installed with `--no-install-recommends`. It runs as an unprivileged `browser` user (uid 1000). The entrypoint imports the CA, then runs headless `chromium --dump-dom <url>`.
- Filter (`feasibility/egress/filter`): `mitmproxy/mitmproxy:12.3.1@sha256:2711066c855659b5af8b1dbb84494ed3eff69b42ece439c60b4fe09a2db829d4` plus the `egress_filter.py` addon. `mitmdump` runs as the image's unprivileged `mitmproxy` user.

**Package versions** (observed 2026-11-22): Chromium `156.0.8078.79-1~deb13u1`, `libnss3` and `libnss3-tools` `2:3.110-1+deb13u5`, Debian 13.7, mitmproxy 12.3.1 on Python 3.15.1 and OpenSSL 4.0.3, Docker Engine 29.6.2, Docker Compose 5.3.1. The Debian packages are not pinned, so a rebuild picks up security updates.

**CA handling.** The filter generates a fresh CA on first start in the `ca-private` volume, which only the filter mounts. It copies only the certificate to the `ca-public` volume, which Chrome mounts read-only. The Chrome entrypoint creates an NSS database in `~/.pki/nssdb` and imports the certificate as a trusted CA (`-t C,,`). No key or certificate is written to the host or the repo. `docker compose down -v` destroys both volumes, so each trial gets a new CA. The generated CA is `CN=mitmproxy, O=mitmproxy` and is valid for 10 years.

### Evidence

#### 2026-11-22 · Chrome loads an approved HTTPS destination through the filter · pass

- **Route:** headless Chromium in the Chrome container, `--proxy-server=http://filter:8080`, loads `https://example.com/` with `example.com` on the `ws-trial` list
- **Date:** 2026-11-22, 07:25 UTC
- **Network origin:** container
- **Expected:** the TLS connection succeeds against the filter's CA, the page DOM is printed, and the filter logs an allow with workspace `ws-trial`
- **Observed:** DOM contained `<title>Example Domain</title>`. The filter logged `allow` for `CONNECT example.com:443`, `GET https://example.com/` and `GET https://example.com/s.js`, each with `"workspace": "ws-trial"`.
- **Retries:** 2026-11-22 07:23 UTC, the automated test run passed
- **Fallback:** none needed

#### 2026-11-22 · Chrome is refused an unapproved destination · pass

- **Route:** the same container loads `https://example.org/`, which is not on the `ws-trial` list
- **Date:** 2026-11-22, 07:26 UTC
- **Network origin:** container
- **Expected:** the filter refuses the tunnel, the page does not load, and the refusal is logged with the workspace
- **Observed:** Chromium reported `Page load failed: net::ERR_TUNNEL_CONNECTION_FAILED`. The filter logged `{"workspace": "ws-trial", "host": "example.org", "decision": "deny", "method": "CONNECT", "port": 443}` three times (Chromium's retries). Chromium's own background requests to `clients2.google.com`, `update.googleapis.com`, `redirector.gvt1.com` and `accounts.google.com` were also denied and logged with `ws-trial`.
- **Retries:** 2026-11-22 07:23 UTC, the automated test run passed
- **Fallback:** none needed

#### 2026-11-22 · Chrome has no route around the filter · pass

- **Route:** the same container loads `https://example.com/` with `--no-proxy-server`
- **Date:** 2026-11-22, 07:26 UTC
- **Network origin:** container
- **Expected:** the page does not load, because the `workspace` network is internal
- **Observed:** `Page load failed: net::ERR_NAME_NOT_RESOLVED`. The filter logged nothing for this load.
- **Retries:** 2026-11-22 07:23 UTC, the automated test run passed
- **Fallback:** none needed

#### 2026-11-22 · Changing the destination list changes what loads, without a rebuild · pass

- **Route:** with the filter still running, `example.org` is appended to `destinations/ws-trial.txt`, then the Chrome container loads `https://example.org/` again
- **Date:** 2026-11-22, 07:26 UTC
- **Network origin:** container
- **Expected:** the page now loads, with no image rebuild or filter restart
- **Observed:** DOM contained `<title>Example Domain</title>`. The filter logged `allow` for `GET https://example.org/` and `GET https://example.org/s.js` with `"workspace": "ws-trial"`.
- **Retries:** 2026-11-22 07:23 UTC, the automated test run passed
- **Fallback:** none needed

### Local trial: WebSocket and HTTP/2 through the filter (#28)

Run `pnpm exec vp test run --project feasibility feasibility/egress-protocols.test.ts` from the repo root with Docker running. It uses its own Compose project, `ditto-feasibility-egress-protocols`, so it can run beside the #27 suite. By default it holds the WebSocket for 5 seconds. Set `EGRESS_WS_HOLD_MS=65000` for the one-minute acceptance check.

`feasibility/egress/protocols.compose.yaml` adds two services to `compose.yaml`. `browser` is the same Chrome image kept running with `--devtools`, which serves DevTools on 127.0.0.1:9222 inside its container. `driver` (`node:24-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54`, Node 24.22.3) shares the browser's network namespace and runs `driver/cdp.mjs`, which opens a URL over DevTools and prints what a JavaScript expression resolves to in the page. Only DevTools traffic stays inside the container. Page traffic leaves through the filter. The filter now logs `http_version` (Chrome to filter) and `upstream_alpn` (filter to origin) on every request, and decides a WebSocket again, as `method: "WEBSOCKET"`, once its upgrade completes.

#### 2026-11-22 · WebSocket held open for a minute through the filter · pass

- **Route:** Chromium 156.0.8078.79 in the `browser` container opens `https://echo.websocket.org/`, then `new WebSocket("wss://echo.websocket.org/")`, through the filter and its CA, with `echo.websocket.org` and `example.com` on the `ws-trial` list. The page sends `ping <n>` every 10 seconds for 65 seconds.
- **Date:** 2026-11-22, 07:37 UTC
- **Network origin:** container
- **Expected:** the socket opens, the server's greeting arrives unprompted, every client message is echoed back, the socket is still open after a minute, and the filter logs an allow for the WebSocket with the workspace
- **Observed:** the socket opened and received `Request served by <instance id>`. 7 of 7 pings were echoed, with round trips of 222 to 237 ms. After 65,189 ms `readyState` was `1` (open) and no close event had fired. The filter logged `allow` for `CONNECT echo.websocket.org:443`, the upgrade `GET https://echo.websocket.org/` with `"http_version": "HTTP/1.1", "upstream_alpn": "http/1.1"`, and `"method": "WEBSOCKET"`, each with `"workspace": "ws-trial"`. The page itself had loaded over a separate HTTP/2 tunnel (`"upstream_alpn": "h2"`), so the WebSocket did not use RFC 8441.
- **Retries:** 2026-11-22 07:35 UTC, the default 5-second automated run passed. 07:36 UTC, the automated run with `EGRESS_WS_HOLD_MS=65000` passed alongside `egress.test.ts`.
- **Fallback:** none needed

#### 2026-11-22 · HTTP/2 negotiated end to end through the filter · pass

- **Route:** the same browser loads `https://example.com/` through the filter
- **Date:** 2026-11-22, 07:38 UTC
- **Network origin:** container
- **Expected:** Chrome negotiates `h2` with the filter, and the filter negotiates `h2` with the origin. If either side falls back to HTTP/1.1, record it as a downgrade.
- **Observed:** `nextHopProtocol` was `h2` for the document and for `https://example.com/s.js`. The filter logged both requests with `"http_version": "HTTP/2.0", "upstream_alpn": "h2"` and `"workspace": "ws-trial"`. `echo.websocket.org` pages also loaded over `h2` on both legs. No downgrade.
- **Retries:** 2026-11-22 07:35 UTC and 07:36 UTC, the automated test runs passed
- **Fallback:** none needed

## Login workflows (#29)

Representative logins, run by the owner with their permitted test accounts in a headed Chrome behind the workspace egress filter. Each workflow is graded under ADR-0004 and resumes under ADR-0007.

**Filtered traffic on a computer with private logins:** suitable. Google and LinkedIn both worked with take-over behind the workspace filter, on the local stack and on Cloudflare Containers, and the filter's denials blocked neither sign-in nor the bot's signed-in page after hand-back. Not evaluated: sites behind a bot challenge such as Turnstile, because the protected-site workflow was skipped for lack of a test account. No other provider needs evaluating for the representative logins.

**Unresolved limits:**

- The take-over view is a raw noVNC screen, not the take-over UI. It has no owner sign-in, so anything on the host's loopback can view or drive the screen during the trial.
- DevTools is published on the host's loopback for the bot. The harness refuses its own bot reads and actions during take-over, but nothing stops another local process from using DevTools.
- The bot's task checks are read-only and prove only that the session works. They post, change and buy nothing. Each representative task is opening one signed-in page, so "works with take-over" here means the owner's session carried over to the bot after hand-back, not that the bot completed a multi-step task on the site.

### Running a workflow

From the repo root, with Docker running:

```sh
pnpm feasibility:takeover google      # or linkedin, protected
pnpm feasibility:takeover --down      # after the last workflow: discards the CA and the signed-in profile
```

1. The harness starts the `ws-takeover` filter, the desktop and the viewer (`feasibility/takeover/compose.yaml`, which includes the #27 egress stack). The bot opens the task page. If the profile is already signed in, the harness stops without an entry, because the run would grade a login it never tested. Discard the profile first with `pnpm feasibility:takeover --down`, or on Cloudflare `pnpm feasibility:containers stop ws-takeover`.
2. The bot opens the login page and suspends. Once it prints **Take-over ready**, open `http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale` and complete only the login and any challenge. The bot neither reads nor drives the screen until you hand back.
3. Type `hand back` in the terminal. Nothing else returns control, including closing the view. The bot inspects where the tab is, then opens the task's signed-in page alone.
4. Answer the three prompts about challenges, the site's response, and whether you had to operate the site beyond the login. Answers holding an email address, cookie, token or long account number are refused.
5. Paste the printed entry into the workflow's slot below, then fill in the grading lines the harness cannot see.

The signed-in profile stays in the desktop's Docker volume, never on the host or in git. Evidence holds hosts, redacted paths and your notes only: no cookies, request URLs or page text.

**Remote view.** Chrome runs headed on Xvfb inside the `desktop` container, which is attached only to the internal `workspace` network. x11vnc serves the screen and `socat` exposes DevTools on that network. The `viewer` container runs noVNC (websockify) and forwards DevTools. It is the only container with published ports, bound to `127.0.0.1:6080` (view) and `127.0.0.1:9222` (DevTools). Set `VIEW_PORT` or `DEVTOOLS_PORT` to move them.

**Destination list.** `feasibility/takeover/destinations/ws-takeover.txt`. Hosts were found by loading each login page and reading the filter's deny log. Analytics (`sparrow.cloudflare.com`, `static.cloudflareinsights.com`, `*.demdex.net`, `play.google.com`), consent banners (`ot.www.cloudflare.com`) and Chromium's background traffic stay denied. If a step fails during the trial, add the denied host it needs, rerun, and record the addition in the entry.

| Workflow                                                    | Login page                  | Representative task                     | Approved hosts                                                                                                                                                                                                             |
| ----------------------------------------------------------- | --------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google                                                      | `accounts.google.com`       | open `myaccount.google.com` signed in   | `accounts.google.com`, `myaccount.google.com`, `www.google.com`, `www.gstatic.com`, `ssl.gstatic.com`, `fonts.gstatic.com`, `fonts.googleapis.com`, `apis.google.com`, `lh3.googleusercontent.com`, `accounts.youtube.com` |
| LinkedIn                                                    | `www.linkedin.com/login`    | open `www.linkedin.com/feed/` signed in | `www.linkedin.com`, `static.licdn.com`, `media.licdn.com`, `platform.linkedin.com`                                                                                                                                         |
| Protected site: Cloudflare dashboard (Turnstile on sign-in) | `dash.cloudflare.com/login` | open `dash.cloudflare.com` signed in    | `dash.cloudflare.com`, `challenges.cloudflare.com`, `brunhild.challenges.cloudflare.com`, `platform.dash.cloudflare.com`                                                                                                   |

### Grading template

Copy under each workflow and fill in every line.

```md
- **Grade:** pass | works with take-over | unsupported
- **Challenges seen:** CAPTCHA, device check, blocked network, other, or none, each with the site's response
- **Bot reached the signed-in page after hand-back:** yes | no, and where the tab was when the bot inspected it
- **Owner operated the site beyond the login or challenge:** yes (fails the trial) | no
- **Destinations added during the run:** hosts, or none
```

Pass: the bot reached the page with no take-over. The harness never attempts a login itself and refuses an already signed-in profile, so it cannot record a pass. Works with take-over: the owner completed only the login or challenge and the bot reached the signed-in page after hand-back. Unsupported: the bot could not reach it, or the owner had to operate the site step by step.

### Evidence

#### 2026-11-22 · Take-over view is reachable on loopback only · pass

- **Route:** `feasibility/takeover-stack.test.ts` starts the stack under its own Compose project, fetches noVNC and DevTools on `127.0.0.1`, reads the published bindings, then fetches noVNC on the host's LAN address
- **Date:** 2026-11-22, 07:42 UTC
- **Network origin:** container
- **Expected:** both answer on loopback, each published port binds `127.0.0.1` only, and the LAN address refuses the connection
- **Observed:** `vnc.html` returned 200 and `/json/version` returned 200 (`Chrome/156.0.8078.79`). `docker compose port` returned only `127.0.0.1:<port>` for 6080 and 9222. The fetch to the LAN address failed.
- **Retries:** 2026-11-22 07:49 UTC, the full feasibility suite passed
- **Fallback:** none needed

#### 2026-11-22 · Login pages load through the filter without signing in · pass

- **Route:** the bot loads each workflow's login page in the headed desktop through the `ws-takeover` filter, and loads `https://example.org/`, which is not on the list. The desktop's own DNS and a direct TCP connection to `1.1.1.1:443` are also tried.
- **Date:** 2026-11-22, 07:42 UTC
- **Network origin:** container
- **Expected:** each login page renders its sign-in form on its own host, the filter logs an allow for it with workspace `ws-takeover`, the Turnstile widget renders on the protected site, and everything else is refused
- **Observed:** `accounts.google.com/v3/signin/identifier` ("Sign in - Google Accounts"), `www.linkedin.com/login` ("LinkedIn Login, Sign in | LinkedIn") and `dash.cloudflare.com/login` each showed an email or password field. Turnstile added its `cf-chl-widget-*` response input, with `challenges.cloudflare.com` allowed. `example.org` failed with `net::ERR_TUNNEL_CONNECTION_FAILED` and a logged deny. DNS lookup and the direct connection both failed. No account was signed in.
- **Retries:** 2026-11-22 07:49 UTC, the full feasibility suite passed
- **Fallback:** none needed

#### 2026-11-22 · Harness dry run without a sign-in · unsupported (expected)

- **Route:** `pnpm feasibility:takeover linkedin`, handing back without signing in
- **Date:** 2026-11-22, 07:48 UTC
- **Network origin:** container
- **Expected:** a non-`hand back` answer leaves the owner in control. After `hand back` the bot inspects the tab, fails the task and the entry grades `unsupported`. This exercises the harness only and grades nothing about LinkedIn.
- **Observed:** the harness refused `ok`, accepted `hand back`, found the tab at `https://www.linkedin.com/login`, reported the task not finished, and printed an `unsupported` entry with the query string removed and only hosts in the deny list
- **Retries:** _none_
- **Fallback:** none needed

#### Google

##### 2026-11-22 · Google login with take-over · works with take-over

- **Route:** headed Chromium behind the `ws-takeover` filter, with owner sign-in through the loopback noVNC viewer.
- **Date:** 2026-11-22, 13:35 UTC
- **Network origin:** local Docker container
- **Expected:** after the owner signs in and hands back control, the bot opens the signed-in page itself.
- **Observed:** the site accepted the login without a challenge. The owner operated only the login. At hand-back the bot reported `null/`, then reached `https://myaccount.google.com/` signed in.
- **Filter denied:** `accountcapabilities-pa.googleapis.com`, `clients2.google.com`, `content-autofill.googleapis.com`, `gds.google.com`, `lh3.google.com`, `ogads-pa.clients6.google.com`, `ogs.google.com`, `optimizationguide-pa.googleapis.com`, `passwordsleakcheck-pa.googleapis.com`, `play.google.com`, `redirector.gvt1.com`, `update.googleapis.com`, `www.googletagmanager.com`.
- **Destinations added during the run:** not reported.
- **Retries:** none
- **Fallback:** none needed

#### LinkedIn

##### 2026-11-22 · LinkedIn login with take-over · works with take-over

- **Route:** headed Chromium behind the `ws-takeover` filter, with owner sign-in through the loopback noVNC viewer.
- **Date:** 2026-11-22, 13:39 UTC
- **Network origin:** local Docker container
- **Expected:** after the owner signs in and hands back control, the bot opens the signed-in page itself.
- **Observed:** the site accepted the login without a challenge. The owner operated only the login. At hand-back the bot reported `https://www.linkedin.com/feed`, then reached `https://www.linkedin.com/feed` signed in.
- **Filter denied:** `ads.stickyadstv.com`, `content-autofill.googleapis.com`, `cs.ns1p.net`, `dms.licdn.com`, `dpm.demdex.net`, `eb2.3lift.com`, `lex.33across.com`, `li.protechts.net`, `lnkd.demdex.net`, `merchantpool1.linkedin.com`, `optimizationguide-pa.googleapis.com`, `play.google.com`, `px.ads.linkedin.com`, `sync.teads.tv`, `token.rubiconproject.com`, `trkn.us`, `update.googleapis.com`.
- **Destinations added during the run:** not reported.
- **Retries:** none
- **Fallback:** none needed

#### Protected site: Cloudflare dashboard

2026-11-22 · No grade. The signed-in check stopped the trial before take-over. The owner discarded the profile and retried on a fresh one. The same check stopped the retry before login. The old check accepted the public dashboard root as signed in. The owner has no Cloudflare test account. Their existing account uses GitHub sign-in. The login trial is blocked and remains ungraded.

## Initial resources

Candidate instance size, resource inventory and package versions. Screen capacity is deferred until it is measured.

**Choice: Provisional.** One `standard-3` Cloudflare Container instance (2 vCPU, 8 GiB) per workspace, at most 2 instances per stage, each destroyed by a Durable Object alarm 60 minutes after start or after 60 minutes idle. `lite` is excluded: Chrome does not fit. `standard-1` (½ vCPU billed, 1 vCPU visible, 4 GiB) passed the `checks` but lost the display during two take-over sign-ins, while `standard-3` completed the LinkedIn sign-in with a CAPTCHA, using up to about 2.8 GiB of summed process memory; see the LinkedIn entry under [Login workflows on Cloudflare](#linkedin-on-cloudflare). The cause on `standard-1` is unconfirmed, so a smaller size needs a repeat sign-in trial before it replaces `standard-3`.

**Evidence today:** [Instance memory and startup under alchemy dev](#2026-11-22--instance-memory-and-startup-under-alchemy-dev--pass). Local Docker only. The Cloudflare figure is the #32 slot [Instance size, observed memory and startup time](#instance-size-observed-memory-and-startup-time).

**Screen capacity: deferred.** No number of concurrent screens, tabs or bots per instance is committed until it is measured on Cloudflare. Capacity benchmarking is out of scope for #16.

**Resource inventory** (target shape, per workspace unless stated):

| Resource                   | What it holds                                                    | Trial counterpart                                    |
| -------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| Model Worker               | Pi turns, SSE over `fetch`, lazy OAuth flows                     | `ditto-paid-pi-trial-model-trial` (#31)              |
| CPU tail Worker            | per-invocation CPU and wall time                                 | `ditto-paid-pi-trial-cpu-tail` (#31)                 |
| KV namespace               | rotated refresh tokens (trial), CPU records                      | one each in the #30 and #31 stages                   |
| Workspaces Worker          | gate, routing to the workspace's Durable Object                  | `ditto-containers-trial-workspaces` (#32)            |
| `Workspace` Durable Object | one per workspace, owns its instance, alarm-based teardown       | `Workspace` class (#32)                              |
| Container instance         | filter, Chromium, Xvfb, x11vnc, noVNC; signed-in profile on disk | `standard-1`, max 2 (#32)                            |
| Container image            | combined image, 1.69 GB locally                                  | `feasibility/containers/Dockerfile`                  |
| Destination list           | exact hostnames, one file per workspace                          | `ws-cloud-trial`, `ws-takeover` baked into the image |
| Secrets                    | run key per stage, the owner's sign-in outside the repo          | `~/.config/ditto-feasibility/*`                      |

**Package versions** (observed 2026-11-22):

- Model: Pi `@earendil-works/pi-ai` 1.6.0, workerd 1.20261026.1, compatibility date `2026-10-26` with `nodejs_compat` and `new_module_registry`, Alchemy and `@alchemy.run/cloudflare` 2.0.0-beta.87.
- Filter: `mitmproxy/mitmproxy:12.3.1@sha256:2711066c855659b5af8b1dbb84494ed3eff69b42ece439c60b4fe09a2db829d4`, Python 3.15.1, OpenSSL 4.0.3.
- Browser: `debian:trixie-20261104-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2` (Debian 13.7) for the local images. Chromium `156.0.8078.79-1~deb13u1`, `libnss3` and `libnss3-tools` `2:3.110-1+deb13u5`. Xvfb, x11vnc, noVNC, `python3-websockify`, `socat` and `iptables` from the same Debian release, unpinned.
- Driver: `node:24-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54`, Node 24.22.3.
- Host: Docker Engine 29.6.2, Docker Compose 5.3.1.

**Unresolved limits:**

- No size has run on Cloudflare. Startup there includes an image pull of about 1.69 GB on first start, unmeasured.
- Containers bill memory, CPU and disk above what Workers Paid includes, with no hard cap. The controls are the owner's billing notification, the 2-instance limit and the 60-minute alarm.
- The signed-in profile lives on the instance's disk and is lost when the instance is destroyed. Persisting it across restarts is later work.

**Owner evidence that confirms or overturns it:** the #32 size entry on `standard-1`. If memory in use nears 4 GiB or cold start is too slow for take-over, redeploy with `--instance standard-2` and rerun `checks`.

### Evidence

#### 2026-11-22 · Instance memory and startup under alchemy dev · pass

- **Route:** the combined image started by the `Workspace` Durable Object under `alchemy dev`, container in local Docker, then `checks --ws-hold-ms 5000`
- **Date:** 2026-11-22
- **Network origin:** container
- **Expected:** the instance is ready well inside the take-over wait, and the headed desktop plus filter fit in `standard-1`
- **Observed:** ready in 2.3 s with the image already built. 344 MiB in use after the checks. The image is 1.69 GB.
- **Retries:** _none recorded_
- **Fallback:** none needed. Local Docker has no instance size, so this does not measure `standard-1` itself.

## Remaining experiments

Every run below is the owner's, with their own accounts. Each prints a redacted entry for the named slot.

| #   | Experiment                                       | Status                                                                            | Command                                                                                                                                                                                     | Decides                                           |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| #25 | Local baseline, ChatGPT plan, day 1 and day 2    | passed on two local dates                                                         | `pnpm feasibility:model --route chatgpt` (once per day, on two dates)                                                                                                                       | provider behaviour from the home network          |
| #25 | Local baseline, OpenCode API key                 | passed                                                                            | `OPENCODE_API_KEY=<key> pnpm feasibility:model --route opencode`                                                                                                                            | the fallback connection                           |
| #26 | Local workerd, ChatGPT plan                      | passed                                                                            | `pnpm feasibility`, then `pnpm feasibility:model --route chatgpt --runtime workerd`                                                                                                         | Pi in workerd against the real endpoint, CPU      |
| #26 | Local workerd, OpenCode API key                  | passed                                                                            | `pnpm feasibility`, then `OPENCODE_API_KEY=<key> pnpm feasibility:model --route opencode --runtime workerd`                                                                                 | same, OpenCode                                    |
| #30 | Free-tier probe from Cloudflare, day 1 and day 2 | both failed, teardown OK                                                          | `pnpm feasibility:free-tier deploy`, `pnpm feasibility:free-tier run` (each day), `pnpm feasibility:free-tier destroy`                                                                      | whether OpenAI accepts Cloudflare's network       |
| #29 | Google, LinkedIn, protected-site logins, local   | Google and LinkedIn work with take-over; protected site skipped (no test account) | `pnpm feasibility:takeover google`, `… linkedin`, `… protected`, then `pnpm feasibility:takeover --down`                                                                                    | per-workflow grade behind the filter              |
| #31 | Deployed Pi trial                                | OpenCode passed, ChatGPT (Codex backend) refused by OpenAI's edge; teardown OK    | `pnpm feasibility:paid deploy`, `pnpm feasibility:paid run --route chatgpt`, `OPENCODE_API_KEY=<key> pnpm feasibility:paid run --route opencode`, `pnpm feasibility:paid destroy`           | the Worker model route and its real CPU           |
| #32 | Cloudflare Containers trial                      | blocked: needs Workers Paid                                                       | set a billing notification, then `pnpm feasibility:containers deploy --spending-cap-set`, `… checks`, `… takeover google` (then `linkedin`, `protected`), `… stop ws-takeover`, `… destroy` | `NET_ADMIN`, identity, size, logins on Cloudflare |

| #34 | Sign in with ChatGPT, local then Durable Object | local passed; the transferred credential was deleted with the paid stage on 2026-11-23, so redeploy and `transfer-siwc` again, then run on a later date | `pnpm feasibility:model --route siwc`; `pnpm feasibility:paid deploy`, `… transfer-siwc`, `… run --route siwc` (later date), `… destroy` | ChatGPT plan on the supported endpoint, self-deployed |
| #36 | Browser Run as the workspace browser | checks and take-overs run; ADR-0012 rejected; stage torn down, harness removed | in git history at `d5545cd` | browser provider: the shared computer stays (ADR-0012 rejected) |
| #37 | Keep the shared computer's browser healthy | built, verified locally with the platform faked; live run pending | GitHub OAuth app, then `pnpm feasibility:containers deploy --spending-cap-set`, `… checks`, `… takeover linkedin` (then `google`), `… screens`, `… idle`, `… socket`, on a later date `… restore google` (then `linkedin`), `… forget`, `… destroy` | logins across instance stops, size, screens per instance, idle stops, sandbox, DevTools during take-over, owner's sign-in, long WebSockets |
| #35 | Workers AI tool calling from a Durable Object | DeepSeek V4.1 Flash and GLM-5.3 passed 3 of 3 with tool calling; OpenCode compared on the same stage; stage torn down | `pnpm feasibility:paid deploy`, `… workers-ai --model @cf/deepseek-ai/deepseek-v4.1-flash-1017`, `… workers-ai --model @cf/zai-org/glm-5.3`, `OPENCODE_API_KEY=<key> … run --route opencode`, `… destroy` | the included model (ADR-0011) |

**Consequence of #31 and #32 staying blocked:** no hosted route is proven. The model route and the desktop stay local: Pi under Node and the #29 Docker stack on the owner's machine, which matches Ditto's current local-only use. Every hosted selection above stays provisional.

Engineering experiments not yet ticketed:

- The `enableInternet: false` outbound-intercept filter, built and run through the allow, deny, WebSocket and HTTP/2 checks, if `NET_ADMIN` is refused.
- Pinning the Debian packages by snapshot and rerunning the suites.

## External dependencies

### Hosted provider approval

Approval to onboard hosted users onto their ChatGPT plan is tracked here, apart from technical readiness. A passing trial does not unlock hosted plan onboarding. OpenAI's [plan usage docs](https://developers.openai.com/siwc/token-sharing-open-source) cover open-source and locally hosted apps; a paid or remotely hosted app completes the [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/). This gate applies to hosted Ditto only. Self-deployed Ditto is decided by #34.

**Status:** _Not started_

**Owner:** _Unassigned_

**Consequence while pending:** hosted users cannot be onboarded onto their ChatGPT plan, whatever the trials show. Technical readiness (the model route above) and approval are separate gates, and both must pass. Developer and owner testing on their own accounts, and the OpenCode API key route, continue meanwhile (ADR-0003). Ditto is local-only today, so nothing ships while this is pending.
