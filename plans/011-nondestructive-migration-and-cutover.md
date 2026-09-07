# 011: Import legacy sessions behind an ownership fence

Status: BLOCKED on 010. Base HEAD: `c963890`, branch `brain`. Effort: L, 5-8 days plus explicitly authorized operations. Risk: highest. Drafting or merging this implementation does not authorize live cutover.

## Goal and prerequisites

Preserve retained user history/recovery and transfer exactly one execution owner per session. Import full recoverable Pi state when available, otherwise keep history and backups with a reason-coded recovery block. Deploy/import/cutover steps below are an operator-reviewed runbook, not instructions to execute during planning or local development.

002 introduced additive D1 schema, permanent identities, `legacy|migrating|trusted_v1|blocked` owner plus monotonic version, import manifests, cleanup state and tombstones. 003-010 provide trusted admission, private two-service execution, real Pi continuation, committed paired recovery, two-pool capacity, retention and complete UI observations. All legacy mutation entrypoints and late callbacks must check owner version. New production sessions are still legacy until explicitly switched.

001 proved the exact Alchemy namespace/binding and cyclic rollout recipe; 012 collects paid proof and release approval. Never claim local import fixtures satisfy platform or budget gates. The old namespace must not be renamed/moved by guesswork.

## Rechecked local evidence

`apps/web/migrations/0019_needy_squadron_sinister.sql:20-26` contains this historical destructive cutover excerpt:

```sql
DELETE FROM `workspace_capacity_leases`;--> statement-breakpoint
DELETE FROM `workspace_runtime_work`;--> statement-breakpoint
DELETE FROM `messages`;--> statement-breakpoint
DELETE FROM `workspace_session_recoveries`;--> statement-breakpoint
DELETE FROM `workspace_sessions`;--> statement-breakpoint
DELETE FROM `project_seeds`;--> statement-breakpoint
DELETE FROM `projects`;--> statement-breakpoint
```

Never modify or reuse it for trusted-runtime migration. Its existing `apps/web/src/db/legacy-cutover-migration.test.ts` asserts the historical reset and is not a target preservation exemplar.

`alchemy.run.ts:39-42` binds Sandbox directly to the product:

```ts
bindings: {
  DB: database,
  Sandbox: sandbox,
  BACKUP_BUCKET: sandboxBackups,
```

The same product binding block includes `OPENCODE_API_KEY` at line 53. `Dockerfile:1` pins stable Sandbox; line 3 copies the runner package into `/opt/ditto-runner`. Target removal must wait until no legacy execution depends on these paths.

`packages/sandbox-runner/src/run-agent.ts:81-85` opens the candidate full import source using the plural `sessionsDir` field:

```ts
const sessionFile = path.join(
  options.sessionsDir,
  `${options.conversationId}.jsonl`,
);
const sessionManager = SessionManager.open(sessionFile);
```

D1 message `content` and JSON-encoded assistant parts stored in `tools` at `apps/web/src/db/schema.ts:114-119` are product projections, not Pi continuation. There is no `parts` schema column.

Use disposable SQLite fixtures like `workspace-runtime-capacity.test.ts`, and the actual runner's fixture sessions/archives for behavioral migration. Assert source rows and digests survive, not merely that migration SQL contains no literal DELETE.

## Files

Existing `alchemy.run.ts`, root `Dockerfile`, `apps/web/src/server.ts`, `apps/web/src/env.ts`, `apps/web/types/env.d.ts`, `apps/web/src/lib/workspace-runtime.ts`, `agent-run-service.ts`, `agent-control-service.ts`, `session-preview.ts`, `sandbox-authority.ts`, `workspace-runtime-capacity.ts`, project/workspace tRPC adapters and tests; runner manifest and old Pi CLI paths only at final removal stage.

