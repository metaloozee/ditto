# 001 local compatibility execution

Status: DONE for the independently reviewed local L0 scope in the detached execution worktree. `pnpm verify`, `pnpm runtime:verify`, and the actual host-authenticated local Worker/SQLite/Docker gate pass. See [final advisor acceptance](001-advisor-final-review.md). No changes were merged into the main branch and no later phase ran. Before separate 002 execution, refresh its provisional interfaces against accepted source/evidence. Earlier failures below remain historical.

Execution worktree: `/tmp/ditto-plan-001-cjCtMO`, detached at `dfeccf270e3937253375b19f9003c895cbd7eef1`. The plan base is `bcce03e`; source was unchanged between those bases. No staging, commit, push, deployment, existing namespace migration, live database access, subscription request or issue publication occurred. Initial attempts used no credentials; later runs used only the separately approved HOST Cloudflare resource properties, with no Cloudflare API request.

## Stop reason

Alchemy 0.93.12 cannot start this credential-free candidate Worker through the inspected local path. `node_modules/alchemy/src/cloudflare/worker.ts:1158` calls `createCloudflareApi(props)` before checking `this.scope.local && !props.dev?.remote`. Credential resolution then fails in `src/cloudflare/api.ts:52-64`. The isolated HOME has no configured Cloudflare profile and the child receives no Cloudflare credentials. The actual failure was `No credentials found`. Docker was reachable and the stable image pulled successfully, but the Worker never reached local Miniflare registration. No Docker-backed tool ran.

Required host change: a supported Alchemy local Worker composition which does not require Cloudflare credential resolution or remote account requests. Move credential-bearing setup out of the purely local path upstream, or provide a documented credential-free local API. This executor did not patch Alchemy, supply dummy credentials, use an existing login, replace Alchemy with Wrangler, or substitute another engine. Changing host/tool versions requires a new compatibility run.

A second blocker appeared when restoring repository policy after dependency installation. The selected 1.0.1 packages were published on 2026-10-03 and fail the repository's one-day minimum-release-age check. Default pnpm entry points reject chord, pi-ai, pi-durable, and transitive pi-telemetry 1.0.1 before running checks. Wait for the release-age window or obtain a separately approved, narrowly scoped policy decision. No policy exception remains in `pnpm-workspace.yaml`.

## Versions and published contracts

| Component | Exact tested version |
|---|---|
| Node | 24.21.0 |
| pnpm | 11.8.0 |
| Pi Durable / pi-ai / Chord | 1.0.1 / 1.0.1 / 1.0.1, exact direct pins |
| TypeBox | 1.3.27, exact direct pin |
| Alchemy | 0.93.12, existing locked root resolution |
| Sandbox / Containers | 0.12.3 / 0.3.7, unchanged |
| runtime TypeScript / Vitest / Worker pool | 5.9.3 / 3.2.7 / 0.12.21 |
| Workers types | 4.20260702.1 |
| Worker-pool workerd | 1.20260310.1 |
| root Alchemy workerd lock resolution | 1.20260915.1, candidate did not start |
| Docker client / server | 29.6.2 / 29.6.2 |
| Docker Desktop | 4.84.0 |
| execution image | `docker.io/cloudflare/sandbox:0.12.3` |
| pulled image digest | `sha256:23f67e16131b780865a5fa5aa3c8607408a730105c248836409f4e02bb6bf042` |

The configuration requests compatibility date `2026-09-16`. Worker-pool tests warn and fall back to `2026-03-10`. Tests therefore do not prove September runtime semantics. The candidate's Alchemy workerd did not start.

Packed and inspected the published Durable, AI, and Chord artifacts. Durable tarball SHA-1 is `4af5c9b2c8938806392cd94876f8bf769f48c790`; full package integrities are in the lockfile and `artifacts/001/pack.json`. Read the published Durable README, SQLite facade declarations and implementation, faux-provider contract, and the researched revision's normative storage/task contract and `14-chat.ts` synthetic-provider example.

Compared against upstream `7fbbd5f4a1d982bb02d63472dde0774fa639f99b`, version 1.0.0. The exported subpath set and root runtime-export names match. Published 1.0.1 requires Chord and pi-ai `^1.0.1`, rather than `^1.0.0`; diff and TypeBox pins remain 8.0.4 and 1.3.27. The package contains compiled `dist` files, README, and changelog, not the source/test/example directories referenced by the README. This is an export comparison, not a claim that every implementation is identical. `export-comparison.json` records the exact names.

## Implemented scope

