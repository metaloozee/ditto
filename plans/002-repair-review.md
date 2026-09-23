# 002 repair execution review

**SUPERSEDED historical first-repair review.** Final acceptance is recorded in [002-expanded-repair-review.md](002-expanded-repair-review.md): 002 landed at `693a334` and 003 is ready, not started. The failures, counts, source anchors and repair instructions below describe the earlier candidate only.

Historical verdict: **CHANGES REQUIRED**. This review followed [the first execution review](002-execution-review.md) and kept 003 blocked at that time. Both documents preserve the original R1-R8 requirements and repair history; neither is a current request to repeat those repairs.

## Target and preservation

- Advisor checkout: `/home/ayan/ditto`, HEAD `d4e447e`, branch `brain`.
- Executor checkout: `/home/ayan/ditto-worktrees/plan-001-reexecute`, HEAD `6eefdd1`, branch `codex/plan-001-reexecute`.
- Executor: `xai/grok-4.6`, agent `916a38f5-2fbb-4d6`.
- Baseline: executor checkout `plans/002-repair-evidence/`, including the initial binary diff, a 683-file SHA256 manifest and before-edit source copies. The advisor verified every saved before-edit copy against that manifest.
- Repair delta: 17 baseline files changed and four new source/test files. The other 666 manifest entries are unchanged. All 40 checked protected files, including Alchemy, sandbox-runner, historical migration 0019, runtime feasibility and Pi recovery/restoration, are byte-identical to the repair baseline.

Source remains uncommitted in the executor checkout. Nothing was staged, committed, merged, pushed, deployed or migrated to a shared database. The advisor changed only files under the main checkout's `plans/`. The missing improve `references/closing-the-loop.md` was reported before dispatch; this review follows the available execution rules.

## Independent verification

Environment: Node `v24.21.0`, npm `12.0.2`. Commands ran in the executor checkout unless stated otherwise.

| Command | Advisor result |
|---|---|
| `pnpm brain:verify` | PASS. Contracts: 13 tests. Freshness selection: 2 tests. Full brain suite: 42 tests. Typechecks/builds passed. |
| `pnpm typecheck` | PASS |
| `pnpm --filter @ditto/runtime typecheck` | PASS |
| `pnpm --filter @ditto/runtime test` | PASS, 19 tests |
| `pnpm check` | PASS, 11 warnings |
| `pnpm --filter @ditto/web exec vitest run` | PASS, 67 files / 710 tests |
| `pnpm verify` | PASS, including a second full web run, web build and runner verification with 79 runner tests |
| `git diff --check` | PASS in both checkouts |
| Repair adversarial probes below, including `--npm` | FAIL, six residual failures |

The freshness-only selection skips three unrelated characterization tests; the subsequent full brain run includes all 42 cases without skips. Root `pnpm verify` does not include the new brain/runtime gates, so the advisor ran them separately. Passing these commands does not prove the contract enforced by a weak test.

Docker boot, paid Cloudflare topology, deployment, live D1 migration and real-user trusted routing were not run. Earlier 001 local evidence is preserved, not newly certified by this review.

## R1-R8 disposition

| ID | Disposition |
|---|---|
| R1, prompt batches | Original raw-SQL D1 batch and illegal SQLite `RAISE` defects removed. The reviewed statements use typed conditional inserts and owner/version-conditioned recency updates. Six real-D1-adapter tests cover existing-session admission, stale ownership, current round-trip version, a later-statement rollback and follow-up behavior. New-session rollback and a stale version after a complete owner round trip are not separately covered by those new tests. |
| R2, privileged authority | PARTIAL. Already-migrating callbacks are denied, builders work and missing stored incarnation correlation is rejected. Remaining request/insertion races and an ignored caller version are detailed below. |
| R3, accounting | Original mode-switch race and missing-policy admission are addressed with write-time mode/version predicates. Release/purge now exclude unified accounting. Tests pass. This is not acceptance of the future unified allocator or all rollback/version-only interleavings. |
| R4, legacy queue | PARTIAL. The shared predicate excludes trusted delivery rows, including project-target rows, from most legacy mutations. Admission and one drainer requeue still write after ownership changes. |
| R5, dependency boundary | INCOMPLETE. An internal helper and generic defaults were narrowed, but the actual runtime policy entrypoints still require product `Env`; the runtime type test still checks a stand-in environment. |
| R6, npm refresh | NOT FIXED. The new test invokes npm, but tests a tarball reinstall rather than the application's directory `file:` dependency and refresh script. The advisor reproduced stale imported JS and declarations after the real refresh command. |
| R7, raw JSON | The reported prototype-key loss and recursive decode overflow are fixed in the reviewed paths. Literal/escaped key tests and independent deep-array/deep-object probes pass with contract errors. |
| R8, deletion fixtures | Fixed without changing deletion assertions. All five previously failing cases and the full web suite pass. |

