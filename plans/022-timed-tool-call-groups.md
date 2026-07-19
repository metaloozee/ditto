# Plan 022: Make tool-call groups durable, timed, and polished

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's status row in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 1588d12..HEAD -- src/lib/agent-message-parts.ts src/lib/agent-message-storage.ts src/lib/agent-run-service.ts src/lib/agent-stream-client.ts src/lib/agent-tool-presentation.ts src/components/composer.tsx src/components/ai-chat.tsx`
>
> This plan was written against a dirty working tree. Also run
> `git diff -- src/components/ai-chat.tsx src/components/composer.tsx` and
> compare the live code with the excerpts below. Preserve the existing empty
> chat/suggestion work in `ai-chat.tsx` and controlled-input work in
> `composer.tsx`; this plan only changes their tool-stream integration.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans 017 and 018 (both DONE); this extends their extracted
  agent-run service and ordered SSE event path
- **Category**: tech-debt
- **Planned at**: commit `1588d12`, 2026-07-13, plus the live working-tree
  state described above
- **Execution**: DONE — worktree branch `advisor/022-timed-tool-call-groups`
  @ `220e5d8` (reviewed and approved 2026-07-13); merged into master at
  `be0ef75`.

## Why this matters

Ditto already groups consecutive non-edit tools and deliberately renders only
their concise command labels. The group header, however, has no durable timing
data and considers only a running tool, so it can switch to `Worked` while the
assistant is still producing the response. The rendering and lifecycle logic
also live across an oversized chat component and several implicit transport
contracts. This change makes timing part of the typed event/storage model,
extracts the tool-group surface, preserves the current calm/inspectable design,
and adds a shadcn shimmer to the genuinely live state.

## Product and design constraints

From `PRODUCT.md`:

- Ditto should feel "modern, clean, minimal" and "calm, capable, and precise."
- AI actions must remain inspectable.
- Prefer calm density and legible state over spectacle.
- Target WCAG AA, including keyboard-first navigation, clear loading states,
  and reduced-motion support.

Translate those constraints as follows:

- Keep one collapsible row per consecutive group of non-edit tools.
- Inside the row, keep only `formatToolCallLabel(tool)` output: the tool title
  and primary command/path/query. Do not expose args/results or add cards.
- Keep edit tools outside these groups and preserve the existing diff UI.
- Keep the existing bottom border, compact type scale, truncation, error color,
  maximum content height, and chevron affordance.
- Use the existing Base UI-backed `Task`/`Collapsible`; do not rebuild keyboard
  or focus behavior.
- Use the existing `shimmer` utility from `shadcn/tailwind.css`. The repo already
  imports it at `src/styles.css:5`; do not add keyframes, CSS variables, a new
  animation library, or a dependency.

## Current state

### Data and lifecycle

- `src/lib/agent-message-parts.ts:1-7` has no timing fields:

  ```ts
  export type StreamToolCall = {
    id: string;
    name: string;
    status: "running" | "done" | "error";
    args?: unknown;
    result?: unknown;
  };
  ```

- `applyAgentToolEvent` at `src/lib/agent-message-parts.ts:42-122` reduces
  `tool_execution_start|update|end`, but accepts only the raw event. Updates
  replace the tool record without a lifecycle timestamp.
- `finalizeAssistantParts` and `finalizeStreamTools` turn orphaned `running`
  records into `done`, but do not record when they were finalized.
- `src/lib/agent-run-service.ts:65-71` emits agent events as
  `{ event: "agent", data: { event } }`. At `:512-523`, the service emits the
  event and independently reduces it into the persisted parts timeline.
- `src/lib/agent-stream-client.ts:59-65,124-128` forwards only the raw event to
  `onAgent`.
- `src/components/composer.tsx:340-345` independently reduces that browser-side
  event. Without one server-assigned occurrence time, the optimistic client
  record and the D1-backed record cannot share an exact duration.
- `src/lib/agent-message-storage.ts` explicitly rebuilds tool records in its
  full, minimal, and parse paths. Any new timing fields must be preserved in
  all three paths or the duration will disappear after reload/fallback storage.

