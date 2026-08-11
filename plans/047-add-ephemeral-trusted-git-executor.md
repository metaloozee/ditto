# Plan 047: Add the ephemeral Trusted Git Executor

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. This
> plan creates the Trusted Git Executor foundation only; it does not cut over
> current Git import, fetch, push, PR, Project Sandbox, or browser paths. If a
> **STOP condition** occurs, stop and report it — do not widen egress, place a
> credential in the container, expose a shell/process/terminal API, or fall back
> to the current Project Sandbox Git implementation.
>
> **Cloud completion boundary**: Plan 039 is `DONE-local`; its paid-plan cloud
> cutover remains deferred. Steps 1–7 are locally executable from a clean
> worktree at `e3abdee`. Steps 8–10 require the already-deployed and converged
> Alchemy v2 `dev` Website graph, Workers Paid Containers, an
> installation-accessible disposable GitHub fixture, and authorization to make
> one disposable non-force branch update. If those prerequisites are absent,
> stop at Step 8 and record
> `DONE-local (BLOCKED for full DONE: deployed Container/GitHub acceptance unavailable)`.
> Do not create or repair Plan 039's missing cloud graph from this plan. A
> present-but-failing Container, migration, egress, Git, revocation, or cleanup
> check is `BLOCKED`, not `DONE-local`.
>
> **Mandatory stock-Git platform gate**: Current Cloudflare documentation and
> installed declarations expose the required outbound HTTPS interception, but
> Ditto has not proved stock Git through that deployed proxy. Step 10 begins
> with a read-only real-GitHub prototype before any remote write. It must prove
> stock `git fetch` works while the installation credential is absent from
> container env, argv, files, process metadata, output, and logs; only then may
> the disposable non-force push run. If that cannot be proved with exact-host/
> exact-request filtering and the ephemeral Cloudflare CA, STOP. Do not invent
> a credential helper, askpass channel, token file, URL credential, broader
> host allowlist, custom Git protocol, or shell API.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat e3abdee..HEAD -- \
>   alchemy.run.ts apps/web/package.json pnpm-lock.yaml \
>   apps/web/src/server.ts apps/web/src/server.test.ts \
>   apps/web/src/lib/github-app.ts apps/web/src/lib/privileged-git.ts \
>   apps/web/src/lib/secret-redaction.ts .dockerignore
> ```
>
> If any listed path changed, compare the **Current state** excerpts with live
> code. STOP if Alchemy is no longer the sole deployment owner, the Website no
> longer owns the Worker entrypoint, the existing `Sandbox` binding/class or
> physical names changed, installation tokens are no longer Worker-minted, R2
> is no longer directly bound, or Alchemy no longer emits a new SQLite Durable
> Object migration for a new locally hosted container class. Preserve all
> unrelated dirty/untracked work by using the clean worktree workflow below;
> never stash, reset, clean, commit, or copy the maintainer's root checkout.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH — credential boundary, authenticated Git mutation, beta IaC,
  Container lifecycle, and deny-all egress
- **Depends on**: `plans/039-migrate-ayan-stack-to-alchemy-v2.md`
  (`DONE-local`; its accepted source graph is enough for local execution; full
  DONE requires its separately authorized deployed v2 prerequisite)
- **Independent of**: Plan 041 and absent Plans 042–046; do not create or wait
  for them
- **Category**: security
- **Planned at**: commit `e3abdee`, 2026-08-11
- **Branch**: `advisor/047-add-ephemeral-trusted-git-executor`
- **Execution status**: BLOCKED — Step 1 frozen install rejected locked `@cloudflare/workers-types@5.20260811.1` under the 4,320-minute minimum-release-age policy; retry after 2026-08-14 00:59:59 UTC

## Why this matters

Current privileged fetch/push runs inside the Project Sandbox, which also holds
project files and executes project/agent processes. Even with command-scoped
Git configuration, that is the wrong long-term credential boundary. A Trusted
Git Executor must perform only narrow, independently validated Git mechanics in
a fresh container that never receives project code or GitHub credentials.

This plan creates that independently deployable primitive. It binds one
container-backed SQLite Durable Object to the existing Website Worker, proves a
deny-all Worker-side smart-HTTP proxy, validates a bounded R2 bundle in a fresh
bare quarantine repository before write access, and destroys every terminal
container. It deliberately does **not** implement durable Git Publication,
Git Import, pull-request behavior, Brain, Workflow, or Project Sandbox cutover.

## Non-negotiable decisions

1. **Exact resource shape**: Website env binding and exported class are both
   `TrustedGitExecutor`; physical ContainerApplication is
   `ditto-git-executor-ayan`; `instanceType: "basic"`; `maxInstances: 4`;
   update rollout is immediate. The existing `Sandbox` resource remains stable
   `0.12.3`, `lite`, max 1, RPC, and otherwise unchanged.
2. **One publication identity**: derive the Durable Object/container name from
   a domain-separated SHA-256 of exact Git Publication ID plus positive
   Execution Epoch. The same pair is idempotent; a different epoch is a fresh
   identity. Do not use user/project/session IDs alone, a singleton, a random
   pool, or a reusable account/repository executor.
3. **No production caller yet**: export a narrow internal RPC contract for
   tests and later orchestration, but do not wire routes, tRPC, current
   `session-git`, Project Sandbox Git, browser, Pi, or PR code. No final public
   route targets this class or its container. Deployed Step 10 may use the
   temporary one-time authenticated acceptance adapter defined there only while
   admission is closed; remove it and its temporary secret binding, redeploy,
   and prove both absent before DONE.
4. **Minimal image**: use a dedicated build context containing only a pinned
   Alpine base, exact Git and CA packages, and one fixed helper. At planning
   time the verified multi-architecture base is
   `docker.io/library/alpine:3.22.5@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce`;
   Alpine v3.22 publishes `git=2.49.1-r0` and
   `ca-certificates=20260611-r0` for both x86_64 and aarch64. Re-resolve the
   digest/package indexes in Step 1; if they differ or exact installs fail,
   STOP and refresh the plan rather than float a tag or package.
5. **No project runtime**: the executor image contains no Pi package, Node
   package, project checkout, project/worktree mount, backup restore, LFS,
   SSH, GitHub CLI, terminal server, listening/public port, or Project Sandbox
   identifier/handle. Type the class environment as the narrow `Pick` of R2 and
   GitHub App values it needs — never as full `Env`, and never include
   `Sandbox`. A POSIX shell may execute the
   baked fixed helper internally, but no RPC accepts commands, argv, scripts,
   paths, env, or shell text from a caller.
6. **Deny by default**: `enableInternet = false`, `interceptHttps = true`, an
   exact `github.com` gate, and a static catch-all deny handler are all required.
   Export `ContainerProxy`. Never rely on `allowedHosts` alone: installed
   `@cloudflare/containers@0.3.7` permits an allowed-host direct-internet
   fallback when no handler matches.
7. **Exact Git smart HTTP only**: read phase permits only the exact configured
   repository's upload-pack discovery and RPC; write phase permits only its
   receive-pack discovery and RPC. Reject every other scheme, host, port,
   method, path, query, repository, service, content type, userinfo,
   Authorization/Cookie/proxy-auth input, redirect, and oversized body.
   Forward only a small code-owned header allowlist and use manual redirects.
8. **Credentials stay in the Worker**: every allowed smart-HTTP request mints a
   fresh repository-scoped installation token with only `contents: read` or
   `contents: write`, injects HTTP Basic in a newly constructed upstream
   request, and revokes that token through GitHub's
   `DELETE /installation/token` before the response stream can finish. A failed
   revoke fails the Git request/operation. Never pass a token to
   `setOutboundByHost()`: version 0.3.7 persists runtime handler params in the
   Durable Object's SQLite storage.
9. **Short phase leases**: persisted outbound params may contain only bounded
   non-secret publication/epoch, installation/repository identity, phase, and
   an absolute expiry. The handler denies after expiry. Read and write use
   distinct grants; removing the host override restores the static deny handler.
10. **Quarantine before write**: read the existing `BACKUP_BUCKET` R2 object as
    a bounded stream; verify exact length and SHA-256; feed it to the fixed
    helper; create a fresh bare repository with no template, hooks, remotes,
    alternates, replacements, shallow/promisor state, or inherited config;
    import exactly one self-contained SHA-1 bundle ref; run strict fsck and the
    fixed limit/protocol checks; and verify expected old/proposed ancestry and
    exact destination ref before enabling receive-pack.
11. **No force and no blind retry**: push exactly
    `<validatedSha>:<validated refs/heads/...>` without force,
    force-with-lease, wildcard refspec, delete, mirror, tags, submodules, or
    caller URL. Capacity/rate refusal proven before process start may retry with
    bounded backoff. Once a write process starts, any uncertain result first
    performs a fresh read-phase `ls-remote` of the exact ref: proposed SHA means
    reconciled success, expected old/expected absence permits at most one retry,
    and any third state returns interrupted without mutation replay.
12. **Terminal destruction is part of the result**: revoke phase access, stop
    or kill any child, destroy the container, prove it is no longer running,
    clear non-secret phase state, and then return. Cleanup failure overrides a
    nominal Git success. A short expiry/alarm is the fail-safe for Worker/DO
    interruption, not permission to report success early.
13. **Safe outputs only**: return a closed structured union of safe status/code,
    publication epoch, exact ref/SHA, bounded counts, and booleans for
    revocation/destruction. Diagnostics are redacted then capped at 8 KiB. Never
    return command text, URL, headers, request/response bodies, Git packet data,
    object bytes, paths, commit messages, token material, process listings, or
    raw exceptions.
14. **Rollout only after drain**: configure the ContainerApplication's immediate
    rollout. The first deployment has no production Git admission because this
    plan adds no caller. Before any later deployment with a caller, close Git
    admission, prove zero nonterminal executor operations/containers through
    that caller's authoritative store and Container inventory, then deploy. A
    grace period, mixed Worker/container protocol, or unproven drain is a STOP.

## Current state

### Domain vocabulary

`CONTEXT.md:23-45` defines the terms this plan must preserve:

```markdown
**Session Branch**:
The Git branch owned by exactly one Workspace Session. Ditto may advance its remote ref without force but never uses it to mutate the repository's default branch.

