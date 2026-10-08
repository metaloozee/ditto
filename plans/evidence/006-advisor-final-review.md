# 006 final advisor review

Verdict: accepted for plan 006's reviewed, fixture-backed local scope. This does not establish live Codex support, hosted authentication or completed L3. Source remains uncommitted and unintegrated.

Reviewed base: `ef172efdfdc575247e39a953ed1b6f74c0d8cead`. Execution worktree: `/tmp/ditto-plan-006-o6dok7`. The initial candidate was [rejected](006-advisor-review.md). The user requested Resume. A separate correction executor used `openai/gpt-6.1-sol` with medium reasoning. The advisor independently reviewed the actual corrected files and reran the probes and repository gates rather than accepting the executor's reported results.

See [original execution](006-execution.md), [correction execution](006-correction-execution.md), [current fixture/authentication contract](006-codex-contract.md) and [independent accepted-review artifacts](artifacts/006/accepted-review/). The initial failed probes and their artifacts remain preserved.

## Correction disposition

### Expected record revision

Accepted. Format-2 AAD binds the purpose, owner, token-record identity, connection generation, expected persisted revision and format version. The DO explicitly opens connected credentials with current SQLite `version`. It seals the rotated replacement against `intent.version + 1`, then commits ciphertext and that version in the same synchronous SQLite transaction. It does not obtain freshness from the substituted envelope.

The unchanged advisor workerd/SQLite probe now observes only one refresh dispatch and returns `reconnect_required` after replacing ciphertext alone. The permanent Worker regression additionally asserts unchanged metadata before reading, encrypted-record deletion on denial and ordered D1 failure projection version 4. Ordinary concurrent renewal, reconnect, revocation and actual workerd abort/reopen tests still pass.

This establishes the reviewed ciphertext-only substitution check. It does not establish whole-database rollback protection. The rejected candidate's format-1 envelopes fail closed; there is no retained/live credential migration claim.

### Complete envelope bound

Accepted using the explicitly permitted bounded-denial design. Both sealing and opening enforce the same 60,000-character complete JSON/hex envelope limit. Successful sealing can no longer return the unreadable oversized records from the initial counterexample. Per-token UTF-8 limits remain; no data is truncated and no provider character restrictions are invented.

The maximum plain token set and smaller escaped values still roundtrip through actual SQLite. Oversized backslash/control-character token sets are denied before installation writes. Permanent tests compare the full prior credential row and D1 projection after denial. An oversized replacement after upstream rotation clears potentially spent credentials, requires reconnect and never redispatches.

The original advisor envelope probe remains unchanged and still exits 1 for its oversized case, now at sealing rather than opening. Its old predicate required all formerly accepted inputs to succeed. The separately reviewed correction probe asserts the approved new contract: maximum plain input succeeds within the bound; oversized serialization is rejected before any persistable envelope is returned. Acceptance relies on this explicit predicate change plus real SQLite denied-write coverage, not an assertion that the old probe passed.

### Lockfile scope

Accepted. The advisor's parsed comparison independently confirms preservation of all 4 base importers, 1626 base package entries and 1635 base snapshots. Only one importer, one Workers type package and three required peer snapshots were added. The base diff contains 63 additions and no removals.

The installed graph independently confirms web Vitest 4.1.10/Vite 8.1.5, runtime Vitest 3.2.7/Vite 7.3.6 and the restored nested esbuild 0.28.1 resolutions. Credential tests use Vitest 3.2.7, shared Vite 7.3.6/esbuild 0.28.1 and their separate direct esbuild 0.27.3. Installed tsx uses esbuild 0.28.1; dotenvx uses undici 7.28.0.

The initial advisor review misnamed the undici consumer as `@expo/env`. The original diff's actual consumer was `@dotenvx/dotenvx`. That attribution is corrected here; the underlying resolution drift was real and is fixed. The correction restores every base entry, not just the examples.

## Independent commands and results

All verification ran in the disposable execution worktree. No install, build or test ran in the main checkout. Aggregate commands were sequential, with the inherited environment removed:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true \
  node --test plans/evidence/006-advisor-record-revision-probe.mjs \
  plans/evidence/006-correction-envelope-bound-probe.mjs

