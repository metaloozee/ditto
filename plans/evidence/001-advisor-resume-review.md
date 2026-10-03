# 001 advisor review after resume

Verdict: BLOCKED. The resumed changes address the isolated launcher defect and add useful candidate-specific import checks. They do not complete L0. Do not start 002 or transfer this diff as completed work.

Reviewed the same detached worktree `/tmp/ditto-plan-001-cjCtMO` at base `dfeccf270e3937253375b19f9003c895cbd7eef1`. Main checkout remains unchanged. No staging, commit, merge, push, deployment or credential use occurred. Historical [first review](001-advisor-review.md) is preserved.

## Resume changes reviewed

Read the revised finite verifier, new bundle auditor and Node regression tests, runtime configuration, root scripts and updated execution evidence. Rechecked candidate composition and the complete tracked diff.

- The verifier resolves the installed Alchemy package's declared CLI and launches it directly with `process.execPath`. The child no longer runs pnpm/Corepack in its fresh HOME. Independent execution reached Alchemy without dependency installation, confirming the previous launch failure is repaired.
- Candidate auditing bundles the actual entry and checks emitted JavaScript with the installed TypeScript parser. It limits static imports, reviews the variable dynamic importer and verifies that the only composed model factory supplies the closed auth context. Negative regressions reject additional filesystem/process imports and changed auth wiring. Node bundler/test imports stay outside the Worker graph.
- The audit permits the pinned TypeBox deployment-owned validation helper's Function constructor and Sandbox logging environment reader. This is a reviewed composition check, not a general code-execution confinement proof. Repository-selected schemas, executable extensions or generated code are still forbidden. A dependency upgrade invalidates the assumptions.
- The Node audit is included in `runtime:verify` and excluded only from the Worker-pool runner. Existing Worker tests remain included. No new dependency or normal deployment composition change was made during resume.

## Independent results

Commands ran in the disposable worktree with `env -i PATH="$PATH" HOME="$PWD" NO_COLOR=1`. The verifier separately creates its own fresh child HOME and state.

| Check | Outcome |
|---|---|
| `node --test apps/runtime/src/pi-durable-imports.test.mjs` | passed, 3 tests |
| Installed TypeScript with runtime `tsconfig.json` | passed, exit 0 |
| Installed TypeScript with `tsconfig.forbidden-bindings.json` | passed, exit 0 |
| Installed Vitest Worker suite | passed, 4 files and 28 tests |
| Biome on included changed source | passed, 5 files |
| `git diff --check` | passed |
| `node scripts/verify-pi-durable-local.mjs` | failed, exit 1 at Alchemy credential resolution |
| `pnpm runtime:verify` | failed, exit 1 on release-age policy before scripts |
| `pnpm runtime:local:verify` | failed, exit 1 on release-age policy before script |
| `pnpm verify` | failed, exit 1 on release-age policy before checks |
| Docker-backed model/tool turn | not run |
| Codex, hosted, browser and retained brain verification | not run, not authorized or unchanged/out of scope |

Independent direct-verifier artifacts are under `plans/evidence/artifacts/001/local-mZkwZX`. `invocation.json` confirms direct installed CLI invocation and the closed environment key list. `outcome.json` correctly records local and Docker turns as `not run`. Docker prerequisite and bundle preflight succeeded, but the candidate Worker never registered.

The Worker pool still falls back from requested `2026-09-16` to `2026-03-10`; its tests do not validate September candidate startup. Passing import checks do not substitute for an actual workerd/Docker run.

## Host decision and remaining gates

Confirmed the source-inspected Alchemy 0.94.0 tarball still calls `createCloudflareApi(props)` at `package/src/cloudflare/worker.ts:1198` before the local branch at line 1200. No compatible v1 solution was demonstrated.

Independently fetched upstream [v2 beta.54 release notes](https://alchemy.run/blog/2026-06-10-beta-54/) and [local-development docs](https://alchemy.run/cloudflare/local-development/). The release notes explicitly describe lazy local account/credential resolution. The local guide describes Effect-based resource composition, SQLite DOs and Docker containers. These are upstream support statements, not a verified Ditto integration. The guide also warns that resources without a local provider may deploy to the cloud, so any spike must exclude those resources and enforce local-only operation.

Recommended next decision: authorize a separate bounded Alchemy v2 compatibility spike before attempting a whole product migration. Its output should establish supported credential-free SQLite DO and stable Sandbox 0.12.3 integration, exact pins, and which normal composition changes would be required. Preserve existing product resources and data; no deployments, authentication reuse, namespace migration, reset or dependency patch. A spike failure must stop, not substitute another owner or engine. Alternative: remain on v1 and wait for a supported upstream backport. Merely rerunning 001 unchanged will not resolve the host prerequisite.

The exact Pi 1.0.1 pins remain inside the active one-day release-age window. Let them become policy-eligible before final default gates; no policy relaxation is needed or authorized. Passing those gates later still will not resolve Alchemy startup.

001 and dependent plans remain BLOCKED. All changes and artifacts stay uncommitted in the existing worktree.
