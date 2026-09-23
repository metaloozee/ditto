# Trusted workspace-session runtime implementation plans

001 local feasibility and 002 are accepted and landed on `brain` at merge `693a334`. **003 is READY, NOT STARTED.** Paid topology, restart and incarnation-lifetime evidence remain NOT RUN and block real-user trusted-runtime enablement.

Reconciled against `a5c1185` on `brain`. Git comparison confirmed that source outside `plans/` matches the accepted execution branch at `4e2bad8`; the checkout was clean before these documentation edits. This reconciliation changes no source and reruns no tests. The [002 acceptance review](002-expanded-repair-review.md) remains the acceptance record, including the approved R5 adjustment and verification timing.

Canonical requirements: [trusted-session-runtime.md](../docs/specs/trusted-session-runtime.md). Current source wins for implemented behavior; the spec wins for the target. Local acceptance of 001/002 is not completion of the trusted runtime or permission to deploy it.

## What is ready for 003

- 001 delivered pinned Pi `0.85.1`, the local journal-led recovery/import recipe and persistence-barrier crash tests, runner compatibility, local topology fixtures and earlier Docker boot evidence. The brain is still feasibility code, not the production coordinator/agent integration.
- 002 delivered strict runtime contracts, additive migration `0020`, identity/ownership and delivery schema, legacy-owner fences, shared lease policy with product-only adapters, and contracts-consumer freshness checks. The sequence counter and capacity ledger exist as schema; durable command admission/allocation belongs to 003 and unified capacity allocation to 008.
- 003 implements authenticated durable admission, idempotent receipts, transactional sequence/message/outbox writes, durable controls and bounded retrying delivery. It does not launch Pi or implement 004's coordinator, execution deduplication or sequence consumption. Existing/default sessions remain on the fenced legacy path.

Start with [003](003-command-admission-and-delivery.md) and the acceptance review. Use a new worktree from current merged `brain`, not the old execution checkout. A new worktree does not inherit uncommitted plan edits: use the reconciled plans from this checkout until they are separately committed. The recorded executor preference remains `gpt-6-sol` with medium reasoning.

## Plan and evidence map

There is one implementation plan per numbered phase. The extra 002 files record successive reviews, not additional work items.

| Artifact | Role |
|---|---|
| [002-contracts-and-identity.md](002-contracts-and-identity.md) | Accepted implementation requirements and handoff |
| [002-expanded-repair-review.md](002-expanded-repair-review.md) | Final acceptance, R5 decision, approved scope and evidence limits |
| [002-execution-review.md](002-execution-review.md), [002-repair-review.md](002-repair-review.md) | Superseded candidate reviews; retain R1-R8 history, not their old blocking verdicts |
| [002-review-probes.cjs](002-review-probes.cjs) | Historical observational reproducer; references a removed helper and is not a current regression gate |
| [002-repair-probes.cjs](002-repair-probes.cjs) | Accepted repair reproducer; version-specific and requires installed dependencies/fresh contracts |
| [002-latest-review-evidence/](002-latest-review-evidence/) | Preserved local verification logs and scope summaries |

Do not run either probe using its default old absolute worktree. A future authorized local verification must pass its candidate root explicitly and follow the acceptance review's prerequisites and optional modes. The repair probe's npm modes create disposable fixtures and run install/build commands; they are not read-only document checks. Before-edit manifests referenced in old executor directories are not all present here. Their availability was not rechecked; tracked summaries are historical evidence, not a claim that every comparison is reproducible from a fresh clone.

## Scope and safety

Accepted 001/002 source is committed on local `brain`. Old reviews refer to retained evidence and stale plan copies in executor and `/tmp` worktrees; those are provenance, not execution targets. Starting 003 requires its own execution request.

Plans are tracked. The old dirty `apps/web/src/lib/sandbox-egress-broker.test.ts` and untracked-plans notes are historical. Always inspect actual status and preserve unrelated work. Do not reset, stage or overwrite it.

The user explicitly authorized local source commits and a branch merge for 001/002. That did not authorize paid environments, production inspection, deployment, shared D1 migration, identity retirement in a live account, backup deletion or Git pushes. Name the intended environment and wait for separate authorization before such work. Implementation, test and build commands below are future executor gates. The editorial pass ran only read-only Git and document/source consistency checks. Never print secret values, request bodies, raw provider records, archive bytes, or capability URLs in evidence.

The improve skill's `references/plan-template.md` was unavailable as reported by recon. `references/audit-playbook.md` also returned ENOENT during the drafter's own read. This set uses the user's explicit standalone-plan requirements instead. No hidden template compliance is claimed.

## Historical cold-review dispositions

Before implementation, Luna reread the revised plans and canonical spec and confirmed CR01-CR09 resolved at the plan-text level. Its NOT READY verdict described the then-missing implementation/platform evidence, not a current block on 003. The broad Grok plan review never completed; later targeted Grok experiments and 001/002 execution reviews did. Those do not replace a broad remaining-phase or release review. The dispositions below preserve the original decisions; current phase status is in the execution table.

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
| 001 | [Feasibility](001-feasibility.md) | none | Pi 0.85.1 recovery-adapter/barrier proof and two-Worker/two-image topology evidence | Local PASS, landed on `brain`; paid F NOT RUN | L / high |
| 002 | [Contracts and identity](002-contracts-and-identity.md) | 001 local feasibility | Versioned wire contracts, additive D1 schema, ownership fence | ACCEPTED, landed on `brain`; no shared D1 migration | M / high |
| 003 | [Command admission and delivery](003-command-admission-and-delivery.md) | 002 | Durable idempotent receipts and retrying delivery, no request-owned run | READY; not started | L / high |
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

