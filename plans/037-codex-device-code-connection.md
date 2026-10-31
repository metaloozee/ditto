# Plan 037: Connect a Codex subscription with OpenAI's device-code sign-in

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the 037 row in
> `plans/README.md`, unless a reviewer dispatched you and said they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat 44c5739..HEAD -- apps/web/src/lib/codex-credential-do.ts apps/web/src/lib/codex-credential-crypto.ts apps/web/src/lib/codex-connection.ts apps/web/src/lib/codex-connection-product.ts apps/web/src/lib/codex-connection.functions.ts apps/credential-tests/src alchemy.run.ts`
> If any listed file changed, compare the "Current state" excerpts with the
> live code. A mismatch is a STOP condition.

## Status

- **Priority**: P1 (the maintainer's first bring-your-own provider)
- **Effort**: L
- **Risk**: HIGH (user credentials, a third-party auth flow)
- **Depends on**: none for Steps 1–6, which use only mocked HTTP. **Step 7 (live check) needs gate G1 and gate G2 below.** Steps 1–6 ship disabled.
- **Category**: direction
- **Planned at**: commit `44c5739`, 2026-10-31

## Gates (maintainer decisions, not executor calls)

- **G1, provider rules.** The flow uses the public OAuth client of OpenAI's Codex CLI (`client_id` `app_EMoamEEZ73f0CkXaXp7hrann`, as pi-ai does) from a hosted service. The spec requires verifying provider rules before claiming support (`docs/specs/pi-durable-session-runtime.md:591-593`). The maintainer must confirm this use is acceptable, or name another client.
- **G2, live account.** Step 7 signs in to a real ChatGPT account. Per plan 020 Track A, the maintainer names the account and approves the requests first.

## Why this matters

The maintainer chose Codex as the first provider users connect with their own subscription (`plans/decisions/035-default-model-and-codex-subscriptions.md`). Today "connect" is a stub: `apps/web/src/lib/codex-connection.ts:28-29` returns `{ status: 503, body: { code: "codex_hosted_auth_unverified" } }`, because Codex's browser sign-in redirects to `http://localhost:1455/auth/callback`, which a hosted app cannot receive. OpenAI also offers a **device-code** sign-in: Ditto shows a short code, the user enters it at `https://auth.openai.com/codex/device`, and the server polls until it completes. No localhost callback is involved. This plan builds that flow, plus token renewal, inside the existing credential Durable Object. Tokens stay encrypted in that object and never reach the runtime, the sandbox or the browser. Model discovery and real model requests are plan 038.

## Current state

- `apps/web/src/lib/codex-credential-do.ts` (553 lines): `class CodexCredential extends DurableObject`, one instance per user (`#owned(owner)` checks `idFromName(owner)`). Relevant members:
  - The SQLite table `credential(id=1, owner, generation, renewal, version, status, sealed)` is created in the constructor (lines 60-69). The constructor also turns any `renewing` row into `reconnect_required`, because a spent rotating refresh token cannot be retried.
  - `#authority(owner, generation)` (lines 99-106) is true only when D1 `codex_connections` has that `generation` and `revoked=0`.
  - `#project(state)` (lines 117-131) writes `status` to D1 `codex_connections` for the same generation.
  - `#keyring()` reads the `CODEX_CREDENTIAL_KEYS` and `CODEX_CREDENTIAL_CURRENT_KEY_VERSION` bindings.
  - `protected installFixture(owner, generation, tokens)` (lines 135-171) is the install path to copy. It checks `fixtureAvailable()`, `#owned` and `#authority`; calls `sealCredentials(tokens, owner, generation, this.#keyring(), 1)`; checks `#authority` again; upserts the row as `connected` in `transactionSync`; then calls `storage.sync()` and returns `this.status(owner)`.
  - `protected fixtureAvailable() { return false; }` (132-134), `protected renewalAvailable() { return false; }` (456-458), and `protected async renewUpstream(_tokens: CodexTokens): Promise<CodexTokens> { throw new Error("connection_unavailable"); }` (459-461). Renewal through `ensureFresh` already exists and calls `renewUpstream`.
