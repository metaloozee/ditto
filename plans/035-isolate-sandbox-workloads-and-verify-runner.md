# Plan 035: Isolate sandbox workloads and verify the runner before credentials

> **Executor instructions**: This is a feasibility-gated security plan. Run Step
> 1 before editing production code. If the pinned Sandbox control plane is
> reachable from a dropped workload or another STOP condition occurs, stop, mark
> the plan BLOCKED, and report the evidence; do not ship a cosmetic UID drop.
> If the gate passes, follow every step and verification exactly. Never weaken
> integrity checks, place secrets in argv/files readable by unrelated identities,
> add `USER` blindly to the Dockerfile, or claim process isolation that tests do
> not prove.
>
> **Drift check (run first)**:
> `git diff --stat b783dec..HEAD -- Dockerfile .github/workflows/ci.yml apps/web/src/lib/sandbox-bootstrap.ts apps/web/src/lib/project-sandbox.ts apps/web/src/lib/agent-run.ts apps/web/src/lib/agent-control-service.ts apps/web/src/lib/provider-auth-service.ts apps/web/src/lib/session-git-metadata.ts apps/web/src/lib/session-preview.ts apps/web/src/lib/session-git.ts apps/web/src/lib/session-worktree.ts apps/web/src/lib/git-secret-policy.ts packages/sandbox-runner/src/run-agent.ts packages/sandbox-runner/src/runner-model.ts docs/architecture/security.md docs/architecture/server-and-data.md docs/architecture/agent-harness.md plans/035-isolate-sandbox-workloads-and-verify-runner.md plans/README.md`
> Plans 032–034 must be DONE and landed first. Their Git, delivery, bootstrap,
> and documentation edits are expected drift; re-read those live files in full.
> Record `git status --short` and preserve all initial out-of-scope entries.
> If landed Plan 032 uses a different privileged-Git process boundary than its
> plan, or any runner path/credential handoff changed semantically, STOP and
> refine this plan before implementation.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plans 032, 033, and 034 (all must be DONE)
- **Category**: security
- **Requirements**: SANDBOX-2 and SANDBOX-3 from the approved platform-hardening specification
- **Planned at**: commit `b783dec`, 2026-07-29

## Why this matters

The Sandbox control plane and all repository/runner commands currently execute
under the image's default identity. Dependency lifecycle scripts, preview
servers, local Git hooks, and the PI bash/edit/write tools therefore share the
same privilege level as the files under `/opt/ditto-runner`. Runner health only
checks one file's existence and parses `package.json`, while several
credential-bearing entrypoints bypass project health entirely.

A naive Docker `USER` is not an acceptable fix. `@cloudflare/sandbox@0.12.3`
has no per-command user option, and the upstream control plane performs
root-required startup/FUSE work. Upstream issue #677 states that Docker `USER`
also drops the control plane and can break certificate setup and other privileged
initialization: <https://github.com/cloudflare/sandbox-sdk/issues/677>.

This plan therefore proceeds only if a root control plane can be proven
unreachable to the dropped workload. If that gate passes, code-owned launchers
run repository workloads under one fixed non-root identity, keep trusted runner
artifacts root-owned/read-only, normalize `/workspace` after SDK clone/restore,
and verify a build-pinned complete artifact manifest before any credential can
reach a runner process. Integrity failure destroys the sandbox and uses existing
project restore/recreate behavior rather than running suspect code.

## Current state

The approved source is
`docs/superpowers/specs/2026-07-26-platform-hardening-design.md`, Workstream 3:

- SANDBOX-2: repository installs, previews, tests, and agent tools run as a
  dedicated unprivileged user; `/opt/ditto-runner` is trusted and non-writable;
  only workspace and required runtime directories are writable.
- SANDBOX-3: all expected runner artifacts, ownership, modes, and build-pinned
  integrity are verified before agent/control/provider/catalog/Git-metadata
  invocation; mismatch fences credentials and forces trusted-image recovery.

### Platform constraint

The installed SDK declarations expose `timeout`, `env`, `cwd`, encoding,
streaming, and signal fields, but no UID/GID/user field:

