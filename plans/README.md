# Platform credential broker implementation plans

These plans implement `docs/specs/platform-credential-broker.md` in twelve
reviewable changes. They were written against commit `62c99b4` and the working
spec digest
`d24ce53aeb29603f6c743e90354387828687299c199859e0d8988648ff262460`.

Plan 001 was executed on 2026-08-20. The spec digest after that change is
`f104e9ba66b97ce8f5a196a08854fa7819cfd7e37186f8b46cfb429c2124c5b3`.

Plan 002 was executed on 2026-08-20 and is on `a49af50`.

Plan 003 was executed on 2026-08-20 and is on `79d7727`.

Plan 004 was executed on 2026-08-21 and is on `8b2a3b9`.

Plan 005 was executed on 2026-08-21 and is on `e7dc34b`.

Plan 006 was executed on 2026-08-21 and is on `913f0e9`. The spec digest
after that change is
`83d0fe14a16093e22d4d028dcb92c18d7a1623c7ecc8322974a7a5fe416e81c6`.

Plan 007 was executed on 2026-08-21 and is on `d2474ad`. The spec digest
after that change is
`a63f8b989e2270c89ed40db16edacc8aa5ddab23c4fac33a250f5cd2756f4e38`.

Plan 008 was executed on 2026-08-21 and is on `5ed000b`. The spec digest
after that change is
`3deb3e5eb7f4af7f36a3b2bf4d2c0926ef9d7e198b8033fb558d874de441195d`.

Plan 009 was executed on 2026-08-21. Advisor verdict: accept. Implementation
is on worktree commit `42da0a8` and is not merged onto `brain`. The spec
digest after that change is
`0c505b7d3d1f85fd16f8579cad55d10e5f81beb6e8f520a5cb18086b1b782fe4`.
Product push is disabled until non-fast-forward rejection is proved.

Plan 010 was executed on 2026-08-21. Advisor verdict: accept. Merged onto
`brain` as `d5e8585`. The spec digest is unchanged
(`0c505b7d3d1f85fd16f8579cad55d10e5f81beb6e8f520a5cb18086b1b782fe4`).

Plan 011 was executed on 2026-08-22. Advisor verdict: accept with follow-ups.
Merged onto `brain` as `cd3883a`. The spec digest after that change is
`28cf032d4d3ea043a9fdd810013a8939284ed1806917887b1289ba14129868ab`.
Later plans should start from that digest. Drain `waitUntil` wiring,
archive-final-checkpoint, and git-mutation queueing remain follow-ups on 011.

Before executing any remaining plan, compare both the commit and the spec
digest. Read the new diff if either changed. Stop if a required guarantee,
trust decision, or cutover rule changed.

## Recommended order

| Plan | Status | Depends on | Result |
|---|---|---|---|
| [001](001-resolve-module-and-platform-contracts.md) | DONE | none | The spec states implementable module interfaces and records local Sandbox contract results. |
| [002](002-lock-pi-resource-loading.md) | DONE | 001 | Normal chat loads only the image-owned Ditto extension and no repository resources. |
| [003](003-fix-model-and-remove-account-providers.md) | DONE | 002 | Ditto exposes one fixed model and removes account-provider product paths. |
| [004](004-add-token-free-archive-transport.md) | DONE | 001 | The Worker streams archives through R2 bindings without giving the sandbox an R2 capability. |
| [005](005-build-project-seeds-through-brokered-fetch.md) | DONE | 003, 004 | Temporary builders use durable identity and brokered Git fetch to create immutable project seeds. |
| [006](006-move-runtime-ownership-to-workspace-sessions.md) | DONE | 005 | Each workspace session owns one sandbox, branch checkout, and lifecycle generation. |
| [007](007-broker-opencode-requests.md) | DONE | 006 | Agent and metadata model requests use exact contracts; the OpenCode key stays in the Worker. |
| [008](008-remove-agent-git-callback-token.md) | DONE | 006 | The image-owned extension invokes Worker Git actions through a synthetic origin without a JWT. |
| [009](009-broker-git-push.md) | DONE | 005, 006, 008 | Receive-pack contract exists; product push is disabled until non-fast-forward rejection is proved. UI/agent push does not mint sandbox tokens. |
| [010](010-add-session-recovery-lineages.md) | DONE | 004, 006 | Session mutations create fenced recovery checkpoints with current and previous restore fallback. |
| [011](011-add-capacity-preview-and-idle-lifecycle.md) | DONE | 006, 010 | Durable capacity work, preview checkpoint deferral, idle shutdown, archive, and deletion follow one runtime module. Merged as `cd3883a`. |
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

