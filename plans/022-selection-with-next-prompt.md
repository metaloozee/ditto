# 022: Apply a model selection carried by the next prompt

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If anything in "STOP conditions" occurs, stop and report; do not improvise. Do not stage or commit. A reviewer maintains `plans/README.md`; do not edit it.
>
> **Drift check (run first)**: `git diff --stat b0db0f2..HEAD -- apps/web/src/lib apps/web/src/db apps/web/migrations apps/runtime/src apps/credential-tests/src packages/runtime-contracts/src`
> Any in-scope change since `b0db0f2` means comparing the excerpts below against live code. A mismatch is a STOP condition.

## Status

- **Status**: DONE, reviewed 2026-10-24. Amendment 1 applied. Review round 1 made the run failure on a refused selection atomic (`disposeCandidate(..., { failRun: true })`).
- **Priority**: P1 (018 needs it)
- **Effort**: M
- **Risk**: MED (host ordering lane)
- **Depends on**: 021 (DONE, integrated at `94df040`)
- **Category**: direction (L5 product completion)
- **Planned at**: commit `b0db0f2`, 2026-10-24
- **Maintainer decision (2026-10-24)**: The browser sends model and thinking with the next prompt or follow-up. No standalone configuration route in this plan. Changing the picker takes effect when the user next sends a message.
- **Spec**: `docs/specs/pi-durable-session-runtime.md` lines ~378–402 (model selection, prepared requests keep their configuration) and ~641–645 (configuration through the runtime owner lane, intent IDs, no D1 selection authority)

## Amendment 1 (2026-10-24, after the first execution stopped at Step 4)

Confirmed by the reviewer: `ownerTransition` (`pi-durable-host.ts` ~1764) chains onto a single `ownerQueue` and is not re-entrant. `consumeCandidate` (~5709) already runs the ordered-submission block inside it, so calling `configureOwned` there deadlocks. Replace Step 4's first bullet with:

- Extract the body of the `ownerTransition` callback in `configureOwned` into `private async applyConfigurationIntent(intent: ConfigurationIntentV1, query: ConfigurationReadV1, context: Context): Promise<ConfigurationAckV1>`, moving it verbatim, the `deny` helper included. `configureOwned` keeps its parsing, timeout, `dependencies.configuration` check and `ownerTransition` wrapper, and calls the new method inside it. This is a pure extraction. Existing configuration tests must pass unchanged before you go on.
- In the ordered-submission block (already inside the lane), set `this.dependencies.configuration = await scope.configuration(record.command.commandId)` exactly as `configureCandidate` does. Then call `applyConfigurationIntent` directly with the intent from Step 4, under the same `SYNTHETIC_MODEL_LIMITS.deadlineMs` timeout `configureOwned` uses. Don't call `configureOwned` or `ownerTransition` there.
- Before any other Step 4 work, verify: `pnpm runtime:verify` and the credential fixture command pass after the extraction alone.

Migration (superseded 2026-10-24 by the maintainer's rule that migrations are never hand-edited): the hand-trimmed 0027 was discarded. 0022–0026 had no Drizzle snapshots, so `drizzle-kit generate` diffed against 0021 and re-created existing tables. The repair: Drizzle generated a snapshot of `schema.ts` as of `b0db0f2` (prevId = 0021's id), installed unmodified as `meta/0026_snapshot.json` with no SQL or journal change. A normal `pnpm db:generate --name=candidate_command_selection` then produced `0027_candidate_command_selection.sql` (`ALTER TABLE session_commands ADD selection text;`) and its snapshot, and a second generate reports no changes. Known drift, not fixed here: `schema.ts` lacks `candidate_capacity_claims` and several CHECK constraints that 0022–0026 create. Any future plan touching the schema must generate with `pnpm db:generate` and STOP if the output re-creates existing objects.

Then finish Step 3's three worker tests, then Steps 4 and 5.

## Why this matters

The product never applies a model choice. `PiDurableHost.configureCandidate(commandId, input)` (`apps/runtime/src/pi-durable-host.ts` ~5655) is the only path that sets a candidate's configuration, and only a fixture test hook calls it (`apps/credential-tests/src/model-entry.ts:599`, `configureFixture`). Every product turn runs on the default `{ model: "faux-1", thinking: "off" }` (`apps/runtime/src/pi-durable-product-session.ts` ~266). Plan 018's model picker needs a way to deliver the user's choice.

## Current state