- `node_modules/.pnpm/@cloudflare+sandbox@0.12.3/node_modules/@cloudflare/sandbox/dist/sandbox-BhIQBik-.d.ts:358-406` (`ExecOptions`)
- the same file at `513-538` (`ProcessOptions`)
- the same file at `664-690` (`SessionOptions`)

`Dockerfile:1-32` has no `USER`; the inherited Sandbox entrypoint and every
spawned command therefore use the base identity. Keep the control plane's
privileged startup behavior unless Step 1 proves a reviewed native alternative.

### Trusted tree and health are incomplete

`Dockerfile:3-27` copies the package as root but does not explicitly remove all
group/world write permissions or create a complete integrity manifest. Its build
checks omit `dist/control-cli.js`; chmod/symlink coverage also omits Git metadata.

`apps/web/src/lib/sandbox-bootstrap.ts:455-465` currently checks only:

```ts
test -f /opt/ditto-runner/dist/cli.js &&
node -e 'JSON.parse(readFileSync("/opt/ditto-runner/package.json"))'
```

That does not verify complete artifact presence, content, ownership, mode,
symlinks, dependencies, or unexpected files.

### Secret-bearing and unchecked paths

The exact Worker-invoked entries are:

| Role | Current Worker constant/invocation |
|---|---|
| Agent | `agent-run.ts:22,278` → `dist/cli.js` |
| Agent control | `agent-control-service.ts:11,228` → `dist/control-cli.js` |
| Provider login/refresh | `provider-auth-service.ts:35,776,1051` → `dist/provider-auth-cli.js` |
| Provider control | `provider-auth-service.ts:36,457` → `dist/provider-auth-control-cli.js` |
| Provider catalog | `provider-auth-service.ts:37,321` → `dist/provider-catalog-cli.js` |
| Git metadata | `session-git-metadata.ts:16,751` → `dist/git-metadata-cli.js` |

Agent preparation provisions a project first, but the credential JSON, callback
capability, and arbitrary project environment are spread into
`createSession({ env })` at `agent-run.ts:99-108` before the runner starts.
Arbitrary project keys can therefore influence a trusted/root child startup
through runtime-sensitive environment names.

Provider catalog/auth/control/refresh create temporary sandboxes and call their
entries directly at `provider-auth-service.ts:303-370`, `449-479`, `751-824`, and
`1039-1100`. OAuth refresh puts the stored credential in session env before any
health check. Git metadata puts the operator fallback credential in session env
at `session-git-metadata.ts:739-752`. Agent control checks D1 readiness but not
the complete runner at `agent-control-service.ts:191-229`.

### Repository-controlled execution that must lose privilege

- Dependency managers and lifecycle scripts: `sandbox-bootstrap.ts:369-439`.
- Agent runner and PI general-purpose tools: `agent-run.ts:255-280` and
  `packages/sandbox-runner/src/run-agent.ts:88-110`.
- Preview dev process: `session-preview.ts:1032-1037`.
- Repository-local Git/status/worktree/preflight/commit/merge commands:
  `sandbox-bootstrap.ts`, `session-worktree.ts`, `session-git.ts`,
  `git-secret-policy.ts`, and `session-git-metadata.ts`.
- SDK clone and restore are root control-plane operations. They can create
  root-owned workspace content and must be followed immediately by safe,
  non-symlink-following ownership normalization before any repository command.

### Security claim boundary

