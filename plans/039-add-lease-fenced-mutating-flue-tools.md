# 039 - Add Lease-Fenced Mutating Flue Tools

## Summary

- Priority: P1
- Effort: L
- Risk: High
- Category: architecture / agent runtime / security
- PRD phase: Phase 3, step 2
- Depends on: 035, 036, 037, 038
- Planned at: `c7cdcba`
- Status: TODO

After the coordinator becomes the mutating authority, the next PRD step is to move mutating project work into Flue while enforcing a lease before every filesystem or command mutation. This plan adds the first mutating Flue path and deliberately keeps the legacy broker available until the Flue path passes smoke tests.

## Hard Constraint

Do not rely on prompt instructions as the safety boundary. Every mutating tool must validate the current coordinator lease using `runId` and `fencingToken` immediately before it mutates `/workspace`.

There is one architecture question to prove before implementation: how the Flue Worker can receive per-product-run context (`projectId`, `sessionId`, `runId`, `fencingToken`, mutating/read-only mode) and expose mutating tools only for that run. The installed Flue direct route accepts a prompt body, but global tools in `.flue/agents/project-coder.ts` do not automatically know Ditto's product run id or coordinator fencing token. Solve this with an application-owned Flue ingress or a Flue workflow/session pattern before adding write tools.

## Evidence

- `src/lib/project-coordinator.ts` returns `fencingToken` for mutating admission.
- `src/lib/project-agent-run-contract.ts` already models `capabilities` and optional `fencingToken`.
- `.flue/agents/project-coder.ts` currently exposes exactly read-only tools.
- `src/lib/flue-run-bridge.ts` rejects `isMutating !== false`.
- `src/integrations/trpc/routers/workspace.ts` keeps mutating runs on `WorkspaceSessionBroker`.
- The PRD requires mutating tools to be lease-fenced, bounded, cancellable, and reflected as diff/artifact events.

## Goal

Implement the first Flue-backed mutating run path with lease-fenced tools, bounded commands, diff/status projection, and cancellation/late-event protection.

## Non-Goals

- Do not delete the legacy `WorkspaceSessionBroker` path in this plan.
- Do not implement full R2 snapshot checkpointing; that is Phase 4.
- Do not implement GitHub PR/export flows.
- Do not add a general shell. Mutating commands must be allowlisted.
- Do not expose mutating tools to read-only runs.

## Design Spike First

Before editing broad runtime code, prove the Flue context-injection shape in the smallest possible change.

Evaluate these options in order:

1. Application-owned Flue ingress route.
   - Add or update `.flue/app.ts`.
   - Define a private route such as `POST /ditto/project-runs/start`.
   - The website `FlueRunBridge` calls this route through the private `FLUE_WORKER` service binding with run context and message.
   - The route starts the project-coder agent/session with operation-scoped tools that close over `{ projectId, sessionId, runId, fencingToken }`.

2. Flue workflow wrapper.
   - If the app route cannot inject operation-scoped tools into a continuing agent session, create a bounded workflow wrapper that opens the correct agent/session and calls `session.prompt(message, { tools })`.
   - This may be acceptable as an interim implementation, but document the tradeoff: workflow runs are bounded jobs, while the PRD wants Flue agents as the canonical conversation runtime.

3. Direct agent route with context in message body.
   - Use this only if the installed Flue route API explicitly exposes the dispatch body to `createAgent(...)`, tool factories, or agent runtime context in a typed and tested way.
   - Do not parse hidden JSON out of the user prompt.

STOP if none of these can inject call-scoped tool context safely. In that case, write a short architecture decision note under `docs/decisions/` and mark this plan blocked rather than faking a lease boundary.

## Implementation Steps

1. Add coordinator status/lease validation support if missing.
   - Ensure `ProjectCoordinator` exposes enough state through `GET /status` or a small internal route to validate:
     - active mutating `runId`
     - `fencingToken`
     - project id
   - Add pure tests for stale run id, stale fencing token, and canceled/completed run.

2. Bind required app services into the Flue Worker.
   - Update `alchemy.run.ts` so the private `flueWorker` has only the bindings required by mutating tools:
     - `Sandbox`
     - `ProjectCoordinator`
     - any existing Flue bindings
   - Add `DB` or `BACKUP_BUCKET` only if this plan truly writes D1 events or artifacts from the Flue Worker. Prefer having `FlueRunBridge` project Flue events to D1 as it does today.