- `apps/web/src/lib/codex-credential-crypto.ts`: `sealCredentials` and its pair. `CodexTokens` is defined in this file or `codex-credential-do.ts`; read both before Step 2.
- `apps/web/src/lib/codex-connection.ts`: `handleCodexConnection({ authenticatedUserId, body, operations })` accepts exactly one key `action` ∈ `status | disconnect | connect`. `connect` is the stub.
- `apps/web/src/lib/codex-connection-product.ts`: `createCodexConnectionOperations({ DB, CodexCredential })` implements `status` and `disconnect`. `disconnect` commits D1 first (`UPDATE codex_connections SET generation=generation+1,revoked=1,status='disconnected' … RETURNING generation`), then calls the object's `revoke`. Product revocation always wins: follow that order.
- `apps/web/src/lib/codex-connection.functions.ts`: TanStack server function `codexConnection` that authenticates with `createAuth(env).api.getSession` and calls `handleCodexConnection`. No UI calls it yet.
- D1 `codex_connections` (`apps/web/src/db/schema.ts:34-46`): `user_id` PK, `generation`, `revoked`, `status` ∈ `connected | renewing | reconnect_required | disconnected`, `projection_version`, `updated_at`. A pending sign-in can use `reconnect_required` with `revoked=0`, so no migration is needed.
- OpenAI device-code protocol, as implemented by pi-ai 0.85.1 (`packages/sandbox-runner/node_modules/@earendil-works/pi-ai/dist/auth/oauth/openai-codex.js:22-30,112-226`; read it in full before Step 3):
  1. `POST https://auth.openai.com/api/accounts/deviceauth/usercode`, JSON `{ client_id }` → `{ device_auth_id, user_code, interval }`. `interval` may be a numeric string. 404 means device login is not enabled.
  2. Poll `POST https://auth.openai.com/api/accounts/deviceauth/token`, JSON `{ device_auth_id, user_code }`, every `interval` seconds for at most 15 minutes. 200 returns `{ authorization_code, code_verifier }`. 403 or 404, or an error code `deviceauth_authorization_pending`, means pending. `slow_down` means increase the interval. Anything else is a failure.
  3. Exchange: `POST https://auth.openai.com/oauth/token`, form-encoded: `grant_type=authorization_code, client_id, code, code_verifier, redirect_uri=https://auth.openai.com/deviceauth/callback` → access, refresh and ID tokens with expiry.
  4. Refresh: same URL, form `grant_type=refresh_token, refresh_token, client_id`.

  The user opens `https://auth.openai.com/codex/device` to enter the code.
- Test seam: `apps/credential-tests` runs Workers tests with a real `CodexCredential` (`FixtureCredential` subclass in `src/entry.ts`) and `fetchMock` from `cloudflare:test` (used in `product-commands.worker.test.ts`: `fetchMock.activate(); fetchMock.disableNetConnect();`). The connection logic's unit tests are in `apps/web/src/lib/codex-connection.test.ts`.

**Conventions.** Protected hook methods gate production behavior (`fixtureAvailable`, `renewalAvailable`, `requestAvailable`). Follow that pattern: a new `protected deviceAuthAvailable()` returns `this.env.CODEX_DEVICE_AUTH === "1"`, so production stays off unless configured. D1 is committed before the object acts. No token, device ID or code verifier appears in logs, errors, D1 or responses, except the `user_code` the user must see.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install (fresh worktree) | `pnpm install` | exit 0 |
| Web unit test | `pnpm --filter @ditto/web test -- src/lib/codex-connection.test.ts` | all pass |
| Worker test | `pnpm --filter @ditto/credential-tests exec vitest run src/codex-device-auth.worker.test.ts` | all pass |
| Credential typecheck | `pnpm --filter @ditto/credential-tests typecheck` | exit 0 |
| Typecheck / lint | `pnpm typecheck`, `pnpm check` | exit 0 |
| Gate | `pnpm verify` | exit 0 (single rerun allowed for `product-commands`) |

## Scope

**In scope:** `apps/web/src/lib/codex-credential-do.ts`, `codex-credential-crypto.ts` (add device sealing only), `apps/web/src/lib/codex-credential-crypto.test.ts` (create; no crypto test exists today), `apps/web/src/lib/codex-device-auth.test.ts` (create), `codex-connection.ts`, `codex-connection-product.ts`, `codex-connection.test.ts`, `apps/web/src/lib/candidate-session-client.ts` (the one `pending` entry in `CODEX_CONNECTION_VIEWS` only), `apps/web/src/lib/codex-device-auth.ts` (create: pure request builders and response parsers), `apps/credential-tests/src/codex-device-auth.worker.test.ts` (create), `apps/credential-tests/vitest.config.ts` (add `CODEX_DEVICE_AUTH: "1"` binding only), `package.json` (`credentials:verify` file list only), `alchemy.run.ts` (`CODEX_DEVICE_AUTH: process.env.CODEX_DEVICE_AUTH ?? ""` beside the other Codex bindings, nothing else), `plans/evidence/037-codex-device-auth.md` (create).

**Out of scope:** any UI beyond the one `CODEX_CONNECTION_VIEWS` entry (the connect dialog is plan 040); model discovery and model requests (`requestModel`, `codex-request-contract.ts`, plan 038); `apps/runtime/**`; D1 migrations; the browser-redirect flow; any other provider.

