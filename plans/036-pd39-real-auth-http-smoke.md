# Plan 036: Prove the agent API routes authenticate real Better Auth cookies (PD39)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the 036 row in
> `plans/README.md`, unless a reviewer dispatched you and said they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat 44c5739..HEAD -- apps/web/src/routes/api.agent.*.ts apps/web/src/lib/auth.ts apps/web/src/lib/session-runtime-client.ts apps/credential-tests package.json`
> If any listed file changed, compare the "Current state" excerpts with the
> live code. A mismatch is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (test-only, plus one `package.json` script line)
- **Depends on**: none. It may run before or after 035; if after, re-run the drift check.
- **Category**: tests
- **Planned at**: commit `44c5739`, 2026-10-31

## Why this matters

Spec test PD39 (`docs/specs/pi-durable-session-runtime.md:926`) requires a "real-auth HTTP smoke with missing, expired, foreign, and valid sessions … separately from injected-auth tests". Today no test checks a real session cookie. Every route test replaces the auth module (`apps/web/src/routes/api.agent.observe.test.ts:20`: `vi.mock("#/lib/auth", () => ({ createAuth: createAuthMock }))`), so a broken cookie name, secret or expiry check would ship unnoticed. This plan adds one worker-runtime test that sends real signed cookies through the real route handlers against a real local D1, and checks that unauthorized requests write nothing.

## Current state

- Five route handlers authenticate the same way. Each calls `createAuth(env).api.getSession({ headers: request.headers })` and returns `jsonResponse({ error: "Unauthorized" }, 401)` when `!session?.user`:
  - `apps/web/src/routes/api.agent.control.ts:36-39` (POST)
  - `apps/web/src/routes/api.agent.observe.ts:22-25` (POST)
  - `apps/web/src/routes/api.agent.workspace-action.ts:22-25` (POST)
  - `apps/web/src/routes/api.agent.models.ts:22-25` (POST)
  - `apps/web/src/routes/api.agent.stream.ts:42-49` (GET) and `:83-90` (POST). The POST hands versioned candidate bodies to `handleCandidateCommandRequest({ service: resolveCandidateProductCommands(), authenticatedUserId: session.user.id, body: raw })` (`:110-118`).
- Each route module is `export const Route = createFileRoute("/api/agent/…")({ server: { handlers: { POST: async ({ request }) => … } } })`, importing `env` from `cloudflare:workers` and `createFileRoute` from `@tanstack/react-router`. The existing unit tests capture the handler by mocking `createFileRoute` (`api.agent.observe.test.ts:5-19`). Reuse that trick.
- `apps/web/src/lib/auth.ts`:
  ```ts
  export function createAuth(env: Env) {
  	const db = createDb(env);
  	return betterAuth({
  		secret: env.BETTER_AUTH_SECRET,
  		baseURL: env.BETTER_AUTH_URL || undefined,
  		database: drizzleAdapter(db, { provider: "sqlite", schema }),
  		socialProviders: { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } },
  		plugins: [tanstackStartCookies()],
  	});
  }
  ```
  `better-auth` is 1.6.23 and its `better-call` is 1.3.7. `better-call` exports `serializeSignedCookie(key, value, secret, opt?)` (`dist/cookies.d.mts:100`), but it is not a dependency of `@ditto/credential-tests`. Do not add it. Sign the cookie with WebCrypto as described in Step 2.
- Candidate commands are resolved per request from an AsyncLocalStorage: `withSessionRuntimeResolution({ candidateCommands }, run)` in `apps/web/src/lib/session-runtime-client.ts:243-249`. Production sets it in `apps/web/src/server.ts:169-176`.
- The worker test pool, `apps/credential-tests/vitest.config.ts`, has: D1 `DB`; `BETTER_AUTH_SECRET: "synthetic-034-auth-secret"`; service binding `CandidateProduct` → entrypoint `CandidateFixtureProduct` (implements `admitOwned`, `observeOwned`, `workspaceActionOwned`, `modelsOwned`, `deleteProjectOwned`); the `CodexCredential` DO; `CANDIDATE_DISPOSABLE: "008-synthetic"`. Tests include `src/**/*.worker.test.ts`. `tsconfig.json` maps `#/*` to `../web/src/*`.
- Exemplars to copy, not import:
  - Migrations for every test: `apps/credential-tests/src/candidate-baseline.worker.test.ts:10-15` (the `import.meta.glob("../../web/migrations/*.sql", { query: "?raw", import: "default", eager: true })` with its `@ts-expect-error`) and `:73-80` (split on `--> statement-breakpoint`, strip `--` comment lines, `env.DB.exec`).
  - The owner, project, Codex connection and fake-account rows, plus `CodexCredential.install`: `apps/credential-tests/src/product-commands.worker.test.ts:207-231`. The fake account object it binds is defined earlier in the same file. Copy it.
  - The prompt body: `product-commands.worker.test.ts:136-142` (`{ version: 2, kind: "prompt", projectId: "project", idempotencyKey: "first", text: "Synthetic admitted command" }`).
  - Row counting with zero-row assertions: `product-commands.worker.test.ts:143-159` (`counts()`), and the foreign-owner case at `:494-505`, where a foreign prompt is refused with `code: "model_unconfigured"` and `counts()` stays all zeros.
