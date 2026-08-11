# Alchemy v1 → v2 migration research (Ditto)

**Date:** 2026-08-05  
**Scope:** Map current Ditto Alchemy v1 resources onto Alchemy v2 APIs; identify support, adoption/cutover hazards, staging spikes, and wayfinder decision questions.  
**Rules followed:** primary sources only; no source-code changes; no secret values reproduced (credential **types/locations** only).

---

## Executive summary

| Area | Finding |
| --- | --- |
| Current Alchemy | Root + web depend on `alchemy` `^0.93.11` (lock resolves **0.93.12**). This is the v1 async/`await alchemy()` model. |
| Target Alchemy | Official migration guide + provider docs describe **v2** as `Alchemy.Stack` + Effect generators, import surface `alchemy` / `alchemy/Cloudflare`, package line currently published as **`2.0.0-beta.*`** (observed latest on npm: `2.0.0-beta.70`). **Not a stable 2.0.0 yet.** |
| State compatibility | **v1 state is not compatible with v2.** First v2 deploy starts from an empty state store; existing cloud resources must be **adopted by pinned physical name** + `alchemy deploy --adopt` (or `adopt(true)`). |
| Local v1 inventory | Only stage found under `.alchemy/ditto/`: **`ayan`**. Markers indicate **local/dev**, not a proven remote production estate (`website.dev.hasRemote: false`, D1/R2 remote IDs empty, route `noop-route`). |
| Resource coverage | D1, R2, Worker/Website (TanStack via `Cloudflare.Website.Vite`), Container (incl. `@cloudflare/sandbox` async bind), Durable Objects, Worker routes/custom domains, secrets/env, Workflows are **documented as supported in v2**. |
| Brain DO | **No “Brain” Durable Object** appears in current source, plans, architecture docs, or v1 state. Support for *adding* a new DO class on a Worker is documented; adoption of an *existing* foreign DO class has one-shot `className` constraints. |
| `sandbox@next` | Orthogonal to Alchemy major version. Alchemy v2 can bind a container image; Cloudflare Sandbox 1.0 preview requires **matched** Worker package + image and **immediate** container rollout. Combining Alchemy adopt + `@next` image cutover in one step is high risk. |

**Bottom line:** A pure IaC rewrite to v2 is documented and looks feasible for Ditto’s graph **if** physical names are pinned and adoption is staged. The hard unknowns are (1) any real remote stage beyond local `ayan`, (2) container application + SQLite DO class adoption details, (3) TanStack Start plugin/`@cloudflare/vite-plugin` cutover, and (4) whether Brain DO / `sandbox@next` should ride the same deploy.

---

## Sources

### Official Alchemy (v2 unless noted)

| Topic | URL |
| --- | --- |
| Migrating from v1 | https://alchemy.run/migrating-from-v1/ |
| Adopting resources | https://alchemy.run/cli/adopting-resources |
| Inspecting state | https://alchemy.run/cli/inspecting-state |
| State store / `Cloudflare.state()` | https://alchemy.run/state-store |
| Cloudflare hub | https://alchemy.run/cloudflare |
| Bindings | https://alchemy.run/infrastructure-as-effects/binding |
| Workers | https://alchemy.run/cloudflare/compute/workers |
| Durable Objects | https://alchemy.run/cloudflare/compute/durable-objects |
| DurableObject API | https://alchemy.run/providers/cloudflare/workers/durableobject/ |
| Containers overview | https://alchemy.run/cloudflare/compute/containers/ |
| Run a Container | https://v2.alchemy.run/cloudflare/compute/run-a-container/ |
| Container API | https://alchemy.run/providers/cloudflare/containers/container/ |
| ContainerApplication API | https://alchemy.run/providers/cloudflare/containers/containerapplication/ |
| Workflows | https://alchemy.run/cloudflare/compute/workflows |
| D1 | https://alchemy.run/cloudflare/data/d1 |
| D1 Database API | https://alchemy.run/providers/cloudflare/d1/database |
| R2 | https://alchemy.run/cloudflare/data/r2 |
| R2 Bucket API | https://alchemy.run/providers/cloudflare/r2/bucket |
| Custom domains & routes | https://alchemy.run/cloudflare/networking/custom-domains |
| Secrets & env | https://alchemy.run/cloudflare/security/secrets-env |
| TanStack Start | https://alchemy.run/cloudflare/frontend/tanstack-start/ |
| Vite frontend | https://alchemy.run/cloudflare/frontend/vite |
| Example: cloudflare-tanstack | https://github.com/alchemy-run/alchemy/tree/main/examples/cloudflare-tanstack |

