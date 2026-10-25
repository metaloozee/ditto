# 029: Brokered branch fetch for candidate sessions

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. On a STOP condition, stop and report; do not improvise. Do not stage or commit. A reviewer maintains `plans/README.md`; do not edit it or this file. No deployment, no `alchemy deploy`/`alchemy dev`, no Cloudflare API call, no GitHub API call, no live provider request, no `db:generate`/`db:migrate` and no data reset is authorized by this plan.
>
> **Drift check (run first)**: `git diff --stat 5a5b012..HEAD -- apps/runtime/src apps/web/src/lib apps/web/src/db packages/sandbox-runner/src apps/credential-tests/src package.json Dockerfile`. If any listed file changed, compare the excerpts below against live code. A mismatch is a STOP condition.

## Status

- **Status**: DONE with limits (reviewed 2026-10-25; see `plans/README.md`)
- **Priority**: P1 (no candidate session can reach a baseline without it)
- **Effort**: L
- **Risk**: HIGH (first path that lets a candidate sandbox reach GitHub, with a token minted by the product)
- **Depends on**: 025 (DONE, `c2dbdf0`..`5a5b012`)
- **Category**: security boundary / L6 prerequisite
- **Spec**: `docs/specs/pi-durable-session-runtime.md` §13 ("Keep owned-repository and workspace-branch policies. Preserve closed, credential-free Git child environments, disabled hooks and credential helpers, fixed trust configuration, no redirects"), the egress policy near line 623, and the reuse list near line 874 (`SandboxAuthority` and `SandboxEgressBroker` behaviours)
- **Decision**: maintainer, 2026-10-25. The runtime's sandbox proxies Git fetch traffic to a product RPC, and the web Worker checks the window, mints the token and calls GitHub. The token never leaves the web Worker.
- **Planned at**: commit `5a5b012`, 2026-10-25

## Why this matters

`establishBaseline` always restores the seed and then calls `syncBranch`. Without a branch authority, `syncBranch` returns `authority_denied`:

```ts
// apps/runtime/src/pi-durable-artifacts.ts:770-773
		syncBranch(scope: MutationScope, branch: string): Promise<SyncResult> {
			return settled(async () => {
				const authority = deps.branch;
				if (!authority) return fail("authority_denied", "fetch");
```

025 composed the publishers with no `branch`, and its `sandboxArtifactExecution(...).fetchBranch` throws "Brokered branch fetch is not composed in the runtime" (`pi-durable-artifacts.ts`, end of `sandboxArtifactExecution`). So no composed candidate session can publish its first pair. 025's test had to use a test-only publisher to get past this. This plan composes a real brokered fetch, so `establishBaseline` succeeds through composed code. Delivering the seed, delivering the branch name and triggering the baseline from the product are plan 030, not this one.

## Current state

### Ports in the runtime (internal types, not `packages/runtime-contracts`)

```ts
// apps/runtime/src/pi-durable-artifacts.ts:383-386 (ArtifactExecution)
	fetchBranch(
		permit: ArtifactPermit,
		request: { window: string; ref: string },
	): Promise<{ head: string }>;

// apps/runtime/src/pi-durable-artifacts.ts:403-409
export interface BranchSyncAuthority {
	open(request: {
		operation: string;
		branch: string;
	}): Promise<{ window: string; ref: string } | { denied: string }>;
	close(window: string): Promise<void>;
}
```

`syncBranch` (`pi-durable-artifacts.ts:770-812`) opens a window, calls `fetchBranch` inside an admitted `fetch` step, checks the returned head with `isGitObjectId`, and always closes the window in `finally`. Fakes: `fakeBranch()` in `apps/runtime/src/pi-durable-recovery.fixture.ts:155-169` returns `{ window, ref: "refs/heads/feature" }`.

### The legacy broker to reuse, not to extend

