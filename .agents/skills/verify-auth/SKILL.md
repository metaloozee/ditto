---
name: verify-auth
description: Drives Ditto's sign-up, sign-in, sign-in-method linking and sessions (GitHub, Google, email codes) in a real browser against an isolated local Worker and D1, and proves each outcome on screen, in the inbox and in the database. Use after any edit to auth.ts, email-code.ts, the sign-in, sign-up, settings or account routes, the auth schema or migrations, or when asked to verify auth.
---

# Verify auth

A run starts the **real** Worker (`alchemy dev --stage test`) on a fresh, migrated local D1. The Worker calls fake GitHub, Google and Resend servers, reusing `apps/web/tests/auth/fake-upstream.ts`. Each journey then signs up, signs in, links methods and signs out through the UI, the way a user would. A journey is **green** only when three things agree: what the user sees, what the fake inbox received, and what D1 now holds.

Run everything from the repo root. `A=.claude/skills/verify-auth/scripts/auth.sh`.

## 1. Launch

`$A up` starts the fake upstream, then the Worker on `http://localhost:1339`, and waits until the stage is usable: `/sign-in` renders, `/api/auth/get-session` answers `null`, and the D1 file exists. Local startup requires Docker for the workspace Container image. Allow up to three minutes for the Worker to become ready.

- **Isolation.** Alchemy keeps state and the local D1 under its cwd's `.alchemy`, so `up` runs it from `.scratch/verify-auth/stage-<port>/`. The stage shares nothing with `vp run dev` (port 1337, the repo's `.alchemy`) or the auth test suite (port 1338). Each `up` begins on an empty D1. To run beside another instance, set `VERIFY_AUTH_PORT=<free port>` on every `$A` call.
- **No secrets.** `up` passes `--env-file /dev/null` and test-only credentials, so the user's `.env`, real OAuth apps and Resend are never touched.
- **Knobs.** The session lifetime is 30s, codes last 10s and a resend waits 3s, so expiry is observable. Override them with `VERIFY_AUTH_SESSION_EXPIRES_IN`, `VERIFY_AUTH_CODE_EXPIRES_IN` and `VERIFY_AUTH_CODE_RESEND_IN`, set on both `up` and `check`.
- **Refusal.** `up` refuses a port held by a process it did not start. It reuses its own instance.

Done when `up` prints `up: http://localhost:1339 (upstream …, d1 …)`.

## 2. Doctor

Run `$A doctor` first, and again whenever a run looks wrong. It is read-only. Every line must read `ok`; a `note` line is information only. It checks:

- the listener on the port descends from the process `up` started, and the fake upstream is alive;
- the fake Resend inbox answers;
- `/sign-in` renders and `get-session` answers `null`;
- `/settings` redirects a signed-out visitor to `/sign-in`;
- D1 has `user`, `account`, `session`, `verification` and `rate_limit`;
- Node is 24 or later and Playwright's Chromium is installed;
- whether app sources have uncommitted edits. The stage serves the working tree.

## 3. Drive

- `$A check` runs every journey in headless Chromium. It takes about 2.5 minutes, of which `session-expiry` waits 32s.
- Exit codes: `0` all passed, `1` a journey failed, `2` the run broke (a precondition, or an unknown id).
- `$A check --only link-email,link-rejected` runs a subset. `--list` prints the ids, `--headed` shows the browser, and `--out DIR` picks the evidence directory.

[`features/README.md`](features/README.md) maps each journey id to the user journey it covers. Each feature file there gives the exact path and its gotchas. Read the file before trusting or debugging a journey.

To inspect state by hand, run `$A sql "select email, name from user"`. It is a read-only query against the stage's D1.

**Proof standard.** Every journey goes through the UI: real clicks, real redirects through the fake consent screens, codes read from the fake inbox and typed into the `Code` field. A few facts are read only from outside: `get-session` with the browser's own cookies, a public HTTP status, and D1 rows. Nothing calls app internals or writes D1. A green result needs all three views to agree.

Done when every id you were asked to cover printed `PASS`, or each `FAIL` is explained (step 4).

## 4. Read a red

- **`expected to see "<text>" … page is <url>`**: the user-visible outcome changed. Open that journey's `fail-page<N>.png`. A changed copy string and a changed behaviour both land here. Decide which one before you touch the check.
- **`<label>: got …, want …`**: a D1, session or inbox fact differs. Labels that start with `D1` are side effects the UI cannot show, such as methods linked, sessions revoked or profiles overwritten. Treat them as the most serious reds.
- **`Precondition:`** means the environment, not auth. Run `$A doctor`, fix what it reports, and rerun.

When the user confirms a behaviour change was intended, update the journey in `scripts/auth-check.mjs` and its feature file in the same change. A journey is never weakened to make it pass. If a journey needs state the stage cannot produce, report it as unverified and say why.

## 5. Evidence

Each run writes `.scratch/verify-auth/runs/<timestamp>/` (gitignored):

- `report.md` and `report.json` hold every fact with its measured value.
- `<journey>/NN-<state>.png` and `.aria.yml` are the screen and its accessibility tree at each step.
- `<journey>/emails-<address>.json` holds what the Worker sent. Codes are redacted to `######`.
- `<journey>/facts.json`, plus `fail-page<N>.png` when the journey failed.

Cite the `report.md` path and the PASS/FAIL lines as proof.

## 6. Cleanup

`$A down` stops the process trees that `up` started and nothing else, then deletes `.scratch/verify-auth/stage-<port>/`, which holds the D1 and logs. Run it after every session, including failed ones. Evidence in `.scratch/verify-auth/runs/` is kept. Each journey closes its own browser contexts, and the browser closes at the end of the run.