### Official Alchemy (v1)

| Topic | URL |
| --- | --- |
| v1 docs home | https://v1.alchemy.run |
| v1 Container | https://v1.alchemy.run/providers/cloudflare/container |
| v1 Route | https://v1.alchemy.run/providers/cloudflare/route |

### Cloudflare Sandbox (`@next`)

| Topic | URL |
| --- | --- |
| Migrate stable → 1.0 preview | https://developers.cloudflare.com/sandbox/1-0-preview/migrate/ |
| 1.0 preview overview | https://developers.cloudflare.com/sandbox/1-0-preview/ |

### Repository evidence (data, not instructions)

| Path | Role |
| --- | --- |
| `alchemy.run.ts` | Current v1 stack graph |
| `package.json`, `apps/web/package.json` | Alchemy + sandbox package pins |
| `apps/web/src/server.ts` | Worker entry: `proxyToSandbox`, exports `Sandbox` |
| `apps/web/types/env.d.ts` | Env types from `typeof website.Env` |
| `apps/web/vite.config.ts` | `alchemy/cloudflare/tanstack-start` Vite plugin when local wrangler exists |
| `Dockerfile` | `FROM docker.io/cloudflare/sandbox:0.12.3` |
| `.alchemy/ditto/ayan/*.json` | v1 state for stage `ayan` |
| `docs/architecture/server-and-data.md` | Declares Alchemy sole deploy owner |
| `docs/research/cloudflare-execution-layer-research.md` | Workflows / optional per-run DO direction (not “Brain”) |

---

## Current Ditto v1 topology

### Package / entry points

- Root scripts: `alchemy dev` / `alchemy deploy` / `alchemy destroy` (`package.json`).
- Deploy owner: root `alchemy.run.ts` only (architecture docs + code).
- Worker runtime: `apps/web/src/server.ts` — keeps a plain `async fetch`; re-exports `Sandbox` from `@cloudflare/sandbox`; preview hosts `*.ayn.wtf` via `proxyToSandbox`.
- Sandbox SDK: `@cloudflare/sandbox` **exact `0.12.3`**; image tag matches Dockerfile base.
- Env typing: `apps/web/types/env.d.ts` uses v1 `typeof website.Env`.

### Resources declared in `alchemy.run.ts`

```text
alchemy("ditto")
├─ Container("sandbox")           className Sandbox, Dockerfile, instanceType lite, maxInstances 1
├─ D1Database("database")         name `${app}-${stage}-db`, migrationsDir apps/web/migrations, table drizzle_migrations
├─ R2Bucket("sandbox-backups")    name `${app}-${stage}-sandbox-backups`
├─ TanStackStart("website")       cwd apps/web, url:true, many bindings, wrangler transform
│    bindings: DB, Sandbox, BACKUP_BUCKET, BACKUP_BUCKET_NAME,
│              plain config vars, alchemy.secret(...) credentials,
│              SANDBOX_TRANSPORT="rpc", PREVIEW_BASE_HOST="ayn.wtf"
│    wrangler: main src/server.ts; forces containers + DO binding Sandbox + migrations tag v1
└─ Route("session-previews")      pattern *.ayn.wtf/*, script website, adopt:true, dev:true
```

### Secret / config binding inventory (types & locations only)

| Binding | Kind in `alchemy.run.ts` | Source location |
| --- | --- | --- |
| `R2_ACCESS_KEY_ID` | `alchemy.secret(...)` | process env / `.env.local` or `.env` via `dotenv` |
| `R2_SECRET_ACCESS_KEY` | `alchemy.secret(...)` | same |
| `BETTER_AUTH_SECRET` | `alchemy.secret(...)` | same |
| `GITHUB_CLIENT_SECRET` | `alchemy.secret(...)` | same |
| `GITHUB_APP_PRIVATE_KEY` | `alchemy.secret(...)` | same |
| `OPENCODE_API_KEY` | `alchemy.secret(...)` | same |
| `AI_CREDENTIALS_ENCRYPTION_KEY` | `alchemy.secret(...)` | same |
| `CLOUDFLARE_ACCOUNT_ID`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, `GITHUB_APP_ID`, `VITE_GITHUB_APP_INSTALL_URL`, `BACKUP_BUCKET_NAME`, `USE_LOCAL_BUCKET_BACKUPS`, `SANDBOX_TRANSPORT`, `PREVIEW_BASE_HOST` | plain string bindings | process env or literals in `alchemy.run.ts` |

