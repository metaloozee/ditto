# Pi Durable implementation plans

Prepared against Ditto `bcce03e`. This is a new track for `docs/specs/pi-durable-session-runtime.md`, not a continuation of the historical Node-container plans. No implementation, runtime experiment, live provider request, deployment or data reset was performed while writing these plans.

## Start here

Execute one plan per implementation session. 001–017 are DONE for their local fixture scope and integrated into `feat/pi-durable`; the 2026-10-23 reconcile at `1f93e9c` confirmed every recorded integration commit is an ancestor of HEAD. Each DONE row links its acceptance evidence. The long execution chronology for 001–008 (stops, corrections, usage-limit interruptions, executor IDs) now lives in [history.md](history.md); nothing was removed from it.

Later files are conditional implementation briefs, not permission to code past a gate. Before starting one, read predecessor evidence, inspect the resulting source, stamp the new base commit and replace provisional file/API details with the actual supported interfaces. Narrow or split the brief if that evidence changes its size. Do not write detailed patches against imagined Pi or host APIs. This preserves decision 17's feasibility-first requirement while making the whole delivery sequence visible now.

Every file includes its own outcome, owners, current-code excerpt, scope, steps, checks, stop conditions and maintenance concerns. No plan relies on another plan for its requirement text. Dependencies identify evidence needed before execution, not an implied pass. Planning review alone passes no implementation gate.

## Open maintainer decisions

These block or shape the remaining work. None is an executor's call.

1. **018 layout and copy.** 018 is blocked only on this. It covers Codex connection placement, model/thinking choice, recovery acknowledgment copy and a visible state for a blocked archive (016 limit). Expect 2–3 sketches before any UI edit.
2. **009 image reads.** Image files now return an error result instead of an attachment, because Pi Durable 1.0.1 tool results cannot carry images. Approve this parity change or ask for a follow-up plan.
3. **Continuation exposure.** Per 016, continuation is not end to end: no composition builds the destination baseline from the seed's archive. 018 must not offer Continue to users until that exists, or the maintainer accepts hiding it.
4. **Stale 008 worktree.** `/home/ayan/ditto-execution/plan-008-4WXvNW` (detached at `2487d56`) was removed on 2026-10-23 at the maintainer's request. Its unarchived `plans/evidence/artifacts/008/*` logs and `.execution-008/` scratch were discarded; the archived checkpoints from `1f93e9c` remain.

## Execution order and status

Current 001–007 disposition: DONE for their accepted local scopes, integrated at `89a34b4`, `0d9c73c`, `2efce11`, `5173e12`, `432e332`, `e43d260` and `3bdf90a`. Production discovery, configuration and transport stay unavailable. Hosted auth, live-provider acceptance and PD38 are not claimed. See each row's acceptance and integration links, and [history.md](history.md) for how each got there.

Current 008 disposition: DONE for the accepted local fixture scope. The product-suite timeout and teardown failure came from a per-instance Proxy in `@cloudflare/vitest-pool-workers` 0.12.21, fixed by a test-pool pnpm patch with no test or deadline changes. Candidate source is integrated at `e9e3684` and the patch at `12fb71a`. All five aggregate gates pass sequentially, CI passes, and an independent review accepts the slice with four recorded limits. See [completion and acceptance](evidence/008-completion.md). The checkpoint paragraphs above are history.

Current 009 disposition: DONE for the local fixture scope. Seven runner-parity tools run through one admitted effect each and an image-owned `ditto-exec` executor with an exclusive per-operation journal. The first independent review rejected a non-exclusive journal and a generation check that hid prior work; both were fixed and a second review accepted with limits. Image reads now return an error instead of an attachment, which needs maintainer approval. See [009 evidence](evidence/009-tool-parity.md).

Current 010 disposition: DONE for the local fixture scope, which completes local L3. Terminal assistants settle in D1 from runtime projection intents that commit with each terminal decision and retry from a durable wakeup until an exact acknowledgment. Owned observation returns redacted snapshots and gap-free semantic events without opening the host. Two independent reviews rejected a retained expiry that was never reconciled, first after a terminal run and then after a cancel; both were fixed with regression tests and a third review accepted the cancel fix. A product-suite teardown failure was traced to the test pool popping storage before Durable Object SQLite closes and fixed in the existing pool patch. Readiness, conversation generation, streaming deltas, push subscribers, exact-value redaction and backup health are not implemented. See [010 evidence](evidence/010-l3-acceptance.md).

