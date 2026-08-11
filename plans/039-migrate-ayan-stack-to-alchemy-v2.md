# Plan 039: Migrate ayan-named resources to Alchemy v2 stage dev

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. This is a deliberately destructive migration of the disposable
> `ayan` stack: it does not preserve D1 rows, R2 objects, Durable Object state,
> Sandbox processes, previews, or uptime. If anything in the **STOP
> conditions** section occurs, stop and report — do not adopt resources, widen
> the scope, or improvise a continuity path. When done, update this plan's row
> in `plans/README.md` and append a redacted execution-evidence section to this
> file.
>
> **Local-first scope override (2026-08-11)**: The operator is on Cloudflare's
> free plan and requires a locally solid migration before any paid-plan deploy.
> Remote inventory, destroy, dry-run, deploy, acceptance, recreate, and rollback
> Steps 2 and 7–11 are deferred and must not run from this plan. A future cloud
> cutover requires a refreshed plan. Local runtime evidence supersedes the
> original Effect pin: Alchemy beta.70's Node CLI requires exact Effect beta.103,
> `@effect/platform-node` beta.103, and the coherent beta.103 workspace overrides;
> beta.106 crashes before command execution.
>
> **Stage rename (2026-08-11)**: The accepted Alchemy v2 stage identifier is
> `dev`, not `ayan`; local/v2 commands and v2 state use `--stage dev` and
> `.alchemy/state/ditto/dev`. Existing physical Cloudflare resource names retain
> `ayan`, and any future v1 cleanup still targets the historical v1 stage `ayan`.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat d44012a..HEAD -- \
>   package.json pnpm-lock.yaml alchemy.run.ts README.md \
>   apps/web/package.json apps/web/vite.config.ts apps/web/types/env.d.ts \
>   Dockerfile apps/web/src/server.ts apps/web/src/lib/sandbox-bootstrap.ts
> ```
>
> If an in-scope file changed since this plan was written, compare the current
> state excerpts below against live code before proceeding. If the dependency
> graph, resource names, binding names, Worker entry, Sandbox version/transport,
> or deployment ownership differs, STOP and refresh the plan. Preserve all
> unrelated work; execute from a clean dedicated worktree.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH — destructive remote infrastructure recreation and beta IaC migration
- **Depends on**: none
- **Category**: migration
- **Planned at**: commit `d44012a`, 2026-08-09
- **Branch**: `advisor/039-alchemy-v2-ayan-recreation`
- **Execution status**: DONE-local — stage rename approved at `e3abdee` on
  2026-08-11 after the full local acceptance at `5189054`; Alchemy v2 local
  provider, automatic root Docker build, D1/R2/Container/Worker
  graph, SSR/assets, and unauthenticated routing passed. Cloud cutover remains
  deferred until a paid-plan migration is separately refreshed. No Cloudflare
  resource was changed.

## Why this matters

Ditto's sole deployment graph still uses Alchemy v1 (`0.93.x`) while the next
architecture depends on Alchemy v2's explicit Stack/provider model. This plan
moves only the disposable `ayan` development stack to the exact approved beta,
without combining the migration with the Brain, Workflow, Trusted Git Executor,
or Sandbox SDK `@next` work. Destroying v1 before creating v2 avoids pretending
that the incompatible state stores can provide continuity or ownership transfer.

The successful end state is a cleanly converged Alchemy v2 stack with the same
runtime binding names and fixed Cloudflare physical names, stable Sandbox
`0.12.3` RPC behavior, verified SSR/assets/preview routing, and a rehearsed
fresh-v1 rollback that never runs v1 destroy after v2 owns the names.

## Non-negotiable decisions

These are part of this plan, not questions for the executor:

1. The Alchemy v2 target is stage `dev`; every v2 Alchemy command must contain
   explicit `--stage dev`, or use a package script that hard-codes it. The
   historical v1 source stage remains `ayan` only for deferred cleanup.
2. Pin exactly `alchemy@2.0.0-beta.70`, `effect@4.0.0-beta.103`, and
   `@effect/platform-node@4.0.0-beta.103` at the root, with the coherent Effect
   beta.103 workspace overrides. Beta.104+ removes `Schema.TaggedErrorClass`
   while Alchemy beta.70 still calls it. No floating range is acceptable.
3. Use `Alchemy.Stack("ditto", { providers: Cloudflare.providers(), state:
   Alchemy.localState() }, ...)`. Do not bootstrap `Cloudflare.state()`.
4. Destroy v1 first, prove the named resources and route absent, retire v1 local
   state, and then create v2 from empty local state without `--adopt`.
5. Preserve these physical names exactly:
   - D1: `ditto-ayan-db`
   - R2: `ditto-ayan-sandbox-backups`
   - Worker: `ditto-website-ayan`
   - ContainerApplication: `ditto-sandbox-ayan`
   - Worker route: `*.ayn.wtf/*` in zone `ayn.wtf`
6. The `ayn.wtf` zone and existing proxied wildcard DNS record remain external
   infrastructure. This stack owns the Worker route, not wildcard DNS.
7. Keep `@cloudflare/sandbox` and `docker.io/cloudflare/sandbox` at `0.12.3` and
   keep `getSandbox(..., { transport: "rpc" })`. This is not the Sandbox
   `@next` cutover.
8. Preserve all existing Worker binding keys and plain-versus-redacted
   classification. Do not rename a binding to match a documentation example.
9. Claim no data, process, preview, or uptime continuity. Rollback recreates an
   empty v1 stack; it does not restore prior state.

## Current state

### Repository ownership and verification

- `README.md:13-21` defines the root as the Alchemy deployment owner and
  `apps/web` as the TanStack Start application. Alchemy remains the sole deploy
  boundary; do not introduce Wrangler-as-deploy, SST, or another IaC system.
- `package.json:5-25` contains the authoritative commands. The full local/CI
  gate is:

  ```json
  "verify": "pnpm check && pnpm typecheck && pnpm test && pnpm build && pnpm runner:verify"
  ```

- `.github/workflows/ci.yml:35-50` installs the pnpm workspace, separately runs
  `npm ci --prefix packages/sandbox-runner`, then runs `pnpm verify`.
- Tests are colocated `*.test.ts` / `*.test.tsx`. Infrastructure-sensitive
  existing coverage includes:
  - `apps/web/src/server.test.ts` — Worker routing and preview proxy fallthrough;
  - `apps/web/src/lib/sandbox-bootstrap.test.ts` — Sandbox lifecycle, runner
    health, and backup calls;
  - `apps/web/src/lib/sandbox-backup.test.ts` — backup configuration;
  - `apps/web/src/lib/session-preview.test.ts` — stable Sandbox preview URLs,
    exposure, and readiness;
  - `apps/web/src/db/session-preview-migration.test.ts` — D1 migration behavior.

### Alchemy v1 stack to replace

`alchemy.run.ts:1-13` uses v1 imports and lifecycle:

```ts
import alchemy from "alchemy";
import {
  Container,
  D1Database,
  R2Bucket,
  Route,
  TanStackStart,
} from "alchemy/cloudflare";

const app = await alchemy("ditto");
```

`alchemy.run.ts:15-34` defines the stable Sandbox image, D1, and R2 graph:

```ts
const sandbox = await Container("sandbox", {
  className: "Sandbox",
  build: { context: ".", dockerfile: "Dockerfile" },
  instanceType: "lite",
  maxInstances: 1,
});

const database = await D1Database("database", {
  name: `${app.name}-${app.stage}-db`,
  migrationsDir: "./apps/web/migrations",
  migrationsTable: "drizzle_migrations",
});

const sandboxBackupBucketName = `${app.name}-${app.stage}-sandbox-backups`;
const sandboxBackups = await R2Bucket("sandbox-backups", {
  name: sandboxBackupBucketName,
});
```

`alchemy.run.ts:36-100` defines `TanStackStart("website")`, bindings, a custom
Wrangler transform, and a separately adopted preview route. The bindings that
must remain byte-for-byte identical in name are:

```text
DB
Sandbox
BACKUP_BUCKET
BACKUP_BUCKET_NAME
CLOUDFLARE_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
USE_LOCAL_BUCKET_BACKUPS
BETTER_AUTH_SECRET
BETTER_AUTH_URL
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
GITHUB_APP_ID
GITHUB_APP_PRIVATE_KEY
VITE_GITHUB_APP_INSTALL_URL
OPENCODE_API_KEY
AI_CREDENTIALS_ENCRYPTION_KEY
SANDBOX_TRANSPORT
PREVIEW_BASE_HOST
```

The redacted/secret bindings are exactly:

```text
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
BETTER_AUTH_SECRET
GITHUB_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY
OPENCODE_API_KEY
AI_CREDENTIALS_ENCRYPTION_KEY
```

All other named values above are plain bindings. In Alchemy v2 beta.70,
`Config.string(...)` in a Worker `env` is still deployed as `secret_text`, so
plain values must remain literals or `process.env` strings. Use
`Config.redacted(...)` only for the seven redacted names.

`alchemy.run.ts:95-104` currently adopts the route and finalizes v1:

```ts
await Route("session-previews", {
  pattern: "*.ayn.wtf/*",
  script: website,
  adopt: true,
  dev: true,
});

console.log({ url: website.url });
await app.finalize();
```

The v2 graph must have no `adopt` property and no `finalize()`.

### Worker, Vite, environment types, and Sandbox protocol

- `apps/web/src/server.ts:1-4` imports the stable Sandbox SDK, uses the TanStack
  server entry, and exports `Sandbox` from `@cloudflare/sandbox`.
- `apps/web/src/server.ts:77-90` calls `proxyToSandbox()` before TanStack SSR and
  rejects unmatched production preview subdomains. Preserve this custom Worker
  entry unchanged.
- `apps/web/src/lib/sandbox-bootstrap.ts:22-30` creates the Sandbox with:

  ```ts
  getSandbox(env.Sandbox, sandboxId, {
    enableDefaultSession: false,
    transport: "rpc",
  });
  ```

  This plan must not change those options.
- `Dockerfile:1` is exactly:

  ```dockerfile
  FROM docker.io/cloudflare/sandbox:0.12.3
  ```

- `apps/web/package.json:19-22` pins `@cloudflare/sandbox` to `0.12.3`.
- `apps/web/vite.config.ts:1-8,62-94` imports the v1
  `alchemy/cloudflare/tanstack-start` plugin and conditionally inserts it only
  when `.alchemy/local/wrangler.jsonc` exists. Alchemy v2 injects its Vite
  integration; remove only this v1 plugin/gate while preserving TanStack,
  React, Tailwind, devtools, Babel, `envDir: "../.."`, and
  `sessionPreviewDevProxy()`.
- `apps/web/types/env.d.ts:1-16` currently derives `Env` from
  `typeof website.Env`. Replace that with the exported v2 `WebsiteEnv`; do not
  hand-maintain a second binding interface.
- `apps/web/tsconfig.json:1-3` already includes `../../alchemy.run.ts` and the
  env type file, so root stack typing remains part of `pnpm typecheck`.

### Dependency state

- Root `package.json:27-29` declares floating v1 `alchemy: "^0.93.11"`.
- `apps/web/package.json:41` duplicates Alchemy v1.
- `apps/web/package.json:70-72` declares the v1-era
  `@cloudflare/vite-plugin`.
- The current lock resolves Alchemy v1 and an older transitive Effect beta.
  Replace these with exact direct root pins; do not leave duplicate or floating
  Alchemy/Effect entries.

### Generated and local artifacts

`.gitignore:9-10` ignores `.wrangler` and `.alchemy`. Generated Wrangler/state
files may contain secret-bearing material. Never paste them into evidence,
commit them, or hand-edit them. It is acceptable to inspect binding **names and
types only** and to archive old state in a mode-`0700` local directory.

## Target Alchemy v2 code shape

Implement this shape in `alchemy.run.ts`; naming variations are acceptable only
when they do not alter logical IDs, physical names, or exports:

```ts
import path from "node:path";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { config } from "dotenv";
import type { Sandbox as SandboxDurableObject } from "./apps/web/src/server.ts";

const repoRoot = import.meta.dirname;
config({
  path: [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")],
});

const sandboxBackupBucketName = "ditto-ayan-sandbox-backups";

const Database = Cloudflare.D1.Database("database", {
  name: "ditto-ayan-db",
  migrationsDir: path.join(repoRoot, "apps/web/migrations"),
  migrationsTable: "drizzle_migrations",
});

const SandboxBackups = Cloudflare.R2.Bucket("sandbox-backups", {
  name: sandboxBackupBucketName,
});

const SandboxContainer = Cloudflare.Container<SandboxDurableObject>("sandbox", {
  name: "ditto-sandbox-ayan",
  className: "Sandbox",
  context: repoRoot,
  dockerfile: path.join(repoRoot, "Dockerfile"),
  instanceType: "lite",
  maxInstances: 1,
});

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
    BACKUP_BUCKET_NAME: sandboxBackupBucketName,
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    R2_ACCESS_KEY_ID: Config.redacted("R2_ACCESS_KEY_ID"),
    R2_SECRET_ACCESS_KEY: Config.redacted("R2_SECRET_ACCESS_KEY"),
    USE_LOCAL_BUCKET_BACKUPS: process.env.USE_LOCAL_BUCKET_BACKUPS ?? "",
    BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "",
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "",
    GITHUB_CLIENT_SECRET: Config.redacted("GITHUB_CLIENT_SECRET"),
    GITHUB_APP_ID: process.env.GITHUB_APP_ID ?? "",
    GITHUB_APP_PRIVATE_KEY: Config.redacted("GITHUB_APP_PRIVATE_KEY"),
    VITE_GITHUB_APP_INSTALL_URL:
      process.env.VITE_GITHUB_APP_INSTALL_URL ??
      "https://github.com/apps/ditto-web/installations/new/",
    OPENCODE_API_KEY: Config.redacted("OPENCODE_API_KEY"),
    AI_CREDENTIALS_ENCRYPTION_KEY: Config.redacted(
      "AI_CREDENTIALS_ENCRYPTION_KEY",
    ),
    SANDBOX_TRANSPORT: "rpc",
    PREVIEW_BASE_HOST: "ayn.wtf",
  },
});

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;

export default Alchemy.Stack(
  "ditto",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const website = yield* Website;
    return { url: website.url };
  }),
);
```

Important beta.70 facts already verified against the exact package:

- `Alchemy.localState()` is exported from `alchemy`.
- `Cloudflare.Website.Vite` accepts `rootDir` and a Vite `main` path resolved
  from that root.
- `Cloudflare.Website.Vite` accepts Worker `name`, `routes`, `env`,
  `compatibility`, and `assets` options.
- `Cloudflare.Container` accepts `name`, `className`, `context`, `dockerfile`,
  `instanceType`, and `maxInstances` and creates the container-backed Durable
  Object binding/Application together.
- JavaScript Workers receive `nodejs_compat` by default; the explicit flag above
  preserves the additional existing `nodejs_compat_populate_process_env` flag.
- Beta.70 registers both `alchemy plan` and `alchemy deploy --dry-run`; both run
  deployment planning without applying changes. This plan standardizes on
  `alchemy deploy --stage dev --dry-run` so v2 planning and deployment exercise
  the same explicit-stage command path.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Root install | `pnpm install --frozen-lockfile` | exit 0; lockfile unchanged |
| Runner install | `npm ci --prefix packages/sandbox-runner` | exit 0 |
| Full verification | `pnpm verify` | check, typecheck, web tests/build, and runner verification all pass |
| Focused tests | `pnpm --filter @ditto/web test -- src/server.test.ts src/lib/sandbox-bootstrap.test.ts src/lib/sandbox-backup.test.ts src/lib/session-preview.test.ts src/db/session-preview-migration.test.ts` | all selected tests pass |
| V2 dry run | `pnpm exec alchemy deploy --stage dev --dry-run` | reviewed create plan before first deploy; `Plan: no changes` after convergence |
| V2 deploy | `pnpm exec alchemy deploy --stage dev --yes` | deploy exits 0 and prints the website URL |
| V2 destroy | `pnpm exec alchemy destroy --stage dev --yes` | destroy exits 0 |
| D1 inventory | `pnpm --filter @ditto/web exec wrangler d1 list --json` | valid JSON account inventory |
| R2 inventory | source `/tmp/ditto-039-cloudflare-inventory.sh`; run `list_r2_buckets` | every paginated R2 bucket page projected to metadata-only JSONL |
| Container inventory | source `/tmp/ditto-039-cloudflare-inventory.sh`; run `list_container_apps` | every paginated ContainerApplication page projected to metadata-only JSONL |
| Worker inventory | `GET /accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts` with metadata-only `jq` projection | successful script inventory; assert exact ID separately |

The executor must also have `jq`, `curl`, and a Cloudflare API token with
read-only access to zone routes and Worker settings plus the permissions needed
by the existing deploy path. Never print or record the token.

## Suggested executor toolkit

- Use the Cloudflare platform skill/docs when checking current API behavior.
- Read the exact installed beta.70 declarations if a type is unclear; do not
  substitute memory or a newer beta:
  - `alchemy/Cloudflare` — `Website.Vite`, `D1.Database`, `R2.Bucket`,
    `Container`, `InferEnv`;
  - `alchemy` — `Stack`, `localState`;
  - `effect/Config` and `effect/Effect`.
- Primary references:
  - <https://alchemy.run/migrating-from-v1/>
  - <https://alchemy.run/cloudflare/frontend/vite/>
  - <https://alchemy.run/environments/secrets/>
  - <https://alchemy.run/environments/stages/>

The generic migration guide recommends adoption for retained resources. That is
intentionally **not** the route here: this stage is destroyed and recreated.

## Scope

### In scope — the only source/config files to modify

- `package.json` — exact root pins and dev-only Alchemy v2 scripts.
- `pnpm-lock.yaml` — lock changes caused only by the exact dependency update and
  web dependency removal.
- `pnpm-workspace.yaml` — exact coherent Effect beta.103 overrides required by
  Alchemy beta.70's Node runtime.
- `alchemy.run.ts` — complete v1-to-v2 resource graph rewrite.
- `apps/web/package.json` — remove duplicate `alchemy` and
  `@cloudflare/vite-plugin`; keep Sandbox `0.12.3`.
- `apps/web/vite.config.ts` — remove only the v1 Alchemy Vite plugin/gate.
- `apps/web/types/env.d.ts` — alias the exported `WebsiteEnv`.
- `README.md` — document dev-only Alchemy v2 scripts, local v2 state,
  destructive recreation, and exact deployment commands.
- `plans/039-migrate-ayan-stack-to-alchemy-v2.md` — append redacted execution
  evidence and final status.
- `plans/README.md` — update the status row after execution.

### Generated local artifacts allowed but never committed

- `.alchemy/**`
- `.wrangler/**`
- `apps/web/.alchemy/**`
- `apps/web/.wrangler/**`
- temporary `/tmp/ditto-039-*` smoke files
- a mode-`0700` retired v1 state directory outside the repository

### Out of scope — do not touch

- `Dockerfile` — its first line must remain Sandbox image `0.12.3`.
- `apps/web/src/server.ts` — custom SSR/Sandbox export and proxy stay unchanged.
- `apps/web/src/lib/sandbox-bootstrap.ts` — stable RPC options stay unchanged.
- Any application schema, D1 migration, route-tree, UI, runner, Git, backup,
  authentication, agent-run, or preview behavior change.
- `.github/workflows/ci.yml`; this plan does not add remote deployment to CI or
  shared state.
- `CONTEXT.md`, `.scratch/**`, `docs/research/**`, or any Wayfinder material.
- Any Brain, Workflow, Trusted Git Executor, new Durable Object, new migration,
  Sandbox `@next`, terminal, shell, or compatibility-adapter resource.
- Wildcard DNS creation/adoption or `ayn.wtf` zone ownership.
- Plans 034–036; they are superseded and must not be restored or executed.
- Production or any Alchemy v2 stage other than `dev`; historical v1 `ayan`
  is allowed only in deferred cleanup/rollback steps.

## Git workflow

- Work from a clean dedicated branch/worktree named
  `advisor/039-alchemy-v2-ayan-recreation`.
- Match the repository's Conventional Commit style. Suggested commits:
  1. `chore(infra): migrate ayan stack to Alchemy v2`
  2. `docs(infra): record Alchemy v2 ayan cutover evidence`
- Do not push or open a pull request unless the operator separately requests it.
- Do not commit generated `.alchemy`/`.wrangler` files or any environment file.

## Steps

### Step 1: Establish a clean baseline and freeze rollback identity

1. Start in a clean dedicated worktree. `git status --short` must be empty.
2. Record, without secrets, the rollback identity in an exact sourceable file:

   ```bash
   set -euo pipefail
   umask 077
   ROLLBACK_SHA="$(git rev-parse HEAD)"
   ROLLBACK_LOCK_SHA="$(sha256sum pnpm-lock.yaml | cut -d' ' -f1)"
   printf 'ROLLBACK_SHA=%q\nROLLBACK_LOCK_SHA=%q\n' \
     "$ROLLBACK_SHA" "$ROLLBACK_LOCK_SHA" \
     > /tmp/ditto-039-cutover.env
   chmod 600 /tmp/ditto-039-cutover.env
   ```

   Also record `node --version`, `pnpm --version`, Wrangler version, and the
   current exact installed Alchemy v1 version from the lockfile. Later command
   blocks do not inherit shell variables: before every use, run
   `source /tmp/ditto-039-cutover.env` and validate the required variable with
   `${VARIABLE:?}`. Copy only non-secret values into the final evidence.
3. Confirm the Dockerfile and application package both say `0.12.3`, and confirm
   the source still contains `transport: "rpc"`.
4. Confirm the external prerequisites before any destroy:
   - Cloudflare deployment authentication works;
   - `CLOUDFLARE_ACCOUNT_ID` is present;
   - a `CLOUDFLARE_API_TOKEN` suitable for metadata/route checks is present;
   - the `ayn.wtf` zone resolves uniquely and the proxied wildcard DNS record is
     already present;
   - an operator-designated, installation-accessible disposable fixture project
     exists for Sandbox/Preview smoke testing;
   - no D1 row, R2 object, active Sandbox process, or preview must survive.
5. Bootstrap and run the existing gate before destructive work:

   ```bash
   pnpm install --frozen-lockfile
   npm ci --prefix packages/sandbox-runner
   pnpm verify
   ```

**Verify**:

```bash
test -z "$(git status --short)"
test "$(node -p "require('./apps/web/package.json').dependencies['@cloudflare/sandbox']")" = "0.12.3"
test "$(grep -c '^FROM docker.io/cloudflare/sandbox:0.12.3$' Dockerfile)" = "1"
rg -n 'transport: "rpc"' apps/web/src/lib/sandbox-bootstrap.ts
```

Expected: clean worktree, exact stable package/image, one RPC source match, and
`pnpm verify` exits 0. If the baseline is red, STOP; do not attribute failures
to the migration.

### Step 2: Inventory and destroy the v1 ayan stack

Before destruction, save metadata-only inventories to `/tmp/ditto-039-before-*`.
Do not save object contents, D1 rows, environment values, or generated Worker
configuration.

Resolve the zone ID without printing credentials and persist only its
non-secret identifier for later independent shell invocations:

```bash
set -euo pipefail
source /tmp/ditto-039-cutover.env
: "${CLOUDFLARE_ACCOUNT_ID:?missing CLOUDFLARE_ACCOUNT_ID}"
: "${CLOUDFLARE_API_TOKEN:?missing CLOUDFLARE_API_TOKEN}"
ZONE_ID="$({
  curl -fsS \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/zones?name=ayn.wtf&status=active"
} | jq -er '.result | if length == 1 then .[0].id else error("expected one ayn.wtf zone") end')"
printf 'ZONE_ID=%q\n' "$ZONE_ID" >> /tmp/ditto-039-cutover.env
```

Wrangler 4.111.0's Container and R2 list commands do not provide authoritative
all-page inventory for these gates. Create this metadata-only paginated helper
once and source it for every ContainerApplication and R2 presence/absence check.
It emits only non-secret resource metadata, never object contents, credentials,
or application environment:

```bash
cat >/tmp/ditto-039-cloudflare-inventory.sh <<'SH'
list_container_apps() {
  local page_token="" encoded_token url page
  while :; do
    url="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/containers/dash/applications?per_page=100"
    if [ -n "$page_token" ]; then
      encoded_token="$(jq -rn --arg value "$page_token" '$value | @uri')"
      url="${url}&page_token=${encoded_token}"
    fi
    page="$(curl -fsS \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      "$url")"
    jq -e '.success == true and (.result | type == "array")' \
      <<<"$page" >/dev/null
    jq -c '.result[] | {id, name, image, version}' <<<"$page"
    page_token="$(jq -r '.result_info.next_page_token // empty' <<<"$page")"
    [ -n "$page_token" ] || break
  done
}

list_r2_buckets() {
  local cursor="" encoded_cursor url page
  while :; do
    url="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets?per_page=1000"
    if [ -n "$cursor" ]; then
      encoded_cursor="$(jq -rn --arg value "$cursor" '$value | @uri')"
      url="${url}&cursor=${encoded_cursor}"
    fi
    page="$(curl -fsS \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      "$url")"
    jq -e '.success == true and (.result.buckets | type == "array")' \
      <<<"$page" >/dev/null
    jq -c '.result.buckets[] | {name, creation_date, location}' <<<"$page"
    cursor="$(jq -r '.result_info.cursor // empty' <<<"$page")"
    [ -n "$cursor" ] || break
  done
}
SH
chmod 600 /tmp/ditto-039-cloudflare-inventory.sh
```

Inventory D1, R2, Worker scripts, all ContainerApplication pages, and routes.
Project Worker and route API output down to metadata before writing temp files.
Confirm that every match is the disposable `ayan` graph:

```bash
set -euo pipefail
source /tmp/ditto-039-cutover.env
source /tmp/ditto-039-cloudflare-inventory.sh
: "${ZONE_ID:?missing ZONE_ID}"

pnpm --filter @ditto/web exec wrangler d1 list --json \
  >/tmp/ditto-039-before-d1.json
list_r2_buckets >/tmp/ditto-039-before-r2.jsonl
list_container_apps >/tmp/ditto-039-before-containers.jsonl
curl -fsS \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts" \
  | jq -c '.result[] | {id, created_on, modified_on}' \
  >/tmp/ditto-039-before-workers.jsonl
curl -fsS \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
  | jq -c '.result[] | {id, pattern, script}' \
  >/tmp/ditto-039-before-routes.jsonl
```

Then, while the v1 checkout and exact v1 lock still own the command, run:

```bash
pnpm exec alchemy destroy --stage ayan
```

Do not pass a different stage. After destroy, prove authoritative absence. Each
inventory request must succeed before the zero-match assertion runs; command,
authentication, pagination, and network failures are failures, never evidence of
absence:

```bash
set -euo pipefail
source /tmp/ditto-039-cutover.env
source /tmp/ditto-039-cloudflare-inventory.sh
: "${ZONE_ID:?missing ZONE_ID}"

pnpm --filter @ditto/web exec wrangler d1 list --json \
  >/tmp/ditto-039-after-destroy-d1.json
jq -e '[.[] | select(.name == "ditto-ayan-db")] | length == 0' \
  /tmp/ditto-039-after-destroy-d1.json

list_r2_buckets >/tmp/ditto-039-after-destroy-r2.jsonl
jq -s -e '[.[] | select(.name == "ditto-ayan-sandbox-backups")] | length == 0' \
  /tmp/ditto-039-after-destroy-r2.jsonl

list_container_apps >/tmp/ditto-039-after-destroy-containers.jsonl
jq -s -e '[.[] | select(.name == "ditto-sandbox-ayan")] | length == 0' \
  /tmp/ditto-039-after-destroy-containers.jsonl

curl -fsS \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts" \
  | jq -e '[.result[] | select(.id == "ditto-website-ayan")] | length == 0'

curl -fsS \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
  | jq -e '[.result[] | select(.pattern == "*.ayn.wtf/*")] | length == 0'
```

A normal successful v1 destroy removes the emptied exact state directory
`.alchemy/ditto/ayan`. First require that path to be absent. If — and only if —
all remote resources are authoritatively absent but residual files remain at
that exact path, reload `ROLLBACK_SHA`, inspect only filenames/metadata, and move
that residue to a mode-`0700` directory outside the repository keyed by the SHA.
Never commit or paste its contents. If live v1 state is found anywhere else,
STOP and identify it from the installed v1 implementation rather than guessing.
The conditional residual path is:

```bash
set -euo pipefail
source /tmp/ditto-039-cutover.env
: "${ROLLBACK_SHA:?missing ROLLBACK_SHA}"
if [ -e .alchemy/ditto/ayan ]; then
  archive="$HOME/.local/state/ditto/retired-alchemy-v1/$ROLLBACK_SHA"
  mkdir -p "$(dirname "$archive")"
  chmod 700 "$(dirname "$archive")"
  test ! -e "$archive"
  mv .alchemy/ditto/ayan "$archive"
fi
test ! -e .alchemy/ditto/ayan
```

Do not delete the external wildcard DNS record or zone.

**Verify**: all five absence checks exit 0, `.alchemy/ditto/ayan` is absent after
normal cleanup or conditional residual archival, and the future v2 path
`.alchemy/state/ditto/dev` does not exist. If any resource or route remains,
STOP before editing dependencies.

### Step 3: Pin Alchemy v2 and remove the duplicate v1 integration

Update dependencies through pnpm, not by hand-editing the lockfile:

```bash
pnpm --filter @ditto/web remove alchemy
pnpm --filter @ditto/web remove --save-dev @cloudflare/vite-plugin
pnpm add --workspace-root --save-exact \
  alchemy@2.0.0-beta.70 effect@4.0.0-beta.103 @effect/platform-node@4.0.0-beta.103
```

Update the root scripts so the repository's ordinary lifecycle commands cannot
silently select `$USER` or another stage:

```json
"dev": "cd apps/web && alchemy dev --stage dev ../../alchemy.run.ts",
"deploy": "alchemy deploy --stage dev",
"destroy": "alchemy destroy --stage dev"
```

Do not add a `plan` script; keep one documented planning path and use
`alchemy deploy --stage dev --dry-run` throughout the v2 migration, even though
beta.70 also registers the equivalent `alchemy plan` command.

**Verify**:

```bash
node --input-type=module <<'NODE'
import fs from "node:fs";
const root = JSON.parse(fs.readFileSync("package.json", "utf8"));
const web = JSON.parse(fs.readFileSync("apps/web/package.json", "utf8"));
if (root.dependencies.alchemy !== "2.0.0-beta.70") throw new Error("wrong alchemy pin");
if (root.dependencies.effect !== "4.0.0-beta.103") throw new Error("wrong effect pin");
if (root.dependencies["@effect/platform-node"] !== "4.0.0-beta.103") throw new Error("wrong platform-node pin");
if (web.dependencies.alchemy !== undefined) throw new Error("duplicate web alchemy");
if (web.devDependencies["@cloudflare/vite-plugin"] !== undefined) throw new Error("old Vite plugin remains");
for (const [name, command] of Object.entries({ dev: "cd apps/web && alchemy dev --stage dev ../../alchemy.run.ts", deploy: "alchemy deploy --stage dev", destroy: "alchemy destroy --stage dev" })) {
  if (root.scripts[name] !== command) throw new Error(`wrong ${name} script`);
}
if (web.dependencies["@cloudflare/sandbox"] !== "0.12.3") throw new Error("Sandbox package drift");
NODE

pnpm install --frozen-lockfile
pnpm why alchemy
pnpm why effect
```

Expected: exact root pins, no web Alchemy/plugin dependency, stable Sandbox
unchanged, frozen install succeeds, and no v1 Alchemy resolution remains.

### Step 4: Rewrite the resource graph as one Alchemy v2 Stack

Replace `alchemy.run.ts` with the target shape above. Preserve `.env.local` then
`.env` loading. Required details:

1. Namespace imports from `alchemy`, `alchemy/Cloudflare`, `effect/Config`, and
   `effect/Effect`.
2. A type-only import of the exported `Sandbox` Durable Object class from
   `apps/web/src/server.ts`.
3. Module-level D1, R2, Container, and Website resource declarations with exact
   logical/physical names.
4. Website root `apps/web`, custom `src/server.ts`, and
   `assets.runWorkerFirst: true`.
5. Only `nodejs_compat_populate_process_env` explicitly added; allow Alchemy v2
   to supply its default `nodejs_compat`.
6. The exact route declared on the Website, without adoption.
7. All existing binding keys and classifications.
8. `WebsiteEnv = Cloudflare.InferEnv<typeof Website>`.
9. A default `Alchemy.Stack("ditto", ...)` export using
   `Cloudflare.providers()`, `Alchemy.localState()`, and `Effect.gen`.
10. No `console.log`/`finalize()` lifecycle or v1 Wrangler transform.

Do not add placeholder resources or manually emit Durable Object migrations;
the container binding owns the existing `Sandbox` container-backed class.

**Verify**:

```bash
pnpm typecheck
rg -n 'Alchemy\.Stack|Cloudflare\.providers|Alchemy\.localState|Website\.Vite|InferEnv' alchemy.run.ts
rg -n 'ditto-ayan-db|ditto-ayan-sandbox-backups|ditto-website-ayan|ditto-sandbox-ayan|\*\.ayn\.wtf/\*' alchemy.run.ts
! rg -n 'from "alchemy/cloudflare"|await alchemy\(|app\.finalize|TanStackStart\(|D1Database\(|R2Bucket\(|await Route\(|adopt:' alchemy.run.ts
```

Expected: typecheck exits 0; required v2 constructs and fixed names are present;
all v1 constructs are absent.

### Step 5: Remove only the v1 Vite plugin and switch environment typing

In `apps/web/vite.config.ts`:

- remove `existsSync` if it becomes unused;
- remove the `alchemy/cloudflare/tanstack-start` import;
- remove `hasAlchemyWranglerConfig`, `alchemyPlugins`, and the plugin spread;
- preserve `sessionPreviewDevProxy()`, `envDir: "../.."`, build externals,
  host configuration, and the ordinary plugin order for devtools, Tailwind,
  Ditto preview proxy, TanStack Start, React, and Babel.

In `apps/web/types/env.d.ts`, import `WebsiteEnv` from the root stack and alias it:

```ts
import type { WebsiteEnv } from "../../../alchemy.run.ts";

export type CloudflareEnv = WebsiteEnv;
```

Keep the existing global `Env` and `cloudflare:workers` augmentation.

Update `README.md` to state:

- the repository uses exact Alchemy v2 beta.70 and local v2 state;
- `pnpm dev`, `pnpm deploy`, and `pnpm destroy` are v2 stage-dev-only scripts;
- this stage is disposable and has no continuity guarantee;
- a different stage or shared-state/CI deployment requires a separate plan;
- generated Alchemy/Wrangler files are secret-bearing local artifacts.

**Verify**:

```bash
! rg -n 'alchemy/cloudflare/tanstack-start|hasAlchemyWranglerConfig|alchemyPlugins' apps/web/vite.config.ts
rg -n 'sessionPreviewDevProxy|envDir: "\.\./\.\."|tanstackStart\(\)|viteReact\(\)' apps/web/vite.config.ts
rg -n 'WebsiteEnv|CloudflareEnv' apps/web/types/env.d.ts
pnpm check
pnpm typecheck
```

Expected: old plugin/gate absent, ordinary Vite configuration retained, and
check/typecheck exit 0.

### Step 6: Run local tests and review the empty-state v2 plan

Run focused infrastructure-sensitive tests, then the full gate:

```bash
pnpm --filter @ditto/web test -- \
  src/server.test.ts \
  src/lib/sandbox-bootstrap.test.ts \
  src/lib/sandbox-backup.test.ts \
  src/lib/session-preview.test.ts \
  src/db/session-preview-migration.test.ts
pnpm verify
```

With the v1 resources absent and v2 local state empty, run:

```bash
set -euo pipefail
pnpm exec alchemy deploy --stage dev --dry-run \
  | tee /tmp/ditto-039-v2-initial-plan.txt
```

The reviewed initial plan may create only the approved graph and dependency
edges: D1 `database`, R2 `sandbox-backups`, Website `website`, its `Sandbox`
container binding/Application, and `*.ayn.wtf/*` route. It must not show:

- adoption;
- any delete/update of unrelated resources;
- a different physical name or stage;
- `Cloudflare.state()` bootstrap resources;
- Brain, Workflow, Git executor, Sandbox `@next`, or additional Durable Objects;
- secret values in output.

**Verify**: focused tests and `pnpm verify` pass; dry run exits 0 and contains no
unexpected operation. If the plan is not exactly understandable and bounded,
STOP rather than approving it.

### Step 7: Deploy v2 and prove convergence/resource shape

Deploy only after the dry run is approved:

```bash
set -euo pipefail
pnpm exec alchemy deploy --stage dev --yes \
  | tee /tmp/ditto-039-v2-first-deploy.txt
```

Capture the exact public website URL from the successful stack output and
persist it for later independent shells. Replace the example value below with
the URL emitted by this deployment; do not guess it from the Worker name:

```bash
set -euo pipefail
WEBSITE_URL='https://<exact URL emitted by Alchemy>'
node -e 'const u = new URL(process.argv[1]); if (u.protocol !== "https:") process.exit(1)' \
  "$WEBSITE_URL"
printf 'WEBSITE_URL=%q\n' "$WEBSITE_URL" \
  >> /tmp/ditto-039-cutover.env
```

Refresh this assignment after every later v1 or v2 deployment before testing
that deployment. Prove all named resources exist:

```bash
set -euo pipefail
source /tmp/ditto-039-cutover.env
source /tmp/ditto-039-cloudflare-inventory.sh
: "${ZONE_ID:?missing ZONE_ID}"

pnpm --filter @ditto/web exec wrangler d1 list --json \
  >/tmp/ditto-039-present-d1.json
jq -e '[.[] | select(.name == "ditto-ayan-db")] | length == 1' \
  /tmp/ditto-039-present-d1.json

list_r2_buckets >/tmp/ditto-039-present-r2.jsonl
jq -s -e '[.[] | select(.name == "ditto-ayan-sandbox-backups")] | length == 1' \
  /tmp/ditto-039-present-r2.jsonl

list_container_apps >/tmp/ditto-039-present-containers.jsonl
jq -s -e '[.[] | select(.name == "ditto-sandbox-ayan")] | length == 1' \
  /tmp/ditto-039-present-containers.jsonl

curl -fsS \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts" \
  | jq -e '[.result[] | select(.id == "ditto-website-ayan")] | length == 1'

curl -fsS \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
  | jq -e '[.result[] | select(.pattern == "*.ayn.wtf/*" and .script == "ditto-website-ayan")] | length == 1'
```

Query the Worker script/version settings endpoint and project its response
straight into boolean assertions. Do not redirect or print the full response:
it may contain plain binding values. This command emits no binding values and
asserts the exact names/types/class plus compatibility flags:

```bash
set -euo pipefail
source /tmp/ditto-039-cutover.env
: "${CLOUDFLARE_ACCOUNT_ID:?missing CLOUDFLARE_ACCOUNT_ID}"
: "${CLOUDFLARE_API_TOKEN:?missing CLOUDFLARE_API_TOKEN}"
curl -fsS \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/ditto-website-ayan/settings" \
  | jq -e '
      .result as $r
      | ([$r.bindings[]
          | {name, type, class_name: (.class_name // null)}]
          | sort_by(.name, .type, .class_name)) as $actual
      | ([
          {name: "AI_CREDENTIALS_ENCRYPTION_KEY", type: "secret_text", class_name: null},
          {name: "ALCHEMY_CLOUDFLARE_ACCOUNT_ID", type: "plain_text", class_name: null},
          {name: "ALCHEMY_PHASE", type: "plain_text", class_name: null},
          {name: "ALCHEMY_STACK_NAME", type: "plain_text", class_name: null},
          {name: "ALCHEMY_STAGE", type: "plain_text", class_name: null},
          {name: "ALCHEMY_WORKER_NAME", type: "plain_text", class_name: null},
          {name: "ASSETS", type: "assets", class_name: null},
          {name: "BACKUP_BUCKET", type: "r2_bucket", class_name: null},
          {name: "BACKUP_BUCKET_NAME", type: "plain_text", class_name: null},
          {name: "BETTER_AUTH_SECRET", type: "secret_text", class_name: null},
          {name: "BETTER_AUTH_URL", type: "plain_text", class_name: null},
          {name: "CLOUDFLARE_ACCOUNT_ID", type: "plain_text", class_name: null},
          {name: "DB", type: "d1", class_name: null},
          {name: "GITHUB_APP_ID", type: "plain_text", class_name: null},
          {name: "GITHUB_APP_PRIVATE_KEY", type: "secret_text", class_name: null},
          {name: "GITHUB_CLIENT_ID", type: "plain_text", class_name: null},
          {name: "GITHUB_CLIENT_SECRET", type: "secret_text", class_name: null},
          {name: "OPENCODE_API_KEY", type: "secret_text", class_name: null},
          {name: "PREVIEW_BASE_HOST", type: "plain_text", class_name: null},
          {name: "R2_ACCESS_KEY_ID", type: "secret_text", class_name: null},
          {name: "R2_SECRET_ACCESS_KEY", type: "secret_text", class_name: null},
          {name: "SANDBOX_TRANSPORT", type: "plain_text", class_name: null},
          {name: "Sandbox", type: "durable_object_namespace", class_name: "Sandbox"},
          {name: "USE_LOCAL_BUCKET_BACKUPS", type: "plain_text", class_name: null},
          {name: "VITE_GITHUB_APP_INSTALL_URL", type: "plain_text", class_name: null}
        ] | sort_by(.name, .type, .class_name)) as $expected
      | ($actual == $expected)
        and ((($r.compatibility_flags // []) | sort)
          == (["nodejs_compat", "nodejs_compat_populate_process_env"] | sort))
    ' >/dev/null
```

If Cloudflare has changed a metadata type label, inspect only `{name, type,
class_name}` plus `compatibility_flags`, never values, and STOP to refresh the
plan rather than accepting a looser assertion.

Then prove convergence:

```bash
set -euo pipefail
pnpm exec alchemy deploy --stage dev --dry-run \
  | tee /tmp/ditto-039-v2-converged-plan.txt
grep -F 'Plan: no changes' /tmp/ditto-039-v2-converged-plan.txt
```

Expected: exact resource counts, exact route target, expected binding metadata,
and a no-change dry run. Any rename, duplicate, wrong binding type, or perpetual
diff is a STOP condition.

### Step 8: Run deployed D1, R2, SSR, asset, Sandbox RPC, and preview checks

#### D1 migrations

Count checked-in SQL migrations and compare with the deployed migration table;
also assert core tables exist:

```bash
set -euo pipefail
EXPECTED_MIGRATIONS="$(find apps/web/migrations -maxdepth 1 -type f -name '*.sql' | wc -l)"
ACTUAL_MIGRATIONS="$(
  pnpm --filter @ditto/web exec wrangler d1 execute ditto-ayan-db \
    --remote --json \
    --command 'SELECT COUNT(*) AS count FROM drizzle_migrations' \
  | jq -er '.[0].results[0].count'
)"
test "$ACTUAL_MIGRATIONS" = "$EXPECTED_MIGRATIONS"

pnpm --filter @ditto/web exec wrangler d1 execute ditto-ayan-db \
  --remote --json \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('projects','workspace_sessions','messages') ORDER BY name" \
  | jq -e '.[0].results | map(.name) == ["messages","projects","workspace_sessions"]'
```

If the exact Wrangler JSON envelope differs, inspect metadata only and adjust the
`jq` projection without changing the semantic assertions.

#### R2 read/write/delete

Use a non-secret random payload and remove it after comparison:

```bash
set -euo pipefail
SMOKE_KEY="alchemy-v2-smoke/$(git rev-parse --short HEAD)-$(date +%s).txt"
printf 'ditto alchemy v2 ayan smoke\n' >/tmp/ditto-039-r2-put.txt

cleanup_r2_smoke() {
  pnpm --filter @ditto/web exec wrangler r2 object delete \
    "ditto-ayan-sandbox-backups/$SMOKE_KEY" --remote \
    >/dev/null 2>&1 || true
}
trap cleanup_r2_smoke EXIT

pnpm --filter @ditto/web exec wrangler r2 object put \
  "ditto-ayan-sandbox-backups/$SMOKE_KEY" \
  --remote --file /tmp/ditto-039-r2-put.txt
pnpm --filter @ditto/web exec wrangler r2 object get \
  "ditto-ayan-sandbox-backups/$SMOKE_KEY" \
  --remote --file /tmp/ditto-039-r2-get.txt
cmp /tmp/ditto-039-r2-put.txt /tmp/ditto-039-r2-get.txt
pnpm --filter @ditto/web exec wrangler r2 object delete \
  "ditto-ayan-sandbox-backups/$SMOKE_KEY" --remote
trap - EXIT
```

#### TanStack SSR and static assets

Reload and validate the exact URL returned by the deployment under test:

```bash
set -euo pipefail
source /tmp/ditto-039-cutover.env
: "${WEBSITE_URL:?missing WEBSITE_URL}"
node -e 'const u = new URL(process.argv[1]); if (u.protocol !== "https:") process.exit(1)' \
  "$WEBSITE_URL"
```

1. `curl -fsS "$WEBSITE_URL/"` must return the Ditto HTML shell/SSR response.
2. Parse one emitted JavaScript or CSS asset URL from the HTML and request it
   directly; it must return HTTP 200 with a matching JavaScript/CSS content
   type and non-empty body.
3. Request one authenticated route while unauthenticated and confirm the
   application's normal redirect/unauthorized behavior rather than an asset 404
   or Worker exception.

Record URL host, status, content type, and response byte count only — not cookies
or bodies that may contain user data.

#### Sandbox RPC/container startup and wildcard preview routing

Use the preselected disposable fixture project through the normal authenticated
Ditto UI/API:

1. Sign in normally; do not manufacture or log session cookies.
2. Import/open the disposable fixture and trigger Project Sandbox provisioning.
3. Confirm provisioning reaches the existing `ready` state and the baked runner
   health check succeeds. This exercises the exported `Sandbox` DO,
   `@cloudflare/sandbox@0.12.3`, and RPC transport.
4. Open a Workspace Session and start its supported Vite/Next/Astro preview.
5. Capture the generated `*.ayn.wtf` URL. Confirm its hostname matches the
   existing capability/token format and resolves through the wildcard route to
   the session process.
6. `curl -fsS` the preview URL and verify the fixture's expected marker plus one
   static asset. A random unmatched `*.ayn.wtf` hostname must return the
   existing plain 404 behavior, not the Ditto app.
7. Stop the preview and confirm the URL no longer serves the process.
8. Trigger one workspace backup through the existing lifecycle and confirm a
   new backup object/handle is recorded without inspecting object contents.

This is a deployment acceptance check, not permission to modify Preview,
Sandbox, backup, auth, or fixture source. If no disposable fixture or required
credentials are available, mark the plan BLOCKED; do not claim DONE from local
mocks.

**Verify**: every subsection passes and the temporary R2 object is deleted.

### Step 9: Destroy and recreate v2 from empty state

Destroy the v2 stack:

```bash
pnpm exec alchemy destroy --stage dev --yes
```

Repeat every authoritative absence assertion from Step 2. Beta.70's successful
local-state destroy deletes the exact stack/stage directory
`.alchemy/state/ditto/dev`. Assert that exact path is absent:

```bash
test ! -e .alchemy/state/ditto/dev
```

If it remains after a successful remote destroy, STOP and investigate the failed
state cleanup; do not archive, delete, or bypass it and do not touch another
stack/stage. The absence of this directory is the proof that the next dry run
starts from empty v2 local state.

Run the dry run again; it must be the same bounded create plan as Step 6. Deploy
again, replace the stored `WEBSITE_URL` with that deployment's emitted URL, and
repeat all resource-shape and deployed checks from Steps 7–8.

**Verify**:

- all five resources/route were absent after destroy;
- second deploy began from empty v2 state;
- second post-deploy dry run says `Plan: no changes`;
- D1, R2, SSR, asset, Sandbox RPC/container, backup, and Preview checks all pass
  a second time.

### Step 10: Rehearse destructive rollback without crossing ownership

Rollback rehearsal must follow this exact ownership order:

```text
v2 owns names
  -> v2 destroy
  -> prove all names absent
  -> fresh v1 deploy from recorded rollback SHA/lock
  -> smoke v1
  -> v1 destroy while v1 still owns names
  -> prove all names absent
  -> fresh v2 deploy
```

1. Destroy v2 and repeat all absence assertions.
2. Reload and validate the rollback identity, then create a detached temporary
   worktree at that exact SHA:

   ```bash
   set -euo pipefail
   source /tmp/ditto-039-cutover.env
   : "${ROLLBACK_SHA:?missing ROLLBACK_SHA}"
   : "${ROLLBACK_LOCK_SHA:?missing ROLLBACK_LOCK_SHA}"
   test ! -e /tmp/ditto-039-v1-rollback
   git worktree add --detach /tmp/ditto-039-v1-rollback "$ROLLBACK_SHA"
   test "$(sha256sum /tmp/ditto-039-v1-rollback/pnpm-lock.yaml | cut -d' ' -f1)" \
     = "$ROLLBACK_LOCK_SHA"
   ```

3. Bootstrap that worktree with its frozen lock and independent runner lock.
   Make the same deployment environment available without committing, printing,
   or copying credentials into tracked files. If a local env file must be copied,
   use mode `0600` and delete it before removing the worktree.
4. From the v1 worktree, run the baseline `pnpm verify`, then:

   ```bash
   pnpm exec alchemy deploy --stage ayan
   ```

5. Persist the exact v1 deployment output URL as `WEBSITE_URL`, prove the same
   four physical resources and route exist, then run minimum v1 SSR, D1
   migration, stable Sandbox provisioning, and Preview routing smokes.
   This is an empty v1 recreation; no historical rows/objects are expected.
6. **While still on v1 and before any v2 deploy**, run:

   ```bash
   pnpm exec alchemy destroy --stage ayan
   ```

7. Prove all resources and route absent again. Remove copied env files and the
   temporary worktree.
8. Return to the v2 branch, assert `.alchemy/state/ditto/dev` is absent, deploy
   v2 with explicit stage `dev`, refresh the stored `WEBSITE_URL` from that output,
   and repeat Steps 7–8 one final time.
9. After v2 is redeployed, never invoke v1 destroy again.

**Verify**: rollback lock hash matched, fresh v1 deployed and passed minimum
smokes, v1 destroyed its own resources before v2 returned, final v2 deploy
passes the full matrix, and the final v2 dry run says `Plan: no changes`.

### Step 11: Record redacted evidence and finish cleanly

Append an **Execution evidence** section to this plan containing only:

- execution date and executor;
- implementation commit SHA;
- `ROLLBACK_SHA` and rollback lock hash;
- exact package versions and Sandbox package/image versions;
- each command/gate with PASS/FAIL and timestamps;
- resource names and non-secret IDs/digests where useful;
- first v2 deploy, second v2 recreate, v1 rollback rehearsal, and final v2 deploy
  outcomes;
- final website/preview hostnames (no capability query parameters, cookies, or
  credentials);
- any check not run, which prevents DONE and requires BLOCKED status.

Update `plans/README.md` from TODO to DONE only if every required local,
deployed, recreate, and rollback check passed. Otherwise use BLOCKED with the
first unmet gate. Keep the source/config diff within Scope and leave generated
local artifacts untracked/ignored.

**Verify**:

```bash
set -euo pipefail
pnpm verify
pnpm exec alchemy deploy --stage dev --dry-run \
  | tee /tmp/ditto-039-final-plan.txt
grep -F 'Plan: no changes' /tmp/ditto-039-final-plan.txt
git diff --check
git status --short
```

Expected: verification passes, final v2 state converges, diff check is clean,
and every tracked change is in the in-scope list.

## Test plan

No new application behavior is introduced, so do not create speculative unit
abstractions solely to mock Alchemy. Verification is layered as follows:

1. **Static/package contract**
   - exact root pins;
   - duplicate web Alchemy/plugin absent;
   - stable Sandbox package/image/RPC unchanged;
   - v1 import/lifecycle grep empty;
   - fixed physical names, route, Stack/provider/state, and `InferEnv` present.
2. **Focused existing tests**
   - Worker proxy/SSR route tests;
   - Sandbox bootstrap/backup tests;
   - session Preview URL/process tests;
   - D1 migration test.
3. **Full repository gate**
   - `pnpm verify` before destroy, after implementation, and at final state.
4. **Infrastructure planning**
   - initial empty-state dry run contains only the approved create graph;
   - every converged dry run prints `Plan: no changes`.
5. **Deployed acceptance**
   - exact resource and binding metadata;
   - D1 migrations/core schema;
   - R2 put/get/delete;
   - TanStack SSR and assets;
   - stable Sandbox RPC/container startup and backup;
   - wildcard Preview route/start/stop and unmatched-host 404;
   - full repetition after v2 destroy/recreate;
   - destructive v1 rollback rehearsal followed by final v2 restoration.

## Done criteria

ALL must hold:

- [ ] Only v2 stage `dev` was touched; scripts and every direct v2 command use
      explicit `--stage dev`.
- [ ] Root dependencies are exactly `alchemy@2.0.0-beta.70`,
      `effect@4.0.0-beta.103`, and `@effect/platform-node@4.0.0-beta.103`;
      coherent Effect overrides are beta.103 and the web duplicate/plugin are absent.
- [ ] `Alchemy.Stack("ditto")`, `Cloudflare.providers()`, and
      `Alchemy.localState()` own the graph.
- [ ] D1, R2, Worker, ContainerApplication, and route use the exact fixed names.
- [ ] All existing binding names and plain/redacted classifications are
      preserved; no secret value appears in plan/deploy/evidence output.
- [ ] Website uses the absolute repo-root `apps/web` path, `main: "src/server.ts"`,
      `assets.runWorkerFirst: true`, and the existing compatibility behavior.
- [ ] `WebsiteEnv = Cloudflare.InferEnv<typeof Website>` is the sole env source.
- [ ] Sandbox package/image remain `0.12.3`; RPC bootstrap is unchanged.
- [ ] No Brain, Workflow, Git executor, new DO/migration, or Sandbox `@next`
      resource/code exists.
- [ ] `pnpm verify` passes on the final implementation.
- [ ] Initial dry run was bounded to approved creates; final dry run prints
      `Plan: no changes`.
- [ ] First v2 deployment passed D1/R2/SSR/assets/Sandbox/backup/Preview checks.
- [ ] V2 destroy/recreate from empty state repeated the full checks.
- [ ] Fresh-v1 rollback deployed, smoked, and destroyed while v1 owned the
      names; final v2 restoration passed all checks.
- [ ] Wildcard DNS/zone remained external and unchanged.
- [ ] No continuity claim was made and no adoption path was used.
- [ ] `git diff --check` passes; no generated or out-of-scope file is tracked.
- [ ] Redacted execution evidence is appended and the README status row is
      accurate.

## STOP conditions

Stop and report back — do not improvise — if any of the following occurs:

- The v2 target is not exactly `dev`, a script can silently choose another
  stage, or any production/non-dev stage appears in the plan.
- The working tree is not clean, baseline `pnpm verify` fails, or current code
  does not match the resource/binding/Sandbox excerpts above.
- Any D1 data, R2 object, Durable Object state, process, preview, or uptime must
  survive; this plan has no adoption or continuity route.
- The exact Alchemy/Effect pins are unavailable, resolve to another version, or
  require a floating range.
- Beta.70's actual types/API require different binding names, physical names,
  route shape, Worker entry, or resource ownership than this plan specifies.
- V1 destroy leaves D1, R2, Worker, ContainerApplication, or route present.
- V2 dry run proposes adoption, unrelated deletes/updates, shared state-store
  bootstrap, extra resources, wrong names, or secret values.
- Deployment requires `--adopt`, programmatic adoption, or v1 state import.
- The wildcard DNS record/zone is absent or would need to become stack-owned.
- `Cloudflare.Website.Vite` cannot build the existing TanStack Start app with
  the absolute repo-root `apps/web` path and `main: "src/server.ts"`.
- The `Sandbox` container-backed Durable Object cannot deploy with exact stable
  package/image `0.12.3`, `lite`, max 1, and existing RPC behavior.
- A required binding is missing, renamed, or has the wrong plain/secret type.
- Any generated config/state containing secret-bearing data would need to be
  committed, pasted, or included in evidence.
- A deployed D1, R2, SSR, asset, Sandbox, backup, or Preview check cannot run or
  fails. Unavailable credentials/fixture/infrastructure means BLOCKED, not DONE.
- Destroy/recreate does not converge from empty state or final dry run is not
  `Plan: no changes`.
- Rollback requires v1 destroy after v2 has reclaimed the names. The only valid
  order is v2 destroy → v1 deploy → v1 destroy → v2 deploy.
- The change requires touching an out-of-scope application, runner, schema,
  migration, CI, Brain, Git, Preview, Sandbox `@next`, or wildcard-DNS file.
- A verification step fails twice after one reasonable correction inside Scope.

## Maintenance notes

- Alchemy and Effect are intentionally exact beta pins. Any future beta/GA
  upgrade is a separate verified migration: rerun typecheck, full verification,
  dry-run convergence, resource metadata, destroy/recreate, and deployed smokes.
- Local state is developer-owned and single-operator. Do not move to
  `Cloudflare.state()` casually; shared CI/operator ownership needs a separate
  state bootstrap and credential decision.
- This plan preserves stable Sandbox `0.12.3` specifically so later architecture
  decisions can evaluate Brain hosting independently. The Sandbox `@next`
  cutover must not be backported into this migration.
- Reviewers should scrutinize physical names, stage enforcement, binding
  classification, container-backed Durable Object metadata, route ownership,
  and the exact v1/v2 destroy ordering more than formatting.
- Plans 034–036 remain superseded. Preserve their useful correctness lessons
  (fail closed before credentials and authoritative failure reconciliation), but
  do not restore their obsolete runner/Sandbox ownership mechanisms.

## Execution attempt — 2026-08-11

- **Status**: BLOCKED before Step 1 destructive prerequisites; no executor
  worktree was created and no source/config file, Alchemy state, or Cloudflare
  resource was changed.
- **Advisor preflight**:
  - repository root resolved to `/home/ayan/ditto` — PASS;
  - current HEAD was `d44012a` — PASS;
  - the plan drift check over all named in-scope and protected contract files
    produced no changes from `d44012a..HEAD` — PASS;
  - Plan 039 has no dependencies and its index row was TODO — PASS;
  - `jq`, `curl`, `pnpm`, `npm`, `node`, and `git` were available — PASS;
  - shell-visible `CLOUDFLARE_ACCOUNT_ID` was absent — FAIL;
  - shell-visible `CLOUDFLARE_API_TOKEN` was absent — FAIL.
- **Executor dispatch**: NOT RUN. Three isolated `general-purpose`/Sonnet
  dispatch attempts were rejected before agent creation because the host's agent
  safety-classifier service was temporarily unavailable. No worktree path,
  branch, implementation commit, or executor diff exists to review.
- **First unmet plan gate**: Step 1 requires both Cloudflare variables, working
  deployment authentication, and the operator-designated disposable fixture
  before any v1 inventory or destroy. Missing credentials are a STOP condition;
  no attempt was made to infer them from files, print secret-bearing material,
  or proceed with remote operations.
- **Resume requirements**: make `CLOUDFLARE_ACCOUNT_ID` and
  `CLOUDFLARE_API_TOKEN` available to the Claude Code session without recording
  their values, confirm the disposable fixture project is designated and
  installation-accessible, then rerun `execute` when isolated executor dispatch
  is available. Repeat the drift and full Step 1 baseline checks from scratch.

## Execution attempt — 2026-08-11 (source implementation)

- **Status**: BLOCKED on deferred remote gates; local source/config review
  approved. No Cloudflare resource, v1 state, or parent-checkout source file was
  changed.
- **Executor**: xAI Grok 4.5 High in isolated worktree
  `/home/ayan/ditto-worktrees/039-alchemy-v2-ayan-recreation`, branch
  `advisor/039-alchemy-v2-ayan-recreation`.
- **Implementation commits**:
  - `ed0049d7319bdeb8e6c24db3555c690ecf6460c9` — Alchemy v2 source/config migration;
  - `b97560f64e75e98bbd94f8a085e70c1e4260bbed` — preserve pre-plan TanStack lock resolutions after reviewer revision.
- **Locally verified shape**: exact `alchemy@2.0.0-beta.70`,
  `effect@4.0.0-beta.103`, and `@effect/platform-node@4.0.0-beta.103`;
  dev-only scripts; v2 Stack/provider/local-state
  graph; fixed D1/R2/Worker/Container/route names; binding classifications;
  `WebsiteEnv`; v1 Vite integration removed; Sandbox package/image `0.12.3` and
  RPC source unchanged.
- **Local gates**:
  - clean pre-change baseline install and `pnpm verify` — PASS;
  - frozen post-change install — PASS;
  - static package/source guards, typecheck, Biome check, and focused suite — PASS;
  - reviewer `pnpm verify` — PASS with 702 web tests and 81 runner tests;
  - `git diff --check`, clean worktree, and exact seven-file scope audit — PASS.
- **Reviewer revision**: the first lockfile advanced four unrelated TanStack
  `latest` resolutions. Revision restored their pre-plan versions without
  changing manifest specifiers; only Alchemy/Effect additions, removal of web
  Alchemy/v1 Vite plugin, and required peer contexts now move.
- **Supply-chain policy note**: the active global 72-hour minimum-release-age
  policy temporarily rejects seven exact beta/transitive lock entries in a cold
  policy check. The operator approved a bounded one-shot
  `minimumReleaseAge=0` override on 2026-08-11; no repository or global policy
  change persists, and this is no longer a cutover blocker.
- **Remote-auth recheck after that approval**: Wrangler OAuth authenticates the
  account, Worker, R2, D1, zone, and Worker-route metadata paths, but the DNS
  record request returns HTTP 403 and ContainerApplication inventory returns
  HTTP 401. A non-secret `CLOUDFLARE_ACCOUNT_ID` is present; no
  `CLOUDFLARE_API_TOKEN` is available. The plan still requires a token with DNS
  record read and ContainerApplication inventory access before destruction.
- **Not run (blocking DONE)**: v1 inventory/destroy, v2 dry run/deploy,
  authoritative resource/binding checks, D1/R2/SSR/assets checks, authenticated
  Sandbox/backup/Preview acceptance using `metaloozee/ditto`, v2
  destroy/recreate, v1 rollback rehearsal, final convergence, and final evidence
  commit.

## Execution attempt — 2026-08-11 (local-first acceptance)

- **Status**: DONE-local at `51890543733b08a34756119588cb47a8601345c3`;
  cloud steps remain deferred by the operator's free-plan boundary.
- **Runtime correction**: the originally planned Effect beta.106 typechecked but
  crashed Alchemy beta.70's Node CLI because `Schema.TaggedErrorClass` was
  removed in Effect beta.104. The accepted graph uses exact Effect beta.103,
  exact `@effect/platform-node` beta.103, and coherent beta.103 workspace
  overrides. Direct CLI help now passes.
- **Local Container correction**: Container logical id remains the original
  lowercase `sandbox` while the Worker binding remains `Sandbox`. Absolute repo
  paths plus running Alchemy dev from `apps/web` serialize Docker context as
  `../..`, allowing the local provider to build the root Dockerfile without a
  shim or prebuilt tag.
- **Independent reviewer verification**:
  - one-shot `minimumReleaseAge=0` frozen install — PASS; no policy persisted;
  - direct Alchemy CLI load and package/version contracts — PASS;
  - full `pnpm verify` — PASS: 702 web tests and 81 runner tests plus both builds;
  - local provider plan — PASS: D1, R2, Container/DO, Worker/assets, and custom
    `src/server.ts` metadata present with the required binding names;
  - automatic root Docker build — PASS: built image history contains the root
    `packages/sandbox-runner` copy and Sandbox base remains `0.12.3`;
  - local app — PASS at `http://localhost:1337`: Ditto HTML 200, transformed
    asset 200/non-empty, and unauthenticated `/settings` redirects 307 to
    `/sign-in`;
  - direct dependency lock comparison — PASS: unrelated TanStack versions match
    `d44012a`; only required peer contexts move;
  - clean shutdown, `git diff --check`, clean worktree, and eight-file scope — PASS.
- **Not run**: manual authenticated OAuth/project import, Sandbox provisioning,
  backup, or Preview smoke. These need an interactive user session. No remote
  inventory, deploy, destroy, or other Cloudflare mutation ran.
- **Future cloud gate**: do not execute this plan's remote steps as written.
  Create or refresh a paid-plan cutover plan that starts from commit `e3abdee`,
  revalidates Alchemy's live Container graph, obtains the required metadata API
  permissions, and restores the destructive acceptance/rollback matrix.

## Execution update — 2026-08-11 (stage rename)

- **Commit**: `e3abdeef6c8fb65ac59517e6ef72072835c422cd` on
  `advisor/039-alchemy-v2-ayan-recreation`.
- **Change**: renamed only the Alchemy v2 stage identifier from `ayan` to `dev`
  in root dev/deploy/destroy scripts and current README guidance.
- **Preserved**: physical `ditto-ayan-*` / `ditto-sandbox-ayan` resource names,
  `ayn.wtf`, the historical v1 `ayan` stage, resource graph, and application
  behavior.
- **Verification**: script assertions, exact two-file scope, `git diff --check`,
  clean worktree, local provider completion, Ditto HTTP response, generated
  `.alchemy/state/ditto/dev`, absence of v2 `ayan` state, and clean shutdown all
  passed. No Cloudflare command or mutation ran.
- **Future cloud gate**: refresh from `e3abdee`; all Alchemy v2 commands and
  local-state assertions must use `dev`, while deferred v1 cleanup remains
  explicitly `ayan`.
