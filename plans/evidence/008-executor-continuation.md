# 008 execution preflight

Disposition: BLOCKED before implementation. The strict dependency preflight did not pass. Plan 008 and its index remain unchanged and not implemented. This record is not independent acceptance.

## Base and permitted scope

Disposable detached worktree: `/home/ayan/ditto-execution/plan-008-4WXvNW`.
HEAD: `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`.
Initial `git status --short` was empty. All execution commands explicitly changed to this worktree. The only written file is this evidence record. No product source, tests, configuration, manifest, lockfile, plan or index was changed.

Read the complete 008 plan and refresh, the complete authoritative runtime specification, root instructions and README, workspace/package configuration, and all six named 005/006/007 acceptance and integration records. Integrated 007 commits `5a33d81` and `3bdf90a` are ancestors of HEAD. Required storage, host-private, history test, credential DO, model adapter, host and credential request Worker test files are present. Predecessor acceptance remains historical evidence, not a baseline result for this execution.

## Exact dependency checks

Read-only commands checked `pwd`, `git rev-parse HEAD`, `git status --short`, `node --version`, launcher paths, explicit dependency paths, predecessor ancestry and `git diff --check`. No package manager was executed.

- Node is `v24.21.0`, at `/home/ayan/.vite-plus/js_runtime/node/24.21.0/bin/node`.
- `command -v pnpm` resolves to `/home/ayan/.nvm/versions/node/v24.14.1/bin/pnpm`. Its resolved target is Corepack's `dist/pnpm.js`, not an installed project test runner. Reading the shim shows download-prompt setup and delegation to Corepack. Corepack's installed package metadata reports `0.34.6`. No proof that this launcher will avoid automatic installation was established, so neither `pnpm --version` nor any pnpm gate was invoked.
- Installed npm metadata reports `12.0.2`. npm was not executed.
- Root package metadata requests pnpm `11.8.0`. Runtime metadata pins Pi Durable, Pi AI and Chord `1.0.1`, and Sandbox `0.12.3`. Installed project versions cannot be verified because project dependencies are absent. Manifests and lockfiles remain untouched.

The following paths are absent in this worktree:

```text
node_modules
apps/web/node_modules
apps/runtime/node_modules
apps/credential-tests/node_modules
node_modules/.bin/vitest
apps/web/node_modules/.bin/vitest
apps/runtime/node_modules/.bin/vitest
apps/credential-tests/node_modules/.bin/vitest
```

A bounded existence-only check also found no dependency directory at `/home/ayan/ditto-execution/node_modules`, the recorded 007 recovery worktree, or the recorded 005/006 execution worktrees. No usable already-prepared isolated environment was identified. No dependency content, credential file or environment file from the main checkout was read or copied. No install, repair, npx/dlx fallback, cleanup or dependency mutation occurred.

## Gates

| Gate | Status | Result |
| --- | --- | --- |
| Required plan/specification/predecessor reading and integrated file checks | passed | Named records read; prerequisite files present; 007 integration ancestors verified |
| Initial worktree and whitespace checks | passed | Clean initial status; `git diff --check` exit 0 |
| Dependency preflight | failed | No local project dependencies or Vitest runner; Corepack launcher noninstallation guarantee unestablished |
| Web baseline: session-command, session-command-delivery, session-runtime-ownership | not run | Blocked before launching Vitest |
| Runtime baseline: pi-durable-effects, pi-durable-models | not run | Blocked before launching Vitest |
| `credentials:verify` baseline | not run | Dependencies absent; pnpm not invoked |
| Ordered implementation stages 1 through 4 and their gates | not run | Strict stage-0 block; no implementation |
| Contracts, typecheck, brain, runtime and repository aggregate gates | not run | Strict stage-0 block |
| Live provider, hosted, Docker, browser and retained-data checks | not run | Outside authorization |

Tests collected: zero. Tests executed: zero. There is no test failure, timeout, workerd invocation or compatibility-date result from this execution. The first failure is the missing-dependency preflight, not a Pi feasibility failure. No A–E protocol decision was implemented and no cross-store handoff was introduced. Default product composition remains unavailable.

## Stop reason and resumption requirement

Stopped because the mandatory installed-runner prerequisite is missing. Resumption requires separate, narrowly scoped authorization to prepare dependencies only for this disposable worktree, preserving the pinned manifests and lockfiles and avoiding shared hook/dependency mutation, or provision of an explicitly identified already-prepared isolated environment. Main-checkout repair is not required or authorized. No authorization to deploy, use credentials, make provider requests or mutate retained/shared databases follows from preparing dependencies.

After that prerequisite is supplied, establish a noninstalling launcher and rerun all three credential-free baseline gates before any source change. Keep `.env.local` and platform credentials out of the test environment. The parent must independently review the eventual diff and rerun done criteria before any DONE status.

## Authorized continuation

The user subsequently authorized locked, script-disabled dependency preparation only in this worktree, including an isolated pinned pnpm toolchain and the two independent npm packages. The initial missing-dependency failure above remains historical fact. It has not been rewritten as a pass.

Current disposition: STOPPED with a partial stage-1 increment, READY FOR REVIEW of that blocked increment only. Not ready for acceptance of 008. No DONE status, plan change or index change.

### Dependency preparation

Preparation used `env -i`, explicit worktree-local HOME, XDG cache/data/config directories, npm cache, pnpm HOME and pnpm store under `.execution-008/`. No main-checkout dependency directory, HOME, cache, store or hook was used. There were no project `.npmrc` files at root or in the seven checked package locations. All checked root/web/runtime/credential `.env` and `.env.local` paths were absent; no environment file or credential was copied or read.

The first toolchain-install attempt failed before config resolution because both npm userconfig and globalconfig pointed to `/dev/null`, which npm rejects as double loading. Exit 1, no package installation. The preserved log is `.execution-008/toolchain-install.log`. Two distinct empty worktree-local config files corrected that launcher configuration. The next explicitly authorized attempt installed exact `pnpm@11.8.0` with `--ignore-scripts --no-audit --no-fund`, without a project lockfile change. Log: `.execution-008/toolchain-install-continuation.log`.

Workspace preparation ran the local pnpm binary with `install --frozen-lockfile --ignore-scripts --store-dir <worktree>/.execution-008/store`. It exited 0, installing 1280 packages. Registry download warnings and retried downloads are retained in `.execution-008/workspace-install.log`. No lifecycle/native installation script or Lefthook hook was enabled.