**Hazard (observed, no values):** generated local Wrangler config under `.alchemy/local/wrangler.jsonc` and `apps/web/.alchemy/local/wrangler.jsonc` materializes binding values into a `vars` object on disk. Treat those paths as **secret-bearing local artifacts** (gitignored). Do not commit or paste them. Prefer v2 `Config.redacted` / Secrets Store patterns so plaintext dump surface shrinks.

---

## Exact physical names from v1 state (stage `ayan`)

State root: `.alchemy/ditto/ayan/`  
FQN prefix: `ditto/ayan/...`  
App name: **`ditto`**. Stage: **`ayan`**.

| Logical ID | Resource kind (v1 state) | Physical / effective name | Notes from state |
| --- | --- | --- | --- |
| `sandbox` | `docker::Image` | image name `cloudflare-dev/ditto-sandbox-ayan`, tag `latest-<buildTs>` | Built from root `Dockerfile` |
| `database` | `cloudflare::D1Database` | **`ditto-ayan-db`** | Explicit `name` prop; migrations table `drizzle_migrations`; remote `id` empty; `dev.remote: false` |
| `sandbox-backups` | `cloudflare::R2Bucket` | **`ditto-ayan-sandbox-backups`** | Explicit name; `dev.isDeployed: false` |
| `website` | `cloudflare::Worker` | **`ditto-website-ayan`** | `cwd: apps/web`; assets `dist/client`; compat flags `nodejs_compat`, `nodejs_compat_populate_process_env`; `dev.hasRemote: false`; local URL recorded |
| `website/sandbox` | `cloudflare::ContainerApplication` | **`ditto-sandbox-ayan`** | className `Sandbox`; instanceType `lite`; maxInstances `1`; sqlite true |
| `session-previews` | `cloudflare::Route` | pattern **`*.ayn.wtf/*`**, script **`ditto-website-ayan`** | Local placeholders: route id `noop-route`, zone `noop-zone`; props `adopt: true`, `dev: true` |

### Durable Object / container binding facts (from state + generated wrangler)

- DO binding name: **`Sandbox`**
- DO class name: **`Sandbox`**
- Migration recorded in generated config: `{ tag: "v1", new_sqlite_classes: ["Sandbox"] }`
- Container class_name: **`Sandbox`**, image path relative to app, `instance_type: lite`, `max_instances: 1`
- D1 binding: **`DB`** → database name `ditto-ayan-db`
- R2 binding: **`BACKUP_BUCKET`** → `ditto-ayan-sandbox-backups`

### Naming formula cross-check

Migration guide default when `name` is omitted: `{app}-{id}-{stage}` (Workers lowercased).  
Ditto **overrides** several names:

| Resource | Default formula would be | Actual |
| --- | --- | --- |
| D1 `database` | `ditto-database-ayan` | **`ditto-ayan-db`** (`${app}-${stage}-db`) |
| R2 `sandbox-backups` | `ditto-sandbox-backups-ayan` | **`ditto-ayan-sandbox-backups`** |
| Worker `website` | `ditto-website-ayan` | **`ditto-website-ayan`** (matches default) |
| Container app | (provider-specific) | **`ditto-sandbox-ayan`** |

**Implication:** v2 must pin the **actual** names from state/dashboard, not re-derive from the default formula alone.

### Stages beyond `ayan`

Only `.alchemy/ditto/ayan/` exists in this checkout. Any `prod` / CI / other developer stages must be inventoried from:

- Cloudflare dashboard / API (Workers, D1, R2, Container applications, routes), and/or  
- another machine’s `.alchemy/` or a remote state store  

before a production adopt. That inventory is a **required spike** if remote resources exist.

---

## Official v1 → v2 migration mechanics

From https://alchemy.run/migrating-from-v1/:

1. **Replace the Stack**  
   - v1: `const app = await alchemy("ditto"); ... await app.finalize();`  
   - v2: `export default Alchemy.Stack("…", { providers: Cloudflare.providers(), state: Cloudflare.state() }, Effect.gen(...))`  
   - Resources use `yield*` / module-level `Cloudflare.*` declarations; no `finalize()`.