- `apps/web/src/lib/git-fetch-contract.ts` provides `validateGitFetchRequest(request, { repository, allowedRefs, contractVersion })` (`:512`), `buildAuthenticatedGitUpstreamRequest({ validated, mintToken })` (`:677`, sets `Authorization`, `redirect: "manual"`) and `wrapGitUpstreamResponse` (`:698`, refuses 3xx and bounds the body). It also exports `GIT_FETCH_CONTRACT_VERSION`. Reuse these three functions unchanged.
- `apps/web/src/lib/sandbox-authority.ts` refuses candidate sessions on purpose. `loadLegacyWorkspaceAdmission` throws `runtime_owner_mismatch` unless `runtimeOwner === "legacy"` (`:201-224`). **Do not change `sandbox-authority.ts` or `sandbox-egress-broker.ts`.** The candidate path is a separate module.
- The D1 table `privileged_operations` (`apps/web/src/db/schema.ts:403-445`) already has every column a window needs: `identityId`, `lifecycleGeneration`, `family` (one of `model`, `git_transport`, `ditto_action`), free-text `type`, `contractVersion`, `runtimeOwnerVersion`, `incarnationId`, `repository`, `allowedRefs`, `maxRequests`, `consumedRequests`, `contractState` (JSON text), `openedAt`, `expiresAt`, `closedAt`, `closeReason`, `correlationId`, and `openSlot` (`'open'` while open, then the row id, so there is one open row per identity and family). **No migration is needed or allowed.** If you think one is, STOP.
- Default-branch resolution: `resolveDefaultBranch` in `apps/web/src/lib/project-seed.ts:156-180` uses `getGitHubApp(env).getInstallationOctokit(installationId)` and `octokit.rest.repos.get`. Token minting: `getInstallationAccessToken(env, installationId, { repositories })` (`apps/web/src/lib/github-app.ts:23-29`).
- The trust root that interception needs inside the container: `CLOUDFLARE_CONTAINERS_CA_PATH = "/etc/cloudflare/certs/cloudflare-containers-ca.crt"` (`apps/web/src/lib/privileged-git.ts:136`).
- How the legacy code binds an outbound handler: `await sandbox.setOutboundHandler("dittoCatchAll", { identityId, lifecycleGeneration: 1 })` (`project-seed.ts:361`). Registration happens on the class: `Sandbox.outboundHandlers = { dittoCatchAll }` (`apps/web/src/server.ts:65-68`, with the comment "Class-field static outboundHandlers does not populate the SDK registry."). The handler receives `(request, env, ctx: { containerId, className, params })`.

### Candidate identity and authority

Candidate sessions have a `sandbox_identities` row (`kind='workspace_session'`, `controllerNamespace='fixture-pi-durable-execution-v1'`, `incarnationId` set), created in `apps/web/src/lib/session-command-candidate.ts:461-475`. `prepareCandidateRuntimeAuthority(db, userId, projectId, sessionId)` and `validateCandidateRuntimeAuthority(row)` (`session-command-candidate.ts:188-220`) give `current`, the identity, the incarnation and the lifecycle generation. Reuse them for the ownership and current-executor check.

The product side of the candidate port exists only in the credential test worker: `CandidateFixtureProduct` (`apps/credential-tests/src/model-entry.ts:715`) implements `CandidatePrivateProduct` by delegating to `apps/web/src/lib`. Follow that pattern: policy goes in `apps/web/src/lib`, wiring goes in the fixture product.

### 025 composition to update

`composeCandidateExecution` (`apps/runtime/src/pi-durable-execution.ts`) creates both publishers with no `branch`. `PiDurableExecutionSession.prepareExecution(scope, keyring)` (`apps/runtime/src/pi-durable-execution-session.ts`) builds the composition from `getSandbox(this.env.CandidateSandbox, scope.workspaceSessionId, { transport: "rpc" })`. The runner command `ditto-workspace` (`packages/sandbox-runner/src/workspace-git.ts`, `workspace-cli.ts`) has `status` and `commit`, uses a closed Git environment, and runs `git` through `execFileSync` argument arrays. Its entry guard resolves symlinks (`isDirectRun`).