Independent package preparation ran `npm ci --ignore-scripts --no-audit --no-fund` with explicit absolute prefixes for `packages/session-brain` and `packages/sandbox-runner`. Both exited 0, adding 274 and 273 packages respectively. Their logs retain npm's warning about the inherited pnpm store-dir configuration. No package version or lockfile was repaired or upgraded.

SHA-256 baselines for all eleven graph files are preserved in `.execution-008/dependency-baseline.json`. Read-only comparisons after workspace installation, after the baseline tests and after both independent installs matched every entry. They still match at the stop point. The list covers root manifest, pnpm lock/workspace configuration, four workspace manifests and both independent manifest/lockfile pairs.

Installed versions checked from package metadata:

| Component | Version |
| --- | --- |
| Node / npm / local pnpm | 24.21.0 / 12.0.2 / 11.8.0 |
| Web Vitest | 4.1.10 |
| Runtime, credentials, brain and runner Vitest | 3.2.7 |
| TypeScript | 5.9.3 |
| Workers pool | 0.12.21 |
| Pi Durable / Pi AI / Chord | 1.0.1 / 1.0.1 / 1.0.1 |
| Sandbox | 0.12.3 |

### Noninstalling verification and actual results

`.execution-008/clean-run.sh` invokes the worktree-installed pnpm via an explicit PATH, not Corepack. It sets `pnpm_config_verify_deps_before_run=error`, `npm_config_ignore_scripts=true`, clean HOME/cache/store/config, `CI=true` and disabled Wrangler metrics. Inspection of the installed pnpm source established that `verifyDepsBeforeRun=error` throws on stale dependencies rather than invoking its install branch. This avoids pnpm 11's default `install` policy. Verification produced no dependency-repair operation.

All three mandatory stage-0 baseline commands ran sequentially before source edits and exited 0:

| Command/gate | Result | Preserved log |
| --- | --- | --- |
| Web baseline, original command/delivery/ownership suites | 37 passed across 3 files, counts 18 / 16 / 3 | `.execution-008/baseline-web.log` |
| Runtime baseline, effects/models suites | 112 passed across 2 files, counts 62 / 50 | `.execution-008/baseline-runtime.log` |
| `credentials:verify` | Typecheck passed; 164 Worker tests across 2 files, counts 22 / 142; 3 Node tests passed | `.execution-008/baseline-credentials.log` |
| Stage-1 `contracts:verify` | Typecheck/build passed; 49 tests across 4 files, including 24 new candidate-contract cases and all 25 existing tests | `.execution-008/stage1-contracts.log` |
| First stage-1 `pnpm typecheck` | Failed, exit 2, TS2322 at `session-runtime-authority.ts:126` because the expanded session-owner type could escape through the old coordinator authority result | `.execution-008/stage1-typecheck.log` |
| Typecheck after a narrow old-authority denial correction | Not run | Stopped on the confinement issue below |
| Web baseline after the ownership changes | Not run | Stopped on the confinement issue below |
| Stages 2–4 and their new Worker/runtime integration suites | Not run | Not implemented |
| Sequential final contracts/brain/credentials/runtime/repository aggregates | Not run | Not reached |
| Final `git diff --check` | Passed | Read-only check at the stop point |

The runtime baseline requested compatibility date 2026-09-16 and reported an effective fallback to 2026-03-10. Credential configuration requests 2026-03-10. No hosted date claim follows. Web route-generation warnings and the runtime compatibility warnings are retained, not suppressed. No live provider request occurred; the existing credential tests used their synthetic private protocol and mock destination.

### Partial source scope

Five tracked source/test files and two new source/test files are changed:

- `packages/runtime-contracts/src/product-command.ts`, new bounded BrowserCommandV2, CommandV2 and handoff-ack parsers for four ordinary kinds, exact identity fields, fixed queue deadline, SHA-256 digest shape and 8192 UTF-8-byte text bound. No command-wide model/thinking field or recovery kind is accepted. Parsing preserves text rather than truncating or normalizing it.
- `packages/runtime-contracts/src/product-command.test.ts`, 24 passing parser cases including multibyte boundaries, V1 preservation, authority-field denial, unsupported recovery/version denial and malformed handoff/body checks.
- `packages/runtime-contracts/src/index.ts`, exports the candidate contracts.
- `apps/web/src/db/schema.ts`, adds `pi_durable_v1` only to the session owner's TypeScript enum. No physical SQL schema or historical migration changed, and no candidate row is created.
- `apps/web/src/lib/session-runtime-ownership.ts`, recognizes the candidate discriminator and permits no transition into or out of it.
- `apps/web/src/lib/session-runtime-ownership.test.ts`, preserves the original three cases and adds candidate owner/version, prohibited transition and old-coordinator denial cases. The added web cases have not run.
- `apps/web/src/lib/session-runtime-authority.ts`, rejects candidate sessions before the old coordinator queries project/identity/capacity state. This addresses the first typecheck failure without widening the old coordinator's owner contract, but remains unverified.

The last authority correction and its test were not reformatted or tested after the stop. The contracts gate passed before that correction; it does not prove the web increment. The new parsers are not wired into product admission. There is no candidate receipt/admission/readiness implementation, namespace/composition activation, resource claim, start reconciliation, ordered host consumption, control implementation or new Worker integration suite. Requirements A–E and stages 1–4 remain incomplete. No provider-policy, encrypted host-storage or summary behavior was changed. Production composition remains unavailable.

### Confinement failure and stop

The test launcher mistakenly omitted `TMPDIR`, `TMP` and `TEMP`. A read-only check under that exact launcher reported `os.tmpdir()` as `/tmp`. The existing web fixture imports `tmpdir()` and calls `mkdtempSync(join(tmpdir(), "ditto-journal-"))` at `apps/web/src/test/session-runtime-fixture.ts:262`; its cleanup calls `rmSync` at line 923. The passing baseline exercises that fixture. Its test-created journal files therefore used the system temporary directory rather than the authorized worktree. Runtime/credential harness temporary paths were not separately inventoried, so confinement cannot be claimed for them either.

This was a scope violation by the executor, not a failed Pi or product gate. It was detected after the partial source work and disclosed immediately. No further tests, source edits, installs or cleanup followed. Only bounded read-only checks and this evidence append followed. No external temporary path was inspected, removed or repaired. Existing fixture cleanup had already run as part of the tests. Exact generated temporary names and remaining external artifacts were not captured, and no claim of their absence is made.

