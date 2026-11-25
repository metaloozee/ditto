# GitHub and Google

A visitor registers or returns with GitHub or Google from `/sign-in` or `/sign-up`. The profile comes from the provider: GitHub's display name (or its login when the name is missing), and Google's name plus its given and family names. Names are never split. A returning identity is recognized by its provider account id, even after the upstream email changes. Cancelled consent returns to sign-in with a message. A provider that isn't linked to an existing account with the same email gets `This account uses another sign-in method`, and the visitor gets no session and no link.

## Sub-features

- `github-signup`: opens the workspace with the GitHub name in the Account menu. D1 holds the name with `first_name` and `last_name` both null, the methods `["github"]`, and `account_id` = the GitHub id. The same id coming back with a new email reaches the same user, and the Ditto email is unchanged.
- `github-private-email`: an identity with `email: null` and a verified private primary address registers under that address.
- `github-no-name`: `name: null` shows the GitHub login in the Account menu.
- `github-cancel`: cancelled consent shows `GitHub sign-in was cancelled` on `/sign-in`, with no session.
- `google-signup`: from `/sign-up`, D1 stores the provider’s name and its given and family names in `name`, `first_name`, and `last_name`, and the methods are `["google"]`. A return reaches the same user, and a cancel shows `Google sign-in was cancelled`.
- `oauth-other-method`: Google with the same verified email as a GitHub account shows `This account uses another sign-in method` on `/sign-in`. It opens no session, and D1 methods stay `["github"]`.

## How to get to it (user POV)

- Choose `Continue with GitHub` or `Continue with Google` on `/sign-in` or `/sign-up`, then consent or cancel on the provider's screen.

## Driving it with auth.sh

Preconditions:

- `auth.sh doctor` is all `ok`, including the fake upstream line.

- **GitHub.** Run `auth.sh check --only github-signup,github-private-email,github-no-name,github-cancel`.
- **Google.** Run `auth.sh check --only google-signup`.
- **Unlinked method.** Run `auth.sh check --only oauth-other-method`. The screenshot `01-other-method.png` shows the toast on `/sign-in`.

## Gotchas

- The fake consent screen answers the next queued authorization, and a click with nothing queued cancels. Queue first, then click. `continueWith` in `auth-check.mjs` does it in that order.
- The redirect chain ends in one new page load. Wait for `load` plus `networkidle`, not for a URL, because the error path and the success path land on different routes.
- `OAUTH_UPSTREAM` reroutes only `github.com`, `api.github.com` and `oauth2.googleapis.com` server calls, and only in the `test` stage. Real providers are never contacted.
- Google ID tokens from the fake are unsigned. The Worker accepts them only because it uses the code flow with `disableIdTokenSignIn`.
