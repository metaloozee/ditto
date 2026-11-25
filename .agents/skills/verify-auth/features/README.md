# Auth verification map

This map is the maintained source for what Ditto's authentication does, from the user's side. Read this index before driving auth, then use the matching feature file as the recipe. Issue #3 defines the auth flows. Issue #17 supplies the workspace owners reach after sign-in.

## Baseline preconditions

- The stage is running from `auth.sh up` at `http://localhost:1339`, and `auth.sh doctor` reports all `ok`.
- D1 starts empty at `up`. Journeys create their own users with unique addresses (`ada+<uuid>@example.com`) and unique GitHub ids and Google subs, so the run order doesn't matter and a rerun on the same stage still works.
- Each `visitor` is a fresh browser context with its own cookies and its own `cf-connecting-ip`, like a separate device. Distinct addresses keep journeys from sharing rate limits.

## Driving conventions

- Handles are accessible names and visible copy, for example the buttons `Continue with email`, `Continue with GitHub`, `Link Google` and `Back to Settings`, the `Sign out` menu item, and the labels `First name`, `Email address` and `Code`. Filling all six digits of `Code` submits the code.
- What the fake consent screen does next is queued before the click: `POST <upstream>/__github/next` or `POST <upstream>/__google/next`, with an identity or `{"cancel":true}`. With nothing queued, the screen cancels.
- Codes come from `GET <upstream>/__emails?to=<address>`, and the newest email wins.
- Run journeys with `auth.sh check --only <id>[,<id>]`.

## Proof and skip reporting

- Proof is the run's `report.md`, plus the screenshots, ARIA snapshots and redacted emails it names.
- `D1 …` facts are the side-effect proof. A journey that shows the right screen while D1 disagrees is red.
- A `Precondition:` failure is reported as unverified, with its reason, and never as a pass.

## Features

| Feature | Journey ids |
| --- | --- |
| [Email sign-up](./email-sign-up.md): names, email and a code create the account | `signup-email`, `signup-change-email`, `signup-existing` |
| [Email sign-in and codes](./email-sign-in.md): returning email users, private acknowledgements, code lifecycle | `signin-email`, `signin-unknown`, `code-wrong`, `code-resend`, `code-expired` |
| [GitHub and Google](./oauth.md): OAuth registration, return, cancellation, unlinked methods | `github-signup`, `github-private-email`, `github-no-name`, `github-cancel`, `google-signup`, `oauth-other-method` |
| [Linking in Settings](./linking.md): add a method by proving it while signed in | `link-google`, `link-github`, `link-email`, `link-rejected` |
| [Sessions](./session.md): protected routes, refresh, sign-out, devices, idle expiry | `protected-routes`, `session-lifecycle`, `session-expiry` |

## Not covered here

The Vitest suite in `apps/web/tests/auth/` already checks these at the HTTP or race level: concurrent code submission, send and verify throttling, Resend delivery failure, untrusted origins and return URLs, forged OAuth state, disabled password and unlink endpoints, and session changes in the middle of linking. The browser tests in `last-used.test.ts` cover the Last used badge. Run it with `pnpm exec vp test run --project auth`. It uses its own stage on port 1338.