## Design (decided; do not redesign)

1. **Window (product).** `openCandidateBranchFetch(scope, { operation, branch })` checks ownership and the current executor through `prepareCandidateRuntimeAuthority`/`validateCandidateRuntimeAuthority`, and that `workspace_sessions.runtimeOwner = 'pi_durable_v1'`. It validates `branch` against the same shape rules as the legacy branch check. Read `rejectInvalidBranchShape` in `privileged-git.ts:191-211` and copy its rules into the new module, because that function is private. It resolves `ref` as `refs/heads/<branch>` when that branch exists on GitHub, otherwise `refs/heads/<default branch>`, through an injected `github` dependency. It inserts one `privileged_operations` row: `family='git_transport'`, `type='candidate_branch_fetch'`, the identity's `id`, `lifecycleGeneration` and `incarnationId`, `runtimeOwnerVersion = scope.ownerVersion`, `repository = projects.githubRepo`, `allowedRefs = JSON.stringify([ref])`, `maxRequests = 16`, `contractVersion = GIT_FETCH_CONTRACT_VERSION`, `expiresAt = now + 5 min`, a fresh `correlationId`, and `openSlot='open'`. A second open while one is open is denied (`{ denied: "busy" }`); the `openSlot` uniqueness enforces this. It returns `{ window: row.id, ref, repository }`. Any failed check returns `{ denied: <code> }` and never throws past the port.
2. **Broker (product).** `brokerCandidateGit(scope, request, containerId)` finds the session identity's single open `candidate_branch_fetch` row. That row must be unexpired, unclosed, under budget, and match the identity's current lifecycle generation and incarnation. On first use, the broker records `containerId` in `contractState` as `{"containerId": ...}`. Every later request must match it. It refuses receive-pack (push) and anything `validateGitFetchRequest` rejects. It increments `consumedRequests`, mints a token through an injected `mintToken`, and builds the upstream request with `buildAuthenticatedGitUpstreamRequest`. It calls an injected `fetch` and returns `wrapGitUpstreamResponse(response)`. Denials return a `403` with a short `x-ditto-denial` code and no token or upstream detail in the body.
3. **Close (product).** `closeCandidateBranchFetch(scope, window)` sets `closedAt`, `closeReason='closed'` and `openSlot = id` on that row only, when it belongs to the scope's identity. It is idempotent.
4. **Port.** Add exactly these three methods to `CandidatePrivateProduct` in `apps/runtime/src/pi-durable-product-session.ts`, as runtime-internal TypeScript (no `packages/runtime-contracts` change): `openCandidateBranchFetch(scope, request: { operation: string; branch: string }): Promise<{ window: string; ref: string; repository: string } | { denied: string }>`, `brokerCandidateGit(scope, request: Request, containerId: string): Promise<Response>` and `closeCandidateBranchFetch(scope, window: string): Promise<void>`.
5. **Grant shape.** Widen `BranchSyncAuthority.open`'s success result to `{ window; ref; repository }`, and `ArtifactExecution.fetchBranch`'s request to `{ window; ref; repository }`. `syncBranch` passes `repository` through. Update `fakeBranch()` to return `repository: "owner/repo"`, and update every other `fetchBranch` fake the typecheck flags.
6. **Runtime outbound handler.** In `apps/runtime/src/pi-durable-execution-session.ts`, add `export class PiDurableCandidateSandbox extends Sandbox` (from `@cloudflare/sandbox`) with `enableInternet = false` and `interceptHttps = true`. Register `PiDurableCandidateSandbox.outboundHandlers = { candidateGit }` as a static assignment, following the web comment. `candidateGit(request, env, ctx)` reads `ctx.params` as a candidate scope, strictly parsed with `parseCandidateRuntimeScope` (exported if needed), and returns `env.CandidateProduct.brokerCandidateGit(scope, request, ctx.containerId)`. A parse failure returns `403`. Its `env` type is `{ CandidateProduct: CandidatePrivateProduct }`. Change `ExecutionSessionBindings.CandidateSandbox` to `DurableObjectNamespace<PiDurableCandidateSandbox>`. Do not touch the runtime's existing `Sandbox` class in `apps/runtime/src/server.ts`.
7. **Composition.** `composeCandidateExecution` gains `branchAuthority: BranchSyncAuthority`, passed as `branch` to both publishers. `PiDurableExecutionSession.prepareExecution` builds it from `this.env.CandidateProduct` and the scope: `open` calls `openCandidateBranchFetch`, and `close` calls `closeCandidateBranchFetch`.
8. **Sandbox fetch.** `sandboxArtifactExecution(sandbox, now, options?)` gets an optional `beforeFetch?: () => Promise<void>`. The composition supplies it as `() => sandbox.setOutboundHandler("candidateGit", scope)`. Widen `ExecutionSandbox` with `setOutboundHandler(name: string, params: unknown): Promise<unknown>`. `fetchBranch(permit, { ref, repository })` calls `beforeFetch`, then `ditto-workspace fetch --repository <quoted> --ref <quoted> --branch <owned>`, then parses `{ ok: true, head }` strictly. When `beforeFetch` is absent, `fetchBranch` keeps throwing the existing "not composed" error. The owned branch for the command is the `branch` argument `syncBranch` received: add it to the `fetchBranch` request if it is not already there, under design point 5.
9. **Runner `fetch`.** `ditto-workspace fetch --repository <owner/repo> --ref refs/heads/<name> --branch <owned>`:
   - `repository` must match `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`.
   - `ref` must be `refs/heads/` plus a name that passes `git check-ref-format`.
   - `branch` must pass the existing `check-ref-format --branch` check.
   - Refuse (`dirty_worktree`) unless `git status --porcelain=v1 -z -uall` is empty.
   - Run `git fetch --no-tags https://github.com/<repository>.git +<ref>:refs/remotes/ditto/sync` with the closed environment plus `GIT_SSL_CAINFO=/etc/cloudflare/certs/cloudflare-containers-ca.crt`, and the `-c` options `core.hooksPath=/dev/null`, `credential.helper=`, `http.followRedirects=false` and `protocol.allow=never`, `protocol.https.allow=always`.
   - Then `git checkout -q -B <branch> refs/remotes/ditto/sync`.
   - Print `{"ok":true,"head":"<sha>"}`. Error codes are `invalid_args`, `dirty_worktree` and `git_failed`.
   - For tests only, `runFetch(workspace, { repository, ref, branch }, { remoteUrl? })` lets a test pass a `file://` bare repository. The CLI never passes `remoteUrl`.