Before resumption, the parent should review this deviation and direct continuation. The launcher must explicitly set all temporary roots inside this worktree, and the harnesses must be checked for absolute/custom temporary paths before rerunning the baselines. This request does not seek permission to use `/tmp`, weaken tests, delete external artifacts or waive confinement. All source hunks need independent review; the latest web increment still needs its first successful typecheck and tests. The initial dependency block is resolved, but 008 remains incomplete and execution is stopped on confinement.

## Parent-directed confinement correction

The parent reviewed all seven source/test files, the launcher and this evidence, independently matched all eleven graph hashes, and authorized correction of the launcher followed by a bounded harness audit. This review was not 008 acceptance. The prior test-journal violation and unknown external artifact limits remain unchanged.

Only `.execution-008/clean-run.sh` was changed in this continuation. It now creates `<worktree>/.execution-008/tmp` and sets `TMPDIR`, `TMP` and `TEMP` to that absolute directory within its `env -i` launch. A read-only Node check under that exact launcher verified physical cwd and `os.tmpdir()`:

```text
cwd=/home/ayan/ditto-execution/plan-008-4WXvNW
os.tmpdir()=/home/ayan/ditto-execution/plan-008-4WXvNW/.execution-008/tmp
TMPDIR=/home/ayan/ditto-execution/plan-008-4WXvNW/.execution-008/tmp
TMP=/home/ayan/ditto-execution/plan-008-4WXvNW/.execution-008/tmp
TEMP=/home/ayan/ditto-execution/plan-008-4WXvNW/.execution-008/tmp
```

The bounded read-only audit searched the baseline test files, web journal fixture, runtime/credential configs and harnesses, independent brain/runner tests, installed Workers pool and installed Miniflare implementation for temporary roots and absolute `/tmp` paths. No external `/tmp` path was opened, enumerated, inspected or cleaned.

### Audit findings

- The web fixture's journal and the inspected brain/runner content fixtures use `os.tmpdir()`, so the corrected launcher supplies their temporary root.
- Installed Miniflare `4.20260310.0` creates its own temporary directory from `os.tmpdir()` at `dist/src/index.js:81810–81812`. Its inspected helper fallbacks use `/tmp` only after `os.tmpdir()` and the explicit temporary environment variables fail to supply a path. The corrected environment supplies those values. This is a bounded source check, not proof of every platform syscall or hosted isolation.
- Some test strings mentioning `/tmp` are rejected CLI inputs, mocked paths or assertions, not independent evidence of content-file writes.
- A real bypass exists in the final repository runner gate. `packages/sandbox-runner/src/control-channel.ts:90–92` derives its default Unix socket path as an absolute `/tmp/ditto-agent-<digest>.sock`, ignoring all temporary roots. `startControlServer` uses this default at line 223, unlinks the endpoint at line 224, listens at line 302 and unlinks again during close at line 323. The first two cases in `packages/sandbox-runner/src/control-channel.test.ts:27–86` use the default for actual socket server/client I/O. The path assertion at line 131 explicitly requires the `/tmp` prefix.

The endpoint is a Unix socket, not journal or transcript content. Its hardcoded absolute location is a repository choice; the audit did not establish a platform mandate for that location. Neither socket mutation nor stale-endpoint deletion outside the worktree is authorized. The code could touch a deterministic external endpoint before any test-owned listen, so it cannot be waved through as ordinary temporary-content confinement.

### Current stop and gate statuses

Stopped immediately on that explicit bypass, as the parent instructed. No corrected baseline, typecheck, formatter, aggregate, install or source edit ran in this continuation. The initial TS2322 remains a historical failure, and its correction is still unverified. The added ownership cases remain unrun. Source scope is unchanged at seven files; only the generated launcher and this evidence were updated. `.execution-008/` remains intact and untracked, separate from intended implementation scope. Plan and index remain not implemented and not DONE.

| Check in this continuation | Status |
| --- | --- |
| Corrected launcher physical cwd and actual `os.tmpdir()` | passed |
| Bounded harness confinement audit | failed, explicit runner socket bypass found |
| Corrected sequential web/runtime/credential baselines | not run, audit stop |
| Corrected web typecheck and narrow formatting | not run, audit stop |
| Remaining 008 stages and final aggregates | not run, audit stop |
| External artifact inspection or cleanup | not run, prohibited |

READY FOR REVIEW of the stopped partial increment and confinement finding only. Resumption needs parent direction for the named runner socket component. A narrow additional source scope could make its default honor the isolated temporary root while retaining the socket length/normalization and real roundtrip tests. Alternatively, the parent could supply an environment with an independently isolated socket namespace. No external-socket exception, runner-source change, fixture alteration, cleanup, weakened assertion or dependency addition has been performed or assumed.

## Separate executor continuation after socket-test authorization

Disposition: BLOCKED on an incomplete corrected credential baseline. READY FOR REVIEW of the partial increment only, not acceptance of 008. The original dependency block, TS2322, system-temporary journal incident and socket audit stop above remain historical evidence.

The user authorized only the first two real Unix socket tests to supply explicit worktree-local paths through the existing options. This executor changed `packages/sandbox-runner/src/control-channel.test.ts` accordingly. Each server and every client call use the same test-local path, `rt-<pid>.sock` or `seq-<pid>.sock`, beneath `os.tmpdir()`. Both concurrent calls carry the explicit option. Real roundtrips, serialization order, all assertions and the default `/tmp` normalized-path string test remain intact. Production `control-channel.ts` is unchanged. No external socket was inspected or cleaned.

All commands explicitly changed to `/home/ayan/ditto-execution/plan-008-4WXvNW`. HEAD remains `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`. The supplied harness reports `PI_MODEL=gpt-6.1-sol` and `PI_REASONING_LEVEL=medium`; no model override was made. The complete plan, refresh, specification, named 005/006/007 accepted evidence, repository instructions, README, inherited increment and relevant platform skills were read. No new installation or dependency repair occurred.

The initial direct invocation of `.execution-008/clean-run.sh` failed with exit 126, permission denied, before Node or tests launched. The existing script is not executable. Subsequent commands invoked it explicitly with `sh`; its mode and content were not changed. This was a launcher invocation error, not a test failure.

