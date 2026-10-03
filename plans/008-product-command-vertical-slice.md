# 008: Connect durable product commands to Pi submissions

Status: BLOCKED on 007 and passed L2. Base: `bcce03e`. Phase: L3.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 3–5, 7, 9, 15, 17; PD01–PD10, PD16, PD32–PD33, PD42; OD3, OD5–OD7.

## Outcome and limits

An authenticated prompt receives a durable receipt before execution. D1 owns command/messages/delivery; the runtime owns inbox acceptance, ordered consumption and a stable Pi-submission mapping. Follow-ups retain their own message pairs and enter one at a supported turn boundary. Stop bypasses ordering gaps and capacity.

Keep candidate routing restricted to explicitly disposable synthetic workspaces until the full L4 gate. Unversioned legacy requests must reject candidate-owned identities rather than invoke `executeAgentRun`; candidate requests must not switch an existing legacy owner's transport implicitly. Exercise that denial through both POST handlers and cron delivery. Use fixture Codex access. Do not enable retained mutations, real provider calls or multiple workspaces without bounded admission. 015 completes capacity policy, but cannot be the first admission control.

## Current code and scope

`apps/web/src/lib/session-runtime-client.ts` already keeps product callers narrow:

```ts
export type SessionRuntime = {
	modelConfiguration(): Promise<SessionRuntimeModelConfiguration>;
	deliver(input: SessionRuntimeDeliverInput): Promise<SessionRuntimeHandoffAck>;
	control(input: SessionRuntimeControlInput): Promise<SessionRuntimeHandoffAck>;
	readSnapshot(query: SessionRuntimeSnapshotQuery): Promise<unknown>;
};
```

The default transport is unavailable and trusted admission defaults false. `session-command.ts` and `session-command-delivery.ts` implement D1 admission/outbox behavior. `apps/web/src/lib/session-command.test.ts` uses `createSessionRuntimeFixture()` and `fixture.asUser(...).command(...)`, asserting rows and upstream work. Reuse that primary seam; do not expose Pi task controls for application tests.

Scope: those modules and handlers `api.agent.stream.ts`/`api.agent.control.ts`, runtime private transport/inbox mapping, shared contracts, schema/migration artifacts, product entrypoint composition and command fixtures. Routes import commands/contracts, not Pi, runtime SQL or Sandbox implementations. No legacy importer or competing execution owner.

## Ordered steps

1. Refresh interfaces against 007. Extend readiness checks to owned connection, selected model and thinking capability. Preserve owner+target idempotency, payload conflict checks and atomic first workspace/session, sequence, command, user message, pending assistant and delivery writes. Changed payloads conflict; identical first prompts return original IDs. Do not apply migrations to an existing environment in this task.
   Run `pnpm --filter @ditto/web exec vitest run src/lib/session-command.test.ts src/lib/session-command-delivery.test.ts`, expected exit 0.
2. Replace the candidate's old brain prerequisite with direct-DO authority before wiring transport. `apps/web/src/lib/session-runtime-authority.ts:161–174` currently returns null from `readTrustedExecutionPrerequisites`; `apps/runtime/src/session-runtime.ts:105–113` requires a brain identity/reservation. Define the candidate owner/protocol version and namespace explicitly, without reinterpreting a retained old owner's state or fabricating a brain-container role. Move only shared versioned transport data out of runtime implementation imports into `packages/runtime-contracts`. Wire private service transport at Worker entrypoints. Resolve delivered content/ownership from trusted product records, never the caller's workspace ID. Product callbacks remain bounded and must not re-enter a waiting runtime. Commit inbox acceptance plus wakeup intent before acknowledgment, even for future sequence numbers. Acknowledgment is not consumption or start.
   Add `apps/runtime/src/pi-durable-commands.test.ts`; run `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-commands.test.ts`. Inject lost D1 delivery, lost runtime acknowledgment and out-of-order arrival.
3. Commit ordered consumption and stable command-to-submission mapping before scheduling. Use Pi deduplication as an extra safeguard, not payload validation. Prove crashes on both sides of the mapping/submission handoff. Record the exact supported Pi follow-up boundary in the evidence before scheduling; do not infer it from streaming/task flags. Process durable cancellations in sequence; keep accepted canceled messages visible. Track run-to-message membership across follow-ups and terminal failures.
   Same command plus existing web admission/delivery tests. Assert one logical submission and no silently skipped predecessor.
4. Connect targeted priority Stop using 003's epoch transition. Provide conservative persisted resource admission before execution: retain configurable execution limits, add bounded model/runtime admissions, or keep a hard one-runtime/one-executor fixture cap until 015. Ordinary queue expiry is fixed at acceptance, 15 minutes. It is distinct from 003's recovery deadline measured from first interruption; neither is a whole-run timeout. Resolve start-versus-expiry with the runtime; the dispatcher must not fail a healthy run after a lost start acknowledgment. Revocation/Stop/cleanup acquire no ordinary capacity slot.
   Add lost-handoff/expiry and saturated-capacity Stop cases to the same command tests. Assert accepted instructions stay visible and no unaccounted duplicate claim.
5. Detach the client and restart the product Worker/runtime during follow-up consumption. The host's durable wakeups drive progress. Rejected foreign/archived/deleting/disconnected/invalid-model requests produce no command/provider/sandbox effects. Run `pnpm runtime:verify`, `pnpm contracts:verify`, `pnpm verify` and applicable retained brain verification.

## Done and handoff

Record results under `plans/evidence/008-product-commands.md`. Tests are injected-auth unless they actually use cookies; PD39 belongs to 019. L3 acceptance also needs remote tool parity and settlement/observations in 009/010. Do not label this fixture-backed slice a retained user workspace.

Stop on ambiguous ownership, changed stored command meanings without a version, or a handoff without a crash protocol. Update this conditional plan with actual predecessor outputs before coding. No reset, deployment, live requests, staging or commit. Future intents must share validation, receipts and runtime mutation ownership instead of adding another execution path.
