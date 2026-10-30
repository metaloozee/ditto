# Local GitHub import and session start fixes

Date: 2026-10-30. Setup: `pnpm dev` (stage `ayan`) on WSL2 with Docker Desktop, sandbox image git 2.34.1, repository `metaloozee/www`.

Plan 029 noted that no local test reached real GitHub or real container egress. Running the import for real exposed the failures below, one after another. Each fix has a regression test. The loops are described so the next person can rerun them.

## Failures and fixes

| # | Symptom | Cause | Fix |
|---|---|---|---|
| 1 | GitHub install popup lands on `http://localhost:1337/installation/completed` and stays open | The `ditto-web` GitHub App's Setup URL still points at an old Alchemy dev port. Dev now serves `http://localhost:5173`. | Configuration only: set the Setup URL to `http://localhost:5173/installation/completed` in the GitHub App settings. |
| 2 | `Failed to fetch branch from GitHub`: `401 Unauthorized`, `could not read Username` | The broker sent `Authorization: token <installation token>`. GitHub's git smart HTTP endpoint rejects `token` and `Bearer` (401) and accepts Basic `x-access-token:<token>` (200). | `githubGitAuthorization()` in `git-fetch-contract.ts`, used by the fetch and push request builders. |
| 3 | The error text from #2 filled the create-project dialog | The brokered child env set `GIT_CURL_VERBOSE=0`. git 2.34 enables curl tracing whenever the variable exists (`http.c`: `if (getenv("GIT_CURL_VERBOSE"))`). | Remove the variable. |
| 4 | `RPC failed; HTTP 403 … the remote end hung up unexpectedly` | Broker log: `capability_denied`. Stock git 2.34 sends `deepen-since deepen-not` on the first v1 `want` line whenever the server advertises them, and the contract denied the bare `deepen-not` token. | Allow bare `deepen-not` for v1. A `deepen-not <rev>` request line still fails as `invalid_body`. |
| 5 | `Failed to read Ditto runner revision from builder.` | `node -p "require(${JSON.stringify(path)}).version"`: the JSON quotes closed the shell's double quotes, so Node saw a syntax error. The runner `package.json` also has no `version`, so a correct probe would have returned `undefined`. | `runnerRevisionCommand()` hashes the baked runner `package.json` and `dist/`. The revision changes with runner code and needs no manual bump. |
| 6 | `Workspace restore failed`; the agent reply shows "No response was generated" | A new session restores the seed archive, which leaves `main` checked out, then fetches into `refs/heads/main`. Git refuses with `Refusing to fetch into current branch`. | Fetch into the remote-tracking ref, then `git checkout --force -B <branch> <sha>`. Works for an empty or a restored workspace. |

The workerd warning `Could not bind egress listener to gateway address, falling back to loopback` appears on every container start. It is expected on WSL with Docker Desktop: `172.17.0.1` lives in the Docker VM, and `host.docker.internal` reaches the WSL loopback. It was not the cause of any failure above.

## Why tests missed them

Every unit seam stubbed the part that failed. Fetch tests used a fake upstream, so no test checked the header against GitHub. The seed tests' mock sandbox answered any command containing `package.json` with `1.2.3`, so the shell never ran. The workspace-runtime tests mocked `fetchGitHubBranchBrokered` entirely. The new regression tests run a real shell or real git where the bug lived.

## Reproduction loops used

- Auth (#2): mint an installation token and `GET /<repo>.git/info/refs?service=git-upload-pack` with `token`, `Bearer` and Basic credentials.
- Contract (#4): run git 2.34 from the sandbox image against a local mini broker built on `validateGitFetchRequest`, `buildAuthenticatedGitUpstreamRequest` and `wrapGitUpstreamResponse`, with real GitHub upstream. Before the fix it printed the exact user error. After the fix the fetch resolved `main`.
- Runner probe (#5): run the generated command in the sandbox image under `sh` and `bash`.
- Restore (#6): drive the real `fetchGitHubBranchBrokered` with an adapter that runs each `sandbox.exec` in a sandbox-image container. Only the GitHub hop was replaced with a local fetch.

## Open: OpenCode free models are blocked

After #6 the agent run fails with `Unknown model: opencode/deepseek-v4-flash-free`. The model is pinned in `open-code-contract.ts`, `agent-models.ts`, `runner-model.ts`, `agent-job.ts` and `git-metadata-job.ts`.

- pi-ai 0.85.1 has no `deepseek-v4-flash-free` in its catalog, so the runner's `getModel` returns nothing.
- OpenCode retired the model. A direct request returns `Model is unavailable`. Its free replacement is `deepseek-v4.1-flash-free`.
- OpenCode now blocks free models outside its own client. `/zen/v1/chat/completions` returns `FreeUsageLimitError: Free usage limit reached. Free models work in OpenCode` for `big-pickle`, `nemotron-3.5-lightning-free` and `deepseek-v4.1-flash-free`. The same error came back with a valid key, a fake key and no key, so the block happens before authentication and no key unlocks it.

On 2026-10-30, `/zen/v1/models` listed eight free models: `big-pickle`, `beam-free`, `flint-40b-free`, `mimo-v2.6-flash-free`, `nemotron-3.5-super-vl-free`, `nemotron-3.5-lightning-free`, `deepseek-v4.1-flash-free` and `glm-5.3-flash-free`. Only `big-pickle` and `nemotron-3.5-lightning-free` are in the pi 0.85.1 catalog.

Undecided. The cheapest paid models that are both live and in the pi catalog are `glm-5.3-flash` ($0.15/M input, $0.50/M output) and the `minimax-m2.5`/`m2.7`/`m3` family ($0.30/M, $1.20/M). Paid access with the current key is not yet verified. Moving the pin to one paid model keeps the single-model broker boundary. A picker would turn that boundary into an allowlist.
