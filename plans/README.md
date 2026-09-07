# Trusted workspace-session runtime implementation plans

Astra-authored plans against `c963890` on branch `brain`, with evidence corrections and Luna cold review plus rereview. Status: DRAFT, requested Grok technical review still BLOCKED by provider rejection before execution. Luna confirmed CR01-CR09 resolved in plan text and phase 001 executable as feasibility. Its overall verdict remains NOT READY: implementation and platform evidence are absent, and later phases remain dependency-blocked. This is not runtime or release approval. No implementation, deployment, migration, staging, or commit is authorized by this plan set.

Canonical requirements: `docs/specs/trusted-session-runtime.md`, all 516 lines reread during the editorial pass. The accepted architecture is pending implementation. Current source wins for current behavior; the spec wins for the target. Research and architecture pages are supporting context, not alternate requirements.

## Scope and safety

Only `plans/*.md` were written. Existing unrelated modification `apps/web/src/lib/sandbox-egress-broker.test.ts` was present at the start. Preserve it. Before execution, compare HEAD and that diff, then revalidate any affected excerpt/test. Do not reset, stage, or overwrite it. At editorial verification, `git status --short` reports `?? plans/`; `git check-ignore` matches neither `plans/` nor `plans/README.md`. These plans are untracked, not ignored. Do not stage them without a separate request.

The spec does not authorize paid environments, production inspection, deployment, shared D1 migration, identity retirement in a live account, backup deletion, Git pushes, or source commits. Name the intended environment and wait for separate authorization before such work. Implementation, test and build commands below are future executor gates. The editorial pass ran only read-only Git and document/source consistency checks. Never print secret values, request bodies, raw provider records, archive bytes, or capability URLs in evidence.

The improve skill's `references/plan-template.md` was unavailable as reported by recon. `references/audit-playbook.md` also returned ENOENT during the drafter's own read. This set uses the user's explicit standalone-plan requirements instead. No hidden template compliance is claimed.

## Cold-review dispositions

Luna completed a fresh rereview of the actual revised plans and canonical spec. It confirmed all nine findings below resolved at the plan-text level, identified no additional plan-text correction, and explicitly found phase 001 executable as feasibility. These are not validated implementations. Its overall NOT READY verdict still applies to implementation/platform/release evidence. Grok remains blocked before execution.

| ID | Disposition | Plan correction / verification owner |
|---|---|---|
| CR01 | Accepted; resolved in plan text | 001 proves named entrypoints; README/005 define deployment binding capability, no public proxy/header identity fiction, fresh D1 operation checks and pre-execution startup/migration intent authority. |
| CR02 | Accepted; resolved in plan text | 001 gates exact stable streaming; 007 narrows archive dependencies and names product/runtime adapters, fixed-path CLI/stream finalization and reconciliation without container storage capabilities. Narrow shared web policy reuse remains allowed; blanket import prohibition rejected. |
| CR03 | Accepted; resolved in plan text | 002/004 define per-target lexicographic projection CAS and old-run settlement; 009 purges full keys/hashes/content on deletion while noncascading minimal fences/cleanup survive. Real SQL/crash assertions added. |
| CR04 | Accepted; resolved in plan text | 002/008/011 select one new capacity ledger for coexistence, fenced conservative claim import and both admission/release paths, old table projection-only. Local mixed-demand proof precedes separately approved operations. |
| CR05 | Partially accepted; resolved in plan text | Mocked-auth ownership tests are labeled; 012 adds bounded real-cookie public HTTP admission/control smoke. Requiring real Better Auth cookies for every fault-matrix case is rejected: it would replace the approved DI seams with an unrelated auth project. |
| CR06 | Accepted; resolved in plan text | 003 defines exact recovery union, state/payload/message/capacity rules and disabled-until-handler ownership; 006/007/008 implement variants; 010 observes without granting authority. |
| CR07 | Accepted; resolved in plan text | 001/004 define trusted termination/isolation evidence; 006/008/009 distinguish replacement permission from old-container capacity release and old-tree archive consistency. Unknown external effects remain unknown. |
| CR08 | Partially accepted; resolved in plan text | 007/012 separate dependency policy from benchmark evidence. Source-only is permitted, not benchmark PASS. Reject skipping P-Git for runtime production readiness: canonical platform gates and carried-forward historical gates require it even while push remains separately disabled. No failed-topology bypass. |
| CR09 | Accepted; resolved in plan text | 001 has no contracts dependency; 002 prepends contracts verification and installed-consumer freshness to brain verification. Later standalone calls enforce the same order; copied npm file dependencies require a proved refresh recipe. |