## Scope

**In scope:**
- `apps/web/src/lib/candidate-branch-fetch.ts` (new).
- `apps/credential-tests/src/model-entry.ts`: implement the three port methods on `CandidateFixtureProduct` by delegating to the new module with injected `github`, `mintToken` and `fetch` fakes.
- `apps/credential-tests/src/candidate-branch-fetch.worker.test.ts` (new), and the root `package.json` `credentials:verify` script, to add that file to its vitest list.
- `apps/runtime/src/pi-durable-product-session.ts` (port methods, plus exporting `parseCandidateRuntimeScope` if needed), `pi-durable-artifacts.ts` (grant and request shapes, `beforeFetch`, `fetchBranch`), `pi-durable-recovery.fixture.ts` and other runtime fakes the typecheck flags, `pi-durable-execution.ts`, `pi-durable-execution-session.ts`, `pi-durable-execution.test.ts`.
- `packages/sandbox-runner/src/workspace-git.ts`, `workspace-cli.ts`, `workspace-git.test.ts`.
- `plans/evidence/029-brokered-branch-fetch.md` and `plans/evidence/artifacts/029/docker-fetch.sh` (new).

**Out of scope:** `sandbox-authority.ts`, `sandbox-egress-broker.ts` and `privileged-git.ts` (read only); `packages/runtime-contracts`; migrations and `schema.ts`; `alchemy.run.ts`; push, receive-pack, PR creation; the seed and branch handoff and the baseline trigger (030); the legacy `Sandbox` classes; `plans/README.md` and this file.

