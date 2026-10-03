# 001 advisor execution review

Verdict: BLOCKED, not accepted as a completed L0 implementation. Preserve the partial diff for a retry. Do not start 002 or transfer this diff to the main branch as completed work.

Reviewed detached base `dfeccf270e3937253375b19f9003c895cbd7eef1` in `/tmp/ditto-plan-001-cjCtMO`. Executor used `openai-codex/gpt-6.1-sol` with Medium reasoning. No staging, commit, merge, push, deployment, live provider call, or main-checkout edit was performed.

## Scope and source review

Read every changed source/configuration file, all new tests and the executor evidence. Compared the full tracked diff. Parsed both lockfiles and checked their structures: only the runtime importer changed; all existing package records and snapshots stayed identical; 102 package records and 104 snapshots were added. The new dependencies belong to the selected framework closure, not an unrelated web upgrade.

The candidate branch selects configuration before dotenv loading, excludes normal product resources, uses distinct regular SQLite and Sandbox class names, and caps the candidate container at one instance. The original website resource definitions and migration transform remain inside the normal branch. No runner, retained brain, shared contract, or Dockerfile change needs brain verification. The candidate uses supported published Harness/SQLite/faux-provider APIs, an injected executor and synthetic data. No alternate engine, Node execution adapter or local tool fallback was found in the composed source.

## Blocking items

1. **The actual Docker gate did not run.** The executor's `local-4KrcdJ/alchemy.log` shows an image pull followed by `No credentials found`, before local Worker registration. Confirmed the host cause in installed Alchemy `src/cloudflare/worker.ts:1158-1160`: credential-bearing API construction precedes the local branch. Existing credentials must not be forwarded to make this pass. A supported credential-free Alchemy path is required before retrying.
2. **The final verifier has an additional launch failure.** `scripts/verify-pi-durable-local.mjs:17-20,62-65` supplies a fresh HOME then launches `pnpm exec`. This changes pnpm's default store location relative to the installed modules. My direct final-source verifier run exited 1 before Alchemy, with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`; the child attempted an automatic dependency installation. Its log is `artifacts/001/local-Cqriee/alchemy.log`. Waiting for package age alone does not repair this. A retry should launch the resolved installed Alchemy CLI directly, or explicitly preserve the non-secret package-manager store configuration, without restoring the user's HOME, credentials or weakening supply-chain policy. This remains the Alchemy deployment/development path, not a new deployment owner.
3. **Candidate portability checks remain incomplete.** `scripts/verify-pi-durable-local.mjs:48,54` externalizes a Node path utility and checks selected static input names, not forbidden filesystem/process APIs or variable dynamic imports. No candidate-specific import test was added. Component tests enable filesystem compatibility for the test runner and fall back to compatibility date `2026-03-10`. They cannot prove the candidate's requested `2026-09-16` runtime or that default auth filesystem imports are unreachable. Complete plan step 4 before claiming L0.
4. **Default package-manager gates currently reject the exact pins.** Independently reproduced four minimum-release-age violations for Chord, pi-ai, pi-durable and transitive pi-telemetry 1.0.1. No policy exception is in the proposed diff. Wait for policy eligibility or obtain a separate explicit policy decision; do not silently relax the policy.

## Independent verification

Commands ran only in the disposable worktree. Environments contained PATH, a credential-free HOME and NO_COLOR. No environment files or credential values were read or forwarded.

| Check | Result |
|---|---|
| Installed TypeScript, runtime `tsconfig.json` | passed, exit 0 |
| Installed TypeScript, `tsconfig.forbidden-bindings.json` | passed, exit 0 |
| Installed Vitest Worker-pool suite | passed, 4 files and 28 tests, including 3 new synthetic component tests |
| Biome on included changed source files | passed, 4 files; root Biome excludes the new script and runtime configuration files |
| `git diff --check` | passed |
| `pnpm runtime:verify`, HOME set to this credential-free worktree to match its installed store | failed, minimum-release-age policy, before tests |
| `pnpm runtime:verify`, `pnpm runtime:local:verify`, `pnpm verify`, each with a fresh review HOME | failed, automatic dependency-install/store mismatch, before their scripts |
| `node scripts/verify-pi-durable-local.mjs` with fresh review HOME | failed, own child hit automatic dependency-install/store mismatch; Docker version and browser bundle preflight completed |
| Docker-backed model/tool turn | not run |
| Live Codex, hosted, browser and `brain:verify` | not run, not authorized or unchanged/out of scope |

Supplemental test commands:

```sh
node apps/runtime/node_modules/typescript/bin/tsc --noEmit -p apps/runtime/tsconfig.json
node apps/runtime/node_modules/typescript/bin/tsc --noEmit -p apps/runtime/tsconfig.forbidden-bindings.json
node apps/runtime/node_modules/vitest/vitest.mjs run --root /tmp/ditto-plan-001-cjCtMO/apps/runtime --config /tmp/ditto-plan-001-cjCtMO/apps/runtime/vitest.config.ts
```

These direct installed-bin checks are supplemental. They do not turn the failing default gates into passes. The executor's earlier expanded-lock full verification result does not establish final-diff acceptance.

## Handoff

Keep 001 BLOCKED and all later plans blocked. Resolve the supported credential-free host path, repair isolated CLI launch, complete candidate import/dynamic-import evidence, and rerun the exact final runtime, Docker and repository gates. Keep provider and hosted results separately `not run`. All partial code and evidence remain uncommitted in this worktree. The main checkout remains unchanged.
