# 006 correction execution

Status: corrected fixture candidate awaiting advisor review. No acceptance, DONE transition or integration is claimed.

Worktree: `/tmp/ditto-plan-006-o6dok7`, still detached at `ef172efdfdc575247e39a953ed1b6f74c0d8cead`. All changes remain uncommitted. Source edits were confined to that existing worktree. No nested agents were used. The main-checkout plan and advisor review were read, not edited.

## Exact delta from the rejected candidate

- `apps/web/src/lib/codex-credential-crypto.ts`: format 2 authenticates the expected record revision alongside owner, record identity and connection generation. Both sealing and opening enforce the same 60,000-character complete envelope limit. Sealing rejects an oversized result before returning anything persistable. Per-token 8192 UTF-8 byte limits remain unchanged; no truncation or token-character restrictions were added.
- `apps/web/src/lib/codex-credential-do.ts`: uses persisted SQLite `version` as the expected token-record revision while connected. Installation explicitly seals at version 1. Opening uses the current persisted version, not a revision supplied by ciphertext. Renewal seals at `intent.version + 1`; the existing synchronous SQLite transaction commits that version and replacement ciphertext together. Renewal intent, authority rechecks, generation fencing and D1 projection ordering remain intact. An oversized upstream replacement follows the existing post-dispatch failure path, clears the spent credential and requires reconnect.
- `apps/credential-tests/src/codex-credential-do.worker.test.ts`: adds five permanent real Worker/SQLite regressions. They cover ciphertext-only replay after rotation with unchanged metadata and no second dispatch; maximum plain and bounded escaped roundtrips; oversized escaped installation with unchanged SQLite and D1 projection; oversized upstream rotation with no redispatch; and total-envelope accounting including escaped key-version metadata. Existing cross-workspace, crash/reopen, historical-key, revocation, reconnect, deleted-projection, production-disabled and rollback assertions remain. Successful rotated-envelope reads now supply the persisted expected revision.
- `apps/web/src/lib/codex-connection.test.ts`: adds wrong-expected-revision denial to the existing crypto failure test. The unsupported-format fixture now uses format 1, which the corrected reader rejects.
- `pnpm-lock.yaml`: restores all base entries and adds only 63 lines: the credential-test importer, `@cloudflare/workers-types@4.20260605.1` package and three necessary snapshots for that type version, Workers pool and Wrangler peer binding. No existing importer, package or snapshot differs semantically from BASE.
- `plans/evidence/006-codex-contract.md`: updates only current implementation claims for revision authentication, format 2, coherent envelope bounds and fail-closed oversized rotation.
- `plans/evidence/006-correction-envelope-bound-probe.mjs`: separate bounded-denial probe using the same maximum plain, backslash and control-character inputs. The original advisor probes were not edited.
- This report and new `006-correction-*.log` files record correction checks. Original execution reports, logs and advisor probe artifacts remain unchanged.

The expected revision is independent of the replayed envelope. This fixes ciphertext-only substitution; it makes no whole-database rollback-protection claim. Old candidate format-1 envelopes fail closed. No live installation was enabled and no retained-user-data migration is claimed.

## Reproduction and probe predicate

Before correction, the unchanged advisor probes reproduced both failures: the revision probe observed two dispatches despite unchanged metadata, and the control-character envelope reached 295,131 characters then failed opening. The plain maximum-token case passed.

After correction, the unchanged revision probe passes with one dispatch and `reconnect_required`. The new permanent Worker test also verifies the replayed ciphertext is cleared and D1 receives ordered failure version 4.

The unchanged original envelope probe still exits 1 for its JSON-expanded case, now because sealing denies the oversized envelope before persistence, not because a successfully sealed value becomes unreadable. Its maximum plain case still passes. The original assertion was preserved. The separate correction probe changes only the permitted predicate for oversized inputs: exact bounded roundtrip for accepted sets, or `credential_integrity` before sealing returns a persistable envelope. The permanent SQLite regression independently asserts denied installation leaves the credential row and product projection unchanged. This is the denial option explicitly permitted by the advisor review, not a weakened unreadable-record assertion.

## Toolchain and restored graph

Node `v24.21.0`, pnpm `11.8.0`. Installed metadata checks after the restored frozen install confirmed:

| Consumer | Installed resolution |
|---|---|
| web | Vitest 4.1.10, Vite 8.1.5, Vite optional esbuild 0.28.1 |
| runtime and runtime-contracts | Vitest 3.2.7, Vite 7.3.6, esbuild 0.28.1 |
| credential tests | Vitest 3.2.7, shared Vite 7.3.6/esbuild 0.28.1; direct esbuild 0.27.3 |
| credential Workers pool | 0.12.21 |
| credential Miniflare | 4.20260310.0, workerd 1.20260310.1, compatibility date 2026-03-10 |
| tsx 4.23.1 | esbuild 0.28.1 |
| @dotenvx/dotenvx 1.75.1 | undici 7.28.0 |