## Steps

### 1. Confirm the seams
Read every file named above. Confirm, and record in evidence:
- (a) `@cloudflare/sandbox` 0.12.3 exposes `setOutboundHandler(name, params)` on the sandbox stub, and static `outboundHandlers` with the handler signature `(request, env, ctx)` (look in its `.d.ts`);
- (b) `projects` has `githubRepo` and an installation id column (name it);
- (c) `prepareCandidateRuntimeAuthority` returns `identityId`, `incarnationId` and `lifecycleGeneration`;
- (d) the credential test worker has a D1 binding with these tables (`apps/credential-tests/vitest.config.ts`).

**STOP** if (a) is false or a migration would be needed. Verify: `pnpm typecheck` exits 0 before changes.

### 2. Runner `fetch`
Implement design point 9. Tests in `workspace-git.test.ts` use temp repos and a `file://` bare remote with two branches. Assert:
- a fetch of an existing ref moves the owned branch to the remote head and prints it;
- a dirty worktree refuses `dirty_worktree` and leaves HEAD unchanged;
- a bad `repository` slug, a ref outside `refs/heads/` and a malformed branch each refuse `invalid_args`;
- a remote `post-checkout` hook marker does not run;
- the CLI (`run(argv)`) never accepts a remote URL argument.

Verify: `npm test --prefix packages/sandbox-runner -- workspace-git.test.ts` passes, then `pnpm runner:verify` exits 0.

### 3. Product module
Implement design points 1 to 3 in `candidate-branch-fetch.ts`. Use injected `{ db, now, github: { branchExists(repo, branch), defaultBranch(repo) }, mintToken(repo), fetch }`. Use raw `db.prepare` SQL, as `session-command-candidate.ts` does. Never log or return the token.

### 4. Port and fixture product
Add the three methods (design point 4) and implement them on `CandidateFixtureProduct`, with fakes: `github` answers from a fixed map, `mintToken` returns a constant fake token, and `fetch` records the upstream request and returns a canned `200` smart-HTTP response.

Tests in `candidate-branch-fetch.worker.test.ts`, written in the style of `candidate-capacity.worker.test.ts`, assert:
1. Open succeeds for an owned candidate session and stores the window row with the bound repository and `allowedRefs`. The ref is the owned branch when it exists, and the default branch otherwise.
2. Open is denied for a non-owned session, a legacy session, a retired identity, a malformed branch, and a second concurrent open.
3. The broker passes a valid upload-pack request upstream with `Authorization` set. The response the sandbox receives contains no token, and the recorded upstream URL is `https://github.com/<repo>...`.
4. The broker refuses receive-pack, another repository, a ref outside `allowedRefs`, a closed window, an expired window (advance `now`), an exhausted budget and a second `containerId`. Each refusal makes no upstream call.
5. A `3xx` upstream answer is not followed.
6. Close is idempotent, and after close the broker refuses.

Verify: `pnpm --filter @ditto/credential-tests exec vitest run src/candidate-branch-fetch.worker.test.ts` passes, and `pnpm --filter @ditto/credential-tests typecheck` exits 0.

### 5. Runtime
Implement design points 5 to 8. In `pi-durable-execution.test.ts`, replace 025's test-only publisher. `context.baseline()` must now call `composed.restorer(port)`'s `establishBaseline` (or whichever composed publisher the host uses) with a fake `branchAuthority`. The stub sandbox answers `ditto-workspace fetch ...` with `{ ok: true, head: HEAD }` and records `setOutboundHandler` calls.

Add assertions:
- (a) the baseline publishes through composed code;
- (b) `setOutboundHandler("candidateGit", scope)` ran before the fetch command;
- (c) the window opened and then closed, even when the fetch command fails;
- (d) a denied open fails the baseline with `authority_denied` and runs no fetch command.