A Node check through `sh .execution-008/clean-run.sh` verified that TMPDIR, TMP, TEMP and actual `os.tmpdir()` all equal `/home/ayan/ditto-execution/plan-008-4WXvNW/.execution-008/tmp`. The sample sequence socket path measured 76 UTF-8 bytes. Socket names are distinct and short. The narrow runner test then passed.

The corrected stage-0 commands ran sequentially, followed by the requested web typecheck:

| Gate | Status | Result and preserved log |
| --- | --- | --- |
| Runner control-channel test | passed | Exit 0, all 7 tests; `.execution-008/continuation-control-channel.log` |
| Web command/delivery/ownership baseline | passed | Exit 0, 40 tests across 3 files, 18 / 16 / 6; `.execution-008/continuation-baseline-web.log` |
| Runtime effects/models baseline | passed | Exit 0, 112 tests across 2 files, 62 / 50; `.execution-008/continuation-baseline-runtime.log` |
| Corrected `credentials:verify` baseline | failed to finish | Command tool timed out after 120 seconds; credential typecheck passed and the credential-DO file reported 22 passing tests, but the 142-case request-contract file had no final result; `.execution-008/continuation-baseline-credentials.log` |
| `pnpm typecheck` after the inherited authority guard | passed | Exit 0; `.execution-008/continuation-typecheck.log` |
| Eleven dependency graph hashes | passed | Every entry still matches `.execution-008/dependency-baseline.json` |
| `git diff --check` | passed | Exit 0 after source inspection |
| Stages 1–4 completion and new integration suites | not run | Corrected baseline incomplete; no further feature implementation |
| Five sequential final aggregates | not run | Not reached |
| Hosted, live provider, retained activation, Docker, browser and benchmarks | not run | Outside this local continuation |

The credential command's 120-second timeout is an outer command timeout, not an observed Vitest assertion failure or proof of a Pi feasibility defect. Its log stops after the `pending outcome before reopen` integrity case. There is no suite-total result or Node crash-test result. A bounded process check immediately afterward found no surviving worktree pnpm, Vitest or workerd process. No signal, cleanup or rerun followed. No timeout setting was increased, no test was filtered or weakened, and no incomplete suite is claimed as passed. Cause remains unclassified. The older 164 Worker plus 3 Node baseline pass does not substitute for this corrected invocation.

The runtime requested 2026-09-16 and reported the inherited fallback to 2026-03-10. Credential configuration requests 2026-03-10. Web route warnings and runner npm configuration warnings remain in logs. No live-provider or hosted result follows.

### Stable diff and remaining handoff

The total implementation diff now has eight source/test files: the seven inherited parser/export/schema/ownership/authority files listed above, plus the narrowly authorized runner socket test. This continuation changed only that runner test and formatting of the last ownership denial test. The inherited authority guard now passes typecheck and its candidate-denial regression. Two new contract files remain untracked; they are part of intended source scope, not generated toolchain material. The only documentation write is this worktree evidence record. `.execution-008/` remains intact, generated and untracked. Manifests, lockfiles, production runner socket behavior, plan and index remain unchanged.

No candidate admission, receipt store, model readiness, identity/capacity claim, direct-DO delivery, command membership callback, start-versus-expiry reconciliation, sequence cursor, autonomous follow-up consumption or priority-control protocol has been implemented. There is no new cross-store handoff to accept. The V2 parser enforces the declared 8192-byte text and fixed 900000-ms queue TTL contracts only; it grants no execution authority and is not wired to admission. Default product composition stays unavailable. Encrypted storage, summary behavior and exact-claim guards are unchanged.

Resumption must first classify the incomplete credential baseline through the nearest existing test seam, preserving this first timeout and the unchanged test deadlines. Do not silently retry until green or treat elapsed command time as a terminal runtime result. Only after usable baseline evidence should implementation advance through the prescribed A–E and stages 1–4, then all five aggregates. Parent independent diff review and gates remain required. No staging, commit, merge, push, deploy, shared database mutation, external cleanup or worktree removal occurred or is authorized by this report.

## Parent classification and current stage-0 disposition

The parent independently classified the interruption and ran the exact corrected `sh .execution-008/clean-run.sh pnpm credentials:verify` command once with a sufficient 600-second outer tool budget. The preserved independent log is `plans/evidence/artifacts/008/advisor-baseline/credentials.log` in this worktree. It reports 164 Worker tests across two files, Worker duration 258.01 seconds, and all three Node checks passing. The parent reports exit 0. This executor inspected the recorded suite totals and Node results. It is a current independent baseline pass, not 008 feature acceptance.

The previous complete executor credential baseline had already taken 218.91 seconds. Setting a 120-second outer command budget for the later invocation was therefore a predictable command-budget mistake by the executor/advisor, not an observed Vitest failure. The historical interruption remains preserved. No Vitest, host, effect, configuration or product deadline changed for the independent pass. Future authorized complete-suite invocations require sufficiently long outer budgets; that does not require renewed installation or deadline approval.

Stage 0 is now resolved by the current web 40, runtime 112, web typecheck and independent credential 164 plus 3 results. No additional baseline repetition was performed. Root `package.json` script-only registration of the planned Worker test remains authorized when that suite exists; its deliberate hash change must be recorded separately from preserved dependency declarations and lockfiles.

## Candidate credential-policy composition scope gap

Disposition: READY FOR REVIEW of the current partial increment and this named scope gap. No further implementation file changed in this continuation. This is not a failed Pi compatibility gate or a request to extend test deadlines.

Source inspection while tracing required section C composition found a necessary implementation location absent from the plan's allowed paths:

- `apps/web/src/lib/model-product-transport.ts`, `performPrivateModelRequest`, calls `CodexCredential.getByName(owner).requestModel(input, capability)`. The product transport does not own credential attachment or final credential-side authority.
- `apps/web/src/lib/codex-credential-do.ts:201–206`, `requestModel`, constructs `new ModelProductAuthority(this.env.DB)` internally. There is no protected policy factory or separate deployment-owned candidate request method. Its subsequent `current`, `reserve`, repeated `permit`, denial and accounting operations use that local policy through credential attachment and dispatch.
- `apps/web/src/lib/model-product-authority.ts`, `ownedConfiguration` and `facts`, currently require `s.runtimeOwner='trusted_v1'`. Making candidate policy explicit at the product permit RPC does not change the independently constructed policy inside the credential DO.
- `apps/credential-tests/src/entry.ts`, `FixtureCredential`, overrides fixture availability and phase waits but inherits `requestModel`. The credential state, ownership, revision and decryption helpers are ECMAScript-private methods in the base class. A fixture entrypoint cannot inject the required policy into the existing credential dispatch by overriding a public hook that does not exist.

