# 002: Add contracts, durable identities and ownership fences

Status: ACCEPTED in `/home/ayan/ditto-worktrees/plan-001-reexecute` at `6eefdd1`, including the approved R5 adjustment, test changes and supporting source edits. The final approval-time check found no drift across 691 reviewed regular files. Post-cleanup web/runtime typechecks, 20 runtime tests, 15 focused web tests, checks and adversarial probes pass. Preceding full gates passed 722 web, 43 brain and 79 runner tests; the final type-only cleanup preserves identical emitted JavaScript. Read the [acceptance review](002-expanded-repair-review.md); earlier reviews are historical. Future subagents must use `gpt-6-sol` with medium reasoning. Source remains uncommitted in the isolated worktree, with 001 implementation preserved; none has been applied to `brain`. 003 is unblocked but not started and must use the retained candidate, not clean `brain`. Pi `0.85.1` recovery tests pass; Docker boot was not rerun. Paid 001 topology stays NOT RUN and blocks real-user enablement. Original plan base `c963890`. Effort: M, 3-5 days. Risk: high, because a missing fence creates two execution owners.

## Problem, target and prerequisites

Current D1 rows model one sandbox identity and one running-slot pool. The target needs durable commands, brain identity, process incarnation, coordinator projections and paired checkpoints without changing what old readers think existing rows mean.

Required 001 deliverables now in the worktree: Pi `0.85.1` barrier/restoration recipe (`SessionManager.inMemory(imageOwnedCwd, undefined, structuredClone(entries))` then `branch(leafId)` before `createAgentSession`; journal-led recovery of one committed tool batch; 8-barrier SIGKILL matrix). `@ditto/runtime` has `typecheck` and `test`. Independent npm `packages/session-brain` has `typecheck`, `test`, `build`. Docker images `ditto-feasibility-brain:local` and `ditto-feasibility-sandbox:local` boot. Live Alchemy two-service create, DO restart, and incarnation death are NOT RUN. Paid evidence may remain NOT RUN, which blocks real-user enablement. No production migration or deployment follows from those local deliverables. Do not downgrade to `0.80.10`.

Target here is additive schema and a small shared wire contract. It does not execute commands, move keys/classes, import old histories, or remove legacy behavior. All existing sessions remain `legacy` until an explicit fenced migration.

## Rechecked local evidence

`apps/web/src/db/schema.ts:245-248`:

```ts
export const SANDBOX_IDENTITY_KINDS = [
  "project_seed",
  "workspace_session",
] as const;
```

`apps/web/src/db/schema.ts:343`:

```ts
openSlot: text("openSlot").notNull().default("open"),
```

This enforces the existing one-open-operation-per-identity/family convention. Extend it, do not replace it with an in-memory lock. `apps/web/src/lib/sandbox-authority.ts:20-31` has identity/lifecycle fields but no brain incarnation or run epoch. D1's single capacity lease table begins at `apps/web/src/db/schema.ts:500`.

The migration exemplar `apps/web/src/db/legacy-cutover-migration.test.ts:15-24` asserts order around a destructive reset. That reset is historical, not a template for new SQL. For real relational behavior follow `apps/web/src/lib/workspace-recovery.test.ts:1-3`:

```ts
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";
```

Use disposable SQLite fixtures with real constraints and transactions, not a mock that treats a batch as unrelated successful calls. `apps/web/types/env.d.ts` infers bindings from Alchemy; preserve that convention while splitting product/runtime types.

## Exact file scope

Existing: `apps/web/src/db/schema.ts`, `apps/web/migrations/meta/_journal.json`, `apps/web/src/lib/sandbox-authority.ts` and `.test.ts`, `apps/web/src/lib/workspace-runtime.ts`, `apps/web/src/lib/workspace-runtime-capacity.ts`, `apps/web/types/env.d.ts`, root/package manifests and `pnpm-workspace.yaml`.

Proposed:

