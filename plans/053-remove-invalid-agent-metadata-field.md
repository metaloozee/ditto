# Plan 053: Remove Invalid `metadata` Field from Flue Agent Runtime Config

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 672b55a..HEAD -- .flue/agents/project-coder.ts`
> If the in-scope file changed since this plan was written, compare the
> "Current state" excerpt against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 052 (dev must be running to verify the agent executes)
- **Category**: bug
- **Planned at**: commit `672b55a`, 2026-07-06

## Why this matters

After plans 049–052 got `pnpm run dev` to reach a running state, sending a
chat message to the project-coder agent immediately fails with:

```
{"name":"Error","message":"[flue] createAgent() initializer returned unknown runtime config field \"metadata\"."}
```

The agent's `createAgent(...)` factory returns a config object with a
`metadata: { projectId }` field (`.flue/agents/project-coder.ts:310`). Flue's
runtime validator (`assertAgentRuntimeConfig` in
`node_modules/.pnpm/@flue+runtime@1.0.0-beta.1_*/dist/events-D94wk5Oa.mjs:96`)
checks every key against `AGENT_RUNTIME_FIELDS` and throws on any unknown
field. The valid fields are:

```
name, description, model, instructions, skills, tools, subagents,
thinkingLevel, compaction, durability, profile, cwd, sandbox
```

(minus `name`, which is reserved). `metadata` is NOT in this set. The fix is
to remove the `metadata` field from the return object. It is not read
anywhere — `grep` confirms no downstream code accesses
`agent.metadata`/`config.metadata`/`harness.metadata`. The `projectId` is
already available in the agent's closure (from `parseMutatingPayloadIdentity`
or `parseAddressableAgentIdentity` at lines 154-156) and is used directly
where needed.

This was a pre-existing bug masked by the dev server not starting. Now that
dev runs (plans 049–052), the agent actually executes and Flue validates the
config.

## Current state

### `.flue/agents/project-coder.ts` (the only file to modify)

Lines 305-313 inside the `createAgent(...)` factory return:

```ts
return {
    model: "opencode-go/deepseek-v4-flash",
    instructions: hasMutatingPayload(payload)
        ? mutatingInstructions
        : readOnlyInstructions,
    metadata: { projectId },
    tools,
    sandbox: cloudflareSandbox(sandbox),
};
```

Line 310 (`metadata: { projectId },`) is the invalid field. Remove it. The
`projectId` variable is destructured at line 154 (`const { projectId, sandboxId } =`)
and is **only** used by the `metadata` field — no other read site exists in
the factory closure. Removing `metadata` alone would make `projectId` an
unused local (TS6133 under `noUnusedLocals`). The fix is therefore two
lines: remove `metadata: { projectId },` AND change the destructuring at
line 154 from `const { projectId, sandboxId }` to `const { sandboxId }`.

The `parseMutatingPayloadIdentity` and `parseAddressableAgentIdentity`
functions (lines 121-150) return `{ projectId, sandboxId }` — they still
return `projectId` in the object, but the agent factory simply doesn't
destructure it anymore. Those functions are used elsewhere
(`parseMutatingPayloadIdentity` is called by `hasMutatingPayload` at line
113, and `parseAddressableAgentIdentity` is only called here) — neither is
affected by the destructuring change.

## Commands you will need

| Purpose   | Command                                       | Expected on success |
|-----------|-----------------------------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit --pretty false`       | exit 0, no errors   |
| Tests     | `pnpm test`                                   | all pass (currently 23 files, 262 tests) |
| Lint      | `pnpm lint`                                   | exit 0 (2 known warnings are acceptable) |
| Build Flue| `pnpm flue:build`                             | exit 0; known DO migration warning from generated `.flue-vite.wrangler.jsonc` is acceptable |
| Dev smoke | `pnpm run dev` + send a chat message          | agent dispatches without the `unknown runtime config field` error. Requires `.env.local`/`.env` — run in main checkout. |

## Scope

**In scope** (the only file you should modify):
- `.flue/agents/project-coder.ts` — (1) remove the `metadata: { projectId },` line from the return object, (2) change `const { projectId, sandboxId }` to `const { sandboxId }` at line 154.

**Out of scope** (do NOT touch):
- `alchemy.run.ts`, `.flue/cloudflare.ts` — fixed by plans 050/052.
- `src/lib/flue-run-bridge.ts`, `src/lib/flue-dispatch-adapter.ts` — they don't read `agent.metadata`.
- `.flue/lib/project-mutating-tools.ts` — uses `projectId` from the payload, not from agent metadata.
- Any other file.

## Git workflow

