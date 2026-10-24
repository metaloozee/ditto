# 023 evidence: schema drift check

## Check design
`scripts/check-schema-drift.mjs` (`pnpm db:drift`, also in `pnpm verify` after `pnpm check`) builds two in-memory `node:sqlite` databases.
- A (real): every migration in `apps/web/migrations/meta/_journal.json` order, split on `--> statement-breakpoint`.
- B (schema): `drizzle-kit generate --dialect=sqlite --schema=./src/db/schema.ts --out=<os tmpdir> --name=drift`, applied the same way; temp dir removed in `finally`.
- Per table compared: columns, unique column sets (inline UNIQUE equals named unique index), non-unique indexes, foreign keys, normalized CHECK expressions.
- Triggers: real-DB triggers must be in `scripts/schema-drift-allowlist.json` (four `*_final` triggers); any trigger in B is a difference.
Journal path used: `apps/web/migrations/meta/_journal.json` (`migrations/_journal.json` does not exist).

## Step 2 output (before schema.ts change; exit 1)
Differences, in kind (expression text trimmed):
- `candidate_archives.checks`: real has 4 (`cutoffseq>=0`, `ownerversion=1`, `state in (closed,complete)`, state-fields OR), schema has none.
- `candidate_capacity_claims.table`: real=present schema=missing.
- `candidate_command_decisions.checks`: real has 5, schema has 2 (owner/epoch/digest combined in one).
- `candidate_continuations.checks`: real has 2 (state in, state-fields OR), schema none.
- `candidate_restore_barriers.checks`: real has 6, schema none.
- `model_request_admissions.checks`: real has 3 (digest length, purpose in, state in), schema none.
No other kinds of difference (no unique, index, column, FK, trigger differences). This matches "Why this matters".

## schema.ts changes
- Added `candidateCapacityClaims` (columns, owner unique index, live index, 6 CHECKs: pool, kind, ownerKey length, state, kind/pool pairing, state fields).
- Added CHECKs to `model_request_admissions` (3), `candidate_restore_barriers` (6), `candidate_archives` (4), `candidate_continuations` (2).
- `candidate_command_decisions`: split the combined check into owner_version, run_epoch, payload_digest, decision kind; `candidate_decision_time` kept.
No constraint meaning changed. Uniqueness representation untouched.

## Step 4: Drizzle's would-be resync (scratch worktree, removed afterward)
`pnpm --filter @ditto/web db:generate --name=drift_resync` produced `0028_drift_resync.sql`, `meta/0028_snapshot.json` (id `701ea77a-f5ab-47c6-a0b6-f4222ca29502`, prevId `3ae978b0-2592-46bf-acfd-ed94f92bc1e7`) and a journal entry idx 28. Statements:
1. `CREATE TABLE candidate_capacity_claims` + `CREATE UNIQUE INDEX candidate_capacity_claims_owner_uidx` + `CREATE INDEX candidate_capacity_claims_live_idx`. The table already exists (0025), so this would fail on apply.
2. Table rebuilds (`PRAGMA foreign_keys=OFF`; `CREATE TABLE __new_x`; `INSERT ... SELECT`; `DROP TABLE x`; `ALTER TABLE __new_x RENAME TO x`; `PRAGMA foreign_keys=ON`) for `candidate_command_decisions`, `candidate_archives`, `candidate_continuations`, `candidate_restore_barriers`, `model_request_admissions`, each followed by re-creating its indexes (`candidate_archives_sessionId_unique`; `candidate_continuations_{sourceSessionId,destinationSessionId,destinationIdentityId}_unique`; `candidate_restore_barriers_closed_uidx`; `model_request_admissions_window_idx`).
All targets are objects the real migrations already create. Warning: `DROP TABLE` drops triggers, so the rebuilds of `candidate_archives`, `candidate_continuations` and `candidate_restore_barriers` would silently delete their `*_final` triggers. A raw `db:generate` output must not be applied as is.

## Gates
- Baseline (before changes): typecheck pass, 80 test files / 916 tests pass, `pnpm check` 123 warnings 11 infos, no errors.
- After: `pnpm check` same counts, `pnpm typecheck` pass, `pnpm test` 80 files / 916 tests pass, `pnpm db:drift` prints `no drift`.