New `apps/web/src/lib/runtime-migration.ts`, `runtime-migration.test.ts`, runtime `apps/runtime/src/legacy-import.ts`, brain `packages/session-brain/src/import-session.ts`, `import-session.test.ts`. Use additive 002 migration and metadata; if additional D1 fields are required, allocate next unused generated migration number and update all plan references. New local operator script `apps/web/scripts/runtime-migration.ts` must default to dry-run/local, refuse shared targets without explicit maintainer-provided stage and authorization, and report IDs/categories/digests only. Do not add another deployment path through Wrangler/SST.

## Import manifest and ownership protocol

`LegacyImportV1` records owner/project/session/source generation, full source-format/Pi/image version, source digest, archive refs/compatibility, branch/base, command/message mapping, selected entry leaf, unresolved old execution, import status and retained-source refs. States: discovered, fenced, captured, validated, staged, paired, owner_committed, blocked. Each transition has an idempotent key and expected owner version. Metadata never contains plaintext canonical entries or credentials.

1. Reinventory retained data in an authorized snapshot or disposable fixtures. Distinguish dedicated legacy workspace and legacy shared project sandbox/worktree. Capture exact session file and applicable archive; do not trust D1 chat as continuation. Pin source backups and old namespace IDs until validation and retention review.
2. CAS owner `legacy -> migrating`, increment version, deny all new mutating entrypoints and old callbacks. Stop/drain old prompt/control/preview/Git/builder-related writes with observed process evidence. Fencing shared project sandbox worktrees must not stop an unrelated legacy session; if safe per-session isolation cannot be proven, block the group with a reason and require an explicit group maintenance plan.
3. Reconcile already-admitted old effects. A lost old shell result is unknown; preserve history/recovery and block, do not fabricate a safe leaf or replay. Snapshot immutable source after actual quiescence. If a recoverable full session is unavailable, keep D1 history/backup and mark `blocked:missing_continuation`; no reset or transcript-to-Pi synthesis.
4. Validate full pinned/source format, leaf/compaction, tool references, provider metadata and extension state using image-owned import tooling. Untrusted file paths are data only. Unsupported version sets a reason-coded block with retained source; conversion requires separately tested versioned adapter. Do not run arbitrary repository extensions to import their state.
5. Register new permanent target identities in runtime namespace, reserve capacity as needed, restore/clone a compatible execution archive and stage encrypted canonical state. Produce a committed matched pair in the target coordinator under the migration owner/version, without enabling target prompt/tool admission. Preserve branch and frozen base; pair must reflect actual source tree/continuation. Old/current R2 references stay pinned.
6. Prepare target readiness evidence, then CAS D1 owner `migrating -> trusted_v1` with new version and record owner-commit projection intent. Coordinator activates only after verifying the current D1 owner/version and import pair. Lost acknowledgment retries safely. If product commit succeeds but activation is delayed, commands queue/recover; legacy remains fenced. No cross-store atomicity claim.
7. Once trusted effects are admitted, rollback never means reactivating the old owner. Roll forward or freeze trusted session for recovery. Before any trusted effect, a carefully validated rollback may restore legacy ownership only after target identities/operations are retired, target execution stopped/isolated, and original source remains unchanged; use a new monotonically higher owner version. Operational rollback requires maintainer approval.

## Ordered rollout implementation and tests