- `apps/runtime/src/pi-durable-local.ts` composes supported Harness, registry, faux provider, and portable SQLite exports. The fixture owns only a synthetic marker tool and uses sequential execution. No coding-agent SDK or second engine is used.
- The plaintext SQL facade uses actual DO `storage.transaction`, serializes unrelated operations, consumes cursors synchronously, rejects expired transaction handles, and rejects unsafe bigint conversion. It is only an L0 fixture, not an encrypted or fully conformance-tested adapter.
- The deployed tool can only call the injected Sandbox writer/reader. There is no local file/shell fallback. Component failure coverage rejects an unreachable writer and proves the read adapter is not called afterward.
- There is no repository settings/resource loader, filesystem-backed credential store, executable extension discovery, MCP, skills, prompts, themes, context discovery, or Codemode. Only the deployment-owned fixture registry is installed. The provider receives an explicit auth context whose environment and file-existence methods return no values.
- Alchemy selects `DITTO_LOCAL_PI_DURABLE=1` before dotenv loading. The candidate branch excludes normal website, D1, R2, Route, retained brain, and retained Sandbox resources. It creates a new regular SQLite class and a separate Sandbox class with `maxInstances: 1`. Normal website composition and its migration transform remain unchanged inside `createWebsite`; the product-only `website` export retains its original inferred type.
- Public fetch is denied except the local verifier's loopback transport with matching port and fresh fixture header. The branch refuses non-local mode. The only admitted runtime identity is the verifier-generated fixture ID, not a product workspace.
- `scripts/verify-pi-durable-local.mjs` is finite. It checks Docker, bundles the candidate, creates fresh fixture state and HOME, selects an ephemeral loopback port, supplies an empty explicit `--env-file`, bounds readiness and the turn, asserts the answer/tool/marker and absence of the marker on the host, and terminates only its own child process group. It never falls back to a mocked executor or silently skips. The runtime's own Sandbox destruction is scoped to its fixture.
- Existing server source and retained tests were not edited. A test-only entry re-exports existing server classes and the candidate DO for Worker-pool SQLite tests.

## Isolation and actual Alchemy invocation

The verifier child environment is an allowlist: PATH, fresh HOME/TMPDIR, telemetry settings, and synthetic fixture selectors/state/identity/port. No inherited provider/product credentials or environment files were forwarded. PATH is used only for toolchain discovery. No root `.env` file was read. The CLI receives an explicit empty environment file, avoiding its default root-env discovery.

Actual selected command was `pnpm exec alchemy dev alchemy.run.ts --stage l0-<fresh-fixture-id> --env-file <fresh-state>/empty.env`. Invocations and environment key names are saved under `local-iRQFr3` and `local-4KrcdJ` in `artifacts/001`. Only the fixture execution Container resource was created; the candidate Worker failed before local startup. Container creation pulled/tagged the image, not a successful tool invocation.

The first invocation passed unsupported `dotAlchemy` through the root options. Typecheck later caught this and it was changed to the supported `rootDir` property. Thus the earlier Alchemy resource-state files are under this disposable worktree's `.alchemy/ditto-pi-durable-l0`, not the intended artifact directory. They remain intact and use new fixture stages. Final source sets `rootDir` to the fresh fixture state, but default pnpm release-age policy prevented another final-source Alchemy run. No generated Wrangler config or running candidate workerd exists. Intended state, command, bundle, metafile, Docker versions, and failure logs remain in the artifact directory.

## Import findings

The browser-platform bundle initially failed without compatibility support because stable Sandbox 0.12.3 imports `node:path/posix`. The second bundle externalized only `cloudflare:workers` and `node:path/posix`; candidate Alchemy configuration now requests `nodejs_compat` for this SDK path utility. This is a path operation, not host tool execution.

The actual preflight bundle/metafile is retained under `local-4KrcdJ`. Its static input check excludes web/product code, retained runner/brain, coding-agent SDK, and Node execution/SQLite adapters. Inspection also found an SDK process-environment lookup and pi-ai's variable dynamic importer for default auth file checks, including `node:fs/promises` and `node:os`. The candidate explicitly injects the closed auth context, and pi-ai's constructor selects it instead of `defaultAuthContext`. No Node tool or Node SQL adapter is composed.

That source argument is not a completed no-filesystem portability proof. The real candidate startup failed, the Worker pool enables Node filesystem support for its test runner, and a candidate-specific full import/dynamic-import test has not landed. Step 4 and its stronger safety claim remain incomplete. An unused shim alone does not pass L0.

## Verification results

All shell commands ran from the disposable worktree with a sanitized environment. Logs are under `plans/evidence/artifacts/001`.

| Check | Outcome | Command/result |
|---|---|---|
| Initial runtime baseline typecheck | passed | `pnpm --filter @ditto/runtime typecheck`, exit 0 |
| Candidate component check before policy restoration | passed | `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-compatibility.test.ts`, 3 tests, exit 0 |
| Focused checks before policy restoration | passed | `pnpm --filter @ditto/runtime exec vitest run src/forbidden-import-graph.test.ts src/pi-durable-compatibility.test.ts`, 4 tests, exit 0 |
| Runtime verification before policy restoration | passed | `pnpm runtime:verify`, 4 files / 28 tests, exit 0 |
| Actual finite Alchemy/Docker verifier attempt | failed | `pnpm runtime:local:verify`, exit 1; Alchemy credential resolution blocks Worker startup. `local-final.log` and `local-4KrcdJ/alchemy.log` |
| Docker-backed synthetic turn | not run | Image pull succeeded; no Worker/Sandbox turn or marker verification ran |
| Final exact default runtime command | failed | `pnpm runtime:verify`, exit 1 before tests due minimum release age. `runtime-locked-final.log` |
| Final exact default Docker command | failed | `pnpm runtime:local:verify`, exit 1 before verifier due minimum release age. `local-policy-final.log` |
| Final exact default repository gate | failed | `pnpm verify`, exit 1 before checks due minimum release age. `verify-policy-final.log` |
| Supplemental final installed runtime typecheck | passed | `node apps/runtime/node_modules/typescript/bin/tsc --noEmit -p apps/runtime/tsconfig.json` and the same command with `tsconfig.forbidden-bindings.json`, exits 0 |
| Supplemental final installed Worker-pool suite | passed | `node apps/runtime/node_modules/vitest/vitest.mjs run --root /tmp/ditto-plan-001-cjCtMO/apps/runtime --config /tmp/ditto-plan-001-cjCtMO/apps/runtime/vitest.config.ts`, 4 files / 28 tests, exit 0. `runtime-direct-final.log` |
| Candidate real workerd without Node compatibility | not run | Browser bundle rejects stable SDK `node:path/posix`; actual candidate never starts |
| Live Codex / hosted / browser | not run | Not authorized and outside this gate |
| `pnpm brain:verify` | not run | No shared contracts, retained brain source/inputs, runner support, or Dockerfile changed |