This plan creates a root-vs-workload privilege/file boundary. It does **not**
claim confidentiality between two processes intentionally running under the same
workload UID. Project environment remains visible to the agent by product design.
Plan 032's credential-bearing privileged Git network process must remain in a
trusted identity/lane inaccessible to the workload UID. If that cannot be
proven, this plan must stop.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install app | `pnpm install --frozen-lockfile` | exit 0; root lock unchanged |
| Install runner | `pnpm runner:install` | exit 0; runner lock unchanged |
| Focused web tests | `pnpm --filter @ditto/web exec vitest run src/lib/sandbox-workload.test.ts src/lib/sandbox-bootstrap.test.ts src/lib/project-sandbox.test.ts src/lib/agent-run.test.ts src/lib/agent-control-service.test.ts src/lib/provider-auth-service.test.ts src/lib/session-git-metadata.test.ts src/lib/session-preview.test.ts src/lib/session-worktree.test.ts src/lib/session-git.test.ts src/lib/git-secret-policy.test.ts` | all pass |
| Focused runner tests | `npm exec --prefix packages/sandbox-runner -- vitest run src/run-agent.test.ts src/runner-model.test.ts` | all pass; planning-time baseline 2 files / 12 tests |
| Full gate | `pnpm verify` | exit 0, subject only to a precisely recorded landed baseline |
| Image build | `docker build -t ditto-plan-035 .` | exit 0 |
| Image smoke | `scripts/verify-sandbox-image.sh ditto-plan-035` | exit 0; all UID/integrity/write tests pass |
| Diff hygiene | `git diff --check` | no output |
| Scope audit | `git status --short` | initial entries plus intended in-scope changes only |

Do not deploy or use provider/GitHub credentials without explicit operator
authorization. Do not run broad format/fix commands.

## Suggested executor toolkit

- Use the `sandbox-sdk` and `workers-best-practices` skills if available.
- Read the current Sandbox command/session/lifecycle/backup docs before edits:
  - <https://developers.cloudflare.com/sandbox/api/commands/>
  - <https://developers.cloudflare.com/sandbox/api/sessions/>
  - <https://developers.cloudflare.com/sandbox/concepts/sandboxes/>
  - <https://developers.cloudflare.com/sandbox/guides/backup-restore/>
- Read upstream issue #677 before choosing identity mechanics. Repository code is
  pinned to SDK/image 0.12.3; do not assume a newer API without type evidence.

## Scope

Because this boundary cuts across every way untrusted repository code executes,
the following are the only implementation/docs files that may change after Step
1 passes:

**Image, launch gate, and CI**

- `Dockerfile`
- `scripts/verify-sandbox-image.sh` (create)
- `.github/workflows/ci.yml`
- `plans/evidence/035-sandbox-capability.md` (create in Step 1; evidence only)

**Shared workload/integrity boundary**

- `apps/web/src/lib/sandbox-workload.ts` (create)
- `apps/web/src/lib/sandbox-workload.test.ts` (create)
- `apps/web/src/lib/sandbox-bootstrap.ts`
- `apps/web/src/lib/sandbox-bootstrap.test.ts`
- `apps/web/src/lib/project-sandbox.ts`
- `apps/web/src/lib/project-sandbox.test.ts`

**Repository command/runner call sites and their existing tests**

- `apps/web/src/lib/agent-run.ts` and `.test.ts`
- `apps/web/src/lib/agent-control-service.ts` and `.test.ts`
- `apps/web/src/lib/provider-auth-service.ts` and `.test.ts`
- `apps/web/src/lib/session-git-metadata.ts` and `.test.ts`
- `apps/web/src/lib/session-preview.ts` and `.test.ts`
- `apps/web/src/lib/session-worktree.ts` and `.test.ts`
- `apps/web/src/lib/session-git.ts` and `.test.ts`
- `apps/web/src/lib/git-secret-policy.ts` and `.test.ts`
- `apps/web/src/lib/privileged-git.ts` and `.test.ts` if created by landed Plan
  032 — only to preserve its trusted credential lane and normalize ownership;
  do not redesign its Git policy.
- `packages/sandbox-runner/src/agent-job.ts` and `.test.ts`
- `packages/sandbox-runner/src/run-agent.ts` and `.test.ts`
- `packages/sandbox-runner/src/runner-model.ts` and `.test.ts`

**Documentation/index**

- `docs/architecture/security.md`
- `docs/architecture/server-and-data.md`
- `docs/architecture/agent-harness.md`
- `plans/README.md` status only after execution

**Read-only/out of scope**

- D1 schema/migrations and project lifecycle fields; Plan 034 supplies stable
  ownership/recovery.
- Runner entrypoint package-manifest centralization and provision-success
  deduplication; those belong to Plan 036.
- SDK/image version upgrades, npm dependency additions, Queues/Workflows/DOs,
  per-run UID allocation, seccomp/AppArmor design, and preview-domain policy.