### Grouping and UI

- `src/lib/agent-tool-presentation.ts:295-328` already owns the correct grouping
  rule: consecutive non-edit tools merge; non-empty text and edit tools split
  groups. Keep this behavior.
- `src/components/ai-chat.tsx:314-359` contains the whole tool-group component:

  ```tsx
  const working = tools.some((tool) => tool.status === "running");
  const title = working ? "Working" : "Worked";

  return (
    <Task className="border-b pb-2" defaultOpen={streaming && working}>
      <TaskTrigger title={title}>...</TaskTrigger>
      <TaskContent>...</TaskContent>
    </Task>
  );
  ```

- `AssistantParts` at `src/components/ai-chat.tsx:361-410` passes the global
  `streaming` flag to every tool group. The executor must derive one active
  group: the newest `tools` group in the current assistant timeline. Earlier
  completed groups must not regress to `Working` merely because a later group
  or later text is streaming.
- `src/components/ai-elements/task.tsx:36-84` composes the existing Base UI
  `Collapsible`, including its trigger semantics and panel animation. Reuse it.
- `src/components/ui/spinner.tsx` is the established loading indicator; reuse
  it instead of adding another loader implementation.
- `src/styles.css:5` already contains `@import "shadcn/tailwind.css";`, which
  provides the official `shimmer` utility.

### Verification baseline

- `pnpm typecheck` passes at plan time.
- All 308 root tests pass at plan time.
- `pnpm check` currently fails because of pre-existing dirty work in
  `src/components/ai-chat.test.tsx` (import ordering) and
  `src/components/ui/sidebar.tsx` (two accessibility diagnostics plus
  formatting). The chat test is in scope only for integration coverage and may
  have its imports organized while preserving its existing router mock. Do not
  fix the sidebar under this plan. Run a scoped Biome gate for all in-scope
  files, then run the full gate and report unchanged out-of-scope failures if
  the owner has not reconciled them.
- No elapsed-duration helper exists. The advisor searched `src` for formatters,
  duration/elapsed symbols, `Intl.DurationFormat`, and `Worked for`; no reusable
  implementation was found.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Targeted tests | `pnpm exec vitest run src/lib/agent-message-parts.test.ts src/lib/agent-message-storage.test.ts src/lib/agent-run-service.test.ts src/lib/agent-stream-client.test.ts src/lib/agent-tool-presentation.test.ts src/components/composer.test.tsx src/components/tool-call-group.test.tsx src/components/ai-chat.test.tsx` | named files pass |
| Typecheck | `pnpm typecheck` | exit 0, no TypeScript errors |
| Scoped check | `pnpm exec biome check src/lib/agent-message-parts.ts src/lib/agent-message-parts.test.ts src/lib/agent-message-storage.ts src/lib/agent-message-storage.test.ts src/lib/agent-run-service.ts src/lib/agent-run-service.test.ts src/lib/agent-stream-client.ts src/lib/agent-stream-client.test.ts src/lib/agent-tool-presentation.ts src/lib/agent-tool-presentation.test.ts src/components/composer.tsx src/components/composer.test.tsx src/components/tool-call-group.tsx src/components/tool-call-group.test.tsx src/components/ai-chat.tsx src/components/ai-chat.test.tsx` | exit 0 |
| Root build | `pnpm build` | exit 0 |
| Full repository gate | `pnpm verify` | exit 0 after pre-existing dirty baseline issues are reconciled |
| Changed React scan | invoke the repo's `react-doctor` skill, then run `npx react-doctor@latest --verbose --scope changed` | no new diagnostics or score regression |

## Suggested executor toolkit

Use these repo-provided skills explicitly; read each `SKILL.md` before acting:

1. `find-similar-functions` before adding the duration helper. Repeat the
   elapsed/duration search if the code has drifted; reuse a new match if its
   contract is genuinely equivalent.
