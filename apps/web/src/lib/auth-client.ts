import { useNavigate } from "@tanstack/react-router";
import { emailOTPClient, lastLoginMethodClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { signOutFailedToast, signedOutToast } from "#/components/account.tsx";
import { oauthFailedToast, type Provider } from "#/components/auth.tsx";
import { toast } from "#/components/ui/toast.tsx";

export const authClient = createAuthClient({
	plugins: [emailOTPClient(), lastLoginMethodClient()],
});

/** Ends this browser's session on the server, then returns to sign-in. */
export function useSignOut() {
	const navigate = useNavigate();
	return async () => {
		const result = await authClient.signOut().catch(() => undefined);
		if (!result?.data?.success) {
			toast(signOutFailedToast);
			return;
		}
		await navigate({ to: "/sign-in" });
		toast(signedOutToast);
	};
}

/**
 * Leaves for the provider's consent screen. Success lands on the home page;
 * a failure or cancellation returns to /sign-in with Better Auth's `error`.
 */
export async function continueWith(provider: Provider) {
	const result = await authClient.signIn
		.social({
			provider,
			callbackURL: "/",
			errorCallbackURL: `/sign-in?provider=${provider}`,
		})
		.catch(() => undefined);
	if (!result?.data) toast(oauthFailedToast(provider));
}