Unit-test `candidateGit` directly: a valid `ctx.params` scope forwards to a fake product with the right `containerId`, and malformed params return `403` without calling the product.

Verify: `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-execution.test.ts src/pi-durable-artifacts.test.ts src/pi-durable-checkpoints.test.ts src/pi-durable-restore.test.ts` passes, and `pnpm --filter @ditto/runtime typecheck` exits 0.

### 6. Docker
`plans/evidence/artifacts/029/docker-fetch.sh <image>` runs with `--network none` and calls `ditto-workspace fetch` through the `PATH` symlink. Each case needs positive evidence, as in `plans/evidence/artifacts/025/docker-workspace.sh`:
- a dirty worktree prints `"error":"dirty_worktree"`;
- a bad slug prints `"error":"invalid_args"`;
- a valid request against the unreachable network prints `"error":"git_failed"` within 60 s, and HEAD is unchanged.

Build the image with `docker build -t ditto-sandbox:029 .` and run the script, then rerun `plans/evidence/artifacts/025/docker-workspace.sh ditto-sandbox:029`. Both must exit 0.

## Checks

```sh
pnpm typecheck
pnpm check
pnpm runner:verify
pnpm runtime:verify
pnpm credentials:verify
pnpm --filter @ditto/credential-tests exec vitest run src/candidate-branch-fetch.worker.test.ts
sh plans/evidence/artifacts/029/docker-fetch.sh ditto-sandbox:029
sh plans/evidence/artifacts/025/docker-workspace.sh ditto-sandbox:029
git diff 5a5b012 --stat -- apps/web/src/lib/sandbox-authority.ts apps/web/src/lib/sandbox-egress-broker.ts apps/web/src/db packages/runtime-contracts alchemy.run.ts   # expect empty
```

Known flakes: the "Isolated storage failed" error in combined `credentials:verify` (it also fails on base `36ae7b4`). Each part must then pass alone; record it. The `runtime:verify` "streams long document tails" timeout belongs to plan 026; record it if it appears.

Write `plans/evidence/029-brokered-branch-fetch.md` in the `plans/README.md` "Evidence format".

## Stop conditions

- A migration, a `schema.ts` change, a `packages/runtime-contracts` change, or a change to `sandbox-authority.ts`/`sandbox-egress-broker.ts` seems needed.
- The SDK has no per-sandbox `setOutboundHandler` with trusted params, or static `outboundHandlers` (Step 1).
- Any path would let the token reach the runtime Worker, the sandbox, a log, or a response body.
- Any path enables receive-pack, push, or a non-`github.com` destination.
- A test needs a raised deadline, a skip or a retry.

## Done

- A composed candidate session's `establishBaseline` reaches `published` through `composeCandidateExecution` with a branch authority backed by the product port. There is no test-only publisher.
- The broker's allow and deny cases (Step 4) pass against the credential worker's D1.
- `ditto-workspace fetch` passes its runner tests and both Docker scripts.
- The files listed in Checks as unchanged are unchanged.

## Limits and follow-ups

- No local test reaches real GitHub or real container egress interception. `setOutboundHandler` routing and the CA trust path are proved only by type and by the Docker refusal cases. A hosted check is a separate, separately approved step.
- **030**: deliver the project seed as a verified `ArchiveArtifactV1` in the runtime store, persist and deliver the owned branch name (synthetic sessions have none today; see `session-command-candidate.ts:461`), and trigger `establishBaseline` from the product path. 025's `sessionBranch()` hook is the place where the branch name arrives.
- Bindings for `PiDurableExecutionSession` and `PiDurableCandidateSandbox` in `alchemy.run.ts` remain a follow-up.

## Maintenance

- The candidate broker duplicates the window-resolution rules of `sandbox-authority.ts` in a narrower form. If either gains a check, such as a new identity state, review the other.
- `rejectInvalidBranchShape` is now copied in the candidate module. Keep the two in step.
- `maxRequests = 16` and the 5-minute expiry are initial ceilings. Raise them only with evidence from a hosted fetch.
