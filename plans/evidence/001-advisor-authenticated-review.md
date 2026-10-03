# 001 advisor review of host-authenticated local gate

Verdict: the core local compatibility gate is independently verified. Plan 001 remains BLOCKED only on final repository lint scope; it is not yet accepted as DONE. Do not start 002 or merge this work as completed implementation.

Reviewed the existing detached worktree `/tmp/ditto-plan-001-cjCtMO`, base `dfeccf270e3937253375b19f9003c895cbd7eef1`. Main checkout remains clean and unchanged. No staging, commit, merge, push, deployment or live model call occurred.

## Reviewed implementation and boundaries

Read the complete host-auth helper and synthetic tests, finite verifier, actual Worker entry and composition, candidate runtime, revised import-audit entry and tracked configuration diff. Supported named Worker auth options avoid exporting credential values to Alchemy/Docker child environments. The normal product resource branch is preserved. Only the two user-authorized Cloudflare values are selected from the explicit source file, not product/provider values.

The candidate remains local-only with one distinct regular SQLite DO and one stable Sandbox executor. Worker bindings and container environments do not receive host credentials. Host secret resource properties use Alchemy encryption with an ephemeral in-memory app password. The loopback API-denial transport uses the supported baseUrl option and makes a control-plane request fail the gate rather than reach Cloudflare.

The narrow Worker entry fixes workerd's handler/export requirements without changing the component helpers. Candidate compatibility date is explicitly `2026-03-10`, not the original unproved September date. Alchemy workerd is 1.20260710.1; Worker-pool workerd is 1.20260310.1. Both runs use March semantics. No September compatibility, live provider support, hosted egress policy or retained-state safety is claimed.

The actual remote tool still uses Sandbox write/read only. Failure coverage still rejects an unreachable executor without local fallback. The real Docker run additionally checks that neither selected credential key is present in the execution environment. The bundle audit checks the actual narrow entry and the closed provider-auth composition, not Node test-runner imports.

## Independent verification

Commands ran only in the disposable worktree, with sanitized outer environment `env -i PATH="$PATH" HOME="$PWD" NO_COLOR=1`. Credential access occurred only through the reviewed explicit loader during the authorized local verifier; no raw credential file or management-state record was printed.

| Check | Result |
|---|---|
| `pnpm runtime:verify` | passed, both runtime typechecks, 6 Node import/auth tests, 28 Worker tests |
| `pnpm runtime:local:verify --cloudflare-env-file /home/ayan/ditto/.env.local` | passed, exit 0, actual Alchemy Worker/SQLite/Docker turn |
| `pnpm verify` | failed, exit 1 in Biome on preserved extracted upstream templates |
| `pnpm typecheck` | passed independently, exit 0 |
| `pnpm test` | passed independently, exit 0 |
| `pnpm build` | passed independently, exit 0 |
| `pnpm runner:verify` | passed independently, exit 0 |
| `git diff --check` | passed |
| Live provider, hosted, browser and brain verification | not run; outside approval or retained/shared inputs unchanged |

Independent Docker artifacts are `plans/evidence/artifacts/001/local-HcN6mj`. Its outcome records local/Docker `passed`, host-resource-property auth, and `cloudflareApiAttempted: false`. Credential boundary audit checked 28 files, detected encrypted secrets in two host management records, found no plaintext token, and confined account metadata to host management state. The marker and committed synthetic answer passed, and the trusted-host marker was absent.

Independent repository logs are `artifacts/001/auth-advisor-repository-verify.log`, `auth-advisor-typecheck.log`, `auth-advisor-test.log`, `auth-advisor-build.log`, and `auth-advisor-runner-verify.log`. Running those stages separately does not turn the failing exact `pnpm verify` command into a pass.

## Remaining decision

Root Biome includes all `**/src/**/*` and ignores Git ignore files. That pattern picks up preserved downloaded upstream research under `plans/evidence/artifacts/001/alchemy-0.94.0-inspect/package/templates`, despite the artifacts' .gitignore. They are not Ditto source. No artifact was deleted/formatted and no lint rule or source exclusion was changed in this review.

Recommended narrowly scoped change, awaiting user approval: add only `!plans/evidence/artifacts/**` to root `biome.json` files.includes. Preserve all existing source checks and lint rules, then rerun exact `pnpm verify` and confirm it passes before marking 001 DONE. This root configuration edit is outside the original plan's allowed paths, so it was not performed without approval.

All implementation and evidence remain uncommitted in the existing worktree. User approval of local auth and release-age removal does not authorize transfer to the main branch, deployment or subsequent phases.