- Browser command contract, `packages/runtime-contracts/src/product-command.ts`:
  ```ts
  type BrowserBaseV2 = { version: 2; idempotencyKey: string; projectId: string };
  export type BrowserCommandV2 =
  	| (BrowserBaseV2 & { kind: "prompt"; sessionId?: string; text: string })
  	| (BrowserBaseV2 & { kind: "follow_up"; sessionId: string; targetRunId: string; text: string })
  	| ...
  type MessagesV2 = { userMessageId: string; assistantMessageId: string; text: string };
  ```
  `parseBrowserCommandV2` and `parseCommandV2` use `strictRecord` with explicit key lists (~lines 210–217), so a new optional key must be added to both key lists.
- Selection type: `ConfigurationSelectionV1 = { model: SyntheticModelId; thinking: SyntheticThinking }` with `parseConfigurationSelectionV1` in `packages/runtime-contracts/src/configuration.ts`.
- Admission, `apps/web/src/lib/session-command-candidate.ts` `admit` (~line 330+). For prompts and follow-ups it checks the credential, then:
  ```ts
  const selection = subject ? await this.runtime.readSelection(subject) : null;
  readiness = await this.policy.preSessionReadiness(userId, input.projectId,
  	selection ?? { model: "faux-1", thinking: "off" }, ...);
  ```
  The idempotency hash is `digest(canonical(input))`, so a selection in the body is covered by changed-payload conflict detection automatically.
- D1 storage: `session_commands` (`apps/web/src/db/schema.ts` ~653) has no selection column. `CandidateProductCommands.reconstruct` (~line 1550) rebuilds `CommandV2` from that row. The latest migration is `apps/web/migrations/0026_candidate_lifecycle.sql`; drizzle metadata is in `apps/web/migrations/meta/`.
- Host intake: `acceptCandidate` (`pi-durable-host.ts` ~4527) stores prompts and follow-ups in arrival order, which can differ from sequence order (the existing test delivers command 3 before command 1).
- Ordered submission: around `pi-durable-host.ts` ~5820, the host picks `host_product_commands` at `next = this.repairProductCursor()` and submits it once all prior commands are disposed. **This is the only place where "the next prompt in sequence" is known.**
- Configuration application: `configureCandidate` sets `this.dependencies.configuration = await scope.configuration(commandId)` and calls `configureOwned(input)` (~1985). That path opens its own `ownerTransition`.
- Existing behavior test to model after: `apps/credential-tests/src/product-commands.worker.test.ts`, test "queued configuration uses the next selection across a sequence gap and preserves committed preparation" (~1520–1610). It shows that a prepared request keeps `faux-1` while a later command uses `faux-2`.

