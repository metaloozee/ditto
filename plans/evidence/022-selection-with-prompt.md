# 022 evidence: selection with next prompt

Status: COMPLETE under Amendment 1 (first run stopped at Step 4 on the non-re-entrant `ownerTransition`).

## Baseline (b0db0f2, before edits)
- `pnpm contracts:verify` pass (69 tests); `pnpm typecheck` pass; `pnpm test` pass (903); `pnpm runtime:verify` pass (512);
  credential `product-commands.worker.test.ts` pass (90).

## Contract
`selection?: ConfigurationSelectionV1` on `prompt` and `follow_up` in `BrowserCommandV2` and `CommandV2`
(`packages/runtime-contracts/src/product-command.ts`). Parsed with `parseConfigurationSelectionV1`, omitted when absent,
rejected on stop/cancel/archive_session/restore. Test: "carries an optional model selection only on prompts and follow-ups".

## Migration
`apps/web/migrations/0027_candidate_command_selection.sql`: `ALTER TABLE session_commands ADD selection text;`.
Hand-written like 0022-0026: journal entry, no snapshot. Registered in `session-command.test.ts` and as `m27` in
`product-commands.worker.test.ts`. Schema column is last in `session_commands` to match the ALTER's physical order.
Fixture fixes the column forced: `selection: null` in the legacy insert-select in `session-command.ts`, and `selection text`
in the hand-copied table in `src/test/session-runtime-fixture.ts`.

## Admission
`session-command-candidate.ts` `admit`: `input.selection ?? readSelection(subject)` feeds `preSessionReadiness` and
`ownedConfiguration`. An unentitled selection is refused with the existing `model_unconfigured`, before any row is written.
The JSON is stored in `session_commands.selection`; `reconstruct` restores it. The idempotency hash covers it (changed
selection under the same key is `conflict`).

## Host
`pi-durable-host.ts`:
- `configureOwned` body extracted verbatim into `private applyConfigurationIntent(intent, query, context)`; `configureOwned`
  keeps parsing, timeout, the dependency check and the `ownerTransition` wrapper. Existing runtime and credential tests passed
  unchanged after the extraction alone (512 and 92 tests).
- New `private applyCommandSelection(command, selection, context)`, called from the ordered-submission block in
  `consumeCandidate` (already inside the lane) just before `schedule`, only for the next-in-sequence prompt or follow-up with
  `selection` and `disposition === null`. It sets `dependencies.configuration = await scope.configuration(commandId)` as
  `configureCandidate` does, then calls `applyConfigurationIntent` with `intentId = commandId` under a
  `SYNTHETIC_MODEL_LIMITS.deadlineMs` timeout. No `configureOwned` or `ownerTransition` is used there.
- The retained-command metadata key list now allows `selection` (the stored command carries it).
- Failure: any ack other than `applied` (denied, conflict, unavailable, outcome_unknown) calls
  `disposeCandidate(commandId, "failed", undefined, context, { failRun: true })`. The new optional `failRun` makes
  `disposeCandidate` call `terminal(run, "failed")` for a prompt inside its existing `transition("account", ...)`, so the
  disposition, the assistant failure (`command_failed`) and the run failure commit together. The global `"failed"`
  disposition is unchanged (the submitted-but-unanswered path does not terminate the run). A follow-up leaves the shared run
  alone. The prompt is never run on another model; the next command proceeds on the model already configured.
- Replay: a reopen finds the ledger entry for the command ID and reuses its retained ack, so the selection is not applied twice.

## Fixture change
`model-entry.ts`: `armControlFault` also accepts `"before-submit"`; `reopenFixture(afterFault = false)` tolerates the
rejected alarm promise left by an armed fault.

## Tests (apps/credential-tests/src/product-commands.worker.test.ts)
- admits an entitled selection, reconstructs it, and conflicts on a changed selection under the same key
- refuses an unentitled selection without writing a command row
- applies a carried selection at its sequence turn and later prompts keep it (out of order; models faux-1, faux-2, faux-2)
- applies a carried selection once across a reopen before submission and leaves earlier work on its model
  (fault at before-submit after apply, reopen; one complete ledger row; earlier host_tasks rows unchanged)
- disposes a prompt whose selection is no longer entitled without any model request (failed follow-up, third prompt runs on faux-1)
- fails the run of a first prompt whose selection is no longer entitled, with no model request (member and `host_runs` row both `failed`)

## Gates
- `pnpm check` pass (warnings only); `pnpm typecheck` pass; `pnpm contracts:verify` pass (70); `pnpm runtime:verify` pass (512);
  `pnpm test` pass (903); `pnpm build` pass.
- `product-commands.worker.test.ts` alone: pass, 95/95, twice.
- `pnpm credentials:verify` (combined) FAILED in 4 of 4 runs with this change, each time on a different test, and only in the
  combined run: storage-pop failures and timeouts in untouched tests, and once in the new "applies a carried selection at its
  sequence turn" test (all three members failed). The same combined command with the five new/changed tests excluded
  passed once and failed once on an untouched test ("runs an actually admitted prompt ..."). Recorded as the known WSL flake;
  each file passes alone. Not proven to be unrelated to the new tests.


## Migration regeneration (reviewer, 2026-10-24)

Migrations are Drizzle-generated only. The hand-trimmed 0027 was discarded. The new `meta/0026_snapshot.json` is Drizzle's own snapshot of `schema.ts` at `b0db0f2`, chained to 0021, with no SQL or journal entry. `pnpm db:generate --name=candidate_command_selection` then produced only `ALTER TABLE session_commands ADD selection text;`, and a second generate reports no changes. A structural comparison of 0000–0026 applied against the schema.ts catch-up found drift that predates this plan: `candidate_capacity_claims` is missing from `schema.ts`, CHECK constraints are missing on `candidate_archives`, `candidate_continuations`, `candidate_restore_barriers` and `model_request_admissions`, and the remaining differences are cosmetic (inline UNIQUE versus named index, qualified CHECK text).
