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

**Choice:** _Undecided_. The local trial (#27) supports a per-workspace TLS-intercepting filter in front of a Chrome container with no other route out. The deployed runtime check is still to run.

**Unresolved limits:**

- Local Docker only. Whether Cloudflare Containers can pass the workspace identity to the filter and deny Chrome every other route is untested.
- Chrome runs with `--no-sandbox`. Running it sandboxed inside the container is untested.
- The filter matches exact hostnames only. A login that spans several hosts needs each one listed, and wildcard rules are not supported yet.
- WebSocket and HTTP/2 through the filter are untested (#28).
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