env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm credentials:verify
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm runtime:verify
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm verify
```

| Check | Result |
|---|---|
| Unchanged record-revision probe and reviewed bounded-denial probes | passed, 3 Node tests |
| `credentials:verify` | passed, typecheck, 22 actual Worker/SQLite tests and 3 standalone Node/workerd tests |
| `runtime:verify` | passed, typechecks, 208 Worker tests and 6 Node checks |
| `verify` | passed, repository checks/typecheck, credential suites, 815 web tests/build and 79 runner tests/typecheck/build |
| Base lock graph preservation | passed, every existing entry unchanged |
| Installed restored dependency graph | passed |
| Correction scope and historical-probe preservation | passed, exactly five implementation/test/configuration files changed since the initial reviewed candidate; original advisor probes unchanged |
| Accepted source identities | passed, 24 file hashes recorded and checked |
| `git diff --check` | passed |
| Accepted archive integrity | passed, `gzip -t`; checksum recorded below |
| Actual Codex auth/discovery/renewal/inference, PD38 | not run |
| Hosted service-binding identity, networking, eviction, quotas, billing | not run |
| New real-cookie HTTP auth smoke | not run; current tests inject identity |

The five correction files are `codex-credential-crypto.ts`, `codex-credential-do.ts`, their Worker test, `codex-connection.test.ts` and `pnpm-lock.yaml`. Nineteen other candidate implementation/configuration/test/migration identities are unchanged from the initial advisor review. No original behavior assertion was removed. The corrected Worker suite adds five focused regressions.

The candidate continues to pass authenticated action validation, foreign owner/role denial, product-only credential bindings/import checks, unique nonce and historical-key handling, fresh D1 authority checks, independent DO/product revocation fences, cross-workspace renewal serialization, atomic replacement, late-result rejection and failure-after-rotation no-retry tests. Production fixture installation and live renewal remain disabled. Connect returns `codex_hosted_auth_unverified`; no guessed callback, token upload, API-billing fallback or provider proxy exists.

Inherited warnings remain warnings. The executor's historical concurrent runtime timing failure and correction-time test/probe failures are retained. They are not claimed as successful runs. The final independently executed sequential gates passed.

## Preserved source and evidence

[Accepted candidate archive](artifacts/006/accepted-candidate.tar.gz) contains the 24 reviewed implementation/configuration/migration/test files and execution/probe evidence. It excludes installed dependencies, CLI HOME, credential files and existing environment state.

Archive SHA-256:

```text
00e34b866fae1a45e8d26688d5c60879c555badee3fa6b19cbdd647aaf609831
```

[Accepted source hashes](artifacts/006/accepted-review/006-advisor-accepted-source.sha256) identify every source/configuration/test file. The archive supplements the preserved live worktree; no worktree was deleted. It does not authorize integration or deployment.

Only `plans/` documentation/evidence was written in `/home/ayan/ditto`. Candidate source remains in `/tmp/ditto-plan-006-o6dok7`, detached at the unchanged base. No staging, commit, merge, push, deployment, reset, existing-environment migration or live subscription request occurred.

The initial install's shared Lefthook synchronization caveat remains. There is no baseline proving unchanged shared-hook bytes; no hook repair was performed. Correction installs used frozen lockfiles with `--ignore-scripts`, as documented by the executor. Main-checkout dependency repair remains unapproved.

## Following work

006 is DONE for the accepted local fixture scope, not integrated. 007 was not executed and remains BLOCKED pending source integration and refresh against the accepted credential/test interfaces. A separately requested refresh may prepare its fixture-only contract work; it must preserve unavailable live behavior while Ditto's supported hosted client, account-capability and transport contracts remain unresolved. No live picker, token use or subscription support is implied by this acceptance.

This is one prerequisite within L3. Prompt admission, exact model-operation authority, account-backed configuration, remote tools and the remaining product vertical slice still require their own plans. Actual provider and hosted validation require separate approval under 020; PD38 stays `not run`.
