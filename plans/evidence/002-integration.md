# 002 branch integration

The user authorized staging and committing the accepted 002 changes, integrating them into `feat/pi-durable`, and deleting the execution worktree. Acceptance remains limited to the revised local gate. No push, PR operation, deployment or 003 implementation is authorized.

The reviewed runtime and exact approved specification amendment landed in source commit `0d9c73c`, `feat(runtime): prove bounded Pi host lifecycle`. The main branch was at `3d69820` and fast-forwarded to that commit. Acceptance records, the integration record and archived artifacts accompany a separate documentation commit.

The integrated source was compared byte-for-byte with the accepted execution worktree and with the source commit. The seven source/decision paths match. No package, lockfile, legacy runtime or L0 fixture changed. Pre-commit hooks for these commits were disabled for their invocation because the configured hooks run write-mode format/fix commands. The exact reviewed source had already passed Biome and both full verification gates; no application check was disabled.

## Existing main-checkout work preserved

Before integration, the main checkout contained older edits to plans 002/003/index and untracked decision/historical evidence files. The older 002/index edits and overlapping untracked files were preserved in stash:

`a09298aecee514fecab5c06d5e42e4b4c2ed4a85`, `preserve pre-002 integration planning`

The stash is retained, not dropped or applied over the newer accepted records. Its older 002/index state is superseded by the integrated accepted plans. Original tracked-file content and the complete pre-integration planning diff are also preserved in the artifact archive and [compressed main-checkout patch](artifacts/002/main-checkout-before-integration.patch.gz).

The user's existing `plans/003-effect-admission-and-stop.md` change was deliberately excluded from both commits. It remains unchanged and unstaged in the main checkout. Its content matched the execution worktree before cleanup. 003 has not been implemented; its conditional brief still needs refresh before separately requested execution.

## Verification retained

[Final advisor acceptance](002-advisor-final-review.md) independently passed:

- The 53-test host suite, also exercised by the full runtime gate.
- `pnpm runtime:verify`, including both typechecks, 81 Worker tests and 6 Node checks.
- `pnpm verify`, including Biome, web types, 808 web tests, web build, runner types, 79 runner tests and runner build.
- Three joined native-alarm probe runs, one actual test per run.
- Source/spec/history preservation and whitespace checks.

The exact reviewed source is what landed. Historical failures and the unjoined native-alarm cleanup control remain failed evidence, not relabeled passes. The effective installed workerd compatibility date is still `2026-03-10`, not the requested September date. Hosted, live-provider, Docker, product-restart and browser checks are not claimed.

An extra post-source-integration `pnpm runtime:verify` was attempted in the main checkout with a sanitized environment. It exited 1 before running tests because this checkout has no installed runtime package dependencies and pnpm's dependency-status check attempted an install, then aborted with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. No install override, dependency replacement or source/configuration workaround was performed. This is a main-checkout prerequisite failure, not a new host-test result. The exact output is preserved in [integration-runtime-verify.log](artifacts/002/integration-runtime-verify.log). Installing main-checkout dependencies is separate from this accepted source integration.

## Artifact archive and cleanup

Before deleting the detached execution worktree, verification logs, both exact pre-edit baselines, incremental patches, ignored provider/authority/native-alarm probes, historical 002 logs and original main-checkout planning content were archived into:

[`artifacts/002/verification.tar.gz`](artifacts/002/verification.tar.gz)

SHA-256:

`ba65edde4c125433efab9f482083c576c4493a2535f0ae40721d1c29fd1f6023`

Both compressed artifacts passed `gzip -t`; [SHA256SUMS](artifacts/002/SHA256SUMS) also covers the compressed planning patch and post-integration prerequisite log. [archive-paths.txt](artifacts/002/archive-paths.txt) lists archived roots. Paths retain their original repository-relative layout, including the ignored `node_modules` paths cited by historical reviews. Extract into a separate scratch directory when inspecting them. Do not extract over the working repository.

Package downloads, CLI HOME/cache directories and credentials were not archived. All source and redacted Markdown evidence are committed separately from the compressed verification artifact.

The execution worktree `/tmp/ditto-plan-002-9KCuBv` was detached, so it has no associated branch to delete. Once the documentation commit is fast-forwarded and its tree/archive are verified, the authorized cleanup removes the worktree and remaining generated caches. The remaining worktree 003 edit is safe to remove only because its identical content remains unstaged in the main checkout and in the archive.

This record identifies the later integration authorization. Earlier reviews accurately describe their pre-integration state and remain unchanged.