2. **Runtime handlers may stay async**  
   - Plain `async fetch` is supported.  
   - Bindings move from v1 `bindings:` to v2 `env:` (async Worker style).  
   - Types: `Cloudflare.InferEnv<typeof Worker>` instead of v1 `typeof website.Env`.  
   - Binding key casing in docs examples often becomes PascalCase resource keys; **Ditto should keep existing env keys** (`DB`, `Sandbox`, `BETTER_AUTH_SECRET`, …) unless app code is updated in lockstep.

3. **Pin physical names**  
   - v2 state starts empty.  
   - Without pinned `name`, v2 would create **new** cloud resources.  
   - Carry explicit v1 physical names; stage-suffix differs per stage.

4. **Deploy with adopt**  
   - First cutover: `alchemy deploy --adopt`  
   - Later: normal `alchemy deploy`  
   - Programmatic: `adopt(true)` from `alchemy/AdoptPolicy` around deploy.

5. **Optional Effect runtime**  
   - Not required for migration. Can stay on async Worker + TanStack server entry.

### State store change

v2 docs recommend `state: Cloudflare.state()` (Worker + DO SQLite + Secrets Store bootstrap).  
v1 Ditto uses on-disk `.alchemy/ditto/<stage>/…`.

Cutover consequences:

- First v2 run may bootstrap a shared **`alchemy-state-store`** Worker (name overridable) and Secrets Store entries (token + encryption key) — account-scoped, reused across stacks.  
- Credentials land under `~/.alchemy/<profile>/cloudflare-state-store.json` (local) or Secrets Store resolution under `CI=true`.  
- Do **not** assume v1 JSON files are readable by v2; adoption is by cloud physical identity, not file import.

---

## Resource-by-resource support matrix

Legend: **Supported** = documented first-party v2 path; **Spike** = docs exist but Ditto-specific adopt/shape unproven; **Gap** = not found in repo / needs product decision.

| Current / proposed resource | v1 Ditto | v2 support | Adopt / pin notes | Confidence |
| --- | --- | --- | --- | --- |
| Stack / app | `await alchemy("ditto")` | `Alchemy.Stack(..., { providers: Cloudflare.providers(), state: Cloudflare.state() })` | New state namespace; pick stack name deliberately (`ditto` vs `Ditto` / `MyApp`) | High |
| TanStack Start Worker | `TanStackStart("website")` + `alchemy/cloudflare/tanstack-start` Vite plugin | **`Cloudflare.Website.Vite`** (TanStack Start guide); remove `@cloudflare/vite-plugin`; `assets.runWorkerFirst` called out | Pin worker name `ditto-website-ayan` (per stage). Keep `async fetch` in `server.ts` viable | High API / **Spike** DX |
| Worker entry / assets | wrangler main `src/server.ts`, assets `dist/client` | `Cloudflare.Worker` / `Website.Vite` with `main`, `assets`, compat flags | Confirm asset routing vs today’s `run_worker_first: false` (v2 TanStack example sets `runWorkerFirst: true`) | Spike |
| D1 | `D1Database("database")` | `Cloudflare.D1.Database` + `migrationsDir` + `migrationsTable: "drizzle_migrations"` | Pin name `ditto-<stage>-db`. Drizzle table supported. Never create a second DB with a default name. | High |
| R2 | `R2Bucket("sandbox-backups")` | `Cloudflare.R2.Bucket` + `ReadWriteBucket` binding (or async `env`) | Pin `ditto-<stage>-sandbox-backups` | High |
| Container image build | `Container` + Dockerfile context `.` | `Cloudflare.Container` with `context` / `dockerfile` **or** `image:` | Pin ContainerApplication name `ditto-sandbox-ayan` via `name` prop where supported | High API / Spike adopt |
| Sandbox DO class | export `Sandbox` from `@cloudflare/sandbox` | Async Worker path: `env: { Sandbox: Cloudflare.Container<Sandbox>("Sandbox", { image|context, className: "Sandbox", … }) }` | **Adopting deploy:** `className` must match existing class (`Sandbox`). DO migrations: do not invent a second `new_sqlite_classes` for same class | High API / Spike live adopt |
| Route `*.ayn.wtf/*` | `Route(..., { adopt: true })` | `Cloudflare.Workers.WorkerRoute` + `adopt(true)`; zone must exist; routes unowned by default | Pin pattern + script name; adopt flag required for pre-existing route | High |
| Custom domain / zone | pattern on `ayn.wtf` | `Cloudflare.Zone.Zone` + Worker `domain` **or** WorkerRoute + DNS | Zone adopt separate; wildcard preview DNS must already exist | Spike (zone ownership) |
| Secrets / env | `alchemy.secret` + plain strings | Async: `env: { KEY: Config.redacted("KEY"), … }`; Effect: `Config.redacted` in init; optional Secrets Store | Re-bind every secret on first deploy from env/Secrets Store; verify no missing keys | High |
| Workflows | **not deployed** today; v1 package exports `Workflow()`; research recommends later | `Cloudflare.Workflow` documented; async Worker `env` bind supported | New resource → create, not adopt | High (when added) |
| Brain DO | **not in repo** | New `Cloudflare.DurableObject` / class export on Worker supported | New class → new migration tag / `new_sqlite_classes` (or declarative exports). Must not collide with `Sandbox` | Gap (product) + High (mechanism) |
| `sandbox@next` cutover | stable `0.12.3` package + image | Alchemy can point `image`/`Dockerfile` at `cloudflare/sandbox:next` (or custom FROM); app code must match | **Immediate** container rollout; no mixed protocol window; process/terminal IDs invalidate | High CF docs / Spike with Alchemy rollout knobs |

