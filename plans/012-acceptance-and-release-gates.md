# 012: Prove the matrix, measure the platform and authorize release separately

Status: BLOCKED on 011 code/rehearsal completion and paid authorization. Base HEAD: `c963890`, branch `brain`. Effort: L, 5-10 days plus platform/reviewer time. Risk: high. This phase verifies; it is not a place to implement deferred core behavior.

## Goal and prerequisites

Collect auditable local and real-platform evidence for the complete trusted runtime. Keep missing budget, archive, migration and historical Git gates as release blockers. Release approval is separate from code completion and separate from permission to touch a specific production target.

001-011 provide: pinned Pi barrier/restore recipe; additive contracts/ownership schema; durable authenticated admission/delivery; encrypted coordinator/effects/projections; closed two-container transport; real Pi continuation; matched checkpoint pairs; both capacity pools/preview policy; reference-safe retention/deletion; durable browser observation; nondestructive import/fenced rollout tooling. Each prerequisite plan has its own API summary and tests. `@ditto/runtime-contracts`, `@ditto/runtime`, independent npm `packages/session-brain` and existing independent runner have verification scripts defined in 001/002.

Dependency distinction: 011's implementation and disposable migration rehearsal precede this phase. Its production deployment/import steps remain blocked until this phase passes and a maintainer names/authorizes the target. There is no requirement to perform live migration to unlock the tests intended to authorize it. A final post-cutover smoke is evidence after that separate approval, not permission to cut over.

No source refactor, new architecture, dependency bump, shared DB migration, Git push to a user repository, paid resource start or data deletion is implicitly authorized. If a test requires one, name the exact disposable environment/repository and wait.

## Rechecked baseline and conventions

`package.json:9-17` currently defines these scripts. This is a fragment of the scripts object:

```json
"test": "pnpm --filter @ditto/web test",
"typecheck": "pnpm --filter @ditto/web typecheck",
"format": "biome format --write",
"lint": "biome lint",
"check": "biome check",
"fix": "biome check --write",
"runner:install": "npm ci --prefix packages/sandbox-runner",
"runner:verify": "npm run typecheck --prefix packages/sandbox-runner && npm test --prefix packages/sandbox-runner && npm run build --prefix packages/sandbox-runner",
"verify": "pnpm check && pnpm typecheck && pnpm test && pnpm build && pnpm runner:verify",
```

Read `.github/workflows/ci.yml` before editing: current CI installs root with pnpm and the runner independently with npm, then runs `pnpm verify`. Extend this ownership rather than pretending the runner/brain are workspace packages.

`apps/web/src/lib/git-push-contract.ts:24-27`:

```ts
export const GIT_PUSH_ENABLED = false;

export const GIT_PUSH_UNAVAILABLE_MESSAGE =
  "Pushing to GitHub is currently unavailable.";
```

The reason is documented in the source comment at lines 18-23: receive-pack commands have no trustworthy force flag, and push stays closed until a crafted non-fast-forward update is rejected before its branch SHA moves. There is no `GIT_PUSH_UNAVAILABLE_REASON` export.

The accepted platform-credential broker spec's historical integration matrix remains independent evidence debt. Local parser tests and the parent's 679-test result do not prove non-fast-forward rejection on real smart HTTP.

Test titles prefix T01-T36. Primary fault fixtures invoke production command handlers with explicitly labeled injected-auth ownership/admission fixtures and observe receipts/snapshots/events/files. These are not full cookie-authentication proof. Keep the approved DI service/runtime seams; add the bounded real-auth adapter smoke below instead of requiring Better Auth cookies for every crash scenario. Fault injection lives in deterministic provider, storage, transport, process and clock adapters, not exported coordinator testing APIs. Narrow web command is `exec vitest run`; the parent's documented wrapper ran every suite. No tests/typechecks/builds were run by this drafter.

## Files and package gate work

