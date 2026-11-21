# Sessions

`/`, `/settings` and `/settings/verify-email` require a session, checked on the server. `/design`, `/design/auth` and `/design.md` stay public. A session survives a refresh, and each device has its own. Sign-out revokes the current session on the server, so a copied cookie stops working. A session ends after `SESSION_EXPIRES_IN` of inactivity.

## Sub-features

- `protected-routes`: signed-out HTTP requests to each protected path get a 3xx to `/sign-in`, and the public paths return 200. A signed-out browser opening `/settings` lands on `/sign-in`.
- `session-lifecycle`: a laptop and a phone (Pixel 7) sign in as one GitHub user, and D1 holds 2 sessions. A refresh stays on `/`. The cookie is HttpOnly, host-only `localhost` and `Lax`. `Sign out` shows `Signed out`, and D1 drops to 1 session. The phone stays on `/`. The laptop's copied cookie gives `get-session` `null` and lands on `/sign-in`.
- `session-expiry`: after `SESSION_EXPIRES_IN + 2`s idle, a reload lands on `/sign-in`.

## How to get to it (user POV)

- Open a protected URL while signed out.
- Sign in, reload, or choose `Sign out` in the header. Sign in on two devices.

## Driving it with auth.sh

Preconditions:

- `auth.sh doctor` is all `ok`, including the `/settings` redirect line.

- **Routes.** Run `auth.sh check --only protected-routes`.
- **Lifecycle.** Run `auth.sh check --only session-lifecycle`. Screenshots `01-signed-out.png` and `02-phone-still-in.png` are saved.
- **Idle expiry.** Run `auth.sh check --only session-expiry`. It takes about 35s at the default 30s lifetime.

## Gotchas

- Expiry slides forward with use (`updateAge` = lifetime / 168). Any request during the idle wait, even a background fetch, resets the clock, so the journey leaves the page untouched while it waits.
- Cookies are `Secure` only on an HTTPS origin, and the stage is plain `http://localhost`. Assert `Secure` only against a deployed HTTPS stage, which this skill does not drive.
- A short session lifetime also bounds every other journey. Raising `VERIFY_AUTH_CODE_EXPIRES_IN` above `VERIFY_AUTH_SESSION_EXPIRES_IN` makes the linking journeys flaky.
