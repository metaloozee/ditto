# Pi Durable implementation plans

Prepared against Ditto `bcce03e`. This is a new track for `docs/specs/pi-durable-session-runtime.md`, not a continuation of the historical Node-container plans. No implementation, runtime experiment, live provider request, deployment or data reset was performed while writing these plans.

## Start here

Execute one plan per implementation session. [001](001-pi-durable-local-compatibility.md) is DONE for the reviewed local scope; its implementation is integrated into `feat/pi-durable` at `89a34b4`. Before separately requested 002 execution, refresh its provisional interfaces against that source and accepted evidence. A failed feasibility gate stops dependent work; it does not authorize another engine, a fork, private scheduler patch or weaker guarantee.

Later files are conditional implementation briefs, not permission to code past a gate. Before starting one, read predecessor evidence, inspect the resulting source, stamp the new base commit and replace provisional file/API details with the actual supported interfaces. Narrow or split the brief if that evidence changes its size. Do not write detailed patches against imagined Pi or host APIs. This preserves decision 17's feasibility-first requirement while making the whole delivery sequence visible now.

Every file includes its own outcome, owners, current-code excerpt, scope, steps, checks, stop conditions and maintenance concerns. No plan relies on another plan for its requirement text. Dependencies identify evidence needed before execution, not an implied pass. Cold reviews and the final targeted dependency check are complete. Accepted corrections are applied. The planning verdict was ready for L0 execution only. Current 001 implementation results are recorded below; planning review alone passes no implementation gate.

## Execution order and status

Current disposition: 001 is DONE for the independently reviewed local scope and integrated into `feat/pi-durable` at `89a34b4`. Exact sanitized `pnpm verify` and `pnpm runtime:verify` pass, as does the independent real host-authenticated Worker/SQLite/Docker gate. The user approved root Biome exclusions `!plans/**` and `!docs/**`; application rules are unchanged. See [final advisor acceptance](evidence/001-advisor-final-review.md) and [branch integration and archived artifacts](evidence/001-integration.md). The user authorized commits, fast-forward integration and detached-worktree cleanup. No later plan ran; 002 requires brief refresh and a separate execution session. Earlier stop records below remain historical.

Historical first-retry disposition: 001 was partially executed in a disposable detached worktree at `dfeccf2`. The 2026-10-03 retry repaired isolated CLI launch and added passing candidate bundle/dynamic-import checks. Component tests passed; credential-free Alchemy startup and the active release-age policy still block L0. No Docker turn ran or requested-date startup was proved. Inspected v1 0.94.0 has the same credential prerequisite; a documented v2 solution requires a separately scoped toolchain migration. See [001 retry evidence](evidence/001-local-compatibility.md#resume-on-2026-10-03), the unchanged historical [advisor review](evidence/001-advisor-review.md), and the [resume review](evidence/001-advisor-resume-review.md). Independent review confirmed the launcher repair and passing supplemental checks; the actual Docker turn and exact default gates still do not pass. The partial diff is not accepted as completed L0 work. Later plans remain blocked.

Historical 001 disposition before the approved directory exclusions, after supported HOST resource-property auth: the actual host-authenticated local Worker/SQLite/Docker marker gate passes, as does `pnpm runtime:verify`, now with 6 Node checks and 28 Worker tests. Only two approved values enter named candidate Worker HOST properties. No credential values enter environments, bindings, runtime SQLite or bundles. HOST management tokens are encrypted with an unpersisted one-run password. The API denial transport observed no Cloudflare API request. Candidate date is `2026-03-10`; normal resource dates are unchanged. `pnpm verify` still fails only at the current check stage on preserved research-template Biome errors. See [current local evidence](evidence/001-local-compatibility.md#supported-host-resource-auth-and-actual-local-docker-result). Advisor must decide any precise artifact exclusion and review the final diff. 001 stays BLOCKED for final acceptance; later plans remain BLOCKED. Historical evidence and reviews are preserved.

`READY` means ready for a separately requested implementation session, not implemented. `BLOCKED` means a prerequisite lacks evidence. `DONE` requires reviewed code plus the listed checks. Gate outcomes use exactly `passed`, `failed`, `not run`.

| Plan | Work | Phase | Depends on | Status |
|---|---|---|---|---|
| [001](001-pi-durable-local-compatibility.md) | Pinned imports, real local workerd and Docker tool | L0 | None | DONE in reviewed execution worktree |
| [002](002-bounded-host-lifecycle.md) | Passive startup, bounded host interruption/reopen, wakeups | L1 | 001 | BLOCKED |
| [003](003-effect-admission-and-stop.md) | Effect evidence, uncertainty, Stop, deadlines | L1 | 002 | BLOCKED |
| [004](004-encrypted-storage-core.md) | Encrypted storage and real SQLite transactions | L2 | 003, complete L1 | BLOCKED |
| [005](005-storage-history-and-large-records.md) | Exact history, size handling, references and key retention | L2 | 004 | BLOCKED |
| [006](006-codex-connection-and-renewal.md) | Supported Codex flow, credential DO and renewal | L3 | 005, complete L2 | BLOCKED |
| [007](007-codex-requests-and-model-configuration.md) | Exact provider contract and account-backed configuration | L3 | 006 | BLOCKED |
| [008](008-product-command-vertical-slice.md) | Product admission, delivery, ordered Pi submissions | L3 | 007 | BLOCKED |
| [009](009-remote-coding-tools.md) | Guarded coding-tool/attachment parity | L3 | 008 | BLOCKED |
| [010](010-settlement-and-observation.md) | Terminal projections and redacted reconnect | L3 | 009 | BLOCKED |
| [011](011-owned-seeds-and-recovery-artifacts.md) | Owned builders and verified archive operations | L4 | 010, complete L3 | BLOCKED |
| [012](012-paired-checkpoint-publication.md) | Initial and later paired publication | L4 | 011 | BLOCKED |
| [013](013-paired-restore-and-command-dispositions.md) | Restore cutoff, dispositions and generation retirement | L4 | 012 | BLOCKED |
| [014](014-git-preview-and-checkpoint-quiescence.md) | Git serialization and preview quiescence | L4 | 013 | BLOCKED |
| [015](015-capacity-and-project-value-policy.md) | Complete capacity and execution-only values | L5 | 014, complete L4 | BLOCKED |
| [016](016-archive-continue-and-deletion.md) | Archive/new lineage and revocation-first deletion | L5 | 015 | BLOCKED |
| [017](017-retention-and-clean-start-rehearsal.md) | Retention and disposable ownership transition | L5 | 016 | BLOCKED |
| [018](018-product-controls-and-reconnect.md) | Product controls without UI-test expansion | L5 | 017, focused UI placement/copy approval | BLOCKED |
| [019](019-local-acceptance-and-implementation-retirement.md) | Real-auth smoke, acceptance, CI and source retirement | L6 | 018, complete L5 | BLOCKED |
| [020](020-approved-provider-and-hosted-validation.md) | Separately approved provider and hosted evidence | External | Provider: 006/007 and safety gates. Hosted: 019. Separate operational approval | BLOCKED |

The critical path is intentionally serial. These plans change shared ownership and persistence protocols; coding them concurrently before gates pass would create speculative contracts. After a gate passes, independent bounded subtasks may be reassessed, but phase order still applies.

```text
001 -> 002 -> 003 -> 004 -> 005
 L0       L1 complete       L2 complete
 -> 006 -> 007 -> 008 -> 009 -> 010
                            L3 complete
 -> 011 -> 012 -> 013 -> 014
                     L4 complete
 -> 015 -> 016 -> 017 -> 018 -> 019
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
