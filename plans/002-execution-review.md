# 002 execution review

Historical first-candidate review. The current [repair review](002-repair-review.md) supersedes its current-state findings and verification results; retain this document as the original R1-R8 handoff.

Verdict: **CHANGES REQUIRED**. The xAI Grok 4.6 executor finished and its listed local gates pass independently, but the candidate breaks real prompt admission and does not implement the required ownership and dependency boundaries. Do not mark 002 complete or unblock 003.

## Execution target and preservation

- Advisor checkout: `/home/ayan/ditto`, HEAD `d4e447e`.
- Executor worktree: `/home/ayan/ditto-worktrees/plan-001-reexecute`, HEAD `6eefdd1`, with retained uncommitted 001 and partial 002 work.
- The original `/tmp/ditto-feasibility-execute.bw57gx/worktree` disappeared. The user explicitly selected the replacement and authorized repairing or discarding its incomplete changes. No wholesale reset was needed.
- Executor model: `xai/grok-4.6`.
- Requirements: `plans/002-contracts-and-identity.md` and `plans/README.md` in the advisor checkout. The worktree's copies predate the handoff approval.
- Migration `0020` belongs to this candidate. Historical `0019` remains unchanged.

The advisor changed only files under `plans/`. Source remains uncommitted in the executor worktree. Nothing was staged, committed, merged, pushed, deployed or migrated to a shared database. No live target was inspected.

The executor saved its starting diff and untracked source under `plans/002-execution-evidence/` in its worktree. Comparison against that baseline confirms the existing Alchemy and sandbox-runner diffs are unchanged. The 001 brain recovery/restoration implementations and runtime feasibility source are also byte-identical. `pi-feasibility.test.ts` changed to add the contracts checks, as planned.

The installed improve skill's `references/closing-the-loop.md` is missing. This execution follows the skill's explicit executor isolation, diff review and verification requirements, not an unread reference.

## Independently run verification

All commands ran in the executor worktree. Environment: Node `v24.21.0`, npm `12.0.2`.

| Command | Advisor result |
|---|---|
| `pnpm --filter @ditto/web exec vitest run src/db/trusted-runtime-migration.test.ts src/lib/session-runtime-ownership.test.ts src/lib/sandbox-authority.test.ts src/lib/agent-run-service.test.ts src/lib/workspace-runtime.test.ts src/lib/workspace-runtime-capacity.test.ts` | PASS, 6 files / 79 tests |
| `pnpm brain:verify` | PASS, contracts 10 tests; freshness selection 2 tests; full brain 42 tests; typechecks/builds passed |
| `pnpm typecheck` | PASS |
| `pnpm --filter @ditto/runtime typecheck` | PASS, including the current forbidden-binding test |
| `pnpm check` | PASS, 11 existing non-null assertion warnings |
| `pnpm --filter @ditto/web exec vitest run` | FAIL, 64 files passed / 1 failed; 688 tests passed / 5 failed |
| `git diff --check` | PASS in both checkouts |

`brain:verify` ran contracts verification and build before consumer checks. The freshness-only selection skipped three unrelated characterization cases; the subsequent full brain suite ran all 42 cases without skips.

The listed narrow tests miss production adapter failures and several ownership cases. Their PASS is not an acceptance verdict. Full `pnpm verify`, Docker boot, paid topology, deployment, shared-database migration and real two-container acceptance were not run by the advisor. Paid evidence remains NOT RUN and trusted real-user enablement remains blocked.

## Required corrections

Paths below are relative to the executor worktree. All findings are confirmed from advisor source reads; executable probes are noted separately.

### R1. Prompt and follow-up batches cannot execute

Evidence: `apps/web/src/lib/session-runtime-ownership.ts:98-109`, `apps/web/src/lib/agent-run-service.ts:374,407,895-929`.

`abortUnlessLegacyOwnerSql()` returns a raw Drizzle `SQL` object. Both call sites put it into Drizzle D1 `db.batch()` and suppress the incompatible type with `as never`. The real adapter calls `query._prepare()` and throws before reaching D1. Independently, the SQL uses `RAISE(ABORT, ...)` outside a SQLite trigger; SQLite rejects the statement even for a matching legacy owner. Ordinary prompt admission is broken, not merely the stale-owner path.

Advisor probes produced:

```text
batch adapter: query._prepare is not a function
SQLite ownership guard: RAISE() may only be used within a trigger-program
```

