# Feasibility decision record

Spec #16 asks whether a bot can use its owner's model plan and reach the websites where the owner works. This record holds the choice for each question, the evidence behind it and the limits that remain open. See ADR-0003 (owner-supplied model access) and ADR-0004 (destination controls on computers with private logins).

Run trials against the isolated feasibility stage: `pnpm feasibility` from the repo root serves `http://localhost:1340/probe`. It keeps its state under `feasibility/.alchemy`, needs no `.env` and shares nothing with the `dev` stage, the auth suite or `verify-auth`. It deploys nothing to Cloudflare.

Each trial adds dated evidence entries under the section it informs, in the format in [evidence.md](evidence.md). A choice is filled in only once its evidence supports it. Until then, it reads _Undecided_.

**Status (2026-11-22): provisional.** The owner has run none of the human trials (#25, #26, #29, #30, #31, #32) and the account is on the Workers free plan. The only evidence so far is local: the egress filter, WebSocket and HTTP/2 in Docker (#27, #28), and the agents' runs against a simulated provider, in `alchemy dev` and in local Docker (#26, #29, #32). Each choice below is therefore marked **Provisional**: it names the target downstream work builds toward, the evidence it rests on today, and the owner run that would confirm or overturn it. No result in this record comes from a real model endpoint, a signed-in account or Cloudflare's network. #31 and #32 are blocked until the owner upgrades to Workers Paid. See [Remaining experiments](#remaining-experiments).

## Model route

**Choice: Provisional.** The official OpenAI Responses route (`https://chatgpt.com/backend-api/codex/responses`) on the owner's ChatGPT plan, through the pinned Pi runtime (`@earendil-works/pi-ai` 1.6.0) in a Cloudflare Worker on Workers Paid. The Worker calls `registerLazyOAuthFlows()` at startup, uses SSE over `fetch`, and receives the owner's sign-in from a step outside the Worker. The owner's OpenCode API key (`OPENCODE_API_KEY`) is the second supported connection and exercises the harness if ChatGPT plan access is unavailable (ADR-0003). It is recorded apart and does not stand in for the ChatGPT result.

**Evidence today:** [2026-11-22 · Pi in local workerd against the simulated provider](#2026-11-22--pi-in-local-workerd-against-the-simulated-provider--pass) and the gaps under [Local Worker compatibility (#26)](#local-worker-compatibility-26). No dated entry from a real endpoint exists yet. The route is chosen because ADR-0003 requires owner-supplied access and Responses is the provider's own route, not because a trial has passed.

**Security guarantees it supports:**

- Every request spends the owner's own access. Ditto holds no shared upstream key (ADR-0003).
- A trial Worker that accepts a credential refuses every request without the stage's run key (`feasibility/run-key.ts`), so a deployed endpoint does not relay for anyone who can reach it. Production needs a real owner sign-in in its place.
- The Worker stores no credential in the trial. Each sign-in file lives outside the repo, one per stage, so no stage retires another's refresh token.

**Unresolved limits:**

- No real turn or refresh has run, from the home network or from Cloudflare. Whether OpenAI accepts refresh and Responses from Cloudflare's addresses is the #30 question, still unanswered.
- **Pi OAuth flows do not load from a bundle in workerd.** Fallback selected: call `registerLazyOAuthFlows()` from `@earendil-works/pi-ai/lazy-oauth` at Worker startup, as `model-worker.ts` does. Pi documents that module as Node-only. Refresh passed with it against the simulated provider only, so a Pi upgrade can break it. Re-run `feasibility/model-worker.test.ts` on every Pi bump.
- **A warm Pi trial request used about 12 to 16ms of CPU, above the free plan's 10ms** (first turn after start 45 to 90ms; simulated provider, upper bound). Consequence: the Pi Worker route needs Workers Paid. On the free plan the only Worker-side check is the plain-`fetch` probe (#30), which proves the network, not the runtime. Real replies are longer, so the owner's #31 run decides the real figure.
- Sign-in cannot run in a Worker (Pi's flows need `node:http` or a terminal). Consequence: a hosted bot needs a sign-in step outside the Worker, which later work designs.
- Pi's WebSocket transport is unused in workerd (headers go in a constructor option workerd does not take). Consequence: SSE only, without Pi's WebSocket cached-context mode. Read from Pi's code, not exercised.
- The harness swaps the global `fetch` per trial. Consequence: one trial at a time per isolate. Production code must pass `fetch` explicitly or isolate turns.

**Fallbacks:**

- If #30 shows OpenAI refuses Cloudflare's network: Workers Paid does not help. Fall back to a supported container route (Pi under Node in a container), and document the provider's restriction in a follow-up ticket linked under #31's "If the route fails".
- If #31 fails only with Pi in the path: the same container route, with the failing step recorded against Pi.
- If the owner stays on the free plan: no deployed Pi route exists. Ditto stays local-only, and model turns run under Node from the owner's machine, the #25 baseline shape.
- If ChatGPT plan access is unavailable to the owner: the OpenCode API key route carries the harness and the first delegated task. Hosted ChatGPT onboarding keeps its own gates.

**Owner evidence that confirms or overturns it:** #25 day 1 and day 2 (refresh of a day-old token) and the OpenCode baseline; #26 in local workerd on both routes, with real CPU figures; #30 day 1 and day 2 from Cloudflare; #31 on Workers Paid. A refusal from Cloudflare's network in #30, or a deployed CPU figure above what Workers Paid allows per request, overturns the Worker route.

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

_Not yet run. Compare with the day 1 and day 2 baseline entries._

##### OpenCode API key in local Worker

_Not yet run. Compare with the OpenCode baseline entry._

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

#### Deployed Pi trial (#31)

The #26 model-trial Worker, deployed to the owner's Cloudflare account on Workers Paid, runs the same turn, refresh and turn as the baseline. Requests now leave from Cloudflare's network with the Pi runtime in the path, so the result separates the runtime (#26) from the network (#30). Blocked until the owner upgrades to Workers Paid.

The trial has its own Alchemy stack and stage (`ditto-paid-pi-trial`, stage `paid-pi-trial`). It runs from `feasibility/paid`, so its state lives in `feasibility/paid/.alchemy`. It creates two Workers, `ditto-paid-pi-trial-model-trial` and `ditto-paid-pi-trial-cpu-tail`, and one KV namespace, and touches no other stage's resources. `feasibility/paid/worker.ts` wraps `feasibility/model-worker.ts` unchanged, with the same compatibility settings.

**Gate.** The Worker spends whatever credential arrives in the request body, so every route, including `GET /model-trial`, refuses a request without the stage's run key in the `x-trial-key` header (#30's digest comparison, in `feasibility/run-key.ts`). A deploy without a run key refuses every request. The deploy command generates the key into `~/.config/ditto-feasibility/paid-run-key` and passes it to the Worker as a secret. The Worker stores no credential: each run sends the owner's sign-in from `~/.config/ditto-feasibility/paid-codex.json` and saves the token the refresh rotates. This sign-in is separate from the baseline's and the probe's, so no stage retires another's refresh token.

**CPU time.** A deployed Worker cannot be measured from `/proc`. Cloudflare reports each invocation's CPU and wall time to the tail Worker, which stores them by the run id the command sent. The figure covers the whole trial request, not each step, and is the number the Workers limit applies to. Under `alchemy dev` the local runtime reports 0ms, so only the owner's run measures it.

Sign in to Cloudflare with Alchemy and upgrade to Workers Paid first. Then run each route on a day different from the baseline's day 1 and day 2:

```sh
pnpm feasibility:paid deploy                                  # generates the run key, deploys the stage
pnpm feasibility:paid run --route chatgpt                     # first time: device-code ChatGPT sign-in; 3 runs, 15 min apart
OPENCODE_API_KEY=<key> pnpm feasibility:paid run --route opencode
pnpm feasibility:paid destroy                                 # tears the stage down, prints the teardown entry
```

##### ChatGPT plan in deployed Worker

_Not yet run. Must be a different date from both baseline days._

##### OpenCode API key in deployed Worker

_Not yet run. Recorded apart from the ChatGPT result (ADR-0003)._

##### Comparison with the local Worker trial and the free-tier probe

_Not yet compared. For each step, compare the deployed result with the #26 local Worker entry (same runtime, home network) and the #30 free-tier probe entry (Cloudflare network, no Pi runtime). A step that fails only here points at Pi on Cloudflare's network. Compare the request CPU time with #26's workerd figures. Explain each difference, or mark it unexplained._

##### If the route fails

_Not applicable yet. If the deployed trial fails, link the follow-up ticket that evaluates a supported container route and documents the provider's restrictions, then record the failure's consequence for the model route._

##### Teardown

_Not yet torn down. Paste the entry that `pnpm feasibility:paid destroy` prints._

## Desktop provider

**Choice: Provisional.** Cloudflare Containers, one instance per workspace, each owned by a `Workspace` Durable Object, running one image that holds the egress filter and a headed Chromium on Xvfb with x11vnc and noVNC for take-over (`feasibility/containers/`). The runtime passes `WORKSPACE_ID` at start, and that is the only place the image learns its workspace.

**Evidence today:** the local Docker trials [Chrome has no route around the filter](#2026-11-22--chrome-has-no-route-around-the-filter--pass), [Take-over view is reachable on loopback only](#2026-11-22--take-over-view-is-reachable-on-loopback-only--pass), [Login pages load through the filter without signing in](#2026-11-22--login-pages-load-through-the-filter-without-signing-in--pass), and the `alchemy dev` runs below: [the combined image under alchemy dev](#2026-11-22--combined-image-on-the-containers-runtime-under-alchemy-dev--pass) and [the fence without NET_ADMIN](#2026-11-22--fence-inside-one-instance-without-net_admin--fail). Nothing has run on Cloudflare.

**Security guarantees it supports**, against the list in [If filtered traffic is unsuitable](#if-filtered-traffic-is-unsuitable):

| Guarantee                                                      | Local Docker (#27–#29)    | Containers under `alchemy dev` (#32)    | Cloudflare (#32) |
| -------------------------------------------------------------- | ------------------------- | --------------------------------------- | ---------------- |
| The computer has no route except the filter                    | yes (internal network)    | only with `NET_ADMIN`; fails without it | untested         |
| The destination list is enforced per workspace, outside Chrome | yes                       | yes                                     | untested         |
| The workspace identity reaches the filter from the runtime     | yes (Compose env)         | yes (`WORKSPACE_ID` at start)           | untested         |
| TLS-intercepted decisions per request, not only per tunnel     | yes                       | yes                                     | untested         |
| WebSocket and HTTP/2 through the filter                        | yes (#28)                 | yes (5 s hold)                          | untested         |
| The take-over view reachable by the owner only                 | loopback only, no sign-in | run-key gate plus loopback doorways     | untested         |

**Unresolved limits:**

- **`NET_ADMIN` on Cloudflare Containers is untested.** Without it, Chrome shares the filter's network namespace and has a direct route out, so the instance is unsuitable for private logins (ADR-0004). Fallback selected: `enableInternet: false`, with outbound HTTP and HTTPS intercepts to a Worker handler that replaces mitmproxy as the filter. That handler must enforce the per-workspace list and log the workspace, and the allow, deny, WebSocket and HTTP/2 checks must be repeated against it. If it cannot make per-request decisions inside TLS or carry WebSocket, evaluate another provider that enforces the workspace destination list in a follow-up ticket.
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

The #27 filter and the #29 headed desktop, running on Cloudflare Containers in their own paid stage. Blocked until the owner upgrades to Workers Paid. Nothing here has run on Cloudflare yet. Every entry below the harness description is an empty slot for the owner.

**Shape.** A Container instance runs one image, so `feasibility/containers/Dockerfile` combines the two local images: the pinned `mitmproxy/mitmproxy:12.3.1` image, plus the #29 desktop packages (`chromium`, `xvfb`, `x11vnc`, `novnc`, `python3-websockify`, `socat`) and `iptables`. It copies `egress/filter/egress_filter.py` unchanged and bakes in the `ws-cloud-trial` and `ws-takeover` destination lists. The image is 1.69 GB locally. `feasibility/containers/worker.ts` holds one `Workspace` Durable Object per workspace, and each object owns one instance. The object starts its instance with `WORKSPACE_ID=<workspace>` and `enableInternet: true`. That variable is the only place the image learns its workspace. The entrypoint hands it to the filter, and the filter logs it on every decision, to stdout (kept by Cloudflare's container logs) and to a file the owner's commands read.

**Gate.** Every route refuses a request without the stage's run key in `x-trial-key` (#30's digest comparison in `feasibility/run-key.ts`), and a deploy without a key refuses everything. Only `POST /w/<workspace>/start` starts a billed instance. View, DevTools and control requests to a stopped instance get 409 and start nothing. Only the two workspaces with a list in the image are accepted. The Worker strips the key before forwarding to the instance. A browser cannot send a header, so the owner's commands open loopback doorways, `127.0.0.1:9222` for DevTools and `127.0.0.1:6080` for the noVNC view, that add the key themselves. The key never appears in a URL or a page.

**Spending.** The stack allows at most 2 instances. Each start sets a Durable Object alarm that destroys the instance 60 minutes later, and an inactivity timeout of the same length, so the instance survives an idle take-over but not a forgotten one. `checks` stops its instance when it finishes.

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

#### Workspace identity in the filter log

_Not yet run. Paste the `filter logs the workspace identity the runtime passed on Cloudflare` entry from `checks`._

#### Allow and deny, compared with the local trial (#27)

_Not yet run. Paste the `approved destination` and `unapproved destination` entries. Each carries a comparison line with the #27 result. Explain any difference._

#### No route around the filter, compared with the local trial (#27)

_Not yet run. Paste the entry. Record whether the instance reported `filter-user-only` or `none`. If `none`, Chrome on Cloudflare has a direct route out, and filtered traffic in this shape is unsuitable for a computer with private logins (ADR-0004)._

#### WebSocket, compared with the local trial (#28)

_Not yet run. Paste the entry from the default 65-second hold._

#### HTTP/2, compared with the local trial (#28)

_Not yet run. Paste the entry. Record any downgrade on either leg._

#### Instance size, observed memory and startup time

_Not yet run. Paste the entry: instance type, memory in use and peak after the checks, and cold startup time. Note whether the first start included pulling the image._

#### Google on Cloudflare

_Not yet run. Paste the `takeover google` entry, then the grading template from Login workflows (#29). Grade: pass, works with take-over or unsupported on Cloudflare._

#### LinkedIn on Cloudflare

_Not yet run. Paste the `takeover linkedin` entry, then the grading template._

#### Protected site on Cloudflare: Cloudflare dashboard

_Not yet run. Paste the `takeover protected` entry, then the grading template. Record whether Turnstile treats Cloudflare's own container egress differently from the home network._

#### If filtered traffic is unsuitable

_Not applicable yet. If the fence does not apply on Cloudflare, or a login is unsupported only because of the filter, open the follow-up ticket to evaluate another provider that enforces the workspace destination list. Link it here and compare, for each option, which guarantees it supports: the computer has no route except the filter; the destination list is enforced per workspace, outside Chrome's control; the workspace identity reaches the filter from the runtime; TLS-intercepted decisions per request, not only per tunnel; WebSocket and HTTP/2 through the filter; the take-over view reachable by the owner only. Include Cloudflare's `enableInternet: false` with outbound intercepts as one option._

#### Teardown

_Not yet torn down. Paste the entry that `pnpm feasibility:containers destroy` prints._

## Egress policy

**Choice: Provisional.** Default deny. Each workspace has an exact-hostname destination list (`destinations/<WORKSPACE_ID>.txt`), enforced by a TLS-intercepting mitmproxy 12.3.1 filter (`egress_filter.py`) that is Chrome's only route out. The runtime passes the workspace identity. The filter reads the list on every decision, refuses an unapproved CONNECT before any upstream connection, decides again for each request inside a tunnel and for each WebSocket upgrade, and logs `{workspace, host, decision, method, http_version, upstream_alpn}` for each. The CA is generated per stage, its key never leaves the filter, and it is discarded on teardown. The local trial (#27) supports this shape, and #28 shows WebSocket and HTTP/2 survive it. The deployed runtime check is still to run.

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

**Topology.** Chrome is attached only to the `workspace` network, which is `internal: true`, so it has no route or DNS to the internet. The filter is attached to `workspace` and `egress` and is Chrome's `--proxy-server`. The runtime passes the workspace identity to the filter as `WORKSPACE_ID`. The filter reads `/destinations/<WORKSPACE_ID>.txt` on every decision and logs `{workspace, host, decision, method, ...}` for every CONNECT and for every request inside a tunnel. An unapproved CONNECT gets a 403 before any upstream connection. `DESTINATIONS_DIR` points the bind mount at another directory. Editing the file changes what loads with no rebuild or restart.

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

**Filtered traffic on a computer with private logins:** _Undecided. State either that filtered traffic is suitable on a computer with private logins, or that another provider that enforces the workspace destination list must be evaluated, with the workflows that decide it._

**Unresolved limits:**

- The take-over view is a raw noVNC screen, not the take-over UI. It has no owner sign-in, so anything on the host's loopback can view or drive the screen during the trial.
- DevTools is published on the host's loopback for the bot. The harness refuses its own bot reads and actions during take-over, but nothing stops another local process from using DevTools.
- The bot's task checks are read-only and prove only that the session works. They post, change and buy nothing.

### Running a workflow

From the repo root, with Docker running:

```sh
pnpm feasibility:takeover google      # or linkedin, protected
pnpm feasibility:takeover --down      # after the last workflow: discards the CA and the signed-in profile
```

1. The harness starts the `ws-takeover` filter, the desktop and the viewer (`feasibility/takeover/compose.yaml`, which includes the #27 egress stack). The bot opens the task page. If it is already signed in, the workflow can pass without take-over.
2. Otherwise the bot opens the login page and suspends. Once it prints **Take-over ready**, open `http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale` and complete only the login and any challenge. The bot neither reads nor drives the screen until you hand back.
3. Type `hand back` in the terminal. Nothing else returns control, including closing the view. The bot inspects where the tab is, then does the task alone.
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
- **Bot finished after hand-back:** yes | no, and where the tab was when the bot inspected it
- **Owner operated the site beyond the login or challenge:** yes (fails the trial) | no
- **Destinations added during the run:** hosts, or none
```

Pass: the bot finished with no take-over. Works with take-over: the owner completed only the login or challenge and the bot finished after hand-back. Unsupported: the bot could not finish, or the owner had to operate the site step by step.

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

_Not yet run by the owner. Paste the harness entry here, then the grading template._

#### LinkedIn

_Not yet run by the owner. Paste the harness entry here, then the grading template._

#### Protected site: Cloudflare dashboard

_Not yet run by the owner. Paste the harness entry here, then the grading template._

## Initial resources

Candidate instance size, resource inventory and package versions. Screen capacity is deferred until it is measured.

**Choice: Provisional.** One `standard-1` Cloudflare Container instance (4 GiB) per workspace, at most 2 instances per stage, each destroyed by a Durable Object alarm 60 minutes after start or after 60 minutes idle. `lite` is excluded: Chrome does not fit. A larger size is chosen only if the #32 size check shows memory pressure or slow startup.

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

| #   | Experiment                                       | Status                      | Command                                                                                                                                                                                     | Decides                                           |
| --- | ------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| #25 | Local baseline, ChatGPT plan, day 1 and day 2    | pending owner               | `pnpm feasibility:model --route chatgpt` (once per day, on two dates)                                                                                                                       | provider behaviour from the home network          |
| #25 | Local baseline, OpenCode API key                 | pending owner               | `OPENCODE_API_KEY=<key> pnpm feasibility:model --route opencode`                                                                                                                            | the fallback connection                           |
| #26 | Local workerd, ChatGPT plan                      | pending owner               | `pnpm feasibility`, then `pnpm feasibility:model --route chatgpt --runtime workerd`                                                                                                         | Pi in workerd against the real endpoint, CPU      |
| #26 | Local workerd, OpenCode API key                  | pending owner               | `pnpm feasibility`, then `OPENCODE_API_KEY=<key> pnpm feasibility:model --route opencode --runtime workerd`                                                                                 | same, OpenCode                                    |
| #30 | Free-tier probe from Cloudflare, day 1 and day 2 | pending owner               | `pnpm feasibility:free-tier deploy`, `pnpm feasibility:free-tier run` (each day), `pnpm feasibility:free-tier destroy`                                                                      | whether OpenAI accepts Cloudflare's network       |
| #29 | Google, LinkedIn, protected-site logins, local   | pending owner               | `pnpm feasibility:takeover google`, `… linkedin`, `… protected`, then `pnpm feasibility:takeover --down`                                                                                    | per-workflow grade behind the filter              |
| #31 | Deployed Pi trial                                | blocked: needs Workers Paid | `pnpm feasibility:paid deploy`, `pnpm feasibility:paid run --route chatgpt`, `OPENCODE_API_KEY=<key> pnpm feasibility:paid run --route opencode`, `pnpm feasibility:paid destroy`           | the Worker model route and its real CPU           |
| #32 | Cloudflare Containers trial                      | blocked: needs Workers Paid | set a billing notification, then `pnpm feasibility:containers deploy --spending-cap-set`, `… checks`, `… takeover google` (then `linkedin`, `protected`), `… stop ws-takeover`, `… destroy` | `NET_ADMIN`, identity, size, logins on Cloudflare |

**Consequence of #31 and #32 staying blocked:** no hosted route is proven. The model route and the desktop stay local: Pi under Node and the #29 Docker stack on the owner's machine, which matches Ditto's current local-only use. Every hosted selection above stays provisional.

Engineering experiments not yet ticketed:

- Chrome sandboxed (without `--no-sandbox`) inside a Container instance.
- The `enableInternet: false` outbound-intercept filter, built and run through the allow, deny, WebSocket and HTTP/2 checks, if `NET_ADMIN` is refused.
- WebSocket sessions of minutes to hours through the filter, and the filter's idle timeouts.
- Screen capacity per instance size.
- Pinning the Debian packages by snapshot and rerunning the suites.

## External dependencies

### Hosted provider approval

Approval to onboard hosted users onto their ChatGPT plan is tracked here, apart from technical readiness. A passing trial does not unlock hosted plan onboarding.

**Status:** _Not started_

**Owner:** _Unassigned_

**Consequence while pending:** hosted users cannot be onboarded onto their ChatGPT plan, whatever the trials show. Technical readiness (the model route above) and approval are separate gates, and both must pass. Developer and owner testing on their own accounts, and the OpenCode API key route, continue meanwhile (ADR-0003). Ditto is local-only today, so nothing ships while this is pending.
