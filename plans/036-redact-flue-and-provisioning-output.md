# 036 - Redact Flue and Provisioning Output Before Persistence

## Summary

- Priority: P1
- Effort: M
- Risk: Medium
- Category: security / data hygiene
- PRD phase: Phase 3 prerequisite
- Depends on: 035
- Planned at: `c7cdcba`
- Status: TODO

The PRD requires secrets to stay out of persisted product projections, live UI frames, and logs. The current Phase 2 Flue path can persist raw tool output and raw Flue error text into D1 and browser frames. The existing legacy runner has a `redactSecrets` helper in `src/lib/runner-protocol.ts`, but Flue projection and project provisioning do not use a shared redaction seam.

## Evidence

- `.flue/agents/project-coder.ts` returns raw `stdout` and `stderr` from `sandbox.exec(...)` through `runCommand(...)`.
- The `git_diff` tool can expose secret-like values already present in unstaged changes.
- `src/lib/flue-event-projection.ts` compacts Flue text but does not redact it before producing D1 events or socket frames.
- `src/lib/flue-dispatch-adapter.ts` includes Flue response text in thrown errors.
- `src/lib/sandbox-bootstrap.ts` throws command output from provisioning failures.
- `src/lib/runner-protocol.ts` already has redaction tests for concrete secrets, GitHub tokens, PEM blocks, AWS access keys, and common provider key patterns.

## Goal

Create a shared redaction helper and apply it to every Phase 2/Phase 3 path where Flue or provisioning output becomes user-visible or D1-persisted.

## Non-Goals

- Do not implement encrypted env storage.
- Do not change the project env-var data model.
- Do not remove the legacy runner redaction behavior.
- Do not claim perfect secret detection. This plan establishes a tested baseline and a single seam for future project-specific secrets.

## Implementation Steps

1. Create a shared helper.
   - Add `src/lib/secret-redaction.ts`.
   - Move or copy the pure pattern logic from `src/lib/runner-protocol.ts` into the new helper.
   - Export at least:

   ```ts
   export function redactSecrets(text: string, secrets?: readonly string[]): string;
   ```

   - Preserve the current behavior that ignores very short concrete secrets to avoid corrupting normal output.

2. Add focused tests.
   - Add `src/lib/secret-redaction.test.ts`.
   - Port the existing `redactSecrets` test cases from `runner-protocol.test.ts`.
   - Include one multi-line git diff case with a provider key on an added line.
   - Include one truncation-safety case in the Flue projection tests after Step 3.

3. Reuse the shared helper from the legacy runner.
   - Update `src/lib/runner-protocol.ts` to import and re-export the helper, or to delegate to it.
   - Keep existing public imports working.
   - Existing `src/lib/runner-protocol.test.ts` cases should continue to pass without weakening expectations.

4. Redact Flue projection text before persistence or broadcast.
   - Update `src/lib/flue-event-projection.ts`.
   - Redact before truncating or compacting, so a secret cannot survive due to slicing.
   - Apply redaction to text from Flue event fields used for:
     - assistant deltas
     - tool progress
     - tool result output
     - log/error messages
     - terminal error text
   - Update `src/lib/flue-event-projection.test.ts` with at least one `tool` or `log` event that would currently persist a token.

5. Redact Flue adapter error text.
   - Update `src/lib/flue-dispatch-adapter.ts` so formatted dispatch and stream-poll errors pass through the shared helper.
   - Keep the existing compacting cap.
   - Add or update adapter tests for JSON error bodies containing a token-like string.

6. Redact project-coder tool output.
   - Prefer importing the shared helper into `.flue/agents/project-coder.ts` with a relative import if `pnpm flue:build` can resolve it.
   - If Flue build cannot resolve imports from `src/lib`, add a tiny local `redactToolOutput` wrapper inside `.flue/agents/project-coder.ts` and document in a code comment that it intentionally mirrors `src/lib/secret-redaction.ts`.
   - Redact after command/file output is assembled and before `capOutput(...)`.
   - This protects `read_file`, `git_diff`, `git_status`, and `run_readonly_command` output.

7. Redact provisioning errors.
   - Update `src/lib/sandbox-bootstrap.ts` so thrown command failures do not include raw secrets.
   - Update `src/integrations/trpc/routers/projects.ts` so provisioning errors returned to the client are redacted before becoming `TRPCError` messages.
   - Keep enough context for debugging: command name, exit code, and redacted tail are acceptable.

## Tests

Run:

```sh
pnpm test -- src/lib/secret-redaction.test.ts src/lib/flue-event-projection.test.ts src/lib/flue-dispatch-adapter.test.ts src/lib/runner-protocol.test.ts
pnpm flue:build
pnpm exec tsc --noEmit --pretty false
pnpm lint
pnpm test
git diff --check
```

## STOP Conditions

- If importing `src/lib/secret-redaction.ts` from `.flue/agents/project-coder.ts` breaks Flue bundling, do not loosen the build. Use the local wrapper fallback described above and report the duplication in the plan completion notes.
- If any existing legacy runner redaction test must be weakened to pass, stop. The shared helper must preserve or improve the current security behavior.
- If redaction creates invalid JSON payloads in Flue projection, stop and fix at the projection boundary rather than storing partially malformed event payloads.

## Acceptance Criteria

- Flue-projected assistant/tool/log/error text is redacted before D1 insertion and before WebSocket broadcast.
- Project-coder read-only tools redact secret-like output before returning it to Flue.
- Provisioning error messages returned through tRPC are redacted.
- Existing legacy runner redaction tests still pass.
- Verification commands pass.
