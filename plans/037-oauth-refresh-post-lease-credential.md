# Plan 037: Refresh OAuth from the post-lease authoritative credential row

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 2c37ee1..HEAD -- apps/web/src/lib/provider-auth-service.ts apps/web/src/lib/provider-auth-service.test.ts apps/web/src/lib/account-provider-credentials.ts apps/web/src/lib/account-provider-credentials.test.ts apps/web/src/lib/agent-run-service.ts apps/web/src/lib/agent-run-service.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P0
- **Effort**: S
- **Risk**: MED → LOW (full post-lease re-read makes stale-token replay unrepresentable)
- **Depends on**: none (independent of plans 034–036)
- **Category**: bug, security
- **Planned at**: commit `2c37ee1`, 2026-08-01
- **Branch**: `advisor/037-oauth-refresh-post-lease-credential`
- **Execution**: DONE @ `be08692` (reviewer APPROVE)

## Why this matters

OAuth providers often rotate the refresh token on every successful refresh.
`resolveOAuthCredential` today accepts a caller-supplied pre-wait
`stored`/`version` snapshot, waits on the D1 refresh lease, then still feeds
that **stale** snapshot into the sandbox resolve job and into
`updateCredentialUnderLease` / `markNeedsRelogin` CAS.

If concurrent waiter A holds a pre-rotation refresh token while waiter B
completes a refresh that rotates it, A can still send the superseded refresh
token to the provider. Provider-side rotation then bricks the connection even
when D1 CAS later correctly rejects the stale version. This is Workstream 4
**CRED-1** from
`docs/superpowers/specs/2026-07-26-platform-hardening-design.md`.

`upsertCredential` already re-reads the row after acquiring the lease and
writes only against `lease.version`. Mirror that pattern here and remove the
caller snapshot options so the bug cannot be reintroduced at the type level.

## Current state

### Files and roles

- `apps/web/src/lib/provider-auth-service.ts` — `resolveOAuthCredential`
  (production refresh path; lines ~876–1200). Bug lives here.
- `apps/web/src/lib/account-provider-credentials.ts` — lease helpers,
  `upsertCredential` re-read exemplar, `loadCredential`,
  `toRuntimeCredential`, `updateCredentialUnderLease`, `markNeedsRelogin`,
  `releaseLease`.
- `apps/web/src/lib/agent-run-service.ts` — **sole production call site**
  (~322). Passes `owned.credential` / `owned.version` loaded before refresh.
- `apps/web/src/lib/provider-auth-service.test.ts` — existing resolve lease /
  kill / projection tests; extend here.
- `apps/web/src/lib/agent-run-service.test.ts` — mocks
  `resolveOAuthCredential`; only needs call-shape update if options change.
- `apps/web/src/lib/account-provider-credentials.test.ts` — lease/upsert
  contracts; do not rewrite unless a tiny shared helper is extracted (prefer
  not extracting).

### Bug excerpts (confirm before editing)

```ts
// apps/web/src/lib/provider-auth-service.ts — resolveOAuthCredential options
export async function resolveOAuthCredential(options: {
  db: CredentialRepository | Db;
  env: Env;
  userId: string;
  providerId: string;
  stored: StoredCredential;   // <-- caller pre-wait snapshot
  version: number;            // <-- caller pre-wait snapshot
  // ...
}): Promise<
  | { ok: true; runtime: StoredCredential }
  | { ok: false; code: "busy" | "refresh_failed" | "missing" }
> {
  // ...
  const lease = await acquireLeaseWithWait({ /* ... */ });
  if (!lease) return { ok: false, code: "busy" };

  // markFailed CAS uses caller snapshot:
  //   expectedVersion: options.version

  // runResolve / sandbox env uses caller snapshot:
  //   stored: options.stored
  //   env: { DITTO_PI_STORED_CREDENTIAL: JSON.stringify(options.stored) }

  // write CAS uses caller snapshot:
  //   expectedVersion: options.version
}
```

