# 027 evidence

## Step 1 probe (before)
drizzle-kit generate against a temp copy produced 0028_probe.sql with: CREATE TABLE candidate_capacity_claims; CREATE TABLE __new_x + DROP TABLE x for candidate_command_decisions, candidate_archives, candidate_continuations, candidate_restore_barriers, model_request_admissions.

## Snapshot diff (0027_snapshot.json: 199 insertions, 7 deletions)
- Added table candidate_capacity_claims (9 columns, 2 indexes, 6 checks).
- Added checks: candidate_archives 4; candidate_command_decisions old combined candidate_decision_owner replaced by 4 (owner_version, run_epoch, payload_digest, kind); candidate_continuations 2; candidate_restore_barriers 6; model_request_admissions 3.
- id 3ae978b0-... and prevId d0c5305a-... unchanged; no trailing newline.

## Step 2 verify
Fresh temp copy probe: "No schema changes, nothing to migrate"; no new file.

## Step 3 negative test
Added "nonexistent_trigger_probe" to allowlist: `trigger.nonexistent_trigger_probe: allowlisted but missing from real`, exit 1. Allowlist restored (git diff --quiet exit 0).

## Gates
pnpm db:drift: no drift (exit 0). pnpm typecheck: exit 0. pnpm check: exit 0 (warnings/infos only).