## Remaining corrections

All source paths below are relative to the executor checkout.

### R2. Make authorization use one current durable fence

Evidence: `apps/web/src/lib/sandbox-authority.ts:198-243,473-608,833-922`; real model/action callers use unlimited windows at `apps/web/src/lib/agent-run-service.ts:946,957`.

The resolver reads workspace ownership, then reads the operation separately. Only the finite-request consumption branch adds a write-time owner predicate. For ordinary `maxRequests: null` model windows, an owner transition between those reads still returns authorization. The advisor changed the owner to `migrating` immediately after the owner read and observed an allowed callback. This is not merely a change after a valid authorization decision: the final operation lookup does not validate its owner at all.

The repair also removed the comparison against a supplied `ctx.runtimeOwnerVersion`. Passing version 99 for a version-1 operation is now accepted. Preserve legacy omission semantics where required, but never ignore an explicitly mismatched expected version.

Operation insertion checks current retirement/state and workspace ownership, but not the loaded lifecycle generation/incarnation. A probe invokes the actual `rotateGeneration()` after admission's session read. `openOperation()` then inserts a generation-1 window against the now-generation-2 identity. This obsolete open slot can block a valid replacement window.

Required correction:

- Authorize unlimited and non-consuming requests through a current relational query that joins the applicable operation, identity and workspace predicates. Finite consumption must atomically apply the same predicates with the allowance update.
- Include expected lifecycle generation, incarnation and owner/version in conditional insertion, not just the earlier JavaScript checks. Preserve valid project-seed builders without fabricated workspace membership. Keep trusted windows closed.
- Restore validation of supplied caller owner versions. Do not let missing correlation fields bypass stored required incarnation/epoch fields.
- Remove the production fallback branches at `sandbox-authority.ts:512-534,598-601` that use unconditional `.values()` when test doubles lack `.select()` or `_prepare`. Update the tests to exercise the real supported Drizzle path. Production security behavior must not branch on a mock's private-method shape.
- Add read/write interleaving regressions for unlimited callbacks, bounded consumption, explicit version mismatch and actual lifecycle rotation. The new SQL authority tests only cover the owner-change insertion race, not these cases.

### R4. Fence queue insertion and the drainer's capacity-failure write

Evidence: `apps/web/src/lib/workspace-runtime-capacity.ts:192-247,1132-1148`; public admission calls this policy at `apps/web/src/lib/workspace-runtime.ts:1043-1068`.

`insertWorkRow()` checks the session owner, then performs an unconditional `.values()` insert. A migration after the read still creates a legacy preview-start row and reports successful persistence. The later lease predicate stops it from executing, but does not make admission valid or remove the stale row.

Separately, `drainOnce()` does not use `legacyWorkOwner` when returning leased work to the queue after capacity is unavailable. With the user already at capacity, the advisor changed the owner after the work lease and before allocation. The drainer changed `leased` to `queued` and cleared lease fields despite the new owner being `migrating`.

Required correction: condition session-target work insertion on the loaded owner/version, fail without a row on mismatch, and apply the complete legacy-work predicate to that requeue update. Check duplicate-return paths without turning this into phase 003 command admission. Add regressions for both races and verify trusted delivery/lease fields remain unchanged. Keep legitimate null-session legacy work supported.

### R5. Complete a real capability boundary, with an approved scope

Evidence: `apps/web/src/lib/workspace-runtime.ts:127,159-164,1288-1325`; `workspace-runtime-capacity.ts:87-101,1197-1203`; `runtime-policy-bindings.type-test.ts:6-36`; `apps/runtime/src/forbidden-bindings.type-test.ts:1-13`; `apps/runtime/tsconfig.forbidden-bindings.json`.

Only `containerIdForSandbox()` was narrowed in `workspace-runtime.ts`. Public orchestration still accepts product `Env` and passes it to the drainer. The new unconstrained `TEnv` parameter lets callers infer that same product `Env`; testing its empty default type does not prove the selected runtime dependencies exclude product secrets. The runtime-specific test still checks the feasibility Worker's hand-written `Env` and does not import the shared policy implementation.