No source, infrastructure, install, tests, staging or commit is part of these revisions. Read-only document checks are not runtime evidence.

## Execution order and status

| Phase | Plan | Prerequisites | Gate delivered | Status | Effort / risk |
|---|---|---|---|---|---|
| 001 | [Feasibility](001-feasibility.md) | none | Pinned Pi barrier/restore experiment and two-Worker/two-image topology evidence | TODO | L / high |
| 002 | [Contracts and identity](002-contracts-and-identity.md) | 001 local feasibility | Versioned wire contracts, additive D1 schema, ownership fence | BLOCKED 001 | M / high |
| 003 | [Command admission and delivery](003-command-admission-and-delivery.md) | 002 | Durable idempotent receipts and retrying delivery, no request-owned run | BLOCKED 002 | L / high |
| 004 | [Coordinator and encrypted journal](004-coordinator-and-encrypted-journal.md) | 003 | Durable execution decisions, epochs, journal, encrypted storage and projections | BLOCKED 003 | L / high |
| 005 | [Privileged transport and remote execution](005-privileged-transport-and-remote-execution.md) | 004 | Private bridge, split credential broker, remote executor, Git/environment policy | BLOCKED 004 | L / high |
| 006 | [Trusted Pi continuation](006-trusted-pi-continuation.md) | 005 | Full Pi running remotely with awaited persistence and safe process recovery | BLOCKED 005 | L / high |
| 007 | [Paired recovery and seeds](007-paired-recovery-and-seeds.md) | 006 | Initial baseline, immutable pair publication, verified fallback, builder relocation | BLOCKED 006 | L / high |
| 008 | [Capacity and preview supervision](008-capacity-and-preview-supervision.md) | 007 | Both pools, lifecycle scheduling, bounded preview deferral and cold preview | BLOCKED 007 | L / high |
| 009 | [Archive, deletion and retention](009-archive-deletion-and-retention.md) | 008 | Final archive/continue, revoke-first deletion, reference-safe GC | BLOCKED 008 | M-L / high |
| 010 | [Events and existing UI](010-events-and-existing-ui.md) | 009 | Gap-free observation, bounded redaction, reconnect and recovery controls | BLOCKED 009 | L / medium-high |
| 011 | [Non-destructive migration](011-nondestructive-migration-and-cutover.md) | 010 | Retained-state import, owner transfer, compatibility removal rehearsal | BLOCKED 010 | L / high |
| 012 | [Acceptance and release gates](012-acceptance-and-release-gates.md) | 011 and 001 platform evidence | Complete matrix, measured budgets, DR rehearsal and release decision | BLOCKED 011 | L / high |

Dependency graph:

```text
001 local -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 -> 008 -> 009 -> 010 -> 011 -> 012
001 paid topology -----------------------------------------------------------> 012
005 paid transport + 007 archive benchmarks + 008 capacity/cost -------------> 012
historical Git rejection gate ----------------------------------------------> 012
```

This ordering keeps security in place before real Pi execution, and recovery in place before lifecycle work can stop containers. Events have a minimal persisted observation API in 004; 010 adds full replay/UI, so earlier behavioral tests have a real observation boundary without waiting for the UI. Deletion is not left for the release phase. 012 verifies and decides; it does not implement missing runtime behavior.

A failed local feasibility requirement stops dependent implementation. Paid tests require authorization. NOT RUN paid evidence does not become PASS through local mocks. Local development after a successful local feasibility gate is possible, but no trusted session is enabled for real users before all release gates. A failed paid topology gate reopens the architecture decision. Do not substitute workerd, agent-core, Workflows, a third coordinator, a shared brain, or Pi in the executor.

## Shared handoff contracts

Each numbered plan repeats its required subset. Names below are planned, not existing APIs.

