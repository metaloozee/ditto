# 025: Compose execution, recovery and workspace actions for candidate sessions

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. On a STOP condition, stop and report; do not improvise. Do not stage or commit. A reviewer maintains `plans/README.md`; do not edit it or this file. No deployment, no `alchemy deploy`, no Cloudflare API call, no live provider request and no data reset is authorized by this plan.
>
> **Drift check (run first)**: `git diff --stat 0f9c7c1..HEAD -- apps/runtime/src alchemy.run.ts apps/web/src/server.ts apps/web/src/lib/project-seed.ts packages/runtime-contracts/src Dockerfile`. If any of these changed, compare the excerpts below against live code. A mismatch is a STOP condition.

## Status

- **Status**: TODO, READY after maintainer approval of the open questions below
- **Priority**: P1 (019 is blocked on it; README open decision 5)
- **Effort**: L. Split into 025a (executor and recovery, Steps 1 to 4) and 025b (workspace actions and retention store, Steps 5 to 6) if Step 1 shows the adapters need more than wiring
- **Risk**: HIGH (first composition that gives a candidate session a real sandbox and a real artifact store)
- **Depends on**: 011 to 018, 021, 022. Not on 023 or 024
- **Category**: composition / L6 prerequisite
- **Spec**: `docs/specs/pi-durable-session-runtime.md` decisions on one runtime DO and one execution sandbox per workspace session, paired checkpoints, preview quiescence and capacity; PD20 to PD25, PD28 to PD31
- **Planned at**: commit `0f9c7c1`, 2026-10-24

## Why this matters

Every runtime module from 009 to 017 is proved only in fixtures that compose `PiDurableHost` directly (`apps/runtime/src/pi-durable-checkpoint.fixture.ts`). The product's own Durable Object, `PiDurableProductSession`, supplies none of them:

- `remoteExecutor()`, `checkpointRestorer()` and `workspaceController()` return `undefined` (`apps/runtime/src/pi-durable-product-session.ts` ~131 to 146).
- Because `remoteExecutor()` is `undefined`, `open()` passes no `checkpoints` dependency at all (~227 to 245). So the session also has no publisher, no restorer, no workspace controller and no retention store (`pi-durable-host.ts` ~730 creates retention only when `checkpoints` is present).
- `alchemy.run.ts` binds no candidate session namespace, no recovery bucket and no candidate product entrypoint for the website. The web side reaches candidate sessions only through the optional `PI_DURABLE_PRODUCT_COMMANDS` service (`apps/web/types/env.d.ts`, `apps/web/src/server.ts` ~160), which only the credential tests provide.
- Every candidate entrypoint refuses unless `CANDIDATE_DISPOSABLE === "008-synthetic"` (`scope()` and `passiveScope()`).

As a result a candidate session fails every tool before admission, cannot publish a baseline, cannot restore and answers every Git and preview action `unavailable`. 019 cannot retire the Node engine while that is true.

## Current state

Adapters that already exist and are tested in isolation:

| Port | Adapter | Location | Test |
|---|---|---|---|
| `RemoteExecutor` | `sandboxExecutor(sandbox, { workspaceSessionId })`, calls `ditto-exec` in the image | `apps/runtime/src/pi-durable-tools.ts` ~413 | `pi-durable-tools.test.ts` |
| `ArtifactExecution` | `sandboxArtifactExecution(sandbox, now)`, calls `ditto-archive`; `fetchBranch` throws "Brokered branch fetch is not composed in the runtime" | `apps/runtime/src/pi-durable-artifacts.ts` ~895, ~953 | `pi-durable-artifacts.test.ts` |
| `ArtifactStore` | `r2ArtifactStore(bucket)` | `apps/runtime/src/pi-durable-artifacts.ts` ~964 | `pi-durable-checkpoints.test.ts`, `RECOVERY_ARTIFACTS` miniflare bucket |
| Publisher and restorer | `createCheckpointPublisher({ storage, host, binding, execution, store, branch?, writers?, now })` | `apps/runtime/src/pi-durable-checkpoints.ts` ~548 | `pi-durable-checkpoints.test.ts`, `pi-durable-restore.test.ts` |
| `WorkspaceController` | `createWorkspaceController({ storage, host, execution, publisher, branch, now })` | `apps/runtime/src/pi-durable-workspace.ts` ~75 | `pi-durable-workspace-actions.test.ts` |
| `WorkspaceExecution` | **none outside the fixture** (`fakeWorkspace`, checkpoint fixture ~260) | `apps/runtime/src/pi-durable-workspace.ts` ~32 | none |

The fixture's composition at `pi-durable-checkpoint.fixture.ts` ~410 to 465 is the reference shape: one publisher for the restorer, one publisher plus controller for the workspace, `writers` taken from the controller, and `store` exposed for retention.

The production image (`Dockerfile` ~28 to 30) already links `ditto-runner`, `ditto-archive` and `ditto-exec`.

## Open questions for the maintainer (answer before Step 2)

1. **Disposable gate.** Recommended: keep `CANDIDATE_DISPOSABLE === "008-synthetic"` and compose behind it, so only disposable synthetic workspaces run on the candidate path. Lifting it is retained enablement and belongs to a later, separately approved step.
2. **Sandbox identity.** Recommended: one Sandbox container instance per candidate workspace session, named from `workspaceSessionId`, separate from the legacy per-project sandbox. This matches the spec's one execution sandbox per workspace session. It needs a candidate-only capacity identity in the 015 claim ledger.
3. **Branch fetch and push.** Recommended: leave brokered branch fetch and push unavailable in this plan. Sync, Push and Open PR stay disabled in the product (018 already shows "Not available for this session yet.").
4. **Preview.** Recommended: compose `previewStart` and `previewStop` but keep the product preview pane on the legacy path until the 024 decision and its build plan land.

