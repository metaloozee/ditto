# Plan 055: Build the validated Brain state core

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. This is Phase 1 of a
> staged replacement for blocked Plan 054. It intentionally does not add a
> Durable Object export, AgentHarness runtime, workerd config, report producer,
> Alchemy resource, route, or product caller. The reviewer maintains
> `plans/README.md`.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 878a6a3..HEAD -- \
>   apps/web/package.json pnpm-lock.yaml \
>   apps/web/src/lib/secret-redaction.ts \
>   apps/web/src/db/schema.ts apps/web/src/lib/agent-run-persistence.ts
> ```
>
> STOP if HEAD is not `878a6a3`, the diff is nonempty, or the accepted
> redaction/D1 boundaries no longer match Current state. Execute in a clean
> isolated worktree. Never inspect, cherry-pick, copy, or diff against Plan 042
> attempts or rejected Plan 054 branches `f87fe2f`, `f948514`, `247e4ef`, or
> `e1bd107`; they are traps, not foundations. Do not copy `.env*`, `.alchemy`,
> `.wrangler`, generated artifacts, or prototypes.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH — durable state integrity and secret-bearing checkpoint data
- **Depends on**: Plans 039 and 041 (`DONE-local`)
- **Category**: correctness, security, architecture, tests
- **Planned at**: commit `878a6a3`, 2026-08-13
- **Execution status**: TODO

## Why this matters

Two monolithic Plan 054 attempts and two fresh runtime attempts failed because
state adapters, runtime concurrency, and evidence tooling were built at once.
This phase establishes a small independently reviewable foundation: exact
contracts, a denied execution environment, a cycle-safe Agent Core
SessionStorage, closed per-Turn redacted events, and immutable checkpoint
publication/restoration. No model runs or production resource graph can depend
on this foundation until every adversarial state test is green.

## Current state and locked vocabulary

At `878a6a3`, `apps/web/src/lib/brain/` does not exist. The Website does not
import Agent Core. The live path remains the independent
`packages/sandbox-runner` Coding Agent JSONL runner and is out of scope.

Preserve these domain terms from `CONTEXT.md`:

- **Brain**: trusted project-scoped coordinator.
- **Pi Runtime**: project-scoped Pi harness hosted by Brain.
- **Pi Agent Session**: durable Pi conversation state for exactly one Workspace
  Session; initially `piAgentSessionId === workspaceSessionId`.
- **Safe Checkpoint**: durable state captured only while no model/tool action is
  unresolved.

D1 remains authoritative for Workspace Sessions, Agent Runs, Turns, messages,
control intent, lifecycle, and outcomes. This phase must not import/read/write
D1 or its schema.

`apps/web/src/lib/secret-redaction.ts` already exports
`redactSecrets`, `redactStructured`, and `StreamingSecretRedactor`. Reuse it
unchanged. Do not create another secret-pattern registry.

Exact package boundary:

- Add direct exact web dependencies
  `@earendil-works/pi-agent-core@0.80.10` and
  `@earendil-works/pi-ai@0.80.10`.
- Use only Agent Core root exports for `ExecutionEnv`, `SessionStorage`,
  `SessionMetadata`, `SessionTreeEntry`, and typed errors.
- `@earendil-works/pi-agent-core/node`, Coding Agent, private paths, patches,
  aliases, externalized hosts, and compatibility shims are forbidden.
- Lock must resolve TypeBox `1.1.38`; no unrelated platform/framework package
  may move.

## Locked state contracts

Create exactly:

```text
apps/web/src/lib/brain/
  contracts.ts
  execution-env.ts
  session-storage.ts
  event-journal.ts
  checkpoint-store.ts