New test names are `commits a remote tool result and its answer in DO SQLite`, `fails without an executor and never calls a read fallback`, and `rolls back SQL and rejects expired transaction handles`. Their execution adapter is controlled in-memory component data, never Docker evidence.

Early own failures were fixed: generic SQL return annotation, RPC return-type recursion, missing Worker-pool test types/export, and accidental fixture/product binding union in the website export. These are implementation corrections, not upstream Pi failures.

The first `pnpm add` re-resolved unrelated `latest` web dependencies and automatically added release-age exceptions. That drift was removed. Final lock generation preserved every unrelated importer and existing snapshot, adding only the selected framework dependency closure, 104 snapshots / 102 package records. Frozen installation succeeded with the explicitly local command `pnpm install --frozen-lockfile --ignore-scripts --config.minimumReleaseAge=0`; default-policy commands subsequently reject those fresh pins. No release policy was weakened in the diff.

`pnpm verify` once passed with the temporary expanded lock after an isolated `npm ci --prefix packages/sandbox-runner --ignore-scripts`. That run covered 72 web files / 808 tests, web build, and runner verification. It is not the final-lock repository gate. Earlier `verify` failures and the temporary-lock success remain in artifacts; the table above gives the final disposition. Attempts to override age through an environment variable or parent CLI flag did not fix default nested pnpm policy checks and are not passes.

## Limits and handoff

L0 is blocked by the credential-free Alchemy host contract and active package-age policy. The Docker marker, real candidate imports, single-owner Docker behavior, and stronger dynamic-import denial remain unproved. Plaintext storage contains only synthetic component data. No retained workspace is enabled and no later phase passes by implication.

All code, logs, packed upstream artifacts, candidate bundles/metafiles, fresh fixture state, and generated local state remain in this worktree. `artifacts/001/.gitignore` keeps generated downloads/logs out of the proposed source diff. No worktree or artifact was removed. Review the partial diff before retrying with a supported credential-free host and policy-eligible pinned set.

## Resume on 2026-10-03

Read the historical advisor review first. Resumed the same detached worktree and preserved earlier code, artifacts and failures. The advisor review is unchanged. No dependency installation, release-policy override, staging, commit, main-checkout write, credentials, live model request or deployment occurred during this retry. Plans 002 and later remain untouched.

### Isolated launch repair

Reproduced the final-source launch failure with `node scripts/verify-pi-durable-local.mjs`. `local-Um5oBu/alchemy.log` records a Corepack download followed by pnpm's automatic install and `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. This happened before Alchemy.

The verifier now resolves the installed Alchemy entry, reads that package's declared `bin.alchemy`, validates its path, and invokes it with `process.execPath`. It does not launch pnpm, Corepack or an installer in the fresh HOME. The child still receives the closed environment, fresh HOME/TMPDIR/state and explicit empty `--env-file`. Docker/readiness/turn deadlines, answer/tool/marker and host-absence assertions, and owned-process-group cleanup remain intact.

The repaired original reproduction reached Alchemy 0.93.12 and pulled the stable image in `local-h02idw`. The final bundle-audited run is `local-qrbE9z`. Both stopped at `No credentials found` before Worker registration. This resolves the package-manager launch defect, not the host integration. The final invocation is `<process.execPath> <installed-alchemy>/bin/alchemy.js dev alchemy.run.ts --stage l0-<fresh-id> --env-file <fresh-state>/empty.env`. Its exact paths and environment key names are in `local-qrbE9z/invocation.json`. No child dependency download or install occurred on this path.

### Candidate import and dynamic-import audit

Added `scripts/check-pi-durable-imports.mjs`, shared by the finite verifier and `apps/runtime/src/pi-durable-imports.test.mjs`. The latter runs in Node with `node --test`, not in the Worker pool. `runtime:verify` includes it explicitly; Vitest excludes that one file without excluding existing Worker tests. Node bundler, AST-parser and test-runner APIs do not enter the candidate graph. No new dependency was added.

The check bundles the actual candidate entry with the installed Alchemy esbuild and parses the entire emitted JavaScript with installed TypeScript, including variable dynamic imports. It rejects unreviewed static/dynamic imports, process capability accesses, product/retained-runtime inputs, require/eval and unreviewed code generation. Negative tests inject filesystem/process imports, a variable importer, process builtin access, omitted closed auth, escaped default-auth references and additional model factory/constructor calls. All are rejected.

For this exact bundle, the only external modules are `cloudflare:workers` and `node:path/posix`. Stable Sandbox uses the latter for string path operations. Its process access is confined to a reviewed logging helper that reads environment values. The AST check pins that helper's full token body and rejects additional process accesses. It does not excuse process execution with a compatibility flag.

The bundle contains one variable dynamic importer. Its only two callers are the `node:fs/promises` and `node:os` probes inside pi-ai's default auth context. The audit checks the full default-context body, all importer/default-context references, the exact Models constructor, the factory body and all constructor/factory references. The sole composed factory call supplies the non-null closed auth object. JavaScript's nullish-coalescing constructor therefore cannot evaluate the default-context branch. The default environment reader is confined to that same unreachable context. This is a checked reachability argument for the pinned synthetic composition, not a general JavaScript sandbox or future-provider guarantee.

