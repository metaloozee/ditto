import { useNavigate } from "@tanstack/react-router";
import { createAuthClient } from "better-auth/react";

import { signedOutToast } from "#/components/account.tsx";
import type { Provider } from "#/components/auth.tsx";
import { toast } from "#/components/ui/toast.tsx";

export const authClient = createAuthClient();

/** Ends this browser's session on the server, then returns to sign-in. */
export function useSignOut() {
	const navigate = useNavigate();
	return async () => {
		await authClient.signOut();
		await navigate({ to: "/sign-in" });
		toast(signedOutToast);
	};
}

/**
 * Leaves for the provider's consent screen. Success lands on the home page;
 * a failure or cancellation returns to /sign-in with Better Auth's `error`.
 */
export function continueWith(provider: Provider) {
	void authClient.signIn.social({
		provider,
		callbackURL: "/",
		errorCallbackURL: `/sign-in?provider=${provider}`,
	});
}