Required fix: use supported typed Drizzle batch queries and valid SQLite. One approach is to condition every message/work/recency write in the batch on the same expected owner/version and classify an empty batch result as an ownership conflict. Do not guard only the first statement with a zero-row select while allowing subsequent writes. Preserve all-or-nothing behavior on a later constraint failure. Remove the casts that hide this adapter mismatch.

Add a regression through the real `drizzle-orm/d1` adapter backed by disposable SQLite, exercising initial prompts and follow-up batches. Cover a matching owner, ownership changing after the initial load, a legacy-owner round trip, and later-statement failure. Assert that rejected acceptance leaves no session/message/work residue. The current mocked `batch()` only returns canned success arrays.

### R2. Privileged operations ignore the workspace ownership fence

Evidence: `apps/web/src/lib/sandbox-authority.ts:379-449,637-766`.

Neither `openOperation()` nor `resolveOutboundRequest()` reads the owning workspace session. New fields merely compare optional caller context to the operation when both are supplied. Legacy callers omit those fields; an old model window continues authorizing requests after the workspace becomes `migrating`, and a new legacy window can still open. Defaulting each new operation to owner version 1 also loses the current version after migration rollback.

A probe using the real authority functions and SQL fixture set the workspace to `migrating`, version 2, with a retained version-1 window:

```text
migrating session old model callback: ALLOWED
migrating session new legacy operation: ALLOWED
```

Required fix: resolve fresh durable workspace ownership and match the expected operation version at admission. Revalidate applicable identity, generation, incarnation and owner predicates in conditional operation insertion/request consumption, not only an earlier read. Preserve project-seed builders without fabricated workspace membership. Keep trusted windows closed in 002. Missing required correlation fields must not disable a check once the stored operation requires them.

Add real SQL tests for blocked/migrating/trusted owners, stale versions after an owner round trip, missing/mismatched incarnation fields, and a valid legacy builder. The current authority additions test trusted-role denial and default legacy fields, not this fence.

### R3. Capacity accounting is checked before, not during, allocation

Evidence: `apps/web/src/lib/workspace-runtime-capacity.ts:296-320` and the subsequent renewal/insertion statements.

`assertLegacyCapacityAccounting()` reads only the mode, then performs renewal/insertion later without a mode/version predicate. A missing singleton row also permits allocation. The plan requires allocator transactions to compare the policy row. The advisor changed the mode to `unified` between the policy read and the actual lease write; acquisition still created a legacy lease.

```text
post-cutover legacy lease count: 1
```

Required fix: include the expected legacy accounting mode/version in the actual conditional writes and fail closed if the singleton is absent. Audit matching release/purge paths so stale legacy calls cannot mutate accounting after the fence. Test a mode change between read and write, not only an already-unified database. Do not implement the unified allocator here; that remains 008.

### R4. Legacy queue mutation does not consistently exclude trusted delivery

Evidence: `apps/web/src/lib/workspace-runtime-capacity.ts:67-76,636-663` and other users of `legacyWorkOwner`.

`legacyWorkOwner` checks workspace ownership but not the work row's `runtimeOwner` or command/protocol identity. Its null-session branch accepts every project-target row. The display query separately filters legacy rows, but leasing, expiry, cancellation and settlement do not consistently do so. A schema-valid trusted project delivery fixture was changed to legacy execution status `failed` by `expireQueuedWork()`.

This fixture exercises the reserved project-target representation; it does not claim project deletion is admitted today. The isolation contract must nevertheless prevent legacy code from interpreting new delivery records as its execution work.

Required fix: use one complete legacy-row predicate for legacy queue claims and mutations, preserving legitimate null-session legacy work while excluding trusted command deliveries. Add tests for workspace-target and reserved project-target delivery rows. Their delivery and execution fields must remain unchanged under legacy queue processing.

### R5. The claimed shared-policy type boundary is unused

Evidence: `apps/web/src/lib/runtime-policy-types.ts:1-19`, `apps/runtime/src/forbidden-bindings.type-test.ts:1-13`, `apps/runtime/tsconfig.forbidden-bindings.json`, and the unchanged `env: Env` declarations in workspace runtime/capacity policy.