## Git workflow

Branch `advisor/037-codex-device-auth` or the one given. Conventional commits (`feat(web): start codex device sign-in`). Do not push.

## Steps

### Step 1: Pure protocol module

Create `apps/web/src/lib/codex-device-auth.ts`. It holds the constants from "Current state" and pure functions:
- builders for the three request types and refresh;
- parsers returning discriminated results: `{ kind: "started", deviceAuthId, userCode, intervalMs }`, `{ kind: "pending" | "slow_down" }`, `{ kind: "authorized", code, verifier }`, `{ kind: "failed", reason }` (`reason` is a fixed code, never response text);
- `parseTokenResponse` → `CodexTokens | null`.

No `fetch` here. Unit-test it in `apps/web/src/lib/codex-device-auth.test.ts` (add to scope) against the pi-ai behaviors listed above, including a string `interval`, the 403/404 pending cases and `slow_down`.

**Verify**: `pnpm --filter @ditto/web test -- src/lib/codex-device-auth.test.ts` → all pass.

### Step 2: Pending sign-in state in the Durable Object

Add a second object-local table `device(id=1, owner, generation, sealed, user_code, interval_ms, next_poll_at, expires_at)`.

`codex-credential-crypto.ts` only seals `CodexTokens` today (`sealCredentials(tokens: CodexTokens, owner, generation, keyring, revision)` at line 88, `openCredentials` at 115). Add `sealDeviceAuth(deviceAuthId, owner, generation, keyring)` and `openDeviceAuth(...)`. Reuse the same AES-GCM key handling, but bind a different purpose string into the additional authenticated data (for example `"codex-device-auth-v1"` versus whatever `sealCredentials` binds). That way a sealed device record can never be opened as tokens, or the reverse. Extract a shared private helper only if it removes duplication; leave `sealCredentials`' output format unchanged. Add a unit test that opening a device record with `openCredentials` fails.

Add `protected deviceAuthAvailable()` (see Conventions).

**Verify**: `pnpm typecheck` → exit 0. `pnpm --filter @ditto/web test -- src/lib/codex-credential-crypto.test.ts` passes, with a token round-trip, a device round-trip and both cross-open failures. `pnpm --filter @ditto/credential-tests exec vitest run src/codex-credential-do.worker.test.ts` still passes.

### Step 3: `startDeviceAuth(owner, generation)` RPC

The method requires `deviceAuthAvailable()`, `#owned` and `#authority(owner, generation)`. It POSTs the user-code request, rechecks `#authority`, stores the pending row (replacing any older one), sets an alarm at `next_poll_at`, and returns the exported type
`DeviceAuthStart = { status: "pending"; generation: number; userCode: string; verificationUri: "https://auth.openai.com/codex/device"; expiresAt: number }` (epoch ms).
On 404 it returns `{ status: "unavailable", generation }`. Any other failure returns `{ status: "reconnect_required", generation }`.

**Pending must be visible.** While a pending sign-in exists, D1 says `reconnect_required`, the same as a failed one, so the UI could not tell waiting from failed. Add `"pending"` to `ConnectionStatus` (`codex-credential-do.ts:27`). Make `status(owner)` return `{ status: "pending", generation }` while an unexpired device row exists for the current generation. Adding the value breaks `CODEX_CONNECTION_VIEWS` (`apps/web/src/lib/candidate-session-client.ts:633-646`, a `Record<ConnectionStatus, …>`). Add exactly one entry there: `pending: { label: "Waiting for sign-in…", action: "connect", verb: "Get a new code" }`. The dialog itself is plan 040.

**Verify**: `pnpm typecheck` → exit 0. Step 6 covers the behavior.

### Step 4: Polling alarm and install

`alarm()` handles a pending device row:
- If `#authority` fails or the row has expired: delete the row and `#project` `disconnected`.
- Otherwise poll once. `pending`: reschedule. `slow_down`: add 5 s to the interval and reschedule. `authorized`: exchange, then install the tokens exactly as `installFixture` does after its checks (seal, recheck `#authority`, upsert `connected` in `transactionSync`, delete the device row in the same transaction, `storage.sync()`, `#project`). `failed`: delete the row and `#project` `reconnect_required`.

`CodexCredential` has no `alarm()` at `44c5739`. If one exists when you start, STOP.

Implement `renewUpstream` with the refresh request, and `renewalAvailable()` as `deviceAuthAvailable()`.

### Step 5: Product `connect`