Each numbered plan repeats its required subset. Packages, parsers, schema and ownership helpers delivered by 001/002 now exist. Coordinator, transport, recovery and lifecycle behavior below remains owned by the later phases; a declared contract is not an implemented service.

Phase 001 proved Pi `0.85.1` and `SessionManager.inMemory(cwd, options, entries)` then `branch(leafId)`. 002 and 006 plan text now carry that recipe. Do not downgrade to `0.80.10` or reconstruct import by rewriting JSONL. 006 remains blocked on 005; only its version/restore assumptions were refreshed.

- `packages/runtime-contracts`, pnpm package `@ditto/runtime-contracts`: implemented versioned JSON parsers and types, no Pi, Cloudflare, auth, or DB imports. Build before independent npm consumers and verify the actual imported artifact is fresh; a copied npm file dependency is not refreshed by building workspace dist alone. `brain:verify` prepends `contracts:verify` and `contracts:check`; standalone brain gates require the same prerequisites. `packages/session-brain` is an independent npm package, like `packages/sandbox-runner`; both pin Pi `0.85.1`. The brain now consumes `file:../runtime-contracts` and pins npm `12.0.2`; `npm run contracts:refresh --prefix packages/session-brain` is the verified refresh command when needed. `apps/runtime`, pnpm package `@ditto/runtime`, currently contains local feasibility/type-boundary tests and the runtime Worker fixture, not production command execution. No Sandbox protocol migration.
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

001's local Pi/barrier and Docker evidence is accepted. Production-adapter validation and real-platform gates remain separate and unrun. Record environment, versions, image digests, compatibility date, limits, commands, result and reason; do not turn local evidence into a platform PASS. Evidence must contain only trusted metadata.

| Gate | Owner | Required evidence |
|---|---|---|
| F-Pi | 001, production adapter retest 006 | Local 001 recipe/barriers accepted at Pi 0.85.1; 006 production-adapter retest pending. Journal-led recovery is required; direct continuation still fails both interrupted-tool cases. |
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

## Verification commands

The accepted review records 722 web, 43 brain, 20 runtime and 79 runner tests passing, plus both repair-probe variants with zero failures. Full repository/brain gates preceded the final type-only cleanup; focused gates and equivalent emitted JavaScript checks followed it. See the acceptance review for exact timing. No runtime gates were rerun during this reconciliation.

During authorized implementation, use all three commands for the inherited local gate:

```sh
pnpm verify
pnpm runtime:verify
pnpm brain:verify
```

Root `pnpm verify` still excludes brain/runtime verification. `brain:verify` includes contracts verification and installed-consumer freshness; refresh a stale copied dependency with the existing brain command before retrying. CI integration of the new gates remains owned by 012.

### Historical original baseline

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

This reconciliation checked the accepted source baseline, plan status/provenance, the 003 source references and inherited package gates, plus known downstream version and policy-boundary drift. It did not rerun tests, audit all runtime invariants, inspect old external worktrees or revalidate every later-phase source excerpt. Plans 004-012 retain their original drafting bases and need a source drift check when their prerequisites land. Historical source anchors inside accepted plans and reviews describe the reviewed revision unless explicitly refreshed.

The original editorial pass checked 13 plans, the complete target spec, 30 source excerpts and 55 test-command paths. At that time Pi 0.80.10 lacked the in-memory entries import and no executable restore recipe had been proved. Those limitations were superseded by 001's accepted Pi 0.85.1 recipe and tests. The later reconcile at `6eefdd1` accepted local A-D and Docker evidence from `/tmp/ditto-feasibility-execute.bw57gx/worktree`, while paid topology/restart/incarnation evidence stayed NOT RUN. These are historical records, not directions to restore an old checkout.

External documentation describes mechanisms, not passing integration evidence. The improve reference files were unavailable during drafting; `audit-playbook.md` and `closing-the-loop.md` were also missing during this review. No hidden template compliance or new platform validation is claimed.

Open release decisions/evidence: paid-plan authorization, first-deployment cyclic bindings, platform identity/restart/incarnation lifetime, production integration of the proven Pi recipe in 006, image sizing and cost/latency budgets, measured protocol limits, archive/dependency benchmarks, Git rejection, migration/DR rehearsal, and unresolved recovery copy/actions. Project-value decryption remains product-only because values use the auth secret; runtime must not receive that secret.

Outside this plans-only reconciliation, root `README.md` still describes the historical destructive plan-012 reset, and `docs/README.md` plus `docs/development/agent-workflow.md` still describe plans as ignored. Those documentation corrections remain a separate follow-up. Trusted-runtime migration must follow the canonical nondestructive specification, never replay the historical reset.

Considered and rejected: historical reset, dependency-inclusive recovery without benchmark evidence, push enablement based on local parser tests, a third coordinator, direct Node binding access, async subscriptions as persistence barriers, blanket timeouts as proof of process death, default Container fetch for history, and retaining two active owners during migration. These are not alternatives for an executor to reconsider silently.