- `packages/runtime-contracts`, pnpm package `@ditto/runtime-contracts`: versioned JSON schemas and types only, no Pi, Cloudflare, auth, or DB imports. Build before independent npm consumers and verify the actual imported artifact is fresh; a copied npm file dependency is not refreshed by building workspace dist alone. From 002, `brain:verify` prepends `contracts:verify` and `contracts:check`; standalone brain gates require the same prerequisites. `packages/session-brain` is an independent npm package, like `packages/sandbox-runner`; it pins Pi `0.80.10` and consumes `file:../runtime-contracts`. `apps/runtime`, pnpm package `@ditto/runtime`, owns the runtime Worker. No Sandbox protocol migration.
- `CommandV1`: workspace variants carry `version`, `kind`, `commandId`, `commandSeq`, `userId`, `projectId`, `workspaceSessionId`, `runtimeOwnerVersion`, optional exact `targetRunId`, message IDs where applicable, bounded scalar payload, accepted time and persisted queue deadline. 009 adds project-scoped deletion without a fabricated workspace sequence. Product creates authority-bearing fields. Browser supplies an idempotency key and permitted business input, never identities, epochs, or object keys.
- `ReceiptV1`: immutable IDs plus evolving admission/delivery/execution status, queue deadline/position, Stop recorded/applied status, reason, and projection version. HTTP acceptance does not mean execution started. Idempotency scope is owner plus project for first-session creation/project deletion, owner plus workspace session otherwise, with command kind and canonical payload hash included in conflict detection. Retain dedupe for the retained workspace lifetime.
- Command-kind delivery is phased: 003 adds prompts/follow-ups/Stop/queue cancellation and defines the recovery union, without accepting missing handlers. 006 delivers failed-run decisions, 007 paired restore/backup retry, 008 preview lifecycle, 005 UI Git admission, and 009 archive/continue/project deletion. Each uses the existing contracts package, durable idempotency and coordinator serialization. Model-free commands do not require model configuration or create chat message pairs. Recovery variants are `abandon_failed_run`, `retry_known_safe`, `acknowledge_uncertainty_and_start_new_action`, `restore_checkpoint_acknowledging_loss`, `retry_backup` and `restart_preview`; 003 defines their exact contracts. Pi-starting recovery actions require model/capacity and explicit message rules, never implicit replay. 009 defines project-deletion scope explicitly rather than inventing a workspace sequence for a project.
- `RuntimeOwnership`: `legacy | migrating | trusted_v1 | blocked`, monotonically increasing owner version. `migrating` admits no mutating work from either path. All legacy entry points and late callbacks check this fence. Branch history remains readable. New feature switches select eligible sessions, never bypass the fence. Final cutover removes the alternative execution path.
- Private `RuntimeService`: configuration Boolean, deliver/query command, priority control, snapshot/events, preview proxy, seed start/status, lifecycle/reconciliation. Private product entrypoint: current-authority Git mint-and-fetch, capacity reserve/observe/release, identity registration/rotation/retirement, and execution-only project-value materialization. No keys or installation tokens cross to runtime. Project values are not platform keys and may cross only for an already-admitted execution operation; they are never returned to the brain.
- Private service authority is possession of an Alchemy-configured named `WorkerEntrypoint` binding granted only to the intended counterpart. Neither default public fetch proxies arbitrary internal paths/methods. No caller-ID header, undocumented caller metadata or shared bearer secret is used. Granting another Worker that binding changes privileged deployment configuration. Every callback also resolves a server-originated durable operation/intent in fresh D1, matching owner/lifecycle/run/incarnation/expiry as applicable. Git/environment require admitted windows; startup identity/capacity use accepted-command/builder/migration intents before execution windows, avoiding circular admission.
- Projection key is `(workspaceSessionId, targetKind, targetId)`; ordering is lexicographic `(runtimeOwnerVersion, coordinatorSeq)`, not current run epoch. 004's update-only membership/status/version SQL settles each run's own assistants and classifies zero-row stale/deleted no-ops separately from outages. 009 purges full command keys/payload hashes/content on deletion; minimal nonsecret fences and cleanup records do not cascade with project/session/auth rows.
- After the fenced accounting transition, `runtime_capacity_reservations` is the only capacity allocator for legacy, trusted, builder and preview claims. Old leases are compatibility projections only. 008 proves atomic all-missing-pool reserve/reuse and conservative legacy import locally; 011 separately authorizes operations. Platform-confirmed termination frees a slot; isolated replacement alone leaves the old live claim occupied.
- `BrainEnvelopeV1`: version, identity-correlated attempt/incarnation, run epoch, operation/record ID, expected committed position, bounded payload. HTTP to a fixed synthetic destination is intercepted in runtime Worker code. Platform context plus D1 mapping establishes source identity; envelope fields alone do not. Startup readiness is not prompt completion.
- `EffectV1`: logical key `{runId, assistantEntryId, toolCallId}`, attempt, expected executor incarnation, epoch, lifecycle generation, deadline, validated arguments, outcome policy, state `prepared | admitted | result_recorded | outcome_unknown`. Completed raw provider/tool content is encrypted durably before Pi may advance. In-flight effects remain tracked after revocation.
- `ContinuationV1`: pinned Pi/adapter/journal versions, full validated session entries, selected leaf, compaction boundaries, settings, image-owned extension state, accepted/consumed command position, exact provider responses/results and logical IDs, unresolved effects, paired checkpoint and mutation generation. No conversion through product chat text.
- `CheckpointPairV1`: immutable archive and encrypted continuation references, digest/byte counts, compatibility, source identities/incarnations, mutation generation, execution position and outstanding-effect summary. Only a committed coordinator manifest is restorable. D1 pointers are projections.
- `SnapshotV1`: committed event cursor, per-command/run/message state, interrupted-history marker and current checkpoint position, queue/recovery/preview state, projection lag and reason codes. No raw provider state, crypto metadata, R2 refs, or preview bearer URL. `EventV1` has a monotonic sequence; transient deltas additionally name run, attempt and committed position.