Section C requires separate deployment-owned candidate policy and unchanged old/default composition. A default constructor that inferred candidate authority from browser/claim JSON or whichever owner happens to be in D1 would violate that closed composition requirement. Copying the credential request implementation into a fixture subclass would duplicate the accepted final-claim/decryption/dispatch protocol rather than use the mandatory adapter's existing credential owner. Neither workaround was implemented or proposed as acceptance evidence.

The smallest required additional source scope is `apps/web/src/lib/codex-credential-do.ts` for a deployment-owned policy injection seam or separate candidate method, with the existing method retaining its trusted/default behavior. The synthetic body and ModelSubjectV1 stay unchanged; credential storage, renewal, deadlines, exact claim and final permit/revision checks must remain intact. The existing fixture entrypoint can then select the closed candidate policy through that seam. Candidate policy support itself belongs in already allowed `model-product-authority.ts` and transport/configuration modules.

The user limited extra source scope to the two runner socket tests, while the refreshed plan's allowed web module list does not include the credential DO file. This executor therefore names the missing target and waits for scope clarification rather than editing it, widening the default allowlist or inventing a credential handoff. This gap does not reopen accepted 007. It identifies the composition seam needed to execute 008's new owner policy. Stages 1–4 and final aggregates remain incomplete. No new provider request, admission row, membership seed or cross-store handoff was introduced.

## Fresh Codex continuation, 2026-10-10

Current disposition: READY FOR REVIEW of a partial, blocked candidate. Plan 008 is incomplete. No DONE or acceptance claim. Earlier sections are chronological records; their statements that no candidate implementation existed do not describe the current files.

### Execution identity and confinement

HEAD remains `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`, detached in `/home/ayan/ditto-execution/plan-008-4WXvNW`. The nonsecret harness details reported model `gpt-6.1-sol`, provider `openai-codex`, reasoning `medium`. No fallback or model override occurred. The executor read the complete plan, refresh, authoritative specification, six named predecessor records, current evidence, current source and relevant platform skills. No repository prompt injection was identified.

All commands and writes explicitly targeted this worktree. Verification used `sh .execution-008/clean-run.sh`, the existing isolated environment and installed runners. No reinstall occurred. The historical system-/tmp journal violation remains disclosed above. No external temporary artifact was inspected or deleted in this continuation. The eleven graph checks report only the authorized root `package.json` script change; comparison excluding `scripts` confirms all other root metadata is unchanged. All three lockfiles and all other graph-file hashes match the baseline. Staging is empty. No main source/dependency/cache, live credential/provider, retained database, deployment, reset, Git commit, push, merge or cleanup operation occurred.

A final brain gate exposed a separate isolated-cache limitation. Its unchanged freshness test removes `npm_*` environment settings and then performs an offline installation in its own worktree-local synthetic copy. The test therefore uses `.execution-008/home/.npm`, not the launcher cache. Copying the already-existing `.execution-008/cache/npm` into that worktree-local default cache did not supply the missing Vitest registry metadata. Both failed logs remain. No package-resolution repair, fresh package installation or test change followed. This is not a Pi compatibility failure.

### Scope and compatibility

The current intended increment contains 29 modified tracked source/test/configuration files and seven new implementation files. The new files are:

- `packages/runtime-contracts/src/product-command.ts` and `product-command.test.ts`.
- `apps/web/src/lib/session-command-candidate.ts`.
- `apps/web/migrations/0023_candidate_product_commands.sql`.
- `apps/runtime/src/pi-durable-product-session.ts` and `pi-durable-commands.test.ts`.
- `apps/credential-tests/src/product-commands.worker.test.ts`.

Tracked changes cover candidate schema/journal/migration tests, admission/routes/client/ownership/authority, entrypoint composition/legacy denial tests, model/configuration authority and private transport, host/model binding, credential Worker fixture/configuration, root test-script registration and the separately approved two runner socket tests. The credential DO change is the separately approved protected `modelProductAuthority()` factory used by the existing request method. The historical default remains `new ModelProductAuthority(this.env.DB)` and unavailable production dispatch. Only the separate fixture subclass selects the closed candidate policy and executor namespace. Credential format/storage/renewal, request protocol and final permit/revision checks were not intentionally changed.

`.execution-008/` and prior evidence/artifacts remain intact and untracked. They are not intended source integration. The plan and index were not changed.

Pinned environment remains Node/npm/pnpm `24.21.0/12.0.2/11.8.0`, TypeScript `5.9.3`, runtime/credential Vitest `3.2.7`, web Vitest `4.1.10`, Workers pool `0.12.21`, Pi Durable/Pi AI/Chord `1.0.1`, Sandbox `0.12.3`, local workerd `1.20260310.1`. Runtime configuration requests `2026-09-16` and actually falls back to `2026-03-10`; credential tests request `2026-03-10`. No hosted compatibility claim follows.

Candidate compatibility tuple: owner `pi_durable_v1`, owner version `1`, runtime protocol `2`, command/receipt/handoff/queue-decision version `2`, encrypted Pi storage format `4` and adapter `ditto-encrypted-storage-4`, crypto format `1`, host version `pi-1.0.1/ditto-host-3`, candidate sequence-cursor version `2`. The candidate namespace is separate and rejects historical host command meaning; the old owner cannot reopen a retained candidate cursor. No owner migration is enabled. The fixture executor controller namespace is `fixture-pi-durable-execution-v1`.

The fixture ceiling remains one persistent D1 workspace claimant, one registered synthetic executor, one runtime owner and one unresolved/live model reservation. Completion, Stop, close or timeout does not release the workspace claimant. This registration does not establish a real Sandbox process. Candidate text is rejected above 8192 UTF-8 bytes. The fixed queue TTL is 900000 milliseconds; it is not a healthy whole-run timeout. The existing one-second host work and one-second drain budgets, finite model/effect deadlines and five-second test limits were not increased.

### Implemented candidate behavior and handoffs

These describe inspected code and specific local tests, not completed plan acceptance.

