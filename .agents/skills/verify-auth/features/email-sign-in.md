# Email sign-in and codes

A returning email user signs in with a code and lands in their original account. Every valid address gets the same `Check your email` acknowledgement. An unknown address, or an account without email enabled, gets that acknowledgement and no mail. Codes are single-use and get three wrong tries. A resend replaces the old code, and a code expires.

## Sub-features

- `signin-email`: a fresh browser signs in to the same user id (D1 sessions: 2). The used code typed again in a third browser shows `That code didn’t work. Check it or request a new one.` and opens no session.
- `signin-unknown`: an unknown address and a GitHub-only address show identical instructions, with the address replaced by `<email>`. Neither receives mail. A guessed code fails, and no user row is created.
- `code-wrong`: three wrong codes count down through `That code isn’t right. 2 tries left.` and `1 try left.`, then show `Too many incorrect codes. Send a new one to continue.` No account is created.
- `code-resend`: `Send a new code` becomes available after the resend wait and shows `New code sent`, and the inbox holds 2 emails. The old code then counts as wrong, and the new code creates the account.
- `code-expired`: a code entered after `CODE_EXPIRES_IN + 1`s shows `This code has expired. Send a new one to continue.`

## How to get to it (user POV)

- Open `/sign-in`, fill `Email address`, then choose `Continue with email`.
- On `Check your email`, type the code, or choose `Send a new code` or `Use a different email`.

## Driving it with auth.sh

Preconditions:

- `auth.sh doctor` is all `ok`. Code knobs are at their defaults (10s expiry, 3s resend) unless overridden on both `up` and `check`.

- **Return by email.** Run `auth.sh check --only signin-email`.
- **Private acknowledgement.** Run `auth.sh check --only signin-unknown`. Compare `01-unknown-ack.png` with `02-github-only-ack.png`.
- **Code lifecycle.** Run `auth.sh check --only code-wrong,code-resend,code-expired`.

## Gotchas

- The wrong-code, resend, and expiry journeys use sign-up so a fresh address receives mail. Sign-up and sign-in share the code-entry UI and expiry settings. Sign-in uses Better Auth’s email OTP verification and shows `Code requested` on resend. Sign-up verifies its own challenge and shows `New code sent`.
- `code-resend` checks the replaced-code rejection only when the new code differs from the old one, as equal codes are indistinguishable. When the codes match, the report omits the `replaced code rejected` fact.
- The sign-in step's `Code` error after an unknown address is deliberately the generic `That code didn’t work…`. A specific message would leak whether the address is registered.