Policy logic stays in `apps/web/src/lib`, reused with narrow dependency types rather than global product `Env`. Runtime-only storage, transport and coordinator code belongs in `apps/runtime/src`. Exclude auth/client/UI code from the runtime import graph. Reuse existing archive, Git, authority and redaction modules; do not create a duplicate policy implementation in the new Worker.

## Specification ownership

| Spec section | Implementation owner | Validation owner |
|---|---|---|
| 1 topology | 001, completed wiring 011 | 001 and 012 |
| 2 responsibilities | 002, 005, 011 | 005, 011 |
| 3 durable ownership | 002, 004 | 003, 004 |
| 4 identity/versioning | 002, 004, 005 | 002, 005, 011 |
| 5 admission/delivery | 003, 004; later Git/lifecycle variants 005, 008, 009 | 003 delivery; 004 consumption/order |
| 6 follow-up/Stop | 003, 004, 006 | 004, 006 |
| 7 run/message lifecycle | 004, 006, 008 | 004, 006, 008 |
| 8 trusted Pi/tools | 001, 005, 006 | 005, 006 |
| 9 effect journal | 004, 005, 006 | 004, 006 |
| 10 continuation | 001, 006 | 001, 006 |
| 11 recovery decisions | 006, 007 | 006, 007 |
| 12 paired publication | 007 | 007 |
| 13 archives/seeds/dependencies | 007 | 007 and 012 benchmarks |
| 14 credential/network contracts | 005 | 005 and 012 |
| 15 Git/project values | 005 | 005 and 012 Git blocker |
| 16 privacy/retention | 004 encryption, 009 retention | 004, 009 |
| 17 events/settlement | 004 projections, 010 delivery | 004, 010 |
| 18 capacity/lifecycle | 008 | 008 and 012 |
| 19 preview/archive/deletion | 008 preview, 009 archive/deletion | 008, 009 |
| 20 observability/failure posture | 004, 005, 010 | each phase; 012 integrated |
| 21 non-destructive cutover | 011 | 011 and 012 |

## Required behavior matrix owners

Test IDs must prefix test titles. Paths below are planned. The fault-matrix helper invokes production handlers with the existing injected-auth fixture and reads receipts/snapshots/events. Label these mocked-auth ownership/admission tests, not full cookie-authentication proof. 012 separately adds a bounded real-auth public HTTP smoke for missing/expired/foreign/valid disposable session cookies and admission/controls. It may inject clocks, transports, storage failures and process termination, not expose coordinator-only testing methods.

