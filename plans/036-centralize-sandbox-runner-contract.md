# Plan 036: Centralize runner entrypoints and sandbox provision success

> **Executor instructions**: Follow this plan step by step after Plan 035 is
> DONE. Preserve its workload launcher, complete integrity verifier, pre-secret
> checks, and recovery behavior. This is contract cleanup, not a second security
> design. Run every verification command and stop on drift or scope expansion;
> do not add code generation, a registry class, a new package, or a runtime
> cross-workspace JSON import.
>
> **Drift check (run first)**:
> `git diff --stat b783dec..HEAD -- packages/sandbox-runner/package.json packages/sandbox-runner/package-lock.json Dockerfile package.json apps/web/src/lib/sandbox-bootstrap.ts apps/web/src/lib/agent-run.ts apps/web/src/lib/agent-control-service.ts apps/web/src/lib/provider-auth-service.ts apps/web/src/lib/session-git-metadata.ts apps/web/src/lib/workspace-policy.ts apps/web/src/lib/project-sandbox.ts apps/web/src/lib/agent-run-service.ts apps/web/src/lib/agent-git-handler.ts apps/web/src/lib/session-preview.ts apps/web/src/integrations/trpc/routers/projects.ts apps/web/src/integrations/trpc/routers/session-git.ts apps/web/src/routes/project.$projectId.tsx docs/architecture/repository-map.md docs/architecture/server-and-data.md docs/architecture/agent-harness.md plans/036-centralize-sandbox-runner-contract.md plans/README.md`
> Plans 032–035 are expected to change many paths above. Confirm all are DONE,
> then treat their landed code—not the pre-plan excerpts—as authoritative. The
> specific drift that matters is the final set of Worker-invoked runner roles,
> the Plan-035 verifier/launcher interface, and provision result vocabulary. If
> any differs from the six-role/three-success-state inventory below, STOP and
> refine the plan. Preserve all initial working-tree entries.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plans 034 and 035 (both must be DONE)
- **Category**: tech-debt
- **Requirements**: SANDBOX-4 from the approved platform-hardening specification
- **Planned at**: commit `b783dec`, 2026-07-29

## Why this matters

The Worker invokes six baked runner entrypoints, but the independent runner
package exports only four, Docker build checks only five, Docker executable/link
setup covers four, and runtime health historically checked one. In particular,
`control-cli.js` is invoked in production without being part of the image build
contract. Runner paths are duplicated across four Worker modules, so adding or
renaming an entry can silently drift package, image, health, and runtime use.

Project sandbox provision success is also reconstructed in seven callers as the
same three-string `Set`. A new lifecycle result can therefore be accepted by one
surface and rejected by another.

After this plan, `packages/sandbox-runner/package.json#bin` is the single image
entrypoint manifest, one small tested Worker role map supplies absolute paths,
Plan 035's Docker/integrity gates derive from the package manifest, and one pure
provision-success predicate is reused everywhere.

## Current state

The approved source is
`docs/superpowers/specs/2026-07-26-platform-hardening-design.md`, Workstream 3,
SANDBOX-4.

### Six production entrypoints, incomplete contracts

At planning commit `b783dec`:

| Semantic role | Built file | Worker definition | Package bin | Docker check |
|---|---|---|---|---|
| Agent | `dist/cli.js` | `agent-run.ts:22` | yes | yes |
| Agent control | `dist/control-cli.js` | `agent-control-service.ts:11` | **no** | **no** |
| Provider auth | `dist/provider-auth-cli.js` | `provider-auth-service.ts:35` | yes | yes |
| Provider auth control | `dist/provider-auth-control-cli.js` | `provider-auth-service.ts:36` | yes | yes |
| Provider catalog | `dist/provider-catalog-cli.js` | `provider-auth-service.ts:37` | yes | yes |
| Git metadata | `dist/git-metadata-cli.js` | `session-git-metadata.ts:16` | **no** | yes, but no chmod/link |

`packages/sandbox-runner/package.json:5-10` declares only four bins. Its lockfile
root entry is already stale and records less bin metadata than the manifest.
`packages/sandbox-runner/tsconfig.json:13` builds every non-test source, so all
six files happen to exist after build; accidental compiler inclusion is not an
artifact contract.