- Public terminal/task-console features or removal of the agent's requested bash
  tool.
- Cryptographic key/credential lifecycle changes.
- The approved umbrella spec.

If implementation requires another production command site, add it only after a
reviewer confirms it is the same workload boundary; otherwise STOP for plan
refinement.

## Git workflow

- Branch: `advisor/035-sandbox-workload-runner-integrity`
- Start from landed Plan 034.
- Suggested commits:
  1. `test(sandbox): prove workload isolation capability`
  2. `fix(sandbox): drop repository workload privileges`
  3. `fix(sandbox): verify runner before credentials`
  4. `ci(sandbox): smoke image trust boundary`
- Do not push, open a PR, merge, deploy, or use live credentials unless the
  operator explicitly authorizes the deployed acceptance smoke.

## Target design (only after Step 1 passes)

### A. Identity and control-plane boundary

- Keep the Sandbox control plane at the identity required by the pinned image;
  do not add a global Docker `USER`.
- Use workload UID/GID **10001:10001**, account/group name
  `ditto-workload`, home `/home/ditto-workload`, cache
  `/home/ditto-workload/.cache`, and private runtime root
  `/tmp/ditto-workload` (0700, 10001:10001). These values are the image/Worker/
  CI contract; do not auto-select IDs. The account has no password, sudo,
  supplementary privileged groups, or write access to trusted paths.
- Bake the root-owned launcher at the exact path
  `/usr/local/bin/ditto-workload-exec` and the runner launch gate at
  `/usr/local/bin/ditto-runner-launch`. The workload launcher accepts exactly one
  command payload,
  sets fixed `HOME`/`USER`/`LOGNAME`/safe base `PATH` and umask, then uses the
  image's verified `setpriv` with fixed numeric IDs, cleared groups, no-new-
  privileges, and cleared capabilities before `exec`.
- The Worker's `sandbox-workload.ts` only quotes/builds calls to that fixed
  launcher. It is not a general identity/configuration abstraction. The exact
  execution model is:
  - `createSession()` remains a trusted control-plane/root session and receives
    only code-owned variables; arbitrary project keys never enter it;
  - `exec()` and `execStream()` receive
    `/usr/local/bin/ditto-workload-exec <one shell-quoted command payload>`;
  - `startProcess()` receives the same launcher-prefixed command while retaining
    the existing cwd/env/processId/autoCleanup options;
  - SDK file APIs remain trusted control-plane operations, but every generated
    directory/file crossing to workload is assigned explicit 0700/0600 ownership;
  - landed Plan-032's one credential-bearing isolated network Git launch is the
    sole root/trusted exception, uses a root-owned 0700 temp directory, and may
    expose no env/path to UID 10001. Its non-credential repository/object work
    uses the workload launcher.
- A dropped workload must be unable to call the root HTTP, WebSocket, or RPC
  control plane. This is an acceptance condition, not an assumption.

### B. Workspace ownership and untrusted command routing

- SDK clone/restore and exact `/workspace` clearing remain trusted maintenance
  operations. Immediately after clone and restore, normalize `/workspace`
  ownership without following repository symlinks, clear setuid/setgid bits,
  and verify the root plus representative files are owned/writable by the fixed
  workload identity.
- All repository-context Git, package-manager/lifecycle, preview, test, and
  metadata snapshot commands use the workload launcher. Remove runtime
  `corepack enable`; the image must bake working package-manager shims because a
  workload may not mutate `/usr/local/bin`.
- PI's Node runner starts through the launcher, so built-in bash/edit/write and
  their descendants inherit the non-root UID. Generated session/job directories
  are created with ownership/modes the runner can use.
- Agent/provider control and result/job/socket paths use private, fixed
  directories and mode 0700/0600 under the appropriate identity. Do not create a
  root-owned 0600 secret file and then make it world-readable.
- Plan 032's token-bearing isolated network Git command stays in its reviewed
  trusted lane; only non-credential local object/repository work may run as the
  workload identity. Never expose its environment/temp directory to workload.

### C. Safe project-environment handoff

Arbitrary project keys must not be spread into a privileged/root-created session
before identity drop.