| Handoff | Durable intent/outcome and recovery | Current evidence and limits |
| --- | --- | --- |
| Authenticated product admission to D1 | One atomic batch binds owner/target-scoped key, exact receipt and message IDs, sequence, owner/protocol, outbox, persistent fixture claim and synthetic executor registration. Same key returns original identity; changed payload conflicts. | Real local D1 concurrent identical/distinct first prompts and eleven injected batch-boundary rollbacks pass. POST handler and real legacy-owner denials pass. Rejections leave no candidate rows. |
| D1 outbox to direct DO | Delivery reconstructs immutable content/membership/digest/current owner from product records. Leased delivery matches exact command, receipt, owner and sequence acknowledgment. Encrypted inbox/product metadata, local message/run membership and wakeup intent precede acknowledgment. | Lost DO acknowledgment/new dispatcher and retained original receipt pass in the narrow Worker gate. Corrupt admitted text denies reconstruction. Future sequence is acknowledged before consumption. Scope is bound to the deterministic dedicated DO identity. Not every reconstruction-field tamper has a permanent test. |
| Runtime queue decision to D1 membership | The host persists exact `started` or `expired` intent before an idempotent bounded private reconciliation callback. D1 atomically records matching decision and command/run/user/assistant/epoch membership. Opposite fate and mismatched digest deny. Provider authority requires the reconciled candidate start. | Real D1 opposite-fate/idempotency tests and runtime lost-ack close/reopen tests for both decisions pass. The latter uses a controlled product callback, not real D1 transport. Real admitted expiry creates no root, submission or provider call. Full real-D1 before/after-commit crash matrix remains incomplete. |
| Host consumption to Pi | Stable command request identity and `submitting` inbox state precede supported `root.submit`; retained `submissionByRequest` is validated against conversation/type/request and original queued/placed payload before mapping. Guarded callback repairs exact numeric task/submission/command membership before model admission. | New encrypted real-DO tests pass before/after submit, lost alarm scheduling, ordered gaps, controls and immediate provider callback held before submit returns. A thrown post-submit fixture fault produces a committed `unanswered` submission; it is failed visibly with projection intent and never automatically replayed as successful work. This is not proof of successful continuation through every abrupt process-death point. |
| One-input turn to next input | Ordinary selection uses the durable sequence cursor/dispositions, waits for `done`, and does not continue `unanswered` as healthy work. One instruction runs per actual host invocation. The DO alarm joins supported Pi `waitForIdle` and actual close, then durably rearms the next known sequence. Gaps do not authorize skipping. | Pinned package README documents follow-ups being placed when a run answers, steers after tools, and failed inputs as `unanswered`; public declarations document `waitForIdle`. Runtime ordered 3,1,2 tests and native Worker alarms pass narrowly without test `schedule` calls. Aggregate timing failure prevents acceptance of autonomous progress as a reliable guarantee. |
| Priority Stop/cancel and late membership | Stop persists the exact run's epoch fence outside the ordinary waiting lane before cooperative cancellation. Cold inspection uses `harness.conversation`, never root creation. Cancel reconstructs missing accepted target, retains disposition and pending-failure projection, and occupies its own sequence. Late terminal delivery preserves original ack, membership, terminal epoch/state and complete assistants. | Cold Stop after disconnect, multiple undelivered follow-ups across reopen, held credential claim with zero fetch, missing-target cancel, and delayed-delivery completion race pass narrowly. Runtime fault tests cover local control accounting. Held configuration, all cancel/start orderings, delayed old Stop versus newer run and each control durability crash point are not fully demonstrated. |
| Candidate model policy | Separate deployment-owned policy compares candidate owner, protocol, fixture claim, closed executor namespace and exact identity. `current/open/reserve/permit` require reconciled start rather than queue TTL and retain current window/effect clocks. Old trusted policy retains command expiry. | Real D1 started work past queue TTL passes current/open/reserve/permit. Expired/wrong-owner/wrong-namespace/protocol calls deny. Three candidate denials persist review. All 142 historical request-policy tests pass in the final executions. Candidate-specific exact-host-halt and queued prepared-configuration change still need dedicated end-to-end coverage. |

The new handoffs are not a D1/DO/Pi distributed transaction. Full projection delivery to D1 remains 010. Local pending projection intent is the scope here. Real coding tools remain 009.

### Corrections and preserved failures

The interrupted executor's last snapshot-fix log actually passed one filtered integration case, with 24 explicit skips. The first fresh unfiltered product run passed all original 25 candidate cases.

The new runtime command suite first failed cold Stop root creation and a post-submit-success assumption. `liveInputs` now reads an existing conversation instead of creating a root. Diagnostic metadata proved that the injected post-submit throw retained `unanswered`, so its permanent assertion now requires original submission/receipt plus failed member/run/projection and no provider replay, rather than pretending that failure resumes successfully. The initial failed logs are preserved.

Expanded native tests exposed persistent interceptor closures, unnecessary fixture observation authority RPCs, fixture reopen/alarm overlap, and host budget spent on configuration before scheduling. The fixture trap is installed once with per-test counters, snapshots read existing fixture storage passively, reopen joins prior alarm/close, candidate default preparation runs before allocation with fresh final authority, and direct-DO alarms join the existing invocation. Queue decision callbacks are bounded. No final model admission check or deadline was removed.

These corrections produced a full narrow Worker pass, but did not make the final aggregates green. Final credential verification timed out the ordered native-alarm test at the unchanged 5000ms limit and reported isolated-storage/unhandled failure afterward. Repository verification later timed out the delayed-delivery completion/reopen test at the same limit. The observed timeouts are genuine failed tests, not outer command interruption, and cannot be replaced by narrower passes. Their exact critical-path timing cause is not independently established. No retry-until-green or increased deadline followed.

### Actual verification

Commands below used the exact confined launcher. All logs are under `.execution-008/`; predecessor/baseline records remain unchanged.