---

## Mapping sketch (illustrative only — not an implementation)

Conceptual v2 shape aligned to Ditto names (stage-parameterized):

```ts
// Pseudocode mapping — do not treat as drop-in
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { adopt } from "alchemy/AdoptPolicy";
// import type { Sandbox } from "./apps/web/src/server.ts";

const stage = process.env.ALCHEMY_STAGE ?? process.env.USER ?? "dev";
const app = "ditto";

export const Database = Cloudflare.D1.Database("database", {
  name: `${app}-${stage}-db`,
  migrationsDir: "./apps/web/migrations",
  migrationsTable: "drizzle_migrations",
});

export const Backups = Cloudflare.R2.Bucket("sandbox-backups", {
  name: `${app}-${stage}-sandbox-backups`,
});

export const Website = Cloudflare.Website.Vite("website", {
  name: `${app}-website-${stage}`.toLowerCase(),
  // cwd / root for monorepo: SPIKE — confirm Website.Vite monorepo props vs Worker main
  env: {
    DB: Database,
    BACKUP_BUCKET: Backups,
    BACKUP_BUCKET_NAME: `${app}-${stage}-sandbox-backups`,
    Sandbox: Cloudflare.Container/*<Sandbox>*/("Sandbox", {
      name: `${app}-sandbox-${stage}`, // ContainerApplication physical name if supported
      className: "Sandbox",
      context: ".", // or image after publish
      dockerfile: "Dockerfile",
      instanceType: "lite",
      maxInstances: 1,
    }),
    BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
    // …remaining secrets/config with identical binding names…
    SANDBOX_TRANSPORT: "rpc", // drop when/if sandbox@next
    PREVIEW_BASE_HOST: "ayn.wtf",
  },
  assets: {
    // SPIKE: today's generated config has run_worker_first: false
    // TanStack v2 guide example uses runWorkerFirst: true
  },
});

export default Alchemy.Stack(
  "ditto",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const website = yield* Website;
    yield* Cloudflare.Workers.WorkerRoute("session-previews", {
      pattern: "*.ayn.wtf/*",
      script: website.workerName, // exact field name: SPIKE against WorkerRoute API
    }).pipe(adopt(true));
    return { url: website.url };
  }),
);
```

**Not verified without a staging spike:** monorepo `cwd` for `Website.Vite`, exact ContainerApplication `name` prop path when bound via Worker `env`, whether `wrangler.transform` equivalents exist, and `InferEnv` replacing `typeof website.Env`.

---

## Brain DO (proposed)

### Repo evidence

- Grep across plans, architecture, source, and v1 state: **no symbol, resource, or plan titled “Brain”**.  
- Closest related design notes: `docs/research/cloudflare-execution-layer-research.md` favors **Workflows as run owner**, with an optional later **per-run Durable Object** for locking/live connections — explicitly **secondary**, not current deploy graph.  
- Current only DO/container class: **`Sandbox`**.

