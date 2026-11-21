# Email sign-up

A visitor creates an account with a first name, a last name and an email address. The account exists only once the emailed code is verified. A mistyped address can be corrected before verifying. Signing up again with an address that already has an email account sends the visitor to sign in, and the saved profile stays as it was.

## Sub-features

- `signup-email`: the form leads to the `Check your email` step with no user row yet. One email arrives from `Ditto <sign-in@test.example>` with the subject `###### is your Ditto code` and a line giving the expiry. Entering the code lands on `Welcome back, Ada Lovelace`. D1 then holds `name`, `first_name` and `last_name`, the methods `["email"]` and one session.
- `signup-change-email`: `Use a different email` returns to the form with the names kept. The corrected address gets the account, and the mistyped address gets no user row.
- `signup-existing`: a second sign-up with names `Someone Else` and a valid code lands on `/sign-in` with `You already have a Ditto account`. It opens no session, D1 keeps `Ada`/`Lovelace`, and there is still one user for the address.

## How to get to it (user POV)

- Open `/sign-up`, or `/sign-in` and then `Sign up`.
- Fill `First name`, `Last name` and `Email address`, then choose `Continue with email`.
- Type the six digits from the email into `Code`.

## Driving it with auth.sh

Preconditions:

- `auth.sh doctor` is all `ok`.

- **Register.** Run `auth.sh check --only signup-email`. Screenshots `01-code-step.png` and `02-home.png` are saved, and `emails-<address>.json` shows the redacted message.
- **Correct the address.** Run `auth.sh check --only signup-change-email`.
- **Repeat registration.** Run `auth.sh check --only signup-existing`. The screenshot `01-sent-to-sign-in.png` shows the toast.

## Gotchas

- The subject line carries the code by design (`<code> is your Ditto code`). Evidence redacts it, so assert the shape and never the digits.
- Six-digit codes can coincide across addresses. Journeys always read the code for the exact address they typed.
- Repeat sign-up for an address owned by a GitHub or Google account shows `This account uses another sign-in method` instead. The Vitest suite covers that case.