- Replace the spread with the single code-owned envelope variable
  `DITTO_PROJECT_ENV_JSON`, containing the exact project key/value map.
  Code-owned runner credential/callback variables
  remain separate and override/reject reserved collisions exactly as current
  Ditto precedence requires.
- Launch with an absolute trusted Node/runner gate and code-owned base
  environment.
- After the process is already non-root, the runner parses and deletes the
  envelope, resolves/deletes credential variables, then applies project values
  to `process.env` immediately before PI session/tools are created.
- Preserve values byte-for-byte; do not trim, bound, re-encrypt, or persist them
  in a job/file. Dynamic-loader/runtime-option values may affect workload child
  commands only, never the trusted launcher or already-started Node process.
- Include the envelope and leaves in existing redaction inputs.

### D. Complete build-pinned runner integrity

- After runner build/prune, generate a deterministic manifest at
  `/usr/local/share/ditto-runner-integrity.manifest`, outside the runner tree,
  that covers every regular file, symlink target, relative path,
  owner UID/GID, and mode under `/opt/ditto-runner`, including production
  dependencies and all six current Worker entrypoints. Detect missing, changed,
  extra, retargeted, wrong-owner, or group/world-writable artifacts.
- Root owns `/opt`, `/opt/ditto-runner`, every ancestor/descendant, the manifest,
  workload launcher, and integrity verifier. Workload cannot modify any of them.
- Bake a root-owned `/usr/local/bin/ditto-runner-health` that validates the
  complete manifest and parent ownership/modes with static output and a distinct
  failure exit. It must not read repository content.
- `isSandboxRunnerHealthy` invokes this verifier, not ad hoc file/package JSON
  checks.
- Before any secret session/job/file is created, call a fail-closed integrity
  assertion. The runner launch gate verifies again immediately before dropping
  privileges and invoking an allowlisted role. No raw `node /opt/...` fallback
  remains.
- On mismatch:
  - project sandbox: log static project/sandbox correlation, destroy it, and
    route through the existing stable-ID restore/recreate path before any retry;
  - temporary auth/catalog sandbox: destroy immediately and return a fixed
    failure;
  - never include raw verifier output, file content, or credentials in logs.

Plan 036 will later centralize the six-role list. This plan may use one explicit
fixed list in the image gate plus one Worker list, with a temporary parity test;
do not invent code generation before that cleanup plan.

## Steps

### Step 0: Baseline and dependency confirmation

1. Confirm Plans 032–034 are DONE and in `HEAD`.
2. Record drift/status and current focused/full baseline.
3. Read the live installed SDK types and upstream issue #677.
4. Confirm Docker is available. If not, STOP: image/control-plane capability is
   the first gate and cannot be mocked.

**Verify**: installs are frozen; focused tests pass; Docker responds; no source
edits have occurred.

### Step 1: Prove a viable control-plane/UID boundary before implementation

This step is a standalone deliverable. Create only a disposable local
image/probe outside committed source first; do not edit production source. Do
not use credentials or destructive control requests. Write
`plans/evidence/035-sandbox-capability.md` with this exact table before asking a
reviewer to authorize Step 2:

| Gate | Exact command/probe | Local result | Deployed result | Evidence/log location |
|---|---|---|---|---|
| Fixed UID/GID/groups/caps | | PASS/FAIL | PASS/FAIL/NOT RUN | |
| SDK exec/session/files | | PASS/FAIL | PASS/FAIL/NOT RUN | |
| Clone + backup + restore | | PASS/FAIL | PASS/FAIL/NOT RUN | |
| HTTP control denial | | PASS/FAIL | PASS/FAIL/NOT RUN | |
| WebSocket control denial | | PASS/FAIL | PASS/FAIL/NOT RUN | |
| RPC/control denial | | PASS/FAIL | PASS/FAIL/NOT RUN | |
| Trusted process/env denial | | PASS/FAIL | PASS/FAIL/NOT RUN | |
| Writable-path inventory | | PASS/FAIL | PASS/FAIL/NOT RUN | |
| Decision | | PROCEED/BLOCKED | PROCEED/BLOCKED | reviewer |

