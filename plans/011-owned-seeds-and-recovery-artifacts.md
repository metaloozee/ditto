# 011: Move seed and archive operations behind admitted execution

Status: BLOCKED on passed L3, plans 006–010. Base: `bcce03e`. Phase: L4.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 3.1–3.4, 11–13, 15, 17; PD20, PD28–PD31, PD41; OD3–OD6.

## Outcome

Owned project creation produces an immutable source-only seed through a temporary execution-only builder. Workspace recovery can capture/restore verified artifacts through narrow admitted execution operations. Only the runtime may publish a paired checkpoint; artifact success alone does not make a pair usable.

Project creation/deletion use existing owned project operations, not a fabricated workspace session. Seed builders have no model authority, project values or trusted-brain identity and retire permanently after completion. Apply the Git credential policy before any repository fetch; use fixtures for external GitHub effects unless separately authorized.

## Current code and scope

`apps/web/src/lib/project-seed.ts` already creates source-only compatibility keys and uses a builder identity. `apps/web/src/lib/sandbox-archive.ts` defines:

```ts
export const ARCHIVE_MAX_COMPRESSED_BYTES = 1024 * 1024 * 1024;
export const ARCHIVE_MAX_EXTRACTED_BYTES = 3 * 1024 * 1024 * 1024;
export const ARCHIVE_MAX_DISK_PERCENT = 70;
```

Its `ArchiveRef` contains digest/size/generation, not Pi context. Retain those policies and safe extraction tests. `workspace-recovery.ts` currently stores filesystem recovery in product D1, not runtime-owned paired publication.

Scope: project-seed/product create orchestration, archive implementation, narrow runtime recovery/execution adapter, archive runner helpers, shared evidence contracts and tests. Extract only policy actually needed by both Workers. Runtime domain code must not import the product environment, auth or GitHub app clients. Do not move credential minting into the runtime.

## Steps and checks

1. Refresh the plan from L3 execution and authority contracts. Route builder lifecycle through product authority and bounded capacity; register a distinct builder role with repository-only fetch permissions. Wire project creation to the existing authenticated owned operation. Keep failure records/retry state and permanently retire the builder's authority even if cleanup needs retries. `project-seed.ts:421–448` currently catches destruction failure and then retires identity; retirement must not release accounting for a potentially live builder. Track that resource until termination evidence exists.
   Run `pnpm --filter @ditto/web exec vitest run src/lib/project-seed.test.ts src/lib/sandbox-authority.test.ts src/lib/sandbox-authority.ownership.test.ts`.
2. Move archive byte transport to Worker R2 bindings and fixed execution paths, preserving bounded streams and hash/length verification. Never deliver R2 credentials, object keys, signed URLs, mounts or internal bearer capabilities to builders/executors. Enforce compressed/extracted/disk ceilings and source-only contents without whole-object buffering.
   Run `pnpm --filter @ditto/web exec vitest run src/lib/sandbox-archive.test.ts` and `npm test --prefix packages/sandbox-runner -- src/archive.test.ts`.
3. Supply the narrow owned workspace branch-sync operation needed by 012 immediately after seed restore, reusing product-only Git mint-and-fetch and closed Git child policy. This is baseline preparation, not 014's broader UI Git feature. It must pass exact runtime admission and product fresh authority before any fetch, and use fixtures until external approval. Implement capture/restore preparation under runtime-granted exclusive mutation ownership. Each archive/extract/read suboperation passes guarded admission with epoch/generation/outcome, not an arbitrary shell callback. Recovery may call execution; execution must not call recovery. Recheck guards after async preparation. Return verified artifact evidence or classified failure; do not publish manifests or activate conversations here.
   Add `apps/runtime/src/pi-durable-artifacts.test.ts`; run `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-artifacts.test.ts`. Inject loss during pack/upload/download/extraction and authority revocation between suboperations.
4. Verify source/Git correctness, path traversal/symlink extraction defenses, incompatible archives and interrupted partial artifacts. Use one local Docker fixture for genuine stream and extraction behavior. Capacity includes builders even before 015. If global accounting is not complete, retain a hard one-live-container fixture cap across builder and workspace execution. Run them sequentially and wait for builder termination before starting the workspace executor. A failed builder destruction blocks progress; it must not free the slot. Separate identities/role accounting do not imply permission for concurrent containers.
   Run the focused commands, `pnpm runner:verify`, `pnpm runtime:verify`, `pnpm verify` and retained brain verification if shared inputs change.

## Done and handoff

Save exact commands and results under `plans/evidence/011-seeds-artifacts.md`. Project creation produces correct records and a retired execution-only builder; archive helpers never receive forbidden values. Source-only artifacts verify before any caller can treat them as recoverable. L4 is not complete, and retained mutations remain blocked until 014 records full L4 acceptance.

Stop if archive streaming needs an executor-held storage capability, Git needs a token in the runtime/sandbox, or an adapter bypasses current admission. Refresh concrete paths from predecessor evidence before coding. No existing data reset, deployment, live credentials, staging or commit. Future dependency-inclusive archives require the deferred benchmark gate, not an unreviewed change here.