| IDs | Required observations | Primary test owner/file |
|---|---|---|
| T01-T04 | Ownership/config rejection; identical first-session retries; conflicting payload | 003 `apps/web/src/lib/session-command.test.ts` |
| T05-T06 | Commit/delivery crash, lost acknowledgment | 003 `apps/web/src/lib/session-command-delivery.test.ts`; T06 no-duplicate-execution proof in 004 |
| T07 | Missing predecessor or durable cancellation | 003 delivery-only coverage in `session-command-delivery.test.ts`; full consumption/order proof in 004 `apps/web/src/lib/session-runtime-control.test.ts` |
| T08 | Priority Stop under missing predecessor and capacity exhaustion | 004 `apps/web/src/lib/session-runtime-control.test.ts`, extended 008 |
| T09-T12 | Browser/product loss; surviving brain; durable results/compaction/follow-ups | 006 `apps/web/src/lib/session-runtime-continuation.test.ts` |
| T13-T16 | Unknown shell; persistence failure; uncooperative Stop; stale callbacks | 006 `apps/web/src/lib/session-runtime-continuation.test.ts`, authority tests in 005 |
| T17-T20 | Publication crash stages, paired rollback, corrupt fallback, backup != assistant failure | 007 `apps/web/src/lib/session-runtime-recovery.test.ts` |
| T21 | First preview deadline fixed; unsafe quiescence blocks | 008 `apps/web/src/lib/session-runtime-preview.test.ts` |
| T22-T23 | Both capacity pools; expiry vs handoff; canceled durable follow-up | 008 `apps/web/src/lib/session-runtime-capacity.test.ts` |
| T24 | Slow subscriber, old cursor, duplicate events, split secret | 010 `apps/web/src/lib/session-runtime-events.test.ts` |
| T25 | Terminal projection outage settles correct assistants on retry | 004 `apps/web/src/lib/session-runtime-journal.test.ts` |
| T26 | History/snapshot/events wake neither container | 010 `apps/web/src/lib/session-runtime-events.test.ts`; minimal check 004 |
| T27-T30 | Brain-only denial; strict requests; hostile resources/tools; secret boundaries | 005 `apps/web/src/lib/session-runtime-security.test.ts`; T29 extended 006 `packages/session-brain/src/resource-loader.test.ts` |
| T31 | Ciphertext/owner/key failures and rotation | 004 `apps/runtime/src/runtime-crypto.test.ts` plus boundary journal test |
| T32-T33 | GC pins; revoke-first deletion races | 009 `apps/web/src/lib/session-runtime-retention.test.ts` |
| T34 | Incompatible/uncertain retained history remains readable | 011 `apps/web/src/lib/runtime-migration.test.ts` |
| T35-T36 | Retry spending attempts; fixed automatic recovery deadline and tracked processes | 006 `apps/web/src/lib/session-runtime-continuation.test.ts`; capacity extended 008 |

## Platform and release gate owners

Every row starts NOT RUN for the target, independent of old local test results. Record environment, versions, image digests, compatibility date, limits, commands, result and reason. Evidence must contain only trusted metadata.

| Gate | Owner | Required evidence |
|---|---|---|
| F-Pi | 001, production adapter retest 006 | All awaited barriers and lossless continuation at Pi 0.80.10, including error swallowing and identical follow-up text |
| F-Topology | 001 | Alchemy first creation and update with both classes on runtime, cyclic private bindings, DO identity source and supported scheduler |
| P-Bridge | 005, 012 | Real Node HTTP bridge and executor/builder denial of brain contracts |
| P-Model | 005, 006, 012 | HTTPS CA/interception, actual provider streaming/cancellation, no platform keys in either container |
| P-Restart | 001, 006, 008, 012 | DO restart with surviving Node, replacement, independent idle and durable reconciliation |
| P-Archive | 007, 012 | Bounded near-ceiling streams, every pair-publication crash, current/previous restore, safe extraction and disk measurements |
| P-Lifecycle | 008, 009, 012 | Both pools including builders/preview, revocation, public product-origin preview, cold restore |
| P-Git | 005, 012 | Crafted non-fast-forward and forbidden ref/capability/delete/extra-ref requests rejected before remote SHA changes; push remains disabled |
| P-Budget | 001 baseline, 008 policy, 012 acceptance | Per-image cold start/memory/disk, tool round trip, idle cost and representative concurrency; maintainer-approved budget thresholds |
| P-Dependencies | 007, 012 | Policy `enabled` or `disabled-source-only` recorded separately from PASS/FAIL/NOT RUN benchmark evidence. Inclusion requires small/medium/large, ten cold restores per path, >=30% p95 improvement and no safety failures. Tested source-only is allowed but is not benchmark PASS. |
| R-Migration | 011 | Non-destructive retained-state rehearsal and fencing-preserving rollback; no replay of historical reset |
| R-DR | 012, operator-authorized | Disaster-recovery backups and verified restore, retaining ciphertext keys and identity fences |
| R-Local | 012 | Extended `pnpm verify` including new packages; no skipped required tests |
| R-Matrix | 012 | T01-T36 against real two-container target plus historical unrun import/isolation/Git/preview/archive/delete/environment matrix |