Use `ss -lntup`/`ps` inside the exact image to inventory every control-plane
listener/process, including the documented port 3000. Test each discovered
listener plus the pinned HTTP, WebSocket-upgrade, and RPC/control endpoints with
harmless health/invalid requests from UID 10001. A connection refusal or an
explicit authentication/authorization rejection counts; an unknown route, 404
from an untested transport, or lack of endpoint knowledge does not. Record the
pinned upstream source/type location used to identify each transport.

Prove all of the following against the exact pinned image:

1. The exact pinned 0.12.3 image's `setpriv` can launch Node, Git, npm, pnpm,
   yarn, and a long-running process as the fixed
   non-root numeric UID/GID with cleared groups, no-new-privileges, and no
   effective capabilities.
2. The inherited Sandbox control plane still starts as required and SDK `exec`,
   sessions, file APIs, clone, backup, restore, process start, and port exposure
   work.
3. From the dropped process, harmless connection attempts to the control
   plane's HTTP port, WebSocket upgrade, and RPC/control transport are rejected
   by an enforcement mechanism whose credential/socket is unavailable to the
   workload. Merely “not documented” or “we did not know the endpoint” is not
   enforcement.
4. A dropped process cannot inspect a trusted/root process environment or
   Plan-032 credential temp directory.
5. Standard sticky runtime paths are enumerated. No trusted application/system
   path is writable; only `/workspace`, the workload home/cache, and explicitly
   accepted runtime paths are writable.

**Gate**:

- If every row passes, record exact commands/results and proceed.
- If the root control API is reachable, the credential lane is observable, or
  clone/backup/restore requires unsafe permissions, **STOP and mark Plan 035
  BLOCKED**. Recommend an upstream authenticated user-execution boundary or SDK
  upgrade/design spike. Do not add global `USER`, chown system trust stores,
  hide the port only in docs, or continue with file-mode theater.

Do not proceed until a human reviewer records `PROCEED` in the evidence file.
A local PASS with deployed rows NOT RUN permits implementation work but never
DONE; any local denial failure records BLOCKED immediately.

### Step 2: Add failing workload/ownership tests (SANDBOX-2 slice)

Create `sandbox-workload.ts`/`.test.ts` and extend existing suites first.
Characterize:

- exact launcher command/quoting; fixed numeric identity; no caller-controlled
  UID/path/options;
- every repository command site uses the workload wrapper;
- clone/restore ownership normalization precedes Git/install;
- symlink targets outside `/workspace` are not followed; setuid/setgid bits are
  removed;
- runtime Corepack/global-bin mutation is absent;
- agent session receives one project-env envelope, not arbitrary project keys;
- envelope parse/delete/apply occurs after non-root start and before PI/tools;
- generated jobs/results/sockets have the required owner/mode;
- Plan-032 credential network launch remains in the trusted lane.

Add only these source guards where behavioral mocks cannot prove absence:

```bash
rg -n 'node /opt/ditto-runner|node \$\{(RUNNER|CONTROL|AUTH|CATALOG|METADATA).*CLI' apps/web/src/lib
rg -n 'startProcess\(discovered\.command' apps/web/src/lib/session-preview.ts
rg -n '\.\.\.projectEnv' apps/web/src/lib/agent-run.ts
```

After implementation all three return no production matches. Do not add a broad
“every exec must match this regex” test; explicit per-module command assertions
are less brittle.

**Verify**: new tests fail against current root/raw-command behavior for their
named reasons; existing tests remain green.

### Step 3: Build the fixed workload launcher and route untrusted commands (SANDBOX-2 slice)

Update Docker and call sites per Target design A/B/C. Use absolute trusted
launcher paths. Preserve command timeouts, cwd, redaction, Git policy, locks,
preview process IDs, package-manager selection, and protocol output.

For project env, update `agent-job`/runner tests to prove:

- exact whitespace/newline values survive the envelope;
- reserved Ditto names cannot replace code-owned credential/callback values;
- project `PATH`, `NODE_OPTIONS`, or loader-shaped keys do not affect the
  privileged launcher/already-started Node process;
- they remain available to workload shell children after PI starts;
- envelope/credential variables are deleted before tools.

**Verify**: focused workload, bootstrap, Git/worktree, preview, agent, metadata,
and runner tests pass.