### Does v2 support adding it?

**Yes, as a new Durable Object class on the Worker**, via either:

- Effect-native `Cloudflare.DurableObject` class + bind from Worker init, or  
- Async Worker `env` / `bindings`: `Cloudflare.DurableObject<Brain>("Brain", { className: "Brain" })` with `export class Brain extends DurableObject` in the worker bundle.

### Hazards if introduced during Alchemy migrate

1. **Migration tag collision** — existing SQLite class `Sandbox` at tag `v1`. A new class needs an additional migration (`new_sqlite_classes: ["Brain"]` with a **new** tag) or declarative exports equivalent. Must not re-declare `Sandbox` as new.  
2. **Adopting deploy constraint** — if the Worker is being adopted in the same deploy, foreign DO matching is **by binding name** and `className` must match live classes. Prefer: adopt Worker+Sandbox first; add Brain on a **second** deploy.  
3. **Product ambiguity** — without a written Brain contract (id scheme, storage, RPC, relation to Workflows/Sandbox), infra support ≠ ready to ship.  
4. **Version workers limitation** — Alchemy docs: version/preview workers **cannot host** DO or Workflow classes; host on parent script only.

---

## `sandbox@next` cutover (proposed)

### Current stable coupling

- Package: `@cloudflare/sandbox@0.12.3`  
- Image: `docker.io/cloudflare/sandbox:0.12.3`  
- Transport binding: `SANDBOX_TRANSPORT: "rpc"`  
- Runtime uses stable APIs heavily: `getSandbox`, `proxyToSandbox`, `createSession`, `execStream` / `parseSSEStream`, `startProcess`, `exposePort`, backups, etc. (apps/web + tests).

### Cloudflare primary rules (migrate doc)

- Worker package and container image must be the **same** `@next` line.  
- Stable and `@next` control protocols are **incompatible both ways**.  
- Production cutover: one deploy with **immediate** container rollout (`wrangler deploy --containers-rollout=immediate` in CF docs). Gradual container rollout leaves a broken mixed window.  
- Leave `rollout_active_grace_period` at **0** for cutover.  
- After cutover: process/terminal IDs from before deploy are invalid; persist job specs, not only IDs.  
- Remove transport/session APIs; `exec` becomes argv → handle.

### Alchemy intersection

- v2 Container supports `image`, `context`/`dockerfile`, and `rollout: { strategy: "immediate" | "rolling", stepPercentage }`.  
- Default container rollout in ContainerApplication docs is described as immediate replacement unless configured rolling — **confirm** Alchemy’s default matches Cloudflare’s Worker-deploy gradual behavior; do not assume wrangler flags are exposed 1:1.  
- Async Worker + `@cloudflare/sandbox` is an **explicit** Alchemy container path.

### Recommendation

Treat **`sandbox@next` as a separate cutover** from Alchemy v1→v2:

1. Either migrate Alchemy on stable `0.12.3` first, prove adopt, then port Sandbox; **or**  
2. Port Sandbox on v1 Alchemy first, then migrate Alchemy; **or**  
3. Only combine after a disposable staging stack proves both in sequence on the same day.

Combining both without a staging rehearsal risks: failed DO/container adopt **and** protocol mismatch outage.

---

## Adoption & cutover hazards (ranked)