Current 011 disposition: DONE for the local fixture scope. Seed builders take an execution slot before any container starts and keep it until termination evidence exists, and may only fetch the owned repository. The runtime has a recovery ledger and workspace recovery module that capture, restore and branch-sync under one exclusive scope with per-step admission, rechecks and classified outcomes; it is not yet wired into the host. Archive restore now checks the digest before extraction and rejects ambiguous link listings. The Docker fixture found and fixed an archive create defect. One review round rejected three issues, all fixed; the second accepted with limits. See [011 evidence](evidence/011-seeds-artifacts.md).

Current 012 disposition: DONE for the local fixture scope. The runtime publishes a pair only after a verified workspace archive and a verified encrypted snapshot of the Pi storage rows at one exact commit position exist, under one exclusive mutation scope bound to the host. The manifest, pointer move and pending product projection commit in one runtime transaction. Ordinary work waits for the baseline and yields to a held scope. One review round rejected four issues, all fixed; the second accepted with limits. The publisher is not yet composed into a deployed session. See [012 evidence](evidence/012-paired-publication.md).

Current 013 disposition: DONE for the local fixture scope. A restore commits its intent, an ordinary-admission barrier and the command cutoff in one D1 batch. The runtime fences its epoch, gives every accepted command through the cutoff its fate, aborts the old conversation with its background tasks, restores the current pair or its previous pair, forks the matching conversation generation and moves the pointer in one transaction. Only the exact completion reopens admission; a restore against a stale pointer is refused before anything is discarded. Two review rounds rejected four issues, all fixed; the third accepted with limits. No deployed composition can restore yet. See [013 evidence](evidence/013-paired-restore.md).

Current 014 disposition: DONE for the local fixture scope, which completes L4 in fixtures. UI Git status and commit and preview start and stop are typed runtime actions under the same exclusive mutation scope as tools, publication and restore; legacy Git and preview leases refuse candidate sessions. The first unbacked change fixes a ten-minute backup deadline. Preview defers it but never extends it; at the deadline new changes are denied, preview stops only with termination evidence and the pair publishes. Cold preview restores only the current pair, and only with nothing unbacked. One review round rejected five issues, all fixed; the second accepted with limits. No deployed composition supplies a workspace controller, and push stays disabled. See [014 evidence](evidence/014-l4-acceptance.md).

Current 015 disposition: DONE for the local fixture scope. Candidate execution and model work are admitted through a D1 claim ledger with no lease: execution (executors, preview and seed builders) and model requests have separate pools, 20 global and two per user by default. A claim is released only with termination evidence, never by time. Stop and cancel bypass capacity; waiting work keeps its fixed queue deadline and is handed over for expiry only after it. Project values are decrypted in the product for one admitted shell operation after fresh authority, travel only in that run's environment, reach only the bash child and are redacted in the runner and the runtime. One review round rejected four issues, all fixed; the second accepted with limits. Multi-workspace execution stays disabled until the listed limits close. See [015 evidence](evidence/015-resource-and-value-policy.md).

Current 016 disposition: DONE for the local fixture scope, accepted with limits after one blocker was fixed. Archive is an admitted command with its own cutoff; continuation starts a new lineage from a sealed seed; deletion fences first and cleans up with termination evidence. Continuation is not end to end: no composition builds the destination baseline from the seed's archive. A blocked archive has no acknowledgment path; deletion is its only exit. Integrated at `d937a85`. See [016 evidence](evidence/016-lifecycle.md).

Current 017 disposition: DONE for the local fixture scope, which completes the L5 backend in fixtures; L5 product completion waits on 018. Retention collects retired pairs, orphaned objects and unreferenced Pi writes after a 24-hour period, one bounded step per host wakeup. A credential test rehearses a clean start that fences old authority and accounts for its executor first. CI failed on `2fe70ae` although the recorded local gate passed: an alarm racing revocation threw from host activation and kept the purged session open, which also made 016's deletion test fail in isolation. The alarm now treats a revocation found at activation as denied, with a regression test. See [017 evidence](evidence/017-l5-backend-acceptance.md).

Runtime gate drift: since 015 the full `pnpm runtime:verify` run is load-sensitive. The upstream conformance case "streams long document tails across root replacement deltas" in `apps/runtime/src/pi-durable-storage.test.ts` hits its 5 s limit under full-suite load: three of four 015 runs (also on base `c827cda`; the recorded run passed), both final 016 runs, and 017's recorded run (510 of 511). It passes alone in about 3 s. 016 and 017 were accepted with this one failure. CI runs only `pnpm verify`, which omits `runtime:verify` and `contracts:verify`, so CI has never exercised the runtime suite. 019 cannot pass its "CI genuinely includes the runtime checks" criterion until this is resolved.