```

Colocate `*.test.ts`. Do not create runtime/model/Brain/Worker scripts yet.

Caps:

- ID/key: 1–128 UTF-8 bytes, no NUL.
- Prompt: 32,000 UTF-16 code units (contract only in this phase).
- Entry string 64 KiB UTF-8; depth 32; count 20,000.
- Event string 4 KiB UTF-8; event 64 KiB; replay 1,000/1 MiB.
- Streaming-redactor pending accepted input: 8 KiB.
- Checkpoint: 4 MiB uncompressed, 2 MiB compressed.
- SQLite/R2 threshold 512 KiB compressed; SQLite chunks 64 KiB.
- Temporary encoding/compression allocation: 8 MiB.
- Cache constants: 4 sessions/16 MiB (contract only in this phase).

Closed result error codes are exactly `disabled`, `test_mode_required`,
`invalid`, `not_found`, `busy`, `stale`, `not_active`, `not_quiescent`,
`corrupt`, `storage`, `aborted`, `internal`. Closed event kinds are exactly
`session_restored`, `turn_started`, `assistant_text_delta`, `tool_started`,
`tool_finished`, `stop_acknowledged`, `turn_settled`,
`checkpoint_published`, and `safe_error`.

Every event carries exact project/workspace/run/epoch/turn/sequence identity.
Define one payload type/builder per kind; never accept generic arbitrary keys.
`session_restored` must use the exact current caller Turn identity supplied by a
future runtime; storage never invents a Turn.

## SessionStorage invariants

`BrainSessionStorage` implements the exact public root `SessionStorage`:

- Constructor requires `expectedWorkspaceSessionId`; metadata ID must equal it.
- Reject empty/NUL/oversized IDs, invalid timestamps, unsupported prototypes,
  cycles in values, non-finite numbers, unknown/discriminator-incomplete entry
  shapes, duplicate IDs, missing parent/label/leaf/compaction/branch targets,
  all parent cycles, and unreachable current leaves.
- Validate exact public `SessionTreeEntry` discriminants by inspecting package
  declarations/source; message and custom-message content blocks must be
  validated, not accepted as arbitrary plain objects.
- Parent-DAG validation and `getPathToRoot` are iterative and bounded by entry
  count. Self and two-node cycles fail before object construction. No call can
  hang.
- Generated IDs use Web Crypto and collision-check every fallback attempt.
- Append validates atomically before mutating indexes. Ordinary entries select
  themselves; a `leaf` entry records the operation and selects its `targetId`.
- Reads and snapshots are deep clones. Disposal permanently rejects reads and
  writes requiring live state.

## Event journal invariants

The journal is constructed over a narrow synchronous SQL adapter. Redaction
state is a `Map` keyed by complete Turn identity. Each entry owns its own
`StreamingSecretRedactor`, concrete-secret array, conservative
accepted-versus-definitely-emitted accounting, discard latch, and marked-event
state.

- Check the 8 KiB budget before passing input to the shared redactor. Never
  transiently retain more.
- Process ordinary large safe chunks incrementally rather than treating chunk
  size itself as dangerous holdback.
- On potential dangerous holdback overflow, discard the held region, emit
  exactly one marked `[REDACTED]`/truncated event, discard continuation until
  the exact identity receives a non-text boundary, then reset and resume.
- Interleaved identities cannot reset, flush, read, or use each other's secrets.
- Flush the exact identity before non-text events and settlement.
- Tool events accept only bounded name/call ID and error boolean. `safe_error`
  accepts only one closed code. No raw Pi/provider/tool object can be represented.
- Stored JSON/kind/identity corruption returns `corrupt`; never cast or replace
  malformed storage with `{}`.
- Replay is strictly after cursor, ascending, and count/byte bounded.

## Checkpoint invariants

Define narrow storage interfaces for synchronous SQLite/transaction semantics
and R2. Production Worker integration comes later, but this phase tests exact
ordering using failure-injectable adapters plus real Node SQLite where possible.

Canonical payload version 1 contains project/workspace/Pi-session identity,
metadata, leaf, entries, and `{runId, executionEpoch, turnSequence}` safe point.

- Validate snapshot/tree/identity, redact with the live operation's concrete
  secrets, then validate again.
- Deterministically stream sorted JSON tokens through UTF-8 into
  `CompressionStream`. Never materialize a canonical JSON string or retain
  canonical string + full raw + compressed copies. Track actual temporary
  buffers and fail above 8 MiB.
- Hash exact compressed bytes. Reject >4 MiB uncompressed or >2 MiB compressed.
- At/below 512 KiB, one synchronous transaction writes bounded contiguous
  chunks, inserts `checkpoint_published`, captures cursor, inserts immutable
  manifest, and CASes pointer.
- Above threshold, conditionally write immutable R2 first under hashed-ID prefix,
  validate an existing conditional-write collision, then transactionally bind
  event/manifest/pointer. R2 failure is typed `storage`; post-put failure may
  leave only an unreferenced orphan.
- `expectedGeneration: null` means expect no current pointer. Positive means
  exact match. Never replace null with observed state.
- Restore follows only current manifest and validates kind, storage/chunk
  exclusivity, exact contiguous chunks or bounded R2 metadata/body, compressed
  length/hash, bounded gzip, exact uncompressed length, fatal UTF-8, version,
  all manifest/payload project/session/safe-point fields, metadata equality,
  tree, and leaf before returning a snapshot.
- R2 objects are size-checked before full buffering. Decompression is streamed
  and cancelled immediately on cap/mismatch.
- Any SQL/R2 exception maps to a typed safe error; no raw message escapes.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | exit 0 |
| Runner baseline | `npm ci --prefix packages/sandbox-runner` | exit 0 |
| Typecheck | `npm run typecheck --prefix apps/web` | exit 0 |
| State tests | `npm test --prefix apps/web -- --run src/lib/brain` | all pass |
| Redaction regression | `npm test --prefix apps/web -- --run src/lib/secret-redaction.test.ts src/lib/brain/event-journal.test.ts src/lib/brain/checkpoint-store.test.ts` | all pass |
| Repository gate | `pnpm verify` | existing checks/tests/build/runner pass |
| Diff | `git diff --check` | no errors |

## Scope

Only modify:

- `apps/web/package.json`
- `pnpm-lock.yaml`
- `apps/web/src/lib/brain/contracts.ts` and test
- `apps/web/src/lib/brain/execution-env.ts` and test
- `apps/web/src/lib/brain/session-storage.ts` and test
- `apps/web/src/lib/brain/event-journal.ts` and test
- `apps/web/src/lib/brain/checkpoint-store.ts` and test

Out of scope: every other path, especially Alchemy, server entry, Env types,
Vite config, D1/migrations, secret-redaction source, runtime/model code,
Durable Object class/config, workerd tests/scripts, Website routes/components,
and sandbox-runner.

## Git workflow

Use a clean isolated worktree from `878a6a3`. Branch suggestion:
`advisor/055-build-validated-brain-state-core`. Conventional commits only:

1. `feat(brain): add validated Agent Core adapters`
2. `feat(brain): add immutable checkpoint and event stores`

Do not push, merge, deploy, or edit plan records.

## Steps

### Step 1: Revalidate exact public declarations and dependency graph

Run baseline install/typecheck/focused redaction tests/runner tests before edits.
Pack exact Agent Core/Pi AI tarballs under `/tmp`, inspect root export maps and
all SessionTreeEntry/SessionStorage/ExecutionEnv declarations. Add only exact
web dependencies with pnpm. Verify TypeBox 1.1.38 and no unrelated lock drift.

**Verify**: install + typecheck; a Node manifest guard confirms exact pins and no
web Coding Agent dependency.

### Step 2: Implement contracts, denied ExecutionEnv, and cycle-safe storage

Implement the locked contracts and complete public interfaces. Write
adversarial tests first for empty/cross-session metadata, self/two-node cycles,
all target types, unknown/incomplete discriminants, clone isolation, collision
retry, leaf semantics, and bounded path traversal.

**Verify**: focused contracts/execution/storage tests and app typecheck pass.

### Step 3: Implement per-identity closed event projection

Implement schema, closed payload builders, bounded SQL insertion/replay, and
per-complete-identity redaction. Tests must interleave two synthetic secret
streams, split exact and private-key-shaped canaries, send multi-megabyte unsafe
continuations, cross boundaries, resume safe text, corrupt stored rows, and hit
UTF-8/count/byte edges. Tests never print canaries.

**Verify**: event + shared redaction suites pass.

### Step 4: Implement immutable checkpoint codec/publication/restoration

Implement exact streaming codec, SQLite/R2 ordering, CAS, faults, corruption
checks, and bounded restore. Tests cover empty/ordinary/max payloads; exact
threshold and threshold+1; every fault stage; stale/null CAS; chunk
missing/duplicate/reordered/oversized; R2 put/collision/orphan; all
hash/gzip/length/version/identity/safe-point/tree/leaf corruptions; and concrete
secret absence from durable bytes/metadata/errors.

**Verify**: checkpoint tests and typecheck pass. The test suite must assert
actual temporary peak <=8 MiB, not calculate a capped proxy.

### Step 5: Run full regression and audit the diff

Run all commands in Commands. Confirm only Scope paths changed. Search Brain
source for Coding Agent, Agent Core `/node`, JSONL, filesystem/process/socket,
`child_process`, worker threads, and compatibility shims; all must be absent.
Commit logical units and leave the worktree clean.

## Test plan

At minimum add named tests for every case listed in Steps 2–4. Tests must assert
negative side effects, not only result status: invalid state does not mutate
indexes; failed publication leaves old pointer/event/manifest; malformed R2 is
bounded before read; per-session canaries never cross; corruption is rejected
before SessionStorage construction.

## Done criteria

- [ ] Exact Agent Core/Pi AI 0.80.10 pins and TypeBox 1.1.38; no Coding Agent.
- [ ] Complete denied ExecutionEnv and public SessionStorage compile against
      exact root declarations.
- [ ] Session metadata equality, discriminants, targets, DAG and leaves are
      enforced; adversarial path lookups cannot hang.
- [ ] Event payloads are closed and exact-Turn keyed; interleaved redaction stays
      isolated and within 8 KiB.
- [ ] Checkpoints are redacted, streaming/bounded, immutable, payload-first,
      event/manifest/pointer atomic, generation-CAS protected, and fully
      validated on restore.
- [ ] Every focused test, app typecheck, `pnpm verify`, scope audit, source guard,
      and `git diff --check` passes.
- [ ] Worktree is clean after Conventional Commits.

## STOP conditions

Stop instead of improvising if exact public declarations require Agent Core
`./node`, Coding Agent, private imports, files/processes, a patch/alias/shim, or
an out-of-scope file; if unmodified TypeBox/Agent Core interfaces cannot compile;
if redactor accounting cannot conservatively enforce 8 KiB without changing the
shared redactor; if streaming deterministic encoding cannot stay under 8 MiB;
if R2 insert-only semantics or SQLite atomic event/manifest/pointer cannot be
represented by the narrow interfaces; if unrelated locked dependencies move;
or if a required gate fails twice after one reasonable correction.

## Maintenance notes

Plan 056 may compose AgentHarness only on this reviewed state core. It must not
weaken validation or add alternate storage. Plan 057 will repeat publication and
corruption behavior in real workerd SQLite/R2 and whole-process restart. Review
this phase primarily for adversarial tests, cycle bounds, exact redaction
identity, fault ordering, and hidden full-buffer copies.