Modify root `package.json`, `.github/workflows/ci.yml`, `pnpm-workspace.yaml` only if not already completed; root/independent lockfiles through their owning package managers. New `apps/runtime/src/acceptance.test.ts`, `platform-acceptance.test.ts`, `platform-benchmark.test.ts` and `apps/web/src/lib/session-runtime-acceptance.test.ts`. Reuse all numbered primary test files rather than replacing them with one opaque integration test. Existing historical `docs/specs/platform-credential-broker.md`, target spec and architecture docs receive accurate completion/evidence references only after results exist.

Before invoking new gates, define runtime scripts:

- `test:platform`: `vitest run src/platform-acceptance.test.ts`, requiring an explicit disposable environment config and failing fast when absent, not passing skipped tests.
- `test:benchmark`: `vitest run src/platform-benchmark.test.ts`, requiring explicit environment and approved thresholds; missing values are BLOCKED.

Keep these paid scripts outside default `test` discovery/`pnpm verify` with explicit Vitest include/exclude configuration. Local acceptance remains in default tests. Do not make local verification start paid containers by accident. Brain similarly keeps feasibility/local fake-provider tests offline.

Extend root `verify` to include `contracts:verify`, `runtime:verify`, `brain:verify` plus all old gates. CI sequence: frozen root install; contracts build; independent npm `ci` for runner and brain; full verify. Contracts build must precede `file:../runtime-contracts` consumer installation. From 002, `brain:verify` runs `contracts:verify`, then brain `contracts:check`, then npm brain gates. Standalone brain commands follow the same order. CI and local checks verify the resolved imported JS/declarations, not just package version; copied file dependencies use 002's proved npm refresh recipe before verification. Never count a stale dist test as PASS. Runtime static `build=tsc --noEmit` from 001 is not actual workerd bundling evidence: use the exact local Alchemy bundle/rehearsal command proved in 001 and record it below before claiming R-Local complete. No independent Wrangler deploy path.

## Bounded real-auth adapter smoke

Add `A-Auth` cases in the planned `apps/web/src/lib/session-runtime-acceptance.test.ts` and repeat via the platform acceptance client. Exercise actual disposable auth sessions/cookies against the existing production public HTTP auth adapter and command/control handlers; no live OAuth flow or production accounts are needed. Missing and expired cookies reject before command/control effects. A valid foreign-owner cookie rejects access to the target; a valid owning cookie admits an idempotent prompt and exact-run control. Assert durable rows/receipts and no unauthorized delivery, not merely HTTP status. Session fixture setup must use the actual auth implementation, not inject a user or mock its session validator for these cases. Read the applicable Better Auth guidance when implementing this seam; no new auth dependency/redesign is authorized. Record local and paid adapter evidence separately from mocked-auth fault coverage. If unavailable, mark this smoke NOT RUN and block acceptance rather than relabel DI tests.

## Conditional policy versus evidence

| Feature/gate | Proposed policy | Required evidence | Initial evidence |
|---|---|---|---|
| Dependency inclusion / P-Dependencies | `disabled-source-only`; may become `enabled` only after benchmark requirements | Source-only recovery safety tests under either selection; inclusion additionally needs all measured benchmark thresholds | Source-only tests NOT RUN; inclusion benchmark NOT RUN |
| Git push feature / P-Git | Push disabled pending separate enablement approval | P-Git is mandatory trusted-runtime production-readiness evidence even while push is disabled | Real crafted rejection NOT RUN |

Record policy selection independently from PASS/FAIL/NOT RUN evidence. Tested source-only can satisfy the permitted dependency-policy outcome without claiming an unrun/failed inclusion benchmark passed. It cannot waive P-Archive or any other mandatory platform gate. The proposed waiver of P-Git is rejected: the canonical spec lists crafted Git rejection among platform/release gates and retains historical incomplete gates. Passing P-Git does not itself authorize push enablement. Failed topology still stops cutover and reopens the architecture decision.

## Ordered acceptance work