`READY` means ready for a separately requested implementation session, not implemented. `BLOCKED` means a prerequisite lacks evidence. `DONE` requires reviewed code plus the listed checks. Gate outcomes use exactly `passed`, `failed`, `not run`.

| Plan | Work | Phase | Depends on | Status |
|---|---|---|---|---|
| [001](001-pi-durable-local-compatibility.md) | Pinned imports, real local workerd and Docker tool | L0 | None | DONE and integrated at `89a34b4`; [acceptance](evidence/001-advisor-final-review.md), [integration](evidence/001-integration.md) |
| [002](002-bounded-host-lifecycle.md) | Cooperative local waits, actual bounded close/reopen, wakeups | L1 | 001 | DONE and integrated at `0d9c73c`; [acceptance](evidence/002-advisor-final-review.md), [integration](evidence/002-integration.md) |
| [003](003-effect-admission-and-stop.md) | Effect evidence, uncertainty, Stop, deadlines | L1 | 002 | DONE and integrated at `2efce11`; [acceptance](evidence/003-advisor-final-review.md), [integration](evidence/003-integration.md) |
| [004](004-encrypted-storage-core.md) | Encrypted storage and real SQLite transactions | L2 | 003, complete L1 | DONE and integrated at `5173e12`; [acceptance](evidence/004-advisor-final-review.md), [integration](evidence/004-integration.md) |
| [005](005-storage-history-and-large-records.md) | Exact history, size handling, references and key retention | L2 | 004 | DONE and integrated at `432e332`; [acceptance](evidence/005-advisor-final-review.md), [integration](evidence/005-integration.md) |
| [006](006-codex-connection-and-renewal.md) | Supported Codex flow, credential DO and renewal | L3 | 005, complete L2 | DONE for [accepted fixture-only local scope](evidence/006-advisor-final-review.md), integrated at `e43d260`; [cleanup](evidence/006-integration.md), hosted auth unavailable |
| [007](007-codex-requests-and-model-configuration.md) | Exact provider contract and account-backed configuration | L3 | 006 | DONE for [accepted local fixture scope](evidence/007-advisor-final-review.md), integrated at `3bdf90a`; [cleanup](evidence/007-integration.md); production/live behavior unavailable; PD38 not run |
| [008](008-product-command-vertical-slice.md) | Product admission, delivery, ordered Pi submissions | L3 | Accepted 007, complete local L2 | DONE for accepted local fixture scope, integrated at `e9e3684` and `12fb71a`; [completion and acceptance](evidence/008-completion.md) |
| [009](009-remote-coding-tools.md) | Guarded coding-tool/attachment parity | L3 | 008 | DONE ([evidence](evidence/009-tool-parity.md)) |
| [010](010-settlement-and-observation.md) | Terminal projections and redacted reconnect | L3 | 009 | DONE for local fixture scope ([evidence](evidence/010-l3-acceptance.md)) |
| [011](011-owned-seeds-and-recovery-artifacts.md) | Owned builders and verified archive operations | L4 | 010, complete L3 | DONE for local fixture scope ([evidence](evidence/011-seeds-artifacts.md)) |
| [012](012-paired-checkpoint-publication.md) | Initial and later paired publication | L4 | 011 | DONE for local fixture scope ([evidence](evidence/012-paired-publication.md)) |
| [013](013-paired-restore-and-command-dispositions.md) | Restore cutoff, dispositions and generation retirement | L4 | 012 | DONE for local fixture scope ([evidence](evidence/013-paired-restore.md)) |
| [014](014-git-preview-and-checkpoint-quiescence.md) | Git serialization and preview quiescence | L4 | 013 | DONE ([evidence](evidence/014-l4-acceptance.md)) |
| [015](015-capacity-and-project-value-policy.md) | Complete capacity and execution-only values | L5 | 014, complete L4 | DONE ([evidence](evidence/015-resource-and-value-policy.md)) |
| [016](016-archive-continue-and-deletion.md) | Archive/new lineage and revocation-first deletion | L5 | 015 | DONE ([evidence](evidence/016-lifecycle.md)) |
| [017](017-retention-and-clean-start-rehearsal.md) | Retention and disposable ownership transition | L5 | 016 | DONE ([evidence](evidence/017-l5-backend-acceptance.md), [CI correction](evidence/017-l5-backend-acceptance.md#ci-correction)) |
| [021](021-candidate-product-exposure.md) | Expose candidate observation, actions, models, configuration, archive/restore facts and deletion to product routes | L5 | 017 | DONE with one limit (2026-10-23 review): Step 5 configuration intents stopped, since the host applies configuration only under a prompt/follow-up command. Uncommitted in `ditto-execution/plan-021`; combined `credentials:verify` hit the known WSL storage flake, every part passes alone ([evidence](evidence/021-product-exposure.md)) |
| [022](022-selection-with-next-prompt.md) | Apply a model selection carried by the next prompt | L5 | 021 | DONE (reviewed 2026-10-24; [evidence](evidence/022-selection-with-prompt.md)). Combined local `credentials:verify` is flaky on WSL; CI is the arbiter |
| — | Schema drift: `schema.ts` lacks `candidate_capacity_claims` and CHECK constraints from hand-written 0022–0026 (found 2026-10-24, see [022 evidence](evidence/022-selection-with-prompt.md#migration-regeneration-reviewer-2026-10-24)) | tech-debt | — | OPEN, unplanned |
| [018](018-product-controls-and-reconnect.md) | Product controls without UI-test expansion | L5 | 017, 021, 022, focused UI placement/copy approval | IN PROGRESS: rewritten 2026-10-24 against 021/022 contracts; executor dispatched in `ditto-execution/plan-018b`. Item 2 slice held in `ditto-execution/plan-018` |
| [019](019-local-acceptance-and-implementation-retirement.md) | Real-auth smoke, acceptance, CI and source retirement | L6 | 018, complete L5, stable `runtime:verify` | BLOCKED |
| [020](020-approved-provider-and-hosted-validation.md) | Separately approved provider and hosted evidence | External | Provider: 006/007 and safety gates. Hosted: 019. Separate operational approval | BLOCKED |

The critical path is intentionally serial. These plans change shared ownership and persistence protocols; coding them concurrently before gates pass would create speculative contracts. After a gate passes, independent bounded subtasks may be reassessed, but phase order still applies.

```text
001 -> 002 -> 003 -> 004 -> 005
 L0       L1 complete       L2 complete
 -> 006 -> 007 -> 008 -> 009 -> 010
                            L3 complete
 -> 011 -> 012 -> 013 -> 014
                     L4 complete
 -> 015 -> 016 -> 017 -> 021 -> 022 -> 018 -> 019
                     L5       L6

006/007 + explicit allowance approval -> 020 provider track
019 + explicit deployment approval    -> 020 hosted track
```

## Non-negotiable scope

- One runtime DO and one execution sandbox per workspace session. One product credential DO per connected user. No shared user-level Pi Harness or trusted brain container.
- D1 owns product commands/authority, runtime SQLite owns Pi and safety state, R2 owns immutable artifacts/oversized encrypted records, disk owns live execution. Browser state is presentation only.
- Mandatory provider/execution adapters enforce fresh authority, Stop and persistence barriers. Unknown shell outcomes never replay automatically.
- No retained mutation before a proved initial paired baseline. These plans conservatively keep retained enablement off until all L4 checks pass. Before then, only explicitly disposable synthetic workspaces.
- Provisional resource limits precede any multi-workspace execution. 015 completes policy, not the first safety cap. Credentials/project values cannot enter a slice before that slice's policy.
- Exact model configuration applies when Pi prepares a request. No command-wide model pin, catalogue-as-entitlement claim, Codex CLI engine or API-billing fallback.
- No legacy importer, maintained Pi fork, parallel engine, Sandbox SDK migration, new deployment owner, benchmark gate, automated UI suite or early browser-verification skill.
- No plan authorizes a data reset, existing-resource deletion, deployment, live subscription use, staging or commit. Actual operations require separate explicit approval and a named target.
- Preserve source, configuration, unrelated changes and historical evidence. The old plan/evidence snapshot is `52c9cef`; numbers in this new directory refer only to this track.

## Verification conventions

Root uses pnpm 11.8.0; runtime/web/contracts are workspace packages. Runner and retained session-brain are independent npm packages. CI uses Node 24. Match each package's installed Vitest rather than introducing a global runner. TypeScript style uses tabs, double quotes, typed domain outcomes and `unknown` external input.

Existing commands:

```sh
pnpm --filter @ditto/web exec vitest run <paths>
pnpm --filter @ditto/runtime exec vitest run <paths>
pnpm typecheck
pnpm runtime:verify
pnpm contracts:verify
npm test --prefix packages/sandbox-runner -- <paths>
pnpm runner:verify
pnpm brain:verify
pnpm verify
```

These are implementation commands, not results from this planning session. Root `verify` currently omits runtime checks; run `runtime:verify` separately until the gate includes them. Keep brain verification while relevant old code remains; removal must follow replacement coverage, not a desire to make tests pass. Future test filenames in plans are proposed locations and must be created or rebound to an existing equivalent before their command can count as a gate. A zero-test filter is not a pass.

001 must create `pnpm runtime:local:verify`, a finite verifier around the existing Alchemy development path, using the new isolated `DITTO_LOCAL_PI_DURABLE=1` selector. Neither command nor candidate fixture exists at planning time. A never-ending dev server or the old `DITTO_LOCAL_RUNTIME_TOPOLOGY` fixture is not this gate. Do not run normal environment initialization against existing state. Missing prerequisites are `not run` in evidence and a nonzero verifier exit, never a silent pass.

The primary behavior seam is authenticated workspace-session commands/observation. Project creation/deletion use owned project operations. Focused storage, crypto/provider contracts and real-auth backend HTTP tests are allowed. Injected-auth and Node SQLite fixtures do not prove cookie auth or real DO semantics.

## Required behavior coverage

This is a planned coverage map, not test evidence. Each executor must replace intended coverage with exact test names and reviewed results in its evidence file. Local fixture coverage and external PD38 cannot be combined into one pass.

| IDs | Principal plans |
|---|---|
| PD01–PD03 | 006–008, 018 |
| PD04–PD06 | 003, 008, 013 |
| PD07–PD10 | 002–003, 008, 010 |
| PD11–PD16 | 003–005, 008–009, 013, 015 |
| PD17–PD19 | 004–005, 017 |
| PD20 | 011–014 |
| PD21–PD23 | 012–013 |
| PD24 | 010, 012, 014, 016 |
| PD25 | 014 |
| PD26–PD27 | 002, 010, 014, 016, 018 |
| PD28–PD31 | 006–009, 011, 014–015 |
| PD32–PD33 | 008, 015 |
| PD34–PD35 | 016–017 |
| PD36 | 004–005, 017 |
| PD37 | 017 |
| PD38 | 020, explicit approval required |
| PD39 | 019, real-auth HTTP rather than injected identity |
| PD40 | 013 |
| PD41 | 006, 011, 018 |
| PD42 | 007–008, 018 |

019 checks all rows against actual evidence. Essential local gaps block L6. Unavailable paid-platform checks do not block unrelated local work and do not pass by omission.

## Evidence format

Each implementation session writes only its actual results to the named `plans/evidence/<number>-*.md` file, then updates its plan/index status. Include:

- Reviewed source commit and dirty-diff scope, exact engine/provider/toolchain/adapter versions, compatibility date and image revision/digest where available.
- Environment and fixture isolation, commands, exit results, test names and injected crash points.
- Observable guarantees and evidence limitations; no secret values, raw provider content, archive bytes or capability URLs.
- `passed`, `failed`, `not run` per local, Docker, provider, hosted and browser check.
- Stop reason and upstream issue/change needed for any failed engineering gate. Do not publish an issue without separate authorization.

## Planning reconnaissance and limits

Read the authoritative spec in full, product/domain documents, historical research, root/package/CI configuration and targeted runtime/product/execution source/test seams. Current README/source still describe the old running fixed-model sandbox path. Target requirements override old architecture assumptions; current code still establishes what runs today.

`plans/` was empty and designated for this new track. No ADRs remain in `docs/adr`. The installed improve skill's `references/plan-template.md` and audit playbook were unavailable. These files use the self-contained structure required by the supplied skill instead. No general codebase audit was requested or performed, no dependency/security sweep or benchmark ran, and no test suite was run merely to write plans. Source excerpts were checked directly, not copied from subagent reports.

Considered and rejected: retaining Node topology to match current code; declaring historical tests new-engine evidence; immediately writing a full legacy importer; enabling multi-workspace execution before limits; treating fixture Codex success as actual subscription support; prematurely choosing private lifecycle APIs. These conflict with the selected spec or lack evidence, rather than being alternate implementation tracks.

## Cold reviews

Three read-only cold reviews completed on `xai/grok-4.7` with `medium` reasoning, covering 001–005, 006–010 and 011–020. The author verified findings against source/spec, applied corrections and recorded rejected recommendations in [review dispositions](reviews/README.md). A fourth targeted revision/dependency check on the same model and reasoning level returned `READY FOR L0`, with no remaining dependency contradiction blocking 001. That verdict concerns the plan, not an existing verifier or working runtime. Planning review does not pass any implementation gate.
