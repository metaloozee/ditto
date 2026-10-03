# 009: Complete guarded remote coding tools

Status: BLOCKED on 008. Base: `bcce03e`. Phase: L3.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 3, 6, 8–9, 12–13, 17; PD11–PD14, PD28–PD31; OD2, OD5–OD6.

## Outcome and scope

Preserve Ditto's actual read, write, edit, bash, grep, find and `ls` behavior, where `ls` is the existing list tool name through one guarded workspace execution interface. Every repository action occurs in the untrusted execution sandbox. No remote failure falls back to Worker/host files or processes.

The runtime grants admission and serializes mutation. Execution validates the exact typed operation/generation and reports known completion, known pre-dispatch rejection, pending reconciliation or unknown effect. It cannot invent authority or replay policy. Start with sequential Pi tools and preserve serialization against upcoming Git, checkpoint, restore and preview operations.

## Current state

`packages/sandbox-runner/package.json` still depends on Pi coding-agent 0.85.1. `packages/runtime-contracts/src/runtime.ts` has an old effect policy:

```ts
outcomePolicy: "retry_safe" | "reconcile" | "never_retry";
state: "prepared" | "admitted" | "result_recorded" | "outcome_unknown";
```

Those states can express policy but are not a typed tool protocol. `apps/runtime/src/session-runtime.ts` owns effect decisions; tools must not write its tables directly. Upstream stock Pi Durable CodingTools lacks grep/find/ls and does not establish image parity. Preserve public tool names; a rename is a product change, not a porting detail.

Allowed: runtime tool registry/execution adapter, execution-only runner handlers/protocol, bounded shared contracts, tests and Docker image inputs if needed. Preserve locked resource discovery and Git credential rules. No new engine in the execution image, Codemode, arbitrary Worker eval, repository-selected extensions, broad tool framework or SDK migration. Retain old runner entrypoints only for separately owned legacy sessions until L6.

## Steps

1. Read `packages/sandbox-runner/src/run-agent.ts`, `locked-resource-loader.ts`, tool/protocol tests and the exact pinned Durable tool contract. Inventory current argument, output, truncation, path, error, attachment and image behavior. Record gaps explicitly in `plans/evidence/009-tool-parity.md`. Disabled Git/project-value paths prove only denial, not full PD30/PD31 support; those rows stay partial until 014/015. Choose bounded typed variants for actual supported actions; unsupported attachments must reject explicitly rather than disappear. Any product parity change needs approval, not an invented equivalence claim.
   Baseline: `npm test --prefix packages/sandbox-runner -- src/run-agent.test.ts src/locked-resource-loader.test.ts src/protocol.test.ts`.
2. Implement remote handlers and deployment-owned Pi tools through the existing admitted execution interface. Validate operation identity, epoch, lifecycle and executor generation immediately before dispatch after asynchronous preparation. Return bounded/redacted product output separately from encrypted canonical tool results. Project values and privileged Git remain disabled until their slice-specific policy is implemented, not passed as ambient environment.
   Add `apps/runtime/src/pi-durable-tools.test.ts`; run `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-tools.test.ts src/pi-durable-effects.test.ts`.
3. Preserve exact outcome classification across transport faults. Persist results or verified encrypted references before Pi advances. Test completed result duplicates, conflicting results, response loss before/after dispatch, interrupted process, expired operation and executor replacement. Expected-content structured writes must reject stale content. Shell dispatch ambiguity blocks automatic execution across two restarts.
   Same command through authenticated prompt fixtures where practical, focused execution contracts where needed. Test genuine file results in the disposable local Docker fixture, not only stub call counts.
4. Attack discovery and fallback paths with repository files named like settings, tools, extensions, skills, prompts, themes, MCP definitions and executable context. They must never load as trusted code/configuration. Make remote read/write fail and assert no host file access. Deny execution/builder model/control/storage privilege and retain credential-free egress policy.
   Run the tool tests, `pnpm --filter @ditto/runtime exec vitest run src/forbidden-import-graph.test.ts`, and runner protocol/resource-loader tests.
5. Run `pnpm runner:verify`, `pnpm runtime:verify`, `pnpm contracts:verify` for changed contracts, `pnpm verify` and retained brain checks when needed. Save exact local Docker command and outcomes with versions. Keep hosted process termination/egress evidence separate.

## Acceptance and maintenance

All inventoried supported tools behave through the runtime owner; no mutation bypass, credential leak or trusted-host fallback exists. Unknown outcomes and persistence failures block subsequent provider and execution calls. Retained workspaces remain disabled until initial pair evidence in 012.

Refresh this conditional plan from actual L3 interfaces before coding. Stop if tool parity requires trusted repository execution or if a transport result cannot be classified safely. No reset, live model request, deployment, staging or commit. New tools must declare bounds, replay/evidence policy and typed arguments before they enter the registry.