Before starting Step 4, commit/review the Step 2–3 slice independently. Its
focused tests and image UID/write/ownership smoke must pass without any
existence-only integrity claim.

### Step 4: Add complete integrity and fail-closed recovery (SANDBOX-3 slice)

Implement the build manifest, verifier, pre-secret assertion, and runner launch
gate. Add adversarial tests for every failure class:

- missing/empty/changed/extra regular file;
- symlink target changed or extra symlink;
- wrong owner/group or group/world write bit on a parent/artifact;
- missing each of the six entrypoints, including `control-cli.js`;
- tampered production dependency;
- verifier/launcher/manifest mode or ownership mismatch.

At every Worker boundary assert that failure occurs before `createSession({
env })`, secret file write, process start, or runner invocation. Assert destroy
and static error mapping. For a project, prove the stable ID can subsequently
restore/recreate from the trusted image; for temporary auth/catalog, prove
immediate destroy.

Measure five warm verifier runs in the built image and deployed smoke. The
median must be at most **1,000 ms** and every run at most **2,000 ms**. If either
budget fails, STOP for a reviewed once-per-image attestation cache held only in
root-owned/control-plane state outside workload-writable paths; do not silently
reduce coverage or cache in `/workspace`/`/tmp/ditto-workload`.

**Verify**: all focused integrity/call-site tests pass; raw entrypoint greps show
no production fallback.

Before starting Step 5, commit/review the Step-4 integrity slice independently.
No partial branch may be merged as SANDBOX-3 unless pre-secret and launch-gate
checks both exist.

### Step 5: Add automated image and deployed smokes

Create `scripts/verify-sandbox-image.sh` with non-destructive checks that CI and
reviewers can run against an image tag. Add a CI step after `pnpm verify` to run
`docker info`, build, and execute the script on GitHub's Ubuntu runner. If
Docker, required container inspection, or the non-destructive privilege checks
are unavailable in CI, STOP and move the image smoke to a reviewed dedicated CI
job/runner; do not mark the automated acceptance criterion satisfied locally.

The script must prove:

- control plane starts with SDK 0.12.3;
- workload UID/GID/groups/capabilities/no-new-privileges are exact;
- workload can write only accepted roots and cannot modify `/opt/ditto-runner`,
  manifest, launchers, `/container-server`, system config, or package-manager
  globals;
- npm/pnpm/yarn lifecycle fixtures run non-root and cannot alter trusted files;
- agent/metadata/control/provider/catalog entries pass the launch gate far
  enough to show the expected UID without real credentials;
- tampering each representative content/mode/owner/symlink class makes health
  fail;
- fresh clone and backup restore normalize ownership and remain usable;
- dropped workload cannot access root control APIs.

Then run an operator-authorized deployed Sandbox smoke with synthetic repository
content and replaceable credentials. Local Docker alone cannot prove Cloudflare
FUSE, control transport, or runtime security. Record each row PASS/FAIL/NOT RUN;
SANDBOX-2/3 cannot be DONE without deployed control-plane denial, backup restore,
UID/write, integrity-fence, agent-shell, preview, and Plan-032 credential-lane
checks.

### Step 6: Align architecture documentation

Document only proven behavior:

- root control-plane role and enforced in-container denial to workload;
- fixed workload identity and accepted writable roots;
- SDK clone/restore ownership normalization;
- project env envelope and post-drop application;
- root-owned complete manifest/launch gate and recovery on mismatch;
- same-workload-UID process confidentiality is not claimed;
- every runner role verifies before credentials.

Do not claim SANDBOX-4 manifest centralization until Plan 036 lands.

### Step 7: Full verification and scope audit

Run focused tests, runner tests, `pnpm verify`, image build/smoke, deployed smoke,
`git diff --check`, and final status/name-only audit. Preserve all seeded planning
artifacts.

## Test plan

- Workload launcher rejects caller-selected identity/path/options and safely
  quotes arbitrary repository commands.
- Clone/restore normalize ownership without following malicious symlinks.
- npm/pnpm/yarn lifecycle, preview, local Git/hooks, metadata snapshots, agent
  runner, and PI shell descendants execute as the fixed non-root UID.