```ts
// apps/web/src/lib/agent-run-service.ts:~307-350 — sole production caller
runtimeCredential = toRuntimeCredential(
  owned.credential,
  parsedModel.providerId,
);
// on expiry throw:
const refreshed = await resolveOAuthCredential({
  db: credentialDb,
  env,
  userId,
  providerId: parsedModel.providerId,
  stored: owned.credential,   // pre-wait
  version: owned.version,     // pre-wait
});
```

### Correct pattern to mirror (`upsertCredential`)

```ts
// apps/web/src/lib/account-provider-credentials.ts:~622-635
const lease = wait
  ? await acquireLeaseWithWait({ /* ... */ })
  : await acquireLease({ /* ... */ });
if (!lease) return "busy";

try {
  // Re-read after lease; write against acquired version only.
  const current = await options.db.getRow(options.userId, options.providerId);
  if (!current || current.leaseId !== lease.leaseId) return "busy";
  if (current.version !== lease.version) return "busy";
  // ... updateRow conditioned on leaseId + lease.version
} finally {
  await releaseLease({ /* lease.leaseId */ });
}
```

`loadCredential` (same file ~516–549) already decrypts + parses a row. Prefer
calling it after the lease rather than hand-rolling decrypt.

### Design constraint (CRED-1) — honor exactly

From `docs/superpowers/specs/2026-07-26-platform-hardening-design.md`:

- Lease acquisition must return or be followed by a fresh authoritative
  credential read.
- The refresh process receives the credential version protected by its lease,
  not caller-supplied pre-wait state.
- Compare-and-set persistence uses that same version.
- A stale caller either consumes the already-refreshed credential or retries
  from fresh state; it must not replay an obsolete rotating refresh token.
- Process-death confirmation and lease-retention behavior remain unchanged
  (`retainLease`, `terminateAuthProcess`, TTL-only release on unconfirmed exit).

### Locked fix shape (do not invent alternatives)

After `acquireLeaseWithWait` succeeds, still holding the lease:

1. **Re-read** authoritative credential via `loadCredential` (or equivalent
   decrypt of `getRow`) using `options.env.AI_CREDENTIALS_ENCRYPTION_KEY`.
2. If missing → `{ ok: false, code: "missing" }` (release lease in `finally`
   as today).
3. If `loaded.version !== lease.version` → `{ ok: false, code: "busy" }`.
4. If row `status !== "connected"` (e.g. `needs_relogin`) → treat as
   refresh-not-viable: `{ ok: false, code: "refresh_failed" }` **without**
   calling the provider. Do not mark needs_relogin again.
5. Try `projectRuntimeCredential(loaded.credential, providerId, { nowMs })`
   (already imported as `toRuntimeCredential as projectRuntimeCredential`).
   - If it succeeds → return `{ ok: true, runtime }` **without** sandbox /
     provider call. Still release lease in `finally`.
   - This is the "concurrent refresh already produced a usable token" path.
6. Otherwise refresh using **`loaded.credential`** (post-lease body) and CAS
   with **`loaded.version` / `lease.version`** (they match after step 3) for:
   - `updateCredentialUnderLease({ expectedVersion: lease.version, ... })`
   - `markNeedsRelogin({ expectedVersion: lease.version, ... })`
7. **Remove** `stored` and `version` from `resolveOAuthCredential` options so
   the bug is unrepresentable. Update the sole production caller and all tests.
8. Keep process-death / `retainLease` / TERM→KILL ordering / destroySandbox
   `finally` **unchanged**.

`runResolve` test hook currently receives `stored: options.stored`. Change it
to receive the post-lease stored credential (same field name, new source).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Drift check | `git diff --stat 2c37ee1..HEAD -- apps/web/src/lib/provider-auth-service.ts apps/web/src/lib/provider-auth-service.test.ts apps/web/src/lib/account-provider-credentials.ts apps/web/src/lib/account-provider-credentials.test.ts apps/web/src/lib/agent-run-service.ts apps/web/src/lib/agent-run-service.test.ts` | empty, or only known concurrent edits you reconcile |
| Focused tests | `pnpm --filter @ditto/web exec vitest run src/lib/provider-auth-service.test.ts src/lib/agent-run-service.test.ts` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint/format | `pnpm check` | exit 0 (pre-existing warnings OK if count does not grow from this change) |
| Full web tests (if cheap) | `pnpm test` | exit 0, or same pre-existing failures only — do not "fix" unrelated tests |

