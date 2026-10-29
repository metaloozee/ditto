# 024: Design how candidate sessions deliver a preview URL (spike)

> **Executor instructions**: This is a read-only design spike. **Don't change any source, test, config or migration file.** The only file you create is `plans/decisions/024-candidate-preview-delivery.md`. Run read-only commands only (reading, `grep`, `git log`, existing tests if useful). Don't deploy, call Cloudflare APIs, or start the fixture stack. When done, report; a reviewer brings the decision to the maintainer.
>
> **Drift check (run first)**: `git diff --stat f025d17..HEAD -- apps/runtime/src/pi-durable-execution.ts apps/runtime/src/pi-durable-execution-session.ts apps/web/src/lib/session-preview.ts apps/web/src/server.ts apps/runtime/src/pi-durable-workspace.ts apps/runtime/src/pi-durable-product-session.ts packages/runtime-contracts/src/workspace-action.ts`. If anything changed, re-read those files before relying on the excerpts.

## Status

- **Status**: DONE, decided 2026-10-29. See `plans/decisions/024-candidate-preview-delivery.md` and build plans 031–033.
- **Priority**: P2 (018 left the candidate preview on the legacy path)
- **Effort**: M (investigation and writing)
- **Risk**: LOW (no code changes)
- **Depends on**: none. A follow-up build plan depends on this decision.
- **Category**: direction (design)
- **Planned at**: commit `69c0867`, 2026-10-24. Refreshed at `f025d17`, 2026-10-28 (025 and 029 changed the composition excerpts and question 5).

## Why this matters

Plan 018 couldn't connect candidate preview start and stop. `WorkspaceActionResultV1` returns `{status:"preview_running", generation}` with no URL, and the preview pane's iframe needs one. The real gap is bigger than a missing field:

- `WorkspaceExecution.previewStart(permit, {port})` returns `void` (`apps/runtime/src/pi-durable-workspace.ts` ~45). Only test fixtures implement it (`apps/runtime/src/pi-durable-checkpoint.fixture.ts` ~285).
- Composition now exists but has no preview. 025 added `PiDurableExecutionSession` (`apps/runtime/src/pi-durable-execution-session.ts:59-118`). When `CandidateSandbox` and `CANDIDATE_RECOVERY` are bound, it composes the executor, restorer and workspace controller. Its `sandboxWorkspaceExecution` (`apps/runtime/src/pi-durable-execution.ts:99-166`) implements Git status and commit, but `previewStart` and `previewStop` throw `ArtifactStepRejected("authority_denied", "Preview is not composed for this session", true)` (`:159-164`). The workspace controller exists only once the session knows its branch (`pi-durable-execution.ts:221-223`), and plan 030 supplies that branch. 029 bound `PiDurableCandidateSandbox` with `enableInternet = false` and `interceptHttps = true` (`pi-durable-execution-session.ts:26-29`), with one outbound handler, `candidateGit`. Nothing in `alchemy.run.ts` binds these classes yet.
- The legacy preview exposes a port on the shared project sandbox with `sandbox.exposePort(port, {hostname})` (`apps/web/src/lib/session-preview.ts` ~815–893). It builds URLs shaped like `<port>-<sandbox>-<token>.<preview zone>` (SDK 0.12.3 note at ~477). The Worker routes them with `proxyToSandbox` before app routing (`apps/web/src/server.ts` ~149–157, `isProductionPreviewHost` ~84).

The spec constrains the answer. From `docs/specs/pi-durable-session-runtime.md` §15 (~715–725):

> Keep the fixed preview command, port 10000, product-origin routing, and authenticated delivery of revocable bearer preview URLs. Cold preview restores a committed pair without starting Pi.
> Preview may defer checkpoint initiation for at most ten minutes after the first unbacked mutation… At expiry, stop preview and deny new mutation admission.
> Archiving requires … revoked preview authority. … Project deletion first … revokes previews …

And from §1 (~152): "The product Worker must not expose an arbitrary public proxy to privileged runtime methods. The runtime Worker must not become a public preview origin."

## Questions the decision must answer

Answer each with evidence (`file:line`) and a recommendation:

1. **Who mints the URL?** The execution sandbox (`exposePort` on the candidate's execution sandbox), the product Worker, or the runtime DO. Recommend one, consistent with "product-origin routing" and with the runtime Worker never being a preview origin.
2. **Routing.** How does a product-origin request reach port 10000 of the candidate's *dedicated* execution sandbox, given that `proxyToSandbox` today resolves the legacy `Sandbox` binding? Name the binding or namespace involved, and whether `proxyToSandbox` can target it or a new narrow route is needed.
3. **Bearer and revocation.** Where is the bearer stored and checked, and how is it revoked on preview stop, on the backup-deadline stop, on archive and on project deletion? Tie it to the `workspace_preview` generation that `pi-durable-workspace.ts` already tracks (`generation = generation + 1` on start). A URL from an older generation must stop working.
4. **Contract change.** Propose the minimal change to `WorkspaceActionResultV1` (for example, `preview_running` carries a product-origin `url`) or a separate owned read. Keep the URL out of observation, D1 history and logs, consistent with §14 ("never log … capability URLs").
5. **Execution composition dependency.** 025 composed execution without preview, and 030 supplies the branch that enables the workspace controller. Can `sandboxWorkspaceExecution.previewStart/previewStop` be implemented and tested against the runtime harness in `apps/runtime/src/pi-durable-execution.test.ts`, which uses a scripted stub sandbox, before deployment bindings exist? Does `exposePort` on `PiDurableCandidateSandbox` work with `enableInternet = false` and `interceptHttps = true`? Say exactly what the deployment wiring (outside this track's plans) must supply.
6. **Local versus hosted.** What can be proven locally (fixture plus `*.localhost` preview hosts) versus only on hosted infrastructure (plan 020)?

## Deliverable

`plans/decisions/024-candidate-preview-delivery.md`, following the existing files in `plans/decisions/` (read two of them first and match their structure). It contains:
- the six answers with evidence;
- **one recommended design**, plus at most one alternative with its cost;
- a draft of the follow-up build plan's scope: files, contract, tests and STOP points;
- open questions for the maintainer.

## STOP conditions
- Any step seems to need a code, config or migration change.
- The spec constraints above contradict each other for this case. Write down the contradiction instead of choosing.
- Answering requires running hosted infrastructure or credentials. Mark the question "hosted-only" and move on.

## Done criteria
- [ ] `plans/decisions/024-candidate-preview-delivery.md` exists and answers all six questions with `file:line` evidence
- [ ] `git status` shows only that new file