1. Add the importer and read-only dry-run report against local fixtures. T34 covers full import, missing file, corrupted archive, unsupported format, shared-worktree isolation, completed assistant, pending/unknown effects, archived lineage and idempotent rerun. Verify `pnpm --filter @ditto/web exec vitest run src/lib/runtime-migration.test.ts` and `npm test --prefix packages/session-brain -- src/import-session.test.ts`.
2. Test every ownership/CAS/crash boundary with authenticated legacy and trusted entrypoints. Race old stream/control, cron lease expiry, Git mutation, preview start, checkpoint callback and terminal projection against migration. Exactly one owner can admit effects; `migrating/blocked` admit none. Preserve source row counts, exact synthetic content/digests and both backup generations. Keep existing 0019 history test unchanged and add behavior tests for the new additive schema.
3. Implement and rehearse 008's accounting migration in disposable fixtures: fence old capacity writers, conservatively import observed/uncertain legacy session/builder/preview claims into `runtime_capacity_reservations`, atomically commit accounting version, and route BOTH legacy and trusted reserve/release to its single policy. Old leases become compatibility projections only. Race mixed demand and late old releases; failed/incomplete import keeps trusted admission closed. The operational form requires a separately named target, maintenance window and authorization before any live claim/allocator change. It must precede trusted-session enablement, not rely on summing independent allocators. Stage runtime Worker, target classes and private bindings using the phase-001 proven Alchemy recipe. Do not enable public runtime entrypoints. During coexistence product retains the legacy Sandbox binding/key solely for fenced legacy execution; runtime has target model/encryption keys only. This temporary duplication is explicit and removed only after inventory says zero executable legacy sessions. If security policy forbids coexistence, choose a maintainer-approved paused fleet import, not premature removal. Separate class/namespace names and route by recorded owner; never put two code owners behind the same live identity.
4. Run disposable local full import and target smoke. 012 then executes separately authorized paid empty-environment topology, identity, model/Git, restart, budget/archive and nondestructive migration smoke. All release blockers and both reviews must pass before enabling new trusted production sessions or touching retained production work. Record the authorization target/time in this plan. No deployment command is prescribed until the exact stage and approval exist.
5. With explicit approval, take supported retained-data recovery evidence, execute and verify the fenced single-ledger accounting transition with both admission paths using it, then enable new trusted session creation, and import retained sessions in bounded batches. Stop on unexpected blockers, count/digest mismatch, projection drift or cleanup loss. Blocked retained sessions stay history-readable with original backups, not reset. No accepted old run is simply killed without preserving its outcome uncertainty.
6. Only after all executable legacy work is gone or intentionally blocked, remove product model/legacy Sandbox bindings and old execution ownership, old Pi prompt/control CLI and executor Pi dependencies. Keep import-compatible archived source data/tools as data migration needs require; trusted Node remains the sole Pi runner. Update runner lockfile with npm in its independent package; root lockfile with pnpm only for workspace changes. Executor image must still expose fixed archive/tool/preview contracts. Do not change Sandbox 0.12.3 or Pi 0.80.10.
7. Update durable architecture/security/runtime docs and README to mark completed target behavior; keep pending language for unshipped parts. `CONTEXT.md` changes only if domain meaning changed and require domain-modeling skill. No new ADR unless a costly non-obvious tradeoff was actually made. Generated binding types/route files must be produced through existing owning tooling during implementation, never hand-edited claims.

Local future gates. Before every standalone brain invocation, enforce 002's contracts build and installed-consumer freshness check; copied file dependencies require its verified refresh recipe, not merely a new workspace dist.

```sh
pnpm contracts:verify
npm run contracts:check --prefix packages/session-brain
pnpm --filter @ditto/web exec vitest run src/lib/runtime-migration.test.ts src/db/legacy-cutover-migration.test.ts src/lib/session-runtime-retention.test.ts src/lib/agent-run-service.test.ts src/lib/workspace-runtime.test.ts
npm test --prefix packages/session-brain -- src/import-session.test.ts src/continuation.test.ts
pnpm contracts:verify
pnpm runtime:verify
pnpm brain:verify
pnpm runner:verify
pnpm typecheck
pnpm check
```

Expect exit 0, no required skipped preservation/race case, and no mutation outside disposable local fixtures. Parent baseline is not target migration evidence. Paid/live steps remain NOT RUN until authorized.

## Done, maintenance and STOP

Code-complete means T34 passes at every boundary; zero source rows/backups disappear during failed import; old callbacks cannot change trusted state; generated target bindings exclude product-only keys from runtime and model/encryption keys from product after final cutover. Operational completion is a separate signed evidence row in 012, not implied by code completion.

STOP on destructive migration, unsupported namespace move, inability to capture full continuation, shared-worktree drain affecting unrelated sessions, copied UI history masquerading as Pi state, missing paid gate or authorization, dual owner, or any attempt to restore legacy execution after trusted effects without a new migration design. Keep imports versioned and rerunnable; retain blocked sessions and minimal retirement tombstones indefinitely according to lifetime policy.
