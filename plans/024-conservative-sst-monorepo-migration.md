# Plan 024: Reorganize Ditto into an Alchemy-owned monorepo

> **Executor instructions**: Follow this plan in order. Run every verification
> command and confirm the expected result before continuing. This is a repository
> organization change only. Alchemy must continue to own the existing web Worker,
> Sandbox Container/Durable Object, D1 database, R2 bucket, bindings, migrations,
> development flow, deploy flow, and destroy flow. Do not introduce SST,
> Wrangler-owned resources, new deployment boundaries, or application behavior
> changes. If a STOP condition occurs, report it instead of improvising. When
> done, update this plan's row in `plans/README.md` unless a reviewer says they
> maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 32f4d1b..HEAD -- \
>   package.json pnpm-lock.yaml pnpm-workspace.yaml alchemy.run.ts \
>   Dockerfile .dockerignore .gitignore biome.json lefthook.yml \
>   .cta.json components.json drizzle.config.ts tsconfig.json vite.config.ts \
>   types src public migrations sandbox/runner apps packages \
>   .github/workflows README.md docs
> ```
>
> If any path changed, preserve compatible application changes through the move.
> STOP only if the package boundaries, verification commands, Alchemy resource
> graph, Docker runner contract, or generated-file ownership no longer matches
> this plan.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none; plans 001–023 are DONE
- **Category**: tech-debt
- **Planned at**: commit `32f4d1b`, 2026-07-15
- **Execution**: DONE — worktree branch `advisor/024-alchemy-monorepo-organization`
  at `674985a` (refactor `2cf2878`, docs `b90a4d5`, migration fixes
  `69e9aae` and `674985a`); worktree
  `.worktrees/advisor-024-alchemy-monorepo-organization`
- **Review**: APPROVED 2026-07-15 — all done criteria re-verified in worktree
- **Merged**: `4f2dab4` on master (2026-07-15)
- **Reconcile note (2026-07-15 @ `4f2dab4`)**: monorepo structure and app/runner
  tests still hold; full `pnpm typecheck` is currently red on an unrelated
  single error in `project-settings-dialog.tsx:674` (see plans/README.md
  reconciliation). Not a Plan 024 scope failure.

## Why this matters

Ditto currently places the TanStack Start application, app dependencies,
configuration, migrations, infrastructure program, and repository tooling in one
root package, while the Sandbox runner already behaves as an independent npm
package. Explicit `apps/web` and `packages/sandbox-runner` boundaries make
ownership and navigation clearer without adding another infrastructure system.

Alchemy already models the complete Cloudflare deployment coherently. This plan
preserves that model and changes only filesystem paths, package manifests,
orchestration scripts, CI paths, and documentation.

## Locked decisions

1. Keep `alchemy.run.ts`, `Dockerfile`, `package.json`, `pnpm-lock.yaml`, and
   repository-wide tooling at the repository root.
2. Alchemy remains the sole owner of the web Worker, Sandbox Container, Sandbox
   Durable Object, D1, R2, every binding, Worker transform, and migration.
3. `apps/web` is the only pnpm workspace package and owns the TanStack Start app,
   app dependencies, app scripts, source, assets, migrations, types, and
   tool-discovered app configuration.
4. `packages/sandbox-runner` remains the same private independent **npm** package
   with its own `package-lock.json`. It is not a pnpm workspace member.
5. Do not add Turborepo, SST, another task runner, shared packages, or a second
   deployment tool.
6. Keep app config files directly under `apps/web`; do not create a nested
   `configs/` directory. Vite, TypeScript, Drizzle, shadcn, and TanStack discover
   conventional package-root filenames without extra flags.
7. Preserve these runtime contracts exactly:
   - `/opt/ditto-runner/dist/cli.js`
   - `/opt/ditto-runner/dist/control-cli.js`
   - `/workspace` and `.ditto/**`
   - Worker↔runner JSON, NDJSON, SSE, callback, and Unix-control protocols
   - Sandbox `instanceType: "lite"`, `maxInstances: 1`, RPC transport, class
     name/binding `Sandbox`, and migration tag `v1`
8. Do not combine the move with dependency upgrades, schema changes, generated
   migration changes, compatibility changes, auth/UI/domain changes, or source
   refactors.

## Target tree

```text
.
├── package.json                    # workspace orchestration + root tooling
├── pnpm-workspace.yaml             # apps/* only
├── pnpm-lock.yaml
├── alchemy.run.ts                  # unchanged resource graph; path updates only
├── Dockerfile                      # root build context
├── biome.json
├── lefthook.yml
├── apps
│   └── web
│       ├── package.json            # app dependencies and app-local scripts
│       ├── .cta.json
│       ├── components.json
│       ├── drizzle.config.ts
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── types/
│       ├── src/
│       ├── public/
│       └── migrations/
└── packages
    └── sandbox-runner              # private npm package; not in pnpm workspace
        ├── package.json
        ├── package-lock.json
        ├── tsconfig.json
        ├── vitest.config.ts
        └── src/
```

## Current state

At commit `32f4d1b`:

- The root is the TanStack Start package.
- `pnpm verify` passed with 383 app tests and 21 runner tests.
- `sandbox/runner` is already a private npm package with an independent lockfile.
- `pnpm-workspace.yaml` contains install policy but no `packages:` list.
- `alchemy.run.ts` creates one coherent resource graph and finalizes it once.

`package.json:9-22` currently mixes app scripts, runner orchestration, and
Alchemy operations:

```json
"dev": "alchemy dev",
"build": "vite build",
"test": "vitest run",
"typecheck": "tsc --noEmit",
"runner:install": "npm ci --prefix sandbox/runner",
"runner:verify": "npm run typecheck --prefix sandbox/runner && npm test --prefix sandbox/runner && npm run build --prefix sandbox/runner",
"verify": "pnpm check && pnpm typecheck && pnpm test && pnpm build && pnpm runner:verify",
"deploy": "alchemy deploy",
"destroy": "alchemy destroy"
```

`alchemy.run.ts:14-86` currently owns:

- `Container("sandbox")` with root Docker context;
- `D1Database("database")` with `./migrations` and
  `drizzle_migrations` tracking;
- `R2Bucket("sandbox-backups")`;
- `TanStackStart("website")` with every current binding and secret;
- the Sandbox Container/DO Wrangler transform and migration `v1`;
- `await app.finalize()`.

Only four Alchemy path adjustments are required:

```ts
const database = await D1Database("database", {
  // unchanged fields
  migrationsDir: "./apps/web/migrations",
});

export const website = await TanStackStart("website", {
  cwd: "apps/web",
  // unchanged bindings and settings
  wrangler: {
    main: "src/server.ts",
    transform: (spec) => ({
      // unchanged transform fields
      ...spec,
      d1_databases: spec.d1_databases?.map((database) =>
        database.binding === "DB"
          ? { ...database, migrations_dir: "../../migrations" }
          : database,
      ),
      containers: [{
        // unchanged container fields
        image: "../../../../Dockerfile",
      }],
    }),
  },
});
```

Alchemy resolves TanStack's `wrangler.main: "src/server.ts"`, generated
`.alchemy/local/wrangler.jsonc`, `dist/client`, and `dist/server` relative to the
`cwd`, so those values stay app-relative. The moved `vite.config.ts` can retain
its current `.alchemy/local/wrangler.jsonc` check. Two generated Wrangler paths
need explicit transform adjustments because Wrangler resolves them from
`apps/web/.alchemy/local/wrangler.jsonc`: `../../migrations` reaches
`apps/web/migrations`, and four parent segments reach the root Dockerfile.

`Dockerfile:3` changes only its repository source path:

```dockerfile
COPY --chown=0:0 packages/sandbox-runner /opt/ditto-runner
```

Everything after the `COPY`, including npm install/build/prune, image paths,
validation, symlink, and `/workspace`, remains unchanged.

After moving `types/env.d.ts`, its import of the root Alchemy program becomes:

```ts
import type { website } from "../../../alchemy.run.ts";
```

The repository conventions to preserve are:

- root `.env*` ownership: `alchemy.run.ts` loads root files and
  `src/env.ts:24` requires the public GitHub App install URL during app
  build/runtime validation; after relocation Vite needs `envDir: "../.."`;
- root Biome/Lefthook/React Doctor orchestration and hooks;
- app tests colocated beside source;
- generated `src/routeTree.gen.ts` and `migrations/meta/**` move with their
  owners and are never hand-edited;
- `docs/architecture/repository-map.md` is the exhaustive path/ownership map;
- current source/schema remain authoritative over plans and generated output.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Current pnpm install | `pnpm install --frozen-lockfile` | exit 0; lock unchanged |
| Current runner install | `npm ci --prefix sandbox/runner` | exit 0 |
| Current baseline | `pnpm verify` | exit 0; 383 app and 21 runner tests at plan baseline |
| Target pnpm install | `pnpm install --frozen-lockfile` | exit 0; workspace installs |
| Target runner install | `npm ci --prefix packages/sandbox-runner` | exit 0 |
| Target full gate | `pnpm verify` | exit 0; app and runner checks/tests/builds pass |
| Local Alchemy smoke | `pnpm dev` | Alchemy starts Vite from `apps/web` and prints a local URL |
| Deploy | `pnpm deploy -- --stage <stage>` | unchanged Alchemy deploy command; run only when explicitly authorized |

No cloud deployment is required to complete this repository-only plan. Never
print or copy secret values while inspecting generated local configuration.

## Suggested executor toolkit

If available, use `workers-best-practices`, `sandbox-sdk`, and `durable-objects`
only to review that the existing Alchemy resource graph stayed unchanged. Do not
redesign it.

## Scope

**In scope** (the only implementation paths to modify):

- Root orchestration/config: `package.json`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`, `alchemy.run.ts`, `Dockerfile`, and `.dockerignore`.
- Move to `apps/web/**`: `.cta.json`, `components.json`, `drizzle.config.ts`,
  `tsconfig.json`, `vite.config.ts`, `types/**`, `src/**`, `public/**`, and
  `migrations/**`.
- Create `apps/web/package.json`.
- Move `sandbox/runner/**` to `packages/sandbox-runner/**`.
- Update `.github/workflows/ci.yml` for the new runner path and workspace gate.
- Update `README.md`, `docs/README.md`, and `docs/architecture/**` for final paths
  and ownership.
- Update only Plan 024's status/details in `plans/README.md`.

**Out of scope**:

- SST, a separate Wrangler deployment, Turborepo, or any new infrastructure
  owner/resource.
- New apps/packages, shared source/config packages, TypeScript project
  references, or dependency-hoisting workarounds.
- Changing any Alchemy logical ID, physical-name formula, binding name/value,
  secret type, compatibility setting, Container/DO setting, or migration.
- Dependency upgrades or lockfile resolution updates unrelated to importer
  relocation.
- Application, schema, auth, UI, route, API, domain, runner, or protocol changes.
- Regenerating `routeTree.gen.ts`, migrations, migration metadata, or generated
  Alchemy/Wrangler output.
- Deploying, destroying, importing, backing up, or migrating cloud resources.

## Git workflow

- Branch: `advisor/024-alchemy-monorepo-organization`
- Use two conventional commits:
  1. `refactor(repo): organize app and runner packages`
  2. `docs(repo): document monorepo ownership`
- Do not push, deploy, destroy, or open a PR unless explicitly authorized.

## Steps

### Step 1: Establish the current verification baseline

Before editing:

```bash
pnpm install --frozen-lockfile
npm ci --prefix sandbox/runner
pnpm verify
pnpm list --recursive --depth Infinity --json | node -e '
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const found = new Set();
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.name && value.version) found.add(`${value.name}@${value.version}`);
    for (const key of ["dependencies", "devDependencies", "optionalDependencies"])
      for (const [name, dependency] of Object.entries(value[key] ?? {})) {
        if (dependency?.version) found.add(`${name}@${dependency.version}`);
        walk(dependency);
      }
  };
  for (const root of JSON.parse(input)) walk(root);
  console.log([...found].sort().join("\n"));
});
' > /tmp/ditto-pnpm-versions.before
git status --short
```

Expected: full baseline passes with the current app/runner suites and the
resolved pnpm version inventory is captured outside the checkout. The working
tree contains only the pre-existing Plan 024/index changes. If source/config is
dirty, preserve it or STOP when ownership is unclear.

Do not commit this step.

### Step 2: Move the web app and runner with Git history

Use `git mv`; do not copy/delete manually:

```bash
mkdir -p apps/web packages
git mv src public migrations types apps/web/
git mv .cta.json components.json drizzle.config.ts tsconfig.json vite.config.ts apps/web/
git mv sandbox/runner packages/sandbox-runner
```

Do not regenerate the route tree or migrations. Do not edit application or
runner source merely because its path changed.

**Verify**:

```bash
git diff HEAD --summary -M
find apps/web -maxdepth 1 -mindepth 1 -print | sort
find packages/sandbox-runner -maxdepth 1 -mindepth 1 -print | sort
```

Expected: `git diff HEAD` includes staged `git mv` changes and reports moves;
`apps/web` contains source/assets/migrations/types and conventional configs; the
runner contains the same manifest, lock, configs, and source at its new path.

### Step 3: Define package ownership and root orchestration

1. Create `apps/web/package.json` from the current root manifest:
   - name `@ditto/web`, `private: true`, `type: "module"`;
   - preserve `imports: { "#/*": "./src/*" }`;
   - move all application runtime dependencies into it;
   - move app build, preview, test, typecheck, and Drizzle scripts into it;
   - keep `doctor` root-owned because existing Claude/Cursor hooks resolve the
     root `react-doctor` binary;
   - move app build/test/type dependencies into it;
   - declare Alchemy in `apps/web` because `vite.config.ts` imports
     `alchemy/cloudflare/tanstack-start` under pnpm's strict package boundary;
   - preserve every existing dependency specifier exactly.
2. Reduce root `package.json` to orchestration and root-owned tooling:
   - preserve name/private/type, package manager, and Node engine;
   - keep `alchemy` under root dependencies and `dotenv` under root
     devDependencies for `alchemy.run.ts`;
   - keep `@biomejs/biome`, `lefthook`, and `react-doctor` under root
     devDependencies; existing `.claude` and `.cursor` hooks require the root
     `react-doctor` binary;
   - move every other current dependency/devDependency to `apps/web`, preserving
     its current dependency section, except that `alchemy` is also declared in
     the web package because `vite.config.ts` imports its plugin;
   - preserve every existing root script name: `dev`, `build`, `preview`,
     `test`, `typecheck`, `format`, `lint`, `check`, `fix`, `runner:install`,
     `runner:verify`, `verify`, `deploy`, `destroy`, all five `db:*` scripts,
     and `doctor`;
   - delegate app-owned commands with `pnpm --filter @ditto/web <script>`;
   - keep root Biome/Lefthook and doctor scripts direct;
   - update runner commands only by replacing their prefix path with
     `packages/sandbox-runner`;
   - keep `dev`, `deploy`, and `destroy` as direct Alchemy commands;
   - keep `verify` ordered as root check → web typecheck/test/build → runner
     typecheck/test/build.
3. Add only `apps/*` under `packages:` in `pnpm-workspace.yaml`. Preserve the
   existing install policy. Do not include `packages/*`.
4. Regenerate the pnpm lockfile without upgrades:

   ```bash
   pnpm install --lockfile-only --offline
   ```

   The baseline install populated the local store; `--offline` prevents moving
   `latest`/range specifiers from consulting newer registry metadata. The
   lockfile importer section may split into root and `apps/web`; resolved
   package versions must not change merely because ownership moved.
5. Compare the installed pnpm package/version inventory captured in Step 1 with
   the post-move inventory. Importer paths may change; the sorted set of
   resolved package names and versions must not.

**Verify**:

```bash
git add -N apps/web/package.json
pnpm install --frozen-lockfile
npm ci --prefix packages/sandbox-runner
pnpm --filter @ditto/web typecheck
pnpm --filter @ditto/web test
npm run typecheck --prefix packages/sandbox-runner
npm test --prefix packages/sandbox-runner
pnpm list --recursive --depth Infinity --json | node -e '
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const found = new Set();
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.name && value.version) found.add(`${value.name}@${value.version}`);
    for (const key of ["dependencies", "devDependencies", "optionalDependencies"])
      for (const [name, dependency] of Object.entries(value[key] ?? {})) {
        if (dependency?.version) found.add(`${name}@${dependency.version}`);
        walk(dependency);
      }
  };
  for (const root of JSON.parse(input)) walk(root);
  console.log([...found].sort().join("\n"));
});
' > /tmp/ditto-pnpm-versions.after
diff -u /tmp/ditto-pnpm-versions.before /tmp/ditto-pnpm-versions.after
git diff HEAD -- package.json apps/web/package.json pnpm-workspace.yaml pnpm-lock.yaml
```

Expected: both package boundaries install and verify; workspace membership is
only `apps/*`; runner remains npm-owned; dependency inventory diff is empty;
lockfile changes are importer/manifest relocation rather than upgrades.

### Step 4: Repoint Alchemy, app config, Docker, hooks, and CI

1. In root `alchemy.run.ts`, make exactly four semantic path changes:
   - `D1Database.migrationsDir` → `"./apps/web/migrations"` for Alchemy's
     root-run migration discovery;
   - add `cwd: "apps/web"` to `TanStackStart("website", ...)`;
   - in the existing Wrangler transform, map the `DB` entry in
     `spec.d1_databases` to `migrations_dir: "../../migrations"`; Wrangler
     resolves this generated field from `apps/web/.alchemy/local`;
   - change only the Container image path inside the existing Wrangler
     transform from `../../Dockerfile` to `../../../../Dockerfile` for the same
     generated-config-relative reason.
2. Preserve all other Alchemy code byte-for-byte where formatting permits:
   resource IDs, physical names, bindings, secret wrappers, D1 migration table,
   Container settings other than the image path, `wrangler.main`, migration
   `v1`, and `app.finalize()`.
3. In `apps/web/types/env.d.ts`, change only the type import path to
   `../../../alchemy.run.ts`; preserve inferred `website.Env` typing.
4. In `apps/web/tsconfig.json`:
   - keep `#/*` and `@/*` relative to `./src/*`;
   - keep app source/types included;
   - include `../../alchemy.run.ts` so the app typecheck covers infrastructure;
   - remove the obsolete `sandbox/runner` exclusion;
   - keep generated/build exclusions package-relative.
5. Keep `drizzle.config.ts`, `components.json`, and `.cta.json` semantically
   unchanged because their relative paths remain correct from `apps/web`.
6. In `apps/web/vite.config.ts`, preserve all existing plugins and the
   `.alchemy/local/wrangler.jsonc` check, and add `envDir: "../.."` to the Vite
   config. Root `.env*` files remain the single environment source; without
   `envDir`, standalone filtered build/test commands would search only
   `apps/web` and miss required public configuration.
7. Change only the Docker source path to
   `packages/sandbox-runner`; preserve every image destination and command.
8. Update `.dockerignore` from `sandbox/runner/**` to
   `packages/sandbox-runner/**`, keep that package included, and exclude
   `apps/**` from the root image context because the Dockerfile does not copy the
   web app.
9. Keep `biome.json` and `lefthook.yml` byte-for-byte unchanged. Their recursive
   globs and root-script calls already cover nested workspace source.
10. Keep `.claude/hooks/react-doctor.sh` and
    `.cursor/hooks/react-doctor.sh` byte-for-byte unchanged; the root
    `react-doctor` dependency keeps their local-binary path working.
11. Update `.github/workflows/ci.yml` cache and install paths from
   `sandbox/runner` to `packages/sandbox-runner`; keep `pnpm verify` as the
   single CI gate.

**Verify**:

```bash
pnpm verify
rg -n 'cwd: "apps/web"|migrationsDir: "\./apps/web/migrations"|migrations_dir: "\.\./\.\./migrations"|image: "\.\./\.\./\.\./\.\./Dockerfile"' alchemy.run.ts
rg -n 'envDir: "\.\./\.\."' apps/web/vite.config.ts
test -x node_modules/.bin/react-doctor
rg -n 'sandbox/runner' \
  package.json pnpm-workspace.yaml alchemy.run.ts Dockerfile .dockerignore \
  biome.json lefthook.yml .github apps packages
rg -n '/opt/ditto-runner/dist/(cli|control-cli)\.js' apps/web packages/sandbox-runner Dockerfile
```

Expected: full gate passes; all four Alchemy paths and Vite's root `envDir`
match; the root React Doctor binary exists; the old runner path search returns
no matches; absolute runtime CLI/control paths remain in live source/tests.

Review this command manually:

```bash
git diff HEAD -- alchemy.run.ts Dockerfile
```

Expected: Alchemy shows only `cwd`, root and generated-config-relative migration
paths, and generated-config-relative Docker image path changes; Docker shows
only the runner source path.
Any resource/binding/runtime change is a STOP.

**Commit**: `refactor(repo): organize app and runner packages`

### Step 5: Prove the local Alchemy flow still owns the whole system

1. Start `pnpm dev` from the repository root.
2. Confirm Alchemy writes generated local config below
   `apps/web/.alchemy/local`, starts Vite with `apps/web` as cwd, and prints a
   local URL.
3. Request that URL and confirm the application responds.
4. Stop development normally. Do not commit generated `.alchemy`, `.wrangler`,
   `dist`, or route-tree output.
5. Inspect generated config by key names only. Confirm it still contains the
   existing binding names `DB`, `Sandbox`, and `BACKUP_BUCKET`, the Sandbox
   Container/DO class, and migration tag `v1`. Never print secret values.

**Verify**:

```bash
test -f apps/web/.alchemy/local/wrangler.jsonc
LOCAL_URL="<copy the URL printed by pnpm dev>"
curl -fsSL -o /dev/null "$LOCAL_URL"
node --input-type=module <<'EOF'
import { readFile } from "node:fs/promises";
const config = JSON.parse(
  await readFile("apps/web/.alchemy/local/wrangler.jsonc", "utf8"),
);
const checks = [
  config.d1_databases?.some(
    (item) =>
      item.binding === "DB" && item.migrations_dir === "../../migrations",
  ),
  config.r2_buckets?.some((item) => item.binding === "BACKUP_BUCKET"),
  config.durable_objects?.bindings?.some(
    (item) => item.name === "Sandbox" && item.class_name === "Sandbox",
  ),
  config.containers?.some(
    (item) =>
      item.class_name === "Sandbox" &&
      item.image === "../../../../Dockerfile" &&
      item.instance_type === "lite" &&
      item.max_instances === 1,
  ),
  config.migrations?.some(
    (item) =>
      item.tag === "v1" && item.new_sqlite_classes?.includes("Sandbox"),
  ),
];
if (!checks.every(Boolean)) process.exit(1);
EOF
git status --short
```

Expected: generated Wrangler config exists under the web package, the app
responds, and the silent structural assertion exits 0 without printing config
values. Only intended tracked moves/config changes appear; generated local
output remains ignored.

No cloud deploy is required. If local Alchemy cannot resolve the app package,
fix only package/path configuration covered by this plan; do not split
infrastructure ownership.

### Step 6: Update repository and architecture documentation

1. Update `README.md` install, development, database, script, runner, Docker, and
   infrastructure paths.
2. Update `docs/README.md` reading paths to `apps/web/src/**` and
   `packages/sandbox-runner/**`.
3. Update all `docs/architecture/*.md` path references while preserving domain
   language and architectural decisions.
4. Rewrite `docs/architecture/repository-map.md` to reflect:
   - root orchestration and Alchemy ownership;
   - `apps/web` application ownership;
   - independent npm runner ownership;
   - generated paths under `apps/web`;
   - current checked-in files after the move.
5. Document explicitly that Alchemy remains the sole deployment owner and that
   this plan added no SST/Wrangler deployment boundary.

**Verify**:

```bash
rg -n 'sandbox/runner|(^|[^/])src/|(^|[^/])migrations/' \
  README.md docs --glob '!docs/operations/**'
pnpm verify
git status --short
```

Expected: old live paths are gone except clearly historical discussion; full
verification still passes; documentation names the final ownership correctly.

**Commit**: `docs(repo): document monorepo ownership`

## Test plan

No new application tests are required because behavior must not change.
Verification consists of:

- all existing web tests passing after relocation;
- all existing runner tests passing from the new npm-package path;
- app and infrastructure typechecking through `apps/web/tsconfig.json`;
- production Vite build succeeding from the web package;
- runner build preserving both absolute CLI outputs;
- local `alchemy dev` generating config under `apps/web/.alchemy/local` and
  serving the application;
- generated config retaining existing binding/container/DO/migration keys;
- Git rename detection proving generated route/migration files were moved, not
  regenerated.

Use these moved tests as behavior authorities:

- `apps/web/src/lib/sandbox-bootstrap.test.ts`
- `apps/web/src/lib/project-sandbox.test.ts`
- `apps/web/src/lib/sandbox-backup.test.ts`
- `apps/web/src/lib/agent-run.test.ts`
- `apps/web/src/lib/agent-control-service.test.ts`
- `packages/sandbox-runner/src/protocol.test.ts`
- `packages/sandbox-runner/src/control-channel.test.ts`
- `packages/sandbox-runner/src/run-agent.test.ts`

## Done criteria

ALL must hold:

- [ ] `pnpm install --frozen-lockfile` exits 0.
- [ ] `npm ci --prefix packages/sandbox-runner` exits 0.
- [ ] `pnpm verify` exits 0 with all app and runner checks/tests/builds.
- [ ] pnpm workspace membership is only `apps/*`.
- [ ] `apps/web/package.json` owns app dependencies/scripts; root owns
      orchestration/Alchemy; runner remains independent npm.
- [ ] App source/assets/migrations/types/config live under `apps/web`.
- [ ] Runner lives under `packages/sandbox-runner` with its original npm lock.
- [ ] `alchemy.run.ts` has only the required `cwd`, root/generated migration
      paths, and generated-config-relative Docker image path changes; its
      complete resource graph remains intact.
- [ ] Docker has only the runner source-path semantic change and still produces
      the same absolute CLI/control paths.
- [ ] Vite reads root `.env*` through `envDir: "../.."`; React Doctor remains
      installed at root for existing hooks.
- [ ] Local Alchemy dev writes config below `apps/web/.alchemy/local`, retains
      `DB`, `Sandbox`, `BACKUP_BUCKET`, Container/DO, and migration `v1`, and
      serves the app.
- [ ] No SST, separate Wrangler deployment, Turborepo, shared package,
      dependency upgrade, generated migration, or behavior change was added.
- [ ] README and architecture docs describe the final tree and sole Alchemy
      ownership.
- [ ] No files outside Scope were modified.
- [ ] `plans/README.md` Plan 024 row is updated.

## STOP conditions

Stop and report; do not improvise if:

- Baseline verification fails before relocation.
- The live Alchemy resource graph differs materially from Current state.
- Alchemy does not resolve `TanStackStart.cwd` or generated config relative to
  `apps/web` as documented by the installed version.
- The move appears to require changing an Alchemy logical ID, physical name,
  binding, secret, compatibility setting, Container/DO setting, or migration.
- The move appears to require changing application/runner behavior or protocol.
- pnpm cannot keep the runner outside workspace membership.
- Lockfile regeneration upgrades resolved dependencies rather than relocating
  importers.
- A generated route tree or migration would need regeneration.
- A command would expose secret values.
- A verification fails twice after one reasonable path/config correction.
- Any out-of-scope file or architecture change is required.

## Maintenance notes

- New deployable web code belongs in `apps/web`; root remains orchestration and
  Alchemy infrastructure.
- Keep tool-discovered app configs at `apps/web` root unless a tool natively
  supports another location and a measured need justifies it.
- Keep the runner independent until there is a concrete reason to abandon its
  npm lock/image boundary.
- Keep root Docker context while it must copy `packages/sandbox-runner`; moving
  the Dockerfile under `apps/web` or the runner package would change build
  context semantics.
- Revisit SST or split deployment ownership only when Alchemy creates a measured
  limitation—not as part of repository organization.
