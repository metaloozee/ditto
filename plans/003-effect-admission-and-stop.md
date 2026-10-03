# 003: Prove effect safety and Stop

Status: BLOCKED on 002. Base: `bcce03e`. Phase: L1 completion.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 3.3–3.5, 5–9, 12, 17; PD06, PD11–PD16; OD2, OD3, OD5–OD6.

## Outcome and owner

The trusted session runtime alone admits effects and owns run epochs, uncertainty blocks and terminal transitions. Mandatory provider and execution adapters enforce its decision. Do not register an unguarded stock tool/provider alongside them. Pi owns task continuation, not authorization. A hook exception cannot be the only guard.

Use disposable synthetic fixtures only. This plan finishes the L1 safety gate; it does not enable product users or real external effects. No deployment, reset, credentials, live allowance, staging or commit.

## Current code and scope

`apps/runtime/src/journal.ts` already defines policy worth retaining:

```ts
export type EffectState =
	| "prepared"
	| "admitted"
	| "result_recorded"
	| "outcome_unknown";
```

It also fixes `RECOVERY_DEADLINE_MS = 15 * 60 * 1000`. `session-runtime.ts` currently ties prerequisites to both brain and executor identities, and `journal.ts` stores a custom `continuations` table. Neither is the new Pi continuation authority. Candidate admission must not call the old brain prerequisite or require a brain-container role/reservation. Preserve all current ownership, retirement, lifecycle, exact-operation and executor checks under the new direct-DO authority. Internal underscore spellings may remain with an explicit versioned mapping to the spec's state meanings; do not create a second ledger just to change punctuation.

Scope: runtime safety transitions, Pi correlation and mandatory synthetic provider/executor adapters, corresponding contracts and tests. Reuse scenarios from `apps/web/src/lib/session-runtime-journal.test.ts` and `session-runtime-control.test.ts`; rerun them but do not relabel old results as Pi Durable evidence. Keep transport, storage and trusted host responsibilities separate. No generic callback coordinator or raw SQL exposed to tools.

## Steps

1. Inspect 001/002 evidence and current journal/control tests. Define stable correlation among command, user/assistant membership, run, Pi submission/task/tool, logical operation and attempt. Persist validated arguments, epoch, lifecycle generation, expected executor incarnation, finite deadline and replay policy before dispatch. Separate model attempts from one logical command.
   Check: `pnpm --filter @ditto/runtime typecheck` and `pnpm --filter @ditto/web exec vitest run src/lib/session-runtime-journal.test.ts src/lib/session-runtime-control.test.ts`, expected exit 0 or documented unrelated baseline failure.
2. Connect Pi and safety commits using a supported shared transaction if available. Otherwise document an intent/evidence protocol and test both crash orders. Sharing a SQLite database is not proof of atomicity. Result evidence must be durable before Pi can consume it. Make duplicate identical results harmless; conflicting results block review. Persist a fatal admission barrier on storage failure even if Pi catches the thrown error.
   Add `apps/runtime/src/pi-durable-effects.test.ts`; run `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-effects.test.ts`. Assert no next request/tool between result receipt and durable evidence.
3. Admit a shell, lose its result commit, reopen twice, and allow Pi's unsafe-tool recovery to try advancing. Both mandatory adapters must deny every new effect. Fail the run, keep the workspace uncertainty block and retain the old effect. A new ID must not evade it. Read-only repeats need explicit new-observation policy; write/edit replay needs expected-content support; arbitrary shell must never replay automatically.
   Same command. Add faults after completed results, during compaction and follow-up consumption; preserve completed IDs/context and do not repeat mutations.
4. Apply targeted Stop through a priority control independently of sequence gaps/capacity. Include an exhausted-capacity fixture with no available ordinary slot and a missing predecessor, then repeat through the product handler in 008. Commit epoch advancement before cooperative cancellation. Test Stop during async preparation, stale callback after Stop, delayed control against a later run and a shell ignoring cancellation. Keep `stopping` until accounted for, or fail with a persistent block. Replacement writers require trusted termination or isolation; unresolved isolated execution still counts toward capacity.
   Same command, including actual local SQLite reopen. A local receipt is diagnostic, not platform termination evidence.
5. Persist separate finite model-attempt and tool-operation deadlines. Persist first interruption and its 15-minute automatic recovery deadline; this is neither the queue expiry nor an overall agent-run lifetime. Retries do not extend it. At expiry fail remaining pending assistants and revoke admissions, while tracking unresolved execution. Model retry records identify each attempt and possible additional spending. Terminal `complete`, `failed` and `canceled` runs never revive.
   Same command with controlled clock. Run `pnpm runtime:verify`, `pnpm contracts:verify` if contracts changed, and `pnpm verify` for the implementation diff.

## Done, stop and maintenance

Record each crash point and observation under `plans/evidence/003-effect-safety.md`, with exact versions, environment, commands and `passed`/`failed`/`not run`. L1 passes only when both this plan and 002 pass. Test assertions must observe denied I/O and preserved effects, not merely a boolean state.

Stop if a supported adapter cannot prevent Pi continuing after failed persistence/unknown effects, or if safe host ownership needs private changes. Do not add a shadow transcript or replay scheduler. Rebase this conditional plan on the passed host evidence before coding. Future tools, compaction and metadata requests must use the same mandatory guard; none may opt out through a hook or direct fetch.
