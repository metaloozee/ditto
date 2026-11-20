# Accept provider names at registration

Email registration collects first name, last name, and email on one form. Submitting the form sends a one-time code. OAuth registration accepts the profile the provider supplies, including a GitHub login when its display name is absent. Keeping structured name fields optional for OAuth preserves names that Ditto cannot reliably split into parts.

Email sign-up creates the account after successful verification. An abandoned attempt leaves the address available. Email sign-in can only open an existing account. If an existing email user repeats sign-up, verification directs them to sign in and preserves their saved names.