- Branch: `advisor/053-remove-invalid-agent-metadata-field`
- Single commit. Message (match the repo's conventional commits):
  - `fix(flue): remove invalid metadata field from project-coder agent config`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Remove the `metadata` field and the now-unused `projectId` destructuring

In `.flue/agents/project-coder.ts`, make two changes:

**1a.** Change line 154 from:

```ts
const { projectId, sandboxId } =
```

to:

```ts
const { sandboxId } =
```

**1b.** Remove line 310 (`metadata: { projectId },`) from the return object.

Change:

```ts
return {
    model: "opencode-go/deepseek-v4-flash",
    instructions: hasMutatingPayload(payload)
        ? mutatingInstructions
        : readOnlyInstructions,
    metadata: { projectId },
    tools,
    sandbox: cloudflareSandbox(sandbox),
};
```

to:

```ts
return {
    model: "opencode-go/deepseek-v4-flash",
    instructions: hasMutatingPayload(payload)
        ? mutatingInstructions
        : readOnlyInstructions,
    tools,
    sandbox: cloudflareSandbox(sandbox),
};
```

That is the entire change. Do not touch `model`, `instructions`, `tools`,
`sandbox`, or any other part of the file.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0, no errors.

### Step 2: Rebuild Flue and run the full verification gate

**Verify** (run all):
- `pnpm flue:build` → exit 0 (known DO migration warning from generated `.flue-vite.wrangler.jsonc` is acceptable).
- `pnpm exec tsc --noEmit --pretty false` → exit 0
- `pnpm test` → exit 0, all tests pass (expect 23 files / 262 tests; no new failures)
- `pnpm lint` → exit 0 (the 2 known warnings are acceptable)
- `git diff --check` → exit 0 (no whitespace errors)

### Step 3: Dev smoke test (the actual unblock)

This step requires `.env.local`/`.env` to be present — run it in the main
checkout, NOT in an isolated worktree (env files are gitignored).

Run `pnpm run dev`, open the app, select a project, and send a chat message
like "Can you show me the contents inside package.json".

**Expected**: the agent dispatches without the
`[flue] createAgent() initializer returned unknown runtime config field
"metadata"` error. The agent should start processing (streaming text or
tool output). You do not need to wait for the full response — if the dispatch
succeeds (no immediate error), the plan is done.

**If the agent fails with a DIFFERENT error**, record the exact error and
report it as a STOP condition.

## Test plan

No new automated tests are required:

- The fix is a one-line removal of an invalid field. `tsc` confirms no type
  errors, and `pnpm test` confirms no test regressions.
- The dev smoke (Step 3) is the real verification — it confirms the agent
  config passes Flue's `assertAgentRuntimeConfig` validator.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0
- [ ] `pnpm test` exits 0 (23 files, 262 tests, no new failures)
- [ ] `pnpm lint` exits 0 (2 known warnings acceptable)
- [ ] `pnpm flue:build` exits 0
- [ ] `grep -n "metadata" .flue/agents/project-coder.ts` returns no matches
- [ ] No files outside the in-scope list are modified (`git status --short` lists only `.flue/agents/project-coder.ts`)
- [ ] `plans/README.md` status row for 053 updated — SKIP if a reviewer dispatched you and maintains the index.
- [ ] Dev smoke (if run in main checkout): agent dispatches without the `unknown runtime config field "metadata"` error.

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `.flue/agents/project-coder.ts:310` doesn't match the "Current
  state" excerpt (the codebase has drifted). Run the drift check at the top
  first.
- `tsc` reports an error after removing the `metadata` field — this would
  mean `projectId` is somehow used in a type-level context that depends on
  the `metadata` field. Investigate before proceeding.
- The dev smoke fails with a DIFFERENT error (not the `metadata` field
  error). Record the exact error and stop — a different failure is a
  separate finding.

## Maintenance notes

- **Flue's `assertAgentRuntimeConfig` is strict.** Any field not in
  `AGENT_RUNTIME_FIELDS` causes a runtime error. The valid fields are:
  `description`, `model`, `instructions`, `skills`, `tools`, `subagents`,
  `thinkingLevel`, `compaction`, `durability`, `profile`, `cwd`, `sandbox`.
  When adding fields to an agent's return object, check this set first.
- **The `projectId` is still available in the agent's closure.** It's
  extracted at lines 154-156 and used for logging (line 62-66) and for
  mutating tool context (via `createMutatingProjectTools`). Removing the
  `metadata` field does not affect availability.
- **Reviewer focus**: confirm that ONLY the `metadata` line was removed, and
  that `model`, `instructions`, `tools`, and `sandbox` are unchanged.