`Dockerfile:13-27` repeats explicit file checks/chmod/symlinks. Plan 035 is
expected to replace/extend this with a complete integrity manifest and launch
gate. This plan must make that landed gate enumerate `package.json#bin`, not add
another list.

### Provision success is duplicated

The authoritative result union is in
`apps/web/src/lib/project-sandbox.ts:20-35`. The success subset is copied as:

```ts
new Set(["connected", "restored_from_backup", "recreated_from_github"])
```

at these planning-time sites:

- `apps/web/src/lib/agent-run-service.ts:414`
- `apps/web/src/lib/agent-git-handler.ts:105`
- `apps/web/src/integrations/trpc/routers/session-git.ts:116`
- `apps/web/src/integrations/trpc/routers/projects.ts:266` and `:348`
- `apps/web/src/lib/session-preview.ts:899`
- `apps/web/src/routes/project.$projectId.tsx:27`

`apps/web/src/lib/workspace-policy.ts` is the existing dependency-light shared
policy module used by Worker and browser. It is the smallest home for a readonly
success tuple and type guard; do not mix provision states into the runner
package contract.

### Existing conventions

- Runner remains an independent npm package, not a pnpm workspace member.
- Root `pnpm runner:verify` owns runner typecheck/test/build ordering.
- Worker production imports stay inside `apps/web`; tests may read root/runner
  manifests with Node built-ins for parity.
- Services use direct constants/functions rather than DI registries.
- Plan 035's root-owned launch/integrity gate is the security boundary. A package
  manifest refactor must not replace content/owner/mode checks with existence.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Refresh runner lock metadata | `npm install --package-lock-only --ignore-scripts --prefix packages/sandbox-runner` | exit 0; only intended runner lock metadata changes |
| Clean runner install | `npm ci --prefix packages/sandbox-runner` | exit 0 |
| Runner contract | `npm run build --prefix packages/sandbox-runner && npm run verify:entrypoints --prefix packages/sandbox-runner` | exactly six entries verified; exit 0 |
| Focused web tests | `pnpm --filter @ditto/web exec vitest run src/lib/sandbox-runner-contract.test.ts src/lib/sandbox-bootstrap.test.ts src/lib/agent-run.test.ts src/lib/agent-control-service.test.ts src/lib/provider-auth-service.test.ts src/lib/session-git-metadata.test.ts src/lib/workspace-policy.test.ts src/lib/agent-run-service.test.ts src/lib/agent-git-handler.test.ts src/lib/session-preview.test.ts src/integrations/trpc/routers/projects.test.ts src/integrations/trpc/routers/session-git.test.ts 'src/routes/project.$projectId.test.tsx'` | all pass |
| Full gate | `pnpm verify` | exit 0 |
| Image contract | `docker build -t ditto-plan-036 . && scripts/verify-sandbox-image.sh ditto-plan-036` | exit 0; Plan-035 security smoke still passes |
| Diff hygiene | `git diff --check` | no output |
| Scope audit | `git status --short` | initial entries plus intended files only |

Do not use pnpm to install the runner, add a workspace member, upgrade packages,
or run a deploy.

## Scope

**Runner package/image contract**

- `packages/sandbox-runner/package.json`
- `packages/sandbox-runner/package-lock.json`
- `packages/sandbox-runner/scripts/verify-entrypoints.mjs` (create)
- `packages/sandbox-runner/scripts/verify-entrypoints.test.ts` (create; this is
  the single verifier test host and uses temporary fixture directories)
- `package.json`
- `Dockerfile`
- Plan-035 image verifier/launcher source only where needed to derive roles from
  `package.json#bin`

**Worker runner contract and callers**

- `apps/web/src/lib/sandbox-runner-contract.ts` (create)
- `apps/web/src/lib/sandbox-runner-contract.test.ts` (create)
- `apps/web/src/lib/sandbox-bootstrap.ts` and `.test.ts`
- `apps/web/src/lib/agent-run.ts` and `.test.ts`
- `apps/web/src/lib/agent-control-service.ts` and `.test.ts`
- `apps/web/src/lib/provider-auth-service.ts` and `.test.ts`
- `apps/web/src/lib/session-git-metadata.ts` and `.test.ts`
- Plan-035 workload/launch helper only if it currently owns a duplicate role map

**Provision-success contract and callers**