- Root maintenance is limited to exact image/health/clear/clone/restore/backup and
  Plan-032 trusted credential operations.
- Arbitrary project environment reaches only the post-drop envelope path and
  remains exact for workload children.
- Complete runner tree content/path/type/owner/mode/extra-file tampering fails.
- All six entries are rejected before any secret session/job/write on mismatch.
- Project mismatch destroys then restores/recreates under the stable ID; auth
  mismatch destroys the temporary sandbox.
- Control-plane HTTP/WS/RPC denial is tested locally and deployed.
- Backup/FUSE restore, worktrees, shared dependencies, control sockets, and
  preview still function with final ownership.

## Done criteria

ALL must hold:

- [ ] Step 1 proves the workload cannot invoke the trusted/root Sandbox control
      plane or inspect Plan-032's credential lane.
- [ ] No global Docker `USER` workaround weakens required Sandbox startup/FUSE.
- [ ] Repository installs/lifecycle scripts, previews, local Git/hooks,
      metadata snapshots, agent runner, and PI shell tools use a fixed non-root
      identity with cleared groups/capabilities and no-new-privileges.
- [ ] `/opt/ditto-runner`, its parents/dependencies, manifest, verifier,
      launchers, `/container-server`, and system/package-manager globals are
      root-owned and non-writable by workload.
- [ ] Clone and restore normalize `/workspace` safely before repository code.
- [ ] Arbitrary project env is not installed in a privileged session before UID
      drop; exact values become available only to the non-root runner/tools.
- [ ] Complete deterministic integrity detects missing/changed/extra/type/
      symlink/owner/mode failures, including every current runner entrypoint.
- [ ] Integrity is checked before secret material becomes workload-visible and
      again in the launch gate immediately before exec.
- [ ] Mismatch destroys/quarantines the sandbox and forces trusted-image
      recovery; there is no raw runner fallback.
- [ ] CI runs the reusable image security smoke.
- [ ] Focused tests, runner tests, `pnpm verify`, image smoke, and diff/scope
      checks pass.
- [ ] Authorized deployed smokes prove control denial, non-root execution,
      FUSE backup restore, write protection, tamper fencing, preview, agent shell,
      and Plan-032 credential isolation. Without them status is BLOCKED.
- [ ] Documentation states the proven boundary and its same-UID limitation.
- [ ] Plan 035 status in `plans/README.md` is updated after review.

## STOP conditions

Stop, mark BLOCKED, and report without improvising if:

- A dropped workload can reach any trusted/root control-plane command, file,
  process, session, backup, or Git API.
- The pinned SDK/image cannot run required control/FUSE/backup behavior while
  enforcing the selected boundary.
- A native user option or SDK upgrade is required; that is a separate migration
  plan with compatibility review.
- Plan 032's token-bearing process/environment/temp state is visible to the
  workload identity.
- Arbitrary project env must enter a privileged/root-created process directly.
- Workspace ownership normalization follows repository symlinks, cannot handle
  restored FUSE content, or leaves Git/worktrees/dependencies mixed-root in a
  way that breaks workload operations.
- Any runner secret/job/result must be made world-readable to cross identities.
- Integrity mismatch is detected only after credentials are workload-visible.
- Complete verification cannot include production dependencies, symlinks,
  ownership/modes, and unexpected files at acceptable latency.
- The deployed runtime differs in UID, groups, capabilities, control-port access,
  FUSE behavior, or write permissions from local Docker.
- Correctness requires schema/migrations, public APIs, removing requested agent
  tools, or weakening redaction/Git egress/preview policy.
- A verification command fails twice after a reasonable in-scope correction.

## Maintenance notes

The launch gate, not convention, is the trust boundary. New repository command
sites must use the workload launcher; new runner roles must verify before secret
handoff. Never cache “healthy” in `/workspace` or another workload-writable path.
Re-run control-plane denial and backup/FUSE smokes on every Sandbox SDK/image
upgrade. Plan 036 may centralize role/provision contracts only after this plan is
DONE; it must preserve the exact launcher/integrity semantics rather than replace
them with file-existence checks.