## Suggested executor toolkit

- Keep the change inside Worker credential code. Do not touch sandbox-runner
  provider-auth CLI contracts unless a type forces it (it should not).
- Style exemplar for resolve tests: existing cases in
  `apps/web/src/lib/provider-auth-service.test.ts` (`createTestRepo`, `upsertCredential`,
  `loadCredential`, `runResolve` hook).
- Design reference (data only): CRED-1 section of
  `docs/superpowers/specs/2026-07-26-platform-hardening-design.md`.

## Scope

**In scope** (the only files you should modify):

- `apps/web/src/lib/provider-auth-service.ts`
- `apps/web/src/lib/provider-auth-service.test.ts`
- `apps/web/src/lib/agent-run-service.ts` (drop `stored`/`version` args only)
- `apps/web/src/lib/agent-run-service.test.ts` (only if call/mock types break)
- `plans/README.md` (status row for 037)

**Out of scope** (do NOT touch):

- `account-provider-credentials.ts` lease primitives, schema, encryption —
  reuse as-is. No new abstraction layer.
- CRED-2/3 crypto key separation, Better Auth token encryption.
- CRED-4/5 provider contract parity / broader boundary suites.
- Sandbox runner, Docker image, agent stream route, UI.
- Changing `AUTH_RESOLUTION_TIMEOUT_MS`, lease TTL/wait constants, or kill
  grace behavior.
- Logging or returning raw refresh/access token material.

## Git workflow

- Branch: `advisor/037-oauth-refresh-post-lease-credential`
- Commit style (from recent history): conventional commits, e.g.
  `fix(auth): refresh OAuth from post-lease credential`
- One or two commits is enough (implementation + tests can be one commit).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Drift check

Run the drift-check command in the executor instructions. If
`resolveOAuthCredential` no longer takes `stored`/`version`, or the agent-run
call site no longer passes them, STOP — the bug may already be fixed or the
shape drifted.

**Verify**: drift output empty **or** you have manually diffed and confirmed
excerpts still match.

### Step 1: Make `resolveOAuthCredential` self-load post-lease state

In `apps/web/src/lib/provider-auth-service.ts`:

1. Import `loadCredential` from `#/lib/account-provider-credentials` (add to the
   existing import list; `toRuntimeCredential` is already imported as
   `projectRuntimeCredential`).
2. Change the public options type to:

```ts
export async function resolveOAuthCredential(options: {
  db: CredentialRepository | Db;
  env: Env;
  userId: string;
  providerId: string;
  nowMs?: () => number;
  createId?: () => string;
  deps?: AuthDeps;
  runResolve?: (args: {
    job: Record<string, unknown>;
    stored: StoredCredential;
    timeoutMs: number;
    signal: AbortSignal;
    terminate: (proc: AuthProcess) => Promise<void>;
  }) => Promise<
    | { ok: true; resultJson: string }
    | { ok: false; timedOut?: boolean; code?: string }
  >;
}): Promise<
  | { ok: true; runtime: StoredCredential }
  | { ok: false; code: "busy" | "refresh_failed" | "missing" }
>
```

3. Immediately after a successful `acquireLeaseWithWait` (and before starting
   any sandbox / `runResolve`), insert:

```ts
const loaded = await loadCredential({
  db: repo,
  userId: options.userId,
  providerId: options.providerId,
  encryptionKey: options.env.AI_CREDENTIALS_ENCRYPTION_KEY,
});
if (!loaded) return { ok: false, code: "missing" };
if (loaded.version !== lease.version) return { ok: false, code: "busy" };
if (loaded.status !== "connected") {
  return { ok: false, code: "refresh_failed" };
}

try {
  const runtime = projectRuntimeCredential(
    loaded.credential,
    options.providerId,
    { nowMs: nowMs() },
  );
  return { ok: true, runtime };
} catch {
  // still expired / not usable — fall through to provider refresh
}

const authoritative = loaded.credential;
const expectedVersion = lease.version; // === loaded.version
```