1. Recheck HEAD, worktree and all source excerpts. Preserve preexisting `sandbox-egress-broker.test.ts` changes. Read completed phase diffs and evidence; every unavailable prerequisite is BLOCKED, not assumed. Run all local phase gates and complete T01-T36 trace table below, with exact test title/path and latest commit.
2. Add deterministic end-to-end sequences through authenticated handlers: create/retry, queue under both pools, follow-up, disconnect, model response/tool-result interruption, coordinator restart with surviving brain, executor loss and paired fallback, Stop unknown shell, archive/continue, GC/deletion races and nondestructive import. Include the A-Auth smoke separately from DI fault sequences, mixed legacy/trusted/builder/preview single-ledger contention, exact recovery-union negative cases, cross-owner/older-run projection ordering, and termination-versus-isolation capacity races. Ensure no target command can fall back to legacy runner. Use real Pi 0.80.10 and local persistent store, not only mocked SessionRuntime.
3. Run local final gates, including real runtime bundling under the 001 recipe. Required commands:

```sh
pnpm check
pnpm typecheck
pnpm --filter @ditto/web exec vitest run src/lib/session-runtime-acceptance.test.ts
npm test --prefix packages/sandbox-runner -- src/remote-tool.test.ts src/archive.test.ts
npm run typecheck --prefix packages/sandbox-runner
pnpm contracts:verify
pnpm runtime:verify
pnpm brain:verify
pnpm runner:verify
pnpm verify
```

All must exit 0 with no required skips. Root check may still report explicitly baseline-matched preexisting warnings; report count/category and any increase. The required documented `pnpm --filter @ditto/web test -- <test-file>` wrapper can run all web tests and is covered by full verify, but use `exec` for narrow evidence. Do not label a no-op runtime build as a bundle pass.
4. Request authorization for a named disposable paid environment, named synthetic GitHub repository/installation, stage-specific D1/R2/DO namespaces and cleanup scope. Verify bindings contain no production resources before applying Alchemy. Record exact approved command, pinned versions/image digests/compatibility date and costs. No production secret/container inspection. Use trusted test-only sentinels and Boolean assertions, never dump env or bodies.
5. Exercise actual two-class runtime deployment: empty first creation and update, private cyclic named-entrypoint bindings, unbound Worker denial and no default-fetch arbitrary internal proxy, fresh D1 startup/operation authorization, platform identity bridge, executor/builder brain-call denial, Node HTTPS CA/intercept streaming/cancellation, external egress denials, scheduler recovery, independent sleep and DO restart with Node alive. Run `pnpm --filter @ditto/runtime test:platform` only after the target/config/authorization is explicit. Local Cloudflare emulation is not this row.
6. Run all T01-T36 applicable scenarios on the paid target through product commands. Infrastructure faults may recycle/restart only the approved test identities. Enforce platform auth and observe actual files/remote SHAs where relevant. Record any untestable scenario as NOT RUN and keep release blocked, not as a mock-backed pass.
7. Measure P-Budget, P-Archive, P-Dependencies and lifecycle behavior with `pnpm --filter @ditto/runtime test:benchmark`. Budget thresholds require prior maintainer approval for each image's cold-start p95, remote tool round-trip p95, peak memory/disk, idle cost and representative concurrent cost. Twenty slots per pool is policy, not evidence of an affordable/supported plan. P-Archive includes near-limit 1 GiB compressed/3 GiB extracted, measured <=70% peak disk, no full Worker buffering, corruption/fallback and every publication interruption stage. If dependency inclusion is proposed for enablement, P-Dependencies requires at least ten cold restores per strategy for each small/medium/large representative case, >=30% p95 improvement and zero safety failures; otherwise source-only remains selected and its safety tests must pass. Keep benchmark evidence NOT RUN or FAIL as applicable, separate from `disabled-source-only` policy. Do not enable dependency inclusion from a synthetic speedup alone.
8. Run the historical Git rejection gate against the explicitly approved disposable remote: valid narrow intended push only where gate procedure allows; crafted non-fast-forward, alternate refs/capabilities, delete refs and extra refs rejected before remote SHA changes. Record before/after SHAs, trusted operation IDs and rejection categories, no token/body. Keep branch push and PR creation disabled unless all relevant historical gates and maintainer enablement approval pass. A parser-only rejection is not proof of remote behavior.
9. Rerun the historical platform matrix: public/private import; two session filesystem/Git isolation; stop/follow-up; supported dependency classes; seed compatibility; binary/large diffs; preview/cold restore/stop; archive/continue; deletion; project-value isolation and redaction; broker role separation; existing disabled terminal/code/export behavior. Read the broker spec/release checklist in full before enumerating the exact cases. Add any historical missing case explicitly rather than declare supersession by T01-T36.
10. Rehearse DR using only disposable backed-up data: restore D1 product/identity fences, coordinator encrypted canonical history, R2 pairs and retained key versions. Verify wrong/missing key blocks safely, current/previous restores match, identities are not reused, dedupe/tombstones prevent old delivery replay and source backups remain retained. Production backup creation/restore requires separate authorization. If no supported recoverable coordinator backup procedure exists, R-DR remains BLOCKED; R2 workspace archives alone do not restore the trusted conversation.
11. Grok technical review remains blocked by provider rejection before execution; obtain that requested review when available. Luna completed initial cold review and fresh rereview, confirmed CR01-CR09 resolved in plan text, and found phase 001 executable as feasibility. It retained overall NOT READY because implementation/platform evidence is absent; no runtime or release approval follows. README records dispositions. Review the eventual implementation and evidence separately before release. Record further findings/dispositions in these plan files, not a separate report. Resolve feasibility/security/data-loss findings before release. User-visible unresolved layout/copy decisions remain approval gates even when backend tests pass.
12. Only with all gates PASS or an explicitly permitted source-only policy result, named target and separate maintainer approval, execute 011's bounded rollout. Perform post-cutover new/retained session, preview, Stop, archive and history smoke. If rollout fails, stop new admission and preserve owner fence; never reactivate stale legacy execution after trusted effects. Record final bindings/legacy executable count. Do not remove old archives or identity tombstones merely to make counts look clean.