## Scope

In scope: a production subclass or composition of `PiDurableProductSession` that supplies the executor, restorer, workspace controller and retention store; one new `WorkspaceExecution` sandbox adapter; the initial baseline from the project seed; Alchemy bindings for the local Pi Durable fixture stage; tests through existing seams.

Out of scope: deployment, lifting the disposable gate, brokered Git, push, preview URL delivery (024), continuation baselines (016 limit), multi-workspace enablement beyond the 015 limits, UI changes, legacy source retirement (019).

## Steps

1. **Read and confirm the seams.** Read the files in the table above, `PiDurableHost.open` and the fixture composition. Confirm each signature in this plan against live code. Record in evidence which adapter needs only wiring and which needs new code. If `sandboxExecutor` or `sandboxArtifactExecution` needs a different sandbox shape than `@cloudflare/sandbox` 0.12.3 provides, STOP and report the mismatch.
2. **Choose the composition point.** Add the composition as overrides in a new class, for example `PiDurableExecutionSession extends PiDurableProductSession`, in a new file under `apps/runtime/src/`. Keep `PiDurableProductSession` itself unchanged except where an override hook is missing. The new class reads a sandbox namespace and a recovery bucket from its bindings. Add those to `CandidateSessionBindings` as optional fields, so the credential fixture keeps compiling.
3. **Compose the executor.** `remoteExecutor()` returns `sandboxExecutor(getSandbox(env.<sandbox>, workspaceSessionId), { workspaceSessionId })`, created once per host open. Before any container starts, the session must hold a 015 execution claim; reuse the product's existing claim path, do not add a second ledger. If the claim API cannot be called from the runtime side without a new contract, STOP and report.
4. **Compose recovery.** Build one `createCheckpointPublisher` per host open with `execution: sandboxArtifactExecution(...)`, `store: r2ArtifactStore(env.<bucket>)` and no `branch`. Return it from `checkpointRestorer(port)`. Expose the store through the `checkpoints.store` dependency so retention runs. Establish the initial baseline from the project seed archive with `establishBaseline({ seed, branch })`. Find where the seed's `ArchiveArtifactV1` is produced (`apps/web/src/lib/project-seed.ts`) and how it reaches the runtime. If no product path hands the seed to the session today, STOP and report with a proposed contract instead of inventing one.
5. **Write and compose `WorkspaceExecution`.** Implement `present`, `gitStatus`, `gitCommit`, `previewStart` and `previewStop` against the sandbox. Reuse runner helpers where they already exist (`packages/sandbox-runner/src/ditto-git-action.ts`, `git-metadata-cli.ts`) through a fixed CLI subcommand, not shell strings built from user input. `gitCommit` must stay credential-free with hooks disabled and the owned branch only, as the interface comment says. `previewStop` returns `terminated: true` only with evidence that the process and its children are gone. Compose `createWorkspaceController` with a second publisher, as in the fixture, and pass the controller's `writers` to both publishers.
6. **Bind it locally.** In the `DITTO_LOCAL_PI_DURABLE=1` branch of `alchemy.run.ts`, bind the new session class, the sandbox container and a local recovery bucket. Do not change the stage `dev` resources. Do not run deploy.
7. **Tests.** Add focused tests under `apps/runtime/src/` that open the composed session against the miniflare `RECOVERY_ARTIFACTS` bucket and a Sandbox stub: a tool dispatch reaches the executor after a baseline exists; no tool runs before the baseline; a restore round trip uses the R2 store; `git_status` and `git_commit` return real results; preview start and stop reach the adapter; retention deletes an orphaned object after its period. Then run the existing Docker gate for the image with the new `WorkspaceExecution` subcommand.

## Checks

```sh
pnpm --filter @ditto/runtime exec vitest run <new test files>
pnpm --filter @ditto/runtime exec vitest run src/pi-durable-checkpoints.test.ts src/pi-durable-restore.test.ts src/pi-durable-workspace-actions.test.ts src/pi-durable-retention.test.ts src/pi-durable-tools.test.ts
pnpm runtime:verify
pnpm credentials:verify
pnpm typecheck
npm test --prefix packages/sandbox-runner
pnpm runtime:local:verify
```

Expected: exit 0 for each, apart from the known `runtime:verify` storage timeout, which plan 026 owns. Record it if it appears; do not count it as a new failure. Missing Docker or Alchemy prerequisites are `not run` and block acceptance of Step 7.

Write results to `plans/evidence/025-execution-composition.md` in the README's evidence format.

## Stop conditions

- An adapter needs a contract change in `packages/runtime-contracts`.
- The seed archive has no product path to the session (Step 4).
- The execution claim cannot be taken before the container starts (Step 3).
- Any change would lift the disposable gate, enable push or brokered fetch, or touch stage `dev` resources.
- A test needs a raised deadline, a skip or a retry to pass.

## Done

The composed session runs tools, publishes and restores pairs, answers Git status and commit and preview start and stop, and runs retention, all in local fixtures with a real R2 binding and the real image. The disposable gate is unchanged. 019's "deployed execution composition" dependency can then be rechecked against this evidence.

## Maintenance

The fixture composition and the production composition now duplicate the wiring shape. If either changes, update both, or move the shared wiring into one function used by both. Keep `fetchBranch` unavailable until a brokered Git plan exists.