- `apps/web/src/lib/workspace-policy.ts` and `.test.ts`
- `apps/web/src/lib/project-sandbox.ts`
- `apps/web/src/lib/agent-run-service.ts` and `.test.ts`
- `apps/web/src/lib/agent-git-handler.ts` and `.test.ts`
- `apps/web/src/lib/session-preview.ts` and `.test.ts`
- `apps/web/src/integrations/trpc/routers/projects.ts` and `.test.ts`
- `apps/web/src/integrations/trpc/routers/session-git.ts` and `.test.ts`
- `apps/web/src/routes/project.$projectId.tsx` and `.test.tsx`

**Documentation/index**

- `README.md`
- `docs/architecture/agent-harness.md`
- `docs/architecture/server-and-data.md`
- `docs/architecture/repository-map.md`
- `plans/README.md` status only after execution

**Out of scope**

- Changing CLI protocols, jobs, output, models, credentials, runner tools, or
  process lifecycle.
- Weakening/changing Plan 035 UID, control-plane denial, project-env envelope,
  integrity content/owner/mode coverage, or recovery behavior.
- Adding new provision states or changing client-visible state semantics.
- Schema/migrations, SDK/image/dependency upgrades, provider parity cleanup,
  route-test warning cleanup, or runner test typecheck migration.
- Creating a shared workspace package, generated source, registry class, or
  runtime import of `packages/sandbox-runner/package.json` from the Worker.
- Renaming/removing existing `/usr/local/bin` aliases unless a landed Plan-035
  contract already made them manifest-derived.

## Git workflow

- Branch: `advisor/036-sandbox-runner-contract`
- Start from landed Plan 035.
- Suggested commits:
  1. `refactor(runner): centralize entrypoint contract`
  2. `refactor(sandbox): share provision success policy`
  3. `docs(sandbox): document runner contract`
- Do not push, open a PR, merge, or deploy unless instructed.

## Target design

### Package/image authority

Make `packages/sandbox-runner/package.json#bin` an exact six-entry object with
these frozen semantic command names and targets:

```json
{
  "ditto-runner": "./dist/cli.js",
  "ditto-agent-control": "./dist/control-cli.js",
  "ditto-provider-auth": "./dist/provider-auth-cli.js",
  "ditto-provider-auth-control": "./dist/provider-auth-control-cli.js",
  "ditto-provider-catalog": "./dist/provider-catalog-cli.js",
  "ditto-git-metadata": "./dist/git-metadata-cli.js"
}
```

A Node-builtins-only `verify-entrypoints.mjs` reads that manifest and fails on:

- missing/extra/duplicate command names or targets;
- absolute, parent-traversing, non-`./dist/*.js`, or duplicate targets;
- missing, empty, non-regular, or non-built target files;
- target basename without the expected `src/<basename>.ts` source;
- lockfile root-package bin metadata that differs from `package.json`.

It prints only fixed role/path diagnostics—never file contents. Add
`verify:entrypoints` to the runner package and run it after `build` in root
`runner:verify`.

Docker build validation and Plan-035's integrity manifest/allowlisted launch
roles must enumerate package bins after the fresh build using the image's Node
runtime (`node -e`/the verifier script reading `package.json#bin`); do not add
`jq`, code generation, or a second manifest parser. Preserve complete tree
hash/owner/mode/extra-file verification; manifest-derived entrypoints are an
additional contract, not a substitute.

### Worker path map

Create one small `sandbox-runner-contract.ts` with six semantic keys and absolute
`/opt/ditto-runner/<relative target>` values. All four Worker modules import it;
delete their private path constants. Plan-035 launch/integrity calls accept only
these semantic roles/paths.

A Node-only test reads runner `package.json` and asserts exact set parity between
its relative targets and the Worker map after stripping `/opt/ditto-runner/`.
The production Worker does not import/read a repository JSON file at runtime.

### Provision success

Add to `workspace-policy.ts`:

- a readonly tuple containing exactly `connected`, `restored_from_backup`, and
  `recreated_from_github`;
- a derived type; and
- `isProjectSandboxProvisionSuccess(value: unknown)`.

Replace every copied success `Set` and UI equivalent with the predicate. Keep
`ProvisionProjectSandboxState` as the complete domain union in
`project-sandbox.ts`; type it against the shared vocabulary without introducing
a circular import. `provisioning` and `failed` remain non-success everywhere.

