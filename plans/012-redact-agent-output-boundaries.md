# Plan 012: Redact agent output before streaming or persistence

> **Executor instructions**: Implement test-first and run every verification
> command. Never place a real credential in fixtures, logs, plans, or commits.
> Stop on any condition listed below instead of weakening redaction.
>
> **Drift check (run first)**:
> `git diff --stat 5ad5e0c..HEAD -- src/lib/secret-redaction.ts src/lib/secret-redaction.test.ts src/lib/agent-run.ts src/lib/agent-run.test.ts src/routes/api.agent.stream.ts src/lib/agent-stream-client.ts src/lib/agent-stream-client.test.ts`

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/011-establish-verification-baseline.md`
- **Category**: security
- **Planned at**: commit `5ad5e0c`, 2026-07-11
- **Execution**: DONE on `advisor/012-redact-agent-output` @ `107b66b` (2026-07-12)
- **Worktree**: `/home/ayan/.grok/worktrees/ayan-ditto/subagent-019f5521-ecf3-7731-a32b-4bc93640df63`
- **Base**: plan 011 commit `052774d` (not yet merged to master)

## Why this matters

Errors are redacted, but successful assistant deltas, tool arguments/results,
stored tool parts, and the final SSE payload currently bypass the redaction
boundary. A tool can therefore echo a project environment value into the
browser and durable D1 history. Redaction must happen before any runner-derived
string crosses into SSE or message persistence, including secrets split across
delta chunks.

## Current state

- `src/lib/agent-run.ts:85-103` already builds the complete per-run secret list
  (provider key, callback JWT, project environment values) and redacts errors.
- `src/lib/agent-run.ts:106-126` forwards every other parsed `RunnerOut`
  unchanged through `onRunnerMessage`.
- `src/routes/api.agent.stream.ts:302-321` broadcasts raw agent events and
  assistant deltas; only `msg.kind === "error"` calls `redactSecrets`.
- `src/routes/api.agent.stream.ts:343-407` stores and returns the accumulated
  raw assistant/tool content.
- `src/lib/secret-redaction.ts:18-31` is the canonical exact-value and
  secret-pattern redactor. Extend it rather than creating competing regexes.
- Storage compatibility tests live in `agent-stream-client.test.ts`; runner
  boundary tests live in `agent-run.test.ts`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Focused tests | `pnpm test -- src/lib/secret-redaction.test.ts src/lib/agent-run.test.ts src/lib/agent-stream-client.test.ts` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Full gate | `pnpm verify` | exit 0 |

## Scope

**In scope**:

- `src/lib/secret-redaction.ts`, `.test.ts`
- `src/lib/agent-run.ts`, `.test.ts`
- `src/routes/api.agent.stream.ts`
- `src/lib/agent-stream-client.ts`, `.test.ts` only where required to test
  stored structured parts
- `plans/README.md` status only

**Out of scope**:

- Encrypting the messages table or retroactively rewriting existing history.
- Generic DLP, entropy scanning, or logging every redaction event.
- Changing model prompts, tool availability, or the project env UI.
- Returning raw content to privileged users as an override.

## Git workflow

- Branch: `advisor/012-redact-agent-output`
- Suggested commit: `fix(secrets): redact streamed agent output`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add structured and streaming redaction primitives

In `secret-redaction.ts`, retain `redactSecrets` and add:

1. a recursive sanitizer for JSON-compatible values that redacts every string,
   preserves arrays/objects/numbers/booleans/null, and rejects cycles rather
   than serializing them;
2. a stateful text redactor for delta streams. It must retain an un-emitted
   suffix long enough to detect every supplied concrete secret across chunk
   boundaries, flush safe prefixes, and flush/redact the tail at completion;
3. explicit handling for the existing multiline private-key pattern so bytes
   after a begin marker are not emitted before the matching end marker or a
   bounded fail-closed replacement.

Do not lower the current eight-character exact-secret threshold globally:
one-character values would erase ordinary output. Document this limitation and
continue applying the existing secret-shaped patterns to all strings.

**Verify**: `pnpm test -- src/lib/secret-redaction.test.ts` -> tests pass for
single strings, nested values, split concrete secrets, multiline material,
safe text, and flush behavior.

### Step 2: Sanitize every runner event at the Worker boundary

In `runAgentInSandbox`, sanitize parsed `RunnerOut` before invoking
`onRunnerMessage`. Use the already complete `secretValues` array, including the
short-lived callback JWT. For assistant deltas, pass text through one stateful
redactor per run and emit only sanitized deltas. Flush it before `done`, error,
or stream completion so safe trailing text is not lost. Tool events must use
recursive structured sanitization.

Keep internal `assistantText` derived from the sanitized events so later
fallbacks cannot reintroduce raw content.

**Verify**: `pnpm test -- src/lib/agent-run.test.ts` -> no callback receives a
fixture secret, including split deltas and nested tool results.

### Step 3: Make the route fail closed

Keep route-level redaction as defense in depth for errors, but ensure all
assistant content, stored `tools`, `parts`, and the `done` event derive only
from sanitized runner messages. Add assertions around both primary and minimal
storage serialization. Never log raw rejected payloads.

**Verify**: focused tests above -> persisted JSON and final payload contain the
redaction marker and no fixture secret.

### Step 4: Run compatibility and full verification

Ensure existing stored legacy tool formats still parse and ordinary streaming
output remains byte-equivalent apart from batching caused by safe holdback.

**Verify**: `pnpm verify` -> exit 0.

## Test plan

- Exact known secret in assistant text, tool arguments, tool result, and error.
- Secret split across two and three deltas.
- Multiple secrets sharing prefixes.
- Multiline private-key-shaped fixture split across chunks.
- Safe nested tool payload remains structurally identical.
- Stored full and minimal serialization never contains fixture values.
- Model tests after `secret-redaction.test.ts`; runner mocks after
  `agent-run.test.ts`.

## Done criteria

- [x] Every runner-derived string is sanitized before callbacks, SSE, or D1.
- [x] Split-delta regression tests pass.
- [x] Final/fallback storage paths contain only sanitized parts.
- [x] Ordinary tool event shapes and legacy stored formats remain compatible.
- [x] `pnpm verify` exits 0; only in-scope files changed.
  (Review note: commit also includes a one-line Biome reflow in
  `src/components/ai-chat.tsx` pre-existing on the 011 base that blocked
  `pnpm check` — format-only, documented deviation.)

## STOP conditions

- Sanitization would require serializing non-JSON SDK objects and loses fields
  required by `applyAgentToolEventToParts`.
- The streaming redactor cannot guarantee that a supported concrete secret is
  withheld across chunk boundaries.
- Existing tests assert that raw secrets should reach the UI or storage.
- Fixing the issue requires exposing or copying a real local secret.

## Maintenance notes

All future runner event kinds must pass through the same sanitizer. Reviewers
should scrutinize ordering at flush boundaries and ensure no separate raw event
reference reaches storage. This plan is a prerequisite for outbound git diff
scanning in plan 013.