- `packages/runtime-contracts/package.json`, `tsconfig.json`, `src/index.ts`, `src/command.ts`, `src/runtime.ts`, `src/limits.ts`, `src/contracts.test.ts`.
- `apps/web/src/lib/session-runtime-ownership.ts` and `.test.ts`.
- `apps/web/src/db/trusted-runtime-migration.test.ts`.
- `apps/web/migrations/0020_trusted_runtime_additive.sql` and generated snapshot metadata, only if 0020 is still the next migration at execution. STOP on numbering drift, select the next unused migration, and update all plan references together.

No changes to the contents of historical migration 0019. Do not apply migrations to any shared database. Do not overwrite the unrelated dirty `sandbox-egress-broker.test.ts`.

## Approved R5 scope expansion

The user explicitly approved the expansion after the first repair review. In addition to the existing 002 repair files, edits may touch `apps/web/src/lib/github-app.ts`, `sandbox-bootstrap.ts`, `sandbox-archive.ts`, `workspace-recovery.ts` and their nearest tests. Approval covers local implementation and verification in `/home/ayan/ditto-worktrees/plan-001-reexecute`, not deployment, shared databases, staging, commits or applying changes to `brain`.

The user also explicitly approved retaining the reviewed DB-only signature change in `apps/web/src/db/index.ts`, the product lease-callback wiring in `apps/web/src/lib/session-git-backup.ts`, and its test changes. This approval covers those reviewed changes, not unrelated edits to these modules.

Implement the capability boundary without changing legacy product behavior:

1. Separate reusable workspace runtime policy from product-specific construction of dependencies. Keep existing `workspace-runtime.ts` product-facing exports compatible so unrelated routes do not need a migration. If extraction is needed, one `workspace-runtime-policy.ts` containing the actual shared implementation and its tests is in scope. Move policy rather than duplicate it. Product wrappers may retain product `Env`; the shared implementation, its exported dependency types and its import graph may not. Treat those wrappers as product-only, not evidence of runtime-safe reuse.
2. Keep provisioning and GitHub metadata lookup product-only behind the actual `prepareRuntime` dependency supplied to shared lease policy. The user approved this coarser boundary instead of a separate shared metadata operation. `resolveDefaultBranch()` and `getGitHubApp()` stay in the product adapter with their existing lookup timing: no lookup on the ready-runtime fast path or when readiness is disallowed. Credentials stay in the product callback and never cross through preparation results. Keep `github-app.ts`'s narrowed credential requirements, without importing it into the shared graph. Remove the unused `ResolveDefaultBranch` export from `workspace-runtime-policy.ts` and the assertions/imports that inspect it in `apps/web/src/lib/runtime-policy-bindings.type-test.ts` and `apps/runtime/src/forbidden-bindings.type-test.ts`. Preserve tests of the actual dependency types and product/shared boundary. This shares lease policy, not product provisioning; a future runtime adapter must supply preparation.
3. `getProjectSandbox()` and lifecycle helpers in `sandbox-bootstrap.ts` need only the Sandbox namespace. Archive functions in `sandbox-archive.ts` need only their backup-storage operations. Give them explicit requirements rather than global `Env`, preserve the current SDK/stream behavior, and leave deployment ownership unchanged.
4. Preserve project-value decryption at its existing authorized execution point, but bind the key inside the product adapter. Shared policy receives the operation, not `BETTER_AUTH_SECRET`. Recovery and archive callbacks must carry only their required inputs. Do not pull product-only recovery/preview orchestration into the shared graph through dynamic imports or type-only imports. Domain lease types may move with the shared implementation and be re-exported for current callers.
5. Capacity policy does not read an environment at all. Remove the unconstrained environment parameter from the queue executor contract instead of passing `TEnv` through it. The product wrapper can close over its environment when supplying an execution callback. Preserve existing work execution, cleanup ordering and preview/recovery semantics.
6. Replace the stand-in assertions with a runtime-only compilation of the actual shared implementations, exported dependencies and transitive import graph, without the product's `Env` declaration. Assert forbidden product bindings on the actual capability types and reject accidental imports of product auth/GitHub/agent/UI modules. Add behavioral tests through the existing policy/adapter seams; a type alias with no consumers, an empty default generic or a file-existence test is not proof.