Conventions: tabs; `unknown` until parsed; contracts get a parser and a `*.test.ts`; stable error codes only. Per the spec, D1 stores no selection *authority*. The new column is the user's requested selection, and the host's Pi state stays the authority.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | exit 0 |
| Contracts | `pnpm contracts:verify` | pass |
| Web typecheck / tests | `pnpm typecheck` / `pnpm test` | pass |
| Runtime | `pnpm runtime:verify` | pass |
| Credential fixture | `pnpm --filter @ditto/credential-tests typecheck && pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts` | pass |
| Migration generation | `pnpm --filter @ditto/web exec drizzle-kit generate` (check `apps/web/package.json` for the repo's script name first and use that) | a new `0027_*.sql` |

## Scope

**In scope**: `packages/runtime-contracts/src/product-command.ts` (+ test); `apps/web/src/db/schema.ts`; one new migration `apps/web/migrations/0027_*.sql` plus its `meta` files; `apps/web/src/lib/session-command-candidate.ts`; `apps/runtime/src/pi-durable-host.ts`; `apps/credential-tests/src/product-commands.worker.test.ts`; `apps/credential-tests/src/model-entry.ts` only if a fixture method must change; `plans/evidence/022-selection-with-prompt.md` (create).

**Out of scope**: UI components; a standalone configuration route; `trusted_v1` or legacy paths; real Codex models; changing what a prepared request retains.

## Steps

### Step 1: Baseline
Run contracts, typecheck, `pnpm test`, `pnpm runtime:verify` and the credential fixture command. Record the results in the evidence file.
**Verify**: pass, or record failures by test name before any edit.

### Step 2: Contract
Add optional `selection?: ConfigurationSelectionV1` to the `prompt` and `follow_up` variants of `BrowserCommandV2` and `CommandV2`. Parse it with `parseConfigurationSelectionV1` when present; it's absent when omitted. Never emit `selection: undefined`, because canonical hashing must match a body without the key.
Tests: round trip with and without the key; an unknown model or thinking value is rejected with a `ContractParseError`; the key is rejected on `stop`, `cancel`, `archive_session` and restore.
**Verify**: `pnpm contracts:verify` passes.

### Step 3: Admission and storage
- Migration 0027: add nullable `selection TEXT` to `session_commands`, plus the matching drizzle schema column. Generate it with the repo's drizzle script. Don't hand-write meta files.
- In `admit`, when `input.selection` is present, use it in place of `readSelection(...)` in the `preSessionReadiness` call, so entitlement is checked against the requested model and thinking level. An unentitled selection must be refused through the existing readiness path's code (`model_unconfigured` or whatever readiness returns). Don't invent a new code unless readiness gives none. If so, STOP.
- Store `JSON.stringify(selection)` in the new column on insert. `reconstruct` puts it back into `CommandV2.selection` with `parseConfigurationSelectionV1`.
Tests in `product-commands.worker.test.ts`: a prompt with an entitled selection is admitted and its reconstructed command carries the selection; an unentitled selection is refused with no command row; the same idempotency key with a different selection is a conflict.
**Verify**: the credential fixture command passes.

### Step 4: Apply at ordered submission
In the host block near ~5820, when the selected next record is a prompt or follow-up whose `command.selection` is set and has not been applied yet, apply it before submission. Use the same configuration dependency `configureCandidate` builds (`scope.configuration(commandId)`) with intent:
```ts
{ version: 1, intentId: command.commandId, projectId: command.projectId,
  workspaceSessionId: command.workspaceSessionId, ownerVersion: command.runtimeOwnerVersion,
  selection: command.selection }
```
Using the command ID as `intentId` makes reopen and duplicate handling reuse the configuration ledger's retained outcome, so a selection is never applied twice.
- `configureOwned` opens its own `ownerTransition`. **If that block already runs inside an owner transition and calling `configureOwned` there would nest, deadlock or need restructuring of the ordering lane, STOP and report the exact call chain.** Don't restructure the lane on your own.
- If the ack is `denied`, `conflict`, `unavailable` or `outcome_unknown`, don't submit the prompt on a different model. Dispose the command through the existing failure/disposition path with a stable reason. If no existing disposition fits, STOP.
- A prepared request (compaction/summary) keeps its own configuration. Don't touch preparation code.
Tests (model after the "queued configuration…" test):
1. Prompt A with `faux-2` is delivered after B (out of order); A's request uses `faux-2`.
2. A later prompt without a selection keeps `faux-2`.
3. Reopen between apply and submission doesn't apply twice; the final request still uses `faux-2`.
4. A committed preparation still uses its original model.
5. A selection that becomes unentitled before submission disposes the command, and no model request is made.
**Verify**: `pnpm runtime:verify` and the credential fixture command pass.

### Step 5: Gates and evidence
Run `pnpm check`, `pnpm typecheck`, `pnpm contracts:verify`, `pnpm runtime:verify`, `pnpm credentials:verify`, `pnpm test`, `pnpm build`. Write `plans/evidence/022-selection-with-prompt.md`: the contract change, the migration, where the selection is applied, the failure dispositions, test names, gate results and any STOP. The 018 executor reads this file.
**Verify**: all pass. A combined `credentials:verify` failure counts only as the known WSL flake when the failing test is untouched and each file passes alone. Record it either way.

## Done criteria
- [ ] `BrowserCommandV2`/`CommandV2` prompt and follow-up accept an optional, parsed `selection`
- [ ] Migration 0027 adds nullable `session_commands.selection`; schema matches
- [ ] Admission checks entitlement against the requested selection
- [ ] The host applies the selection in sequence order with `intentId = commandId`; the five Step 4 tests pass
- [ ] No component files changed; `git status` shows only in-scope files
- [ ] Evidence file written; gates pass or are recorded

## STOP conditions
- Drift in the excerpted code.
- Step 4 nesting or ordering-lane restructuring would be needed.
- No existing disposition or readiness code fits a refusal.
- Any change that seems to need a UI component, a deployment, a real Codex request, or a change to prepared-request retention.
- A touched or added test fails twice after a reasonable fix.

## Maintenance notes
- 018 sends `selection` on a prompt or follow-up only when the user changed the picker since the last send. It reads the current selection from `/api/agent/models`.
- A standalone configuration route (spec ~641) remains possible later. It would reuse the same `intentId` ledger, and its intent IDs must not collide with command IDs.
- `session_commands.selection` is request data. Don't read it as current configuration; `readSelection` is the source.
