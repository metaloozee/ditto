# Deferred audit findings — 2026-07-02

These findings were vetted during the deep improve audit at commit `bb00b96`
but were intentionally not turned into implementation plans in this planning
round. Do not treat this file as an execution plan; each item needs a fresh
plan before implementation.

Finding 5 from the audit ("Start from Scratch is a no-op") is not included
below because the maintainer chose a direct product decision: disable that
field/surface for now rather than write a plan.

## 6. Redact provisioning errors before returning them to users

- **Category**: security
- **Evidence**:
  - `src/lib/sandbox-bootstrap.ts:74-80` throws command stderr/stdout directly in `runCommand` errors.
  - `src/lib/sandbox-bootstrap.ts:231-245` builds a GitHub clone URL using an installation access token.
  - `src/integrations/trpc/routers/projects.ts:143-148` returns the raw provisioning error message to the client.
- **Impact**: If sandbox clone/install output includes a tokenized remote, private key text, `.env` value, or provider key, the app can display and persist a secret-bearing error path.
- **Effort**: S-M
- **Risk**: LOW
- **Suggested next action**: Plan a small redaction helper shared with runner redaction patterns, then apply it to sandbox provisioning and restore errors before they cross tRPC/UI boundaries.

## 7. Make environment validation real and remove unsafe defaults

- **Category**: DX / config
- **Evidence**:
  - `src/env.ts:4-27` declares required server/client env validation.
  - No source file imports `#/env`, so the validation does not run in the app or Alchemy setup path.
  - `alchemy.run.ts:43-55` binds many env vars with empty-string fallbacks and defaults `VITE_GITHUB_APP_INSTALL_URL` to a specific app URL.
- **Impact**: Misconfigured deployments can start with empty secret bindings or the wrong GitHub App install URL, then fail later in less obvious paths.
- **Effort**: S
- **Risk**: LOW
- **Suggested next action**: Plan a startup/deploy validation module used by `alchemy.run.ts` and Worker initialization; add `.env.example`; remove the default GitHub App install URL.

## 8. Gate TanStack devtools out of production

- **Category**: performance / DX
- **Evidence**:
  - `src/routes/__root.tsx:1-14` imports TanStack devtools and router devtools unconditionally.
  - `src/routes/__root.tsx:64-75` renders `<TanStackDevtools>` unconditionally.
  - `vite.config.ts:25-27` includes the devtools Vite plugin unconditionally.
- **Impact**: Production bundles/UI may include development tooling that adds weight and product chrome not meant for users.
- **Effort**: S
- **Risk**: LOW
- **Suggested next action**: Plan a dev-only gate using Vite mode/runtime env and move devtools-only packages to dev dependencies where compatible.

## 9. Clear high-severity audit advisories from old Miniflare transitive deps

- **Category**: dependencies / security
- **Evidence**:
  - `pnpm audit --audit-level high --prod` reports high advisories for `ws` and `undici` through `alchemy > miniflare`.
  - `pnpm-lock.yaml:6325-6331` contains both `miniflare@4.20260424.0` and `miniflare@4.20260623.0`.
  - `pnpm-lock.yaml:13819-13826` shows old Miniflare depends on `undici@7.24.8` and `ws@8.18.0`.
- **Impact**: The repo cannot get a clean high-severity audit. Reachability appears mostly dev/deploy/runtime-tooling rather than browser app code, but it still deserves cleanup.
- **Effort**: S-M
- **Risk**: MED
- **Suggested next action**: Plan a dependency update/dedupe pass for Alchemy/Wrangler/Miniflare, then rerun `pnpm audit --audit-level high --prod`. Avoid blanket overrides unless verified compatible.

## 10. Split read-side workspace queries from sandbox repair work

- **Category**: performance / architecture
- **Evidence**:
  - `src/integrations/trpc/routers/workspace.ts:104-121` calls `ensureProjectSandbox` inside `workspace.get`.
  - `src/routes/project.$projectId.tsx:32-39` calls `workspace.get` from the page query and can poll while active.
  - `src/lib/project-sandbox.ts:104-203` can mark a project provisioning, restore from backup, recreate from GitHub, and update project rows.
- **Impact**: Opening or polling a workspace can trigger remote sandbox checks/repair flows on a read path, increasing latency and making page load side effects harder to reason about.
- **Effort**: M
- **Risk**: MED
- **Suggested next action**: Plan a split between cheap workspace reads and explicit ensure/repair actions. Keep repair on start-run or a visible recovery action, and cache health where appropriate.

## 11. Reconcile stale docs, manifest, and old plan statuses

- **Category**: docs / DX
- **Evidence**:
  - `README.md:1` still says "Welcome to your new TanStack Start app!".
  - `README.md:126-149` describes GitHub OAuth/App setup in terms that no longer match the current server-authorized import flow.
  - `README.md:166-179` still describes a generic Claude chat sample with streaming "coming soon".
  - `public/manifest.json:2-3` still uses TanStack starter app names.
  - `plans/README.md:12-14` lists plans 004-006 as TODO even though live code appears to contain the intended fixes.
- **Impact**: New users and executor agents get stale setup/product information; plan reconciliation noise makes future audits re-check already-fixed items.
- **Effort**: S-M
- **Risk**: LOW
- **Suggested next action**: Plan a docs reconciliation pass: update README to Ditto-specific setup/current architecture, fix manifest names, and reconcile old plan statuses with live code evidence.