1. **Empty v2 state creates duplicates** if physical names are wrong (especially D1/R2). Data-loss / split-brain risk on DB and backups.  
2. **D1 name mismatch** — Ditto does **not** use `{app}-{id}-{stage}`; it uses `{app}-{stage}-db`.  
3. **Sandbox SQLite DO class** — adopting Worker must keep `className: "Sandbox"`; re-creating class migration fails if class already exists.  
4. **ContainerApplication name** `ditto-sandbox-ayan` must be adopted; wrong name → second app or adopt miss.  
5. **Route `*.ayn.wtf/*`** — unowned unless `adopt(true)` / `--adopt`; wrong script name breaks all session previews.  
6. **Local-only state in this checkout** — `hasRemote: false` means this research has **not** proven production physical IDs (UUID database ids, real route ids, registry digests).  
7. **Secrets re-bind** — every `alchemy.secret` must be present in the deploy environment; missing secret may deploy a Worker that boots then fails auth/crypto at runtime.  
8. **TanStack / Vite plugin swap** — v2 guide: drop `@cloudflare/vite-plugin`; use Alchemy Vite integration; env access via deferred `cloudflare:workers` proxy pattern in server modules. Ditto currently uses `alchemy/cloudflare/tanstack-start` gated on local wrangler file presence.  
9. **`run_worker_first` / asset behavior** — possible behavior change for SSR vs static; can break routes or previews if wrong.  
10. **State store bootstrap** — first `Cloudflare.state()` deploy creates account-level store resources; needs Cloudflare auth and operator consent.  
11. **Monorepo paths** — migrations dir, Dockerfile context, `apps/web` cwd must be re-validated under v2 resource props.  
12. **Binding name renames** — docs examples rename `BUCKET`↔`Bucket`; Ditto app code depends on exact keys (`DB`, `Sandbox`, …).  
13. **Simultaneous Brain DO or `@next`** — multiplies failure modes (see above).  
14. **R2 S3 credentials** — app still uses account id + access key bindings for some backup paths (`sandbox-backup.ts`); native R2 binding exists as `BACKUP_BUCKET`. Confirm whether S3 keys remain required after migrate.  
15. **Destroy / retain policies** — Zone defaults to retain; understand Worker/D1/R2 destroy behavior before any `alchemy destroy` experiment.

---

## Gaps requiring a staging spike

Perform on a **disposable Cloudflare account or isolated stage**, never first on prod.

| # | Spike question | Success signal |
| --- | --- | --- |
| S1 | Install `alchemy@2.0.0-beta.x` + `effect` peers in a branch; `alchemy plan` against empty state with **pinned names of non-prod copies** | Plan shows adopt/update, not create-new for pinned resources |
| S2 | Adopt a throwaway Worker that already has SQLite DO class `Sandbox` + container | Deploy succeeds; DO storage retained; no “class already exists” migration error |
| S3 | `Cloudflare.Website.Vite` + TanStack Start monorepo (`apps/web`) + custom `server.ts` export `Sandbox` | Dev HMR works; `InferEnv` types; production bundle serves SSR + assets |
| S4 | D1 adopt with `migrationsTable: "drizzle_migrations"` and existing migration set | No re-apply of old migrations; schema intact |
| S5 | R2 adopt + read/write via binding | Objects preserved; app backup path works |
| S6 | WorkerRoute adopt for a wildcard pattern | Pattern unchanged; traffic hits adopted worker name |
| S7 | Secrets: `Config.redacted` + dotenv/CI | Runtime reads secrets; dashboard shows secret_text not plain vars |
| S8 | ContainerApplication `name` + `instanceType: "lite"` + Dockerfile context from monorepo root | Image builds; maxInstances 1; preview proxy works |
| S9 | Alchemy container `rollout.strategy: "immediate"` vs CF gradual default | No mixed Worker/image protocol window on image bump |
| S10 | Optional: add second DO class after adopt | New migration only adds Brain; Sandbox untouched |
| S11 | Optional: `@cloudflare/sandbox@next` on already-v2 stack | Immediate rollout; exec/handle rewrite smoke; backups/previews |
| S12 | Inventory **real** remote stages (if any) via dashboard/API | Written table of physical names/IDs per stage |

---

## Suggested rollout strategy (conservative)

```text
0. Inventory remote stages (S12). Freeze prod deploys during cut window.
1. Branch: dependency bump to alchemy v2 beta + effect; no cloud changes.
2. Rewrite alchemy.run.ts to Stack form with pinned names; keep stable sandbox 0.12.3.
3. Staging stage (new names OR copies): full deploy from empty → proves greenfield v2.
4. Staging adopt rehearsal: create resources with v1-like names, wipe v2 state, deploy --adopt.
5. App DX: env types InferEnv; vite plugin path; remove wrangler.transform reliance.
6. Adopt real staging/prod with --adopt; verify D1/R2/DO/route/previews/auth.
7. Only then schedule Brain DO (new migration) and/or sandbox@next (immediate rollout) as separate changes.
8. Keep v1 branch + state backup until soak period ends; do not destroy v1-managed resources via v1 destroy after v2 owns them.
```

**Do not:** run `alchemy destroy` on v1 against resources already adopted by v2.  
**Do not:** change D1/R2 physical names “to match defaults.”  
**Do not:** rename DO class `Sandbox` on the adopting deploy.

---

## Wayfinder decision questions