The review named `@expo/env`, but no such package exists in BASE or this installed graph. The actual changed undici edge in the rejected diff was `@dotenvx/dotenvx`; it is restored and its installed dependency checked. This naming discrepancy did not narrow the correction: all 4 base importers, 1626 base package records and 1635 base snapshots were compared against HEAD and are unchanged. The additions are one importer, one package and three snapshots. See `006-correction-lock-preservation.log` and `006-correction-installed-versions-verified.log`.

The lockfile was rebuilt from base blocks plus only the required new blocks, then validated by the package manager. Both installs used `--frozen-lockfile --ignore-scripts`. The first relinked only this worktree's modules with no downloads; the second reported already up to date after a whitespace-only lockfile correction. No hook synchronization or lifecycle script ran during this correction. No main dependencies or hooks were repaired.

## Commands and results

Commands below ran from the execution worktree. Final checks removed inherited environment variables and retained only PATH, isolated HOME and CI:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm install --frozen-lockfile --ignore-scripts
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm exec biome format --write apps/web/src/lib/codex-credential-crypto.ts apps/web/src/lib/codex-credential-do.ts apps/web/src/lib/codex-connection.test.ts apps/credential-tests/src/codex-credential-do.worker.test.ts
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm --filter @ditto/credential-tests exec vitest run src/codex-credential-do.worker.test.ts
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm --filter @ditto/web exec vitest run src/lib/codex-connection.test.ts
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true node --test plans/evidence/006-advisor-record-revision-probe.mjs plans/evidence/006-correction-envelope-bound-probe.mjs
```

The three aggregate gates ran sequentially, never concurrently:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm credentials:verify
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm runtime:verify
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm verify
```

| Check | Result and evidence |
|---|---|
| Restored frozen installs | passed, `006-correction-install.log`, `006-correction-install-final.log` |
| Narrow Worker suite | passed, 22 actual SQLite/workerd tests, `006-correction-narrow-workers-rerun.log` |
| Narrow web suite | passed, 7 tests, `006-correction-narrow-web.log` |
| Unchanged revision plus rebound bounds probes | passed, 3 tests, `006-correction-probes.log` |
| Original envelope probe after correction | expected failure at oversized seal, plain case passed; `006-correction-original-envelope-probe.log` |
| credentials:verify | passed, typecheck, 22 Worker and 3 Node checks; `006-correction-credentials-verify.log` |
| runtime:verify | passed, typechecks, 208 Worker and 6 Node checks; `006-correction-runtime-verify.log` |
| verify | passed, repository checks/typecheck, 22 credential Worker and 3 Node checks, 815 web tests/build, 79 runner tests/typecheck/build; `006-correction-verify.log` |
| Installed graph assertions | passed, `006-correction-installed-versions-verified.log` |
| Base lock preservation assertions | passed, `006-correction-lock-preservation.log` |
| git diff --check | passed |

The original envelope probe was rerun with the same isolated environment:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true node --test plans/evidence/006-advisor-envelope-probe.mjs
```

The metadata check used `env -i ... node --input-type=module` with `createRequire` anchored to each worktree package and each installed tsx/dotenvx manifest. It asserted nested esbuild/undici versions and read the pool's manifest directly because that package does not export its package.json. The lock check used Python PyYAML to parse `git show HEAD:pnpm-lock.yaml` and the current worktree lock, asserting equality for every pre-existing entry before listing additions. Neither check read private environment or credential files.

No zero-test result was counted. Repository warnings remain inherited warnings.

### Correction-time failed checks

The first new Workers run failed because rejected fixture-install RPC promises produced unhandled rejection/storage-stack errors in the pinned test pool. The test now executes the same actual installation inside `runInDurableObject`, catches the bounded exception inside that invocation, asserts its exact denial code, and compares SQLite/D1 afterward. No runner-wide suppression or weaker persistence assertion was added. The failed run is preserved in `006-correction-narrow-workers.log`; the subsequent 22-test run passed.

Three installed-metadata probe attempts failed for probe mistakes: an incorrect contracts directory, the review's nonexistent expo package name, and a pool package.json export restriction. Partial logs are preserved as `006-correction-installed-versions.log`, `006-correction-installed-versions-rerun.log` and `006-correction-installed-versions-final.log`. The corrected metadata probe passes in `006-correction-installed-versions-verified.log`. These failed probes did not modify dependencies or source.

## Remaining blockers and limits

Hosted Ditto authentication and supported provider identity remain unresolved. Production installation and renewal stay disabled. No callback, token-upload endpoint, live renewal, UI, billing fallback, model discovery or plan 007 provider proxy was added. PD38 remains `not run`.

Ownership routing, fresh D1 authority, revocation fences, historical keys, cross-workspace serialization, crash/reopen safety and no-secret-output checks remain in the passing suites. Injected-auth tests still do not establish real-cookie HTTP coverage. Local fixture success is not hosted eviction, identity, networking, quota, billing or provider-permission evidence.

No staging, commit, push, merge, reset, deployment, live authentication/provider use, existing-environment migration, cleanup or worktree recreation occurred. The inherited initial-install shared-hook caveat remains historical and was not repaired. Advisor acceptance and external auth evidence remain outstanding.
