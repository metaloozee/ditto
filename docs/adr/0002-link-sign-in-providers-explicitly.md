# Link additional sign-in methods explicitly in Settings

Registration enables the first sign-in method for a Ditto account. Email registration enables email OTP. A GitHub or Google user can enable email OTP by explicitly linking their email in Settings. A matching address alone grants no additional sign-in method.

Settings lists the enabled methods and lets a signed-in user add one. Linking GitHub or Google requires completing that provider’s OAuth flow, with the same Ditto account signed in at initiation and callback. Linking email requires a fresh, single-use code sent to the existing Ditto address and verified in the same signed-in account. A linking code is valid only for that operation. An additional social provider must verify the same email address and its identity must be available to link. If either check fails, existing links stay intact. A visitor who proves ownership using an unlinked OAuth provider sees an explanation on the sign-in page and receives no session.

Ditto recognizes a linked identity by its provider and stable provider account ID. A later email change at that provider preserves access through the link and leaves the Ditto email address in place.

Email sign-in sends a code only to an account with email enabled. The sign-in page gives the same response for every valid address so visitors cannot look up which methods an account uses. Ditto checks eligibility again before issuing a session. A person who loses access to every enabled method must recover one through its provider.
