import { createIsomorphicFn, createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";

import { METHOD_KEYS, type Account, type Method } from "#/components/account.tsx";
import { oneOf } from "#/components/auth.tsx";
import { authClient } from "#/lib/auth-client.ts";

/** The signed-in Ditto account, or `null` without a live session. */
export const getAccount = createServerFn({ method: "GET" }).handler(
	async (): Promise<Account | null> => {
		const { auth } = await import("./auth.server.ts");
		const headers = getRequestHeaders();
		const session = await auth.api.getSession({ headers });
		if (!session) return null;
		const linked = await auth.api.listUserAccounts({ headers });
		return {
			displayName: session.user.name,
			email: session.user.email,
			methods: METHOD_KEYS.filter((method) => linked.some((a) => a.providerId === method)),
		};
	},
);

/**
 * The method this browser last signed in with, kept after sign-out so the
 * sign-in screen can point back to it. Read from the request during SSR and
 * from `document.cookie` after hydration, so both renders agree.
 */
export const getLastUsedMethod = createIsomorphicFn()
	// The cookie Better Auth's last-login-method plugin sets by default.
	.server((): Method | undefined =>
		oneOf(METHOD_KEYS, getCookie("better-auth.last_used_login_method")),
	)
	.client((): Method | undefined => oneOf(METHOD_KEYS, authClient.getLastUsedLoginMethod()));