2. `shadcn` before editing the component. Confirm the Base UI project context
   and consult the current Collapsible, Spinner, Marker, and
   [shimmer](https://ui.shadcn.com/docs/utils/shimmer.md) docs. Do not reinstall
   or overwrite existing components.
3. `baseline-ui`, `emil-design-eng`, and `fixing-accessibility` while shaping
   the trigger. Keep motion purposeful, compositor-friendly, reduced-motion
   safe, keyboard accessible, and visually restrained.
4. `deslop` after implementation, limited to files changed by this plan. Do not
   collapse the pure timing helper into JSX or reintroduce pass-through layers.
5. `react-doctor` after all React changes and before handoff.

The official shadcn guidance says `shimmer` is for live status text and ships
through `shadcn/tailwind.css`; apply the utility class only while the visible
label is `Working`.

## Scope

**In scope** (the only source/test files to modify or create):

- `src/lib/agent-message-parts.ts`
- `src/lib/agent-message-parts.test.ts`
- `src/lib/agent-message-storage.ts`
- `src/lib/agent-message-storage.test.ts`
- `src/lib/agent-run-service.ts`
- `src/lib/agent-run-service.test.ts`
- `src/lib/agent-stream-client.ts`
- `src/lib/agent-stream-client.test.ts`
- `src/lib/agent-tool-presentation.ts`
- `src/lib/agent-tool-presentation.test.ts` (create)
- `src/components/composer.tsx`
- `src/components/composer.test.tsx`
- `src/components/tool-call-group.tsx` (create)
- `src/components/tool-call-group.test.tsx` (create)
- `src/components/ai-chat.tsx`
- `src/components/ai-chat.test.tsx` (only newest-group integration coverage and
  preserving/organizing the existing router mock)
- `plans/README.md` (status row only when executing)

**Out of scope** (do not touch even if nearby):

- Tool grouping semantics in `groupAssistantParts`.
- Edit-tool diff rendering or the special ungrouped edit behavior.
- Tool args/results, command-label formatting, or storage payload limits.
- Database schema/migrations. Timing belongs in the existing JSON parts value.
- Runner protocol or `sandbox/runner`; server receipt time is the canonical
  occurrence time, so no Docker image rebuild is needed.
- `src/styles.css`, `src/components/ui/collapsible.tsx`,
  `src/components/ai-elements/task.tsx`, `src/components/ui/spinner.tsx`, and
  `src/components/ui/marker.tsx`; reuse them unchanged.
- Empty chat/suggestion UX, composer input ownership, sidebar behavior, message
  pagination/virtualization, or model/footer presentation.
- Auto-closing a group when streaming ends. Preserve the existing uncontrolled
  Collapsible behavior; changing it is a separate UX decision.
- Installing packages, changing `package.json`/lockfiles, or updating shadcn
  components from the registry.

## Git workflow

- Branch: `advisor/022-timed-tool-call-groups`
- Preserve all pre-existing user changes in the dirty working tree.
- Suggested commits:
  1. `feat(chat): persist tool lifecycle timing`
  2. `refactor(chat): extract timed tool groups`
- Do not push or open a PR unless instructed.

## Required behavior contract

### Timing model

- Extend `StreamToolCall` with optional numeric epoch-millisecond fields named
  `startedAt` and `endedAt`.
- Assign one `occurredAt` value in the server service when each runner agent
  event is received. Emit it in the same SSE `agent` payload and pass it into
  both the server reducer and browser reducer. Do not call `Date.now()`
  separately in those two reducers.
- Keep reducer time optional so old tests/callers and legacy stored records
  without timestamps remain valid.
- A start records `startedAt` once. Updates preserve it. An end records
  `endedAt` and preserves the original start. If an end is received without a
  start, use the same occurrence value for both fields (zero elapsed time) so
  the record remains internally complete.
- Terminal finalization must give any still-running tool an `endedAt` using one
  server settlement time and persist the finalized parts, including failure
  paths. Preserve existing status/error semantics; do not redesign statuses.
- Full storage, minimal fallback storage, parsing, optimistic client parts, SSE
  done parts, and D1-backed reloads must all retain the two optional fields.
- Parsing accepts only finite numeric timestamps. Invalid timing input is
  omitted rather than allowed to produce `NaN` labels.

### Group duration

- Duration is elapsed wall-clock time, not the sum of per-tool durations:
  `latest endedAt - earliest startedAt` across the group. This handles serial
  and overlapping tool executions without double counting.
- Return no duration unless every tool in the completed group has valid start
  and end timestamps. A legacy or partially timed group renders `Worked`; it
  must not render a fabricated `Worked for 0s`.
- Clamp clock anomalies to zero.
- Format rounded whole seconds with compact units and no zero-valued interior
  noise:
  - `4_000` -> `4s`
  - `1_023_000` -> `17m 3s`
  - `3_723_000` -> `1h 2m 3s`
  - `60_000` -> `1m`
  - `0` -> `0s`
  - positive sub-second durations -> `1s`
- The completed trigger label is `Worked for ${formattedDuration}`. Apply
  `tabular-nums` to the duration-bearing label.

### Working state

- A group is working if any tool inside it has `status === "running"`.
- While an assistant response is streaming, also mark the newest non-edit tool
  group active. This keeps the latest group at `Working` while the model emits
  its following message, even after the final tool end event.
- Earlier completed groups remain `Worked for …`; do not mark every historical
  group working just because the response stream is globally active.
- The visible and accessible label is exactly `Working` while active. Apply the
  built-in `shimmer` class only to this text. Keep a spinner as a decorative
  visual indicator and ensure it does not duplicate the accessible name.
- The Base UI Collapsible trigger must retain its generated `aria-expanded`,
  keyboard behavior, focus treatment, and a usable accessible name.

## Steps

### Step 1: Make timing a lossless part of the tool record

In `src/lib/agent-message-parts.ts`:

1. Add optional `startedAt`/`endedAt` epoch-millisecond fields.
2. Add an optional occurrence-time argument to `applyAgentToolEvent` and
   `applyAgentToolEventToParts`.
3. Preserve the fields across start/update/end replacement records according
   to the required behavior contract.
4. Allow `finalizeStreamTools` and `finalizeAssistantParts` to receive an
   optional settlement time and add only the missing `endedAt` for orphaned
   running tools.

In `src/lib/agent-message-storage.ts`, include validated timing in:

- the normal sanitized record;
- minimal fallback serialization;
- `parseToolRecord` for both parts-format and legacy flat tool lists.

Tests:

- Start at `1_000`, update at `2_000`, end at `5_000` retains
  `{ startedAt: 1_000, endedAt: 5_000 }`.
- End-only at `5_000` records both fields as `5_000`.
- Finalizing a running tool at `8_000` preserves its start and records the end.
- Full and minimal storage round-trip both fields.
- Legacy records without timing still parse unchanged.
- Non-finite/malformed stored timing is omitted.

**Verify**:
`pnpm exec vitest run src/lib/agent-message-parts.test.ts src/lib/agent-message-storage.test.ts`
passes.

### Step 2: Stamp once on the server and propagate the same value end to end

In `src/lib/agent-run-service.ts`:

1. Add an injectable `now: () => number` dependency with `Date.now` as the
   default so lifecycle tests are deterministic.
2. Change the typed `agent` event data to `{ event, occurredAt }`.
3. For each runner `agent_event`, call `now()` once, then use that same value in
   the emitted SSE event and `applyAgentToolEventToParts` call.
4. At normal or exceptional settlement, finalize once with a settlement time,
   pass those finalized parts to persistence, and use those same parts/tools
   in the done payload. Do not persist the earlier unfinalized array.

In `src/lib/agent-stream-client.ts` and `src/components/composer.tsx`:

1. Change `onAgent` to receive `(event, occurredAt?)`.
2. Validate/forward a finite `occurredAt` from the SSE payload.
3. Pass it to the browser-side reducer so optimistic and done/reloaded records
   use the server's exact timestamps.

Tests:

- Service test injects known start/end times and asserts the agent SSE payload,
  persisted parts, and done parts all contain those exact values.
- Stream-client transport test asserts `onAgent` receives both arguments and
  remains backward-compatible when `occurredAt` is absent.
- Composer test sends timed start/end handler calls and asserts
  `onStreamCommit` keeps the timestamps.
- Existing delta ordering/batching tests remain unchanged and green.

**Verify**:
`pnpm exec vitest run src/lib/agent-run-service.test.ts src/lib/agent-stream-client.test.ts src/components/composer.test.tsx`
passes.

### Step 3: Add pure, independently tested presentation helpers

In `src/lib/agent-tool-presentation.ts`, add focused exported helpers:

- `getToolGroupElapsedMs(tools): number | null` implementing the complete-group
  wall-clock rule;
- `formatElapsedDuration(durationMs): string` implementing the exact examples
  in the behavior contract.

Keep these helpers free of React, timers, locale dependence, and side effects.
Do not alter `formatToolCallLabel` or `groupAssistantParts`.

Create `src/lib/agent-tool-presentation.test.ts`. Model its Vitest style on
`src/lib/agent-message-parts.test.ts`. Cover serial calls, overlapping calls,
missing timing, reversed-clock clamping, sub-second rounding, minute, and hour
formats.

**Verify**:
`pnpm exec vitest run src/lib/agent-tool-presentation.test.ts`
passes.

### Step 4: Extract the tool-group UI and keep activity group-specific

Create `src/components/tool-call-group.tsx` with one exported
`ToolCallGroup` component and an explicit props type:

- inputs: `tools: StreamToolCall[]` and `active?: boolean`;
- derive `working` from `active || tools.some(running)`;
- render the existing `Task`, `TaskTrigger`, `TaskContent`, list semantics,
  command labels, truncation/title, error color, max height, border, and chevron;
- use the existing `Spinner` when working;
- label `Working` with `shimmer`; label completed fully timed groups
  `Worked for …`; fall back to `Worked` for legacy/partial timing;
- add `tabular-nums` only when duration is shown;
- use `cn` for conditional classes and semantic theme tokens only;
- do not add `useEffect`, an interval, custom CSS, gradient markup, or a second
  primitive system.

In `src/components/ai-chat.tsx`:

1. Remove the local `ToolGroupPart` and its now-unused imports only.
2. After `groupAssistantParts(parts)`, find the newest group whose type is
   `tools` when `streaming` is true.
3. Render `ToolCallGroup` and pass `active` only for that group. A group's own
   running tool still makes it working even without this prop.
4. Leave the dirty-tree empty state/suggestions and all other chat behavior
   byte-for-byte intact where practical.

Create `src/components/tool-call-group.test.tsx` using jsdom and Testing
Library. Cover:

- four completed tools from `0` through `1_023_000` produce one accessible
  trigger named `Worked for 17m 3s`;
- expanding the trigger shows exactly the four concise labels and does not show
  result payloads;
- `active` produces `Working`, a `shimmer` class on the label, and no completed
  duration text;
- one running tool produces `Working` even when `active` is false;
- a legacy completed group with no timestamps produces `Worked`;
- error tools retain destructive styling;
- the trigger remains a keyboard-operable Base UI button with
  `aria-expanded`/controlled panel association supplied by the primitive.

Add or extend an `ai-chat` test only if needed to prove that, with two tool
groups in one streaming timeline, only the newest group receives `active`.
If proving this would require exporting internal chat helpers or broad mocking,
extract a small pure `findActiveToolGroupId(groups, streaming)` helper beside
`groupAssistantParts` and test it there instead. Do not export the whole
`AssistantParts` component for tests.

**Verify**:
`pnpm exec vitest run src/components/tool-call-group.test.tsx src/components/ai-chat.test.tsx src/lib/agent-tool-presentation.test.ts`
passes.

### Step 5: Apply the UI quality skills and run all gates

1. Run `deslop` only across this plan's changed files. Reject abstractions that
   merely forward props, but retain the pure timing helpers and extracted
   domain component because each removes a separate concern from `ai-chat`.
2. Review `tool-call-group.tsx` with `baseline-ui`, `emil-design-eng`, and
   `fixing-accessibility`. For any findings, record the review in the required
   Before/After table while fixing only in-scope code.
3. Run the targeted tests, scoped Biome command, typecheck, build, React Doctor,
   then `pnpm verify`.
4. Manually inspect light/dark, a running group, a completed seconds-only group,
   a minutes+seconds group, a failed command, keyboard expansion, narrow-width
   truncation, and reduced-motion mode. The shimmer must remain text-only and
   the completed row must not visually jump when its label changes.

**Verify**: all commands in "Commands you will need" meet their expected
result, subject only to the documented unchanged out-of-scope baseline issue.

## Test plan

The new regression coverage is distributed by ownership:

- `agent-message-parts.test.ts`: event lifecycle timing and finalization.
- `agent-message-storage.test.ts`: full/minimal/reload compatibility.
- `agent-run-service.test.ts`: one canonical server timestamp and persistence.
- `agent-stream-client.test.ts`: SSE timestamp transport/backward compatibility.
- `composer.test.tsx`: optimistic-to-commit timing preservation.
- `agent-tool-presentation.test.ts`: elapsed wall-clock calculation and format.
- `tool-call-group.test.tsx`: status labels, shimmer, concise disclosure, and
  accessible Collapsible behavior.
- `ai-chat.test.tsx` or a pure presentation-helper test: newest-group-only
  activity selection during streaming.

Do not use real timers for the completed label. All inputs are fixed values, so
tests must be deterministic and require no fake-clock advancement.

## Done criteria

- [ ] Four consecutive non-edit tools still render in one Collapsible and show
  only concise labels.
- [ ] A fully timed completed group renders `Worked for 4s`,
  `Worked for 17m 3s`, and hour-scale values according to the pure formatter.
- [ ] Group duration uses earliest start to latest end and does not sum
  overlapping executions.
- [ ] The newest group says `Working` while assistant output continues or any
  tool in that group remains running; earlier groups do not regress.
- [ ] Only `Working` has the built-in shadcn `shimmer` class.
- [ ] Legacy stored messages remain readable and show `Worked` without a fake
  duration.
- [ ] The same server-assigned times survive SSE, optimistic state, done payload,
  full/minimal storage, and D1 reload parsing.
- [ ] Edit tools, results, args, empty-state work, and unrelated UI remain out of
  the tool group.
- [ ] Targeted tests, scoped Biome, typecheck, and build exit 0.
- [ ] React Doctor reports no new changed-scope regression.
- [ ] No files outside Scope changed, except the plan status row.
- [ ] `plans/README.md` marks plan 022 DONE only after all applicable gates pass.

## STOP conditions

Stop and report back instead of improvising if:

- The live dirty changes in `ai-chat.tsx` or `composer.tsx` no longer match the
  described empty-state/controlled-input work, or implementing this plan would
  overwrite them.
- Agent events already gained a canonical server timestamp under another field;
  reuse/reconcile that field rather than adding a duplicate.
- The current shadcn package no longer provides `shimmer` through the existing
  `shadcn/tailwind.css` import.
- Correct persistence would require a D1 schema migration or runner/Docker
  protocol change; this plan assumes JSON parts plus server receipt time.
- Base UI Collapsible no longer supplies accessible button semantics,
  `aria-expanded`, or panel association.
- A required change falls outside Scope.
- A verification command fails twice because of in-scope changes.
- `pnpm verify` fails only in the documented dirty sidebar/test baseline: report
  the unchanged failure and do not fix out-of-scope files. Any new failure in an
  in-scope file must be fixed before handoff.

## Maintenance notes

- Treat `StreamToolCall.startedAt/endedAt` as persisted wire data. Future event
  reducers, sanitizers, or schema-versioning work must preserve both optional
  fields and legacy absence.
- If the product later wants "agent worked time" to include token generation
  after the last tool, add an explicit group/message completion timestamp. Do
  not silently stretch a tool's `endedAt`; it would corrupt tool wall time.
- If tool calls become truly concurrent, the chosen earliest-start/latest-end
  calculation already reports elapsed wall time without double counting.
- Reviewers should scrutinize the normal and failure persistence paths for use
  of the same finalized parts array, and verify that only the newest streaming
  tool group receives the assistant-level active state.
- Keep the shimmer semantic: it communicates live work. Do not reuse it for
  completed durations or decorative emphasis.