No source consumer uses `RuntimePolicyEnv`. The new Worker type test examines only the existing feasibility Worker's hand-written `Env`; it does not import or check the actual shared policy dependencies. Further, the omit/forbidden list names `GITHUB_APP_CLIENT_SECRET`, but the product's actual OAuth binding is `GITHUB_CLIENT_SECRET`, which remains in the proposed policy type.

No live credential leak was demonstrated. The finding is that plan step 4 is not implemented and its passing test does not prove the stated boundary.

Required fix: narrow actual shared policy function dependencies and test their real runtime import graph against the actual product binding names. Prefer explicit required capabilities over an unused blacklist-derived alias. Preserve Alchemy-inferred product bindings and leave actual key/class movement to 011. If the intended seam requires files beyond the approved scope, stop and document the scope change instead of claiming completion from a stand-in interface.

### R6. The npm copied-consumer refresh recipe is not tested

Evidence: `packages/session-brain/src/pi-feasibility.test.ts:144-168`, `packages/session-brain/package.json:10`.

The actual installed symlink's emitted JS/declaration digest matches a fresh build. That part works. However, the stale-copy test modifies the copied output and then repairs it with `fs.rmSync()` plus `fs.cpSync()`. It never invokes npm or the documented refresh script. It proves directory copying, not that npm refreshes a copied `file:` dependency after a source mutation/rebuild. The local npm version is observed, not pinned by the brain manifest.

Required fix: use an isolated npm consumer fixture with the documented npm version/resolution policy. Mutate fixture source, rebuild it, prove the actual imported installed copy is stale, run the proposed npm refresh recipe, then prove the actual import and JS/declarations are fresh. Do not mutate or reinstall the working dependency as a test fixture. Do not claim the existing npm recipe fails; its effectiveness for copies has not been demonstrated.

### R7. The raw JSON parser silently drops a field and has no decode depth bound

Evidence: `packages/runtime-contracts/src/json.ts:84-159`.

The parser creates `{}` and assigns `record[key] = value`. A raw `"__proto__":"ignored"` property hits the inherited setter rather than creating an own property. Strict unknown-field validation never sees it, so the command is accepted. This also risks lossy handling of raw continuation JSON. Separately, 8,000 nested arrays within the command byte ceiling produce a stack-overflow `RangeError` before the later JSON validation depth limit.

Advisor probes produced:

```text
unknown __proto__ field: ACCEPTED
deep bounded JSON: RangeError Maximum call stack size exceeded
```

Required fix: preserve object keys as own data properties without invoking inherited setters, then reject unknown contract fields normally. Enforce bounded nesting during raw decoding before recursive descent. Add raw and escaped prototype-key cases and deeply nested JSON cases; they must fail with a bounded contract error, not silently drop data or overflow the stack.

### R8. Existing deletion tests are broken by the schema addition

Evidence: `apps/web/src/lib/session-preview.test.ts:38-110,129`.

All five project-runtime deletion tests fail with `no such column: runtimeOwner`. Their disposable SQLite fixture still has the old workspace, identity, operation and work schema. Other fixtures were updated, but this one was missed.

Required fix: update the fixture to the additive schema without weakening its deletion/revocation assertions. Rerun the complete web suite. Do not change deletion semantics merely to accommodate a stale fixture; trusted deletion remains owned by 009.

## Reproduction

The advisor's diagnostic script executes reviewed candidate functions against in-memory SQLite and uses the actual installed Drizzle D1 batch adapter. It does not contact Cloudflare or write source files:

```sh
node /home/ayan/ditto/plans/002-review-probes.cjs /home/ayan/ditto-worktrees/plan-001-reexecute
```

It prints observed behavior rather than serving as a passing regression gate. It deliberately reuses the candidate migration test's fixture and will require review if that fixture changes. Contract probes require the freshly built contracts output; the advisor ran them after `pnpm brain:verify`.

## Scope and next handoff

The review read all contract parsers, their tests/config, the consumer freshness implementation, ownership helper/tests, authority implementation, candidate migration test, runtime binding type files, and changed caller/queue/schema hunks. It also compared the executor's diff against its saved baseline. This is not a full audit of untouched legacy services or a certification of all target schema constraints.

Recommended repair order: R1 and R2 first; then R3/R4; R5; R6/R7; R8 and all verification. Add regressions before correcting the confirmed defects. Retain useful candidate work and the preserved 001 source. A further executor must read this review and the selected plan from the advisor checkout, not the outdated worktree plan status. No further repair executor was dispatched in this review.