4. Replace every use of `options.stored` with `authoritative`.
5. Replace every use of `options.version` in CAS paths
   (`markNeedsRelogin`, `updateCredentialUnderLease`) with `expectedVersion`
   / `lease.version`.
6. Production sandbox session env must serialize `authoritative`, not a caller
   snapshot:

```ts
env: {
  DITTO_PI_STORED_CREDENTIAL: JSON.stringify(authoritative),
},
```

7. `runResolve` hook:

```ts
stored: authoritative,
```

8. Do **not** restructure the try/finally kill and `retainLease` logic. Early
   returns for missing/busy/already-usable must still flow through the existing
   `finally` that releases the lease when `!retainLease` (today `retainLease`
   starts false and process handles are unset on the early path — confirm
   release still runs).

**Verify**: `pnpm typecheck` fails only on call sites still passing
`stored`/`version` (expected until Step 2), or passes if you do Step 2 in the
same edit.

### Step 2: Update the sole production caller

In `apps/web/src/lib/agent-run-service.ts` (~322):

```ts
const refreshed = await resolveOAuthCredential({
  db: credentialDb,
  env,
  userId,
  providerId: parsedModel.providerId,
});
```

Keep the surrounding `toRuntimeCredential` try/catch and 409 mapping unchanged.

**Verify**:

```bash
rg -n "resolveOAuthCredential\(" apps/web --glob '*.ts'
```

Only the definition, the agent-run call site (no `stored`/`version`), and tests
remain. No production caller may pass `stored` or `version`.

```bash
rg -n "stored:|version:" apps/web/src/lib/agent-run-service.ts apps/web/src/lib/provider-auth-service.ts
```

`resolveOAuthCredential`'s options type must not declare `stored`/`version`.
Internal locals named `stored` after parsing the resolve result JSON are fine.

### Step 3: Fix existing resolve tests for the new signature

In `apps/web/src/lib/provider-auth-service.test.ts`, every
`resolveOAuthCredential({ ..., stored: ..., version: ... })` call must drop
those two fields. The tests already `upsertCredential` + `loadCredential`
before calling resolve — keep that setup (it seeds D1); just stop passing the
snapshot into resolve.

`runResolve` callbacks that need the credential body must read
`args.stored` from the hook (post-lease), not a closed-over pre-call snapshot,
**in the new regression tests below**. Existing tests that ignore `stored` can
stay as-is aside from the signature change.

If `agent-run-service.test.ts` asserts on mock call args including
`stored`/`version`, update those expectations. The default mock at the top of
the file needs no change unless TypeScript complains.

**Verify**: existing focused suite mostly green before adding new cases:

```bash
pnpm --filter @ditto/web exec vitest run src/lib/provider-auth-service.test.ts src/lib/agent-run-service.test.ts
```

### Step 4: Add CRED-1 regression tests

Add tests to `apps/web/src/lib/provider-auth-service.test.ts` (same
`createTestRepo` / clock / KEY helpers). Concrete scenarios:

#### 4a. Re-read ignores caller snapshot (type-level + behavioral)

Because `stored`/`version` are removed, prove behaviorally:

- Seed row with refresh token `"refresh-authoritative-aa"`, version N, access
  already expired (so `toRuntimeCredential` throws).
- Call `resolveOAuthCredential` **without** any credential body.
- In `runResolve`, assert `args.stored` equals the DB credential
  (`refresh === "refresh-authoritative-aa"`), then return a successful rotate
  payload with a new refresh/access and far-future `expires`.
- Expect `ok: true` and D1 row version N+1 with the new stored refresh.

#### 4b. Short-circuit after concurrent refresh (no provider call)

Simulates waiter that lost the race:

1. Upsert oauth credential with **already-usable** access
   (`expires: clock.value + 3_600_000`), refresh `"refresh-v1"`, version 1.
2. Manually bump the in-memory row as a concurrent refresher would:
   - set refresh to `"refresh-v2-rotated"`, access still far-future,
   - `version = 2` (and ensure lease is free so waiter acquires version 2).
3. Call `resolveOAuthCredential` with a `runResolve` that **throws** if invoked
   (or pushes to an `called` flag).
4. Expect `{ ok: true, runtime }` with projected runtime
   (`refresh: "ditto:no-refresh"`, access from post-lease body).
5. Expect `runResolve` **not** called.
6. Expect D1 version still 2 (no extra write).

Implementation tip: easiest setup is upsert usable token at version 1, then
`updateCredentialUnderLease` under a brief lease to rotate to version 2 with a
still-usable access, release lease, then call resolve. Or directly mutate the
test repo map the way `"stale refresh failure after reconnect..."` already does,
as long as `loadCredential` decrypts whatever you write — prefer going through
`updateCredentialUnderLease` / `upsertCredential` so encryption stays valid.

#### 4c. Still-expired post-lease row refreshes with leased version

1. Upsert expired oauth (access near/past window) version 1, refresh `"r-old"`.
2. `runResolve` returns new stored credential with refresh `"r-new"` and
   far-future access.
3. Expect success, runtime projected from new stored, D1 version 2, and
   `runResolve` received `stored.refresh === "r-old"` (the leased body).

#### 4d. Never replay a pre-wait refresh token after rotation during wait

This is the brick-the-connection scenario:

1. Upsert expired oauth version 1, refresh `"refresh-pre-wait"`.
2. Hold a lease externally (`acquireLease`) so `acquireLeaseWithWait` must poll.
3. While the wait is in flight (use injectable `deps.sleep` / fake clock if the
   resolve path threads them — today `resolveOAuthCredential` does **not**
   forward `sleep`/`tick` into `acquireLeaseWithWait`).

**Practical approach that stays inside current APIs (prefer this):**

Do not try to interleave a real multi-task wait unless you extend options.
Instead, simulate "wait completed after concurrent refresh" by:

1. Starting from version 1 expired with refresh `"refresh-pre-wait"`.
2. Before calling resolve, perform a full concurrent refresh yourself:
   acquire lease, `updateCredentialUnderLease` to version 2 with
   refresh `"refresh-post-wait"` and **still-expired** access (so short-circuit
   cannot succeed), release lease.
3. Call `resolveOAuthCredential` with `runResolve` that:
   - records `args.stored.refresh`
   - returns success rotating to `"refresh-final"` with far-future access
4. Assert `args.stored.refresh === "refresh-post-wait"` (not `"refresh-pre-wait"`).
5. Assert final D1 refresh is `"refresh-final"` at version 3.

If you truly want an in-wait mutation, you may add an **optional** test-only
pass-through of `sleep`/`tick` on `resolveOAuthCredential` →
`acquireLeaseWithWait` — but only if the practical approach above is somehow
impossible. Prefer not adding test knobs.

#### 4e. Version skew after lease → busy

1. Upsert credential.
2. Call resolve with `runResolve` unused.
3. Inside a thin repo wrapper OR by patching `db.getRow` after lease acquisition
   is awkward; simpler: after acquire, if you can inject a repo whose
   `getRow` returns `version: lease.version + 1` while lease held — expect
   `{ ok: false, code: "busy" }` and **no** `runResolve`.

If skew is hard to inject without a custom repo, it is acceptable to cover skew
indirectly via 4b/4d and a unit assertion that `loaded.version !== lease.version`
returns busy — but prefer an explicit test with a wrapping
`CredentialRepository`.

#### 4f. Existing kill / retainLease tests still pass

Do not weaken:

- timeout kills process before lease release
- unconfirmed kill retains lease
- TERM-confirmed failure marks needs_relogin
- stale failure after reconnect does not mark needs_relogin
- runtime projection / near-expiry rejection

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/lib/provider-auth-service.test.ts src/lib/agent-run-service.test.ts
```

All pass, including ≥3 new CRED-1 cases (4a, 4b, 4d required; 4c/4e strongly
preferred).

### Step 5: Full gates

```bash
pnpm typecheck
pnpm check
pnpm --filter @ditto/web exec vitest run src/lib/provider-auth-service.test.ts src/lib/agent-run-service.test.ts
```

Optional if fast enough:

```bash
pnpm test
```

**Verify**: typecheck 0, check 0 (no new warnings from this change), focused
tests 0 failures. Update `plans/README.md` Plan 037 status to DONE (or
IN PROGRESS → DONE).

## Test plan

| Case | File | Intent |
|------|------|--------|
| Post-lease body fed to resolve | `provider-auth-service.test.ts` | `runResolve` sees DB credential, not a removed caller field |
| Short-circuit usable post-lease | same | no provider call after concurrent success |
| Refresh when still expired | same | CAS at leased version; success path |
| No pre-wait token replay | same | after concurrent rotation, only new refresh is sent |
| Version skew → busy | same | no provider call |
| Prior kill/lease tests | same | retainLease / needs_relogin unchanged |
| Agent-run still refreshes on expiry | `agent-run-service.test.ts` | mock still invoked; no `stored`/`version` required |

Model structural style after existing resolve tests in
`provider-auth-service.test.ts` (in-memory `createTestRepo`, fake clock, KEY).

Never assert full raw token dumps in failure messages beyond the fixed test
fixtures already used in-file.

## Done criteria

- [ ] `resolveOAuthCredential` options do **not** accept `stored` or `version`
- [ ] After lease, function re-reads via `loadCredential` (or equivalent decrypt)
- [ ] Provider/sandbox refresh input is always the post-lease credential body
- [ ] CAS (`updateCredentialUnderLease`, `markNeedsRelogin`) uses post-lease /
      `lease.version`
- [ ] Usable post-lease credential short-circuits with no provider call
- [ ] Version skew / missing row → `busy` / `missing` without provider call
- [ ] `retainLease` / TERM→KILL / unconfirmed-exit behavior unchanged
- [ ] Sole production caller `agent-run-service.ts` updated
- [ ] `rg -n "stored:" apps/web/src/lib/agent-run-service.ts` shows no
      `resolveOAuthCredential` snapshot pass
- [ ] Focused vitest command exits 0 with new CRED-1 cases
- [ ] `pnpm typecheck` exit 0
- [ ] `pnpm check` exit 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` Plan 037 status updated

## STOP conditions

Stop and report back (do not improvise) if:

- Drift check shows `resolveOAuthCredential` or lease helpers no longer match
  the excerpts (especially if someone already removed `stored`/`version` or
  changed lease semantics).
- You find a second production caller of `resolveOAuthCredential` that needs
  behavior beyond dropping snapshot fields.
- Correctness appears to require changing `updateCredentialUnderLease`,
  lease TTL, or sandbox-runner resolve job schema.
- `loadCredential` cannot run under an held lease (it should — it only reads).
- A step's verification fails twice after a reasonable fix attempt.
- Fix seems to need files outside the in-scope list.
- You believe short-circuit should refresh anyway "to be safe" — no; CRED-1
  explicitly wants consume-or-retry, never replay.

## Maintenance notes

- Reviewers: focus on (1) no path still serializes a pre-lease credential into
  `DITTO_PI_STORED_CREDENTIAL`, (2) CAS version source is exclusively
  post-lease/`lease.version`, (3) kill/retainLease ordering diff is empty or
  trivial, (4) tests fail if someone re-adds caller snapshot parameters.
- Future callers must not reintroduce snapshot parameters; if a batch refresh
  API appears, it must also re-read under its own lease.
- CRED-2/3 (token encryption / key separation) and CRED-4/5 (contract parity)
  remain separate plans; this change must not entangle them.
- If lease wait injection becomes necessary for more elaborate concurrency
  tests later, add optional `sleep`/`tick` forwarding in a follow-up — not
  required for this plan's practical 4d setup.
