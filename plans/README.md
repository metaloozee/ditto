# Platform credential broker implementation plans

These plans implement `docs/specs/platform-credential-broker.md` in twelve
reviewable changes. They were written against commit `62c99b4` and the working
spec digest
`d24ce53aeb29603f6c743e90354387828687299c199859e0d8988648ff262460`.

Plan 001 was executed on 2026-08-20. The spec digest after that change is
`f104e9ba66b97ce8f5a196a08854fa7819cfd7e37186f8b46cfb429c2124c5b3`. Later
plans should start from that digest. The spec is already in this workspace.

Plan 002 was executed on 2026-08-20. Uncommitted runner and architecture
changes are in
`/home/ayan/.grok/worktrees/ayan-ditto/subagent-01a02037-4e7f-76a2-9afc-9a1e093ef707`.
Copy or merge that worktree before running plan 003.

Before executing any remaining plan, compare both the commit and the spec
digest. Read the new diff if either changed. Stop if a required guarantee,
trust decision, or cutover rule changed.

## Recommended order

| Plan | Status | Depends on | Result |
|---|---|---|---|
| [001](001-resolve-module-and-platform-contracts.md) | DONE | none | The spec states implementable module interfaces and records local Sandbox contract results. |
| [002](002-lock-pi-resource-loading.md) | DONE | 001 | Normal chat loads only the image-owned Ditto extension and no repository resources. |
| [003](003-fix-model-and-remove-account-providers.md) | TODO | 002 | Ditto exposes one fixed model and removes account-provider product paths. |
| [004](004-add-token-free-archive-transport.md) | TODO | 001 | The Worker streams archives through R2 bindings without giving the sandbox an R2 capability. |
| [005](005-build-project-seeds-through-brokered-fetch.md) | TODO | 003, 004 | Temporary builders use durable identity and brokered Git fetch to create immutable project seeds. |
| [006](006-move-runtime-ownership-to-workspace-sessions.md) | TODO | 005 | Each workspace session owns one sandbox, branch checkout, and lifecycle generation. |
| [007](007-broker-opencode-requests.md) | TODO | 006 | Agent and metadata model requests use exact contracts; the OpenCode key stays in the Worker. |
| [008](008-remove-agent-git-callback-token.md) | TODO | 006 | The image-owned extension invokes Worker Git actions through a synthetic origin without a JWT. |
| [009](009-broker-git-push.md) | TODO | 005, 006, 008 | Fetch and push use brokered GitHub credentials; no installation token enters a sandbox. |
| [010](010-add-session-recovery-lineages.md) | TODO | 004, 006 | Session mutations create fenced recovery checkpoints with current and previous restore fallback. |
| [011](011-add-capacity-preview-and-idle-lifecycle.md) | TODO | 006, 010 | Durable capacity work, preview checkpoint deferral, idle shutdown, archive, and deletion follow one runtime module. |
| [012](012-cut-over-and-delete-legacy-paths.md) | TODO | 003 through 011 | Legacy project sandboxes, credential injection, provider data, and obsolete docs are removed. |

Plans 002 and 004 may run in either order after plan 001. All other edges are
blocking. Do not combine plans 005 through 011 into one change. Each one crosses
a security or durability seam and needs its own review.

## Decisions shared by every plan

- Treat every sandbox process and file as untrusted.
- Keep D1 as the durable authority for identities, operations, runtime state,
  queue state, and recovery metadata.
- Use R2 only through the Worker binding.
- Keep Alchemy as the only deployment owner.
- Keep `@cloudflare/sandbox` on stable `0.12.3` for this plan set. A move to
  `@next` requires a separate migration.
- Use TypeScript `unknown` until validation narrows input. Do not add `any`.
- Keep routes and UI focused on orchestration. Put lifecycle and policy in
  `apps/web/src/lib` modules.
- Tests cross the same external seam as callers. Internal request-contract
  adapters may have focused tests because OpenCode, Git fetch, Git push, Ditto
  actions, and public internet policy are real variations.
- Never cache an operation's open or closed state in the first implementation.
  Every privileged request checks D1.
- Allow at most one open operation for each identity and contract family.
  Different families may overlap. Consume bounded operations atomically before
  forwarding the upstream request.
- Preserve the current secret redaction and Git secret preflight controls until
  the final plan proves that their old credential inputs are gone.

## Repository verification

Use the narrow checks listed in each plan while working. Every code plan ends
with:

```bash
pnpm verify
```

Expected result: Biome, web type checking and tests, the production build, and
the independent sandbox-runner verification all exit with status 0.

Production validation remains blocked until the paid Cloudflare container plan
is available. No plan may deploy or mutate production resources.