| Gate | Status | Actual result / log |
| --- | --- | --- |
| Stage 1 contracts/typecheck/web baseline | passed | Contracts 49; web typecheck; command/delivery/ownership 42. `continuation-contracts.log`, `continuation-web-typecheck.log`, `continuation-web-stage1.log` |
| First new runtime command test | failed | 6 passed, 2 failed. `continuation-runtime-commands-first.log` |
| Corrected stage 2/3 runtime command/effects/host/models | passed | 176 across four files, including nine new command cases. `continuation-runtime-stage2.log`, `continuation-runtime-stage3.log` |
| First runtime/credential typechecks with new tests | failed, then corrected | Test discriminated-union construction and fixture TypeScript narrowing, respectively. Original and corrected logs retained. |
| Expanded product Worker attempts | failed, preserved | Interceptor accounting, native lifetime/deadline and fixture close/reopen failures described above. No suppressed assertions or hidden first failure. |
| Web stage 4 command/control/ownership/workspace/services/server/migration | passed | 135 across nine files. `continuation-web-stage4.log` |
| Worker stage 4 after observation correction | passed | 174 across two files, candidate 32 plus historical 142. `continuation-worker-stage4-observation-corrected.log` |
| Biome check | failed, then corrected | Two unsorted new imports fixed; final check passes with inherited warnings. `continuation-biome-check.log`, `continuation-biome-final.log` |
| Final aggregate 1, exact `pnpm contracts:verify` | passed | 49 tests, typecheck/build. `final-contracts.log` |
| Final aggregate 2, exact `pnpm brain:verify` | failed | Contracts 49; freshness 2 passed/1 failed/3 explicit script-filtered skips. Missing offline registry metadata. Remaining brain typecheck/tests/build did not run. `final-brain.log` |
| Final aggregate 3, exact `pnpm credentials:verify` | failed | Credential typecheck passed; historical Worker suites passed. Candidate ordered-alarm 5000ms timeout, storage isolation/unhandled error; summary 189 passed/1 failed out of 196 collected, remaining candidate outcomes not completed. Node crash gate did not run. `final-credentials.log` |
| Final aggregate 4, exact `pnpm runtime:verify` | passed | Both typechecks, six Node checks and 396 Worker tests across 13 files. `final-runtime.log` |
| Final aggregate 5, exact `pnpm verify` | failed | Biome and web typecheck passed; nested credential gate 195 passed/1 failed out of 196, delayed-delivery 5000ms timeout. Credential Node checks, full web tests/build and runner verification did not run. `final-verify.log` |
| Last small source simplification after aggregate failure | passed narrowly only | Removed redundant submission-count queries/loop from the joined one-turn invocation. No authority or deadline change. Final-byte runtime typecheck and nine command tests pass in `continuation-final-byte-typecheck.log` / `continuation-final-byte-commands.log`. Full aggregates were not rerun on these last bytes. |
| Dependency graph / staging / whitespace | passed | Ten graph hashes unchanged; root non-script metadata preserved; staging empty; `git diff --check` passes. `continuation-final-graph.log` |
| Live/hosted/cookie auth/Docker/retained workspaces/benchmarks | not run | Not authorized or assigned to later plans |

The first final sequence stopped on brain. After the bounded cache diagnosis, the remaining three aggregates ran in their prescribed order, one at a time, to record independent statuses. None was filtered or overlapped with another aggregate. `final-status.log` records exits `0/1/1/0/1`. The failed totals above are not successful full-suite totals. The final narrow correction does not supersede those aggregate failures.

### Remaining work and review boundary

008 cannot be accepted on this candidate. Immediate blockers are the unchanged brain test's isolated offline metadata prerequisite and unreliable completion of the new real-Worker tests within existing deadlines. The latter must be measured and corrected without extending deadlines, hiding suites, changing pinned providers or reducing final authority checks.

The full required crash matrix is not complete. Remaining coverage includes real-D1 decision acknowledgment crash orderings; before/after each new control intent/outcome; held configuration Stop; cancel/start too-late ordering through real transport; delayed old Stop against a newer run; reliable detached/native progress under aggregate load; full queue-start/expiry/final-permit mutable-authority races; queued prepared configuration retention; and candidate-specific three-denial exact host halt. Existing accepted predecessor tests are preservation evidence, not substitutes for these new integrations. The immediate-provider test uses a guarded cooperative provider as a host-boundary fault seam; the Worker product cases use the actual private model adapter and credential/D1 policy with admitted commands, not manual successful command/membership seeds.

No full PD01–PD11/PD16/PD32/PD33/PD42, L3, hosted service-binding authority, exactly-once provider billing or retained-data enablement claim is made. Default candidate composition remains unavailable. Full tools/projections and later capacity policy remain 009/010/015. Parent independent hunk review and acceptance gates are still required. Preserve all source, generated isolation directories and failure logs; no cleanup or integration is authorized by this report.

## Correction executor, 2026-10-11

Disposition: STOPPED at the unresolved trusted termination-witness boundary. READY FOR REVIEW of the four-file correction increment only. Not READY for plan 008 acceptance, and not DONE. The remaining plan matrix and five final aggregates have not been completed on these bytes.

### Scope and preserved evidence

All commands and source writes targeted detached `/home/ayan/ditto-execution/plan-008-4WXvNW`, still at `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`. The harness reports `openai-codex/gpt-6.1-sol`, reasoning `medium`. The complete plan, refresh, chronological evidence, initial advisor rejection, authoritative runtime specification, domain context and relevant diagnostic/Cloudflare/DO skills were read. No model override occurred.

The advisor archive, hash manifest, probe source/configuration and historical logs are unchanged. The correction changes only:

- `apps/runtime/src/pi-durable-host.ts`.
- `apps/runtime/src/pi-durable-commands.test.ts`.
- `apps/web/src/lib/workspace-runtime.ts`.
- `apps/web/src/server.test.ts`.

The three already archived files have exact correction diffs against the preserved source archive. The newly touched workspace maintenance file is compared against HEAD. These are recorded in `plans/evidence/artifacts/008/correction-executor/source-diff.patch`, with resulting intended-source hashes in the adjacent `source-hashes.json`. The other 33 archived implementation files match their original hashes. Intended source scope is now 37 files, excluding evidence and generated isolation material.

All eleven dependency graph checks still differ only at the already-authorized root script registration. Root package metadata excluding `scripts` matches HEAD; the other ten graph files match their initial baseline hashes. No dependency preparation, cache repair, installation, lifecycle hook, manifest/lockfile resolution change or main-checkout operation occurred. Tests used the unchanged confined `sh .execution-008/clean-run.sh`. No staging, commit, merge, push, deployment, live credential/provider request, retained/shared DB mutation, external cleanup or worktree removal occurred. Staging is empty and `git diff --check` passes.

### Corrections and permanent behavior tests