## Verification baseline and command caveat

The parent supplied these independent baseline results for `c963890` plus the preexisting dirty egress test. The drafter did not run them and does not claim them as target-runtime evidence:

- `pnpm typecheck`: PASS.
- `npm run typecheck --prefix packages/sandbox-runner`: PASS.
- `pnpm check`: PASS with 11 existing non-null assertion warnings.
- `pnpm --filter @ditto/web test -- <two paths>` unexpectedly selected all 63 files and 679 tests, all passed, with route-test warnings and jsdom `scrollTo` notices.
- Verified narrow form: `pnpm --filter @ditto/web exec vitest run src/lib/agent-run-service.test.ts src/lib/workspace-runtime-capacity.test.ts`, 2 files / 41 tests PASS.
- `npm test --prefix packages/sandbox-runner -- src/locked-resource-loader.test.ts`, 1 file / 4 tests PASS.
- Builds, `pnpm runner:verify`, full `pnpm verify`, and Cloudflare target gates: NOT RUN.

Use `pnpm --filter @ditto/web exec vitest run <paths>` for narrow web gates. The documented `pnpm --filter @ditto/web test -- <test-file>` remains a repository command, but is not reliably narrow under this pnpm version. Root `pnpm verify` builds and writes ignored outputs; execute only during authorized implementation, never during a read-only plan review. New package commands are defined in 001 and 002 before later plans use them.

## Evidence limits and open decisions

The editorial pass read all 13 plan files, the complete target spec, and the local source ranges behind every quoted code/SQL/manifest excerpt. It checked all 30 fenced source excerpts with indentation normalized, corrected line anchors, checked local plan links and the 55 distinct local test-command paths, and read root/web/runner manifests, workspace membership and CI. It also read the installed Pi session-manager declarations, the cited event/tool-hook/compaction source ranges, and Alchemy's WorkerRef implementation. This verifies those bounded excerpts, not the entire codebase or runtime behavior. Installed `SessionManager.inMemory` has no entries argument and compaction uses `firstKeptEntryId`; no executable restore recipe has been proved.

Broad research, global Pi documentation reads and fetched Cloudflare pages were reported by the earlier draft, not independently repeated or certified by this pass. External links remain references, not completed platform evidence. The missing improve template/playbook reports were not rechecked. No baseline tests were rerun; builds, new target tests, platform gates and runtime benchmarks remain NOT RUN. All proposed source paths are future deliverables, not implemented APIs.

The installed Pi coding-agent package and types were readable. The earlier drafter reported that resolving `pi-agent-core` from that installed package failed; this editorial pass did not retry dependency resolution. 001 must inspect the actual resolved transitive dependency graph in its isolated implementation checkout and prove behavior, not assume a passing typecheck proves SDK runtime completeness. Alchemy `WorkerRef` supports named service references, but first-creation cyclic deployment was not demonstrated. Cloudflare documentation supports the proposed mechanisms, not this project's integration.

Open release decisions: paid-plan access/authorization, first-deployment cyclic-binding procedure, the precise supported Pi barrier/restore recipe, two-image instance sizing and cost/latency budgets, any required protocol size-policy adjustment after measurement, and approval of unresolved recovery copy/actions in existing UI areas. Project-value materialization is specified as a narrow product-service operation because values currently use the auth secret for encryption; moving that secret to runtime is forbidden.

Considered and rejected: historical reset, dependency-inclusive recovery without benchmark evidence, push enablement based on local parser tests, a third coordinator, direct Node binding access, async subscriptions as persistence barriers, blanket timeouts as proof of process death, default Container fetch for history, and retaining two active owners during migration. These are not alternatives for an executor to reconsider silently.