**Repository Binding**:
The immutable association between a Project and one GitHub repository identity; installation and owner/name locators may change without changing the binding.

**Git Publication**:
One durable Brain-authorized attempt to commit a Workspace Session's safe changes, advance its Session Branch, and create or return its pull request.

**Trusted Git Executor**:
The ephemeral trusted component that validates credential-free Git artifacts and performs narrowly authorized authenticated remote mechanics without running project code.
```

Use `TrustedGitExecutor`, Git Publication, Repository Binding, Session Branch,
and Execution Epoch. Do not call this a Project Sandbox, Brain, runner, generic
Git worker, terminal, or Agent Run.

### Alchemy v2 Website and existing Container

`alchemy.run.ts:28-35` currently declares the only Container:

```ts
const SandboxContainer = Cloudflare.Container<SandboxDurableObject>("sandbox", {
	name: "ditto-sandbox-ayan",
	className: "Sandbox",
	context: repoRoot,
	dockerfile: path.join(repoRoot, "Dockerfile"),
	instanceType: "lite",
	maxInstances: 1,
});
```

`alchemy.run.ts:37-50` makes the Website Worker and env graph authoritative:

```ts
export const Website = Cloudflare.Website.Vite("website", {
	name: "ditto-website-ayan",
	rootDir: path.join(repoRoot, "apps/web"),
	main: "src/server.ts",
	assets: { runWorkerFirst: true },
	compatibility: {
		flags: ["nodejs_compat_populate_process_env"],
	},
	routes: [{ pattern: "*.ayn.wtf/*", zoneName: "ayn.wtf" }],
	env: {
		DB: Database,
		Sandbox: SandboxContainer,
		BACKUP_BUCKET: SandboxBackups,
```

Add one sibling declaration and one env binding. Do not rename/rebuild the
existing resource, add a Worker, route, D1 database, R2 bucket, or hand-written
migration.

The exact installed `alchemy@2.0.0-beta.70` declarations currently prove:

- `Cloudflare.Container<DOShape>(id, { name, className, context, dockerfile,
  instanceType, maxInstances, rollout })` is valid;
- `rollout.strategy` accepts `"immediate"`;
- binding the declaration emits a `durable_object_namespace`, attaches the
  ContainerApplication, and contributes container class metadata;
- a new locally hosted class is added to `newSqliteClasses` during a full
  Worker deployment;
- a migration cannot ride a gradual Worker rollout.

Use this target shape (the logical id is intentionally distinct from the
binding/class but the binding/class are exact):

```ts
import type { TrustedGitExecutor as TrustedGitExecutorDurableObject } from "./apps/web/src/lib/trusted-git-executor.ts";

const TrustedGitExecutorContainer =
	Cloudflare.Container<TrustedGitExecutorDurableObject>("trusted-git-executor", {
		name: "ditto-git-executor-ayan",
		className: "TrustedGitExecutor",
		context: path.join(repoRoot, "containers/trusted-git-executor"),
		dockerfile: path.join(
			repoRoot,
			"containers/trusted-git-executor/Dockerfile",
		),
		instanceType: "basic",
		maxInstances: 4,
		rollout: { strategy: "immediate" },
	});

// Website env
TrustedGitExecutor: TrustedGitExecutorContainer,
```

### Worker entrypoint

`apps/web/src/server.ts:1-5` currently exports only the stable Sandbox class:

```ts
import { proxyToSandbox, type SandboxEnv } from "@cloudflare/sandbox";
import handler from "@tanstack/react-start/server-entry";

export { Sandbox } from "@cloudflare/sandbox";
```

Preserve the default fetch path byte-for-byte except imports/exports needed to
export `TrustedGitExecutor` and `ContainerProxy`. Do not route browser requests
to either. `apps/web/src/server.test.ts` mocks the Sandbox package and verifies
preview proxy fallthrough; extend its mocks only as needed to keep that routing
coverage green.

### Installed Container and Worker APIs

Planning retrieved current Cloudflare docs and exact installed packages on
2026-08-11:

- current/latest `@cloudflare/containers` is `0.3.7`; it is present only as
  Sandbox's transitive dependency, so add it as an exact direct web dependency;
- latest retrieved `@cloudflare/workers-types` is `5.20260811.1` and declares
  `ctx.container.exec(argv, { stdin, stdout, stderr, signal, cwd, env, user })`,
  `destroy()`, `running`, and outbound HTTP/HTTPS interception;
- current docs state `Container` extends SQLite Durable Object, `destroy()`
  resolves after runtime destruction, HTTPS interception uses the ephemeral
  `/etc/cloudflare/certs/cloudflare-containers-ca.crt`, and `ContainerProxy`
  must be exported;
- current docs and 0.3.7 expose `enableInternet`, `interceptHttps`, static
  `outbound`, named `outboundHandlers`, `setOutboundByHost`,
  `removeOutboundByHost`, and runtime handler params;
- 0.3.7 source persists those runtime params under
  `OUTBOUND_CONFIGURATION` in Durable Object SQLite. Persist only non-secret
  policy metadata there;
- current docs say open connections pick up updated low-level interception;
  deployed phase-revocation tests remain mandatory because that property is
  security-critical;
- GitHub's current REST description defines
  `DELETE /installation/token` (`apps/revoke-installation-access-token`) with
  success status 204.

Primary references to re-fetch in Step 1:

- <https://developers.cloudflare.com/containers/platform-details/outbound-traffic/>
- <https://developers.cloudflare.com/containers/container-class/>
- <https://developers.cloudflare.com/durable-objects/api/container/>
- <https://developers.cloudflare.com/containers/platform-details/rollouts/>
- <https://developers.cloudflare.com/containers/platform-details/limits/>
- <https://docs.github.com/en/rest/apps/installations#delete-an-installation-access-token>

If current docs, latest types, installed 0.3.7, or installed Alchemy beta.70 no
longer support this exact shape, STOP and refresh; do not mix Sandbox `@next`,
Wrangler-owned deployment, or guessed APIs into this plan.

### Current token boundary

`apps/web/src/lib/github-app.ts:17-33` mints a repository-scoped installation
token and returns the raw token only to trusted Worker code:

```ts
export async function getInstallationAccessToken(
	env: Env,
	installationId: number,
	options?: {
		repositories?: string[];
	},
): Promise<string> {
	const app = getGitHubApp(env);

	const response = await app.octokit.rest.apps.createInstallationAccessToken({
		installation_id: installationId,
		...(options?.repositories?.length
			? { repositories: options.repositories }
			: {}),
	});

	return response.data.token;
}
```

Extend this helper minimally to request exact Contents permission and add a
Worker-only revoke helper. Preserve existing callers and repository short-name
semantics. Unit tests must mock Octokit and never use a real token.

The superseded implementation at `apps/web/src/lib/privileged-git.ts:122-189`
puts Basic auth in a Project Sandbox child environment:

```ts
const rawUserPass = `x-access-token:${token}`;
// ...
GIT_CONFIG_KEY_0: "http.https://github.com/.extraHeader",
GIT_CONFIG_VALUE_0: header,
```

Do not reuse that credential channel, launcher, command-string API, or Project
Sandbox abstraction. Reuse only its lessons: HTTPS-only protocol, disabled
prompts/helpers/hooks/config/tracing/redirects, exact refs/refspecs, bounded
output, and redaction.

### Dependency and image state

`apps/web/package.json:19-22` currently has Sandbox but no direct Container
package:

```json
"dependencies": {
  "@base-ui/react": "^1.6.0",
  "@cloudflare/sandbox": "0.12.3",
```

Add exact `"@cloudflare/containers": "0.3.7"`; do not move or upgrade Sandbox.
The lock already contains 0.3.7 transitively, so the lock diff should add the
direct importer relationship without changing its resolved version.

The root `.dockerignore` excludes `apps/**` and most of the repo. Do not weaken
it. Use the dedicated Container build context so only the new Dockerfile/helper
enter this image.

## Fixed contracts and limits

Keep these limits as exported constants in
`apps/web/src/lib/trusted-git-executor-policy.ts` and mirror them in the fixed
helper. Tightening later is compatible; widening requires security review and
new deployed evidence.

| Limit | Value |
|---|---:|
| Publication ID UTF-8 | 128 bytes |
| Repository owner/name | 100 bytes each, GitHub-safe characters only |
| Full Session Branch ref | 512 bytes; `refs/heads/` only |
| R2 bundle | 64 MiB compressed |
| Quarantine reachable object bytes | 256 MiB |
| Individual blob | 8 MiB |
| Reachable objects | 100,000 |
| Reachable commits | 1,000 |
| Changed/path records inspected by this protocol gate | 20,000 |
| Git HTTP request or response | 80 MiB each, streamed |
| Git command wall time | 120 seconds, then kill + container destroy |
| Read/write phase grant | 150 seconds absolute maximum |
| Capacity retries before any process starts | 3, exponential bounded backoff |
| Ambiguous write retry after exact-old reconciliation | 1 |
| Combined safe diagnostic | 8 KiB UTF-8 after redaction |
| Structured result | 16 KiB serialized maximum |

This plan's bundle validation is the transport/resource gate, not a substitute
for later semantic publication policy. It must still prove: SHA-1 object format;
self-contained bundle; one exact ref/tip; no extra refs/tags; strict fsck; full
reachable closure; no alternates, replace refs, shallow/promisor state,
submodules, LFS pointer dependency, or hooks/config; proposed commit descends
from expected old when old exists; and all fixed bounds. Reject rather than
truncate repository data.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Root install | `pnpm install --frozen-lockfile` | exit 0; lockfile unchanged after implementation |
| Runner install | `npm ci --prefix packages/sandbox-runner` | exit 0 |
| App typecheck | `npm run typecheck --prefix apps/web` | exit 0 |
| Focused tests | `npm test --prefix apps/web -- --run src/lib/github-app.test.ts src/lib/trusted-git-executor-policy.test.ts src/lib/trusted-git-executor.test.ts src/server.test.ts` | all selected tests pass |
| Biome | `./node_modules/.bin/biome check alchemy.run.ts apps/web/src/server.ts apps/web/src/lib/github-app.ts apps/web/src/lib/trusted-git-executor*.ts` | exit 0 |
| Image build | `docker build --pull=false -t ditto-trusted-git-executor:test containers/trusted-git-executor` | exit 0 |
| Image/helper smoke | `containers/trusted-git-executor/test.sh image ditto-trusted-git-executor:test` | exit 0; exact Git/CA, valid bundle, rejection, and image-content checks pass |
| Full gate | `pnpm verify` | check, typecheck, web tests/build, and runner verification pass |
| Local Alchemy | `pnpm dev` | local graph starts and dedicated Container image builds |
| V2 dry run | `pnpm exec alchemy deploy --stage dev --dry-run` | bounded Website update + one ContainerApplication + one SQLite DO migration; no unrelated replacement |
| V2 deploy | `pnpm exec alchemy deploy --stage dev --yes` | existing graph updated; new binding/application active |
| D1 inventory | `pnpm --filter @ditto/web exec wrangler d1 list --json` | existing `ditto-ayan-db` present; no new D1 database |
| Container inventory | authenticated paginated Containers API metadata projection | exactly existing Sandbox app plus `ditto-git-executor-ayan` |
| Worker metadata | authenticated Worker settings/version metadata projected to names/types/classes only | both `Sandbox` and `TrustedGitExecutor` bindings/classes, no values printed |

Do not use `wrangler deploy` or `wrangler d1 migrations apply`; Alchemy remains
the sole deploy/migration owner. `--containers-rollout=immediate` is a Wrangler
one-off documented option, but this graph expresses immediate rollout through
the exact installed Alchemy resource declaration. If Alchemy's live plan does
not produce an immediate Container rollout, STOP rather than bypassing Alchemy.

## Suggested executor toolkit

- Re-read `cloudflare`, `durable-objects`, `workers-best-practices`,
  `sandbox-migrate-to-next`, `sandbox-next`, `improve`, and `ponytail` before
  implementation. Sandbox skills are boundary guards here: do not migrate or
  use either Sandbox line for the Trusted Git Executor.
- Re-fetch the current Cloudflare pages listed above and inspect exact installed
  declarations before making API changes:
  - `node_modules/alchemy/src/Cloudflare/Containers/Container.ts`
  - `node_modules/alchemy/src/Cloudflare/Containers/ContainerApplication.ts`
  - `node_modules/alchemy/src/Cloudflare/Workers/WorkerAsyncBindings.ts`
  - `node_modules/alchemy/src/Cloudflare/Workers/WorkerProvider.ts`
  - `apps/web/node_modules/@cloudflare/containers/dist/lib/container.d.ts`
  - the latest packed `@cloudflare/workers-types/index.d.ts`
- Use native Web Streams, Web Crypto, R2, Durable Object RPC/SQLite, stock Git,
  and the already-installed Octokit. Add no queue, workflow, ORM table,
  protocol library, shell framework, test framework, or logging dependency.

## Scope

### In scope — the only implementation files to modify/create

- `alchemy.run.ts` — one low-level Container declaration and Website env binding.
- `apps/web/package.json` — exact direct `@cloudflare/containers@0.3.7` only.
- `pnpm-lock.yaml` — direct importer edge only; no resolved package drift.
- `apps/web/src/server.ts` — export `TrustedGitExecutor` and `ContainerProxy`;
  final default fetch behavior otherwise unchanged. A temporary Step-10-only
  authenticated acceptance adapter may exist uncommitted during deployed
  testing but must be removed/redeployed before evidence/DONE.
- `apps/web/src/server.test.ts` — preserve routing tests and new export mocks.
- `apps/web/src/lib/github-app.ts` — exact Contents permission + revoke helper.
- `apps/web/src/lib/github-app.test.ts` — token scope/revoke tests.
- `apps/web/src/lib/trusted-git-executor-policy.ts` — pure identity, input,
  egress request-shape, limits, result, and redaction helpers.
- `apps/web/src/lib/trusted-git-executor-policy.test.ts` — adversarial pure matrix.
- `apps/web/src/lib/trusted-git-executor.ts` — Container subclass, outbound
  handler, narrow RPC, R2 stream, fixed process orchestration, reconciliation,
  revocation, and destruction.
- `apps/web/src/lib/trusted-git-executor.test.ts` — mocked Container/R2/GitHub
  lifecycle, retry, ambiguity, and cleanup tests.
- `containers/trusted-git-executor/Dockerfile` — pinned minimal image.
- `containers/trusted-git-executor/ditto-git-executor` — fixed helper only.
- `containers/trusted-git-executor/test.sh` — runnable local Docker/helper check.

### Planning records maintained in the dirty root checkout, not implementation worktree

- `plans/047-add-ephemeral-trusted-git-executor.md` — append redacted evidence.
- `plans/README.md` — update only Plan 047 row/note/status.

### Generated/temporary artifacts allowed but never committed

- ignored `node_modules/**`, `.alchemy/**`, `.wrangler/**`;
- local Docker image `ditto-trusted-git-executor:test`;
- `/tmp/ditto-047-*` fixtures, bundles, metadata-only inventories, reports, and
  the mode-0600 one-time acceptance secret material;
- disposable R2 objects under a `plan-047-smoke/` prefix, deleted in cleanup;
- one operator-designated disposable GitHub branch, restored/deleted in cleanup.

### Out of scope — do not touch

- `Dockerfile` and `packages/sandbox-runner/**`; the Project Sandbox image/runner
  stays exactly as-is.
- `apps/web/src/lib/privileged-git.ts`, `session-git.ts`,
  `sandbox-bootstrap.ts`, current clone/fetch/push/PR behavior, or their callers.
- D1 schema/migrations and Plan 041 implementation/worktree.
- Any Brain, Workflow, Agent Run, Operation Fence, scheduling/lease, Browser
  Gateway, Files UI, Preview, Git Publication table/orchestrator, Git Import,
  PR, or Sandbox `@next` work.
- Any new Worker, permanent route, public hostname, tunnel, `exposePort`,
  service binding, D1 database, R2 bucket, Queue, KV namespace, persistent
  secret, SSH key, mount, volume, backup, or terminal. The temporary Step-10
  acceptance adapter/binding is the sole exception and must not survive.
- Existing Website name/routes/assets/compatibility/bindings, existing Sandbox
  Container properties, Alchemy/Effect pins, stage, state owner, wildcard DNS,
  or resource names.
- A generic command/process/files/terminal API, caller-provided argv/env/path/
  URL/refspec, helper plugin, configurable shell script, or project source in the
  executor image.
- Plans 042–046. They are neither prerequisites nor products of this plan and
  must not be created.
- `CONTEXT.md`, `.scratch/**`, research docs, or unrelated cleanup/refactors.

## Clean worktree Git workflow

The maintainer's root checkout is dirty and contains pre-existing untracked
plans, scratch files, skill changes, and an independent Plan 041 worktree. Do
not modify or clean any of it except the two planning records maintained by the
advisor/operator.

Create a fresh implementation worktree from the exact planned-at commit:

```bash
set -euo pipefail
cd /home/ayan/ditto
test ! -e /home/ayan/ditto-worktrees/047-add-ephemeral-trusted-git-executor
test -z "$(git branch --list advisor/047-add-ephemeral-trusted-git-executor)"
git worktree add \
  -b advisor/047-add-ephemeral-trusted-git-executor \
  /home/ayan/ditto-worktrees/047-add-ephemeral-trusted-git-executor \
  e3abdee
cd /home/ayan/ditto-worktrees/047-add-ephemeral-trusted-git-executor
test -z "$(git status --short)"
```

If the branch/path already exists, STOP and ask whether to reuse it; never
remove it yourself. Do not copy `.env*`, `.alchemy`, `.wrangler`, untracked
plans, scratch files, or Plan 041 files into the worktree. Read this plan from
`/home/ayan/ditto/plans/047-add-ephemeral-trusted-git-executor.md`; do not copy
it into the implementation worktree. Cloud/GitHub credentials enter only
through the operator's secure environment.

Use Conventional Commits. Suggested logical commits:

1. `feat(git): add trusted executor image and policy`
2. `feat(infra): bind ephemeral git executor`
3. `test(git): verify trusted executor boundaries`

Do not push, open a PR, merge, or modify the maintainer's branch unless the
operator separately requests it.

## Steps

### Step 1: Revalidate exact APIs, pins, and the green baseline

1. Run the drift and clean-worktree checks.
2. Bootstrap locked dependencies and run the current baseline:

   ```bash
   pnpm install --frozen-lockfile
   npm ci --prefix packages/sandbox-runner
   npm run typecheck --prefix apps/web
   npm test --prefix apps/web -- --run \
     src/lib/privileged-git.test.ts \
     src/lib/secret-redaction.test.ts \
     src/server.test.ts
   ```

3. Re-fetch all current Cloudflare/GitHub references in **Current state**.
4. Pack latest Workers and Containers packages into `/tmp`; confirm latest
   Containers is still 0.3.7 and compare its outbound/lifecycle declarations to
   the installed package.
5. Read the exact Alchemy beta.70 files listed in **Suggested executor toolkit**.
   Confirm the second container binding creates a distinct SQLite DO migration,
   accepts `basic`, max 4, and immediate rollout without changing the Sandbox.
6. Re-query Docker Hub/Alpine package metadata without authentication values.
   Confirm the exact base manifest digest and both architecture package versions.
7. Confirm the GitHub OpenAPI operation for revocation is still
   `DELETE /installation/token`, 204.

**Verify**:

```bash
set -euo pipefail
test "$(node -p "require('./node_modules/alchemy/package.json').version")" = "2.0.0-beta.70"
test "$(node -p "require('./apps/web/node_modules/@cloudflare/sandbox/package.json').version")" = "0.12.3"
test "$(node -p "require('./node_modules/.pnpm/@cloudflare+containers@0.3.7/node_modules/@cloudflare/containers/package.json').version")" = "0.3.7"
rg -n 'interceptOutboundHttps|exec\(cmd: string\[\]|destroy\(' /tmp/ditto-047-workers-types*/package/index.d.ts
rg -n 'setOutboundByHost|removeOutboundByHost|ContainerProxy' \
  node_modules/.pnpm/@cloudflare+containers@0.3.7/node_modules/@cloudflare/containers/dist/lib/container.d.ts
rg -n 'rollout\?:|strategy\?: "rolling" \| "immediate"|newSqliteClasses.push' \
  node_modules/alchemy/src/Cloudflare/Containers/ContainerApplication.ts \
  node_modules/alchemy/src/Cloudflare/Workers/WorkerProvider.ts
test -z "$(git status --short)"
```

Expected: baseline green; exact APIs/pins remain available; no working-tree
changes. Any API/pin mismatch is a STOP before implementation.

### Step 2: Build the pinned fixed-helper image

Create the three dedicated image files. The Dockerfile must:

- use the exact Alpine manifest digest and exact Git/CA package versions;
- install no `git-lfs`, SSH, GitHub CLI, Node, Python, Pi, package runner,
  compiler, debugger, terminal server, or project files;
- copy only `ditto-git-executor`;
- run as a non-root numeric user after build;
- expose no port and declare no volume;
- set the helper's fixed idle/hold mode as entrypoint so the container can be
  started without a network listener;
- verify `git version 2.49.1` and CA files during build.

The helper may accept only a closed set of subcommands selected by trusted
Worker code, for example `hold`, `fetch-ref`, `validate-bundle`,
`push-validated`, `ls-remote-ref`, and `scan-canary`. Every subcommand validates
argument count and fixed shapes again. It must never evaluate input, invoke
`sh -c` on caller data, inherit a user Git config, use a repository template,
run hooks, follow redirects, prompt, invoke a credential helper, or print raw
Git output. It may call stock Git with an exact `env -i` and fixed configuration.

`validate-bundle` reads bundle bytes from stdin once, enforces the compressed
cap while writing a mode-0600 temp file, checks digest/size, creates a fresh
mode-0700 quarantine directory, imports exactly the expected ref, validates the
fixed contract/limits, and emits one bounded JSON result. All temp state is
removed by a trap on success, error, and signal. `push-validated` can operate
only on the quarantine created within the same top-level RPC; do not accept a
caller filesystem path or reusable repository.

`test.sh` must create tiny local Git fixtures and prove:

- exact image Git/CA versions and non-root user;
- valid one-ref self-contained SHA-1 bundle passes;
- corrupt digest, malformed bundle, extra ref, non-descendant update, invalid
  full ref, oversize input, symlink/path escape argument, and unknown subcommand
  fail with fixed safe codes;
- no Pi/Node/LFS/SSH/GitHub CLI/project files, listening port, volume, or env
  credential exists;
- helper stdout is valid bounded JSON and stderr contains no fixture canary.

**Verify**:

```bash
set -euo pipefail
docker build --pull=false \
  -t ditto-trusted-git-executor:test \
  containers/trusted-git-executor
containers/trusted-git-executor/test.sh image ditto-trusted-git-executor:test
docker image inspect ditto-trusted-git-executor:test \
  --format '{{json .Config.ExposedPorts}} {{json .Config.Volumes}} {{json .Config.Env}}'
```

Expected: build/smoke exit 0; no exposed ports/volumes; environment contains no
credential or project value. If Git needs an interactive prompt, credential
helper/file, LFS, SSH, project checkout, or general command API, STOP.

### Step 3: Implement pure identity, egress, bounds, and safe-result policy

Create `trusted-git-executor-policy.ts` with no Cloudflare class import so its
security decisions are directly unit-testable.

Implement:

1. strict input validation for publication ID, positive safe epoch,
   installation ID, repository owner/name, R2 key, size/digest, exact SHA-1
   values, expected old-or-absent, proposed SHA, and `refs/heads/...`;
2. asynchronous domain-separated SHA-256 identity derivation, returning a
   lowercase URL-safe fixed-length name with no raw publication/user/repository
   text;
3. exact phase/request classifier for the four allowed smart-HTTP shapes:
   - read discovery: `GET /<owner>/<repo>.git/info/refs?service=git-upload-pack`;
   - read RPC: `POST /<owner>/<repo>.git/git-upload-pack` with exact Git content
     type and no query;
   - write discovery: corresponding `git-receive-pack` GET;
   - write RPC: corresponding receive-pack POST/content type;
4. explicit rejection of request credentials and a code-owned forwarded-header
   allowlist (`accept`, exact content type, `git-protocol`, bounded
   `user-agent`); do not forward cookies, origin, referer, forwarding headers,
   authorization, proxy headers, or arbitrary `x-*`;
5. byte-counting Web Stream wrappers for request/response and a finalizer that
   runs exactly once on normal EOF, upstream error, downstream cancellation, or
   explicit abort;
6. a closed result/error union and redacted UTF-8 byte caps using the existing
   `redactSecrets` boundary.

Required adversarial table tests include uppercase/trailing-dot/lookalike hosts,
userinfo, explicit ports, HTTP/SSH/git schemes, encoded/double slashes, dot
segments, suffix/prefix repository confusion, other repository, other service,
dumb HTTP paths, duplicate/extra query keys, HEAD/PUT/DELETE/PATCH, GET bodies,
POST missing/wrong content type, incoming auth/cookie, redirects, split/oversize
streams, invalid UTF-8 diagnostics, invalid refs/SHA/epochs, and identity
separation across publication/epoch.

**Verify**:

```bash
npm test --prefix apps/web -- --run \
  src/lib/trusted-git-executor-policy.test.ts
```

Expected: every allow row is exact and every adversarial row denies before token
mint/upstream fetch.

### Step 4: Add repository-scoped token mint/revoke without persistence

Extend `github-app.ts` minimally:

- allow `getInstallationAccessToken` to accept exact GitHub App Contents
  permission (`read` or `write`) while preserving all existing callers;
- add `revokeInstallationAccessToken(token)` using a Worker-side GitHub request
  with explicit API version/accept headers; success is exactly 204;
- expose no token in thrown errors, response bodies, logs, return values beyond
  the existing mint function, or test snapshots.

In `github-app.test.ts`, mock Octokit/fetch and prove repository short-name plus
exact permission is sent, revoke uses the installation token only in the
Authorization header, 204 succeeds, every other status fails with one fixed
message, and no error contains token/canary material.

The outbound handler will mint a fresh token **inside each allowed request**
from non-secret handler params. Construct HTTP Basic in Worker memory, forward
with `redirect: "manual"`, reject any 3xx, wrap the response stream, and revoke
before final EOF/cancel. Never pass the token into Container methods, DO
storage, RPC input/output, class fields, R2, helper args/env/stdin, or logs.

**Verify**:

```bash
npm test --prefix apps/web -- --run \
  src/lib/github-app.test.ts \
  src/lib/trusted-git-executor-policy.test.ts \
  -t 'token|permission|revoke|redirect|cancel|credential'
```

Expected: exact scoping and all finalize paths revoke; a revoke failure prevents
operation success.

### Step 5: Implement the narrow Container RPC and fixed orchestration

Create `TrustedGitExecutor extends Container<Env>` with:

- a narrow environment type containing only `BACKUP_BUCKET`,
  `GITHUB_APP_ID`, and `GITHUB_APP_PRIVATE_KEY`; update `github-app.ts` helper
  parameters to accept the corresponding narrow `Pick` so this class never
  imports or types access to `Sandbox`;
- `enableInternet = false`, `interceptHttps = true`, short inactivity expiry,
  exact allowed host, and a static catch-all deny;
- named read/write outbound handlers that accept only validated non-secret
  policy params, deny expired/wrong-container/wrong-phase requests, call the
  Step 3 classifier, and use the Step 4 token lifecycle;
- no overridden public `fetch`, default port, exposed port, terminal, generic
  exec/files/process method, or caller-controlled command surface;
- one narrow `probeRead` RPC for an exact ref and one `validateAndPush` RPC for
  the bounded R2 bundle/exact expected-old/proposed ref contract. Names may
  vary, but responsibilities may not broaden.

`validateAndPush` order is load-bearing:

1. validate all input and derive/assert this publication+epoch identity;
2. set fail-safe expiry/cleanup schedule and prove static deny is active;
3. read R2 metadata/body and begin bounded streaming into the fixed validation
   helper with **no egress phase enabled**;
4. await successful digest, quarantine, fsck, closure, limits, exact-ref/tip,
   and non-force ancestry result;
5. enable only exact write phase with non-secret expiring params;
6. start fixed push argv; record locally that process start occurred as soon as
   `ctx.container.exec` returns a handle;
7. concurrently drain bounded stdout/stderr and enforce timeout; never call
   `output()` after stream consumption;
8. revoke write phase immediately after the process settles;
9. on any post-start uncertainty, enable a fresh read phase and reconcile only
   the exact remote ref; follow the three-state rules above;
10. in one `finally`, restore deny-all, terminate any child, destroy and verify
    the container, clear phase/schedule state, and only then return a safe result.

`probeRead` follows the same phase/finally discipline and returns only exact
remote SHA plus safe counts. It does not export a repository/bundle in this
plan.

Use `ctx.container.exec(argv)` directly with only fixed helper subcommands. Use
R2's `ReadableStream` as process stdin through a counting transform. Keep the
container start environment credential-free and minimal. Do not use
`Container.start({ envVars })` for any repository/token/policy value.

Mocked orchestration tests must prove:

- R2 validation completes before write phase/token mint/process start;
- no token appears in persisted outbound params or any container-facing value;
- exact read/write phase separation and expiry;
- validation rejection causes no network/process write;
- capacity/rate error before process start is the only generic retry class;
- every post-start error reconciles proposed/old/absent/third state correctly;
- only exact old/absence retries once; proposed becomes reconciled success;
- terminal/third state never retries;
- timeout kills child then destroys container;
- normal/error/cancel/cleanup-failure paths all revoke and destroy;
- cleanup failure overrides nominal success;
- result/diagnostic bounds and redaction;
- same publication+epoch cannot execute a second terminal operation; next epoch
  derives a distinct identity.

**Verify**:

```bash
npm test --prefix apps/web -- --run \
  src/lib/trusted-git-executor.test.ts \
  src/lib/trusted-git-executor-policy.test.ts
```

Expected: complete validation/phase/retry/reconciliation/cleanup matrix passes.
If the high-level Container library forces token-bearing runtime params or
cannot revoke interception without a direct-internet fallback, use documented
low-level `ctx.container.interceptOutboundHttp/Https` with a WorkerEntrypoint
whose props remain non-secret. If neither documented path satisfies the
contract, STOP; do not invent an API.

### Step 6: Bind the class and verify the local graph/proxy model

1. Add exact direct `@cloudflare/containers@0.3.7` with pnpm; no other package
   changes.
2. Export `ContainerProxy` and `TrustedGitExecutor` from `server.ts`; keep its
   default fetch logic unchanged.
3. Add the exact Alchemy resource/env binding target shape. Preserve all
   existing Website/Sandbox declarations and bindings.
4. Start local Alchemy. Confirm it builds the dedicated image and emits a
   separate `TrustedGitExecutor` SQLite DO/container binding while the Sandbox
   still uses the root Dockerfile. Inspect binding names/types/classes only;
   generated local config may contain values and must not be printed/committed.
5. Extend the fixed Docker test harness with a synthetic smart-HTTP fixture and
   host-side credential-injecting proxy. Run stock Git from the executor image
   through that proxy and prove:
   - read and one non-force write use only the four expected request shapes;
   - the synthetic credential exists only in the host proxy's upstream request;
   - image `/proc/*/{cmdline,environ}`, temp/home files, helper stdout/stderr,
     and image metadata do not contain the credential-shaped canary;
   - phase removal/expiry denies, redirects deny, and cleanup removes every
     fixture container/network/file.

This local harness validates Ditto's policy/process/image model without claiming
Cloudflare's deployed HTTPS interception or GitHub installation-token behavior.
That platform proof is the first read-only row of Step 10. Do not add a
production/browser route or persist a real credential for local testing.

**Verify**:

```bash
set -euo pipefail
npm run typecheck --prefix apps/web
npm test --prefix apps/web -- --run \
  src/lib/github-app.test.ts \
  src/lib/trusted-git-executor-policy.test.ts \
  src/lib/trusted-git-executor.test.ts \
  src/server.test.ts
containers/trusted-git-executor/test.sh proxy \
  ditto-trusted-git-executor:test
```

Expected: local Alchemy graph/build passes; synthetic stock-Git proxy shapes,
credential-negative scans, revocation model, and cleanup pass. If the image/
fixed helper needs a credential in env/argv/files/process metadata/output/logs,
a broader destination/request allowance, project code, or a terminal/shell API,
STOP. A limitation unique to Cloudflare interception remains a mandatory
Step-10 STOP, never invented local evidence.

### Step 7: Run full local verification and scope/security audits

```bash
set -euo pipefail
pnpm install --frozen-lockfile
npm ci --prefix packages/sandbox-runner
containers/trusted-git-executor/test.sh image ditto-trusted-git-executor:test
containers/trusted-git-executor/test.sh proxy ditto-trusted-git-executor:test
./node_modules/.bin/biome check \
  alchemy.run.ts \
  apps/web/src/server.ts \
  apps/web/src/server.test.ts \
  apps/web/src/lib/github-app.ts \
  apps/web/src/lib/github-app.test.ts \
  apps/web/src/lib/trusted-git-executor-policy.ts \
  apps/web/src/lib/trusted-git-executor-policy.test.ts \
  apps/web/src/lib/trusted-git-executor.ts \
  apps/web/src/lib/trusted-git-executor.test.ts
pnpm verify
git diff --check
```

Run fail-closed source/image guards:

```bash
set -euo pipefail
# Current Project Sandbox Git path is untouched and no production caller exists.
git diff --exit-code e3abdee -- \
  Dockerfile packages/sandbox-runner \
  apps/web/src/lib/privileged-git.ts \
  apps/web/src/lib/session-git.ts \
  apps/web/src/lib/sandbox-bootstrap.ts

# New container source exposes no generic execution/public surface.
! rg -n 'terminal|exposePort|proxyToSandbox|getSandbox|Sandbox\b|Project Sandbox|DITTO_PI|pi-coding|startProcess|execStream|gitCheckout|ssh://|git@github|force-with-lease|--force|--mirror' \
  apps/web/src/lib/trusted-git-executor*.ts \
  containers/trusted-git-executor

# No credential channel exists in the image/helper. Worker-side injection is
# reviewed and tested separately because it legitimately handles the token.
! rg -n 'Authorization|extraHeader|askpass|gh[pousr]_|x-access-token' \
  containers/trusted-git-executor

# Exact resource and package shape.
rg -n 'TrustedGitExecutor|ditto-git-executor-ayan|instanceType: "basic"|maxInstances: 4|strategy: "immediate"' alchemy.run.ts
node --input-type=module <<'NODE'
import fs from "node:fs";
const web = JSON.parse(fs.readFileSync("apps/web/package.json", "utf8"));
if (web.dependencies["@cloudflare/containers"] !== "0.3.7") throw new Error("container pin drift");
if (web.dependencies["@cloudflare/sandbox"] !== "0.12.3") throw new Error("sandbox drift");
NODE
```

Manually review every grep match without printing values. Expected: all gates
pass; only in-scope files changed; no current caller/cutover; no generic or
credential-bearing container channel.

At this point the implementation may be committed and recorded as DONE-local
if every local graph, synthetic stock-Git proxy, image/helper, unit/integration,
and full-repository gate passed. This status makes no claim about deployed
Cloudflare HTTPS interception, real GitHub credentials, or remote mutation;
those remain mandatory in Steps 8–10 for full DONE.

### Step 8: Preflight deployed graph, paid capacity, migration, and drain

This is the full-DONE boundary. It is not permission to create Plan 039's cloud
graph.

1. Confirm Plan 039's separately refreshed cloud cutover is recorded as passed,
   Alchemy stage `dev` state already owns the deployed graph, and secure
   Cloudflare/GitHub credentials are available without printing them.
2. Project metadata-only inventory to mode-0600 `/tmp/ditto-047-*` files. Assert
   exactly one existing D1/R2/Website/Sandbox graph with the Plan 039 names and
   no existing `TrustedGitExecutor` class/application on first deploy.
3. Confirm Workers Paid Containers and capacity for four `basic` instances.
4. Prove current source has no production caller/admission path for
   `TrustedGitExecutor`; therefore initial admission is drained by construction.
   If a caller landed since planning, require its authoritative admission-close
   and zero-nonterminal query plus zero running executor inventory. If that
   query does not exist or is not trustworthy, STOP.
5. Run Alchemy dry run. It may add only:
   - direct package/bundle code already reviewed;
   - binding/class `TrustedGitExecutor`;
   - its distinct `new_sqlite_classes` migration;
   - ContainerApplication `ditto-git-executor-ayan`, basic, max 4, immediate;
   - the corresponding Website Worker update.
6. It must not replace/reconfigure Sandbox, D1, R2, routes, assets, or other
   bindings; add a D1 migration/database; show adoption; use gradual Worker or
   Container rollout; or reveal binding values.

**Verify**:

```bash
set -euo pipefail
pnpm exec alchemy deploy --stage dev --dry-run \
  | tee /tmp/ditto-047-plan.txt
# Review sanitized operation metadata before any deploy.
```

Expected: existing graph converged plus one exact resource/binding/migration.
Absent cloud graph/capacity/authorization becomes DONE-local at this boundary.
Any present-but-wrong plan is BLOCKED.

### Step 9: Deploy with immediate rollout and prove resource/migration shape

Deploy only after Step 8 passes:

```bash
pnpm exec alchemy deploy --stage dev --yes \
  | tee /tmp/ditto-047-deploy.txt
```

Treat raw output as potentially secret-bearing; do not paste it into evidence.
Using metadata-only API projections, prove:

- Website remains `ditto-website-ayan` with existing routes/assets/settings;
- existing `Sandbox` DO/container binding remains class `Sandbox` and app
  `ditto-sandbox-ayan` with prior shape;
- exactly one new DO binding/class `TrustedGitExecutor` exists and its first
  migration is SQLite, distinct from `Sandbox`;
- exactly one `ditto-git-executor-ayan` application exists with `basic`, max 4,
  scale-to-zero, dedicated image digest, no env/secrets, ports, SSH keys, public
  route, volume/mount, or Project Sandbox reference;
- rollout strategy completed immediate with no old executor image instance;
- D1/R2 resources were not recreated and a converged Alchemy dry run reports
  `Plan: no changes`.

If the provider/API metadata label differs, inspect only names/types/classes/
non-secret application configuration and STOP to refresh the assertion; never
weaken it or print values.

**Verify**: all metadata assertions and final dry run pass. Requests remain
unadmitted until Step 10 acceptance begins.

### Step 10: Run mandatory deployed Container/GitHub acceptance

Use only an operator-designated installation-accessible disposable repository
and branch. Record immutable repository ID separately from current owner/name,
the original exact branch state, and cleanup instructions without credentials.
Never use a default/protected/shared branch.

Before the matrix, create a one-time random acceptance token outside the repo
under mode 0600. Temporarily add one redacted
`TRUSTED_GIT_ACCEPTANCE_TOKEN` Website binding and one exact POST-only Worker
adapter at `/__ditto/acceptance/trusted-git-executor`. The adapter must:

- compare the bearer token in constant time, accept a strict bounded schema,
  call only the narrow executor RPCs/code-owned denial probes, and return only
  the safe result union;
- return 404 when the temporary binding is absent; have no GET/CORS/browser
  behavior; never proxy `fetch` to a container port or accept command/URL/argv;
- exist only in the uncommitted deployment worktree while Git admission is
  closed. It is an acceptance control plane, not a public Container route.

Deploy that temporary adapter through Alchemy, run the matrix with a fixed
operator script that reads the token from secure stdin/file (never command
argv), then in `finally` remove the adapter and binding, redeploy the reviewed
source, delete the local token material, and prove the route returns ordinary
404. Failure to remove/redeploy blocks DONE even if every Git check passed.

Run this matrix through that fixed authenticated adapter:

1. **Read-only platform prototype (mandatory before any write)**: new
   publication+epoch identity; exact upload-pack fetch of one disposable ref;
   correct SHA/count result; ephemeral Cloudflare CA trusted; token scope read;
   response finalizer revoke succeeds; phase removed; container destroyed; and
   credential/canary scans are negative. STOP before creating/uploading a write
   bundle if this row fails or egress must widen.
2. **Real non-force write**: create a small synthetic descendant commit and
   self-contained one-ref bundle; upload it under `plan-047-smoke/`; executor
   streams/validates it before any write grant; receive-pack advances exactly
   the disposable ref from expected old to proposed SHA without force; result
   reports revocation/destruction; independently read the exact remote ref.
3. **Destination/request denial**: deployed probes deny before token mint for
   another host, host lookalike/trailing dot, IP, HTTP, explicit port, another
   repository, path prefix/suffix confusion, upload-pack in write phase,
   receive-pack in read phase, dumb object path, extra query, wrong method,
   wrong/missing content type, incoming auth/cookie, and redirect response.
4. **Phase revocation**: while the container remains alive inside the controlled
   probe, remove read/write host override and repeat the formerly valid request;
   it must hit static deny. After expiry it must also deny. No allowed-host
   direct fallback is accepted.
5. **Canary-negative evidence**: fixed scans show synthetic credential-shaped
   canaries and real tokens absent from process argv/env, `/proc` metadata,
   temp/home/quarantine files, helper output, returned diagnostics, R2 metadata,
   and projected Worker/Container logs. Do not print scan contents.
6. **Bounds**: malformed digest/bundle, extra ref, non-descendant update,
   oversize compressed body, object/blob/commit/path limits, timeout, and output
   flood all fail safely before write and still destroy.
7. **Capacity**: a controlled max-4 exercise proves the fifth concurrent start
   is refused/queued without a Git process or token; only the documented
   pre-process capacity result is retryable. Do not consume unrelated account
   capacity or relax maxInstances.
8. **Write ambiguity**: mocked/fault-injected deployed transport loss after
   receive-pack start must reconcile only the exact ref. Proposed returns
   reconciled success; exact old permits one retry; third state interrupts. The
   fault hook must be code-owned, unavailable to production inputs, and removed
   or compiled out after acceptance; if that cannot be guaranteed, keep this
   case in deterministic integration tests and record why no deployed fault was
   introduced. Never weaken the real exact-ref checks.
9. **Replacement**: complete epoch N, prove its container gone and terminal
   identity refuses reuse; epoch N+1 derives a different DO/container, performs
   read, and is also destroyed. Inventory shows no running executor afterward.
10. **Cleanup**: delete the R2 smoke object and restore/delete the disposable
    branch. Independently verify exact cleanup. Remove the temporary acceptance
    adapter/binding, redeploy the final source, prove the endpoint is 404 and no
    acceptance secret binding exists, then reopen admission. Any cleanup or
    adapter-removal uncertainty blocks DONE.

Acceptance output is one redacted machine-readable report containing test IDs,
release Git SHA, lock hash, image digest, Worker version/config, non-secret
repository ID/ref/SHAs, safe counts, and PASS/FAIL booleans. It contains no token,
headers, Git packet/object/body, path/commit text, cookies, env values, process
contents, or raw logs.

**Verify**:

```bash
set -euo pipefail
pnpm exec alchemy deploy --stage dev --dry-run \
  | tee /tmp/ditto-047-final-plan.txt
grep -F 'Plan: no changes' /tmp/ditto-047-final-plan.txt
pnpm verify
git diff --check
git status --short
```

Expected: every deployed row passes, remote/R2 cleanup is exact, no executor
container remains, the temporary adapter/secret binding is absent, graph
converges on the final reviewed source, and local verification stays green.

### Step 11: Record redacted evidence and status

Append an **Execution evidence** section to this plan in the dirty root planning
checkout (or report it to the advisor/operator if they maintain records). Include
only:

- date, executor, implementation branch/worktree/commit;
- exact Alchemy, Containers, Workers-types, Sandbox, Alpine, Git, and CA versions;
- base/image digest and release lock hash;
- changed-file list;
- local baseline, pure adversarial, token/revoke, helper/image, orchestration,
  typecheck, focused, full-gate, local synthetic proxy, and deployed read-only
  stock-Git platform prototype PASS/FAIL;
- cloud preflight and first unmet cloud gate;
- metadata-only class/migration/application/rollout assertions;
- deployed acceptance test IDs with safe counts/SHAs/booleans;
- exact first failed/unrun gate and accurate status.

Status rules:

- `DONE`: every local gate, deployed read-only stock-Git prototype, Steps 8–10 deployment, real
  fetch/non-force push, denial, canary, revocation, capacity, bounds,
  replacement, cleanup, and convergence check passed.
- `DONE-local (BLOCKED for full DONE: deployed Container/GitHub acceptance unavailable)`:
  every local graph/synthetic-proxy gate passed, but Plan 039's
  accepted deployed graph, paid Containers, secure authorization, or disposable
  fixture was absent. No dependent production Git work may claim deployed proof.
- `BLOCKED (<first failed gate>)`: API/platform-prototype/security/local invariant fails,
  or a present deployed migration/Container/GitHub/cleanup check fails.

Do not update Plan 041 or any other status. Do not create Plans 042–046.

## Test plan

### Pure policy tests

`apps/web/src/lib/trusted-git-executor-policy.test.ts`:

- identity domain separation, stability, bounds, and epoch freshness;
- exact repository/full-ref/SHA/R2 input validation;
- complete read/write smart-HTTP allow matrix;
- adversarial host/scheme/port/method/path/query/repository/service/header/body
  denial before mint/fetch;
- streaming byte caps and finalize-on-EOF/error/cancel once;
- safe result/diagnostic redaction and UTF-8 caps.

### GitHub credential tests

`apps/web/src/lib/github-app.test.ts`:

- existing callers remain compatible;
- repository short name and exact Contents read/write permission;
- fresh mint per allowed request;
- Basic auth built only in Worker request memory;
- manual redirect rejection;
- revoke 204 on EOF/error/cancel and fixed failure otherwise;
- no token/canary in errors or snapshots.

### Container orchestration tests

`apps/web/src/lib/trusted-git-executor.test.ts` with a minimal mock of
`ctx.container`, R2, and GitHub fetch:

- validate-before-write ordering;
- non-secret persisted phase params and expiry;
- exact fixed argv/env/stdin, no generic process API;
- read/write revocation and static deny fallback;
- capacity-before-start retries only;
- post-start exact-ref reconciliation matrix and one safe retry;
- timeout/output bounds;
- every terminal destruction/cleanup path and cleanup-failure precedence;
- terminal identity reuse denial and next-epoch replacement.

### Image/helper tests

`containers/trusted-git-executor/test.sh`:

- pinned base/Git/CA/non-root/no-port/no-volume/no-project-runtime;
- valid one-ref self-contained bundle;
- malformed/digest/ref/ancestry/extra-ref/resource rejection;
- fixed JSON output and canary-negative filesystem/process scan.

### Regression tests

- `apps/web/src/server.test.ts` — Website/default preview routing unchanged while
  class/proxy exports exist;
- current privileged Git and secret-redaction tests remain green;
- full `pnpm verify` proves app/runner/build unchanged outside the new boundary.

### Deployed acceptance

Real exact-ref fetch and non-force push, adversarial deny matrix, token revoke,
phase revoke, synthetic canary-negative scans, malformed/resource limits,
max-4 capacity behavior, terminal cleanup, epoch replacement, R2/remote cleanup,
immediate rollout, migration/binding/resource metadata, and final convergence.

## Done criteria

ALL local criteria must hold; cloud criteria are additionally mandatory for full
DONE:

- [ ] Only the exact in-scope files changed; current Project Sandbox Git/runtime
      paths and Plan 041 are untouched.
- [ ] Web directly pins `@cloudflare/containers@0.3.7`; Sandbox remains 0.12.3
      and no unrelated lock resolution moves.
- [ ] Alchemy adds only binding/class `TrustedGitExecutor`, physical app
      `ditto-git-executor-ayan`, basic, max 4, immediate rollout, and a distinct
      SQLite DO migration; existing graph stays unchanged.
- [ ] Dedicated pinned image contains exact Git/CA/fixed helper only, no Pi,
      project checkout/mount, public/listening port, credentials, or terminal API.
- [ ] Publication ID + positive epoch derive one deterministic fresh identity;
      terminal identity cannot be reused and next epoch differs.
- [ ] Container starts with no credential/repository/project env and exposes no
      generic command, argv, env, file, process, shell, terminal, or fetch API.
- [ ] HTTPS interception is deny-all by default; static deny prevents the
      allowed-host fallback; only exact GitHub repository smart-HTTP shapes pass.
- [ ] Runtime outbound params contain no token; fresh exact-permission token is
      Worker-minted per allowed request and revoked before stream completion.
- [ ] R2 bundle streams into a fresh bare quarantine and passes digest,
      self-contained one-ref/tip, strict fsck, closure, ancestry, and all fixed
      bounds before write phase.
- [ ] Push is exact non-force; capacity retries only before process start;
      post-start ambiguity reconciles exact remote ref before at most one retry.
- [ ] Every terminal path revokes phase, terminates children, destroys/proves
      container absence, clears phase state, and treats cleanup failure as failure.
- [ ] Results are structured/bounded/redacted and contain no raw Git/process/
      repository/credential diagnostic material.
- [ ] Pure, credential, orchestration, image/helper, regression, typecheck,
      Biome, `pnpm verify`, and `git diff --check` gates pass.
- [ ] Local synthetic smart-HTTP stock Git fetch/non-force push pass through the
      test proxy with credential/canary-negative scans. Required for DONE-local.
- [ ] Existing deployed Alchemy v2 graph and paid Container capacity were
      preflighted without this plan creating Plan 039 infrastructure.
- [ ] Deployed class/migration/application/image/immediate-rollout metadata is
      exact and converged.
- [ ] Deployed real fetch and non-force push, adversarial denial, token/phase
      revocation, canary scans, resource/capacity limits, cleanup, replacement,
      R2/remote cleanup, and no-running-container checks all pass. Temporary
      acceptance route/binding are removed and redeployed; endpoint is 404.
      Required for DONE.
- [ ] Redacted evidence and only Plan 047's README status are updated accurately.

## STOP conditions

Stop and report — do not improvise — if:

- Plan 039's accepted Alchemy v2 source graph drifted, or full cloud work would
  require this plan to create/adopt/recreate its deferred D1/R2/Website/Sandbox
  resources.
- Installed/current Alchemy cannot bind a second low-level Container to Website,
  emit a distinct SQLite DO migration, configure basic/max4/immediate, or keep
  existing Sandbox unchanged.
- Current documented/installed Container APIs cannot intercept **all** HTTP and
  HTTPS deny-first, update/revoke a phase on open connections, stream stdin,
  bound output, kill/destroy, or prove stopped state.
- Stock Git cannot fetch/push through HTTPS interception while the credential is
  absent from container env, argv, files, process metadata, output, and logs.
- HTTPS interception requires trusting anything beyond the ephemeral Cloudflare
  CA plus pinned system CA, or Git requires disabled TLS verification.
- Any token/Basic value must enter outbound handler params, DO SQLite, RPC,
  Container start/exec env, argv, URL, stdin, file, R2, helper output, logs, or
  returned diagnostics.
- Token revocation cannot be made part of stream completion/cancellation, or a
  revoke failure could still report Git success.
- Exact egress requires allowing another host, wildcard, IP, scheme, port,
  redirect, repository, Git service, request shape, or allowed-host direct
  fallback.
- The executor needs project code, a Project Sandbox binding/handle/mount,
  backup restore, Pi/runner package, LFS, SSH, GitHub CLI, terminal, direct or
  permanent public route, listening port, arbitrary process/command/argv/env/
  path, or caller shell API.
- R2 input cannot be streamed and bounded before disk, or validation requires a
  non-fresh repository, alternates, promisor/lazy objects, extra refs, or
  incomplete strict fsck/reachability.
- A force/delete/wildcard push, caller destination/refspec, or third remote state
  is required; or any post-start write retry would occur without exact-ref
  reconciliation.
- Capacity/rate failure cannot be distinguished before Git process start, or a
  generic retry wrapper appears.
- Any terminal path can return before phase revocation, child termination,
  container destruction proof, and cleanup; or interrupted ownership leaves an
  unbounded egress grant.
- Image base/package pin or digest differs/unavailable, a floating install is
  required, or image contents cannot be audited to the fixed helper surface.
- Initial/subsequent deployment cannot prove Git admission drained, proposes a
  gradual/mixed rollout or nonzero grace, or leaves an old executor image active.
- A permanent public/browser route, new infrastructure product, D1 schema
  migration, current Git cutover, or out-of-scope file is needed to make tests
  pass. The temporary Step-10 acceptance adapter is the only route exception and
  must be removed/redeployed before DONE.
- A required local verification fails twice after one reasonable in-scope fix.
- Deployed graph/capacity/authorization/fixture is absent: record DONE-local only
  after all local graph/synthetic-proxy gates pass; do not invent cloud evidence.
- A present deployed migration, real Git, denial, canary, revocation, bounds,
  capacity, replacement, cleanup, or convergence check fails: mark BLOCKED.
- Evidence would expose secret/env/header/body/object/process/log contents.

## Maintenance notes

- `@cloudflare/containers@0.3.7` persists runtime outbound params. Future package
  upgrades must re-audit that implementation before deployment; never assume
  secrets stay in memory because the TypeScript signature says `params`.
- The image and Git/CA pins are deliberate. Refresh them only with a separate
  supply-chain/security review plus full local/deployed proxy, canary, and
  replacement evidence.
- This plan creates a transport/validation primitive, not Git Publication or
  Git Import authority. Future callers must provide durable authorization and
  admission/drain truth; they must not weaken this executor or make its DO
  SQLite authoritative for publication state.
- Reviewers should scrutinize request-shape classification, allowed-host fallback,
  token finalization/revocation, validation-before-write ordering, process-start
  retry classification, exact-ref reconciliation, and cleanup proof more than
  naming or formatting.
- Plan 041 may execute in parallel in its independent worktree. Plans 042–046
  remain absent and are not prerequisites.
