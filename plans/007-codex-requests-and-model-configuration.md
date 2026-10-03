# 007: Guard Codex requests and conversation model changes

Status: BLOCKED on 006 and passed L2. Base: `bcce03e`. Phase: L3.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 3, 5–6, 8–9, 12; PD01, PD13, PD15, PD28, PD38, PD41–PD42; OD1, OD5–OD7.

## Outcome and owner

Privileged access performs exact authorized subscription-backed requests. The runtime owns per-conversation model/thinking configuration and effect admission; Pi's default prepared-request semantics determine when a change applies. D1 may project configuration but is not a second authority. No command-wide model pin or model-switch scheduler.

## Current state and scope

`apps/web/src/lib/agent-models.ts` currently fixes the product model:

```ts
export const DEFAULT_PROJECT_CODER_MODEL =
	"opencode/deepseek-v4-flash-free" as const;
```

`packages/runtime-contracts/src/command.ts` fixes thinking to `off`, `high`, `max`. `apps/web/src/lib/session-runtime-client.ts` exposes only `modelConfiguration(): Promise<{ configured: boolean; protocolVersion: number }>` for readiness. These cannot establish account entitlement or independent workspace choices.

Scope: Codex provider request validation/product credential transport, runtime provider adapter/configuration transitions, framework-independent versioned contracts, model policy tests. Preserve legacy fixed-model code only while it serves a separately owned legacy path. Do not globally change old stored V1 payload meanings. UI controls belong to 018, prompt D1 admission to 008.

## Steps and verification

1. Refresh the plan from 006's supported authentication/discovery contract and 001's exact provider API. Define bounded account model/capability results with stable unavailable/revoked outcomes. A generic bundled catalogue is not an entitlement check. If 006 cannot establish a supported discovery/validation method, real discovery returns stable `unavailable`; never probe a guessed model URL. Deterministic fixtures may exercise the contract but cannot populate a live entitled picker. Define a new/versioned authenticated configuration intent and snapshot fields without exposing Pi types. Document how first conversation defaults are validated before creation and how mutable entitlement is rechecked at request admission.
   Run `pnpm --filter @ditto/web exec vitest run src/lib/agent-models.test.ts` and `pnpm contracts:verify` after contract changes. Existing fixed-model assertions need owner-aware replacement, not deletion without coverage.
2. Implement reconstruction of the allowed upstream request in the product credential DO, after narrow product-side validation if useful. Credentials and credential-bearing fetch stay in that DO, never the runtime. Validate exact method, destination/path/port/query, content type/encoding, streaming protocol, complete bounded body, operation type and contract version. Reject duplicate/malformed authority fields, redirects, unexpected authorization/proxy headers and arbitrary destinations. Attach credentials only after fresh ownership, connection, lifecycle, epoch and operation-window checks. Never forward the original unvalidated body/headers.
   Add `apps/web/src/lib/codex-request-contract.test.ts`; run `pnpm --filter @ditto/web exec vitest run src/lib/codex-request-contract.test.ts src/lib/codex-connection.test.ts`. Assert no outbound credential-bearing call for each denial.
3. Enforce one open operation per subject/contract family. Three contract denials close it, halt the affected run and require review. Already admitted work remains tracked. Add a mandatory runtime provider adapter using private product transport, finite deadlines and separate attempt records. Never expose a token or fall back to billed API/public network on denial. Apply the same guard to compaction, retries and Git metadata, whose one reserved attempt is not refunded on failure.
   Add `apps/runtime/src/pi-durable-models.test.ts`; run `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-models.test.ts src/pi-durable-effects.test.ts`.
4. Persist model/thinking choices in the active Pi conversation through runtime configuration intents. Requests already prepared retain original configuration, including after restart. The next prepared request observes the change even inside a running instruction; queued instructions use preparation-time configuration. Invalid or unavailable options reject rather than silently clamp. Separate workspace sessions must not share selections.
   Same command; capture constructed deterministic provider requests during normal turns, follow-ups, compaction, retry, cancellation and mid-run changes. Assert actual bodies, not only a selected-model variable. Crash after preparation but before dispatch, change selection, then reopen. The retained prepared request, including compaction, keeps its original configuration. A newly prepared attempt follows Pi's current configuration. Configuration intents still need payload-conflict idempotency; removing command-wide model pinning must not remove configuration-intent hashing.
5. Save fixture and discovery evidence under `plans/evidence/007-codex-model-policy.md`. Register tests in `pnpm runtime:verify` and repository verification. Run `pnpm verify`, and retained brain checks if shared contracts changed. List PD38 separately as `not run` unless explicitly authorized and completed in 020.

## Acceptance, stops and maintenance

The fixture-backed model contract and configuration timing pass. Missing/revoked connection never authorizes a request. Every model request is linked to a current exact operation; no provider call bypasses effect/storage/Stop guards. History and lifecycle operations needing no model remain usable.

Stop if account-backed discovery/validation cannot be supported, request reconstruction cannot preserve the actual streaming contract, or selected Pi APIs cannot preserve prepared configuration. Do not substitute catalogue results or invent an auth destination. This conditional plan must adopt the passed storage/provider APIs before execution. No reset, deployment, live allowance, staging or commit is authorized.