Answer these before writing implementation tickets:

1. **Is Alchemy v2 migration a goal now, or blocked on stable 2.0.0 GA?** (Today: beta only.)  
2. **Which stages are in scope?** Only local `ayan`, or remote staging/prod with different physical names?  
3. **What is “Brain DO”?** Confirm name, responsibility vs Workflows vs Sandbox, id scheme, and whether it ships in the same milestone as Alchemy migrate.  
4. **Is `sandbox@next` in-scope for the same milestone?** If yes, accept immediate-rollout downtime and a large app rewrite (`createSession` / `execStream` / …).  
5. **State store:** adopt `Cloudflare.state()` default worker name, or dedicated `workerName` per team/account?  
6. **Stack display name:** keep `ditto` or rename? (Affects FQNs in v2 state, not necessarily Cloudflare physical names if pinned.)  
7. **SSR asset mode:** keep `run_worker_first: false` or move to v2 guide’s `runWorkerFirst: true`? Who owns the behavior check?  
8. **Secrets posture:** stay env-injected `secret_text`, or graduate shared secrets to Secrets Store?  
9. **R2 access keys:** still required post-migrate, or can backup code use only the native `BACKUP_BUCKET` binding?  
10. **Preview domain:** remain `*.ayn.wtf` route adopt, or move to Worker `domain` / different zone model?  
11. **Rollback plan:** keep v1 deployable branch for how long after cutover?  
12. **CI:** who runs first `Cloudflare.state()` bootstrap, and where are state-store credentials kept for CI (`CI=true` path)?

---

## Verified facts (short list)

- Ditto is on Alchemy **v1** (`0.93.x`) with top-level await resources and `app.finalize()`.  
- Official migrate path is Stack + pin names + `--adopt`; v1/v2 state stores are incompatible.  
- v2 documents support for Worker/Website.Vite (TanStack), D1 (incl. Drizzle migrations table), R2, Containers (including async `@cloudflare/sandbox` style), Durable Objects, routes, secrets, Workflows.  
- Local v1 physical names for stage `ayan` are as tabulated above; remote production not evidenced in this checkout.  
- Only DO/container class today is **`Sandbox`** with migration tag **`v1`**.  
- No Brain DO in repository.  
- Sandbox is stable **0.12.3** end-to-end; `@next` is a separate Cloudflare-protocol cutover.  
- Async `fetch` handlers can remain through Alchemy v2.

---

## Explicit non-goals of this document

- No code or dependency changes.  
- No reproduction of secret values (including those present in local generated wrangler files).  
- No claim that beta Alchemy v2 is production-GA.  
- No claim that Brain DO requirements are known.

---

## Appendix A — v1 ↔ v2 vocabulary cheat sheet

| v1 | v2 |
| --- | --- |
| `await alchemy(name)` + `finalize()` | `Alchemy.Stack(name, { providers, state }, Effect.gen)` |
| `await Resource(id, props)` | `Cloudflare.*(id, props)` + `yield*` / module const |
| `bindings: { KEY: res }` | `env: { KEY: res }` (async) or `yield* Binding(res)` (Effect) |
| `alchemy.secret(process.env.X)` | `Config.redacted("X")` (or Secrets Store) |
| `TanStackStart` | `Cloudflare.Website.Vite` |
| `D1Database` | `Cloudflare.D1.Database` |
| `R2Bucket` | `Cloudflare.R2.Bucket` |
| `Container` | `Cloudflare.Container` (+ ContainerApplication under the hood) |
| `Route` | `Cloudflare.Workers.WorkerRoute` |
| `typeof website.Env` | `Cloudflare.InferEnv<typeof Website>` |
| `.alchemy/<app>/<stage>/*.json` | `Cloudflare.state()` (recommended) or local `.alchemy/state/...` layout |
| `alchemy deploy` | `alchemy deploy` then first-time `--adopt` for foreign/unowned |

## Appendix B — binding names the app code expects (do not rename casually)

`DB`, `Sandbox`, `BACKUP_BUCKET`, `BACKUP_BUCKET_NAME`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `USE_LOCAL_BUCKET_BACKUPS`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `VITE_GITHUB_APP_INSTALL_URL`, `OPENCODE_API_KEY`, `AI_CREDENTIALS_ENCRYPTION_KEY`, `SANDBOX_TRANSPORT`, `PREVIEW_BASE_HOST`.