Do not centralize unrelated state machines or response-building policy.

## Steps

### Step 0: Reconcile Plan-035 output and baseline

1. Confirm Plans 034/035 are DONE and their commits are in `HEAD`.
2. Record status/drift and the exact six live runner invocation roles.
3. Locate Plan 035's definitive integrity manifest, launch role list, health
   command, and image smoke. If it already established a different single source
   than `package.json#bin`, STOP and update this plan to reuse it rather than
   create a second authority.
4. Run current `pnpm runner:verify`, focused web tests, and Plan-035 image smoke.

**Verify**: baseline is green; exact six roles/three success states match this
plan.

### Step 1: Add red parity tests before changing manifests

Add focused tests that fail on current drift:

- package manifest must contain exactly six names/targets;
- agent control and Git metadata are missing today and produce named failures;
- Worker role map must match package targets exactly;
- Docker/Plan-035 image contract must derive/check every package bin;
- runtime health/launch allowlist must cover every Worker role;
- package-lock root metadata must match package manifest.

Fixtures for malformed/extra/duplicate/absolute/traversing/missing/empty targets
must use temporary directories, not mutate real package files.

**Verify**: new parity tests fail only for the current missing entries/contract.

### Step 2: Make package bins the image manifest

1. Add the two missing bins and lock metadata.
2. Implement the narrow verifier and package script.
3. Change root `runner:verify` to typecheck, test, build, then verify entrypoints.
4. Make Docker's post-build checks/chmod/links and Plan-035 integrity role
   enumeration consume `package.json#bin` rather than hardcoded file subsets.
5. Keep all six source CLIs and protocols unchanged.

**Verify**:

```bash
npm install --package-lock-only --ignore-scripts --prefix packages/sandbox-runner
npm ci --prefix packages/sandbox-runner
npm run typecheck --prefix packages/sandbox-runner
npm test --prefix packages/sandbox-runner
npm run build --prefix packages/sandbox-runner
npm run verify:entrypoints --prefix packages/sandbox-runner
```

Expected: exact six verified, all commands exit 0, no resolved dependency version
changes beyond bin lock metadata.

### Step 3: Centralize Worker runner paths

Create the typed six-role map and parity test. Replace private path constants in
agent, control, provider auth/catalog/control/refresh, and Git metadata modules.
Route Plan-035 health/launch calls through the same semantic roles.

Add one negative test per previously unchecked role: removing/tampering the
manifest entry causes health/launch rejection before process invocation. Do not
duplicate Plan-035 content/mode adversarial cases.

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/lib/sandbox-runner-contract.test.ts src/lib/sandbox-bootstrap.test.ts src/lib/agent-run.test.ts src/lib/agent-control-service.test.ts src/lib/provider-auth-service.test.ts src/lib/session-git-metadata.test.ts
rg -n 'const (RUNNER|CONTROL|AUTH|AUTH_CONTROL|CATALOG|METADATA)_CLI' apps/web/src/lib
```

Expected: tests pass; grep returns no private production path constants. Also
run:

```bash
rg -n '/opt/ditto-runner/dist/.+\.js' apps/web/src/lib --glob '*.ts'
```

Expected: production literals appear only in
`apps/web/src/lib/sandbox-runner-contract.ts`; test fixtures may quote them.

### Step 4: Centralize provision success

Add the tuple/type guard and tests for all three successes plus `provisioning`,
`failed`, unknown strings, null, and objects. Replace all copied success sets in
Scope.

Preserve each caller's additional conditions (for example requiring
`sandboxId`) and error/result mapping. Only the membership decision moves.

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/lib/workspace-policy.test.ts src/lib/agent-run-service.test.ts src/lib/agent-git-handler.test.ts src/lib/session-preview.test.ts src/integrations/trpc/routers/projects.test.ts src/integrations/trpc/routers/session-git.test.ts 'src/routes/project.$projectId.test.tsx'
rg -n 'PROVISION_SUCCESS|new Set\(\[.*connected' apps/web/src
```

Expected: tests pass; grep finds no copied production success set.

### Step 5: Update documentation

- README: independent runner has six internal command entries and one manifest
  verification gate; users still run root `pnpm runner:verify`.