## T01-T36 result ledger

All target results initially NOT RUN. Populate exact titles, commit and result after execution; grouping does not excuse an omitted ID.

| IDs | Primary file and phase | Local | Paid |
|---|---|---|---|
| T01,T02,T03,T04 | `apps/web/src/lib/session-command.test.ts` / 003 | NOT RUN | NOT RUN |
| T05,T06 | `apps/web/src/lib/session-command-delivery.test.ts` / 003; T06 execution-decision dedupe in `session-runtime-control.test.ts` / 004 | NOT RUN | NOT RUN |
| T07 | `apps/web/src/lib/session-runtime-control.test.ts` / 004; delivery-only prerequisite in `session-command-delivery.test.ts` / 003 | NOT RUN | NOT RUN |
| T08 | `apps/web/src/lib/session-runtime-control.test.ts` / 004,008 | NOT RUN | NOT RUN |
| T09,T10,T11,T12,T13,T14,T15,T16 | `apps/web/src/lib/session-runtime-continuation.test.ts` / 006 | NOT RUN | NOT RUN |
| T17,T18,T19,T20 | `apps/web/src/lib/session-runtime-recovery.test.ts` / 007 | NOT RUN | NOT RUN |
| T21 | `apps/web/src/lib/session-runtime-preview.test.ts` / 008 | NOT RUN | NOT RUN |
| T22,T23 | `apps/web/src/lib/session-runtime-capacity.test.ts` / 008 | NOT RUN | NOT RUN |
| T24,T26 | `apps/web/src/lib/session-runtime-events.test.ts` / 010 | NOT RUN | NOT RUN |
| T25 | `apps/web/src/lib/session-runtime-journal.test.ts` / 004 | NOT RUN | NOT RUN |
| T27,T28,T29,T30 | `apps/web/src/lib/session-runtime-security.test.ts` / 005,006 | NOT RUN | NOT RUN |
| T31 | `apps/runtime/src/runtime-crypto.test.ts` + journal boundary / 004 | NOT RUN | NOT RUN |
| T32,T33 | `apps/web/src/lib/session-runtime-retention.test.ts` / 009 | NOT RUN | NOT RUN |
| T34 | `apps/web/src/lib/runtime-migration.test.ts` / 011 | NOT RUN | NOT RUN |
| T35,T36 | `apps/web/src/lib/session-runtime-continuation.test.ts` / 006,008 | NOT RUN | NOT RUN |