3. Extend `FlueRunBridge` start handling.
   - Accept `isMutating: true` only after admission has provided `fencingToken`.
   - Preserve read-only behavior from Phase 2.
   - Dispatch mutating starts through the chosen app-owned Flue ingress, not the public direct read-only route unless the design spike proves safe context injection.
   - Store `flueAgentName`, `flueAgentInstanceId`, `flueStreamOffset`, and the mutating capability in DO state and D1.
   - Continue to gate canceled and late events by active run id.

4. Route mutating `workspace.startRun` into Flue.
   - After plan 038 coordinator admission succeeds, call `FlueRunBridge /start` with:
     - `isMutating: true`
     - `runId`
     - `projectId`
     - `sessionId`
     - `sandboxId`
     - `message`
     - `modelSpecifier`
     - `fencingToken`
   - Keep a feature flag or narrow branch fallback to the legacy broker if the Flue mutating dispatch fails before admission starts execution.

5. Add mutating tools.
   - Add tools only in the mutating context, or make each tool require validated context before it appears usable.
   - Initial tool set:
     - `write_file` or `replace_file`
     - `apply_patch` or `replace_text`
     - `run_mutating_command`
     - `git_diff`
     - `git_status`
   - Before every mutation:
     - call coordinator status
     - verify active mutating run id matches
     - verify fencing token matches
     - verify the project id matches
     - reject if canceled/terminal
   - Apply the path traversal guard from the read-only tools to every filesystem path.
   - Keep command allowlist narrow. Acceptable first commands are project-local install/test/build commands already present in `package.json`, plus formatter commands if needed. Do not allow arbitrary shell strings.

6. Project diff/status artifacts.
   - After a mutating tool changes the workspace, emit tool output that includes redacted `git status --short` and a bounded `git diff --stat`.
   - On terminal success or failure, have the bridge insert a `tool` or dedicated event that records final changed-file summary.
   - If R2 artifact writing is small and obvious, write a full diff artifact under the existing `r2-layout` helper and insert a `run_artifacts` row only after the R2 write succeeds.
   - If R2 writing expands scope, defer full R2 artifacts to Phase 4 and persist only bounded D1 events in this plan.

7. Cancellation.
   - Ensure `/abort` marks the run canceled and causes subsequent mutating tool lease checks to fail.
   - Ensure late Flue events after cancellation do not clear the coordinator lease for a newer run.

8. Tests.
   - Add pure tests for lease validation:
     - missing token rejected
     - stale token rejected
     - wrong run id rejected
     - canceled/terminal run rejected
   - Add tool policy tests:
     - read-only mode has no mutating tools
     - path traversal rejected
     - non-allowlisted command rejected
     - mutation calls coordinator before executing
   - Extend bridge/router tests for mutating Flue dispatch and cancellation.

## Tests

Run:

```sh
pnpm test -- src/lib/project-coordinator.test.ts src/lib/flue-run-bridge.test.ts src/lib/flue-dispatch-adapter.test.ts
pnpm flue:build
pnpm exec tsc --noEmit --pretty false
pnpm lint
pnpm test
git diff --check
```

Manual smoke before merge:

```sh
pnpm dev
```

Then start one mutating run from the UI/API, confirm a file edit happens in `/workspace`, confirm a concurrent mutating run is rejected, cancel a run mid-flight, and confirm a later mutation attempt with the canceled token is rejected.

## STOP Conditions

- Stop if Flue cannot provide call-scoped tool context without exposing mutating tools globally or embedding hidden JSON in the user prompt.
- Stop if a mutating tool can run without a fresh coordinator lease check.
- Stop if read-only runs can see or invoke mutating tools.
- Stop if cancellation does not invalidate subsequent mutating tool calls.
- Stop if R2 artifact persistence becomes large enough to obscure the lease-fencing implementation; defer full artifacts to Phase 4 instead.

## Acceptance Criteria

- Mutating runs can execute through Flue behind the private service binding.
- Every mutating tool validates `runId` and `fencingToken` with `ProjectCoordinator` before mutating.
- Read-only runs have no mutating tools.
- Canceled or stale runs cannot mutate.
- Final run output includes a bounded changed-file/diff summary.
- Legacy broker path remains available until Flue mutating smoke passes.
- Verification commands and manual smoke pass.