1. Candidate consumption now uses the cancellation context supplied by the existing owner lane. Bounded decision/configuration waits retain that signal. Candidate scheduling carries it through authority, configuration, supported Pi reads/submission and durability waits. Post-await checks deny released local continuations after yield, rather than merely abandoning the caller's wait. Priority Stop remains outside the lane; actual close still joins the owner queue and actual Harness close. Late product reconciliation itself may retain the original decision; it grants no effect admission.
2. Cancel rechecks its canonical retained control in the owner lane and at its local commit. Stop rechecks the exact retained identity synchronously at its priority fence commit after encryption. Identical duplicates retain the original acknowledgment without another epoch fence, cooperative Stop or safety block. Conflicts still deny. The ordinary command lane also checks canonical identity rather than silently accepting a conflicting delivery that raced its pre-read.
3. A start deadline crossed during preparation is now an ordinary expired outcome, not a transition exception. The original immutable decision identity/deadline is retained, and failed pending membership plus projection intent commit with expiry evidence before product acknowledgment. Reconciliation retries that same fate; no submission occurs. Stop/run revocation is checked separately before start commit. Fixed queue TTL and healthy run/effect deadlines are unchanged.
4. Capacity reclamation reads current workspace ownership before its first Sandbox state RPC. Only legacy-owned sessions reach the legacy namespace. A scheduled-entrypoint regression executes the real drain/reclamation code with lower execution/cleanup/delivery dependencies inert and observes zero legacy Sandbox calls for a ready candidate synthetic identity. This is not the previous all-drain mock.

Five new registered encrypted real-DO command cases exercise concurrent Stop/cancel acknowledgment and unchanged duplicate epochs, preparation-crossed expiry across reopen, held expiry reconciliation close, and held configuration close. Released held callbacks cannot submit or call a provider. Existing lost-expiry-ack coverage now also asserts failed local membership/projection before acknowledgment. These focused host cases are not replacements for the required product-admitted real-D1/private-adapter crash matrix.

### Verification and first failures

Logs below are preserved under `.execution-008/`. Actual test, invocation, effect, configuration and runtime deadlines were not increased.

| Check | Result |
| --- | --- |
| Unchanged four advisor probes after initial runtime corrections | passed, 4 tests; `correction-independent-probes-1.log` |
| First four-file runtime narrow gate | failed, 175 passed / 6 failed out of 181; `correction-runtime-narrow-1.log` |
| Cause and correction of that new regression | Applying owner abort to historical standalone scheduling changed passive duplicate-invocation inspection and its established denial behavior. Cancellation now bypasses passive duplicate inspection and attaches the owner signal only on the candidate scheduling path. No predecessor assertion changed. |
| Corrected runtime narrow gate | passed, 181 tests; `correction-runtime-narrow-2.log` |
| Final-byte command/effects/host/models gate | passed, 181 tests across 4 files, duration 28.50s; `correction-runtime-final.log` |
| Unchanged final-byte advisor probes | passed, 4 tests; `correction-independent-probes-final.log` |
| Final-byte server/workspace maintenance gate | passed, 28 tests across 2 files; `correction-web-final.log` |
| Final-byte runtime typecheck / web typecheck / scoped Biome check | passed; `correction-runtime-typecheck-final.log`, `correction-web-typecheck-final.log`, `correction-biome-final.log`; inherited lint warnings remain |
| Dependency graph, staging and whitespace | passed as described above |
| Exact five aggregate gates on corrected bytes | not run, termination authority boundary and remaining matrix unresolved |
| Brain offline cache preparation | not performed; the independent ENOTCACHED failure remains outstanding |
| Live, hosted, retained activation, UI, Docker and full tools/projections | not run or assigned to later plans |

The inherited executor aggregate failures, later independent credential/runtime passes, interrupted repository run and initial four red probes retain their original meanings. None has been erased or promoted into a final-byte aggregate pass.

### Abrupt restart investigation and exact stop

The existing accepted seams do not issue real candidate abrupt-host evidence. `PiDurableHostFixture.retire` calls graceful yield before writing authority. `CandidateFixtureSession.retireFixture` and `reopenFixture` join graceful close and never issue a generation or prior-invocation witness. Accepted takeover tests manually provide a synthetic `LocalAuthority.priorTerminated`; they test the guard and accounting, not the origin of a candidate termination witness. Candidate `runtimeAuthority` still returns generation 1 forever. The accepted takeover guard was not weakened.

Cloudflare documents `DurableObjectState.abort()` as an immediate per-object reset. A separate exploratory probe tested that supported primitive in the existing isolated Worker pool without changing the advisor probes. Its source/configuration are explicitly exploratory evidence under `plans/evidence/artifacts/008/correction-executor/termination-seam.*`.

The first probe failed when it reused the broken old stub after abort. That log remains `correction-termination-seam.log`. The corrected invocation acquires a fresh stub for the same DO and verifies both discarded instance state and preserved durable storage. It passes in `correction-termination-fresh-stub.log`. This proves a local fixture reset primitive, not candidate abrupt-host recovery, preserved effect occupancy or absence of duplicate dispatch. It allocated no candidate run or Pi host and is not a substitute for the mandatory admitted-command test.

The missing engineering contract is a deployment-owned trusted issuer that binds a reset operation to the exact workspace owner, invocation ID and prior generation, observes actual reset completion, and durably issues one newer authority generation with the exact prior invocation witness. There is no such supported accepted issuer in current candidate composition. An arbitrary private-RPC rejection or a caller-supplied marker is not sufficient termination evidence; constructing the replacement is not the authority source. Writing a witness before abort would also leave an unsafe crash ordering.

Adding that issuer and its authenticated completion/accounting protocol establishes a new trust boundary. This executor stops here under the user's explicit new-boundary stop condition rather than inventing a fixture witness, treating timeout as death, using the pool's internal unsafe abort-all API, or opening a second execution owner. The next authorized step needs review of that issuer's exact trust and crash-ordering contract. The supported per-object abort/fresh-stub result is available to that review; no platform impossibility is claimed.

After that boundary is resolved, implement and test actual product-admitted abrupt takeover, preserved unresolved occupancy and zero duplicate dispatch, then complete real-D1 decision/control crash orderings, held-configuration Stop, transport cancel/start too-late, delayed old Stop/new run, mutable-authority races, queued prepared configuration and candidate exact-host halt. Prepare only the already-authorized isolated locked-package metadata needed by the unchanged brain fixture, then run all five aggregates sequentially with sufficient outer budgets. Parent independent hunk review and unchanged probes/gates remain required before any acceptance.