In `codex-connection-product.ts`, add `connect(owner)`. In one D1 statement, upsert `codex_connections` with `generation = generation+1` (or 1 for a new row), `revoked=0` and `status='reconnect_required'`, `RETURNING generation`. Then call `startDeviceAuth(owner, generation)`. In `codex-connection.ts`, route `connect` to it: return 200 with the pending view, or 503 `{ code: "codex_device_auth_unavailable" }` when the object says unavailable. Keep `codex_hosted_auth_unverified` only for the case where `CODEX_DEVICE_AUTH` is not `"1"`. Update `codex-connection.test.ts`.

**Verify**: `pnpm --filter @ditto/web test -- src/lib/codex-connection.test.ts` → all pass.

### Step 6: Worker tests with mocked OpenAI

Create `apps/credential-tests/src/codex-device-auth.worker.test.ts` using `fetchMock` with net connect disabled (`product-commands.worker.test.ts` is the setup exemplar). Add `CODEX_DEVICE_AUTH: "1"` to the pool bindings and the file to `credentials:verify`. Cases:
1. connect → `DeviceAuthStart` with the mocked `user_code`; the D1 row is `reconnect_required`, `revoked=0`, generation bumped; `status(owner)` returns `pending`;
2. alarm with pending, then slow_down (the next poll is at least 5 s later), then authorized → status `connected`, D1 `connected`, no device row;
3. disconnect during pending → the next alarm installs nothing, and status stays `disconnected`;
4. expiry → `disconnected`, no tokens;
5. an exchange failure → `reconnect_required`;
6. after install, the object's SQLite `sealed` column does not contain the mocked access-token string, and no D1 table contains the device ID or tokens (scan every text column of `codex_connections`);
7. renewal via `ensureFresh` with a near-expiry token calls the refresh mock once and keeps `connected`;
8. with `CODEX_DEVICE_AUTH` unset (construct through a second pool binding only if it already exists; otherwise test `deviceAuthAvailable()` false through the unit test), connect returns the old 503.

**Verify**: the worker test passes. `pnpm --filter @ditto/credential-tests typecheck`, `pnpm typecheck` and `pnpm check` exit 0. `pnpm verify` exits 0.

### Step 7: Live check (only after G1 and G2; otherwise record `not run`)

The maintainer, not the executor, runs this on `pnpm dev` with `CODEX_DEVICE_AUTH=1` and the approved account. They call `codexConnection({ action: "connect" })` from the browser console or a temporary local script, enter the code, and confirm `status` becomes `connected`. Record only `passed`/`failed`, the date and the account class (Plus/Pro/Team). No tokens, codes or emails.

## Done criteria

- [ ] Steps 1–6 verifications pass. `pnpm verify` exits 0 (single `product-commands` rerun allowed).
- [ ] `grep -rn "app_EMoamEEZ73f0CkXaXp7hrann" apps/web/src` → only in `codex-device-auth.ts`
- [ ] `grep -rn "console\.\(log\|error\|warn\)" apps/web/src/lib/codex-device-auth.ts apps/web/src/lib/codex-credential-do.ts` → no new matches
- [ ] With `CODEX_DEVICE_AUTH` unset, `connect` still returns `codex_hosted_auth_unverified` (unit test)
- [ ] `plans/evidence/037-codex-device-auth.md` records Steps 1–6 results and Step 7 as `passed`, `failed` or `not run`
- [ ] Only in-scope files changed; `plans/README.md` 037 row updated

## STOP conditions

- A "Current state" excerpt does not match.
- Adding device sealing would change `sealCredentials`' output format or break an existing sealed-token test (Step 2).
- `CodexCredential` already has an `alarm()` (Step 4).
- Any step seems to need a D1 migration, a UI change, or touching `requestModel`.
- A test shows a token, device ID or code verifier in D1, a response body or a thrown error message.
- Anyone asks you to run Step 7 without G1 and G2 recorded in `plans/README.md`.

## Maintenance notes

- **Users only benefit once the new runtime serves them.** Only the new runtime uses Codex connections. Real users stay on the current engine until 019 retires it and 020's hosted track deploys the runtime. Until then this lands disabled and is reachable only locally.
- **UI is plan 040** (modal, layout A, chosen 2026-10-31). It relies on `DeviceAuthStart` and the `pending` status exactly as defined in Step 3. Changing either means updating 040.
- **Client ID risk.** If OpenAI restricts its CLI client to its own apps, device login can start returning 404 or 403 on step 1. The `unavailable` path keeps that failure visible instead of retrying forever.
- **Renewal rotates refresh tokens.** The constructor's `renewing` → `reconnect_required` rule must stay. A crash mid-refresh forces a reconnect rather than reusing a spent token.
- Reviewers: check product-first ordering on connect and disconnect, the `#authority` rechecks around every await, and that tests assert absence of secrets, not just success.