- `package.json:21` `credentials:verify` lists each worker test file explicitly. A new file must be added there to run in CI.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install (fresh worktree) | `pnpm install` | exit 0 |
| Run the new test | `pnpm --filter @ditto/credential-tests exec vitest run src/pi-durable-auth-http.worker.test.ts` | all pass |
| Test-package typecheck | `pnpm --filter @ditto/credential-tests typecheck` | exit 0 |
| Lint/format | `pnpm check` | exit 0 |
| Credential gate | `pnpm credentials:verify` | exit 0 (known `product-commands` flake: rerun that file once) |

## Scope

**In scope:**
- `apps/credential-tests/src/pi-durable-auth-http.worker.test.ts` (create)
- `package.json`: append the new file to `credentials:verify` only
- `plans/evidence/036-pd39-auth-http.md` (create)

**Out of scope:**
- Every file under `apps/web/src`. This plan proves current behavior; it changes no product code. If a real-cookie case fails, that is a finding: STOP.
- A shared `requireUser` helper. Considered and deferred: PD39 must prove each route, so the helper is not needed now.
- `apps/credential-tests/vitest.config.ts`. If the test needs a new binding, STOP.
- Browser automation, GitHub OAuth, or any network call.

## Git workflow

- Work on the branch you were given or `advisor/036-pd39-auth-http`.
- Conventional commits, e.g. `test(credentials): cover real auth cookies on agent routes`, then `docs(plans): record 036 evidence`.
- Do not push.

## Steps

### Step 1: Load one route in the worker pool

Create the test file. At the top, mock only `@tanstack/react-router` so `createFileRoute` captures the options, the same way as `api.agent.observe.test.ts:5-19`, but capture all five routes into a map keyed by path. Then `await import()` the five route modules through relative paths (`../../web/src/routes/api.agent.control.ts`, and so on). Do **not** mock `#/lib/auth` or `cloudflare:workers`.

Add a single smoke `it` that asserts the `/api/agent/observe` POST handler exists.

**Verify**: run the new test → 1 passed. If the import fails on `@tanstack/react-start` or `better-auth/tanstack-start`, apply the fallback in STOP condition 2 and record it in evidence.

### Step 2: Real sessions and signed cookies

In `beforeEach`: apply all migrations (exemplar above), insert two users `owner` and `intruder`, the `owner` project, the owner's Codex connection and fake account, and run `CodexCredential.install` (exemplar `:207-231`).

Helpers:
- `async function sessionCookie(userId, expiresAt)`: build `const auth = createAuth(env)` (import `createAuth` from `../../web/src/lib/auth`), then `const ctx = await auth.$context`. Create the session row with `ctx.internalAdapter.createSession(userId)`. If `expiresAt` is in the past, `UPDATE session SET expiresAt=? WHERE token=?` afterwards. Take the cookie name from `ctx.authCookies.sessionToken.name`. Sign the way better-call 1.3.7 does: read `node_modules/.pnpm/better-auth@1.6.23_*/node_modules/better-call/dist/cookies.mjs` (`serializeSignedCookie` and the signing function it calls) and reproduce the value format with `crypto.subtle` HMAC-SHA256 and the pool's `env.BETTER_AUTH_SECRET`. Return `${name}=${value}`.
- `async function call(path, method, init: { cookie?: string; body?: unknown; search?: string })`: build a `Request` to `http://localhost:5173${path}${search ?? ""}` with the JSON body and optional `cookie` header. Invoke the captured handler inside `withSessionRuntimeResolution({ candidateCommands: env.CandidateProduct }, () => handler({ request }))`.

**Verify**: a temporary assertion that `await auth.api.getSession({ headers: new Headers({ cookie }) })` returns `user.id === "owner"` for a valid cookie passes. This proves the signature format before any route assertions. Keep it as a real test case named "signed test cookie is accepted by Better Auth".

### Step 3: The PD39 matrix

For each of the six handlers (control POST, observe POST, workspace-action POST, models POST, stream GET, stream POST):

1. **Missing**: no cookie → status 401.
2. **Expired**: the owner's cookie whose session `expiresAt` is one minute in the past → 401.
3. **Tampered**: the owner's valid cookie with the last signature character changed → 401.