TypeBox also carries its deployment-owned validation acceleration helper, `Evaluate`, using `new globalThis.Function`. The audit checks its exact body. No repository schema, generated tool JavaScript or repository-owned configuration enters this fixture; only the static empty tool-argument schema does. This helper is not a filesystem/process execution adapter. Real Worker startup remains unproved.

The final `candidate.js`, `metafile.json` and `import-assessment.json` are in `local-qrbE9z`. Component tests still run March workerd semantics because of the Worker-pool fallback. No requested September-runtime or Docker import/startup result is claimed. Current [Cloudflare path docs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/path/) describe path utilities and note that Node compatibility is automatic for dates from 2026-08-04; the explicit existing flag is not proof of safety. The [process docs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/) distinguish environment lookup from process APIs and explain Worker binding population. The fixture has only synthetic string bindings, no credentials. We did not add filesystem compatibility to the candidate or patch dependencies.

### Supported host research and stop

Checked the [v1 Cloudflare auth guide](https://v1.alchemy.run/guides/cloudflare/). Its supported paths require OAuth, an API token or a global API key. It does not document a credential-free override for the inspected local Worker path.

Queried registry versions without installing them. A mature v1 release, 0.94.0, exists, published 2026-08-01. Downloaded its published tarball into `artifacts/001/alchemy-0.94.0-inspect` for source inspection only. `package/src/cloudflare/worker.ts:1198-1200` still constructs `createCloudflareApi(props)` before the local branch. It cannot resolve this blocker by a compatible minor toolchain adjustment. No manifest or lockfile version changed.

Upstream documents a real credential-free solution in the [2.0.0-beta.54 release](https://alchemy.run/blog/2026-06-10-beta-54/), which explicitly defers credential/account resolution in local dev, and the [v2 local-development guide](https://alchemy.run/cloudflare/local-development/). That guide uses the new Effect-based Worker/container/resource composition. Registry tags at this retry point to v2 beta releases, not a compatible v1 fix. Moving this repository's deployment owner to that API is broader than a minimal L0 version adjustment and would require normal resource/migration review. It was not attempted. Registry findings are saved in `resume-alchemy-versions.json`.

Stop host integration here. Preferred next action is a supported v1 backport that makes API construction/account resolution lazy for purely local Worker registration and resource provisioning. Alternatively, the advisor must authorize and scope a v2 Alchemy migration before changing the toolchain. No dummy authentication, existing login, dependency patch, private monkeypatch or second deployment owner was used. No issue was published.

### Retry verification

All commands below ran from `/tmp/ditto-plan-001-cjCtMO`. Supplemental commands used `env -i PATH="$PATH" HOME=/tmp/ditto-plan-001-cjCtMO NO_COLOR=1`; the verifier itself gives Alchemy a separate fresh HOME. The outer worktree HOME aligns the installed pnpm store without exposing a user auth store. Logs are under `plans/evidence/artifacts/001`.

| Check | Outcome | Exact command/result |
|---|---|---|
| Supplemental candidate bundle audit | passed | `node --test apps/runtime/src/pi-durable-imports.test.mjs`, 3 tests, exit 0; `resume-import-tests.log` |
| Supplemental installed runtime types | passed | `node apps/runtime/node_modules/typescript/bin/tsc --noEmit -p apps/runtime/tsconfig.json`, exit 0; same command with `tsconfig.forbidden-bindings.json`, exit 0 |
| Supplemental installed Worker suite | passed | `node apps/runtime/node_modules/vitest/vitest.mjs run --root /tmp/ditto-plan-001-cjCtMO/apps/runtime --config /tmp/ditto-plan-001-cjCtMO/apps/runtime/vitest.config.ts`, 4 files / 28 tests, exit 0; `resume-runtime-direct.log` |
| Repaired final finite local verifier | failed | `node scripts/verify-pi-durable-local.mjs`, exit 1 at Alchemy credentials; `resume-local-direct.log`, `local-qrbE9z/alchemy.log` |
| Docker prerequisite and image | passed | Verifier's `docker version --format '{{json .}}'`, exit 0; stable image pulled/up to date with unchanged digest |
| Actual Docker-backed model/tool turn | not run | Worker registration blocked; no tool or marker assertion ran |
| Exact default runtime gate | failed | `pnpm runtime:verify`, exit 1 before scripts; `resume-runtime-verify.log` |
| Exact default local gate | failed | `pnpm runtime:local:verify`, exit 1 before script; `resume-runtime-local-verify.log` |
| Exact final repository gate | failed | `pnpm verify`, exit 1 before checks; `resume-verify.log` |
| Supplemental included-source Biome | passed | `node node_modules/@biomejs/biome/bin/biome check alchemy.run.ts apps/runtime/src/pi-durable-local.ts apps/runtime/src/pi-durable-compatibility.test.ts apps/runtime/src/pi-durable-imports.test.mjs apps/runtime/src/pi-durable-test-entry.ts`, 5 files, exit 0 |
| Diff whitespace | passed | `git diff --check`, exit 0 |
| Lock preservation | passed | Parsed base and final lock with installed YAML; every existing package/snapshot and non-runtime importer identical, still 102 new package records / 104 snapshots; `resume-lock-comparison.json` |
| Actual Codex / hosted / browser | not run | Not authorized, outside L0 |
| `pnpm brain:verify` | not run | Retained/shared inputs remain unchanged |

Exact pnpm gates still reject the same four 1.0.1 packages under the active one-day policy. The retry logs include their 2026-10-03 12:29 UTC publication timestamps and cutoff. No waiting, policy exceptions or silent candidate downgrade occurred. Direct installed-bin results are supplemental only. The historical expanded-lock `pnpm verify` result is still not final-diff acceptance.

Advisor dispositions: isolated CLI launch resolved; static candidate/dynamic-import checks added and passed for this pinned composition; actual requested-date/Docker portability remains unresolved; credential-free host remains blocked even in inspected v1 0.94.0; package-age default gates remain failed. L0 stays BLOCKED pending those gates and advisor review. All partial source, tests and artifacts remain uncommitted in this worktree.

## User-approved release-age policy removal on 2026-10-03

The user explicitly approved disabling repository package minimum-release-age enforcement during 001 execution. This supersedes the earlier no-relaxation disposition only for that policy. Set `minimumReleaseAge: 0` in `pnpm-workspace.yaml` and remove the now-unused `@shadcn/react@0.1.0` and `shadcn@4.12.0` exclusions. The [pnpm settings reference](https://pnpm.io/settings/dependency-resolution#minimumreleaseage) defines this setting as a number of minutes and documents the v11 default of 1440, so omission would retain a one-day delay. Installed pnpm is 11.8.0; its sanitized `pnpm config get minimumReleaseAge` returned `0`.

Only the workspace policy and 001 documentation/index changed in this executor. `allowBuilds`, overrides, package extensions, dependency pins and all existing partial source/tests were preserved. No install or re-resolution command was invoked. Both default gates performed pnpm's automatic verification, reported all 1626 lock entries passing supply-chain checks and skipped resolution. The lockfile's Git blob hash before and after was identical: `68c7b2e071f062086a484c974cd993dc064c06eb`.

Commands ran from `/tmp/ditto-plan-001-cjCtMO` with the exact sanitized environment below. The worktree HOME avoids user auth stores. No environment files, auth stores or credentials were read by this executor. The verifier and its closed child environment were not edited or invoked.

| Check | Outcome | Exact command/result |
|---|---|---|
| Default runtime gate | passed | `env -i PATH="$PATH" HOME="$PWD" NO_COLOR=1 pnpm runtime:verify`, exit 0; both runtime TypeScript checks, 3 Node import-audit tests and 4 Worker files / 28 tests; `artifacts/001/policy-approved-runtime-verify.log` |
| Default final repository gate | failed | `env -i PATH="$PATH" HOME="$PWD" NO_COLOR=1 pnpm verify`, exit 1 in `pnpm check`; Biome scanned preserved extracted Alchemy research templates under `plans/evidence/artifacts/001/alchemy-0.94.0-inspect/package/templates`, reporting 617 errors, 798 warnings and 4 infos; `artifacts/001/policy-approved-verify.log` |
| Effective release-age setting | passed | `env -i PATH="$PATH" HOME="$PWD" NO_COLOR=1 pnpm config get minimumReleaseAge`, exit 0, output `0` |
| Diff whitespace | passed | `git diff --check`, exit 0 |
| Alchemy/local Docker integration | not run | Not authorized in this executor; historical credential-free startup blocker remains |
| Actual Docker-backed model/tool turn | not run | No Worker startup, sandbox tool or marker assertion was attempted |
| Provider / hosted checks | not run | Not authorized |

The repository gate no longer fails on release age. Its unrelated Biome failure is recorded without moving, deleting, formatting or excluding preserved artifacts and without changing check policy. Later typecheck, web tests/build and runner checks in that short-circuiting gate did not run. The runtime Worker pool still falls back to `2026-03-10`, not the requested `2026-09-16`.

Latest disposition: package-age blocker resolved by explicit user approval; exact runtime gate passed; final repository gate failed on existing research artifacts; credential-free Alchemy host and actual Docker turn remain unproved. L0 and dependent plans stay BLOCKED. Offered credentials are not authorization to use them. No staging, commit, merge, push, deployment, reset or main-checkout write occurred. All changes remain uncommitted.

Advisor independently reviewed the scoped config diff and reran `pnpm runtime:verify` successfully with both typechecks, 3 Node import tests and 28 Worker tests. Reran `pnpm verify`, which exited 1 in Biome on extracted upstream research templates; log is `artifacts/001/policy-advisor-verify.log`. `git diff --check` passed and main checkout remained clean. Release-age removal is accepted as the user-approved scoped change, not acceptance of L0. No credential or Docker integration was attempted in this review.

## HOST-only credential approval and child-environment blocker

The user approved using only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from `/home/ayan/ditto/.env.local` for Alchemy HOST startup in a local-only test. The stated token scope is Account Settings Read for the development account, with an explicit Account ID. No permission verification or live Account read was needed or attempted. This approval supersedes earlier statements that all credential use was unauthorized, but does not authorize deployment, remote resource mutation, provider calls, hosted checks, other file values, existing profiles or Global API Keys.

The intended loader must require an explicit file path, parse in memory with installed dotenv, select only those two keys, validate without printing values, keep the empty CLI `--env-file`, and redact both values before output or artifact writes. Neither value may enter Worker bindings, the bundle, Docker/container environments, SQLite, invocation records or logs. Model and executor fixtures remain synthetic and credential-free. Any eventual approved successful run is a host-authenticated local test, not credential-free startup.

### New boundary finding

Before implementing or invoking a real credential loader, inspected installed Alchemy 0.93.12's Docker process path. `node_modules/alchemy/src/docker/api.ts:181-197` supplies either `process.env` or a full spread of it to `execa(this.dockerPath, args, ...)`. `DockerApiOptions` exposes only `dockerPath` and `configDir`; it has no child-environment allowlist. `src/cloudflare/container.ts:390-440` uses this API for the candidate's external-registry image pull/tag. Therefore adding the two credentials to the Alchemy host environment, as requested, also forwards them to Docker CLI children before Worker startup. These are host Docker client processes, not evidence that the values enter the execution container, but the approval explicitly prohibits Docker/container environments and permits only the Alchemy control process.

Executed `artifacts/001/host-env-boundary-repro.mjs` with a sanitized outer environment. It first invokes actual `docker version`, then supplies synthetic values to the installed `DockerApi` and uses its supported custom executable path to run a Node child that reports only the two key names. The child receives both keys. The reproduction asserts this result and exits 0. This Node probe exercises installed Alchemy's child-launch implementation; it is not a mocked Docker PASS or a Worker/tool integration gate. Actual Docker client/server remain 29.6.2. No real credential file or auth store was read.

No dependency patch, process-global monkeypatch, Docker PATH wrapper or toolchain migration was attempted. The explicit opt-in loader and its forwarding/redaction regression tests were not implemented because the requested host environment cannot yet satisfy the complete approved boundary. Source/tests and candidate bundle remain unchanged in this resume. The reproduction and logs are preserved as ignored research artifacts.

### Remote API inspection

Rechecked `src/cloudflare/api.ts:64-101`: explicit API token plus Account ID constructs the client without account discovery. `src/cloudflare/worker.ts:1158-1216` constructs it before entering the local branch; local registration uses only fixture bindings and returns before deployment operations. `ContainerApplication` returns for local dev before API construction. The candidate has no remote bindings, proxies or tunnel. This is source inspection, not an observed authenticated run. No remote Cloudflare request or resource mutation was made in this resume.

### Current checks

All commands ran only from `/tmp/ditto-plan-001-cjCtMO`, detached at `dfeccf2`. The outer environment key names were PATH, HOME and NO_COLOR, with HOME set to this worktree. No install or resolution command was run and no main-checkout writes occurred.

| Check | Outcome | Exact command/result |
|---|---|---|
| Installed host child-environment reproduction | passed | `env -i PATH="$PATH" HOME="$PWD" NO_COLOR=1 node /tmp/ditto-plan-001-cjCtMO/plans/evidence/artifacts/001/host-env-boundary-repro.mjs`, exit 0; `host-env-boundary-repro.log` |
| Actual Docker prerequisite | passed | Reproduction's `docker version --format '{{json .}}'`, exit 0; client/server 29.6.2 |
| Default runtime gate | passed | `env -i PATH="$PATH" HOME="$PWD" NO_COLOR=1 pnpm runtime:verify`, exit 0; both typechecks, 3 Node audit tests, 4 Worker files / 28 tests; `host-approval-runtime-verify.log` |
| Default repository gate | failed | `env -i PATH="$PATH" HOME="$PWD" NO_COLOR=1 pnpm verify`, exit 1 in Biome on preserved Alchemy templates; `host-approval-verify.log` |
| Approved host-authenticated `pnpm runtime:local:verify` | not run | Stopped before reading the approved file because Alchemy forwards host credentials to Docker children |
| Actual Worker/DO/Docker marker and committed answer | not run | No new fixture ID, candidate bundle or local invocation was created in this resume |
| Live provider / hosted / browser | not run | Outside approval |
| `pnpm brain:verify` | not run | Retained/shared inputs unchanged |

Worker tests still fall back to compatibility date `2026-03-10`; the candidate still requests `2026-09-16`. Exact pins, prior image digest and historical bundles remain as recorded above, not new successful startup evidence. The repository gate remains blocked on the retained research-template lint scope. No templates were deleted, formatted or excluded, and no root Biome change was made. Advisor scope approval is required before such an exclusion.

At that stop, 001 remained BLOCKED pending safe credential delivery and advisor review. The request to broaden host Docker CLI inheritance was subsequently rejected by the advisor. Environment delivery was this executor's proposed implementation, not a user requirement. The user authorized local use of two selected values, not exporting them. The next section records the supported resource-property solution; the reproduction above remains valid only for the rejected environment proposal.

## Supported HOST resource auth and actual local Docker result

The advisor identified the documented public Worker options `apiToken: alchemy.secret(...)` and `accountId`, which take precedence over environment lookup. Implemented that path in the same detached worktree at `dfeccf270e3937253375b19f9003c895cbd7eef1`. No toolchain migration, dependency change, dependency patch, environment monkeypatch, second engine, Sandbox migration, deployment or main-checkout write occurred.

### Scoped implementation

- `scripts/pi-durable-host-auth.ts` reads only an explicitly designated file, parses it in memory with installed dotenv, selects `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and validates with key-only errors. It never calls dotenv.config or writes environment variables. The helper returns only those two values. Its masking function operates after full stream collection, so split chunks cannot evade masking.
- The finite verifier requires `--cloudflare-env-file PATH`. Its closed child environment contains only the file path, never the selected values. The explicit empty Alchemy CLI `--env-file` remains. Parent selection is used solely for validation, redaction and boundary assertions. Stdout and stderr are captured separately without unredacted streaming, then masked before bounded log writes. No token env file is generated.
- After checking local mode and fresh fixture selectors, candidate HOST composition selects the same file and supplies named auth properties only to the candidate Worker. Container props, Worker bindings, model and executor receive none. The app uses a random 32-byte in-memory password through supported Alchemy options. No password is persisted or sent to child environments. Host management token fields are automatically encrypted; explicit account metadata exists only in HOST management records. This exception does not permit credentials in canonical runtime storage.
- The Worker API `baseUrl` points to a loopback denial server owned by the verifier. Any attempted Cloudflare control-plane API call receives 403 locally and fails the gate. This supported option prevents remote API requests while using genuine approved credentials for host construction. The final outcome records `cloudflareApiAttempted: false`. No live permission check or Account read was necessary.
- A fresh workspace marker under each fixture state directory makes Alchemy's supported workspace-root discovery place actual Miniflare SQLite under that directory. Earlier successful `local-gLgnEM` used fresh names in worktree-local Miniflare state; it was not deleted. Final runs use fully isolated state, HOME and TMPDIR.
- `apps/runtime/src/pi-durable-local-entry.ts` exports only the Worker handler and two DO classes. This separates supported Worker exports from component helpers and constants. The bundle audit now targets this actual entry and retains all static/dynamic-import and closed-auth checks. No audit rule was weakened.
- The real Docker fixture asserts that neither approved key exists in Worker bindings or in the execution environment. The execution assertion uses only Sandbox's remote `exec` and emits no values. Existing unreachable-executor component coverage still proves no read or local fallback. The committed model turn remains faux and the marker tool remains deployment-owned and sequential.

Three new synthetic tests run in the exact runtime gate: `selects only host auth keys without exporting dotenv values`, `invalid credentials and split logs cannot expose selected values`, and `public resource auth keeps inherited Docker child environment credential-free`. They use only synthetic credential files, exercise the actual loader/public API constructor/Alchemy serializer, and use installed DockerApi's supported custom executable probe. Serializer coverage confirms v1 ciphertext rather than plaintext token state. The DockerApi probe is explicitly a child-environment behavior check, not Docker integration evidence. All tests passed before reading the real approved file. A test-harness env-object prototype comparison, missing Scope phase and ciphertext-shape assertion were corrected before that real read.

### Startup failures and supported fixture corrections

The first property-auth attempt, `local-q3oVBQ`, reached actual local workerd but failed because requested `2026-09-16` exceeded installed Alchemy Miniflare's maximum `2026-07-17`. No API call was attempted. This reveals the actual Alchemy runtime is workerd 1.20260710.1 with Miniflare 4.20260710.0, not the root 1.20260915.1 lock resolution previously inferred. The inference remains historical, not successful version evidence.

Changed only the disposable candidate compatibility date to `2026-03-10`, matching the semantics supported by the installed Worker-pool tests. Normal product resources and their dates remain unchanged. September semantics are not claimed. This requires no dependency resolution or weakening of import checks.

The next attempt, `local-3nCHwW`, failed at Worker module instantiation because the old entry exported string constants such as `FIXTURE_ANSWER`. Workerd requires function/handler/class exports. The new narrow entry fixes that candidate composition mistake while keeping component helpers available to tests. The verifier now recognizes `ERR_RUNTIME_FAILURE` promptly instead of waiting through a known watch-mode startup failure.

Actual subsequent Docker turns passed in `local-gLgnEM`, `local-tBO73L`, `local-3E0Ohj`, and final-source `local-IYgQe5`. Earlier attempts remain preserved and are not retroactively passes.

### Final actual local evidence

Final fixture ID is `af6025293a456e3bddaa22f7aa447de6`, stage `l0-af6025293a456e3bddaa22f7aa447de6`, loopback port 39731. State is `artifacts/001/local-IYgQe5`. Its `invocation.json` records the resolved Node 24.21.0 binary and installed Alchemy CLI, `dev alchemy.run.ts --stage <fresh-stage> --env-file <fresh-state>/empty.env`, file path and environment key names only.

Outer environment keys were PATH, HOME, NO_COLOR. The Alchemy child received PATH, fresh HOME/TMPDIR, NO_COLOR, DITTO_LOCAL_PI_DURABLE, DITTO_FIXTURE_ID, DITTO_FIXTURE_STATE, ALCHEMY_STATE_FILE, ALCHEMY_CI_STATE_STORE_CHECK, WRANGLER_SEND_METRICS, ALCHEMY_TELEMETRY_DISABLED, DO_NOT_TRACK, DITTO_FIXTURE_CLOUDFLARE_ENV_FILE, DITTO_FIXTURE_API_ORIGIN, and DITTO_FIXTURE_PORT. Neither approved credential key is exported.

Exact package pins remain Pi Durable/pi-ai/Chord 1.0.1 and TypeBox 1.3.27, Sandbox/Containers 0.12.3/0.3.7, Alchemy 0.93.12 and pnpm 11.8.0. Actual Alchemy workerd is 1.20260710.1; Worker-pool workerd remains 1.20260310.1. Both execute candidate semantics at compatibility date `2026-03-10`. The stable Sandbox image digest remains `sha256:23f67e16131b780865a5fa5aa3c8607408a730105c248836409f4e02bb6bf042`. Local container plumbing also pulls `cloudflare/proxy-everything` at `sha256:0ef6716c52430096900b150d84a3302057d6cd2319dae7987128c85d0733e3c8`.

The actual regular SQLite runtime DO committed `Synthetic sandbox marker verified.` and the tool result `ditto-disposable-l0`. Sandbox readback verified the marker at `/tmp/ditto-l0-af6025293a456e3bddaa22f7aa447de6.txt`; trusted-host stat checks found no file before or after. Actual container credential-absence command succeeded. The owned Sandbox was destroyed after readback and only the verifier's own host process group was terminated.

Final artifacts include `candidate.js`, `metafile.json`, `import-assessment.json`, `docker.json`, `invocation.json`, `result.json`, redacted `alchemy.log`, `outcome.json`, `credential-boundary.json`, encrypted HOST resource JSON and actual synthetic DO SQLite/WAL files under `.alchemy/miniflare/v3`. The artifact audit checked 28 files, found two management records carrying encrypted secrets, found no plaintext token anywhere, and found account metadata only under the HOST management namespace. Candidate bundle, logs, result, invocation and runtime SQLite contain neither selected credential value. The ephemeral encryption password is generated only in HOST app options and has no persistence/output path.

This is a host-authenticated local test. It is not credential-free Alchemy startup, actual provider evidence or hosted acceptance. Sandbox's local log reports HTTP transport internally despite the fixture requesting the SDK RPC option. No host execution fallback occurred. Workerd warned about local egress-listener loopback fallback; this synthetic marker turn does not prove hosted egress policy.

### Final gates and remaining decision

| Check | Outcome | Exact command/result |
|---|---|---|
| Actual finite Worker/SQLite/Docker gate | passed | `env -i PATH="$PATH" HOME="$PWD" NO_COLOR=1 pnpm runtime:local:verify --cloudflare-env-file /home/ayan/ditto/.env.local`, exit 0; final `local-IYgQe5` |
| Runtime types, import/auth checks and Worker tests | passed | `env -i PATH="$PATH" HOME="$PWD" NO_COLOR=1 pnpm runtime:verify`, exit 0; both TypeScript checks, 6 Node tests and 4 Worker files / 28 tests; `props-auth-runtime-final.log` |
| Web/Alchemy composition typecheck | passed | `env -i PATH="$PATH" HOME="$PWD" NO_COLOR=1 pnpm typecheck`, exit 0; `props-auth-web-typecheck.log` |
| Exact repository gate | failed | `env -i PATH="$PATH" HOME="$PWD" NO_COLOR=1 pnpm verify`, exit 1 in Biome; 617 errors, 798 warnings, 4 infos from preserved upstream templates; `props-auth-verify-final.log` |
| Included changed-source Biome | passed | Installed Biome on `alchemy.run.ts`, `pi-durable-local.ts`, `pi-durable-local-entry.ts`, exit 0, 3 included files; root config excludes scripts |
| Diff whitespace | passed | `git diff --check`, exit 0 |
| Live provider / hosted / browser | not run | Outside approval; no allowance consumed |
| `pnpm brain:verify` | not run | Shared contracts, retained brain/runner inputs and Dockerfile unchanged |

The only observed final gate blocker is root Biome scanning preserved downloaded research. Its short-circuit still means later repository web tests/build and runner checks did not run on this final diff. No artifact was deleted, moved or formatted and no Biome exclusion/rule was changed. Advisor must decide the exact exclusion scope before any root config edit. Core L0 runtime/Docker gates pass, but 001 is not marked DONE because repository acceptance and advisor review remain pending. No later plan ran. All source, tests, evidence and management state remain uncommitted in the existing worktree.

## User-approved Biome directory exclusions

The user explicitly approved excluding the complete root `plans/` and `docs/` directories from Biome during 001 execution. Added only `!plans/**` and `!docs/**` to root `biome.json` files.includes using the documented [negated glob syntax](https://biomejs.dev/reference/configuration/#filesincludes). Installed schema is Biome 2.4.5. Existing includes/excludes, VCS settings and lint/format/import rules are unchanged. Application sources remain checked. Preserved downloaded artifacts were not deleted, moved or formatted.

This config-only executor used the existing detached worktree `/tmp/ditto-plan-001-cjCtMO` at `dfeccf2`. Only `biome.json`, this evidence, the 001 plan header/scope and index changed. No dependencies were installed or re-resolved. No credentials, environment files or auth stores were read. The authenticated Docker gate was not rerun. Its independent advisor pass in `artifacts/001/local-HcN6mj` remains the actual Worker/SQLite/Docker evidence, with no Cloudflare API attempt. The authenticated advisor review and all earlier failures remain unchanged.

| Check | Outcome | Exact command/result |
|---|---|---|
| Final repository gate | passed | `env -i PATH="$PATH" HOME="$PWD" NO_COLOR=1 pnpm verify`, exit 0; Biome checked 278 files with no fixes, web typecheck, 72 web files / 808 tests, web build, runner typecheck, 11 runner files / 79 tests and runner build; `artifacts/001/directories-approved-verify.log` |
| Final runtime gate | passed | `env -i PATH="$PATH" HOME="$PWD" NO_COLOR=1 pnpm runtime:verify`, exit 0; both runtime TypeScript checks, 6 Node checks and 4 Worker files / 28 tests; `artifacts/001/directories-approved-runtime-verify.log` |
| Diff whitespace | passed | `git diff --check`, exit 0; `artifacts/001/directories-approved-diff-check.log` |
| Authenticated local Docker | not run | Unchanged config-only task; independent advisor pass retained in `local-HcN6mj` |
| Live provider / hosted / browser / brain | not run | Outside this task; retained/shared inputs unchanged |

Implementation gates passed, pending advisor final review and acceptance. This is not DONE and does not unblock 002. Main checkout was not modified. No staging, commit, merge, push, deployment, reset or artifact removal occurred. The existing worktree remains uncommitted.