No runtime credential exposure was demonstrated. The failure is the required dependency boundary and its claimed verification.

The executor reports that the remaining dependencies reach `github-app.ts`, `sandbox-bootstrap.ts`, `sandbox-archive.ts`, `workspace-recovery.ts` and `agent-run-service.ts`. The current plan says to stop rather than enlarge that change silently. Before another executor, approve a bounded capability-adapter change and name the permitted files. Recommended approach: preserve product-side operations behind explicit capabilities while making the shared policy signatures and the runtime's actual import/type graph independent of global product `Env`. Do not move keys, classes or deployment bindings before 011. A generic parameter that accepts any environment is not the missing boundary.

### R6. Test and fix the script users actually run

Evidence: `packages/session-brain/package.json:10,14,17`; `packages/session-brain/src/pi-feasibility.test.ts:145-150,195-216,263-281`.

The application depends on `file:../runtime-contracts` and documents:

```sh
npm run build --prefix ../runtime-contracts && npm install --prefix .
```

The test instead installs a packed tarball, later packs it again, uninstalls the package and installs the tarball. It invokes neither the application's refresh script nor even the different refresh script declared inside its fixture. `engines.npm: ">=10"` is a range, not the plan's pinned npm policy.

The advisor installed a directory `file:` dependency as a copy with npm `12.0.2` and `install-links=true`, changed source and rebuilt, then ran the exact application refresh script in the disposable consumer. It exited successfully but the actual imported JS stayed `before` and declarations stayed stale.

Required correction: choose and document the supported npm version/resolution policy, retain the planned directory dependency, and define a refresh command that works for its supported copied installation. The isolated test must load that exact command from the real manifest, install the same dependency shape, mutate fixture source, prove actual imports are stale, invoke the command, and verify fresh imported behavior plus emitted declaration digests. Do not replace this with a tarball-only test or mutate the working installation as a fixture. The real installed symlink freshness check currently passes and should remain.

## Reproduction

The advisor's new script reads candidate modules and the reviewed migration fixture. SQL databases are in memory. The optional npm case creates and removes only its own temporary local package fixture; it runs offline, without registry or Cloudflare access. It exits 1 when a residual failure reproduces, unlike the older observational script.

```sh
cd /home/ayan/ditto-worktrees/plan-001-reexecute
node /home/ayan/ditto/plans/002-repair-probes.cjs "$PWD" --npm
```

Requires installed dependencies and fresh contracts output. `pnpm brain:verify` supplied that build in this historical review. Observed output from the rejected first-repair candidate included:

```text
PASS already-migrating callback: denied runtime_owner_mismatch
FAIL unlimited callback owner changes after owner read: ALLOWED
FAIL explicit caller owner-version mismatch: ALLOWED
FAIL operation insertion after actual lifecycle rotation: ALLOWED
identityGeneration: 2, operationGeneration: 1
FAIL legacy drainer mutation after ownership fence: leased -> queued
FAIL legacy queue admission after owner read: denied=false, insertedRows=1
PASS prototype unknown field: ContractParseError unknown_field
PASS deep array: ContractParseError invalid_json
PASS deep object: ContractParseError invalid_json
FAIL actual copied-consumer refresh: imported=before, declarations=stale
Residual failures: 6
```

The probe fixture and loaded APIs are intentionally version-specific. Review drift instead of interpreting a missing export or fixture failure as a security rejection. The original `002-review-probes.cjs` references the now-removed `abortUnlessLegacyOwnerSql`; its TypeErrors are no longer a valid R1 regression signal.

## Scope of review and next handoff

The advisor reviewed the complete repair delta, all four new source/test files, the full authority and capacity modules, the changed contract decoder and npm test, and the relevant runtime callers/type configuration. Independent gates include all web, brain, runtime and runner tests. This is not a fresh audit of every unchanged contract/schema rule, all legacy services or the eventual trusted runtime.

Next work remains on the same isolated candidate. Preserve the passing fixes and all 001 source. Address R2 and R4 with real interleaving tests, fix R6 against the actual command, and obtain the R5 scope decision before claiming plan completion. Do not unblock 003, mark 002 accepted, or apply source to `brain` on the strength of the green suite. No second repair executor was dispatched during this review.