After each case, `counts()` (copied from the exemplar) equals all zeros, and `SELECT count(*) FROM privileged_operations` is 0.

Then, for the prompt route (stream POST, with the `prompt` body):

4. **Foreign**: the intruder's valid cookie, sending the prompt for the owner's `project` → non-2xx, body `code` is `model_unconfigured` (the code the service gives a foreign owner; see the exemplar at `:501-503`), and `counts()` is all zeros.
5. **Valid**: the owner's valid cookie → status 202, and `SELECT count(*) FROM session_commands` is 1.

For observe, workspace-action and models, also run case 4 with a fabricated `sessionId`: the response is non-2xx and writes no rows. Assert the exact status and code each route returns today. Read them from the first run, then pin them in the test and list them in the evidence. The test fails if any of these ever turns 2xx.

**Verify**: run the new test → all pass. Then make each case fail on purpose once and confirm it goes red, reverting each change afterwards. This proves the assertions bite:
- Sign the owner's cookie with `"wrong-secret"` instead of `env.BETTER_AUTH_SECRET`: case 5 fails (401).
- Skip the past-expiry update: case 2 fails.

Do not commit these edits.

### Step 4: Add to the credential gate and record evidence

Append `src/pi-durable-auth-http.worker.test.ts` to the `vitest run` file list in `package.json`'s `credentials:verify`, after `src/candidate-preview.worker.test.ts`.

Write `plans/evidence/036-pd39-auth-http.md`:
- the command and its pass count;
- the status/code table per route and case;
- the two deliberate-failure checks from Step 3 (`passed` / `failed` / `not run`);
- whether the Step 1 fallback was used;
- one line labeling case 5 as fixture-backed admission (the `CandidateFixtureProduct` binding), with authentication real throughout.

**Verify**: `pnpm --filter @ditto/credential-tests typecheck` → exit 0. `pnpm check` → exit 0. `pnpm credentials:verify` → exit 0, with the single-rerun allowance for `product-commands`.

## Test plan

The test file is the deliverable. It has 1 cookie-format case plus 6 handlers × 3 unauthenticated cases, plus foreign and valid on the prompt route, plus foreign on observe, workspace-action and models. Model the setup on `product-commands.worker.test.ts` and `candidate-baseline.worker.test.ts`. Every case asserts both the status and the absence of writes, so a test that "passes" with a 200 and new rows is impossible.

## Done criteria

- [ ] `pnpm --filter @ditto/credential-tests exec vitest run src/pi-durable-auth-http.worker.test.ts` → all pass, at least 23 tests
- [ ] `grep -n 'vi.mock("#/lib/auth"\|vi.mock("cloudflare:workers"' apps/credential-tests/src/pi-durable-auth-http.worker.test.ts` → no matches
- [ ] `grep -n "pi-durable-auth-http.worker.test.ts" package.json` → present in `credentials:verify`
- [ ] `pnpm --filter @ditto/credential-tests typecheck` and `pnpm check` exit 0
- [ ] `git status --porcelain` lists only in-scope files
- [ ] `plans/evidence/036-pd39-auth-http.md` exists with the per-route table
- [ ] `plans/README.md` 036 row updated

## STOP conditions

1. A "Current state" excerpt does not match the live code.
2. Importing a route module fails in the pool. If the failure is inside `better-auth/tanstack-start` or `@tanstack/react-start` (the cookie-setting plugin), you may mock **only** `better-auth/tanstack-start` as `{ tanstackStartCookies: () => ({ id: "tanstack-start-cookies" }) }`. That plugin only sets cookies on responses; reading and verifying cookies is Better Auth core. Record this in evidence. Any other import failure: STOP.
3. `auth.$context`, `internalAdapter.createSession` or `authCookies.sessionToken.name` does not exist in 1.6.23. Report what does exist. Do not hand-insert session rows with guessed column names.
4. The "signed test cookie is accepted" case cannot pass after reproducing better-call's format. Report both the produced value's shape (not the secret) and the better-call function source location.
5. Any unauthenticated, expired, tampered or foreign case returns 2xx or writes a row. That is a real auth bug: stop, report the route and case, and do not fix product code in this plan.
6. The test needs a binding or config change in `vitest.config.ts`.

## Maintenance notes

- New agent routes must be added to this matrix. A reviewer should reject a new `api.agent.*` route without a PD39 case.
- If 035 or later work changes the prompt route's response for a valid owner (for example, the default model makes candidate admission succeed without Codex), update case 5's expected status, not the auth cases.
- The cookie signer mirrors better-call 1.3.7. A Better Auth upgrade that changes signing makes the "signed test cookie is accepted" case fail first; fix the helper there.
- Deferred: a shared `requireUser(request, env)` would put the five copies of the auth check in one place. If a sixth route appears, plan it then.