- Agent/server docs: package bin is image authority, Worker uses a tested typed
  map, complete Plan-035 integrity runs before launch, and control/Git metadata
  have equal coverage.
- Repository map: include all six CLI sources and the Worker contract module;
  remove any implication that the map is exhaustive if it still omits active
  boundaries.

Do not duplicate the full security appendix or claim new provision states.

### Step 6: Run full/image gates and audit scope

Run `pnpm verify`, exact focused suites, Docker build, Plan-035 image smoke,
`git diff --check`, `git diff --name-only`, and final status. In the built image,
remove or corrupt `control-cli.js` in a disposable root-run container and prove
health/launch fails exactly as for every other entry; never use credentials.

## Test plan

| Case | Location | Assertion |
|---|---|---|
| Exact package bins | runner verifier test | six frozen names/targets only |
| Malformed target | same | absolute/traversal/non-dist/duplicate rejected |
| Fresh build output | same | every target regular, non-empty, source-backed |
| Lock parity | same | root package lock bin metadata equals manifest |
| Worker parity | `sandbox-runner-contract.test.ts` | exact six relative targets match package bins |
| Docker/integrity parity | same/image smoke | every manifest target checked/launched; no hidden list |
| Control CLI regression | contract + image tests | missing/tampered control rejected before invoke |
| Git metadata regression | same | equal package/Docker/health/Worker coverage |
| Provision predicate | `workspace-policy.test.ts` | three success; all other values false |
| Caller parity | existing caller tests | success/failure behavior unchanged on every surface |

## Done criteria

ALL must hold:

- [ ] `package.json#bin` contains exactly the six frozen command/target pairs and
      runner lock metadata matches.
- [ ] Fresh runner build followed by `verify:entrypoints` is mandatory in root
      `runner:verify` and exits 0.
- [ ] Docker build checks/chmod/aliases and Plan-035 integrity/launch roles derive
      from the package manifest or have an exact failing parity test; no entry is
      silently omitted.
- [ ] Agent control and Git metadata receive the same package, Docker, health,
      integrity, and Worker contract as all other roles.
- [ ] One typed Worker map supplies every absolute runner path; private module
      path constants are gone and no production `/opt/ditto-runner/dist/*.js`
      literal exists outside `sandbox-runner-contract.ts`.
- [ ] Production Worker does not runtime-read/import the independent package's
      JSON; parity is build/test-time.
- [ ] Plan-035 complete content/owner/mode/extra-file integrity and pre-secret
      recovery behavior remain unchanged and pass its image smoke.
- [ ] One shared predicate defines the exact three provision-success states and
      every copied `PROVISION_SUCCESS` set/UI equivalent is removed.
- [ ] No CLI protocol, lifecycle result, public API, schema, migration,
      dependency version, UID, credential, or process behavior changed.
- [ ] Focused tests, `pnpm verify`, Docker/image smoke, and diff/scope checks pass.
- [ ] Documentation/repository map matches the six-role contract.
- [ ] Plan 036 status in `plans/README.md` is updated after review.

## STOP conditions

Stop and report without improvising if:

- Plan 035 is BLOCKED or not deployed/verified; contract cleanup cannot certify a
  boundary that does not exist.
- Landed Plan 035 already chose another authoritative manifest. Reuse/refine it;
  do not create package-vs-image dual authority.
- The live Worker invokes any seventh runner path or a dynamic/arbitrary runner
  path.
- Runner build output cannot be verified from package bins without evaluating
  untrusted scripts or importing application code.
- Package-lock refresh changes dependency resolutions rather than only expected
  bin metadata.
- Runtime Worker bundling would require importing files outside `apps/web`; keep
  the tested local role map instead.
- A caller's provision success semantics intentionally differ from the exact
  three-state contract; report the domain difference instead of forcing it.
- Correctness requires protocol, credential, UID, SDK/image, schema/migration,
  route, or public response changes.
- A verification command fails twice after a reasonable in-scope correction.

## Maintenance notes

Adding a runner command becomes one explicit operation: add its source and
`package.json#bin` entry, then satisfy runner build, lock, Worker-map, Docker,
integrity, health, and image parity gates. A reviewer should reject any direct
`/opt/ditto-runner/dist/*.js` literal outside the contract module. Adding a new
provision result requires updating the complete union deliberately; callers gain
success only if the shared success tuple changes in the same reviewed diff.