These changes do not authorize a new service protocol, service-binding movement, trusted routing, phase-003 command execution or changes to recovery semantics. Keep real product calls in product adapters and runtime effects injected for future phases. If the extraction requires unrelated route rewrites or additional product modules beyond the approved set, report the concrete dependency before expanding further.

R2, R4 and R6 pass the regressions recorded in [the acceptance review](002-expanded-repair-review.md). Preserve those repairs. The approved cleanup is complete: it touched only the three files named in point 2 and removed unused types/assertions without moving executable code. Verify `pnpm typecheck`, `pnpm --filter @ditto/runtime typecheck`, `pnpm --filter @ditto/runtime test`, the existing workspace policy/adapter tests, `pnpm check` and `git diff --check`. Keep `plans/002-repair-probes.cjs` passing with `--npm --adapter --tsc-build`; the last full brain/repository gates remain required acceptance evidence. If an API change invalidates a probe, report the drift and preserve an equivalent regression; do not count an untriggered hook or loader error as a PASS.

## Planned contract and schema

Create `@ditto/runtime-contracts` with no runtime dependencies. Use strict parsing from `unknown` and explicit bounds; avoid importing Pi into workerd. Add only this package to the pnpm workspace in addition to `apps/*`. The independent brain uses `file:../runtime-contracts`, with `dist` exports. Build contracts before installing/building an npm consumer; lockfiles must resolve the same source. Prove whether pinned npm links or copies this file dependency. For a copy, document and test the owning npm refresh/install recipe in an authorized executor checkout; rebuilding the workspace dist alone is insufficient. Preserve independence of `packages/sandbox-runner`.

Define scripts `typecheck = tsc --noEmit`, `test = vitest run`, `build = tsc -p tsconfig.json`; root `contracts:verify = pnpm --filter @ditto/runtime-contracts typecheck && pnpm --filter @ditto/runtime-contracts exec vitest run && pnpm --filter @ditto/runtime-contracts build`. Tests stay out of emitted production output. The TypeScript output contains portable JS and declarations. Define these before invoking them.

When adding the file dependency, replace 001's `brain:verify` with `pnpm contracts:verify && npm run contracts:check --prefix packages/session-brain && npm run typecheck --prefix packages/session-brain && npm test --prefix packages/session-brain && npm run build --prefix packages/session-brain`. Define brain `contracts:check = vitest run src/pi-feasibility.test.ts -t contracts-consumer-freshness` here, with that named case in the existing planned test file: resolve the actual imported package and compare its emitted JS/declaration digest with freshly built contracts. It must fail on stale copied output or an unexpected package, not merely compare a version string. Add an isolated fixture mutation/rebuild regression proving stale copies fail until refreshed by the documented npm recipe; never mutate the working dependency installation as a test fixture. This is a dependency-resolution behavior gate, not a file-existence test. Every later standalone brain test/typecheck/build requires preceding `pnpm contracts:verify` and `npm run contracts:check --prefix packages/session-brain`; `brain:verify` already enforces both. Never obtain a PASS from stale dist. Installation/refresh commands remain future authorized executor work, not review commands.

Required fields and tables:

1. `workspace_sessions.runtimeOwner`: `legacy | migrating | trusted_v1 | blocked`, default `legacy`; `runtimeOwnerVersion` monotonically increasing; optional `brainIdentityId`; protocol/journal versions and safe product projection version. Old readers never see a new owner as an active old run. `migrating` and `blocked` deny both mutating owners, allow history.
2. Extend permanent identities with `trusted_brain` role and explicit controller class/namespace mapping plus incarnation metadata. Keep random opaque executor/builder IDs and never reuse retired IDs. Do not accept caller-provided mapping as platform identity. Separate lifecycle generation from run epoch and mutation generation.
3. `session_commands`: primary command ID, authenticated owner, target kind/ID, project, optional session/target run/sequence as constrained by kind, payload version, optional user/assistant message IDs, payload digest, accepted/deadline timestamps, admission/execution projection version and reason. Workspace variants require session and sequence; prompt/follow-up variants require message pairs. Unique `(sessionId, commandSeq)` for workspace commands. Reserve project-target representation for 009 deletion, with no fabricated session sequence; do not admit that kind before its policy/delivery exists.
4. `session_command_keys`: unique `(userId, targetKind, targetId, idempotencyKey)` with canonical payload hash and immutable receipt IDs. For first prompt, target is the owned project, not a session that does not exist yet. Include command kind in canonical payload. Retain full dedupe keys and canonical payload hashes through the retained workspace lifetime. Deletion purges those keys/hashes and content through durable cleanup, leaving only minimal nonsecret target/identity fences, never an indefinitely retained secret payload or payload hash.
5. `session_command_sequences`: session counter updated transactionally in the same acceptance batch. Do not use unprotected `max()+1`. Command and cancellation rows occupy sequence positions; sequence allocation rollback must not create a permanent missing predecessor.
6. Extend `workspace_runtime_work` with protocol/owner/command ID and delivery state separate from legacy execution status, unique command delivery identity, retry/lease fields. Persist bounded startup intent metadata linked to accepted commands here: permitted roles/pools, expected owner/version, identity assignment and deadline. Builder-start intent metadata belongs to project-seed records; migration startup uses `runtime_migrations`. 005 resolves those records for pre-execution identity/capacity callbacks. Trusted delivery leases never authorize execution or terminal settlement.
7. Extend privileged operations with `runtimeOwnerVersion`, exact admitted `runId`, `runEpoch`, incarnation and bounded admission reference. Existing legacy rows remain clearly legacy. Preserve open-slot uniqueness and atomic request allowance/denial counters.
8. Add `runtime_capacity_reservations`: pool `brain | execution`, owner/session or builder, identity/incarnation, reservation group, observed state, expiry, owner version and accounting-cutover version. Unique active reservation per identity/pool. Add singleton `runtime_capacity_policy` with accounting mode `legacy | unified` and monotonic version; allocator transactions compare this row. 008 implements one authoritative allocator for both legacy and trusted execution, builders and preview. At the fenced accounting migration boundary, conservatively import observed legacy claims and unresolved claims; route both old/new reserve/release paths to this ledger atomically before enabling trusted sessions. The old lease table then becomes a compatibility projection only, never a second allocator. Before that boundary only legacy allocation runs and trusted admission is closed. 008 proves this locally; 011 performs any separately approved operational migration.
9. Add pair/projection/import/cleanup metadata without pretending D1 is coordinator authority: versioned current/previous pair pointers and per-target projection cursors `(runtimeOwnerVersion, coordinatorSeq)`, ordered lexicographically. Projection key is `(workspaceSessionId, targetKind, targetId)`, where targets are command, message or session recovery/status. Coordinator sequence is workspace-wide, not reset per run. Persist command/run/message membership for settlement. Run epoch is correlation, not a fence that rejects an older run's own pending assistants. 004 defines update-only SQL CAS predicates and zero-row handling. Add `runtime_cleanup_jobs` and minimal deleted-target/identity fences with no cascading foreign-key dependency on project, workspace-session or auth rows. `runtime_migrations` records expected owner/version and pinned source references. Payload-free fences outlive cleanup; canonical content and full dedupe records do not.

003 defines the exact recovery union and admission rules, but keeps each executable recovery kind disabled until its handler is delivered: 006 owns failed-run decisions, 007 owns explicit paired restore and backup retry, and 008 owns explicit preview restart. Later phases add strict variants and admission together: UI Git in 005, preview in 008, archive/continue/project deletion in 009. Do not accept an unimplemented kind or make every kind require prompt messages, a target run, or model configuration. Project deletion gets a project-scoped variant in 009; the session sequence schema here applies to workspace commands.

Wire `CommandV1`, `ReceiptV1`, `BrainEnvelopeV1`, `EffectV1`, `ContinuationV1`, `CheckpointPairV1`, `SnapshotV1`, `EventV1` as summarized below, without implementing their owners:

- Receipt IDs are immutable. Status distinguishes admitted, queued, coordinator-accepted and terminal; Stop additionally recorded/applied. Browser input has only business IDs, key, kind, text/thinking or explicit recovery choice.
- Effects are keyed by run + original assistant entry + tool-call ID across attempts. Continuation stores raw versioned Pi entries/leaf/compaction, settings and pending command position, not product chat.
- Pairs bind archive, continuation, execution position, generation, compatibility, source incarnations and outstanding effects. Product snapshots exclude raw provider state, encryption metadata and R2/preview capabilities.
- Initial proposed bounds: 64 KiB command body, 32,000 text characters, 128-byte idempotency/ID fields, 8 KiB delivery envelope, 1 MiB brain control record, 64 KiB stream frame, 1 MiB per subscriber buffer. Larger runtime content uses bounded chunked encrypted records and opaque transport paging, never an R2 key in Node. Reuse stricter existing model/Git contract limits. Test bounds in bytes as well as characters. If 001 proves these prevent the supported fixed-model context, revise limits explicitly with measured memory evidence before execution, not an unbounded exception.

## Ordered steps and verification

1. Drift-check HEAD, dirty file and next migration number. Read the complete schema and current authority implementation. Add contract types/parsers first and tests for unknown version, duplicate authority fields, oversized encodings, invalid integers and malformed unions. Verify `pnpm --filter @ditto/runtime-contracts exec vitest run src/contracts.test.ts`; expect no permissive parsing or unknown-field forwarding.
2. Add additive schema/migration in a disposable fixture. Populate retained projects/messages/identities/archives before applying only the new migration. Prove counts, IDs, content hashes and legacy interpretation survive, constraints reject duplicate keys, and rollback of failed batch leaves no sequence/message residue. Add schema-level SQL fixtures for per-target version/membership columns and noncascading cleanup/fences when project/session/auth rows are deleted. Check transactional accounting-mode/version constraints with populated legacy claims. Actual projection CAS behavior is completed in 004, retryable full key/hash/content purge in 009, and both-allocator cutover/concurrent admission proof in 008; these are not passing implementation claims in 002. Verify `pnpm --filter @ditto/web exec vitest run src/db/trusted-runtime-migration.test.ts`.
3. Implement `assertRuntimeOwner({session, expectedOwner, ownerVersion})` and compare-and-set owner transition policy. Old execution/queue/settlement entry points must reject a non-legacy owner before any effect. Trusted windows require trusted owner/role/current epoch. No new actual windows open in this phase. Verify `pnpm --filter @ditto/web exec vitest run src/lib/session-runtime-ownership.test.ts src/lib/sandbox-authority.test.ts`.
4. Narrow shared policy function dependencies so the runtime cannot receive global product `Env`. Add compile-time forbidden-binding assertions to the new Worker type tests. Keep actual binding movement for 011, with separate target/test configuration now. Verify `pnpm typecheck`, `pnpm --filter @ditto/runtime typecheck`, `pnpm contracts:verify`, `pnpm check`.

Expected outcome for every command is exit 0 and no skipped required case. Parent baseline in README is prior evidence only. The documented `pnpm --filter @ditto/web test -- <path>` may select all tests; use `exec vitest run` here.

## Handoff and done criteria

003 receives strict versioned parsers, immutable receipt IDs, retained idempotency schema, monotonic transactional sequence allocation, delivery fields and enforced ownership fence. 004 receives distinct epochs/incarnations, encrypted-content envelope types and projection/pair fields. No actual plaintext continuation is written yet.

Machine-checkable completion requires migration-preservation tests, owner-fence tests, contract tests and all four step-4 commands passing. Source fixture queries must assert zero duplicate owner/sequence/key/open-slot rows and unchanged retained data. Active source behavior remains legacy with no new real-user routing.

STOP for destructive generated SQL, historical reset replay, a schema requiring old readers to interpret new execution state, missing transaction support, a shared global Env that exposes auth/model keys to both Workers, or any need to change Sandbox protocol. Maintain one versioned contract source; every incompatible protocol/Pi change needs migration tests or an explicit recovery block.
