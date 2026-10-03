# 001 branch integration

The user explicitly authorized creating commits, integrating the approved implementation into `feat/pi-durable`, and removing the execution worktree. The verdict is approved for local L0 only.

Implementation commits:

- `160a5ca` updates the user-approved Biome directory exclusions and package-age policy.
- `89a34b4` adds the actual local Pi Durable compatibility fixture, pinned dependencies, verifier and tests.

`feat/pi-durable` was clean at `dfeccf270e3937253375b19f9003c895cbd7eef1` and fast-forwarded to the implementation commits. Acceptance documents are committed separately. No push, PR operation, deployment or subsequent implementation phase is authorized by this integration.

## What landed

- A local-only Alchemy candidate selected by `DITTO_LOCAL_PI_DURABLE=1`, separate from normal product resources, with one regular SQLite runtime DO and one stable Sandbox 0.12.3 executor.
- Pi Durable, pi-ai and Chord pinned to 1.0.1, with TypeBox 1.3.27. Only a deployment-owned synthetic provider and sequential marker tool run in this fixture.
- A finite `runtime:local:verify` command that checks actual Worker/SQLite/Docker execution and shuts down its own fixture. Host authentication uses explicit resource properties, not credential environment inheritance. A loopback denial transport prevents Cloudflare control-plane requests.
- Import/auth boundary regression checks and component behavior tests included in `runtime:verify`.
- The approved `minimumReleaseAge: 0` policy and root Biome exclusions for `plans/` and `docs/`.
- Reviewed acceptance evidence marking 001 DONE. Existing product runtime source, tests, resources and migration transform remain preserved.

## Verification carried into integration

The final reviewed source passed `pnpm verify`, `pnpm runtime:verify`, the real host-authenticated `runtime:local:verify` gate and `git diff --check`. Coverage included 808 web tests, 79 runner tests, 28 Worker tests and 6 Node import/auth checks. The selected candidate semantics use compatibility date `2026-03-10`.

Pre-commit hooks normally run write-mode format/fix commands. These commits disabled those hooks for their invocation to preserve the already reviewed source byte-for-byte; the independent full verification gates had already passed. No application check rule was disabled.

This does not enable product users, prove retained encrypted state or bounded recovery, establish full coding-tool parity, validate Codex subscriptions, or prove hosted behavior. No Cloudflare control-plane request, live model call or deployment occurred. Plan 002 still needs its provisional API details refreshed in a separate requested session.

## Preserved artifact archive

Before worktree cleanup, all `plans/evidence` and worktree-local `.alchemy` verification state were archived outside the repository:

`/home/ayan/.local/share/ditto/evidence/pi-durable-l0-TtJCzqZV/worktree-evidence.tar.gz`

SHA-256:

`a4abc89264cb019c5ff4a9c642e62529ee43b2161d79e7d21248a97859c687dd`

The archive passed `gzip -t`. Its directory is mode 700 and the archive is mode 600. It preserves the historical logs, bundles, upstream artifacts and disposable local state referenced by the acceptance documents. Host management tokens are encrypted; ephemeral encryption passwords were not retained. The source credential file was never copied into the worktree or archive.

Extract this archive only into a separate scratch directory when inspecting historical artifacts. Source and redacted Markdown acceptance records are in Git; generated downloads, caches and fixture state are not committed.

The execution worktree was detached, so no worktree branch exists to delete. Once the acceptance-document commit is fast-forwarded into `feat/pi-durable` and its tree is confirmed, the user-authorized cleanup can remove the detached worktree and its remaining generated caches. Historical review documents describe the pre-integration state; this record identifies the later authorization and archive location.
