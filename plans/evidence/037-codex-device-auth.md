# Plan 037 evidence: Codex device-code sign-in

Base: `b2f4d0f`. All HTTP is mocked (`fetchMock`, net connect disabled). Fake values only.

## Steps

- Step 1 (protocol module): done. `pnpm --filter @ditto/web test -- src/lib/codex-device-auth.test.ts` passes (the filter argument runs the whole web suite: 85 files, 989 tests passed, run before the final additions).
- Step 2 (device sealing): done. `codex-credential-crypto.test.ts` covers token round-trip, device round-trip, and both cross-open failures. `pnpm typecheck` exit 0. `sealCredentials` output format unchanged; existing `codex-connection.test.ts` sealing tests still pass.
- Step 3 (`startDeviceAuth`, `pending` status, one `CODEX_CONNECTION_VIEWS` entry): done. `pnpm typecheck` exit 0.
- Step 4 (`alarm()`, install, `renewUpstream`): done. No `alarm()` existed before.
- Step 5 (product `connect`): done. `codex-connection.test.ts` passes.
- Step 6 (worker tests): `pnpm --filter @ditto/credential-tests exec vitest run src/codex-device-auth.worker.test.ts` passes, 10 tests. `pnpm --filter @ditto/credential-tests typecheck` and `pnpm check` exit 0 (`pnpm check` still reports pre-existing warnings only).
- Step 7 (live check): not run. Gates G1 and G2 are open.

## `pnpm verify`

- `pnpm check`, `pnpm db:drift`, `pnpm typecheck`: pass.
- `credentials:verify`: the vitest segment failed only in `product-commands.worker.test.ts` (timing flake, different tests each run); that file passes alone (100 tests). All other credential-test files pass, including the new one.
- `credentials:verify` then stops at `crash.test.mjs` ("credential imports and bindings remain product-only"): its regex `auth\.ts` matches the plan-mandated filename `codex-device-auth.ts` now bundled into `entry.ts`. NOT fixed: it needs an out-of-scope edit to `apps/credential-tests/crash.test.mjs` (for example `(^|\/)auth\.ts`) or a module rename. Maintainer decision.
- Remaining segments run as one chain (`contracts:verify && runtime:verify && pnpm test && pnpm build && runner:verify`): exit 0.

## Rename

The protocol module and its unit test were renamed to `codex-device-login.ts` and `codex-device-login.test.ts`. The guard regex `auth\.ts` in `crash.test.mjs` matched the planned filename `codex-device-auth.ts` once it was bundled into `entry.ts`. The guard is unchanged. The worker test keeps its name (`codex-device-auth.worker.test.ts`); it is not bundled. This supersedes the `crash.test.mjs` finding above.

## Notes

- `apps/credential-tests/src/codex-credential-do.worker.test.ts` also changed: the production-class renewal test now passes `CODEX_DEVICE_AUTH: ""` (renewal is flag-gated, and the pool binding is now `"1"`).

- `apps/credential-tests/src/codex-credential-do.worker.test.ts` gained one `startDeviceAuth` stub in an inline mock, required by the widened product-bindings type.
- Renewal test swaps the fixture's `renewUpstream` for the production one on the live object, because the fixture overrides it.
- Secret scan: the sealed DO column and every D1 `codex_connections` column are checked for the mocked access, refresh, identity, device ID, verifier and authorization code.