## Platform/release ledger

For each row append actual command, environment/stage, timestamp, commit, dependency versions, image digests, compatibility date, configured limits, relevant metrics and sanitized evidence location within these plans. No external report is required by this drafting task.

| Gate | Owner | Initial result / release rule |
|---|---|---|
| F-Pi | 001,006 | NOT RUN; all exact continuation/barrier positions required |
| F-Topology | 001 | NOT RUN; first-deploy/update/private identity/scheduler required |
| P-Bridge | 005,012 | NOT RUN; actual trusted platform source and role denial |
| P-Model | 005,006,012 | NOT RUN; real HTTPS stream/abort/no container key |
| P-Restart | 001,006,008,012 | NOT RUN; surviving brain, epoch fencing and independent sleep |
| P-Archive | 007,012 | NOT RUN; bounded stream, safe extraction, paired faults and disk |
| P-Lifecycle | 008,009,012 | NOT RUN; pools, preview, archive and revoke-first deletion |
| P-Git | 005,012 | NOT RUN; historical non-fast-forward gate; export stays disabled |
| P-Budget | 001,008,012 | NOT RUN; approved per-image/concurrency budgets required |
| P-Dependencies | 007,012 | Benchmark NOT RUN; policy disabled-source-only; source-only safety evidence also NOT RUN. See separate policy/evidence table. |
| R-Migration | 011 | NOT RUN; retained source preserved and exactly one owner |
| R-DR | 012 | NOT RUN; encrypted canonical + filesystem + identity restore |
| R-Local | 012 | NOT RUN; extended verify and actual runtime bundle |
| R-Matrix | 012 | NOT RUN; T01-T36 plus historical integration matrix |
| A-Auth | 012 | Local NOT RUN / paid NOT RUN; real disposable-cookie admission/control HTTP adapter smoke |
| Technical review | dispatcher/grok-4.6 | BLOCKED; two provider request rejections before reviewer execution, no review produced |
| Fresh cold review | dispatcher/gpt-5.6-luna | COMPLETED initial review and fresh rereview. CR01-CR09 resolved in plan text; 001 executable as feasibility. Overall NOT READY pending implementation/platform evidence, not runtime/release approval. |
| Production rollout authorization | maintainer | NOT GRANTED |

## Completion, maintenance and STOP

Machine-checkable completion requires one passing named test for each T01-T36 plus crash/negative variants, all local commands exit 0, real bundle evidence, every required platform row with an actual target/result, no required skips, and no unresolved security/data-loss review finding. Source-only is an explicit allowed outcome for dependency policy, not a waiver for archive safety. No unrelated worktree diff may be lost. Paid/production approval cannot be manufactured by a test.

Release remains BLOCKED for unproved Pi barriers, cyclic deployment/identity/scheduler failure, missing budget/archive/DR evidence, historical Git blocker, unsupported retained-state loss, dual execution owner, plaintext state, or missing authorization. Reopen the owning phase rather than weakening its invariant here. Maintain gate evidence by image/Pi/protocol/compatibility version; rerun affected platform gates when any changes. Document key retention/rotation and recovery compatibility before the first real retained trusted session.
