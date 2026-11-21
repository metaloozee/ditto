# Linking in Settings

A signed-in user sees their enabled methods in Settings and can add another one by proving it. GitHub and Google need a successful OAuth flow whose verified email matches the Ditto email. Email needs a fresh code sent to the Ditto email and entered in the same session. A rejected, cancelled or mismatched attempt changes nothing. After linking, either method opens the same account.

## Sub-features

- `link-google`: a GitHub account links Google and sees `Google is linked`. D1 methods become `["github","google"]`, and Settings shows two `Enabled` badges. Google sign-in in a fresh browser reaches the same user.
- `link-github`: a Google account links a GitHub identity whose private primary address matches. GitHub sign-in then greets the user with the original Google name.
- `link-email`: before linking, an email sign-in request sends no mail. `Link Email` opens `Add email sign-in` and sends a code. That linking code typed into a stranger's sign-in step fails and opens no session. Entered by the owner, it shows `Email is linked`, and D1 methods become `["email","github"]`. Email sign-in then reaches the same user.
- `link-rejected`: four attempts on one GitHub account, after which D1 methods are still `["github"]`. The Google identity owned by another account stays with its owner.
  - A Google account with a different email shows `That Google account uses a different email`.
  - A Google identity already owned by another Ditto account shows `That Google account belongs to another Ditto account`.
  - Cancelled Google consent shows `Google wasn’t linked` and `You cancelled before it finished. Nothing changed.`
  - `Back to Settings` on the email step shows `Email wasn’t linked`.

## How to get to it (user POV)

- Sign in, choose `Settings` in the header, then `Link GitHub`, `Link Google` or `Link Email` under `Sign-in methods`.
- For email, type the code on `Add email sign-in`, or choose `Back to Settings`.

## Driving it with auth.sh

Preconditions:

- `auth.sh doctor` is all `ok`.

- **OAuth linking.** Run `auth.sh check --only link-google,link-github`.
- **Email linking.** Run `auth.sh check --only link-email`. The screenshots `01-verify-email.png`, `02-linked.png` and `03-home-via-email.png` are saved.
- **Rejections.** Run `auth.sh check --only link-rejected`. One screenshot is saved for each toast.

## Gotchas

- The Settings toast is shown once, and then the URL drops `?outcome=`. `t.link` reloads `/settings` before each attempt, so an earlier toast can't satisfy a later check.
- `Cancelled` and `interrupted` share the title `<Method> wasn’t linked`. Only the description tells them apart, so assert it.
- Unlinking does not exist (`/unlink-account` is disabled). Linked state accumulates for the life of a stage. Use a new identity for every journey.
- Session-change-during-linking (sign-out, expiry, cookie swap before the callback) needs a request paused in the middle of a redirect. The Vitest suite covers it (`link-oauth.test.ts`, `link-email.test.ts`), and it is not driven here.
