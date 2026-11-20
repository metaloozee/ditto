# Link additional sign-in methods explicitly in Settings

Registration enables the first sign-in method for a Ditto account. Email registration enables email OTP. A GitHub or Google user can enable email OTP by explicitly linking their email in Settings. A matching address alone grants no additional sign-in method.

Settings lists the enabled methods and lets a signed-in user add one. Linking GitHub or Google requires completing that provider’s OAuth flow, with the same Ditto account signed in at initiation and callback. Linking email requires a fresh, single-use code sent to the existing Ditto address and verified in the same signed-in account. A linking code is valid only for that operation. An additional social provider must verify the same email address and its identity must be available to link. If either check fails, existing links stay intact. A visitor who proves ownership using an unlinked method sees an explanation on the sign-in page and receives no session.

Ditto recognizes a linked identity by its provider and stable provider account ID. A later email change at that provider preserves access through the link and leaves the Ditto email address in place.

On email sign-in, Ditto sends a code even when the existing account has email sign-in disabled. After mailbox verification, Ditto explains the conflict without creating a session or enabling email. This timing keeps account membership private until the visitor proves mailbox ownership. A person who loses access to every enabled method must recover one through its provider.
